// Pacchetto di benvenuto, terza richiesta del CEO del 07/11/2026: lettera di offerta sempre rigenerata dal contratto corrente (regola
// della rigenerazione, firmato e listino cambiato dopo la firma), margine inferiore del contratto (nessun testo sul piè di pagina) e
// pagina "Qualità e certificazioni" completa come il sito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { regolaRigenerazione, haFirmato, metaPdf } from '../src/modules/business/lib/contrattoGenera.js';
import { testoSulPiede } from '../src/modules/business/lib/mod230.js';
import { controllaPiede } from '../src/modules/business/lib/contrattoPdf.js';
import { contractData, renderDocx, docxToPdf, pdfAvailable, CONTRACT_TEMPLATE } from '../src/modules/business/lib/docgen.js';
import { DEFAULT_SETTINGS } from '../src/modules/business/lib/rules.js';
import {
  listinoDopoLaFirma, qualitaCertificazioni, certificazioniDa, famigliaNorma, CERTIFICAZIONI_DEFAULT, sezioniLinea,
} from '../src/modules/business/lib/pacchetto.js';
import * as D from '../src/modules/business/lib/pacchettoDocx.js';

test('rigenerazione: libera senza firmato (stessa versione), revisione con il firmato, mai su cessati e annullati', () => {
  const gen = (v) => ({ category: 'GENERATO_DOCX', version: v });
  assert.deepEqual(regolaRigenerazione({ status: 'BOZZA', version: 1, files: [] }), { modo: 'PROPOSTA', errore: null });
  assert.deepEqual(regolaRigenerazione({ status: 'PROPOSTA', version: 5, files: [gen(5)] }), { modo: 'PROPOSTA', errore: null });
  // il caso del CEO: ATTIVO importato senza PDF firmato, documento della versione 1 già presente → si rigenera, niente revisione
  assert.deepEqual(regolaRigenerazione({ status: 'ATTIVO', version: 1, files: [gen(1)] }), { modo: 'RIGENERA', errore: null });
  assert.deepEqual(regolaRigenerazione({ status: 'FIRMATO', version: 2, files: [] }), { modo: 'RIGENERA', errore: null });
  const firmato = { category: 'FIRMATO', version: 1 };
  const conFirmato = regolaRigenerazione({ status: 'ATTIVO', version: 1, files: [gen(1), firmato] });
  assert.equal(conFirmato.modo, 'REVISIONE'); assert.match(conFirmato.errore, /salva prima una nuova revisione/);
  assert.deepEqual(regolaRigenerazione({ status: 'ATTIVO', version: 2, files: [gen(1), firmato] }), { modo: 'REVISIONE', errore: null }, 'revisione appena salvata: si genera');
  assert.match(regolaRigenerazione({ status: 'CESSATO', version: 1, files: [] }).errore, /cessato o annullato/);
  assert.equal(haFirmato([{ category: 'LISTINO_PDF' }]), false); assert.equal(haFirmato([firmato]), true);
  assert.equal(metaPdf({ allegato1: null }), null);
  assert.deepEqual(metaPdf({ allegato1: { listino_id: 3, versione: 2, documento_id: 9, filename: 'x.pdf', pagine: 4, pagina: 12, generata: true, segnalibro: false } }),
    { allegato1_offerta: { listino_id: 3, versione: 2, documento_id: 9, pagine: 4, pagina: 12 } });
});

