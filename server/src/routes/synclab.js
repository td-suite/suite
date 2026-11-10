// Amministrazione > Connettori > StudioLAB > Dati Synclab (Data API v1): stato della sincronizzazione, impostazioni, avvio manuale,
// "Riprendi", completo forzato, storico dei cicli e abbinamento dei client Synclab alle Legal entity. Solo amministratori.
// Mai checkpoint, cursori, token o dati di pazienti nelle risposte: lo stato espone solo sì/no, date e conteggi.
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, audit, parse, notFound } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { one, many, q } from '../db.js';
import { DATASETS, eseguiCiclo, eseguiTutti, statoSincronizzazione, ultimiRun, salvaImpostazioni, impostazioni, inCorso } from '../lib/synclab/sync.js';
import { listinoCliente, LEGENDA_STATI, STATI_EROGATI_PREDEFINITI } from '../lib/synclab/letture.js';
import { allineaAbbinamenti, ultimoAllineamento, abbinaManuale } from '../lib/synclab/abbinamenti.js';

const r = Router();
r.use(requireAdmin);

r.get('/stato', ah(async (_req, res) => res.json({ ...(await statoSincronizzazione()), legenda_stati: LEGENDA_STATI, stati_erogati_predefiniti: STATI_EROGATI_PREDEFINITI })));
r.get('/run', ah(async (req, res) => res.json(await ultimiRun(Math.min(200, Math.max(1, Number(req.query.limit) || 20))))));

r.put('/impostazioni', ah(async (req, res) => {
  const b = parse(z.object({
    data_api_enabled: z.boolean().optional(),
    sync_ora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ora nel formato HH:MM').optional(),
    page_size: z.coerce.number().int().min(1).max(500).optional(),
    page_size_listini: z.coerce.number().int().min(1).max(500).optional(),
    include_patient: z.boolean().optional(),
    data_api_timeout_ms: z.coerce.number().int().min(5000).max(600000).optional(),
    operating_company: z.string().trim().max(40).optional(),
    datasets: z.array(z.enum(DATASETS)).optional(),
    // v0.68.5: stati dell'accettazione che valgono "produzione erogata" (codici interi) e delta di giorno ogni N minuti (0 = spento)
    stati_erogati: z.array(z.coerce.number().int().min(0).max(999)).min(1, 'Indica almeno uno stato erogato').max(30).optional(),
    sync_intraday_minuti: z.coerce.number().int().min(0).max(720).optional(),
  }), req.body);
  const out = await salvaImpostazioni(b, req.user.id);
  await audit(req, 'SYNCLAB_IMPOSTAZIONI', { entity: 'connector', entityId: 'STUDIOLAB', label: 'Dati Synclab (Data API): impostazioni', data: { campi: Object.keys(b), data_api_enabled: b.data_api_enabled, include_patient: b.include_patient, stati_erogati: b.stati_erogati, sync_intraday_minuti: b.sync_intraday_minuti, svuotati: out.svuotati } });
  if (b.stati_erogati) { const { svuotaCacheMonitor } = await import('../lib/cockpitMonitor.js'); svuotaCacheMonitor(); }
  res.json(out);
}));

// Avvio in sottofondo: la cattura può durare minuti (202 + polling). La pagina rilegge /stato.
r.post('/sincronizza', ah(async (req, res) => {
  const b = parse(z.object({ dataset: z.enum(DATASETS).nullable().optional(), modo: z.enum(['AUTO', 'COMPLETO']).default('AUTO') }), req.body || {});
  const imp = await impostazioni();
  if (imp.auth_kind !== 'CLIENT_JWT') throw bad('Il connettore StudioLAB deve usare il client registrato (CLIENT_JWT) con nome e password del client');
  const origine = b.modo === 'COMPLETO' ? 'MANUALE' : 'MANUALE';
  const lavoro = b.dataset ? eseguiCiclo(b.dataset, { modo: b.modo, origine }) : eseguiTutti({ modo: b.modo, origine });
  lavoro.catch((e) => console.warn(`[synclab] ${b.dataset || 'tutti'}: ${e.message}`));
  await audit(req, b.modo === 'COMPLETO' ? 'SYNCLAB_COMPLETO_FORZATO' : 'SYNCLAB_SINCRONIZZA', { entity: 'connector', entityId: 'STUDIOLAB', label: `Dati Synclab: ${b.dataset || 'tutti gli insiemi'} (${b.modo === 'COMPLETO' ? 'completo forzato' : 'sincronizza o riprendi'})` });
  res.status(202).json({ avviato: true, dataset: b.dataset || null, modo: b.modo, in_corso: inCorso() });
}));

