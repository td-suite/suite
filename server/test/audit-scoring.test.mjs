// Test del modulo Audit SGI: funzioni pure di lib/scoring.js (punteggio con NA, NC, voci libere, verificatore che prevale, livelli,
// mese dell'alert, selezione dei destinatari) e validazione dei due JSON dei modelli (chiavi uniche, campi obbligatori).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemsOf, computeScore, scoreAudit, effectiveScore, levelLetter, levelOf, alertWindow, sitesToAlert, alertRecipients, validateTemplate, monthStart } from '../src/modules/audit/lib/scoring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'src', 'modules', 'audit', 'data');
const sede = JSON.parse(fs.readFileSync(path.join(DATA, 'checklist_sede.json'), 'utf8'));
const le = JSON.parse(fs.readFileSync(path.join(DATA, 'checklist_legal_entity.json'), 'utf8'));

const mini = { code: 'T', title: 'Test', rev: '1', parts: [{ key: 'P', title: 'Parte', sections: [
  { key: 'S1', title: 'Uno', items: [{ n: '1', text: 'a' }, { n: '2', text: 'b' }, { n: '3', text: 'c', sub: [{ key: '3a', text: 'c1', rev: true }, { key: '3b', text: 'c2' }] }, { n: '4', text: 'Altri', free: true, repeat: 2 }] },
  { key: 'S2', title: 'Due', items: [{ n: 'Sic 1', text: 'd' }, { n: 'Sic 2', text: 'e' }] },
] }], report: { nc_columns: ['n', 'descrizione'] } };

test('itemsOf: sotto-voci al posto del padre, voci libere ripetute, chiavi senza spazi', () => {
  const keys = itemsOf(mini).map((i) => i.key);
  assert.deepEqual(keys, ['1', '2', '3a', '3b', '4_1', '4_2', 'Sic1', 'Sic2']);
  assert.equal(itemsOf(mini).find((i) => i.key === '3a').rev, true);
  assert.equal(itemsOf(mini).find((i) => i.key === '4_1').free, true);
});

test('computeScore: SI=1, NO=0, NC=0 e conta come NC, NA esclusa, voci libere vuote ignorate', () => {
  const r = computeScore(mini, { 1: { v: 'SI' }, 2: { v: 'NO' }, '3a': { v: 'NC' }, '3b': { v: 'NA' }, Sic1: { v: 'SI' }, '4_1': { free: '' , v: 'SI' } });
  // conteggiate: 1 SI, 2 NO, 3a NC, 3b NA, Sic1 SI (Sic2 senza risposta; 4_1 libera vuota ignorata)
  assert.equal(r.total, 6);           // 8 voci meno le 2 libere vuote (4_1 ha testo vuoto, 4_2 assente)
  assert.equal(r.answered, 5);
  assert.equal(r.nc, 1);
  assert.equal(r.na, 1);
  assert.equal(r.score, 50);          // SI 2 su denominatore 4 (SI+NO+NC)
  assert.equal(r.by_section.S1.score, 33.3);   // S1: SI, NO, NC → 1/3
  assert.equal(r.by_section.S2.score, 100);
});

test('computeScore: voce libera con testo conta', () => {
  const r = computeScore(mini, { '4_1': { free: 'Modulo X', v: 'NO' } });
  assert.equal(r.total, 7);
  assert.equal(r.answered, 1);
  assert.equal(r.score, 0);
});

test('computeScore: tutte NA → punteggio null', () => {
  const r = computeScore(mini, { 1: { v: 'NA' }, 2: { v: 'NA' } });
  assert.equal(r.score, null);
  assert.equal(r.answered, 2);
});