test('contratto firmato: offerta economica come sezione a sé solo se il listino è cambiato dopo la firma', () => {
  // listino caricato dopo il giorno della firma → sezione a sé
  assert.equal(listinoDopoLaFirma('2026-11-07T10:00:00Z', { signedAt: '2026-11-03' }), true);
  // listino caricato prima (o lo stesso giorno) → è nel firmato
  assert.equal(listinoDopoLaFirma(new Date('2026-11-01T10:00:00Z'), { signedAt: '2026-11-03' }), false);
  assert.equal(listinoDopoLaFirma('2026-11-03T18:00:00Z', { signedAt: '2026-11-03' }), false);
  // senza data di firma vale il caricamento del firmato
  assert.equal(listinoDopoLaFirma('2026-11-07T10:00:00Z', { caricatoFirmatoAt: new Date('2026-11-05T09:00:00Z') }), true);
  // senza data di firma il confronto è al momento: lo stesso giorno, prima o dopo il caricamento del firmato
  assert.equal(listinoDopoLaFirma('2026-11-07T15:00:00Z', { caricatoFirmatoAt: new Date('2026-11-07T14:00:00Z') }), true);
  assert.equal(listinoDopoLaFirma('2026-11-07T13:00:00Z', { caricatoFirmatoAt: new Date('2026-11-07T14:00:00Z') }), false);
  // la lettera generata da cui nasce il firmato aveva già questa versione nell'Allegato 1: non è cambiata, qualunque sia la data
  assert.equal(listinoDopoLaFirma('2026-11-07T10:00:00Z', { signedAt: '2026-11-03', meta: { allegato1_offerta: { listino_id: 7, pagine: 3 } }, listinoId: 7 }), false);
  // senza date utili: meglio i prezzi una volta in più
  assert.equal(listinoDopoLaFirma(null, {}), true);
});

// PDF di esempio: carta con piè di pagina (dati societari + numero di pagina) su ogni pagina; il corpo scende fino a `fondo`
async function pdfEsempio(pagine) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  pagine.forEach((corpo, i) => {
    const pg = doc.addPage([595, 842]);
    pg.drawText('Toscana Diagnostica S.r.l.', { x: 230, y: 58, size: 7.5, font });
    pg.drawText('Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)', { x: 150, y: 47.6, size: 7.5, font });
    pg.drawText('P.IVA e C.F.: 07528130482', { x: 200, y: 37.3, size: 7.5, font });
    pg.drawText(String(i + 1), { x: 540, y: 68.3, size: 7.5, font });
    for (const r of corpo) pg.drawText(r.t, { x: 60, y: r.y, size: 11, font });
  });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test('margine inferiore: il piè si riconosce dalle righe ripetute, il corpo che ci entra è segnalato', async () => {
  const ok = await pdfEsempio([
    [{ t: 'Art. 1 - Oggetto', y: 700 }, { t: 'ultima riga del corpo', y: 87.5 }, { t: '9.2.6', y: 112.8 }],
    [{ t: 'Art. 2 - Durata', y: 700 }, { t: 'modalita stabilite nel Contratto.', y: 87.5 }, { t: '11.3.5', y: 112.8 }],
    [{ t: 'Art. 3 - Corrispettivi', y: 700 }, { t: 'fine articolo', y: 100.1 }],
    [{ t: 'Art. 4 - Recesso', y: 700 }],
    [{ t: 'ALLEGATO 1 - Elenco', y: 700 }],
  ]);
  const r = await controllaPiede(ok);
  assert.equal(r.pagine, 5); assert.deepEqual(r.senzaPiede, []);
  assert.deepEqual(r.violazioni, [], 'numerazione del corpo ripetuta alla stessa quota ("#.#.#") non è piè di pagina');
  // la tabella dei prezzi del vecchio Allegato 1 che scende sul piè (il caso del pacchetto AgapeLab v4)
  const ko = await pdfEsempio([
    [{ t: 'Art. 1 - Oggetto', y: 700 }],
    [{ t: 'Prezzi dell\'offerta', y: 700 }, { t: '0614  Tipizzazione linfocitaria  8,57', y: 52 }, { t: '0613  Linfociti CD4+  43,20', y: 74 }],
    [{ t: 'ALLEGATO 2 - Ritiro', y: 700 }],
  ]);
  const v = (await controllaPiede(ko)).violazioni;
  assert.deepEqual([...new Set(v.map((x) => x.pagina))], [2]);
  assert.ok(v.some((x) => /Tipizzazione/.test(x.testo)) && v.some((x) => /Linfociti/.test(x.testo)));
  // regola pura: pagina senza testo nella fascia bassa → nessun piè riconosciuto, nessuna violazione
  assert.deepEqual(testoSulPiede([{ w: 595, h: 842, items: [{ s: 'solo corpo', x: 60, y: 700, w: 80, h: 11 }] }]).violazioni, []);
});

