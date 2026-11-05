// Autenticazione e sessione (debug pre-produzione, script 06_sessione portato nei test, L9): la Suite vera su un database temporaneo.
// Coperti: B2 (con il solo primo fattore non si tocca il TOTP né la password; la disattivazione chiede password e codice), B3/PUT /me
// prima del cambio password, L14 (presa d'atto verificata dal server), L11 (il cambio password chiude le altre sessioni), blocco
// dopo 5 errori, M3 (il rate limit non blocca chi entra correttamente), M4 (ritorno dopo Microsoft 365 solo su percorsi interni).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { SALTA, avviaSuite, client, datiProva, entra } from './helpers/suiteTest.mjs';
import { percorsoInterno } from '../src/routes/auth.js';

test('M4: percorsoInterno ammette solo percorsi della Suite', () => {
  assert.equal(percorsoInterno('/nc/nc/3?x=1#a'), '/nc/nc/3?x=1#a');
  for (const x of ['//esempio.test', '/\\esempio.test', 'https://esempio.test', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x', '', null, '/\u0000x']) {
    const p = percorsoInterno(x);
    assert.ok(p === '/' || (p.startsWith('/') && !p.startsWith('//') && !p.includes('\\')), `${x} → ${p}`);
  }
  assert.equal(percorsoInterno('//esempio.test'), '/');
  assert.equal(percorsoInterno('/\\esempio.test'), '/');
});

describe('autenticazione e sessione (integrazione)', { skip: SALTA }, () => {
  let S, D;
  before(async () => { S = await avviaSuite(); D = await datiProva(S.base); }, { timeout: 120000 });
  after(async () => { await S?.stop(); });

  test('B2: con il TOTP in sospeso non si cambia il segreto, non si disattiva, non si tocca il profilo', async () => {
    const email = 'pia.partner@farmacia-test.test';
    let c = await entra(client(S.base), email, D.acc.partner.temporaryPassword, D.PW);
    const st = await c.post('/api/auth/totp/setup', {});
    assert.equal(st.s, 200);
    assert.equal((await c.post('/api/auth/totp/enable', { code: authenticator.generate(st.j.secret) })).s, 200);
    await c.post('/api/auth/logout', {});
    c = client(S.base);
    const l = await c.login(email, D.PW);
    assert.equal(l.j.totpRequired, true);
    assert.equal((await c.get('/api/people')).s, 403);
    assert.equal((await c.post('/api/auth/totp/setup', {})).s, 403);
    assert.equal((await c.post('/api/auth/totp/disable', { password: D.PW, code: '000000' })).s, 403);
    assert.equal((await c.put('/api/auth/me', { bio: 'senza secondo fattore' })).s, 403);
    assert.equal((await c.post('/api/auth/change-password', { currentPassword: D.PW, newPassword: 'Altra-Password-2026x' })).s, 403);
    // con il codice la sessione si completa
    assert.equal((await c.post('/api/auth/totp/verify', { code: authenticator.generate(st.j.secret) })).s, 200);
    assert.equal((await c.get('/api/auth/me')).s, 200);
  });

  test('B2: disattivazione con password e codice valido, rifiutata con la sola password', async () => {
    const email = 'ciro.cliente@cliente-test.test';
    const c = await entra(client(S.base), email, D.acc.cliente.temporaryPassword, D.PW);
    const st = await c.post('/api/auth/totp/setup', {});
    assert.equal((await c.post('/api/auth/totp/enable', { code: authenticator.generate(st.j.secret) })).s, 200);
    assert.equal((await c.post('/api/auth/totp/disable', { password: D.PW })).s, 400);
    assert.equal((await c.post('/api/auth/totp/disable', { password: D.PW, code: authenticator.generate(st.j.secret) === '000000' ? '111111' : '000000' })).s, 400);
    assert.equal((await c.post('/api/auth/totp/disable', { password: D.PW, code: authenticator.generate(st.j.secret) })).s, 200);
  });

  test('nuovo accesso esterno: PUT /me negato prima del cambio password; API negate senza presa d\'atto (L14)', async () => {
    const nu = (await D.o.post(`/api/organizations/${D.org.p1}/external-access`, { last_name: 'Nuovotest', first_name: 'Nino', email: 'nino.nuovo@farmacia-test.test', profile_key: 'PARTNER_OSPITANTE', send_invite: false })).j;
    const c = client(S.base);
    const l = await c.login('nino.nuovo@farmacia-test.test', nu.temporaryPassword);
    assert.equal(l.j.mustChangePassword, true);
    assert.equal((await c.put('/api/auth/me', { bio: 'prima del cambio' })).s, 403);
    assert.equal((await c.post('/api/auth/change-password', { currentPassword: nu.temporaryPassword, newPassword: 'corta' })).s, 400);
    assert.equal((await c.post('/api/auth/change-password', { currentPassword: nu.temporaryPassword, newPassword: 'Nuova-Password-2026x' })).s, 200);
    const r = await c.get('/api/people');
    assert.equal(r.s, 403);
    assert.equal(r.j.code, 'CONSENSI_RICHIESTI');
    const me = await c.get('/api/auth/me');
    await c.post('/api/consensi/accetta', { documenti: me.j.user.consensi_da_accettare });
    assert.equal((await c.get('/api/people')).s, 200);
  });

  test('L11: il cambio password chiude le altre sessioni dello stesso utente', async () => {
    const nu = (await D.o.post(`/api/organizations/${D.org.c1}/external-access`, { last_name: 'Sessionitest', first_name: 'Sara', email: 'sara.sessioni@cliente-test.test', profile_key: 'CLIENTE_SERVICE', send_invite: false })).j;
    const a = await entra(client(S.base), 'sara.sessioni@cliente-test.test', nu.temporaryPassword, 'Prima-Password-2026x');
    const b = await entra(client(S.base), 'sara.sessioni@cliente-test.test', nu.temporaryPassword, 'Prima-Password-2026x');
    assert.equal((await b.get('/api/auth/me')).s, 200);
    assert.equal((await a.post('/api/auth/change-password', { currentPassword: 'Prima-Password-2026x', newPassword: 'Seconda-Password-2026x' })).s, 200);
    assert.equal((await a.get('/api/auth/me')).s, 200, 'la sessione corrente resta');
    assert.equal((await b.get('/api/auth/me')).s, 401, 'l\'altra sessione è chiusa');
  });

  test('blocco dopo 5 errori e rate limit che non blocca gli accessi corretti di altri utenti (M3)', async () => {
    const nu = (await D.o.post(`/api/organizations/${D.org.p1}/external-access`, { last_name: 'Bloccotest', first_name: 'Bea', email: 'bea.blocco@farmacia-test.test', profile_key: 'PARTNER_OSPITANTE', send_invite: false })).j;
    const c = client(S.base);
    for (let i = 0; i < 6; i++) await c.login('bea.blocco@farmacia-test.test', `Sbagliata-${i}`);
    assert.equal((await c.login('bea.blocco@farmacia-test.test', nu.temporaryPassword)).s, 423);
    const codici = [];
    for (let i = 0; i < 27; i++) codici.push((await client(S.base).login('nessuno@esempio.test', 'Qualsiasi-1234')).s);
    assert.ok(codici.includes(429), 'limite per coppia IP + email');
    const ok = await client(S.base).login('ciro.cliente@cliente-test.test', D.PW);
    assert.equal(ok.s, 200, 'un altro utente dallo stesso IP entra');
  });
});
