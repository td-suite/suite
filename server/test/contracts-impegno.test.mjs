// v0.91.0 · Gestione del Personale. Chi è in fase "Lettera di impegno" (stato IMPEGNO) non figura in nessun elenco: anagrafica e rubrica
// della Suite, elenco del personale, organigrammi, team di Integration. La lettera conserva i benefit, per copiarli (con RAL e MBO) da
// un'altra lettera. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Gestione del Personale: fase Lettera di impegno', { skip: SALTA }, () => {
  let H, S, O; const ids = {};
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    S = await H.avviaSuite();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
    const lettera = async (last, first, letter) => {
      const r = await O.post('/api/contracts/scouting/letters', { person: { last_name: last, first_name: first, kind: 'DIPENDENTE', status: 'IMPEGNO' }, letter });
      assert.equal(r.s, 201, r.text); return r.j;
    };
    ids.a = await lettera('Impegnotest', 'Ida', { letter_date: '2026-11-20', level: '3', job_title: 'Tecnico di laboratorio', ral: 31000, ral_steps: [{ from: '2027-07-01', ral: 33000 }], mbo_enabled: true, mbo_pct: 10, benefits: ['PC portatile aziendale', 'Buoni pasto'] });
    ids.b = await lettera('Secondatest', 'Sara', { letter_date: '2026-11-20', level: '4', job_title: 'Accettazione', ral: 24000 });
  }, { timeout: 240000 });
  after(async () => { await S?.stop(); });

  test('la lettera conserva RAL, crescite, MBO e benefit; l\'elenco delle lettere li espone per la copia', async () => {
    const l = (await O.get(`/api/contracts/scouting/letters/${ids.a.id}`)).j;
    assert.deepEqual(l.benefits, ['PC portatile aziendale', 'Buoni pasto']); assert.equal(Number(l.ral), 31000); assert.equal(l.mbo_enabled, true);
    const elenco = (await O.get('/api/contracts/scouting/letters')).j;
    const a = elenco.find((x) => x.id === ids.a.id);
    assert.ok(a && a.benefits.length === 2 && a.ral_steps.length === 1 && Number(a.mbo_pct) === 10);
    // copia sulla seconda lettera (quello che fa il pulsante: stessi campi, con una modifica)
    const u = await O.put(`/api/contracts/scouting/letters/${ids.b.id}`, { ral: Number(a.ral), ral_steps: a.ral_steps, mbo_enabled: a.mbo_enabled, mbo_pct: Number(a.mbo_pct), benefits: a.benefits });
    assert.equal(u.s, 200, u.text);
    const b = (await O.get(`/api/contracts/scouting/letters/${ids.b.id}`)).j;
    assert.deepEqual(b.benefits, a.benefits); assert.equal(Number(b.ral), 31000); assert.equal(b.job_title, 'Accettazione', 'mansione della proposta non toccata');
  });

  test('chi è in impegno non figura in nessun elenco', async () => {
    const no = (r, dove) => { assert.equal(r.s, 200, `${dove}: ${r.text}`); assert.ok(!r.text.includes('Impegnotest') && !r.text.includes('Secondatest'), dove); };
    no(await O.get('/api/people'), 'anagrafica Persone (attivi)');
    no(await O.get('/api/people?all=1'), 'anagrafica Persone (tutti gli stati)');
    no(await O.get('/api/people?status=IMPEGNO'), 'anagrafica Persone, filtro IMPEGNO');
    no(await O.get('/api/people?qtext=Impegnotest'), 'ricerca in anagrafica');
    no(await O.get('/api/contracts/resources'), 'elenco del personale');
    no(await O.get('/api/contracts/resources?status=ATTIVO,IMPEGNO'.replace(',IMPEGNO', '')), 'elenco del personale, attivi');
    no(await O.get('/api/contracts/org/chart'), 'organigramma di Gestione del Personale');
    no(await O.get('/api/contracts/stats/summary'), 'cruscotto di Gestione del Personale');
    const cerca = await O.get('/api/search?q=Impegnotest'); assert.equal(cerca.s, 200);
    assert.ok(!JSON.stringify(cerca.j.results ?? cerca.j.risultati ?? cerca.j.items ?? []).includes('Impegnotest'), `ricerca della Suite: ${cerca.text.slice(0, 300)}`);
    // restano dove si lavorano: le lettere di impegno
    const lettere = await O.get('/api/contracts/scouting/letters');
    assert.ok(lettere.text.includes('Impegnotest') && lettere.text.includes('Secondatest'));
  });
});