test('margine inferiore sul contratto Service vero (template MOD230 + LibreOffice): nessun testo sul piè in tutte le pagine', { timeout: 240000 }, async (t) => {
  if (!(await pdfAvailable())) { t.skip('LibreOffice non disponibile'); return; }
  const p = { name: 'Laboratorio Prova S.r.l.', street: 'Via Roma 1', zip: '59100', city: 'Prato', prov: 'PO', vat: '01234567890', pec: 'prova@pec.test', legal_rep: 'Carla Prova' };
  const c = { id: 9, kind: 'SRV', protocol: 'SRV-2026-0009', version: 1, proposal_date: '2026-11-07', data: { privacy: { role: 'RESPONSABILE' }, payment_terms: 'RID/SDD 30 gg f.m.' } };
  const pdf = await docxToPdf(renderDocx(CONTRACT_TEMPLATE.SRV, contractData(c, p, DEFAULT_SETTINGS, { allegato1: { versione: 2, data: '2026-11-06', esami: 2793 } })));
  const r = await controllaPiede(pdf);
  assert.ok(r.pagine >= 10, `pagine: ${r.pagine}`);
  assert.deepEqual(r.senzaPiede, [], 'ogni pagina ha il piè della carta intestata');
  assert.deepEqual(r.violazioni, []);
});

const CERT = {
  organismo: { nome: 'EuCI - European Certification Institute Ltd', accreditamento: 'Accreditato ESYD, certificato n. 831', verifica: 'https://www.eucicertification.com' },
  certificazioni: [
    { norma: 'ISO 9001:2015', titolo: 'Sistema di Gestione per la Qualità', numero: 'TOSC5191Q2606', emissione_corrente: '04/09/2026', scadenza: '03/09/2029' },
    { norma: 'ISO 45001:2018', titolo: 'Sistema di Gestione per la Salute e Sicurezza sul Lavoro', numero: 'TOSC5191H2605', emissione_corrente: '04/09/2026', scadenza: '03/09/2029' },
    { norma: 'ISO 14001:2015', titolo: 'Sistema di Gestione Ambientale', numero: 'TOSC5191E2602', emissione_corrente: '04/09/2026', scadenza: '30/04/2029' },
    { norma: 'ISO 37001:2025', titolo: 'Sistema di Gestione per la Prevenzione della Corruzione', numero: 'TOSC5191A2604', emissione_corrente: '04/09/2026', scadenza: '03/09/2029' },
    { norma: 'ISO 7101:2024', titolo: 'Sistema di Gestione per la Qualità nelle Organizzazioni Sanitarie' },
    { norma: 'ISO/IEC 27001:2022', titolo: 'Sistema di Gestione per la Sicurezza delle Informazioni' },
  ],
};

