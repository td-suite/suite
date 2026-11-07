// Business Hub · processo Service (route montate sotto /api/business/hub): stato del processo nella scheda account, accesso alla Suite
// senza widget, collegamento alla form pubblica, kit di proposta (prepara, anteprima, invia), verifica degli allegati arrivati per
// email, contrattualizzazione manuale, differenze dell'anagrafica, elenco dei clienti della linea, richiamo dei prospect, modelli dei
// testi e allegati richiesti (Impostazioni). Lettura per tutti i profili del modulo; scrittura per chi gestisce la linea; modelli,
// allegati, richiamo manuale: Admin del modulo. Docs: docs/BUSINESS_HUB.md, "Processo Service".
// Linea Punti Prelievo (06/11/2026, "Processo Punti Prelievo"): anagrafica del punto, contratto al partner da network@ (stesso invio del
// kit), contratto firmato caricato a mano, avvio del flagship, passi dell'avvio con "Riprova", elenco dei punti prelievo.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse } from '../lib/util.js';
import { canEditKind, getSettings } from '../lib/rules.js';
import { requireAdmin } from '../lib/access.js';
import { LINEE, LINEE_KEYS } from '../lib/hub.js';
import {
  statoProcesso, creaAccesso, referentePrincipale, assicuraToken, preparaKit, inviaKit, verificaDocumento, applicaDifferenze, CHIAVE_ALLEGATI, CHIAVE_MODELLI,
} from '../lib/flusso.js';
import { contrattualizza, attivaAccessi } from '../lib/contrattualizza.js';
import { anteprimaRichiamo, eseguiRichiamo } from '../lib/richiamo.js';
import { modelliFlussoDa, MODELLI_DEFAULT, MODELLI_LABEL, SEGNAPOSTO_MODELLI, segnapostoDi, allegatiDa, volumiGiornalieri } from '../lib/processo.js';
import { modelliFlusso } from '../lib/pacchettoGenera.js';
import { salvaFile } from '../lib/flusso.js';
import {
  statoPuntoPrelievi, aggiornaPunto, preparaContrattoPartner, avviaFlagship, eseguiAvvio, elencoPuntiPrelievo, sedeDi,
} from '../lib/puntoPrelievi.js';
import { PASSI_AVVIO_PP, tipoPunto } from '../lib/processo.js';
import { config } from '../config.js';
import { loadAccount } from './hub.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida').nullable());
const optInt = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable());
function richiedi(req, a) { if (!canEditKind(req.user, a.linea)) throw forbidden(`Operazione riservata a chi gestisce la linea ${LINEE[a.linea].label}`); }
const chi = (req) => ({ userId: req.user.id, suiteUserId: req.suiteUser?.id || null });

r.get('/accounts/:id/processo', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  res.json({ ...(await statoProcesso(a)), puo_modificare: canEditKind(req.user, a.linea) });
}));

// Accesso alla Suite per il referente (nessun widget fino alla firma) con l'invito dalla casella della linea
r.post('/accounts/:id/accesso', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const d = parse(z.object({ contatto_id: optInt.optional() }), req.body || {});
  const c = await referentePrincipale(a.id, d.contatto_id || null);
  if (!c?.email) throw bad('Serve un referente con email (scheda Referenti)');
  const out = await creaAccesso(a, c, chi(req));
  await audit(req, 'HUB_ACCESSO_ESTERNO', 'account', a.id, { user_id: out.user_id, gia_presente: Boolean(out.gia_presente) });
  res.status(201).json(out);
}));

// Collegamento alla form pubblica: crea, rinnova (stesso link, nuova scadenza), rigenera (link nuovo)
r.post('/accounts/:id/b2b-link', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const d = parse(z.object({ azione: z.enum(['crea', 'rinnova', 'rigenera']).default('crea') }), req.body || {});
  const out = await assicuraToken(a, { azione: d.azione, userId: req.user.id });
  await audit(req, 'HUB_B2B_LINK', 'account', a.id, { azione: d.azione });
  res.json({ scade: out.scade, nuovo: out.nuovo });
}));

