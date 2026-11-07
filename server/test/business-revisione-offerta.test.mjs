// Business Hub · richiesta del CEO del 07/11/2026: offerta economica PDF ripulita (niente sconto medio, colonna "Sconto" solo se c'è uno
// sconto, niente "preparata per", versione, fascia "Ci prendiamo cura" e "Listino di riferimento"), revisione del listino/offerta
// (regola pura applicaRevisione: righe cambiate, differenze, validazione) e, con DATABASE_URL_TEST, il flusso sulla Suite vera: contratto
// SRV caricato firmato dalla scheda Contratto → contrattualizzazione una volta sola; revisione v2 → offerta v2 → "Invia per la firma"
// (EMAIL_OUT OFFERTA_REVISIONE) → offerta firmata caricata (nessuna nuova contrattualizzazione).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { applicaRevisione, testoRigheCambiate, chiaveRiga, riepilogo } from '../src/modules/business/lib/listino.js';
import { copertinaOfferta, corpoOfferta, tabellaEsami, haSconto } from '../src/modules/business/lib/offertaEconomica.js';
import { MODELLI_DEFAULT, SEGNAPOSTO_MODELLI, segnapostoDi, compila } from '../src/modules/business/lib/processo.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

const RIGHE = [
  { codice: 'A1', descrizione: 'Glicemia', settore: 'Chimica', listino: 2.5, offerto: 2, sconto: 20 },
  { codice: 'A2', descrizione: 'Emocromo', settore: 'Ematologia', listino: 4, offerto: 4, sconto: 0 },
  { codice: null, descrizione: 'Esame senza codice', settore: null, listino: 10, offerto: 9, sconto: 10 },
];

// ---------------------------------------------------------------- offerta economica: contenuto
const datiOfferta = (righe) => ({ cliente: 'Laboratorio Prova S.r.l.', indirizzo: 'Via Roma 1, Prato (PO)', data: '2026-11-07', validita: '2027-01-06', condizioni: 'Bonifico 30 gg', note: null,
  destinatario: 'Maria Bianchi', owner: 'Mario Rossi', versione: 3, caricato_at: '2026-11-01', righe, riepilogo: riepilogo(righe), luogo: 'Sesto Fiorentino', societa: 'Società', firma: { nome: 'Nome', ruolo: 'Ruolo' } });

test('offerta economica: copertina senza "preparata per", versione e fascia "Ci prendiamo cura"', () => {
  const x = copertinaOfferta(datiOfferta(RIGHE));
  assert.doesNotMatch(x, /preparata per/i);
  assert.doesNotMatch(x, /Versione|StudioLAB|v3/);
  assert.doesNotMatch(x, /Ci prendiamo cura|ogni minuto conta/);
  for (const t of ['Data', 'Valida fino al', 'A cura di', 'Alla cortese attenzione', 'Laboratorio Prova S.r.l.']) assert.match(x, new RegExp(t.toUpperCase() === t ? t : `(${t}|${t.toUpperCase()})`));
});

test('offerta economica: corpo senza sconto medio né "Listino di riferimento"; colonna Sconto solo se c\'è uno sconto', () => {
  const con = corpoOfferta(datiOfferta(RIGHE));
  assert.doesNotMatch(con, /SCONTO MEDIO|Sconto medio|ponderato/);
  assert.doesNotMatch(con, /Listino di riferimento|versione 3/);
  assert.match(con, />Sconto</, 'con almeno un esame scontato la colonna c\'è');
  const pieni = RIGHE.map((x) => ({ ...x, offerto: x.listino, sconto: 0 }));
  assert.equal(haSconto(pieni), false);
  assert.equal(haSconto(RIGHE), true);
  const senza = corpoOfferta(datiOfferta(pieni));
  assert.doesNotMatch(senza, />Sconto</, 'nessuno sconto: niente colonna');
  assert.match(senza, />Offerta €</);
  assert.doesNotMatch(tabellaEsami(pieni, { conSconto: false }), />Sconto</);
});

