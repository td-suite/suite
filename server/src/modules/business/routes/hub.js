// Business Hub · route del CRM (montate sotto /api/business/hub). Lettura per tutti i profili del modulo; scrittura sull'account per
// chi gestisce la linea (canEditKind: ADMIN tutte, SERVICE il service, RETAIL i punti prelievo, MDL la medicina del lavoro); le
// criticità anche per HQS; "cliente attivo" solo il CEO (Owner della Suite) o un Admin del modulo. Docs: docs/BUSINESS_HUB.md.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome } from '../lib/util.js';
import { canEditKind, getSettings } from '../lib/rules.js';
import { ribaltaDaAvvio } from '../lib/processo.js';
import { storeBuffer, sendFile, readBuffer, dropBlobs } from '../lib/storage.js';
import { indexOrg } from '../../../lib/search.js';
import {
  LINEE, LINEE_KEYS, FASI, faseLabel, faseEffettiva, puoAndareInFase, puoImpostareAttivo, ultimoAvanzamento, giorniDa, inStallo, spostaFase, indirizzi, emailValida,
} from '../lib/hub.js';
import { ncDiOrg, ordiniDiOrg, ticketDiOrg, circolariDiOrg, portaleDiOrg, contatoriFeed } from '../lib/feed.js';
import { assegnaEmail, inviaAlCliente, casella, ccFissi } from '../lib/caselle.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });

const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().trim().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida').nullable());
const optNum = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(String(v).replace(',', '.'))), z.number().finite().nullable());
const optInt = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable());

const isCeoOAdmin = (req) => puoImpostareAttivo(req.user?.role, req.suiteUser?.level);
const puoLinea = (req, linea) => canEditKind(req.user, linea);
function richiediLinea(req, linea) { if (!puoLinea(req, linea)) throw forbidden(`Non gestisci la linea ${LINEE[linea]?.label || linea}`); }

export const ACCOUNT_SELECT = `SELECT a.*, o.name AS org_name, o.kind AS org_kind, o.code AS org_code, o.vat_number, o.address AS org_address, o.zip AS org_zip,
    coalesce(o.city, a.sedi->0->>'citta') AS citta, coalesce(o.province, a.sedi->0->>'prov') AS prov, o.email AS org_email, o.pec AS org_pec, o.phone AS org_phone, o.active AS org_active,
    uo.full_name AS owner_name, ua.full_name AS attivo_da_name, jsonb_array_length(a.sedi) AS n_sedi,
    CASE WHEN a.linea='PP' THEN coalesce((SELECT ps.name FROM public.sites ps WHERE ps.id=a.pp_site_id), a.pp_nome) END AS punto_nome
  FROM accounts a JOIN public.organizations o ON o.id=a.organization_id
  LEFT JOIN public.users uo ON uo.id=a.owner_user_id LEFT JOIN public.users ua ON ua.id=a.attivo_da_user`;

