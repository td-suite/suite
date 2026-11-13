// Rimborso Spese · PDF della nota mensile che riproduce i due moduli SGI in uso (TD-SGI-MOD025 Rimborso Spese e TD-SGI-MOD029 Rimborso
// Chilometrico, revisione 00 del 12/04/2026): intestazione con i codici, dati del richiedente, tabelle, riepilogo, le tre "firme" come
// attestazioni elettroniche (invio, approvazione, liquidazione: nome, data e ora) e l'elenco dei giustificativi con miniatura o nome file.
// pdfkit con i font LiberationSans e il logo della Suite, come gli altri PDF (Piano Ferie, Ordini). Dati aziendali da getCompany().
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { getCompany } from '../../../lib/company.js';
import { readBuffer } from '../../../lib/moduleStorage.js';
import { many } from '../db.js';
import { MODULI_CARTACEI, RIF_PROCEDURA } from '../config.js';
import { nomeMese, itData, primoGiorno, ultimoGiorno, METODI } from './calcoli.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shipments', 'assets');
const FONT_R = path.join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_B = path.join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = fs.existsSync(path.join(ASSETS, 'logo-td.png')) ? fs.readFileSync(path.join(ASSETS, 'logo-td.png')) : null;
const C = { teal: '#1C505E', head: '#1F4E5A', light: '#EAF3F5', line: '#9FB7BD', ink: '#0F2A33', grey: '#5B6B70', red: '#B3261E', green: '#2F7D5B' };
const n2 = (v) => Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (v) => Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const t4 = (v) => (v == null ? '' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const dataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const IMMAGINI = new Set(['image/jpeg', 'image/png']);

/**
 * PDF della nota. sc: scheda (lib/scheda.js) con nota, persona, spese, viaggi, riepilogo, eventi, eccezione, vettura_aziendale.
 * Ritorna un Buffer.
 */
export async function notaPdf(sc, { generato = new Date() } = {}) {
  const company = await getCompany();
  const n = sc.nota;
  const allegati = await many('SELECT * FROM allegati WHERE nota_id=$1 AND riga_tipo <> \'NOTA\' ORDER BY riga_tipo DESC, riga_id, id', [n.id]);
  const buffers = new Map();
  for (const a of allegati) if (IMMAGINI.has(a.mime)) { try { buffers.set(a.id, await readBuffer(a)); } catch { /* miniatura facoltativa */ } }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: `Nota spese ${nomeMese(n.anno, n.mese)} ${sc.persona.nome}`, Author: 'Suite TD · Toscana Diagnostica', Subject: `${MODULI_CARTACEI.MOD025.codice}_${MODULI_CARTACEI.MOD025.revisione} e ${MODULI_CARTACEI.MOD029.codice}_${MODULI_CARTACEI.MOD029.revisione}` } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    if (fs.existsSync(FONT_R)) { doc.registerFont('R', FONT_R); doc.registerFont('B', FONT_B); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }
    const W = doc.page.width, H = doc.page.height, M = 36, CW = W - 2 * M;
    const BOTTOM = H - 70;
    let y = 0;

    const intestazione = () => {
      if (LOGO) { try { doc.image(LOGO, M, 26, { fit: [150, 36] }); } catch { /* logo facoltativo */ } }
      doc.font('R').fontSize(7.5).fillColor(C.teal);
      const contatti = [company.email, company.pec, company.website].filter(Boolean);
      contatti.forEach((t, i) => doc.text(t, W - M - 200, 28 + i * 10, { width: 200, align: 'right' }));
      y = 74;
    };
    const nuovaPagina = () => { doc.addPage(); intestazione(); };
    const spazio = (h) => { if (y + h > BOTTOM) nuovaPagina(); };

    // tabella: cols [{ t, w, a }], righe di celle (stringhe); opts.totale = riga finale in grassetto; opts.grigie = Set degli indici attenuati
    const tabella = (cols, righe, { totale = null, grigie = new Set(), font = 8, header = true } = {}) => {
      const pad = 3;
      const altezza = (celle, f, bold) => {
        doc.font(bold ? 'B' : 'R').fontSize(f);
        return Math.max(14, ...celle.map((c, i) => doc.heightOfString(String(c ?? ''), { width: cols[i].w - 2 * pad }) + 2 * pad));
      };
      const riga = (celle, { bold = false, fill = null, color = C.ink, f = font } = {}) => {
        const h = altezza(celle, f, bold);
        if (y + h > BOTTOM) { nuovaPagina(); if (header) riga(cols.map((c) => c.t), { bold: true, fill: C.head, color: '#FFFFFF', f: 7.5 }); }
        let x = M;
        if (fill) doc.rect(M, y, CW, h).fill(fill);
        doc.lineWidth(0.5).strokeColor(C.line);
        cols.forEach((c, i) => {
          doc.rect(x, y, c.w, h).stroke();
          doc.font(bold ? 'B' : 'R').fontSize(f).fillColor(color).text(String(celle[i] ?? ''), x + pad, y + pad, { width: c.w - 2 * pad, align: c.a || 'left' });
          x += c.w;
        });
        y += h;
      };
      if (header) riga(cols.map((c) => c.t), { bold: true, fill: C.head, color: '#FFFFFF', f: 7.5 });
      righe.forEach((r, i) => riga(r, { color: grigie.has(i) ? C.grey : C.ink, fill: i % 2 ? '#F7FAFB' : null }));
      if (totale) riga(totale, { bold: true, fill: C.light });
    };
    const fascia = (testo) => {
      spazio(40);
      doc.rect(M, y, CW, 16).fill(C.head);
      doc.font('B').fontSize(8.5).fillColor('#FFFFFF').text(testo, M + 6, y + 4, { width: CW - 12 });
      y += 16;
    };
    // coppie etichetta / valore come "DATI DEL RICHIEDENTE" e "RIEPILOGO" dei moduli
    const coppie = (voci, wl = 190) => {
      for (const [k, v, opz = {}] of voci) {
        doc.font('R').fontSize(8.5);
        const hv = doc.heightOfString(String(v ?? ''), { width: CW - wl - 10 });
        doc.font('B').fontSize(8.5);
        const h = Math.max(16, hv + 8, doc.heightOfString(String(k), { width: wl - 10 }) + 8);
        spazio(h);
        doc.rect(M, y, wl, h).fill(C.light);
        doc.lineWidth(0.5).strokeColor(C.line).rect(M, y, wl, h).stroke().rect(M + wl, y, CW - wl, h).stroke();
        doc.font('B').fontSize(8.5).fillColor(C.ink).text(k, M + 5, y + 4, { width: wl - 10 });
        doc.font(opz.bold ? 'B' : 'R').fontSize(8.5).fillColor(opz.color || C.ink).text(String(v ?? ''), M + wl + 5, y + 4, { width: CW - wl - 10 });
        y += h;
      }
    };

    // ---------------------------------------------------------------- prima pagina: titolo e codici
    intestazione();
    // come nei moduli: "TOSCANA DIAGNOSTICA S.r.l." (la forma giuridica resta com'è)
    const ragione = String(company.legal_name || 'Toscana Diagnostica S.r.l.');
    const mf = ragione.match(/^(.+?)\s+(S\.r\.l\.|S\.p\.A\.|S\.n\.c\.|S\.a\.s\.|S\.r\.l\.s\.)$/i);
    doc.font('B').fontSize(14).fillColor(C.teal).text(mf ? `${mf[1].toUpperCase()} ${mf[2]}` : ragione.toUpperCase(), M, y, { width: CW, align: 'center' });
    doc.font('R').fontSize(8.5).fillColor(C.teal).text('Sistema di Gestione Integrato', M, y + 17, { width: CW, align: 'center' });
    doc.font('B').fontSize(12.5).fillColor(C.teal).text(`NOTA SPESE MENSILE · ${nomeMese(n.anno, n.mese).toUpperCase()}`, M, y + 36, { width: CW, align: 'center' });
    doc.font('R').fontSize(8.5).fillColor(C.grey).text('Modulo Rimborso Spese e Modulo Rimborso Chilometrico · Area 12 · People', M, y + 53, { width: CW, align: 'center' });
    y += 70;
    const m25 = MODULI_CARTACEI.MOD025, m29 = MODULI_CARTACEI.MOD029;
    tabella([{ t: 'Codice', w: 150, a: 'center' }, { t: 'Titolo', w: 170, a: 'center' }, { t: 'Revisione', w: 70, a: 'center' }, { t: 'Data', w: 70, a: 'center' }, { t: 'Classificazione', w: CW - 460, a: 'center' }],
      [[`${m25.codice}_${m25.revisione}`, m25.titolo, m25.revisione, itData(m25.data), 'Interno'], [`${m29.codice}_${m29.revisione}`, m29.titolo, m29.revisione, itData(m29.data), 'Interno']], { font: 8 });
    doc.font('B').fontSize(8.5).fillColor(C.ink).text(`Rif.: ${RIF_PROCEDURA} · TD-SGI-IDL006 (CCNL) · TD-SGI-IDL008 (TeamSystem HR)`, M, y + 6, { width: CW, align: 'center' });
    y += 24;

    // ---------------------------------------------------------------- dati del richiedente
    const viaggiVivi = sc.viaggi.filter((v) => !v.esclusa);
    const veicoli = [...new Set(viaggiVivi.map((v) => v.veicolo_testo).filter(Boolean))];
    const tariffe = [...new Set(viaggiVivi.filter((v) => v.rimborsabile && v.tariffa != null).map((v) => t4(v.tariffa)))];
    fascia('DATI DEL RICHIEDENTE');
    coppie([
      ['Cognome e nome', sc.persona.nome],
      ['Funzione / Area', [sc.persona.role_name || sc.persona.job_title, sc.persona.unit_name].filter(Boolean).join(' · ') || ''],
      ['Sede di lavoro', sc.persona.site_name || ''],
      ['Periodo di riferimento (dal - al)', `${itData(primoGiorno(n.anno, n.mese))} - ${itData(ultimoGiorno(n.anno, n.mese))}`],
      ['Motivazione della trasferta', n.motivazione || 'indicata sulle singole righe'],
      ['Veicolo utilizzato (marca, modello, targa)', veicoli.join('; ') || (viaggiVivi.length ? '' : 'nessun viaggio nel mese')],
      ['Tariffa ACI applicata (EUR/km)', sc.vettura_aziendale ? 'vettura aziendale: nessun rimborso chilometrico' : tariffe.join('; ') || ''],
    ]);
    y += 10;

    // ---------------------------------------------------------------- MOD025: spese
    const catTipo = (s) => s.categoria_tipo;
    const speseMod25 = sc.spese.filter((s) => s.metodo === 'DIPENDENTE' && !['PEDAGGIO', 'PARCHEGGIO'].includes(catTipo(s)));
    const giust = (s) => (s.allegati.length ? `Sì (${s.allegati.length})` : sc.eccezione ? 'No (facoltativo)' : 'No');
    fascia(`RIMBORSO SPESE · ${m25.codice}_${m25.revisione}`);
    const c25 = [{ t: 'N.', w: 24, a: 'center' }, { t: 'Data', w: 52, a: 'center' }, { t: 'Descrizione spesa', w: 205 }, { t: 'Categoria', w: 90 }, { t: 'Importo (EUR)', w: 70, a: 'right' }, { t: 'Giustificativo allegato', w: CW - 441, a: 'center' }];
    const grig25 = new Set();
    const righe25 = speseMod25.map((s, i) => {
      if (s.esclusa) grig25.add(i);
      const extra = [s.motivazione, s.cliente ? `cliente: ${s.cliente}` : null, s.progetto ? `progetto: ${s.progetto}` : null, s.esclusa ? `ESCLUSA dal responsabile: ${s.esclusa_motivo || ''}` : null].filter(Boolean).join(' · ');
      return [i + 1, itData(s.data), `${s.descrizione}${extra ? `\n${extra}` : ''}`, s.categoria, s.esclusa ? `(${n2(s.importo)})` : n2(s.importo), giust(s)];
    });
    if (!righe25.length) righe25.push(['', '', 'Nessuna spesa nel mese', '', '', '']);
    tabella(c25, righe25, { totale: ['', '', '', 'TOTALE', n2(sc.riepilogo.tot_spese), ''], grigie: grig25 });
    const carta = sc.spese.filter((s) => s.metodo !== 'DIPENDENTE');
    if (carta.length) {
      y += 6; spazio(30);
      doc.font('B').fontSize(8).fillColor(C.ink).text('Spese pagate con carta aziendale o fuel card (non rimborsabili: solo riconciliazione)', M, y); y += 12;
      tabella([{ t: 'Data', w: 52, a: 'center' }, { t: 'Descrizione', w: 220 }, { t: 'Categoria', w: 90 }, { t: 'Pagamento', w: CW - 432 }, { t: 'Importo (EUR)', w: 70, a: 'right' }],
        carta.map((s) => [itData(s.data), s.descrizione, s.categoria, s.metodo === 'FUEL_CARD' ? `Fuel card ${s.fuel_card ? `${s.fuel_card.circuito} ${s.fuel_card.numero_mascherato}` : ''}` : METODI[s.metodo], n2(s.importo)]),
        { totale: ['', '', '', 'TOTALE', n2(sc.riepilogo.tot_carta)] });
    }
    y += 10;

    // ---------------------------------------------------------------- MOD029: chilometri, pedaggi, parcheggi
    fascia(`RIMBORSO CHILOMETRICO · ${m29.codice}_${m29.revisione}`);
    if (sc.vettura_aziendale) {
      spazio(26);
      const v = sc.vettura_aziendale;
      doc.font('R').fontSize(8).fillColor(C.ink).text(`Vettura aziendale assegnata (${v.marca} ${v.modello} ${v.targa}): i chilometri non sono rimborsabili. I viaggi sotto sono il registro dei viaggi di servizio.`, M + 4, y + 4, { width: CW - 8 });
      y += 20;
    }
    const c29 = [{ t: 'N.', w: 24, a: 'center' }, { t: 'Data', w: 52, a: 'center' }, { t: 'Tratta (da - a)', w: 150 }, { t: 'Motivazione', w: 120 }, { t: 'Km', w: 45, a: 'right' }, { t: 'Tariffa EUR/km', w: 60, a: 'right' }, { t: 'Importo (EUR)', w: CW - 451, a: 'right' }];
    const grig29 = new Set();
    const righe29 = sc.viaggi.map((v, i) => {
      if (v.esclusa || !v.rimborsabile) grig29.add(i);
      const tratta = `${v.partenza} - ${v.arrivo}${v.andata_ritorno ? ' (andata e ritorno)' : ''}`;
      const mot = [v.motivazione, v.esclusa ? `ESCLUSO: ${v.esclusa_motivo || ''}` : null, !v.rimborsabile ? 'vettura aziendale, non rimborsabile' : null].filter(Boolean).join(' · ');
      return [i + 1, itData(v.data), tratta, mot, n1(v.km_totali), v.rimborsabile ? t4(v.tariffa) : '-', v.rimborsabile ? (v.esclusa ? `(${n2(v.importo)})` : n2(v.importo)) : '-'];
    });
    if (!righe29.length) righe29.push(['', '', 'Nessun viaggio nel mese', '', '', '', '']);
    tabella(c29, righe29, { totale: ['', '', '', 'TOTALE Km', n1(sc.riepilogo.tot_km), '', n2(sc.riepilogo.tot_km_importo)], grigie: grig29 });
    const pp = sc.spese.filter((s) => s.metodo === 'DIPENDENTE' && ['PEDAGGIO', 'PARCHEGGIO'].includes(catTipo(s)));
    if (pp.length) {
      y += 6; spazio(30);
      doc.font('B').fontSize(8).fillColor(C.ink).text('Pedaggi autostradali e parcheggi (con ricevute allegate)', M, y); y += 12;
      const grigPP = new Set();
      tabella([{ t: 'Data', w: 52, a: 'center' }, { t: 'Descrizione', w: 250 }, { t: 'Categoria', w: 90 }, { t: 'Ricevuta', w: CW - 462, a: 'center' }, { t: 'Importo (EUR)', w: 70, a: 'right' }],
        pp.map((s, i) => { if (s.esclusa) grigPP.add(i); return [itData(s.data), `${s.descrizione}${s.esclusa ? `\nESCLUSA: ${s.esclusa_motivo || ''}` : ''}`, s.categoria, giust(s), s.esclusa ? `(${n2(s.importo)})` : n2(s.importo)]; }), { grigie: grigPP });
    }
    y += 10;

    // ---------------------------------------------------------------- riepilogo
    const rp = sc.riepilogo;
    spazio(230);   // il riepilogo resta tutto sulla stessa pagina
    fascia('RIEPILOGO');
    coppie([
      ['Totale spese documentate (EUR)', n2(rp.tot_spese)],
      ['Totale chilometri del mese', `${n1(rp.tot_km)} km${rp.km_registro ? ` (più ${n1(rp.km_registro)} km con la vettura aziendale, non rimborsabili)` : ''}`],
      ['Totale rimborso chilometrico (EUR)', n2(rp.tot_km_importo)],
      ['Pedaggi autostradali (EUR, con ricevute allegate)', n2(rp.tot_pedaggi)],
      ['Parcheggi (EUR, con ricevute allegate)', n2(rp.tot_parcheggi)],
      ['Totale complessivo rimborsabile (EUR)', n2(rp.tot_rimborsabile), { bold: true }],
      ['Anticipi ricevuti (EUR)', n2(rp.anticipi)],
      ['Pagato con carta aziendale o fuel card (EUR, non rimborsabile)', n2(rp.tot_carta)],
      ...(rp.tot_escluso ? [['Righe escluse dal responsabile (EUR)', n2(rp.tot_escluso)]] : []),
      ['Saldo a favore del dipendente / dell\'azienda (EUR)', `${n2(Math.abs(rp.saldo))} ${rp.saldo > 0 ? 'a favore del dipendente' : rp.saldo < 0 ? 'a favore dell\'azienda' : '(nessun saldo)'}`, { bold: true, color: rp.saldo < 0 ? C.red : C.ink }],
      ...(n.liquidazione_data ? [['Liquidazione', `${n2(n.liquidazione_importo)} EUR il ${itData(n.liquidazione_data)}${n.liquidazione_rif ? ` · rif. ${n.liquidazione_rif}` : ''}`]] : []),
      ['Note', n.note || ''],
    ], 230);
    y += 12;

    // ---------------------------------------------------------------- firme come attestazioni elettroniche
    spazio(96);
    const fw = CW / 3;
    const ev = (tipo) => [...sc.eventi].reverse().find((e) => e.tipo === tipo);
    const inviata = ev('INVIATA'), approvata = ev('APPROVATA'), liquidata = ev('LIQUIDATA');
    const firme = [
      ['Dipendente · Firma e data', n.inviata_at ? `Inviata da ${inviata?.utente || n.inviata_da_nome || sc.persona.nome}\nil ${dataOra(n.inviata_at)}${n.in_ritardo ? '\n(inviata in ritardo)' : ''}` : 'non ancora inviata'],
      ['Responsabile · Approvazione', n.approvata_at && n.approvazione_automatica ? `Approvazione automatica (vertice dell'organigramma)\nil ${dataOra(n.approvata_at)}` : n.approvata_at ? `Approvata da ${approvata?.utente || n.approvata_da_nome || ''}${n.al_pc ? ' (P&C, secondo controllo)' : ''}\nil ${dataOra(n.approvata_at)}` : n.stato === 'INVIATA' ? `in attesa di ${n.al_pc ? 'P&C' : n.responsabile_nome || 'responsabile'}` : 'non ancora approvata'],
      ['P&C · Liquidazione', n.liquidata_at ? `Liquidata da ${liquidata?.utente || n.liquidata_da_nome || ''}\nil ${dataOra(n.liquidata_at)}\npagamento del ${itData(n.liquidazione_data)}${n.liquidazione_rif ? `, rif. ${n.liquidazione_rif}` : ''}` : 'non ancora liquidata'],
    ];
    doc.lineWidth(0.5).strokeColor(C.line);
    firme.forEach(([t, v], i) => {
      const x = M + i * fw;
      doc.rect(x, y, fw, 16).fill(C.light); doc.rect(x, y, fw, 16).stroke();
      doc.font('B').fontSize(8).fillColor(C.ink).text(t, x + 5, y + 4, { width: fw - 10 });
      doc.rect(x, y + 16, fw, 54).stroke();
      doc.font('R').fontSize(7.8).fillColor(C.ink).text(v, x + 5, y + 21, { width: fw - 10 });
    });
    y += 74;
    doc.font('R').fontSize(7).fillColor(C.grey).text('Attestazioni elettroniche registrate dalla Suite TD (accesso autenticato, data e ora; storico completo della nota nella Suite) al posto delle firme del modulo cartaceo.', M, y, { width: CW });
    y += 12;
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(`Allegare tutti i giustificativi originali (ricevute, fatture, scontrini). I rimborsi senza giustificativo non saranno liquidati${sc.eccezione ? ' (per questo dipendente il giustificativo è facoltativo per decisione della direzione)' : ''}.`, M, y, { width: CW });
    y += 18;

    // ---------------------------------------------------------------- giustificativi
    fascia(`GIUSTIFICATIVI (${allegati.length})`);
    if (!allegati.length) { spazio(16); doc.font('R').fontSize(8).fillColor(C.grey).text('Nessun giustificativo allegato.', M + 4, y + 4); y += 18; }
    const numSpesa = new Map(sc.spese.map((s, i) => [s.id, i + 1]));
    const numViaggio = new Map(sc.viaggi.map((v, i) => [v.id, i + 1]));
    const riga = (a) => (a.riga_tipo === 'SPESA' ? sc.spese.find((s) => s.id === a.riga_id) : sc.viaggi.find((v) => v.id === a.riga_id));
    // griglia a due colonne: miniatura (foto) o icona del tipo, nome del file, riga collegata, tipo, peso, data e impronta SHA-256
    const TW = 78, GAP = 8, CELL = (CW - GAP) / 2;
    const cella = (a) => {
      const rg = riga(a);
      const desc = a.riga_tipo === 'SPESA'
        ? `Spesa ${numSpesa.get(a.riga_id) || ''} del ${itData(rg?.data)}: ${rg?.descrizione || ''} (${n2(rg?.importo)} EUR)`
        : `Viaggio ${numViaggio.get(a.riga_id) || ''} del ${itData(rg?.data)}: ${rg ? `${rg.partenza} - ${rg.arrivo}` : ''}`;
      const meta = `${a.mime || 'file'} · ${(a.size / 1024).toFixed(0)} KB · ${dataOra(a.caricato_at)}`;
      const sha = `SHA-256 ${a.sha256}`;
      const larg = CELL - TW - 16;
      doc.font('B').fontSize(7.8); const h1 = doc.heightOfString(a.filename, { width: larg });
      doc.font('R').fontSize(7.3); const h2 = doc.heightOfString(desc, { width: larg });
      doc.fontSize(6.3); const h3 = doc.heightOfString(meta, { width: larg }) + doc.heightOfString(sha, { width: larg });
      return { a, desc, meta, sha, larg, h: Math.max(TW + 8, h1 + h2 + h3 + 14) };
    };
    const disegna = (c, x) => {
      const img = buffers.get(c.a.id);
      doc.lineWidth(0.5).strokeColor(C.line).rect(x, y, CELL, c.h).stroke();
      if (img) { try { doc.image(img, x + 4, y + 4, { fit: [TW, TW], align: 'center', valign: 'center' }); } catch { doc.font('R').fontSize(7).fillColor(C.grey).text('anteprima non disponibile', x + 4, y + 30, { width: TW, align: 'center' }); } }
      else { doc.rect(x + 4, y + 4, TW, TW).fill(C.light); doc.font('B').fontSize(11).fillColor(C.teal).text(String(c.a.filename.split('.').pop() || 'file').toUpperCase(), x + 4, y + TW / 2 - 2, { width: TW, align: 'center' }); }
      const tx = x + TW + 10;
      doc.font('B').fontSize(7.8).fillColor(C.ink).text(c.a.filename, tx, y + 5, { width: c.larg });
      doc.font('R').fontSize(7.3).fillColor(C.ink).text(c.desc, tx, doc.y + 1, { width: c.larg });
      doc.font('R').fontSize(6.3).fillColor(C.grey).text(c.meta, tx, doc.y + 2, { width: c.larg });
      doc.text(c.sha, tx, doc.y, { width: c.larg });
    };
    for (let i = 0; i < allegati.length; i += 2) {
      const celle = allegati.slice(i, i + 2).map(cella);
      const h = Math.max(...celle.map((c) => c.h));
      celle.forEach((c) => { c.h = h; });
      spazio(h + GAP);
      celle.forEach((c, k) => disegna(c, M + k * (CELL + GAP)));
      y += h + GAP;
    }

    // ---------------------------------------------------------------- piè di pagina con numeri
    const piede = String(company.footer_text || '').split('\n');
    const pagine = doc.bufferedPageRange();
    for (let i = 0; i < pagine.count; i++) {
      doc.switchToPage(pagine.start + i);
      doc.page.margins.bottom = 0;   // il piè sta sotto il margine: senza questo pdfkit aprirebbe una pagina nuova
      doc.font('B').fontSize(7.5).fillColor(C.teal).text(company.legal_name || 'Toscana Diagnostica S.r.l.', M, H - 58, { width: CW, align: 'center', lineBreak: false });
      piede.slice(0, 2).forEach((l, k) => doc.font('R').fontSize(6.8).fillColor(C.teal).text(l, M, H - 48 + k * 9, { width: CW, align: 'center', lineBreak: false }));
      doc.font('R').fontSize(6.5).fillColor(C.grey).text(`Nota spese ${nomeMese(n.anno, n.mese)} · ${sc.persona.nome} · generata dalla Suite TD il ${dataOra(generato)} · pagina ${i + 1} di ${pagine.count}`, M, H - 28, { width: CW, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