// ---------------------------------------------------------------- revisione: regola pura
test('revisione: un solo prezzo cambiato, sconto ricalcolato, differenze con la funzione di sempre', () => {
  const out = applicaRevisione(RIGHE, [{ chiave: 'c:A2', offerto: 3.5 }]);
  assert.equal(out.righe.length, 3);
  assert.equal(out.righe[1].offerto, 3.5); assert.equal(out.righe[1].listino, 4); assert.equal(out.righe[1].sconto, 12.5);
  assert.deepEqual(out.righe[0], RIGHE[0], 'le altre righe non cambiano');
  assert.equal(out.differenze.cambiate.length, 1);
  assert.equal(out.differenze.cambiate[0].offerto_prima, 4); assert.equal(out.differenze.cambiate[0].offerto_dopo, 3.5);
  assert.equal(out.differenze.aggiunte.length, 0); assert.equal(out.differenze.tolte.length, 0); assert.equal(out.differenze.invariate, 2);
  assert.equal(out.riepilogo.esami, 3);
  assert.equal(out.riepilogo.totale_offerto, 14.5);
});

test('revisione: anche il listino, righe senza codice per descrizione, avviso sopra listino', () => {
  const k = chiaveRiga(RIGHE[2]);
  assert.match(k, /^d:/);
  const out = applicaRevisione(RIGHE, [{ chiave: k, offerto: 8, listino: 12 }, { chiave: 'c:A1', offerto: '2.75' }]);
  assert.equal(out.righe[2].listino, 12); assert.equal(out.righe[2].offerto, 8); assert.equal(out.righe[2].sconto, 33.33);
  assert.equal(out.differenze.cambiate.length, 2);
  assert.equal(out.avvisi.length, 1, 'A1 offerto 2,75 sopra il listino 2,50');
  const t = testoRigheCambiate(out.differenze.cambiate);
  assert.match(t, /- A1 Glicemia: 2,00 € → 2,75 €/);
  assert.match(t, /Esame senza codice: 9,00 € → 8,00 € \(listino 10,00 € → 12,00 €\)/);
});

test('revisione: validazione (chiave sconosciuta o ripetuta, prezzi negativi o non numerici, nessun cambio)', () => {
  assert.throws(() => applicaRevisione(RIGHE, []), /Nessun prezzo modificato/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:ZZ', offerto: 1 }]), /non presente/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: 1 }, { chiave: 'c:A1', offerto: 2 }]), /due volte/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: -1 }]), /non valido/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: 'abc' }]), /non valido/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: 1, listino: -2 }]), /listino non valido/);
  assert.throws(() => applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: 2 }]), /Nessun prezzo diverso/);
  assert.equal(applicaRevisione(RIGHE, [{ chiave: 'c:A1', offerto: 0 }]).righe[0].sconto, 100, 'zero è un prezzo valido');
});

test('modello "Revisione dell\'offerta economica": segnaposto ammessi e righe compilate', () => {
  assert.ok(MODELLI_DEFAULT.revisione_oggetto && MODELLI_DEFAULT.revisione_testo);
  const usati = [...segnapostoDi(MODELLI_DEFAULT.revisione_oggetto), ...segnapostoDi(MODELLI_DEFAULT.revisione_testo)];
  for (const k of usati) assert.ok(SEGNAPOSTO_MODELLI.revisione.includes(k), `{{${k}}} ammesso`);
  const t = compila(MODELLI_DEFAULT.revisione_testo, { cliente: 'Lab Prova', versione: '2', righe_cambiate: '- A1 Glicemia: 2,00 € → 1,80 €', data: '07/11/2026' });
  assert.match(t, /versione 2 del 07\/11\/2026/); assert.match(t, /A1 Glicemia: 2,00 € → 1,80 €/);
});

