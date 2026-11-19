// v0.90.0 · "Vedi come profilo": solo il titolare, solo dentro il widget indicato, solo con un profilo del catalogo, sola lettura.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { leggiVista } from '../src/lib/vediCome.js';

const SALTA = process.env.DATABASE_URL_TEST ? false : 'DATABASE_URL_TEST mancante';

describe('Vedi come profilo: intestazione', () => {
  test('accetta solo widget e profili del catalogo', () => {
    assert.deepEqual(leggiVista('cash:CASSIERE:12'), { key: 'cash', profile: 'CASSIERE', label: leggiVista('cash:CASSIERE').label, site_id: 12 });
    assert.equal(leggiVista('cash:INVENTATO'), null);
    assert.equal(leggiVista('inesistente:ADMIN'), null);
    assert.equal(leggiVista('cash:CASSIERE:abc'), null);
    assert.equal(leggiVista(''), null);
  });
});

describe('Vedi come profilo: nella Suite', { skip: SALTA }, () => {
  let S; let D;
  const chiama = (c, metodo, p, vista, body) => fetch(S.base + p, { method: metodo, headers: { cookie: c.cookie, 'X-Requested-With': 'td-suite', ...(vista ? { 'X-Vedi-Come': vista } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
  before(async () => { const H = await import('./helpers/suiteTest.mjs'); S = await H.avviaSuite(); D = await H.datiProva(S.base); });
  after(async () => { await S?.stop(); });

  test('il titolare vede il widget con il profilo scelto e torna al suo senza intestazione', async () => {
    const mio = await chiama(D.o, 'GET', '/api/gipoguida/state');
    assert.equal(mio.s, 200); assert.equal(mio.j.user.role, 'ADMIN');
    const come = await chiama(D.o, 'GET', '/api/gipoguida/state', 'gipoguida:LETTORE');
    assert.equal(come.s, 200); assert.equal(come.j.user.role, 'LETTORE');
    const dopo = await chiama(D.o, 'GET', '/api/gipoguida/state');
    assert.equal(dopo.j.user.role, 'ADMIN', 'il ruolo del titolare non resta cambiato');
    // una pagina riservata alla redazione è negata nella vista
    const red = await chiama(D.o, 'GET', '/api/gipoguida/redazione/sezioni', 'gipoguida:LETTORE');
    assert.equal(red.s, 403);
  });
  test('la vista è in sola lettura', async () => {
    const r = await chiama(D.o, 'POST', '/api/gipoguida/chiedi', 'gipoguida:LETTORE', { domanda: 'come si crea una agenda?' });
    assert.equal(r.s, 403); assert.equal(r.j.code, 'VEDI_COME');
  });
  test('vale solo dentro il widget indicato e solo per profili previsti', async () => {
    const altro = await chiama(D.o, 'GET', '/api/suiteguida/state', 'gipoguida:LETTORE');
    assert.equal(altro.j.user.role, 'ADMIN');
    const finto = await chiama(D.o, 'GET', '/api/gipoguida/state', 'gipoguida:SUPERCAPO');
    assert.equal(finto.j.user.role, 'ADMIN');
  });
  test('chi non è titolare non può usarla', async () => {
    const r = await chiama(D.cliente, 'GET', '/api/suiteguida/state', 'suiteguida:ADMIN');
    assert.equal(r.s, 200); assert.notEqual(r.j.user.role, 'ADMIN');
    const p = await chiama(D.cliente, 'GET', '/api/vedi-come/cash');
    assert.equal(p.s, 403);
    const a = await chiama(D.cliente, 'POST', '/api/vedi-come', null, { key: 'cash', profile: 'ADMIN' });
    assert.equal(a.s, 403);
  });
  test('elenco dei profili e traccia nel registro', async () => {
    const p = await chiama(D.o, 'GET', '/api/vedi-come/cash');
    assert.equal(p.s, 200); assert.ok(p.j.per_sede); assert.ok(p.j.profili.some((x) => x.key === 'CASSIERE'));
    const a = await chiama(D.o, 'POST', '/api/vedi-come', null, { key: 'cash', profile: 'CASSIERE', site_id: D.site.pp1 });
    assert.equal(a.s, 200); assert.equal(a.j.vista.site_id, D.site.pp1);
    const no = await chiama(D.o, 'POST', '/api/vedi-come', null, { key: 'cash', profile: 'NESSUNO' });
    assert.equal(no.s, 400);
  });
});
