// Importo in lettere (italiano) e controllo formale IBAN, speculari a server/src/lib/rules.js
const UNITS = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
function below1000(n) {
  let s = '';
  const h = Math.floor(n / 100); const r = n % 100;
  if (h === 1) s = 'cento'; else if (h > 1) s = UNITS[h] + 'cento';
  if (r < 20) s += UNITS[r];
  else { let t = TENS[Math.floor(r / 10)]; const u = r % 10; if (u === 1 || u === 8) t = t.slice(0, -1); s += t + UNITS[u]; }
  return s;
}
export function amountToWords(amount) {
  const n = Math.round(Number(amount || 0) * 100);
  const int = Math.floor(n / 100); const cents = n % 100;
  let s = '';
  if (int === 0) s = 'zero';
  else {
    const millions = Math.floor(int / 1e6); const thousands = Math.floor((int % 1e6) / 1000); const rest = int % 1000;
    if (millions === 1) s += 'unmilione'; else if (millions > 1) s += below1000(millions) + 'milioni';
    if (thousands === 1) s += 'mille'; else if (thousands > 1) s += below1000(thousands) + 'mila';
    s += below1000(rest);
  }
  return `${s}/${String(cents).padStart(2, '0')}`;
}
export const normalizeIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
export function validIban(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < digits.length; i += 7) rem = Number(String(rem) + digits.slice(i, i + 7)) % 97;
  return rem === 1;
}
export const prettyIban = (s) => normalizeIban(s).replace(/(.{4})/g, '$1 ').trim();
