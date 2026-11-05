// Produce il DOCX dell'Informativa sull'uso dell'intelligenza artificiale, da pubblicare sul sito, dallo stesso testo della pagina
// /informativa-ia (web/src/pages/informativaIATesto.js). Formattazione sobria, senza carta intestata.
// Uso: node scripts/informativaIA-docx.mjs [percorso di uscita]   (predefinito: ./Informativa_IA_Suite_TD.docx)
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { TITOLO, SEZIONI, NOTA_VERSIONE } from '../../web/src/pages/informativaIATesto.js';

const out = path.resolve(process.argv[2] || 'Informativa_IA_Suite_TD.docx');
const FONT = 'Calibri';
const TEAL = '1C505E';

const children = [
  new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [new TextRun({ text: TITOLO, bold: true, size: 34, color: TEAL, font: FONT })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Toscana Diagnostica S.r.l.', size: 22, color: '5B6F75', font: FONT })] }),
];
for (const s of SEZIONI) {
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, children: [new TextRun({ text: s.titolo, bold: true, size: 26, color: TEAL, font: FONT })] }));
  for (const p of s.paragrafi) children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 140, line: 300 }, children: [new TextRun({ text: p, size: 22, font: FONT })] }));
}
children.push(new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: NOTA_VERSIONE, italics: true, size: 20, color: '5B6F75', font: FONT })] }));

const doc = new Document({
  creator: 'Toscana Diagnostica S.r.l.', title: TITOLO, description: 'Informativa sull\'uso dell\'intelligenza artificiale nella Suite TD',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ properties: { page: { margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } }, children }],
});
fs.writeFileSync(out, await Packer.toBuffer(doc));
console.log(`DOCX scritto in ${out}`);