// ---------------------------------------------------------------- flusso sulla Suite vera
const pdfMinimo = async (testo) => { const d = await PDFDocument.create(); const p = d.addPage([300, 200]); p.drawText(testo, { x: 20, y: 100, size: 12 }); return Buffer.from(await d.save()); };
async function xlsxListino() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Listino');
  ws.addRow(['Codice', 'Descrizione', 'Settore', 'Prezzo listino', 'Prezzo offerto']);
  ws.addRow(['A1', 'Glicemia', 'Chimica', 2.5, 2]); ws.addRow(['A2', 'Emocromo', 'Ematologia', 4, 4]); ws.addRow(['A3', 'TSH', 'Endocrinologia', 12, 10]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('flusso: contratto firmato dalla scheda Contratto (una sola contrattualizzazione) e revisione dell\'offerta con rifirma', { skip: SALTA, timeout: 300000 }, async () => {
  const s = await avviaSuite();
  try {
    const o = await entra(client(s.base), OWNER.email, OWNER.password, OWNER.finale);
    const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
    const up = async (p, campi) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(campi)) fd.append(k, v);
      const r = await fetch(s.base + p, { method: 'POST', body: fd, headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
      const j = await r.json().catch(() => null); if (r.status >= 300) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j;
    };
    must(await o.post('/api/travaso/business/run', {}), 'avvio Business Hub');
    const acc = must(await o.post('/api/business/hub/accounts', { linea: 'SRV', nuova_org: { name: 'Laboratorio Revisione Prova S.r.l.', city: 'Prato', province: 'PO', email: 'info@labrev.test', address: 'Via Roma 2', vat_number: '01234567891' } }), 'prospect');
    must(await o.post(`/api/business/hub/accounts/${acc.id}/contatti`, { nome: 'Maria Verdi', ruolo: 'Direttrice', email: 'maria.verdi@labrev.test', principale: true }), 'referente');
    // contratto SRV della Legal entity: la scheda account lo propone come contratto corrente
    let a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.contratto_corrente_id, null, 'nessun contratto: la scheda propone "Nuova proposta"');
    const c = must(await o.post('/api/business/contracts', { kind: 'SRV', org_id: a.organization_id, proposal_date: '2026-11-07', data: {} }), 'contratto');
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.contratto_corrente_id, c.id);
    // in bozza il firmato non si carica; in proposta passa dalla contrattualizzazione
    const pdf = new Blob([await pdfMinimo('contratto firmato')], { type: 'application/pdf' });
    await assert.rejects(up(`/api/business/contracts/${c.id}/files`, { category: 'FIRMATO', files: new File([pdf], 'firmato.pdf') }), /Genera prima la proposta/);
    must(await o.post(`/api/business/contracts/${c.id}/stato-manuale`, { status: 'PROPOSTA', motivo: 'proposta consegnata a mano (prova)' }), 'proposta');
    const f1 = await up(`/api/business/contracts/${c.id}/files`, { category: 'FIRMATO', signed_at: '2026-11-07', files: new File([pdf], 'contratto_firmato.pdf', { type: 'application/pdf' }) });
    assert.equal(f1.status, 'FIRMATO'); assert.equal(f1.contrattualizzazione.gia, false);
    assert.equal(f1.files.filter((x) => x.category === 'FIRMATO').length, 1, 'un solo PDF firmato nel contratto');
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.fase_corrente, 6);
    assert.ok(a.contrattualizzato_at);
    const email0 = a.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length;
    assert.ok(['CONTRATTUALIZZAZIONE', 'BENVENUTO', 'NUOVO_CLIENTE_LAB'].every((st) => a.attivita.some((x) => x.sottotipo === st)), 'comunicazioni della contrattualizzazione');
    assert.equal(a.attivita.filter((x) => x.tipo === 'SISTEMA' && x.fase_a === 6).length, 1, 'fase 6 una volta sola');
    // secondo caricamento: PDF nel contratto, nessuna comunicazione nuova
    const f2 = await up(`/api/business/contracts/${c.id}/files`, { category: 'FIRMATO', files: new File([pdf], 'contratto_firmato_2.pdf', { type: 'application/pdf' }) });
    assert.equal(f2.contrattualizzazione.gia, true);
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.equal(a.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length, email0);
    assert.equal(a.attivita.filter((x) => x.tipo === 'SISTEMA' && x.fase_a === 6).length, 1);

    // listino v1 e revisione v2 di un solo prezzo
    const l1 = await up(`/api/business/hub/accounts/${acc.id}/listini`, { file: new File([await xlsxListino()], 'listino.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), note: 'prima versione' });
    const righe = must(await o.get(`/api/business/hub/listini/${l1.id}`), 'righe').righe;
    assert.ok(righe.every((x) => x.chiave));
    const k = righe.find((x) => x.codice === 'A2').chiave;
    assert.equal((await o.post(`/api/business/hub/accounts/${acc.id}/listini/${l1.id}/revisione`, { righe: [{ chiave: k, offerto: 3.6 }] })).s, 400, 'motivo obbligatorio');
    assert.equal((await o.post(`/api/business/hub/accounts/${acc.id}/listini/${l1.id}/revisione`, { righe: [{ chiave: k, offerto: -1 }], motivo: 'prezzo concordato' })).s, 400, 'prezzo negativo');
    const rv = must(await o.post(`/api/business/hub/accounts/${acc.id}/listini/${l1.id}/revisione`, { righe: [{ chiave: k, offerto: '3,60' }], motivo: 'prezzo concordato al telefono' }), 'revisione');
    assert.equal(rv.versione, 2); assert.equal(rv.differenze.cambiate.length, 1);
    assert.equal((await o.post(`/api/business/hub/accounts/${acc.id}/listini/${l1.id}/revisione`, { righe: [{ chiave: k, offerto: 3 }], motivo: 'dalla vecchia versione' })).s, 400, 'la revisione parte dalla corrente');
    const lst = must(await o.get(`/api/business/hub/accounts/${acc.id}/listini`), 'versioni');
    const v2 = lst.versioni.find((x) => x.versione === 2);
    assert.equal(lst.corrente_id, v2.id); assert.equal(v2.origine, 'REVISIONE'); assert.equal(v2.base_versione, 1); assert.equal(v2.note, 'prezzo concordato al telefono');
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    const diarioRev = a.attivita.find((x) => x.tipo === 'LISTINO' && x.sottotipo === 'REVISIONE');
    assert.match(diarioRev.testo, /A2 Emocromo: 4,00 € → 3,60 €/);
    // email prima dell'offerta: 400; offerta v2 (solo quel PDF) e invio per la firma
    assert.equal((await o.get(`/api/business/hub/listini/${v2.id}/revisione/email`)).s, 400);
    const off = must(await o.post(`/api/business/hub/listini/${v2.id}/offerta`, {}), 'offerta v2');
    assert.equal(off.versione, 2); assert.match(off.filename, /_v2\.pdf$/);
    const em = must(await o.get(`/api/business/hub/listini/${v2.id}/revisione/email`), 'email');
    assert.match(em.subject, /v2/); assert.match(em.testo, /A2 Emocromo: 4,00 € → 3,60 €/); assert.equal(em.documento.id, off.documento_id);
    const inv = must(await o.post(`/api/business/hub/accounts/${acc.id}/email/invia`, { to: ['maria.verdi@labrev.test'], subject: em.subject, testo: em.testo, documenti: [off.documento_id], sottotipo: 'OFFERTA_REVISIONE', listino_id: v2.id, conferma: true }), 'invio');
    assert.equal(inv.stato, 'REGISTRATO');
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    const out = a.attivita.find((x) => x.sottotipo === 'OFFERTA_REVISIONE');
    assert.equal(out.tipo, 'EMAIL_OUT'); assert.equal(out.email_to, 'maria.verdi@labrev.test');
    // offerta firmata caricata: diario, versione firmata e corrente, nessuna nuova contrattualizzazione
    const nEmail = a.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length;
    const fir = await up(`/api/business/hub/listini/${v2.id}/offerta-firmata`, { file: new File([await pdfMinimo('offerta firmata')], 'offerta_v2_firmata.pdf', { type: 'application/pdf' }) });
    assert.equal(fir.gia, false); assert.equal(fir.versione, 2);
    const lst2 = must(await o.get(`/api/business/hub/accounts/${acc.id}/listini`), 'versioni');
    const v2b = lst2.versioni.find((x) => x.versione === 2);
    assert.ok(v2b.firmata_at); assert.ok(v2b.revisione_inviata_at); assert.equal(lst2.corrente_id, v2b.id);
    a = must(await o.get(`/api/business/hub/accounts/${acc.id}`), 'account');
    assert.ok(a.documenti.some((d) => d.etichetta === 'Offerta economica v2 firmata'));
    assert.ok(a.attivita.some((x) => x.sottotipo === 'OFFERTA_FIRMATA'));
    assert.equal(a.attivita.filter((x) => x.tipo === 'EMAIL_OUT').length, nEmail, 'nessuna comunicazione nuova');
    assert.equal(a.attivita.filter((x) => x.tipo === 'CONTRATTO_FIRMATO').length, 2, 'solo le due ricezioni del contratto, nessuna per l\'offerta');
  } finally { await s.stop(); }
});
