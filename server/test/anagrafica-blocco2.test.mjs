// Programma "anagrafica unica", blocco 2 (08/11/2026). Parte pura (sempre): orari di ritiro, codice della sede SERVICE, strutture del
// gruppo attivate, Legal entity cliente del Portale. Parte d'integrazione (con DATABASE_URL_TEST, la Suite vera su un database
// temporaneo, helpers/suiteTest.mjs): A5 clienti attivi e contrattualizzati (SRV e MDL), A7 sede SERVICE alla contrattualizzazione e
// "Crea le sedi SERVICE mancanti", indirizzo ereditato, codice StudioLAB, A4 strutture di Ordini e NC solo clienti, profili di accesso
// che sostituiscono i permessi e assegnano la sede.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { orariRitiro, codiceSedeService, strutturaAttivata } from '../src/lib/clienti.js';
import { legalEntityClienteService, riconosciClienteService } from '../src/lib/esterni.js';
import { SALTA, avviaSuite, client, entra, OWNER } from './helpers/suiteTest.mjs';

describe('anagrafica unica, blocco 2 (funzioni pure)', () => {
  test('orari di ritiro del contratto Service → orari della sede e testo', () => {
    const r = orariRitiro([{ mode: 'FISSO', time_from: '8:00', time_to: '10:30' }, { mode: 'CHIAMATA' }, { mode: 'NO' }, { mode: 'FISSO', time_from: '09.00' }]);
    assert.deepEqual(r.json, { mon: [{ from: '08:00', to: '10:30' }] });
    assert.equal(r.testo, 'Ritiro campioni: lunedì 08:00-10:30; martedì a chiamata; giovedì dalle 09:00');
    assert.deepEqual(orariRitiro([]), { json: null, testo: null });
    assert.deepEqual(orariRitiro(undefined), { json: null, testo: null });
  });
  test('codice della sede SERVICE: dalla Legal entity, progressivo, MDL', () => {
    assert.equal(codiceSedeService({ id: 7, code: 'abc d' }), 'SRV-ABC-D');
    assert.equal(codiceSedeService({ id: 7, code: null }, 2), 'SRV-7-2');
    assert.equal(codiceSedeService({ id: 9 }, 0, 'MDL'), 'MDL-9');
  });
  test('struttura del gruppo attivata: fase 6/7 del DB o punto del contratto', () => {
    assert.equal(strutturaAttivata({ nome: 'A', fase: '7. Attivo' }).si, true);
    assert.equal(strutturaAttivata({ nome: 'A', fase: '5. In Negoziazione' }).si, false);
    assert.equal(strutturaAttivata({ nome: 'RSA Gli Alberi', fase: '0. Prospect' }, ['rsa gli alberi ']).si, true);
  });
  test('Portale: cliente del servizio anche senza sede SERVICE se è in clienti_attivi_v', () => {
    assert.equal(legalEntityClienteService({ kind: 'CLIENTE', sediService: 0 }), false);
    assert.equal(legalEntityClienteService({ kind: 'CLIENTE', sediService: 0, livello: 'CONTRATTUALIZZATO' }), true);
    assert.equal(legalEntityClienteService({ kind: 'PARTNER', sediService: 0, livello: 'ATTIVO' }), false);
    assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: ['CLIENTE_SERVICE'], livello: 'ATTIVO' }), true);
  });
});

