// Tracciamento spedizioni. SDA (Poste Italiane) tramite aggregatore (17TRACK o AfterShip), FedEx tramite API ufficiale Track.
// Senza configurazione resta il tracciamento manuale: l'operatore registra consegna e ricezione a mano.
// Nota: i tracciati delle API degli aggregatori vanno verificati sulla documentazione corrente del fornitore scelto al momento dell'attivazione.
import { config } from '../config.js';
import { many, q, one, tx } from '../db.js';
import { logEvent } from './util.js';

export const trackingUrl = (carrier, n) => {
  if (!n) return null;
  if (carrier === 'FEDEX') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`;
  return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(n)}`;
};

export const trackingStatus = () => ({
  sda: config.tracking.provider !== 'none' && Boolean(config.tracking.apiKey) ? config.tracking.provider : null,
  fedex: Boolean(config.tracking.fedexClientId && config.tracking.fedexClientSecret),
});

// ---- Normalizzazione stato ----
function normalize(code) {
  const c = String(code || '').toLowerCase();
  if (/deliver/.test(c) && !/out|attempt|fail/.test(c)) return 'DELIVERED';
  if (/out.?for.?delivery|outfordelivery|in consegna/.test(c)) return 'OUT_FOR_DELIVERY';
  if (/transit|accept|pickup|picked|in viaggio|inforeceived|info_received|departed|arrived/.test(c)) return 'IN_TRANSIT';
  if (/exception|fail|undeliver|return|expired|giacenza|alert/.test(c)) return 'EXCEPTION';
  if (!c) return 'UNKNOWN';
  return 'UNKNOWN';
}

