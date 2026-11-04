// Generatore del referto sul format TD: porting FEDELE, riga per riga, del generatore Python del progetto Claude dedicato
// (pacchetto "Referti EXT su format TD", 04_Generatore_python/gen.py + gen3.py + row2r di gen11.py). Stesse stringhe OpenXML, stessi
// twip, colori, dimensioni e margini di cella: a parità di dati il word/document.xml prodotto qui è IDENTICO byte per byte a quello
// dei 28 referti del progetto (01_Referti_DOCX), verificato da server/test/referti-formatTD.test.mjs. Non "migliorare" le stringhe:
// ogni modifica rompe la parità con i referti che il CEO considera il modello.
//
// Meccanismo (build di gen.py): dal word/document.xml del template si tengono la testa fino a <w:body> compreso e la coda da <w:sectPr
// in poi (intestazione, piè di pagina e margini del template); in mezzo va il corpo generato; tutti gli altri file del template
// (header, footer, media, stili, rels) restano com'erano. Template predefinito: templates/formatTD_BARONI_VERA.docx (05_Template del
// pacchetto); quello caricato dalle Impostazioni usa lo stesso meccanismo. PDF con LibreOffice headless (coda di business/lib/docgen.js).
//
// I dati arrivano dal JSON della scheda (lib/blocchi.js): anagrafica { cognome_nome, righe } e blocchi nell'ordine di stampa; ogni
// blocco corrisponde a una chiamata del generatore Python (settore, titolo_esame, paragrafo, tabella1, esame2, tabella2,
// antibiogramma, spacer).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { docxToPdf } from '../../business/lib/docgen.js';

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const TEMPLATE_DEFAULT = path.join(TPL_DIR, 'formatTD_BARONI_VERA.docx');
export const TEMPLATE_DEFAULT_NOME = 'Format TD (BARONI VERA)';

