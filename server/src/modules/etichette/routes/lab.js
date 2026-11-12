// Lab Control (v0.71.0) · API del controllo del laboratorio sotto /api/etichette/lab (il resto di /api/etichette è la sezione Label).
// Tutti i profili (ADMIN, LABORATORIO, OPERATORE) nel proprio perimetro; Impostazioni solo ADMIN. Nessuna scrittura verso StudioLab: l'unica
// chiamata al gestionale è la lettura puntuale "Aggiorna dal gestionale" (una accettazione, al più una ogni 2 minuti).
import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, bad, forbidden, notFound, parse } from '../../../lib/util.js';
import { many } from '../db.js';
import { KEY, contesto, soloAdmin, settings, setSetting, dataApiAttiva, STATI_SOGLIA, COLONNE, oggiRoma } from '../lib/core.js';
import * as L from '../lib/lab.js';
import { scheda, aggiornaDalGestionale, documento } from '../lib/scheda.js';
import { collegamenti, linkPrincipali } from '../lib/collegamenti.js';
import { xlsxAccettazioni } from '../lib/export.js';
import { FASI, FASE_NC, STATO_LABEL } from '../lib/fasi.js';

const r = Router();
const chiaveOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200;
const conLink = async (req, righe) => {
  const m = await linkPrincipali(req.user, righe);
  return righe.map((x) => ({ ...x, link_cliente: m.get(`${x.instance_id}|${x.client_id}`) || null }));
};

// Stato del Lab Control per le pagine: copia, Data API, NC, soglie, sedi per il filtro, colonne predefinite, legenda delle fasi
r.get('/lab/stato', ah(async (req, res) => {
  const ctx = contesto(req);
  const imp = await settings();
  const sedi = await many(`SELECT DISTINCT s.id, s.code, s.name FROM synclab.clients_td ct JOIN public.sites s ON s.id = ct.site_id
      WHERE ${ctx.tutte ? 'TRUE' : 's.id = ANY($1::int[])'} ORDER BY s.code NULLS LAST, s.name`, ctx.tutte ? [] : [ctx.siteIds]).catch(() => []);
  res.json({
    profilo: ctx.role, tutte: ctx.tutte, copia: await L.copiaAccettazioni(), data_api: await dataApiAttiva(), nc_disponibile: await L.ncDisponibile(), oggi: oggiRoma(),
    soglia: { ore_ritardo: imp.ore_ritardo, ore_campioni: imp.ore_campioni, giorni_finestra: imp.giorni_finestra, soglie_fase: imp.soglie_fase },
    colonne: COLONNE, colonne_predefinite: imp.colonne_predefinite, sedi: sedi.map((s) => ({ id: s.id, nome: [s.code, s.name].filter(Boolean).join(' ') })),
    fasi: [...FASI.map((f, i) => ({ key: f.key, label: f.label, breve: f.breve, indice: i, stati: f.stati })), { key: FASE_NC.key, label: FASE_NC.label, breve: FASE_NC.breve, indice: null, stati: FASE_NC.stati }],
    stati: Object.entries(STATO_LABEL).map(([k, v]) => ({ stato: Number(k), label: v })),
  });
}));

r.get('/lab/cruscotto', ah(async (req, res) => res.json({ ...(await L.cruscotto(contesto(req))), copia: await L.copiaAccettazioni() })));

r.get('/lab/accettazioni', ah(async (req, res) => {
  const ctx = contesto(req);
  const out = await L.elencoAccettazioni(req.query, ctx);
  res.json({ ...out, righe: await conLink(req, out.righe), cliente_nome: out.filtri.cliente ? await L.nomeFiltroCliente(out.filtri.cliente) : null, copia: await L.copiaAccettazioni() });
}));

// Export Excel: senza nomi dei pazienti (età e sesso), al più 20.000 righe
r.get('/lab/accettazioni.xlsx', ah(async (req, res) => {
  const ctx = contesto(req);
  const { righe, troncato, max } = await L.tutteLeAccettazioni(req.query, ctx);
  const f = (await L.filtriElenco(req.query, ctx, await settings())).filtri;
  const cp = await L.copiaAccettazioni();
  const intest = `Lab Control · accettazioni ${f.da ? `dal ${f.da} al ${f.a}` : 'di tutto il periodo'}${f.cliente ? ` · cliente ${await L.nomeFiltroCliente(f.cliente) || f.cliente}` : ''}${f.fase ? ` · fase ${f.fase}` : ''}${f.ritardo ? ' · solo in ritardo' : ''} · copia Synclab ${cp.checkpoint_at ? `aggiornata al ${new Date(cp.checkpoint_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : 'senza checkpoint'} · senza nomi dei pazienti${troncato ? ` · prime ${max} righe` : ''}`;
  const buf = await xlsxAccettazioni(righe, { intestazione: intest });
  await audit(req, 'LABCONTROL_EXPORT', { module: KEY, entity: 'accettazioni', label: `Export Excel delle accettazioni (${righe.length} righe, senza nomi dei pazienti)`, data: { righe: righe.length, filtri: f } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="lab-control-accettazioni_${oggiRoma()}.xlsx"`);
  res.send(buf);
}));

