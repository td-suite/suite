// Estrazione dell'elenco "Sedi del network" (Retail > B2C > Sedi) in Excel e in PDF (richiesta del CEO del 19/11/2026).
// Stesse righe e stesse colonne della pagina, con in più i campi che in tabella stanno nei badge (area TuoTempo, codici dei gestionali,
// sabato, bacino). Il PDF è un A4 orizzontale con la tabella e i totali; carattere e logo delle altre stampe della Suite.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toXlsx } from './exports.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(QUI, '..', '..', 'orders', 'assets');
const LOGO = path.join(QUI, '..', 'assets', 'logo-td.png');
const C = { teal: '#1C505E', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', light: '#EEF4F5' };
const MM = 2.8346;
export const SITE_KIND = { LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', SERVICE: 'Struttura service', HEADQUARTER: 'Sede direzionale', ALTRO: 'Altro' };
export const AMBITI = { network: 'Sedi del network', active: 'Tutte le sedi attive', all: 'Tutte le sedi, anche disattivate' };
const eur0 = (n) => `${Math.round(Number(n || 0)).toLocaleString('it-IT')} €`;
const oggi = () => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

export const ambitoDi = (v) => (AMBITI[v] ? v : 'network');
export const filtra = (rows, ambito) => (ambito === 'all' ? rows : ambito === 'active' ? rows.filter((s) => s.active) : rows.filter((s) => s.active && s.in_network));
const indirizzo = (s) => [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.province ? `(${s.province})` : null].filter(Boolean).join(s.address ? ', ' : ' ').replace(', (', ' (');
const retail = (s) => (!s.in_network ? 'Fuori network' : s.configured ? 'Impostata' : 'Predefinite');
export function righe(rows) {
  return rows.map((s) => ({ code: s.code, name: s.name, kind: SITE_KIND[s.kind] || s.kind, address: s.address || null, zip: s.zip || null, city: s.city || null, province: s.province || null, indirizzo: indirizzo(s),
    manager: s.manager || null, people_count: Number(s.people_count || 0), stato: s.active ? 'Attiva' : 'Disattivata', network: s.in_network ? 'Sì' : 'No', retail: retail(s),
    tuotempo_area_id: s.tuotempo_area_id || null, gipo_site_code: s.gipo_site_code || null, studiolab_code: s.studiolab_code || null, sabato: s.saturday_open === false ? 'Chiuso' : 'Aperto',
    catchment_cities: s.catchment_cities || null, revenue_ytd: Number(s.revenue_ytd || 0), exposure_ok: Number(s.exposure_ok || 0), exposure_items: Number(s.exposure_items || 0),
    esposizione: s.in_network ? `${Number(s.exposure_ok || 0)}/${Number(s.exposure_items || 0)}` : '' }));
}

export async function sediXlsx(rows, ambito) {
  const R = righe(rows);
  return toXlsx([{ name: AMBITI[ambito].slice(0, 31), columns: [
    { header: 'Codice', key: 'code' }, { header: 'Sede', key: 'name', width: 38 }, { header: 'Tipologia', key: 'kind', width: 20 }, { header: 'Indirizzo', key: 'address', width: 34 }, { header: 'CAP', key: 'zip' },
    { header: 'Comune', key: 'city', width: 22 }, { header: 'Prov.', key: 'province' }, { header: 'Site manager', key: 'manager', width: 26 }, { header: 'Persone', key: 'people_count', int: true },
    { header: 'Stato', key: 'stato' }, { header: 'Nel network', key: 'network' }, { header: 'Impostazioni Retail', key: 'retail', width: 20 }, { header: 'Area TuoTempo', key: 'tuotempo_area_id' },
    { header: 'Codice GIPO', key: 'gipo_site_code' }, { header: 'Codice StudioLab', key: 'studiolab_code' }, { header: 'Sabato', key: 'sabato' }, { header: 'Comuni del bacino', key: 'catchment_cities', width: 40 },
    { header: 'Fatturato YTD', key: 'revenue_ytd', money: true, width: 18 }, { header: 'Esposizione installata', key: 'exposure_ok', int: true }, { header: 'Esposizione prevista', key: 'exposure_items', int: true },
  ], rows: R, totals: { people_count: R.reduce((a, r) => a + r.people_count, 0), revenue_ytd: R.reduce((a, r) => a + r.revenue_ytd, 0), exposure_ok: R.reduce((a, r) => a + r.exposure_ok, 0), exposure_items: R.reduce((a, r) => a + r.exposure_items, 0) } }]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// PDF = infografica della rete in UNA pagina A4 orizzontale, da usare per gare e clienti (CEO, 19/11/2026): logo in alto, mappa della
// Toscana a sinistra con un segnaposto numerato per sede, elenco numerato delle sedi a destra, piè di pagina della carta intestata.
// È un documento per l'esterno: niente fatturato, persone, codici dei gestionali o sedi disattivate (quei dati stanno nell'Excel).
// Confini delle province: ISTAT (CC BY), geometrie semplificate in assets/toscana-province.json.
let _mappa = null;
function mappaToscana() {
  if (!_mappa) { try { _mappa = JSON.parse(fs.readFileSync(path.join(QUI, '..', 'assets', 'toscana-province.json'), 'utf8')); } catch { _mappa = { province: {} }; } }
  return _mappa;
}
const PIEDE = (c) => [c.legal_name,
  `${[c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}${c.province ? ` (${c.province})` : ''}. ${c.phone ? `Tel.${c.fax && c.fax === c.phone ? ' e Fax' : ''}: ${c.phone}. ` : ''}${c.health_director ? `Direttore Sanitario: ${c.health_director}.` : ''}`,
  `P.IVA e C.F.: ${c.vat}${c.rea ? `, REA n. ${c.rea}` : ''}${c.share_capital ? ` – Capitale Sociale: ${c.share_capital}` : ''}`];

export function sediPdf(rows, ambito, company = {}) {
  const c = { legal_name: 'Toscana Diagnostica S.r.l.', name: 'Toscana Diagnostica', ...company };
  const sedi = rows.filter((s) => s.active).map((s, i) => ({ n: i + 1, nome: s.name, tipo: SITE_KIND[s.kind] || s.kind, indirizzo: indirizzo(s), tel: s.phone || null, provincia: s.province || null,
    lat: s.lat != null ? Number(s.lat) : null, lng: s.lng != null ? Number(s.lng) : null }));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: { Title: `La rete ${c.name} · ${oggi()}`, Author: c.legal_name } });
    const pezzi = []; doc.on('data', (b) => pezzi.push(b)); doc.on('end', () => resolve(Buffer.concat(pezzi))); doc.on('error', reject);
    try { doc.registerFont('R', path.join(FONT, 'LiberationSans-Regular.ttf')); doc.registerFont('B', path.join(FONT, 'LiberationSans-Bold.ttf')); }
    catch { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
    const PW = doc.page.width; const PH = doc.page.height; const L = 14 * MM; const W = PW - 2 * L;
    const T = { teal: '#1C505E', blu: '#71B1BD', jet: '#01212C', grey: '#5B6B70', terra: '#DDEBEE', bordo: '#FFFFFF', chiaro: '#F3F8F9' };

    // ---- testata: logo, titolo, contatti (come la carta intestata)
    doc.rect(0, 0, PW, 5).fill(T.teal);
    try { doc.image(LOGO, L, 10 * MM, { fit: [58 * MM, 15 * MM] }); } catch { /* logo assente */ }
    const tx = L + 66 * MM;
    doc.font('B').fontSize(19).fillColor(T.teal).text(`La rete ${c.name}`, tx, 10.5 * MM, { width: W - 66 * MM - 62 * MM, lineBreak: false });
    const perTipo = Object.entries(sedi.reduce((a, s) => { a[s.tipo] = (a[s.tipo] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
    const province = [...new Set(sedi.map((s) => s.provincia).filter(Boolean))];
    doc.font('R').fontSize(9).fillColor(T.grey).text(`${sedi.length} ${sedi.length === 1 ? 'sede' : 'sedi'}${province.length ? ` in ${province.length} ${province.length === 1 ? 'provincia' : 'province'}` : ''} · laboratorio di analisi, diagnostica per immagini, medicina specialistica`, tx, 18.5 * MM, { width: W - 66 * MM - 62 * MM, height: 12, ellipsis: true });
    doc.font('R').fontSize(8).fillColor(T.teal);
    [c.email, c.pec, c.website].filter(Boolean).forEach((v, i) => doc.text(v, L + W - 60 * MM, 10.5 * MM + i * 10.5, { width: 60 * MM, align: 'right', lineBreak: false }));
    const Y0 = 30 * MM; const Y1 = PH - 21 * MM;
    doc.moveTo(L, Y0 - 7).lineTo(L + W, Y0 - 7).lineWidth(0.6).strokeColor(T.blu).stroke();

    // ---- mappa (a sinistra)
    const MW = W * 0.44; const MH = Y1 - Y0; const MX = L; const MY = Y0;
    const prov = mappaToscana().province || {};
    const pts = Object.values(prov).flatMap((p) => p.rings.flat());
    const mappaOk = pts.length > 0;
    let proj = () => null;
    if (mappaOk) {
      const lons = pts.map((p) => p[0]); const lats = pts.map((p) => p[1]);
      const lo0 = Math.min(...lons); const lo1 = Math.max(...lons); const la0 = Math.min(...lats); const la1 = Math.max(...lats);
      const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
      const sc = Math.min((MW - 8) / ((lo1 - lo0) * k), (MH - 8) / (la1 - la0));
      const ox = MX + (MW - (lo1 - lo0) * k * sc) / 2; const oy = MY + (MH - (la1 - la0) * sc) / 2;
      proj = (lng, lat) => (lng < lo0 - 0.05 || lng > lo1 + 0.05 || lat < la0 - 0.05 || lat > la1 + 0.05 ? null : [ox + (lng - lo0) * k * sc, oy + (la1 - lat) * sc]);
      const P = (lng, lat) => [ox + (lng - lo0) * k * sc, oy + (la1 - lat) * sc];
      for (const p of Object.values(prov)) for (const r of p.rings) {
        r.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) doc.lineTo(px, py); else doc.moveTo(px, py); });
        doc.closePath().lineWidth(1.1).fillAndStroke(T.terra, T.bordo);
      }
      // sigla della provincia al centro dell'anello principale
      doc.font('B').fontSize(7).fillColor('#9DBEC5');
      for (const [sig, p] of Object.entries(prov)) {
        const r = p.rings.reduce((a, b) => (b.length > a.length ? b : a), p.rings[0] || []);
        if (!r.length) continue;
        const cx = r.reduce((a, q) => a + q[0], 0) / r.length; const cy = r.reduce((a, q) => a + q[1], 0) / r.length; const [px, py] = P(cx, cy);
        doc.text(sig, px - 10, py - 3, { width: 20, align: 'center', lineBreak: false });
      }
    }
    // segnaposto: punto vero + bolla numerata, allontanate tra loro quando le sedi sono vicine
    const R = sedi.length > 30 ? 5.2 : 6.4;
    const pin = sedi.map((s) => { const q = s.lat != null && s.lng != null ? proj(s.lng, s.lat) : null; return q ? { s, ax: q[0], ay: q[1], x: q[0], y: q[1] - R - 3 } : null; }).filter(Boolean);
    for (let it = 0; it < 400; it++) {
      let mosso = false;
      for (let i = 0; i < pin.length; i++) for (let j = i + 1; j < pin.length; j++) {
        const a = pin[i]; const b = pin[j]; let dx = b.x - a.x; let dy = b.y - a.y; let d = Math.hypot(dx, dy);
        const min = 2 * R + 1.5;
        if (d < min) { if (d < 0.01) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); d = 1; } const sp = (min - d) / 2; a.x -= (dx / d) * sp; a.y -= (dy / d) * sp; b.x += (dx / d) * sp; b.y += (dy / d) * sp; mosso = true; }
      }
      for (const p of pin) { p.x += (p.ax - p.x) * 0.02; p.y += (p.ay - R - 3 - p.y) * 0.02; p.x = Math.max(MX + R, Math.min(MX + MW - R, p.x)); p.y = Math.max(MY + R, Math.min(MY + MH - R, p.y)); }
      if (!mosso && it > 40) break;
    }
    for (const p of pin) { doc.moveTo(p.ax, p.ay).lineTo(p.x, p.y).lineWidth(0.7).strokeColor(T.teal).stroke(); doc.circle(p.ax, p.ay, 1.7).fill(T.jet); }
    for (const p of pin) {
      doc.circle(p.x, p.y, R).lineWidth(1).fillAndStroke(T.teal, '#FFFFFF');
      doc.font('B').fontSize(p.s.n > 99 ? R * 0.8 : R).fillColor('#FFFFFF').text(String(p.s.n), p.x - R, p.y - R * 0.36 * (p.s.n > 99 ? 0.8 : 1) - 0.6, { width: 2 * R, align: 'center', lineBreak: false });
    }
    const conPin = new Set(pin.map((p) => p.s.n));

    // ---- elenco delle sedi (a destra): si adatta in colonne e corpo del carattere per stare nella pagina
    const EX = L + MW + 9 * MM; const EW = L + W - EX; const EH = Y1 - Y0;
    const misura = (fs, cols) => {
      const cw = (EW - (cols - 1) * 12) / cols; const tw = cw - (fs * 1.9 + 6);
      const alt = sedi.map((s) => { doc.font('B').fontSize(fs); const h1 = doc.heightOfString(s.nome, { width: tw }); doc.font('R').fontSize(fs * 0.86); const h2 = doc.heightOfString([s.tipo, s.indirizzo, s.tel ? `Tel. ${s.tel}` : null].filter(Boolean).join(' · '), { width: tw }); return h1 + h2 + fs * 0.75; });
      // riempimento delle colonne in ordine
      const colonne = []; let cur = []; let h = 0;
      alt.forEach((a, i) => { if (h + a > EH && cur.length) { colonne.push(cur); cur = []; h = 0; } cur.push(i); h += a; });
      if (cur.length) colonne.push(cur);
      return { ok: colonne.length <= cols, cw, tw, alt, colonne };
    };
    let scelta = null;
    for (const cols of [1, 2, 3]) { for (let fs = cols === 1 ? 10.5 : 9.5; fs >= 5.2; fs -= 0.3) { const m = misura(fs, cols); if (m.ok) { scelta = { fs, cols, ...m }; break; } } if (scelta && scelta.fs >= (cols === 1 ? 8 : 6.2)) break; if (cols < 3) scelta = scelta && scelta.fs >= 6.2 ? scelta : null; }
    if (!scelta) { const fs = 5.2; scelta = { fs, cols: 3, ...misura(fs, 3) }; }
    const { fs, cw, tw, alt, colonne } = scelta;
    colonne.slice(0, scelta.cols).forEach((col, ci) => {
      const x = EX + ci * (cw + 12); let y = Y0;
      for (const i of col) {
        const s = sedi[i]; const r = fs * 0.82; const cy = y + r + 0.5;
        if (conPin.has(s.n)) doc.circle(x + r, cy, r).fill(T.teal); else doc.circle(x + r, cy, r - 0.5).lineWidth(0.9).strokeColor(T.teal).stroke();
        doc.font('B').fontSize(s.n > 99 ? fs * 0.66 : fs * 0.8).fillColor(conPin.has(s.n) ? '#FFFFFF' : T.teal).text(String(s.n), x, cy - fs * 0.3, { width: 2 * r, align: 'center', lineBreak: false });
        const xt = x + fs * 1.9 + 6;
        doc.font('B').fontSize(fs).fillColor(T.jet).text(s.nome, xt, y, { width: tw });
        doc.font('R').fontSize(fs * 0.86).fillColor(T.grey).text([s.tipo, s.indirizzo, s.tel ? `Tel. ${s.tel}` : null].filter(Boolean).join(' · '), xt, doc.y, { width: tw });
        y += alt[i];
      }
    });
    if (!sedi.length) doc.font('R').fontSize(10).fillColor(T.grey).text('Nessuna sede attiva in questo elenco.', EX, Y0, { width: EW });

    // ---- piè di pagina della carta intestata
    doc.moveTo(L, Y1 + 6).lineTo(L + W, Y1 + 6).lineWidth(0.6).strokeColor(T.blu).stroke();
    const [p1, p2, p3] = PIEDE(c); let fy = Y1 + 12;
    doc.font('B').fontSize(8).fillColor(T.teal).text(p1, L, fy, { width: W, align: 'center', lineBreak: false }); fy += 10;
    doc.font('R').fontSize(7.6).fillColor(T.teal).text(p2, L, fy, { width: W, align: 'center', lineBreak: false }); fy += 9.5;
    doc.text(p3, L, fy, { width: W, align: 'center', lineBreak: false });
    doc.font('R').fontSize(5.5).fillColor('#93A5AA').text(`Aggiornato al ${oggi()}`, L, PH - 9, { width: W / 2, lineBreak: false });
    if (mappaOk) doc.text('Confini delle province: ISTAT', L + W / 2, PH - 9, { width: W / 2, align: 'right', lineBreak: false });
    doc.end();
  });
}
