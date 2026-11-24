// Recupero Crediti · fatture, incassi, posizioni dei clienti. Fonti: Synclab (documenti emessi ai clienti B2B abbinati a una Legal
// entity) e partitario della contabilità (file XLSX o CSV). Il collegamento con il Business Hub dà termini di pagamento, contatti
// amministrativi e referente commerciale. Nessun dato sanitario: numeri, date e importi dei documenti.
import ExcelJS from 'exceljs';
import { one, many, q, tx } from '../db.js';
import { normName } from '../../../lib/util.js';
import { scadenzaDaTermini, normNumero, giorniTra, piuGiorni, aging, FASE_LABEL } from './regole.js';
import { evento, oggiRoma } from './impostazioni.js';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const APERTE = `f.stato IN ('APERTA','PARZIALE')`;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** Tabelle del Business Hub presenti? (il modulo può non essere ancora nella Suite: il widget funziona lo stesso, senza i suoi dati) */
export async function hub() {
  return one(`SELECT to_regclass('business.accounts') IS NOT NULL AS accounts, to_regclass('business.org_ext') IS NOT NULL AS org_ext, to_regclass('business.contatti') IS NOT NULL AS contatti,
                     to_regclass('public.clienti_attivi_v') IS NOT NULL AS attivi`);
}
/** Termini di pagamento per cliente: quelli scritti nella scheda crediti, poi quelli della Legal entity nel Business Hub. Map org -> testo. */
export async function terminiClienti() {
  const h = await hub();
  const m = new Map();
  if (h.org_ext) for (const r of await many(`SELECT org_id, btrim(concat_ws(' ', pay_method, pay_terms)) AS t FROM business.org_ext WHERE coalesce(pay_terms, '') <> ''`)) m.set(r.org_id, r.t);
  for (const r of await many(`SELECT organization_id, termini FROM clienti WHERE coalesce(termini, '') <> ''`)) m.set(r.organization_id, r.termini);
  return m;
}
async function assicuraCliente(orgId, client = null) { await (client ? client.query.bind(client) : q)('INSERT INTO clienti (organization_id) VALUES ($1) ON CONFLICT DO NOTHING', [orgId]); }

// ---------------------------------------------------------------- incassi e stato della fattura
/** Ricalcola incassato e stato di una fattura dagli incassi confermati. */
export async function ricalcola(fatturaId, client = null) {
  const run = client ? client.query.bind(client) : q;
  await run(`UPDATE fatture f SET incassato = x.s,
       stato = CASE WHEN f.stato IN ('NOTA_CREDITO','ANNULLATA') THEN f.stato WHEN x.s >= f.importo - 0.005 THEN 'PAGATA' WHEN x.s > 0.005 THEN 'PARZIALE' ELSE 'APERTA' END,
       chiusa_at = CASE WHEN f.stato NOT IN ('NOTA_CREDITO','ANNULLATA') AND x.s >= f.importo - 0.005 THEN coalesce(f.chiusa_at, now()) ELSE NULL END,
       chiusa_origine = CASE WHEN f.stato NOT IN ('NOTA_CREDITO','ANNULLATA') AND x.s >= f.importo - 0.005 THEN coalesce(f.chiusa_origine, x.o) ELSE NULL END, updated_at = now()
      FROM (SELECT coalesce(sum(importo), 0) AS s, (array_agg(origine ORDER BY created_at DESC))[1] AS o FROM incassi WHERE fattura_id = $1 AND stato = 'CONFERMATO') x
     WHERE f.id = $1 AND f.stato NOT IN ('NOTA_CREDITO','ANNULLATA')`, [fatturaId]);
}
/** Parte già usata di una nota di credito (somma degli incassi NOTA_CREDITO che la citano). */
async function ricalcolaNota(notaId, client) {
  await client.query(`UPDATE fatture SET incassato = (SELECT coalesce(sum(importo), 0) FROM incassi WHERE nota_credito_id = $1 AND stato = 'CONFERMATO'), updated_at = now() WHERE id = $1 AND stato = 'NOTA_CREDITO'`, [notaId]);
}
/** Registra un incasso confermato su una fattura aperta. Rifiuta importi superiori al residuo. */
export async function registraIncasso(fatturaId, { importo, data, origine = 'MANUALE', bankTransactionId = null, automatico = false, punteggio = null, motivo = null, userId = null, notaCreditoId = null }, client = null) {
  const esegui = async (c) => {
    const f = (await c.query('SELECT * FROM fatture WHERE id = $1 FOR UPDATE', [fatturaId])).rows[0];
    if (!f) throw bad('Fattura non trovata');
    if (!['APERTA', 'PARZIALE'].includes(f.stato)) throw bad(`La fattura n. ${f.numero} non è aperta`);
    const imp = r2(importo), residuo = r2(f.importo - f.incassato);
    if (!(imp > 0)) throw bad('Importo non valido');
    if (imp > residuo + 0.005) throw bad(`L'importo (${imp.toFixed(2)}) supera il residuo della fattura n. ${f.numero} (${residuo.toFixed(2)})`);
    const ins = (await c.query(`INSERT INTO incassi (fattura_id, importo, data, origine, bank_transaction_id, stato, automatico, punteggio, motivo, user_id, confermato_at, nota_credito_id)
       VALUES ($1,$2,$3,$4,$5,'CONFERMATO',$6,$7,$8,$9,now(),$10) RETURNING id`, [fatturaId, imp, data, origine, bankTransactionId, automatico, punteggio, motivo, userId, notaCreditoId])).rows[0];
    await ricalcola(fatturaId, c);
    return { id: ins.id, fattura: f, importo: imp, saldata: imp >= residuo - 0.005 };
  };
  return client ? esegui(client) : tx(esegui);
}
/** Applica una nota di credito a una fattura dello stesso cliente (per il minore fra residuo della fattura e parte libera della nota). */
export async function applicaNotaCredito(notaId, fatturaId, userId) {
  return tx(async (c) => {
    const n = (await c.query(`SELECT * FROM fatture WHERE id = $1 AND stato = 'NOTA_CREDITO' FOR UPDATE`, [notaId])).rows[0];
    const f = (await c.query('SELECT * FROM fatture WHERE id = $1 FOR UPDATE', [fatturaId])).rows[0];
    if (!n || !f) throw bad('Nota di credito o fattura non trovata');
    if (!n.organization_id || n.organization_id !== f.organization_id) throw bad('Nota di credito e fattura sono di clienti diversi');
    const libera = r2(-Number(n.importo) - Number(n.incassato)), residuo = r2(f.importo - f.incassato);
    const imp = Math.min(libera, residuo);
    if (!(imp > 0)) throw bad('Nulla da applicare: la nota di credito è già usata o la fattura è già chiusa');
    await registraIncasso(fatturaId, { importo: imp, data: oggiRoma(), origine: 'NOTA_CREDITO', motivo: `Nota di credito n. ${n.numero}`, userId, notaCreditoId: n.id }, c);
    await ricalcolaNota(n.id, c);
    await evento(f.organization_id, 'NOTA_CREDITO', `Nota di credito n. ${n.numero} applicata alla fattura n. ${f.numero} per € ${imp.toFixed(2)}`, { userId }, c);
    return { importo: imp };
  });
}

