// Giorni lavorabili: lunedì-sabato (o lunedì-venerdì) meno le festività nazionali italiane
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(Date.UTC(y, mo - 1, da)); }
export function holidays(y) {
  const fixed = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'].map((d) => `${y}-${d}`);
  const e = easter(y); const mon = new Date(e.getTime() + 86400000);
  return new Set([...fixed, e.toISOString().slice(0, 10), mon.toISOString().slice(0, 10)]);
}
// Giorni lavorabili di un mese: dal lunedì al sabato (saturday=true) o al venerdì, esclusi i festivi; patrono facoltativo (es. '06-24' Firenze)
export function plannedDays(y, m, { saturday = true, patron = null } = {}) {
  const hol = holidays(y); if (patron) hol.add(`${y}-${patron}`);
  let n = 0; const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) { const dt = new Date(Date.UTC(y, m - 1, d)); const dow = dt.getUTCDay(); if (dow === 0 || (dow === 6 && !saturday)) continue; if (hol.has(dt.toISOString().slice(0, 10))) continue; n++; }
  return n;
}
