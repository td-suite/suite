// v0.68.6 (CEO 10/11/2026: "C'è una discrepanza tra il valore dell'accettato di StudioLab a ieri e quello del Cockpit o comunque della
// Suite. Trovare l'errore e correggere."): A) produzione ACCETTATA (stati predefiniti tutti tranne 11), sconto di testata non applicato
// salvo impostazione, righe a prezzo nullo contate negli esami, migrazione del predefinito solo se invariato; B) quadratura con il report
// "Riepilogo Esami" (testo nel formato del report, cause attribuite, varianti, XLSX, PDF letto con pdftotext); C) Cockpit ridisegnato
// (KPI con statistiche, grafici, operatività, sintesi delle scadenze). Solo dati sintetici con nomi inventati: nessun cliente reale, nessun
// paziente. Parte pura sempre; parte con database (DATABASE_URL_TEST, database temporaneo suite_v686_<pid>) solo se la variabile c'è.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_v686_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const copia = (o) => JSON.parse(JSON.stringify(o));
const here = path.dirname(fileURLToPath(import.meta.url));

// Report sintetico nel formato del "Riepilogo Esami" di StudioLab (nomi inventati). Totali coerenti con i dati della parte con database.
const NOME_LUNGO = 'Poliambulatorio Prova Gamma Servizi Sanitari Integrati Società Cooperativa Sociale';
const REPORT = `                                   Riepilogo Esami  Dal 01/11/2026 al 09/11/2026
Cliente / Esame                                                 Q.ta      Privati      Ticket        ULSS       Costo
Casa di Cura Prova Alfa S.r.l. - Medicina
    GLU      Glucosio                                              2        20,00        0,00        0,00        4,00
    IND      INDICE DI SIERO                                       1
Totale cliente:                                                    3        20,00        0,00        0,00        4,00
Casa di Cura Prova Alfa S.r.l. - Chirurgia
    ALT      Alanina aminotransferasi                              1        30,00        0,00        0,00        6,00
Totale cliente:                                                    1        30,00        0,00        0,00        6,00
Studio Prova Beta
    GLU      Glucosio                                              2        20,00        0,00        0,00        4,00
Totale cliente:                                                    2        20,00        0,00        0,00        4,00
${NOME_LUNGO.slice(0, 45)}
    25990    Proteine Totali                                       1        50,00        0,00        0,00        9,00
Totale cliente:                                                    1        50,00        0,00        0,00        9,00
Centro Prova Delta
    GLU      Glucosio                                              1        10,00        0,00        0,00        2,00
    AZO      Azotemia                                              1         8,00        0,00        0,00        1,00
Totale cliente:                                                    2        23,00        0,00        0,00        3,00
Cliente Sconosciuto Prova
    GLU      Glucosio                                              1        12,00        0,00        0,00        2,00
Totale cliente:                                                    1        12,00        0,00        0,00        2,00
                                                                                                        Pag. 1 di 1
Totale globale:                                                   10       155,00        0,00        0,00       28,00
`;

