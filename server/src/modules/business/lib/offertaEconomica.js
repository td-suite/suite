// Business Hub · "Offerta economica" in PDF da una versione del listino StudioLAB del cliente (richiesta del CEO del 06/11/2026: "l'offerta
// economica in PDF impaginata figa"). Stessa tecnica del Pacchetto di benvenuto: DOCX sulla carta intestata luglio 2026 (pacchettoDocx.js),
// un giro di LibreOffice, numerazione e segnalibri con pdf-lib (pacchettoPdf.js). Copertina con il cliente; riepilogo (numero di esami,
// validità, condizioni di pagamento); tabelle per settore con codice, esame, listino, offerta e, solo se almeno un esame è scontato,
// sconto; note; firma del CEO dalle Impostazioni (lr_name, lr_role). Solo dati presenti nella Suite: il listino caricato, l'account, le
// Impostazioni.
// Richiesta del CEO del 07/11/2026: niente sconto medio, niente colonna "Sconto" se non c'è sconto, niente "preparata per", niente riga
// della versione, niente fascia "Ci prendiamo cura ...", niente "Listino di riferimento". La versione resta nel nome del file, nei
// metadati del PDF e nel registro (listini, diario), non nel documento.
import { one } from '../db.js';
import { getCompany } from '../../../lib/company.js';
import { getSettings } from './rules.js';
import { docxToPdfBatch } from './docgen.js';
import { perSettore } from './listino.js';
import { dataLunga, dataBreve } from './pacchetto.js';
import * as D from './pacchettoDocx.js';
import { assembla } from './pacchettoPdf.js';

