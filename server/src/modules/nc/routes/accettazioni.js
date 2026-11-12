import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { config } from '../config.js';
import { ah, bad, notFound, audit, parse, HttpError } from '../lib/util.js';
import { requireLab, isSede, canSeeSede } from '../lib/access.js';
import * as lis from '../lib/lis.js';
import { NC_COLS, NC_FROM, viewFor } from '../lib/nc.js';
import { loadSedeInviante } from '../lib/sedi.js';
import { recuperaPaziente, ncDellAccettazione } from '../lib/pazienteSynclab.js';
import { cercaAccettazioniSynclab, descriviCandidati, importaDaSynclab, aggiornamentoCopia } from '../lib/synclabDesk.js';

const r = Router();
const ACC_COLS = `a.*, s.nome AS sede_nome, s.codice AS sede_codice, s.tipo AS sede_tipo, s.origin AS sede_origin, s.email_effettiva AS sede_email, s.canale AS sede_canale, s.attiva AS sede_attiva,
  (SELECT count(*)::int FROM nc n WHERE n.accettazione_id=a.id AND n.stato <> 'ANNULLATA') AS n_nc`;

// Elenco accettazioni in cache (ultime ricevute) con filtri
r.get('/accettazioni', ah(async (req, res) => {
  const { sede, q: text, from, to, solo_nc, limit } = req.query;
  const w = [], p = [];
  if (isSede(req.user)) { p.push(req.user.sedi || []); w.push(`a.sede_id = ANY($${p.length}::int[])`); }
  if (sede) { p.push(Number(sede)); w.push(`a.sede_id = $${p.length}`); }
  if (text) { p.push(`%${String(text).trim()}%`); w.push(`(a.id ILIKE $${p.length} OR a.paziente_cognome ILIKE $${p.length} OR a.id_richiesta_cliente ILIKE $${p.length})`); }
  if (from) { p.push(from); w.push(`coalesce(a.data_accettazione, a.created_at) >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`coalesce(a.data_accettazione, a.created_at) < ($${p.length}::date + 1)`); }
  // accettazioni richiamate dalla copia Synclab senza NC: provvisorie, non restano in archivio (il job nc:pulizia-synclab le toglie)
  w.push(`NOT (a.origine = 'SYNCLAB' AND NOT EXISTS (SELECT 1 FROM nc n0 WHERE n0.accettazione_id = a.id))`);
  if (solo_nc === '1') w.push(`EXISTS (SELECT 1 FROM nc n WHERE n.accettazione_id=a.id AND n.stato <> 'ANNULLATA'${isSede(req.user) ? ' AND n.sent_at IS NOT NULL' : ''})`);
  p.push(Math.min(Number(limit) || 100, 500));
  const rows = await many(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi_v s ON s.id=a.sede_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY coalesce(a.data_accettazione, a.created_at) DESC LIMIT $${p.length}`, p);
  res.json(rows);
}));

// Richiamo per numero di accettazione: cache locale + aggiornamento dal LIS se configurato
r.get('/accettazioni/:id', ah(async (req, res) => {
  const id = String(req.params.id).trim();
  let acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi_v s ON s.id=a.sede_id WHERE a.id=$1`, [id]);
  let lisError = null;
  if (config.lis.enabled && (!acc || req.query.refresh === '1' || !acc.fetched_at || Date.now() - new Date(acc.fetched_at).getTime() > 10 * 60 * 1000)) {
    try {
      const row = await lis.refreshFromLis(id);
      if (row) acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi_v s ON s.id=a.sede_id WHERE a.id=$1`, [id]);
    } catch (e) { lisError = e.message; }
  }
  // Non in cache (né da ServiceNET): ricerca nella copia Synclab per numero o barcode (esatta, normalizzata, anno + numero);
  // una sola accettazione → importata nella cache con il merge di ServiceNET; più di una → elenco per scegliere (?synclab_id=…)
  let synclabImport = null;
  if ((!acc || req.query.synclab_id) && !isSede(req.user)) {
    let scelta = null;
    if (req.query.synclab_id) scelta = await one(`SELECT instance_id, id FROM synclab.requests WHERE id = $1 AND deleted_at IS NULL ORDER BY (disponibilita = 'ATTIVO') DESC LIMIT 1`, [String(req.query.synclab_id)]).catch(() => null);
    else {
      const t = await cercaAccettazioniSynclab(id);
      if (t.candidati.length > 1) {
        const e = new HttpError(409, `Più accettazioni nella copia Synclab corrispondono a "${id}": scegli quella giusta`);
        e.code = 'ACC_SYNCLAB_SCELTA'; e.details = { candidati: await descriviCandidati(t.candidati), passo: t.passo }; throw e;
      }
      if (t.candidati.length === 1) scelta = { ...t.candidati[0], passo: t.passo };
    }
    if (scelta) {
      const imp = await importaDaSynclab(scelta.instance_id, scelta.id);
      if (imp) {
        acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi_v s ON s.id=a.sede_id WHERE a.id=$1`, [imp.row.id]);
        synclabImport = { numero: imp.row.id, cercato: id, passo: scelta.passo || 'SCELTA', sede: imp.sede.come, sede_proposta: imp.sede.proposta || null };
        await audit(req, 'ACC_SYNCLAB_IMPORT', { entity: 'accettazione', entityId: imp.row.id, label: `${imp.row.id} · importata dalla copia Synclab${imp.row.id !== id ? ` (cercata come ${id})` : ''}` });
      }
    }
  }
  if (!acc) {
    const cp = await aggiornamentoCopia();
    const quando = cp.checkpoint_at ? new Date(cp.checkpoint_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : null;
    const synTxt = cp.accettazioni ? `non è nella copia Synclab (aggiornata al ${quando || 'data non nota'})` : 'la copia Synclab della Suite è vuota';
    const e = notFound(`${config.lis.enabled ? `Accettazione ${id} non trovata su StudioLAB né in archivio locale` : `Accettazione ${id} non presente in archivio`} e ${synTxt}: puoi registrarla manualmente`);
    e.code = 'ACC_NOT_FOUND'; e.details = { canCreateManual: true, lisError, synclab: cp }; throw e;
  }
  if (!canSeeSede(req.user, acc.sede_id)) throw notFound('Accettazione non trovata');
  // Paziente ancora mancante dopo ServiceNET (non collegato, non risponde, non trova l'accettazione o non restituisce il paziente):
  // recupero puntuale dal gestionale Synclab (una accettazione, al più una chiamata ogni 10 minuti; lib/pazienteSynclab.js). Mai bloccante.
  let pazienteSynclab = null;
  if (!acc.paziente_cognome) {
    const nc0 = await ncDellAccettazione(id);
    pazienteSynclab = await recuperaPaziente(acc, { req, audit, ncCodice: nc0?.codice, ncId: nc0?.id });
    if (pazienteSynclab.esito === 'RECUPERATO') acc = await one(`SELECT ${ACC_COLS} FROM accettazioni a LEFT JOIN sedi_v s ON s.id=a.sede_id WHERE a.id=$1`, [id]);
    delete pazienteSynclab.accettazione;
  }
  const ncs = await many(`SELECT ${NC_COLS} ${NC_FROM} WHERE n.accettazione_id=$1 ${isSede(req.user) ? "AND n.sent_at IS NOT NULL AND n.stato <> 'ANNULLATA'" : ''} ORDER BY n.opened_at DESC`, [id]);
  // v0.71.0: "Apri in Lab Control" (scheda dell'accettazione della copia Synclab), solo con Lab Control LIVE e il grant
  const labControl = await (await import('../../etichette/lib/collegamenti.js')).linkLabControl(req.suiteUser || req.user, { numero: acc.id }).catch(() => null);
  res.json({ ...acc, lisError, pazienteSynclab, synclabImport, campioniSynclab: acc.lis_json?.synclab?.campioni || null, lisStatoLabel: lis.STATO_LIS[acc.stato_lis] || acc.lis_json?.synclab?.stato_label || null, nc: ncs.map((n) => viewFor(n, req.user)), labControl });
}));

// Recupero a richiesta del paziente dal gestionale (pulsante nel Desk e nella NC): prima ServiceNET se collegato, poi la Data API
// Synclab con la stessa regola del richiamo. Consentito a chi vede l'accettazione (e quindi il paziente nella NC).
r.post('/accettazioni/:id/paziente', ah(async (req, res) => {
  const id = String(req.params.id).trim();
  let acc = await one('SELECT * FROM accettazioni WHERE id=$1', [id]);
  if (!acc || !canSeeSede(req.user, acc.sede_id)) throw notFound('Accettazione non trovata');
  if (acc.paziente_cognome) return res.json({ esito: 'PRESENTE', messaggio: 'Il paziente è già nella scheda dell\'accettazione' });
  let lisError = null;
  if (config.lis.enabled) {
    try { const row = await lis.refreshFromLis(id); if (row) acc = row; } catch (e) { lisError = e.message; }
    if (acc.paziente_cognome) return res.json({ esito: 'RECUPERATO', fonte: 'SERVICENET', messaggio: 'Paziente aggiornato da ServiceNET' });
  }
  const nc0 = req.body?.nc_id ? await one('SELECT id, codice FROM nc WHERE id=$1 AND accettazione_id=$2', [Number(req.body.nc_id), id]) : await ncDellAccettazione(id);
  const out = await recuperaPaziente(acc, { req, audit, ncCodice: nc0?.codice, ncId: nc0?.id });
  delete out.accettazione;
  res.json({ ...out, fonte: out.esito === 'RECUPERATO' ? 'SYNCLAB' : null, lisError });
}));

// Registrazione manuale (LIS non raggiungibile, accettazione non trasmessa, campione senza ordine informatico)
const manualSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[A-Za-z0-9/_.-]+$/, 'numero accettazione non valido'),
  sede_id: z.number().int(),
  data_accettazione: z.string().optional().nullable(),
  id_richiesta_cliente: z.string().max(80).optional().nullable(),
  paziente_cognome: z.string().max(120).optional().nullable(), paziente_nome: z.string().max(120).optional().nullable(),
  paziente_nascita: z.string().optional().nullable(), paziente_sesso: z.enum(['M', 'F', 'X']).optional().nullable(),
  esami: z.array(z.object({ cod: z.string().min(1).max(40), descrizione: z.string().max(200).optional().default('') })).optional().default([]),
});
r.post('/accettazioni', requireLab, ah(async (req, res) => {
  const b = parse(manualSchema, req.body);
  const sede = await loadSedeInviante(b.sede_id);
  if (!sede) throw bad('Sede inviante non valida');
  b.sede_id = sede.id;
  if (!sede.attiva) throw bad(`La sede "${sede.nome}" non è attiva per le non conformità`);
  const existing = await one('SELECT id FROM accettazioni WHERE id=$1', [b.id]);
  const row = await lis.upsertAccettazione({
    id: b.id, sede_id: b.sede_id, data_accettazione: b.data_accettazione || new Date().toISOString(), id_richiesta_cliente: b.id_richiesta_cliente || null,
    paziente_cognome: b.paziente_cognome || null, paziente_nome: b.paziente_nome || null, paziente_nascita: b.paziente_nascita || null, paziente_sesso: b.paziente_sesso || null,
    esami: b.esami.map((e) => ({ cod: e.cod.trim().toUpperCase(), descrizione: e.descrizione || '', stato: null, bloccato: false })),
  }, 'MANUALE');
  await audit(req, existing ? 'ACC_UPDATED' : 'ACC_CREATED', { entity: 'accettazione', entityId: b.id, label: `${b.id} · ${sede.nome} (manuale)` });
  res.status(existing ? 200 : 201).json(row);
}));

// Associa (o corregge) la sede inviante di un'accettazione già in cache
r.patch('/accettazioni/:id/sede', requireLab, ah(async (req, res) => {
  const { sede_id } = parse(z.object({ sede_id: z.number().int() }), req.body);
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [req.params.id]);
  if (!acc) throw notFound();
  const sede = await loadSedeInviante(sede_id);
  if (!sede) throw bad('Sede non valida');
  if (!sede.attiva) throw bad(`La sede "${sede.nome}" non è attiva per le non conformità`);
  await one('UPDATE accettazioni SET sede_id=$2, updated_at=now() WHERE id=$1 RETURNING *', [acc.id, sede.id]);
  await audit(req, 'ACC_UPDATED', { entity: 'accettazione', entityId: acc.id, label: `${acc.id} · sede corretta` });
  res.json({ ok: true });
}));

// Eliminazione: solo accettazioni registrate a mano, senza non conformità. Quelle arrivate dal LIS (API, HL7, push) non si eliminano:
// sono la copia di un dato che esiste in StudioLAB e verrebbero comunque ricreate alla prossima notifica.
r.delete('/accettazioni/:id', requireLab, ah(async (req, res) => {
  const acc = await one('SELECT * FROM accettazioni WHERE id=$1', [req.params.id]);
  if (!acc) throw notFound('Accettazione non trovata');
  if (acc.origine !== 'MANUALE') throw bad(`L'accettazione proviene da StudioLAB (${acc.origine}) e non si può eliminare`);
  const n = await one('SELECT count(*)::int AS n FROM nc WHERE accettazione_id=$1', [acc.id]);
  if (n.n > 0) throw bad(`L'accettazione ha ${n.n} non conformità collegate: annullale prima di eliminarla`);
  await one('DELETE FROM accettazioni WHERE id=$1 RETURNING id', [acc.id]);
  await audit(req, 'ACC_DELETED', { entity: 'accettazione', entityId: acc.id, label: `${acc.id} · registrata manualmente, eliminata` });
  res.json({ ok: true });
}));

export default r;
