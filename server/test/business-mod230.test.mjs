// Contratto Service MOD230 (richiesta del CEO del 07/11/2026): tendina dei termini di pagamento con il valore attuale, note svuotate
// davvero, allegati 1 e 2 accorpati e rinumerati (funzione pura e template), Allegato 2 "Ritiro campioni" precompilato, Nominativo del
// Committente predefinito, Politica della Qualità dallo specchio SGI, spazio della firma di TD nel PDF. Dati fittizi; la firma di prova
// è un PNG generato al volo, mai una firma vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import {
  ALLEGATI_MOD230, MAPPA_ALLEGATI_MOD230, rinumeraRichiami, dividiIndirizzo, ritiroPredefinito, ritiroPerDocumento, committente,
  cercaPoliticaQualita, riferimentoPolitica, spaziFirma, misuraFirma, testoAllegato1, posizioneOffertaAllegato1,
} from '../src/modules/business/lib/mod230.js';
import { contractData, renderDocx, CONTRACT_TEMPLATE } from '../src/modules/business/lib/docgen.js';
import { DEFAULT_SETTINGS } from '../src/modules/business/lib/rules.js';
import { apponiFirma, accodaPdf, inserisciPdf, inserisciOffertaAllegato1, testoPagine } from '../src/modules/business/lib/contrattoPdf.js';
import { aggiungiSegnalibri, leggiSegnalibri } from '../src/modules/business/lib/pacchettoPdf.js';
import { tipoImmagine, firmatario } from '../src/modules/business/lib/firmaTd.js';
import * as F from '../../web/src/modules/business/format.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(HERE, '..', 'src', 'modules', 'business', 'templates');
const testoDocx = (buf) => {
  const xml = new PizZip(buf).file('word/document.xml').asText();
  const ent = (t) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return xml.split(/<\/w:p>/).map((p) => ent((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))).filter(Boolean);
};

test('tendina dei termini di pagamento: voci standard, Altro, valore attuale fuori elenco', () => {
  assert.deepEqual(F.TERMINI_PAGAMENTO, ['Bonifico bancario 30 gg f.m. data fattura', 'Bonifico bancario 60 gg f.m. data fattura', 'Bonifico bancario a vista fattura', 'RID/SDD 30 gg f.m.']);
  const vuoto = F.opzioniPagamento('', { predefinito: 'Bonifico bancario 30 gg fm da emissione fattura' });
  assert.equal(vuoto.scelta, '');
  assert.equal(vuoto.opzioni[0].label, 'Predefinito: Bonifico bancario 30 gg fm da emissione fattura');
  assert.equal(vuoto.opzioni.at(-1).value, F.PAGAMENTO_ALTRO);
  assert.ok(!vuoto.opzioni.some((o) => /valore attuale/.test(o.label)));
  const std = F.opzioniPagamento('Bonifico bancario 60 gg f.m. data fattura');
  assert.equal(std.scelta, 'Bonifico bancario 60 gg f.m. data fattura');
  assert.ok(!std.opzioni.some((o) => /valore attuale/.test(o.label)), 'una voce dell\'elenco non si ripete');
  const vecchio = F.opzioniPagamento('Rimessa diretta a 90 giorni');
  assert.equal(vecchio.scelta, 'Rimessa diretta a 90 giorni');
  const att = vecchio.opzioni.filter((o) => o.value === 'Rimessa diretta a 90 giorni');
  assert.equal(att.length, 1); assert.equal(att[0].label, 'Rimessa diretta a 90 giorni (valore attuale)');
  assert.ok(vecchio.opzioni.findIndex((o) => o.value === F.PAGAMENTO_ALTRO) > vecchio.opzioni.findIndex((o) => o.value === 'Rimessa diretta a 90 giorni'));
  const altro = F.opzioniPagamento('Rimessa diretta a 90 giorni', { altro: true });
  assert.equal(altro.scelta, F.PAGAMENTO_ALTRO); assert.equal(altro.altro, true);
  assert.ok(!altro.opzioni.some((o) => /valore attuale/.test(o.label)), 'scrivendo il testo libero il valore attuale non si duplica');
});

