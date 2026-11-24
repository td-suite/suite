// Recupero Crediti · API. Ogni scrittura passa da un controllo di profilo (lib/access.js) e lascia traccia nel registro del modulo
// (audit_log), nel registro della Suite e, quando riguarda un cliente, nel suo registro dei contatti (eventi).
import { Router } from 'express';
import multer from 'multer';
import { ah, HttpError, bad, forbidden, notFound, audit as auditSuite } from '../../../lib/util.js';
import { statoBanca, bancaAggiornata } from '../../../lib/banca.js';
import { graphConfigured, provaCasella } from '../../../lib/graphInbox.js';
import { mailStatus } from '../../../lib/mailer.js';
import { aiEnabled } from '../../../lib/claude.js';
import { one, many, q, tx } from '../db.js';
import { KEY } from '../config.js';
import { soloDirezione, soloOperativi, soloVistaCompleta, clientiVisibili, puoVedereCliente } from '../lib/access.js';
import { impostazioni, salvaImpostazione, evento, audit, oggiRoma, CHIAVI_MODELLO } from '../lib/impostazioni.js';
import { PREDEFINITE, FASI, FASE_LABEL, FASCE, piuLavorativi } from '../lib/regole.js';
import { MODELLI, componi, itData, eur } from '../lib/testi.js';
import { posizioni, fattureAperte, indicatori, destinatari, sincronizzaSynclab, importaPartitario, registraIncasso, applicaNotaCredito, ricalcolaScadenze, listaEmail, hub, r2 } from '../lib/fatture.js';
import { elencoMovimenti, contaMovimenti, applica, rifiuta, ignora, annulla, esaminaMovimenti } from '../lib/riconcilia.js';
import { giro, approva, proponiLegale } from '../lib/motore.js';
import { leggiCasella, riclassifica } from '../lib/casella.js';

const r = Router();
const carica = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('Identificativo non valido'); return n; };
const data = (v, nome = 'Data') => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw bad(`${nome} non valida`); return String(v); };
const traccia = async (req, azione, label, { entity = null, entityId = null, dati = null } = {}) => { await audit(req, azione, { entity, entityId, label, data: dati }); await auditSuite(req, `CREDITI_${azione}`, { module: KEY, entity, entityId, label, data: dati }).catch(() => 0); };
const vedeCliente = async (req, orgId) => { if (!(await puoVedereCliente(req, orgId))) throw forbidden('Cliente fuori dal tuo perimetro'); };

// ---------------------------------------------------------------- cruscotto e contatori
async function contatori(req) {
  const mov = req.cred.tutto ? await contaMovimenti() : { proposti: 0, da_abbinare: 0 };
  const k = await one(`SELECT
      (SELECT count(*)::int FROM comunicazioni WHERE stato = 'DA_APPROVARE') AS da_approvare,
      (SELECT count(*)::int FROM comunicazioni WHERE stato = 'DA_APPROVARE' AND fase = 3) AS da_firmare,
      (SELECT count(*)::int FROM comunicazioni WHERE pec_stato = 'DA_INVIARE') AS pec,
      (SELECT count(*)::int FROM risposte WHERE stato = 'DA_GESTIRE') AS risposte,
      (SELECT count(*)::int FROM attivita WHERE stato = 'APERTA' AND ($1::int IS NULL OR assegnata_user_id = $1)) AS chiamate,
      (SELECT count(*)::int FROM pratiche_legali WHERE stato = 'PROPOSTA') AS legale_proposte,
      (SELECT count(*)::int FROM pratiche_legali WHERE stato = 'AUTORIZZATA') AS legale_da_trasmettere,
      (SELECT count(*)::int FROM promesse WHERE stato = 'DA_APPROVARE') AS piani`, [req.cred.commerciale ? req.user.id : null]);
  // v_*: voci di menu da mostrare (la barra laterale della Suite mostra una voce con flag solo se il valore è maggiore di zero)
  if (req.cred.commerciale) return { chiamate: k.chiamate, v_clienti: 1, v_chiamate: 1 };
  if (req.cred.legale) return { legale: k.legale_da_trasmettere, v_legale: 1 };
  return { v_tutto: 1, v_clienti: 1, v_chiamate: 1, v_legale: 1, v_banca: req.cred.opera ? 1 : 0, da_approvare: k.da_approvare, da_firmare: k.da_firmare, pec: k.pec, risposte: k.risposte, riconciliazione: mov.proposti + mov.da_abbinare, chiamate: k.chiamate, legale: req.cred.dirige ? k.legale_proposte : k.legale_da_trasmettere, piani: k.piani };
}
r.get('/badges', ah(async (req, res) => res.json(await contatori(req))));
r.get('/cruscotto', soloVistaCompleta, ah(async (req, res) => {
  const imp = await impostazioni();
  const [ind, banca, ultimo, pos] = await Promise.all([indicatori(), bancaAggiornata(imp.ore_banca_fresca), one('SELECT at, esito FROM giri ORDER BY id DESC LIMIT 1'), posizioni({ tolleranza: imp.tolleranza_promessa })]);
  const stati = {}; for (const p of pos) stati[p.stato] = (stati[p.stato] || 0) + 1;
  res.json({ modalita: imp.modalita, indicatori: ind, fasce: FASCE, banca, ultimo_giro: ultimo, contatori: await contatori(req), stati, maggiori: pos.filter((p) => p.scaduto > 0).slice(0, 8),
    scala: FASI.map((f) => ({ n: f.n, label: f.label, giorni: f.n === 1 ? -imp.giorni_avviso : imp[f.giorni_key] })), giorni_invio: imp.giorni_invio, ora_invio: [imp.ora_invio_da, imp.ora_invio_a] });
}));

