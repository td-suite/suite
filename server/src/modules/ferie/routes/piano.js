// Piano ferie per area (Direzione, Laboratorio, ogni sede): vista a calendario annuale, "Oggi assenti", "Prossimi 14 giorni",
// esportazioni XLSX e PDF. Ogni dipendente vede il piano della propria area (nomi e periodi dei colleghi, mai i saldi); i responsabili
// quello delle aree che approvano; HR e consultazione tutto.
import { Router } from 'express';
import { many } from '../db.js';
import { ah, audit, forbidden, bad } from '../../../lib/util.js';
import { KEY, userContext, oggi, itData } from '../lib/core.js';
import { pianoGruppo } from '../lib/piano.js';
import { addDays } from '../lib/calendario.js';
import { nomeGruppo } from '../lib/perimetro.js';
import { pianoXlsx, pianoPdf } from '../lib/export.js';
import { annoQ } from './richieste.js';

const r = Router();
const iso = /^\d{4}-\d{2}-\d{2}$/;

// Aree visibili all'utente (colonne del piano), con il numero di persone
r.get('/gruppi', ah(async (req, res) => {
  const ctx = await userContext(req);
  const conta = new Map();
  for (const p of ctx.perim.persone.values()) conta.set(p.gruppo, (conta.get(p.gruppo) || 0) + 1);
  res.json({ gruppi: ctx.perim.gruppi.filter((g) => ctx.vedeGruppo(g.key)).map((g) => ({ ...g, persone: conta.get(g.key) || 0, mio: ctx.me?.gruppo === g.key })), contratti: ctx.perim.contratti });
}));

/** Toglie i dettagli altrui (note) a chi non è HR né approvatore della persona */
const pulisci = (ctx, piano) => ({
  ...piano,
  assenze: piano.assenze.map((a) => (ctx.tutto || a.person_id === ctx.personId || ctx.approva.has(a.person_id) ? a : { ...a, note: undefined, giorni: undefined, ore: undefined })),
});

r.get('/piano', ah(async (req, res) => {
  const ctx = await userContext(req);
  const gruppo = String(req.query.gruppo || ctx.me?.gruppo || ctx.gruppi[0] || '');
  if (!gruppo) return res.json({ gruppo: null, persone: [], assenze: [], chiusure: [], festivi: [], scoperture: [], regole: [] });
  if (!ctx.vedeGruppo(gruppo)) throw forbidden('Piano di un\'altra area');
  const anno = annoQ(req.query.anno);
  const da = iso.test(req.query.da || '') ? req.query.da : `${anno}-01-01`;
  const a = iso.test(req.query.a || '') ? req.query.a : `${anno}-12-31`;
  if (a < da) throw bad('Periodo non valido');
  const piano = await pianoGruppo(ctx.perim, gruppo, da, a, { s: ctx.settings });
  res.json({ ...pulisci(ctx, piano), da, a, anno });
}));

// Oggi assenti e prossimi N giorni (predefinito 14) nelle aree visibili
r.get('/assenze', ah(async (req, res) => {
  const ctx = await userContext(req);
  const giorni = Math.min(60, Math.max(1, Number(req.query.giorni) || 14));
  const da = oggi(), a = addDays(da, giorni);
  const gruppi = ctx.gruppi.filter((g) => !req.query.gruppo || g === req.query.gruppo);
  const persone = [...ctx.perim.persone.values()].filter((p) => gruppi.includes(p.gruppo));
  const ids = persone.map((p) => p.id);
  const rows = ids.length ? await many(`SELECT id, person_id, tipo, stato, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, ore FROM richieste
      WHERE person_id = ANY($1::int[]) AND stato IN ('RICHIESTA','APPROVATA','GODUTA') AND data_fine >= $2 AND data_inizio <= $3 ORDER BY data_inizio, id`, [ids, da, a]) : [];
  const byId = new Map(persone.map((p) => [p.id, p]));
  const vediAttesa = (pid) => ctx.tutto || ctx.approva.has(pid) || pid === ctx.personId;
  const out = rows.filter((x) => x.stato !== 'RICHIESTA' || vediAttesa(x.person_id)).map((x) => {
    const p = byId.get(x.person_id);
    return { ...x, persona: p.nome, ruolo: p.role_name, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti), giorni: vediAttesa(x.person_id) ? x.giorni : undefined, ore: vediAttesa(x.person_id) ? x.ore : undefined };
  });
  res.json({
    oggi: da, a, giorni,
    oggi_assenti: out.filter((x) => x.data_inizio <= da && x.data_fine >= da && x.stato !== 'RICHIESTA'),
    prossimi: out.filter((x) => x.data_fine >= da),
  });
}));

// ---------------------------------------------------------------- esportazioni (una o tutte le aree visibili)
async function pianiPerExport(ctx, req) {
  const anno = annoQ(req.query.anno);
  const sel = String(req.query.gruppo || '');
  let gruppi;
  if (!sel || sel === 'TUTTI') gruppi = ctx.perim.gruppi.filter((g) => ctx.vedeGruppo(g.key)).map((g) => g.key);
  else if (sel === 'SEDI') gruppi = ctx.perim.gruppi.filter((g) => g.key.startsWith('SEDE:') && ctx.vedeGruppo(g.key)).map((g) => g.key);
  else { if (!ctx.vedeGruppo(sel)) throw forbidden('Piano di un\'altra area'); gruppi = [sel]; }
  if (!gruppi.length) throw bad('Nessuna area da esportare');
  const piani = [];
  for (const g of gruppi) piani.push(pulisci(ctx, await pianoGruppo(ctx.perim, g, `${anno}-01-01`, `${anno}-12-31`, { s: ctx.settings })));
  return { anno, piani, etichetta: sel && !['TUTTI', 'SEDI'].includes(sel) ? nomeGruppo(sel, ctx.perim.siti) : sel === 'SEDI' ? 'Sedi' : 'Tutte le aree' };
}
r.get('/export/piano.xlsx', ah(async (req, res) => {
  const ctx = await userContext(req);
  const { anno, piani, etichetta } = await pianiPerExport(ctx, req);
  const buf = await pianoXlsx(piani, { anno, conDettagli: ctx.tutto });
  await audit(req, 'FERIE_EXPORT_XLSX', { module: KEY, entity: 'piano', label: `${etichetta} ${anno}` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Piano ferie ${etichetta.replace(/[^\w\s-]/g, '')} ${anno}.xlsx"`);
  res.end(Buffer.from(buf));
}));
r.get('/export/piano.pdf', ah(async (req, res) => {
  const ctx = await userContext(req);
  const { anno, piani, etichetta } = await pianiPerExport(ctx, req);
  const mesi = req.query.mese ? [Math.min(12, Math.max(1, Number(req.query.mese) || 1))] : null;
  const buf = await pianoPdf(piani, { anno, mesi, generato: itData(oggi()) });
  await audit(req, 'FERIE_EXPORT_PDF', { module: KEY, entity: 'piano', label: `${etichetta} ${anno}${mesi ? ` mese ${mesi[0]}` : ''}` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Piano ferie ${etichetta.replace(/[^\w\s-]/g, '')} ${anno}.pdf"`);
  res.end(buf);
}));

export default r;