// ------------------------------------------------------------------ parte pura
describe('v0.68.6 · regole pure', () => {
  let L, Q, M, Y;
  before(async () => {
    L = await import('../src/lib/synclab/letture.js');
    Q = await import('../src/lib/synclab/quadratura.js');
    M = await import('../src/lib/cockpitMonitor.js');
    Y = await import('../src/lib/synclab/sync.js');
  });

  test('definizione: accettato = tutti gli stati tranne 11; sconto di testata predefinito non applicato', () => {
    assert.deepEqual(L.STATI_ACCETTATO, [10, 15, 18, 20, 25, 30, 40, 50]);
    assert.deepEqual(L.STATI_EROGATI_PREDEFINITI, L.STATI_ACCETTATO);
    assert.deepEqual(L.STATI_EROGATI_STORICI, [18, 20, 25, 40, 50]);
    assert.equal(L.SCONTO_TESTATA_PREDEFINITO, 'NON_APPLICARE');
    assert.equal(L.normalizzaSconto('applica'), 'APPLICA'); assert.equal(L.normalizzaSconto(null), 'NON_APPLICARE'); assert.equal(L.normalizzaSconto(true), 'APPLICA');
    assert.equal(Y.IMPOSTAZIONI_PREDEFINITE.sconto_testata, 'NON_APPLICARE');
    assert.equal(L.fonteProduzione(L.STATI_ACCETTATO, null), 'Synclab, produzione accettata (stati 10, 15, 18, 20, 25, 30, 40, 50), importi di riga (sconto di testata non applicato), nessuna copia delle accettazioni');
    assert.match(L.fonteProduzione([50], null, 'APPLICA'), /netto di riga e sconto di testata/);
    assert.equal(L.VARIANTI_QUADRATURA.length, 4);
  });

  test('calcolaVariante: stati esclusi, righe cancellate, righe senza prezzo, sconto di testata sì/no', () => {
    const righe = [
      { client_id: 'A', state: 50, deleted: false, accettazioni: 2, righe: 3, quantita: 3, importo_riga: 100, sconto: 10, senza_prezzo: 1 },
      { client_id: 'A', state: 50, deleted: true, accettazioni: 1, righe: 1, quantita: 1, importo_riga: 7, sconto: 0, senza_prezzo: 0 },
      { client_id: 'A', state: 10, deleted: false, accettazioni: 1, righe: 2, quantita: 2, importo_riga: 40, sconto: 0, senza_prezzo: 0 },
      { client_id: 'A', state: 11, deleted: false, accettazioni: 1, righe: 1, quantita: 1, importo_riga: 9, sconto: 0, senza_prezzo: 0 },
    ];
    const a = L.calcolaVariante(righe, 'ACCETTATO_RIGA');
    assert.deepEqual([a.accettazioni, a.righe, a.quantita, a.importo, a.righe_senza_prezzo, a.sconto_testata], [3, 5, 5, 140, 1, 10]);
    assert.deepEqual([a.esclusi.accettazioni, a.esclusi.importo, a.cancellate.righe, a.cancellate.importo], [1, 9, 1, 7], 'esclusa solo la 11; riga cancellata a parte');
    const s = L.calcolaVariante(righe, 'ACCETTATO_SCONTO');
    assert.equal(s.importo, 130, 'sconto di testata applicato');
    const e = L.calcolaVariante(righe, 'EROGATI_RIGA');
    assert.deepEqual([e.importo, e.esclusi.importo], [100, 49]);
    assert.deepEqual(e.stati_esclusi.map((x) => [x.stato, x.accettazioni]), [[10, 1], [11, 1]]);
  });

  test('lettura del report "Riepilogo Esami": periodo, sottototali per cliente, reparto, righe senza importo, totale globale', () => {
    const r = Q.leggiRiepilogoEsami(REPORT);
    assert.deepEqual(r.periodo, { da: '2026-11-01', a: '2026-11-09' });
    assert.deepEqual(r.totale, { qta: 10, importo: 155, ticket: 0, ulss: 0, costo: 28 });
    assert.deepEqual(r.clienti.map((c) => [c.nome, c.qta, c.importo]), [
      ['Casa di Cura Prova Alfa S.r.l. - Medicina', 3, 20], ['Casa di Cura Prova Alfa S.r.l. - Chirurgia', 1, 30], ['Studio Prova Beta', 2, 20],
      [NOME_LUNGO.slice(0, 45).trim(), 1, 50], ['Centro Prova Delta', 2, 23], ['Cliente Sconosciuto Prova', 1, 12]]);
    const alfa = r.clienti[0];
    assert.deepEqual([alfa.base, alfa.reparto, alfa.righe, alfa.righe_senza_importo], ['Casa di Cura Prova Alfa S.r.l.', 'Medicina', 2, 1], 'la componente di profilo senza importo conta nella Q.ta');
    assert.equal(r.controllo.coincide, true);
    assert.ok(r.avvisi.some((a) => /Centro Prova Delta: le righe d'esame/.test(a)), 'righe (18) diverse dal sottototale (23): avviso');
    // sottototale con il nome dopo "Totale" e righe senza intestazione; importi con le migliaia
    const r2 = Q.leggiRiepilogoEsami('Riepilogo Esami Dal 01/11/2026 al 09/11/2026\n  GLU Glucosio 1.200 12.345,50\nTotale Laboratorio Prova Epsilon: 1.200 12.345,50 0,00 0,00 1,00\nTotale globale: 1.200 12.345,50 0,00 0,00 1,00');
    assert.deepEqual(r2.clienti.map((c) => [c.nome, c.qta, c.importo]), [['Laboratorio Prova Epsilon', 1200, 12345.5]]);
    // testo senza periodo e senza totale: avvisi
    const r3 = Q.leggiRiepilogoEsami('niente');
    assert.ok(r3.avvisi.some((a) => /Periodo non trovato/.test(a)) && r3.avvisi.some((a) => /Totale globale/.test(a)));
    assert.deepEqual(Q.codaNumerica('25990 Proteine Totali 3'), { testo: '25990 Proteine Totali', qta: 3, importi: [], numeri: 1 });
  });

  test('layout reale (pdftotext -layout): intestazione di pagina, salto pagina dentro un blocco, sola Q.ta, Q.ta e solo Costo, sottototale di soli numeri', () => {
    // stessa STRUTTURA del PDF di StudioLab, con nomi inventati: colonne allineate a destra sotto le intestazioni
    const fine = { qta: 75, privati: 89, ticket: 102, ulss: 123, costo: 138 };
    const aDestra = (riga, testo, colFine) => { const r = riga.padEnd(colFine - testo.length); return r + testo; };
    const esame = (cod, descr, qta, privati = null, costo = null, sposta = 0) => {
      let r = `${cod.padEnd(17)}${descr}`.padEnd(57);
      r = aDestra(r, String(qta), fine.qta + sposta);
      if (privati != null) r = aDestra(r, privati, fine.privati + sposta);
      if (costo != null) r = aDestra(r, costo, fine.costo);
      return r;
    };
    const sotto = (qta, privati, costo) => [[String(qta), fine.qta], [privati, fine.privati], ['0,00', fine.ticket], ['0,00', fine.ulss], [costo, fine.costo]].reduce((r, [t, c]) => aDestra(r, t, c), '');
    const testata = (pag) => [...(pag > 1 ? [aDestra('', `Pagina ${pag - 1} di 2`, 140)] : []), 'Laboratorio Analisi Prova Srl', '',
      aDestra(aDestra('                           Riepilogo Esami', 'Dal    01/11/2026', 101), 'al    09/11/2026', 123), '',
      [['Q.ta', fine.qta], ['Privati', fine.privati], ['Ticket', fine.ticket], ['ULSS', fine.ulss], ['Costo', fine.costo]].reduce((r, [t, c]) => aDestra(r, t, c), '    Codice                           Descrizione'), ''];
    const testo = [
      ...testata(1),
      'Casa di Cura Prova Alfa S.r.l. - Medicina',
      esame('GLU', 'Glucosio', 10, '35,00', '10,00'),
      esame('IND', 'INDICE DI SIERO', 4),                          // sola Q.ta (componente di profilo)
      esame('6337', 'Componente prova - pannello', 21, null, '10,50'),   // Q.ta e solo Costo: NON è l'importo Privati
      ...testata(2),                                                // salto pagina dentro il blocco
      esame('ALT', 'Alanina aminotransferasi', 3, '15,00', '6,00', 4),
      sotto(38, '50,00', '26,50'),
      '',
      'Studio Prova Beta',
      esame('25990', 'Proteine Totali', 2, '1.200,50', '40,00'),
      sotto(2, '1.200,50', '40,00'),
      '',
      aDestra('Totale globale:', '40', fine.qta) + aDestra('', '1.250,50', fine.privati - fine.qta) + aDestra('', '0,00', fine.ticket - fine.privati) + aDestra('', '0,00', fine.ulss - fine.ticket) + aDestra('', '66,50', fine.costo - fine.ulss),
      aDestra('', 'Pagina 2 di 2', 140),
    ].join('\n');
    const r = Q.leggiRiepilogoEsami(testo);
    assert.deepEqual(r.periodo, { da: '2026-11-01', a: '2026-11-09' });
    assert.deepEqual(r.clienti.map((c) => [c.nome, c.qta, c.importo, c.costo, c.sottototale]), [
      ['Casa di Cura Prova Alfa S.r.l. - Medicina', 38, 50, 26.5, true], ['Studio Prova Beta', 2, 1200.5, 40, true]], 'sottototale autorevole, blocco unito dopo il salto pagina, nessun cliente "intestazione"');
    const a = r.clienti[0];
    assert.deepEqual([a.righe, a.righe_senza_importo, a.qta_righe, a.importo_righe, a.reparto], [4, 2, 38, 50, 'Medicina'], 'il Costo della riga "Q.ta e solo Costo" non è preso per Privati');
    assert.deepEqual(r.totale, { qta: 40, importo: 1250.5, ticket: 0, ulss: 0, costo: 66.5 });
    assert.deepEqual(r.controllo, { sottototali: 2, somma_qta: 40, somma_importo: 1250.5, coincide: true });
    assert.deepEqual(r.avvisi, []);
    // la riga di colonna dà le posizioni; ogni numero va nella colonna più vicina
    const col = Q.colonneIntestazione(testo.split('\n').find((l) => /Q\.ta/.test(l)));
    assert.deepEqual(Q.analizzaRiga(esame('6337', 'Componente prova', 21, null, '10,50'), col), { testo: '6337             Componente prova', qta: 21, privati: null, ticket: null, ulss: null, costo: 10.5, numeri: 2 });
    // somma dei sottototali diversa dal totale globale: segnalata nel controllo
    const r2 = Q.leggiRiepilogoEsami(testo.replace('1.250,50', '1.300,00'));
    assert.equal(r2.controllo.coincide, false); assert.ok(r2.avvisi.some((x) => /non coincide con il totale globale/.test(x)));
  });

  test('nomi: normalizzazione, reparto, nomi troncati, scelta per reparto fra più client', () => {
    assert.equal(Q.normCliente('Casa di Cura Prova Alfa S.r.l.'), Q.normCliente('CASA DI CURA PROVA ALFA SRL'));
    assert.deepEqual(Q.dividiReparto('Casa di Cura Prova Alfa S.r.l. - Medicina'), { base: 'Casa di Cura Prova Alfa S.r.l.', reparto: 'Medicina' });
    const clients = [
      { chiave: '1', legal_name: 'Casa di Cura Prova Alfa S.r.l.', sede_gestionale: 'Reparto Medicina', client_code: 'A1' },
      { chiave: '2', legal_name: 'Casa di Cura Prova Alfa S.r.l.', sede_gestionale: 'Reparto Chirurgia', client_code: 'A2' },
      { chiave: '3', legal_name: NOME_LUNGO, client_code: 'G1' },
    ];
    const m = Q.candidatiReport({ nome: 'Casa di Cura Prova Alfa S.r.l. - Medicina', ...Q.dividiReparto('Casa di Cura Prova Alfa S.r.l. - Medicina') }, clients);
    assert.deepEqual([m.candidati.map((c) => c.chiave), m.regola], [['1'], 'NOME_SENZA_REPARTO+REPARTO']);
    const t = Q.candidatiReport({ nome: NOME_LUNGO.slice(0, 45), base: NOME_LUNGO.slice(0, 45) }, clients);
    assert.deepEqual([t.candidati.map((c) => c.chiave), t.regola], [['3'], 'NOME_TRONCATO']);
    const senzaRep = Q.candidatiReport({ nome: 'Casa di Cura Prova Alfa', base: 'Casa di Cura Prova Alfa' }, clients);
    assert.equal(senzaRep.candidati.length, 2, 'senza reparto: entrambi i client (si sommano)');
  });

  test('scelta delle cause: il sottoinsieme che spiega la differenza, residuo altrimenti', () => {
    const c = [{ codice: 'STATI_ESCLUSI', effetto: 40 }, { codice: 'RIGHE_CANCELLATE', effetto: 7 }, { codice: 'SCONTO_TESTATA', effetto: 10 }];
    assert.deepEqual(Q.scegliCause(47, c), { codici: ['STATI_ESCLUSI', 'RIGHE_CANCELLATE'], spiegato: 47, residuo: 0, quadra: true });
    assert.deepEqual(Q.scegliCause(12, c).codici, ['SCONTO_TESTATA']);
    assert.equal(Q.scegliCause(12, c).residuo, 2);
    assert.deepEqual(Q.scegliCause(-3, c), { codici: [], spiegato: 0, residuo: -3, quadra: false }, 'nessuna causa che avvicini: niente');
  });

  test('statistiche del Cockpit: media per giorno lavorativo fino a ieri, proiezione, stesso giorno della settimana, sintesi delle scadenze', () => {
    assert.equal(M.giorniLavorativiTra('2026-11-01', '2026-11-30'), 21);
    const giorni = { '2026-11-02': 100, '2026-11-03': 100, '2026-11-04': 100, '2026-11-05': 100, '2026-11-06': 100, '2026-11-07': 50, '2026-11-08': 0, '2026-11-09': 100 };
    const s = M.statisticheMese({ giorni: { ...giorni, '2026-11-01': 0 }, oggi: '2026-11-10', valoreOggi: 120 });
    assert.deepEqual([s.giorni_lavorativi_fatti, s.giorni_lavorativi_mese, s.fino_a_ieri, s.media, s.proiezione, s.vs_media], [6, 21, 650, 108.33, 2275, 10.8]);
    const primo = M.statisticheMese({ giorni: {}, oggi: '2026-11-01', valoreOggi: 10 });
    assert.equal(primo.media, null); assert.match(primo.motivo, /nessun giorno lavorativo completo/);
    const incompleti = M.statisticheMese({ giorni: { '2026-11-02': null, '2026-11-03': 5 }, oggi: '2026-11-04' });
    assert.equal(incompleti.media, null, 'giorni senza dati: niente media (mai zeri finti)');
    const m = M.mediaStessoGiorno({ serie: { '2026-11-03': 10, '2026-10-27': 20, '2026-10-20': 30, '2026-10-13': 99 }, oggi: '2026-11-10', dal: '2026-10-15' });
    assert.deepEqual([m.n, m.media, m.giorno], [3, 20, 'martedì'], 'solo le settimane coperte dai dati');
    const sett = M.settimaneMonitor('2026-11-10');
    const righe = [{ id: 'a', data: '2026-11-05', stato: 'SCADUTA', gravita: 'ALTA', titolo: 'A' }, { id: 'b', data: '2026-11-12', stato: 'ENTRO_7', gravita: 'MEDIA', titolo: 'B' },
      { id: 'c', data: '2026-11-17', stato: 'ENTRO_7', gravita: 'CRITICA', titolo: 'C' }, { id: 'd', data: '2026-11-10', stato: 'OGGI', gravita: 'BASSA', titolo: 'D' }, { id: 'e', data: '2026-11-30', stato: 'ENTRO_30', gravita: 'BASSA', titolo: 'E' }];
    const x = M.sintesiScadenze(righe, sett, '2026-11-10');
    assert.deepEqual([x.questa, x.prossima, x.scadute, x.prime.map((r) => r.id)], [2, 1, 1, ['d', 'b', 'c']], 'settimana dal 9 al 15 e dal 16 al 22');
  });
});

// ------------------------------------------------------------------ parte con database
describe('v0.68.6 con database e dati sintetici', { skip: SALTA }, () => {
  const M = {};
  let db;
  const OGGI = '2026-11-10';
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const RIC = (o) => { const r = copia(ESEMPI.standardRequest); delete r.patient; return { ...r, invoiceIds: [], samples: [], headerDiscountPercent: 0, ...o, items: o.items.map((x) => ({ ...x, invoiceIds: [], sampleIds: [] })) }; };
  const riga = (id, code, netto, extra = {}) => ({ ...copia(ESEMPI.standardRequest.items[0]), id, examCode: code, description: `Esame ${code}`, netUnitPriceExcludingVat: netto, quantity: 1, deleted: false, ...extra });
  const cli = (id, o = {}) => ({ ...copia(ESEMPI.client), id, clientCode: id, legalName: `Client ${id}`, vatNumber: null, fiscalCode: null, priceListId: null, extraPriceListId: null, site: { description: null, address: null, city: null, province: null, postalCode: null, phone: null }, ...o });
  const impostaRegola = (o) => db.query(`UPDATE public.connectors SET settings = settings || $1::jsonb WHERE kind = 'STUDIOLAB'`, [JSON.stringify(o)]);
  const togliRegola = () => db.query(`UPDATE public.connectors SET settings = settings - 'stati_erogati' - 'sconto_testata' WHERE kind = 'STUDIOLAB'`);

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    for (const k of ['retail', 'business']) await tr.startFresh(k, null);
    M.pers = await import('../src/lib/synclab/persistenza.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    // Società di prova con un punto (Laboratorio in sede) e clienti Service inventati
    const td = await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('SOCIETA', 'TDV686', 'Società Prova TD') RETURNING id`);
    await db.query(`INSERT INTO public.app_settings (key, value) VALUES ('company_org_id', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(td.id)]);
    M.sede = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ('PP-686', 'Punto Prova Sei', 'PUNTO_PRELIEVI', 'Firenze', 'FI', $1, 'S686') RETURNING id`, [td.id])).id;
    M.org = {};
    for (const [k, nome, cod] of [['A', 'Casa di Cura Prova Alfa S.r.l.', 'A-MED'], ['B', 'Studio Prova Beta', 'B1'], ['D', 'Centro Prova Delta', 'D1'], ['F', 'Laboratorio Prova Effe', 'F1']]) {
      M.org[k] = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', $1, $2) RETURNING id`, [`SER-686${k}`, nome])).id;
      await db.query(`INSERT INTO public.sites (code, name, kind, city, province, organization_id, studiolab_code) VALUES ($1, $2, 'SERVICE', 'Lucca', 'LU', $3, $4)`, [`SRV-686${k}`, `${nome} (service)`, M.org[k], cod]);
      await db.query(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, data_avvio_effettiva, attivo_dal) VALUES ($1, 'SRV', FALSE, TRUE, 7, 500000, '2025-01-01', '2025-01-01')`, [M.org[k]]);
    }
    const site = (o) => ({ description: null, address: null, city: null, province: null, postalCode: null, phone: null, ...o });
    await importa('clients', [
      cli('A-MED', { legalName: 'CASA DI CURA PROVA ALFA SRL', site: site({ description: 'Reparto Medicina' }) }),
      cli('A-CHI', { legalName: 'CASA DI CURA PROVA ALFA SRL', site: site({ description: 'Reparto Chirurgia' }) }),
      cli('B1', { legalName: 'Studio Prova Beta' }), cli('G1', { legalName: NOME_LUNGO }), cli('D1', { legalName: 'Centro Prova Delta' }),
      cli('F1', { legalName: 'Laboratorio Prova Effe' }), cli('S686', { legalName: 'Società Prova TD', site: site({ description: 'Punto Prova Sei' }) }),
    ]);
    await importa('exams', [copia(ESEMPI.exam)]);
    let n = 0;
    const r = (clientId, date, state, items, extra = {}) => RIC({ id: `RA${++n}`, requestNumber: `2026/A${n}`, date, clientId, state, createdAtLocal: `${date}T08:00:00`, demographics: { ageYears: 40, sex: 'F', city: 'Lucca', province: 'LU' }, items, ...extra });
    await importa('requests', [
      // Alfa Medicina: 2 glucosi (uno chiuso, uno prenotato = stato 10) + componente senza prezzo; Alfa Chirurgia: ALT con sconto di testata 10%
      r('A-MED', '2026-11-03', 50, [riga('a1', 'GLU', 10), riga('a2', 'IND', null)]),
      r('A-MED', '2026-11-04', 10, [riga('a3', 'GLU', 10)]),
      r('A-CHI', '2026-11-05', 40, [riga('c1', 'ALT', 30)], { headerDiscountPercent: 10 }),
      // Beta: un glucosio in attende prelievo (30) e uno in prelievo eseguito (18)
      r('B1', '2026-11-06', 30, [riga('b1', 'GLU', 10)]), r('B1', '2026-11-06', 18, [riga('b2', 'GLU', 10)]),
      // Gamma (nome lungo, troncato nel report); NC mai arrivato (11): mai nella produzione
      r('G1', '2026-11-02', 20, [riga('g1', '25990', 50)]), r('G1', '2026-11-02', 11, [riga('g2', '25990', 50)]),
      // Delta: una riga cancellata (AZO 8) che il report conta e 5 € che nessuna causa spiega
      r('D1', '2026-11-07', 50, [riga('d1', 'GLU', 10), riga('d2', 'AZO', 8, { deleted: true })]),
      // Effe: produzione nella Suite, assente dal report; punto TD (Laboratorio in sede) oggi
      r('F1', '2026-11-08', 50, [riga('f1', 'GLU', 15)]), r('S686', OGGI, 50, [riga('s1', 'GLU', 7)]), r('F1', OGGI, 25, [riga('f2', 'GLU', 15), riga('f3', 'IND', null)]),
      // mese precedente (statistiche del Cockpit)
      r('B1', '2026-10-01', 50, [riga('o1', 'GLU', 12)]),
    ]);
    // checkpoint della copia delle accettazioni: 9/11 alle 10:00, prima della fine del periodo del report
    await db.query(`INSERT INTO synclab.sync_scope (instance_id, client_name, dataset, filtri_canonici, include_patient, checkpoint_at) VALUES ('ISTANZA-DIMOSTRATIVA', 'TDSuite', 'requests', '{}', FALSE, '2026-11-09T09:00:00Z')`).catch(() => {});
    const { allineaAbbinamenti } = await import('../src/lib/synclab/abbinamenti.js');
    await allineaAbbinamenti({ scrivi: true, origine: 'test' });
    // GIPO: due vendite del mese e una del mese prima
    const c1 = await uno(`INSERT INTO retail.customers (kind, last_name, first_name, city, province) VALUES ('B2C', 'Prova', 'Uno', 'Firenze', 'FI') RETURNING id`);
    const v = (ref, data, net) => db.query(`INSERT INTO retail.sales (source, external_ref, sale_date, customer_id, site_id, product_code, quantity, net_amount) VALUES ('GIPO', $1, $2, $3, $4, 'PRE01', 1, $5)`, [ref, data, c1.id, M.sede, net]);
    await v('G1', OGGI, 40); await v('G2', '2026-11-03', 60); await v('G3', '2026-10-03', 30);
    M.L = await import('../src/lib/synclab/letture.js');
    M.Q = await import('../src/lib/synclab/quadratura.js');
    M.mon = await import('../src/lib/cockpitMonitor.js');
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('A · accettato vs erogati, sconto di testata sì/no, righe a prezzo nullo contate negli esami', async () => {
    await togliRegola();
    assert.deepEqual(await M.L.statiErogati(), [10, 15, 18, 20, 25, 30, 40, 50], 'predefinito dalla funzione SQL: accettato');
    assert.equal(await M.L.scontoTestata(), 'NON_APPLICARE');
    const da = '2026-11-01', a = '2026-11-09';
    const acc = await M.L.produzioneErogata({ da, a });
    // accettato, importi di riga: 10 + 10 + 30 + 10 + 10 + 50 + 10 + 15 = 145 (la 11 esclusa, la riga cancellata fuori)
    assert.equal(acc.totale.valore, 145); assert.equal(acc.totale.accettazioni, 8);
    assert.equal(acc.totale.esami, 9, 'righe non cancellate comprese quelle senza prezzo'); assert.equal(acc.totale.righe_senza_prezzo, 1);
    assert.equal(acc.totale.sconto_testata, 3, 'di cui sconti di testata (non applicati)'); assert.equal(acc.sconto, 'NON_APPLICARE');
    const sc = await M.L.produzioneErogata({ da, a, sconto: 'APPLICA' });
    assert.equal(sc.totale.valore, 142, 'sconto di testata applicato');
    const ero = await M.L.produzioneErogata({ da, a, stati: M.L.STATI_EROGATI_STORICI });
    assert.equal(ero.totale.valore, 125, 'erogati: senza la prenotata (10) e l\'attende prelievo (30)');
    // dall'impostazione del connettore
    await impostaRegola({ sconto_testata: 'APPLICA' });
    assert.equal((await M.L.produzioneErogata({ da, a })).totale.valore, 142);
    assert.match(M.L.fonteProduzione(await M.L.statiErogati(), null, await M.L.scontoTestata()), /netto di riga e sconto di testata/);
    await togliRegola();
    const [d] = await M.dbm.many(`SELECT synclab.sconto_testata_applicato() AS a`); assert.equal(d.a, false);
  });

  test('A · migrazione 056: il predefinito passa all\'accettato solo se il valore salvato è ancora il vecchio predefinito', async () => {
    const sql = fs.readFileSync(path.join(here, '../src/migrations/056_produzione_accettata.sql'), 'utf8');
    const salvato = async () => (await uno(`SELECT settings->'stati_erogati' AS s FROM public.connectors WHERE kind = 'STUDIOLAB'`)).s;
    await impostaRegola({ stati_erogati: [50, 40, 25, 20, 18, 18] });
    await db.query(sql);
    assert.deepEqual(await salvato(), [10, 15, 18, 20, 25, 30, 40, 50], 'vecchio predefinito (in qualunque ordine) → nuovo');
    await impostaRegola({ stati_erogati: [18, 20] });
    await db.query(sql); await db.query(sql);
    assert.deepEqual(await salvato(), [18, 20], 'scelta diversa: non si tocca (idempotente)');
    const rap = await uno(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'MIGRAZIONE_RAPPORTO' AND entity_id = '056_produzione_accettata.sql'`);
    assert.equal(rap.n, 1, 'rapporto scritto una volta');
    await togliRegola();
  });

  test('B · quadratura con il report sintetico: varianti, abbinamento dei nomi, cause attribuite, XLSX', async () => {
    const report = M.Q.leggiRiepilogoEsami(REPORT);
    const base = await M.L.quadratura({ da: report.periodo.da, a: report.periodo.a });
    assert.equal(base.variante.etichetta, 'Impostazione in vigore');
    const q = M.Q.confrontaQuadratura(report, base);
    const V = Object.fromEntries(q.varianti.map((v) => [v.chiave, v]));
    assert.deepEqual([V.ACCETTATO_RIGA.importo, V.ACCETTATO_SCONTO.importo, V.EROGATI_RIGA.importo, V.EROGATI_SCONTO.importo], [145, 142, 125, 122]);
    assert.equal(V.ACCETTATO_RIGA.in_vigore, true); assert.equal(V.ACCETTATO_RIGA.migliore, true);
    assert.equal(q.variante.chiave, 'ACCETTATO_RIGA', 'nessuna coincide: si usa quella in vigore');
    const per = (nome) => q.righe.find((r) => (r.report?.nomi || []).includes(nome));
    const alfaMed = per('Casa di Cura Prova Alfa S.r.l. - Medicina');
    assert.deepEqual([alfaMed.esito, alfaMed.clienti.map((c) => c.client_code), alfaMed.suite.quantita, alfaMed.suite.importo, alfaMed.suite.righe_senza_prezzo], ['QUADRA', ['A-MED'], 3, 20, 1], 'reparto → client del reparto; la riga senza prezzo conta nella Q.ta');
    assert.equal(per('Casa di Cura Prova Alfa S.r.l. - Chirurgia').esito, 'QUADRA');
    assert.equal(per('Studio Prova Beta').esito, 'QUADRA');
    const gamma = per(NOME_LUNGO.slice(0, 45).trim());
    assert.deepEqual([gamma.esito, gamma.clienti[0].client_code, gamma.regola], ['QUADRA', 'G1', 'NOME_TRONCATO']);
    const delta = per('Centro Prova Delta');
    assert.equal(delta.esito, 'NON_SPIEGATA');
    assert.deepEqual([delta.differenza.importo, delta.residuo], [13, 5]);
    assert.ok(delta.cause.find((c) => c.codice === 'RIGHE_CANCELLATE' && c.spiega && c.effetto === 8), 'la riga cancellata spiega 8 €');
    assert.ok(delta.cause.find((c) => c.codice === 'DOPO_COPIA'), 'copia del 9/11 alle 10: possibili accettazioni arrivate dopo');
    assert.ok(delta.cause.find((c) => c.codice === 'RESIDUO' && c.effetto === 5));
    const ignoto = per('Cliente Sconosciuto Prova');
    assert.deepEqual([ignoto.esito, ignoto.cause[0].codice], ['SOLO_REPORT', 'CLIENT_NON_TROVATO']);
    const effe = q.righe.find((r) => r.esito === 'SOLO_SUITE' && r.clienti[0].client_code === 'F1');
    assert.equal(effe.suite.importo, 15, 'produzione nella Suite assente dal report');
    // variante "erogati": Alfa Medicina e Beta spiegate dagli stati esclusi
    const qe = M.Q.confrontaQuadratura(report, base, { variante: 'EROGATI_RIGA' });
    const am = qe.righe.find((r) => (r.report?.nomi || []).includes('Casa di Cura Prova Alfa S.r.l. - Medicina'));
    assert.equal(am.esito, 'SPIEGATA');
    assert.ok(am.cause.find((c) => c.codice === 'STATI_ESCLUSI' && c.spiega && c.effetto === 10 && /10 prenotata: 1/.test(c.testo)));
    // variante con lo sconto di testata applicato: Alfa Chirurgia spiegata dallo sconto
    const qs = M.Q.confrontaQuadratura(report, base, { variante: 'ACCETTATO_SCONTO' });
    const ac = qs.righe.find((r) => (r.report?.nomi || []).includes('Casa di Cura Prova Alfa S.r.l. - Chirurgia'));
    assert.deepEqual([ac.esito, ac.cause.find((c) => c.spiega)?.codice], ['SPIEGATA', 'SCONTO_TESTATA']);
    // totali a mano uguali alla variante accettato: coincide ed è quella scelta
    const man = M.Q.reportManuale({ da: '2026-11-01', a: '2026-11-09', qta: 10, importo: 145 });
    const qm = M.Q.confrontaQuadratura(man, base);
    assert.deepEqual(qm.varianti.filter((v) => v.coincide).map((v) => v.chiave), ['ACCETTATO_RIGA']);
    assert.equal(qm.variante.chiave, 'ACCETTATO_RIGA');
    // XLSX
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await M.Q.xlsxQuadratura(q));
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Varianti', 'Per cliente', 'Cause sul totale', 'Note']);
    const testi = []; wb.getWorksheet('Per cliente').eachRow((r) => testi.push(r.values.slice(1).join('|')));
    assert.ok(testi.some((t) => t.startsWith('differenza non spiegata|Centro Prova Delta|D1 Centro Prova Delta')), testi.join('\n'));
  });

  test('B · il PDF del report si legge con pdftotext (se presente sul server)', async (t) => {
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { t.skip('pdftotext non disponibile'); return; }
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const parti = []; doc.on('data', (b) => parti.push(b));
    const fine = new Promise((res) => doc.on('end', res));
    doc.font('Courier').fontSize(7.5);
    REPORT.split('\n').forEach((l, i) => doc.text(l.replace(/à/g, 'a'), 20, 20 + i * 10, { lineBreak: false }));
    doc.end(); await fine;
    const { estraiTesto } = await import('../src/lib/pdftext.js');
    const tx = await estraiTesto(Buffer.concat(parti));
    const r = M.Q.leggiRiepilogoEsami(tx.pagine.join('\n'));
    assert.deepEqual(r.periodo, { da: '2026-11-01', a: '2026-11-09' });
    assert.equal(r.totale.importo, 155); assert.equal(r.clienti.length, 6);
  });

  test('C · Cockpit: KPI con statistiche, grafici (giornaliero, 12 mesi, TOP 5, ripartizione), operatività e sintesi delle scadenze', async () => {
    await togliRegola();
    M.mon.svuotaCacheMonitor();
    const d = await M.mon.calcolaMonitor({ oggi: OGGI });
    const S = d.schermo;
    assert.ok(S && !S.errore, S?.errore);
    const K = Object.fromEntries(S.kpi.map((x) => [x.chiave, x]));
    assert.deepEqual(Object.keys(K), ['ricavi_oggi', 'ricavi_mese', 'lab_oggi', 'lab_mese']);
    // laboratorio oggi: punto TD 7 + Effe 15 (riga senza prezzo contata negli esami); ricavi = GIPO 40 + 22
    assert.equal(K.lab_oggi.valore, 22); assert.deepEqual(K.lab_oggi.parti.map((p) => p.valore), [15, 7]);
    assert.equal(K.ricavi_oggi.valore, 62);
    assert.equal(K.lab_mese.valore, 167, '145 fino al 9 + 22 di oggi');
    assert.equal(K.ricavi_mese.valore, 167 + 100);
    for (const k of Object.values(K)) { assert.ok(k.statistiche.length >= 1, `${k.chiave}: almeno una statistica`); assert.ok(k.fonte, `${k.chiave}: fonte`); }
    const proj = K.lab_mese.statistiche.find((s) => s.etichetta === 'proiezione a fine mese');
    assert.equal(proj.valore, Math.round((145 / 6) * 21 * 100) / 100, 'media dei 6 giorni lavorativi completi (145 €) × 21 giorni lavorativi del mese');
    const mp = K.lab_mese.statistiche.find((s) => s.etichetta === 'vs mese precedente allo stesso giorno');
    assert.equal(mp.valore, Math.round(((167 - 12) / 12) * 1000) / 10);
    assert.equal(K.lab_oggi.confronto, null, 'anno prima prima della copia: nessun confronto con zeri finti');
    assert.match(K.lab_mese.fonte, /produzione accettata \(stati 10, 15, 18, 20, 25, 30, 40, 50\), importi di riga/);
    // grafici
    const G = S.grafici;
    assert.equal(G.giornaliero.giorni.length, 10); assert.equal(G.giornaliero.prec.length, 30);
    assert.deepEqual(G.giornaliero.giorni.at(-1), { giorno: OGGI, b2b: 15, sede: 7, lab: 22, b2c: 40, esami: 3 });
    assert.equal(G.giornaliero.prec.find((p) => p.giorno === 1).valore, 12);
    assert.equal(G.mensile.mesi.length, 12); assert.equal(G.mensile.mesi[0].lab, null, 'mesi prima del primo dato importato: n.d.');
    assert.equal(G.mensile.mesi.at(-1).lab, 167);
    assert.ok(G.top5.righe.length >= 3);
    assert.deepEqual(G.ripartizione.parti.map((p) => p.chiave), ['B2B', 'LAB_SEDE', 'B2C']);
    assert.equal(G.ripartizione.totale, 267);
    assert.match(G.ripartizione.nota || '', /Possibile doppio conteggio/, 'GIPO vende nelle sedi con Laboratorio in sede: dichiarato, niente tolto');
    // operatività: ogni tessera ha un numero e una statistica (o "non disponibile" con il motivo)
    const T = Object.fromEntries(S.operativita.map((x) => [x.chiave, x]));
    // v0.71.0: "Esami del mese", "Quota fuori area" e "Clienti Service con produzione" lasciano il posto alle tessere di Lab Control
    for (const k of ['op_acc_oggi', 'op_lab_lavorazione', 'op_lab_ritardo', 'op_lab_tat', 'op_scontrino', 'op_prima_disp', 'op_nc', 'op_ordini', 'op_ferie', 'op_clienti_ritardo']) {
      assert.ok(T[k], `tessera ${k}`);
      assert.ok(T[k].non_disponibile ? T[k].motivo : T[k].statistiche.length >= 1, `${k}: statistica o motivo`);
    }
    assert.equal(S.operativita.length, 10, 'dieci tessere (5 × 2)');
    assert.ok(!T.op_esami_mese && !T.op_fuori_area && !T.op_clienti_prod);
    assert.equal(typeof T.op_lab_lavorazione.valore, 'number'); assert.match(T.op_lab_ritardo.titolo, /oltre 72 ore/);
    assert.equal(T.op_scontrino.statistiche[0].valore, Math.round(((50 - 30) / 30) * 1000) / 10, 'scontrino medio vs mese prima');
    // scadenze: una fascia per utente
    const u = await M.mon.monitorPerUtente({ level: 'OWNER', grants: {} }, { oggi: OGGI, fresco: true });
    const ss = u.schermo.scadenze_sintesi;
    assert.ok(ss && typeof ss.questa === 'number' && typeof ss.prossima === 'number' && typeof ss.scadute === 'number' && Array.isArray(ss.prime) && ss.prime.length <= 3);
    assert.equal(u.schermo.versione, (await import('../src/version.js')).APP_VERSION);
  });
});