async function soglie() {
  const s = await getSettings();
  return { stallo: Number(s.hub_stallo_giorni) || 45, ordini: Number(s.hub_ordini_giorni) || 3 };
}
function arricchisci(a, soglia, oggi = todayRome()) {
  const ua = ultimoAvanzamento(a.phase_dates);
  return { ...a, ultimo_avanzamento: ua, giorni_da_avanzamento: giorniDa(ua, oggi), stallo: inStallo(a, soglia, oggi), fase_label: faseLabel(a.fase_corrente),
    azione_scaduta: Boolean(a.data_prossima_azione && String(a.data_prossima_azione) < oggi) };
}
export async function loadAccount(id) {
  const a = await one(`${ACCOUNT_SELECT} WHERE a.id=$1`, [Number(id)]);
  if (!a) throw notFound('Account non trovato');
  return a;
}
export async function addActivity(accountId, x, userId) {
  return one(`INSERT INTO activities (account_id, tipo, at, user_id, con_chi, contatto_id, oggetto, testo, esito, prossima_azione, data_prossima, contract_id, nc_ref, order_ref, ticket_ref, fase_da, fase_a, dati)
    VALUES ($1,$2,coalesce($3::timestamptz, now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
  [accountId, x.tipo, x.at || null, userId || null, x.con_chi || null, x.contatto_id || null, x.oggetto || null, x.testo || null, x.esito || null, x.prossima_azione || null, x.data_prossima || null,
    x.contract_id || null, x.nc_ref || null, x.order_ref || null, x.ticket_ref || null, x.fase_da ?? null, x.fase_a ?? null, x.dati ? JSON.stringify(x.dati) : null]);
}
const tocca = (id) => q('UPDATE accounts SET updated_at=now() WHERE id=$1', [id]);

// ---------------- Elenco (Pipeline, Clienti e prospect) ----------------
r.get('/accounts', ah(async (req, res) => {
  const { linea, priorita, owner, prov, segmento, fase, attivo, q: qs, prospect } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (linea) add('a.linea = ?', String(linea));
  if (priorita) add('a.priorita = ?', String(priorita));
  if (owner === 'nessuno') where.push('a.owner_user_id IS NULL'); else if (owner) add('a.owner_user_id = ?', Number(owner));
  if (prov) add("upper(coalesce(o.province, a.sedi->0->>'prov', '')) = upper(?)", String(prov));
  if (segmento) add('a.segmento_lab = ?', String(segmento));
  if (fase !== undefined && fase !== '') add('a.fase_corrente = ?', Number(fase));
  if (attivo === '1') where.push('a.cliente_attivo'); else if (attivo === '0') where.push('NOT a.cliente_attivo');
  if (prospect === '1') where.push('a.prospect'); else if (prospect === '0') where.push('NOT a.prospect');
  if (qs) { p.push(String(qs).toLowerCase()); const i = p.length; where.push(`(lower(o.name) LIKE '%'||$${i}||'%' OR lower(coalesce(a.gruppo,'')) LIKE '%'||$${i}||'%' OR lower(coalesce(o.city,'')) LIKE '%'||$${i}||'%' OR lower(a.sedi::text) LIKE '%'||$${i}||'%')`); }
  const rows = await many(`SELECT a.id, a.organization_id, o.name AS org_name, a.linea, a.prospect, a.gruppo, a.tipologia, a.segmento_lab, coalesce(o.city, a.sedi->0->>'citta') AS citta,
      coalesce(o.province, a.sedi->0->>'prov') AS prov, a.priorita, a.fase_corrente, a.phase_dates, a.owner_user_id, uo.full_name AS owner_name, a.prossima_azione, a.data_prossima_azione,
      a.fatturato_fy_atteso, a.fatturato_2026, a.cliente_attivo, a.attivo_dal, jsonb_array_length(a.sedi) AS n_sedi, a.fornitore_attuale, a.situazione_fornitore, a.updated_at,
      CASE WHEN a.linea='PP' THEN coalesce((SELECT ps.name FROM public.sites ps WHERE ps.id=a.pp_site_id), a.pp_nome) END AS punto_nome,
      (SELECT count(*)::int FROM contracts c WHERE c.org_id=a.organization_id AND c.kind=a.linea AND c.status<>'ANNULLATO') AS n_contratti,
      (SELECT max(x.at) FROM activities x WHERE x.account_id=a.id AND x.tipo<>'SISTEMA') AS ultimo_contatto,
      (SELECT count(*)::int FROM criticita k WHERE k.account_id=a.id AND k.chiusa_at IS NULL) AS criticita_aperte,
      EXISTS (SELECT 1 FROM activities x WHERE x.account_id=a.id AND x.esito='DA_CONFERMARE') AND NOT a.cliente_attivo AS da_confermare
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN public.users uo ON uo.id=a.owner_user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.fase_corrente DESC, a.fatturato_fy_atteso DESC NULLS LAST, o.name LIMIT 3000`, p);
  const { stallo } = await soglie();
  const oggi = todayRome();
  let out = rows.map((a) => arricchisci(a, stallo, oggi));
  if (req.query.stallo === '1') out = out.filter((a) => a.stallo);
  res.json({ righe: out, soglia_stallo: stallo, fasi: FASI, linee: LINEE });
}));

// Persone che possono essere owner di un account: personale interno con il widget o amministratori della Suite
r.get('/utenti', ah(async (_req, res) => {
  res.json(await many(`SELECT u.id, u.full_name, u.email FROM public.users u WHERE u.status='ACTIVE' AND NOT u.is_external
    AND (u.level IN ('OWNER','ADMIN') OR EXISTS (SELECT 1 FROM public.grants g WHERE g.user_id=u.id AND g.module_key='business' AND NOT g.proposed AND g.profile <> 'VIEWER'))
    ORDER BY u.full_name`));
}));

// ---------------- Scheda account ----------------
r.get('/accounts/:id', ah(async (req, res) => {
  let a = await loadAccount(req.params.id);
  // listino unico (07/11/2026): Service senza listino con un Excel storico nel contratto della linea → importazione automatica alla prima
  // apertura (versione 1 corrente, attività LISTINO nel diario, file del contratto collegato alla versione); se il file non si legge resta
  // "Importa dal contratto" con il mapping a video
  if (a.linea === 'SRV') {
    const { importaAllaPrimaApertura } = await import('../lib/listinoUnico.js');
    const { salvaVersione } = await import('./listino.js');
    const imp = await importaAllaPrimaApertura(a, (x) => salvaVersione(a, { buffer: x.buffer, filename: x.filename, mimetype: x.mime, note: x.note, esistenteId: x.esistenteId }, req.user.id));
    if (imp) { await audit(req, 'HUB_LISTINO', 'account', a.id, { versione: imp.versione, esami: imp.riepilogo.esami, automatico: true }); a = await loadAccount(req.params.id); }
  }
  const { stallo } = await soglie();
  const [contatti, persone, criticita, contratti, fascicoli, documenti, attivita, altri] = await Promise.all([
    many(`SELECT c.*, p.last_name || ' ' || p.first_name AS persona_nome, p.job_title AS persona_ruolo FROM contatti c LEFT JOIN public.people p ON p.id=c.person_id WHERE c.account_id=$1 ORDER BY c.principale DESC, c.nome`, [a.id]),
    many(`SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.email, p.phone, p.job_title AS ruolo FROM public.people p
      WHERE p.organization_id=$1 AND p.status <> 'CESSATO' AND NOT EXISTS (SELECT 1 FROM contatti c WHERE c.account_id=$2 AND c.person_id=p.id) ORDER BY p.last_name, p.first_name`, [a.organization_id, a.id]),
    many(`SELECT k.*, u.full_name AS user_name, uc.full_name AS chiusa_by_name FROM criticita k LEFT JOIN users u ON u.id=k.user_id LEFT JOIN users uc ON uc.id=k.chiusa_by WHERE k.account_id=$1 ORDER BY (k.chiusa_at IS NULL) DESC, k.aperta_at DESC`, [a.id]),
    many(`SELECT c.id, c.kind, c.protocol, c.status, c.title, c.proposal_date, c.signed_at, c.start_date, c.end_date, c.version, c.site_id, s.name AS site_name,
        (SELECT json_agg(json_build_object('id', f.id, 'category', f.category, 'filename', f.filename, 'size', f.size) ORDER BY f.created_at DESC) FROM contract_files f WHERE f.contract_id=c.id) AS files
      FROM contracts c LEFT JOIN public.sites s ON s.id=c.site_id WHERE c.org_id=$1 ORDER BY (c.kind=$2) DESC, c.created_at DESC`, [a.organization_id, a.linea]),
    many(`SELECT d.id, d.status, coalesce(d.title, c.title, s.name) AS title, d.submitted_at, d.authorized_at, d.authorization_ref, s.name AS site_name, c.protocol
      FROM dossiers d LEFT JOIN contracts c ON c.id=d.contract_id LEFT JOIN public.sites s ON s.id=d.site_id WHERE d.org_id=$1 ORDER BY d.created_at DESC`, [a.organization_id]),
    many(`SELECT d.id, d.categoria, d.filename, d.mime, d.size, d.created_at, d.activity_id, d.etichetta, d.da_verificare, u.full_name AS uploaded_by_name FROM documenti d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.account_id=$1 ORDER BY d.created_at DESC`, [a.id]),
    many(`SELECT x.*, u.full_name AS user_name, c.protocol AS contract_protocol,
        (SELECT json_agg(json_build_object('id', d.id, 'filename', d.filename, 'size', d.size)) FROM documenti d WHERE d.activity_id=x.id) AS allegati
      FROM activities x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN contracts c ON c.id=x.contract_id WHERE x.account_id=$1 ORDER BY x.at DESC, x.id DESC LIMIT 500`, [a.id]),
    many('SELECT id, linea, fase_corrente, cliente_attivo FROM accounts WHERE organization_id=$1 AND id<>$2', [a.organization_id, a.id]),
  ]);
  // scheda "Contratto" (07/11/2026): il contratto della linea mostrato per primo è quello del pacchetto e del kit (offertaDi: il più
  // recente non annullato né cessato; per i Punti Prelievo quello della sede del punto)
  const { offertaDi } = await import('../lib/pacchettoGenera.js');
  const { contratto: contrattoCorrente } = await offertaDi(a);
  res.json({ ...arricchisci(a, stallo), contatti, persone, criticita, contratti, fascicoli, documenti, attivita, altri_account: altri, contratto_corrente_id: contrattoCorrente?.id || null,
    puo_modificare: puoLinea(req, a.linea), puo_attivo: isCeoOAdmin(req), puo_criticita: puoLinea(req, a.linea) || req.user.role === 'HQS',
    casella: casella(a.linea, await getSettings()).address, soglia_stallo: stallo, da_verificare: documenti.filter((d) => d.da_verificare).length });
}));

// Feed dagli altri widget (sola lettura)
r.get('/accounts/:id/feed/:sezione', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  switch (req.params.sezione) {
    case 'nc': return res.json(await ncDiOrg(a.organization_id));
    case 'ordini': { const { ordini } = await soglie(); return res.json({ ...(await ordiniDiOrg(a.organization_id)), soglia_giorni: ordini }); }
    case 'ticket': return res.json(await ticketDiOrg(a.organization_id));
    case 'circolari': {
      const emails = (await many(`SELECT lower(x) AS e FROM (SELECT o.email AS x FROM public.organizations o WHERE o.id=$1 UNION SELECT o.pec FROM public.organizations o WHERE o.id=$1
        UNION SELECT c.email FROM contatti c WHERE c.account_id=$2 UNION SELECT p.email FROM public.people p WHERE p.organization_id=$1) t WHERE x IS NOT NULL`, [a.organization_id, a.id])).map((x) => x.e);
      return res.json(await circolariDiOrg(a.organization_id, a.linea, emails));
    }
    case 'portale': return res.json(await portaleDiOrg(a.organization_id));
    default: throw notFound('Sezione inesistente');
  }
}));

// ---------------- Creazione e modifica ----------------
const accountFields = {
  priorita: z.enum(['ALTA', 'MEDIA', 'BASSA']).nullable().optional(), owner_user_id: optInt.optional(), prospect: z.boolean().optional(),
  gruppo: optStr(200).optional(), tipologia: optStr(200).optional(), segmento_lab: optStr(200).optional(), discipline: optStr(500).optional(), accreditata_ssr: optStr(20).optional(),
  fatturato_struttura: optNum.optional(), anno_bilancio: optStr(10).optional(), modalita_contatto: optStr(100).optional(), fornitore_attuale: optStr(200).optional(),
  situazione_fornitore: optStr(200).optional(), listino_riferimento: optStr(200).optional(), fonte_priorita: optStr(200).optional(), stato_cartella: optStr(100).optional(),
  prossima_azione: optStr(500).optional(), data_prossima_azione: optDate.optional(), sconto_medio: optNum.optional(), volume_fy_atteso: optNum.optional(),
  prezzo_medio_esame: optNum.optional(), fatturato_fy_atteso: optNum.optional(), fatturato_2026: optNum.optional(), fatturato_2027: optNum.optional(),
  note: optStr(5000).optional(), fonte_censimento: optStr(500).optional(),
  // processo Service: volumi giornalieri attesi (email al laboratorio), data di avvio prevista, esclusione dal richiamo dei prospect
  volumi_giornalieri_attesi: optNum.optional(), data_avvio_prevista: optDate.optional(), non_contattare: z.boolean().optional(),
};
const createSchema = z.object({
  linea: z.enum(['SRV', 'PP', 'MDL']), organization_id: optInt.optional(),
  // Punti Prelievo: un account per punto (sede TD collegata o nome finché la sede non c'è, tipo previsto flagship/corner)
  pp_site_id: optInt.optional(), pp_nome: optStr(200).optional(), pp_tipo_previsto: z.preprocess((v) => (v === '' ? null : v), z.enum(['FLAGSHIP', 'CORNER']).nullable()).optional(),
  nuova_org: z.object({ name: z.string().trim().min(2).max(200), city: optStr(120), province: optStr(4), email: optStr(160), phone: optStr(60), address: optStr(200), vat_number: optStr(20) }).optional(),
  ...accountFields,
});
async function checkOwner(id) { if (id && !(await one(`SELECT 1 FROM public.users WHERE id=$1 AND status='ACTIVE' AND NOT is_external`, [id]))) throw bad('Owner non valido: scegli una persona interna attiva'); }

r.post('/accounts', ah(async (req, res) => {
  const d = parse(createSchema, req.body);
  richiediLinea(req, d.linea);
  await checkOwner(d.owner_user_id);
  let orgId = d.organization_id;
  if (!orgId && !d.nuova_org) throw bad('Scegli la Legal entity o indica il nome della nuova');
  if (!orgId) {
    // prospect nuovo: Legal entity CLIENTE (il tipo TARGET è delle società da acquisire di Integration)
    const o = d.nuova_org;
    const row = await one(`INSERT INTO public.organizations (kind, name, city, province, email, phone, address, vat_number, notes) VALUES ('CLIENTE',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [o.name, o.city, o.province, o.email, o.phone, o.address, o.vat_number, 'Creata dal Business Hub (prospect)']);
    orgId = row.id; indexOrg(row).catch(() => {});
  } else if (!(await one('SELECT 1 FROM public.organizations WHERE id=$1', [orgId]))) throw bad('Legal entity non trovata');
  if (d.linea !== 'PP' && await one('SELECT 1 FROM accounts WHERE organization_id=$1 AND linea=$2', [orgId, d.linea])) throw bad('Questa Legal entity ha già un account su questa linea');
  if (d.linea === 'PP') {
    if (d.pp_site_id) {
      const sd = await one('SELECT kind FROM public.sites WHERE id=$1', [d.pp_site_id]);
      if (sd?.kind !== 'PUNTO_PRELIEVI') throw bad('Collega una sede di tipo Punto prelievi');
      if (await one('SELECT 1 FROM accounts WHERE pp_site_id=$1', [d.pp_site_id])) throw bad('Questa sede ha già il suo punto prelievi nel Business Hub');
    }
    if (await one(`SELECT 1 FROM accounts WHERE organization_id=$1 AND linea='PP' AND coalesce(pp_site_id,0)=coalesce($2::int,0) AND lower(coalesce(pp_nome,''))=lower(coalesce($3::text,''))`, [orgId, d.pp_site_id || null, d.pp_nome || null])) throw bad('Questa Legal entity ha già un punto prelievi con questa sede o questo nome: indica il nome del nuovo punto');
  } else { delete d.pp_site_id; delete d.pp_nome; delete d.pp_tipo_previsto; }
  const { linea, organization_id: _o, nuova_org: _n, ...fields } = d;
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const row = await one(`INSERT INTO accounts (organization_id, linea, created_by${cols.map((c) => `, ${c}`).join('')}) VALUES ($1,$2,$3${cols.map((_, i) => `, $${i + 4}`).join('')}) RETURNING id`,
    [orgId, linea, req.user.id, ...cols.map((c) => fields[c])]);
  await addActivity(row.id, { tipo: 'SISTEMA', oggetto: 'Account creato', testo: `Linea ${LINEE[linea].label}${linea === 'PP' && (d.pp_nome || d.pp_site_id) ? ' (punto prelievi)' : ''}` }, req.user.id);
  await audit(req, 'HUB_ACCOUNT_CREATE', 'account', row.id, { linea, org_id: orgId });
  res.status(201).json({ id: row.id });
}));

