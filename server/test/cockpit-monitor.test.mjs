// Cockpit direzionale · Monitor (CEO, 08/11/2026): regole pure di lib/cockpitMonitor.js (settimana in corso e prossima anche a cavallo
// d'anno, blocchi di scadenze con conteggi per gravità e "+N altre", confronto con il periodo precedente, indicatore "non disponibile",
// periodi di confronto, copertura degli ambulatori) e, con DATABASE_URL_TEST, GET /api/cockpit/monitor su una Suite vera: forma del JSON,
// fonti assenti dichiarate (mai zero), incassi da Retail quando Cash non ha il rendiconto di oggi e da Cash quando c'è, cache di 60
// secondi, 403 a chi non ha il Cockpit. Dati fittizi.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { settimaneMonitor, bloccoScadenze, confronto, indicatore, periodi, coperturaAmbulatori, serieMesi, etichettaMese, MAX_RIGHE_SCADENZE } from '../src/lib/cockpitMonitor.js';
import { riga, addGiorni } from '../src/lib/scadenzario.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

test('settimana in corso e prossima: da lunedì a domenica', () => {
  const s = settimaneMonitor('2026-11-08');   // domenica
  assert.deepEqual([s.corrente.da, s.corrente.a, s.prossima.da, s.prossima.a], ['2026-11-02', '2026-11-08', '2026-11-09', '2026-11-15']);
  assert.equal(s.corrente.periodo, 'dal 02/11 al 08/11/2026');
  const l = settimaneMonitor('2026-11-09');   // lunedì: inizia una settimana nuova
  assert.deepEqual([l.corrente.da, l.corrente.a, l.prossima.da], ['2026-11-09', '2026-11-15', '2026-11-16']);
});

test('settimane a cavallo d\'anno (e anno bisestile)', () => {
  const a = settimaneMonitor('2026-12-31');   // giovedì
  assert.deepEqual([a.corrente.da, a.corrente.a, a.prossima.da, a.prossima.a], ['2026-12-28', '2027-01-03', '2027-01-04', '2027-01-10']);
  assert.equal(a.corrente.periodo, 'dal 28/12 al 03/01/2027');
  assert.deepEqual(settimaneMonitor('2027-01-03').corrente, { ...a.corrente });   // domenica della stessa settimana
  const b = settimaneMonitor('2027-12-29');   // mercoledì, la prossima settimana è nel 2028
  assert.deepEqual([b.corrente.da, b.corrente.a, b.prossima.da, b.prossima.a], ['2027-12-27', '2028-01-02', '2028-01-03', '2028-01-09']);
  const c = settimaneMonitor('2028-02-28');   // lunedì di un anno bisestile
  assert.deepEqual([c.corrente.a, c.prossima.da], ['2028-03-05', '2028-03-06']);
  assert.deepEqual([settimaneMonitor('2026-01-01').corrente.da, settimaneMonitor('2026-01-01').prossima.a], ['2025-12-29', '2026-01-11']);
});

const F = (modulo, area = 'FINANCE') => ({ key: `f_${modulo}`, modulo, nome: `Modulo ${modulo}`, area });
const OGGI = '2026-11-05';   // giovedì
const R = [
  riga(F('finance'), { chiave: '1', data: '2026-11-02', tipo: 'Canone', titolo: 'Canone scaduto', gravita: 'MEDIA' }, OGGI),       // scaduta: MEDIA → ALTA
  riga(F('nc', 'HQS'), { chiave: '2', data: '2026-11-05', tipo: 'NC', titolo: 'Risposta NC', gravita: 'CRITICA', oggetto: 'Sede Nord' }, OGGI),
  riga(F('business', 'RETAIL_FLOW'), { chiave: '3', data: '2026-11-08', tipo: 'Proposta', titolo: 'Proposta', gravita: 'BASSA' }, OGGI),
  riga(F('finance'), { chiave: '4', data: '2026-11-09', tipo: 'Istanza', titolo: 'Istanza in firma', gravita: 'ALTA', importo: 1200 }, OGGI),
  riga(F('facility', 'OPERATIONS'), { chiave: '5', data: '2026-11-16', tipo: 'Verifica', titolo: 'Fuori dalle due settimane', gravita: 'ALTA' }, OGGI),
  riga(F('finance'), { chiave: '6', data: '2026-11-01', tipo: 'Canone', titolo: 'Settimana precedente', gravita: 'MEDIA' }, OGGI),
];

