// v0.93.0 · Non conformità: il responsabile di un'azione correttiva o preventiva si sceglie dall'elenco del personale (dipendenti e
// liberi professionisti), riceve la notifica, trova l'azione in "Le mie azioni" e ne aggiorna lo stato. Senza profilo sul widget entra
// con il profilo implicito AZIONI: vede e aggiorna SOLO le proprie azioni, nient'altro del widget. Dati sintetici.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Non conformità: azioni assegnate al personale e Le mie azioni', { skip: SALTA }, () => {
  let H, S, db, O, D, ncId, resp, altro, lp, esterno, U, U2, azId;
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const utente = async (last, first, email, pw) => {
    const pe = must(await O.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: last, first_name: first, email }), 'persona');
    await new Promise((r) => setTimeout(r, 1200));
    const uid = (await O.get(`/api/people/${pe.id}`)).j.user_id;
    await O.put(`/api/users/${uid}`, { auth_provider: 'BOTH' });
    await O.del(`/api/users/${uid}/grants/nc`);   // nessun profilo sul widget NC
    const rp = must(await O.post(`/api/users/${uid}/reset-password`, {}), 'password');
    return { person: pe.id, uid, c: await H.entra(H.client(S.base), email, rp.temporaryPassword, pw) };
  };
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base); O = D.o;
    for (const p of ['/api/travaso/nc/run', '/api/travaso/nc/live']) assert.equal((await O.post(p)).s, 200, p);
    await db.query(`INSERT INTO nc.accettazioni (id, sede_id, origine) VALUES ('2026/AZ001', $1, 'MANUALE')`, [D.site.pp1]);
    ncId = (await db.query(`INSERT INTO nc.nc (codice, accettazione_id, sede_id, macro, gravita, descrizione, azione_attesa) VALUES ('NC-2026-AZ01', '2026/AZ001', $1, 'FISICA', 'MINORE', 'Campione di prova non idoneo', 'Nuovo prelievo') RETURNING id`, [D.site.pp1])).rows[0].id;
    resp = await utente('Responsabiletest', 'Rita', 'rita.responsabiletest@toscanadiagnostica.it', 'Resp-Azioni-2026x');
    altro = await utente('Altrotest', 'Aldo', 'aldo.altrotest@toscanadiagnostica.it', 'Altro-Azioni-2026x');
    lp = must(await O.post('/api/people', { kind: 'LP', status: 'ATTIVO', last_name: 'Liberotest', first_name: 'Lia' }), 'LP senza accesso');
    esterno = must(await O.post('/api/people', { kind: 'ESTERNO', status: 'ATTIVO', last_name: 'Esternotest', first_name: 'Ezio' }), 'esterno');
    U = resp.c; U2 = altro.c;
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('senza azioni assegnate e senza profilo il widget resta chiuso', async () => {
    assert.equal((await U.get('/api/nc/state')).s, 403);
    assert.equal((await U.get('/api/nc/mie-azioni')).s, 403);
    const home = JSON.stringify((await U.get('/api/home/modules')).j); assert.ok(!home.includes('"key":"nc"'));
  });

  test('elenco del personale: dipendenti e liberi professionisti attivi; il responsabile si sceglie da lì', async () => {
    const el = must(await O.get('/api/nc/personale-assegnabile'), 'elenco');
    const nomi = el.map((x) => x.nome);
    assert.ok(nomi.includes('Responsabiletest Rita') && nomi.includes('Liberotest Lia')); assert.ok(!nomi.includes('Esternotest Ezio'), 'gli esterni no');
    assert.equal(el.find((x) => x.id === resp.person).ha_accesso, true); assert.equal(el.find((x) => x.id === lp.id).ha_accesso, false); assert.equal(el.find((x) => x.id === lp.id).kind, 'LP');
    assert.equal((await O.post(`/api/nc/nc/${ncId}/azioni`, { tipo: 'PREVENTIVA', descrizione: 'Azione con responsabile non valido', responsabile_person_id: esterno.id })).s, 400);
    const a = must(await O.post(`/api/nc/nc/${ncId}/azioni`, { tipo: 'PREVENTIVA', descrizione: 'Formazione specifica. Verifica preventiva del Vademecum.', responsabile_person_id: resp.person, scadenza: '2026-12-31' }), 'azione');
    azId = a.id;
    assert.equal(a.responsabile, 'Responsabiletest Rita'); assert.equal(a.responsabile_person_id, resp.person); assert.equal(a.responsabile_avvisato, true);
    // libero professionista senza accesso alla Suite: l'azione si salva, ma chi assegna viene avvertito
    const b = must(await O.post(`/api/nc/nc/${ncId}/azioni`, { tipo: 'CORRETTIVA', descrizione: 'Azione per il libero professionista', responsabile_person_id: lp.id }), 'azione LP');
    assert.equal(b.responsabile_senza_accesso, true); assert.equal(b.responsabile_avvisato, false);
    // un'azione di un'altra persona, per verificare l'isolamento
    must(await O.post(`/api/nc/nc/${ncId}/azioni`, { tipo: 'CORRETTIVA', descrizione: 'Azione di Aldo, non di Rita', responsabile_person_id: altro.person }), 'azione altro');
  });

  test('il responsabile: notifica, widget in Home con contatore, solo le proprie azioni e nient\'altro del widget', async () => {
    const no = (await U.get('/api/notifications')).j; const lista = no.rows || [];
    const n = lista.find((x) => /Azione preventiva assegnata a te · NC-2026-AZ01/.test(x.title));
    assert.ok(n, JSON.stringify(lista).slice(0, 300)); assert.equal(n.link, '/nc/mie-azioni'); assert.match(n.body, /entro il 31\/12\/2026/);
    const home = (await U.get('/api/home/modules')).j.areas.flatMap((a) => a.modules).find((m) => m.key === 'nc');
    assert.ok(home); assert.equal(home.href, '/nc/mie-azioni'); assert.equal(home.profile, 'AZIONI');
    const cnt = (await U.get('/api/home/counters')).j.nc; assert.equal(cnt.value, 1); assert.match(cnt.label, /Azione da fare/);
    const st = must(await U.get('/api/nc/state'), 'state'); assert.equal(st.user.role, 'AZIONI');
    assert.deepEqual(must(await U.get('/api/nc/badges'), 'badges'), { mie_azioni: 1 });
    const mie = must(await U.get('/api/nc/mie-azioni'), 'mie');
    assert.deepEqual(mie.righe.map((x) => x.id), [azId]); assert.equal(mie.righe[0].nc_codice, 'NC-2026-AZ01'); assert.equal(mie.righe[0].scadenza, '2026-12-31');
    assert.ok(!JSON.stringify(mie).includes('2026/AZ001'), 'nessun dato dell\'accettazione');
    // elenco chiuso: nessun'altra parte del widget
    for (const p of ['/api/nc/nc', `/api/nc/nc/${ncId}`, '/api/nc/stats/summary', '/api/nc/sedi', '/api/nc/personale-assegnabile', '/api/nc/accettazioni', '/api/nc/audit']) assert.equal((await U.get(p)).s, 403, p);
    assert.equal((await U.post(`/api/nc/nc/${ncId}/azioni`, { tipo: 'CORRETTIVA', descrizione: 'Non posso creare azioni' })).s, 403);
    assert.equal((await U.put(`/api/nc/nc/${ncId}/azioni/${azId}`, { stato: 'COMPLETATA' })).s, 403);
  });

  test('aggiornamento dello stato dal responsabile; non può toccare le azioni degli altri', async () => {
    let r = await U.put(`/api/nc/mie-azioni/${azId}`, { stato: 'IN_CORSO', nota: 'Corso fissato per il 10 dicembre' });
    assert.equal(r.s, 200, r.text); assert.equal(r.j.stato, 'IN_CORSO'); assert.equal(r.j.resp_nota, 'Corso fissato per il 10 dicembre');
    assert.equal((await U.put(`/api/nc/mie-azioni/${azId}`, { stato: 'ANNULLATA' })).s, 400, 'annullare resta alla Qualità');
    assert.equal((await U.put(`/api/nc/mie-azioni/${azId}`, {})).s, 400);
    const diAldo = (await db.query(`SELECT id FROM nc.nc_azioni WHERE responsabile_person_id = $1`, [altro.person])).rows[0].id;
    assert.equal((await U.put(`/api/nc/mie-azioni/${diAldo}`, { stato: 'COMPLETATA' })).s, 404);
    assert.deepEqual(must(await U2.get('/api/nc/mie-azioni'), 'mie di Aldo').righe.map((x) => x.id), [diAldo]);
    r = await U.put(`/api/nc/mie-azioni/${azId}`, { stato: 'COMPLETATA' });
    assert.equal(r.j.stato, 'COMPLETATA'); assert.ok(r.j.completata_at); assert.equal(r.j.resp_nota, 'Corso fissato per il 10 dicembre', 'la nota resta');
    assert.deepEqual(must(await U.get('/api/nc/badges'), 'badges'), { mie_azioni: 0 });
    assert.equal((await U.get('/api/home/counters')).j.nc, undefined);
    // chi gestisce la NC vede stato e nota del responsabile, e ha ricevuto l'avviso
    const det = must(await O.get(`/api/nc/nc/${ncId}`), 'dettaglio').azioni.find((x) => x.id === azId);
    assert.equal(det.stato, 'COMPLETATA'); assert.equal(det.resp_nota, 'Corso fissato per il 10 dicembre'); assert.equal(det.responsabile_ha_accesso, true);
    const no = (await O.get('/api/notifications')).j; const lista = no.rows || [];
    assert.ok(lista.some((x) => /NC-2026-AZ01 · azione completata/.test(x.title)), JSON.stringify(lista.map((x) => x.title)).slice(0, 400));
    const aud = (await db.query(`SELECT count(*)::int AS n FROM nc.audit_log WHERE action = 'NC_ACTION_RESP_UPDATE'`)).rows[0].n; assert.equal(aud, 2);
  });

  test('cambio di responsabile: avviso al nuovo, il precedente non la vede più; modifica senza toccare il responsabile lo conserva', async () => {
    let r = await O.put(`/api/nc/nc/${ncId}/azioni/${azId}`, { stato: 'IN_CORSO', note: 'Riaperta dalla Qualità' });
    assert.equal(r.s, 200, r.text); assert.equal(r.j.responsabile_person_id, resp.person, 'responsabile non toccato'); assert.equal(r.j.responsabile, 'Responsabiletest Rita');
    r = await O.put(`/api/nc/nc/${ncId}/azioni/${azId}`, { responsabile_person_id: altro.person });
    assert.equal(r.j.responsabile, 'Altrotest Aldo'); assert.equal(r.j.responsabile_avvisato, true);
    assert.equal((await U.get('/api/nc/mie-azioni')).s, 403, 'senza più azioni assegnate il widget torna chiuso');
    assert.equal(must(await U2.get('/api/nc/mie-azioni'), 'mie di Aldo').righe.length, 2);
    r = await O.put(`/api/nc/nc/${ncId}/azioni/${azId}`, { responsabile_person_id: null });
    assert.equal(r.j.responsabile, null); assert.equal(r.j.responsabile_person_id, null);
  });
});
