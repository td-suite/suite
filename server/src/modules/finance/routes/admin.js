// Impostazioni, conti di addebito, anagrafica beneficiari, registro attività dell'app Finance.
// La gestione utenti (routes /users dell'app di origine) non è portata: utenti, profili e firmatari si assegnano nella Suite
// (grant del modulo finance con profilo CEO, CFO, SUPPORT o VIEWER).
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireAdmin, requireManage } from '../lib/access.js';
import { getSettings, DEFAULT_SETTINGS, normalizeIban, validIban, CORE_KEYS } from '../lib/rules.js';
import { config } from '../config.js';
import { pdfAvailable } from '../lib/docgen.js';
import { mailAvailable } from '../lib/mail.js';

const r = Router();

// ---------------- Impostazioni ----------------
r.get('/settings', ah(async (_req, res) => {
  const s = await getSettings();
  const signers = await many("SELECT role, full_name, title, email FROM users WHERE role IN ('CEO','CFO') AND active");
  res.json({ settings: s, defaults: DEFAULT_SETTINGS, coreKeys: CORE_KEYS, signers, entraEnabled: config.entra.enabled, mailMode: config.mail.mode, mailSender: config.mail.sender, pdfEnabled: await pdfAvailable(), maxUploadMb: config.maxUploadMb, signAllowLocal: config.signAllowLocal });
}));

r.get('/settings/mail-status', requireAdmin, ah(async (_req, res) => res.json(await mailAvailable())));

r.put('/settings', requireAdmin, ah(async (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!(k in DEFAULT_SETTINGS)) throw bad(`Impostazione sconosciuta: ${k}`);
    if (CORE_KEYS.includes(k)) continue;   // ragione sociale: Dati aziendali della Suite
    if (['threshold_single', 'threshold_joint', 'aggregation_days', 'token_days', 'reminder_days', 'schedule_alert_days'].includes(k) && !(Number(body[k]) >= 0)) throw bad(`${k}: valore numerico non valido`);
    if (['schedule_istat_pct', 'schedule_utility_growth_pct'].includes(k)) { body[k] = String(body[k] ?? '').replace(',', '.'); if (!Number.isFinite(Number(body[k]))) throw bad(`${k}: percentuale non valida`); }
    if (k === 'schedule_notify_roles') {
      const roles = String(body[k] || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      if (roles.some((x) => !['SUPPORT', 'CEO', 'CFO', 'VIEWER'].includes(x))) throw bad('Profili ammessi per gli avvisi: SUPPORT, CEO, CFO, VIEWER');
      body[k] = roles.join(',');
    }
    await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(body[k] ?? '')]);
  }
  if (body.threshold_single != null || body.threshold_joint != null) {
    const s = await getSettings();
    if (Number(s.threshold_single) >= Number(s.threshold_joint)) throw bad('La soglia di firma singola deve essere inferiore a quella della delibera CdA');
  }
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, body);
  res.json({ ok: true });
}));

// ---------------- Conti di addebito ----------------
r.get('/bank-accounts', ah(async (req, res) => res.json(await many(`SELECT * FROM bank_accounts ${req.query.all ? '' : 'WHERE active'} ORDER BY sort_order, id`))));
const bankSchema = z.object({ bank_name: z.string().min(2).max(160), iban: z.string().min(10).max(40), label: z.string().max(80).nullable().optional(), active: z.boolean().default(true), sort_order: z.number().int().default(100) });
r.post('/bank-accounts', requireAdmin, ah(async (req, res) => {
  const d = parse(bankSchema, req.body);
  d.iban = normalizeIban(d.iban);
  if (!validIban(d.iban)) throw bad('IBAN non valido');
  const row = await one('INSERT INTO bank_accounts(bank_name, iban, label, active, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *', [d.bank_name, d.iban, d.label || null, d.active, d.sort_order]);
  await audit(req, 'BANK_ACCOUNT_CREATE', 'bank_account', row.id, d);
  res.status(201).json(row);
}));
r.put('/bank-accounts/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(bankSchema.partial(), req.body);
  if (d.iban) { d.iban = normalizeIban(d.iban); if (!validIban(d.iban)) throw bad('IBAN non valido'); }
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE bank_accounts SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'BANK_ACCOUNT_UPDATE', 'bank_account', id, d);
  res.json({ ok: true });
}));

// ---------------- Beneficiari (anagrafica e storico IBAN) ----------------
r.get('/beneficiaries', ah(async (req, res) => {
  const qs = String(req.query.q || '').trim().toLowerCase();
  const rows = await many(`SELECT b.id, b.name, b.tax_id, b.created_at,
      (SELECT json_agg(json_build_object('id', i.id, 'iban', i.iban, 'bic', i.bic, 'bank', i.bank, 'first_seen_at', i.first_seen_at, 'verified_at', i.verified_at, 'verified_note', i.verified_note) ORDER BY i.first_seen_at DESC) FROM beneficiary_ibans i WHERE i.beneficiary_id=b.id) AS ibans,
      (SELECT count(*)::int FROM payment_requests p WHERE p.beneficiary_id=b.id AND p.status NOT IN ('ANNULLATA')) AS requests,
      (SELECT coalesce(sum(amount),0) FROM payment_requests p WHERE p.beneficiary_id=b.id AND p.status IN ('FIRMATA','ESEGUITA')) AS total_authorized
    FROM beneficiaries b WHERE $1='' OR lower(b.name) LIKE '%'||$1||'%' OR lower(coalesce(b.tax_id,'')) LIKE '%'||$1||'%' ORDER BY b.name LIMIT 200`, [qs]);
  res.json(rows);
}));
r.put('/beneficiaries/:id', requireManage, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(z.object({ name: z.string().min(2).max(200).optional(), tax_id: z.string().max(40).nullable().optional() }), req.body);
  const cols = Object.keys(d);
  if (cols.length) await q(`UPDATE beneficiaries SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'BENEFICIARY_UPDATE', 'beneficiary', id, d);
  res.json({ ok: true });
}));
// Conferma di un IBAN tramite canale indipendente (telefonata al fornitore, PEC, ...)
r.post('/beneficiaries/ibans/:id/verify', requireManage, ah(async (req, res) => {
  const id = Number(req.params.id);
  const { note } = parse(z.object({ note: z.string().min(3).max(300) }), req.body);
  await q('UPDATE beneficiary_ibans SET verified_at=now(), verified_by=$2, verified_note=$3 WHERE id=$1', [id, req.user.id, note]);
  await audit(req, 'IBAN_VERIFIED', 'beneficiary_iban', id, { note });
  res.json({ ok: true });
}));

// ---------------- Registro attività ----------------
r.get('/audit', requireAdmin, ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit || 200));
  res.json(await many(`SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.ip, a.at, u.full_name AS user_name
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));

export default r;
