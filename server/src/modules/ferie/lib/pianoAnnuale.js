// Piano ferie annuale per persona (funzionamento stabilito dal CEO, 08/11/2026): il dipendente compila il piano dell'anno, lo invia al
// responsabile dell'area, che lo può modificare, approvare e rendere definitivo. Il piano dell'area (i piani di tutti i suoi dipendenti)
// è trasparente a tutta l'area e solo all'area.
// Stati: BOZZA → PROPOSTO → IN_REVISIONE → APPROVATO → DEFINITIVO (riapertura: DEFINITIVO → APPROVATO, con motivo).
// I periodi del piano sono righe di ferie.richieste con piano_id: PIANIFICATA finché il piano non è approvato, APPROVATA dopo (GODUTA a
// data passata, job). Dopo l'approvazione il dipendente propone solo variazioni (aggiunta: riga RICHIESTA con variazione = true;
// spostamento o rimozione di un periodo: variazione_proposta sul periodo), che il responsabile approva o rifiuta una per una.
import { q, one, many } from '../db.js';
import { oggi, notifica, utentiDiPersone, utentiHr, itData, periodoTesto } from './core.js';
import { nomeGruppo } from './perimetro.js';

export const STATI_PIANO = ['BOZZA', 'PROPOSTO', 'IN_REVISIONE', 'APPROVATO', 'DEFINITIVO'];
export const STATO_PIANO_LABEL = { BOZZA: 'Bozza', PROPOSTO: 'Inviato al responsabile', IN_REVISIONE: 'In revisione dal responsabile', APPROVATO: 'Approvato', DEFINITIVO: 'Definitivo' };
export const APERTI = ['BOZZA', 'PROPOSTO', 'IN_REVISIONE'];        // periodi PIANIFICATA
export const CHIUSI = ['APPROVATO', 'DEFINITIVO'];                  // periodi APPROVATA; il dipendente propone solo variazioni

// ------------------------------------------------------------------ funzioni pure (test: server/test/ferie.test.mjs)
/**
 * Azioni consentite su un piano. proprio: il piano è dell'utente; gestisce: l'utente è ADMIN o responsabile della persona (mai sé
 * stesso, salvo ADMIN). Ritorna i flag per l'interfaccia e per i controlli del server.
 */
export function azioniPiano(stato, { proprio = false, gestisce = false } = {}) {
  return {
    // il dipendente compila e modifica finché è BOZZA o PROPOSTO non ancora preso in carico
    modifica: (proprio && ['BOZZA', 'PROPOSTO'].includes(stato)) || (gestisce && stato !== 'DEFINITIVO'),
    modifica_con_motivo: gestisce && stato === 'DEFINITIVO',
    invia: proprio && stato === 'BOZZA',
    prendi_in_carico: gestisce && stato === 'PROPOSTO',
    approva: gestisce && APERTI.includes(stato),
    definitivo: gestisce && stato === 'APPROVATO',
    riapri: gestisce && stato === 'DEFINITIVO',
    variazione: proprio && CHIUSI.includes(stato) && !gestisce,
  };
}

/** Stato di un periodo nuovo o approvato in un piano: PIANIFICATA nei piani aperti; APPROVATA (GODUTA se già passato) negli altri */
export function statoPeriodo(statoPiano, dataFine, giorno) {
  if (APERTI.includes(statoPiano)) return 'PIANIFICATA';
  return dataFine < giorno ? 'GODUTA' : 'APPROVATA';
}

/** Stato del piano dopo una modifica dei periodi: il responsabile che modifica un piano BOZZA o PROPOSTO lo prende in carico */
export function statoDopoModifica(statoPiano, { daResponsabile }) {
  if (daResponsabile && ['BOZZA', 'PROPOSTO'].includes(statoPiano)) return 'IN_REVISIONE';
  return statoPiano;
}

/**
 * Stato iniziale di un piano dalle sue richieste (regola della migrazione 002): APPROVATO se ha almeno un periodo FERIE attivo e sono
 * tutti approvati o goduti; altrimenti BOZZA.
 */
export function statoDaRichieste(richieste) {
  const attive = (richieste || []).filter((r) => (r.tipo || 'FERIE') === 'FERIE' && ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'GODUTA'].includes(r.stato));
  return attive.length && attive.every((r) => ['APPROVATA', 'GODUTA'].includes(r.stato)) ? 'APPROVATO' : 'BOZZA';
}

/** Conteggio dei piani per stato (cruscotto e intestazione del piano dell'area) */
export function contaPerStato(piani) {
  const out = Object.fromEntries(STATI_PIANO.map((s) => [s, 0]));
  for (const p of piani || []) if (p && out[p.stato] != null) out[p.stato]++;
  return out;
}

// ------------------------------------------------------------------ database
export const anniGestiti = () => { const a = Number(oggi().slice(0, 4)); return [a - 1, a, a + 1]; };

