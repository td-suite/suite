// Ricerca prospect · persistenza e flusso: ricerche, candidati, profilo in coda, abbinamento con l'anagrafica, promozione in pipeline,
// completamento di un account esistente dal suo sito. Le scritture sull'anagrafica passano dalle funzioni della Suite (nessun doppione).
import { one, many, q, tx } from '../../db.js';
import { createOrganization, cercaDoppione } from '../../../../lib/organizations.js';
import { getSettings } from '../rules.js';
import { scopriProvincia, PROVINCE } from './scoperta.js';
import { profilaSito } from './profila.js';
import { punteggio, CATEGORIE } from './fit.js';
import { FORNITORI_PREDEFINITI, CATALOGO } from './segnali.js';
import { dominioDi, normUrl } from './web.js';
import { RUOLI } from './persone.js';

export async function impostazioni() {
  const s = await getSettings();
  let attivi = {}; try { attivi = JSON.parse(s.scout_segnali || '{}') || {}; } catch { attivi = {}; }
  const fornitori = String(s.scout_fornitori || '').split(/[\n;,]/).map((x) => x.trim()).filter((x) => x.length >= 3);
  return { attivi, fornitori: fornitori.length ? fornitori : FORNITORI_PREDEFINITI, max_persone: Math.min(6, Math.max(1, Number(s.scout_max_persone) || 4)) };
}
export const catalogo = async () => { const i = await impostazioni(); return CATALOGO.map((s) => ({ ...s, attivo: i.attivi[s.key] !== false })); };

/** Legal entity già in anagrafica per P.IVA, dominio dell'email o del sito, nome uguale: { organization_id, account_id, come } */
export async function abbina(c) {
  let org = null; let come = null;
  if (c.piva) { const d = await cercaDoppione({ name: '', vat_number: c.piva }); if (d) { org = d.id; come = 'partita IVA'; } }
  if (!org && c.dominio) {
    const r = await one(`SELECT id FROM public.organizations WHERE lower(coalesce(website,'')) ~ ('(^|[/.])' || regexp_replace($1, '\\.', '\\.', 'g') || '(/|$)') OR lower(split_part(coalesce(email,''), '@', 2)) = $1 ORDER BY active DESC, id LIMIT 1`, [c.dominio]);
    if (r) { org = r.id; come = 'dominio'; }
  }
  if (!org && c.nome) { const d = await cercaDoppione({ name: c.nome }); if (d) { org = d.id; come = 'nome'; } }
  if (!org) return { organization_id: null, account_id: null, come: null };
  const a = await one('SELECT id FROM accounts WHERE organization_id=$1 AND linea=$2 ORDER BY id LIMIT 1', [org, c.linea]);
  return { organization_id: org, account_id: a?.id || null, come };
}

// ---------------------------------------------------------------- scoperta
/** Le ricerche girano nella memoria del server: se il server riparte restano "in corso" per sempre. Dopo 4 minuti senza segni di vita si chiudono. */
export const chiudiInterrotte = () => q(`UPDATE scout_ricerche SET stato='ERRORE', errore='Ricerca interrotta (il server è ripartito o il servizio non ha più risposto): ripetila, anche una provincia alla volta', avanzamento=NULL, finita_at=now()
  WHERE stato='IN_CORSO' AND aggiornata_at < now() - interval '4 minutes'`);
