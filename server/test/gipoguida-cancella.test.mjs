// Guida GIPO: cancellazione delle proprie domande e azzeramento generale (v0.71.2). Senza DATABASE_URL_TEST: saltato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SALTA, avviaSuite, datiProva } from './helpers/suiteTest.mjs';

describe('guida GIPO: cancella e azzera', { skip: SALTA }, () => {
  let S, D;
  before(async () => { S = await avviaSuite(); D = await datiProva(S.base); }, { timeout: 120000 });
  after(async () => { await S?.stop(); });

  test('cancello una mia domanda, poi tutte; la redazione azzera solo con la conferma', async () => {
    const a = await D.o.post('/api/gipoguida/chiedi', { domanda: 'come faccio una nota di credito?' });
    assert.equal(a.s, 200, a.text);
    await D.o.post('/api/gipoguida/chiedi', { domanda: 'come annullo un appuntamento?' });
    assert.equal((await D.o.get('/api/gipoguida/domande/mie')).j.length, 2);
    assert.equal((await D.o.del(`/api/gipoguida/domande/${a.j.id}`)).s, 200);
    assert.equal((await D.o.get('/api/gipoguida/domande/mie')).j.length, 1);
    assert.equal((await D.o.del('/api/gipoguida/domande/mie')).s, 200);
    assert.equal((await D.o.get('/api/gipoguida/domande/mie')).j.length, 0);
    await D.o.post('/api/gipoguida/chiedi', { domanda: 'come stampo la chiusura di cassa?' });
    assert.equal((await D.o.post('/api/gipoguida/redazione/azzera', { conferma: 'no' })).s, 400);
    const z = await D.o.post('/api/gipoguida/redazione/azzera', { conferma: 'AZZERA' });
    assert.equal(z.s, 200, z.text); assert.equal(z.j.domande, 1);
    assert.equal((await D.o.get('/api/gipoguida/domande/mie')).j.length, 0);
  });
});