/** Crea (se mancano) i piani delle persone indicate per l'anno, solo per gli anni gestiti (precedente, corrente, prossimo) */
export async function assicuraPiani(personIds, anno, userId = null) {
  const ids = [...new Set((personIds || []).filter(Boolean))];
  if (!ids.length || !anniGestiti().includes(anno)) return 0;
  const nuovi = await many(`INSERT INTO piani (person_id, anno) SELECT x, $2 FROM unnest($1::int[]) AS x ON CONFLICT (person_id, anno) DO NOTHING RETURNING id`, [ids, anno]);
  for (const n of nuovi) await eventoPiano(n.id, 'CREATO', userId, {});
  return nuovi.length;
}

export async function pianiDi(personIds, anno) {
  const ids = [...new Set((personIds || []).filter(Boolean))];
  if (!ids.length) return [];
  return many(`SELECT pi.*, ua.full_name AS approvato_da_nome, ud.full_name AS definitivo_da_nome FROM piani pi
      LEFT JOIN public.users ua ON ua.id = pi.approvato_da LEFT JOIN public.users ud ON ud.id = pi.definitivo_da
     WHERE pi.person_id = ANY($1::int[]) AND pi.anno = $2`, [ids, anno]);
}
export async function loadPiano(id) {
  return one(`SELECT pi.*, ua.full_name AS approvato_da_nome, ud.full_name AS definitivo_da_nome FROM piani pi
      LEFT JOIN public.users ua ON ua.id = pi.approvato_da LEFT JOIN public.users ud ON ud.id = pi.definitivo_da WHERE pi.id = $1`, [id]);
}

/** Periodi di un piano (righe di ferie.richieste); con storico = anche rifiutati e tolti */
export async function periodiPiano(pianoId, { storico = false } = {}) {
  return many(`SELECT r.id, r.person_id, r.anno, r.tipo, r.data_inizio, r.data_fine, r.mezza_inizio, r.mezza_fine, r.giorni, r.ore, r.note, r.stato, r.variazione,
        r.variazione_proposta, r.chiusura_id, r.sotto_copertura, r.copertura, r.nota_decisione, r.deciso_at, r.created_at, r.modificata_at
      FROM richieste r WHERE r.piano_id = $1 ${storico ? '' : `AND r.stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA')`} ORDER BY r.data_inizio, r.id`, [pianoId]);
}

export async function eventoPiano(pianoId, tipo, userId, dati = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  await runner('INSERT INTO piano_eventi (piano_id, tipo, user_id, dati) VALUES ($1,$2,$3,$4)', [pianoId, tipo, userId || null, JSON.stringify(dati || {})]);
}
export async function eventiPiano(pianoId) {
  return many(`SELECT e.*, u.full_name AS user_nome FROM piano_eventi e LEFT JOIN public.users u ON u.id = e.user_id WHERE e.piano_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 200`, [pianoId]);
}

/** Collegamenti delle notifiche: il dipendente apre il proprio piano, il responsabile il piano dell'area */
export const linkMioPiano = (anno) => `/ferie?anno=${anno}`;
export const linkArea = (gruppo, anno) => `/ferie/area?gruppo=${encodeURIComponent(gruppo)}&anno=${anno}`;

/** Utenti da avvisare per il piano di una persona: il suo approvatore e i delegati attivi; senza nessuno, gli amministratori del modulo */
export async function destinatariResponsabile(persona) {
  const delegati = persona.approvatore_id ? (await many(`SELECT delegato_person_id AS id FROM deleghe WHERE delegante_person_id=$1 AND $2::date BETWEEN dal AND al`, [persona.approvatore_id, oggi()])).map((x) => x.id) : [];
  let dest = await utentiDiPersone([persona.approvatore_id, ...delegati]);
  if (!dest.length) dest = await utentiHr();
  return dest;
}

/** Notifica al responsabile (invio del piano, variazione proposta) */
export async function avvisaResponsabile(persona, piano, { evento, title, body, exclude = [] }, siti) {
  const dest = await destinatariResponsabile(persona);
  return notifica(dest, { id: `piano-${piano.id}` }, { evento, title, body, exclude, link: linkArea(persona.gruppo, piano.anno) });
}
/** Notifica al dipendente (modifica, approvazione, definitivo, riapertura, variazione decisa) */
export async function avvisaDipendente(persona, piano, { evento, title, body, exclude = [] }) {
  return notifica(await utentiDiPersone([persona.id]), { id: `piano-${piano.id}` }, { evento, title, body, exclude, link: linkMioPiano(piano.anno) });
}

export const descriviPeriodo = (r) => `${periodoTesto(r)} (${Number(r.giorni || 0).toLocaleString('it-IT')} ${Number(r.giorni) === 1 ? 'giorno' : 'giorni'})`;
export const nomeArea = (g, perim) => nomeGruppo(g, perim?.siti);
export { itData };
