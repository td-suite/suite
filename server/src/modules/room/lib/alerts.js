import { many, q } from '../db.js';
import { computePlan } from './engine.js';
import { sendMail, adminEmails } from './mailer.js';
import { getSetting, todayRome } from './util.js';
import { joinStruttura, sortStrutture } from './strutture.js';

// Stato criticità di tutte le sedi attive (calcolo con lo stesso motore del frontend)
export async function criticita() {
  const rows = await many('SELECT id, data FROM strutture WHERE deleted_at IS NULL');
  const soglia = Number(await getSetting('crit_soglia', '5'));
  const out = sortStrutture(rows.map((r) => joinStruttura(r.data, {}))).map((s) => {
    let plan = null; try { plan = computePlan(s); } catch { /* dati incompleti */ }
    const alte = plan ? plan.crit.filter((c) => c.lv === 'alta') : [];
    return { id: s.id, denominazione: s.denominazione, nomeSede: s.nomeSede || '', email: s.email || '', alte: alte.length, sopraSoglia: alte.length >= soglia, dettaglio: alte.slice(0, 12).map((c) => c.t) };
  });
  return { soglia, sedi: out };
}

// Avviso giornaliero: una volta al giorno all'ora impostata, email agli amministratori (e alla sede) per le sedi sopra soglia
export async function runDailyAlert({ force = false } = {}) {
  const enabled = (await getSetting('crit_alert_enabled', 'false')) === 'true';
  const hour = Number(await getSetting('crit_alert_hour', '8'));
  const today = todayRome();
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
  const last = await getSetting('crit_alert_last_run', '');
  if (!force && (!enabled || nowHour < hour || last === today)) return null;
  const { soglia, sedi } = await criticita();
  const over = sedi.filter((s) => s.sopraSoglia);
  const results = [];
  const admins = await adminEmails();
  for (const s of over) {
    const label = s.denominazione + (s.nomeSede ? ' · ' + s.nomeSede : '');
    const to = [...admins, ...(s.email ? [s.email] : [])];
    results.push({ sede: label, ...(await sendMail({
      kind: 'AVVISO_CRITICITA', refKey: `CRIT:${s.id}:${today}`, to, sedeId: s.id,
      subject: `Room Planning · ${label}: ${s.alte} criticità alte (soglia ${soglia})`,
      title: `${label}: ${s.alte} criticità alte`,
      body: `La pianificazione della sede ${label} presenta ${s.alte} criticità di livello alto, oltre la soglia di ${soglia}.\n\nPrime criticità:\n${s.dettaglio.map((t) => '• ' + t).join('\n')}\n\nApri la sede in Room Planning, scheda Pianificazione e controllo → Criticità e ottimizzazioni, per sistemarle.`,
    })) });
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('crit_alert_last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [today]);
  return { date: today, soglia, over: over.length, results };
}

export function startScheduler() {
  const tick = () => runDailyAlert().catch((e) => console.error('[avvisi]', e.message));
  setTimeout(tick, 20_000);
  setInterval(tick, 10 * 60 * 1000);
}
