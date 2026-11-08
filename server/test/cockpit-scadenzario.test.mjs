// Scadenzario unico di direzione nel Cockpit (decisione del CEO, 08/11/2026): regole pure di lib/scadenzario.js (stato, gravità,
// settimana, ordine, filtri, visibilità dei moduli riservati, viste, rinnovi della locazione, testo della notifica) e, con
// DATABASE_URL_TEST, la route su una Suite vera: fonti dei moduli non avviati dichiarate "non disponibili", scadenza della sede in
// anagrafica, "Segna come vista", export, 403 a chi non ha il Cockpit. Dati fittizi.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  statoScadenza, gravitaEffettiva, settimana, ordina, filtra, riepilogo, visibiliA, applicaViste, vistaPredefinita, finiLocazione, riga,
  addMesi, fineMese, iso, testoNotifica, finestraPredefinita, raggruppaPerSettimana, FONTI,
} from '../src/lib/scadenzario.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

const OGGI = '2026-11-08';
const F = { key: 'prova', modulo: 'facility', nome: 'Prova', area: 'OPERATIONS' };

test('stato rispetto a oggi: scaduta, oggi, entro 7, entro 30, oltre', () => {
  assert.equal(statoScadenza('2026-11-07', OGGI), 'SCADUTA');
  assert.equal(statoScadenza('2026-11-08', OGGI), 'OGGI');
  assert.equal(statoScadenza('2026-11-09', OGGI), 'ENTRO_7');
  assert.equal(statoScadenza('2026-11-15', OGGI), 'ENTRO_7');
  assert.equal(statoScadenza('2026-11-16', OGGI), 'ENTRO_30');
  assert.equal(statoScadenza('2026-12-08', OGGI), 'ENTRO_30');
  assert.equal(statoScadenza('2026-12-09', OGGI), 'OLTRE');
});

test('gravità: un livello in più se scaduta, mai oltre CRITICA', () => {
  assert.equal(gravitaEffettiva('MEDIA', 'ENTRO_7'), 'MEDIA');
  assert.equal(gravitaEffettiva('MEDIA', 'SCADUTA'), 'ALTA');
  assert.equal(gravitaEffettiva('CRITICA', 'SCADUTA'), 'CRITICA');
  assert.equal(gravitaEffettiva(undefined, 'OGGI'), 'MEDIA');
});

test('date: gg/mm/aaaa delle certificazioni, fine mese, mesi con fine mese, settimana ISO', () => {
  assert.equal(iso('03/09/2029'), '2029-09-03');
  assert.equal(iso('2026-11-08T10:00:00Z'), '2026-11-08');
  assert.equal(iso('31/02/2026'), null);
  assert.equal(iso(''), null);
  assert.equal(fineMese('2026-02-10'), '2026-02-28');
  assert.equal(addMesi('2026-01-31', 1), '2026-02-28');
  assert.equal(addMesi('2027-05-12', -6), '2026-11-12');
  assert.deepEqual(settimana('2026-11-08'), { chiave: '2026-11-02', etichetta: 'Settimana dal 02/11 al 08/11/2026' });
  assert.equal(settimana('2026-11-09').chiave, '2026-11-09');
  assert.deepEqual(finestraPredefinita(OGGI), { da: '2026-10-09', a: '2027-02-06' });
});

test('locazione con rinnovo tacito: fini dei periodi nella finestra; senza rinnovo solo la prima', () => {
  assert.deepEqual(finiLocazione({ fine: '2020-11-28', rinnovoAnni: 6, da: '2026-10-01', a: '2027-01-01' }), [{ fine: '2026-11-28', rinnovi: 1 }]);
  assert.deepEqual(finiLocazione({ fine: '2026-11-03', rinnovoAnni: 0, da: '2026-10-09', a: '2027-02-06' }), [{ fine: '2026-11-03', rinnovi: 0 }]);
  assert.deepEqual(finiLocazione({ fine: '2020-11-03', rinnovoAnni: 0, da: '2026-10-09', a: '2027-02-06' }), []);
  assert.deepEqual(finiLocazione({ fine: null, rinnovoAnni: 6, da: '2026-10-09', a: '2027-02-06' }), []);
});

