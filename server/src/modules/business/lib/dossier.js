// Fascicolo di autorizzazione sanitaria del punto prelievi (L.R. Toscana 51/2009, Modello 5):
// catalogo dei documenti, liste di autovalutazione precaricate, export XLSX
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// source: GEN = generato dall'app dal format aziendale; UPLOAD = da caricare; CHECK = liste di autovalutazione (XLSX generato dalle risposte)
export const DOSSIER_DOCS = [
  { key: 'MODELLO_5', group: 'Istanza', label: 'Modello 5 · Domanda di autorizzazione all’apertura del punto prelievo decentrato (con autocertificazione requisiti generali ex A23)', source: 'GEN', template: 'modello_5.docx', required: true, signer: 'Legale Rappresentante' },
  { key: 'MODELLO_6', group: 'Istanza', label: 'Modello 6 · Dichiarazione di assunzione dell’incarico del Direttore Sanitario', source: 'GEN', template: 'modello_6.docx', required: true, signer: 'Direttore Sanitario' },
  { key: 'DISPONIBILITA_LOCALI', group: 'Istanza', label: 'Documento o dichiarazione sostitutiva di atto di notorietà sulla disponibilità dei locali (contratto con la struttura ospitante)', source: 'UPLOAD', required: true },
  { key: 'PLANIMETRIA_GENERALE', group: 'Planimetrie e relazioni tecniche', label: 'Planimetria generale (localizzazione, lotto, volume, parcheggi), firmata dal tecnico e dal richiedente', source: 'UPLOAD', required: true },
  { key: 'PLANIMETRIA_INQUADRAMENTO', group: 'Planimetrie e relazioni tecniche', label: 'Planimetria di inquadramento dei locali in scala 1:100 con destinazioni d’uso e percorsi', source: 'UPLOAD', required: true },
  { key: 'RELAZIONE_TECNICA', group: 'Planimetrie e relazioni tecniche', label: 'Relazione tecnica del tecnico incaricato (requisiti strutturali e impiantistici, liste B.2-12 e B.20)', source: 'UPLOAD', required: true },
  { key: 'RELAZIONE_OPERATIVA', group: 'Planimetrie e relazioni tecniche', label: 'Relazione operativa (premessa, SGI, orari, note alle liste di autovalutazione, elenco personale e strumentazione)', source: 'GEN', template: 'relazione_operativa.docx', required: true, signer: 'Amministratore Delegato' },
  { key: 'RELAZIONE_NON_INSUDICIANTI', group: 'Planimetrie e relazioni tecniche', label: 'Relazione tecnico-descrittiva sui requisiti igienico-sanitari: attività non insudiciante (esenzione docce)', source: 'GEN', template: 'relazione_non_insudicianti.docx', required: true, signer: 'Legale Rappresentante' },
  { key: 'COLLEGAMENTO_FUNZIONALE', group: 'Dichiarazioni', label: 'Dichiarazione di collegamento funzionale con il Laboratorio di Analisi', source: 'GEN', template: 'collegamento_funzionale.docx', required: true, signer: 'Legale Rappresentante' },
  { key: 'SPORCO_PULITO', group: 'Dichiarazioni', label: 'Dichiarazione di individuazione degli spazi sporco e pulito (requisiti BS10, BS11)', source: 'GEN', template: 'dichiarazione_sporco_pulito.docx', required: true, signer: 'Legale Rappresentante' },
  { key: 'GESTIONE_FARMACI', group: 'Dichiarazioni', label: 'Gestione dei farmaci (procedura o dichiarazione della Direzione Sanitaria sui farmaci di emergenza)', source: 'UPLOAD', required: true },
  { key: 'AUTOVALUTAZIONE_A', group: 'Liste di autovalutazione', label: 'Lista A · Requisiti generali', source: 'CHECK', list: 'A', required: true },
  { key: 'AUTOVALUTAZIONE_B', group: 'Liste di autovalutazione', label: 'Lista B · Requisiti organizzativi, strutturali e tecnologici delle prestazioni ambulatoriali', source: 'CHECK', list: 'B', required: true },
  { key: 'AUTOVALUTAZIONE_B11', group: 'Liste di autovalutazione', label: 'Lista B1.1 · Medicina di laboratorio (punto prelievi)', source: 'CHECK', list: 'B1.1', required: true },
  { key: 'ELENCO_PERSONALE', group: 'Personale e strumentazione', label: 'Elenco del personale che opera nella struttura (titolo di studio, contratto, orario) con organigramma', source: 'GEN', template: 'elenco_personale.docx', required: true, signer: 'Amministratore Delegato' },
  { key: 'ELENCO_STRUMENTAZIONE', group: 'Personale e strumentazione', label: 'Inventario delle attrezzature sanitarie', source: 'GEN', template: 'elenco_strumentazione.docx', required: true, signer: 'Amministratore Delegato' },
  { key: 'ATTO_CONDIVISIONE', group: 'Sicurezza e struttura ospitante', label: 'Atto di condivisione delle procedure con la struttura ospitante (SGI, 81/08, 231, antincendio, emergenza, DAE, manutenzioni)', source: 'GEN', template: 'atto_condivisione_procedure.docx', required: true, signer: 'AD e Legale Rappresentante ospitante' },
  { key: 'DUVRI', group: 'Sicurezza e struttura ospitante', label: 'DUVRI · Documento di valutazione dei rischi interferenti (art. 26 D.Lgs. 81/2008), bozza da validare con il RSPP', source: 'GEN', template: 'duvri.docx', required: true, signer: 'AD, RSPP e Legale Rappresentante ospitante' },
  { key: 'DVR', group: 'Sicurezza e struttura ospitante', label: 'DVR · Documento di valutazione dei rischi della sede (artt. 17 e 28 D.Lgs. 81/2008), bozza da validare con il RSPP', source: 'GEN', template: 'dvr.docx', required: true, signer: 'Datore di lavoro, RSPP, RLS, MC' },
  { key: 'CONFORMITA_IMPIANTI', group: 'Impianti', label: 'Dichiarazioni di conformità degli impianti (elettrico, idrico, termico e condizionamento, messa a terra) della struttura ospitante', source: 'UPLOAD', required: true, multi: true },
  { key: 'AUTORIZZAZIONE', group: 'Esito', label: 'Autorizzazione sanitaria rilasciata dal Comune', source: 'UPLOAD', required: false },
  { key: 'ALTRO', group: 'Altri documenti', label: 'Altri documenti a completamento del fascicolo (DURC, polizze, attestati, titoli del personale, visure)', source: 'UPLOAD', required: false, multi: true },
];
export const DOC_BY_KEY = Object.fromEntries(DOSSIER_DOCS.map((d) => [d.key, d]));

