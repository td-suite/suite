// v0.94.0 · Gestione del Personale: simulazione dei cedolini del mese, divisa fra netti in busta da pagare e F24 (XLSX e PDF).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

test('cedolino simulato: lordo = netto + trattenute; F24 = contributi + IRPEF + addizionali; ingressi nel mese in proporzione; 13a e 14a', async () => {
  process.env.DATABASE_URL ||= 'postgresql://x@localhost/x';
  const { simulaCedolino, estremiMese } = await import('../src/modules/contracts/lib/cedolini.js');
  assert.deepEqual(estremiMese('2026-11'), { primo: '2026-11-01', ultimo: '2026-11-30', giorni: 30, numero: 11 });
  const e = { ral: 28000, ral_steps: [], monthly_payments: 14, contract_type: 'TIND', inizio: '2025-01-01', fine: null };
  const c = simulaCedolino(e, {}, '2026-11');
  assert.equal(c.lordo, 2000); assert.equal(c.inps_dipendente, 183.8); assert.equal(c.inps_azienda, 580);
  assert.ok(Math.abs(c.netto + c.inps_dipendente + c.irpef + c.addizionali - c.integrativo - c.lordo) < 0.011, 'il lordo si divide in netto e trattenute');
  assert.ok(Math.abs(c.f24 - (c.inps_dipendente + c.inps_azienda + c.irpef + c.addizionali - c.integrativo)) < 0.011);
  assert.ok(Math.abs(c.totale - (c.lordo + c.inps_azienda)) < 0.011, 'netti + F24 = lordo + contributi a carico dell\'azienda');
  // apprendista entrato il 16: metà mese, aliquota aziendale degli apprendisti
  const a = simulaCedolino({ ...e, contract_type: 'APPRENDISTATO', inizio: '2026-11-16' }, {}, '2026-11');
  assert.equal(a.lordo, 1000); assert.equal(a.parziale, true); assert.equal(a.giorni, 15); assert.equal(a.inps_azienda, 116.1);
  assert.equal(simulaCedolino({ ...e, inizio: '2026-12-01' }, {}, '2026-11'), null, 'non ancora in forza');
  assert.equal(simulaCedolino({ ...e, fine: '2026-10-31' }, {}, '2026-11'), null, 'già cessato');
  assert.equal(simulaCedolino(e, {}, '2026-12').lordo, 4000, 'tredicesima a dicembre');
  assert.equal(simulaCedolino(e, {}, '2026-06').lordo, 4000, 'quattordicesima a giugno');
  assert.equal(simulaCedolino({ ...e, monthly_payments: 13 }, {}, '2026-06').mensilita_aggiuntive, 0);
  // scatto di RAL programmato: vale la RAL vigente a fine mese
  assert.equal(simulaCedolino({ ...e, ral_steps: [{ from: '2026-11-15', ral: 35000 }] }, {}, '2026-11').lordo, 2500);
  // aliquote dalle impostazioni del widget
  assert.equal(simulaCedolino(e, { employee_inps_pct: '10', cost_inps_pct: '30' }, '2026-11').inps_dipendente, 200);
});