test('blocchi di scadenze: settimana, scadute comprese, conteggi per gravità, ordine per data', () => {
  const s = settimaneMonitor(OGGI);
  const b = bloccoScadenze(R, s.corrente);
  assert.deepEqual(b.righe.map((r) => r.titolo), ['Canone scaduto', 'Risposta NC', 'Proposta']);
  assert.deepEqual([b.conteggi.totale, b.conteggi.scadute, b.conteggi.CRITICA, b.conteggi.ALTA, b.conteggi.MEDIA, b.conteggi.BASSA], [3, 1, 1, 1, 0, 1]);
  assert.equal(b.righe[0].stato, 'SCADUTA'); assert.equal(b.righe[0].gravita, 'ALTA');
  assert.equal(b.righe[1].oggetto, 'Sede Nord'); assert.equal(b.righe[1].modulo_nome, 'Modulo nc'); assert.equal(b.righe[1].area, 'HQS');
  assert.ok(!('link' in b.righe[0]), 'il monitor non porta collegamenti ai moduli');
  const p = bloccoScadenze(R, s.prossima);
  assert.deepEqual(p.righe.map((r) => r.titolo), ['Istanza in firma']);
  assert.equal(p.altre, 0);
  // oltre il massimo: "+N altre"
  const tante = Array.from({ length: 11 }, (_, i) => riga(F('finance'), { chiave: `t${i}`, data: '2026-11-04', tipo: 'X', titolo: `Riga ${String(i).padStart(2, '0')}` }, OGGI));
  const t = bloccoScadenze(tante, s.corrente);
  assert.equal(t.righe.length, MAX_RIGHE_SCADENZE); assert.equal(t.altre, 3); assert.equal(t.conteggi.totale, 11);
});

test('confronto con il periodo precedente: segno, esito secondo il verso buono, punti per le percentuali', () => {
  assert.deepEqual(confronto(120, 100), { valore_precedente: 100, delta: 20, delta_pct: 20, segno: 'su', esito: 'meglio', punti: false, etichetta: '' });
  assert.equal(confronto(80, 100, { meglio: 'giu' }).esito, 'meglio');
  assert.equal(confronto(120, 100, { meglio: 'giu' }).esito, 'peggio');
  assert.equal(confronto(120, 100, { meglio: null }).esito, 'neutro');
  assert.equal(confronto(5, 0).delta_pct, null, 'precedente a zero: nessuna variazione percentuale');
  const p = confronto(87.5, 90, { unita: '%' });
  assert.equal(p.delta, -2.5); assert.equal(p.delta_pct, null); assert.equal(p.punti, true);
  assert.equal(confronto(null, 10), null); assert.equal(confronto(10, null), null);
  assert.equal(confronto(10, 10).segno, 'pari');
});

test('indicatore: senza valore è "non disponibile" con il motivo, mai zero', () => {
  const nd = indicatore({ chiave: 'x', titolo: 'X', gruppo: 'OPERATIONS', motivo: 'Ordini: modulo non avviato nella Suite', serie: [{ etichetta: 'a', valore: 1 }] });
  assert.equal(nd.non_disponibile, true); assert.equal(nd.valore, null); assert.match(nd.motivo, /non avviato/); assert.deepEqual(nd.serie, []);
  const ok = indicatore({ chiave: 'y', titolo: 'Y', gruppo: 'OPERATIONS', valore: 0, serie: Array.from({ length: 15 }, (_, i) => ({ etichetta: String(i), valore: i })) });
  assert.equal(ok.non_disponibile, false); assert.equal(ok.valore, 0, 'zero letto da una fonte vera resta zero'); assert.equal(ok.serie.length, 12);
  assert.equal(indicatore({ chiave: 'z', titolo: 'Z', gruppo: 'G', valore: 10.555 }).valore, 10.56);
});

