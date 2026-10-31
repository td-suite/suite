// Integrazione con Silva Group (gestore del magazzino di Toscana Diagnostica).
// Modello "il fornitore interroga noi" ogni 5 minuti con il segreto in ingresso del connettore SILVA (header X-API-KEY; ripiego SILVA_INBOUND_KEY):
//   POST /api/integrations/silva/stock                     feed delle giacenze di magazzino (articoli, lotti, scadenze, quantità)
//   GET  /api/integrations/silva/orders                    ordini approvati da preparare (contenuto, destinazione, urgenza)
//   POST /api/integrations/silva/orders/:numero/presa-in-carico | spedito | consegnato   avanzamento dell'ordine
// In subordine, l'Area Operations può inviare l'ordine in PDF alla casella SILVA_ORDER_EMAIL e registrare a mano gli avanzamenti.
import { config } from '../config.js';
import { connectorSync } from '../../../lib/connectors.js';
import { sendMail } from './mailer.js';
import { itDate } from './util.js';

export const silvaStatus = () => { const c = connectorSync('SILVA'); return { inboundConfigured: Boolean(config.silva.inboundKey), email: config.silva.email || null, customerCode: config.silva.customerCode, connector: { source: c.source, configured: c.configured, active: c.active, last_test_at: c.last_test_at, last_status: c.last_status } }; };

// Ordine come lo legge il fornitore: una riga per articolo, quantità in confezioni e in unità, destinazione e urgenza
export function orderPayload(order, struttura, lines) {
  return {
    numero: order.number,
    cliente: config.silva.customerCode,
    dataApprovazione: order.approved_at ? new Date(order.approved_at).toISOString() : null,
    stato: order.status,
    urgenza: order.urgent ? 'URGENTE' : 'ORDINARIA',
    motivoUrgenza: order.urgent ? order.urgent_reason || null : null,
    tipoDestinatario: order.kind === 'CLIENTE' ? 'CLIENTE_SERVICE' : order.kind === 'SEDE' ? 'SEDE_TD' : 'LABORATORIO_TD',
    origineDestinatario: struttura.origin === 'ORG' ? 'LEGAL_ENTITY' : 'SEDE',   // Legal entity (public.organizations) o sede (public.sites)
    note: order.ops_notes || null,
    destinazione: {
      codice: struttura.silva_code || struttura.code, codiceSede: struttura.code, nome: struttura.name, indirizzo: struttura.address, cap: struttura.zip, citta: struttura.city, provincia: struttura.province,
      referente: struttura.referente, telefono: struttura.referente_phone || struttura.phone, email: struttura.email, noteConsegna: struttura.delivery_notes,
      modalita: struttura.delivery_mode === 'RITIRO' ? 'RITIRO_PRESSO_TD' : 'CONSEGNA',
    },
    righe: lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => ({
      codiceArticolo: l.article_code, codiceSilva: l.silva_code || null, gtin: l.gtin || null, descrizione: l.article_name,
      confezioni: l.qty_approved, confezione: l.pack_label, unitaPerConfezione: l.pack_size, unitaTotali: l.qty_approved * l.pack_size, unita: l.unit,
      noteOperations: l.note_ops || null,
    })),
  };
}

