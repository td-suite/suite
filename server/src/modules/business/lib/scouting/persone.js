// Ricerca prospect · key people dalle pagine del sito dell'azienda: chi decide, con il titolo scritto sul sito e la frase di
// provenienza. Solo ruoli professionali pubblicati dall'azienda stessa (direzione sanitaria, direzione, legale rappresentante, acquisti,
// laboratorio, coordinamento, personale, sicurezza). Mai clienti citati nelle testimonianze, ex titolari o persone di altre aziende.
import { frase } from './estrai.js';

// rango: più basso = più vicino alla decisione, per linea
export const RUOLI = [
  { ruolo: 'DIRETTORE_SANITARIO', etichetta: 'Direttore sanitario', re: /dirett(?:ore|rice)\s+sanitari[oa]|direzione\s+sanitaria/i, rango: { SRV: 10, PP: 10, MDL: 40 } },
  { ruolo: 'LEGALE', etichetta: 'Legale rappresentante o titolare', re: /legale\s+rappresentante|amministrat(?:ore|rice)\s+(?:unic[oa]|delegat[oa])|president[ea](?:\s+del\s+(?:cda|consiglio)[\wà ]*)?|titolare|proprietari[oa]|\bceo\b|fondat(?:ore|rice)|socio\s+amministratore/i, rango: { SRV: 15, PP: 12, MDL: 15 } },
  { ruolo: 'DIREZIONE', etichetta: 'Direzione', re: /dirett(?:ore|rice)\s+general[ei]|dirett(?:ore|rice)\s+(?:di|della)\s+struttura|dirett(?:ore|rice)\s+(?:amministrativ[oa]|operativ[oa]|gestionale)|responsabile\s+(?:di|della)\s+struttura|coordinat(?:ore|rice)\s+(?:di|della)\s+struttura|dirett(?:ore|rice)\s+(?:della\s+)?(?:rsa|residenza|casa di cura|farmacia)/i, rango: { SRV: 20, PP: 20, MDL: 25 } },
  { ruolo: 'ACQUISTI', etichetta: 'Acquisti', re: /responsabile\s+(?:ufficio\s+)?(?:acquisti|approvvigionament[io])|ufficio\s+acquisti|econom[oa]|provveditor[ea]/i, rango: { SRV: 25, PP: 35, MDL: 30 } },
  { ruolo: 'LABORATORIO', etichetta: 'Laboratorio', re: /(?:responsabile|dirett(?:ore|rice))\s+(?:del\s+|di\s+)?laboratorio|dirett(?:ore|rice)\s+tecnic[oa]/i, rango: { SRV: 30, PP: 30, MDL: 60 } },
  { ruolo: 'INFERMIERISTICO', etichetta: 'Coordinamento infermieristico', re: /coordinat(?:ore|rice)\s+infermieristic[oa]|responsabile\s+infermieristic[oa]|caposala/i, rango: { SRV: 35, PP: 40, MDL: 60 } },
  { ruolo: 'PERSONALE', etichetta: 'Risorse umane', re: /responsabile\s+(?:delle\s+)?(?:risorse\s+umane|del\s+personale|hr)|hr\s+manager|dirett(?:ore|rice)\s+(?:del\s+personale|risorse\s+umane)/i, rango: { SRV: 50, PP: 50, MDL: 10 } },
  { ruolo: 'SICUREZZA', etichetta: 'Sicurezza sul lavoro (RSPP)', re: /\brspp\b|responsabile\s+(?:del\s+)?servizio\s+(?:di\s+)?prevenzione(?:\s+e\s+protezione)?/i, rango: { SRV: 60, PP: 60, MDL: 12 } },
  { ruolo: 'MEDICO_COMPETENTE', etichetta: 'Medico competente', re: /medico\s+competente/i, rango: { SRV: 70, PP: 70, MDL: 35 } },
  { ruolo: 'QUALITA', etichetta: 'Qualità', re: /responsabile\s+(?:della\s+)?(?:qualità|assicurazione\s+qualità)/i, rango: { SRV: 45, PP: 45, MDL: 45 } },
];
const ONOR = '(?:Dott\\.?(?:\\s?ssa)?|Dr\\.?(?:\\s?ssa)?|Prof\\.?(?:\\s?ssa)?|Ing\\.?|Avv\\.?|Rag\\.?|Geom\\.?|Arch\\.?|Sig\\.?(?:\\s?ra)?)';
const PAROLA = "[A-ZÀ-Ý][a-zà-ÿ]+(?:['’-][A-ZÀ-Ýa-zà-ÿ]+)?|[A-ZÀ-Ý]{2,}(?:['’-][A-ZÀ-Ý]+)?";
const PARTIC = '(?:[Dd][aei]|[Dd]el(?:l[ao’\'])?|[Dd]ell[aeo]|[Ll][aeo]|[Dd]\'|[Dd]’)';
const NOME = `(?:${ONOR}\\s+)?((?:${PAROLA})(?:\\s+(?:${PARTIC}\\s*)?(?:${PAROLA})){1,3})`;
// parole che non sono mai parte di un nome di persona: titoli, reparti, voci di menu
const NON_NOME = new Set(('direttore direttrice sanitario sanitaria direzione generale responsabile struttura centro medico medica studio servizi servizio contatti chi siamo home privacy team staff nostro nostra nostri nostre '
  + 'laboratorio analisi ambulatorio poliambulatorio residenza casa cura rsa farmacia azienda società gruppo ufficio acquisti amministratore unico delegato presidente titolare legale rappresentante coordinatore '
  + 'infermieristico via viale piazza corso italia toscana firenze prato pistoia lucca pisa livorno arezzo siena grosseto massa carrara orari sede sedi telefono email pec informazioni cookie policy '
  + 'lunedì martedì mercoledì giovedì venerdì sabato domenica gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre prenota prenotazione visita visite esami '
  + 'tecnico amministrativo operativo qualità personale risorse umane sicurezza lavoro competente equipe organigramma carta dei convenzioni news lavora con noi area riservata iscrizione ordine medici '
  + 'specialista specialistica chirurgo chirurgia cardiologia ortopedia ginecologia dermatologia pediatria radiologia fisioterapia riabilitazione diagnostica prevenzione salute benessere').split(' '));