// ======================= gen.py =======================
const LATO = '<w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato" w:eastAsia="Lato"/>';
// html.escape(s, quote=False): solo & < >
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function runs(parts) {
  const out = [];
  for (const [text, rpr] of parts) {
    const segs = String(text ?? '').split('\n');
    const body = segs.map((s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`).join('<w:br/>');
    out.push(`<w:r><w:rPr>${LATO}${rpr}</w:rPr>${body}</w:r>`);
  }
  return out.join('');
}

export function p(parts, { before = 0, after = 0, jc = 'left', extra = '' } = {}) {
  return (`<w:p><w:pPr>${extra}<w:spacing w:before="${before}" w:after="${after}" w:line="254" w:lineRule="auto"/>`
    + `<w:jc w:val="${jc}"/></w:pPr>${runs(parts)}</w:p>`);
}

const LBL = '<w:b/><w:color w:val="5A6B70"/><w:sz w:val="17"/>';
const VAL = '<w:color w:val="1A1A1A"/><w:sz w:val="17"/>';
export function anagrafica(nome, rows) {
  let ps = p([[nome, '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="24"/>']], { after: 80 });
  for (const [lbl, val] of rows) {
    ps += p([[`${lbl}:  `, LBL], [val, VAL]], { after: 20 });
  }
  return ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="right"/><w:tblLayout w:type="fixed"/>'
    + '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4479"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4479"/>'
    + '<w:shd w:val="clear" w:fill="EAF5F7"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="C9E1E6"/>'
    + '<w:left w:val="single" w:sz="24" w:space="0" w:color="42B2BF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="C9E1E6"/>'
    + '<w:right w:val="single" w:sz="4" w:space="0" w:color="C9E1E6"/></w:tcBorders><w:tcMar><w:top w:w="110" w:type="dxa"/>'
    + '<w:left w:w="200" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr>'
    + `${ps}</w:tc></w:tr></w:tbl>`
    + `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>${LATO}<w:sz w:val="4"/></w:rPr></w:r></w:p>`);
}

export function settore(titolo) {
  return (p([[titolo, '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="25"/>']], { before: 200, extra: '<w:keepNext/>' })
    + '<w:p><w:pPr><w:spacing w:before="20" w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="42B2BF"/></w:pBdr></w:pPr></w:p>');
}

const W = [3969, 3061, 2608];
const MAR = [[60, 110], [110, 110], [160, 110]];
function tc(i, content) {
  return (`<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${W[i]}"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/>`
    + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="C9E1E6"/><w:right w:val="nil"/></w:tcBorders>'
    + `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="${MAR[i][0]}" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>`
    + `<w:right w:w="${MAR[i][1]}" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`);
}

const NAME_B = '<w:b/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>';
const NAME_N = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>';
export const SMALL = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="15"/>';
const RES_B = '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="21"/>';
const RES_U = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="21"/>';
const REF = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="17"/>';

export function row(name, result, { ref = '', bold_name = false, small = [], unit = '' } = {}) {
  let c1 = p([[name, bold_name ? NAME_B : NAME_N]]);
  for (const s of small) {
    c1 += p([[s, SMALL]], { before: 20 });
  }
  const parts = [[result, RES_B]];
  if (unit) parts.push([`  ${unit}`, RES_U]);
  const c2 = p(parts, { jc: 'right' });
  const c3 = ref ? p([[ref, REF]]) : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="254" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr>${LATO}${REF}</w:rPr></w:r></w:p>`;
  return `<w:tr>${tc(0, c1)}${tc(1, c2)}${tc(2, c3)}</w:tr>`;
}

export function table(rows) {
  return ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="left"/><w:tblLayout w:type="fixed"/>'
    + '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>'
    + `<w:tblGrid><w:gridCol w:w="${W[0]}"/><w:gridCol w:w="${W[1]}"/><w:gridCol w:w="${W[2]}"/></w:tblGrid>`
    + rows.join('') + '</w:tbl>');
}

export function spacer(sz = 2) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>${LATO}<w:sz w:val="${sz}"/></w:rPr></w:r></w:p>`;
}

// ======================= gen3.py (corpo 2, dal modello CELIN) =======================
const W2 = [4309, 3628, 1701];
function tc2(i, content) {
  const lm = i === 0 ? 60 : 110;
  return (`<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${W2[i]}"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/>`
    + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="C9E1E6"/><w:right w:val="nil"/></w:tcBorders>'
    + `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="${lm}" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>`
    + `<w:right w:w="110" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`);
}
const V2_LBL = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>';
const V2_VAL = '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="19"/>';
const V2_REF = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="18"/>';
export function row2(lbl, val) {
  const empty = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="254" w:lineRule="auto"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr>${LATO}${V2_REF}</w:rPr></w:r></w:p>`;
  return `<w:tr>${tc2(0, p([[lbl, V2_LBL]]))}${tc2(1, p([[val, V2_VAL]]))}${tc2(2, empty)}</w:tr>`;
}
// gen11.py: riga con riferimento nella terza colonna (esami aggiuntivi RDI)
export function row2r(lbl, val, ref) {
  return `<w:tr>${tc2(0, p([[lbl, V2_LBL]]))}${tc2(1, p([[val, V2_VAL]]))}${tc2(2, p([[ref, V2_REF]], { jc: 'right' }))}</w:tr>`;
}
export function table2(rows) {
  return ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="left"/><w:tblLayout w:type="fixed"/>'
    + '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>'
    + `<w:tblGrid><w:gridCol w:w="${W2[0]}"/><w:gridCol w:w="${W2[1]}"/><w:gridCol w:w="${W2[2]}"/></w:tblGrid>`
    + rows.join('') + '</w:tbl>');
}
// Titolo dell'esame 10,5 pt bold teal (anche da solo: gen9.py, IgE Bianalisi)
const TITOLO_ESAME = '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="21"/>';
export const titoloEsame = (nome) => p([[nome, TITOLO_ESAME]], { before: 40, after: 20, extra: '<w:keepNext/>' });
export function esame_v2(nome, righe_metodo) {
  let out = titoloEsame(nome);
  out += p([[righe_metodo.join('\n'), SMALL]], { before: 0, after: 120, extra: '<w:keepNext/>' });
  return out;
}

const W3 = [4876, 1928, 1474];
function tc3(i, content, fill, header = false) {
  let bord; let m;
  if (header) { bord = '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="004F5F"/>'; m = 90; }
  else { bord = '<w:bottom w:val="single" w:sz="2" w:space="0" w:color="C9E1E6"/>'; m = 60; }
  return (`<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${W3[i]}"/><w:shd w:val="clear" w:fill="${fill}"/><w:tcBorders><w:top w:val="nil"/>`
    + `<w:left w:val="nil"/>${bord}<w:right w:val="nil"/></w:tcBorders><w:tcMar><w:top w:w="${m}" w:type="dxa"/>`
    + `<w:left w:w="140" w:type="dxa"/><w:bottom w:w="${m}" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`);
}

export const LEG_DEFAULT = 'R: Resistente   I: Intermedio   S: Sensibile';
export function antibiogramma_leg(specie, num, carica, legenda, abx, carica_lbl = 'Carica Batterica') {
  let out = p([[`Microrganismo #${num}: ${specie}`, '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="20"/>']], { before: 160, extra: '<w:keepNext/>' });
  if (carica) {
    out += p([[`${carica_lbl}: ${carica}`, '<w:b/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>']], { before: 20, after: 80, extra: '<w:keepNext/>' });
  }
  const HW = '<w:b/><w:i w:val="0"/><w:color w:val="FFFFFF"/><w:sz w:val="17"/>';
  const hdr = ('<w:tr><w:trPr><w:tblHeader/></w:trPr>'
    + tc3(0, p([[legenda, '<w:b w:val="0"/><w:i/><w:color w:val="FFFFFF"/><w:sz w:val="17"/>']]), '004F5F', true)
    + tc3(1, p([[`${specie}\n#${num}`, HW]], { jc: 'center' }), '004F5F', true)
    + tc3(2, p([['MIC', HW]], { jc: 'center' }), '004F5F', true) + '</w:tr>');
  let rows = '';
  abx.forEach(([a, sir, mic], i) => {
    const fill = i % 2 === 0 ? 'FFFFFF' : 'EAF5F7';
    rows += ('<w:tr>' + tc3(0, p([[a, '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="18"/>']]), fill)
      + tc3(1, p([[sir, '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="18"/>']], { jc: 'center' }), fill)
      + tc3(2, p([[mic, '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="18"/>']], { jc: 'center' }), fill) + '</w:tr>');
  });
  return out + ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="left"/><w:tblLayout w:type="fixed"/>'
    + '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>'
    + `<w:tblGrid><w:gridCol w:w="${W3[0]}"/><w:gridCol w:w="${W3[1]}"/><w:gridCol w:w="${W3[2]}"/></w:tblGrid>${hdr}${rows}</w:tbl>`);
}
export const antibiogrammaStd = (specie, num, carica, abx) => antibiogramma_leg(specie, num, carica, LEG_DEFAULT, abx);

