// Lettura inversa di un referto prodotto dal generatore del progetto (01_Referti_DOCX del pacchetto): dal word/document.xml al JSON
// della scheda (anagrafica + blocchi). Serve ai test di parità: rigenerando il JSON con lib/formatTD.js si deve riottenere lo
// stesso document.xml, quindi lo schema a blocchi copre tutti i 28 referti del progetto. Lavora sulle stringhe esatte del generatore:
// un DOCX scritto a mano o da Word non si legge (e il test lo segnala).
import PizZip from 'pizzip';

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const LATO = '<w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:cs="Lato" w:eastAsia="Lato"/>';

function paragrafo(xml) {
  const m = xml.match(/^<w:p><w:pPr>([\s\S]*?)<\/w:pPr>([\s\S]*)<\/w:p>$/);
  if (!m) throw new Error(`paragrafo non riconosciuto: ${xml.slice(0, 120)}`);
  const ppr = m[1];
  const sp = ppr.match(/<w:spacing w:before="(\d+)" w:after="(\d+)"/);
  const runs = [...m[2].matchAll(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr>([\s\S]*?)<\/w:r>/g)].map((r) => ({
    rpr: r[1].replace(LATO, ''),
    testo: [...r[2].matchAll(/<w:t xml:space="preserve">([\s\S]*?)<\/w:t>|<w:br\/>/g)].map((t) => (t[0] === '<w:br/>' ? '\n' : unesc(t[1]))).join(''),
  }));
  return { ppr, keepNext: ppr.includes('<w:keepNext/>'), bordo: ppr.includes('<w:pBdr>'), before: sp ? Number(sp[1]) : 0, after: sp ? Number(sp[2]) : 0,
    jc: (ppr.match(/<w:jc w:val="(\w+)"/) || [])[1] || '', runs, testo: runs.map((r) => r.testo).join('') };
}
const celle = (tr) => [...tr.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => [...c[1].matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((x) => paragrafo(x[0])));
const righe = (tbl) => [...tbl.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((r) => ({ xml: r[1], celle: celle(r[1]) }));

const SZ = (rpr) => Number((rpr.match(/<w:sz w:val="(\d+)"/) || [])[1] || 0);
const SMALL = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="5A6B70"/><w:sz w:val="15"/>';
const NAME_N = '<w:b w:val="0"/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>';
const NAME_B = '<w:b/><w:i w:val="0"/><w:color w:val="1A1A1A"/><w:sz w:val="19"/>';
const TITOLO_ESAME = '<w:b/><w:i w:val="0"/><w:color w:val="004F5F"/><w:sz w:val="21"/>';

export function blocchiDaDocumentXml(xml) {
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr'));
  const el = [...body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  if (el.join('') !== body) throw new Error('corpo con elementi non riconosciuti');
  let i = 0;
  // riquadro anagrafico + paragrafo sz 4
  const tAna = righe(el[i++])[0].celle[0];
  const anagrafica = { cognome_nome: tAna[0].testo, righe: tAna.slice(1).map((p) => [p.runs[0].testo.replace(/:\s\s$/, ''), p.runs[1]?.testo ?? '']) };
  i++;
  const blocchi = [];
  while (i < el.length) {
    const x = el[i];
    if (x.startsWith('<w:tbl>')) {
      const grid = (x.match(/<w:gridCol w:w="(\d+)"/) || [])[1];
      const rr = righe(x);
      if (grid === '3969') {
        blocchi.push({ tipo: 'tabella1', righe: rr.map(({ celle: [c1, c2, c3] }) => ({
          nome: c1[0].testo, risultato: c2[0].runs[0].testo, riferimento: c3[0].testo,
          bold_name: c1[0].runs[0].rpr === NAME_B, small: c1.slice(1).map((p) => p.testo), unit: c2[0].runs[1] ? c2[0].runs[1].testo.replace(/^ {2}/, '') : '' })) });
      } else if (grid === '4309') {
        blocchi.push({ tipo: 'tabella2', righe: rr.map(({ celle: [c1, c2, c3] }) => {
          const r = { etichetta: c1[0].testo, valore: c2[0].testo };
          if (c3[0].jc === 'right' && c3[0].testo) r.riferimento = c3[0].testo;
          return r;
        }) });
      } else throw new Error(`tabella con griglia ${grid} non attesa`);
      i++; continue;
    }
    const p = paragrafo(x);
    const rpr = p.runs[0]?.rpr || '';
    if (!p.runs.length || (p.runs.length === 1 && p.runs[0].testo === '' && !x.includes('<w:t '))) {
      // spacer: <w:r> senza testo con sz
      const sz = SZ(x.replace(LATO, ''));
      blocchi.push(sz === 2 ? { tipo: 'spacer' } : { tipo: 'spacer', sz }); i++; continue;
    }
    if (SZ(rpr) === 25 && p.keepNext) { blocchi.push({ tipo: 'settore', titolo: p.testo }); i += 2; continue; }
    if (rpr === TITOLO_ESAME && p.keepNext && p.before === 40 && p.after === 20) {
      const n = el[i + 1] ? paragrafo(el[i + 1]) : null;
      if (n && n.keepNext && n.after === 120 && n.runs[0]?.rpr === SMALL) {
        blocchi.push({ tipo: 'esame2', nome: p.testo, metodo: n.testo.split('\n') }); i += 2; continue;
      }
      blocchi.push({ tipo: 'titolo_esame', testo: p.testo }); i++; continue;
    }
    if (/^Microrganismo #/.test(p.testo) && SZ(rpr) === 20) {
      const m = p.testo.match(/^Microrganismo #(\d+): ([\s\S]*)$/);
      const b = { tipo: 'antibiogramma', specie: m[2], n: Number(m[1]), carica: '', carica_lbl: 'Carica Batterica', legenda: '', righe: [] };
      i++;
      const c = el[i].startsWith('<w:p>') ? paragrafo(el[i]) : null;
      if (c) { const mm = c.testo.match(/^([\s\S]*?): ([\s\S]*)$/); b.carica_lbl = mm[1]; b.carica = mm[2]; i++; }
      const rr = righe(el[i]); i++;
      b.legenda = rr[0].celle[0][0].testo;
      b.righe = rr.slice(1).map(({ celle: [a, s, mic] }) => [a[0].testo, s[0].testo, mic[0].testo]);
      blocchi.push(b); continue;
    }
    blocchi.push({ tipo: 'paragrafo', testo: p.testo, stile: rpr === SMALL ? 'small' : rpr === NAME_N ? 'normale' : rpr, before: p.before, after: p.after });
    i++;
  }
  return { anagrafica, blocchi };
}

export const documentXmlDi = (buf) => new PizZip(buf).file('word/document.xml').asText();
export const blocchiDaDocx = (buf) => blocchiDaDocumentXml(documentXmlDi(buf));
