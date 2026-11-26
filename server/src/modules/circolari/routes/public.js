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

// Conferma di lettura (v0.99.4): il collegamento personale dell'email apre una pagina con il pulsante; la conferma si registra solo
// premendo il pulsante (POST), così i controlli automatici della posta che aprono i collegamenti non confermano al posto della persona
const pagina = (titolo, corpo) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titolo}</title></head><body style="margin:0;background:#f3f6f6;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33"><div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #dbe5e7;border-radius:12px;overflow:hidden"><div style="background:#01212C;color:#fff;padding:16px 22px;font-weight:700">Toscana Diagnostica <span style="color:#71B1BD;font-weight:600">· Circolari</span></div><div style="padding:24px">${corpo}</div></div></body></html>`;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
async function destinatario(token, codice) {
  const c = await resolve(token);
  if (!/^[a-f0-9]{24}$/.test(codice)) throw notFound('Collegamento non valido');
  const d = await one('SELECT d.* FROM invii_destinatari d JOIN circolari x ON x.id = d.circolare_id WHERE d.codice = $1 AND x.pub_token = $2', [codice, token]);
  if (!d) throw notFound('Collegamento non valido');
  return { c, d };
}
r.get('/:token/conferma/:codice', ah(async (req, res) => {
  const { c, d } = await destinatario(req.params.token, req.params.codice);
  await q('UPDATE invii_destinatari SET aperta_at = coalesce(aperta_at, now()) WHERE id = $1', [d.id]);
  const base = `/api/circolari/pub/${req.params.token}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.send(pagina(`Circolare ${esc(c.protocollo)}`, `<h2 style="margin:0 0 6px;color:#1C505E;font-size:19px">Circolare ${esc(c.protocollo)}</h2><p style="margin:0 0 18px"><b>${esc(c.titolo)}</b></p>${d.confermata_at
    ? `<p style="color:#1c7a4a;font-weight:600">Lettura già confermata da ${esc(d.email)}.</p>`
    : `<form method="post" action="${base}/conferma/${req.params.codice}"><button style="background:#1C505E;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Confermo di aver letto la circolare</button></form><p style="font-size:12px;color:#5b6f75;margin-top:10px">La conferma viene registrata per l'indirizzo ${esc(d.email)}.</p>`}
    <p style="margin-top:18px"><a href="${base}?d=${req.params.codice}" style="color:#1C505E">Apri la circolare</a></p>`));
}));
r.post('/:token/conferma/:codice', ah(async (req, res) => {
  const { c, d } = await destinatario(req.params.token, req.params.codice);
  await q('UPDATE invii_destinatari SET aperta_at = coalesce(aperta_at, now()), confermata_at = coalesce(confermata_at, now()) WHERE id = $1', [d.id]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.send(pagina('Lettura confermata', `<h2 style="margin:0 0 6px;color:#1C505E;font-size:19px">Lettura confermata</h2><p>Grazie. La lettura della circolare ${esc(c.protocollo)} è stata registrata per ${esc(d.email)}.</p><p><a href="/api/circolari/pub/${req.params.token}?d=${req.params.codice}" style="color:#1C505E">Apri la circolare</a></p>`));
}));

r.get('/:token', ah(async (req, res) => {
  const c = await resolve(req.params.token);
  // collegamento personale dell'email: registra l'apertura per quel destinatario
  if (/^[a-f0-9]{24}$/.test(String(req.query.d || ''))) await q('UPDATE invii_destinatari SET aperta_at = coalesce(aperta_at, now()) WHERE codice = $1', [req.query.d]).catch(() => {});
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