// ======================= dal JSON della scheda al corpo =======================
// Stili del blocco "paragrafo": small = SMALL di gen.py (note a piè, valori di riferimento IgE); normale = testo 9,5 pt (NAME_N)
const STILE_PARAGRAFO = { small: SMALL, normale: NAME_N };
const n0 = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export function blocco(b) {
  switch (b?.tipo) {
    case 'settore': return settore(b.titolo ?? '');
    case 'titolo_esame': return titoloEsame(b.testo ?? '');
    case 'paragrafo': return p([[b.testo ?? '', STILE_PARAGRAFO[b.stile] || SMALL]], { before: n0(b.before), after: n0(b.after) });
    case 'tabella1': return table((b.righe || []).map((r) => row(r.nome ?? '', r.risultato ?? '', { ref: r.riferimento || '', bold_name: Boolean(r.bold_name), small: r.small || [], unit: r.unit || '' })));
    case 'esame2': return esame_v2(b.nome ?? '', b.metodo || []);
    case 'tabella2': return table2((b.righe || []).map((r) => (r.riferimento ? row2r(r.etichetta ?? '', r.valore ?? '', r.riferimento) : row2(r.etichetta ?? '', r.valore ?? ''))));
    case 'antibiogramma': return antibiogramma_leg(b.specie ?? '', b.n ?? 1, b.carica || '', b.legenda ?? LEG_DEFAULT, (b.righe || []).map((r) => [r[0] ?? '', r[1] ?? '', r[2] ?? '']), b.carica_lbl || 'Carica Batterica');
    case 'spacer': return spacer(n0(b.sz, 2) || 2);
    default: return '';
  }
}

