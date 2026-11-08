// Amministrazione > Impostazioni > "Email della Suite": stato del canale di posta (provider, casella mittente), prova di invio a se
// stessi e registro degli ultimi invii (email_log). Nato l'08/11/2026 dalla domanda del CEO "sei sicuro che Comunicazione mandi
// davvero l'email a tutti gli interni?": prima non c'era nessun punto della Suite da cui verificarlo.
import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { ah, audit, parse, bad } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { sendMail, layout } from '../lib/mailer.js';
import { config } from '../config.js';

const r = Router();

r.get('/admin/mail/stato', requireAdmin, ah(async (_req, res) => {
  const ultimi = await many(`SELECT status, count(*)::int AS n FROM public.email_log WHERE at > now() - interval '30 days' GROUP BY status`);
  const interni = await one(`SELECT count(*)::int AS tot, count(*) FILTER (WHERE notify_email AND coalesce(email,'') <> '')::int AS con_email
    FROM users u WHERE u.status='ACTIVE' AND NOT u.is_external`);
  res.json({ provider: config.mail.provider, sender: config.mail.sender, sender_name: config.mail.senderName,
    attivo: config.mail.provider === 'graph',
    spiegazione: config.mail.provider === 'graph'
      ? `Le email partono dalla casella ${config.mail.sender} tramite Microsoft Graph (servono il permesso Mail.Send dell'app registration e, se c'è una Application Access Policy, la casella inclusa).`
      : 'Canale in modalità registro: le email NON partono, vengono solo scritte nel registro (manca GRAPH_SENDER o ENTRA_CLIENT_SECRET su Render, oppure MAIL_PROVIDER=log).',
    ultimi_30_giorni: Object.fromEntries(ultimi.map((x) => [x.status, x.n])), interni_attivi: interni.tot, interni_che_ricevono_email: interni.con_email });
}));

r.post('/admin/mail/prova', requireAdmin, ah(async (req, res) => {
  const b = parse(z.object({ to: z.string().email().optional() }), req.body || {});
  const to = b.to || req.user.email;
  if (!to) throw bad('Nessun indirizzo a cui inviare la prova');
  const out = await sendMail({ to, subject: 'Suite TD: prova di invio', ref: 'admin:prova',
    html: layout('Prova di invio', `<p>Questa è una prova inviata da Amministrazione &gt; Impostazioni della Suite TD alle ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}.</p><p>Se la leggi, il canale di posta della Suite funziona.</p>`) });
  const esito = out?.ok ? (config.mail.provider === 'graph' ? 'SENT' : 'LOGGED') : out?.skipped ? 'SKIPPED' : 'FAILED';
  await audit(req, 'MAIL_PROVA', { entity: 'mail', entityId: to, label: to, data: { esito, errore: out?.error || null } });
  if (!out?.ok && !out?.skipped) throw bad(`Invio non riuscito: ${out?.error || 'errore sconosciuto'}`);
  res.json({ to, esito, provider: config.mail.provider, errore: out?.error || null });
}));

r.get('/admin/mail/registro', requireAdmin, ah(async (req, res) => {
  const lim = Math.min(200, Number(req.query.limit) || 50);
  res.json(await many(`SELECT id, at AS created_at, from_addr, to_addr, subject, status, error, ref FROM public.email_log ORDER BY id DESC LIMIT $1`, [lim]));
}));

export default r;