test('scoreAudit e effectiveScore: per gli AUTO con verifica compilata fa fede il verificatore, con scostamento', () => {
  const audit = { kind: 'AUTO', answers: { 1: { v: 'SI' }, 2: { v: 'SI' }, Sic1: { v: 'SI' }, Sic2: { v: 'SI' } }, verifier_answers: { 1: { v: 'SI' }, 2: { v: 'NO' }, Sic1: { v: 'SI' }, Sic2: { v: 'NC' } } };
  const sc = scoreAudit(mini, audit);
  assert.equal(sc.score, 100);
  assert.equal(sc.score_verifier, 50);
  assert.equal(sc.by_section.S2.score_verifier, 50);
  assert.equal(sc.nc_verifier, 1);
  const eff = effectiveScore({ kind: 'AUTO', score: sc.score, score_verifier: sc.score_verifier });
  assert.deepEqual(eff, { score: 50, source: 'VERIFICA', delta: -50 });
  // senza verifica vale la sede
  const sc2 = scoreAudit(mini, { kind: 'AUTO', answers: audit.answers, verifier_answers: {} });
  assert.equal(sc2.score_verifier, null);
  assert.equal(effectiveScore({ kind: 'AUTO', score: 100, score_verifier: null }).source, 'SEDE');
  // per un audit interno la colonna del verificatore non esiste
  assert.equal(scoreAudit(mini, { kind: 'INTERNO', answers: audit.answers, verifier_answers: audit.verifier_answers }).score_verifier, null);
});

test('livelli: A ≥ 90, B 75-89, C 60-74, D < 60', () => {
  assert.equal(levelLetter(100), 'A'); assert.equal(levelLetter(90), 'A'); assert.equal(levelLetter(89.9), 'B'); assert.equal(levelLetter(75), 'B');
  assert.equal(levelLetter(74.9), 'C'); assert.equal(levelLetter(60), 'C'); assert.equal(levelLetter(59.9), 'D'); assert.equal(levelLetter(0), 'D');
  assert.equal(levelLetter(null), null);
  assert.equal(levelOf(80).label, 'Sostanzialmente allineato');
});

test('alertWindow: prima del giorno dell\'alert niente; dal 17 a fine mese sì; promemoria ogni N giorni', () => {
  assert.equal(alertWindow('2026-11-16', { alert_day: 17, reminder_every_days: 5 }).due, false);
  const d17 = alertWindow('2026-11-17', { alert_day: 17, reminder_every_days: 5 });
  assert.equal(d17.due, true); assert.equal(d17.period, '2026-11-01'); assert.equal(d17.reminder, false);
  assert.equal(alertWindow('2026-11-22', { alert_day: 17, reminder_every_days: 5 }).reminder, true);
  assert.equal(alertWindow('2026-11-23', { alert_day: 17, reminder_every_days: 5 }).reminder, false);
  assert.equal(alertWindow('2026-11-30', { alert_day: 17, reminder_every_days: 0 }).reminder, false);
  assert.equal(alertWindow('2026-12-01', { alert_day: 17 }).due, false);   // mese nuovo: si riparte
  assert.equal(alertWindow('2026-02-10', { alert_day: 10 }).due, true);
  assert.equal(monthStart(new Date(2026, 1, 15)), '2026-02-01');
});

test('sitesToAlert: solo sedi struttura attive senza invio; una volta per sede e mese; promemoria non ripetuto nello stesso giorno', () => {
  const kinds = ['PUNTO_PRELIEVI', 'CENTRO_MEDICO'];
  const sites = [{ id: 1, kind: 'PUNTO_PRELIEVI', active: true }, { id: 2, kind: 'CENTRO_MEDICO', active: true }, { id: 3, kind: 'SERVICE', active: true }, { id: 4, kind: 'PUNTO_PRELIEVI', active: false }, { id: 5, kind: 'PUNTO_PRELIEVI', active: true }];
  const audits = [{ site_id: 2, period: '2026-11-01', status: 'INVIATO' }, { site_id: 5, period: '2026-11-01', status: 'BOZZA' }];
  const r1 = sitesToAlert({ today: '2026-11-17', settings: { alert_day: 17, reminder_every_days: 5 }, sites, audits, sent: [], structureKinds: kinds });
  assert.deepEqual(r1.map((x) => [x.site_id, x.kind]), [[1, 'ALERT'], [5, 'ALERT']]);   // 2 ha inviato, 3 service, 4 inattiva, 5 in bozza → va avvisata
  const sent = [{ site_id: 1, period: '2026-11-01', sent_at: '2026-11-17T10:00:00Z', kind: 'ALERT' }, { site_id: 5, period: '2026-11-01', sent_at: '2026-11-17T10:00:00Z', kind: 'ALERT' }];
  assert.deepEqual(sitesToAlert({ today: '2026-11-18', settings: { alert_day: 17, reminder_every_days: 5 }, sites, audits, sent, structureKinds: kinds }), []);   // già avvisate, non è giorno di promemoria
  const r3 = sitesToAlert({ today: '2026-11-22', settings: { alert_day: 17, reminder_every_days: 5 }, sites, audits, sent, structureKinds: kinds });
  assert.deepEqual(r3.map((x) => [x.site_id, x.kind]), [[1, 'REMINDER'], [5, 'REMINDER']]);
  const sent2 = [...sent, { site_id: 1, period: '2026-11-01', sent_at: '2026-11-22T08:00:00', kind: 'REMINDER' }];
  assert.deepEqual(sitesToAlert({ today: '2026-11-22', settings: { alert_day: 17, reminder_every_days: 5 }, sites, audits, sent: sent2, structureKinds: kinds }).map((x) => x.site_id), [5]);
  assert.deepEqual(sitesToAlert({ today: '2026-11-10', settings: { alert_day: 17 }, sites, audits, sent: [], structureKinds: kinds }), []);
});

