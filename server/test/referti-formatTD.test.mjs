// Referti esterni · parità del generatore (motore del 03/11/2026): lib/formatTD.js è il porting riga per riga di gen.py + gen3.py del
// progetto Claude dedicato. A parità di dati il DOCX deve essere IDENTICO a quello del progetto: stesso word/document.xml byte per byte
// e stessi file del template.
//  - istanze gen8-gen11 (fixture test/fixtures/referti/lettura/*.json, registrate dalle chiamate dei generatori Python) contro
//    01_Referti_DOCX del pacchetto;
//  - i 28 referti del progetto: lettura inversa del DOCX (test/helpers/docxInBlocchi.mjs) → JSON → generatore → stesso document.xml.
// Il pacchetto non sta nel repository (dati reali dei pazienti): REFERTI_PACCHETTO (predefinito /home/claude/referti-pacchetto); se manca,
// i confronti con i DOCX del progetto vengono saltati e restano i controlli sul generatore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { generaDocx, documentXml, testoDocx, verificaTemplate, build, row, p, spacer, esc, TEMPLATE_DEFAULT, partiTemplate } from '../src/modules/referti/lib/formatTD.js';
import { validaDati } from '../src/modules/referti/lib/blocchi.js';
import { blocchiDaDocx, documentXmlDi } from './helpers/docxInBlocchi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'referti', 'lettura');
const PACCHETTO = process.env.REFERTI_PACCHETTO || '/home/claude/referti-pacchetto';
const DOCX_DIR = path.join(PACCHETTO, '01_Referti_DOCX');
const conPacchetto = fs.existsSync(DOCX_DIR);
const fixture = () => fs.readdirSync(FIX).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')) }));

// Confronto di due DOCX file per file (contenuto decompresso)
function diffDocx(a, b) {
  const za = new PizZip(a); const zb = new PizZip(b);
  const nomi = (z) => Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
  const out = [];
  const na = nomi(za); const nb = nomi(zb);
  for (const n of new Set([...na, ...nb])) {
    const x = za.file(n)?.asNodeBuffer(); const y = zb.file(n)?.asNodeBuffer();
    if (!x || !y || !x.equals(y)) out.push(n);
  }
  return out;
}

test('istanze gen8-gen11: DOCX identico ai referti del progetto (document.xml byte per byte e tutti i file del template)', { skip: !conPacchetto && 'pacchetto non disponibile (REFERTI_PACCHETTO): test saltato' }, async () => {
  const fx = fixture();
  assert.equal(fx.length, 7);
  for (const f of fx) {
    for (const s of f.risposta.schede) {
      const v = validaDati(s.dati);
      assert.ok(v.ok, `${f.file}: ${v.errore}`);
      const atteso = fs.readFileSync(path.join(DOCX_DIR, f.atteso_docx));
      const gen = await generaDocx(v.dati);
      assert.deepEqual(diffDocx(gen, atteso), [], `${f.file}: file diversi dal referto del progetto`);
      assert.equal(documentXml(v.dati), documentXmlDi(atteso), `${f.file}: document.xml`);
      assert.equal(testoDocx(gen), testoDocx(atteso));
    }
  }
});

test('i 28 referti del progetto: lettura inversa → JSON a blocchi → generatore → stesso document.xml', { skip: !conPacchetto && 'pacchetto non disponibile (REFERTI_PACCHETTO): test saltato' }, () => {
  const files = fs.readdirSync(DOCX_DIR).filter((f) => f.endsWith('.docx'));
  assert.equal(files.length, 28);
  const tipi = new Set();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DOCX_DIR, f));
    const dati = blocchiDaDocx(buf);
    const v = validaDati(dati);
    assert.ok(v.ok, `${f}: ${v.errore}`);
    assert.equal(documentXml(v.dati), documentXmlDi(buf), f);
    for (const b of v.dati.blocchi) tipi.add(b.tipo);
  }
  // lo schema copre tutti i tipi di blocco del generatore
  assert.deepEqual([...tipi].sort(), ['antibiogramma', 'esame2', 'paragrafo', 'settore', 'spacer', 'tabella1', 'tabella2', 'titolo_esame']);
});

