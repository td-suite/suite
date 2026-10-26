// Versione digitale della circolare raggiunta dal QR code: GET /api/circolari/pub/:token (PDF) e /:token/info (JSON).
// Nessuna sessione, nessun dato personale: il token è casuale e assegnato alla pubblicazione. Una circolare superata
// rimanda all'ultima revisione in vigore dello stesso protocollo.
import { Router } from 'express';
import { one, q } from '../db.js';
import { ah, notFound } from '../../../lib/util.js';

const r = Router();

async function resolve(token) {
  if (!/^[a-f0-9]{24}$/.test(token)) throw notFound('Circolare non trovata');
  let c = await one(`SELECT id, anno, numero, revisione, protocollo, stato, titolo, data, published_at, pdf IS NOT NULL AS has_pdf FROM circolari WHERE pub_token=$1`, [token]);
  if (!c || c.stato === 'BOZZA' || c.stato === 'ANNULLATA') throw notFound('Circolare non trovata');
  if (c.stato === 'SUPERATA') {
    const latest = await one(`SELECT id, anno, numero, revisione, protocollo, stato, titolo, data, published_at, pdf IS NOT NULL AS has_pdf FROM circolari WHERE anno=$1 AND numero=$2 AND stato='PUBBLICATA' ORDER BY revisione DESC LIMIT 1`, [c.anno, c.numero]);
    if (latest) c = { ...latest, superata: true };
  }
  return c;
}

r.get('/:token/info', ah(async (req, res) => {
  const c = await resolve(req.params.token);
  res.json({ protocollo: c.protocollo, revisione: c.revisione, titolo: c.titolo, data: c.data, stato: c.stato, pdf: c.has_pdf });
}));

r.get('/:token', ah(async (req, res) => {
  const c = await resolve(req.params.token);
  const row = await one('SELECT pdf, docx FROM circolari WHERE id=$1', [c.id]);
  await q('INSERT INTO letture (circolare_id) VALUES ($1)', [c.id]).catch(() => {});
  if (row?.pdf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Circolare ${c.protocollo.replace(/[\/]/g, '-')}.pdf"`);
    return res.send(row.pdf);
  }
  if (row?.docx) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Circolare ${c.protocollo.replace(/[\/]/g, '-')}.docx"`);
    return res.send(row.docx);
  }
  throw notFound('Documento non disponibile');
}));

export default r;
