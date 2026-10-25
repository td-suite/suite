// Foglio di spedizione del kit (A4): etichetta indirizzo del paziente, codice a barre del kit, tratte, istruzioni per il ritorno.
// Packing list della spedizione al laboratorio (FedEx).
import { newDoc, letterhead, finish, barcode, box, C, M, W, PAGE, MM, fmtDate } from './common.js';

const T = {
  it: { title: 'Foglio di spedizione kit', sub: (o) => `Richiesta ${o.external_ref || '#' + o.id} · progetto ${o.project === 'ENDEAVOR' ? 'Endeavor DNA' : 'Lifestyle'}`, dest: 'Destinatario', kit: 'Codice kit', mode: 'Modalità di spedizione', out: 'Andata', ret: 'Ritorno del campione', none: 'non prevista', std: 'SDA Standard', exp: 'SDA Express', outT: 'Lettera di vettura andata', retT: 'Etichetta di ritorno', retAddr: 'Indirizzo di ritorno del campione', instr: 'Istruzioni per il paziente', instrText: 'Raccogli il campione seguendo le istruzioni contenute nel kit. Richiudi il kit nella busta preaffrancata con l\'etichetta di ritorno già applicata e consegnala a un ufficio postale o a un punto SDA. Il codice a barre del kit non va rimosso.', instrNoRet: 'Raccogli il campione seguendo le istruzioni del kit e consegnalo in uno dei centri Toscana Diagnostica indicati al momento dell\'acquisto, insieme a questo foglio.', checks: 'Controlli prima della chiusura della busta', c1: 'Il codice a barre del kit coincide con quello della richiesta', c2: 'Etichetta SDA di andata applicata sulla busta', c3: 'Etichetta di ritorno e busta prepagata inserite (se previste)', c4: 'Questo foglio inserito nella busta', phone: 'Tel.', prepared: 'Preparato il', by: 'da' },
  en: { title: 'Kit shipping sheet', sub: (o) => `Request ${o.external_ref || '#' + o.id} · project ${o.project === 'ENDEAVOR' ? 'Endeavor DNA' : 'Lifestyle'}`, dest: 'Recipient', kit: 'Kit barcode', mode: 'Shipping mode', out: 'Outbound', ret: 'Sample return', none: 'not included', std: 'SDA Standard', exp: 'SDA Express', outT: 'Outbound waybill', retT: 'Return label', retAddr: 'Sample return address', instr: 'Instructions for the patient', instrText: 'Collect the sample following the instructions in the kit. Put the kit back in the prepaid envelope with the return label already applied and hand it to a post office or SDA point. Do not remove the kit barcode.', instrNoRet: 'Collect the sample following the kit instructions and bring it to one of the Toscana Diagnostica centres indicated at purchase, together with this sheet.', checks: 'Checks before sealing the envelope', c1: 'The kit barcode matches the request', c2: 'SDA outbound label applied on the envelope', c3: 'Return label and prepaid envelope included (where provided)', c4: 'This sheet included in the envelope', phone: 'Tel.', prepared: 'Prepared on', by: 'by' },
};

export async function shippingSheet(o, { legs, settings, lang = 'it' }) {
  const t = T[lang] || T.it;
  const doc = newDoc({ Title: `${t.title} ${o.external_ref || o.id}`, Subject: t.title });
  doc.addPage();
  let y = letterhead(doc, t.title, t.sub(o));
  const name = [o.patient_title, o.patient_first_name, o.patient_last_name].filter(Boolean).join(' ');
  const addr = [name, o.address1, o.address2, [o.zip, o.city, o.province && `(${o.province})`].filter(Boolean).join(' '), o.country, o.phone && `${t.phone} ${o.phone}`].filter(Boolean).join('\n');
  // Colonna sinistra: destinatario grande; destra: barcode kit
  const colW = (W - 14) / 2;
  const h1 = box(doc, M.left, y, colW, t.dest, addr, { size: 13, bold: true, minH: 120, strong: true });
  const bx = M.left + colW + 14;
  doc.font('B').fontSize(7.5).fillColor(C.teal).text(t.kit.toUpperCase(), bx + 8, y + 6, { characterSpacing: .6 });
  if (o.barcode) {
    const png = await barcode(o.barcode, { height: 16 });
    doc.image(png, bx + 8, y + 20, { fit: [colW - 16, 52] });
    doc.font('B').fontSize(16).fillColor(C.jet).text(o.barcode, bx + 8, y + 78, { width: colW - 16, align: 'center', characterSpacing: 1.5 });
  } else doc.font('R').fontSize(11).fillColor(C.grey).text('-', bx + 8, y + 30);
  doc.roundedRect(bx, y, colW, h1, 6).lineWidth(0.8).strokeColor(C.teal).stroke();
  y += h1 + 14;
  // Tratte
  const svc = (s) => (s === 'EXPRESS' ? t.exp : s === 'STANDARD' ? t.std : t.none);
  const out = o.shipments?.find((s) => s.direction === 'OUTBOUND');
  const ret = o.shipments?.find((s) => s.direction === 'RETURN');
  const modeName = o.project === 'ENDEAVOR' ? (lang === 'en' ? o.mode_en : o.mode_it) || '-' : (o.order_type === 'KIT_ONLY' ? (lang === 'en' ? 'Kit only' : 'Solo kit') : lang === 'en' ? 'Kit + exam' : 'Kit + esame');
  const h2 = box(doc, M.left, y, colW, t.mode, `${modeName}\n${t.out}: ${svc(legs.outbound)}${out?.tracking_number ? `\n${t.outT}: ${out.tracking_number}` : ''}\n${t.ret}: ${svc(legs.ret)}${ret?.tracking_number ? `\n${t.retT}: ${ret.tracking_number}` : ''}`, { size: 10, minH: 90 });
  const h3 = legs.ret ? box(doc, bx, y, colW, t.retAddr, settings.return_address || '', { size: 10.5, bold: true, minH: 90 }) : 0;
  y += Math.max(h2, h3) + 14;
  // Istruzioni
  const h4 = box(doc, M.left, y, W, t.instr, legs.ret ? t.instrText : t.instrNoRet, { size: 10 });
  y += h4 + 14;
  // Checklist operatore
  doc.font('B').fontSize(7.5).fillColor(C.teal).text(t.checks.toUpperCase(), M.left, y, { characterSpacing: .6 });
  y += 14;
  for (const c of [t.c1, t.c2, t.c3, t.c4]) {
    doc.rect(M.left, y, 10, 10).lineWidth(0.8).strokeColor(C.jet).stroke();
    doc.font('R').fontSize(9.5).fillColor(C.ink).text(c, M.left + 16, y - 1);
    y += 16;
  }
  doc.font('R').fontSize(8).fillColor(C.grey).text(`${t.prepared} ${fmtDate(new Date(), lang)}${o.created_by_name ? ` · ${t.by} ${o.created_by_name}` : ''}`, M.left, PAGE.h - M.bottom - 40 * MM / 2 - 18, { width: W, align: 'right' });
  return finish(doc);
}