test('Qualità e certificazioni: certificati dalla fonte, standard del sito in ordine, differenze di anno segnalate', () => {
  assert.equal(famigliaNorma('ISO/IEC 27001:2022'), 'ISO 27001'); assert.equal(famigliaNorma('UNI/PdR 125:2022'), 'UNI/PDR 125'); assert.equal(famigliaNorma('UNI/PdR 125'), 'UNI/PDR 125');
  const politica = { code: 'TD-SGI-POL001_01', rev: '01', data: '29/10/2026', title: 'Politica Integrata', url: 'https://service.toscanadiagnostica.it/doc/TD-SGI-POL001' };
  const q = qualitaCertificazioni({ cert: CERT, testi: CERTIFICAZIONI_DEFAULT, autorizzazione: 'Autorizzazione Sanitaria n. 12 del 12/06/2026 rilasciata dal Comune di Sesto Fiorentino', politica });
  // le 4 righe della tabella: le ISO con numero dello specchio, con norme e anni della fonte dei certificati
  assert.deepEqual(q.certificati.map((c) => [c.norma, c.numero, c.emissione, c.scadenza]), [
    ['ISO 9001:2015', 'TOSC5191Q2606', '04/09/2026', '03/09/2029'], ['ISO 45001:2018', 'TOSC5191H2605', '04/09/2026', '03/09/2029'],
    ['ISO 14001:2015', 'TOSC5191E2602', '04/09/2026', '30/04/2029'], ['ISO 37001:2025', 'TOSC5191A2604', '04/09/2026', '03/09/2029']]);
  // elenco completo come sul sito, in quell'ordine; con il certificato vale la norma del certificato
  assert.deepEqual(q.standard.map((x) => x.norma), ['Politica della Qualità nel SGI', 'ISO 9001:2015', 'ISO 45001:2018', 'ISO 14001:2015', 'ISO 37001:2025', 'ISO 7101:2024', 'PAS 24000:2022', 'ISO 27001:2022', 'ISO 30415:2021', 'UNI/PdR 125']);
  assert.deepEqual(q.standard.filter((x) => x.certificato).map((x) => x.certificato), ['TOSC5191Q2606', 'TOSC5191H2605', 'TOSC5191E2602', 'TOSC5191A2604']);
  assert.equal(q.standard.find((x) => x.norma === 'ISO 7101:2024').certificato, null, 'senza certificato: standard di riferimento, nessun numero');
  assert.deepEqual(q.differenze, [{ standard: 'ISO 45001:2023', certificato: 'ISO 45001:2018', numero: 'TOSC5191H2605' }, { standard: 'ISO 37001:2016', certificato: 'ISO 37001:2025', numero: 'TOSC5191A2604' }]);
  assert.equal(q.organismo.nome, 'EuCI - European Certification Institute Ltd');
  assert.match(q.autorizzazione, /n\. 12 del 12\/06\/2026/); assert.equal(q.politica.url, politica.url);
  // senza specchio: nessun certificato, gli standard restano tutti "di riferimento"
  const vuota = qualitaCertificazioni({ cert: null });
  assert.deepEqual(vuota.certificati, []); assert.equal(vuota.standard.length, 10); assert.ok(vuota.standard.every((x) => !x.certificato)); assert.equal(vuota.politica, null);
});

test('Qualità e certificazioni: impostazioni sopra i predefiniti, pagina DOCX con tabella, standard e collegamento alla Politica', () => {
  assert.deepEqual(certificazioniDa(null), CERTIFICAZIONI_DEFAULT);
  const mod = certificazioniDa({ titolo: '  ', pratiche: 'Pratiche nuove.', standard: [{ norma: 'ISO 9001:2015', ambito: 'Qualità' }, { norma: '', ambito: 'vuota' }] });
  assert.equal(mod.titolo, CERTIFICAZIONI_DEFAULT.titolo); assert.equal(mod.pratiche, 'Pratiche nuove.'); assert.deepEqual(mod.standard, [{ norma: 'ISO 9001:2015', ambito: 'Qualità' }]);
  assert.equal(sezioniLinea('SRV').find((x) => x.key === 'diversi').titolo, 'Qualità e certificazioni');
  const politica = { code: 'TD-SGI-POL001_01', rev: '01', data: '29/10/2026', title: 'Politica Integrata', url: 'https://service.toscanadiagnostica.it/doc/TD-SGI-POL001' };
  const qualita = qualitaCertificazioni({ cert: CERT, autorizzazione: 'Autorizzazione Sanitaria n. 12 del 12/06/2026 rilasciata dal Comune di Sesto Fiorentino', politica });
  const corpo = D.diversi({ linea: 'SRV', qualita });
  const testo = corpo.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  for (const atteso of ['Qualità e certificazioni', 'La qualità non è una promessa. È un metodo.', 'TOSC5191H2605', 'dal 04/09/2026 al 03/09/2029', 'Standard di riferimento',
    'L.R. Toscana 51/2009', 'Comune di Sesto Fiorentino.', 'Valutazione Esterna di Qualità (VEQ)', 'Governance clinica', 'TD-SGI-POL001 "Politica Integrata", revisione 01', 'Apri il PDF della revisione in vigore', 'Cosa ci rende diversi']) {
    assert.ok(testo.includes(atteso), `manca: ${atteso}`);
  }
  assert.match(corpo, /<w:hyperlink r:id="rIdPolitica"/);
  const docx = D.costruisci(corpo, [], [{ rId: 'rIdPolitica', url: politica.url }]);
  const rels = new PizZip(docx).file('word/_rels/document.xml.rels').asText();
  assert.match(rels, /Id="rIdPolitica" Type="[^"]+\/hyperlink" Target="https:\/\/service\.toscanadiagnostica\.it\/doc\/TD-SGI-POL001" TargetMode="External"/);
});