// ---------------------------------------------------------------- posizioni e scheda del cliente
r.get('/posizioni', ah(async (req, res) => {
  const imp = await impostazioni(); const vis = await clientiVisibili(req);
  res.json({ righe: vis && !vis.length ? [] : await posizioni({ orgIds: vis, tolleranza: imp.tolleranza_promessa }) });
}));
r.get('/clienti/:id', ah(async (req, res) => {
  const orgId = id(req.params.id); await vedeCliente(req, orgId);
  const imp = await impostazioni(); const oggi = oggiRoma();
  const org = await one(`SELECT o.id, o.name, o.code, o.vat_number, o.email, o.pec, o.city, o.kind, c.escluso, c.esclusione_motivo, c.esclusione_fino::text AS esclusione_fino, c.esclusa_at, ue.full_name AS esclusa_da_nome,
        c.email_solleciti, c.pec AS pec_crediti, c.termini, c.referente_user_id, c.sospeso_fino::text AS sospeso_fino, c.sospeso_motivo, c.note
      FROM public.organizations o LEFT JOIN clienti c ON c.organization_id = o.id LEFT JOIN public.users ue ON ue.id = c.esclusa_da WHERE o.id = $1`, [orgId]);
  if (!org) throw notFound('Cliente non trovato');
  const h = await hub();
  const [pos, dest, fatture, comunicazioni, risposte, promesse, chiamate, attivita, pratiche, eventi, esclusioni] = await Promise.all([
    posizioni({ orgIds: [orgId], tolleranza: imp.tolleranza_promessa }), destinatari(orgId),
    many(`SELECT f.id, f.fonte, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, f.scadenza_origine, f.importo, f.incassato, (f.importo - f.incassato) AS residuo, f.stato, f.fase, f.fase_at, f.contestata, f.contestazione_nota, f.nota, ($2::date - f.scadenza)::int AS giorni, f.chiusa_origine, f.chiusa_at
            FROM fatture f WHERE f.organization_id = $1 AND f.stato <> 'ANNULLATA' ORDER BY (f.stato IN ('APERTA','PARZIALE')) DESC, f.scadenza DESC LIMIT 400`, [orgId, oggi]),
    many(`SELECT k.id, k.fase, k.stato, k.motivo_attesa, k.destinatari, k.oggetto, k.totale, k.creata_at, k.inviata_at, k.simulata, k.pec_stato, k.rif, u.full_name AS approvata_da FROM comunicazioni k LEFT JOIN public.users u ON u.id = k.approvata_da WHERE k.organization_id = $1 ORDER BY k.id DESC LIMIT 60`, [orgId]),
    many(`SELECT id, ricevuta_at, da_email, da_nome, oggetto, classe, sintesi, effetto, stato FROM risposte WHERE organization_id = $1 ORDER BY ricevuta_at DESC LIMIT 40`, [orgId]),
    many(`SELECT p.id, p.data::text AS data, p.importo, p.origine, p.piano, p.rate, p.stato, p.nota, p.created_at, u.full_name AS approvata_da FROM promesse p LEFT JOIN public.users u ON u.id = p.approvata_da WHERE p.organization_id = $1 ORDER BY p.id DESC LIMIT 30`, [orgId]),
    many(`SELECT c.id, c.data::text AS data, c.interlocutore, c.esito, c.impegno_data::text AS impegno_data, c.impegno_importo, c.prossima_azione, c.nota, u.full_name AS utente FROM chiamate c LEFT JOIN public.users u ON u.id = c.user_id WHERE c.organization_id = $1 ORDER BY c.id DESC LIMIT 30`, [orgId]),
    many(`SELECT a.id, a.stato, a.entro::text AS entro, a.totale, a.simulata, a.creata_at, u.full_name AS assegnata_a FROM attivita a LEFT JOIN public.users u ON u.id = a.assegnata_user_id WHERE a.organization_id = $1 ORDER BY a.id DESC LIMIT 20`, [orgId]),
    many(`SELECT id, stato, motivo, totale, serve_dir, simulata, creata_at, raf_at, dir_at, trasmessa_at, chiusa_at, esito FROM pratiche_legali WHERE organization_id = $1 ORDER BY id DESC LIMIT 10`, [orgId]),
    many(`SELECT e.id, e.at, e.tipo, e.testo, u.full_name AS utente FROM eventi e LEFT JOIN public.users u ON u.id = e.user_id WHERE e.organization_id = $1 ORDER BY e.id DESC LIMIT 150`, [orgId]),
    many(`SELECT l.id, l.azione, l.motivo, l.fino::text AS fino, l.at, u.full_name AS utente FROM esclusioni_log l LEFT JOIN public.users u ON u.id = l.user_id WHERE l.organization_id = $1 ORDER BY l.id DESC LIMIT 30`, [orgId]),
  ]);
  const account = h.accounts ? await one(`SELECT a.id, a.linea, a.cliente_attivo FROM business.accounts a WHERE a.organization_id = $1 ORDER BY a.cliente_attivo DESC, a.updated_at DESC LIMIT 1`, [orgId]) : null;
  const terminiHub = h.org_ext ? (await one(`SELECT btrim(concat_ws(' ', pay_method, pay_terms)) AS t FROM business.org_ext WHERE org_id = $1`, [orgId]))?.t || null : null;
  res.json({ cliente: { ...org, escluso: Boolean(org.escluso) && (!org.esclusione_fino || org.esclusione_fino >= oggi) }, posizione: pos[0] || null, destinatari: dest, account, termini_hub: terminiHub, termini_predefiniti: imp.termini_predefiniti,
    fatture: fatture.map((f) => ({ ...f, importo: r2(f.importo), incassato: r2(f.incassato), residuo: r2(f.residuo), fase_label: FASE_LABEL[f.fase] || null })), comunicazioni, risposte, promesse, chiamate, attivita, pratiche, eventi, esclusioni,
    puoi: { dirigere: req.cred.dirige, operare: req.cred.opera, chiamare: req.cred.opera || req.cred.commerciale } });
}));
r.put('/clienti/:id', soloOperativi, ah(async (req, res) => {
  const orgId = id(req.params.id); const b = req.body || {};
  if (!(await one('SELECT 1 FROM public.organizations WHERE id = $1', [orgId]))) throw notFound('Cliente non trovato');
  const email = b.email_solleciti == null ? null : listaEmail(b.email_solleciti).join(', ');
  if (b.email_solleciti && String(b.email_solleciti).trim() && !email) throw bad('Indirizzi dei destinatari non validi');
  const pec = String(b.pec || '').trim().toLowerCase() || null; if (pec && !listaEmail(pec).length) throw bad('PEC non valida');
  const ref = b.referente_user_id ? id(b.referente_user_id) : null;
  if (ref && !(await one(`SELECT 1 FROM public.users WHERE id = $1 AND status = 'ACTIVE'`, [ref]))) throw bad('Referente commerciale non trovato fra gli utenti attivi');
  const sosp = b.sospeso_fino ? data(b.sospeso_fino, 'Data di fine sospensione') : null;
  if (sosp && !String(b.sospeso_motivo || '').trim()) throw bad('Scrivi il motivo della sospensione');
  const prima = await one('SELECT * FROM clienti WHERE organization_id = $1', [orgId]);
  await q(`INSERT INTO clienti (organization_id, email_solleciti, pec, termini, referente_user_id, sospeso_fino, sospeso_motivo, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id) DO UPDATE SET email_solleciti = EXCLUDED.email_solleciti, pec = EXCLUDED.pec, termini = EXCLUDED.termini, referente_user_id = EXCLUDED.referente_user_id, sospeso_fino = EXCLUDED.sospeso_fino, sospeso_motivo = EXCLUDED.sospeso_motivo, note = EXCLUDED.note, updated_at = now()`,
    [orgId, email || null, pec, String(b.termini || '').trim() || null, ref, sosp, sosp ? String(b.sospeso_motivo).trim().slice(0, 300) : null, String(b.note || '').trim().slice(0, 2000) || null]);
  if (sosp && sosp !== (prima?.sospeso_fino ? oggiRoma(new Date(prima.sospeso_fino)) : null)) await evento(orgId, 'SOSPENSIONE', `Scala sospesa fino al ${itData(sosp)}: ${String(b.sospeso_motivo).trim()}`, { userId: req.user.id });
  if (!sosp && prima?.sospeso_fino) await evento(orgId, 'SOSPENSIONE', 'Sospensione della scala tolta', { userId: req.user.id });
  const ricalcolate = String(b.termini || '').trim() !== String(prima?.termini || '').trim() ? await ricalcolaScadenze(orgId, await impostazioni()) : 0;
  if (ricalcolate) await evento(orgId, 'SCADENZA', `Termini di pagamento aggiornati: ${ricalcolate} ${ricalcolate === 1 ? 'scadenza ricalcolata' : 'scadenze ricalcolate'}`, { userId: req.user.id });
  await traccia(req, 'CLIENTE_SCHEDA', 'Scheda crediti del cliente aggiornata', { entity: 'clienti', entityId: orgId });
  res.json({ ok: true });
}));
// Esclusione dai solleciti: decisione riservata a CEO e CFO (basta uno dei due), con motivo obbligatorio ed eventuale data di fine
r.post('/clienti/:id/esclusione', soloDirezione, ah(async (req, res) => {
  const orgId = id(req.params.id); const b = req.body || {}; const oggi = oggiRoma();
  const org = await one('SELECT name FROM public.organizations WHERE id = $1', [orgId]);
  if (!org) throw notFound('Cliente non trovato');
  if (b.escluso) {
    const motivo = String(b.motivo || '').trim();
    if (motivo.length < 5) throw bad('Il motivo dell\'esclusione è obbligatorio');
    const fino = b.fino ? data(b.fino, 'Data di fine') : null;
    if (fino && fino < oggi) throw bad('La data di fine dell\'esclusione è già passata');
    await tx(async (c) => {
      await c.query(`INSERT INTO clienti (organization_id, escluso, esclusione_motivo, esclusione_fino, esclusa_da, esclusa_at) VALUES ($1,TRUE,$2,$3,$4,now())
         ON CONFLICT (organization_id) DO UPDATE SET escluso = TRUE, esclusione_motivo = EXCLUDED.esclusione_motivo, esclusione_fino = EXCLUDED.esclusione_fino, esclusa_da = EXCLUDED.esclusa_da, esclusa_at = now(), updated_at = now()`, [orgId, motivo.slice(0, 500), fino, req.user.id]);
      await c.query(`INSERT INTO esclusioni_log (organization_id, azione, motivo, fino, user_id) VALUES ($1,'ESCLUSO',$2,$3,$4)`, [orgId, motivo.slice(0, 500), fino, req.user.id]);
      await c.query(`UPDATE comunicazioni SET stato = 'ANNULLATA', motivo_attesa = 'Annullata: cliente escluso dai solleciti' WHERE organization_id = $1 AND stato IN ('DA_APPROVARE','IN_CODA')`, [orgId]);
      await evento(orgId, 'ESCLUSO', `Cliente escluso dai solleciti ${fino ? `fino al ${itData(fino)}` : 'fino a revoca'} (${req.cred.ruolo}): ${motivo}`, { userId: req.user.id }, c);
    });
    await traccia(req, 'ESCLUSIONE', `${org.name}: escluso dai solleciti`, { entity: 'clienti', entityId: orgId, dati: { fino, ruolo: req.cred.ruolo } });
  } else {
    const era = await one('SELECT escluso FROM clienti WHERE organization_id = $1', [orgId]);
    if (!era?.escluso) throw bad('Il cliente non è escluso');
    await tx(async (c) => {
      await c.query('UPDATE clienti SET escluso = FALSE, updated_at = now() WHERE organization_id = $1', [orgId]);
      await c.query(`INSERT INTO esclusioni_log (organization_id, azione, motivo, user_id) VALUES ($1,'RIAMMESSO',$2,$3)`, [orgId, String(b.motivo || '').trim().slice(0, 500) || null, req.user.id]);
      await evento(orgId, 'RIAMMESSO', `Cliente riammesso ai solleciti (${req.cred.ruolo})${b.motivo ? `: ${String(b.motivo).trim()}` : ''}`, { userId: req.user.id }, c);
    });
    await traccia(req, 'RIAMMISSIONE', `${org.name}: riammesso ai solleciti`, { entity: 'clienti', entityId: orgId });
  }
  res.json({ ok: true });
}));
r.get('/esclusioni', soloVistaCompleta, ah(async (_req, res) => {
  const oggi = oggiRoma();
  res.json({ attive: await many(`SELECT c.organization_id, o.name AS cliente, c.esclusione_motivo AS motivo, c.esclusione_fino::text AS fino, c.esclusa_at, u.full_name AS utente,
        (SELECT coalesce(sum(f.importo - f.incassato), 0) FROM fatture f WHERE f.organization_id = c.organization_id AND f.stato IN ('APERTA','PARZIALE') AND f.scadenza < $1::date) AS scaduto
      FROM clienti c JOIN public.organizations o ON o.id = c.organization_id LEFT JOIN public.users u ON u.id = c.esclusa_da WHERE c.escluso AND (c.esclusione_fino IS NULL OR c.esclusione_fino >= $1::date) ORDER BY o.name`, [oggi]),
    registro: await many(`SELECT l.id, l.organization_id, o.name AS cliente, l.azione, l.motivo, l.fino::text AS fino, l.at, u.full_name AS utente FROM esclusioni_log l JOIN public.organizations o ON o.id = l.organization_id LEFT JOIN public.users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200`) });
}));
r.get('/organizzazioni', soloOperativi, ah(async (req, res) => {
  const c = String(req.query.cerca || '').trim(); if (c.length < 2) return res.json({ righe: [] });
  res.json({ righe: await many(`SELECT id, name, kind, vat_number, city FROM public.organizations WHERE active AND kind NOT IN ('GRUPPO','SOCIETA') AND (name ILIKE '%' || $1 || '%' OR regexp_replace(coalesce(vat_number, ''), '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') AND $1 ~ '[0-9]{8}') ORDER BY (kind = 'CLIENTE') DESC, name LIMIT 15`, [c]) });
}));
r.get('/utenti', soloOperativi, ah(async (_req, res) => res.json({ righe: await many(`SELECT id, full_name FROM public.users WHERE status = 'ACTIVE' AND organization_id IS NULL ORDER BY full_name`).catch(() => many(`SELECT id, full_name FROM public.users WHERE status = 'ACTIVE' ORDER BY full_name`)) })));

