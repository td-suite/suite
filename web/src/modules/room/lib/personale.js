// Helper del modulo Personale sanitario (frontend) + PDF rendiconto e turni
import { mkDoc, table, section } from './exports.js';
import { DAYS, DAYS_S } from './network.js';

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseTxt = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return `${MESI[Number(mm) - 1]} ${y}`; };
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const daysOf = (m) => { const [y, mm] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
export const dow = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const itD = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const t2m = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const ore = (da, a) => Math.max(0, t2m(a) - t2m(da)) / 60;
export const oreTxt = (h) => { const m = Math.round(h * 60); return m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}'` : `${m / 60}h`; };
export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
export const STATO_REND = { BOZZA: ['Bozza', 'grey'], DA_APPROVARE: ['Da approvare', 'amber'], APPROVATO: ['Approvato', 'teal'], INVIATO: ['Inviato', 'green'], RESPINTO: ['Respinto', 'red'] };
export const RAPPORTO = { LP: 'Libero professionista', DIPENDENTE: 'Dipendente', CONVENZIONATO: 'Convenzionato', SOCIETA: 'Società / cooperativa' };
export const REGIME = { FORFETTARIO: 'Forfettario (no IVA, no ritenuta)', ORDINARIO: 'Ordinario (IVA + ritenuta d\'acconto)', DIPENDENTE: 'Dipendente (busta paga)', ALTRO: 'Altro' };
export const DOC_LABEL = { CV: 'Curriculum', DOCUMENTO_IDENTITA: 'Documento d\'identità', CODICE_FISCALE: 'Codice fiscale / tessera', ALBO: 'Iscrizione all\'albo', ASSICURAZIONE: 'Assicurazione RC', TITOLO_STUDIO: 'Titolo di studio', CONTRATTO: 'Contratto', PRIVACY: 'Privacy / consensi', ALTRO: 'Altro' };
export { DAYS, DAYS_S };

// mkDoc è asincrona (jsPDF si carica al primo uso): va attesa, altrimenti `doc` è una Promise e il PDF non nasce
export async function pdfRendiconto(r) {
  const det = r.dettaglio || {}; const o = det.oneri || {};
  const doc = await mkDoc(`Rendiconto compensi · ${meseTxt(r.mese)}`, `${r.nome}${r.profilo ? ' · ' + r.profilo : ''}${det.professionista?.piva ? ' · P.IVA ' + det.professionista.piva : ''}${det.professionista?.cf ? ' · CF ' + det.professionista.cf : ''}`);
  let y = 30;
  y = section(doc, det.tipo === 'FISSO' ? `Compenso fisso mensile: ${eur(det.fisso)}` : `Prestazioni confermate: ${oreTxt(Number(r.ore))} · imponibile ${eur(r.importo)}`, y);
  if (det.righe?.length) y = table(doc, ['Data', 'Sede', 'Dalle', 'Alle', 'Ore', 'Tariffa', 'Importo', 'Attività', 'Note'], det.righe.map((x) => [itD(x.data), x.sede, x.oraDa, x.oraA, oreTxt(x.ore), det.tipo === 'FISSO' ? '—' : eur(x.tariffa), det.tipo === 'FISSO' ? '—' : eur(x.importo), x.attivita, x.nota]), y) + 6;
  if (det.perSede?.length) { y = section(doc, 'Riepilogo per sede', y); y = table(doc, ['Sede', 'Presenze', 'Ore', 'Importo'], det.perSede.map((s) => [s.sede, String(s.presenze), oreTxt(s.ore), eur(s.importo)]), y) + 6; }
  y = section(doc, 'Totali per la fattura', y);
  const rows = [['Imponibile', eur(o.imponibile)]];
  if (det.compenso?.cassaPct) rows.push([`Cassa previdenziale ${det.compenso.cassaPct}%`, eur(o.cassa)]);
  if (det.compenso?.ivaPct) rows.push([`IVA ${det.compenso.ivaPct}%`, eur(o.iva)]);
  rows.push(['Totale fattura', eur(o.totaleFattura)]);
  if (det.compenso?.ritPct) rows.push([`Ritenuta d'acconto ${det.compenso.ritPct}%`, '− ' + eur(o.ritenuta)], ['Netto a pagare', eur(o.netto)]);
  y = table(doc, ['Voce', 'Importo'], rows, y, { columnStyles: { 1: { halign: 'right' } }, tableWidth: 120 }) + 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 90, 95);
  doc.text(`Stato: ${STATO_REND[r.stato]?.[0] || r.stato}${r.approvato_da_nome ? ` · approvato da ${r.approvato_da_nome} il ${new Date(r.approvato_at).toLocaleDateString('it-IT')}` : ''}${r.nota ? ` · ${r.nota}` : ''}`, 12, y);
  doc.text('Importi calcolati dalle presenze confermate dai gestori di sede e dalle condizioni di compenso in anagrafica; gli oneri fiscali sono indicativi e vanno verificati in fattura.', 12, y + 5);
  return { doc, filename: `Rendiconto_${r.mese}_${String(r.nome).replace(/[^\w]+/g, '_')}.pdf` };
}