describe('Simulazione dei cedolini del mese: elenco, XLSX e PDF', { skip: SALTA }, () => {
  let H, S, O, db;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
    const persona = async (last, first, stato, extra = '') => {
      const id = (await db.query(`INSERT INTO public.people (kind, status, last_name, first_name ${extra ? ', terminated_at' : ''}) VALUES ('DIPENDENTE', $1, $2, $3 ${extra ? `, ${extra}` : ''}) RETURNING id`, [stato, last, first])).rows[0].id;
      await db.query(`INSERT INTO contracts.person_ext (person_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
      return id;
    };
    const contratto = (id, ral, tipo = 'TIND', inizio = `date_trunc('year', CURRENT_DATE)::date - 400`) => db.query(`INSERT INTO contracts.employments (resource_id, contract_type, level, ral, monthly_payments, start_date) VALUES ($1, $2, '3', $3, 14, ${inizio})`, [id, tipo, ral]);
    await contratto(await persona('Cedolinotest', 'Carla', 'ATTIVO'), 28000);
    await contratto(await persona('Apprendistatest', 'Aldo', 'ATTIVO'), 21000, 'APPRENDISTATO');
    await contratto(await persona('Futurotest', 'Fabio', 'ATTIVO'), 30000, 'TIND', `(date_trunc('month', CURRENT_DATE) + interval '2 months')::date`);
    await contratto(await persona('Impegnotest', 'Ida', 'IMPEGNO'), 30000);
    await contratto(await persona('Cessatotest', 'Ciro', 'CESSATO', `(date_trunc('month', CURRENT_DATE) - interval '1 day')::date`), 30000);
    await contratto(await persona('Senzaraltest', 'Sara', 'ATTIVO'), 0);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('solo i dipendenti in forza nel mese; totali coerenti; scadenza dell\'F24 al 16 del mese dopo', async () => {
    const r = await O.get('/api/contracts/stats/cedolini'); assert.equal(r.s, 200, r.text);
    const d = r.j;
    assert.deepEqual(d.righe.map((x) => x.nome), ['Apprendistatest Aldo', 'Cedolinotest Carla'], 'fuori chi inizia dopo, chi è in impegno, chi è cessato prima del mese');
    assert.deepEqual(d.senza_ral, ['Senzaraltest Sara']);
    const som = (k) => Math.round(d.righe.reduce((s, x) => s + x[k], 0) * 100) / 100;
    for (const k of ['lordo', 'netto', 'f24', 'totale', 'inps_azienda']) assert.equal(d.totali[k], som(k), k);
    assert.ok(Math.abs(d.totali.netto + d.totali.f24 - d.totali.totale) < 0.02);
    assert.match(d.f24_scadenza, /^\d{4}-\d{2}-16$/); assert.equal(d.mese, new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7));
    assert.equal((await O.get('/api/contracts/stats/cedolini?mese=2026-13')).j.mese, d.mese, 'mese non valido = mese in corso');
  });

  test('XLSX e PDF scaricabili, con nome del mese; registrati nel registro attività; vietati a chi non scrive nel modulo', async () => {
    const x = await fetch(`${S.base}/api/contracts/stats/cedolini.xlsx`, { headers: { cookie: O.cookie } });
    assert.equal(x.status, 200); assert.match(x.headers.get('content-disposition'), /simulazione-cedolini_\d{4}-\d{2}\.xlsx/);
    const bx = Buffer.from(await x.arrayBuffer()); assert.equal(bx.subarray(0, 2).toString(), 'PK');
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bx);
    const t = []; wb.worksheets[0].eachRow((row) => t.push(row.values.slice(1).map((v) => String(v ?? '')).join('|')));
    assert.ok(t.some((l) => /NETTO IN BUSTA/.test(l) && /F24/.test(l))); assert.ok(t.some((l) => l.startsWith('Cedolinotest Carla|Tempo indeterminato|3|28000|14|intero|2000|')));
    assert.ok(t.some((l) => l.startsWith('Totale|')));
    const p = await fetch(`${S.base}/api/contracts/stats/cedolini.pdf`, { headers: { cookie: O.cookie } });
    assert.equal(p.status, 200); assert.equal(p.headers.get('content-type'), 'application/pdf');
    const bp = Buffer.from(await p.arrayBuffer()); assert.equal(bp.subarray(0, 5).toString(), '%PDF-'); assert.ok(bp.length > 3000);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM contracts.audit_log WHERE action='CEDOLINI_SIMULAZIONE_EXPORT'`)).rows[0].n, 2);
    const anon = await fetch(`${S.base}/api/contracts/stats/cedolini.xlsx`); assert.ok([401, 403].includes(anon.status));
  });
});