test('periodi di confronto: mese precedente fino allo stesso giorno (fine mese corta), stesso periodo dell\'anno prima, 12 mesi', () => {
  const p = periodi('2026-03-31');
  assert.deepEqual(p.mese_prec, { da: '2026-02-01', a: '2026-02-28' });
  assert.deepEqual(p.anno_prec, { da: '2025-03-01', a: '2025-03-31' });
  assert.equal(p.settimana_prec, '2026-03-24');
  const g = periodi('2027-01-10');
  assert.deepEqual(g.mese_prec, { da: '2026-12-01', a: '2026-12-10' });
  assert.equal(g.mesi12[0], '2026-02'); assert.equal(g.mesi12[11], '2027-01');
  assert.equal(g.giorni12[0], '2026-12-30'); assert.equal(g.giorni12[11], '2027-01-10');
  assert.deepEqual(periodi('2028-02-29').anno_prec, { da: '2027-02-01', a: '2027-02-28' });
  assert.equal(etichettaMese('2026-11'), 'nov 26');
  assert.deepEqual(serieMesi(['2026-10', '2026-11'], [{ mk: '2026-11', v: '12.5' }]).map((x) => x.valore), [0, 12.5]);
});

test('copertura degli ambulatori: ore prenotabili coperte da un turno con professionista sullo stesso ambulatorio', () => {
  const tutti = (from, to) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ from, to }]]));
  const hours = { 0: { closed: false, open: '08:00', close: '14:00' }, 1: { closed: false, open: '08:00', close: '14:00' }, 2: { closed: true }, 3: { closed: true }, 4: { closed: true }, 5: { closed: true }, 6: { closed: true } };
  const sedi = [{ id: 7, hours, ambulatori: [
    { id: 'A1', nome: 'Ambulatorio 1', disp: tutti('08:00', '20:00'), discipline: [] },                                   // 6 ore (dentro l'apertura)
    { id: 'P1', nome: 'Prelievi', disp: tutti('08:00', '14:00'), discipline: ['Punto Prelievi'], prelievi: { 0: [{ from: '08:00', to: '10:00' }], 1: [{ from: '08:00', to: '10:00' }] } },   // 4 ore
  ] }];
  const giorni = ['2026-11-09', '2026-11-10', '2026-11-11'];   // lunedì, martedì, mercoledì (chiuso)
  const turni = [
    { sede_id: 7, data: '2026-11-09', ora_da: '08:00', ora_a: '11:00', room_id: 'A1', prof_id: 1 },
    { sede_id: 7, data: '2026-11-09', ora_da: '10:00', ora_a: '12:00', room_id: 'A1', prof_id: 2 },   // sovrapposto: contato una volta
    { sede_id: 7, data: '2026-11-09', ora_da: '09:00', ora_a: '12:00', room_id: 'P1', prof_id: 3 },   // 09-10 è fascia prelievi: conta 10-12
    { sede_id: 7, data: '2026-11-10', ora_da: '08:00', ora_a: '14:00', room_id: 'A1', prof_id: null }, // scoperto
    { sede_id: 7, data: '2026-11-10', ora_da: '08:00', ora_a: '10:00', room_id: null, prof_id: 4 },    // senza ambulatorio
  ];
  const c = coperturaAmbulatori({ sedi, turni, giorni });
  assert.equal(c.ore_aperte, 20);          // (6 + 4) × 2 giorni aperti
  assert.equal(c.ore_coperte, 6);          // lunedì: A1 08-12 (4 ore) + P1 10-12 (2 ore)
  assert.equal(c.pct, 30); assert.equal(c.ambulatori, 2); assert.equal(c.turni_senza_ambulatorio, 1);
  const chiuso = coperturaAmbulatori({ sedi, turni, giorni, chiusure: [{ sede_id: 7, dal: '2026-11-09', al: '2026-11-09' }] });
  assert.equal(chiuso.ore_aperte, 10); assert.equal(chiuso.ore_coperte, 0);
  assert.equal(coperturaAmbulatori({ sedi: [], turni, giorni }).pct, null, 'senza ambulatori: non calcolabile');
});

