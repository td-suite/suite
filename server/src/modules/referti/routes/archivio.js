// Archivio (una riga per scheda confermata con i tre file: PDF sorgente, DOCX, PDF TD), registro delle operazioni ed export XLSX.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { many } from '../db.js';
import { ah } from '../../../lib/util.js';
import { SORGENTI } from '../lib/core.js';

const r = Router();

const AZIONI = { CARICATO: 'Caricamento', SCARTATO: 'PDF scartato', MODIFICATA: 'Correzione', CONFERMATA: 'Conferma', SOSTITUZIONE: 'Sostituzione del file precedente', SCARTATA: 'Scheda scartata', IMPOSTAZIONI: 'Impostazioni', TEMPLATE: 'Template carta intestata' };

function filtriData(params, from, to, col) {
  const w = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); w.push(`${col} >= $${params.length}::date`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); w.push(`${col} < ($${params.length}::date + 1)`); }
  return w;
}

// GET /archivio?q=&from=&to=&sorgente=
r.get('/archivio', ah(async (req, res) => {
  const params = []; const w = [`s.stato='CONFERMATA'`];
  const qs = String(req.query.q || '').trim();
  if (qs) { params.push(`%${qs}%`); w.push(`(s.cognome_nome ILIKE $${params.length} OR s.accettazione ILIKE $${params.length} OR s.referto_codice ILIKE $${params.length} OR s.nome_file ILIKE $${params.length})`); }
  if (typeof req.query.sorgente === 'string' && SORGENTI[req.query.sorgente]) { params.push(req.query.sorgente); w.push(`s.sorgente=$${params.length}`); }
  w.push(...filtriData(params, req.query.from, req.query.to, 's.confirmed_at'));
  params.push(Math.min(1000, Math.max(1, Number(req.query.limit) || 300)));
  const rows = await many(`SELECT s.id, s.cognome_nome, s.sorgente, s.accettazione, s.data_acc, s.referto_codice, s.referto_data, s.nome_file, s.confirmed_at, s.sostituisce_id, s.sostituita_da, s.pagine,
      u.full_name AS operatore, e.filename AS elaborazione_filename,
      (SELECT jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'filename', f.filename, 'size', f.size, 'intero', f.intero) ORDER BY CASE f.kind WHEN 'SORGENTE_PDF' THEN 0 WHEN 'DOCX' THEN 1 ELSE 2 END) FROM file_prodotti f WHERE f.scheda_id=s.id) AS file
    FROM schede s JOIN elaborazioni e ON e.id=s.elaborazione_id LEFT JOIN public.users u ON u.id=s.confirmed_by
    WHERE ${w.join(' AND ')} ORDER BY s.confirmed_at DESC, s.id DESC LIMIT $${params.length}`, params);
  res.json(rows.map((x) => ({ ...x, data: x.data_acc || x.referto_data || null, sorgente_nome: SORGENTI[x.sorgente] || x.sorgente, file: x.file || [] })));
}));

async function registroRows(query) {
  const params = []; const w = ['TRUE'];
  if (typeof query.azione === 'string' && AZIONI[query.azione]) { params.push(query.azione); w.push(`r.azione=$${params.length}`); }
  const qs = String(query.q || '').trim();
  if (qs) { params.push(`%${qs}%`); w.push(`(s.cognome_nome ILIKE $${params.length} OR s.accettazione ILIKE $${params.length} OR e.filename ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`); }
  w.push(...filtriData(params, query.from, query.to, 'r.at'));
  params.push(Math.min(5000, Math.max(1, Number(query.limit) || 500)));
  const rows = await many(`SELECT r.id, r.at, r.azione, r.dettagli, r.scheda_id, r.elaborazione_id, u.full_name AS operatore,
      s.cognome_nome, s.sorgente, s.accettazione, s.nome_file, s.stato AS scheda_stato, s.anomalie, coalesce(e.filename, e2.filename) AS elaborazione_filename
    FROM registro r LEFT JOIN public.users u ON u.id=r.user_id LEFT JOIN schede s ON s.id=r.scheda_id LEFT JOIN elaborazioni e ON e.id=r.elaborazione_id LEFT JOIN elaborazioni e2 ON e2.id=s.elaborazione_id
    WHERE ${w.join(' AND ')} ORDER BY r.at DESC, r.id DESC LIMIT $${params.length}`, params);
  return rows.map((x) => ({ ...x, azione_nome: AZIONI[x.azione] || x.azione, sorgente_nome: x.sorgente ? (SORGENTI[x.sorgente] || x.sorgente) : null, n_anomalie: Array.isArray(x.anomalie) ? x.anomalie.length : 0 }));
}

r.get('/registro', ah(async (req, res) => res.json(await registroRows(req.query))));

r.get('/registro.xlsx', ah(async (req, res) => {
  const rows = await registroRows({ ...req.query, limit: 5000 });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Toscana Diagnostica · Referti esterni';
  const ws = wb.addWorksheet('Registro');
  ws.columns = [
    { header: 'Data e ora', key: 'at', width: 18 }, { header: 'Operatore', key: 'operatore', width: 26 }, { header: 'Azione', key: 'azione', width: 26 },
    { header: 'Sorgente', key: 'sorgente', width: 34 }, { header: 'Paziente', key: 'paziente', width: 28 }, { header: 'Accettazione', key: 'acc', width: 16 },
    { header: 'File prodotto', key: 'file', width: 40 }, { header: 'Anomalie segnalate', key: 'anomalie', width: 40 }, { header: 'Dettagli', key: 'dettagli', width: 50 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const x of rows) {
    const anomalie = Array.isArray(x.anomalie) ? x.anomalie.map((a) => a.testo).join('; ') : '';
    const d = x.dettagli || {};
    const det = [d.motivo ? `Motivo: ${d.motivo}` : null, d.schede != null ? `Schede: ${d.schede}` : null, d.pagine != null ? `Pagine: ${d.pagine}` : null, d.forzata ? 'Conferma forzata (coerenza non superata)' : null,
      d.suffisso ? 'Nome con suffisso' : null, d.sostituisce_scheda_id ? `Sostituisce la scheda ${d.sostituisce_scheda_id}` : null, d.pdf_sorgente_intero ? 'PDF sorgente intero (ritaglio non disponibile)' : null, d.ocr ? 'OCR' : null,
      Array.isArray(d.campi) ? `Campi: ${d.campi.join(', ')}` : null, d.template ? `Template: ${d.template}` : null].filter(Boolean).join(' · ');
    ws.addRow({ at: new Date(x.at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }), operatore: x.operatore || '', azione: x.azione_nome, sorgente: x.sorgente_nome || '', paziente: x.cognome_nome || '', acc: x.accettazione || '',
      file: x.nome_file ? (x.azione === 'CONFERMATA' || x.azione === 'SOSTITUZIONE' ? `${x.nome_file}.docx / .pdf` : x.nome_file) : (x.elaborazione_filename || ''), anomalie, dettagli: det });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Registro referti esterni ${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