const SCARTA_RIGA = /\b(?:ex|già|compiant[oa]|in memoria|fino al|dal \d{4} al \d{4}|recensione|testimonianz|paziente|cliente|ha scritto|ci ha scelto)\b/i;

export function nomePlausibile(n) {
  const parole = String(n || '').trim().split(/\s+/);
  if (parole.length < 2 || parole.length > 5) return false;
  if (parole.some((p) => NON_NOME.has(p.toLowerCase().replace(/[’']/g, '')))) return false;
  if (parole.every((p) => p === p.toUpperCase()) && parole.join('').length < 6) return false;
  return parole.filter((p) => p.length >= 2 && !/^(d[aei]|del|della|dello|dell|la|le|lo)$/i.test(p)).length >= 2;
}
export const nomeProprio = (n) => String(n || '').trim().split(/\s+/).map((p) => (/^(d[aei]|del|della|dello|la|le|lo)$/i.test(p) ? p.toLowerCase() : p === p.toUpperCase() && p.length > 2 ? p[0] + p.slice(1).toLowerCase() : p)).join(' ');
const ruoloDi = (testo) => RUOLI.find((r) => r.re.test(testo)) || null;
const titoloDi = (testo, r) => { const m = String(testo).match(r.re); return m ? m[0].replace(/\s+/g, ' ').trim() : null; };

/**
 * Persone con un ruolo chiave lette da una pagina: [{ nome, titolo, ruolo, evidenza, url }].
 * Tre forme: "Titolo: Dott. Nome Cognome", "Dott. Nome Cognome, Titolo", scheda con nome e titolo su due righe vicine.
 */
export function personeDaTesto(testo, url) {
  const out = [];
  const righe = String(testo || '').split('\n');
  const aggiungi = (nome, riga, r, sorgente) => {
    const pulito = nomeProprio(nome.replace(/\s+/g, ' ').trim());
    if (!nomePlausibile(pulito) || SCARTA_RIGA.test(sorgente)) return;
    out.push({ nome: pulito, titolo: titoloDi(riga, r), ruolo: r.ruolo, evidenza: sorgente.replace(/\s+/g, ' ').trim().slice(0, 240), url });
  };
  const reTitoloNome = (r) => new RegExp(`(?:${r.re.source})[\\s:–—-]*(?:è\\s+(?:il|la|l['’])\\s*)?(?:(?:il|la)\\s+)?${NOME}`, 'i');
  const reNomeTitolo = (r) => new RegExp(`${NOME}\\s*[,–—|:(-]\\s*(?:${r.re.source})`, 'i');
  for (let i = 0; i < righe.length; i += 1) {
    const riga = righe[i];
    if (riga.length > 400) {   // paragrafo: si cercano le frasi "il Direttore Sanitario è il Dott. …"
      for (const r of RUOLI) { const m = riga.match(reTitoloNome(r)); if (m && new RegExp(ONOR).test(m[0])) aggiungi(m[1], m[0], r, frase(riga, m.index, m[0].length, 60)); }
      continue;
    }
    const r = ruoloDi(riga);
    if (r) {
      // i nomi propri iniziano con la maiuscola: la ricerca senza distinzione vale solo per il titolo
      const a = riga.match(reTitoloNome(r)); const b = riga.match(reNomeTitolo(r));
      const maiuscola = (n) => /^[A-ZÀ-Ý]/.test(n);
      if (a && maiuscola(a[1])) { aggiungi(a[1], riga, r, riga); continue; }
      if (b && maiuscola(b[1])) { aggiungi(b[1], riga, r, riga); continue; }
      // scheda: il titolo sta su una riga, il nome sulla riga accanto (prima o dopo)
      const soloTitolo = riga.replace(r.re, '').replace(/[\s:–—|,.-]/g, '').length <= 14;
      if (soloTitolo) {
        for (const j of [i - 1, i + 1]) {
          const vicina = righe[j];
          if (!vicina || vicina.length > 70 || ruoloDi(vicina)) continue;
          const m = vicina.match(new RegExp(`^${NOME}$`));
          if (m) { aggiungi(m[1], riga, r, `${vicina} · ${riga}`); break; }
        }
      }
    }
  }
  return out;
}
/** Persone dichiarate nei dati schema.org dell'azienda (founder, employee): mai l'autore di un articolo */
export function personeDaLd(ld, url) {
  const out = [];
  for (const o of ld) {
    const tipi = [].concat(o['@type'] || []).map(String);
    if (!tipi.some((t) => /Organization|LocalBusiness|Medical|Clinic|Hospital|Pharmacy|Corporation/i.test(t))) continue;
    for (const [campo, pred] of [['founder', 'Fondatore'], ['employee', null], ['member', null]]) {
      for (const p of [].concat(o[campo] || [])) {
        if (!p || typeof p !== 'object' || !p.name) continue;
        const titolo = p.jobTitle ? String([].concat(p.jobTitle)[0]) : pred;
        if (!titolo) continue;
        const r = ruoloDi(titolo) || (campo === 'founder' ? RUOLI.find((x) => x.ruolo === 'LEGALE') : null);
        const nome = nomeProprio(String(p.name));
        if (r && nomePlausibile(nome)) out.push({ nome, titolo, ruolo: r.ruolo, evidenza: `Dati strutturati del sito: ${campo} ${nome}, ${titolo}`, url, email: p.email ? String(p.email).replace(/^mailto:/, '').toLowerCase() : null });
      }
    }
  }
  return out;
}
/** Unisce le persone trovate su più pagine (stesso nome), ordina per vicinanza alla decisione e tiene le prime `max` */
export function sceltaPersone(trovate, linea = 'SRV', max = 4) {
  const per = new Map();
  for (const p of trovate) {
    const k = p.nome.toLowerCase();
    const rango = (RUOLI.find((r) => r.ruolo === p.ruolo)?.rango || {})[linea] ?? 50;
    const cur = per.get(k);
    if (!cur || rango < cur.rango) per.set(k, { ...cur, ...p, rango, email: p.email || cur?.email || null });
  }
  return [...per.values()].sort((a, b) => a.rango - b.rango || a.nome.localeCompare(b.nome)).slice(0, max);
}
