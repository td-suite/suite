// Rimborso Spese · elenchi: "Da approvare" (responsabili: le note dei diretti; P&C anche quelle del vertice; i livelli sotto in sola
// lettura), "Liquidazione" (P&C: approvate, in liquidazione, liquidate da archiviare), "Archivio" per anno e mese con ricerca (il proprio;
// il responsabile la sua catena; P&C e titolare tutti), export Excel per P&C.
import { Router } from 'express';
import { many } from '../db.js';
import { ah, forbidden, audit } from '../../../lib/util.js';
import { KEY, userContext, oggi } from '../lib/core.js';
import { STATO_LABEL, STATI, nomeMese } from '../lib/calcoli.js';
import { exportXlsx } from '../lib/export.js';

const r = Router();
const COLS = `n.id, n.person_id, n.anno, n.mese, n.stato, n.tot_spese, n.tot_km, n.tot_km_importo, n.tot_pedaggi, n.tot_parcheggi, n.tot_carta, n.tot_escluso, n.tot_rimborsabile,
  n.anticipi, n.saldo, n.inviata_at, n.in_ritardo, n.approvata_at, n.liquidata_at, n.liquidazione_data, n.liquidazione_importo, n.liquidazione_rif, n.archiviata_at, n.al_pc, n.responsabile_person_id,
  p.last_name || ' ' || p.first_name AS persona, s.name AS sede, r.last_name || ' ' || r.first_name AS responsabile_nome,
  (SELECT count(*)::int FROM spese x WHERE x.nota_id = n.id) AS n_spese, (SELECT count(*)::int FROM viaggi x WHERE x.nota_id = n.id) AS n_viaggi,
  (SELECT count(*)::int FROM allegati x WHERE x.nota_id = n.id AND x.riga_tipo <> 'NOTA') AS n_allegati,
  floor(extract(epoch FROM now() - n.inviata_at) / 86400)::int AS giorni_attesa`;
const FROM = `note n JOIN public.people p ON p.id = n.person_id LEFT JOIN public.sites s ON s.id = p.site_id LEFT JOIN public.people r ON r.id = n.responsabile_person_id`;
const vista = (x) => ({ ...x, stato_label: STATO_LABEL[x.stato], titolo: nomeMese(x.anno, x.mese) });

r.get('/da-approvare', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.isResponsabile && !ctx.isPC && !ctx.isTitolare) throw forbidden('Non hai note da approvare: questa pagina è dei responsabili');
  const da = await many(`SELECT ${COLS} FROM ${FROM} WHERE n.stato = 'INVIATA' AND n.person_id <> $1 AND (n.responsabile_person_id = $1 OR ($2 AND n.al_pc)) ORDER BY n.inviata_at`, [ctx.personId, ctx.isPC]);
  const catena = [...ctx.catena].filter((id) => !ctx.diretti.has(id));
  const sotto = catena.length ? await many(`SELECT ${COLS} FROM ${FROM} WHERE n.stato = 'INVIATA' AND n.person_id = ANY($1::int[]) AND coalesce(n.responsabile_person_id, 0) <> $2 ORDER BY n.inviata_at`, [catena, ctx.personId]) : [];
  const decise = await many(`SELECT * FROM (SELECT DISTINCT ON (n.id) ${COLS}, e.tipo AS decisione, e.at AS decisa_at FROM eventi e JOIN note n ON n.id = e.nota_id JOIN public.people p ON p.id = n.person_id LEFT JOIN public.sites s ON s.id = p.site_id LEFT JOIN public.people r ON r.id = n.responsabile_person_id
      WHERE e.person_id = $1 AND e.tipo IN ('APPROVATA','RESPINTA') AND e.at > now() - interval '60 days' ORDER BY n.id, e.at DESC) x ORDER BY decisa_at DESC LIMIT 20`, [ctx.personId]);
  res.json({ da_approvare: da.map(vista), catena: sotto.map(vista), decise: decise.map(vista), diretti: ctx.diretti.size, pc: ctx.isPC });
}));