// Accesso alla scheda con l'identità del paziente: audit (senza nome), al più uno ogni 10 minuti per utente e accettazione
const accessi = new Map();
r.get('/lab/accettazioni/:inst/:id', ah(async (req, res) => {
  const ctx = contesto(req);
  const { inst, id } = req.params;
  if (!chiaveOk(inst) || !chiaveOk(id)) throw bad('Accettazione non valida');
  const s = await scheda(inst, id, ctx);
  if (!s) throw notFound('Accettazione non trovata nella copia Synclab né tra le letture dal gestionale');
  if (s.fuori) throw forbidden('Accettazione fuori dal tuo perimetro di sedi');
  if (s.paziente) {
    const k = `${req.user.id}|${inst}|${id}`;
    if (!accessi.has(k) || Date.now() - accessi.get(k) > 10 * 60 * 1000) {
      accessi.set(k, Date.now());
      await audit(req, 'LABCONTROL_SCHEDA_PAZIENTE', { module: KEY, entity: 'accettazione', entityId: s.accettazione.numero, label: `Scheda dell'accettazione ${s.accettazione.numero} aperta con l'identità del paziente`, data: { site_id: s.accettazione.site_id } });
    }
  }
  const [cli, sede, acc] = [
    s.accettazione.client_id ? await collegamenti(req.user, { client: { instance_id: inst, client_id: s.accettazione.client_id } }) : null,
    s.accettazione.site_id ? await collegamenti(req.user, { site: s.accettazione.site_id }) : null,
    await collegamenti(req.user, { request: { instance_id: inst, id } }),
  ];
  res.json({ ...s, collegamenti: { cliente: cli, sede, accettazione: acc }, data_api: await dataApiAttiva(), copia: await L.copiaAccettazioni() });
}));

r.post('/lab/accettazioni/:inst/:id/aggiorna', ah(async (req, res) => {
  const ctx = contesto(req);
  const { inst, id } = req.params;
  if (!chiaveOk(inst) || !chiaveOk(id)) throw bad('Accettazione non valida');
  const prima = await scheda(inst, id, ctx);
  if (!prima) throw notFound('Accettazione non trovata');
  if (prima.fuori) throw forbidden('Accettazione fuori dal tuo perimetro di sedi');
  const out = await aggiornaDalGestionale(inst, id, { numero: prima.accettazione.numero });
  if (out.esito === 'LETTA') await audit(req, 'LABCONTROL_AGGIORNA', { module: KEY, entity: 'accettazione', entityId: prima.accettazione.numero, label: `Accettazione ${prima.accettazione.numero} riletta dal gestionale` });
  res.json(out);
}));

// Documento economico (copia Synclab): testata, righe, accettazioni collegate. Il PDF resta in StudioLab.
r.get('/lab/documenti/:inst/:id', ah(async (req, res) => {
  const { inst, id } = req.params;
  if (!chiaveOk(inst) || !chiaveOk(id)) throw bad('Documento non valido');
  const d = await documento(inst, id, contesto(req));
  if (!d) throw notFound('Documento economico non presente nella copia Synclab (può arrivare con il prossimo aggiornamento)');
  if (d.fuori) throw forbidden('Documento fuori dal tuo perimetro di sedi');
  res.json(d);
}));

r.get('/lab/campioni', ah(async (req, res) => {
  const out = await L.elencoCampioni(req.query, contesto(req));
  res.json({ ...out, righe: await conLink(req, out.righe), stati: Object.entries(L.STATI_CAMPIONE).map(([k, v]) => ({ key: k, label: v.label })), copia: await L.copiaAccettazioni() });
}));

