// Ricerca prospect · PROFILO di una struttura dal suo sito: anagrafica (ragione sociale, P.IVA, PEC, telefono, email, indirizzo),
// segnali, key people ed email. Si leggono la pagina iniziale e al massimo altre sette pagine scelte dal menu del sito (contatti, chi
// siamo, direzione ed équipe, lavora con noi, servizi, note legali), con una pausa tra una e l'altra. Nessun modello di AI, nessun costo.
import { scarica, leggiRobots, dominioDi, normUrl, pausa } from './web.js';
import { testoPagina, linkPagina, jsonLd, emailPubblicate, telefoni, partiteIva, ragioniSociali, indirizzoDaTesto, indirizzoDaLd, organizzazioniLd, eGenerica } from './estrai.js';
import { personeDaTesto, personeDaLd, sceltaPersone } from './persone.js';
import { abbinaEmail, dominioRicevePosta } from './email.js';
import { rilevaSegnali } from './segnali.js';

// pagine da cercare nel menu, in ordine di utilità: [chiave, espressione su testo del link o indirizzo, quante al massimo]
const PAGINE = [
  ['contatti', /contatt|contact|dove\s+siamo|recapiti/i, 1],
  ['persone', /direzione|organigramma|équipe|equipe|\bteam\b|staff|i\s+nostri\s+(?:medici|professionisti|specialisti)|chi[-\s]?siamo|about|la[-\s]struttura|l['’]azienda|azienda|la[-\s]società|la[-\s]nostra[-\s]storia|governance|management/i, 3],
  ['lavoro', /lavora[-\s]con[-\s]noi|carriere|careers|posizioni[-\s]aperte|candidat/i, 1],
  ['servizi', /laboratorio|prelievi|analisi|servizi|prestazioni|carta[-\s]dei[-\s]servizi/i, 1],
  ['legali', /note[-\s]legali|privacy|dati[-\s]societari|trasparenza/i, 1],
];
const NON_PAGINA = /\.(pdf|docx?|xlsx?|zip|jpe?g|png|gif|webp|mp4|ics)(\?|$)/i;

export function scegliPagine(links, home, max = 7) {
  const dom = dominioDi(home); const visti = new Set([home.replace(/\/$/, '')]); const out = [];
  for (const [tipo, re, quante] of PAGINE) {
    let n = 0;
    for (const l of links) {
      if (out.length >= max || n >= quante) break;
      const pulito = l.url.replace(/\/$/, '');
      if (visti.has(pulito) || NON_PAGINA.test(l.url) || dominioDi(l.url) !== dom) continue;
      let percorso = ''; try { percorso = decodeURIComponent(new URL(l.url).pathname); } catch { /* indirizzo strano: vale il testo */ }
      if (re.test(l.testo) || re.test(percorso)) { visti.add(pulito); out.push({ url: l.url, tipo }); n += 1; }
    }
  }
  return out;
}

/**
 * Profila un sito. `leggi` è iniettabile per i test. Ritorna
 * { ok, errore, sfida, pagine:[{url,tipo}], anagrafica:{campo:{valore,url}}, persone:[…], segnali:{…}, email:{generali,pec,schema,dominio}, dominio }
 */
export async function profilaSito(sito, { linea = 'SRV', fornitori = null, attivi = null, leggi = scarica, attesa = 700, mx = dominioRicevePosta, maxPersone = 4 } = {}) {
  const home0 = normUrl(sito);
  if (!home0) return { ok: false, errore: 'Sito non valido' };
  let consentito = () => true;
  const rb = await leggi(new URL('/robots.txt', home0).toString());
  if (rb.ok && /text|plain/i.test(rb.tipo || 'text') && rb.testo) consentito = leggiRobots(rb.testo);
  const percorso = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return '/'; } };
  if (!consentito(percorso(home0))) return { ok: false, errore: 'Il sito chiede ai programmi automatici di non leggerlo (robots.txt): non lo leggiamo' };
  let h = await leggi(home0);
  if (!h.ok && home0.startsWith('https://') && !h.sfida) { const alt = await leggi(home0.replace(/^https:/, 'http:')); if (alt.ok) h = alt; }
  if (!h.ok) return { ok: false, errore: h.errore || 'Sito non raggiungibile', sfida: Boolean(h.sfida) };
  const home = h.url; const dominio = dominioDi(home);
  const pagine = [{ url: home, tipo: 'home', html: h.testo, testo: testoPagina(h.testo) }];
  for (const p of scegliPagine(linkPagina(h.testo, home), home)) {
    if (!consentito(percorso(p.url))) continue;
    await pausa(attesa);
    const r = await leggi(p.url);
    if (r.ok && r.testo) pagine.push({ url: r.url, tipo: p.tipo, html: r.testo, testo: testoPagina(r.testo) });
  }
  // ---- anagrafica: ogni campo con la pagina di provenienza
  const an = {};
  const metti = (campo, valore, url) => { if (valore && !an[campo]) an[campo] = { valore, url }; };
  const ld = pagine.flatMap((p) => jsonLd(p.html).map((x) => ({ x, url: p.url })));
  const org = organizzazioniLd(ld.map((l) => l.x))[0];
  // la P.IVA e la ragione sociale stanno di norma nel piè di pagina: si parte dal fondo della pagina iniziale e dalle note legali
  const ordine = [...pagine].sort((a, b) => (['legali', 'home', 'contatti'].indexOf(a.tipo) + 9) % 9 - (['legali', 'home', 'contatti'].indexOf(b.tipo) + 9) % 9);
  for (const p of ordine) {
    const coda = p.testo.slice(-2500);
    metti('piva', partiteIva(coda)[0] || partiteIva(p.testo)[0], p.url);
    const iPiva = coda.search(/p(?:artita)?\.?\s*i\.?v\.?a/i);
    const rs = ragioniSociali(iPiva >= 0 ? coda.slice(Math.max(0, iPiva - 400), iPiva + 200) : coda);
    metti('ragione_sociale', rs[0], p.url);
  }
  if (org?.legalName) metti('ragione_sociale', String(org.legalName).trim(), home);
  if (org?.vatID && !an.piva) { const v = String(org.vatID).replace(/\D/g, ''); if (partiteIva(`P.IVA ${v}`)[0]) metti('piva', v, home); }
  const indLd = indirizzoDaLd(ld.map((l) => l.x));
  const indTx = pagine.filter((p) => ['contatti', 'home', 'legali'].includes(p.tipo)).map((p) => ({ i: indirizzoDaTesto(p.testo.slice(-3000)) || indirizzoDaTesto(p.testo), url: p.url })).find((x) => x.i);
  const ind = indLd || indTx?.i;
  if (ind) for (const k of ['indirizzo', 'cap', 'comune', 'provincia']) metti(k, ind[k], indLd ? home : indTx.url);
  for (const p of pagine.filter((x) => ['contatti', 'home'].includes(x.tipo))) metti('telefono', telefoni(p.testo, p.html)[0], p.url);
  if (org?.telephone) metti('telefono', String(org.telephone), home);
  // ---- email pubblicate, persone, schema
  const emails = pagine.flatMap((p) => emailPubblicate(p.html).map((e) => ({ ...e, url: p.url })));
  const trovate = [...pagine.flatMap((p) => personeDaTesto(p.testo, p.url)), ...ld.flatMap((l) => personeDaLd([l.x], l.url))];
  const scelte = sceltaPersone(trovate, linea, maxPersone);
  const ab = abbinaEmail(scelte, emails, dominio);
  const urlDi = (e) => emails.find((x) => x.email === e)?.url || home;
  if (ab.generali[0]) metti('email', ab.generali[0], urlDi(ab.generali[0]));
  if (ab.pec[0]) metti('pec', ab.pec[0], urlDi(ab.pec[0]));
  const contatti = pagine.find((p) => p.tipo === 'contatti');
  // ---- segnali
  const segnali = rilevaSegnali({ pagine, fornitori, attivi, linea });
  const deriva = (k, v) => { if (v && (!attivi || attivi[k] !== false)) segnali[k] = v; };
  const ds = ab.persone.find((p) => p.ruolo === 'DIRETTORE_SANITARIO');
  deriva('DIRETTORE_SANITARIO_NOTO', ds && { valore: ds.nome, evidenza: ds.evidenza, url: ds.url });
  const dec = ab.persone.find((p) => ['LEGALE', 'DIREZIONE', 'DIRETTORE_SANITARIO', 'PERSONALE', 'SICUREZZA'].includes(p.ruolo));
  deriva('DECISORE_NOTO', dec && { valore: `${dec.nome}, ${dec.titolo || ''}`.replace(/, $/, ''), evidenza: dec.evidenza, url: dec.url });
  deriva('EMAIL_GENERALE', an.email && { valore: an.email.valore, evidenza: 'Indirizzo pubblicato sul sito', url: an.email.url });
  const ed = ab.persone.find((p) => p.email);
  deriva('EMAIL_DECISORE', ed && { valore: `${ed.email} (${ed.email_stato === 'PUBBLICATA' ? 'pubblicata' : 'ipotesi'})`, evidenza: ed.email_stato === 'PUBBLICATA' ? 'Indirizzo pubblicato sul sito' : `Ipotesi dallo schema ${ab.schema}`, url: ed.url });
  deriva('SCHEMA_EMAIL', ab.schema && { valore: `${ab.schema}@${ab.dominio}`, evidenza: 'Imparato da un indirizzo personale pubblicato sul sito', url: home });
  deriva('PEC_NOTA', an.pec && { valore: an.pec.valore, evidenza: 'PEC pubblicata sul sito', url: an.pec.url });
  deriva('PIVA_NOTA', an.piva && { valore: an.piva.valore, evidenza: 'Partita IVA con cifra di controllo valida', url: an.piva.url });
  const riceve = await mx(ab.dominio || dominio).catch(() => null);
  deriva('DOMINIO_RICEVE_POSTA', riceve === true && { valore: true, evidenza: `Il dominio ${ab.dominio || dominio} ha un servizio di posta`, url: home });
  return {
    ok: true, dominio, home, pagine: pagine.map((p) => ({ url: p.url, tipo: p.tipo })), anagrafica: an, persone: ab.persone, segnali,
    email: { generali: ab.generali.filter((e) => eGenerica(e) || true).slice(0, 5), pec: ab.pec.slice(0, 2), schema: ab.schema, dominio: ab.dominio, riceve_posta: riceve },
    modulo_contatti: contatti?.url || null,
  };
}
