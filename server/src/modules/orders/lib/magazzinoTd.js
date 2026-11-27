// Magazzino TD (v0.99.14, CEO 28/11/2026): il magazzino interno di Toscana Diagnostica, gestito dall'Area Operations.
//  - Articoli interni (articles.source = 'TD'): non sono e non saranno mai nel magazzino di Silva, quindi non hanno codice Silva.
//  - Un ordine approvato con articoli TD non va a Silva: se è tutto TD cambia canale (orders.channel = 'TD'); se è misto si DIVIDE, le
//    righe TD passano a un ordine figlio "<numero>-TD" e la parte Silva prosegue come sempre. L'ordine TD parte per email verso la
//    casella del magazzino interno (impostazione td_warehouse_email, acquisti@toscanadiagnostica.it).
//  - La giacenza è la somma dei movimenti (td_stock_movements, confezioni con segno): CARICO, RETTIFICA e USCITA. Scala quando la merce
//    ESCE verso il destinatario (registraUscita → ordine SPEDITO), non all'approvazione né alla consegna.
import { one, many, q, tx } from '../db.js';
import { bad, notFound, getSetting, itDate } from './util.js';
import { sendMail } from './mailer.js';
import { event, markShipped } from './orderflow.js';

export const EMAIL_PREDEFINITA = 'acquisti@toscanadiagnostica.it';
export const emailMagazzinoTd = async () => String((await getSetting('td_warehouse_email', EMAIL_PREDEFINITA)) || EMAIL_PREDEFINITA).trim();

/**
 * Regola pura della divisione: righe { id, source, qty } → { canale: 'SILVA' | 'TD' | 'MISTO', td: [id delle righe TD] }.
 * Contano le sole righe con quantità approvata; senza righe TD con quantità l'ordine resta a Silva.
 */
export function canaleOrdine(righe) {
  const piene = righe.filter((r) => Number(r.qty) > 0);
  const td = piene.filter((r) => r.source === 'TD');
  if (!td.length) return { canale: 'SILVA', td: [] };
  if (td.length === piene.length) return { canale: 'TD', td: righe.filter((r) => r.source === 'TD').map((r) => r.id) };
  return { canale: 'MISTO', td: righe.filter((r) => r.source === 'TD').map((r) => r.id) };
}

/**
 * All'approvazione: assegna il canale all'ordine e, se misto, sposta le righe TD in un ordine figlio già approvato.
 * Ritorna { canale: 'SILVA' | 'TD', figlio: { id, number } | null } dove canale è quello dell'ordine di partenza.
 */
export async function dividiPerMagazzino(orderId, userId = null) {
  return tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!o) throw notFound();
    if (o.channel === 'TD' || o.parent_order_id) return { canale: o.channel, figlio: null };
    const righe = (await c.query(`SELECT l.id, a.source, coalesce(l.qty_approved, l.qty_requested, 0) AS qty FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1`, [orderId])).rows;
    const d = canaleOrdine(righe);
    if (d.canale === 'SILVA') return { canale: 'SILVA', figlio: null };
    if (d.canale === 'TD') {
      await c.query(`UPDATE orders SET channel='TD', updated_at=now() WHERE id=$1`, [orderId]);
      await c.query('INSERT INTO order_events (order_id, user_id, event) VALUES ($1,$2,$3)', [orderId, userId, 'Ordine del Magazzino TD: articoli interni, non si trasmette a Silva']);
      return { canale: 'TD', figlio: null };
    }
    const number = `${o.number}-TD`;
    const figlio = (await c.query(`INSERT INTO orders (number, struttura_id, kind, origin, status, urgent, urgent_reason, notes, client_ref, requested_by, delivery_site_id, approved_by, approved_at, submitted_at, ops_notes, channel, parent_order_id)
      SELECT $2, struttura_id, kind, origin, status, urgent, urgent_reason, notes, client_ref, requested_by, delivery_site_id, approved_by, approved_at, submitted_at, ops_notes, 'TD', id FROM orders WHERE id=$1 RETURNING id`, [orderId, number])).rows[0];
    await c.query('UPDATE order_lines SET order_id=$2 WHERE order_id=$1 AND id = ANY($3::int[])', [orderId, figlio.id, d.td]);
    await c.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [orderId, userId, `Ordine diviso: ${d.td.length} ${d.td.length === 1 ? 'articolo interno passa' : 'articoli interni passano'} all'ordine ${number} del Magazzino TD`, JSON.stringify({ figlio: figlio.id, number })]);
    await c.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [figlio.id, userId, `Creato dalla divisione dell'ordine ${o.number}: articoli del Magazzino TD, approvato`, JSON.stringify({ origine: orderId, number: o.number })]);
    return { canale: 'SILVA', figlio: { id: figlio.id, number } };
  });
}

const righeOrdine = (orderId) => many(`SELECT l.id, l.article_id, l.qty_approved, l.qty_requested, l.note_client, l.note_ops, a.code AS article_code, a.name AS article_name, a.pack_label, a.unit,
    coalesce((SELECT sum(m.qty) FROM td_stock_movements m WHERE m.article_id=a.id),0)::int AS giacenza,
    coalesce((SELECT -sum(m.qty) FROM td_stock_movements m WHERE m.line_id=l.id AND m.kind='USCITA'),0)::int AS uscite
  FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1 ORDER BY a.name`, [orderId]);