r.get('/liquidazione', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.isPC) throw forbidden('Pagina riservata a P&C');
  const righe = await many(`SELECT ${COLS} FROM ${FROM} WHERE n.stato IN ('APPROVATA','IN_LIQUIDAZIONE','LIQUIDATA') ORDER BY CASE n.stato WHEN 'IN_LIQUIDAZIONE' THEN 0 WHEN 'APPROVATA' THEN 1 ELSE 2 END, n.approvata_at`);
  const attesa = await many(`SELECT ${COLS} FROM ${FROM} WHERE n.stato = 'INVIATA' ORDER BY n.inviata_at`);
  res.json({ righe: righe.map((x) => ({ ...vista(x), mia: x.person_id === ctx.personId })), in_attesa_responsabile: attesa.map(vista) });
}));

r.get('/archivio', ah(async (req, res) => {
  const ctx = await userContext(req);
  const par = [];
  const w = [];
  const add = (v) => { par.push(v); return `$${par.length}`; };
  // Due archivi distinti (decisione della Direzione, 13/11/2026): `personale` = solo le MIE note, chiunque io sia; `approvatore` = le
  // note degli ALTRI che vedo da responsabile (catena o responsabile registrato) o da P&C/titolare (tutte), mai le mie e mai le bozze
  // non ancora inviate. Senza parametro vale `personale`: l'archivio di una persona non mostra mai le note altrui per sbaglio.
  const ambito = String(req.query.ambito) === 'approvatore' ? 'approvatore' : 'personale';
  if (ambito === 'personale') w.push(`n.person_id = ${add(ctx.personId)}`);
  else {
    if (!ctx.isResponsabile && !ctx.tutto) throw forbidden('Archivio riservato a responsabili, P&C e titolare');
    w.push(`n.person_id <> ${add(ctx.personId)}`);
    w.push(`(n.stato <> 'BOZZA' OR n.inviata_at IS NOT NULL)`);
    if (!ctx.tutto) w.push(`(n.person_id = ANY(${add([...ctx.catena])}::int[]) OR n.responsabile_person_id = $1)`);
  }
  const anno = Number(req.query.anno) || null;
  if (anno) w.push(`n.anno = ${add(anno)}`);
  const mese = Number(req.query.mese) || null;
  if (mese) w.push(`n.mese = ${add(mese)}`);
  if (STATI.includes(String(req.query.stato))) w.push(`n.stato = ${add(String(req.query.stato))}`);
  const t = String(req.query.q || '').trim();
  if (t) w.push(`(p.last_name || ' ' || p.first_name ILIKE '%' || ${add(t)} || '%' OR n.motivazione ILIKE '%' || $${par.length} || '%' OR EXISTS (SELECT 1 FROM spese x WHERE x.nota_id = n.id AND x.descrizione ILIKE '%' || $${par.length} || '%'))`);
  const righe = await many(`SELECT ${COLS} FROM ${FROM} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY n.anno DESC, n.mese DESC, lower(p.last_name) LIMIT 500`, par);
  const anni = (await many(`SELECT DISTINCT anno FROM note ORDER BY anno DESC`)).map((x) => x.anno);
  const ris = { ambito };
  res.json({ righe: righe.map((x) => ({ ...vista(x), mia: x.person_id === ctx.personId })), anni: anni.length ? anni : [Number(oggi().slice(0, 4))], tutto: ctx.tutto, ...ris });
}));

r.get('/export.xlsx', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.isPC && !ctx.isTitolare) throw forbidden('Export riservato a P&C e al titolare');
  const anno = Number(req.query.anno) || Number(oggi().slice(0, 4));
  const mese = Number(req.query.mese) || null;
  const stati = String(req.query.stati || 'APPROVATA,IN_LIQUIDAZIONE,LIQUIDATA,ARCHIVIATA').split(',').filter((x) => STATI.includes(x));
  const { buffer, note } = await exportXlsx({ anno, mese, stati: stati.length ? stati : ['LIQUIDATA', 'ARCHIVIATA'] });
  await audit(req, 'RIMBORSI_EXPORT', { module: KEY, entity: 'export', label: `${anno}${mese ? `-${mese}` : ''}`, data: { note, stati } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Rimborsi_${anno}${mese ? `-${String(mese).padStart(2, '0')}` : ''}.xlsx"`);
  res.send(buffer);
}));

export default r;
