// Test della presa d'atto delle informative (lib/consensi.js): funzioni pure. Configurazione da app_settings con i ripieghi, documenti
// da accettare per versione (primo accesso, nessuna ripresentazione, nuova versione di uno solo), documenti da registrare (solo i
// mancanti nella versione corrente), CSV per Excel in italiano. Gli endpoint si provano nel collaudo con il db di prova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configDaRighe, documentiDaAccettare, documentiDaRegistrare, csv, DOCUMENTI, PREDEFINITI } from '../src/lib/consensi.js';

const righe = (privacyV = '2026-11', iaV = '1.0') => [
  { key: 'consensi.privacy_url', value: 'https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf', updated_at: '2026-11-05T09:00:00Z' },
  { key: 'consensi.privacy_versione', value: privacyV, updated_at: '2026-11-05T09:00:00Z' },
  { key: 'consensi.ia_url', value: '/informativa-ia', updated_at: '2026-11-05T09:00:00Z' },
  { key: 'consensi.ia_versione', value: iaV, updated_at: '2026-11-06T10:00:00Z' },
];

test('configDaRighe: legge URL, versione e data della versione; senza chiavi usa i predefiniti della migrazione 039', () => {
  const c = configDaRighe(righe());
  assert.deepEqual(DOCUMENTI, ['PRIVACY', 'IA']);
  assert.equal(c.PRIVACY.url, 'https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf');
  assert.equal(c.IA.versione, '1.0');
  assert.equal(c.IA.data, '2026-11-06T10:00:00Z');
  const vuota = configDaRighe([]);
  assert.equal(vuota.PRIVACY.versione, PREDEFINITI.PRIVACY.versione);
  assert.equal(vuota.IA.url, '/informativa-ia');
  assert.equal(vuota.IA.data, null);
  // valori vuoti o numerici (editor JSON generico) normalizzati a testo
  const strani = configDaRighe([{ key: 'consensi.ia_versione', value: 1.1 }, { key: 'consensi.privacy_url', value: '  ' }]);
  assert.equal(strani.IA.versione, '1.1');
  assert.equal(strani.PRIVACY.url, PREDEFINITI.PRIVACY.url);
});

test('documentiDaAccettare: primo accesso entrambi; dopo la presa d\'atto nessuno; nuova versione IA solo IA', () => {
  const c = configDaRighe(righe());
  assert.deepEqual(documentiDaAccettare(c, []), ['PRIVACY', 'IA']);
  const fatti = [{ documento: 'PRIVACY', versione: '2026-11' }, { documento: 'IA', versione: '1.0' }];
  assert.deepEqual(documentiDaAccettare(c, fatti), []);
  const c11 = configDaRighe(righe('2026-11', '1.1'));
  assert.deepEqual(documentiDaAccettare(c11, fatti), ['IA']);
  // tornare a una versione già accettata non la richiede di nuovo
  assert.deepEqual(documentiDaAccettare(c, [...fatti, { documento: 'IA', versione: '1.1' }]), []);
  // versione accettata di un altro documento non conta
  assert.deepEqual(documentiDaAccettare(c, [{ documento: 'IA', versione: '2026-11' }]), ['PRIVACY', 'IA']);
});

test('documentiDaRegistrare: solo i richiesti, validi e mancanti nella versione corrente, senza doppioni', () => {
  const c11 = configDaRighe(righe('2026-11', '1.1'));
  const fatti = [{ documento: 'PRIVACY', versione: '2026-11' }, { documento: 'IA', versione: '1.0' }];
  assert.deepEqual(documentiDaRegistrare(c11, fatti, ['PRIVACY', 'IA']), ['IA']);
  assert.deepEqual(documentiDaRegistrare(c11, [], ['IA', 'IA', 'ALTRO', 'PRIVACY']), ['IA', 'PRIVACY']);
  assert.deepEqual(documentiDaRegistrare(c11, [...fatti, { documento: 'IA', versione: '1.1' }], ['PRIVACY', 'IA']), []);
});

test('csv: separatore ";" e virgolette solo quando servono', () => {
  const out = csv(['A', 'B'], [['uno', 'due;tre'], ['Mozilla "x"', null]]);
  assert.equal(out, 'A;B\r\nuno;"due;tre"\r\n"Mozilla ""x""";\r\n');
});

test('testo dell\'informativa IA: versione, titolare, "con Claude", nessun articolo specifico del Regolamento', async () => {
  const { VERSIONE, SEZIONI, NOTA_VERSIONE } = await import('../../web/src/pages/informativaIATesto.js');
  const tutto = SEZIONI.flatMap((s) => [s.titolo, ...s.paragrafi]).join('\n');
  assert.equal(VERSIONE, PREDEFINITI.IA.versione);
  assert.match(tutto, /Toscana Diagnostica S\.r\.l\./);
  assert.match(tutto, /07528130482/);
  assert.match(tutto, /con Claude/);
  assert.match(tutto, /secondo i termini del fornitore/i);
  assert.doesNotMatch(tutto, /\bart(icol[oi])?\.?\s*\d/i);
  assert.match(NOTA_VERSIONE, /Versione 1\.0/);
});