/** Email dell'ordine al Magazzino TD (con il PDF dell'ordine in allegato, se c'è). ripeti = nuovo invio voluto dall'operatore. */
export async function avvisaMagazzinoTd(order, { pdf = null, userId = null, ripeti = false } = {}) {
  const to = await emailMagazzinoTd();
  const righe = (await righeOrdine(order.id)).filter((l) => (l.qty_approved || 0) > 0);
  const dove = order.struttura_label || order.struttura_name || '';
  const indirizzo = (order.delivery_site_id ? [order.delivery_site_address, order.delivery_site_zip, order.delivery_site_city] : []).filter(Boolean).join(' ');
  const body = [`Ordine ${order.number} per il Magazzino TD, approvato il ${itDate(order.approved_at || new Date())}.`, `Destinatario: ${dove}${indirizzo ? `, ${indirizzo}` : ''}.`,
    order.urgent ? `URGENTE: ${order.urgent_reason || 'motivo non indicato'}.` : null, '',
    ...righe.map((l) => `${l.qty_approved} × ${l.article_name} (${l.article_code}${l.pack_label ? `, ${l.pack_label}` : ''})${l.note_ops ? ` · ${l.note_ops}` : ''}`), '',
    order.ops_notes ? `Note dell'Area Operations: ${order.ops_notes}` : null,
    'Quando la merce esce verso il destinatario registra l\'uscita in Ordini e Magazzino › Magazzino TD › Ordini da evadere: la giacenza scala in quel momento.'].filter((x) => x !== null).join('\n');
  const out = await sendMail({ kind: 'ORDINE_MAGAZZINO_TD', refKey: ripeti ? `TD:${order.id}:${Date.now()}` : `TD:${order.id}`, to, strutturaId: order.struttura_id, sentBy: userId,
    subject: `Ordine ${order.number}${order.urgent ? ' URGENTE' : ''} · Magazzino TD · ${dove}`, title: `Ordine ${order.number} per il Magazzino TD`, body,
    attachment: pdf ? { filename: `${order.number}.pdf`, content: pdf } : null });
  if (out.status === 'INVIATA') await q('UPDATE orders SET td_email_at=now() WHERE id=$1', [order.id]);
  if (out.status !== 'DUPLICATA') await event(order.id, userId, out.status === 'INVIATA' ? `Ordine inviato al Magazzino TD (${to})` : `Invio al Magazzino TD non riuscito (${out.error || out.status}): l'ordine resta in "Ordini da evadere"`, { to, status: out.status });
  return { ...out, to };
}

/** Articoli interni con giacenza, confezioni impegnate dagli ordini TD approvati e non ancora usciti, sotto scorta. */
export async function giacenzeTd() {
  return many(`SELECT a.id, a.code, a.name, a.category_code, c.name AS category_name, a.unit, a.pack_size, a.pack_label, a.min_stock_packs, a.active,
      a.visible_all, a.visible_sedi, a.visible_poli, a.visible_lab, a.visible_service,
      coalesce((SELECT sum(m.qty) FROM td_stock_movements m WHERE m.article_id=a.id),0)::int AS giacenza,
      coalesce((SELECT sum(l.qty_approved) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.article_id=a.id AND o.channel='TD' AND o.status IN ('APPROVATO','PRESO_IN_CARICO')),0)::int AS impegnate,
      (SELECT max(m.created_at) FROM td_stock_movements m WHERE m.article_id=a.id) AS ultimo_movimento
    FROM articles a JOIN categories c ON c.code=a.category_code WHERE a.source='TD' ORDER BY a.active DESC, a.name`);
}