test('rinumerazione degli allegati: richiami, titoli, conteggio, numeri fuori mappa', () => {
  assert.equal(ALLEGATI_MOD230.length, 8);
  assert.deepEqual(ALLEGATI_MOD230.map((a) => a.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(ALLEGATI_MOD230[0].titolo, 'Elenco delle analisi, prezzi e condizioni economiche');
  assert.equal(ALLEGATI_MOD230.at(-1).titolo, 'Politica della Qualità di Toscana Diagnostica');
  assert.deepEqual(Object.values(MAPPA_ALLEGATI_MOD230), [1, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(rinumeraRichiami("sconto sul nostro Listino come indicato nell'Allegato n. 2 delle Condizioni"), "sconto sul nostro Listino come indicato nell'Allegato n. 1 delle Condizioni");
  assert.equal(rinumeraRichiami("in giorni e orari di cui all'Allegato n. 3"), "in giorni e orari di cui all'Allegato n. 2");
  assert.equal(rinumeraRichiami('(Soluzione n. 1, Allegato n. 6);'), '(Soluzione n. 1, Allegato n. 5);', 'la Soluzione n. 1 non è un allegato');
  assert.equal(rinumeraRichiami('I Terzi Incaricati indicati nell\'Allegato 7 si intendono'), 'I Terzi Incaricati indicati nell\'Allegato 6 si intendono');
  assert.equal(rinumeraRichiami('ALLEGATO 9 — Politica della Qualità'), 'ALLEGATO 8 — Politica della Qualità');
  assert.equal(rinumeraRichiami('Condizioni Generali di Contratto (con relativi 9 Allegati).'), 'Condizioni Generali di Contratto (con relativi 8 Allegati).');
  assert.equal(rinumeraRichiami('vedi Allegati n. 3 e 4, All. 8'), 'vedi Allegati n. 2 e 3, All. 7');
  assert.equal(rinumeraRichiami('Allegato 12 e art. 4.3'), 'Allegato 12 e art. 4.3', 'fuori mappa resta com\'è');
  assert.equal(rinumeraRichiami('Mensile, con dettaglio riepilogativo in allegato'), 'Mensile, con dettaglio riepilogativo in allegato');
});

test('template MOD230: allegati accorpati e rinumerati ovunque, righe vuote prima degli artt. 5 e 15, blocchi firme', () => {
  const righe = testoDocx(fs.readFileSync(path.join(TPL, CONTRACT_TEMPLATE.SRV)));
  const titoli = righe.filter((t) => /^ALLEGATO \d+ — /.test(t));
  assert.deepEqual(titoli.map((t) => Number(t.match(/^ALLEGATO (\d+)/)[1])), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(titoli[0], 'ALLEGATO 1 — Elenco delle analisi, prezzi e condizioni economiche');
  assert.ok(titoli[1].startsWith('ALLEGATO 2 — Ritiro campioni')); assert.ok(titoli[4].startsWith('ALLEGATO 5 — Interfacciamento informatico'));
  assert.ok(titoli[7].startsWith('ALLEGATO 8 — Politica della Qualità'));
  assert.ok(!righe.some((t) => /Prezzi e Condizioni Economiche/.test(t)), 'il vecchio Allegato 2 non c\'è più');
  const tutto = righe.join('\n');
  assert.match(tutto, /con relativi 8 Allegati/);
  assert.match(tutto, /orari di cui all'Allegato n\. 2\b/); assert.match(tutto, /Guida agli Esami \(Allegato n\. 4\)/);
  assert.match(tutto, /Soluzione n\. 1, Allegato n\. 5/); assert.match(tutto, /elencati nell'Allegato n\. 6/); assert.match(tutto, /nell'Allegato n\. 7 delle Condizioni Generali/);
  const numeri = [...tutto.matchAll(/\b(?:Allegat[oi]|ALLEGATO|All\.)(?:\s+n\.)?\s+(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(numeri.length > 20 && numeri.every((n) => n >= 1 && n <= 8), `richiami fuori dagli 8 allegati: ${numeri}`);
  // Lista degli allegati: 8 righe con i titoli della nuova numerazione
  const i = righe.indexOf('LISTA DEGLI ALLEGATI');
  const lista = righe.slice(i + 3, i + 3 + 16);
  assert.deepEqual(lista.filter((_, k) => k % 2 === 0).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(lista.filter((_, k) => k % 2 === 1), ALLEGATI_MOD230.map((a) => a.titolo));
  // spaziatura uniforme: esattamente un paragrafo vuoto prima di ogni titolo di articolo (CEO, 07/11/2026: prima art. 5 ne aveva 3 e art. 15 cinque, buco evidente)
  const xml = new PizZip(fs.readFileSync(path.join(TPL, CONTRACT_TEMPLATE.SRV))).file('word/document.xml').asText();
  const ps = [...xml.matchAll(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g)].map((m) => m[0]);
  const vuotiPrima = (titolo) => { const k = ps.findIndex((p) => p.includes(`<w:t>${titolo}</w:t>`)); let n = 0; while (k - 1 - n >= 0 && !/<w:t[ >]/.test(ps[k - 1 - n])) n++; return n; };
  assert.equal(vuotiPrima('Durata del Contratto'), 1, 'tra gli altri articoli una riga vuota');
  assert.equal(vuotiPrima('Prezzi, modalità di pagamento e morosità del Cliente'), 1);
  assert.equal(vuotiPrima('Foro'), 1);
  assert.equal((xml.match(/\{firma_nome\}/g) || []).length, 3); assert.equal((xml.match(/\{firma_ruolo\}/g) || []).length, 3);
  assert.ok(!/\{lr_name\}|\{lr_role\}/.test(xml));
  // Allegato 1 (seconda richiesta del CEO del 07/11/2026): niente tabelle dei prezzi, un paragrafo che rimanda all'Offerta economica;
  // il testo del catalogo resta
  const a1 = righe.indexOf('ALLEGATO 1 — Elenco delle analisi, prezzi e condizioni economiche');
  const a2 = righe.findIndex((t) => t.startsWith('ALLEGATO 2 — '));
  const corpo1 = righe.slice(a1 + 1, a2);
  assert.ok(corpo1[0].startsWith("L'elenco completo degli esami eseguiti da Toscana Diagnostica è disponibile nel catalogo aggiornato, articolato per settori clinici: Ematologia"));
  assert.ok(corpo1.some((t) => t.startsWith('Il catalogo è fornito al Cliente in formato Excel e PDF')));
  assert.equal(corpo1.at(-1), '{allegato1_offerta}', 'il rimando all\'offerta chiude l\'allegato, prima del salto pagina');
  assert.equal(corpo1.filter((t) => t === '{allegato1_offerta}').length, 1);
  for (const x of ['listino_righe', 'listino_intro', 'con_listino', 'solo_offerta', 'ha_listino', 'Listino €', 'Offerta €']) assert.ok(!xml.includes(x), `nel template resta ${x}`);
  const mdl = new PizZip(fs.readFileSync(path.join(TPL, CONTRACT_TEMPLATE.MDL))).file('word/document.xml').asText();
  assert.equal((mdl.match(/\{firma_nome\}/g) || []).length, 3, 'MOD231: stesso blocco firme');
});

test('Allegato 2 ritiro campioni: sede operativa se indicata, altrimenti sede legale; referente principale; i campi compilati prevalgono', () => {
  const p = { name: 'Laboratorio Prova S.r.l.', street: 'Via Roma 1', zip: '59100', city: 'Prato', prov: 'PO' };
  const r = { nome: 'Maria Verdi', telefono: '0574 111222', email: 'maria.verdi@prova.test' };
  assert.deepEqual(dividiIndirizzo('Via dei Mille 4, 50100 Firenze (FI)'), { via: 'Via dei Mille 4', citta: '50100 Firenze (FI)' });
  assert.deepEqual(dividiIndirizzo('Via dei Mille 4'), { via: 'Via dei Mille 4', citta: '' });
  assert.deepEqual(dividiIndirizzo('Via dei Mille, 4'), { via: 'Via dei Mille, 4', citta: '' }, 'un civico dopo la virgola non è una città');
  const legale = ritiroPredefinito({}, p, r);
  assert.deepEqual(legale, { site: 'Laboratorio Prova S.r.l.', street: 'Via Roma 1', city: '59100 Prato (PO)', contact: 'Maria Verdi', phone: '0574 111222', email: 'maria.verdi@prova.test', fonte: 'SEDE_LEGALE' });
  const op = ritiroPredefinito({ site_name: 'Poliambulatorio Prova', site_address: 'Via dei Mille 4, 50100 Firenze (FI)' }, p, null);
  assert.deepEqual(op, { site: 'Poliambulatorio Prova', street: 'Via dei Mille 4', city: '50100 Firenze (FI)', contact: '', phone: '', email: '', fonte: 'SEDE_OPERATIVA' });
  assert.equal(ritiroPredefinito({ site_name: 'Sede Due' }, p).street, 'Via Roma 1', 'solo la denominazione: indirizzo della sede legale');
  const doc = ritiroPerDocumento({ site: '', street: 'Via Altra 9', city: ' ', contact: '', phone: '', email: '' }, {}, p, r);
  assert.deepEqual(doc, { site: 'Laboratorio Prova S.r.l.', street: 'Via Altra 9', city: '59100 Prato (PO)', contact: 'Maria Verdi', phone: '0574 111222', email: 'maria.verdi@prova.test' });
  // stessa regola nel form (format.js) e nel documento (mod230.js)
  for (const d of [{}, { site_name: 'X', site_address: 'Via Y 1, Lucca' }, { site_address: 'Via Z' }]) assert.deepEqual(F.ritiroPredefinito(d, p, r), ritiroPredefinito(d, p, r));
});

test('Nominativo del Committente: vuoto = ragione sociale della Legal entity; con Titolare un trattino', () => {
  const p = { name: 'Laboratorio Prova S.r.l.' };
  assert.equal(committente({ role: 'RESPONSABILE', principal: '' }, p), 'Laboratorio Prova S.r.l.');
  assert.equal(committente({ role: 'RESPONSABILE', principal: 'ASL Toscana Centro' }, p), 'ASL Toscana Centro');
  assert.equal(committente({ role: 'TITOLARE', principal: 'x' }, p), '-');
});

test('Politica della Qualità: titolo esplicito, poi Politica Integrata, revisione più alta; riferimento nel DOCX', () => {
  const docs = [
    { code: 'TD-SGI-POL001_01', rev: '01', data: '30/04/2026', title: 'Politica Integrata', famiglia: 'POL', pdf: 'a/POL001_01.pdf' },
    { code: 'TD-SGI-POL001_02', rev: '02', data: '29/10/2026', title: 'Politica Integrata', famiglia: 'POL', pdf: 'a/POL001_02.pdf' },
    { code: 'TD-SGI-PRO045_01', rev: '01', data: '28/04/2026', title: 'Gestione Della Valutazione Esterna Di Qualità (Veq)', famiglia: 'PRO', pdf: 'b.pdf' },
  ];
  assert.equal(cercaPoliticaQualita(docs).code, 'TD-SGI-POL001_02');
  assert.equal(cercaPoliticaQualita([...docs, { code: 'TD-SGI-POL009_00', rev: '00', data: '01/11/2026', title: 'Politica per la Qualità', famiglia: 'POL', pdf: 'c.pdf' }]).code, 'TD-SGI-POL009_00');
  assert.equal(cercaPoliticaQualita([docs[2]]), null);
  assert.equal(cercaPoliticaQualita([{ ...docs[1], pdf: '' }]), null, 'senza PDF non si allega');
  assert.match(riferimentoPolitica(docs[1], { inCoda: true }), /^Documento di riferimento: TD-SGI-POL001 "Politica Integrata", revisione 02 del 29\/10\/2026 .*in coda alla versione PDF/);
  assert.match(riferimentoPolitica(docs[1]), /non disponibile dallo specchio SGI/);
  assert.match(riferimentoPolitica(null), /^Documento non disponibile dallo specchio SGI/);
  const reale = '/home/claude/legacy-sgi/portale-main/data/docs.json';
  if (fs.existsSync(reale)) assert.equal(cercaPoliticaQualita(JSON.parse(fs.readFileSync(reale, 'utf8'))).code, 'TD-SGI-POL001_02');
});

test('Allegato 1: testo con la versione del listino o "verrà allegata"', () => {
  assert.equal(testoAllegato1({ versione: 3, data: '2026-11-05T09:12:00.000Z', esami: 2793 }),
    "I prezzi riservati al Cliente sono riportati nell'Offerta economica che segue, parte integrante del presente Allegato (listino StudioLAB versione 3 del 05/11/2026, 2793 esami).");
  assert.equal(testoAllegato1({ versione: 1, data: new Date('2026-11-07T10:00:00Z'), esami: 1 }),
    "I prezzi riservati al Cliente sono riportati nell'Offerta economica che segue, parte integrante del presente Allegato (listino StudioLAB versione 1 del 07/11/2026, 1 esame).");
  assert.equal(testoAllegato1({ versione: 2, data: null, esami: 4 }),
    "I prezzi riservati al Cliente sono riportati nell'Offerta economica che segue, parte integrante del presente Allegato (listino StudioLAB versione 2, 4 esami).", 'senza data nessuna data inventata');
  assert.equal(testoAllegato1(null), "L'Offerta economica con i prezzi riservati al Cliente verrà allegata alla sottoscrizione.");
});

test('Allegato 1: posizione dell\'offerta dal testo delle pagine (dopo l\'Allegato 1, prima dell\'Allegato 2)', () => {
  const pagine = ['Spett.le Laboratorio ... Allegato n. 1 e Allegato n. 2', 'LISTA DEGLI ALLEGATI 1 Elenco delle analisi, prezzi e condizioni economiche 2 Ritiro campioni',
    'ALLEGATO 1 — Elenco delle analisi, prezzi e condizioni economiche L\'elenco completo ...', 'ALLEGATO 2 — Ritiro campioni Sede ...', 'ALLEGATO 3 — Trasporto ...'];
  assert.deepEqual(posizioneOffertaAllegato1(pagine), { allegato1: 2, indice: 3 });
  // titoli spezzati in più pezzi di testo e con spazi diversi; Allegato 1 su due pagine
  assert.deepEqual(posizioneOffertaAllegato1(['x', 'ALLEGATO  1 —\nElenco delle analisi', 'seguito dell\'allegato 1', 'ALLEGATO 2 — Ritiro campioni']), { allegato1: 1, indice: 3 });
  assert.equal(posizioneOffertaAllegato1(['ALLEGATO 1 — Elenco ... ALLEGATO 2 — Ritiro campioni']), null, 'stessa pagina: nessun punto pulito');
  assert.equal(posizioneOffertaAllegato1(['Allegato n. 1', 'Allegato n. 2']), null, 'i richiami del corpo non sono titoli');
  assert.equal(posizioneOffertaAllegato1([]), null);
});

test('Allegato 1: pagine dell\'offerta inserite nel PDF prima dell\'Allegato 2, segnalibro solo se il PDF ne ha già', async () => {
  const pdfDi = async (testi, { segnalibri = false } = {}) => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const t of testi) doc.addPage([595, 842]).drawText(t, { x: 60, y: 760, size: 12, font });
    if (segnalibri) aggiungiSegnalibri(doc, [{ titolo: 'Lettera', pagina: 1 }, { titolo: 'Allegati', pagina: 3 }]);
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  };
  // i titoli con il trattino lungo: Helvetica standard non lo codifica, nel PDF di prova si usa il trattino semplice (la regola li accetta entrambi)
  const contratto = await pdfDi(['Lettera di offerta', 'Condizioni generali', 'ALLEGATO 1 - Elenco delle analisi, prezzi e condizioni economiche', 'ALLEGATO 2 - Ritiro campioni', 'ALLEGATO 3 - Trasporto']);
  const offerta = await pdfDi(['OFFERTA ECONOMICA copertina', 'Offerta economica pagina 1', 'Offerta economica pagina 2']);
  const r = await inserisciOffertaAllegato1(contratto, offerta);
  assert.deepEqual(r.posizione, { allegato1: 2, indice: 3 }); assert.equal(r.pagine, 3); assert.equal(r.segnalibro, false);
  const testi = await testoPagine(r.pdf);
  assert.equal(testi.length, 8);
  assert.deepEqual(testi.map((t) => t.split(' ')[0]), ['Lettera', 'Condizioni', 'ALLEGATO', 'OFFERTA', 'Offerta', 'Offerta', 'ALLEGATO', 'ALLEGATO']);
  assert.match(testi[2], /ALLEGATO 1/); assert.match(testi[6], /ALLEGATO 2/);
  assert.equal((await PDFDocument.load(r.pdf)).catalog.get(PDFName.of('Outlines')), undefined, 'nessun segnalibro creato se il contratto non ne ha');
  // con segnalibri: "Allegati" porta a pagina 3 (Allegato 1), prima dell'offerta: la voce nuova va in fondo
  const conSegn = await inserisciOffertaAllegato1(await pdfDi(['Lettera', 'Condizioni', 'ALLEGATO 1 - Elenco', 'ALLEGATO 2 - Ritiro', 'Fine'], { segnalibri: true }), offerta, { titolo: 'Allegato 1 · Offerta economica v3' });
  assert.equal(conSegn.segnalibro, true);
  assert.deepEqual(await leggiSegnalibri(conSegn.pdf), [{ titolo: 'Lettera', pagina: 1 }, { titolo: 'Allegati', pagina: 3 }, { titolo: 'Allegato 1 · Offerta economica v3', pagina: 4 }]);
  // segnalibro dopo la posizione: la voce nuova lo precede
  const doc = await PDFDocument.create(); for (let i = 0; i < 4; i++) doc.addPage([595, 842]);
  aggiungiSegnalibri(doc, [{ titolo: 'Inizio', pagina: 1 }, { titolo: 'Allegato 2', pagina: 3 }]);
  const ins = await inserisciPdf(Buffer.from(await doc.save()), offerta, 2, { segnalibro: 'Offerta' });
  assert.deepEqual(await leggiSegnalibri(ins.pdf), [{ titolo: 'Inizio', pagina: 1 }, { titolo: 'Offerta', pagina: 3 }, { titolo: 'Allegato 2', pagina: 6 }]);
  await assert.rejects(() => inserisciPdf(contratto, offerta, 99), /fuori dal documento/);
  await assert.rejects(() => inserisciOffertaAllegato1(offerta, offerta), /non trovati/);
});

test('documento: committente, ritiro precompilato, rimando all\'offerta economica, firmatario e riferimento della Politica', () => {
  const s = { ...DEFAULT_SETTINGS, firma_nome: '', firma_qualifica: '' };
  const p = { name: 'Laboratorio Prova S.r.l.', street: 'Via Roma 1', zip: '59100', city: 'Prato', prov: 'PO', vat: '01234567890', pec: 'prova@pec.test', legal_rep: 'Carla Prova', pay_method: 'RID/SDD', pay_terms: '30 gg f.m. data fattura' };
  const c = { id: 9, kind: 'SRV', protocol: 'SRV-2026-0009', version: 1, proposal_date: '2026-11-07', data: { privacy: { role: 'RESPONSABILE' } } };
  const d = contractData(c, p, s, { referente: { nome: 'Maria Verdi', telefono: '0574 1', email: 'm@p.test' }, allegato1: { versione: 2, data: '2026-11-06T08:00:00Z', esami: 2 }, politica: { doc: { code: 'TD-SGI-POL001_02', rev: '02', data: '29/10/2026', title: 'Politica Integrata' }, inCoda: true } });
  assert.equal(d.priv_principal, 'Laboratorio Prova S.r.l.');
  assert.equal(d.pickup_site, 'Laboratorio Prova S.r.l.'); assert.equal(d.pickup_city, '59100 Prato (PO)'); assert.equal(d.pickup_contact, 'Maria Verdi'); assert.equal(d.pickup_contact_ref, '0574 1 / m@p.test');
  // (07/11/2026) termini di pagamento: unica fonte = Impostazioni Business della Legal entity (metodo + termine)
  assert.equal(d.payment_terms, 'RID/SDD 30 gg f.m. data fattura');
  assert.equal(d.firma_nome, DEFAULT_SETTINGS.lr_name); assert.equal(d.firma_ruolo, DEFAULT_SETTINGS.lr_role);
  assert.equal(contractData(c, p, { ...s, firma_nome: 'Nome Firmatario', firma_qualifica: 'Procuratore' }).firma_nome, 'Nome Firmatario');
  const testo = testoDocx(renderDocx(CONTRACT_TEMPLATE.SRV, d)).join('\n');
  assert.match(testo, /\nI prezzi riservati al Cliente sono riportati nell'Offerta economica che segue, parte integrante del presente Allegato \(listino StudioLAB versione 2 del 06\/11\/2026, 2 esami\)\.\nALLEGATO 2 — Ritiro campioni/);
  assert.doesNotMatch(testo, /Prezzi dell'offerta|Listino €|Offerta €/, 'nessuna tabella dei prezzi nel DOCX');
  assert.match(testo, /Documento di riferimento: TD-SGI-POL001 "Politica Integrata", revisione 02/);
  assert.equal((testo.match(new RegExp(DEFAULT_SETTINGS.lr_name, 'g')) || []).length, 3);
  // senza listino (o senza offerta disponibile): "verrà allegata"
  const senza = testoDocx(renderDocx(CONTRACT_TEMPLATE.SRV, contractData(c, p, s, {}))).join('\n');
  assert.match(senza, /\nL'Offerta economica con i prezzi riservati al Cliente verrà allegata alla sottoscrizione\.\nALLEGATO 2 — Ritiro campioni/);
  assert.doesNotMatch(senza, /che segue|Listino €/);
  assert.match(senza, /Documento non disponibile dallo specchio SGI/);
});

// PNG RGBA minimo (tinta unita semitrasparente) per la firma di prova: niente firme vere nei test
function pngProva(w = 120, h = 40) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([20, 40, 120, x % 7 ? 0 : 255], y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('firma di TD: spazio tra qualifica e nome nella colonna di TD, proporzioni conservate, apposta nel PDF', async () => {
  const pag = { w: 595, h: 842, items: [
    { s: 'Il Cliente', x: 156, y: 435, w: 43, h: 11 }, { s: 'Toscana Diagnostica S.r.l.', x: 355, y: 435, w: 125, h: 11 },
    { s: 'Carla Prova', x: 150, y: 422, w: 55, h: 11 }, { s: 'Chief Executive Officer', x: 362, y: 422, w: 112, h: 11 },
    { s: '_______________________', x: 107, y: 380, w: 141, h: 11 }, { s: 'Francesco Epifani', x: 374, y: 380, w: 88, h: 11 },
  ] };
  const sp = spaziFirma([pag], { nome: 'Francesco Epifani', ruolo: 'Chief Executive Officer' });
  assert.equal(sp.length, 1);
  assert.ok(sp[0].y > 380 + 8 && sp[0].y + sp[0].h < 422, 'tra il nome e la qualifica');
  assert.ok(Math.abs(sp[0].cx - (374 + 44)) < 0.01);
  assert.equal(spaziFirma([pag], { nome: 'Carla Prova', ruolo: 'Chief Executive Officer' }).length, 0, 'mai nella colonna del Cliente');
  assert.equal(spaziFirma([pag], { nome: 'Altro Nome', ruolo: 'Chief Executive Officer' }).length, 0);
  const m = misuraFirma(sp[0], 620, 160);
  assert.ok(Math.abs(m.width / m.height - 620 / 160) < 1e-9, 'nessuna deformazione');
  assert.ok(m.height <= sp[0].h && m.width <= 170);
  // PDF con il blocco firme (testo vero), firma PNG apposta
  const doc = await PDFDocument.create(); const pg = doc.addPage([595, 842]); const font = await doc.embedFont(StandardFonts.Helvetica);
  pg.drawText('Toscana Diagnostica S.r.l.', { x: 355, y: 470, size: 11, font }); pg.drawText('Chief Executive Officer', { x: 362, y: 457, size: 11, font });
  pg.drawText('Francesco Epifani', { x: 374, y: 410, size: 11, font }); pg.drawText('Il Cliente', { x: 156, y: 470, size: 11, font });
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const png = pngProva();
  assert.equal(tipoImmagine(png), 'image/png'); assert.equal(tipoImmagine(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg'); assert.equal(tipoImmagine(Buffer.from('GIF89a')), null);
  const r = await apponiFirma(pdf, { mime: 'image/png', buffer: png }, { nome: 'Francesco Epifani', ruolo: 'Chief Executive Officer' });
  assert.equal(r.apposte, 1); assert.ok(r.pdf.length > pdf.length);
  const nessuna = await apponiFirma(pdf, { mime: 'image/png', buffer: png }, { nome: 'Nome Diverso', ruolo: 'Chief Executive Officer' });
  assert.equal(nessuna.apposte, 0); assert.equal(nessuna.pdf, pdf);
  const coda = await accodaPdf(r.pdf, pdf);
  assert.equal(coda.pagine, 1); assert.equal((await PDFDocument.load(coda.pdf)).getPageCount(), 2);
  assert.deepEqual(firmatario({ ...DEFAULT_SETTINGS, firma_nome: ' ', firma_qualifica: '' }), { nome: DEFAULT_SETTINGS.lr_name, ruolo: DEFAULT_SETTINGS.lr_role });
});

test('API: note svuotate restano vuote, denominazione vuota torna predefinita, firma solo PNG/JPG', { skip: SALTA, timeout: 300000 }, async () => {
  const s = await avviaSuite();
  try {
    const o = await entra(client(s.base), OWNER.email, OWNER.password, OWNER.finale);
    const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
    must(await o.post('/api/travaso/business/run', {}), 'avvio Business Hub');
    const org = must(await o.post('/api/organizations', { name: 'Laboratorio Note Prova S.r.l.', kind: 'CLIENTE', code: 'LNP', city: 'Prato' }), 'Legal entity');
    const c = must(await o.post('/api/business/contracts', { kind: 'SRV', org_id: org.id, proposal_date: '2026-11-07', title: 'Titolo provvisorio', start_date: '2026-12-01', notes: 'Pipeline B2B: nota importata', data: { payment_terms: 'Bonifico bancario 60 gg f.m. data fattura' } }), 'contratto');
    assert.equal(c.notes, 'Pipeline B2B: nota importata');
    // come il form: note '' (o null), denominazione vuota, decorrenza tolta
    must(await o.put(`/api/business/contracts/${c.id}`, { org_id: org.id, title: null, proposal_date: '2026-11-07', start_date: null, end_date: null, notes: '', data: c.data }), 'modifica');
    let g = must(await o.get(`/api/business/contracts/${c.id}`), 'lettura');
    assert.equal(g.notes, null, 'le note svuotate non tornano');
    assert.equal(g.start_date, null);
    assert.equal(g.title, 'Laboratorio Note Prova S.r.l.', 'denominazione vuota = ragione sociale');
    assert.equal(g.data.payment_terms, 'Bonifico bancario 60 gg f.m. data fattura');
    // una richiesta senza il campo non lo tocca
    must(await o.put(`/api/business/contracts/${c.id}`, { notes: 'Nuova nota' }), 'nota');
    must(await o.put(`/api/business/contracts/${c.id}`, { data: { ...g.data, payment_terms: '' } }), 'pagamento vuoto');
    g = must(await o.get(`/api/business/contracts/${c.id}`), 'lettura');
    assert.equal(g.notes, 'Nuova nota'); assert.equal(g.data.payment_terms, null, 'termini svuotati: vale il predefinito delle Impostazioni');
    // firma: niente immagine = nessuna firma; un file non immagine è rifiutato
    assert.equal(must(await o.get('/api/business/settings/firma'), 'firma').firma, null);
    const up = async (buf, nome, tipo) => {
      const fd = new FormData(); fd.append('file', new File([buf], nome, { type: tipo }));
      const r = await fetch(`${s.base}/api/business/settings/firma`, { method: 'POST', body: fd, headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
      return { s: r.status, j: await r.json().catch(() => null) };
    };
    assert.equal((await up(Buffer.from('%PDF-1.4 non è una firma'), 'firma.png', 'image/png')).s, 400);
    assert.equal((await up(Buffer.alloc(1024 * 1024 + 10, 1), 'grande.png', 'image/png')).s, 400);
    const ok = await up(pngProva(), 'firma_di_prova.png', 'image/png');
    assert.equal(ok.s, 200); assert.equal(ok.j.firma.larghezza, 120); assert.equal(ok.j.firma.mime, 'image/png');
    const img = await fetch(`${s.base}/api/business/settings/firma/immagine`, { headers: { cookie: o.cookie } });
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await o.del('/api/business/settings/firma')).s, 200);
    assert.equal(must(await o.get('/api/business/settings/firma'), 'firma').firma, null);
  } finally { await s.stop(); }
});