describe('monitor del Cockpit (integrazione)', { skip: SALTA }, () => {
  let S, o, db;
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const byKey = (j) => Object.fromEntries(j.indicatori.map((x) => [x.chiave, x]));
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    db = new pg.Client({ connectionString: S.url }); await db.connect();
  }, { timeout: 120000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('forma del JSON e fonti assenti dichiarate (moduli non avviati: non disponibile, mai zero)', async () => {
    const j = must(await o.get('/api/cockpit/monitor?fresco=1'), 'monitor');
    assert.ok(j.generato_at && j.oggi === oggi);
    assert.equal(j.aggiorna_ogni_s, 300);
    assert.equal(j.scadenze.blocchi.length, 2);
    assert.deepEqual(j.scadenze.blocchi.map((b) => b.titolo), ['Questa settimana', 'Prossima settimana']);
    for (const b of j.scadenze.blocchi) { assert.ok(b.da && b.a && b.conteggi && Array.isArray(b.righe)); assert.equal(typeof b.altre, 'number'); }
    assert.deepEqual(j.gruppi.map((g) => g.key), ['INCASSI', 'RICAVI_COSTI', 'FINANCE', 'OPERATIONS', 'RETAIL_FLOW', 'PERSONE']);
    const k = byKey(j);
    for (const chiave of ['incassi_oggi', 'incassi_mese', 'incassi_sedi', 'ricavi_mese', 'ricavi_anno', 'costi_mese', 'costi_anno', 'margine_mese', 'margine_anno', 'fatturato',
      'istanze_in_firma', 'istanze_da_eseguire', 'istanze_eseguite', 'scadenziario_30', 'nc_aperte', 'nc_chiuse_mese', 'ordini_in_corso', 'ordini_mese', 'kit_in_gestione',
      'referti_da_trascrivere', 'copertura_turni', 'copertura_ambulatori', 'richiami_scaduti', 'clienti_attivi', 'pipeline', 'contratti_firmati', 'dipendenti_attivi',
      'assenti_oggi', 'autoaudit_mancanti', 'ticket_aperti', 'circolari_da_confermare']) assert.ok(k[chiave], `indicatore ${chiave}`);
    for (const x of j.indicatori) {
      for (const campo of ['chiave', 'titolo', 'valore', 'unita', 'confronto', 'dettaglio', 'serie', 'gruppo', 'fonte', 'non_disponibile']) assert.ok(campo in x, `${x.chiave}.${campo}`);
      if (x.non_disponibile) { assert.equal(x.valore, null, `${x.chiave}: nessuno zero finto`); assert.ok(x.motivo, `${x.chiave}: motivo`); }
    }
    assert.equal(k.istanze_in_firma.non_disponibile, true); assert.match(k.istanze_in_firma.motivo, /Finance Management: modulo non avviato/);
    assert.equal(k.fatturato.non_disponibile, true);
    assert.equal(k.incassi_oggi.non_disponibile, true); assert.match(k.incassi_oggi.motivo, /Cash Management.*Retail/);
    // l'anagrafica della Suite è sempre leggibile
    assert.equal(k.dipendenti_attivi.non_disponibile, false); assert.equal(typeof k.dipendenti_attivi.valore, 'number');
  });

  test('incassi: Retail quando Cash non ha il rendiconto di oggi (fonte dichiarata), Cash quando c\'è; cache di 60 secondi', async () => {
    for (const m of ['cash', 'retail']) must(await o.post(`/api/travaso/${m}/run`, {}), `avvio ${m}`);
    const td = must(await o.post('/api/organizations', { name: 'Gruppo Monitor', kind: 'GRUPPO', code: 'TDM' }), 'org');
    const s1 = must(await o.post('/api/sites', { code: 'M-PP1', name: 'Punto Monitor Uno', kind: 'PUNTO_PRELIEVI', organization_id: td.id, city: 'Firenze' }), 'sede 1');
    const s2 = must(await o.post('/api/sites', { code: 'M-PP2', name: 'Punto Monitor Due', kind: 'PUNTO_PRELIEVI', organization_id: td.id, city: 'Prato' }), 'sede 2');
    await db.query(`INSERT INTO retail.sales (source, sale_date, site_id, net_amount, gross_amount) VALUES ('MANUALE', $1, $2, 100, 100), ('MANUALE', $1, $3, 50.5, 50.5), ('DEMO', $1, $2, 999, 999)`, [oggi, s1.id, s2.id]);
    let j = must(await o.get('/api/cockpit/monitor?fresco=1'), 'monitor');
    let k = byKey(j);
    assert.equal(k.incassi_oggi.valore, 150.5, 'vendite nette Retail di oggi senza le dimostrative');
    assert.match(k.incassi_oggi.fonte, /^Retail/); assert.match(k.incassi_oggi.dettaglio, /Cash non ha ancora rendiconti di oggi/);
    assert.equal(k.incassi_mese.valore, 150.5); assert.match(k.incassi_mese.fonte, /^Retail/);
    assert.equal(k.incassi_sedi.tabella.length, 2); assert.equal(k.incassi_sedi.tabella[0].etichetta, 'Punto Monitor Uno');
    assert.equal(k.incassi_oggi.serie.length, 12);
    // rendiconto Cash di oggi chiuso (e una bozza, che non conta)
    const op = (await db.query(`INSERT INTO cash.users (email, full_name, role) VALUES ('operatore.monitor@toscanadiagnostica.it', 'Operatore Monitor', 'SUPERADMIN') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO cash.cash_reports (site_id, report_date, status, cash_float, cash_to_deposit, pos_total, transfer_total, operator_id) VALUES ($1, $2, 'CLOSED', 100, 80, 120.25, 10, $3), ($4, $2, 'DRAFT', 100, 500, 0, 0, $3)`, [s1.id, oggi, op, s2.id]);
    // cache: senza fresco il dato è quello di prima (stesso generato_at)
    const c = must(await o.get('/api/cockpit/monitor'), 'monitor in cache');
    assert.equal(c.generato_at, j.generato_at); assert.ok(c.cache.eta_s >= 0);
    j = must(await o.get('/api/cockpit/monitor?fresco=1'), 'monitor fresco');
    assert.notEqual(j.generato_at, c.generato_at);
    k = byKey(j);
    assert.equal(k.incassi_oggi.valore, 210.25, 'contanti da versare + POS + bonifici dei rendiconti chiusi');
    assert.match(k.incassi_oggi.fonte, /^Cash, rendiconti del/); assert.match(k.incassi_oggi.dettaglio, /^1 sede/);
    assert.equal(k.incassi_mese.valore, 210.25); assert.equal(k.incassi_sedi.tabella.length, 1);
    assert.ok(k.incassi_mese.confronto, 'confronto con lo stesso periodo dell\'anno scorso');
  });

  test('scadenze delle due settimane dallo scadenzario (sede in locazione); 403 a chi non ha il Cockpit', async () => {
    const td = must(await o.post('/api/organizations', { name: 'Gruppo Scadenze', kind: 'GRUPPO', code: 'TDS' }), 'org');
    const s = must(await o.post('/api/sites', { code: 'M-LOC', name: 'Sede Locazione Monitor', kind: 'PUNTO_PRELIEVI', organization_id: td.id, city: 'Firenze', tenure: 'PROPRIETA' }), 'sede');
    const fine = addGiorni(oggi, 7);   // sempre nella prossima settimana o in questa
    await db.query(`UPDATE sites SET tenure='LOCAZIONE', lease_end=$2, lease_notice_months=0, lease_renewal_years=0 WHERE id=$1`, [s.id, fine]);
    const j = must(await o.get('/api/cockpit/monitor?fresco=1'), 'monitor');
    const tutte = j.scadenze.blocchi.flatMap((b) => b.righe);
    const r = tutte.find((x) => x.oggetto === 'Sede Locazione Monitor');
    assert.ok(r, 'scadenza della locazione nel monitor');
    const b = j.scadenze.blocchi.find((x) => x.da <= fine && x.a >= fine);
    assert.ok(b.righe.some((x) => x.id === r.id));
    assert.ok(b.conteggi.totale >= 1);
    const pe = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Senzamonitor', first_name: 'Ugo', email: 'ugo.senzamonitor@toscanadiagnostica.it' }), 'persona');
    await new Promise((x) => setTimeout(x, 1200));
    const uid = (await o.get(`/api/people/${pe.id}`)).j.user_id;
    await o.put(`/api/users/${uid}`, { auth_provider: 'BOTH' });
    await o.del(`/api/users/${uid}/grants/cockpit`);
    const rp = must(await o.post(`/api/users/${uid}/reset-password`, {}), 'password');
    const u = await entra(client(S.base), 'ugo.senzamonitor@toscanadiagnostica.it', rp.temporaryPassword, 'Senza-Monitor-2026x');
    assert.equal((await u.get('/api/cockpit/monitor')).s, 403);
  });
});