r.put('/accounts/:id', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const d = parse(z.object(accountFields), req.body);
  if (d.owner_user_id !== undefined) await checkOwner(d.owner_user_id);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!cols.length) return res.json(await loadAccount(a.id));
  await q(`UPDATE accounts SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [a.id, ...cols.map((c) => d[c])]);
  // data di avvio (o volumi) cambiati: fatturato dell'anno di avvio e dell'anno seguente ribaltati in automatico dai dati annui
  if (['data_avvio_prevista', 'data_avvio_effettiva', 'volumi_giornalieri_attesi', 'volume_fy_atteso', 'fatturato_fy_atteso'].some((k) => cols.includes(k))) {
    const fresco = await loadAccount(a.id);
    const s = await getSettings();
    const rb = ribaltaDaAvvio({ ...fresco, data_avvio: fresco.data_avvio_effettiva || fresco.data_avvio_prevista }, s.hub_giorni_lavorativi);
    if (rb && rb.fatturato_anno_avvio != null) {
      const set = {}; if (rb.anno === 2026) { set.fatturato_2026 = rb.fatturato_anno_avvio; set.fatturato_2027 = rb.fatturato_anno_seguente; } else if (rb.anno === 2025) set.fatturato_2026 = rb.fatturato_anno_seguente;
      if (fresco.volumi_giornalieri_attesi == null && rb.volumi_giornalieri != null) set.volumi_giornalieri_attesi = rb.volumi_giornalieri;
      const ks = Object.keys(set);
      if (ks.length) {
        await q(`UPDATE accounts SET ${ks.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [a.id, ...ks.map((k) => set[k])]);
        await addActivity(a.id, { tipo: 'SISTEMA', oggetto: 'Volumi e fatturati ribaltati dalla data di avvio', testo: `Avvio ${String(fresco.data_avvio_effettiva || fresco.data_avvio_prevista).slice(0, 10)}: ${rb.giorni_lavorativi_residui} giorni lavorativi residui nel ${rb.anno} (${Math.round(rb.quota_anno * 100)}% dell'anno). ${rb.volumi_giornalieri != null ? `Volumi: ${rb.volumi_giornalieri} esami al giorno, ${rb.volume_anno_avvio} nel ${rb.anno}. ` : ''}Fatturato ${rb.anno} da starting: ${rb.fatturato_anno_avvio} €; ${rb.anno + 1}: ${rb.fatturato_anno_seguente} €.` }, req.user.id);
      }
    }
  }
  if (d.owner_user_id !== undefined && d.owner_user_id !== a.owner_user_id) {
    const u = d.owner_user_id ? await one('SELECT full_name FROM public.users WHERE id=$1', [d.owner_user_id]) : null;
    await addActivity(a.id, { tipo: 'SISTEMA', oggetto: 'Owner cambiato', testo: `${a.owner_name || 'nessuno'} → ${u?.full_name || 'nessuno'}` }, req.user.id);
  }
  await audit(req, 'HUB_ACCOUNT_UPDATE', 'account', a.id, { campi: cols });
  res.json({ ok: true });
}));

