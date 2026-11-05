// Perimetri degli accessi (debug pre-produzione, script 05_perimetri portato nei test, L9): la Suite vera su un database temporaneo
// (helpers/suiteTest.mjs), un partner ospitante, un cliente service, un dipendente senza grant. Senza DATABASE_URL_TEST: saltato.
// Coperti: B3 (il profilo non allarga il perimetro), A2 (l'editor Rubrica non tocca la Legal entity, un esterno resta esterno),
// M10 (rubrica senza cellulari senza il widget), perimetro di sedi, Legal entity e bacheca, amministrazione negata, CSRF e sessione.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SALTA, avviaSuite, client, datiProva, entra } from './helpers/suiteTest.mjs';

describe('perimetri degli accessi (integrazione)', { skip: SALTA }, () => {
  let S, D;
  before(async () => { S = await avviaSuite(); D = await datiProva(S.base); }, { timeout: 120000 });
  after(async () => { await S?.stop(); });

  test('B3: PUT /api/auth/me con site_id di un altro cliente è rifiutato e il perimetro non cambia', async () => {
    const r = await D.partner.put('/api/auth/me', { site_id: D.site.sv2 });
    assert.equal(r.s, 403);
    const me = await D.partner.get('/api/auth/me');
    assert.ok(!me.j.user.site_ids.includes(D.site.sv2));
    const sites = await D.partner.get('/api/sites');
    assert.ok(!sites.text.includes('T-SV2'));
    const posts = await D.partner.get('/api/community/posts');
    assert.ok(!posts.text.includes('MARCATORE-'), 'nessun post INTERNAL, ORGS o SITES altrui');
  });

  test('B3: livello, Legal entity e ruoli non si cambiano dal profilo; i campi personali sì', async () => {
    assert.equal((await D.cliente.put('/api/auth/me', { level: 'ADMIN', organization_id: D.org.td })).s, 403);
    assert.equal((await D.cliente.put('/api/auth/me', { phone: '+39 000 0000000', lang: 'it' })).s, 200);
    const me = await D.cliente.get('/api/auth/me');
    assert.equal(me.j.user.level, 'USER');
    assert.equal(me.j.user.is_external, true);
  });

  test('perimetro degli esterni: sedi, Legal entity, rubrica, organigramma', async () => {
    for (const c of [D.partner, D.cliente]) {
      const s = await c.get('/api/sites?all=1');
      assert.ok(!s.text.includes('T-SV2') && !s.text.includes('T-HQ'));
      const o = await c.get('/api/organizations');
      assert.ok(!o.text.includes('Cliente Test Due'));
      const p = await c.get('/api/people');
      assert.ok(!p.text.includes('333 1111111'), 'niente cellulari personali');
      assert.notEqual((await c.get('/api/people/org-chart')).s, 200);
    }
  });

  test('amministrazione e lavori negati agli esterni', async () => {
    for (const p of ['/api/users', '/api/jobs', '/api/audit', '/api/settings', '/api/access-profiles', '/api/consensi/riepilogo']) {
      const r = await D.cliente.get(p);
      assert.ok([403, 404].includes(r.s), `${p} → ${r.s}`);
    }
    assert.notEqual((await D.cliente.post('/api/jobs/search:reindex/run', {})).s, 200);
  });

  test('A2: l\'editor Rubrica non cambia la Legal entity; l\'amministratore sì ma l\'esterno resta esterno', async () => {
    const pid = D.acc.partner.person_id;
    // un dipendente con il profilo Rubrica "Aggiornamento schede"
    const pe = (await D.o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Editortest', first_name: 'Elio', email: 'elio.editor@toscanadiagnostica.it' })).j;
    await new Promise((r) => setTimeout(r, 1200));
    const uid = (await D.o.get(`/api/people/${pe.id}`)).j.user_id;
    assert.ok(uid, 'account automatico per l\'email aziendale');
    await D.o.put(`/api/users/${uid}`, { auth_provider: 'BOTH' });
    const rp = await D.o.post(`/api/users/${uid}/reset-password`, {});
    assert.ok(rp.j.temporaryPassword, 'con la posta in registro la password provvisoria torna all\'amministratore (L13)');
    await D.o.put(`/api/users/${uid}/grants/rubrica`, { profile: 'EDITOR' });
    const ed = await entra(client(S.base), 'elio.editor@toscanadiagnostica.it', rp.j.temporaryPassword, 'Editor-Test-2026x');
    assert.equal((await ed.put(`/api/people/${pid}`, { organization_id: D.org.td })).s, 403);
    assert.equal((await ed.put(`/api/people/${pid}`, { phone_office: '055 0000009' })).s, 200);
    assert.equal((await D.o.put(`/api/people/${pid}`, { organization_id: D.org.td })).s, 200);
    const me = await D.partner.get('/api/auth/me');
    assert.equal(me.j.user.is_external, true);
    assert.ok(!(await D.partner.get('/api/community/posts')).text.includes('MARCATORE-INTERNO'));
    await D.o.put(`/api/people/${pid}`, { organization_id: D.org.p1 });
  });

  test('M10: un interno senza il widget Rubrica non legge i cellulari personali', async () => {
    const uid = (await D.o.get(`/api/people/${D.person.interno}`)).j.user_id;
    await D.o.put(`/api/users/${uid}`, { auth_provider: 'BOTH' });
    for (const m of ['rubrica', 'cartella', 'ticket', 'circolari', 'sgi', 'room', 'retail']) await D.o.del(`/api/users/${uid}/grants/${m}`);
    const rp = await D.o.post(`/api/users/${uid}/reset-password`, {});
    const c = await entra(client(S.base), 'ivo.internotest@toscanadiagnostica.it', rp.j.temporaryPassword, 'Interno-Test-2026x');
    const r = await c.get('/api/people');
    assert.equal(r.s, 200);
    assert.ok(!r.text.includes('333 1111111'));
  });

  test('CSRF, sessione anonima e logout', async () => {
    assert.equal((await D.cliente.post('/api/community/posts', { body: 'x' }, { csrf: false })).s, 403);
    assert.equal((await client(S.base).get('/api/people')).s, 401);
    const c = await entra(client(S.base), 'ciro.cliente@cliente-test.test', D.acc.cliente.temporaryPassword, D.PW);
    const prima = c.cookie;
    await c.post('/api/auth/logout', {});
    const dopo = client(S.base); dopo.cookie = prima;
    assert.equal((await dopo.get('/api/auth/me')).s, 401);
  });

  test('M1: id non numerici, numeri enormi e NUL nei testi rispondono 4xx, mai 500', async () => {
    for (const p of ['/api/people/abc', '/api/people/99999999999', '/api/users?page=abc', '/api/people?site_id=abc']) {
      const r = await D.o.get(p);
      assert.ok(r.s >= 400 && r.s < 500, `${p} → ${r.s}`);
      assert.ok(!/22P02|22003/.test(r.text), 'nessun codice SQLSTATE nella risposta (L3)');
    }
    const r = await D.o.post('/api/community/posts', { body: 'testo con NUL \u0000 dentro', audience: { type: 'ALL' } });
    assert.equal(r.s, 201);
  });
});
