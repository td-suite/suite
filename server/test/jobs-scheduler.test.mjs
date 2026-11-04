// Scheduler dei lavori di sfondo: un job senza runAtStart deve partire da solo dopo il suo intervallo (difetto fino alla 0.43.1: non
// partiva mai finché non lo si lanciava a mano, e le caselle email restavano ferme).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDue } from '../src/lib/jobs.js';

test('job mai eseguito senza runAtStart: parte dopo l\'intervallo dalla registrazione', () => {
  const t0 = 1_000_000;
  const j = { minutes: 10, runAtStart: false, last: 0, registered: t0 };
  assert.equal(isDue(j, t0 + 5 * 60_000), false);
  assert.equal(isDue(j, t0 + 10 * 60_000), true);
});
test('job con runAtStart: parte subito; poi ogni intervallo dall\'ultima esecuzione', () => {
  const t0 = 1_000_000;
  assert.equal(isDue({ minutes: 10, runAtStart: true, last: 0, registered: t0 }, t0), true);
  const j = { minutes: 10, runAtStart: false, last: t0 + 10 * 60_000, registered: t0 };
  assert.equal(isDue(j, t0 + 15 * 60_000), false);
  assert.equal(isDue(j, t0 + 20 * 60_000), true);
});