// ---------------------------------------------------------------- client Synclab ↔ Legal entity
r.get('/clienti', ah(async (req, res) => {
  const t = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
  const filtro = String(req.query.filtro || '');
  const rows = await many(`SELECT v.client_id, v.client_code, v.legal_name, v.active, v.operating_company, v.disponibilita, v.stato_abbinamento, v.regola_proposta, v.fonte,
      v.organization_id, o.name AS organization_name, o.kind AS organization_kind, v.site_id, s.code AS site_code, s.name AS site_name, s.studiolab_code AS site_studiolab_code, v.price_list_id,
      v.org_proposta_id, op.name AS org_proposta_name, v.perimetro_calcolato, v.perimetro_forzato, v.perimetro_b2b, v.note
    FROM synclab.clients_td v LEFT JOIN public.organizations o ON o.id = v.organization_id LEFT JOIN public.sites s ON s.id = v.site_id
    LEFT JOIN public.organizations op ON op.id = v.org_auto_id
   WHERE ($1::text IS NULL OR v.client_code ILIKE $1 OR v.legal_name ILIKE $1 OR v.vat_number ILIKE $1 OR o.name ILIKE $1)
     AND ($2 = '' OR ($2 = 'DA_ABBINARE' AND v.stato_abbinamento IN ('DA_ABBINARE','PROPOSTO')) OR ($2 = 'B2B' AND v.perimetro_b2b) OR ($2 = 'NON_B2B' AND NOT coalesce(v.perimetro_b2b, FALSE)))
   ORDER BY (v.stato_abbinamento = 'DA_ABBINARE') DESC, (v.stato_abbinamento = 'PROPOSTO') DESC, lower(v.legal_name) NULLS LAST, v.client_code LIMIT 1000`, [t, filtro]);
  const conteggi = await one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE stato_abbinamento IN ('CONFERMATO','MANUALE'))::int AS confermati, count(*) FILTER (WHERE stato_abbinamento = 'PROPOSTO')::int AS proposti,
      count(*) FILTER (WHERE stato_abbinamento = 'DA_ABBINARE')::int AS da_abbinare, count(*) FILTER (WHERE perimetro_b2b)::int AS b2b FROM synclab.clients_td`);
  res.json({ clienti: rows, conteggi });
}));

// Abbina (conferma la proposta), Scegli (Legal entity a mano), Escludi/Includi (perimetro B2B forzato), Ripristina (torna al calcolo)
r.put('/clienti/:clientId', ah(async (req, res) => {
  const b = parse(z.object({
    azione: z.enum(['ABBINA', 'SCEGLI', 'ESCLUDI', 'INCLUDI', 'PERIMETRO_CALCOLATO', 'TOGLI_ABBINAMENTO']),
    organization_id: z.coerce.number().int().positive().nullable().optional(),
    site_id: z.coerce.number().int().positive().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  }), req.body);
  const c = await one('SELECT * FROM synclab.clients_td WHERE client_id=$1 ORDER BY instance_id LIMIT 1', [req.params.clientId]);
  if (!c) throw notFound('Client Synclab non trovato');
  const cur = await one('SELECT * FROM synclab.client_map WHERE instance_id=$1 AND client_id=$2', [c.instance_id, c.client_id]);
  let org = cur?.organization_id ?? null, site = cur?.site_id ?? null, fonte = cur?.fonte ?? null, per = cur?.perimetro_b2b ?? null;
  if (b.azione === 'ABBINA') { if (!c.org_auto_id) throw bad('Nessuna proposta automatica da confermare: scegli la Legal entity'); org = c.org_auto_id; site = c.site_proposta_id || null; fonte = 'AUTO'; }
  if (b.azione === 'SCEGLI') {
    if (!b.organization_id) throw bad('Indica la Legal entity');
    if (!(await one('SELECT 1 FROM public.organizations WHERE id=$1', [b.organization_id]))) throw bad('Legal entity inesistente');
    if (b.site_id && !(await one('SELECT 1 FROM public.sites WHERE id=$1 AND (organization_id=$2 OR host_organization_id=$2)', [b.site_id, b.organization_id]))) throw bad('La sede scelta non appartiene alla Legal entity');
    // v0.68.5: con la sede scelta il codice StudioLAB del client si scrive nella sede se manca (saveSite, audit "codice StudioLAB dal gestionale")
    const esito = await abbinaManuale({ clientId: c.client_id, organizationId: b.organization_id, siteId: b.site_id || null, userId: req.user.id, req, origine: 'Dati Synclab > Clienti Synclab' });
    await audit(req, 'SYNCLAB_CLIENTE', { entity: 'synclab_client', entityId: c.client_id, label: `Client Synclab ${c.client_code || c.client_id}: scegli`, data: { prima: cur ? { organization_id: cur.organization_id, site_id: cur.site_id, fonte: cur.fonte } : null, dopo: { organization_id: b.organization_id, site_id: b.site_id || null }, codice: esito.codice } });
    return res.json({ ...(await one('SELECT * FROM synclab.clients_td WHERE instance_id=$1 AND client_id=$2', [c.instance_id, c.client_id])), codice: esito.codice });
  }
  // abbinamento tolto a mano: fonte MANUALE senza Legal entity, così l'allineamento automatico non lo rifà
  if (b.azione === 'TOGLI_ABBINAMENTO') { org = null; site = null; fonte = 'MANUALE'; }
  if (b.azione === 'ESCLUDI') per = false;
  if (b.azione === 'INCLUDI') per = true;
  if (b.azione === 'PERIMETRO_CALCOLATO') per = null;
  await q(`INSERT INTO synclab.client_map (instance_id, client_id, organization_id, site_id, fonte, perimetro_b2b, note, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (instance_id, client_id) DO UPDATE SET organization_id=EXCLUDED.organization_id, site_id=EXCLUDED.site_id, fonte=EXCLUDED.fonte, perimetro_b2b=EXCLUDED.perimetro_b2b,
       note=coalesce(EXCLUDED.note, synclab.client_map.note), updated_by=EXCLUDED.updated_by, updated_at=now()`, [c.instance_id, c.client_id, org, site, fonte, per, b.note ?? null, req.user.id]);
  await audit(req, 'SYNCLAB_CLIENTE', { entity: 'synclab_client', entityId: c.client_id, label: `Client Synclab ${c.client_code || c.client_id}: ${b.azione.toLowerCase()}`, data: { prima: cur ? { organization_id: cur.organization_id, site_id: cur.site_id, fonte: cur.fonte, perimetro_b2b: cur.perimetro_b2b } : null, dopo: { organization_id: org, site_id: site, fonte, perimetro_b2b: per } } });
  res.json(await one('SELECT * FROM synclab.clients_td WHERE instance_id=$1 AND client_id=$2', [c.instance_id, c.client_id]));
}));

// v0.68.5: allineamento automatico degli abbinamenti (regole in lib/synclab/abbinamenti.js): ultimo esito, anteprima, "Riallinea abbinamenti"
r.get('/abbinamenti', ah(async (req, res) => {
  const ultimo = await ultimoAllineamento();
  const anteprima = req.query.anteprima === '1' ? await allineaAbbinamenti({ scrivi: false }) : null;
  res.json({ ultimo, anteprima });
}));
r.post('/abbinamenti/riallinea', ah(async (req, res) => {
  const out = await allineaAbbinamenti({ scrivi: true, userId: req.user.id, req, origine: 'Riallinea abbinamenti (Dati Synclab)' });
  await audit(req, 'SYNCLAB_ABBINAMENTI', { entity: 'connector', entityId: 'STUDIOLAB', label: `Riallinea abbinamenti: ${out.abbinati.length} abbinati, ${out.codici_scritti.length} codici StudioLAB scritti, ${out.ambigui.length} ambigui`,
    data: { abbinati: out.abbinati.length, sedi_completate: out.sedi_completate.length, codici_scritti: out.codici_scritti.length, ambigui: out.ambigui.length, sede_da_scegliere: out.sede_da_scegliere.length, conflitti: out.conflitti.length } });
  res.json(out);
}));

// Listino corrente di un client (dettaglio a richiesta)
r.get('/clienti/:clientId/listino', ah(async (req, res) => {
  const l = await listinoCliente(req.params.clientId);
  if (!l) throw notFound('Client Synclab non trovato');
  res.json(l);
}));

export default r;
