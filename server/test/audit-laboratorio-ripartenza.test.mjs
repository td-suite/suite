// Audit SGI v0.84.0: modello del Laboratorio di Analisi (checklist di sistema + operativa + sistemi di gestione integrati), modello
// delle sedi rev. 2 con i sistemi integrati, ripartenza degli audit dal mese scelto. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemsOf, sectionsOf, validateTemplate, computeScore } from '../src/modules/audit/lib/scoring.js';

const SALTA = !process.env.DATABASE_URL_TEST;
const leggi = (f) => JSON.parse(fs.readFileSync(new URL(`../src/modules/audit/data/${f}`, import.meta.url), 'utf8'));
const NORME = ['ISO 45001', 'ISO 14001', 'ISO 37001', 'UNI/PdR 125', 'ISO 30415', 'PAS 24000'];

describe('Modelli di checklist', () => {
  test('laboratorio: 59 domande di sistema, poi 48 operative nella stessa parte, poi i sei sistemi integrati; ogni domanda ha la norma', () => {
    const t = leggi('checklist_laboratorio.json');
    assert.deepEqual(validateTemplate(t), []);
    assert.equal(t.code, 'TD-AUD-LAB');
    const it = itemsOf(t);
    const lab = it.filter((x) => x.part_key === 'LAB');
    assert.deepEqual(lab.slice(0, 59).map((x) => x.key), Array.from({ length: 59 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`), 'prima la checklist di sistema, nell\'ordine del file');
    assert.deepEqual(lab.slice(59).map((x) => x.key), Array.from({ length: 48 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`), 'poi la checklist operativa');
    assert.ok(lab.slice(0, 59).every((x) => /^ISO 9001:2015 · \d/.test(x.ref) && x.hint), 'punto norma ed evidenze attese su ogni domanda di sistema');
    assert.equal(it.find((x) => x.key === 'Q15').ref, 'ISO 9001:2015 · 7.1.5');
    assert.match(it.find((x) => x.key === 'V26').label, /valori critici/);
    const sis = it.filter((x) => x.part_key === 'SISTEMI');
    assert.ok(sis.length >= 55);
    for (const n of NORME) assert.ok(sis.filter((x) => x.ref.startsWith(n)).length >= 6, `domande su ${n}`);
    assert.ok(sis.every((x) => x.ref && x.hint && x.label.endsWith('?')));
    assert.deepEqual(sectionsOf(t).filter((s) => s.part_key === 'SISTEMI').map((s) => s.key), ['SSL', 'AMB', 'ACO', 'PDG', 'DEI', 'SOC']);
    // punteggio per norma: ogni sistema è una sezione
    const sc = computeScore(t, { SSL01: { v: 'SI' }, SSL02: { v: 'NC' }, AMB01: { v: 'SI' } });
    assert.equal(sc.by_section.SSL.score, 50); assert.equal(sc.by_section.AMB.score, 100);
  });
  test('sedi rev. 2: le voci della rev. 1 restano, si aggiungono i sei sistemi per punti prelievo e centri medici', () => {
    const t = leggi('checklist_sede.json');
    assert.deepEqual(validateTemplate(t), []);
    assert.equal(t.rev, '2');
    const it = itemsOf(t);
    for (const k of ['1a', '19p_1', '45', 'Sic1', 'Sic21']) assert.ok(it.some((x) => x.key === k), `voce ${k} della rev. 1`);
    const sis = it.filter((x) => x.part_key === 'SISTEMI');
    assert.equal(sis.length, 48);
    for (const n of NORME) assert.ok(sis.some((x) => x.ref.startsWith(n)), n);
    assert.equal(new Set(it.map((x) => x.key)).size, it.length);
  });
});

describe('Laboratorio, sedi e ripartenza', { skip: SALTA }, () => {
  let H, S, D, o, lab;
  const must = (r, cosa) => { assert.ok(r.s >= 200 && r.s < 300, `${cosa}: ${r.s} ${r.text.slice(0, 300)}`); return r.j; };
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    S = await H.avviaSuite(); D = await H.datiProva(S.base); o = D.o;
    must(await o.post('/api/travaso/audit/run'), 'modulo');
    lab = must(await o.post('/api/sites', { code: 'T-LAB', name: 'Laboratorio di Analisi Test', kind: 'LABORATORIO', city: 'Sesto Fiorentino', province: 'FI', address: 'Via di Prova 2', organization_id: D.org.td }), 'laboratorio').id;
  }, { timeout: 240000 });
  after(async () => { await S?.stop(); });

  test('il laboratorio usa TD-AUD-LAB, il punto prelievi TD-AUD-SEDE rev. 2; export con norma ed evidenze', async () => {
    const mod = must(await o.get('/api/audit/templates'), 'modelli');
    assert.deepEqual(mod.filter((t) => t.active).map((t) => `${t.kind}:${t.code}:${t.rev}`).sort(), ['LABORATORIO:TD-AUD-LAB:1', 'LEGAL_ENTITY:TD-AUD-LE:1', 'SEDE:TD-AUD-SEDE:2']);
    const a = must(await o.post('/api/audit/audits', { kind: 'INTERNO', site_id: lab }), 'interno lab');
    const al = must(await o.get(`/api/audit/audits/${a.id}`), 'audit lab');
    assert.equal(al.template.code, 'TD-AUD-LAB'); assert.equal(al.template.body.parts[0].title, 'Checklist e checklist operativa');
    must(await o.put(`/api/audit/audits/${a.id}`, { answers: { Q01: { v: 'SI' }, V01: { v: 'NC', note: 'prova' }, SSL01: { v: 'SI' } } }), 'salva');
    const dopo = must(await o.get(`/api/audit/audits/${a.id}`), 'audit lab');
    assert.equal(Number(dopo.score), 66.7); assert.equal(dopo.score_by_section.SSL.score, 100); assert.equal(dopo.score_by_section.O01.score, 0);
    const b = must(await o.post('/api/audit/audits/auto', { site_id: D.site.pp1 }), 'auto pp');
    assert.equal(must(await o.get(`/api/audit/audits/${b.id}`), 'auto').template.code, 'TD-AUD-SEDE');
    assert.equal(must(await o.get(`/api/audit/audits/${b.id}`), 'auto').template.rev, '2');
    const x = await fetch(`${S.base}/api/audit/audits/${a.id}/export.xlsx`, { headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(x.status, 200);
    assert.equal((await fetch(`${S.base}/api/audit/audits/${a.id}/export.pdf`, { headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } })).status, 200);
  });

  test('ripartenza: conferma obbligatoria, audit nel cestino, primo mese utile, i nuovi auto-audit nascono dal mese scelto', async () => {
    const oggi = new Date(); const mese = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}`;
    assert.equal((await o.post('/api/audit/settings/ripartenza', { period: mese, conferma: 'si' })).s, 400);
    const r = must(await o.post('/api/audit/settings/ripartenza', { period: mese, conferma: 'RIPARTI' }), 'ripartenza');
    assert.equal(r.auto, 1); assert.equal(r.interni, 1); assert.equal(r.stato.start_period, `${mese}-01`);
    assert.equal(must(await o.get('/api/audit/archivio'), 'archivio').rows?.length ?? 0, 0);
    const prima = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); const pp = `${prima.getFullYear()}-${String(prima.getMonth() + 1).padStart(2, '0')}-01`;
    const no = await o.post('/api/audit/audits/auto', { site_id: lab, period: pp });
    assert.equal(no.s, 400); assert.match(no.text, /ripartono da/);
    const si = must(await o.post('/api/audit/audits/auto', { site_id: lab }), 'auto lab del mese');
    assert.equal(must(await o.get(`/api/audit/audits/${si.id}`), 'auto lab').template.code, 'TD-AUD-LAB');
  });
});
