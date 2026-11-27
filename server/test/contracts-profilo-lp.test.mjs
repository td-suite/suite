// Gestione del Personale, profilo LP (liberi professionisti: dalla v0.99.12 li GESTISCE, non è più in sola lettura): nessun dato dei
// dipendenti da nessuna route del modulo (elenco chiuso), scritture solo sui liberi professionisti, estratto Excel dei soli LP con TUTTI i compensi (non solo il fisso). Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Contratti del personale: profilo LP', { skip: SALTA }, () => {
  let H, S, db, O, L, ids = {};
  const PW = 'Prova-ProfiloLp-2026x';
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    const bcrypt = (await import('bcryptjs')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
    const persona = async (last, first, kind) => (await db.query(`INSERT INTO people (kind, status, last_name, first_name, email) VALUES ($1,'ATTIVO',$2,$3,$4) RETURNING id`,
      [kind, last, first, `${first}.${last}@toscanadiagnostica.it`.toLowerCase()])).rows[0].id;
    ids.dip = await persona('Dipendentetest', 'Dora', 'DIPENDENTE');
    ids.fisso = await persona('Fissotest', 'Fabio', 'LP');
    ids.orario = await persona('Orariotest', 'Olga', 'MEDICO');
    await db.query(`INSERT INTO contracts.lp_contracts (resource_id, discipline, est_monthly_cost, fees) VALUES ($1,'Biologia',2000,$2)`, [ids.fisso,
      JSON.stringify([{ type: 'FISSO', description: 'Compenso mensile', amount: 2000, vat: 'SENZA' }])]);
    await db.query(`INSERT INTO contracts.lp_contracts (resource_id, discipline, fees) VALUES ($1,'Cardiologia',$2)`, [ids.orario,
      JSON.stringify([{ type: 'ORARIO', description: 'Ambulatorio', amount: 45, unit: 'ora', vat: 'SENZA' }, { type: 'VARIABILE', description: 'Quota sulle prestazioni', amount: 40, unit: '%', vat: 'SENZA' },
        { type: 'PRESTAZIONE', code: 'ECG', description: 'Elettrocardiogramma', amount: 12, vat: 'SENZA' }])]);
    const hash = await bcrypt.hash(PW, 10);
    const uid = (await db.query(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, password_hash, must_change_password, is_external)
      VALUES ('solo.lp@toscanadiagnostica.it','Solo LP','Solo','Lp','ADMIN','ACTIVE','BOTH',$1,false,false) RETURNING id`, [hash])).rows[0].id;
    await db.query(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,'contracts','LP','MANUAL')`, [uid]);
    L = await H.entra(H.client(S.base), 'solo.lp@toscanadiagnostica.it', PW, PW);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  const xlsx = async (c, url) => {
    const r = await fetch(`${S.base}${url}`, { headers: { cookie: c.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(r.status, 200, url);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
    const testo = []; wb.eachSheet((ws) => ws.eachRow((row) => testo.push(row.values.filter((v) => v != null).join('|'))));
    return { fogli: wb.worksheets.map((w) => w.name), testo: testo.join('\n') };
  };

  test('il profilo esiste nel catalogo dei moduli', async () => {
    const m = (await db.query(`SELECT profiles FROM modules WHERE key='contracts'`)).rows[0];
    assert.ok(m.profiles.some((p) => p.key === 'LP'));
  });

  test('elenco: solo LP, qualunque filtro; compensi di ogni tipo anche senza fisso', async () => {
    for (const q of ['', '?kind=DIPENDENTE', '?kind=LP', '?person_kind=DIPENDENTE', '?q=Dipendentetest']) {
      const r = await L.get(`/api/contracts/resources${q}`);
      assert.equal(r.s, 200, r.text);
      assert.ok(r.j.every((x) => x.kind === 'LP'), `nessun dipendente con ${q}`);
      assert.ok(!r.text.includes('Dipendentetest'));
    }
    const tutti = (await L.get('/api/contracts/resources')).j;
    const o = tutti.find((x) => x.id === ids.orario);
    assert.equal(o.compensi.fisso_mensile, 0); assert.equal(o.compensi.orari[0].importo, 45); assert.equal(o.compensi.variabili, 1); assert.equal(o.compensi.prestazione, 1);
    assert.equal(tutti.find((x) => x.id === ids.fisso).compensi.fisso_mensile, 2000);
  });

  test('scheda: LP sì, dipendente no; tutto il resto del modulo è chiuso', async () => {
    assert.equal((await L.get(`/api/contracts/resources/${ids.fisso}`)).s, 200);
    assert.equal((await L.get(`/api/contracts/resources/${ids.dip}`)).s, 403);
    for (const u of ['/stats/summary', '/settings', '/org/chart', '/org', '/ccnl', '/scouting/cv', '/scouting/letters', '/documents', '/people-inbox', '/audit', `/benefit/persona/${ids.dip}`,
      `/resources/${ids.dip}/attachments/1/download`, '/resources/bulk-template.xlsx?kind=DIPENDENTE', '/una-route-futura']) {
      assert.equal((await L.get(`/api/contracts${u}`)).s, 403, u);
    }
    assert.equal((await L.post('/api/contracts/ccnl/simulate', {})).s, 403);
    const aree = await L.get('/api/contracts/areas');
    assert.equal(aree.s, 200); assert.ok(!aree.text.includes('head_name') && !aree.text.includes('headcount'));
    assert.deepEqual((await L.get('/api/contracts/badges')).j, {});
    const sc = await L.get('/api/contracts/stats/deadlines');
    assert.equal(sc.s, 200); assert.ok(sc.j.every((d) => d.kind === 'LP'));
  });

  // v0.99.12 (CEO, 27/11/2026): "il profilo Liberi professionisti NON deve essere sola lettura ma EDITOR: può aggiungere, correggere,
  // modificare o eliminare il personale. Altrimenti non è usabile Room Planning". Solo sui liberi professionisti.
  test('editor dei liberi professionisti: aggiunge, modifica, incarico, scadenze, cessa, riattiva, elimina', async () => {
    const nuovo = await L.post('/api/contracts/resources', { person: { kind: 'MEDICO', last_name: 'Nuovotest', first_name: 'Nino' }, lp: { discipline: 'Ortopedia', fees: [{ type: 'ORARIO', description: 'Ambulatorio', amount: 50, unit: 'ora', vat: 'SENZA' }] } });
    assert.equal(nuovo.s, 201, nuovo.text); const id = nuovo.j.id;
    const sch = await L.get(`/api/contracts/resources/${id}`); assert.equal(sch.s, 200); assert.equal((sch.j.resource || sch.j).kind, 'LP');
    assert.equal((await db.query('SELECT kind, last_name FROM people WHERE id = $1', [id])).rows[0].last_name, 'Nuovotest', 'è nell\'anagrafica unica (da lì lo prende Room Planning)');
    assert.equal((await L.put(`/api/contracts/resources/${id}`, { first_name: 'Nicola', phone: '+39 055 000000' })).s, 200, 'corregge l\'anagrafica');
    assert.equal((await L.put(`/api/contracts/resources/${id}/lp`, { discipline: 'Ortopedia e traumatologia', fees: [] })).s, 200, 'modifica l\'incarico');
    const sc = await L.post(`/api/contracts/resources/${id}/deadlines`, { title: 'Rinnovo polizza RC', due_date: '2027-01-31' }); assert.ok(sc.s < 300, sc.text);
    assert.equal((await L.put(`/api/contracts/resources/${id}/terminate`, { terminated_at: '2026-11-27', reason: 'FINE_INCARICO' })).s, 200, 'cessa');
    assert.equal((await L.put(`/api/contracts/resources/${id}/reactivate`, {})).s, 200, 'riattiva');
    const canc = await fetch(`${S.base}/api/contracts/resources/${id}`, { method: 'DELETE', headers: { cookie: L.cookie, 'X-Requested-With': 'td-suite', 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'inserito per errore' }) });
    assert.equal(canc.status, 200, 'elimina');
    assert.equal((await L.get(`/api/contracts/resources/${id}`)).s, 403, 'non c\'è più');
    assert.equal((await db.query('SELECT 1 FROM people WHERE id = $1', [id])).rowCount, 0);
  });

  test('editor ma solo dei liberi professionisti: nessuna scrittura su dipendenti e tirocinanti, nessuna trasformazione', async () => {
    assert.equal((await L.post('/api/contracts/resources', { person: { kind: 'DIPENDENTE', last_name: 'Abusivotest', first_name: 'Ada' } })).s, 403, 'non crea dipendenti');
    assert.equal((await L.post('/api/contracts/resources', { person: { kind: 'TIROCINANTE', last_name: 'Abusivotest', first_name: 'Tea' } })).s, 403, 'non crea tirocinanti');
    assert.equal((await L.post('/api/contracts/resources', { person: { kind: 'LP', last_name: 'Abusivotest', first_name: 'Leo' }, employment: { start_date: '2026-12-01' } })).s, 403, 'niente rapporto di lavoro');
    assert.equal((await L.post('/api/contracts/resources', {})).s, 403);
    for (const [m, u, b] of [['put', `/resources/${ids.dip}`, { first_name: 'X' }], ['put', `/resources/${ids.dip}/employment`, {}], ['put', `/resources/${ids.dip}/terminate`, { terminated_at: '2026-11-27', reason: 'ALTRO' }],
      ['del', `/resources/${ids.dip}`, { reason: 'prova' }], ['post', `/resources/${ids.dip}/deadlines`, { title: 'x', due_date: '2027-01-01' }], ['post', `/resources/${ids.dip}/documents/generate`, { kind: 'CONTRATTO' }],
      ['put', `/resources/${ids.fisso}/employment`, {}], ['post', '/resources/bulk-import', {}], ['post', '/stats/deadlines/segnala', {}], ['put', '/settings', {}], ['post', `/resources/${ids.fisso}/formazione`, {}]]) {
      assert.equal((await L[m](`/api/contracts${u}`, b)).s, 403, `${m} ${u}`);
    }
    assert.equal((await L.put(`/api/contracts/resources/${ids.fisso}`, { kind: 'DIPENDENTE' })).s, 403, 'un professionista non diventa dipendente');
    assert.equal((await db.query('SELECT kind, first_name FROM people WHERE id = $1', [ids.dip])).rows[0].first_name, 'Dora', 'il dipendente è intatto');
    assert.equal((await db.query('SELECT kind FROM people WHERE id = $1', [ids.fisso])).rows[0].kind, 'LP');
    // chi è in sola lettura resta in sola lettura
    await db.query(`UPDATE grants SET profile = 'VIEWER' WHERE module_key = 'contracts' AND user_id = (SELECT id FROM users WHERE email = 'solo.lp@toscanadiagnostica.it')`);
    const V = await H.entra(H.client(S.base), 'solo.lp@toscanadiagnostica.it', PW, PW);
    assert.equal((await V.put(`/api/contracts/resources/${ids.fisso}`, { first_name: 'Y' })).s, 403);
    await db.query(`UPDATE grants SET profile = 'LP' WHERE module_key = 'contracts' AND user_id = (SELECT id FROM users WHERE email = 'solo.lp@toscanadiagnostica.it')`);
    L = await H.entra(H.client(S.base), 'solo.lp@toscanadiagnostica.it', PW, PW);
  });

  test('estratto: il profilo LP riceve solo LP con tutti i compensi; per gli altri segue l\'elenco (kind)', async () => {
    for (const q of ['', '?kind=DIPENDENTE', '?kind=LP']) {
      const x = await xlsx(L, `/api/contracts/stats/costs.xlsx${q}`);
      assert.deepEqual(x.fogli, ['Liberi professionisti', 'Compensi']);
      assert.ok(!x.testo.includes('Dipendentetest'), `nessun dipendente nell'estratto ${q}`);
      for (const s of ['Fissotest', 'Orariotest', 'Orario', 'Variabile', 'A prestazione', 'Elettrocardiogramma', '45,00 €/ora']) assert.ok(x.testo.includes(s), s);
    }
    const lp = await xlsx(O, '/api/contracts/stats/costs.xlsx?kind=LP');
    assert.ok(!lp.testo.includes('Dipendentetest') && lp.testo.includes('Orariotest'));
    const dip = await xlsx(O, '/api/contracts/stats/costs.xlsx?kind=DIPENDENTE');
    assert.ok(dip.testo.includes('Dipendentetest') && !dip.testo.includes('Orariotest') && !dip.testo.includes('Fissotest'));
    const tutto = await xlsx(O, '/api/contracts/stats/costs.xlsx');
    assert.ok(tutto.testo.includes('Dipendentetest') && tutto.testo.includes('Orariotest'));
  });

  test('Scadenzario della Suite: con il profilo LP le righe del personale non passano', async () => {
    const { visibiliA } = await import('../src/lib/scadenzario.js');
    const righe = [{ modulo: 'contracts' }, { modulo: 'business' }];
    assert.deepEqual(visibiliA(righe, { level: 'ADMIN', grants: { contracts: { profile: 'LP' } } }).map((r) => r.modulo), ['business']);
    assert.equal(visibiliA(righe, { level: 'USER', grants: { contracts: { profile: 'HR' } } }).length, 2);
  });
});