// Kit di proposta: preparazione (nessun invio) e invio con conferma
r.post('/accounts/:id/kit/prepara', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const d = parse(z.object({ contatto_id: optInt.optional(), includi_password: z.boolean().default(false), vademecum: z.boolean().default(true) }), req.body || {});
  const out = await preparaKit(a, { contattoId: d.contatto_id || null, includiPassword: d.includi_password, vademecum: d.vademecum }, chi(req));
  await audit(req, 'HUB_KIT_PREPARATO', 'account', a.id, { kit: out.id, allegati: out.allegati.length });
  res.status(201).json(out);
}));
r.post('/kit/:id/invia', ah(async (req, res) => {
  const k = await one('SELECT account_id FROM kit_proposta WHERE id=$1', [Number(req.params.id)]);
  if (!k) throw notFound('Kit non trovato');
  const a = await loadAccount(k.account_id);
  richiedi(req, a);
  const d = parse(z.object({ conferma: z.boolean().optional(), reinvia: z.boolean().optional(), oggetto: z.string().trim().min(3).max(300).optional(), testo: z.string().trim().min(10).max(20000).optional(), altri: z.array(z.string()).default([]) }), req.body || {});
  const out = await inviaKit(Number(req.params.id), d, chi(req));
  await audit(req, 'HUB_KIT_INVIATO', 'account', a.id, { kit: Number(req.params.id), stato: out.stato, destinatari: out.to.length });
  res.json(out);
}));
r.post('/kit/:id/annulla', ah(async (req, res) => {
  const k = await one('SELECT id, account_id, stato FROM kit_proposta WHERE id=$1', [Number(req.params.id)]);
  if (!k) throw notFound('Kit non trovato');
  richiedi(req, await loadAccount(k.account_id));
  if (k.stato !== 'PREPARATO') throw bad('Si annulla solo un kit preparato e non inviato');
  await q(`UPDATE kit_proposta SET stato='ANNULLATO' WHERE id=$1`, [k.id]);
  res.json({ ok: true });
}));
r.get('/kit/:id', ah(async (req, res) => {
  const k = await one('SELECT * FROM kit_proposta WHERE id=$1', [Number(req.params.id)]);
  if (!k) throw notFound('Kit non trovato');
  await loadAccount(k.account_id);
  res.json(k);
}));