// ---- 17TRACK (api.17track.net v2.2) ----
const SDA_17TRACK_CARRIER = 100047; // codice SDA in 17TRACK: da confermare sulla lista carrier del fornitore
async function t17(path, body) {
  const res = await fetch(`https://api.17track.net/track/v2.2/${path}`, { method: 'POST', headers: { '17token': config.tracking.apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`17TRACK ${res.status}`);
  return j;
}
async function track17(sh) {
  if (!sh.provider_registered) {
    const r = await t17('register', [{ number: sh.tracking_number, carrier: SDA_17TRACK_CARRIER }]);
    const rej = r?.data?.rejected?.[0];
    if (rej && rej.error?.code !== -18019901 /* già registrato */) throw new Error(rej.error?.message || 'Registrazione rifiutata');
    await q('UPDATE shipments SET provider_registered=TRUE WHERE id=$1', [sh.id]);
  }
  const r = await t17('gettrackinfo', [{ number: sh.tracking_number, carrier: SDA_17TRACK_CARRIER }]);
  const acc = r?.data?.accepted?.[0];
  if (!acc) return null;
  const info = acc.track_info || {};
  const latest = info.latest_event || {};
  const status = info.latest_status?.status || '';
  const events = (info.tracking?.providers?.[0]?.events || []).slice(0, 30).map((e) => ({ at: e.time_utc || e.time_iso, text: e.description, place: e.location }));
  return { status: normalize(status), text: latest.description || status, at: latest.time_utc || latest.time_iso || null, events };
}

// ---- AfterShip (api.aftership.com/v4) ----
async function as(path, init = {}) {
  const res = await fetch(`https://api.aftership.com/v4${path}`, { ...init, headers: { 'as-api-key': config.tracking.apiKey, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 4003) throw new Error(`AfterShip ${res.status}: ${j?.meta?.message || ''}`);
  return j;
}
async function trackAftership(sh) {
  const slug = sh.carrier === 'FEDEX' ? 'fedex' : 'sda-it';
  if (!sh.provider_registered) {
    await as('/trackings', { method: 'POST', body: JSON.stringify({ tracking: { tracking_number: sh.tracking_number, slug } }) }).catch((e) => { if (!/4003|already exists/i.test(e.message)) throw e; });
    await q('UPDATE shipments SET provider_registered=TRUE WHERE id=$1', [sh.id]);
  }
  const r = await as(`/trackings/${slug}/${encodeURIComponent(sh.tracking_number)}`);
  const t = r?.data?.tracking;
  if (!t) return null;
  const cps = (t.checkpoints || []).slice(-30).reverse();
  return { status: normalize(t.tag), text: cps[0]?.message || t.tag, at: cps[0]?.checkpoint_time || null, events: cps.map((c) => ({ at: c.checkpoint_time, text: c.message, place: c.location })) };
}

// ---- FedEx Track API ----
let fxToken = { value: null, exp: 0 };
async function fedexToken() {
  if (fxToken.value && Date.now() < fxToken.exp - 60_000) return fxToken.value;
  const res = await fetch(`${config.tracking.fedexBase}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.tracking.fedexClientId, client_secret: config.tracking.fedexClientSecret }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`FedEx token ${res.status}`);
  fxToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function trackFedex(sh) {
  const token = await fedexToken();
  const res = await fetch(`${config.tracking.fedexBase}/track/v1/trackingnumbers`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-locale': 'en_US' },
    body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: sh.tracking_number } }] }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`FedEx track ${res.status}`);
  const r = j?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!r || r.error) return null;
  const ls = r.latestStatusDetail || {};
  const events = (r.scanEvents || []).slice(0, 30).map((e) => ({ at: e.date, text: e.eventDescription, place: [e.scanLocation?.city, e.scanLocation?.countryCode].filter(Boolean).join(', ') }));
  return { status: normalize(ls.code === 'DL' ? 'delivered' : ls.derivedCode || ls.code), text: ls.description || ls.statusByLocale, at: events[0]?.at || null, events };
}

export async function fetchTracking(sh) {
  if (sh.carrier === 'FEDEX') {
    if (trackingStatus().fedex) return trackFedex(sh);
    if (config.tracking.provider === 'aftership' && config.tracking.apiKey) return trackAftership(sh);
    return null;
  }
  if (config.tracking.provider === '17track' && config.tracking.apiKey) return track17(sh);
  if (config.tracking.provider === 'aftership' && config.tracking.apiKey) return trackAftership(sh);
  return null;
}

// Applica un aggiornamento di tracking a una spedizione e propaga la consegna alla richiesta
export async function applyTracking(shipmentId, upd, source = 'AUTO', userId = null) {
  return tx(async (c) => {
    const sh = (await c.query('SELECT * FROM shipments WHERE id=$1 FOR UPDATE', [shipmentId])).rows[0];
    if (!sh) return null;
    const delivered = upd.status === 'DELIVERED';
    const deliveredAt = delivered ? (upd.at || new Date()) : sh.delivered_at;
    const shippedAt = sh.shipped_at || (['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(upd.status) ? (upd.events?.[upd.events.length - 1]?.at || new Date()) : null);
    await c.query(`UPDATE shipments SET last_status=$2, last_status_text=$3, last_event_at=$4, last_checked_at=now(), check_error=NULL, events=$5, delivered_at=$6, shipped_at=$7, updated_at=now() WHERE id=$1`,
      [sh.id, upd.status, upd.text || null, upd.at || null, JSON.stringify(upd.events || []), deliveredAt, shippedAt]);
    if (sh.last_status !== upd.status) await logEvent(c, { orderId: sh.order_id, event: 'TRACKING', data: { direction: sh.direction, status: upd.status, text: upd.text, source }, userId });
    if (delivered && sh.order_id) {
      const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [sh.order_id])).rows[0];
      if (sh.direction === 'OUTBOUND' && o && o.status === 'SHIPPED') {
        await c.query(`UPDATE orders SET status='DELIVERED', delivered_at=$2, updated_at=now() WHERE id=$1`, [o.id, deliveredAt]);
        await c.query(`UPDATE kits SET status='DELIVERED', updated_at=now() WHERE id=$1`, [o.kit_id]);
        await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'DELIVERED', data: { source }, userId });
      }
    }
    if (delivered && sh.direction === 'LAB' && sh.lab_shipment_id) {
      await c.query(`UPDATE lab_shipments SET status='DELIVERED', delivered_at=$2, updated_at=now() WHERE id=$1 AND status='SHIPPED'`, [sh.lab_shipment_id, deliveredAt]);
      const ords = (await c.query(`UPDATE orders SET status='CLOSED', closed_at=$2, updated_at=now() WHERE lab_shipment_id=$1 AND status='SHIPPED_TO_LAB' RETURNING id, kit_id`, [sh.lab_shipment_id, deliveredAt])).rows;
      for (const o of ords) { await c.query(`UPDATE kits SET status='CLOSED', updated_at=now() WHERE id=$1`, [o.kit_id]); await logEvent(c, { orderId: o.id, kitId: o.kit_id, event: 'LAB_DELIVERED', data: { source }, userId }); }
    }
    return true;
  });
}

// Giro periodico su tutte le spedizioni aperte con numero di tracking
export async function pollTracking() {
  const st = trackingStatus();
  if (!st.sda && !st.fedex) return { skipped: true };
  const open = await many(`SELECT * FROM shipments WHERE tracking_number IS NOT NULL AND last_status <> 'DELIVERED' AND created_at > now() - interval '120 days'
    AND (last_checked_at IS NULL OR last_checked_at < now() - ($1 || ' minutes')::interval) ORDER BY last_checked_at NULLS FIRST LIMIT 60`, [String(config.tracking.pollMinutes)]);
  let n = 0;
  for (const sh of open) {
    try {
      const upd = await fetchTracking(sh);
      if (upd) { await applyTracking(sh.id, upd); n++; } else await q('UPDATE shipments SET last_checked_at=now() WHERE id=$1', [sh.id]);
    } catch (e) {
      await q('UPDATE shipments SET last_checked_at=now(), check_error=$2 WHERE id=$1', [sh.id, e.message]);
    }
  }
  return { checked: open.length, updated: n };
}

export async function refreshOne(shipmentId, userId) {
  const sh = await one('SELECT * FROM shipments WHERE id=$1', [shipmentId]);
  if (!sh?.tracking_number) return { ok: false, reason: 'no_number' };
  const upd = await fetchTracking(sh);
  if (!upd) return { ok: false, reason: 'no_provider' };
  await applyTracking(sh.id, upd, 'MANUAL_REFRESH', userId);
  return { ok: true, status: upd.status };
}