export async function avviaRicerca({ linea, province, categorie, userId }, { scopri = scopriProvincia, pausaMs = process.env.NODE_ENV === 'test' ? 0 : 2000 } = {}) {
  const r = await one(`INSERT INTO scout_ricerche (linea, province, categorie, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [linea, province, categorie, userId || null]);
  const lavoro = (async () => {
    let trovati = 0; let nuovi = 0; let diFila = 0; const avvisi = [];
    const segna = (testo) => q('UPDATE scout_ricerche SET avanzamento=$2, trovati=$3, nuovi=$4, avvisi=$5, aggiornata_at=now() WHERE id=$1', [r.id, testo, trovati, nuovi, JSON.stringify(avvisi)]);
    try {
      for (let i = 0; i < province.length; i += 1) {
        const p = province[i]; const dove = `${PROVINCE[p] || p} (${i + 1} di ${province.length})`;
        if ((await one('SELECT stato FROM scout_ricerche WHERE id=$1', [r.id]))?.stato !== 'IN_CORSO') return;   // annullata
        await segna(`${dove}: interrogo OpenStreetMap`);
        let candidati; let falliti = [];
        // una provincia che non risponde non ferma le altre: resta negli avvisi e si può ripetere da sola. Due province di fila senza
        // risposta da nessun servizio = OpenStreetMap è giù: ci si ferma subito invece di provarle tutte a vuoto
        try { ({ candidati, falliti = [] } = await scopri(p, categorie)); diFila = 0; } catch (e) {
          avvisi.push(String(e.message).slice(0, 400)); diFila += 1; await segna(`${dove}: non riuscita`);
          if (diFila >= 2 && trovati === 0) throw new Error(`I servizi pubblici di OpenStreetMap in questo momento non rispondono (${String(e.message).slice(0, 300)}). Non dipende dalla Suite: riprova tra un'ora, meglio una provincia alla volta.`);
          continue;
        }
        if (falliti.length) avvisi.push(`${PROVINCE[p] || p}: non lette ${falliti.map((f) => CATEGORIE[f.categoria]?.etichetta || f.categoria).join(', ')} (${String(falliti[0].errore).slice(0, 160)})`);
        await segna(`${dove}: ${candidati.length} strutture, le registro`);
        for (let k = 0; k < candidati.length; k += 1) {
          const c = candidati[k];
          trovati += 1;
          const m = await abbina({ ...c, linea });
          const segnali = c.sito ? {} : { SENZA_SITO: { valore: true, evidenza: 'OpenStreetMap non riporta un sito per questa struttura', url: `https://www.openstreetmap.org/${c.fonte_ref}` } };
          const pt = punteggio({ ...c, segnali }, linea).punteggio;
          const ins = await one(`INSERT INTO scout_candidati (ricerca_id, linea, fonte, fonte_ref, nome, categoria, indirizzo, cap, comune, provincia, lat, lon, telefono, email, sito, dominio, piva, operatore, tags, segnali, punteggio, organization_id, account_id, abbinato_come)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            ON CONFLICT (linea, fonte, fonte_ref) DO UPDATE SET ricerca_id=EXCLUDED.ricerca_id, updated_at=now() RETURNING (xmax = 0) AS nuovo`,
          [r.id, linea, c.fonte, c.fonte_ref, c.nome, c.categoria, c.indirizzo, c.cap, c.comune, c.provincia, c.lat, c.lon, c.telefono, c.email, c.sito, c.dominio, c.piva, c.operatore, JSON.stringify(c.tags), JSON.stringify(segnali), pt, m.organization_id, m.account_id, m.come]);
          if (ins.nuovo) nuovi += 1;
          if (k % 25 === 24) await segna(`${dove}: registrate ${k + 1} di ${candidati.length}`);
        }
        await segna(`${dove}: fatta`);
        if (i < province.length - 1) await new Promise((ok) => setTimeout(ok, pausaMs));   // cortesia verso il servizio pubblico
      }
      const tutteFallite = avvisi.length === province.length;
      await q(`UPDATE scout_ricerche SET stato=$2, errore=$3, trovati=$4, nuovi=$5, avvisi=$6, avanzamento=NULL, finita_at=now(), aggiornata_at=now() WHERE id=$1 AND stato='IN_CORSO'`,
        [r.id, tutteFallite ? 'ERRORE' : 'FATTA', tutteFallite ? avvisi[0] : null, trovati, nuovi, JSON.stringify(avvisi)]);
    } catch (e) {
      await q(`UPDATE scout_ricerche SET stato='ERRORE', errore=$2, trovati=$3, nuovi=$4, avvisi=$5, avanzamento=NULL, finita_at=now(), aggiornata_at=now() WHERE id=$1`, [r.id, String(e.message).slice(0, 500), trovati, nuovi, JSON.stringify(avvisi)]);
    }
  })();
  return { ricerca: r, lavoro };
}

/**
 * Registra candidati arrivati da una fonte ufficiale o da un file: niente doppioni con ciò che c'è già (stessa fonte e riferimento, oppure
 * stesso nome e comune da un'altra fonte, che viene completato con i dati mancanti). Ritorna la riga della ricerca.
 */
