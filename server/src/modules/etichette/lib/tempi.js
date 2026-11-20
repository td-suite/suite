// Lab Control · giorni di refertazione per codice esame (tabella lc_tempi_esame, v0.91.1). Il gestionale non espone questo dato: si carica
// dalle Impostazioni (file con codice e giorni, o a mano). Regola del ritardo in lib/fasi.js (ritardo, scadenzaRefertazione).
import ExcelJS from 'exceljs';
import { many, one, q } from '../db.js';

const norm = (c) => String(c ?? '').trim().toUpperCase();
const chiave = (h) => String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const COL_CODICE = ['codesame', 'codiceesame', 'codice', 'examcode', 'cod'];
const COL_GIORNI = ['giornirefertazione', 'giornidirefertazione', 'giorni', 'ggrefertazione', 'gg', 'tempodirefertazione', 'temporefertazione', 'tat'];
const COL_DESC = ['descesame', 'descrizione', 'descrizioneesame', 'descesameabbr', 'description'];

/** Map codice (maiuscolo) -> giorni di refertazione. */
export async function tempiEsami() { return new Map((await many('SELECT codice, giorni FROM lc_tempi_esame')).map((r) => [r.codice, r.giorni])); }

/** Elenco per le Impostazioni: righe della tabella + quanti codici del catalogo esami del gestionale non hanno ancora i giorni. */
export async function elencoTempi({ cerca = '', limite = 500 } = {}) {
  const c = String(cerca || '').trim();
  const righe = await many(`SELECT t.codice, t.giorni, coalesce(t.descrizione, e.description) AS descrizione, t.origine, t.updated_at
      FROM lc_tempi_esame t LEFT JOIN LATERAL (SELECT x.description FROM synclab.exams x WHERE upper(btrim(x.exam_code)) = t.codice ORDER BY x.updated_at DESC LIMIT 1) e ON TRUE
     WHERE ($1 = '' OR t.codice ILIKE '%' || $1 || '%' OR coalesce(t.descrizione, e.description) ILIKE '%' || $1 || '%') ORDER BY t.codice LIMIT $2`, [c, Math.min(2000, Number(limite) || 500)]);
  const tot = await one(`SELECT (SELECT count(*)::int FROM lc_tempi_esame) AS n,
      (SELECT count(DISTINCT upper(btrim(x.exam_code)))::int FROM synclab.exams x WHERE x.exam_code IS NOT NULL AND coalesce(x.active, TRUE)
         AND NOT EXISTS (SELECT 1 FROM lc_tempi_esame t WHERE t.codice = upper(btrim(x.exam_code)))) AS senza`).catch(() => ({ n: righe.length, senza: null }));
  return { righe, totale: tot.n, catalogo_senza_giorni: tot.senza };
}

/** Codici del catalogo del gestionale ancora senza giorni (per completare la tabella). */
export async function esamiSenzaGiorni(limite = 300) {
  return many(`SELECT DISTINCT ON (upper(btrim(x.exam_code))) upper(btrim(x.exam_code)) AS codice, x.description AS descrizione FROM synclab.exams x
     WHERE x.exam_code IS NOT NULL AND coalesce(x.active, TRUE) AND NOT EXISTS (SELECT 1 FROM lc_tempi_esame t WHERE t.codice = upper(btrim(x.exam_code)))
     ORDER BY upper(btrim(x.exam_code)), x.updated_at DESC LIMIT $1`, [limite]).catch(() => []);
}