// Allegati arrivati dal cliente: "È il contratto firmato" / "Allegato del contratto" / "Non pertinente"
r.post('/documenti/:id/verifica', ah(async (req, res) => {
  const d0 = await one('SELECT account_id FROM documenti WHERE id=$1', [Number(req.params.id)]);
  if (!d0?.account_id) throw notFound('Documento non trovato');
  const a = await loadAccount(d0.account_id);
  richiedi(req, a);
  const d = parse(z.object({ esito: z.enum(['CONTRATTO', 'ALLEGATO', 'NON_PERTINENTE', 'OFFERTA_FIRMATA']), etichetta: z.string().trim().max(160).optional() }), req.body || {});
  const out = await verificaDocumento(a, Number(req.params.id), d.esito, { userId: req.user.id, etichetta: d.etichetta || null });
  await audit(req, 'HUB_DOCUMENTO_VERIFICATO', 'account', a.id, { documento: Number(req.params.id), esito: d.esito });
  res.json(out);
}));
// Contratto firmato caricato a mano dall'operatore (Documenti dell'account): stessa contrattualizzazione
r.post('/accounts/:id/contrattualizza', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const d = parse(z.object({ documento_id: z.number().int().positive() }), req.body || {});
  const doc = await one('SELECT id, mime, filename FROM documenti WHERE id=$1 AND account_id=$2', [d.documento_id, a.id]);
  if (!doc) throw bad('Documento non di questo account');
  if (!(/pdf/i.test(doc.mime) || /\.pdf$/i.test(doc.filename))) throw bad('Il contratto firmato deve essere un PDF');
  await q(`UPDATE documenti SET categoria='CONTRATTO_FIRMATO', da_verificare=FALSE, verificato_at=now(), verificato_by=$2, etichetta='Contratto firmato' WHERE id=$1`, [doc.id, req.user.id]);
  const out = await contrattualizza(a.id, { documentoId: doc.id, fonte: 'caricamento', userId: req.user.id });
  await audit(req, 'HUB_CONTRATTUALIZZAZIONE', 'account', a.id, { documento: doc.id, gia: Boolean(out.gia) });
  res.json(out);
}));
// Riattiva i servizi (ad esempio dopo aver creato la sede SERVICE o un nuovo accesso): profilo Cliente service in merge
r.post('/accounts/:id/attiva-accessi', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  if (!a.contrattualizzato_at && !a.cliente_attivo) throw bad('I servizi si attivano con il contratto firmato');
  const out = await attivaAccessi(a, { userId: req.user.id });
  await audit(req, 'HUB_ATTIVAZIONE', 'account', a.id, { accessi: out.accessi });
  res.json(out);
}));
// Differenze dell'anagrafica ricevuta: applica i campi scelti alla Legal entity
r.post('/anagrafiche/:id/applica', ah(async (req, res) => {
  const x = await one('SELECT account_id FROM anagrafiche_b2b WHERE id=$1', [Number(req.params.id)]);
  if (!x) throw notFound('Anagrafica non trovata');
  const a = await loadAccount(x.account_id);
  richiedi(req, a);
  const d = parse(z.object({ campi: z.array(z.string().max(40)).min(1) }), req.body || {});
  const out = await applicaDifferenze(a, Number(req.params.id), d.campi, req.user.id);
  await audit(req, 'HUB_ANAGRAFICA_APPLICATA', 'account', a.id, { campi: d.campi.length });
  res.json(out);
}));

// Contratto firmato ricevuto per altri canali (PEC, consegna a mano): caricamento del PDF e contrattualizzazione (o avvio del punto prelievi)
r.post('/accounts/:id/contratto-firmato', upload.single('file'), ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const f = req.file;
  if (!f) throw bad('Carica il PDF del contratto firmato');
  if (!(/pdf/i.test(f.mimetype || '') || /\.pdf$/i.test(f.originalname || '')) || f.buffer.subarray(0, 5).toString() !== '%PDF-') throw bad('Il contratto firmato deve essere un PDF');
  const doc = await salvaFile(a, f, 'CONTRATTO_FIRMATO', 'Contratto firmato', { userId: req.user.id });
  await q('UPDATE documenti SET verificato_at=now(), verificato_by=$2 WHERE id=$1', [doc.id, req.user.id]);
  const out = await contrattualizza(a.id, { documentoId: doc.id, fonte: 'caricamento (ricevuto per altri canali)', userId: req.user.id });
  await audit(req, 'HUB_CONTRATTO_CARICATO', 'account', a.id, { documento: doc.id, gia: Boolean(out.gia) });
  res.status(201).json(out);
}));

