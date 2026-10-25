// Lettura CSV degli import acquirer e canali digitali. Nella Suite non c'è il pacchetto csv-parse: il parser qui sotto
// copre lo stesso uso dell'app di origine (intestazione in riga 1, separatore ; o , riconosciuto, campi tra virgolette,
// righe vuote ignorate, colonne in più o in meno tollerate).
import { bad } from './util.js';

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function readCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delimiter = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  try {
    const rows = parseCsv(text, delimiter);
    if (!rows.length) return [];
    const headers = rows[0].map((x) => x.trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  } catch (e) {
    throw bad(`CSV non leggibile: ${e.message}`);
  }
}

// "1.234,56" | "1234.56" | "1234,56" -> 1234.56
export function parseAmount(v) {
  if (v == null || v === '') return NaN;
  let s = String(v).replace(/[€\s]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  return Math.round(Number(s) * 100) / 100;
}

// "24/09/2026" | "2026-09-24" -> "2026-09-24"
export function parseDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export const pick = (row, ...keys) => { for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]; return null; };