let cachedLists = null;
export function defaultChecklists() {
  if (!cachedLists) cachedLists = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'autovalutazione.json'), 'utf8'));
  return JSON.parse(JSON.stringify(cachedLists));
}

export const DEFAULT_HOURS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'].map((day, i) => ({
  day, draw: i < 6 ? 'dalle ore 7:00 alle ore 10:30' : '', pickup: i === 6 ? '' : (i === 0 || i === 5 ? 'dalle ore 7:30 alle ore 12:30' : 'dalle ore 7:30 alle ore 19:30'),
}));

// Stato di completamento del fascicolo
export function completeness(dossier, files) {
  const byKey = {};
  for (const f of files) (byKey[f.doc_key] ||= []).push(f);
  const state = dossier.doc_state || {};
  const rows = DOSSIER_DOCS.map((d) => {
    const fl = byKey[d.key] || [];
    const na = Boolean(state[d.key]?.not_applicable);
    let status = 'MANCANTE';
    if (na) status = 'NON_APPLICABILE';
    else if (fl.some((f) => f.source === 'UPLOAD')) status = 'CARICATO';
    else if (fl.length) status = 'GENERATO';
    else if (d.source === 'CHECK') {
      const L = (dossier.checklists || []).find((x) => x.code === d.list);
      if (L && L.items.every((it) => !it.code || it.answer)) status = 'COMPILATO';
    }
    return { ...d, status, files: fl.map(({ data, ...rest }) => rest), note: state[d.key]?.note || '' };
  });
  const req = rows.filter((r) => r.required);
  const done = req.filter((r) => ['CARICATO', 'GENERATO', 'COMPILATO', 'NON_APPLICABILE'].includes(r.status)).length;
  const signed = req.filter((r) => r.status === 'CARICATO' || r.status === 'NON_APPLICABILE' || (r.source === 'CHECK' && r.status !== 'MANCANTE')).length;
  return { rows, required: req.length, done, signed, pct: req.length ? Math.round((done / req.length) * 100) : 0 };
}

// Export XLSX della lista di autovalutazione nello stesso tracciato dei file regionali compilati
export async function checklistXlsx(list, meta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Toscana Diagnostica · Business';
  const ws = wb.addWorksheet(list.code === 'A' ? 'A' : 'Requisiti');
  ws.columns = [{ width: 10 }, { width: 70 }, { width: 34 }, { width: 18 }, { width: 70 }, { width: 60 }];
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = list.title; ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } };
  ws.getRow(1).height = 24;
  const head = ['', 'Testo', 'Applicabilità', 'Sì/Non pertinente', 'Documento', 'Note'];
  ws.addRow(head).eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0F2' } }; c.border = { bottom: { style: 'thin' } }; });
  let section = null;
  for (const it of list.items) {
    if (it.section && it.section !== section) {
      section = it.section;
      const r = ws.addRow([section]); r.getCell(1).font = { bold: true, color: { argb: 'FF1C505E' } }; ws.mergeCells(`A${r.number}:F${r.number}`);
    }
    const r = ws.addRow([it.code, it.text, it.applicability, it.answer, it.document, it.notes]);
    r.alignment = { vertical: 'top', wrapText: true };
    r.getCell(1).font = { bold: true };
    if (/non pertinente/i.test(it.answer)) r.getCell(4).font = { color: { argb: 'FF5B6F75' } };
  }
  ws.addRow([]);
  const f = ws.addRow([`Struttura: ${meta.company} · Sede: ${meta.site} · Direttore Sanitario: ${meta.ds} · esportato il ${meta.date}`]);
  f.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF5B6F75' } }; ws.mergeCells(`A${f.number}:F${f.number}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