// ---------------- Punti Prelievo
// Scheda "Punto prelievi" dell'account: anagrafica, contratto al partner, contratto firmato, avvio con i passi
r.get('/accounts/:id/punto', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (a.linea !== 'PP') throw bad('Il punto prelievi è degli account della linea Punti Prelievo');
  res.json({ ...(await statoPuntoPrelievi(a)), puo_modificare: canEditKind(req.user, a.linea) });
}));
r.put('/accounts/:id/punto', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (a.linea !== 'PP') throw bad('Il punto prelievi è degli account della linea Punti Prelievo');
  richiedi(req, a);
  const d = parse(z.object({
    pp_site_id: optInt.optional(), pp_nome: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).nullable()).optional(),
    pp_tipo_previsto: z.preprocess((v) => (v === '' ? null : v), z.enum(['FLAGSHIP', 'CORNER']).nullable()).optional(), data_avvio_prevista: optDate.optional(), data_avvio_effettiva: optDate.optional(),
  }), req.body || {});
  const out = await aggiornaPunto(a, d, { userId: req.user.id });
  await audit(req, 'HUB_PUNTO_PRELIEVI', 'account', a.id, { campi: Object.keys(d) });
  res.json(out);
}));
// Contratto al partner (solo corner): preparazione con l'anteprima; l'invio è POST /kit/:id/invia (stessa conferma e idempotenza del kit)
r.post('/accounts/:id/contratto-partner/prepara', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (a.linea !== 'PP') throw bad('Il contratto al partner è della linea Punti Prelievo');
  richiedi(req, a);
  const d = parse(z.object({ contatto_id: optInt.optional() }), req.body || {});
  const out = await preparaContrattoPartner(a, { contattoId: d.contatto_id || null }, chi(req));
  await audit(req, 'HUB_CONTRATTO_PARTNER_PREPARATO', 'account', a.id, { kit: out.id });
  res.status(201).json(out);
}));
// "Avvia il punto prelievi" del flagship (data di avvio effettiva obbligatoria)
r.post('/accounts/:id/avvio', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (a.linea !== 'PP') throw bad('L\'avvio è dei punti prelievo');
  richiedi(req, a);
  const d = parse(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Indica la data di avvio effettiva') }), req.body || {});
  const out = await avviaFlagship(a, { data: d.data, userId: req.user.id });
  await audit(req, 'HUB_AVVIO_PP', 'account', a.id, { fatti: out.riepilogo.fatti, previsti: out.riepilogo.previsti });
  res.json(out);
}));
// Riprova dei passi non riusciti o rimasti da fare (mai quelli già riusciti)
r.post('/accounts/:id/avvio/riprova', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (a.linea !== 'PP') throw bad('L\'avvio è dei punti prelievo');
  richiedi(req, a);
  if (!a.pp_avvio_at) throw bad('Il punto prelievi non è ancora stato avviato');
  const d = parse(z.object({ passi: z.array(z.enum(PASSI_AVVIO_PP.map((p) => p.key))).min(1).optional() }), req.body || {});
  const passi = a.pp_avvio?.passi || {};
  const solo = (d.passi || PASSI_AVVIO_PP.map((p) => p.key)).filter((k) => passi[k]?.stato !== 'OK');
  if (!solo.length) throw bad('Nessun passo da riprovare: sono tutti riusciti');
  const out = await eseguiAvvio(a.id, { solo, userId: req.user.id, fonte: a.pp_avvio?.fonte || null });
  await audit(req, 'HUB_AVVIO_PP_RIPROVA', 'account', a.id, { passi: solo, esiti: out.eseguiti.map((x) => `${x.key}:${x.stato}`) });
  res.json(out);
}));
// Pagina "Punti Prelievo": elenco dei punti (account PP) e sedi Punto prelievi senza account
r.get('/punti-prelievo', ah(async (_req, res) => res.json(await elencoPuntiPrelievo())));
// Account PP dalla sede: Legal entity = ospitante (corner) o Legal entity della sede (flagship), sede collegata
r.post('/punti-prelievo/da-sede', ah(async (req, res) => {
  if (!canEditKind(req.user, 'PP')) throw forbidden('Operazione riservata a chi gestisce la linea Punti Prelievo');
  const d = parse(z.object({ site_id: z.number().int().positive() }), req.body || {});
  const sede = await sedeDi(d.site_id);
  if (!sede || sede.kind !== 'PUNTO_PRELIEVI') throw bad('Sede Punto prelievi non trovata');
  if (await one('SELECT 1 FROM accounts WHERE pp_site_id=$1', [sede.id])) throw bad('Questa sede ha già il suo punto prelievi nel Business Hub');
  const tp = tipoPunto({ sede });
  const orgId = tp.tipo === 'CORNER' ? sede.host_organization_id : sede.organization_id;
  if (!orgId) throw bad(tp.tipo === 'CORNER' ? 'Indica la Legal entity ospitante della sede (Amministrazione > Sedi)' : 'La sede non ha una Legal entity (Amministrazione > Sedi)');
  const row = await one(`INSERT INTO accounts (organization_id, linea, pp_site_id, prospect, created_by) VALUES ($1,'PP',$2,TRUE,$3) RETURNING id`, [orgId, sede.id, req.user.id]);
  await q(`INSERT INTO activities (account_id, tipo, user_id, oggetto, testo) VALUES ($1,'SISTEMA',$2,'Account creato dalla sede',$3)`, [row.id, req.user.id, `Punto prelievi ${sede.name} (${sede.code}), ${tp.tipo === 'CORNER' ? 'corner' : 'flagship'} dalla sede.`]);
  await audit(req, 'HUB_ACCOUNT_CREATE', 'account', row.id, { linea: 'PP', site_id: sede.id });
  res.status(201).json({ id: row.id });
}));

