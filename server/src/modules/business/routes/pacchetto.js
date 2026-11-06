// Business Hub · Pacchetto di benvenuto (route montate sotto /api/business/hub). Docs: docs/BUSINESS_HUB.md, sezione "Pacchetto di
// benvenuto". Lettura della composizione per tutti i profili del modulo; generazione per chi gestisce la linea (canEditKind); modelli dei
// testi (lettera del CEO per linea ed email) modificabili dall'Admin del modulo. L'invio passa da POST /hub/accounts/:id/email/invia
// (stesso riepilogo, mittente della linea e copie fisse di "Scrivi al cliente") con documenti=[PDF del pacchetto] e pacchetto_id.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, forbidden, audit, parse, todayRome } from '../lib/util.js';
import { canEditKind } from '../lib/rules.js';
import { requireAdmin } from '../lib/access.js';
import { storeBuffer } from '../lib/storage.js';
import { LINEE } from '../lib/hub.js';
import { componiSezioni, nomeFile, segnapostoSconosciuti, LETTERA_CEO_DEFAULT, EMAIL_DEFAULT, OGGETTO_EMAIL, SEGNAPOSTO } from '../lib/pacchetto.js';
import { generaPacchetto, disponibilita, emailPacchetto, modelli, CHIAVE_LETTERA, CHIAVE_EMAIL } from '../lib/pacchettoGenera.js';
import { loadAccount, addActivity } from './hub.js';

const r = Router();
const optInt = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().positive().nullable());

async function contattoDi(accountId, id) {
  if (!id) return null;
  const c = await one('SELECT id, nome, ruolo, email FROM contatti WHERE id=$1 AND account_id=$2', [id, accountId]);
  if (!c) throw bad('Referente non valido per questo account');
  return c;
}
const versioni = (accountId) => many(`SELECT k.id, k.versione, k.variante, k.data, k.created_at, k.pagine, k.bytes, k.sezioni, k.avvisi, k.offerta, k.password_inclusa, k.destinatario, k.contatto_id,
    k.documento_id, d.filename, u.full_name AS created_by_name, k.inviato_at, k.inviato_stato, x.email_to AS inviato_a
  FROM pacchetti k LEFT JOIN documenti d ON d.id=k.documento_id LEFT JOIN users u ON u.id=k.created_by LEFT JOIN activities x ON x.id=k.inviato_activity_id
  WHERE k.account_id=$1 ORDER BY k.versione DESC`, [accountId]);

// Composizione: sezioni della linea con la disponibilità dei dati, referenti, versioni già generate, testo dell'email
r.get('/accounts/:id/pacchetto', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  const disp = await disponibilita(a);
  const contatti = await many('SELECT id, nome, ruolo, email, principale FROM contatti WHERE account_id=$1 ORDER BY principale DESC, nome', [a.id]);
  const principale = contatti.find((c) => c.principale) || contatti[0] || null;
  res.json({
    linea: a.linea, linea_label: LINEE[a.linea].label, data: todayRome(),
    sezioni: componiSezioni(a.linea, {}, { offerta: disp.offerta, listino: Boolean(disp.listino), studiolab: disp.studiolab }), disponibilita: disp, contatti, contatto_predefinito: principale?.id || null,
    versioni: await versioni(a.id), email: await emailPacchetto(a, { contatto: principale, data: todayRome() }),
    puo_generare: canEditKind(req.user, a.linea),
  });
}));

// Testo dell'email per il referente scelto (segnaposto sostituiti)
r.get('/accounts/:id/pacchetto/email', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  const c = await contattoDi(a.id, req.query.contatto_id ? Number(req.query.contatto_id) : null);
  res.json(await emailPacchetto(a, { contatto: c, data: todayRome() }));
}));

// Generazione: nuova versione nei Documenti dell'account, attività PACCHETTO nel diario
const generaSchema = z.object({
  escluse: z.array(z.string().max(30)).default([]), contatto_id: optInt.optional(), includi_password: z.boolean().default(false),
  data: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida').nullable()).optional(),
});
/**
 * Generazione e archiviazione di un pacchetto (anche dal kit di proposta e dal richiamo dei prospect): nuova versione nei Documenti
 * dell'account (categoria PACCHETTO), attività PACCHETTO nel diario, riga nel registro dei pacchetti con la variante.
 */