// Corpo completo: riquadro anagrafico + blocchi nell'ordine
export function corpo(dati) {
  const a = dati?.anagrafica || {};
  return anagrafica(a.cognome_nome ?? '', (a.righe || []).map((r) => [r[0] ?? '', r[1] ?? ''])) + (dati?.blocchi || []).map(blocco).join('');
}

// ======================= build (gen.py) =======================
// Testa e coda del template: head = fino a <w:body> compreso, sect = da <w:sectPr (quello del corpo, l'ultimo) alla fine.
// Python legge il file in modalità testo: i \r\n diventano \n.
export function partiTemplate(templateBuf) {
  const zip = new PizZip(templateBuf);
  const src = (zip.file('word/document.xml')?.asText() || '').replace(/\r\n?/g, '\n');
  const ib = src.indexOf('<w:body>');
  const is = src.lastIndexOf('<w:sectPr');
  if (ib < 0) throw new Error('Template DOCX non valido: manca word/document.xml con <w:body>');
  if (is < 0 || is < ib) throw new Error('Il template non ha le proprietà di sezione (sectPr): impossibile usarne intestazione e piè di pagina');
  return { zip, head: src.slice(0, ib + '<w:body>'.length), sect: margineMinimo(src.slice(is)) };
}

// Margine superiore minimo 2232 twip (3,94 cm, come il template del progetto): l'intestazione TD è fatta di immagini ancorate che
// non spingono il corpo in basso, quindi con un template caricato dalle Impostazioni che ha un margine più basso (es. 2 cm) il
// riquadro del paziente finisce sopra i contatti (segnalazione del CEO, 04/11/2026). Gli altri margini restano quelli del template.
export const TOP_MIN = 2232;
export function margineMinimo(sect) {
  return sect.replace(/<w:pgMar\b([^>]*)\/>/, (m, attrs) => {
    const top = Number((attrs.match(/w:top="(-?\d+)"/) || [])[1]);
    if (Number.isFinite(top) && top >= TOP_MIN) return m;
    const a = Number.isFinite(top) ? attrs.replace(/w:top="-?\d+"/, `w:top="${TOP_MIN}"`) : `${attrs} w:top="${TOP_MIN}"`;
    return `<w:pgMar${a}/>`;
  });
}

const templateDefault = () => fs.readFileSync(TEMPLATE_DEFAULT);

// DOCX del referto: head del template + corpo + sectPr, gli altri file del template invariati
export function build(body, templateBuf = null) {
  const { zip, head, sect } = partiTemplate(templateBuf || templateDefault());
  zip.file('word/document.xml', head + body + sect);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const generaDocx = async (dati, { template = null } = {}) => build(corpo(dati), template);
export const documentXml = (dati, { template = null } = {}) => { const { head, sect } = partiTemplate(template || templateDefault()); return head + corpo(dati) + sect; };

// Verifica di un template caricato: DOCX con word/document.xml, <w:body> e <w:sectPr>
export function verificaTemplate(buf) {
  try {
    const z = new PizZip(buf);
    const xml = z.file('word/document.xml')?.asText();
    if (!xml) return { ok: false, errore: 'Il file non è un documento Word (manca word/document.xml)' };
    if (!xml.includes('<w:body>')) return { ok: false, errore: 'Il documento non ha un corpo <w:body> leggibile' };
    if (!xml.includes('<w:sectPr')) return { ok: false, errore: 'Il documento non ha le proprietà di sezione (intestazione e piè di pagina)' };
    const headers = Object.keys(z.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).length;
    const footers = Object.keys(z.files).filter((f) => /^word\/footer\d*\.xml$/.test(f)).length;
    return { ok: true, headers, footers };
  } catch (e) { return { ok: false, errore: `File non leggibile: ${e.message}` }; }
}

// Testo del corpo di un DOCX (solo word/document.xml: intestazione e piè del template esclusi). Una riga per paragrafo, <w:br/> a capo.
export function testoDocx(buf) {
  const z = new PizZip(buf);
  const xml = z.file('word/document.xml')?.asText() || '';
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [null, xml])[1];
  return body.replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

export const generaPdf = (docxBuf) => docxToPdf(docxBuf);
