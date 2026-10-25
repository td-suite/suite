import { Router } from 'express';
import { z } from 'zod';
import { many } from '../db.js';
import { ah, forbidden, audit, parse } from '../lib/util.js';
import { canEdit, requireRole } from '../lib/access.js';
import { sendMail, mailStatus } from '../lib/mailer.js';

const r = Router();

r.get('/status', ah(async (_req, res) => res.json(mailStatus())));

// Invio di una comunicazione con allegato PDF generato dal client (agenda del medico, proposta di collaborazione)
r.post('/invia', ah(async (req, res) => {
  if (!canEdit(req.user)) throw forbidden('Profilo in sola consultazione');
  const d = parse(z.object({
    kind: z.enum(['AGENDA_MEDICO', 'PIANO_DISPONIBILITA', 'PROPOSTA', 'CALENDARIO_SEDE', 'LIBERA']),
    to: z.array(z.string().email()).min(1).max(10),
    cc: z.array(z.string().email()).max(10).default([]),
    subject: z.string().min(3).max(200),
    body: z.string().min(1).max(6000),
    sedeId: z.string().max(40).nullable().optional(),
    attachment: z.object({ filename: z.string().max(120), base64: z.string().max(12_000_000), contentType: z.string().max(80).optional() }).nullable().optional(),
  }), req.body);
  const r2 = await sendMail({ ...d, sentBy: req.user.id, footer: `Inviata da ${req.user.full_name} tramite Room Planning di Toscana Diagnostica. Per domande rispondi a questa email.` });
  await audit(req, 'EMAIL_' + d.kind, 'email', r2.id, { to: d.to, status: r2.status });
  res.json(r2);
}));

r.get('/log', requireRole('ADMIN'), ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await many(`SELECT l.id, l.kind, l.sede_id, l.to_addr, l.cc_addr, l.subject, l.attachment_name, l.status, l.error, l.at, u.full_name AS sent_by_name FROM email_log l LEFT JOIN users u ON u.id=l.sent_by ORDER BY l.at DESC LIMIT ${limit}`));
}));

export default r;