describe('anagrafica unica, blocco 2 (integrazione)', { skip: SALTA }, () => {
  let S, o, db; const id = {};
  const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };
  const diag = async (k) => (await o.get(`/api/admin/diagnostica/${k}`)).j;
  const org = async (b) => must(await o.post('/api/organizations', { kind: 'CLIENTE', ...b }), `org ${b.name}`).id;
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    for (const k of ['business', 'orders', 'nc']) must(await o.post(`/api/travaso/${k}/run`, {}), `avvio ${k}`);
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    must(await o.get('/api/business/state'), 'utente business');
    id.td = must(await o.post('/api/organizations', { name: 'Toscana Diagnostica S.r.l.', kind: 'SOCIETA', code: 'TD', vat_number: '07528130482' }), 'td').id;
    id.srv = await org({ name: 'Cliente Service Prova', code: 'CSP', address: 'Via Uno 1', zip: '50100', city: 'Firenze', province: 'FI', vat_number: '01111111111', pec: 'csp@pec.test' });
    id.mdl = await org({ name: 'Azienda MdL Prova', code: 'AMP', address: 'Via Due 2', city: 'Prato', province: 'PO', vat_number: '02222222222', pec: 'amp@pec.test' });
    id.att = await org({ name: 'Cliente Attivo Senza Sede', code: 'CAS', address: 'Via Tre 3', city: 'Pisa', province: 'PI' });
    id.pro = await org({ name: 'Prospect Qualsiasi', code: 'PRQ', city: 'Lucca' });
    for (const [k, linea] of [['srv', 'SRV'], ['mdl', 'MDL'], ['att', 'SRV'], ['pro', 'SRV']]) id[`a_${k}`] = must(await o.post('/api/business/hub/accounts', { linea, organization_id: id[k] }), `account ${k}`).id;
    for (const k of ['srv', 'mdl']) must(await o.put(`/api/business/organizations/${id[k]}/ext`, { legal_rep: 'Rappresentante Prova' }), `ext ${k}`);
    id.pp = must(await o.post('/api/sites', { code: 'T-PP', name: 'Punto Test', kind: 'PUNTO_PRELIEVI', city: 'Firenze' }), 'pp').id;
  }, { timeout: 180000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const firmato = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const caricaFirmato = async (contrattoId, data) => {
    const fd = new FormData();
    fd.append('files', new Blob([firmato], { type: 'application/pdf' }), 'firmato.pdf'); fd.append('category', 'FIRMATO'); fd.append('signed_at', data);
    const r = await fetch(`${S.base}/api/business/contracts/${contrattoId}/files`, { method: 'POST', headers: { 'X-Requested-With': 'td-suite', cookie: o.cookie }, body: fd });
    if (r.status >= 300) throw new Error(`caricamento firmato: ${r.status} ${await r.text()}`);
    return r.json();
  };

  test('A4: prima dei contratti nessuna Legal entity tra le strutture attive di Ordini e NC (D20 verde)', async () => {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders.strutture_v WHERE origin='ORG' AND active`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM nc.sedi_v WHERE origin='ORG' AND attiva`)).rows[0].n, 0);
    assert.equal((await diag('D20')).stato, 'OK');
  });

  test('A5 + A7: contrattualizzazione Service → sede SERVICE con indirizzo della Legal entity e orari di ritiro; cliente in Ordini e NC', async () => {
    const c = must(await o.post('/api/business/contracts', { kind: 'SRV', org_id: id.srv, proposal_date: '2026-11-01', data: { pickup: { days: [{ mode: 'FISSO', time_from: '08:00', time_to: '10:00' }] } } }), 'contratto SRV');
    must(await o.post(`/api/business/contracts/${c.id}/generate`, {}), 'proposta SRV');
    await caricaFirmato(c.id, '2026-11-07');
    const s = (await db.query(`SELECT * FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.srv])).rows;
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].name, s[0].address, s[0].city, s[0].address_from_org, s[0].code], ['Cliente Service Prova', 'Via Uno 1', 'Firenze', true, 'SRV-CSP']);
    assert.deepEqual(s[0].opening_hours_json, { mon: [{ from: '08:00', to: '10:00' }] });
    const v = (await db.query('SELECT livello, fonte FROM clienti_attivi_v WHERE org_id=$1', [id.srv])).rows[0];
    assert.deepEqual([v.livello, v.fonte], ['CONTRATTUALIZZATO', 'CONTRATTUALIZZAZIONE']);
    assert.equal((await db.query('SELECT active FROM orders.strutture_v WHERE id=$1', [-id.srv])).rows[0].active, true);
    assert.equal((await db.query('SELECT attiva FROM nc.sedi_v WHERE id=$1', [-id.srv])).rows[0].attiva, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders.strutture_v WHERE id=$1', [-id.pro])).rows[0].n, 0, 'il prospect non è una struttura');
    const a = must(await o.get(`/api/business/hub/accounts/${id.a_srv}`), 'account');
    assert.equal(a.prospect, false); assert.ok(a.fase_corrente >= 6); assert.equal(a.cliente_livello, 'CONTRATTUALIZZATO');
  });

  test('A7 (d): cambio d\'indirizzo della Legal entity → sede SERVICE ereditata aggiornata; indirizzo a mano → non segue più', async () => {
    const r = must(await o.put(`/api/organizations/${id.srv}`, { address: 'Via Nuova 9' }), 'indirizzo');
    assert.equal(r.sedi_service_allineate, 1);
    const sid = (await db.query(`SELECT id, address FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.srv])).rows[0];
    assert.equal(sid.address, 'Via Nuova 9');
    assert.equal((await db.query(`SELECT data->>'origine' AS o FROM audit_log WHERE action='SITE_UPDATED' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [String(sid.id)])).rows[0].o, 'Amministrazione > Legal entity (indirizzo)');
    must(await o.put(`/api/sites/${sid.id}`, { address: 'Via del Punto 4' }), 'indirizzo a mano');
    assert.equal((await db.query('SELECT address_from_org FROM sites WHERE id=$1', [sid.id])).rows[0].address_from_org, false);
    must(await o.put(`/api/organizations/${id.srv}`, { address: 'Via Altra 1' }), 'indirizzo 2');
    assert.equal((await db.query('SELECT address FROM sites WHERE id=$1', [sid.id])).rows[0].address, 'Via del Punto 4');
  });

  test('A7 (c): codice StudioLAB dalla scheda account nella sede; doppione rifiutato; D15c', async () => {
    const a = must(await o.put(`/api/business/hub/accounts/${id.a_srv}/studiolab`, { codice: 'SL-100' }), 'codice');
    assert.equal(a.codice_studiolab, 'SL-100');
    assert.equal((await db.query(`SELECT studiolab_code FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.srv])).rows[0].studiolab_code, 'SL-100');
    assert.equal((await o.put(`/api/business/hub/accounts/${id.a_att}/studiolab`, { codice: 'sl-100' })).s, 400);
    must(await o.put(`/api/business/hub/accounts/${id.a_att}/studiolab`, { codice: 'SL-200' }), 'codice in attesa');
    assert.equal((await db.query('SELECT studiolab_code FROM business.accounts WHERE id=$1', [id.a_att])).rows[0].studiolab_code, 'SL-200');
  });

  test('A5: Medicina del Lavoro firmata → contrattualizzata, fase 6, sede SERVICE MDL-', async () => {
    const c = must(await o.post('/api/business/contracts', { kind: 'MDL', org_id: id.mdl, proposal_date: '2026-11-02', data: {} }), 'contratto MDL');
    must(await o.post(`/api/business/contracts/${c.id}/generate`, {}), 'proposta MDL');
    await caricaFirmato(c.id, '2026-11-05');
    const v = (await db.query(`SELECT livello, linea, to_char(dal,'YYYY-MM-DD') AS dal FROM clienti_attivi_v WHERE org_id=$1`, [id.mdl])).rows[0];
    assert.deepEqual([v.linea, v.livello, v.dal], ['MDL', 'CONTRATTUALIZZATO', '2026-11-05']);
    const a = (await db.query('SELECT prospect, fase_corrente, contrattualizzato_at FROM business.accounts WHERE id=$1', [id.a_mdl])).rows[0];
    assert.equal(a.prospect, false); assert.equal(a.fase_corrente, 6); assert.ok(a.contrattualizzato_at);
    assert.equal((await db.query(`SELECT code FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.mdl])).rows[0].code, 'MDL-AMP');
  });

  test('A7 (b): cliente attivo senza sede → D13 rosso; "Crea le sedi SERVICE mancanti" (Prova, Esegui, idempotente) → verde', async () => {
    must(await o.put(`/api/business/hub/accounts/${id.a_att}/attivo`, { attivo: true, dal: '2026-10-01' }), 'cliente attivo');
    const d13 = await diag('D13');
    assert.equal(d13.stato, 'BLOCCANTE'); assert.deepEqual(d13.righe.map((r) => r.id), [id.att]);
    const prova = must(await o.get('/api/admin/migrazioni/sedi-service'), 'prova');
    assert.deepEqual(prova.piano.map((p) => [p.org_id, p.tipo, p.esito]), [[id.att, 'LEGAL_ENTITY', 'da creare']]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM sites WHERE organization_id=$1`, [id.att])).rows[0].n, 0, 'la prova non scrive');
    assert.equal((await o.post('/api/admin/migrazioni/sedi-service', {})).s, 400, 'serve la conferma');
    const es = must(await o.post('/api/admin/migrazioni/sedi-service', { conferma: 'ESEGUI' }), 'esegui');
    assert.equal(es.creati, 1);
    const s = (await db.query(`SELECT address, city, studiolab_code, address_from_org FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.att])).rows[0];
    assert.deepEqual([s.address, s.city, s.studiolab_code, s.address_from_org], ['Via Tre 3', 'Pisa', 'SL-200', true], 'indirizzo della Legal entity e codice in attesa');
    assert.equal(must(await o.post('/api/admin/migrazioni/sedi-service', { conferma: 'ESEGUI' }), 'di nuovo').creati, 0);
    assert.equal((await diag('D13')).stato, 'OK');
    assert.equal((await db.query(`SELECT livello FROM clienti_attivi_v WHERE org_id=$1`, [id.att])).rows[0].livello, 'ATTIVO');
  });

  test('D12: contratto vigente con account ancora prospect → Segna contrattualizzati → verde', async () => {
    await db.query(`INSERT INTO business.contracts (kind, protocol, status, proposal_date, signed_at, org_id, created_by) VALUES ('SRV','SRV-T9','ATTIVO','2026-01-01','2026-01-10',$1,1)`, [id.pro]);
    assert.equal((await diag('D12')).stato, 'BLOCCANTE');
    must(await o.post('/api/admin/diagnostica/D12/correggi', { ids: [id.a_pro], conferma: 'CORREGGI' }), 'D12');
    assert.equal((await diag('D12')).stato, 'OK');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [id.pro])).rows[0].n, 1);
  });

  test('PROFILI: il profilo sostituisce il permesso manuale e assegna la sede; senza sede avviso con il link', async () => {
    const p1 = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Consede', first_name: 'Ugo', email: 'ugo.consede@toscanadiagnostica.it', site_id: id.pp, organization_id: id.td }), 'persona 1');
    const p2 = must(await o.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Senzasede', first_name: 'Ada', email: 'ada.senzasede@toscanadiagnostica.it', organization_id: id.td }), 'persona 2');
    await new Promise((r) => setTimeout(r, 1500));
    const u1 = (await o.get(`/api/people/${p1.id}`)).j.user_id; const u2 = (await o.get(`/api/people/${p2.id}`)).j.user_id;
    must(await o.put(`/api/users/${u1}/grants/nc`, { profile: 'ADMIN', scopes: [] }), 'grant manuale');
    const prof = must(await o.post('/api/access-profiles', { name: 'Sede di prova', items: [{ module_key: 'nc', profile: 'SEDE' }] }), 'profilo');
    // senza la spunta (merge) il permesso manuale resta
    const m = must(await o.post(`/api/access-profiles/${prof.id}/apply`, { user_ids: [u1], mode: 'merge' }), 'merge');
    assert.equal(m.rows[0].sostituiti.length, 0);
    assert.equal((await db.query(`SELECT profile FROM grants WHERE user_id=$1 AND module_key='nc'`, [u1])).rows[0].profile, 'ADMIN');
    // predefinito: sovrascrivi
    const r = must(await o.post(`/api/access-profiles/${prof.id}/apply`, { user_ids: [u1, u2] }), 'sovrascrivi');
    assert.equal(r.mode, 'sovrascrivi');
    const riga1 = r.rows.find((x) => x.user_id === u1);
    assert.deepEqual(riga1.sostituiti.map((x) => [x.da, x.a]), [['ADMIN', 'SEDE']]);
    assert.equal(riga1.ambito_sede.id, id.pp);
    const g = (await db.query(`SELECT g.profile, g.source, array_agg(s.scope_id) AS sc FROM grants g LEFT JOIN grant_scopes s ON s.grant_id=g.id WHERE g.user_id=$1 AND g.module_key='nc' GROUP BY g.id`, [u1])).rows[0];
    assert.deepEqual([g.profile, g.source, g.sc], ['SEDE', 'PROFILE', [id.pp]]);
    assert.deepEqual(r.sede_mancante.map((x) => [x.user_id, x.link]), [[u2, '/admin/people?q=Senzasede']]);
    assert.ok(!r.warnings.some((w) => /lasciato/.test(w)), 'nessun "lasciato"');
  });
});
