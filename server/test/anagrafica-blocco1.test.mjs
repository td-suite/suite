// Programma "anagrafica unica", blocco 1 (08/11/2026): la Suite vera su un database temporaneo (helpers/suiteTest.mjs). Dati "sporchi"
// preparati direttamente sul database di prova (stato di produzione prima delle correzioni), poi Diagnostica → Correggi → verde.
// Coperti: A0 (saveSite, audit con origine), A9 (proposta della Legal entity TD), A13 (D02, D04, D18a, D19 rossi e poi verdi),
// A1 (firma PP → sede ospitata, cessazione → sede chiusa), A11 (cessazione con accesso da amministratore), A3 (Prova ed Esegui).
// Senza DATABASE_URL_TEST: saltato.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

describe('anagrafica unica, blocco 1 (integrazione)', { skip: SALTA }, () => {
  let S, o, db; const id = {};
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const diag = async (k) => (await o.get(`/api/admin/diagnostica/${k}`)).j;
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    for (const k of ['business', 'cash']) must(await o.post(`/api/travaso/${k}/run`, {}), `avvio ${k}`);
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    id.td = must(await o.post('/api/organizations', { name: 'Toscana Diagnostica S.r.l.', kind: 'SOCIETA', code: 'TD', vat_number: '07528130482' }), 'td').id;
    id.p1 = must(await o.post('/api/organizations', { name: 'Partner Uno', kind: 'PARTNER', code: 'P1' }), 'p1').id;
    id.loc = must(await o.post('/api/organizations', { name: 'Locatore Test', kind: 'FORNITORE', code: 'L1' }), 'loc').id;
    id.lab = must(await o.post('/api/sites', { code: 'T-LAB', name: 'Lab Test', kind: 'LABORATORIO', tenure: 'LOCAZIONE', rent_amount: 5000, lease_start: '2025-01-01', lease_years: 6, lease_landlord_org_id: id.loc }), 'lab').id;
    id.pp = must(await o.post('/api/sites', { code: 'T-PP', name: 'Punto Test', kind: 'PUNTO_PRELIEVI' }), 'pp').id;
    must(await o.get('/api/business/state'), 'utente business');
  }, { timeout: 180000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('A0: sede ospitata senza ospitante rifiutata; audit SITE_UPDATED con origine', async () => {
    assert.equal((await o.post('/api/sites', { code: 'T-X', name: 'Sede X', tenure: 'OSPITATA' })).s, 400);
    must(await o.put(`/api/sites/${id.pp}`, { phone: '055 000' }), 'modifica');
    const a = (await db.query(`SELECT data FROM audit_log WHERE action='SITE_UPDATED' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [String(id.pp)])).rows[0];
    assert.equal(a.data.origine, 'Amministrazione > Sedi');
  });

  test('A9 + A13: D22a e D01 rossi, "Usa la proposta" e "Assegna" → verdi; le sedi nuove nascono di TD', async () => {
    assert.equal((await diag('D22a')).stato, 'BLOCCANTE');
    assert.equal((await diag('D01')).n, 2);
    assert.equal((await o.post('/api/admin/diagnostica/D22a/correggi', {})).s, 400, 'serve la conferma');
    must(await o.post('/api/admin/diagnostica/D22a/correggi', { conferma: 'CORREGGI' }), 'D22a');
    must(await o.post('/api/admin/diagnostica/D01/correggi', { ids: [id.lab, id.pp], conferma: 'CORREGGI' }), 'D01');
    assert.equal((await diag('D22a')).n, 0);
    assert.equal((await diag('D01')).n, 0);
    const nuova = must(await o.post('/api/sites', { code: 'T-NEW', name: 'Sede nuova', kind: 'PUNTO_PRELIEVI' }), 'nuova');
    assert.equal(nuova.organization_id, id.td);
  });

  test('A13: dati sporchi (ospitante mancante, nodo doppio, persona cessata) rossi → Correggi → verdi', async () => {
    const pers = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Cessatotest', first_name: 'Ciro', email: 'ciro.cessatotest@toscanadiagnostica.it' }), 'persona');
    await new Promise((r) => setTimeout(r, 1500));
    await db.query(`UPDATE sites SET tenure='OSPITATA' WHERE id=$1`, [id.pp]);
    await db.query(`INSERT INTO business.contracts (kind, protocol, status, proposal_date, org_id, site_id, created_by) VALUES ('PP','PP-T1','ATTIVO','2026-01-01',$1,$2,1)`, [id.p1, id.pp]);
    await db.query('DROP INDEX IF EXISTS org_units_sede_site_uq');
    await db.query(`INSERT INTO org_units (name, kind, site_id) VALUES ('Lab Test doppio','SEDE',$1)`, [id.lab]);
    await db.query(`UPDATE people SET status='CESSATO' WHERE id=$1`, [pers.id]);
    for (const k of ['D02', 'D04', 'D18a', 'D19']) assert.equal((await diag(k)).stato, 'BLOCCANTE', k);
    must(await o.post('/api/admin/diagnostica/D02/correggi', { ids: [id.pp], conferma: 'CORREGGI' }), 'D02');
    must(await o.post('/api/admin/diagnostica/D18a/correggi', { ids: [id.lab], conferma: 'CORREGGI' }), 'D18a');
    must(await o.post('/api/admin/diagnostica/D19/correggi', { ids: [pers.id], conferma: 'CORREGGI' }), 'D19');
    for (const k of ['D02', 'D04', 'D18a', 'D19']) assert.equal((await diag(k)).stato, 'OK', k);
    assert.ok((await db.query(`SELECT 1 FROM pg_indexes WHERE indexname='org_units_sede_site_uq'`)).rows[0], 'indice unico ricreato');
    assert.ok((await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action='DIAGNOSTICA_CORREZIONE'`)).rows[0].n >= 4);
  });

  test('A1: firma del contratto PP → sede ospitata dalla controparte; cessazione non rinnovata → sede chiusa', async () => {
    const s = must(await o.post('/api/sites', { code: 'T-PP2', name: 'Punto Due', kind: 'PUNTO_PRELIEVI' }), 'sede');
    const c = must(await o.post('/api/business/contracts', { kind: 'PP', org_id: id.p1, site_id: s.id, proposal_date: '2026-11-08', data: {} }), 'contratto');
    assert.equal(c.coerenza_sede.stato, 'DA_IMPOSTARE');
    assert.equal(must(await o.post(`/api/business/contracts/${c.id}/status`, { status: 'FIRMATO' }), 'firma').sede.esito, 'IMPOSTATA');
    let r = (await db.query('SELECT tenure, host_organization_id, active FROM sites WHERE id=$1', [s.id])).rows[0];
    assert.deepEqual([r.tenure, r.host_organization_id, r.active], ['OSPITATA', id.p1, true]);
    const x = must(await o.post(`/api/business/contracts/${c.id}/status`, { status: 'CESSATO', reason: 'non rinnovato', date: '2026-12-31' }), 'cessazione');
    assert.equal(x.sede.esito, 'CHIUSA');
    r = (await db.query(`SELECT active, to_char(closed_at,'YYYY-MM-DD') AS c FROM sites WHERE id=$1`, [s.id])).rows[0];
    assert.deepEqual([r.active, r.c], [false, '2026-12-31']);
    assert.equal((await o.post('/api/business/contracts', { kind: 'SEDE', site_id: s.id, proposal_date: '2026-11-08', data: {} })).s, 400, 'contratti SEDE non più creabili');
  });

  test('A11: cessazione manuale di un amministratore solo con conferma; accesso disattivato e incarichi chiusi', async () => {
    const p = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Admintest', first_name: 'Ada', email: 'ada.admintest@toscanadiagnostica.it' }), 'persona');
    await new Promise((r) => setTimeout(r, 1500));
    const uid = (await o.get(`/api/people/${p.id}`)).j.user_id;
    must(await o.put(`/api/users/${uid}`, { level: 'ADMIN' }), 'admin');
    const r1 = await o.put(`/api/people/${p.id}`, { status: 'CESSATO' });
    assert.equal(r1.s, 400); assert.equal(r1.j.details.richiede_conferma, 'conferma_disattivazione_admin');
    const r2 = must(await o.put(`/api/people/${p.id}`, { status: 'CESSATO', conferma_disattivazione_admin: true }), 'cessazione');
    assert.equal(r2.cessazione.utenti_disattivati.length, 1);
    assert.equal((await db.query('SELECT status FROM users WHERE id=$1', [uid])).rows[0].status, 'DISABLED');
  });

  test('A3: Prova senza scritture, Esegui stacca il fascicolo, porta il PDF, vale Sedi, cancella il contratto SEDE', async () => {
    const c = (await db.query(`INSERT INTO business.contracts (kind, protocol, status, proposal_date, start_date, org_id, site_id, created_by, data)
      VALUES ('SEDE','SEDE-T1','ATTIVO','2025-01-01','2025-01-01',$1,$2,1,'{"rent":{"amount":5500,"deposit":11000,"notice_months":12}}') RETURNING id`, [id.loc, id.lab])).rows[0];
    await db.query(`INSERT INTO business.contract_files (contract_id, category, filename, mime, size, sha256, data, version, uploaded_by) VALUES ($1,'FIRMATO','loc.pdf','application/pdf',8,'sha-t1',convert_to('%PDF-1.4','UTF8'),1,1)`, [c.id]);
    const d = (await db.query(`INSERT INTO business.dossiers (contract_id, org_id, site_id, created_by) VALUES ($1,$2,$3,1) RETURNING id`, [c.id, id.loc, id.lab])).rows[0];
    const prova = must(await o.get('/api/admin/migrazioni/sede-business'), 'prova');
    assert.equal(prova.contratti[0].confronto.find((x) => x.campo === 'rent_amount').azione, 'diverso: vale Sedi');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM business.contracts WHERE kind='SEDE'`)).rows[0].n, 1, 'la prova non scrive');
    assert.equal((await o.post('/api/admin/migrazioni/sede-business', {})).s, 400, 'serve la conferma');
    const out = must(await o.post('/api/admin/migrazioni/sede-business', { conferma: 'ESEGUI' }), 'esegui');
    assert.equal(out.verifiche.contratti_sede, 0);
    assert.equal(out.verifiche.firmati_in_sedi, 1);
    const site = (await db.query('SELECT rent_amount, deposit_amount, lease_notice_months FROM sites WHERE id=$1', [id.lab])).rows[0];
    assert.deepEqual([Number(site.rent_amount), Number(site.deposit_amount), site.lease_notice_months], [5000, 11000, 12]);
    const dos = (await db.query('SELECT contract_id, site_id FROM business.dossiers WHERE id=$1', [d.id])).rows[0];
    assert.deepEqual([dos.contract_id, dos.site_id], [null, id.lab]);
    assert.ok((await db.query(`SELECT 1 FROM audit_log WHERE action='BUSINESS_SEDE_MIGRATED' AND entity_id=$1`, [String(c.id)])).rows[0]);
  });
});