// Avanzamento di fase (trascinamento nella Pipeline o dalla scheda): registra l'attività con la data
r.put('/accounts/:id/fase', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const d = parse(z.object({ fase: z.coerce.number().int().min(0).max(7), data: optDate.optional(), nota: optStr(1000).optional() }), req.body);
  const ok = puoAndareInFase(d.fase, a.cliente_attivo);
  if (!ok.ok) throw bad(ok.motivo);
  const { phase_dates: pd, tolte } = spostaFase(a.phase_dates, d.fase, d.data || todayRome());
  const nuova = faseEffettiva(pd, a.cliente_attivo);
  await q('UPDATE accounts SET phase_dates=$2, fase_corrente=$3, updated_at=now() WHERE id=$1', [a.id, JSON.stringify(pd), nuova]);
  const togli = Object.entries(tolte).map(([n, dt]) => `${faseLabel(n)} (${dt})`);
  await addActivity(a.id, { tipo: 'SISTEMA', oggetto: `Fase: ${faseLabel(a.fase_corrente)} → ${faseLabel(nuova)}`, fase_da: a.fase_corrente, fase_a: nuova,
    testo: [d.fase >= 1 ? `Data della fase ${d.fase}: ${pd[d.fase]}` : 'Riportato a prospect censito', togli.length ? `Date tolte (ritorno a una fase precedente): ${togli.join(', ')}` : null, d.nota].filter(Boolean).join('\n'),
    dati: { phase_dates_prima: a.phase_dates } }, req.user.id);
  await audit(req, 'HUB_FASE', 'account', a.id, { da: a.fase_corrente, a: nuova });
  res.json({ ok: true, fase_corrente: nuova, phase_dates: pd });
}));

// Cliente attivo: "chi dice che il cliente è attivo? Lo devo dire io" (CEO, 06/11/2026). Solo Owner della Suite o Admin del modulo.
r.put('/accounts/:id/attivo', ah(async (req, res) => {
  if (!isCeoOAdmin(req)) throw forbidden('Il cliente attivo lo imposta solo il CEO o un Admin del modulo');
  const a = await loadAccount(req.params.id);
  const d = parse(z.object({ attivo: z.boolean(), dal: optDate.optional(), nota: optStr(1000).optional() }), req.body);
  const pd = { ...(a.phase_dates || {}) };
  if (d.attivo) {
    const dal = d.dal || pd[7] || todayRome();
    pd[7] = dal;
    await q('UPDATE accounts SET cliente_attivo=TRUE, attivo_dal=$2, attivo_da_user=$3, attivo_nota=$4, prospect=FALSE, phase_dates=$5, fase_corrente=7, updated_at=now() WHERE id=$1',
      [a.id, dal, req.suiteUser.id, d.nota || null, JSON.stringify(pd)]);
    await q(`UPDATE activities SET esito='CONFERMATO' WHERE account_id=$1 AND esito='DA_CONFERMARE'`, [a.id]);
    await addActivity(a.id, { tipo: 'SISTEMA', oggetto: 'Cliente attivo', esito: 'CONFERMATO', fase_da: a.fase_corrente, fase_a: 7, testo: [`Cliente attivo dal ${dal}, impostato da ${req.suiteUser.full_name}.`, d.nota].filter(Boolean).join('\n') }, req.user.id);
  } else {
    delete pd[7];
    const f = faseEffettiva(pd, false);
    await q('UPDATE accounts SET cliente_attivo=FALSE, attivo_dal=NULL, attivo_da_user=$2, attivo_nota=$3, phase_dates=$4, fase_corrente=$5, updated_at=now() WHERE id=$1', [a.id, req.suiteUser.id, d.nota || null, JSON.stringify(pd), f]);
    await q(`UPDATE activities SET esito='NON_CONFERMATO' WHERE account_id=$1 AND esito='DA_CONFERMARE'`, [a.id]);
    await addActivity(a.id, { tipo: 'SISTEMA', oggetto: 'Cliente non attivo', esito: 'NON_ATTIVO', fase_da: a.fase_corrente, fase_a: f, testo: [`Impostato da ${req.suiteUser.full_name}.`, a.phase_dates?.[7] ? `Tolta la data della fase 7 (${a.phase_dates[7]}).` : null, d.nota].filter(Boolean).join('\n') }, req.user.id);
  }
  await audit(req, d.attivo ? 'HUB_CLIENTE_ATTIVO' : 'HUB_CLIENTE_NON_ATTIVO', 'account', a.id, { dal: d.dal || null });
  res.json({ ok: true });
}));

