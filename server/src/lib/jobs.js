// Registro dei lavori di sfondo: ogni modulo registra funzioni (nome, intervallo in minuti, fn). Lo scheduler di index.js le esegue.
const jobs = [];
export function registerJob(name, minutes, fn, { runAtStart = false } = {}) { jobs.push({ name, minutes, fn, runAtStart, last: 0, running: false }); }
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
export function startScheduler() {
  const tick = async () => {
    for (const j of jobs) {
      const due = !j.last ? j.runAtStart : Date.now() - j.last >= j.minutes * 60_000;
      if (due && !j.running) runJob(j.name).catch(() => {});
    }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
}