test('riga normalizzata: id stabile, stato, gravità, importo arrotondato; senza data nessuna riga', () => {
  const r = riga(F, { chiave: 'piano:7', data: '2026-11-03', tipo: 'Scadenza normativa', titolo: 'Verifica', importo: '10.555', gravita: 'ALTA', link: '/facility/piano' }, OGGI);
  assert.equal(r.id, 'prova:piano:7');
  assert.equal(r.stato, 'SCADUTA'); assert.equal(r.giorni, -5); assert.equal(r.gravita, 'CRITICA'); assert.equal(r.gravita_base, 'ALTA');
  assert.equal(r.importo, 10.56); assert.equal(r.modulo, 'facility'); assert.equal(r.area, 'OPERATIONS');
  assert.equal(riga(F, { chiave: 'x', data: null, tipo: 't', titolo: 't' }, OGGI), null);
  assert.equal(riga({ ...F, modulo: null }, { chiave: 'y', data: OGGI, tipo: 't', titolo: 't' }, OGGI).modulo, 'core');
});

const R = [
  riga({ key: 'a', modulo: 'finance', nome: 'Finance', area: 'FINANCE' }, { chiave: '1', data: '2026-11-12', tipo: 'Canone', titolo: 'Canone', oggetto: 'Sede Nord', gravita: 'MEDIA' }, OGGI),
  riga({ key: 'b', modulo: 'contracts', nome: 'Contratti', area: 'PEOPLE' }, { chiave: '2', data: '2026-11-12', tipo: 'Prova', titolo: 'Fine prova', oggetto: 'Rossi Anna', gravita: 'ALTA' }, OGGI),
  riga({ key: 'c', modulo: 'nc', nome: 'NC', area: 'HQS' }, { chiave: '3', data: '2026-11-01', tipo: 'NC', titolo: 'NC oltre termine', oggetto: 'Sede Sud', gravita: 'MEDIA' }, OGGI),
  riga({ key: 'd', modulo: null, nome: 'Sedi', area: 'DIREZIONE' }, { chiave: '4', data: '2026-11-28', tipo: 'Disdetta', titolo: 'Termine disdetta', oggetto: 'Sede Nord', responsabile: 'Bianchi Luca' }, OGGI),
  riga({ key: 'e', modulo: 'ferie', nome: 'Ferie', area: 'PEOPLE' }, { chiave: '5', data: OGGI, tipo: 'Richiesta', titolo: 'Richiesta ferie', oggetto: 'Verdi Sara' }, OGGI),
];

test('ordine: per data, a parità di data prima la più grave', () => {
  const o = ordina(R).map((r) => r.id);
  assert.deepEqual(o, ['c:3', 'e:5', 'b:2', 'a:1', 'd:4']);
});

test('filtri per area, modulo, ricerca e stato; riepilogo', () => {
  assert.deepEqual(filtra(R, { area: 'PEOPLE' }).map((r) => r.id).sort(), ['b:2', 'e:5']);
  assert.deepEqual(filtra(R, { area: 'FINANCE,HQS' }).map((r) => r.id).sort(), ['a:1', 'c:3']);
  assert.deepEqual(filtra(R, { modulo: 'core' }).map((r) => r.id), ['d:4']);
  assert.deepEqual(filtra(R, { q: 'nord' }).map((r) => r.id).sort(), ['a:1', 'd:4']);
  assert.deepEqual(filtra(R, { q: 'bianchi' }).map((r) => r.id), ['d:4']);
  assert.deepEqual(filtra(R, { stati: 'SCADUTA,OGGI' }).map((r) => r.id).sort(), ['c:3', 'e:5']);
  const rp = riepilogo(R);
  assert.deepEqual([rp.SCADUTA, rp.OGGI, rp.ENTRO_7, rp.ENTRO_30, rp.entro_7, rp.totale], [1, 1, 2, 1, 3, 5]);
  assert.deepEqual(raggruppaPerSettimana(R).map((g) => [g.chiave, g.righe.length]), [['2026-10-26', 1], ['2026-11-02', 1], ['2026-11-09', 2], ['2026-11-23', 1]]);
});