const { p, r, C, LARGHEZZA } = D;
const eur = (x) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(Number(x || 0));
const pct = (x) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Number(x || 0))}%`;
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'cliente';
export const nomeFileOfferta = (cliente, versione, data) => `${String(data || '').slice(0, 10)}_Offerta_economica_${slug(cliente)}_v${versione}.pdf`;

const meta = (etichetta, valore) => [
  { c: p(r(etichetta.toUpperCase(), { b: true, sz: 14, color: C.accento, spacing: 20 }), { line: 240 }), w: 2000, mar: [70, 0, 70, 120] },
  { c: p(r(valore, { sz: 20, color: C.testo }), { line: 252 }), w: 4400, mar: [70, 0, 70, 0] },
];

/** Copertina: titolo, cliente, data, validità, a cura di, destinatario (la versione del listino non compare nel documento). */
export function copertinaOfferta(d) {
  const righe = [['Data', dataLunga(d.data)], ['Valida fino al', d.validita ? dataBreve(d.validita) : ''], ['A cura di', d.owner || ''], ['Alla cortese attenzione', d.destinatario || '']]
    .filter(([, v]) => v).map(([k, v]) => meta(k, v));
  return [
    D.vuoto(900),
    p(r('OFFERTA ECONOMICA', { b: true, sz: 17, color: C.accento, spacing: 60 }), { after: 260 }),
    p(r('Service di Laboratorio', { sz: 44, color: C.medio }), { line: 240, after: 40 }),
    p(r('Toscana Diagnostica', { b: true, sz: 64, color: C.scuro }), { line: 240, after: 320 }),
    p('', { border: D.bordo('bottom', C.accento, 24, 1), after: 360, ind: `w:right="${LARGHEZZA - 1800}"` }),
    p(r(d.cliente, { b: true, sz: 36, color: C.testo }), { line: 260, after: 120 }),
    d.indirizzo ? p(r(d.indirizzo, { sz: 19, color: C.grigio }), { after: 0 }) : '',
    D.vuoto(d.indirizzo ? 3700 : 3980),
    D.tabella([2000, 4400], righe),
  ].join('');
}

/** Vero se almeno un esame ha un prezzo offerto sotto il listino (altrimenti la colonna "Sconto" non compare). */
export const haSconto = (righe = []) => righe.some((x) => x.listino != null && x.offerto != null && Number(x.listino) - Number(x.offerto) > 0.005);

const W = { codice: 1300, prezzo: 1250, sconto: 1000 };
const bordoRiga = [D.nil('top'), D.nil('left'), D.bordo('bottom', C.bordo, 4), D.nil('right')].join('');
const cellaTesto = (t, w, o = {}) => ({ c: p(r(t, { sz: 17, color: o.color || C.testo, b: o.b }), { line: 252, jc: o.jc || 'left' }), w, mar: [70, 100, 70, 100], fill: o.fill || null, borders: bordoRiga });
/**
 * Tabella di un settore: intestazione ripetuta sulle pagine, numeri allineati a destra. conSconto=false: senza la colonna "Sconto"
 * (nessun esame scontato in tutta l'offerta), la colonna dell'esame si allarga.
 */
export function tabellaEsami(righe, { conSconto = true } = {}) {
  const wEsame = LARGHEZZA - W.codice - 2 * W.prezzo - (conSconto ? W.sconto : 0);
  const colonne = [['Codice', W.codice, 'left'], ['Esame', wEsame, 'left'], ['Listino €', W.prezzo, 'right'], ['Offerta €', W.prezzo, 'right'], ...(conSconto ? [['Sconto', W.sconto, 'right']] : [])];
  const head = colonne.map(([t, w, jc]) => ({ c: p(r(t, { b: true, sz: 16, color: C.bianco }), { line: 240, jc }), w, fill: C.medio, mar: [80, 100, 80, 100] }));
  const body = righe.map((x, i) => {
    const fill = i % 2 ? 'F6FAFB' : null;
    return [cellaTesto(x.codice || '–', W.codice, { fill }), cellaTesto(x.descrizione, wEsame, { fill }), cellaTesto(eur(x.listino), W.prezzo, { jc: 'right', fill, color: C.grigio }),
      cellaTesto(eur(x.offerto), W.prezzo, { jc: 'right', fill, b: true }),
      ...(conSconto ? [cellaTesto(Number(x.sconto) > 0 ? `−${pct(x.sconto)}` : '–', W.sconto, { jc: 'right', fill, color: Number(x.sconto) > 0 ? C.medio : C.grigio })] : [])];
  });
  return D.tabella(colonne.map(([, w]) => w), [head, ...body], { header: true });
}

/** Corpo: riepilogo, tabelle per settore, note, firma. */
export function corpoOfferta(d) {
  const rp = d.riepilogo;
  const kpi = (lbl, val, foot) => ({ c: [p(r(lbl.toUpperCase(), { b: true, sz: 14, color: C.accento, spacing: 20 }), { after: 40 }), p(r(val, { b: true, sz: 30, color: C.scuro }), { after: 20, line: 240 }), foot ? p(r(foot, { sz: 15, color: C.grigio }), { line: 240 }) : ''].join(''),
    w: Math.floor((LARGHEZZA - 2 * 200) / 3), fill: C.chiaro, borders: D.BORDO_SCHEDA, mar: [160, 180, 160, 140] });
  const gap = { c: p(''), w: 200 };
  const w2 = Math.floor((LARGHEZZA - 200) / 2);
  // due riquadri: esami e validità (lo sconto medio non compare nel documento, richiesta del CEO del 07/11/2026)
  const kpis = D.tabella([w2, 200, w2], [[{ ...kpi('Esami in offerta', String(rp.esami), rp.settori > 1 ? `in ${rp.settori} settori` : null), w: w2 }, gap,
    { ...kpi('Valida fino al', d.validita ? dataBreve(d.validita) : '–', null), w: w2 }]]);
  const condizioni = [
    d.condizioni ? ['Condizioni di pagamento', d.condizioni] : null,
    ['Prezzi', 'In euro, per singolo esame.'],
  ].filter(Boolean);
  const conSconto = haSconto(d.righe);
  const gruppi = perSettore(d.righe);
  const tabelle = gruppi.map((g, i) => [
    gruppi.length > 1 || g.settore !== 'Esami' ? D.titoletto(`${g.settore} (${g.righe.length})`, { before: i ? 300 : 200 }) : '',
    tabellaEsami(g.righe, { conSconto }),
  ].join('')).join('');
  return [
    D.testata('La proposta', 'Offerta economica', `Le condizioni economiche riservate a ${d.cliente} per gli esami del Service di Laboratorio di Toscana Diagnostica.`),
    kpis,
    D.vuoto(240),
    D.tabella([3000, LARGHEZZA - 3000], condizioni.map(([k, v]) => [
      { c: p(r(k, { b: true, sz: 17, color: C.scuro }), { line: 252 }), w: 3000, mar: [80, 0, 80, 120], borders: bordoRiga },
      { c: p(r(v, { sz: 18 }), { line: 264 }), w: LARGHEZZA - 3000, mar: [80, 0, 80, 0], borders: bordoRiga },
    ])),
    D.titoletto('Gli esami', { before: 360 }),
    tabelle,
    // note, chiusura e firma restano insieme: mai la sola firma su una pagina nuova
    d.note ? [D.titoletto('Note', { before: 300 }), ...String(d.note).split(/\n+/).filter(Boolean).map((x) => p(r(x, { sz: 18 }), { after: 120, line: 300, jc: 'both', keepNext: true }))].join('') : '',
    p(r('Le condizioni contrattuali sono quelle della lettera di offerta e delle Condizioni Generali di Contratto che vi trasmettiamo per la firma.', { sz: 17, color: C.grigio }), { before: 240, after: 120, line: 300, jc: 'both', keepNext: true }),
    p(r(`${d.luogo}, ${dataLunga(d.data)}`, { sz: 19, color: C.grigio }), { before: 360, after: 200, keepNext: true }),
    p(r(`Per ${d.societa}`, { sz: 18, color: C.grigio }), { after: 40, keepNext: true }),
    p(r(d.firma.nome, { b: true, sz: 22, color: C.scuro }), { after: 20, keepNext: true, keepLines: true }),
    p(r(d.firma.ruolo, { sz: 19, color: C.grigio }), { after: 0 }),
  ].join('');
}

/**
 * Genera il PDF. a = account (ACCOUNT_SELECT), listino = riga della tabella listini, opz = { data, validita, condizioni, note, destinatario }.
 * Ritorna { pdf, pagine, dati }.
 */
export async function generaOffertaEconomica(a, listino, opz = {}) {
  const [s, company] = await Promise.all([getSettings(), getCompany()]);
  const own = a.owner_user_id ? await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS nome FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id WHERE u.id=$1`, [a.owner_user_id]) : null;
  const d = {
    cliente: a.org_name, indirizzo: [a.org_address, [a.org_zip, a.citta].filter(Boolean).join(' ') + (a.prov ? ` (${a.prov})` : '')].filter((x) => x && String(x).trim()).join(', '),
    data: opz.data, validita: opz.validita || null, condizioni: opz.condizioni || null, note: opz.note || null, destinatario: opz.destinatario || null, owner: own?.nome || null,
    versione: listino.versione, caricato_at: listino.caricato_at ? new Date(listino.caricato_at).toISOString().slice(0, 10) : null, righe: listino.righe || [], riepilogo: listino.riepilogo,
    luogo: company.city || 'Sesto Fiorentino', societa: company.legal_name || s.company_name, firma: { nome: s.lr_name || '', ruolo: s.lr_role || '' },
  };
  const [cop, corpo] = await docxToPdfBatch([D.costruisci(copertinaOfferta(d)), D.costruisci(corpoOfferta(d))]);
  const out = await assembla([
    { key: 'copertina', titolo: 'Copertina', pdf: cop, numero: 'piede' },
    { key: 'offerta', titolo: 'Offerta economica', pdf: corpo, numero: 'piede' },
  ], { titolo: `Offerta economica · ${a.org_name} · v${listino.versione}`, etichettaEsterne: 'Offerta economica' });
  return { pdf: out.pdf, pagine: out.pagine, dati: { data: d.data, validita: d.validita, condizioni: d.condizioni, note: d.note, destinatario: d.destinatario } };
}