/** Ripiego: ordine PDF via email alla casella del fornitore. Ritorna l'esito del registro invii. */
export async function emailOrder({ order, struttura, lines, pdf }) {
  if (!config.silva.email) return { status: 'FALLITA', error: 'Email ordini Silva non impostata (connettore Silva in Amministrazione > Connettori)' };
  const payload = orderPayload(order, struttura, lines);
  return sendMail({
    kind: 'ORDINE_FORNITORE', refKey: `SILVA:${order.id}:${Date.now()}`, to: config.silva.email, strutturaId: struttura.id,
    subject: `Ordine ${order.number}${order.urgent ? ' URGENTE' : ''} · consegna a ${struttura.name}`, title: `Ordine di materiale ${order.number}`,
    body: `In allegato l'ordine ${order.number} del ${itDate(payload.dataApprovazione)} da consegnare a ${struttura.name}, ${[struttura.address, struttura.zip, struttura.city].filter(Boolean).join(' ')}.\n\nRighe: ${payload.righe.length}. ${order.urgent ? 'Ordine urgente: ' + (order.urgent_reason || '') : 'Consegna con il primo giro utile.'}\n\nL'avanzamento (presa in carico, spedizione, consegna) va comunicato tramite le API di Orders Management.`,
    attachment: pdf ? { filename: `${order.number}.pdf`, content: pdf } : null,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Trasmissione in API al gestionale Silva (fase 2 → 3, richiesta del CEO del 31/10/2026): all'approvazione l'ordine viene inviato con
// POST {base}/api/v1/ordini (chiave X-API-KEY del connettore, stessa dell'API catalogo). Idempotente sul numero d'ordine
// (header X-Idempotency-Key = numero; 200/201 = ricevuto, 409 = già presente: va bene). Se Silva non risponde si ritenta dal job
// orders:silva-push ogni 5 minuti finché l'ordine resta APPROVATO; il polling GET /api/orders/integrations/silva/orders resta come
// seconda via. Specifica consegnata a Silva: docs/SILVA_API_ORDINI.md.
import { getConnector as _getConnector, logConnector as _logConnector } from '../../../lib/connectors.js';
import { one as _one, many as _many, q as _q } from '../db.js';
import { orderLines as _orderLines } from './orders.js';

const SILVA_DEFAULT_BASE = 'https://silva.cloud/portaleordini';
const pushEnabled = (c) => c.enabled && Boolean(c.credentials?.api_key) && String(c.settings?.push_orders ?? 'true') !== 'false';

export async function pushOrderToSilva(orderId, { actor = 'sistema' } = {}) {
  const c = await _getConnector('SILVA');
  if (!pushEnabled(c)) return { skipped: !c.credentials?.api_key ? 'chiave API Silva assente' : 'trasmissione in API disattivata nel connettore' };
  const o = await _one(`SELECT o.*, s.name AS struttura_name FROM orders o JOIN strutture_v s ON s.id=o.struttura_id WHERE o.id=$1`, [orderId]);
  if (!o) throw new Error('Ordine inesistente');
  if (o.status !== 'APPROVATO') return { skipped: `ordine ${o.status}: si trasmette solo APPROVATO` };
  const s = await _one('SELECT * FROM strutture_v WHERE id=$1', [o.struttura_id]);
  const payload = orderPayload(o, s, await _orderLines(o.id));
  const url = `${String(c.base_url || SILVA_DEFAULT_BASE).replace(/\/+$/, '')}/api/v1/ordini`;
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': c.credentials.api_key, 'X-Idempotency-Key': o.number }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    text = await res.text();
  } catch (e) {
    const msg = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'nessuna risposta entro 30 s' : `non raggiungibile: ${e.cause?.message || e.message}`;
    await _q(`UPDATE orders SET silva_send_status='ERRORE', silva_send_message=$2, silva_send_attempts=silva_send_attempts+1, silva_last_attempt_at=now() WHERE id=$1`, [o.id, msg]);
    _logConnector({ kind: 'SILVA', direction: 'OUT', module: 'orders', endpoint: `POST ${url}`, status: 'ERRORE', ms: Date.now() - t0, message: `${o.number}: ${msg}` });
    return { ok: false, message: msg };
  }
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  const ok = res.ok || res.status === 409;
  const riferimento = data?.riferimento || data?.id || data?.numeroInterno || null;
  const msg = ok ? (res.status === 409 ? 'già presente presso Silva' : `ricevuto da Silva${riferimento ? ` (rif. ${riferimento})` : ''}`) : `Silva risponde ${res.status}: ${(data && (data.message || data.error || data.title)) || text.slice(0, 200)}`;
  await _q(`UPDATE orders SET silva_send_status=$2, silva_send_message=$3, silva_send_attempts=silva_send_attempts+1, silva_last_attempt_at=now(), silva_sent_at=CASE WHEN $4 THEN now() ELSE silva_sent_at END,
            silva_reference=coalesce($5, silva_reference), updated_at=now() WHERE id=$1`, [o.id, ok ? 'INVIATO' : 'ERRORE', msg, ok, riferimento]);
  if (ok) await _q('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,NULL,$2,$3)', [o.id, `Trasmesso in API al magazzino Silva (${actor})`, JSON.stringify({ status: res.status, riferimento })]);
  _logConnector({ kind: 'SILVA', direction: 'OUT', module: 'orders', endpoint: `POST ${url}`, status: res.status, ms: Date.now() - t0, message: `${o.number}: ${msg}` });
  return { ok, status: res.status, message: msg, riferimento };
}

/** Job: ritenta gli ordini APPROVATO non ancora trasmessi (o in errore), al massimo ogni 5 minuti per ordine, fino a 50 tentativi */
export async function pushPendingOrders() {
  const c = await _getConnector('SILVA');
  if (!pushEnabled(c)) return { skipped: 'trasmissione in API non attiva' };
  const rows = await _many(`SELECT id, number FROM orders WHERE status='APPROVATO' AND (silva_send_status IS DISTINCT FROM 'INVIATO') AND silva_send_attempts < 50
    AND (silva_last_attempt_at IS NULL OR silva_last_attempt_at < now() - interval '5 minutes') ORDER BY urgent DESC, approved_at LIMIT 20`);
  const esiti = [];
  for (const r of rows) { try { esiti.push({ numero: r.number, ...(await pushOrderToSilva(r.id, { actor: 'ritentativo automatico' })) }); } catch (e) { esiti.push({ numero: r.number, ok: false, message: e.message }); } }
  return { tentati: rows.length, esiti };
}
