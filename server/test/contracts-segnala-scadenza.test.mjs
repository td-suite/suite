// v0.92.0 · Gestione del Personale, Calendario delle scadenze: "Segnala Scadenza" sulle scadenze selezionate (prima email dalla casella
// People) e sollecito ogni 7 giorni finché la scadenza resta aperta; i solleciti si fermano a mano o quando la scadenza è chiusa.
// Posta in modalità registro (nessun invio reale). Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

test('testo delle email: segnalazione e sollecito, alla persona e a HR', async () => {
  process.env.DATABASE_URL ||= 'postgresql://x@localhost/x';
  const { emailSegnalazione, GIORNI_SOLLECITO } = await import('../src/modules/contracts/lib/segnalazioni.js');
  assert.equal(GIORNI_SOLLECITO, 7);
  const it = { key: 'A12', title: 'Scadenza Polizza RC', due_date: '2026-12-01', days: 10, resource_name: 'Rossi Anna', resource_id: 5 };
  const a = emailSegnalazione(it, { recipient: 'PERSONA', personName: 'Anna Rossi' });
  assert.match(a.subject, /segnalazione: Scadenza Polizza RC entro il 01\/12\/2026 \[TD-SCAD-A12\]/); assert.match(a.html, /Gentile Anna Rossi/); assert.match(a.html, /sollecito ogni 7 giorni/);
  const b = emailSegnalazione({ ...it, days: -3 }, { recipient: 'HR', n: 2, primaIl: '2026-11-21' });
  assert.match(b.subject, /sollecito n\. 2/); assert.match(b.html, /scaduta da 3 giorni/); assert.match(b.html, /Prima segnalazione del 21\/11\/2026/); assert.match(b.text, /\[TD-SCAD-A12\]/);
});