r.delete('/accounts/:id', ah(async (req, res) => {
  if (req.user.role !== 'ADMIN') throw forbidden('Un account lo elimina solo un Admin del modulo');
  const a = await loadAccount(req.params.id);
  const blobs = await many('SELECT blob_path FROM documenti WHERE account_id=$1', [a.id]);
  await q('DELETE FROM accounts WHERE id=$1', [a.id]);
  await dropBlobs(blobs.map((b) => b.blob_path));
  await audit(req, 'HUB_ACCOUNT_DELETE', 'account', a.id, { org: a.org_name, linea: a.linea });
  res.json({ ok: true });
}));

// ---------------- Diario ----------------
const attivitaSchema = z.object({
  tipo: z.enum(['CHIAMATA', 'MESSAGGIO', 'INCONTRO', 'SOPRALLUOGO', 'NOTA', 'OFFERTA', 'CRITICITA', 'EMAIL_IN', 'EMAIL_OUT']),
  at: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().max(40).nullable()).optional(),
  con_chi: optStr(300).optional(), contatto_id: optInt.optional(), oggetto: optStr(300).optional(), testo: optStr(20000).optional(), esito: optStr(300).optional(),
  prossima_azione: optStr(500).optional(), data_prossima: optDate.optional(), contract_id: optInt.optional(),
});
r.post('/accounts/:id/attivita', upload.array('files', 10), ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const d = parse(attivitaSchema, req.body);
  if (!d.testo && !d.oggetto) throw bad('Scrivi cosa vi siete detti (o almeno l\'oggetto)');
  if (d.at && Number.isNaN(Date.parse(d.at))) throw bad('Data e ora non valide');
  if (d.contatto_id && !(await one('SELECT 1 FROM contatti WHERE id=$1 AND account_id=$2', [d.contatto_id, a.id]))) throw bad('Referente non valido');
  if (d.contract_id && !(await one('SELECT 1 FROM contracts WHERE id=$1 AND org_id=$2', [d.contract_id, a.organization_id]))) throw bad('Contratto non della Legal entity');
  const act = await addActivity(a.id, { ...d, dati: d.tipo.startsWith('EMAIL') ? { registrata_a_mano: true } : null }, req.user.id);
  for (const f of req.files || []) {
    const st = await storeBuffer('hub', f.originalname, f.mimetype, f.buffer);
    await q(`INSERT INTO documenti (account_id, activity_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,$2,'ALLEGATO',$3,$4,$5,$6,$7,$8,$9)`,
      [a.id, act.id, f.originalname, f.mimetype || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path, req.user.id]);
  }
  if (d.prossima_azione || d.data_prossima) await q('UPDATE accounts SET prossima_azione=coalesce($2, prossima_azione), data_prossima_azione=coalesce($3, data_prossima_azione), updated_at=now() WHERE id=$1', [a.id, d.prossima_azione || null, d.data_prossima || null]);
  else await tocca(a.id);
  await audit(req, 'HUB_ATTIVITA', 'account', a.id, { tipo: d.tipo, allegati: (req.files || []).length });
  res.status(201).json(act);
}));

r.delete('/attivita/:id', ah(async (req, res) => {
  const x = await one('SELECT x.id, x.tipo, x.user_id, x.account_id, a.linea FROM activities x JOIN accounts a ON a.id=x.account_id WHERE x.id=$1', [Number(req.params.id)]);
  if (!x) throw notFound();
  if (['SISTEMA', 'EMAIL_OUT'].includes(x.tipo) || (x.tipo === 'EMAIL_IN' && !(await one('SELECT 1 FROM activities WHERE id=$1 AND graph_id IS NULL', [x.id])))) throw bad('Le attività di sistema e le email registrate dalle caselle non si eliminano');
  if (!(req.user.role === 'ADMIN' || (x.user_id === req.user.id && puoLinea(req, x.linea)))) throw forbidden('Elimina solo le tue attività (o un Admin del modulo)');
  await q('UPDATE documenti SET activity_id=NULL WHERE activity_id=$1', [x.id]);
  await q('DELETE FROM activities WHERE id=$1', [x.id]);
  await audit(req, 'HUB_ATTIVITA_DELETE', 'account', x.account_id, { tipo: x.tipo });
  res.json({ ok: true });
}));

// ---------------- Referenti ----------------
const contattoSchema = z.object({ nome: z.string().trim().min(2).max(200), ruolo: optStr(200).optional(), email: optStr(200).optional(), telefono: optStr(60).optional(),
  principale: z.boolean().optional(), note: optStr(1000).optional(), person_id: optInt.optional(),
  // provenienza del referente scelto dalle rubriche esterne (componente CercaRubrica, 07/11/2026): resta modificabile come ogni referente
  fonte: z.enum(['MANUALE', 'RUBRICA_OUTLOOK', 'RUBRICA_GMAIL']).optional() });