/** Carico (qty > 0) o rettifica (qty con segno, nota obbligatoria). La giacenza non scende mai sotto zero. */
export async function registraMovimento({ article_id, kind, qty, lot = null, expiry = null, note = null }, userId = null) {
  const n = Math.round(Number(qty));
  if (!['CARICO', 'RETTIFICA'].includes(kind)) throw bad('Movimento non valido');
  if (!n) throw bad('Quantità obbligatoria');
  if (kind === 'CARICO' && n < 0) throw bad('Il carico è una quantità positiva: per togliere usa la rettifica');
  if (kind === 'RETTIFICA' && !String(note || '').trim()) throw bad('La rettifica vuole il motivo');
  return tx(async (c) => {
    const a = (await c.query(`SELECT id, name FROM articles WHERE id=$1 AND source='TD' FOR UPDATE`, [article_id])).rows[0];
    if (!a) throw bad('Articolo del Magazzino TD inesistente');
    const g = Number((await c.query('SELECT coalesce(sum(qty),0)::int AS g FROM td_stock_movements WHERE article_id=$1', [a.id])).rows[0].g);
    if (g + n < 0) throw bad(`Giacenza insufficiente: ${a.name} ha ${g} confezioni`);
    const row = (await c.query(`INSERT INTO td_stock_movements (article_id, kind, qty, lot, expiry, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [a.id, kind, n, lot || null, expiry || null, note || null, userId])).rows[0];
    return { id: row.id, giacenza: g + n };
  });
}

/** Ordini del Magazzino TD da evadere (approvati, non ancora usciti) e usciti in attesa di consegna, con le righe e la giacenza. */
export async function ordiniTd() {
  const rows = await many(`SELECT o.id, o.number, o.status, o.urgent, o.urgent_reason, o.approved_at, o.shipped_at, o.td_email_at, o.parent_order_id, o.ops_notes, po.number AS parent_number,
      s.name || coalesce(' · ' || ds.name, '') AS struttura_label, coalesce(ds.city, s.city) AS city
    FROM orders o JOIN strutture_v s ON s.id=o.struttura_id LEFT JOIN public.sites ds ON ds.id=o.delivery_site_id LEFT JOIN orders po ON po.id=o.parent_order_id
   WHERE o.channel='TD' AND o.status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO') ORDER BY (o.status='SPEDITO'), o.urgent DESC, o.approved_at`);
  for (const o of rows) o.lines = await righeOrdine(o.id);
  return rows;
}

/**
 * Uscita della merce verso il destinatario: scala la giacenza delle quantità uscite (per riga, al massimo l'approvato e la giacenza) e
 * porta l'ordine a SPEDITO. lines: [{ line_id, qty }]; senza lines escono le quantità approvate. Una riga può uscire in parte o a zero:
 * resta scritto nell'evento, la parte non uscita non viene più evasa da questo ordine.
 */
export async function registraUscita(orderId, { lines = null, ddt = null, note = null, userId = null, actor = 'Magazzino TD' } = {}) {
  const esito = await tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!o) throw notFound();
    if (o.channel !== 'TD') throw bad('L\'uscita si registra solo per gli ordini del Magazzino TD');
    if (!['APPROVATO', 'PRESO_IN_CARICO'].includes(o.status)) throw bad(`Ordine ${o.status}: l'uscita si registra una sola volta, su un ordine approvato`);
    const righe = (await c.query(`SELECT l.id, l.article_id, coalesce(l.qty_approved,0)::int AS qty_approved, a.name FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1 ORDER BY l.article_id FOR UPDATE OF a`, [orderId])).rows;
    const chiesto = new Map((lines || []).map((l) => [Number(l.line_id), Math.max(0, Math.round(Number(l.qty) || 0))]));
    const perArticolo = new Map(); const uscite = []; const parziali = [];
    for (const l of righe) {
      const n = lines ? (chiesto.get(l.id) ?? 0) : l.qty_approved;
      if (n > l.qty_approved) throw bad(`${l.name}: escono ${n} confezioni ma ne sono approvate ${l.qty_approved}`);
      if (n < l.qty_approved) parziali.push(`${l.name} ${n} di ${l.qty_approved}`);
      if (!n) continue;
      perArticolo.set(l.article_id, (perArticolo.get(l.article_id) || 0) + n); uscite.push({ ...l, n });
    }
    if (!uscite.length) throw bad('Nessuna confezione in uscita: indica le quantità che escono');
    for (const [aid, n] of perArticolo) {
      const g = Number((await c.query('SELECT coalesce(sum(qty),0)::int AS g FROM td_stock_movements WHERE article_id=$1', [aid])).rows[0].g);
      if (n > g) throw bad(`Giacenza insufficiente: ${uscite.find((u) => u.article_id === aid).name} ha ${g} confezioni, ne escono ${n}. Carica la merce o riduci la quantità`);
    }
    for (const u of uscite) await c.query(`INSERT INTO td_stock_movements (article_id, kind, qty, order_id, line_id, note, user_id) VALUES ($1,'USCITA',$2,$3,$4,$5,$6)`, [u.article_id, -u.n, orderId, u.id, note || `Ordine ${o.number}`, userId]);
    return { confezioni: uscite.reduce((s, u) => s + u.n, 0), parziali };
  });
  const o = await one('SELECT * FROM orders WHERE id=$1', [orderId]);
  await markShipped(o, { ddt, userId, actor, label: `Uscita dal Magazzino TD verso il destinatario: ${esito.confezioni} confezioni, giacenza scalata${esito.parziali.length ? ` · uscita parziale: ${esito.parziali.join(', ')}` : ''}`, data: { confezioni: esito.confezioni, parziali: esito.parziali } });
  return { status: 'SPEDITO', ...esito };
}

/** Righe di consegna di un ordine TD dalle uscite registrate (per markDelivered): [{ codiceArticolo, confezioni }]. */
export async function righeUscite(orderId) {
  return (await many(`SELECT a.code, -sum(m.qty)::int AS n FROM td_stock_movements m JOIN articles a ON a.id=m.article_id WHERE m.order_id=$1 AND m.kind='USCITA' GROUP BY a.code HAVING -sum(m.qty) > 0`, [orderId]))
    .map((x) => ({ codiceArticolo: x.code, confezioni: x.n }));
}