// ---------------------------------------------------------------- fatture
r.get('/fatture', soloVistaCompleta, ah(async (req, res) => {
  const oggi = oggiRoma(); const stato = String(req.query.stato || 'APERTE'); const cerca = String(req.query.cerca || '').trim();
  const cond = stato === 'APERTE' ? `f.stato IN ('APERTA','PARZIALE')` : stato === 'SCADUTE' ? `f.stato IN ('APERTA','PARZIALE') AND f.scadenza < $1::date` : stato === 'SENZA_CLIENTE' ? `f.organization_id IS NULL AND f.stato <> 'ANNULLATA'` : stato === 'CONTESTATE' ? `f.contestata AND f.stato IN ('APERTA','PARZIALE')` : stato === 'NOTE' ? `f.stato = 'NOTA_CREDITO'` : stato === 'PAGATE' ? `f.stato = 'PAGATA'` : `f.stato <> 'ANNULLATA'`;
  const righe = await many(`SELECT f.id, f.fonte, f.organization_id, coalesce(o.name, f.cliente_nome) AS cliente, f.cliente_piva, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, f.scadenza_origine, f.importo, f.incassato, (f.importo - f.incassato) AS residuo, f.stato, f.fase, f.contestata, ($1::date - f.scadenza)::int AS giorni, f.nota
      FROM fatture f LEFT JOIN public.organizations o ON o.id = f.organization_id WHERE ${cond} AND ($2 = '' OR f.numero ILIKE '%' || $2 || '%' OR coalesce(o.name, f.cliente_nome) ILIKE '%' || $2 || '%') ORDER BY f.scadenza DESC, f.id DESC LIMIT 800`, [oggi, cerca]);
  res.json({ righe: righe.map((f) => ({ ...f, importo: r2(f.importo), incassato: r2(f.incassato), residuo: r2(f.residuo), fase_label: FASE_LABEL[f.fase] || null })), importazioni: await many(`SELECT i.id, i.filename, i.righe, i.nuove, i.aggiornate, i.chiuse, i.non_abbinate, i.completo, i.at, u.full_name AS utente FROM importazioni i LEFT JOIN public.users u ON u.id = i.user_id ORDER BY i.id DESC LIMIT 10`) });
}));
r.post('/fatture', soloOperativi, ah(async (req, res) => {
  const b = req.body || {}; const orgId = id(b.organization_id); const numero = String(b.numero || '').trim();
  const importo = r2(b.importo); if (!numero || !(importo > 0)) throw bad('Numero e importo sono obbligatori');
  const d = data(b.data, 'Data della fattura'), s = data(b.scadenza, 'Scadenza');
  if (s < d) throw bad('La scadenza precede la data della fattura');
  await q('INSERT INTO clienti (organization_id) VALUES ($1) ON CONFLICT DO NOTHING', [orgId]);
  const f = await one(`INSERT INTO fatture (fonte, fonte_id, organization_id, numero, data, scadenza, scadenza_origine, importo, nota) VALUES ('MANUALE',$1,$2,$3,$4,$5,'MANUALE',$6,$7) ON CONFLICT (fonte, fonte_id) DO NOTHING RETURNING id`,
    [`${orgId}:${numero}:${d.slice(0, 4)}`, orgId, numero, d, s, importo, String(b.nota || '').trim().slice(0, 500) || null]);
  if (!f) throw bad('Esiste già una fattura inserita a mano con questo numero per il cliente');
  await evento(orgId, 'FATTURA', `Fattura n. ${numero} inserita a mano: € ${eur(importo)}, scadenza ${itData(s)}`, { userId: req.user.id });
  await traccia(req, 'FATTURA_MANUALE', `Fattura n. ${numero}`, { entity: 'fatture', entityId: f.id });
  res.json({ id: f.id });
}));
r.put('/fatture/:id', soloOperativi, ah(async (req, res) => {
  const f = await one('SELECT * FROM fatture WHERE id = $1', [id(req.params.id)]); const b = req.body || {};
  if (!f) throw notFound('Fattura non trovata');
  if (b.organization_id !== undefined) {
    const org = id(b.organization_id);
    if (f.organization_id) throw bad('La fattura ha già un cliente');
    await q('INSERT INTO clienti (organization_id) VALUES ($1) ON CONFLICT DO NOTHING', [org]);
    // stesso cliente del file (stessa partita IVA o stesso nome): si abbinano insieme
    const n = (await q(`UPDATE fatture SET organization_id = $1, updated_at = now() WHERE organization_id IS NULL AND ((coalesce($2, '') <> '' AND cliente_piva = $2) OR (coalesce($2, '') = '' AND cliente_nome = $3))`, [org, f.cliente_piva, f.cliente_nome])).rowCount;
    await traccia(req, 'FATTURA_CLIENTE', `${n} fatture del partitario abbinate al cliente`, { entity: 'fatture', entityId: f.id, dati: { organization_id: org } });
    return res.json({ abbinate: n });
  }
  if (b.scadenza !== undefined) {
    const s = data(b.scadenza, 'Scadenza'); if (s < oggiRoma(new Date(f.data))) throw bad('La scadenza precede la data della fattura');
    if (!String(b.motivo || '').trim()) throw bad('Scrivi il motivo della modifica della scadenza');
    await q(`UPDATE fatture SET scadenza = $2, scadenza_origine = 'MANUALE', updated_at = now() WHERE id = $1`, [f.id, s]);
    if (f.organization_id) await evento(f.organization_id, 'SCADENZA', `Scadenza della fattura n. ${f.numero} portata al ${itData(s)}: ${String(b.motivo).trim()}`, { userId: req.user.id });
    await traccia(req, 'FATTURA_SCADENZA', `Fattura n. ${f.numero}: scadenza ${s}`, { entity: 'fatture', entityId: f.id });
  }
  if (b.nota !== undefined) await q('UPDATE fatture SET nota = $2, updated_at = now() WHERE id = $1', [f.id, String(b.nota || '').trim().slice(0, 500) || null]);
  res.json({ ok: true });
}));
r.post('/fatture/:id/incasso', soloOperativi, ah(async (req, res) => {
  const b = req.body || {}; const f = await one('SELECT id, numero, organization_id FROM fatture WHERE id = $1', [id(req.params.id)]);
  if (!f) throw notFound('Fattura non trovata');
  const d = data(b.data, 'Data dell\'incasso'); if (d > oggiRoma()) throw bad('La data dell\'incasso è nel futuro');
  const out = await registraIncasso(f.id, { importo: b.importo, data: d, origine: 'MANUALE', motivo: String(b.nota || '').trim().slice(0, 300) || 'Registrato a mano', userId: req.user.id });
  if (f.organization_id) await evento(f.organization_id, 'INCASSO', `Incasso di € ${eur(out.importo)} del ${itData(d)} registrato a mano sulla fattura n. ${f.numero}${out.saldata ? ' (saldata)' : ''}`, { userId: req.user.id });
  await traccia(req, 'INCASSO_MANUALE', `Fattura n. ${f.numero}: € ${out.importo}`, { entity: 'fatture', entityId: f.id });
  res.json({ ok: true, saldata: out.saldata });
}));
r.post('/fatture/:id/contestazione', soloOperativi, ah(async (req, res) => {
  const b = req.body || {}; const f = await one('SELECT * FROM fatture WHERE id = $1', [id(req.params.id)]);
  if (!f) throw notFound('Fattura non trovata');
  const nota = String(b.nota || '').trim(); if (nota.length < 3) throw bad(b.aperta ? 'Descrivi la contestazione' : 'Scrivi come si è chiusa la contestazione');
  if (b.aperta) await q(`UPDATE fatture SET contestata = TRUE, contestata_at = now(), contestazione_nota = $2, contestazione_chiusa_at = NULL, updated_at = now() WHERE id = $1`, [f.id, nota.slice(0, 500)]);
  else await q(`UPDATE fatture SET contestata = FALSE, contestazione_chiusa_at = now(), contestazione_nota = $2, updated_at = now() WHERE id = $1`, [f.id, `Chiusa: ${nota}`.slice(0, 500)]);
  if (f.organization_id) await evento(f.organization_id, 'CONTESTAZIONE', b.aperta ? `Fattura n. ${f.numero} contestata: ${nota}. Esce dalla scala di sollecito.` : `Contestazione sulla fattura n. ${f.numero} chiusa: ${nota}. La fattura rientra nella scala.`, { userId: req.user.id });
  await traccia(req, b.aperta ? 'CONTESTAZIONE_APERTA' : 'CONTESTAZIONE_CHIUSA', `Fattura n. ${f.numero}`, { entity: 'fatture', entityId: f.id });
  res.json({ ok: true });
}));
r.post('/note-credito/:id/applica', soloOperativi, ah(async (req, res) => {
  const out = await applicaNotaCredito(id(req.params.id), id(req.body?.fattura_id), req.user.id);
  await traccia(req, 'NOTA_CREDITO', `Nota di credito applicata: € ${out.importo}`, { entity: 'fatture', entityId: req.params.id });
  res.json(out);
}));
r.post('/fatture-sincronizza', soloOperativi, ah(async (req, res) => { const imp = await impostazioni(); const out = await sincronizzaSynclab(imp); await traccia(req, 'SYNCLAB', `Fatture da Synclab: ${out.nuovi} nuove, ${out.aggiornati} aggiornate`); res.json(out); }));
r.post('/fatture-importa', soloOperativi, carica.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const imp = await impostazioni(); const conferma = req.body?.conferma === 'true' || req.body?.conferma === true;
  const out = await importaPartitario(req.file.buffer, req.file.originalname, { completo: req.body?.completo === 'true' || req.body?.completo === true, anteprima: !conferma, userId: req.user.id }, imp);
  if (conferma) await traccia(req, 'PARTITARIO', `Partitario ${req.file.originalname}: ${out.nuove} nuove, ${out.aggiornate} aggiornate, ${out.chiuse} chiuse`, { dati: { righe: out.righe, completo: Boolean(req.body?.completo === 'true') } });
  res.json(out);
}));

