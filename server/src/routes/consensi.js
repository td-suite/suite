// Presa d'atto delle informative (Privacy e uso dell'intelligenza artificiale). Montate sotto /api/consensi dopo requireAuth.
// Utente: GET /stato, POST /accetta. Owner e Admin: GET /riepilogo, PUT /impostazioni, GET /export.csv.
import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, audit, parse, setSetting, today } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { DOCUMENTI, CHIAVI, ETICHETTE, leggiConfig, accettatiDa, documentiDaAccettare, documentiDaRegistrare, registra, csv, invalidaConfigConsensi } from '../lib/consensi.js';

const r = Router();

// Stato dell'utente collegato: per ogni documento URL, versione corrente, data della versione, accettato sì/no e quando
r.get('/stato', ah(async (req, res) => {
  const [cfg, acc] = await Promise.all([leggiConfig(), accettatiDa(req.user.id)]);
  const mancanti = new Set(documentiDaAccettare(cfg, acc));
  res.json({
    documenti: DOCUMENTI.map((d) => {
      const fatto = acc.find((a) => a.documento === d && a.versione === cfg[d].versione);
      return { ...cfg[d], accettato: !mancanti.has(d), accettato_at: fatto?.accettato_at || null };
    }),
    da_accettare: [...mancanti],
  });
}));

// Presa d'atto: registra solo i documenti non ancora accettati nella versione corrente (con IP e user agent)
r.post('/accetta', ah(async (req, res) => {
  const { documenti } = parse(z.object({ documenti: z.array(z.enum(DOCUMENTI)).min(1) }), req.body);
  const [cfg, acc] = await Promise.all([leggiConfig(), accettatiDa(req.user.id)]);
  const nuovi = documentiDaRegistrare(cfg, acc, documenti);
  await registra(req.user.id, nuovi, cfg, { ip: req.ip, userAgent: req.get('user-agent') });
  if (nuovi.length) {
    await audit(req, 'CONSENSO_ACCETTATO', { entity: 'user', entityId: req.user.id, label: nuovi.map((d) => `${d} ${cfg[d].versione}`).join(', '),
      data: Object.fromEntries(nuovi.map((d) => [d, cfg[d].versione])) });
  }
  res.json({ ok: true, registrati: nuovi, da_accettare: documentiDaAccettare(cfg, [...acc, ...nuovi.map((d) => ({ documento: d, versione: cfg[d].versione }))]) });
}));

// Riepilogo per Amministrazione > Impostazioni > Informative: configurazione e conteggi sugli utenti attivi
r.get('/riepilogo', requireAdmin, ah(async (_req, res) => {
  const cfg = await leggiConfig();
  const [{ attivi }] = await many(`SELECT count(*)::int AS attivi FROM users WHERE status='ACTIVE'`);
  const conteggi = await many(`SELECT c.documento, c.versione, count(DISTINCT c.user_id)::int AS n FROM consensi c JOIN users u ON u.id=c.user_id AND u.status='ACTIVE' GROUP BY 1, 2`);
  const [{ tutti }] = await many(`SELECT count(*)::int AS tutti FROM users u WHERE u.status='ACTIVE'
    AND EXISTS (SELECT 1 FROM consensi c WHERE c.user_id=u.id AND c.documento='PRIVACY' AND c.versione=$1)
    AND EXISTS (SELECT 1 FROM consensi c WHERE c.user_id=u.id AND c.documento='IA' AND c.versione=$2)`, [cfg.PRIVACY.versione, cfg.IA.versione]);
  res.json({
    attivi, tutti, mancano: attivi - tutti,
    documenti: DOCUMENTI.map((d) => {
      const n = conteggi.find((c) => c.documento === d && c.versione === cfg[d].versione)?.n || 0;
      return { ...cfg[d], accettato: n, da_accettare: attivi - n };
    }),
  });
}));

const urlSchema = z.string().trim().min(1).max(500).refine((u) => /^https?:\/\/\S+$/i.test(u) || /^\/[^\s/]\S*$/.test(u), 'indirizzo https://... oppure percorso della Suite che inizia con /');
const versioneSchema = z.string().trim().min(1).max(40);

// URL e versioni: cambiare una versione fa riaccettare quel documento a tutti al prossimo accesso
r.put('/impostazioni', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({
    privacy_url: urlSchema.optional(), privacy_versione: versioneSchema.optional(),
    ia_url: urlSchema.optional(), ia_versione: versioneSchema.optional(),
  }), req.body);
  const prima = await leggiConfig();
  const cambi = {};
  for (const d of DOCUMENTI) {
    const pre = d === 'PRIVACY' ? 'privacy' : 'ia';
    for (const campo of ['url', 'versione']) {
      const v = b[`${pre}_${campo}`];
      if (v !== undefined && v !== prima[d][campo]) { await setSetting(CHIAVI[d][campo], v, req.user.id); cambi[CHIAVI[d][campo]] = [prima[d][campo], v]; }
    }
  }
  invalidaConfigConsensi();   // il controllo di requireAuth legge subito la nuova versione
  if (Object.keys(cambi).length) await audit(req, 'CONSENSI_IMPOSTAZIONI', { entity: 'setting', entityId: 'consensi', data: cambi });
  res.json({ ok: true, cambi });
}));

// Registro delle prese d'atto (tutte le versioni), per il consulente privacy
r.get('/export.csv', requireAdmin, ah(async (req, res) => {
  const righe = await many(`SELECT c.accettato_at, u.email, u.full_name, o.name AS organizzazione, u.status, c.documento, c.versione, c.ip, c.user_agent
    FROM consensi c JOIN users u ON u.id=c.user_id LEFT JOIN organizations o ON o.id=u.organization_id ORDER BY c.accettato_at DESC, u.full_name`);
  const fmt = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' });
  const out = csv(['Data e ora', 'Email', 'Utente', 'Legal entity', 'Stato utente', 'Documento', 'Versione', 'IP', 'Browser'],
    righe.map((x) => [fmt(x.accettato_at), x.email, x.full_name, x.organizzazione, x.status, ETICHETTE[x.documento] || x.documento, x.versione, x.ip, x.user_agent]));
  await audit(req, 'CONSENSI_EXPORT', { entity: 'consensi', label: `${righe.length} righe` });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="consensi_${today()}.csv"`).send('﻿' + out);
}));

export default r;