// Clienti della linea (menu "Clienti"): clienti attivi e contrattualizzati in avvio, con contratto, avvio, volumi, ultimo contatto
r.get('/clienti-attivi', ah(async (req, res) => {
  const linea = LINEE_KEYS.includes(req.query.linea) ? req.query.linea : 'SRV';
  const s = await getSettings();
  const rows = await many(`SELECT a.id, a.organization_id, o.name AS org_name, o.city AS citta, o.province AS prov, a.linea, a.fase_corrente, a.phase_dates, a.cliente_attivo, a.attivo_dal, a.contrattualizzato_at,
      a.data_avvio_prevista, a.volumi_giornalieri_attesi, a.volume_fy_atteso, a.fatturato_fy_atteso, uo.full_name AS owner_name,
      (SELECT json_build_object('id', c.id, 'protocol', c.protocol, 'status', c.status, 'signed_at', c.signed_at, 'start_date', c.start_date) FROM contracts c
        WHERE c.org_id=a.organization_id AND c.kind=a.linea AND c.status NOT IN ('ANNULLATO') ORDER BY c.updated_at DESC NULLS LAST LIMIT 1) AS contratto,
      (SELECT max(x.at) FROM activities x WHERE x.account_id=a.id AND x.tipo NOT IN ('SISTEMA')) AS ultimo_contatto,
      (SELECT l.versione FROM listini l WHERE l.account_id=a.id ORDER BY l.versione DESC LIMIT 1) AS listino_versione,
      (SELECT count(*)::int FROM documenti d WHERE d.account_id=a.id AND d.da_verificare) AS da_verificare,
      (SELECT count(*)::int FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.is_external AND u.status='ACTIVE' AND coalesce(p.organization_id, u.organization_id)=a.organization_id) AS accessi
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN public.users uo ON uo.id=a.owner_user_id
    WHERE a.linea=$1 AND (a.cliente_attivo OR a.contrattualizzato_at IS NOT NULL OR a.fase_corrente >= 6) ORDER BY a.cliente_attivo DESC, coalesce(a.attivo_dal, a.data_avvio_prevista) DESC NULLS LAST, o.name`, [linea]);
  res.json({ linea, righe: rows.map((x) => ({ ...x, volumi: volumiGiornalieri(x, s.hub_giorni_lavorativi) })) });
}));

// Richiamo dei prospect: anteprima (cruscotto) ed esecuzione manuale (Admin, con l'interruttore acceso)
r.get('/richiamo/anteprima', ah(async (_req, res) => res.json(await anteprimaRichiamo())));
r.post('/richiamo/esegui', requireAdmin, ah(async (req, res) => {
  const out = await eseguiRichiamo({ manuale: true, userId: req.user.id });
  if (out.skipped) throw bad(`Richiamo non eseguito: ${out.skipped}. Accendi l'interruttore in Impostazioni`);
  await audit(req, 'HUB_RICHIAMO', 'richiamo', null, { inviati: out.inviati, falliti: out.falliti });
  res.json(out);
}));