test('moduli riservati (Contratti, Ferie, Room): solo con il grant del modulo o a titolare e amministratori', () => {
  const viewer = { level: 'USER', grants: { cockpit: { profile: 'VIEWER' } } };
  assert.deepEqual(visibiliA(R, viewer).map((r) => r.modulo).sort(), ['core', 'finance', 'nc']);
  assert.equal(visibiliA(R, { ...viewer, grants: { ...viewer.grants, contracts: { profile: 'HR' } } }).length, 4);
  assert.equal(visibiliA(R, { level: 'ADMIN', grants: {} }).length, 5);
  assert.equal(visibiliA(R, { level: 'OWNER', grants: {} }).length, 5);
});

test('"Segna come vista": nasconde fino alla data compresa; predefinita = data futura della scadenza o tra 7 giorni', () => {
  const v = applicaViste(R, [{ chiave: 'a:1', fino_a: '2026-11-12' }, { chiave: 'c:3', fino_a: '2026-11-07' }], OGGI);
  assert.equal(v.find((r) => r.id === 'a:1').vista_fino_a, '2026-11-12');
  assert.equal(v.find((r) => r.id === 'c:3').vista_fino_a, undefined, 'vista con data passata: la riga torna visibile');
  assert.equal(vistaPredefinita('2026-11-28', OGGI), '2026-11-28');
  assert.equal(vistaPredefinita('2026-11-01', OGGI), '2026-11-15');
  assert.equal(vistaPredefinita(OGGI, OGGI), '2026-11-15');
});

test('notifica: solo con scadenze entro 7 giorni, con conteggi e prime righe', () => {
  assert.equal(testoNotifica([R[2], R[3]]), null);
  const t = testoNotifica(R);
  assert.match(t.title, /3 scadenze entro 7 giorni/);
  assert.match(t.body, /^1 oggi, 2 nei prossimi 7 giorni, 1 già scadute\./);
  assert.match(t.body, /08\/11 Richiesta ferie \(Verdi Sara\)/);
});

test('fonti: chiave unica, area valida, campi letti dichiarati', () => {
  const keys = FONTI.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const f of FONTI) {
    assert.ok(['DIREZIONE', 'FINANCE', 'RETAIL_FLOW', 'OPERATIONS', 'HQS', 'PEOPLE'].includes(f.area), f.key);
    assert.ok(f.campi && f.campi.length > 20, `campi letti di ${f.key}`);
    assert.equal(typeof f.leggi, 'function');
  }
});