export async function registraElenco({ linea, fonte, etichetta, candidati, userId }) {
  const r = await one(`INSERT INTO scout_ricerche (linea, province, categorie, created_by, fonte, avanzamento) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [linea, [...new Set(candidati.map((c) => c.provincia).filter(Boolean))], [...new Set(candidati.map((c) => c.categoria))], userId || null, fonte, `${etichetta}: registro ${candidati.length} strutture`]);
  let nuovi = 0; let completati = 0;
  for (let k = 0; k < candidati.length; k += 1) {
    const c = candidati[k];
    const gemello = await one(`SELECT id FROM scout_candidati WHERE linea=$1 AND NOT (fonte=$2 AND fonte_ref=$3) AND fonte <> 'ACCOUNT' AND lower(nome)=lower($4) AND lower(coalesce(comune,''))=lower(coalesce($5::text,'')) LIMIT 1`, [linea, c.fonte, c.fonte_ref, c.nome, c.comune]);
    if (gemello) {
      await q(`UPDATE scout_candidati SET piva=coalesce(piva,$2), indirizzo=coalesce(indirizzo,$3), cap=coalesce(cap,$4), telefono=coalesce(telefono,$5), email=coalesce(email,$6), sito=coalesce(sito,$7), dominio=coalesce(dominio,$8),
        segnali = CASE WHEN $7::text IS NOT NULL THEN (segnali - 'SENZA_SITO') ELSE segnali END || $9::jsonb, updated_at=now() WHERE id=$1`, [gemello.id, c.piva, c.indirizzo, c.cap, c.telefono, c.email, c.sito, c.dominio, JSON.stringify(c.segnali || {})]);
      completati += 1; continue;
    }
    const m = await abbina({ ...c, linea });
    const segnali = { ...(c.segnali || {}), ...(c.sito ? {} : { SENZA_SITO: { valore: true, evidenza: `${etichetta}: l'elenco non riporta il sito`, url: null } }) };
    const pt = punteggio({ ...c, segnali }, linea).punteggio;
    const ins = await one(`INSERT INTO scout_candidati (ricerca_id, linea, fonte, fonte_ref, nome, categoria, indirizzo, cap, comune, provincia, lat, lon, telefono, email, sito, dominio, piva, operatore, tags, segnali, punteggio, organization_id, account_id, abbinato_come)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      ON CONFLICT (linea, fonte, fonte_ref) DO UPDATE SET ricerca_id=EXCLUDED.ricerca_id, nome=EXCLUDED.nome, indirizzo=EXCLUDED.indirizzo, cap=EXCLUDED.cap, comune=EXCLUDED.comune, piva=coalesce(scout_candidati.piva, EXCLUDED.piva),
        tags=EXCLUDED.tags, updated_at=now() RETURNING (xmax = 0) AS nuovo`,
    [r.id, linea, c.fonte, c.fonte_ref, c.nome, c.categoria, c.indirizzo, c.cap, c.comune, c.provincia, c.lat, c.lon, c.telefono, c.email, c.sito, c.dominio, c.piva, c.operatore, JSON.stringify(c.tags || {}), JSON.stringify(segnali), pt, m.organization_id, m.account_id, m.come]);
    if (ins.nuovo) nuovi += 1;
    if (k % 100 === 99) await q('UPDATE scout_ricerche SET trovati=$2, nuovi=$3, avanzamento=$4, aggiornata_at=now() WHERE id=$1', [r.id, k + 1, nuovi, `${etichetta}: registrate ${k + 1} di ${candidati.length}`]);
  }
  return one(`UPDATE scout_ricerche SET stato='FATTA', trovati=$2, nuovi=$3, avanzamento=NULL, avvisi=$4, finita_at=now(), aggiornata_at=now() WHERE id=$1 RETURNING *`,
    [r.id, candidati.length, nuovi, JSON.stringify(completati ? [`${completati} strutture erano già in elenco da un'altra fonte: sono state completate, non duplicate`] : [])]);
}