// ---------------------------------------------------------------- Synclab
/**
 * Porta nel widget i documenti emessi da Synclab ai clienti abbinati a una Legal entity (non del gruppo), dalla data fatture_dal.
 * Fatture e note di credito; i documenti con tipo non indicato si contano e si lasciano fuori. Un documento annullato in Synclab
 * dopo l'arrivo si annulla anche qui solo se non ha incassi né solleciti (altrimenti resta e si segnala).
 */
export async function sincronizzaSynclab(imp) {
  const out = { letti: 0, nuovi: 0, aggiornati: 0, annullati: 0, tipo_non_indicato: 0, da_verificare: 0 };
  const righe = await many(`SELECT i.instance_id, i.id, i.invoice_number, i.document_type, i.date::text AS data, i.total, coalesce(i.cancelled, FALSE) AS cancelled, coalesce(i.proforma, FALSE) AS proforma,
        (i.deleted_at IS NOT NULL OR i.disponibilita <> 'ATTIVO') AS assente, c.organization_id, c.legal_name, c.vat_number
      FROM synclab.invoices i JOIN synclab.clients_td c ON c.instance_id = i.instance_id AND c.client_id = i.client_id
      JOIN public.organizations o ON o.id = c.organization_id AND o.kind NOT IN ('GRUPPO','SOCIETA')
     WHERE i.date >= $1 AND coalesce(i.invoice_number, '') <> '' AND i.total IS NOT NULL`, [imp.fatture_dal]).catch((e) => { if (/synclab/.test(e.message)) return []; throw e; });
  if (!righe.length) return out;
  const termini = await terminiClienti();
  const esistenti = new Map((await many(`SELECT id, fonte_id, numero, data::text AS data, importo, incassato, stato, fase, scadenza::text AS scadenza, scadenza_origine FROM fatture WHERE fonte = 'SYNCLAB'`)).map((f) => [f.fonte_id, f]));
  for (const x of righe) {
    out.letti++;
    const chiave = `${x.instance_id}:${x.id}`;
    const valido = !x.cancelled && !x.proforma && !x.assente;
    if (!['invoice', 'credit_note'].includes(x.document_type)) { if (valido) out.tipo_non_indicato++; continue; }
    const nota = x.document_type === 'credit_note';
    const importo = nota ? -Math.abs(r2(x.total)) : Math.abs(r2(x.total));
    const e = esistenti.get(chiave);
    if (!e) {
      if (!valido || importo === 0) continue;
      const s = nota ? { scadenza: x.data, origine: 'TERMINI' } : scadenzaDaTermini(x.data, termini.get(x.organization_id), imp.termini_predefiniti);
      await assicuraCliente(x.organization_id);
      await q(`INSERT INTO fatture (fonte, fonte_id, organization_id, cliente_nome, cliente_piva, numero, data, scadenza, scadenza_origine, importo, stato)
               VALUES ('SYNCLAB',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (fonte, fonte_id) DO NOTHING`,
        [chiave, x.organization_id, x.legal_name, x.vat_number, x.invoice_number, x.data, s.scadenza, s.origine, importo, nota ? 'NOTA_CREDITO' : 'APERTA']);
      out.nuovi++;
      continue;
    }
    if (!valido) {
      if (e.stato === 'ANNULLATA') continue;
      if (Number(e.incassato) === 0 && Number(e.fase) === 0) { await q(`UPDATE fatture SET stato = 'ANNULLATA', nota = 'Documento annullato in Synclab', updated_at = now() WHERE id = $1`, [e.id]); out.annullati++; }
      else { await q(`UPDATE fatture SET nota = 'ATTENZIONE: documento annullato in Synclab dopo incassi o solleciti: verificare', updated_at = now() WHERE id = $1 AND coalesce(nota, '') NOT LIKE 'ATTENZIONE: documento annullato%'`, [e.id]); out.da_verificare++; }
      continue;
    }
    // documento già presente: si riallineano numero, data e importo; la scadenza calcolata si ricalcola solo se nessuna fase è partita
    const cambia = e.numero !== x.invoice_number || e.data !== x.data || r2(e.importo) !== importo;
    let scad = null;
    if (!nota && Number(e.fase) === 0 && ['TERMINI', 'PREDEFINITA'].includes(e.scadenza_origine)) {
      const s = scadenzaDaTermini(x.data, termini.get(x.organization_id), imp.termini_predefiniti);
      if (s.scadenza !== e.scadenza || s.origine !== e.scadenza_origine) scad = s;
    }
    if (cambia || scad) {
      await q(`UPDATE fatture SET numero = $2, data = $3, importo = $4, scadenza = coalesce($5, scadenza), scadenza_origine = coalesce($6, scadenza_origine), updated_at = now() WHERE id = $1`,
        [e.id, x.invoice_number, x.data, importo, scad?.scadenza || null, scad?.origine || null]);
      if (cambia && !nota) await ricalcola(e.id);
      out.aggiornati++;
    }
  }
  return out;
}