describe('scadenzario di direzione (integrazione)', { skip: SALTA }, () => {
  let S, o, db;
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    db = new pg.Client({ connectionString: S.url }); await db.connect();
  });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('moduli non avviati: fonti "non disponibili" (nessuna riga, non zero); sede in locazione dall\'anagrafica', async () => {
    const td = must(await o.post('/api/organizations', { name: 'Gruppo Prova', kind: 'GRUPPO', code: 'TDP' }), 'org');
    const s = must(await o.post('/api/sites', { code: 'T-LOC', name: 'Sede Locazione Test', kind: 'PUNTO_PRELIEVI', organization_id: td.id, city: 'Firenze', tenure: 'PROPRIETA' }), 'sede');
    const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const fine = addMesi(oggi, 6);
    await db.query(`UPDATE sites SET tenure='LOCAZIONE', lease_end=$2, lease_notice_months=6, lease_renewal_years=6 WHERE id=$1`, [s.id, fine]);
    const j = must(await o.get('/api/cockpit/scadenzario?fresco=1'), 'scadenzario');
    const fin = j.fonti.find((f) => f.key === 'finance_istanze');
    assert.equal(fin.stato, 'NON_ATTIVO'); assert.equal(fin.righe, 0); assert.match(fin.nota, /non avviato/);
    assert.equal(j.fonti.find((f) => f.key === 'sedi').stato, 'OK');
    const dis = j.righe.find((r) => r.fonte === 'sedi' && r.oggetto === 'Sede Locazione Test');
    assert.ok(dis, 'termine di disdetta della sede');
    assert.equal(dis.data, oggi); assert.equal(dis.stato, 'OGGI'); assert.equal(dis.gravita, 'ALTA'); assert.equal(dis.link, '/admin/sites');
    assert.ok(j.scartate.some((x) => /Spedizioni/.test(x.nome)));
    // contatore della Home e card del Cockpit
    assert.equal((await o.get('/api/home/counters')).j.cockpit.value, 1);
    assert.equal((await o.get('/api/cockpit')).j.cards[0].key, 'scadenze_7');
    // segna come vista: sparisce, il contatore scende, ripristino
    must(await o.post('/api/cockpit/scadenzario/viste', { chiave: dis.id, data: dis.data }), 'vista');
    const j2 = must(await o.get('/api/cockpit/scadenzario'), 'dopo la vista');
    assert.ok(!j2.righe.some((r) => r.id === dis.id)); assert.equal(j2.nascoste, 1);
    assert.equal((await o.get('/api/home/counters')).j.cockpit.value, 0);
    assert.ok((await o.get('/api/cockpit/scadenzario?viste=1')).j.righe.some((r) => r.id === dis.id && r.vista_fino_a));
    must(await o.del(`/api/cockpit/scadenzario/viste?chiave=${encodeURIComponent(dis.id)}`), 'ripristino');
    assert.ok((await o.get('/api/cockpit/scadenzario')).j.righe.some((r) => r.id === dis.id));
    assert.equal((await o.post('/api/cockpit/scadenzario/viste', { chiave: dis.id, fino_a: '2020-01-01' })).s, 400);
    // export
    const x = await o.get('/api/cockpit/scadenzario/export.xlsx');
    assert.equal(x.s, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
    const p = await o.get('/api/cockpit/scadenzario/export.pdf');
    assert.equal(p.s, 200); assert.ok(p.text.startsWith('%PDF'));
    assert.equal((await o.get('/api/cockpit/scadenzario?da=2026-12-01&a=2026-11-01')).s, 400);
  });

  test('impostazioni (amministratori) e chi non ha il Cockpit riceve 403', async () => {
    const imp = must(await o.get('/api/cockpit/scadenzario/impostazioni'), 'impostazioni');
    assert.equal(imp.valori.notifica_attiva, true); assert.equal(imp.valori.proposte_giorni, 30);
    assert.equal((await o.put('/api/cockpit/scadenzario/impostazioni', { ...imp.valori, proposte_giorni: 0 })).s, 400);
    must(await o.put('/api/cockpit/scadenzario/impostazioni', { ...imp.valori, notifica_attiva: false }), 'spegni');
    assert.equal((await o.get('/api/cockpit/scadenzario/impostazioni')).j.valori.notifica_attiva, false);
    const pe = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Senzacockpit', first_name: 'Ugo', email: 'ugo.senzacockpit@toscanadiagnostica.it' }), 'persona');
    await new Promise((r) => setTimeout(r, 1200));
    const uid = (await o.get(`/api/people/${pe.id}`)).j.user_id;
    await o.put(`/api/users/${uid}`, { auth_provider: 'BOTH' });
    await o.del(`/api/users/${uid}/grants/cockpit`);   // le regole di accesso possono darlo ai responsabili: qui no
    const rp = must(await o.post(`/api/users/${uid}/reset-password`, {}), 'password');
    const u = await entra(client(S.base), 'ugo.senzacockpit@toscanadiagnostica.it', rp.temporaryPassword, 'Senza-Cockpit-2026x');
    assert.equal((await u.get('/api/cockpit/scadenzario')).s, 403);
    assert.equal((await u.get('/api/cockpit/scadenzario/export.pdf')).s, 403);
    assert.equal((await u.get('/api/home/counters')).j.cockpit, undefined);
    assert.equal((await u.get('/api/cockpit/scadenzario/impostazioni')).s, 403);
  });
});