test('fixture gen8-gen11: schema valido e struttura delle chiamate del generatore Python', () => {
  const per = Object.fromEntries(fixture().map((f) => [f.file, f.risposta.schede[0].dati]));
  const tipi = (d) => d.blocchi.map((b) => b.tipo).join(',');
  assert.equal(tipi(per['gen8_rdi_ige.json']), 'settore,tabella1,spacer');
  assert.equal(tipi(per['gen9_bianalisi_ige.json']), 'settore,titolo_esame,paragrafo,tabella1,paragrafo,spacer');
  assert.equal(tipi(per['gen9_nuovaigea_due_microrganismi.json']), 'settore,esame2,tabella2,spacer,antibiogramma,spacer,antibiogramma,spacer');
  assert.equal(tipi(per['gen11_nuovaigea_rdi.json']), 'settore,esame2,tabella2,spacer,antibiogramma,spacer,esame2,tabella2,spacer,esame2,tabella2,paragrafo,spacer');
  const grassi = per['gen9_nuovaigea_due_microrganismi.json'].blocchi.filter((b) => b.tipo === 'antibiogramma');
  assert.deepEqual(grassi.map((b) => [b.n, b.carica_lbl, b.righe.length]), [[1, 'Carica Batterica', 19], [2, 'Carica Batterica Totale', 17]]);
  assert.deepEqual(per['gen9_bianalisi_ige.json'].anagrafica.righe.map((r) => r[0]), ['Data di nascita', 'Sesso', 'Referto', 'Accettazione']);
  for (const d of Object.values(per)) assert.ok(validaDati(d).ok);
});

test('porting di gen.py: stringhe OpenXML esatte (escape, riga senza riferimento, spacer, a capo)', () => {
  assert.equal(esc('<=0,5 & >2/38'), '&lt;=0,5 &amp; &gt;2/38');
  assert.equal(spacer(), '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato" w:eastAsia="Lato"/><w:sz w:val="2"/></w:rPr></w:r></w:p>');
  assert.equal(p([['a\nb', '<w:b/>']], { before: 20 }), '<w:p><w:pPr><w:spacing w:before="20" w:after="0" w:line="254" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato" w:eastAsia="Lato"/><w:b/></w:rPr><w:t xml:space="preserve">a</w:t><w:br/><w:t xml:space="preserve">b</w:t></w:r></w:p>');
  const r = row('KPC', 'Negativo');
  assert.match(r, /<w:tcW w:type="dxa" w:w="3969"\/>/); assert.match(r, /<w:tcW w:type="dxa" w:w="3061"\/>/); assert.match(r, /<w:tcW w:type="dxa" w:w="2608"\/>/);
  assert.ok(r.endsWith('<w:r><w:rPr><w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato" w:eastAsia="Lato"/><w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="17"/></w:rPr></w:r></w:p></w:tc></w:tr>'), 'cella del riferimento vuota come in gen.py');
  assert.match(row('x', '1', { unit: 'kU/L' }), /<w:t xml:space="preserve"> {2}kU\/L<\/w:t>/);
});

test('build: testa e sectPr del template (intestazione, piè, margini) invariati, solo word/document.xml cambia; testo del corpo', async () => {
  const tpl = fs.readFileSync(TEMPLATE_DEFAULT);
  const { head, sect } = partiTemplate(tpl);
  const dati = { anagrafica: { cognome_nome: 'ROSSI ANNA', righe: [['Data di nascita', '01/01/1970'], ['Sesso', 'F']] }, blocchi: [{ tipo: 'settore', titolo: 'MICROBIOLOGIA' }, { tipo: 'tabella1', righe: [{ nome: 'KPC', risultato: 'Negativo', riferimento: '', bold_name: true, small: ['Metodo: immunoenzimatico'], unit: '' }] }, { tipo: 'spacer' }] };
  const docx = await generaDocx(dati);
  assert.deepEqual(diffDocx(docx, tpl), ['word/document.xml']);
  const xml = new PizZip(docx).file('word/document.xml').asText();
  assert.ok(xml.startsWith(head) && xml.endsWith(sect));
  assert.match(sect, /<w:headerReference w:type="default"/); assert.match(sect, /w:top="2232"/);
  assert.equal(testoDocx(docx).split('\n').filter(Boolean).join('|'), 'ROSSI ANNA|Data di nascita:  01/01/1970|Sesso:  F|MICROBIOLOGIA|KPC|Metodo: immunoenzimatico|Negativo');
  // template caricato dalle Impostazioni: stesso meccanismo, con i suoi head e sectPr
  const z = new PizZip(tpl);
  z.file('word/document.xml', z.file('word/document.xml').asText().replace('w:top="2232"', 'w:top="2500"'));
  const altro = z.generate({ type: 'nodebuffer' });
  assert.match(new PizZip(build('<w:p/>', altro)).file('word/document.xml').asText(), /w:top="2500"/);
  assert.deepEqual(verificaTemplate(tpl), { ok: true, headers: 1, footers: 1 });
  assert.equal(verificaTemplate(Buffer.from('non un docx')).ok, false);
});
