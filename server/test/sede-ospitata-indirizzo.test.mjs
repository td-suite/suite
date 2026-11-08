// Sede OSPITATA = indirizzo della Legal entity ospitante (CEO, 08/11/2026): alla scelta dell'ospitante la sede prende il suo indirizzo,
// lo segue quando cambia, un indirizzo scritto a mano la stacca; D03b segnala e corregge le sedi ospitate con indirizzo diverso.
// Senza DATABASE_URL_TEST: saltato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

describe('sede ospitata: indirizzo della Legal entity ospitante (integrazione)', { skip: SALTA }, () => {
  let S, o; const id = {};
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const diag = async (k) => (await o.get(`/api/admin/diagnostica/${k}`)).j;
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    id.host = must(await o.post('/api/organizations', { name: 'Ospitante Test', kind: 'PARTNER', code: 'H1', address: 'Via Roma 1', zip: '50100', city: 'Firenze', province: 'FI' }), 'host').id;
  }, { timeout: 180000 });
  after(async () => { await S?.stop(); });

  test('la sede ospitata prende l\'indirizzo dell\'ospitante, lo segue e si stacca con un indirizzo a mano', async () => {
    const s = must(await o.post('/api/sites', { code: 'T-OSP', name: 'Corner Test', kind: 'PUNTO_PRELIEVI', tenure: 'OSPITATA', host_organization_id: id.host }), 'sede');
    assert.equal(s.address, 'Via Roma 1'); assert.equal(s.city, 'Firenze'); assert.equal(s.address_from_org, true);
    must(await o.put(`/api/organizations/${id.host}`, { address: 'Via Milano 2', zip: '50121', city: 'Firenze', province: 'FI' }), 'indirizzo ospitante');
    const dopo = (await o.get('/api/sites')).j.find((x) => x.id === s.id);
    assert.equal(dopo.address, 'Via Milano 2'); assert.equal(dopo.zip, '50121');
    const mano = must(await o.put(`/api/sites/${s.id}`, { address: 'Piazza Altra 3' }), 'indirizzo a mano');
    assert.equal(mano.address, 'Piazza Altra 3'); assert.equal(mano.address_from_org, false);
    const d = await diag('D03b');
    assert.equal(d.n, 1, 'D03b segnala la sede con indirizzo diverso');
    must(await o.post('/api/admin/diagnostica/D03b/correggi', { ids: [s.id], conferma: 'CORREGGI' }), 'D03b');
    assert.equal((await diag('D03b')).n, 0);
    const fine = (await o.get('/api/sites')).j.find((x) => x.id === s.id);
    assert.equal(fine.address, 'Via Milano 2'); assert.equal(fine.address_from_org, true);
  });
});