r.get('/lab/ritardi', ah(async (req, res) => {
  const out = await L.ritardi(req.query, contesto(req));
  res.json({ ...out, righe: await conLink(req, out.righe), copia: await L.copiaAccettazioni() });
}));
r.get('/lab/ritardi.xlsx', ah(async (req, res) => {
  const out = await L.ritardi(req.query, contesto(req));
  const buf = await xlsxAccettazioni(out.righe, { foglio: 'In ritardo', bloccanti: true, intestazione: `Lab Control · accettazioni in ritardo (oltre ${out.soglia.ore_ritardo} ore dall'accettazione senza referto, ultimi ${out.soglia.giorni_finestra} giorni) · senza nomi dei pazienti` });
  await audit(req, 'LABCONTROL_EXPORT', { module: KEY, entity: 'ritardi', label: `Export Excel delle accettazioni in ritardo (${out.righe.length} righe, senza nomi dei pazienti)` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="lab-control-ritardi_${oggiRoma()}.xlsx"`);
  res.send(buf);
}));

r.get('/lab/tat', ah(async (req, res) => {
  const out = await L.tat(req.query, contesto(req));
  res.json({ ...out, clienti: await conLink(req, out.clienti), copia: await L.copiaAccettazioni() });
}));
r.get('/lab/non-eseguiti', ah(async (req, res) => {
  const out = await L.nonEseguiti(req.query, contesto(req));
  res.json({ ...out, per_cliente: await conLink(req, out.per_cliente), elenco: await conLink(req, out.elenco), copia: await L.copiaAccettazioni() });
}));
r.get('/lab/clienti', ah(async (req, res) => {
  const out = await L.clienti(req.query, contesto(req));
  res.json({ ...out, righe: await conLink(req, out.righe), copia: await L.copiaAccettazioni() });
}));
r.get('/lab/clienti/cerca', ah(async (req, res) => {
  const rows = await L.cercaClienti(req.query.q, contesto(req));
  res.json(rows.map((c) => ({ value: `c-${c.client_id}`, cliente: c.cliente, client_code: c.client_code, org_name: c.org_name, organization_id: c.organization_id, sede: c.site_id ? [c.sede_code, c.sede_name].filter(Boolean).join(' ') : null })));
}));

// API interna riusabile: collegamenti di un client, di una sede o di un'accettazione (link verificati lato server)
r.get('/lab/collegamenti', ah(async (req, res) => {
  const q = req.query;
  if (q.client_id) return res.json(await collegamenti(req.user, { client: { instance_id: String(q.instance_id || ''), client_id: String(q.client_id) } }));
  if (q.site) return res.json(await collegamenti(req.user, { site: Number(q.site) || 0 }));
  if (q.request_id) return res.json(await collegamenti(req.user, { request: { instance_id: String(q.instance_id || ''), id: String(q.request_id) } }));
  throw bad('Indicare client_id, site o request_id');
}));

// ---------------------------------------------------------------- impostazioni (ADMIN)
r.use('/lab/impostazioni', soloAdmin);
r.get('/lab/impostazioni', ah(async (_req, res) => { const s = await settings(); res.json({ ...s, stati_soglia: STATI_SOGLIA.map((k) => ({ stato: k, label: STATO_LABEL[k] })), colonne: COLONNE }); }));
r.put('/lab/impostazioni', ah(async (req, res) => {
  const b = parse(z.object({
    ore_ritardo: z.number().int().min(1).max(2000).optional(), ore_campioni: z.number().int().min(1).max(720).optional(), giorni_finestra: z.number().int().min(7).max(365).optional(),
    soglie_fase: z.record(z.string().regex(/^\d{2}$/), z.number().int().min(1).max(2000).nullable()).optional(),
    colonne_predefinite: z.array(z.enum(COLONNE)).max(COLONNE.length).nullable().optional(),
  }), req.body);
  if (b.soglie_fase && Object.keys(b.soglie_fase).some((k) => !STATI_SOGLIA.includes(Number(k)))) throw bad(`Soglie di fase solo per gli stati ${STATI_SOGLIA.join(', ')}`);
  for (const k of ['ore_ritardo', 'ore_campioni', 'giorni_finestra', 'colonne_predefinite']) if (b[k] !== undefined) await setSetting(k, b[k]);
  if (b.soglie_fase) await setSetting('soglie_fase', Object.fromEntries(Object.entries(b.soglie_fase).filter(([, v]) => v != null)));
  await audit(req, 'LABCONTROL_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: `Impostazioni di Lab Control: ${Object.keys(b).join(', ')}`, data: b });
  res.json(await settings());
}));

export default r;