// Piano dei turni in PDF come calendario (richiesta del CEO del 18/11/2026): un solo file, una pagina di calendario per sede
// (lunedì-domenica, una riga per settimana), in ogni giorno i turni con orario, persona e attività. Per una persona (Portale) un
// solo calendario con la sede al posto del nome. Le righe si allargano secondo il contenuto; se il mese non entra in una pagina il
// carattere si riduce e, solo se non basta, le settimane continuano nella pagina dopo.
// sede_id è numerico dall'anagrafica unica (public.sites.id): tutti i confronti e le celle passano da String().
const TEAL = [28, 80, 94]; const JET = [1, 33, 44]; const GRIGIO = [91, 107, 112]; const ROSSO = [179, 38, 30];
export function settimaneDelMese(mese) {
  const giorni = daysOf(mese); const sett = [];
  let riga = new Array(7).fill(null);
  for (const d of giorni) { const k = dow(d); riga[k] = d; if (k === 6) { sett.push(riga); riga = new Array(7).fill(null); } }
  if (riga.some(Boolean)) sett.push(riga);
  return sett;
}
export async function pdfTurni(mese, turni, label, sediMap = {}, { perPersona = false } = {}) {
  const doc = await mkDoc(`Turni · ${meseTxt(mese)}`, label || '');
  const nomeSede = (t) => String(sediMap[t.sede_id] || t.sede || t.sede_id || '');
  const hm = (x) => String(x || '').slice(0, 5);
  const persona = (t) => t.prof_nome || t.nome || 'SCOPERTO';
  const gruppi = perPersona ? [[label || '', turni]] : Object.entries(turni.reduce((m, t) => { (m[nomeSede(t)] ||= []).push(t); return m; }, {})).sort((a, b) => a[0].localeCompare(b[0], 'it'));
  const X0 = 10; const W = 277; const CW = W / 7; const Y0 = 26; const HEAD = 6; const FONDO = 198; const sett = settimaneDelMese(mese);
  const pagina = (titolo, prima) => {
    if (!prima) { doc.addPage(); doc.setFillColor(...TEAL); doc.rect(0, 0, 297, 4, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...TEAL); doc.text(`Turni · ${meseTxt(mese)}`, X0, 14); }
    if (titolo) { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...JET); doc.text(titolo, 287, prima ? 14 : 14, { align: 'right' }); }
    doc.setFillColor(...TEAL); doc.rect(X0, Y0, W, HEAD, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
    DAYS.forEach((g, k) => doc.text(String(g), X0 + k * CW + CW / 2, Y0 + 4.2, { align: 'center' }));
    return Y0 + HEAD;
  };
  let prima = true;
  for (const [titolo, lista] of gruppi) {
    const perGiorno = {};
    for (const t of lista) (perGiorno[String(t.data).slice(0, 10)] ||= []).push(t);
    for (const k of Object.keys(perGiorno)) perGiorno[k].sort((a, b) => hm(a.ora_da).localeCompare(hm(b.ora_da)) || persona(a).localeCompare(persona(b), 'it'));
    // voci di ogni giorno, con il carattere più grande che fa entrare il mese in una pagina (da 8 a 5,5 punti)
    const componi = (fs) => {
      const lh = fs * 0.3528 * 1.18; doc.setFontSize(fs);
      const celle = {}; const alt = sett.map((riga) => {
        let max = 0;
        for (const d of riga) {
          if (!d) continue;
          const voci = (perGiorno[d] || []).map((t) => {
            const chi = perPersona ? nomeSede(t) : persona(t);
            doc.setFont('helvetica', 'bold');
            const righe = doc.splitTextToSize(`${hm(t.ora_da)}-${hm(t.ora_a)} ${chi}`, CW - 3);
            doc.setFont('helvetica', 'normal');
            const sotto = [perPersona ? '' : (t.prof_profilo || t.profilo || ''), t.attivita || '', t.nota || ''].filter(Boolean).join(' · ');
            const righe2 = sotto ? doc.splitTextToSize(sotto, CW - 3) : [];
            return { righe, righe2, scoperto: !perPersona && !(t.prof_nome || t.nome), h: (righe.length + righe2.length) * lh + 0.8 };
          });
          celle[d] = voci; max = Math.max(max, 6.5 + voci.reduce((a, v) => a + v.h, 0) + 1);
        }
        return Math.max(max, 16);
      });
      return { lh, celle, alt, tot: alt.reduce((a, b) => a + b, 0) };
    };
    let fs = 8; let c = componi(fs);
    const spazio = FONDO - (Y0 + HEAD);
    while (c.tot > spazio && fs > 5.5) { fs = Math.round((fs - 0.5) * 10) / 10; c = componi(fs); }
    const extra = c.tot < spazio ? (spazio - c.tot) / sett.length : 0;   // il calendario riempie la pagina
    let y = pagina(perPersona ? '' : titolo, prima); prima = false;
    sett.forEach((riga, i) => {
      const h = c.alt[i] + extra;
      if (y + h > FONDO + 0.1) y = pagina(perPersona ? '' : `${titolo} (segue)`, false);
      riga.forEach((d, k) => {
        const x = X0 + k * CW;
        if (!d) { doc.setFillColor(243, 246, 247); doc.rect(x, y, CW, h, 'F'); }
        else if (k >= 5) { doc.setFillColor(250, 248, 240); doc.rect(x, y, CW, h, 'F'); }
        doc.setDrawColor(201, 217, 220); doc.setLineWidth(0.2); doc.rect(x, y, CW, h, 'S');
        if (!d) return;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...TEAL); doc.text(String(Number(d.slice(8, 10))), x + 1.6, y + 4.6);
        let yy = y + 6.5 + c.lh * 0.8;
        for (const v of c.celle[d] || []) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(...(v.scoperto ? ROSSO : JET));
          for (const r of v.righe) { doc.text(r, x + 1.6, yy); yy += c.lh; }
          doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIGIO);
          for (const r of v.righe2) { doc.text(r, x + 1.6, yy); yy += c.lh; }
          yy += 0.8;
        }
      });
      y += h;
    });
    const minuti = lista.reduce((a, t) => a + Math.max(0, t2m(hm(t.ora_a)) - t2m(hm(t.ora_da))), 0);
    const scoperti = perPersona ? 0 : lista.filter((t) => !(t.prof_nome || t.nome)).length;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIGIO);
    doc.text(`${lista.length} ${lista.length === 1 ? 'turno' : 'turni'} · ${oreTxt(minuti / 60)}${scoperti ? ` · ${scoperti} scoperti (in rosso)` : ''}`, X0, 204);
  }
  const np = doc.getNumberOfPages();
  if (np > 1) for (let p = 1; p <= np; p += 1) { doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIGIO); doc.text(`pagina ${p} di ${np}`, 287, 204, { align: 'right' }); }
  return { doc, filename: `Turni_${mese}${label ? '_' + label.replace(/[^\w]+/g, '_') : ''}.pdf` };
}