// Modelli dei testi del processo (Impostazioni)
r.get('/flusso/modelli', ah(async (_req, res) => {
  const x = await one('SELECT value FROM app_settings WHERE key=$1', [CHIAVE_MODELLI]);
  res.json({ modelli: await modelliFlusso(), predefiniti: MODELLI_DEFAULT, etichette: MODELLI_LABEL, segnaposto: SEGNAPOSTO_MODELLI, personalizzati: Object.keys(x ? JSON.parse(x.value || '{}') : {}) });
}));
r.put('/flusso/modelli', requireAdmin, ah(async (req, res) => {
  const d = parse(z.object({ modelli: z.record(z.string().max(20000)).optional(), ripristina: z.boolean().optional() }), req.body || {});
  if (d.ripristina) { await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_MODELLI]); await audit(req, 'HUB_FLUSSO_MODELLI', 'settings', null, { ripristina: true }); return res.json({ ok: true, avvisi: [], modelli: MODELLI_DEFAULT }); }
  const nuovi = modelliFlussoDa(d.modelli || {});
  const diversi = Object.fromEntries(Object.entries(nuovi).filter(([k, v]) => k in MODELLI_DEFAULT && v !== MODELLI_DEFAULT[k]));
  const avvisi = [];
  for (const [k, v] of Object.entries(diversi)) {
    const gruppo = Object.keys(SEGNAPOSTO_MODELLI).find((g) => k === g || k.startsWith(`${g}_`)) || k;
    const ammessi = [...(SEGNAPOSTO_MODELLI[gruppo] || []), 'referenti'];
    const sconosciuti = segnapostoDi(v).filter((x) => !ammessi.includes(x));
    if (sconosciuti.length) avvisi.push(`${MODELLI_LABEL[gruppo] || k}: segnaposto non riconosciuti (restano come testo) ${sconosciuti.map((x) => `{{${x}}}`).join(', ')}`);
  }
  if (diversi.kit_testo !== undefined && !/\{\{\s*link_form\s*\}\}/.test(diversi.kit_testo)) avvisi.push('Kit di proposta: manca {{link_form}}, il cliente non riceve il collegamento alla form online');
  if (diversi.pp_contratto_testo !== undefined && !/\{\{\s*link_form\s*\}\}/.test(diversi.pp_contratto_testo)) avvisi.push('Contratto al partner: manca {{link_form}}, il partner non riceve il collegamento alla form');
  if (Object.keys(diversi).length) await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_MODELLI, JSON.stringify(diversi)]);
  else await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_MODELLI]);
  await audit(req, 'HUB_FLUSSO_MODELLI', 'settings', null, { modelli: Object.keys(diversi) });
  res.json({ ok: true, avvisi, modelli: nuovi });
}));

// Allegati del contratto richiesti nella form, per linea (il contratto firmato c'è sempre)
r.get('/b2b/allegati', ah(async (_req, res) => {
  const x = await one('SELECT value FROM app_settings WHERE key=$1', [CHIAVE_ALLEGATI]);
  res.json(allegatiDa(x?.value || null));
}));
r.put('/b2b/allegati', requireAdmin, ah(async (req, res) => {
  const voce = z.object({ titolo: z.string().trim().min(2).max(160), obbligatorio: z.boolean().default(false) });
  const d = parse(z.object({ SRV: z.array(voce).max(20).default([]), PP: z.array(voce).max(20).default([]), MDL: z.array(voce).max(20).default([]) }), req.body || {});
  await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_ALLEGATI, JSON.stringify(d)]);
  await audit(req, 'HUB_B2B_ALLEGATI', 'settings', null, { SRV: d.SRV.length, PP: d.PP.length, MDL: d.MDL.length });
  res.json(allegatiDa(d));
}));

export default r;