// ---------------------------------------------------------------- profilo (uno alla volta, in coda)
export async function profilaCandidato(id, { profila = profilaSito } = {}) {
  const c = await one('SELECT * FROM scout_candidati WHERE id=$1', [id]);
  if (!c) return null;
  if (!c.sito) { await q(`UPDATE scout_candidati SET errore_profilo='Nessun sito indicato', updated_at=now() WHERE id=$1`, [id]); return { ok: false, errore: 'Nessun sito indicato' }; }
  const imp = await impostazioni();
  const p = await profila(c.sito, { linea: c.linea, fornitori: imp.fornitori, attivi: imp.attivi, maxPersone: imp.max_persone });
  if (!p.ok) { await q(`UPDATE scout_candidati SET errore_profilo=$2, profilato_at=now(), updated_at=now() WHERE id=$1`, [id, p.errore]); return p; }
  const an = Object.fromEntries(Object.entries(p.anagrafica).map(([k, v]) => [k, v.valore]));
  const nuovo = { ...c, piva: c.piva || an.piva || null, email: c.email || an.email || null, pec: an.pec || c.pec, telefono: c.telefono || an.telefono || null, indirizzo: c.indirizzo || an.indirizzo || null, cap: c.cap || an.cap || null,
    comune: c.comune || an.comune || null, dominio: p.dominio, segnali: p.segnali };
  const m = c.fonte === 'ACCOUNT' ? { organization_id: c.organization_id, account_id: c.account_id, come: c.abbinato_come } : await abbina(nuovo);
  const pt = punteggio(nuovo, c.linea).punteggio;
  await tx(async (cl) => {
    await cl.query(`UPDATE scout_candidati SET stato = CASE WHEN stato='NUOVO' THEN 'PROFILATO' ELSE stato END, profilo=$2, segnali=$3, punteggio=$4, piva=$5, email=$6, pec=$7, telefono=$8, indirizzo=$9, cap=$10, comune=$11, dominio=$12,
        organization_id=$13, account_id=$14, abbinato_come=$15, errore_profilo=NULL, profilato_at=now(), updated_at=now() WHERE id=$1`,
    [id, JSON.stringify({ home: p.home, pagine: p.pagine, anagrafica: p.anagrafica, email: p.email, modulo_contatti: p.modulo_contatti }), JSON.stringify(p.segnali), pt, nuovo.piva, nuovo.email, nuovo.pec, nuovo.telefono, nuovo.indirizzo, nuovo.cap, nuovo.comune, nuovo.dominio,
      m.organization_id, m.account_id, m.come]);
    // le persone si rileggono a ogni profilo: restano quelle già portate tra i referenti
    await cl.query('DELETE FROM scout_persone WHERE candidato_id=$1 AND contatto_id IS NULL', [id]);
    for (const x of p.persone) {
      await cl.query(`INSERT INTO scout_persone (candidato_id, nome, titolo, ruolo, rango, email, email_stato, evidenza, url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (candidato_id, nome) DO UPDATE SET titolo=EXCLUDED.titolo, ruolo=EXCLUDED.ruolo, rango=EXCLUDED.rango, email=EXCLUDED.email, email_stato=EXCLUDED.email_stato, evidenza=EXCLUDED.evidenza, url=EXCLUDED.url`,
      [id, x.nome, x.titolo || null, x.ruolo || null, x.rango ?? 50, x.email || null, x.email_stato || null, x.evidenza || null, x.url || null]);
    }
  });
  return p;
}
const coda = []; let inCorso = false; let fatti = 0; let totale = 0;
export const statoCoda = () => ({ in_corso: inCorso, in_attesa: coda.length, fatti, totale });
export function accoda(ids, opts) {
  for (const id of ids) if (!coda.includes(id)) { coda.push(id); totale += 1; }
  if (inCorso) return statoCoda();
  inCorso = true;
  (async () => {
    while (coda.length) { const id = coda.shift(); try { await profilaCandidato(id, opts); } catch (e) { await q(`UPDATE scout_candidati SET errore_profilo=$2, updated_at=now() WHERE id=$1`, [id, String(e.message).slice(0, 300)]).catch(() => {}); } fatti += 1; }
    inCorso = false; fatti = 0; totale = 0;
  })();
  return statoCoda();
}