export async function creaPacchetto(a, { scelte = {}, contatto = null, includiPassword = false, data, variante = 'BENVENUTO', vademecumPagine } = {}, userId = null) {
  const t0 = Date.now();
  const g = await generaPacchetto(a, { scelte, contatto, includiPassword, data, variante, vademecumPagine });
  const versione = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM pacchetti WHERE account_id=$1', [a.id])).v);
  const filename = variante === 'BENVENUTO' ? nomeFile(a.org_name, versione, data) : nomeFile(a.org_name, versione, data).replace('_Pacchetto_benvenuto_', variante === 'KIT' ? '_Proposta_di_collaborazione_' : '_Presentazione_');
  const st = await storeBuffer('hub', filename, 'application/pdf', g.pdf);
  const doc = await one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by) VALUES ($1,'PACCHETTO',$2,'application/pdf',$3,$4,$5,$6,$7) RETURNING id`,
    [a.id, filename, st.size, st.sha256, st.data, st.blob_path, userId]);
  const incluse = g.sezioni.filter((x) => x.inclusa).map((x) => x.titolo);
  const omesse = g.sezioni.filter((x) => !x.inclusa).map((x) => `${x.titolo} (${x.motivo})`);
  const nome = { BENVENUTO: 'Pacchetto di benvenuto', KIT: 'Pacchetto della proposta', PROSPECT: 'Pacchetto di presentazione (prospect)' }[variante] || 'Pacchetto';
  const act = await addActivity(a.id, { tipo: 'PACCHETTO', oggetto: `${nome} v${versione} generato (${g.pagine} pagine)`, con_chi: contatto?.nome || null, contatto_id: contatto?.id || null,
    testo: [`Sezioni: ${incluse.join(', ')}.`, omesse.length ? `Non incluse: ${omesse.join('; ')}.` : null, g.password_inclusa ? 'Password del portale referti stampata nel pacchetto (scelta dell\'operatore).' : null].filter(Boolean).join('\n'),
    dati: { documento_id: doc.id, versione, pagine: g.pagine, variante } }, userId);
  await q('UPDATE documenti SET activity_id=$2 WHERE id=$1', [doc.id, act.id]);
  const row = await one(`INSERT INTO pacchetti (account_id, versione, data, documento_id, activity_id, contatto_id, destinatario, sezioni, avvisi, pagine, bytes, offerta, password_inclusa, created_by, variante)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
  [a.id, versione, data, doc.id, act.id, contatto?.id || null, contatto?.nome || null, JSON.stringify(g.sezioni), JSON.stringify(g.avvisi), g.pagine, g.pdf.length, g.offerta, g.password_inclusa, userId, variante]);
  await q('UPDATE accounts SET updated_at=now() WHERE id=$1', [a.id]);
  console.log(`[business] pacchetto ${variante.toLowerCase()} account ${a.id} v${versione}: ${g.pagine} pagine in ${Date.now() - t0} ms`);
  return { id: row.id, versione, documento_id: doc.id, filename, pagine: g.pagine, bytes: g.pdf.length, sezioni: g.sezioni, avvisi: g.avvisi, password_inclusa: g.password_inclusa, referenti_testo: g.referenti_testo, ms: Date.now() - t0 };
}

r.post('/accounts/:id/pacchetto', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  if (!canEditKind(req.user, a.linea)) throw forbidden(`Il pacchetto lo genera chi gestisce la linea ${LINEE[a.linea].label}`);
  const d = parse(generaSchema, req.body || {});
  const contatto = await contattoDi(a.id, d.contatto_id);
  const data = d.data || todayRome();
  const scelte = Object.fromEntries(d.escluse.map((k) => [k, false]));
  const out = await creaPacchetto(a, { scelte, contatto, includiPassword: d.includi_password, data }, req.user.id);
  await audit(req, 'HUB_PACCHETTO', 'account', a.id, { versione: out.versione, pagine: out.pagine, password_inclusa: out.password_inclusa, ms: out.ms });
  res.status(201).json({ ...out, email: await emailPacchetto(a, { contatto, data }) });
}));

// Modelli dei testi (Impostazioni): lettera del CEO per linea ed email di accompagnamento
r.get('/pacchetto/modelli', ah(async (_req, res) => {
  const m = await modelli();
  res.json({ ...m, predefiniti: { lettera: LETTERA_CEO_DEFAULT, email: EMAIL_DEFAULT, oggetto: OGGETTO_EMAIL }, segnaposto: [...SEGNAPOSTO, 'referenti'] });
}));
r.put('/pacchetto/modelli', requireAdmin, ah(async (req, res) => {
  const d = parse(z.object({
    lettera: z.object({ SRV: z.string().max(20000), PP: z.string().max(20000), MDL: z.string().max(20000) }).partial().optional(),
    email: z.string().max(10000).optional(), ripristina: z.boolean().optional(),
  }), req.body || {});
  if (d.ripristina) {
    await q('DELETE FROM app_settings WHERE key = ANY($1::text[])', [[CHIAVE_LETTERA, CHIAVE_EMAIL]]);
  } else {
    const avvisi = [];
    if (d.lettera) {
      const cur = (await modelli()).lettera;
      const nuova = { ...cur };
      for (const [k, v] of Object.entries(d.lettera)) {
        if (!v.trim()) continue;
        if (!/\{\{\s*referenti\s*\}\}/i.test(v)) avvisi.push(`${LINEE[k].label}: manca {{referenti}}, il blocco dei contatti non comparirà`);
        nuova[k] = v;
      }
      const diversi = Object.fromEntries(Object.entries(nuova).filter(([k, v]) => v !== LETTERA_CEO_DEFAULT[k]));
      if (Object.keys(diversi).length) await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_LETTERA, JSON.stringify(diversi)]);
      else await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_LETTERA]);
    }
    if (d.email !== undefined) {
      if (d.email.trim() && d.email !== EMAIL_DEFAULT) await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_EMAIL, d.email]);
      else await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_EMAIL]);
    }
    const sconosciuti = segnapostoSconosciuti([...Object.values(d.lettera || {}), d.email || ''].join('\n'));
    if (sconosciuti.length) avvisi.push(`Segnaposto non riconosciuti (restano come testo): ${sconosciuti.map((x) => `{{${x}}}`).join(', ')}`);
    await audit(req, 'HUB_PACCHETTO_MODELLI', 'settings', null, { lettera: Object.keys(d.lettera || {}), email: d.email !== undefined });
    return res.json({ ok: true, avvisi, ...(await modelli()) });
  }
  await audit(req, 'HUB_PACCHETTO_MODELLI', 'settings', null, { ripristina: true });
  res.json({ ok: true, avvisi: [], ...(await modelli()) });
}));

export default r;
