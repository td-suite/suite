// v0.68.5 (richieste del CEO del 10/11/2026): A) PRODUZIONE EROGATA come grandezza principale (stati erogati, sconto di testata applicato
// una volta, prezzi null contati a parte, per giorno/mese/cliente/sede, anno prima, top clienti) nel Cockpit, nel Business Hub (maturato) e
// nelle letture; aggiornamento di giorno (regola pura); B) listini del gestionale in XLSX (per cliente e aggregato con riepilogo e listini
// non associati); C) abbinamento automatico client Synclab ↔ Legal entity e SEDE (univoco, ambiguo, per sede, codice scritto nella sede).
// Dati solo sintetici (forma degli esempi di CB Sistemi, test/helpers/fakeSynclab.mjs); nessun nome reale né dato di pazienti.
// Parte pura sempre; parte con database (DATABASE_URL_TEST, database temporaneo suite_v685_<pid>) solo se la variabile c'è.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { ESEMPI } from './helpers/fakeSynclab.mjs';

const URL_TEST = process.env.DATABASE_URL_TEST || '';
const SALTA = URL_TEST ? false : 'DATABASE_URL_TEST mancante: test con database saltati';
// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite".
const nomeDb = `suite_v685_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const dbUrl = () => { const m = URL_TEST.match(/^(postgres(?:ql)?:\/\/[^/]*\/)([^?]*)(.*)$/); return `${m[1]}${nomeDb}${m[3]}`; };
process.env.DATABASE_URL = URL_TEST ? dbUrl() : 'postgres://nessuno@127.0.0.1:1/nessun_database';
const copia = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ parte pura
describe('v0.68.5 · regole pure', () => {
  let L, A, Y, LI;
  before(async () => {
    L = await import('../src/lib/synclab/letture.js');
    A = await import('../src/lib/synclab/abbinamenti.js');
    Y = await import('../src/lib/synclab/sync.js');
    LI = await import('../src/lib/synclab/listini.js');
  });

  test('stati erogati: predefiniti 18, 20, 25, 40, 50; normalizzazione; fonte dichiarata con stati, netto e ora della copia', () => {
    assert.deepEqual(L.STATI_EROGATI_PREDEFINITI, [18, 20, 25, 40, 50]);
    assert.deepEqual(L.normalizzaStati('50, 18;20 x 18'), [18, 20, 50]);
    assert.deepEqual(L.normalizzaStati([]), [18, 20, 25, 40, 50], 'vuoto = predefiniti');
    for (const s of [10, 11, 15, 30]) assert.ok(!L.STATI_EROGATI_PREDEFINITI.includes(s), `${s} escluso`);
    assert.equal(L.LEGENDA_STATI[18], 'prelievo eseguito'); assert.equal(L.LEGENDA_STATI[30], 'attende prelievo');
    const f = L.fonteProduzione([18, 20, 25, 40, 50], '2026-11-10T13:05:00Z');
    assert.equal(f, 'Synclab, accettazioni erogate (stati 18, 20, 25, 40, 50), netto di riga e sconto di testata, copia al 10/11/2026 · aggiornato alle 14:05');
    assert.equal(L.aggiornatoAlle('2026-11-10T13:05:00Z', '2026-11-10'), 'aggiornato alle 14:05');
    assert.equal(L.aggiornatoAlle('2026-11-09T13:05:00Z', '2026-11-10'), 'aggiornato al 09/11/2026 14:05');
    assert.match(L.descriviStati([18, 50]), /18 prelievo eseguito, 50 chiuso/);
  });

  test('aggiornamento di giorno: solo con la Data API accesa, fra le 7 e le 21, ogni N minuti, un ciclo alla volta, 0 = spento', () => {
    const imp = { data_api_enabled: true, sync_intraday_minuti: 60 };
    const ora = new Date('2026-11-10T10:00:00Z');
    assert.equal(Y.intradayDaEseguire({ imp, ora: '11:00', adesso: ora }).esegui, true);
    assert.match(Y.intradayDaEseguire({ imp: { ...imp, data_api_enabled: false }, ora: '11:00', adesso: ora }).motivo, /non abilitata/);
    assert.match(Y.intradayDaEseguire({ imp: { ...imp, sync_intraday_minuti: 0 }, ora: '11:00', adesso: ora }).motivo, /spento/);
    assert.match(Y.intradayDaEseguire({ imp, ora: '06:59', adesso: ora }).motivo, /fuori dalla fascia/);
    assert.match(Y.intradayDaEseguire({ imp, ora: '21:00', adesso: ora }).motivo, /fuori dalla fascia/);
    assert.match(Y.intradayDaEseguire({ imp, ora: '11:00', adesso: ora, inCorso: { dataset: 'requests' } }).motivo, /già in corso/);
    assert.equal(Y.intradayDaEseguire({ imp, ora: '11:00', adesso: ora, stato: { at: '2026-11-10T09:30:00Z' } }).esegui, false, '30 minuti fa: aspetta');
    assert.equal(Y.intradayDaEseguire({ imp, ora: '11:00', adesso: ora, stato: { at: '2026-11-10T08:59:00Z' } }).esegui, true, '61 minuti fa: riparte');
    assert.equal(Y.IMPOSTAZIONI_PREDEFINITE.sync_intraday_minuti, 60);
    assert.deepEqual(Y.IMPOSTAZIONI_PREDEFINITE.stati_erogati, [18, 20, 25, 40, 50]);
  });

  test('abbinamento: nomi e indirizzi normalizzati, sede scelta per indirizzo, comune o nome; ambiguo con due Legal entity', () => {
    assert.equal(A.normNome('Studio Medico Prova S.r.l.'), A.normNome('STUDIO MEDICO PROVA SRL'));
    assert.equal(A.normIndirizzo('V.le Italia, 5'), A.normIndirizzo('Viale Italia 5'));
    assert.equal(A.normFiscale('IT 01234567890'), '01234567890'); assert.equal(A.normFiscale('00000000000'), null);
    const sedi = [{ id: 1, name: 'Casa di cura Alfa', city: 'Lucca', address: 'Via dei Pini 3', kind: 'SERVICE', active: true, organization_id: 9 },
      { id: 2, name: 'Casa di cura Beta', city: 'Pisa', address: 'Via del Mare 8', kind: 'SERVICE', active: true, organization_id: 9 }];
    assert.equal(A.scegliSede({ site_address: 'Via del Mare, 8' }, sedi).site.id, 2);
    assert.equal(A.scegliSede({ site_city: 'LUCCA' }, sedi).site.id, 1);
    assert.equal(A.scegliSede({ site_description: 'Struttura Casa di cura Beta' }, sedi).site.id, 2);
    assert.equal(A.scegliSede({ site_city: 'Siena' }, sedi).site, null, 'nessun indizio: sede da scegliere');
    const ctx = { orgs: [{ id: 9, kind: 'CLIENTE', name: 'Gruppo Prova Kappa', vat_number: '22222222222', active: true }, { id: 10, kind: 'CLIENTE', name: 'Doppio Uno', vat_number: '33333333333', active: true },
      { id: 11, kind: 'CLIENTE', name: 'Doppio Due', vat_number: '33333333333', active: true }], sites: sedi, tdOrgId: null };
    const k = A.decidiClient({ client_code: 'K2', vat_number: '22222222222', site_city: 'Pisa' }, ctx);
    assert.deepEqual([k.esito, k.regola, k.org.id, k.site.id], ['ABBINA', 'PARTITA_IVA', 9, 2]);
    const d = A.decidiClient({ client_code: 'D', vat_number: '33333333333' }, ctx);
    assert.deepEqual([d.esito, d.candidati.length], ['AMBIGUO', 2]);
    assert.equal(A.decidiClient({ client_code: 'Z', legal_name: 'Ignoto' }, ctx).esito, 'NESSUNO');
  });

  test('listini: valori esatti per Excel e confronto con il listino del Business Hub', () => {
    assert.equal(LI.esatto('12.50'), 12.5); assert.equal(LI.esatto('20.12345'), 20.12345);
    assert.equal(LI.esatto('12345678901234567.89'), '12345678901234567.89', 'oltre il double: testo esatto');
    const hub = new Map([['GLU', { prezzo: 10 }], ['ALT', { prezzo: 18 }], ['SOLOHUB', { prezzo: 5 }]]);
    const k = LI.confrontoConHub([{ exam_code: 'GLU', netto: '10' }, { exam_code: 'ALT', netto: '20.12345' }, { exam_code: 'NEW', netto: '3' }], hub);
    assert.deepEqual([k.diverse, k.uguali, k.solo_synclab, k.solo_hub], [1, 1, 1, 1]);
    assert.equal(k.righe[0].codice, 'ALT'); assert.equal(k.righe[0].differenza, 2.12345);
  });
});

// ------------------------------------------------------------------ parte con database
describe('v0.68.5 con database e dati sintetici', { skip: SALTA }, () => {
  const M = {};
  let db;
  const OGGI = '2026-11-10';
  const adm = async (sql) => { const c = new pg.Client({ connectionString: URL_TEST }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
  const uno = async (sql, p) => (await db.query(sql, p)).rows[0];
  const importa = async (dataset, righe) => M.dbm.tx(async (c) => { for (const d of righe) await M.pers.upsertAggregato(c, { instanceId: 'ISTANZA-DIMOSTRATIVA', dataset, d }); });
  const RIC = (o) => { const r = copia(ESEMPI.standardRequest); delete r.patient; return { ...r, invoiceIds: [], samples: [], headerDiscountPercent: 0, ...o, items: o.items.map((x) => ({ ...x, invoiceIds: [], sampleIds: [] })) }; };
  const riga = (id, code, netto, extra = {}) => ({ ...copia(ESEMPI.standardRequest.items[0]), id, examCode: code, description: `Esame ${code}`, netUnitPriceExcludingVat: netto, quantity: 1, deleted: false, ...extra });
  const cli = (id, o = {}) => ({ ...copia(ESEMPI.client), id, clientCode: id, legalName: `Client ${id}`, vatNumber: null, fiscalCode: null, priceListId: null, extraPriceListId: null, site: { description: null, address: null, city: null, province: null, postalCode: null, phone: null }, ...o });

  before(async () => {
    await adm(`CREATE DATABASE ${nomeDb}`);
    assert.equal(process.env.DATABASE_URL, dbUrl(), 'database di prova');
    M.dbm = await import('../src/db.js');
    assert.equal((await M.dbm.one('SELECT current_database() AS d')).d, nomeDb, 'mai il database della Suite');
    const { migrate } = await import('../src/migrate.js');
    await migrate();
    const tr = await import('../src/lib/travaso.js');
    for (const k of ['business']) await tr.startFresh(k, null);
    M.pers = await import('../src/lib/synclab/persistenza.js');
    db = new pg.Client({ connectionString: dbUrl() }); await db.connect();
    // Toscana Diagnostica di prova con due punti (senza codice StudioLAB), un gruppo cliente con due sedi SERVICE, due Legal entity con la
    // stessa partita IVA (ambiguo), un cliente riconoscibile dal codice e uno dal nome e comune
    const td = await uno(`INSERT INTO public.organizations (kind, code, name, vat_number) VALUES ('SOCIETA', 'TDV685', 'Società Prova TD', '11111111111') RETURNING id`);
    await db.query(`INSERT INTO public.app_settings (key, value) VALUES ('company_org_id', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(td.id)]);
    M.td = td.id;
    M.ppA = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, address, organization_id) VALUES ('PP-NORD', 'Punto Prova Nord', 'PUNTO_PRELIEVI', 'Firenze', 'FI', 'Via Roma 1', $1) RETURNING id`, [td.id])).id;
    M.ppB = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, address, organization_id) VALUES ('PP-SUD', 'Punto Prova Sud', 'PUNTO_PRELIEVI', 'Prato', 'PO', 'Viale Italia 5', $1) RETURNING id`, [td.id])).id;
    M.kappa = (await uno(`INSERT INTO public.organizations (kind, code, name, vat_number, city) VALUES ('CLIENTE', 'SER0701', 'Gruppo Prova Kappa', '22222222222', 'Lucca') RETURNING id`)).id;
    M.kA = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, address, organization_id) VALUES ('SRV-KA', 'Casa di cura Alfa', 'SERVICE', 'Lucca', 'LU', 'Via dei Pini 3', $1) RETURNING id`, [M.kappa])).id;
    M.kB = (await uno(`INSERT INTO public.sites (code, name, kind, city, province, address, organization_id) VALUES ('SRV-KB', 'Casa di cura Beta', 'SERVICE', 'Pisa', 'PI', 'Via del Mare 8', $1) RETURNING id`, [M.kappa])).id;
    M.d1 = (await uno(`INSERT INTO public.organizations (kind, code, name, vat_number) VALUES ('CLIENTE', 'SER0702', 'Doppio Uno', '33333333333') RETURNING id`)).id;
    M.d2 = (await uno(`INSERT INTO public.organizations (kind, code, name, vat_number) VALUES ('CLIENTE', 'SER0703', 'Doppio Due', '33333333333') RETURNING id`)).id;
    M.cod = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', 'SER0099', 'Cliente Codice Prova') RETURNING id`)).id;
    M.codSede = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id) VALUES ('SRV-COD', 'Cliente Codice Prova (service)', 'SERVICE', 'Empoli', $1) RETURNING id`, [M.cod])).id;
    M.nome = (await uno(`INSERT INTO public.organizations (kind, code, name, city) VALUES ('CLIENTE', 'SER0704', 'Studio Medico Prova S.r.l.', 'Prato') RETURNING id`)).id;
    M.nomeSede = (await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id, studiolab_code) VALUES ('SRV-NOM', 'Studio Medico Prova (service)', 'SERVICE', 'Prato', $1, 'GIA-99') RETURNING id`, [M.nome])).id;
    // account attivi (perimetro B2B calcolato) per Kappa e per il cliente col codice
    for (const o of [M.kappa, M.cod]) await db.query(`INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, data_avvio_effettiva, attivo_dal) VALUES ($1, 'SRV', FALSE, TRUE, 7, 100000, '2025-01-01', '2025-01-01')`, [o]);
    M.accKappa = (await uno('SELECT id FROM business.accounts WHERE organization_id=$1', [M.kappa])).id;
    await db.query(`INSERT INTO business.listini (account_id, versione, filename, mapping, righe, riepilogo) VALUES ($1, 1, 'listino.xlsx', '{}', $2, '{}')`,
      [M.accKappa, JSON.stringify([{ codice: 'GLU', descrizione: 'Glucosio', listino: 12, offerto: 10 }, { codice: 'ALT', descrizione: 'Esame ALT', offerto: 18 }])]);
    // copia Synclab: client, esami, listini
    const site = (o) => ({ description: null, address: null, city: null, province: null, postalCode: null, phone: null, ...o });
    await importa('clients', [
      cli('TD-1', { vatNumber: '11111111111', legalName: 'Società Prova TD', site: site({ description: 'Punto prelievi Nord', address: 'Via Roma, 1', city: 'Firenze' }) }),
      cli('TD-2', { vatNumber: '11111111111', legalName: 'Società Prova TD', site: site({ address: 'V.le Italia 5', city: 'Prato' }) }),
      cli('K1', { vatNumber: '22222222222', legalName: 'Gruppo Prova Kappa', priceListId: 'LK', site: site({ city: 'Lucca', address: 'Via dei Pini 3' }) }),
      cli('K2', { vatNumber: '22222222222', legalName: 'Gruppo Prova Kappa', site: site({ city: 'Pisa' }) }),
      cli('D', { vatNumber: '33333333333' }),
      cli('SER0099', { vatNumber: '00000000000' }),
      cli('NOME-1', { legalName: 'STUDIO MEDICO PROVA SRL', city: 'Prato' }),
      cli('IGNOTO', { legalName: 'Nessuno Prova' }),
    ]);
    await importa('exams', [copia(ESEMPI.exam)]);
    const pl = (id, code, items) => ({ ...copia(ESEMPI.priceList), id, code, description: `Listino ${code}`, items });
    const pli = (id, code, gross, disc, net) => ({ ...copia(ESEMPI.priceList.items[0]), id, examCode: code, description: `Esame ${code}`, grossUnitPriceExcludingVat: gross, discountPercent: disc, netUnitPriceExcludingVat: net });
    await importa('price-lists', [pl('LK', 'LK', [pli('LK1', 'GLU', 12.5, 20, 10), pli('LK2', 'ALT', 25, null, 20.12345)]), pl('ORF', 'ORF', [pli('O1', 'GLU', 9, null, 9)])]);
    // accettazioni: stati erogati e non, sconto di testata, riga senza prezzo, riga cancellata, anno prima
    let n = 0;
    const r = (clientId, date, state, items, extra = {}) => RIC({ id: `RQ${++n}`, requestNumber: `2026/Q${n}`, date, clientId, state, createdAtLocal: `${date}T08:00:00`, demographics: { ageYears: 40, sex: 'F', city: 'Lucca', province: 'LU' }, items, ...extra });
    await importa('requests', [
      r('K1', '2026-11-02', 50, [riga('a1', 'GLU', 10), riga('a2', 'ALT', 20)], { headerDiscountPercent: 10 }),   // (10 + 20) × 0,9 = 27
      r('K1', '2026-11-05', 18, [riga('b1', 'GLU', 10), riga('b2', 'ALT', null)]),                                 // 10 + 1 senza prezzo
      r('K1', '2026-11-06', 10, [riga('c1', 'GLU', 10)]),                                                          // prenotata: esclusa
      r('K1', '2026-11-06', 30, [riga('d1', 'GLU', 10)]),                                                          // attende prelievo: esclusa
      r('K2', OGGI, 40, [riga('e1', 'GLU', 12.5), riga('e2', 'AZO', 99, { deleted: true })]),                       // 12,5 (riga cancellata fuori)
      r('K2', '2025-11-05', 50, [riga('f1', 'GLU', 8)]),                                                           // anno prima: 8
      r('TD-1', OGGI, 50, [riga('g1', 'GLU', 10)]),                                                                // Laboratorio in sede
      r('SER0099', '2026-11-03', 25, [riga('h1', 'GLU', 5)]),                                                      // in firma: 5
    ]);
    M.L = await import('../src/lib/synclab/letture.js');
    M.A = await import('../src/lib/synclab/abbinamenti.js');
    M.LI = await import('../src/lib/synclab/listini.js');
    M.S = await import('../src/modules/business/lib/synclabAccount.js');
    M.mon = await import('../src/lib/cockpitMonitor.js');
    M.diag = await import('../src/lib/diagnostica.js');
  }, { timeout: 180000 });
  after(async () => {
    await db?.end().catch(() => {});
    await M.dbm?.pool.end().catch(() => {});
    await adm(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`).catch((e) => console.warn(`database ${nomeDb} non eliminato: ${e.message}`));
  });

  test('C · allineamento automatico: univoco per partita IVA, codice, nome e comune; ambiguo; due client dello stesso gruppo a due sedi; codici scritti', async () => {
    const prova = await M.A.allineaAbbinamenti({ scrivi: false });
    assert.equal((await uno('SELECT count(*)::int AS n FROM synclab.client_map')).n, 0, 'anteprima: niente scritto');
    assert.equal(prova.abbinati.length, 6);
    const out = await M.A.allineaAbbinamenti({ scrivi: true, origine: 'test' });
    const by = Object.fromEntries(out.abbinati.map((x) => [x.client_id, x]));
    assert.deepEqual([by['TD-1'].organization_id, by['TD-1'].site_id, by['TD-1'].regola_sede], [M.td, M.ppA, 'INDIRIZZO'], 'punto TD per indirizzo');
    assert.deepEqual([by['TD-2'].site_id], [M.ppB], 'secondo punto TD per indirizzo abbreviato');
    assert.deepEqual([by.K1.organization_id, by.K1.site_id, by.K1.regola], [M.kappa, M.kA, 'PARTITA_IVA'], 'gruppo: client K1 alla sua sede');
    assert.deepEqual([by.K2.organization_id, by.K2.site_id, by.K2.regola_sede], [M.kappa, M.kB, 'COMUNE'], 'gruppo: client K2 all\'altra sede');
    assert.deepEqual([by.SER0099.organization_id, by.SER0099.regola, by.SER0099.site_id], [M.cod, 'CODICE', M.codSede]);
    assert.deepEqual([by['NOME-1'].organization_id, by['NOME-1'].regola], [M.nome, 'NOME_COMUNE']);
    assert.deepEqual(out.ambigui.map((x) => [x.client_id, x.candidati.length]), [['D', 2]]);
    assert.equal(out.senza_candidati, 1, 'IGNOTO');
    assert.deepEqual(out.codici_scritti.map((x) => [x.client_code, x.site_id]).sort(), [['K1', M.kA], ['K2', M.kB], ['SER0099', M.codSede], ['TD-1', M.ppA], ['TD-2', M.ppB]].sort());
    assert.deepEqual(out.conflitti.map((x) => [x.client_code, x.site_id]), [['NOME-1', M.nomeSede]], 'codice diverso già presente: non sovrascritto');
    assert.equal((await uno('SELECT studiolab_code FROM public.sites WHERE id=$1', [M.kB])).studiolab_code, 'K2');
    assert.equal((await uno('SELECT studiolab_code FROM public.sites WHERE id=$1', [M.nomeSede])).studiolab_code, 'GIA-99');
    const au = await uno(`SELECT count(*)::int AS n FROM public.audit_log WHERE action = 'SITE_UPDATED' AND data->>'origine' ILIKE '%codice StudioLAB dal gestionale%'`);
    assert.ok(au.n >= 5, `audit "codice StudioLAB dal gestionale" (${au.n})`);
    const v = await uno(`SELECT stato_abbinamento, organization_id, site_id FROM synclab.clients_td WHERE client_id = 'K2'`);
    assert.deepEqual([v.stato_abbinamento, v.organization_id, v.site_id], ['CONFERMATO', M.kappa, M.kB]);
    // idempotente; un abbinamento tolto a mano non si rifà; scelta manuale dell'ambiguo con la sede
    const di = await M.A.allineaAbbinamenti({ scrivi: true });
    assert.equal(di.abbinati.length, 0); assert.equal(di.codici_scritti.length, 0); assert.equal(di.gia_abbinati, 6);
    await db.query(`UPDATE synclab.client_map SET organization_id = NULL, site_id = NULL, fonte = 'MANUALE' WHERE client_id = 'NOME-1'`);
    assert.equal((await M.A.allineaAbbinamenti({ scrivi: true })).saltati_manuali, 1);
    const sd = await uno(`INSERT INTO public.sites (code, name, kind, city, organization_id) VALUES ('SRV-D1', 'Doppio Uno (service)', 'SERVICE', 'Siena', $1) RETURNING id`, [M.d1]);
    const m = await M.A.abbinaManuale({ clientId: 'D', organizationId: M.d1, siteId: sd.id, origine: 'test' });
    assert.deepEqual(m.codice, { scritto: true, codice: 'D' });
    const cand = await M.A.candidatiPerOrg(M.kappa);
    assert.deepEqual(cand.candidati.map((x) => x.client_id).sort(), ['K1', 'K2']);
    assert.equal(cand.candidati.find((x) => x.client_id === 'K2').sede_proposta.site_id, M.kB);
    const ultimo = await M.A.ultimoAllineamento(); assert.equal(typeof ultimo.esaminati, 'number');
  });

  test('A · produzione erogata: stati, sconto di testata una volta, prezzi null, per giorno, mese, cliente, sede; anno prima; top clienti', async () => {
    const t = await M.L.produzioneErogata({ da: '2026-11-01', a: OGGI, ripartizione: 'B2B' });
    assert.equal(t.totale.valore, 54.5, 'Kappa 27 + 10 + 12,5; Codice 5; prenotata e "attende prelievo" escluse');
    assert.equal(t.totale.accettazioni, 4); assert.equal(t.totale.esami, 6); assert.equal(t.totale.righe_senza_prezzo, 1);
    assert.equal(t.totale.sconto_testata, 3, 'sconto di testata del 10% su 30');
    const tutti = await M.L.produzioneErogata({ da: '2026-11-01', a: OGGI, per: 'ripartizione' });
    assert.deepEqual(tutti.righe.map((x) => [x.chiave, x.valore]), [['B2B', 54.5], ['LAB_SEDE', 10]]);
    const g = await M.L.produzioneGiornaliera({ da: '2026-11-01', a: OGGI, ripartizione: 'B2B' });
    assert.equal(g.giorni.length, 10);
    assert.deepEqual(g.giorni.filter((x) => x.valore).map((x) => [x.giorno, x.valore]), [['2026-11-02', 27], ['2026-11-03', 5], ['2026-11-05', 10], [OGGI, 12.5]]);
    const ms = await M.L.produzioneErogata({ da: '2026-09-01', a: OGGI, per: 'mese', ripartizione: 'B2B' });
    assert.deepEqual(ms.righe.map((x) => [x.chiave, x.valore]), [['2026-09', null], ['2026-10', null], ['2026-11', 54.5]]);
    const cl = await M.L.produzioneErogata({ da: '2026-11-01', a: OGGI, per: 'cliente', ripartizione: 'B2B', annoPrima: true });
    assert.deepEqual(cl.righe.map((x) => [x.nome, x.valore, x.organization_id]), [['Gruppo Prova Kappa', 49.5, M.kappa], ['Cliente Codice Prova', 5, M.cod]]);
    assert.equal(cl.anno_prima.totale.valore, 8, 'stesso periodo dell\'anno prima'); assert.equal(cl.anno_prima.per_chiave[String(M.kappa)].valore, 8);
    const se = await M.L.produzioneErogata({ da: '2026-11-01', a: OGGI, per: 'sede' });
    assert.deepEqual(Object.fromEntries(se.righe.map((x) => [x.chiave, x.valore])), { [M.kA]: 37, [M.kB]: 12.5, [M.ppA]: 10, [M.codSede]: 5 });
    const top = await M.L.topClientiProduzione({ da: '2026-11-01', a: OGGI, prec: { da: '2026-10-01', a: '2026-10-10' }, n: 5 });
    assert.deepEqual(top.righe.map((x) => [x.pos, x.cliente, x.valore, x.quota]), [[1, 'Gruppo Prova Kappa', 49.5, 90.8], [2, 'Cliente Codice Prova', 5, 9.2]]);
    // produzioneMensile e produzionePerOrg (Finance, Business Hub): stessa definizione
    const pm = await M.L.produzioneMensile({ organization_id: M.kappa, mese: '2026-11' });
    assert.deepEqual([pm.valore, pm.esami, pm.accettazioni, pm.righe_senza_prezzo], [49.5, 5, 3, 1]);
    assert.match(pm.note, /applicato una volta/); assert.equal(pm.sconto_testata.importo, 3);
    const po = await M.L.produzionePerOrg([M.kappa], '2026-11-01', OGGI);
    assert.equal(po.get(`${M.kappa}|2026-11`).valore, 49.5);
    // stati dall'impostazione del connettore: solo 50 → solo l'accettazione chiusa di Kappa
    await db.query(`UPDATE public.connectors SET settings = settings || '{"stati_erogati":[50]}'::jsonb WHERE kind = 'STUDIOLAB'`);
    assert.deepEqual(await M.L.statiErogati(), [50]);
    assert.equal((await M.L.produzioneErogata({ da: '2026-11-01', a: OGGI, ripartizione: 'B2B' })).totale.valore, 27);
    await db.query(`UPDATE public.connectors SET settings = settings - 'stati_erogati' WHERE kind = 'STUDIOLAB'`);
    assert.deepEqual(await M.L.statiErogati(), [18, 20, 25, 40, 50]);
  });

  test('A · Cockpit: ricavi B2B = produzione erogata, produzione B2B oggi e mese, andamento giornaliero, TOP 5 per produzione', async () => {
    M.mon.svuotaCacheMonitor();
    const d = await M.mon.calcolaMonitor({ oggi: OGGI });
    const S = d.schermo;
    assert.ok(S && !S.errore, S?.errore);
    const by = (l) => Object.fromEntries(l.map((x) => [x.chiave, x]));
    const R = by(S.ricavi), L = by(S.laboratorio);
    assert.equal(R.ricavi_mese.titolo, 'Ricavi del mese · B2C + B2B');
    assert.equal(R.ricavi_mese.parti.find((p) => p.etichetta === 'B2B produzione erogata').valore, 54.5);
    assert.equal(R.ricavi_oggi.parti.find((p) => p.etichetta === 'B2B produzione erogata').valore, 12.5);
    assert.equal(L.lab_prod_oggi.valore, 12.5); assert.equal(L.lab_prod_mese.valore, 54.5);
    assert.match(L.lab_prod_mese.fonte, /^Synclab, accettazioni erogate \(stati 18, 20, 25, 40, 50\), netto di riga e sconto di testata, /);
    assert.equal(L.lab_acc_oggi.valore, 2, 'accettazioni erogate di oggi: K2 e il punto TD');
    assert.equal(S.andamento.giorni.length, 10); assert.equal(S.andamento.totale, 54.5);
    assert.deepEqual(S.top5.righe.map((x) => [x.cliente, x.valore]), [['Gruppo Prova Kappa', 49.5], ['Cliente Codice Prova', 5]]);
    assert.ok(!('lab_b2b_mese' in L), 'niente più fatturato B2B da documenti come KPI');
    const syn = S.fonti.find((f) => f.chiave === 'SYNCLAB'); assert.ok(syn.ok);
  });

  test('A · Business Hub: maturato = produzione erogata dell\'anno, progressione giornaliera; D51 sulla produzione', async () => {
    const a = (await db.query(`SELECT id, organization_id, linea, fatturato_fy_atteso, data_avvio_effettiva::text, data_avvio_prevista::text, attivo_dal::text, cliente_attivo FROM business.accounts WHERE id=$1`, [M.accKappa])).rows[0];
    const b = await M.S.bloccoAccount(a, { oggi: OGGI });
    assert.equal(b.applicabile, true);
    assert.equal(b.confronto.maturato, 49.5); assert.equal(b.confronto.grandezza, 'PRODUZIONE_EROGATA');
    assert.equal(b.confronto.mesi.at(-1).produzione, 49.5);
    assert.equal(b.giornaliero.giorni.length, 10); assert.equal(b.giornaliero.totale.valore, 49.5);
    assert.deepEqual(b.clients.map((c) => [c.client_code, c.site_id]), [['K1', M.kA], ['K2', M.kB]]);
    assert.match(b.fonte.testo, /accettazioni erogate/);
    const [k] = await M.diag.esegui({ ids: ['D51'] });
    assert.notEqual(k.stato, 'ERRORE', k.nota);
    const x = k.righe.find((r) => Number(r.account_id) === M.accKappa);
    assert.ok(x, 'Kappa sotto il 75% del pro quota'); assert.equal(Number(x.maturato), 49.5, 'maturato del D51 = produzione erogata');
  });

  test('B · listini del gestionale: XLSX per cliente (righe esatte, riepilogo, confronto) e aggregato (riepilogo, foglio lungo, non associati)', async () => {
    const a = { id: M.accKappa, organization_id: M.kappa, org_name: 'Gruppo Prova Kappa', linea: 'SRV' };
    const d = await M.S.listinoGestionaleAccount(a, { tutte: true });
    assert.equal(d.applicabile, true);
    const k1 = d.clients.find((c) => c.client_code === 'K1');
    assert.deepEqual(k1.listini.map((l) => [l.ruolo, l.code, l.stato, l.righe]), [['BASE', 'LK', 'approvato', 2]]);
    assert.deepEqual([k1.listini[0].confronto.diverse, k1.listini[0].confronto.uguali], [1, 1]);
    assert.equal(k1.listini[0].confronto.righe[0].codice, 'ALT');
    const buf = await M.LI.xlsxListiniOrg({ org: { id: M.kappa, name: 'Gruppo Prova Kappa' }, dati: d, confronti: d.confronti });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    assert.equal(wb.worksheets[0].name, 'Riepilogo');
    const fl = wb.worksheets.find((w) => w.name.startsWith('K1 LK'));
    assert.deepEqual(fl.getRow(1).values.slice(1, 7), ['Codice esame', 'Descrizione', 'Prezzo lordo', 'Sconto %', 'Prezzo netto', 'IVA %']);
    const cella = (r, c) => fl.getRow(r).getCell(c).value;
    assert.deepEqual([cella(3, 1), cella(3, 2), cella(3, 3), cella(3, 4), cella(3, 5)], ['ALT', 'Esame ALT', 25, null, 20.12345], 'decimali esatti, sconto null vuoto');
    assert.deepEqual([cella(2, 1), cella(2, 3), cella(2, 4), cella(2, 5)], ['GLU', 12.5, 20, 10]);
    assert.ok(wb.worksheets.some((w) => w.name.startsWith('Confronto')));
    const ag = await M.LI.xlsxListiniAggregato({});
    const wa = new ExcelJS.Workbook(); await wa.xlsx.load(ag.buffer);
    const rie = wa.getWorksheet('Riepilogo'); const lun = wa.getWorksheet('Listini cliente × esame');
    assert.deepEqual(rie.getRow(1).values.slice(1, 5), ['Cliente', 'Codice StudioLab', 'Ragione sociale nel gestionale', 'Listino']);
    const testi = []; rie.eachRow((r) => testi.push(r.values.slice(1).join('|')));
    assert.ok(testi.some((t) => t.startsWith('Gruppo Prova Kappa|K1|Gruppo Prova Kappa|LK · Listino LK|base|approvato|2')), testi.join('\n'));
    assert.ok(testi.some((t) => t.startsWith('Listini Synclab non associati ad alcun cliente abbinato (1)')));
    assert.ok(testi.some((t) => t.startsWith('ORF|Listino ORF')), 'il listino non associato è in fondo');
    assert.equal(lun.rowCount, 3, 'intestazione + 2 righe del listino LK (solo clienti del perimetro)');
    assert.deepEqual(lun.getRow(2).values.slice(1, 6), ['Gruppo Prova Kappa', 'K1', 'LK', 'base', 'GLU']);
    assert.deepEqual(ag.non_associati.map((l) => l.code), ['ORF']);
  });
});