// ---------------------------------------------------------------- promozione in pipeline
const etichettaRuolo = (r) => RUOLI.find((x) => x.ruolo === r)?.etichetta || null;
export async function portaReferenti(accountId, candidatoId, personeIds, cl) {
  const run = (sql, p) => (cl ? cl.query(sql, p).then((r) => r.rows) : many(sql, p));
  const ps = await run('SELECT * FROM scout_persone WHERE candidato_id=$1 AND id = ANY($2::int[]) AND contatto_id IS NULL ORDER BY rango, id', [candidatoId, personeIds]);
  const fatti = [];
  for (const p of ps) {
    const gia = (await run(`SELECT id FROM contatti WHERE account_id=$1 AND (lower(nome)=lower($2) OR ($3::text IS NOT NULL AND lower(email)=lower($3)))`, [accountId, p.nome, p.email_stato === 'PUBBLICATA' ? p.email : null]))[0];
    let cid = gia?.id;
    if (!cid) {
      const nota = [`Letto dal sito: ${p.url || ''}`.trim(), p.evidenza ? `"${p.evidenza}"` : null, p.email_stato === 'IPOTESI' ? `Indirizzo ipotizzato dallo schema del dominio, da verificare prima dell'uso: ${p.email}` : null].filter(Boolean).join('\n');
      const principale = !(await run('SELECT 1 FROM contatti WHERE account_id=$1 AND principale LIMIT 1', [accountId]))[0] && !fatti.length;
      cid = (await run(`INSERT INTO contatti (account_id, nome, ruolo, email, principale, note, fonte) VALUES ($1,$2,$3,$4,$5,$6,'SITO_WEB') RETURNING id`,
        [accountId, p.nome, p.titolo || etichettaRuolo(p.ruolo), p.email_stato === 'PUBBLICATA' ? p.email : null, principale, nota]))[0].id;
    }
    await run('UPDATE scout_persone SET contatto_id=$2 WHERE id=$1', [p.id, cid]);
    fatti.push({ persona: p.id, contatto: cid, nuovo: !gia });
  }
  return fatti;
}
/** Candidato → Legal entity (ritrovata o creata) + account della linea in fase 0 o 1 + referenti scelti + riga nel diario */
export async function promuovi(id, { fase = 1, owner_user_id = null, persone = [], userId, req = null }) {
  const c = await one('SELECT * FROM scout_candidati WHERE id=$1', [id]);
  if (!c) throw Object.assign(new Error('Candidato non trovato'), { status: 404 });
  if (c.fonte === 'ACCOUNT') throw Object.assign(new Error('È il profilo di un account esistente: usa "Completa dal sito" nella scheda'), { status: 400 });
  if (c.stato === 'PROMOSSO' && c.account_id) return { account_id: c.account_id, gia: true };
  const an = c.profilo?.anagrafica || {};
  const nome = an.ragione_sociale?.valore && an.ragione_sociale.valore.length >= 4 ? an.ragione_sociale.valore : c.nome;
  const out = await createOrganization({ kind: c.linea === 'PP' ? 'PARTNER' : 'CLIENTE', name: nome, vat_number: c.piva || undefined, email: c.email || undefined, pec: c.pec || undefined, phone: c.telefono || undefined,
    address: c.indirizzo || undefined, zip: c.cap || undefined, city: c.comune || undefined, province: c.provincia || undefined, website: c.sito || undefined,
    notes: `Creata dalla Ricerca prospect del Business Hub (${c.fonte === 'OSM' ? `OpenStreetMap ${c.fonte_ref}` : c.fonte === 'MINISTERO' ? `Ministero della Salute, ${c.tags?.elenco || 'open data'} ${c.fonte_ref}` : c.fonte === 'ELENCO' ? 'elenco caricato da file' : 'inserimento manuale'}${c.sito ? `, sito ${c.sito}` : ''})${nome !== c.nome ? `. Insegna: ${c.nome}` : ''}` },
  { origine: 'Business Hub, Ricerca prospect', req, schedaBusiness: false });
  const orgId = out.org.id;
  const s = c.segnali || {};
  let acc = await one('SELECT id, fase_corrente FROM accounts WHERE organization_id=$1 AND linea=$2 ORDER BY id LIMIT 1', [orgId, c.linea]);
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const pt = punteggio(c, c.linea);
  const riepilogo = [`Punteggio ${pt.punteggio}/100: ${pt.motivi.map((m) => `${m.perche} (${m.punti > 0 ? '+' : ''}${m.punti})`).join('; ')}`,
    ...Object.entries(s).filter(([k]) => CATALOGO.some((x) => x.key === k)).map(([k, v]) => `${CATALOGO.find((x) => x.key === k).etichetta}: ${v.valore === true ? 'sì' : v.valore}${v.url ? ` (${v.url})` : ''}`)].join('\n');
  let creato = false;
  if (!acc) {
    acc = await one(`INSERT INTO accounts (organization_id, linea, created_by, prospect, fase_corrente, phase_dates, owner_user_id, tipologia, gruppo, accreditata_ssr, fornitore_attuale, fonte_censimento, sito_web, note)
      VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,'Ricerca prospect',$11,$12) RETURNING id, fase_corrente`,
    [orgId, c.linea, userId || null, fase >= 1 ? 1 : 0, JSON.stringify(fase >= 1 ? { 1: oggi } : {}), owner_user_id, CATEGORIE[c.categoria]?.etichetta || null, String(s.GRUPPO?.valore || c.operatore || '').replace(/^gruppo\s+/i, '') || null, s.ACCREDITATO ? 'Sì' : null,
      s.FORNITORE_LAB?.valore || null, c.sito || null, null]);
    creato = true;
  } else if (c.sito) await q('UPDATE accounts SET sito_web = coalesce(sito_web, $2), updated_at=now() WHERE id=$1', [acc.id, c.sito]);
  await one(`INSERT INTO activities (account_id, tipo, user_id, oggetto, testo, fase_da, fase_a) VALUES ($1,'SISTEMA',$2,$3,$4,$5,$6) RETURNING id`,
    [acc.id, userId || null, creato ? 'Account creato dalla Ricerca prospect' : 'Profilo dalla Ricerca prospect aggiunto', riepilogo, creato && fase >= 1 ? 0 : null, creato && fase >= 1 ? 1 : null]);
  const ref = await portaReferenti(acc.id, c.id, persone);
  await q(`UPDATE scout_candidati SET stato='PROMOSSO', organization_id=$2, account_id=$3, abbinato_come=coalesce(abbinato_come, $4), updated_at=now() WHERE id=$1`, [c.id, orgId, acc.id, out.created ? 'creata' : out.come || 'anagrafica']);
  return { account_id: acc.id, organization_id: orgId, org_creata: out.created, account_creato: creato, referenti: ref.length, simili: out.simili || [] };
}

