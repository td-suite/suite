// Estratto della simulazione di busta paga (richiesta del CEO, 28/10/2026): DOCX costruito dai risultati del simulatore, PDF via LibreOffice.
// Riporta ipotesi (RAL, livello, mensilità, contratto, ore, MBO, data dei minimi), scomposizione mensile, netto stimato e, per chi vede
// i costi, il costo azienda. Le aliquote usate sono riportate in calce come ipotesi da verificare con il consulente del lavoro.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel } from 'docx';
import { docxToPdf } from './docgen.js';

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const itDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : '');
const CONTRACT = { TIND: 'Tempo indeterminato', TDET: 'Tempo determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente' };
const TEAL = '1C505E';

const cell = (text, { bold = false, align = AlignmentType.LEFT, shade = null, width } = {}) => new TableCell({
  width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  shading: shade ? { fill: shade } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  borders: { top: { style: BorderStyle.SINGLE, size: 2, color: 'DBE5E7' }, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'DBE5E7' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
  children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(text ?? ''), bold, size: 20, font: 'Calibri' })] })],
});
const rows2 = (pairs) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pairs.map(([k, v, strong]) => new TableRow({ children: [cell(k, { bold: strong, width: 68 }), cell(v, { bold: strong, align: AlignmentType.RIGHT, width: 32 })] })) });
const h = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun({ text, color: TEAL, bold: true, size: 26, font: 'Calibri' })] });
const p = (text, opts = {}) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, size: opts.size || 20, italics: opts.italic, color: opts.color, font: 'Calibri' })] });

export async function buildPayrollDocx({ params, result, settings, user, includeCosts }) {
  const d = result.decomposition; const m = result.minimum; const net = result.net; const cost = result.cost; const a = result.assumptions;
  const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const children = [
    new Paragraph({ children: [new TextRun({ text: settings.company_name || 'Toscana Diagnostica S.r.l.', bold: true, size: 22, color: TEAL, font: 'Calibri' })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Simulazione di busta paga', bold: true, size: 36, font: 'Calibri' })] }),
    p(`Estratto del ${today}${user ? `, preparato da ${user}` : ''}. Documento di simulazione: non costituisce cedolino né impegno contrattuale.`, { italic: true, color: '5B6F75' }),
    h('Ipotesi della simulazione'),
    rows2([
      ['RAL (retribuzione annua lorda)', eur(d.ral), true],
      ['Livello CCNL Studi Professionali', params.level ? `Livello ${params.level}` : 'non indicato'],
      ['Minimo tabellare mensile', m ? `${eur(m.amount)} (in vigore dal ${itDate(m.valid_from)})` : 'non disponibile'],
      ['Mensilità', String(d.monthly)],
      ['Tipo di contratto', CONTRACT[params.contract_type] || params.contract_type],
      ['Orario settimanale', `${params.weekly_hours} ore${params.weekly_hours < 40 ? ` (part time ${Math.round((params.weekly_hours / 40) * 100)}%)` : ''}`],
      ['MBO', params.mbo_pct ? `${params.mbo_pct}% della RAL` : 'non previsto'],
      ['Minimi vigenti alla data', params.at_date ? itDate(params.at_date) : 'oggi'],
    ]),
    h('Scomposizione mensile (Elaboratore Buste Paga)'),
    rows2([
      [`RAL mensile (÷ ${d.monthly})`, eur(d.ral_monthly), true],
      ['Paga base (minimo tabellare)', eur(d.base_pay)],
      ['Indennità di funzione (70% dell\'eccedenza)', eur(d.function_allowance)],
      ['Superminimo', eur(d.superminimo)],
      ...(m?.enac ? [['ENAC (indicativo)', eur(m.enac)]] : []),
    ]),
    h('Netto stimato per il dipendente'),
    rows2([
      [`Contributi INPS a carico del dipendente (${a.employee_inps_pct}%)`, `- ${eur(net.inps)}`],
      ['Imponibile IRPEF', eur(net.taxable)],
      ['IRPEF lorda', `- ${eur(net.irpef_gross)}`],
      ['Detrazioni per lavoro dipendente', `+ ${eur(net.detractions)}`],
      ['Addizionali regionale e comunale', `- ${eur(Number(net.add_regional || 0) + Number(net.add_municipal || 0))}`],
      ...(net.bonus ? [['Trattamento integrativo', `+ ${eur(net.bonus)}`]] : []),
      ['Netto annuo stimato', eur(net.net_annual), true],
      [`Netto medio mensile (÷ ${d.monthly})`, eur(net.net_monthly), true],
    ]),
    ...(net.note ? [p(net.note, { italic: true, color: '5B6F75' })] : []),
  ];
  if (includeCosts && cost) {
    children.push(h('Costo azienda (stima)'), rows2([
      [`Coefficiente (INPS ${a.cost_inps_pct}% + INAIL ${a.cost_inail_pct}% + TFR ${a.cost_tfr_pct}%)`, String(cost.coefficient)],
      ['Costo annuo', eur(cost.annual), true],
      ['Costo mensile (÷ 12)', eur(cost.monthly)],
      ...(cost.mbo_max ? [['MBO massimo (costo azienda)', eur(cost.mbo_max)], ['Costo annuo con MBO al 100%', eur(cost.annual_with_mbo)]] : []),
    ]));
  }
  children.push(h('Note'), p('Le aliquote contributive e fiscali sono quelle impostate nel widget Contratti del personale (Impostazioni) e vanno verificate con il consulente del lavoro per il profilo contributivo effettivo (apprendisti, dirigenti, sgravi). La scomposizione segue la regola dell\'Elaboratore Buste Paga: paga base pari al minimo tabellare del livello, indennità di funzione pari al 70% dell\'eccedenza, il resto a superminimo.', { color: '5B6F75' }));
  const doc = new Document({ creator: 'Suite TD · Contratti del personale', title: 'Simulazione di busta paga', sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }] });
  return Packer.toBuffer(doc);
}

export async function buildPayrollPdf(args) {
  return docxToPdf(await buildPayrollDocx(args));
}
