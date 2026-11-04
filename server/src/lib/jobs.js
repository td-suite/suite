// Registro dei lavori di sfondo: ogni modulo registra funzioni (nome, intervallo in minuti, fn). Lo scheduler di index.js le esegue.
const jobs = [];
// Un job appena registrato parte da solo: subito (runAtStart) oppure dopo il suo intervallo. Prima (fino alla 0.43.1) un job senza
// runAtStart non partiva mai finché qualcuno non lo lanciava a mano ("Leggi"): le caselle Shipments, People, Referti e gli specchi dei
// portali restavano ferme in produzione (segnalazione del CEO, 04/11/2026).
export function registerJob(name, minutes, fn, { runAtStart = false } = {}) { jobs.push({ name, minutes, fn, runAtStart, last: 0, registered: Date.now(), running: false }); }
export function listJobs() { return jobs.map((j) => ({ name: j.name, minutes: j.minutes, last: j.last ? new Date(j.last).toISOString() : null, running: j.running, lastResult: j.lastResult || null, lastError: j.lastError || null })); }
export async function runJob(name) {
  const j = jobs.find((x) => x.name === name);
  if (!j) throw new Error(`Job ${name} inesistente`);
  if (j.running) return { skipped: true };
  j.running = true;
  try { j.lastResult = await j.fn(); j.lastError = null; j.last = Date.now(); return j.lastResult; }
  catch (e) { j.lastError = e.message; j.last = Date.now(); console.error(`[job ${name}]`, e.message); throw e; }
  finally { j.running = false; }
}
// Il job è da eseguire? Mai eseguito: subito se runAtStart, altrimenti dopo il suo intervallo dalla registrazione; poi ogni intervallo.
export function isDue(j, now = Date.now()) {
  const ms = j.minutes * 60_000;
  return !j.last ? (j.runAtStart || now - j.registered >= ms) : now - j.last >= ms;
}
export function startScheduler() {
  const tick = async () => {
    for (const j of jobs) {
      if (isDue(j) && !j.running) runJob(j.name).catch(() => {});
    }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
}
