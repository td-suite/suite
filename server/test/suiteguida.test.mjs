// v0.89.0 · Guida alla Suite (modulo `suiteguida`): seme coerente (un capitolo per widget più il capitolo generale, sezioni validate dal
// manuale TD-SGI-MAN009), mappa "Guida al widget" allineata ai widget della Suite, e con database (DATABASE_URL_TEST): il modulo si attiva
// da solo, indice e sezioni rispondono, la ricerca trova il widget giusto, PDF del manuale e del widget, visibile anche a un accesso esterno.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.join(QUI, '..', 'src', 'modules', 'suiteguida');
const MAPPA = JSON.parse(fs.readFileSync(path.join(MOD, 'widget.json'), 'utf8'));
const SALTA = process.env.DATABASE_URL_TEST ? false : 'DATABASE_URL_TEST mancante';

describe('Guida alla Suite: contenuti', () => {
  test('un capitolo per widget, quattro sezioni ciascuno, tutte validate dal manuale', () => {
    const files = fs.readdirSync(path.join(MOD, 'content')).filter((f) => /^\d\d-.*\.md$/.test(f));
    assert.equal(files.length, Object.keys(MAPPA).length + 1);
    for (const f of files.slice(1)) {
      const t = fs.readFileSync(path.join(MOD, 'content', f), 'utf8');
      assert.equal((t.match(/^=== sezione$/gm) || []).length, 4, f);
      assert.equal((t.match(/^stato: VALIDATA$/gm) || []).length, 4, f);
      assert.ok(!/GIPO come|GipoNext come/.test(t));
    }
  });
  test('la mappa copre i widget del catalogo della Suite', async () => {
    const seed = fs.readFileSync(path.join(QUI, '..', 'src', 'seed', 'modules.js'), 'utf8');
    const chiavi = [...seed.matchAll(/\{ key: '(\w+)', area:/g)].map((m) => m[1]);
    for (const k of chiavi) assert.ok(MAPPA[k], `manca la guida del widget ${k}`);
    assert.equal(new Set(Object.values(MAPPA).map((w) => w.capitolo)).size, Object.keys(MAPPA).length);
  });
  test('PDF del manuale e di ogni widget distribuiti con il modulo', () => {
    assert.ok(fs.existsSync(path.join(MOD, 'assets', 'manuale.pdf')));
    for (const k of Object.keys(MAPPA)) assert.ok(fs.existsSync(path.join(MOD, 'assets', `widget-${k}.pdf`)), k);
  });
});

describe('Guida alla Suite: nella Suite', { skip: SALTA }, () => {
  let S; let H; let o;
  before(async () => { H = await import('./helpers/suiteTest.mjs'); S = await H.avviaSuite(); o = (await H.datiProva(S.base)).o; });
  after(async () => { await S?.stop(); });
  test('attiva da sola, indice con i capitoli, sezione leggibile', async () => {
    const st = await o.get('/api/suiteguida/state'); assert.equal(st.s, 200); assert.equal(st.j.mode, 'LIVE');
    const ind = await o.get('/api/suiteguida/indice'); assert.equal(ind.s, 200);
    assert.equal(ind.j.capitoli.length, Object.keys(MAPPA).length + 1);
    assert.equal(ind.j.totali.da_validare, 0);
    const sez = await o.get('/api/suiteguida/sezioni/ferie-uso'); assert.equal(sez.s, 200); assert.match(sez.j.corpo, /Il mio piano/);
  });
  test('ricerca: "ferie" porta al Piano Ferie; domanda senza AI registrata', async () => {
    const r = await o.get('/api/suiteguida/cerca?q=chiedere%20le%20ferie&registra=0'); assert.equal(r.s, 200);
    assert.ok(r.j.risultati.some((x) => /ferie/i.test(x.titolo)), JSON.stringify(r.j.risultati.map((x) => x.titolo)));
    const d = await o.post('/api/suiteguida/chiedi', { domanda: '[Widget: Ticket] come apro un ticket?' }); assert.equal(d.s, 200); assert.ok(d.j.id);
  });
  test('Guida al widget: mappa e PDF', async () => {
    const m = await o.get('/api/suiteguida/widget'); assert.equal(m.s, 200); assert.ok(m.j.cash.capitolo > 1);
    const p = await fetch(`${S.base}/api/suiteguida/widget/cash.pdf`, { headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } });
    assert.equal(p.status, 200); assert.match(p.headers.get('content-type'), /pdf/);
    const g = await fetch(`${S.base}/api/suiteguida/guida.pdf`, { headers: { cookie: o.cookie, 'X-Requested-With': 'td-suite' } }); assert.equal(g.status, 200);
    const no = await o.get('/api/suiteguida/widget/inesistente.pdf'); assert.equal(no.s, 404);
  });
  test('la tessera è nel catalogo, area Direzione, aperta a tutti', async () => {
    const mods = await o.get('/api/modules'); assert.equal(mods.s, 200);
    const tutti = (mods.j.areas ? mods.j.areas.flatMap((a) => a.modules) : mods.j);
    const g = tutti.find((x) => x.key === 'suiteguida'); assert.ok(g); assert.equal(g.area || 'DIREZIONE', 'DIREZIONE');
  });
});
