// Attivazione di un widget per più utenti con lo stesso profilo (POST /api/users/grants/massa, v0.69.1). Senza DATABASE_URL_TEST: saltato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SALTA, avviaSuite, datiProva } from './helpers/suiteTest.mjs';

describe('utenti: attivazione multipla di un widget', { skip: SALTA }, () => {
  let S, D, ids, mod, prof, scoped;
  before(async () => {
    S = await avviaSuite(); D = await datiProva(S.base);
    const us = (await D.o.get('/api/users?per_page=200')).j;
    const rows = us.users || us.rows || us.items || us;
    ids = rows.filter((u) => /partner|cliente/.test(u.email)).map((u) => u.id);
    const mods = (await D.o.get('/api/modules')).j;
    mod = (mods.modules || mods).find((m) => m.key !== 'admin' && !m.restricted && (m.profiles || []).length >= 2 && (m.profiles || []).some((p) => !p.scoped));
    prof = mod.profiles.find((p) => !p.scoped); scoped = mod.profiles.find((p) => p.scoped);
  }, { timeout: 120000 });
  after(async () => { await S?.stop(); });

  test('attiva per tutti, poi salta chi ha un profilo diverso, poi sostituisce', async () => {
    assert.equal(ids.length, 2);
    const r1 = await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: prof.key });
    assert.equal(r1.s, 200, r1.text);
    assert.equal(r1.j.attivati.length + r1.j.aggiornati.length + r1.j.invariati.length, 2);
    const r2 = await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: prof.key });
    assert.equal(r2.j.invariati.length, 2);
    const altro = mod.profiles.find((p) => p.key !== prof.key && !p.scoped);
    if (altro) {
      const r3 = await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: altro.key });
      assert.equal(r3.j.saltati.length, 2);
      const r4 = await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: altro.key, sovrascrivi: true });
      assert.equal(r4.j.aggiornati.length, 2);
    }
  });

  test('profilo con ambito senza sedi rifiutato; modulo admin rifiutato; non amministratore rifiutato', async () => {
    if (scoped) assert.equal((await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: scoped.key })).s, 400);
    assert.equal((await D.o.post('/api/users/grants/massa', { user_ids: ids, module_key: 'admin', profile: 'ADMIN' })).s, 400);
    assert.equal((await D.cliente.post('/api/users/grants/massa', { user_ids: ids, module_key: mod.key, profile: prof.key })).s, 403);
  });
});