const L = {
  it: { title: 'Spedizione campioni al laboratorio', sub: (l) => `FedEx AWB ${l.awb_number || 'da ricevere'} · ${l.orders.length} kit`, to: 'Destinatario', from: 'Mittente', list: 'Elenco kit contenuti', cols: ['Kit', 'Riferimento', 'Paziente', 'Campione ricevuto'], notes: 'Note', sign: 'Preparato da · firma' },
  en: { title: 'Sample shipment to the laboratory', sub: (l) => `FedEx AWB ${l.awb_number || 'pending'} · ${l.orders.length} kits`, to: 'Consignee', from: 'Shipper', list: 'Kits enclosed', cols: ['Kit', 'Reference', 'Patient', 'Sample received'], notes: 'Notes', sign: 'Prepared by · signature' },
};
export async function labSheet(l, { consignee, sender, lang = 'en' }) {
  const t = L[lang] || L.en;
  const doc = newDoc({ Title: `${t.title} ${l.awb_number || l.id}`, Subject: t.title });
  doc.addPage();
  let y = letterhead(doc, t.title, t.sub(l));
  const colW = (W - 14) / 2;
  const h1 = box(doc, M.left, y, colW, t.to, consignee || '', { size: 11.5, bold: true, minH: 110, strong: true });
  const h2 = box(doc, M.left + colW + 14, y, colW, t.from, sender || '', { size: 10.5, minH: 110 });
  y += Math.max(h1, h2) + 10;
  if (l.awb_number) {
    const png = await barcode(l.awb_number, { height: 12 });
    doc.image(png, M.left, y, { fit: [220, 40] });
    doc.font('B').fontSize(12).fillColor(C.jet).text(`AWB ${l.awb_number}`, M.left + 232, y + 12);
    y += 52;
  }
  doc.font('B').fontSize(7.5).fillColor(C.teal).text(t.list.toUpperCase(), M.left, y, { characterSpacing: .6 });
  y += 14;
  const cw = [120, 110, W - 120 - 110 - 90, 90];
  const row = (vals, bold, fill) => {
    if (fill) doc.rect(M.left, y - 3, W, 18).fillColor('#F3F6F6').fill();
    let x = M.left;
    doc.font(bold ? 'B' : 'R').fontSize(9).fillColor(C.ink);
    vals.forEach((v, i) => { doc.text(String(v ?? ''), x + 4, y, { width: cw[i] - 8, lineBreak: false }); x += cw[i]; });
    y += 18;
    doc.moveTo(M.left, y - 4).lineTo(M.left + W, y - 4).lineWidth(0.4).strokeColor(C.line).stroke();
  };
  row(t.cols, true, true);
  l.orders.forEach((o, i) => { if (y > PAGE.h - 60 * MM) { doc.addPage(); letterhead(doc); y = 45 * MM; row(t.cols, true, true); } row([o.barcode || '-', o.external_ref || '-', `${o.patient_last_name} ${o.patient_first_name}`, fmtDate(o.sample_received_at, lang)], false, i % 2 === 1); });
  y += 10;
  if (l.notes) { y += box(doc, M.left, y, W, t.notes, l.notes, { size: 9.5 }) + 12; }
  doc.font('B').fontSize(7.5).fillColor(C.teal).text(t.sign.toUpperCase(), M.left, y, { characterSpacing: .6 });
  doc.moveTo(M.left, y + 40).lineTo(M.left + 220, y + 40).lineWidth(0.8).strokeColor(C.jet).stroke();
  doc.font('R').fontSize(8).fillColor(C.grey).text(fmtDate(new Date(), lang), M.left + 240, y + 30);
  return finish(doc);
}