async function personaDi(orgId, d) {
  if (d.person_id) { const p = await one('SELECT id FROM public.people WHERE id=$1 AND organization_id=$2', [d.person_id, orgId]); if (!p) throw bad('La persona non appartiene a questa Legal entity'); return p.id; }
  if (d.email) return (await one('SELECT id FROM public.people WHERE organization_id=$1 AND lower(email)=lower($2) LIMIT 1', [orgId, d.email]))?.id || null;
  return null;
}
r.post('/accounts/:id/contatti', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const d = parse(contattoSchema, req.body);
  if (d.email && !emailValida(d.email)) throw bad('Email non valida');
  const personId = await personaDi(a.organization_id, d);
  if (personId && await one('SELECT 1 FROM contatti WHERE account_id=$1 AND person_id=$2', [a.id, personId])) throw bad('Questa persona è già tra i referenti');
  if (d.principale) await q('UPDATE contatti SET principale=FALSE WHERE account_id=$1', [a.id]);
  const row = await one(`INSERT INTO contatti (account_id, person_id, nome, ruolo, email, telefono, principale, note, fonte) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [a.id, personId, d.nome, d.ruolo || null, d.email ? d.email.toLowerCase() : null, d.telefono || null, Boolean(d.principale), d.note || null, d.fonte || 'MANUALE']);
  await tocca(a.id);
  await audit(req, 'HUB_CONTATTO', 'account', a.id, { contatto: row.id, persona: personId, fonte: row.fonte });
  res.status(201).json(row);
}));
r.put('/contatti/:id', ah(async (req, res) => {
  const c = await one('SELECT c.*, a.linea, a.organization_id FROM contatti c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1', [Number(req.params.id)]);
  if (!c) throw notFound();
  richiediLinea(req, c.linea);
  const d = parse(contattoSchema.omit({ fonte: true }).partial(), req.body);   // la provenienza non cambia in modifica
  if (d.email && !emailValida(d.email)) throw bad('Email non valida');
  if (d.principale) await q('UPDATE contatti SET principale=FALSE WHERE account_id=$1', [c.account_id]);
  const personId = d.email !== undefined || d.person_id !== undefined ? await personaDi(c.organization_id, { ...c, ...d }) : c.person_id;
  await q(`UPDATE contatti SET nome=coalesce($2,nome), ruolo=$3, email=$4, telefono=$5, principale=coalesce($6, principale), note=$7, person_id=$8, updated_at=now() WHERE id=$1`,
    [c.id, d.nome || null, d.ruolo !== undefined ? d.ruolo : c.ruolo, d.email !== undefined ? (d.email ? d.email.toLowerCase() : null) : c.email, d.telefono !== undefined ? d.telefono : c.telefono, d.principale ?? null, d.note !== undefined ? d.note : c.note, personId]);
  res.json({ ok: true });
}));
r.delete('/contatti/:id', ah(async (req, res) => {
  const c = await one('SELECT c.id, c.account_id, a.linea FROM contatti c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1', [Number(req.params.id)]);
  if (!c) throw notFound();
  richiediLinea(req, c.linea);
  await q('DELETE FROM contatti WHERE id=$1', [c.id]);
  res.json({ ok: true });
}));

// ---------------- Criticità ----------------
const criticitaSchema = z.object({ origine: z.enum(['LABORATORIO', 'CLIENTE', 'LOGISTICA', 'AMMINISTRAZIONE', 'ALTRO']), gravita: z.enum(['BASSA', 'MEDIA', 'ALTA', 'CRITICA']).default('MEDIA'),
  titolo: optStr(200).optional(), descrizione: z.string().trim().min(3).max(5000), aperta_at: optDate.optional() });
const puoCriticita = (req, linea) => puoLinea(req, linea) || req.user.role === 'HQS';
r.post('/accounts/:id/criticita', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (!puoCriticita(req, a.linea)) throw forbidden('Non puoi registrare criticità su questa linea');
  const d = parse(criticitaSchema, req.body);
  const row = await one(`INSERT INTO criticita (account_id, origine, gravita, titolo, descrizione, aperta_at, user_id) VALUES ($1,$2,$3,$4,$5,coalesce($6::date::timestamptz, now()),$7) RETURNING *`,
    [a.id, d.origine, d.gravita, d.titolo || null, d.descrizione, d.aperta_at || null, req.user.id]);
  await addActivity(a.id, { tipo: 'CRITICITA', oggetto: `Criticità aperta (${d.origine.toLowerCase()}, gravità ${d.gravita.toLowerCase()})${d.titolo ? `: ${d.titolo}` : ''}`, testo: d.descrizione, dati: { criticita_id: row.id } }, req.user.id);
  const o = await one('SELECT owner_user_id FROM accounts WHERE id=$1', [a.id]);
  if (o?.owner_user_id && ['ALTA', 'CRITICA'].includes(d.gravita)) {
    const { notify } = await import('../../../lib/community.js');
    await notify([o.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `Criticità ${d.gravita.toLowerCase()} su ${a.org_name}`.slice(0, 200), body: d.titolo || d.origine, link: `/business/account/${a.id}` }).catch(() => 0);
  }
  await audit(req, 'HUB_CRITICITA', 'account', a.id, { id: row.id, origine: d.origine, gravita: d.gravita });
  res.status(201).json(row);
}));
r.put('/criticita/:id/chiudi', ah(async (req, res) => {
  const k = await one('SELECT k.*, a.linea FROM criticita k JOIN accounts a ON a.id=k.account_id WHERE k.id=$1', [Number(req.params.id)]);
  if (!k) throw notFound();
  if (!puoCriticita(req, k.linea)) throw forbidden();
  if (k.chiusa_at) throw bad('Criticità già chiusa');
  const d = parse(z.object({ esito: z.string().trim().min(3).max(2000) }), req.body);
  await q('UPDATE criticita SET chiusa_at=now(), chiusa_by=$2, esito=$3 WHERE id=$1', [k.id, req.user.id, d.esito]);
  await addActivity(k.account_id, { tipo: 'CRITICITA', oggetto: `Criticità chiusa${k.titolo ? `: ${k.titolo}` : ''}`, testo: d.esito, esito: 'CHIUSA', dati: { criticita_id: k.id } }, req.user.id);
  res.json({ ok: true });
}));

// ---------------- Documenti ----------------
r.post('/accounts/:id/documenti', upload.array('files', 10), ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  if (!req.files?.length) throw bad('Nessun file');
  const cat = ['OFFERTA', 'VERBALE', 'ALTRO'].includes(req.body.categoria) ? req.body.categoria : 'ALTRO';
  for (const f of req.files) {
    const st = await storeBuffer('hub', f.originalname, f.mimetype, f.buffer);
    await q(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.id, cat, f.originalname, f.mimetype || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path, req.user.id]);
  }
  await tocca(a.id);
  res.status(201).json({ ok: true });
}));
r.get('/documenti/:id', ah(async (req, res) => {
  const f = await one('SELECT filename, mime, data, blob_path FROM documenti WHERE id=$1', [Number(req.params.id)]);
  if (!f) throw notFound();
  await sendFile(res, f, { inline: Boolean(req.query.inline) });
}));
r.delete('/documenti/:id', ah(async (req, res) => {
  const f = await one('SELECT d.id, d.blob_path, d.categoria, a.linea FROM documenti d JOIN accounts a ON a.id=d.account_id WHERE d.id=$1', [Number(req.params.id)]);
  if (!f) throw notFound();
  richiediLinea(req, f.linea);
  if (f.categoria === 'EMAIL' && req.user.role !== 'ADMIN') throw bad('Gli allegati delle email ricevute li rimuove solo un Admin del modulo');
  await q('DELETE FROM documenti WHERE id=$1', [f.id]);
  await dropBlobs([f.blob_path]);
  res.json({ ok: true });
}));

// ---------------- Scrivi al cliente ----------------
const emailSchema = z.object({ to: z.array(z.string().trim()).min(1, 'almeno un destinatario'), cc_extra: z.array(z.string().trim()).default([]), subject: z.string().trim().min(2).max(300),
  testo: z.string().trim().min(2).max(50000), documenti: z.array(z.coerce.number().int()).default([]), contract_files: z.array(z.coerce.number().int()).default([]),
  contatto_id: optInt.optional(), contract_id: optInt.optional(), conferma: z.boolean().optional(), pacchetto_id: optInt.optional(),
  // revisione del listino/offerta (07/11/2026): "Invia per la firma" dell'offerta economica della versione
  sottotipo: z.enum(['OFFERTA_REVISIONE']).optional(), listino_id: optInt.optional() });
async function preparaEmail(req) {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const d = parse(emailSchema, req.body);
  const to = indirizzi(d.to);
  if (!to.length) throw bad('Indica almeno un destinatario valido');
  const docs = d.documenti.length ? await many('SELECT id, filename, mime, size, data, blob_path FROM documenti WHERE id = ANY($1::int[]) AND account_id=$2', [d.documenti, a.id]) : [];
  const cf = d.contract_files.length ? await many('SELECT f.id, f.filename, f.mime, f.size, f.data, f.blob_path, f.contract_id FROM contract_files f JOIN contracts c ON c.id=f.contract_id WHERE f.id = ANY($1::int[]) AND c.org_id=$2', [d.contract_files, a.organization_id]) : [];
  if (docs.length !== d.documenti.length || cf.length !== d.contract_files.length) throw bad('Allegati non validi per questo account');
  const peso = [...docs, ...cf].reduce((n, f) => n + Number(f.size || 0), 0);
  if (peso > 25 * 1024 * 1024) throw bad('Allegati oltre 25 MB: Microsoft rifiuta il messaggio. Togli qualche file');
  const s = await getSettings();
  const cc = [...new Set([...ccFissi(a.linea, s), ...indirizzi(d.cc_extra)])].filter((x) => !to.includes(x));
  const conosciuti = new Set((await many('SELECT lower(email) AS e FROM contatti WHERE account_id=$1 AND email IS NOT NULL', [a.id])).map((x) => x.e));
  const avvisi = to.filter((x) => !conosciuti.has(x)).map((x) => `${x} non è tra i referenti dell'account`);
  return { a, d, to, cc, docs, cf, avvisi, from: casella(a.linea, s).address };
}
r.post('/accounts/:id/email/anteprima', ah(async (req, res) => {
  const { a, to, cc, docs, cf, avvisi, from, d } = await preparaEmail(req);
  res.json({ account_id: a.id, from, to, cc, cc_fissi: ccFissi(a.linea, await getSettings()), subject: d.subject, allegati: [...docs, ...cf].map((f) => ({ filename: f.filename, size: f.size })), avvisi });
}));
r.post('/accounts/:id/email/invia', ah(async (req, res) => {
  const { a, d, to, cc, docs, cf } = await preparaEmail(req);
  if (!d.conferma) throw bad('Conferma l\'invio dopo aver letto il riepilogo');
  const allegati = [];
  for (const f of docs) allegati.push({ filename: f.filename, content: await readBuffer(f), contentType: f.mime, ref: `documento:${f.id}` });
  for (const f of cf) allegati.push({ filename: f.filename, content: await readBuffer(f), contentType: f.mime, ref: `contract_file:${f.id}` });
  const revisione = d.sottotipo === 'OFFERTA_REVISIONE' ? await one('SELECT id, versione FROM listini WHERE id=$1 AND account_id=$2', [d.listino_id || 0, a.id]) : null;
  if (d.sottotipo === 'OFFERTA_REVISIONE' && !revisione) throw bad('Versione del listino non valida per questo account');
  const out = await inviaAlCliente({ account: a, to, ccExtra: cc, subject: d.subject, testo: d.testo, allegati, userId: req.user.id, contattoId: d.contatto_id || null, contractId: d.contract_id || null,
    sottotipo: d.sottotipo || null, dati: revisione ? { listino_id: revisione.id, versione: revisione.versione } : null });
  if (revisione) { const { segnaInviata } = await import('../lib/revisioneOfferta.js'); await segnaInviata(revisione.id, out.activity_id, out.stato); }
  for (const f of docs) await q('UPDATE documenti SET activity_id=coalesce(activity_id, $2) WHERE id=$1', [f.id, out.activity_id]);
  // Pacchetto di benvenuto inviato dalla scheda: l'invio resta nel registro dei pacchetti (l'email è un EMAIL_OUT come le altre)
  if (d.pacchetto_id) {
    await q(`UPDATE pacchetti SET inviato_activity_id=$2, inviato_at=now(), inviato_stato=$3 WHERE id=$1 AND account_id=$4`, [d.pacchetto_id, out.activity_id, out.stato, a.id]);
    await q(`UPDATE activities SET dati = coalesce(dati, '{}'::jsonb) || jsonb_build_object('pacchetto_id', $2::int) WHERE id=$1`, [out.activity_id, d.pacchetto_id]);
  }
  await tocca(a.id);
  await audit(req, 'HUB_EMAIL_OUT', 'account', a.id, { stato: out.stato, destinatari: to.length, allegati: allegati.length });
  res.json(out);
}));

// Registro invii (tutte le email partite dal Business Hub)
r.get('/invii', ah(async (req, res) => {
  const linea = String(req.query.linea || '');
  res.json(await many(`SELECT x.id, x.at, x.account_id, o.name AS org_name, a.linea, x.oggetto, x.sottotipo, x.email_from, x.email_to, x.email_cc, x.email_stato, x.email_errore, x.email_message_id, u.full_name AS user_name,
      jsonb_array_length(coalesce(x.dati->'allegati', '[]'::jsonb)) AS n_allegati
    FROM activities x JOIN accounts a ON a.id=x.account_id JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN users u ON u.id=x.user_id
    WHERE x.tipo='EMAIL_OUT' AND x.email_stato IS NOT NULL AND ($1='' OR a.linea=$1) ORDER BY x.at DESC LIMIT 500`, [linea]));
}));

// ---------------- Email da assegnare ----------------
r.get('/email/da-assegnare', ah(async (_req, res) => {
  res.json(await many(`SELECT e.id, e.linea, e.casella, e.received_at, e.from_email, e.from_name, e.subject, e.preview, e.n_allegati, e.come, e.simulato FROM email_in e WHERE e.stato='DA_ASSEGNARE' ORDER BY e.received_at DESC LIMIT 300`));
}));
r.post('/email/:id/assegna', ah(async (req, res) => {
  const m = await one('SELECT * FROM email_in WHERE id=$1', [Number(req.params.id)]);
  if (!m) throw notFound('Messaggio non trovato');
  const d = parse(z.object({ account_id: optInt.optional(), crea_prospect: z.object({ nome: z.string().trim().min(2).max(200), city: optStr(120).optional() }).optional(), aggiungi_referente: z.boolean().optional() }), req.body);
  let accountId = d.account_id;
  if (!accountId && d.crea_prospect) {
    richiediLinea(req, m.linea);
    const row = await one(`INSERT INTO public.organizations (kind, name, city, email, notes) VALUES ('CLIENTE',$1,$2,$3,$4) RETURNING *`, [d.crea_prospect.nome, d.crea_prospect.city || null, m.from_email, 'Creata dal Business Hub da un\'email in arrivo (prospect)']);
    indexOrg(row).catch(() => {});
    accountId = (await one(`INSERT INTO accounts (organization_id, linea, prospect, created_by) VALUES ($1,$2,TRUE,$3) RETURNING id`, [row.id, m.linea, req.user.id])).id;
    await addActivity(accountId, { tipo: 'SISTEMA', oggetto: 'Prospect creato da un\'email in arrivo', testo: `Casella ${m.casella}` }, req.user.id);
  }
  if (!accountId) throw bad('Scegli l\'account o crea il prospect');
  const a = await loadAccount(accountId);
  richiediLinea(req, a.linea);
  const actId = await assegnaEmail(m.id, a.id, req.user.id);
  if (d.aggiungi_referente && m.from_email && !(await one('SELECT 1 FROM contatti WHERE account_id=$1 AND lower(email)=lower($2)', [a.id, m.from_email]))) {
    await q(`INSERT INTO contatti (account_id, nome, email, fonte, note) VALUES ($1,$2,$3,'EMAIL',$4)`, [a.id, m.from_name || m.from_email, m.from_email.toLowerCase(), 'Aggiunto dall\'assegnazione di un\'email in arrivo']);
  }
  await audit(req, 'HUB_EMAIL_ASSEGNATA', 'account', a.id, { email_in: m.id });
  res.json({ ok: true, account_id: a.id, activity_id: actId });
}));
r.post('/email/:id/ignora', ah(async (req, res) => {
  if (!['ADMIN', 'SERVICE', 'RETAIL', 'MDL'].includes(req.user.role)) throw forbidden();
  await q(`UPDATE email_in SET stato='IGNORATO', assegnato_by=$2 WHERE id=$1 AND stato='DA_ASSEGNARE'`, [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

// ---------------- Cruscotto ----------------
r.get('/cruscotto', ah(async (req, res) => {
  const linea = LINEE_KEYS.includes(req.query.linea) ? req.query.linea : null;
  const { stallo, ordini } = await soglie();
  const oggi = todayRome();
  const acc = await many(`SELECT a.id, a.organization_id, o.name AS org_name, a.linea, a.fase_corrente, a.phase_dates, a.fatturato_fy_atteso, a.cliente_attivo, a.prospect, a.priorita,
      a.prossima_azione, a.data_prossima_azione, a.owner_user_id, uo.full_name AS owner_name
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN public.users uo ON uo.id=a.owner_user_id WHERE ($1::text IS NULL OR a.linea=$1)`, [linea]);
  const funnel = FASI.map((f) => { const l = acc.filter((a) => a.fase_corrente === f.n); return { fase: f.n, label: f.label, n: l.length, fatturato: Math.round(l.reduce((s, a) => s + Number(a.fatturato_fy_atteso || 0), 0)) }; });
  const stalli = acc.map((a) => arricchisci(a, stallo, oggi)).filter((a) => a.stallo).sort((x, y) => y.giorni_da_avanzamento - x.giorni_da_avanzamento);
  const prossime = acc.filter((a) => a.data_prossima_azione && String(a.data_prossima_azione) <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
    .sort((x, y) => String(x.data_prossima_azione).localeCompare(String(y.data_prossima_azione))).map((a) => ({ ...a, scaduta: String(a.data_prossima_azione) < oggi }));
  const attivita = await many(`SELECT x.id, x.account_id, x.tipo, x.at, x.oggetto, x.esito, x.email_stato, o.name AS org_name, a.linea, u.full_name AS user_name
    FROM activities x JOIN accounts a ON a.id=x.account_id JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN users u ON u.id=x.user_id
    WHERE x.at >= now() - interval '7 days' AND NOT (x.tipo='SISTEMA' AND x.dati ? 'import_key') AND ($1::text IS NULL OR a.linea=$1) ORDER BY x.at DESC LIMIT 60`, [linea]);
  const criticita = await many(`SELECT k.id, k.account_id, k.origine, k.gravita, k.titolo, k.descrizione, k.aperta_at, o.name AS org_name, a.linea FROM criticita k JOIN accounts a ON a.id=k.account_id
    JOIN public.organizations o ON o.id=a.organization_id WHERE k.chiusa_at IS NULL AND ($1::text IS NULL OR a.linea=$1) ORDER BY CASE k.gravita WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END, k.aperta_at`, [linea]);
  const attivi = acc.filter((a) => a.cliente_attivo);
  const feed = await contatoriFeed(attivi.map((a) => a.organization_id), ordini);
  const nomeOrg = (id) => { const a = attivi.find((x) => x.organization_id === Number(id)); return a ? { id: a.id, org_name: a.org_name } : null; };
  const da_confermare = await many(`SELECT DISTINCT ON (a.id) a.id, o.name AS org_name, a.linea, x.oggetto, x.testo FROM activities x JOIN accounts a ON a.id=x.account_id JOIN public.organizations o ON o.id=a.organization_id
    WHERE x.esito='DA_CONFERMARE' AND NOT a.cliente_attivo AND ($1::text IS NULL OR a.linea=$1) ORDER BY a.id, x.at DESC`, [linea]);
  const email = await many(`SELECT id, linea, received_at, from_email, from_name, subject, come FROM email_in WHERE stato='DA_ASSEGNARE' AND ($1::text IS NULL OR linea=$1) ORDER BY received_at DESC LIMIT 20`, [linea]);
  const nEmail = (await one(`SELECT count(*)::int AS n FROM email_in WHERE stato='DA_ASSEGNARE' AND ($1::text IS NULL OR linea=$1)`, [linea])).n;
  const pipe = acc.filter((a) => a.fase_corrente >= 1 && a.fase_corrente <= 6);
  // Punti Prelievo: avvii con passi da completare (con "Riprova") e flagship con l'autorizzazione rilasciata ancora da avviare
  const pp = !linea || linea === 'PP' ? await (await import('../lib/puntoPrelievi.js')).promemoriaPP() : null;
  res.json({
    pp,
    linea, soglia_stallo: stallo, soglia_ordini: ordini,
    kpi: { account: acc.length, prospect: acc.filter((a) => a.fase_corrente === 0).length, in_pipeline: pipe.length, attivi: attivi.length, fatturato_pipeline: Math.round(pipe.reduce((s, a) => s + Number(a.fatturato_fy_atteso || 0), 0)),
      fatturato_attivi: Math.round(attivi.reduce((s, a) => s + Number(a.fatturato_fy_atteso || 0), 0)), stalli: stalli.length, criticita: criticita.length, email_da_assegnare: nEmail, da_confermare: da_confermare.length },
    funnel, stalli: stalli.slice(0, 30), prossime: prossime.slice(0, 30), attivita, criticita,
    nc: { attivo: feed.nc.attivo, righe: feed.nc.aperte.map((n) => ({ ...n, account: nomeOrg(n.organization_id) })) },
    ordini: { attivo: feed.ordini.attivo, soglia_giorni: ordini, righe: feed.ordini.in_attesa.map((o) => ({ ...o, account: nomeOrg(o.organization_id), oltre_soglia: o.giorni > ordini })) },
    da_confermare, email,
  });
}));

export default r;