// ---------------------------------------------------------------- completa un account esistente dal suo sito
export async function candidatoDiAccount(a, sito) {
  const url = normUrl(sito);
  if (!url) throw Object.assign(new Error('Indica il sito della struttura'), { status: 400 });
  const row = await one(`INSERT INTO scout_candidati (linea, fonte, fonte_ref, nome, sito, dominio, organization_id, account_id, abbinato_come, stato)
    VALUES ($1,'ACCOUNT',$2,$3,$4,$5,$6,$7,'account','PROFILATO')
    ON CONFLICT (linea, fonte, fonte_ref) DO UPDATE SET sito=EXCLUDED.sito, dominio=EXCLUDED.dominio, nome=EXCLUDED.nome, updated_at=now() RETURNING id`,
  [a.linea, String(a.id), a.ragione_sociale || a.org_name || a.name || `Account ${a.id}`, url, dominioDi(url), a.organization_id, a.id]);
  await q('UPDATE accounts SET sito_web=$2 WHERE id=$1', [a.id, url]);
  return row.id;
}
// campi della Legal entity che il profilo può proporre: [campo del profilo, colonna, etichetta]
export const CAMPI_ORG = [['piva', 'vat_number', 'Partita IVA'], ['pec', 'pec', 'PEC'], ['email', 'email', 'Email'], ['telefono', 'phone', 'Telefono'], ['indirizzo', 'address', 'Indirizzo'], ['cap', 'zip', 'CAP'], ['comune', 'city', 'Comune'], ['provincia', 'province', 'Provincia']];
export async function proposteAccount(a) {
  const c = await one(`SELECT * FROM scout_candidati WHERE fonte='ACCOUNT' AND linea=$1 AND fonte_ref=$2`, [a.linea, String(a.id)]);
  if (!c) return { candidato: null, campi: [], persone: [], segnali: {} };
  const org = await one('SELECT * FROM public.organizations WHERE id=$1', [a.organization_id]);
  const an = c.profilo?.anagrafica || {};
  const campi = CAMPI_ORG.filter(([k]) => an[k]?.valore).map(([k, col, etichetta]) => ({ campo: k, etichetta, proposto: an[k].valore, url: an[k].url, attuale: org?.[col] || null,
    stato: !org?.[col] ? 'MANCANTE' : String(org[col]).replace(/\s+/g, '').toLowerCase() === String(an[k].valore).replace(/\s+/g, '').toLowerCase() ? 'UGUALE' : 'DIVERSO' }));
  if (c.sito) campi.push({ campo: 'sito', etichetta: 'Sito', proposto: c.sito, url: c.sito, attuale: org?.website || null, stato: !org?.website ? 'MANCANTE' : 'UGUALE' });
  const persone = await many(`SELECT p.*, (SELECT k.id FROM contatti k WHERE k.account_id=$2 AND (lower(k.nome)=lower(p.nome) OR (p.email IS NOT NULL AND lower(k.email)=lower(p.email))) LIMIT 1) AS gia_referente
    FROM scout_persone p WHERE p.candidato_id=$1 ORDER BY p.rango, p.id`, [c.id, a.id]);
  return { candidato: { id: c.id, sito: c.sito, profilato_at: c.profilato_at, errore_profilo: c.errore_profilo, pagine: c.profilo?.pagine || [], email: c.profilo?.email || null }, campi, persone, segnali: c.segnali || {} };
}