/** Termini cambiati nella scheda: ricalcola le scadenze CALCOLATE del cliente sulle fatture aperte su cui non è partita nessuna fase. */
export async function ricalcolaScadenze(orgId, imp) {
  const termini = (await terminiClienti()).get(orgId);
  let n = 0;
  for (const f of await many(`SELECT id, data::text AS data, scadenza::text AS scadenza, scadenza_origine FROM fatture f WHERE f.organization_id = $1 AND ${APERTE} AND f.fase = 0 AND f.scadenza_origine IN ('TERMINI','PREDEFINITA')`, [orgId])) {
    const s = scadenzaDaTermini(f.data, termini, imp.termini_predefiniti);
    if (s.scadenza !== f.scadenza || s.origine !== f.scadenza_origine) { await q('UPDATE fatture SET scadenza = $2, scadenza_origine = $3, updated_at = now() WHERE id = $1', [f.id, s.scadenza, s.origine]); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- file della contabilità (partitario clienti)
const chiaveCol = (h) => String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const COLONNE = {
  numero: ['numero', 'numerodocumento', 'ndocumento', 'numdocumento', 'numerofattura', 'nfattura', 'numfattura', 'documento', 'fattura', 'ndoc', 'numdoc', 'riferimento'],
  data: ['data', 'datadocumento', 'datafattura', 'datadoc', 'dataemissione', 'del'],
  scadenza: ['scadenza', 'datascadenza', 'scad', 'datascad'],
  importo: ['importo', 'totale', 'importodocumento', 'totaledocumento', 'importofattura', 'totalefattura', 'importototale', 'dare'],
  residuo: ['residuo', 'saldo', 'daincassare', 'aperto', 'importoresiduo', 'saldoaperto', 'importoaperto', 'scoperto'],
  cliente: ['cliente', 'ragionesociale', 'intestatario', 'denominazione', 'nominativo', 'anagrafica'],
  piva: ['piva', 'partitaiva', 'pivacf', 'codicefiscale', 'cf', 'partitaivacodicefiscale', 'vat'],
};
export function numeroIt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : null;
  if (typeof v === 'object' && v.result != null) return numeroIt(v.result);
  let s = String(v).replace(/[€\s]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : null;
}
export function dataIt(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
  if (typeof v === 'object' && v.result != null) return dataIt(v.result);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000) + 12 * 3600 * 1000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); if (Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
async function leggiTabella(buffer, filename) {
  if (/\.csv$/i.test(filename || '') || !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    const testo = buffer.toString('utf8').replace(/^﻿/, '');
    const sep = (testo.split('\n')[0].match(/;/g) || []).length >= (testo.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return testo.split(/\r?\n/).filter((l) => l.trim()).map((l) => { const out = []; let cur = '', inq = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (inq && l[i + 1] === '"') { cur += '"'; i++; } else inq = !inq; } else if (ch === sep && !inq) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); });
  }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 1) || wb.worksheets[0];
  if (!ws) return [];
  const righe = [];
  ws.eachRow({ includeEmpty: false }, (row) => { const v = []; row.eachCell({ includeEmpty: true }, (cell, n) => { const x = cell.value; v[n - 1] = x && typeof x === 'object' && !(x instanceof Date) ? (x.result ?? x.text ?? (x.richText ? x.richText.map((t) => t.text).join('') : null)) : x; }); righe.push(v); });
  return righe;
}
/** Righe del partitario lette dal file: [{ numero, data, scadenza, importo, residuo, cliente, piva, riga }] + colonne riconosciute. */
export async function leggiPartitario(buffer, filename) {
  const tab = await leggiTabella(buffer, filename);
  let iH = -1, col = null;
  for (let i = 0; i < Math.min(tab.length, 20); i++) {
    const c = {};
    (tab[i] || []).forEach((h, j) => { const k = chiaveCol(h); for (const [campo, nomi] of Object.entries(COLONNE)) if (c[campo] === undefined && nomi.includes(k)) c[campo] = j; });
    if (c.numero !== undefined && (c.importo !== undefined || c.residuo !== undefined)) { iH = i; col = c; break; }
  }
  if (iH < 0) throw bad('Intestazioni non riconosciute: servono almeno le colonne "Numero" (del documento) e "Importo" o "Residuo"; sono utili "Data", "Scadenza", "Cliente" e "Partita IVA".');
  const righe = [], scartate = [];
  for (let i = iH + 1; i < tab.length; i++) {
    const r = tab[i] || []; const v = (k) => (col[k] === undefined ? null : r[col[k]]);
    const numero = String(v('numero') ?? '').trim();
    if (!numero || /^totale/i.test(numero)) continue;
    const importo = numeroIt(v('importo')), residuo = numeroIt(v('residuo')), data = dataIt(v('data')), scadenza = dataIt(v('scadenza'));
    if (importo == null && residuo == null) { scartate.push({ riga: i + 1, motivo: 'importo non leggibile' }); continue; }
    if (!data && !scadenza) { scartate.push({ riga: i + 1, motivo: 'manca la data del documento (o la scadenza)' }); continue; }
    righe.push({ riga: i + 1, numero, data: data || scadenza, scadenza, importo: importo ?? residuo, residuo: residuo ?? null, cliente: String(v('cliente') ?? '').trim() || null, piva: String(v('piva') ?? '').replace(/[^0-9A-Za-z]/g, '').replace(/^IT/i, '').toUpperCase() || null });
  }
  return { righe, scartate, colonne: Object.keys(col) };
}
/**
 * Importa il partitario. anteprima = true non scrive nulla e dice cosa cambierebbe. completo = true: il file contiene TUTTE le partite
 * aperte, quindi le fatture aperte nella Suite, con data compresa fra la più vecchia e la più recente del file, che nel file non ci
 * sono si chiudono come incassate secondo il partitario. Senza "completo" nessuna fattura viene chiusa per assenza.
 */
export async function importaPartitario(buffer, filename, { completo = false, anteprima = true, userId = null } = {}, imp) {
  const { righe, scartate, colonne } = await leggiPartitario(buffer, filename);
  if (!righe.length) throw bad('Nessuna riga utile nel file');
  const oggi = oggiRoma();
  const orgs = await many(`SELECT id, name, regexp_replace(upper(coalesce(vat_number, '')), '[^0-9A-Z]', '', 'g') AS piva, regexp_replace(upper(coalesce(tax_code, '')), '[^0-9A-Z]', '', 'g') AS cf FROM public.organizations WHERE kind NOT IN ('GRUPPO','SOCIETA')`);
  const perPiva = new Map(), perNome = new Map();
  for (const o of orgs) { for (const k of [o.piva.replace(/^IT/, ''), o.cf]) if (k) perPiva.set(k, perPiva.has(k) ? null : o.id); const n = normName(o.name); if (n) perNome.set(n, perNome.has(n) ? null : o.id); }
  const termini = await terminiClienti();
  const tutte = await many(`SELECT id, fonte, fonte_id, organization_id, numero, data::text AS data, scadenza::text AS scadenza, importo, incassato, stato, fase FROM fatture WHERE stato <> 'ANNULLATA'`);
  const indice = new Map();
  for (const f of tutte) if (f.organization_id) indice.set(`${f.organization_id}|${normNumero(f.numero)}|${f.data.slice(0, 4)}`, f);
  const perFonte = new Map(tutte.filter((f) => f.fonte === 'CONTABILITA').map((f) => [f.fonte_id, f]));
  const out = { righe: righe.length, nuove: 0, aggiornate: 0, incassi: 0, chiuse: 0, non_abbinate: 0, invariate: 0, scartate, colonne, anomalie: [], da_chiudere: [], clienti_non_abbinati: [] };
  const viste = new Set(); const azioni = [];
  const nonAbb = new Map();
  for (const x of righe) {
    const org = (x.piva && perPiva.get(x.piva)) || (x.cliente && perNome.get(normName(x.cliente))) || null;
    if (!org) { out.non_abbinate++; const k = x.piva || x.cliente || '?'; nonAbb.set(k, { cliente: x.cliente, piva: x.piva, righe: (nonAbb.get(k)?.righe || 0) + 1 }); }
    const nota = x.importo < 0;
    const fonteId = `${x.piva || normName(x.cliente || '') || 'senza-cliente'}:${normNumero(x.numero)}:${x.data.slice(0, 4)}`;
    const e = (org && indice.get(`${org}|${normNumero(x.numero)}|${x.data.slice(0, 4)}`)) || perFonte.get(fonteId) || null;
    if (e) viste.add(e.id);
    if (nota) { if (!e) azioni.push({ tipo: 'NUOVA', x, org, fonteId, nota: true }); else out.invariate++; continue; }
    const residuo = x.residuo == null ? null : Math.max(0, x.residuo);
    if (!e) { azioni.push({ tipo: 'NUOVA', x, org, fonteId, residuo }); continue; }
    if (['NOTA_CREDITO'].includes(e.stato)) { out.invariate++; continue; }
    const az = { tipo: 'AGGIORNA', e, x, scadenza: null, delta: 0 };
    if (x.scadenza && x.scadenza !== e.scadenza) az.scadenza = x.scadenza;
    if (residuo != null) {
      const delta = r2((Number(e.importo) - residuo) - Number(e.incassato));
      if (delta > 0.005) az.delta = delta;
      else if (delta < -0.005) out.anomalie.push({ riga: x.riga, numero: x.numero, testo: `nella Suite risultano incassati € ${Number(e.incassato).toFixed(2)}, nel partitario la fattura è aperta per € ${residuo.toFixed(2)} su € ${Number(e.importo).toFixed(2)}: non modificata, da verificare` });
    }
    if (az.scadenza || az.delta) azioni.push(az); else out.invariate++;
  }
  out.clienti_non_abbinati = [...nonAbb.values()].slice(0, 100);
  if (completo) {
    const date = righe.map((x) => x.data).sort(); const dal = date[0], al = date[date.length - 1];
    for (const f of tutte) if (['APERTA', 'PARZIALE'].includes(f.stato) && !viste.has(f.id) && f.data >= dal && f.data <= al) out.da_chiudere.push({ id: f.id, numero: f.numero, data: f.data, residuo: r2(f.importo - f.incassato), organization_id: f.organization_id });
  }
  for (const a of azioni) { if (a.tipo === 'NUOVA') out.nuove++; else { out.aggiornate++; } if (a.delta || (a.tipo === 'NUOVA' && !a.nota && a.residuo != null && a.residuo < a.x.importo - 0.005)) out.incassi++; }
  out.chiuse = out.da_chiudere.length;
  if (anteprima) return { ...out, anteprima: true, da_chiudere: out.da_chiudere.slice(0, 200) };
  await tx(async (c) => {
    for (const a of azioni) {
      if (a.tipo === 'NUOVA') {
        const { x } = a;
        const s = x.scadenza ? { scadenza: x.scadenza, origine: 'FILE' } : a.nota ? { scadenza: x.data, origine: 'FILE' } : scadenzaDaTermini(x.data, a.org ? termini.get(a.org) : null, imp.termini_predefiniti);
        if (a.org) await assicuraCliente(a.org, c);
        const ins = (await c.query(`INSERT INTO fatture (fonte, fonte_id, organization_id, cliente_nome, cliente_piva, numero, data, scadenza, scadenza_origine, importo, stato)
           VALUES ('CONTABILITA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (fonte, fonte_id) DO NOTHING RETURNING id`, [a.fonteId, a.org, x.cliente, x.piva, x.numero, x.data, s.scadenza, s.origine, x.importo, a.nota ? 'NOTA_CREDITO' : 'APERTA'])).rows[0];
        if (ins && !a.nota && a.residuo != null && a.residuo < x.importo - 0.005) await registraIncasso(ins.id, { importo: r2(x.importo - a.residuo), data: oggi, origine: 'PARTITARIO', motivo: `Partitario ${filename || ''}`.trim(), userId }, c);
      } else {
        if (a.scadenza) await c.query(`UPDATE fatture SET scadenza = $2, scadenza_origine = 'FILE', updated_at = now() WHERE id = $1`, [a.e.id, a.scadenza]);
        if (a.delta && ['APERTA', 'PARZIALE'].includes(a.e.stato)) await registraIncasso(a.e.id, { importo: a.delta, data: oggi, origine: 'PARTITARIO', motivo: `Partitario ${filename || ''}`.trim(), userId }, c);
      }
    }
    for (const f of out.da_chiudere) await registraIncasso(f.id, { importo: f.residuo, data: oggi, origine: 'PARTITARIO', motivo: `Assente dal partitario completo ${filename || ''}`.trim(), userId }, c);
    await c.query('INSERT INTO importazioni (filename, righe, nuove, aggiornate, chiuse, non_abbinate, completo, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [filename || null, out.righe, out.nuove, out.aggiornate, out.chiuse, out.non_abbinate, completo, userId]);
  });
  return { ...out, anteprima: false, da_chiudere: out.da_chiudere.slice(0, 200) };
}

// ---------------------------------------------------------------- destinatari e referente commerciale
const emailValida = (e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(String(e || '').trim());
export const listaEmail = (s) => [...new Set(String(s || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(emailValida))];
const RUOLO_AMM = /ammin|contab|pagament|fornitor|finanz|finance|cfo|tesor|ragion|segreter/i;
/**
 * A chi scrivere per un cliente: indirizzi scelti nella scheda crediti; altrimenti i contatti del Business Hub con un ruolo
 * amministrativo; altrimenti il contatto principale; altrimenti l'email della Legal entity. Ritorna anche PEC e referente commerciale.
 */
export async function destinatari(orgId) {
  const h = await hub();
  const o = await one(`SELECT o.id, o.name, o.email, o.pec, o.code, o.vat_number, c.email_solleciti, c.pec AS pec_crediti, c.referente_user_id FROM public.organizations o LEFT JOIN clienti c ON c.organization_id = o.id WHERE o.id = $1`, [orgId]);
  if (!o) return null;
  const contatti = h.contatti ? await many(`SELECT k.nome, k.ruolo, lower(btrim(k.email)) AS email, k.principale FROM business.contatti k JOIN business.accounts a ON a.id = k.account_id
       WHERE a.organization_id = $1 AND coalesce(k.email, '') <> '' ORDER BY k.principale DESC, k.id`, [orgId]) : [];
  let to = listaEmail(o.email_solleciti), origine = 'scheda crediti', nome = null;
  if (!to.length) { const amm = contatti.filter((k) => RUOLO_AMM.test(k.ruolo || '') && emailValida(k.email)); if (amm.length) { to = [...new Set(amm.map((k) => k.email))].slice(0, 3); origine = 'contatti amministrativi del Business Hub'; nome = amm[0].nome; } }
  // indirizzo di fatturazione scritto nell'anagrafica del gestionale (Synclab) per i client abbinati a questa Legal entity
  if (!to.length) {
    const sy = await many(`SELECT DISTINCT lower(btrim(c.invoice_email)) AS email FROM synclab.clients c JOIN synclab.clients_td t ON t.instance_id = c.instance_id AND t.client_id = c.id WHERE t.organization_id = $1 AND coalesce(c.invoice_email, '') <> '' AND c.deleted_at IS NULL`, [orgId]).catch(() => []);
    const ok = sy.map((x) => x.email).filter(emailValida);
    if (ok.length) { to = ok.slice(0, 2); origine = 'indirizzo di fatturazione del gestionale (Synclab)'; }
  }
  if (!to.length) { const p = contatti.find((k) => emailValida(k.email)); if (p) { to = [p.email]; origine = p.principale ? 'contatto principale del Business Hub' : 'primo contatto del Business Hub'; nome = p.nome; } }
  if (!to.length && emailValida(o.email)) { to = [o.email.trim().toLowerCase()]; origine = 'email della Legal entity'; }
  if (!nome) nome = contatti.find((k) => to.includes(k.email))?.nome || null;
  const rifId = o.referente_user_id || (h.accounts ? (await one(`SELECT owner_user_id FROM business.accounts WHERE organization_id = $1 AND owner_user_id IS NOT NULL ORDER BY cliente_attivo DESC, updated_at DESC LIMIT 1`, [orgId]))?.owner_user_id : null);
  const referente = rifId ? await one(`SELECT id, full_name AS nome, email FROM public.users WHERE id = $1 AND status = 'ACTIVE'`, [rifId]) : null;
  return { organization_id: o.id, ragione_sociale: o.name, codice: o.code || o.vat_number || `C${o.id}`, to, origine: to.length ? origine : null, nome, pec: (o.pec_crediti || o.pec || '').trim() || null, referente,
    indirizzi_noti: [...new Set([...listaEmail(o.email_solleciti), ...contatti.map((k) => k.email), ...(emailValida(o.email) ? [o.email.trim().toLowerCase()] : [])])] };
}

// ---------------------------------------------------------------- posizioni
/**
 * Stato dei clienti con partite aperte: una riga per Legal entity. orgIds = null per tutti. `stato` (in ordine di precedenza): ESCLUSO,
 * LEGALE, CONTESTAZIONE, PROMESSA, SOSPESO, IN_SOLLECITO, SCADUTO, REGOLARE.
 */
export async function posizioni({ orgIds = null, oggi = oggiRoma(), tolleranza = 2 } = {}) {
  const h = await hub();
  const righe = await many(`
    WITH f AS (SELECT f.organization_id, (f.importo - f.incassato) AS residuo, ($1::date - f.scadenza) AS giorni, f.fase, f.contestata, f.scadenza, f.scadenza_origine
                 FROM fatture f WHERE ${APERTE} AND f.organization_id IS NOT NULL AND ($2::int[] IS NULL OR f.organization_id = ANY($2::int[]))),
         a AS (SELECT organization_id, count(*)::int AS fatture, sum(residuo) AS totale, coalesce(sum(residuo) FILTER (WHERE giorni > 0), 0) AS scaduto, coalesce(max(giorni) FILTER (WHERE giorni > 0), 0)::int AS giorni_max,
                      max(fase)::int AS fase, bool_or(contestata) AS contestata, coalesce(sum(residuo) FILTER (WHERE contestata), 0) AS contestato, min(scadenza)::text AS prima_scadenza,
                      bool_or(scadenza_origine = 'PREDEFINITA') AS termini_mancanti FROM f GROUP BY 1)
    SELECT a.*, o.name AS ragione_sociale, o.code AS codice, o.kind,
           coalesce(c.escluso AND (c.esclusione_fino IS NULL OR c.esclusione_fino >= $1::date), FALSE) AS escluso, c.esclusione_motivo, c.esclusione_fino::text AS esclusione_fino,
           CASE WHEN c.sospeso_fino >= $1::date THEN c.sospeso_fino::text END AS sospeso_fino, c.sospeso_motivo, c.referente_user_id,
           (SELECT coalesce(sum(-n.importo - n.incassato), 0) FROM fatture n WHERE n.organization_id = a.organization_id AND n.stato = 'NOTA_CREDITO' AND (-n.importo - n.incassato) > 0.005) AS note_credito,
           (SELECT json_build_object('id', p.id, 'data', p.data::text, 'importo', p.importo, 'piano', p.piano, 'stato', p.stato) FROM promesse p WHERE p.organization_id = a.organization_id AND p.stato IN ('APERTA','DA_APPROVARE') ORDER BY p.data LIMIT 1) AS promessa,
           (SELECT count(*)::int FROM risposte r WHERE r.organization_id = a.organization_id AND r.stato = 'DA_GESTIRE') AS risposte_da_gestire,
           (SELECT p.stato FROM pratiche_legali p WHERE p.organization_id = a.organization_id AND p.stato IN ('PROPOSTA','AUTORIZZATA','TRASMESSA') ORDER BY p.id DESC LIMIT 1) AS pratica,
           (SELECT count(*)::int FROM comunicazioni k WHERE k.organization_id = a.organization_id AND k.stato = 'DA_APPROVARE') AS da_approvare,
           (SELECT max(k.inviata_at) FROM comunicazioni k WHERE k.organization_id = a.organization_id AND k.stato IN ('INVIATA','REGISTRATA')) AS ultimo_contatto
           ${h.attivi ? `, (SELECT string_agg(DISTINCT v.linea, ', ') FROM public.clienti_attivi_v v WHERE v.org_id = a.organization_id) AS linee_hub` : ', NULL::text AS linee_hub'}
           ${h.accounts ? `, (SELECT x.id FROM business.accounts x WHERE x.organization_id = a.organization_id ORDER BY x.cliente_attivo DESC, x.updated_at DESC LIMIT 1) AS account_id,
              coalesce(c.referente_user_id, (SELECT x.owner_user_id FROM business.accounts x WHERE x.organization_id = a.organization_id AND x.owner_user_id IS NOT NULL ORDER BY x.cliente_attivo DESC, x.updated_at DESC LIMIT 1)) AS referente_id` : ', NULL::int AS account_id, c.referente_user_id AS referente_id'}
      FROM a JOIN public.organizations o ON o.id = a.organization_id LEFT JOIN clienti c ON c.organization_id = a.organization_id
     ORDER BY a.scaduto DESC, a.totale DESC`, [oggi, orgIds]);
  const nomi = new Map((await many('SELECT id, full_name FROM public.users WHERE id = ANY($1::int[])', [righe.map((r) => r.referente_id).filter(Boolean)])).map((u) => [u.id, u.full_name]));
  return righe.map((r) => {
    const promessaAttiva = r.promessa && (r.promessa.stato === 'DA_APPROVARE' || piuGiorni(r.promessa.data, tolleranza) >= oggi);
    const stato = r.escluso ? 'ESCLUSO' : ['AUTORIZZATA', 'TRASMESSA'].includes(r.pratica) ? 'LEGALE' : r.contestata ? 'CONTESTAZIONE' : promessaAttiva ? 'PROMESSA' : r.sospeso_fino ? 'SOSPESO'
      : Number(r.scaduto) > 0 && r.fase >= 2 ? 'IN_SOLLECITO' : Number(r.scaduto) > 0 ? 'SCADUTO' : 'REGOLARE';
    return { ...r, totale: r2(r.totale), scaduto: r2(r.scaduto), contestato: r2(r.contestato), note_credito: r2(r.note_credito), stato, fase_label: FASE_LABEL[r.fase] || null, referente: nomi.get(r.referente_id) || null, hub_attivo: Boolean(r.linee_hub) };
  });
}

/** Fatture aperte con i giorni di ritardo (per il motore, le schede e gli elenchi). */
export async function fattureAperte({ orgId = null, oggi = oggiRoma() } = {}) {
  return (await many(`SELECT f.id, f.organization_id, o.name AS org_nome, f.numero, f.data::text AS data, f.scadenza::text AS scadenza, f.scadenza_origine, f.importo, f.incassato, (f.importo - f.incassato) AS residuo,
        ($1::date - f.scadenza)::int AS giorni, f.fase, f.fase_at, f.contestata, f.contestazione_nota, f.fonte, f.stato, f.nota, f.cliente_nome, f.cliente_piva
      FROM fatture f LEFT JOIN public.organizations o ON o.id = f.organization_id WHERE ${APERTE} AND ($2::int IS NULL OR f.organization_id = $2) ORDER BY f.scadenza, f.id`, [oggi, orgId]))
    .map((f) => ({ ...f, importo: r2(f.importo), incassato: r2(f.incassato), residuo: r2(f.residuo) }));
}

/** Indicatori del cruscotto. */
export async function indicatori({ oggi = oggiRoma() } = {}) {
  const aperte = (await fattureAperte({ oggi })).filter((f) => f.organization_id);
  const tot = r2(aperte.reduce((s, f) => s + f.residuo, 0)), scaduto = r2(aperte.filter((f) => f.giorni > 0).reduce((s, f) => s + f.residuo, 0));
  const k = await one(`SELECT
      (SELECT coalesce(sum(importo), 0) FROM fatture WHERE stato NOT IN ('ANNULLATA','NOTA_CREDITO') AND organization_id IS NOT NULL AND data > $1::date - 90) AS fatturato90,
      (SELECT coalesce(sum(i.importo), 0) FROM incassi i WHERE i.stato = 'CONFERMATO' AND i.origine <> 'NOTA_CREDITO' AND i.data > $1::date - 30) AS incassato30,
      (SELECT count(*)::int FROM promesse WHERE stato = 'MANTENUTA' AND chiusa_at > now() - interval '180 days') AS promesse_ok,
      (SELECT count(*)::int FROM promesse WHERE stato = 'NON_RISPETTATA' AND chiusa_at > now() - interval '180 days') AS promesse_ko,
      (SELECT count(*)::int FROM clienti WHERE escluso AND (esclusione_fino IS NULL OR esclusione_fino >= $1::date)) AS esclusi`, [oggi]);
  const scala = await many(`SELECT fase, count(*)::int AS n, coalesce(sum(totale), 0) AS importo FROM comunicazioni WHERE stato IN ('INVIATA','REGISTRATA') AND inviata_at > now() - interval '90 days' GROUP BY fase ORDER BY fase`);
  const dso = Number(k.fatturato90) > 0 ? Math.round(tot / Number(k.fatturato90) * 90) : null;
  return { totale: tot, scaduto, quota_scaduto: tot > 0 ? Math.round(scaduto / tot * 1000) / 10 : 0, clienti: new Set(aperte.map((f) => f.organization_id)).size, fatture: aperte.length,
    aging: aging(aperte), dso, fatturato90: r2(k.fatturato90), incassato30: r2(k.incassato30), promesse_mantenute: k.promesse_ok, promesse_non_rispettate: k.promesse_ko, esclusi: k.esclusi,
    contestato: r2(aperte.filter((f) => f.contestata).reduce((s, f) => s + f.residuo, 0)), scala: scala.map((s) => ({ fase: s.fase, label: FASE_LABEL[s.fase], n: s.n, importo: r2(s.importo) })),
    senza_cliente: (await one(`SELECT count(*)::int AS n FROM fatture f WHERE ${APERTE} AND f.organization_id IS NULL`)).n };
}
export { r2, giorniTra };