export async function salvaTempo({ codice, giorni, descrizione = null, origine = 'MANUALE' }, userId = null) {
  const c = norm(codice), g = Math.round(Number(giorni));
  if (!c) throw Object.assign(new Error('Codice esame mancante'), { status: 400 });
  if (!(g >= 1 && g <= 365)) throw Object.assign(new Error(`Giorni di refertazione non validi per ${c}: da 1 a 365`), { status: 400 });
  await q(`INSERT INTO lc_tempi_esame (codice, giorni, descrizione, origine, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (codice) DO UPDATE SET giorni = EXCLUDED.giorni, descrizione = coalesce(EXCLUDED.descrizione, lc_tempi_esame.descrizione), origine = EXCLUDED.origine, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [c, g, descrizione ? String(descrizione).trim().slice(0, 300) : null, origine, userId]);
  return { codice: c, giorni: g };
}
export async function eliminaTempo(codice) { const r = await q('DELETE FROM lc_tempi_esame WHERE codice = $1', [norm(codice)]); return r.rowCount; }

const testo = (v) => { if (v == null) return ''; if (typeof v === 'object') return String(v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((x) => x.text).join('') : '') ?? ''); return String(v); };
/** Legge un file .xlsx o .csv con una colonna del codice esame e una dei giorni (es. la Tabella esami del gestionale: CodEsame, GiorniRefertazione). */
export async function leggiFileTempi(buffer, nome = '') {
  let tab = [];
  if (/\.csv$|\.txt$/i.test(nome)) {
    const t = buffer.toString('utf8').replace(/^﻿/, ''); const sep = (t.split(/\r?\n/)[0].match(/;/g) || []).length ? ';' : (t.split(/\r?\n/)[0].includes('\t') ? '\t' : ',');
    tab = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((x) => x.replace(/^"|"$/g, '')));
  } else {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    // il foglio buono è il primo che ha sia la colonna del codice sia quella dei giorni
    for (const ws of wb.worksheets) {
      const righe = []; ws.eachRow({ includeEmpty: false }, (row) => { righe.push((row.values || []).slice(1).map(testo)); });
      if (righe.slice(0, 15).some((r) => r.some((h) => COL_CODICE.includes(chiave(h))) && r.some((h) => COL_GIORNI.includes(chiave(h))))) { tab = righe; break; }
      if (!tab.length) tab = righe;
    }
  }
  const iT = tab.slice(0, 15).findIndex((r) => r.some((h) => COL_CODICE.includes(chiave(h))) && r.some((h) => COL_GIORNI.includes(chiave(h))));
  if (iT < 0) throw Object.assign(new Error('Nel file servono una colonna del codice esame (es. CodEsame, Codice) e una dei giorni di refertazione (es. GiorniRefertazione, Giorni)'), { status: 400 });
  const H = tab[iT].map(chiave); const pos = (lista) => { for (const k of lista) { const i = H.indexOf(k); if (i >= 0) return i; } return -1; };
  const iC = pos(COL_CODICE), iG = pos(COL_GIORNI), iD = pos(COL_DESC);
  const valide = new Map(); const scartate = [];
  tab.slice(iT + 1).forEach((r, k) => {
    const c = norm(r[iC]); const g = Number(String(r[iG] ?? '').replace(',', '.').trim());
    if (!c) return;
    if (!Number.isFinite(g) || String(r[iG] ?? '').trim() === '' || Math.round(g) < 1 || Math.round(g) > 365) { scartate.push({ riga: iT + 2 + k, codice: c, valore: String(r[iG] ?? '').trim() || null }); return; }
    valide.set(c, { codice: c, giorni: Math.round(g), descrizione: iD >= 0 ? String(r[iD] ?? '').trim() || null : null });
  });
  return { valide: [...valide.values()], scartate };
}

export async function importaTempi(buffer, nome, userId, { prova = false } = {}) {
  const { valide, scartate } = await leggiFileTempi(buffer, nome);
  const prima = await tempiEsami();
  const nuove = valide.filter((v) => !prima.has(v.codice)).length, cambiate = valide.filter((v) => prima.has(v.codice) && prima.get(v.codice) !== v.giorni).length;
  if (!prova) for (const v of valide) await salvaTempo({ ...v, origine: 'FILE' }, userId);
  return { prova, lette: valide.length, nuove, cambiate, invariate: valide.length - nuove - cambiate, scartate: scartate.slice(0, 50), scartate_totale: scartate.length };
}