test('alertRecipients: manager_email della sede oppure grant SITE sulla sede, solo utenti attivi, senza doppioni', () => {
  const site = { id: 7, manager_email: 'Mario.Rossi@toscanadiagnostica.it' };
  const users = [{ id: 1, email: 'mario.rossi@toscanadiagnostica.it', status: 'ACTIVE' }, { id: 2, email: 'anna@td.it', status: 'ACTIVE' }, { id: 3, email: 'ex@td.it', status: 'DISABLED' }, { id: 4, email: 'altro@td.it', status: 'ACTIVE' }];
  const grants = [{ user_id: 1, site_id: 7 }, { user_id: 2, site_id: 7 }, { user_id: 3, site_id: 7 }, { user_id: 4, site_id: 8 }];
  assert.deepEqual(alertRecipients(site, users, grants).sort(), [1, 2]);
  assert.deepEqual(alertRecipients({ id: 9, manager_email: null }, users, grants), []);
});

test('modelli JSON: validi, chiavi uniche, campi obbligatori, sezioni attese', () => {
  assert.deepEqual(validateTemplate(sede), []);
  assert.deepEqual(validateTemplate(le), []);
  for (const t of [sede, le]) {
    const keys = itemsOf(t).map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `chiavi duplicate in ${t.code}`);
    assert.ok(t.code && t.title && t.rev && t.rev_date);
    assert.ok(Array.isArray(t.answer_values) && t.answer_values.join() === 'SI,NO,NC,NA');
    assert.ok(t.report && Array.isArray(t.report.nc_columns) && t.report.nc_columns.includes('descrizione'));
  }
  assert.equal(sede.parts.length, 3);
  assert.deepEqual(sede.parts.flatMap((p) => p.sections.map((s) => s.key)), ['F1', 'F2', 'F3', 'F4', 'F5', 'B1', 'B2', 'B3', 'B4', 'S1']);
  assert.ok(itemsOf(sede).length > 100);
  assert.equal(itemsOf(sede).filter((i) => i.free).length, 5);   // 19p x3 + 35o x2
  assert.equal(le.parts[0].sections.length, 6);
  assert.equal(itemsOf(le).length, 32);
  assert.ok(le.risk_values.join() === 'BASSO,MEDIO,ALTO');
  assert.ok(le.report.extra_fields.some((f) => f.key === 'livello_rischio_finale'));
});

test('validateTemplate: segnala chiavi duplicate e campi mancanti', () => {
  const bad = { code: 'X', title: 'x', rev: '1', parts: [{ key: 'P', title: 'p', sections: [{ key: 'S', title: 's', items: [{ n: '1', text: 'a' }, { n: '1', text: 'b' }, { n: '2' }] }] }] };
  const errs = validateTemplate(bad);
  assert.ok(errs.some((e) => /duplicate/.test(e)));
  assert.ok(errs.some((e) => /senza testo/.test(e)));
  assert.ok(errs.some((e) => /nc_columns/.test(e)));
  assert.ok(validateTemplate(null).length === 1);
});
