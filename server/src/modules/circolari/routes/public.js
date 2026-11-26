// Versione digitale della circolare raggiunta dal QR code: GET /api/circolari/pub/:token (PDF) e /:token/info (JSON).
// Nessuna sessione, nessun dato personale: il token è casuale e assegnato alla pubblicazione. Una circolare superata
// rimanda all'ultima revisione in vigore dello stesso protocollo.
import express, { Router } from 'express';
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
// SOLO per le email già partite con la 0.99.9 (circolare TD-2026/002 del 26/11/2026: una email con tutti in Ccn e collegamento uguale
// per tutti). Dalla 0.99.10 i collegamenti sono personali e questa pagina non è più usata dai nuovi invii. La pagina chiede
// l'indirizzo e conferma solo se è tra i destinatari di un invio di questa circolare; non dice mai chi sono gli altri destinatari.
const modulo = (c, token, messaggio = '', valore = '') => pagina(`Circolare ${esc(c.protocollo)}`, `<h2 style="margin:0 0 6px;color:#1C505E;font-size:19px">Circolare ${esc(c.protocollo)}</h2><p style="margin:0 0 18px"><b>${esc(c.titolo)}</b></p>${messaggio}
  <form method="post" action="/api/circolari/pub/${token}/conferma"><label style="display:block;font-size:14px;margin-bottom:6px">Indirizzo email a cui ha ricevuto la circolare</label>
  <input type="email" name="email" required value="${esc(valore)}" autocomplete="email" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #b9c9cd;border-radius:8px;font-size:15px;margin-bottom:14px">
  <button style="background:#1C505E;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Confermo di aver letto la circolare</button></form>
  <p style="margin-top:18px"><a href="/api/circolari/pub/${token}" style="color:#1C505E">Apri la circolare</a></p>`);
r.get('/:token/conferma', ah(async (req, res) => {
  const c = await resolve(req.params.token);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.send(modulo(c, req.params.token));
}));
r.post('/:token/conferma', express.urlencoded({ extended: false, limit: '2kb' }), ah(async (req, res) => {
  const c = await resolve(req.params.token);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  const righe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? (await q(`UPDATE invii_destinatari d SET aperta_at = coalesce(d.aperta_at, now()), confermata_at = coalesce(d.confermata_at, now())
      FROM circolari x WHERE x.id = d.circolare_id AND x.anno = $1 AND x.numero = $2 AND lower(d.email) = $3 AND d.inviata RETURNING d.id`, [c.anno, c.numero, email])).rowCount : 0;
  if (!righe) return res.status(404).send(modulo(c, req.params.token, '<p style="color:#b3261e;font-weight:600">Questo indirizzo non risulta tra i destinatari della circolare. Indichi l\'indirizzo a cui l\'ha ricevuta.</p>', email));
  res.send(pagina('Lettura confermata', `<h2 style="margin:0 0 6px;color:#1C505E;font-size:19px">Lettura confermata</h2><p>Grazie. La lettura della circolare ${esc(c.protocollo)} è stata registrata per ${esc(email)}.</p><p><a href="/api/circolari/pub/${req.params.token}" style="color:#1C505E">Apri la circolare</a></p>`));
}));

// v0.99.10 (CEO: "cliccando su conferma, basta"): il collegamento personale conferma con UN clic. La pagina che si apre invia da sola
// la conferma (una riga di script); i controlli automatici della posta, che aprono i collegamenti senza eseguire la pagina, non
// confermano al posto della persona. Senza script resta il pulsante.
r.get('/:token/conferma/:codice', ah(async (req, res) => {
  const { c, d } = await destinatario(req.params.token, req.params.codice);
  await q('UPDATE invii_destinatari SET aperta_at = coalesce(aperta_at, now()) WHERE id = $1', [d.id]);
  const base = `/api/circolari/pub/${req.params.token}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'");
  res.send(pagina(`Circolare ${esc(c.protocollo)}`, `<h2 style="margin:0 0 6px;color:#1C505E;font-size:19px">Circolare ${esc(c.protocollo)}</h2><p style="margin:0 0 18px"><b>${esc(c.titolo)}</b></p>${d.confermata_at
    ? `<p style="color:#1c7a4a;font-weight:600">Lettura già confermata da ${esc(d.email)}.</p>`
    : `<form id="conferma" method="post" action="${base}/conferma/${req.params.codice}"><p id="attesa" style="display:none;color:#5b6f75">Registro la conferma di lettura…</p><noscript><p>Prema il pulsante per confermare la lettura.</p></noscript><button id="pulsante" style="background:#1C505E;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Confermo di aver letto la circolare</button></form><script>document.getElementById('pulsante').style.display='none';document.getElementById('attesa').style.display='block';document.getElementById('conferma').submit();</script>`}
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
