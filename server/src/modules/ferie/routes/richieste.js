// Periodi e variazioni del piano ferie come elenco (storico) e dettaglio con la cronologia. Le scritture passano tutte dal piano annuale
// (routes/piani.js): periodi, invio, approvazione, definitivo, variazioni. Visibilità: il dipendente i propri periodi; il responsabile
// quelli dei dipendenti della propria area; ADMIN e VIEWER tutti.
import { Router } from 'express';
import { one, many } from '../db.js';
import { ah, notFound, forbidden } from '../../../lib/util.js';
import { STATO_LABEL, userContext, saldoPersona, calendarioPersona, loadRichiesta, oggi, R_COLS, R_FROM } from '../lib/core.js';
import { contaGiorni } from '../lib/calendario.js';
import { coperturaRichiesta } from '../lib/piano.js';
import { nomeGruppo } from '../lib/perimetro.js';
import { STATO_PIANO_LABEL } from '../lib/pianoAnnuale.js';

const r = Router();
const annoQ = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : Number(oggi().slice(0, 4)); };

// ---------------------------------------------------------------- elenco
// viste: mie (i miei periodi), da_approvare (variazioni in attesa delle persone che gestisco; ADMIN tutte), tutte (storico)
r.get('/richieste', ah(async (req, res) => {
  const ctx = await userContext(req);
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  const vista = String(req.query.vista || 'mie');
  if (vista === 'mie') where.push(`r.person_id = ${p(ctx.personId || 0)}`);
  else if (vista === 'da_approvare') {
    where.push(`(r.stato = 'RICHIESTA' OR (r.variazione_proposta IS NOT NULL AND r.stato IN ('PIANIFICATA','APPROVATA')))`);
    if (!ctx.isAdmin) where.push(`r.person_id = ANY(${p([...ctx.approva])}::int[])`);
  } else if (!ctx.tutto) {
    if (!ctx.isApprovatore) throw forbidden('Lo storico dei periodi lo vedono il responsabile dell\'area e l\'amministratore');
    where.push(`r.person_id = ANY(${p([...ctx.approva])}::int[])`);
  }
  if (req.query.anno) where.push(`r.anno = ${p(annoQ(req.query.anno))}`);
  if (req.query.stato && STATO_LABEL[req.query.stato]) where.push(`r.stato = ${p(req.query.stato)}`);
  if (req.query.tipo && ['FERIE', 'ROL'].includes(req.query.tipo)) where.push(`r.tipo = ${p(req.query.tipo)}`);
  if (req.query.gruppo) where.push(`r.gruppo = ${p(String(req.query.gruppo))}`);
  if (req.query.person_id) where.push(`r.person_id = ${p(Number(req.query.person_id) || 0)}`);
  if (req.query.sotto_copertura === '1') where.push('r.sotto_copertura');
  if (req.query.q) where.push(`(lower(p.last_name || ' ' || p.first_name) LIKE ${p(`%${String(req.query.q).toLowerCase()}%`)} OR lower(r.note) LIKE $${params.length})`);
  const sql = `FROM ${R_FROM} LEFT JOIN piani pi ON pi.id = r.piano_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(200, Math.max(5, Number(req.query.pageSize) || 50));
  const total = (await one(`SELECT count(*)::int AS n ${sql}`, params)).n;
  const rows = await many(`SELECT ${R_COLS}, pi.stato AS piano_stato ${sql} ORDER BY ${vista === 'da_approvare' ? 'r.data_inizio ASC' : 'r.data_inizio DESC'}, r.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  res.json({ rows: rows.map((x) => ({ ...x, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti), piano_stato_label: STATO_PIANO_LABEL[x.piano_stato] || null,
    puo_decidere: (x.stato === 'RICHIESTA' || Boolean(x.variazione_proposta)) && ctx.puoDecidere(x.person_id) })), total, page, pageSize });
}));

// ---------------------------------------------------------------- dettaglio
async function caricaVisibile(ctx, id) {
  const x = await loadRichiesta(Number(id));
  if (!x) throw notFound('Periodo non trovato');
  if (!(ctx.tutto || x.person_id === ctx.personId || ctx.approva.has(x.person_id))) throw forbidden('Periodo di un\'altra persona');
  return x;
}
r.get('/richieste/:id', ah(async (req, res) => {
  const ctx = await userContext(req);
  const x = await caricaVisibile(ctx, req.params.id);
  const eventi = await many(`SELECT e.*, u.full_name AS user_nome FROM eventi e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.richiesta_id=$1 ORDER BY e.created_at, e.id`, [x.id]);
  const p = ctx.perim.persone.get(x.person_id);
  const inAttesa = x.stato === 'RICHIESTA' || Boolean(x.variazione_proposta);
  const decide = inAttesa && ctx.puoDecidere(x.person_id);
  let copertura = x.copertura || [];
  // la copertura si ricalcola per chi decide: nel frattempo altri periodi possono essere cambiati
  if (decide && p && x.tipo === 'FERIE') {
    const v = x.variazione_proposta?.tipo === 'SPOSTAMENTO' ? { ...x, ...x.variazione_proposta } : x;
    const cal = await calendarioPersona(p, [x.anno], ctx.settings);
    const c = contaGiorni({ inizio: v.data_inizio, fine: v.data_fine, mezza_inizio: v.mezza_inizio, mezza_fine: v.mezza_fine }, cal);
    copertura = await coperturaRichiesta(ctx.perim, v, p, c.dettaglio, ctx.settings);
  }
  const piano = x.piano_id ? await one('SELECT id, anno, stato, versione FROM piani WHERE id=$1', [x.piano_id]) : null;
  const saldo = p && ctx.vedeSaldo(x.person_id) ? await saldoPersona(p, x.anno, ctx.settings) : null;
  const mia = x.person_id === ctx.personId;
  res.json({
    ...x, eventi, copertura, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti), saldo, mia,
    piano: piano ? { ...piano, stato_label: STATO_PIANO_LABEL[piano.stato] } : null,
    azioni: { approva: decide, rifiuta: decide, ritira: mia && inAttesa },
  });
}));

export default r;
export { annoQ };