// ---------------------------------------------------------------- comunicazioni
r.get('/comunicazioni', soloVistaCompleta, ah(async (req, res) => {
  const stato = String(req.query.stato || 'DA_APPROVARE');
  const cond = stato === 'DA_APPROVARE' ? `k.stato = 'DA_APPROVARE'` : stato === 'INVIATE' ? `k.stato IN ('INVIATA','REGISTRATA')` : stato === 'SIMULATE' ? `k.stato = 'SIMULATA'` : stato === 'PEC' ? `k.pec_stato = 'DA_INVIARE'` : stato === 'FALLITE' ? `k.stato = 'FALLITA'` : `k.stato = 'ANNULLATA'`;
  res.json({ righe: await many(`SELECT k.id, k.organization_id, o.name AS cliente, k.fase, k.stato, k.motivo_attesa, k.destinatari, k.cc, k.oggetto, k.totale, k.creata_at, k.inviata_at, k.simulata, k.automatica, k.pec_stato, k.pec_indirizzo, k.errore, u.full_name AS approvata_da,
        (SELECT count(*)::int FROM comunicazioni_fatture cf WHERE cf.comunicazione_id = k.id) AS fatture
      FROM comunicazioni k JOIN public.organizations o ON o.id = k.organization_id LEFT JOIN public.users u ON u.id = k.approvata_da WHERE ${cond} ORDER BY k.id DESC LIMIT 300`), puoi_firmare: req.cred.dirige, puoi_approvare: req.cred.opera });
}));
r.get('/comunicazioni/:id', ah(async (req, res) => {
  const k = await one(`SELECT k.*, o.name AS cliente FROM comunicazioni k JOIN public.organizations o ON o.id = k.organization_id WHERE k.id = $1`, [id(req.params.id)]);
  if (!k) throw notFound('Comunicazione non trovata');
  await vedeCliente(req, k.organization_id);
  const fatture = await many(`SELECT f.id, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, cf.residuo, f.stato, (f.importo - f.incassato) AS residuo_oggi FROM comunicazioni_fatture cf JOIN fatture f ON f.id = cf.fattura_id WHERE cf.comunicazione_id = $1 ORDER BY f.scadenza`, [k.id]);
  res.json({ ...k, fase_label: FASE_LABEL[k.fase], fatture });
}));
r.post('/comunicazioni/:id/approva', soloOperativi, ah(async (req, res) => {
  const k = await one('SELECT id, fase, organization_id FROM comunicazioni WHERE id = $1', [id(req.params.id)]);
  if (!k) throw notFound('Comunicazione non trovata');
  if (k.fase === 3 && !req.cred.dirige) throw forbidden('Il 2° sollecito porta la firma del Responsabile Amministrazione e Finanza: lo approvano il CFO o il CEO');
  const out = await approva(k.id, req.user, { destinatari: req.body?.destinatari ?? null, cc: req.body?.cc ?? null });
  await traccia(req, out.annullata ? 'COMUNICAZIONE_ANNULLATA' : 'COMUNICAZIONE_APPROVATA', `${FASE_LABEL[k.fase]}: ${out.annullata ? 'annullata, fatture non più aperte' : 'approvata e inviata'}`, { entity: 'comunicazioni', entityId: k.id });
  res.json(out);
}));
r.post('/comunicazioni/:id/annulla', soloOperativi, ah(async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim(); if (motivo.length < 3) throw bad('Scrivi il motivo dell\'annullamento');
  const k = await one(`UPDATE comunicazioni SET stato = 'ANNULLATA', motivo_attesa = $2 WHERE id = $1 AND stato IN ('DA_APPROVARE','FALLITA','SIMULATA') RETURNING id, organization_id, fase`, [id(req.params.id), `Annullata: ${motivo}`.slice(0, 500)]);
  if (!k) throw bad('La comunicazione non è annullabile');
  await evento(k.organization_id, 'ANNULLATA', `${FASE_LABEL[k.fase]} annullato: ${motivo}`, { userId: req.user.id });
  await traccia(req, 'COMUNICAZIONE_ANNULLATA', `${FASE_LABEL[k.fase]} annullato`, { entity: 'comunicazioni', entityId: k.id });
  res.json({ ok: true });
}));
// La PEC non parte dalla Suite: una persona la invia dalla casella PEC aziendale e qui registra di averlo fatto
r.post('/comunicazioni/:id/pec', soloOperativi, ah(async (req, res) => {
  const k = await one(`UPDATE comunicazioni SET pec_stato = 'INVIATA', pec_at = now(), pec_da = $2 WHERE id = $1 AND pec_stato = 'DA_INVIARE' RETURNING id, organization_id, pec_indirizzo`, [id(req.params.id), req.user.id]);
  if (!k) throw bad('Nessuna PEC da registrare per questa comunicazione');
  await evento(k.organization_id, 'PEC', `2° sollecito inviato anche via PEC a ${k.pec_indirizzo}`, { userId: req.user.id });
  await traccia(req, 'PEC', 'Invio PEC registrato', { entity: 'comunicazioni', entityId: k.id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- risposte dei clienti
r.get('/risposte', soloVistaCompleta, ah(async (req, res) => {
  const stato = req.query.stato === 'GESTITE' ? 'GESTITA' : 'DA_GESTIRE';
  res.json({ righe: await many(`SELECT r.id, r.ricevuta_at, r.da_email, r.da_nome, r.oggetto, r.anteprima, r.organization_id, o.name AS cliente, r.comunicazione_id, k.fase, r.abbinata_per, r.classe, r.confidenza, r.classificata_da, r.promessa_data::text AS promessa_data, r.promessa_importo, r.sintesi, r.effetto, r.allegati, r.stato, r.gestita_at, r.gestione_nota, u.full_name AS gestita_da
      FROM risposte r LEFT JOIN public.organizations o ON o.id = r.organization_id LEFT JOIN comunicazioni k ON k.id = r.comunicazione_id LEFT JOIN public.users u ON u.id = r.gestita_da WHERE r.stato = $1 ORDER BY r.ricevuta_at DESC LIMIT 200`, [stato]),
    casella: (await impostazioni()).casella });
}));
r.put('/risposte/:id', soloOperativi, ah(async (req, res) => {
  const b = req.body || {};
  if (b.classe === 'PROMESSA' && b.promessa_data) data(b.promessa_data, 'Data promessa');
  const out = await riclassifica(id(req.params.id), { classe: b.classe, promessa_data: b.promessa_data, promessa_importo: b.promessa_importo ? r2(b.promessa_importo) : null }, req.user.id);
  await traccia(req, 'RISPOSTA_CLASSE', `Risposta riletta come ${b.classe}`, { entity: 'risposte', entityId: req.params.id });
  res.json(out);
}));
r.post('/risposte/:id/gestita', soloOperativi, ah(async (req, res) => {
  const x = await one(`UPDATE risposte SET stato = 'GESTITA', gestita_da = $2, gestita_at = now(), gestione_nota = $3 WHERE id = $1 AND stato = 'DA_GESTIRE' RETURNING organization_id`, [id(req.params.id), req.user.id, String(req.body?.nota || '').trim().slice(0, 500) || null]);
  if (!x) throw bad('Risposta già gestita');
  if (x.organization_id) await evento(x.organization_id, 'RISPOSTA', `Risposta del cliente gestita${req.body?.nota ? `: ${String(req.body.nota).trim()}` : ''}`, { userId: req.user.id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- riconciliazione
r.get('/riconciliazione', soloVistaCompleta, ah(async (req, res) => {
  const stato = ['PROPOSTO', 'DA_ABBINARE', 'ABBINATO', 'IGNORATO'].includes(req.query.stato) ? req.query.stato : 'PROPOSTO';
  res.json({ righe: await elencoMovimenti({ stato }), conteggi: await contaMovimenti(), banca: await statoBanca() });
}));
r.get('/riconciliazione/fatture', soloVistaCompleta, ah(async (req, res) => {
  const cerca = String(req.query.cerca || '').trim().toLowerCase();
  const tutte = (await fattureAperte()).filter((f) => f.organization_id && f.residuo > 0);
  res.json({ righe: (cerca ? tutte.filter((f) => `${f.numero} ${f.org_nome}`.toLowerCase().includes(cerca)) : tutte).slice(0, 60).map((f) => ({ id: f.id, numero: f.numero, cliente: f.org_nome, organization_id: f.organization_id, data: f.data, scadenza: f.scadenza, residuo: f.residuo })) });
}));
r.post('/movimenti/:id/conferma', soloOperativi, ah(async (req, res) => {
  const mid = id(req.params.id);
  let righe = req.body?.righe;
  if (!Array.isArray(righe) || !righe.length) righe = (await many(`SELECT fattura_id, importo FROM incassi WHERE bank_transaction_id = $1 AND stato = 'PROPOSTO'`, [mid]));
  const out = await applica(mid, righe, { userId: req.user.id, motivo: Array.isArray(req.body?.righe) && req.body.righe.length ? 'Abbinato a mano' : 'Proposta confermata' });
  await traccia(req, 'INCASSO_BANCA', `Bonifico abbinato: € ${out.attribuito}`, { entity: 'bank_transactions', entityId: mid });
  res.json(out);
}));
r.post('/movimenti/:id/rifiuta', soloOperativi, ah(async (req, res) => { await rifiuta(id(req.params.id), req.user.id); await traccia(req, 'PROPOSTA_RIFIUTATA', 'Proposta di abbinamento rifiutata', { entity: 'bank_transactions', entityId: req.params.id }); res.json({ ok: true }); }));
r.post('/movimenti/:id/ignora', soloOperativi, ah(async (req, res) => { await ignora(id(req.params.id), req.body?.nota, req.user.id); await traccia(req, 'MOVIMENTO_IGNORATO', 'Movimento non riferito a fatture', { entity: 'bank_transactions', entityId: req.params.id }); res.json({ ok: true }); }));
r.post('/movimenti/:id/annulla', soloOperativi, ah(async (req, res) => { const out = await annulla(id(req.params.id), req.user.id); await traccia(req, 'ABBINAMENTO_ANNULLATO', 'Abbinamento annullato', { entity: 'bank_transactions', entityId: req.params.id }); res.json(out); }));
r.post('/riconciliazione/esegui', soloOperativi, ah(async (_req, res) => res.json(await esaminaMovimenti(await impostazioni()))));

// ---------------------------------------------------------------- chiamate del referente commerciale
r.get('/attivita', ah(async (req, res) => {
  if (!(req.cred.tutto || req.cred.commerciale)) throw forbidden('Sezione non prevista dal tuo profilo');
  const stato = req.query.stato === 'FATTE' ? 'FATTA' : 'APERTA';
  const righe = await many(`SELECT a.id, a.organization_id, o.name AS cliente, a.stato, a.entro::text AS entro, a.totale, a.simulata, a.creata_at, a.chiusa_at, a.fattura_ids, a.assegnata_user_id, u.full_name AS assegnata_a, (a.entro < $2::date AND a.stato = 'APERTA') AS in_ritardo
      FROM attivita a JOIN public.organizations o ON o.id = a.organization_id LEFT JOIN public.users u ON u.id = a.assegnata_user_id WHERE a.stato = $1 AND ($3::int IS NULL OR a.assegnata_user_id = $3) ORDER BY a.entro NULLS LAST, a.id LIMIT 200`, [stato, oggiRoma(), req.cred.commerciale ? req.user.id : null]);
  res.json({ righe, esiti: [['PAGAMENTO_PROMESSO', 'Pagamento promesso'], ['PIANO_RIENTRO', 'Piano di rientro'], ['CONTESTAZIONE', 'Contestazione'], ['NESSUN_RISCONTRO', 'Nessun riscontro']] });
}));
r.post('/chiamate', ah(async (req, res) => {
  const b = req.body || {}; const orgId = id(b.organization_id); const oggi = oggiRoma();
  if (!(req.cred.opera || req.cred.commerciale)) throw forbidden('Operazione non prevista dal tuo profilo');
  await vedeCliente(req, orgId);
  const esito = String(b.esito || ''); if (!['PAGAMENTO_PROMESSO', 'PIANO_RIENTRO', 'CONTESTAZIONE', 'NESSUN_RISCONTRO'].includes(esito)) throw bad('Esito della chiamata non valido');
  const d = data(b.data || oggi, 'Data della chiamata'); if (d > oggi) throw bad('La data della chiamata è nel futuro');
  const nota = String(b.nota || '').trim(); if (['CONTESTAZIONE'].includes(esito) && nota.length < 5) throw bad('Descrivi la contestazione riferita dal cliente');
  let impData = null, rate = [];
  if (esito === 'PAGAMENTO_PROMESSO') { impData = data(b.impegno_data, 'Data promessa'); if (impData < oggi) throw bad('La data promessa è già passata'); }
  if (esito === 'PIANO_RIENTRO') {
    rate = (Array.isArray(b.rate) ? b.rate : []).map((x) => ({ data: data(x.data, 'Data della rata'), importo: r2(x.importo) })).filter((x) => x.importo > 0).sort((a, c) => a.data.localeCompare(c.data));
    if (!rate.length) throw bad('Il piano di rientro richiede almeno una rata con data e importo');
    impData = rate[rate.length - 1].data;
  }
  const att = b.attivita_id ? await one(`SELECT * FROM attivita WHERE id = $1 AND organization_id = $2`, [id(b.attivita_id), orgId]) : await one(`SELECT * FROM attivita WHERE organization_id = $1 AND stato = 'APERTA' ORDER BY id LIMIT 1`, [orgId]);
  const out = await tx(async (c) => {
    const ch = (await c.query(`INSERT INTO chiamate (organization_id, attivita_id, data, interlocutore, esito, impegno_data, impegno_importo, prossima_azione, nota, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [orgId, att?.id || null, d, String(b.interlocutore || '').trim().slice(0, 200) || null, esito, impData, b.impegno_importo ? r2(b.impegno_importo) : rate.length ? r2(rate.reduce((s, x) => s + x.importo, 0)) : null, String(b.prossima_azione || '').trim().slice(0, 300) || null, nota.slice(0, 2000) || null, req.user.id])).rows[0];
    if (att?.stato === 'APERTA') await c.query(`UPDATE attivita SET stato = 'FATTA', chiusa_at = now() WHERE id = $1`, [att.id]);
    let testo = `Chiamata del ${itData(d)}${b.interlocutore ? ` con ${String(b.interlocutore).trim()}` : ''}: `;
    if (esito === 'PAGAMENTO_PROMESSO') {
      await c.query(`INSERT INTO promesse (organization_id, data, importo, origine, chiamata_id, nota, user_id) VALUES ($1,$2,$3,'CHIAMATA',$4,$5,$6)`, [orgId, impData, b.impegno_importo ? r2(b.impegno_importo) : null, ch.id, nota || null, req.user.id]);
      testo += `pagamento promesso entro il ${itData(impData)}. Scala sospesa fino a quella data.`;
    } else if (esito === 'PIANO_RIENTRO') {
      await c.query(`INSERT INTO promesse (organization_id, data, importo, origine, chiamata_id, piano, rate, stato, nota, user_id) VALUES ($1,$2,$3,'CHIAMATA',$4,TRUE,$5,'DA_APPROVARE',$6,$7)`, [orgId, impData, r2(rate.reduce((s, x) => s + x.importo, 0)), ch.id, JSON.stringify(rate), nota || null, req.user.id]);
      testo += `piano di rientro in ${rate.length} ${rate.length === 1 ? 'rata' : 'rate'} proposto, da approvare dal Responsabile Amministrazione e Finanza.`;
    } else if (esito === 'CONTESTAZIONE') {
      const ids = att?.fattura_ids?.length ? att.fattura_ids : [];
      if (ids.length) await c.query(`UPDATE fatture SET contestata = TRUE, contestata_at = now(), contestazione_nota = $2, contestazione_chiusa_at = NULL, updated_at = now() WHERE id = ANY($1::int[]) AND stato IN ('APERTA','PARZIALE')`, [ids, `Dalla chiamata del ${itData(d)}: ${nota}`.slice(0, 500)]);
      testo += `contestazione (${nota}). ${ids.length ? 'Le fatture escono dalla scala: gestione eccezioni.' : 'Indica le fatture contestate nella scheda.'}`;
    } else testo += `nessun riscontro. Senza un impegno entro ${(await impostazioni()).giorni_piano_dopo_chiamata} giorni lavorativi (${itData(piuLavorativi(d, (await impostazioni()).giorni_piano_dopo_chiamata))}) la posizione viene proposta all'area legale.`;
    if (b.prossima_azione) testo += ` Prossima azione: ${String(b.prossima_azione).trim()}.`;
    await evento(orgId, 'CHIAMATA', testo, { userId: req.user.id, dati: { chiamata_id: ch.id, esito } }, c);
    return ch;
  });
  await traccia(req, 'CHIAMATA', `Esito della chiamata: ${esito}`, { entity: 'chiamate', entityId: out.id });
  res.json({ id: out.id });
}));

// ---------------------------------------------------------------- promesse e piani di rientro
r.get('/promesse', soloVistaCompleta, ah(async (_req, res) => res.json({ righe: await many(`SELECT p.id, p.organization_id, o.name AS cliente, p.data::text AS data, p.importo, p.origine, p.piano, p.rate, p.stato, p.nota, p.created_at, u.full_name AS utente FROM promesse p JOIN public.organizations o ON o.id = p.organization_id LEFT JOIN public.users u ON u.id = p.user_id WHERE p.stato IN ('APERTA','DA_APPROVARE') OR p.created_at > now() - interval '120 days' ORDER BY (p.stato = 'DA_APPROVARE') DESC, p.data LIMIT 200`) })));
r.post('/promesse', soloOperativi, ah(async (req, res) => {
  const b = req.body || {}; const orgId = id(b.organization_id); const d = data(b.data, 'Data promessa');
  if (d < oggiRoma()) throw bad('La data promessa è già passata');
  const p = await one(`INSERT INTO promesse (organization_id, data, importo, origine, nota, user_id) VALUES ($1,$2,$3,'MANUALE',$4,$5) RETURNING id`, [orgId, d, b.importo ? r2(b.importo) : null, String(b.nota || '').trim().slice(0, 500) || null, req.user.id]);
  await evento(orgId, 'PROMESSA', `Promessa di pagamento entro il ${itData(d)}${b.importo ? ` per € ${eur(b.importo)}` : ''} registrata a mano: scala sospesa fino a quella data`, { userId: req.user.id });
  await traccia(req, 'PROMESSA', 'Promessa di pagamento registrata', { entity: 'promesse', entityId: p.id });
  res.json({ id: p.id });
}));
r.post('/promesse/:id/approva', soloDirezione, ah(async (req, res) => {
  const ok = req.body?.approva !== false;
  const p = await one(`UPDATE promesse SET stato = $2, approvata_da = $3, approvata_at = now(), chiusa_at = CASE WHEN $2 = 'ANNULLATA' THEN now() END WHERE id = $1 AND stato = 'DA_APPROVARE' RETURNING id, organization_id, data::text AS data`, [id(req.params.id), ok ? 'APERTA' : 'ANNULLATA', req.user.id]);
  if (!p) throw bad('Nessun piano da approvare');
  await evento(p.organization_id, 'PIANO', ok ? `Piano di rientro approvato (${req.cred.ruolo}): scala sospesa finché le rate sono rispettate, ultima rata il ${itData(p.data)}` : `Piano di rientro non approvato (${req.cred.ruolo})${req.body?.nota ? `: ${String(req.body.nota).trim()}` : ''}: la scala riprende`, { userId: req.user.id });
  await traccia(req, ok ? 'PIANO_APPROVATO' : 'PIANO_RESPINTO', 'Piano di rientro', { entity: 'promesse', entityId: p.id });
  res.json({ ok: true });
}));
r.post('/promesse/:id/annulla', soloOperativi, ah(async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim(); if (motivo.length < 3) throw bad('Scrivi il motivo');
  const p = await one(`UPDATE promesse SET stato = 'ANNULLATA', chiusa_at = now() WHERE id = $1 AND stato IN ('APERTA','DA_APPROVARE') RETURNING id, organization_id`, [id(req.params.id)]);
  if (!p) throw bad('Promessa non annullabile');
  await evento(p.organization_id, 'PROMESSA', `Promessa annullata: ${motivo}. La scala riprende.`, { userId: req.user.id });
  await traccia(req, 'PROMESSA_ANNULLATA', 'Promessa annullata', { entity: 'promesse', entityId: p.id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- area legale
r.get('/legale', ah(async (req, res) => {
  if (!(req.cred.tutto || req.cred.legale)) throw forbidden('Sezione non prevista dal tuo profilo');
  res.json({ righe: await many(`SELECT p.id, p.organization_id, o.name AS cliente, p.stato, p.motivo, p.totale, p.serve_dir, p.simulata, p.creata_at, p.raf_at, ur.full_name AS raf, p.dir_at, ud.full_name AS dir, p.trasmessa_at, p.chiusa_at, p.esito, p.nota, cardinality(p.fattura_ids) AS fatture
      FROM pratiche_legali p JOIN public.organizations o ON o.id = p.organization_id LEFT JOIN public.users ur ON ur.id = p.raf_da LEFT JOIN public.users ud ON ud.id = p.dir_da
     WHERE ($1 OR p.stato IN ('AUTORIZZATA','TRASMESSA','CHIUSA')) ORDER BY (p.stato IN ('PROPOSTA','AUTORIZZATA')) DESC, p.id DESC LIMIT 200`, [req.cred.tutto]), soglia_dir: (await impostazioni()).soglia_dir,
    puoi: { autorizzare: req.cred.dirige, direzione: req.cred.ruolo === 'CEO', trasmettere: req.cred.dirige || req.cred.legale, proporre: req.cred.opera } });
}));
r.post('/legale', soloOperativi, ah(async (req, res) => {
  const orgId = id(req.body?.organization_id); const motivo = String(req.body?.motivo || '').trim(); if (motivo.length < 5) throw bad('Scrivi il motivo della proposta');
  const imp = await impostazioni();
  const pid = await proponiLegale({ orgId, motivo, imp, oggi: oggiRoma(), modo: imp.modalita, userId: req.user.id });
  if (!pid) throw bad('Proposta non creata: il cliente non ha fatture scadute non contestate, oppure ha già una pratica aperta o respinta negli ultimi 30 giorni');
  await traccia(req, 'LEGALE_PROPOSTA', 'Pratica legale proposta a mano', { entity: 'pratiche_legali', entityId: pid });
  res.json({ id: pid });
}));
// Autorizzazione: il RAF (CFO; il CEO può sostituirlo); sopra la soglia serve anche la Direzione (CEO). Due firme di due persone solo
// se il CFO firma come RAF: il CEO che autorizza da solo copre entrambe, come previsto dalla scelta "basta uno dei due" per le decisioni.
r.post('/legale/:id/autorizza', soloDirezione, ah(async (req, res) => {
  const p = await one('SELECT * FROM pratiche_legali WHERE id = $1', [id(req.params.id)]);
  if (!p || p.stato !== 'PROPOSTA') throw bad('La pratica non è in attesa di autorizzazione');
  if (p.simulata) throw bad('Pratica nata in modalità Prova: non si autorizza. In modalità Attiva verrà riproposta.');
  const ceo = req.cred.ruolo === 'CEO';
  const raf = p.raf_da || req.user.id, dir = p.serve_dir ? (ceo ? req.user.id : p.dir_da) : null;
  const completa = !p.serve_dir || Boolean(dir);
  await tx(async (c) => {
    await c.query(`UPDATE pratiche_legali SET raf_da = $2, raf_at = coalesce(raf_at, now()), dir_da = $3, dir_at = CASE WHEN $3::int IS NOT NULL THEN coalesce(dir_at, now()) END, stato = $4 WHERE id = $1`, [p.id, raf, dir, completa ? 'AUTORIZZATA' : 'PROPOSTA']);
    if (completa) await c.query(`UPDATE fatture SET fase = 5, fase_at = now(), updated_at = now() WHERE id = ANY($1::int[]) AND stato IN ('APERTA','PARZIALE')`, [p.fattura_ids]);
    await evento(p.organization_id, 'LEGALE', completa ? `Passaggio all'area legale autorizzato (${req.cred.ruolo}) per € ${eur(p.totale)}: i solleciti si fermano, il fascicolo va trasmesso` : `Pratica legale autorizzata dal RAF: sopra la soglia di € ${eur((await impostazioni()).soglia_dir)} serve anche la Direzione`, { userId: req.user.id }, c);
  });
  await traccia(req, 'LEGALE_AUTORIZZATA', completa ? 'Pratica legale autorizzata' : 'Pratica legale: firma del RAF, manca la Direzione', { entity: 'pratiche_legali', entityId: p.id });
  res.json({ ok: true, completa });
}));
r.post('/legale/:id/respingi', soloDirezione, ah(async (req, res) => {
  const nota = String(req.body?.nota || '').trim(); if (nota.length < 3) throw bad('Scrivi il motivo');
  const p = await one(`UPDATE pratiche_legali SET stato = 'RESPINTA', chiusa_at = now(), nota = $2 WHERE id = $1 AND stato = 'PROPOSTA' RETURNING id, organization_id`, [id(req.params.id), nota.slice(0, 500)]);
  if (!p) throw bad('La pratica non è in attesa di autorizzazione');
  await evento(p.organization_id, 'LEGALE', `Passaggio all'area legale non autorizzato (${req.cred.ruolo}): ${nota}`, { userId: req.user.id });
  await traccia(req, 'LEGALE_RESPINTA', 'Pratica legale respinta', { entity: 'pratiche_legali', entityId: p.id });
  res.json({ ok: true });
}));
r.post('/legale/:id/trasmetti', ah(async (req, res) => {
  if (!(req.cred.dirige || req.cred.legale)) throw forbidden('Operazione riservata all\'area legale, al CFO e al CEO');
  const p = await one(`UPDATE pratiche_legali SET stato = 'TRASMESSA', trasmessa_at = now(), trasmessa_da = $2 WHERE id = $1 AND stato = 'AUTORIZZATA' RETURNING id, organization_id`, [id(req.params.id), req.user.id]);
  if (!p) throw bad('La pratica non è autorizzata');
  await evento(p.organization_id, 'LEGALE', 'Fascicolo trasmesso all\'area legale', { userId: req.user.id });
  await traccia(req, 'LEGALE_TRASMESSA', 'Fascicolo trasmesso', { entity: 'pratiche_legali', entityId: p.id });
  res.json({ ok: true });
}));
r.post('/legale/:id/chiudi', ah(async (req, res) => {
  if (!(req.cred.dirige || req.cred.legale)) throw forbidden('Operazione riservata all\'area legale, al CFO e al CEO');
  const esito = String(req.body?.esito || '').trim(); if (esito.length < 3) throw bad('Scrivi l\'esito');
  const p = await one(`UPDATE pratiche_legali SET stato = 'CHIUSA', chiusa_at = now(), esito = $2 WHERE id = $1 AND stato IN ('AUTORIZZATA','TRASMESSA') RETURNING id, organization_id`, [id(req.params.id), esito.slice(0, 500)]);
  if (!p) throw bad('La pratica non è aperta');
  await evento(p.organization_id, 'LEGALE', `Pratica legale chiusa: ${esito}`, { userId: req.user.id });
  await traccia(req, 'LEGALE_CHIUSA', 'Pratica legale chiusa', { entity: 'pratiche_legali', entityId: p.id });
  res.json({ ok: true });
}));
// Fascicolo: fatture, comunicazioni, chiamate, registro dei contatti e bozza della messa in mora (da validare con l'area legale)
r.get('/legale/:id/fascicolo', ah(async (req, res) => {
  const p = await one(`SELECT p.*, o.name AS cliente, o.vat_number, o.pec, o.address, o.zip, o.city, o.province FROM pratiche_legali p JOIN public.organizations o ON o.id = p.organization_id WHERE p.id = $1`, [id(req.params.id)]);
  if (!p) throw notFound('Pratica non trovata');
  if (!(req.cred.tutto || (req.cred.legale && ['AUTORIZZATA', 'TRASMESSA', 'CHIUSA'].includes(p.stato)))) throw forbidden('Pratica non visibile con il tuo profilo');
  const imp = await impostazioni(); const oggi = oggiRoma();
  const fatture = await many(`SELECT f.id, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, f.importo, f.incassato, (f.importo - f.incassato) AS residuo, ($2::date - f.scadenza)::int AS giorni, f.stato FROM fatture f WHERE f.id = ANY($1::int[]) ORDER BY f.scadenza`, [p.fattura_ids, oggi]);
  const aperte = fatture.filter((f) => ['APERTA', 'PARZIALE'].includes(f.stato)).map((f) => ({ ...f, residuo: r2(f.residuo) }));
  const prec = await many(`SELECT fase, max(inviata_at) AS at FROM comunicazioni WHERE organization_id = $1 AND stato IN ('INVIATA','REGISTRATA') GROUP BY fase`, [p.organization_id]);
  const quando = (n) => { const x = prec.find((y) => y.fase === n); return x ? itData(oggiRoma(new Date(x.at))) : null; };
  const ch = await one('SELECT max(data)::text AS d FROM chiamate WHERE organization_id = $1', [p.organization_id]);
  const bozza = componi(5, imp, { 'ragione sociale': p.cliente, 'data 1° sollecito': quando(2), 'data 2° sollecito': quando(3), 'data chiamata': ch?.d ? itData(ch.d) : null }, aperte, null);
  res.json({ pratica: p, fatture: fatture.map((f) => ({ ...f, importo: r2(f.importo), incassato: r2(f.incassato), residuo: r2(f.residuo) })),
    comunicazioni: await many(`SELECT id, fase, stato, destinatari, oggetto, totale, inviata_at, pec_stato, pec_at, corpo_testo FROM comunicazioni WHERE organization_id = $1 AND stato IN ('INVIATA','REGISTRATA') ORDER BY inviata_at`, [p.organization_id]),
    chiamate: await many(`SELECT c.data::text AS data, c.interlocutore, c.esito, c.nota, u.full_name AS utente FROM chiamate c LEFT JOIN public.users u ON u.id = c.user_id WHERE c.organization_id = $1 ORDER BY c.data`, [p.organization_id]),
    risposte: await many(`SELECT ricevuta_at, da_email, oggetto, classe, sintesi FROM risposte WHERE organization_id = $1 ORDER BY ricevuta_at`, [p.organization_id]),
    eventi: await many(`SELECT e.at, e.tipo, e.testo, u.full_name AS utente FROM eventi e LEFT JOIN public.users u ON u.id = e.user_id WHERE e.organization_id = $1 ORDER BY e.id`, [p.organization_id]),
    messa_in_mora: { oggetto: bozza.oggetto, testo: bozza.testo, mancanti: bozza.mancanti, avvertenza: 'Bozza: il testo della messa in mora va validato dall\'area legale prima dell\'invio, che avviene via PEC o raccomandata fuori dalla Suite.' } });
}));

// ---------------------------------------------------------------- impostazioni, modalità, motore
const CHIAVI = ['giorni_avviso', 'giorni_sollecito_1', 'giorni_sollecito_2', 'giorni_chiamata', 'giorni_legale', 'giorni_piano_dopo_chiamata', 'giorni_termine_1', 'giorni_termine_2', 'giorni_invio', 'ora_invio_da', 'ora_invio_a', 'ore_banca_fresca', 'giorni_bonifici_dubbi',
  'tolleranza_promessa', 'giorni_attesa_pagato', 'soglia_minima', 'soglia_dir', 'termini_predefiniti', 'fatture_dal', 'riconciliazione_automatica', 'risposta_automatica', 'iban', 'intestatario', 'firma_att', 'telefono_att', 'firma_raf_nome', 'firma_raf_ruolo', 'cc_fissi', 'tasso_mora_pct', 'casella', 'traccia_chiamata', ...CHIAVI_MODELLO];
r.get('/impostazioni', soloVistaCompleta, ah(async (req, res) => {
  const imp = await impostazioni();
  res.json({ valori: imp, predefinite: PREDEFINITE, modelli: MODELLI, modificabili: req.cred.dirige, posta: mailStatus(), graph: graphConfigured(), ai: aiEnabled(), banca: await bancaAggiornata(imp.ore_banca_fresca),
    casella_errore: (await one(`SELECT value FROM public.app_settings WHERE key = 'crediti_casella_errore'`))?.value || null, casella_env: Boolean(process.env.CREDITI_MAILBOX),
    giri: await many('SELECT at, modalita, esito FROM giri ORDER BY id DESC LIMIT 12'), registro: await many(`SELECT a.at, a.action, a.label, u.full_name AS utente FROM audit_log a LEFT JOIN public.users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 80`) });
}));
r.put('/impostazioni', soloDirezione, ah(async (req, res) => {
  const b = req.body || {}; const cambiate = [];
  const imp = await impostazioni();
  const dopo = { ...imp, ...Object.fromEntries(Object.entries(b).filter(([k]) => CHIAVI.includes(k))) };
  const n = (k) => Number(dopo[k]);
  if (!(n('giorni_sollecito_1') >= 1 && n('giorni_sollecito_1') < n('giorni_sollecito_2') && n('giorni_sollecito_2') < n('giorni_chiamata') && n('giorni_chiamata') < n('giorni_legale'))) throw bad('La scala deve crescere: 1° sollecito, 2° sollecito, chiamata, area legale');
  if (!(n('ora_invio_da') < n('ora_invio_a'))) throw bad('Fascia oraria di invio non valida');
  if (b.fatture_dal !== undefined) data(b.fatture_dal, 'Data di partenza delle fatture');
  if (b.iban !== undefined && String(b.iban).trim() && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(String(b.iban).replace(/\s+/g, '').toUpperCase())) throw bad('IBAN non valido');
  for (const [k, v] of Object.entries(b)) {
    if (!CHIAVI.includes(k)) continue;
    let val = v;
    if (k === 'iban') val = String(v || '').replace(/\s+/g, '').toUpperCase();
    if (k === 'giorni_invio') { val = [...new Set((Array.isArray(v) ? v : []).map(Number).filter((x) => x >= 1 && x <= 7))].sort(); if (!val.length) throw bad('Scegli almeno un giorno di invio'); }
    if (k === 'cc_fissi') val = listaEmail(v).join(', ');
    if (k === 'casella') { val = String(v || '').trim().toLowerCase() || null; if (val && !listaEmail(val).length) throw bad('Indirizzo della casella non valido'); }
    if (CHIAVI_MODELLO.includes(k)) { val = String(v || '').trim() || null; if (val === MODELLI[k]) val = null; }
    if (JSON.stringify(val) === JSON.stringify(imp[k])) continue;
    if (val === null && CHIAVI_MODELLO.includes(k)) await q('DELETE FROM impostazioni WHERE key = $1', [k]); else await salvaImpostazione(k, val, req.user.id);
    cambiate.push(k);
  }
  if (cambiate.length) await traccia(req, 'IMPOSTAZIONI', `Impostazioni cambiate: ${cambiate.join(', ')}`, { dati: { chiavi: cambiate } });
  res.json({ cambiate });
}));
// Modalità Attiva: da qui in poi le comunicazioni partono davvero. Decidono CEO o CFO, dopo aver visto cosa partirebbe subito.
r.post('/modalita', soloDirezione, ah(async (req, res) => {
  const nuova = req.body?.modalita === 'ATTIVA' ? 'ATTIVA' : 'PROVA'; const imp = await impostazioni();
  if (nuova === imp.modalita) return res.json({ modalita: nuova, invariata: true });
  if (nuova === 'ATTIVA') {
    const manca = [!imp.iban && 'IBAN per i pagamenti', !imp.firma_raf_nome && 'nome del Responsabile Amministrazione e Finanza (firma del 2° sollecito)', !imp.telefono_att && 'telefono dell\'Amministrazione'].filter(Boolean);
    if (manca.length) throw bad(`Prima di attivare completa le Impostazioni: ${manca.join('; ')}.`);
    const prova = await giro({ anteprima: true, forza: true });
    if (!req.body?.conferma) return res.json({ modalita: imp.modalita, anteprima: { invii: prova.invii, attese: prova.attese, firme: prova.firme, chiamate: prova.chiamate, pratiche: prova.pratiche }, posta: mailStatus(), banca: await bancaAggiornata(imp.ore_banca_fresca) });
    await q(`DELETE FROM attivita WHERE simulata AND stato = 'APERTA'`); await q(`DELETE FROM pratiche_legali WHERE simulata AND stato = 'PROPOSTA'`);
  }
  await salvaImpostazione('modalita', nuova, req.user.id);
  await evento(null, 'MODALITA', `Modalità ${nuova === 'ATTIVA' ? 'Attiva: le comunicazioni partono' : 'Prova: nessuna comunicazione parte'} (${req.cred.ruolo})`, { userId: req.user.id });
  await traccia(req, 'MODALITA', `Modalità ${nuova}`, { dati: { ruolo: req.cred.ruolo } });
  res.json({ modalita: nuova });
}));
r.post('/giro', soloOperativi, ah(async (req, res) => {
  const forza = Boolean(req.body?.forza); if (forza && !req.cred.dirige) throw forbidden('L\'esecuzione fuori dai giorni di invio è riservata a CEO e CFO');
  const out = await giro({ forza }); await traccia(req, 'GIRO', `Giro eseguito a mano${forza ? ' (fuori calendario)' : ''}`, { dati: { inviate: out.inviate, in_attesa: out.in_attesa } });
  res.json(out);
}));
r.get('/anteprima', soloVistaCompleta, ah(async (_req, res) => { const p = await giro({ anteprima: true, forza: true }); res.json({ invii: p.invii, attese: p.attese, firme: p.firme, chiamate: p.chiamate, pratiche: p.pratiche, fermi: p.fermi }); }));
r.post('/casella/prova', soloDirezione, ah(async (_req, res) => res.json(await provaCasella((await impostazioni()).casella, { serveInvio: true }))));
r.post('/casella/leggi', soloOperativi, ah(async (_req, res) => res.json(await leggiCasella())));

r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));
export default r;
