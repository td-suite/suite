// Turni del mese di una persona, in PDF (v0.79.0, richiesta del CEO del 17/11/2026): è l'allegato della comunicazione che parte alla
// conferma del mese. Una riga per turno (giorno, orario, sede, attività, note), ore totali e data di conferma. Stesso carattere e stesso
// logo delle altre stampe della Suite (cartella assets di Orders Management).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'orders', 'assets');
const C = { teal: '#1C505E', jet: '#01212C', grey: '#5B6B70', line: '#C9D9DC', light: '#EEF4F5' };
const MM = 2.8346;
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const hm = (t) => String(t || '').slice(0, 5);
const minuti = (t) => { const [h, m] = hm(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const oreTurni = (turni) => Math.round(turni.reduce((a, t) => a + Math.max(0, minuti(t.ora_a) - minuti(t.ora_da)), 0) / 6) / 10;
export const meseEsteso = (m) => `${MESI[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * turni: [{ data 'AAAA-MM-GG', ora_da, ora_a, sede, attivita, nota }] già ordinati. Ritorna un Buffer.
 */
export function pdfTurniPersona({ mese, nome, profilo = null, turni, confermatoIl = null, azienda = 'Toscana Diagnostica' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 14 * MM, bottom: 16 * MM, left: 16 * MM, right: 16 * MM }, info: { Title: `Turni di ${meseEsteso(mese)} · ${nome}`, Author: azienda } });
    const pezzi = []; doc.on('data', (b) => pezzi.push(b)); doc.on('end', () => resolve(Buffer.concat(pezzi))); doc.on('error', reject);
    try { doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf')); doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf')); }
    catch { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
    const L = doc.page.margins.left; const W = doc.page.width - L - doc.page.margins.right; const FONDO = doc.page.height - doc.page.margins.bottom - 10;
    const COL = [{ t: 'Giorno', w: 0.24 }, { t: 'Dalle', w: 0.09 }, { t: 'Alle', w: 0.09 }, { t: 'Sede', w: 0.26 }, { t: 'Attività', w: 0.16 }, { t: 'Note', w: 0.16 }].map((c) => ({ ...c, w: c.w * W }));
    const intestazione = () => {
      doc.rect(0, 0, doc.page.width, 4).fill(C.teal);
      try { doc.image(path.join(ASSETS, 'logo-td.png'), L, 9 * MM, { fit: [52 * MM, 14 * MM] }); } catch { /* logo assente */ }
      doc.font('B').fontSize(15).fillColor(C.jet).text(`Turni di ${meseEsteso(mese)}`, L, 28 * MM, { width: W });
      doc.font('R').fontSize(10.5).fillColor(C.grey).text([nome, profilo].filter(Boolean).join(' · '), L, doc.y + 2, { width: W });
      let y = doc.y + 10;
      doc.rect(L, y, W, 18).fill(C.teal);
      let x = L; doc.font('B').fontSize(8.5).fillColor('#fff');
      for (const c of COL) { doc.text(c.t, x + 5, y + 5, { width: c.w - 8, lineBreak: false }); x += c.w; }
      return y + 18;
    };
    let y = intestazione();
    turni.forEach((t, i) => {
      const d = new Date(`${String(t.data).slice(0, 10)}T12:00:00Z`);
      const celle = [`${GIORNI[d.getUTCDay()]} ${String(t.data).slice(8, 10)}/${String(t.data).slice(5, 7)}`, hm(t.ora_da), hm(t.ora_a), String(t.sede || ''), String(t.attivita || ''), String(t.nota || '')];
      doc.font('R').fontSize(9);
      const h = Math.max(18, ...celle.map((txt, k) => doc.heightOfString(txt, { width: COL[k].w - 8 }) + 9));
      if (y + h > FONDO) { doc.addPage(); y = intestazione(); }
      if (i % 2 === 1) doc.rect(L, y, W, h).fill(C.light);
      let x = L;
      celle.forEach((txt, k) => { doc.font(k === 0 ? 'B' : 'R').fontSize(9).fillColor(C.jet).text(txt, x + 5, y + 5, { width: COL[k].w - 8 }); x += COL[k].w; });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
      y += h;
    });
    if (y + 46 > FONDO) { doc.addPage(); y = intestazione(); }
    const ore = oreTurni(turni);
    doc.font('B').fontSize(10).fillColor(C.jet).text(`${turni.length} ${turni.length === 1 ? 'turno' : 'turni'} · ${String(ore).replace('.', ',')} ore`, L, y + 10, { width: W });
    doc.font('R').fontSize(8.5).fillColor(C.grey).text(`${confermatoIl ? `Pianificazione confermata il ${confermatoIl}. ` : ''}Eventuali variazioni successive vengono comunicate dal gestore di sede e sono sempre visibili nel portale Room Planning della Suite.`, L, doc.y + 4, { width: W });
    doc.end();
  });
}

/** Testo della comunicazione alla persona in turno (corpo dell'email, senza saluti di rito superflui). */
export function testoComunicazioneTurni({ nome, mese, turni, base }) {
  const sedi = [...new Set(turni.map((t) => t.sede).filter(Boolean))];
  const giorno = (t) => `${String(t.data).slice(8, 10)}/${String(t.data).slice(5, 7)}`;
  const ore = String(oreTurni(turni)).replace('.', ',');
  return `Gentile ${nome},

ti comunichiamo la pianificazione dei turni di ${meseEsteso(mese)}, confermata dalla Direzione.

Per te sono previsti ${turni.length} ${turni.length === 1 ? 'turno' : 'turni'}, per un totale di ${ore} ore, ${sedi.length === 1 ? `presso la sede di ${sedi[0]}` : `nelle sedi di ${sedi.join(', ')}`}. Il primo è il ${giorno(turni[0])} dalle ${hm(turni[0].ora_da)} alle ${hm(turni[0].ora_a)}, l'ultimo il ${giorno(turni[turni.length - 1])}.

In allegato trovi il prospetto completo del mese in PDF, con giorno, orario, sede e attività di ciascun turno.

Se un turno non è compatibile con i tuoi impegni segnalalo al più presto al gestore della tua sede, così da poter organizzare la sostituzione. Eventuali variazioni ti verranno comunicate e restano sempre aggiornate nel portale Room Planning${base ? ` (${base}/room)` : ''}.

Grazie per la collaborazione.
Toscana Diagnostica`;
}