describe('Segnala Scadenza e solleciti ogni 7 giorni', { skip: SALTA }, () => {
  let H, S, O, db, k1, k2, k3;
  const scad = async () => (await O.get('/api/contracts/stats/deadlines?days=730')).j;
  const riga = async (k) => (await scad()).find((x) => x.key === k);
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
    await db.query(`INSERT INTO contracts.app_settings (key, value) VALUES ('people_hr_cc', 'hr.prova@example.org') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
    const m = async (t, g) => `M${(await db.query(`INSERT INTO contracts.deadlines (title, due_date) VALUES ($1, CURRENT_DATE + $2::int) RETURNING id`, [t, g])).rows[0].id}`;
    k1 = await m('Rinnovo convenzione di prova', 20); k2 = await m('Verifica estintori di prova', -5); k3 = await m('Scadenza non selezionata', 40);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('prova: elenco dei destinatari, nessun invio; conferma: prima email e stato accanto alla scadenza', async () => {
    assert.ok((await riga(k1)) && (await riga(k1)).segnalazione === null);
    let r = await O.post('/api/contracts/stats/deadlines/segnala', { keys: [k1, k2, 'INESISTENTE'], prova: true });
    assert.equal(r.s, 200, r.text);
    assert.deepEqual(r.j.righe.map((x) => [x.key, x.esito, x.a]).sort(), [[k1, 'DA_INVIARE', 'hr.prova@example.org'], [k2, 'DA_INVIARE', 'hr.prova@example.org']].sort());
    assert.equal(r.j.non_trovate, 1); assert.equal(r.j.giorni_sollecito, 7);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM contracts.deadline_signals')).rows[0].n, 0, 'la prova non scrive');
    r = await O.post('/api/contracts/stats/deadlines/segnala', { keys: [k1, k2] });
    assert.equal(r.s, 200, r.text); assert.ok(r.j.righe.every((x) => ['REGISTRATO', 'INVIATO'].includes(x.esito)));
    const x = await riga(k1);
    assert.ok(x.segnalazione.prima && !x.segnalazione.ferma); assert.equal(x.segnalazione.solleciti, 0);
    const giorni = Math.round((new Date(x.segnalazione.prossimo) - new Date(x.segnalazione.prima)) / 86400000); assert.equal(giorni, 7, 'prossimo sollecito a 7 giorni');
    assert.equal((await riga(k3)).segnalazione, null);
    const inv = (await db.query(`SELECT kind, n, to_email, status FROM contracts.deadline_signal_sends WHERE deadline_key=$1`, [k1])).rows;
    assert.deepEqual(inv.map((i) => [i.kind, i.n, i.to_email]), [['SEGNALAZIONE', 0, 'hr.prova@example.org']]);
    const mail = (await db.query(`SELECT subject FROM public.email_log ORDER BY id DESC LIMIT 5`)).rows.map((m) => m.subject).join(' | ');
    assert.match(mail, new RegExp(`segnalazione: Rinnovo convenzione di prova.*\\[TD-SCAD-${k1}\\]`));
    // segnalare di nuovo una scadenza attiva non manda una seconda email
    r = await O.post('/api/contracts/stats/deadlines/segnala', { keys: [k1] });
    assert.equal(r.j.righe[0].esito, 'GIA_SEGNALATA');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM contracts.deadline_signal_sends WHERE deadline_key=$1`, [k1])).rows[0].n, 1);
  });

  test('sollecito: non prima di 7 giorni dall\'ultimo invio, poi ogni 7 giorni', async () => {
    let g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j;
    assert.equal(g.attive, 2); assert.equal(g.solleciti + g.registrati, 0); assert.equal(g.non_ancora, 2);
    await db.query(`UPDATE contracts.deadline_signals SET last_sent_at = now() - interval '6 days 23 hours' WHERE deadline_key=$1`, [k1]);
    g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j; assert.equal(g.solleciti + g.registrati, 0, 'a 6 giorni e 23 ore niente');
    await db.query(`UPDATE contracts.deadline_signals SET last_sent_at = now() - interval '7 days 1 hour' WHERE deadline_key=$1`, [k1]);
    g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j; assert.equal(g.solleciti + g.registrati, 1);
    let x = await riga(k1); assert.equal(x.segnalazione.solleciti, 1);
    g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j; assert.equal(g.solleciti + g.registrati, 0, 'il sollecito appena partito non si ripete');
    await db.query(`UPDATE contracts.deadline_signals SET last_sent_at = now() - interval '8 days' WHERE deadline_key=$1`, [k1]);
    g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j; assert.equal(g.solleciti + g.registrati, 1);
    x = await riga(k1); assert.equal(x.segnalazione.solleciti, 2);
    const inv = (await db.query(`SELECT kind, n FROM contracts.deadline_signal_sends WHERE deadline_key=$1 ORDER BY id`, [k1])).rows;
    assert.deepEqual(inv.map((i) => `${i.kind}${i.n}`), ['SEGNALAZIONE0', 'SOLLECITO1', 'SOLLECITO2']);
    const mail = (await db.query(`SELECT subject FROM public.email_log ORDER BY id DESC LIMIT 1`)).rows[0].subject;
    assert.match(mail, /sollecito n\. 2: Rinnovo convenzione di prova/);
  });

  test('i solleciti si fermano a mano e quando la scadenza viene chiusa; una segnalazione fermata può ripartire', async () => {
    assert.equal((await O.post('/api/contracts/stats/deadlines/segnala/ferma', { key: k1 })).j.fermate, 1);
    await db.query(`UPDATE contracts.deadline_signals SET last_sent_at = now() - interval '30 days'`);
    await db.query(`UPDATE contracts.deadlines SET done = TRUE WHERE id = $1`, [Number(k2.slice(1))]);   // scadenza chiusa: esce dal calendario
    const g = (await O.post('/api/contracts/stats/deadlines/solleciti/esegui', {})).j;
    assert.equal(g.attive, 1); assert.equal(g.chiuse, 1); assert.equal(g.solleciti + g.registrati, 0, 'nessun sollecito né per la fermata né per la chiusa');
    const x = await riga(k1); assert.equal(x.segnalazione.ferma, true); assert.equal(x.segnalazione.prossimo, null);
    assert.equal((await db.query(`SELECT stopped_reason FROM contracts.deadline_signals WHERE deadline_key=$1`, [k2])).rows[0].stopped_reason, 'scadenza chiusa o non più in calendario');
    const r = await O.post('/api/contracts/stats/deadlines/segnala', { keys: [k1] });
    assert.ok(['REGISTRATO', 'INVIATO'].includes(r.j.righe[0].esito));
    const y = await riga(k1); assert.equal(y.segnalazione.ferma, false); assert.equal(y.segnalazione.solleciti, 0);
  });

  test('solo chi scrive nel modulo segnala', async () => {
    const anon = H.client(S.base);
    assert.ok([401, 403].includes((await anon.post('/api/contracts/stats/deadlines/segnala', { keys: [k3] })).s));
    assert.equal((await O.post('/api/contracts/stats/deadlines/segnala', { keys: [] })).s, 400);
  });
});
