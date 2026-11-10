// v0.68.4 (richieste del CEO del 10/11/2026). A) Finance > Conto economico e Margine Service: stime commerciali dei soli clienti ATTIVI, in
// pro quota sul periodo (fatturato FY atteso × giorni lavorativi dopo l'avvio / 250), "Proiezione FY" a parte e mai sommata.
// B) Room Planning: l'impegno assegnato in "Sedi e ambulatori" arriva in Turni, Presenze e Calendario (impegni del piano di tutti i
// gruppi: medici, personale sanitario, accettazione; scheda Room creata in automatico; persone non agganciabili con il motivo e D52).
// Parte pura sempre; parte d'integrazione con la Suite vera su un database temporaneo (helpers/suiteTest.mjs) solo con DATABASE_URL_TEST.
// Dati solo fittizi.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Il database del processo si fissa PRIMA di caricare qualunque modulo della Suite: mai il database "suite" (la parte pura non ne usa;
// quella d'integrazione avvia la Suite su un database temporaneo suo).
process.env.DATABASE_URL = 'postgres://nessuno@127.0.0.1:1/nessun_database';
const { SALTA, avviaSuite, client, entra, OWNER } = await import('./helpers/suiteTest.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', 'web', 'src');
const must = (r, cosa) => { if (r.s >= 300) throw new Error(`${cosa}: ${r.s} ${r.text}`); return r.j; };

// ------------------------------------------------------------------ A. pro quota (puro)
describe('A · stime in pro quota (puro)', () => {
  let PQ, CE;
  before(async () => { PQ = await import('../src/modules/business/lib/proQuota.js'); CE = await import('../src/modules/finance/lib/contoEconomico.js'); });

  test('cliente attivo avviato a metà mese: la stima è la quota dei giorni lavorativi dall\'avvio', () => {
    // ottobre 2026: avvio venerdì 16 → 16, 19-23, 26-30 = 11 giorni lavorativi
    const st = CE.stimaProQuota({ fatturato_fy_atteso: 50000, volumi_giornalieri_attesi: 6 }, '2026-10', { giorniAnno: 250, avvio: '2026-10-16', oggi: '2026-11-10' });
    assert.equal(st.giorni, 11); assert.equal(st.valore, 2200); assert.equal(st.esami, 66);
    assert.match(st.nota, /11 giorni lavorativi dal 16\/10\/2026 al 31\/10\/2026 su 250/);
    // mese in corso: fino a oggi (10/11 → 2-6, 9-10 = 7 giorni)
    assert.equal(CE.stimaProQuota({ fatturato_fy_atteso: 50000 }, '2026-11', { avvio: '2026-10-16', oggi: '2026-11-10' }).giorni, 7);
    // somma dei mesi mai oltre il FY atteso pieno: con 248 giorni già contati restano 2 giorni
    assert.equal(CE.stimaProQuota({ fatturato_fy_atteso: 25000 }, '2026-12', { oggi: '2026-12-31', giorniUsati: 248 }).valore, 200);
    assert.equal(PQ.proQuotaPeriodo({ fatturato_fy_atteso: 1000, da: '2026-12-01', a: '2026-12-31', oggi: '2026-11-10' }).giorni, 0, 'periodo futuro');
    assert.equal(PQ.proQuotaPeriodo({ fatturato_fy_atteso: null, da: '2026-12-01', a: '2026-12-31' }), null);
  });
  test('stime e proiezione FY: righe non sommate, il totale dei ricavi resta l\'effettivo', () => {
    const p = CE.periodo(2026, 10);
    const st = CE.stimaProQuota({ fatturato_fy_atteso: 50000 }, '2026-10', { avvio: '2026-10-16', oggi: '2026-11-10' });
    const prod = CE.scegliProduzione({ stima: st });
    const cl = [{ org_id: 1, org_name: 'Cliente Attivo Prova', proiezione_fy: { anno: 2027, importo: 50000 }, mesi: { '2026-10': { ...CE.margineCliente({ produzione: prod }), produzione: { fonte: prod.fonte, stima: true, dettaglio_stima: st } } } }];
    const mov = CE.movimentiService(cl, { id: 10 }, p);
    assert.deepEqual(mov.map((m) => [m.riga, m.importo]), [['stime_service', 2200], ['proiezione_fy', 50000]]);
    assert.match(mov[0].descrizione, /pro quota del fatturato FY atteso su 11 giorni lavorativi/);
    const conto = CE.componiConto({ sedi: [{ id: 10, code: 'LAB', name: 'Laboratorio Prova', kind: 'LABORATORIO' }], movimenti: [...mov, { riga: 'ricavi_retail', site_id: 10, importo: 40 }], fonti: {} });
    assert.equal(conto.totale.ricavi, 40, 'né stime né proiezione nei ricavi');
    assert.equal(conto.colonne[0].margine, 40);
    assert.deepEqual(conto.totale.stime, { importo: 2200, clienti: 1 });
    assert.deepEqual(conto.totale.proiezione, { importo: 50000, clienti: 1, anno: 2027 });
    assert.equal(CE.RIGHE.find((r) => r.key === 'proiezione_fy').gruppo, 'PROIEZIONE');
  });
});

// ------------------------------------------------------------------ B. impegni della settimana-tipo (puro)
const sedeProva = (personale, extra = {}) => {
  const ore = (o, c) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, d < 5 ? { closed: false, open: o, close: c } : { closed: true, open: o, close: c }]));
  const vuota = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, []]));
  const lun_ven = (from, to) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, d < 5 ? [{ from, to }] : []]));
  const persona = (id, nome, tipo, o = {}) => ({ id, nome, tipo, disciplina: '', attrezzature: [], richiedeSanitario: false, dispositivi: [], supporto: '', disp: vuota, ...o });
  return {
    id: 1, denominazione: 'Sede Prova', hours: ore('08:00', '19:00'), deskCapacity: 1, deskCapAM: 1, deskCapPM: 1, deskSplit: '14:00', plan: { markers: {} },
    ambulatori: [{ id: 'a1', nome: 'Ambulatorio 1', discipline: ['Cardiologia'], attrezzature: [], disp: lun_ven('08:00', '19:00') },
      { id: 'pp', nome: 'Sala prelievi', discipline: ['Punto Prelievi'], attrezzature: [], disp: lun_ven('07:30', '10:00'), prelievi: lun_ven('08:00', '10:00') }],
    personale: personale({ persona, lun_ven }), ...extra,
  };
};
const personaleProva = ({ persona, lun_ven }) => [
  persona('m', 'Medico Prova', 'medico', { person_id: 11, disciplina: 'Cardiologia', discipline: ['Cardiologia'], disp: lun_ven('09:00', '13:00'), richiedeSanitario: true, supportoIds: ['s'] }),
  persona('s', 'Infermiera Prova', 'sanitario', { person_id: 12, contratto: 'dipendente', oreContratto: 30, profilo: 'Infermiere' }),
  persona('a', 'Accettista Prova', 'accettazione', { person_id: 13, oreContratto: 30 }),
  persona('pp', 'Punto prelievi', 'sanitario'),
];

describe('B · impegni della settimana-tipo (puro)', () => {
  let I;
  before(async () => { I = await import('../src/modules/room/lib/impegni.js'); });

  test('dal piano: medico in ambulatorio, sanitario di supporto e ai prelievi, accettazione al desk; le attività restano fuori', () => {
    const imp = I.impegniSettimana(sedeProva(personaleProva));
    const lun = imp.filter((x) => x.d === 0);
    const di = (rowId) => lun.filter((x) => x.rowId === rowId);
    assert.deepEqual(di('m').map((x) => [x.s, x.e, x.attivita]), [[540, 780, 'Ambulatorio 1 · Cardiologia']]);
    assert.ok(di('s').some((x) => /^Supporto Medico Prova/.test(x.attivita) && x.s === 540 && x.e === 780), 'supporto al medico');
    assert.ok(di('s').some((x) => /^Punto prelievi/.test(x.attivita) && x.s === 480 && x.e === 540), 'prelievi 8-9 (dalle 9 è di supporto)');
    assert.ok(di('a').length >= 1 && di('a').every((x) => x.gruppo === 'accettazione' && x.room === 'Accettazione'), 'turni del desk');
    assert.equal(lun.some((x) => x.rowId === 'pp'), false, 'riga "Punto prelievi": attività, non persona');
    assert.deepEqual(I.personeDiSede(sedeProva(personaleProva)).map((x) => [x.rowId, x.person_id, x.gruppo]), [['m', 11, 'medico'], ['s', 12, 'sanitario'], ['a', 13, 'accettazione']]);
  });
  test('turnazione del desk: settimana A nelle settimane ISO dispari, B nelle pari', () => {
    assert.equal(I.settimanaIso('2026-11-10'), 46); assert.equal(I.settimanaIso('2027-01-01'), 53); assert.equal(I.settimanaIso('2026-01-01'), 1);
    assert.equal(I.settimanaTurnazione('2026-11-16'), 0); assert.equal(I.settimanaTurnazione('2026-11-10'), 1);
    const str = sedeProva(({ persona }) => [persona('a1', 'Accettista Uno', 'accettazione', { oreContratto: 30, turnazione: true, turnoPref: 'mattina' }), persona('a2', 'Accettista Due', 'accettazione', { oreContratto: 30, turnazione: true, turnoPref: 'pomeriggio' })]);
    const A = I.impegniDelGiorno(str, null, '2026-11-16'), B = I.impegniDelGiorno(str, null, '2026-11-23');
    const primo = (l) => l.filter((x) => x.rowId === 'a1').map((x) => x.s)[0];
    assert.ok(primo(A) < primo(B), 'Accettista Uno di mattina nella settimana A, di pomeriggio nella B');
  });
  test('il modulo è identico sul server e nel browser', () => {
    assert.equal(fs.readFileSync(path.join(HERE, '..', 'src', 'modules', 'room', 'lib', 'impegni.js'), 'utf8'), fs.readFileSync(path.join(WEB, 'modules', 'room', 'lib', 'impegni.js'), 'utf8'));
  });
  test('Calendario: la settimana datata mostra anche il desk di accettazione e i prelievi', async () => {
    const N = await import(path.join(WEB, 'modules/room/lib/network.js'));
    const net = N.buildNetwork([sedeProva(personaleProva)]);
    const w = N.datedWeek(net, [], '2026-11-16');
    const lun = w.giorni[0].sessioni;
    assert.ok(lun.some((q) => q.nome === 'Medico Prova' && q.room === 'Ambulatorio 1'));
    assert.ok(lun.some((q) => q.nome === 'Accettista Prova' && q.roomId === 'desk' && q.tipo === 'accettazione'));
    assert.ok(lun.some((q) => q.nome === 'Infermiera Prova' && /Punto prelievi/.test(q.disciplina)));
    assert.ok(net.byKey[N.personKey('Accettista Prova')], 'l\'accettazione è nel network (filtro per persona)');
    const ass = N.datedWeek(net, [{ kind: 'ASSENZA', persona_key: N.personKey('Accettista Prova'), dal: '2026-11-16', al: '2026-11-16' }], '2026-11-16');
    assert.ok(ass.giorni[0].sessioni.some((q) => q.nome === 'Accettista Prova' && q.stato === 'assente'));
  });
});

// ------------------------------------------------------------------ integrazione
describe('v0.68.4 con la Suite su un database temporaneo', { skip: SALTA }, () => {
  let S, o, db, lf;
  const id = {};
  const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  before(async () => {
    S = await avviaSuite();
    o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale);
    for (const k of ['business', 'room', 'retail']) must(await o.post(`/api/travaso/${k}/run`, {}), `avvio ${k}`);
    // Finance Management si avvia con il travaso da una sorgente vuota di prova (nessun dato copiato), poi LIVE
    lf = `${S.url.match(/\/([^/?]+)(\?|$)/)[1]}_lf`;
    const adm = new pg.Client({ connectionString: S.url }); await adm.connect(); await adm.query(`CREATE DATABASE ${lf}`); await adm.end();
    const lfUrl = S.url.replace(/\/([^/?]+)(\?|$)/, `/${lf}$2`) + (S.url.includes('?') ? '&' : '?') + 'sslmode=disable';
    must(await o.put('/api/legacy/sources/finance/credential', { database_url: lfUrl }), 'sorgente Finance');
    must(await o.post('/api/travaso/finance/run', {}), 'travaso Finance');
    must(await o.post('/api/travaso/finance/live', {}), 'Finance LIVE');
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    id.lab = (await uno(`INSERT INTO public.sites (code, name, kind, city, province) VALUES ('LAB-T', 'Laboratorio Prova', 'LABORATORIO', 'Firenze', 'FI') RETURNING id`)).id;
    id.sede = (await uno(`INSERT INTO public.sites (code, name, kind, city, province) VALUES ('POL-T', 'Poliambulatorio Prova', 'POLIAMBULATORIO', 'Firenze', 'FI') RETURNING id`)).id;
  }, { timeout: 240000 });
  after(async () => {
    await db?.end().catch(() => {});
    await S?.stop();
    if (lf) { const adm = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST }); await adm.connect(); await adm.query(`DROP DATABASE IF EXISTS ${lf} WITH (FORCE)`).catch(() => {}); await adm.end(); }
  });

  test('A · conto economico e margine Service: solo clienti attivi, pro quota, proiezione FY separata, prospect e contrattualizzati fuori', async () => {
    const acc = async (code, nome, sql, par) => { const org = (await uno(`INSERT INTO public.organizations (kind, code, name) VALUES ('CLIENTE', $1, $2) RETURNING id`, [code, nome])).id; await db.query(sql, [org, ...par]); return org; };
    id.alfa = await acc('ALFA-T', 'Clinica Alfa Prova', `INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, data_avvio_effettiva, attivo_dal, volumi_giornalieri_attesi) VALUES ($1, 'SRV', FALSE, TRUE, 7, $2, '2026-10-16', '2026-10-16', 8)`, [50000]);
    id.gamma = await acc('GAMMA-T', 'Studio Gamma Prova', `INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso, contrattualizzato_at) VALUES ($1, 'SRV', FALSE, FALSE, 6, $2, now())`, [70000]);
    id.delta = await acc('DELTA-T', 'Ambulatorio Delta Prova', `INSERT INTO business.accounts (organization_id, linea, prospect, cliente_attivo, fase_corrente, fatturato_fy_atteso) VALUES ($1, 'SRV', TRUE, FALSE, 2, $2)`, [80000]);
    const c = must(await o.get('/api/finance/controllo/conto-economico?anno=2026&mese=10'), 'conto economico');
    assert.deepEqual(c.totale.stime, { importo: 2200, clienti: 1 }, '50.000 × 11 / 250: solo il cliente attivo, dal 16 ottobre');
    assert.deepEqual(c.totale.proiezione, { importo: 50000, clienti: 1, anno: 2027 });
    assert.equal(c.totale.ricavi, 0, 'stime e proiezione mai sommate');
    const righe = c.colonne.flatMap((x) => x.voci.stime_service.righe);
    assert.deepEqual(righe.map((r) => r.org_id), [id.alfa]);
    assert.ok(c.da_dove.ricavi.some((t) => /Proiezione FY 2027/.test(t)));
    const m = must(await o.get('/api/finance/controllo/margine-service?anno=2026&mese=10'), 'margine Service');
    assert.deepEqual(m.clienti.map((x) => x.org_id), [id.alfa]);
    assert.equal(m.clienti[0].totale.ricavo_stime, 2200); assert.equal(m.totale.ricavo_effettivo, null);
    assert.deepEqual(m.esclusi_non_attivi.map((x) => x.org_id), [id.gamma], 'contrattualizzato non avviato: fuori');
    assert.equal(m.proiezione.importo, 50000);
    for (const u of ['conto-economico/export.xlsx', 'conto-economico/export.pdf', 'margine-service/export.xlsx', 'margine-service/export.pdf']) assert.equal((await o.get(`/api/finance/controllo/${u}?anno=2026&mese=10`)).s, 200, u);
  });

  test('B · persona scelta col selettore nella sede → scheda Room automatica → turni generati, presenze e calendario la mostrano', async () => {
    const p = async (sql, par = []) => (await uno(sql, par)).id;
    id.med = await p(`INSERT INTO public.people (kind, status, last_name, first_name, discipline) VALUES ('MEDICO', 'ATTIVO', 'Prova', 'Medico', 'Cardiologia') RETURNING id`);
    id.inf = await p(`INSERT INTO public.people (kind, status, last_name, first_name, job_title) VALUES ('DIPENDENTE', 'ATTIVO', 'Prova', 'Infermiera', 'Infermiere') RETURNING id`);
    // ESTERNO senza ruolo, disciplina, sede né scheda: prima della v0.68.4 non era pianificabile e restava "non censito"
    id.est = await p(`INSERT INTO public.people (kind, status, last_name, first_name) VALUES ('ESTERNO', 'ATTIVO', 'Prova', 'Accettista') RETURNING id`);
    id.escl = await p(`INSERT INTO public.people (kind, status, last_name, first_name) VALUES ('DIPENDENTE', 'ATTIVO', 'Prova', 'Esclusa') RETURNING id`);
    await db.query(`INSERT INTO room.person_ext (person_id, planning_excluded) VALUES ($1, TRUE)`, [id.escl]);
    assert.equal((await uno('SELECT pianificabile FROM room.professionisti_v WHERE id=$1', [id.est])).pianificabile, false);
    const cur = must(await o.get(`/api/room/strutture/${id.sede}`), 'sede');
    const doc = sedeProva(({ persona, lun_ven }) => [
      persona('m', 'Medico Prova', 'medico', { person_id: id.med, disciplina: 'Cardiologia', discipline: ['Cardiologia'], disp: lun_ven('09:00', '13:00'), richiedeSanitario: true, supportoIds: ['s'] }),
      persona('s', 'Infermiera Prova', 'sanitario', { person_id: id.inf, contratto: 'dipendente', oreContratto: 30, profilo: 'Infermiere' }),
      persona('a', 'Accettista Prova', 'accettazione', { person_id: id.est, oreContratto: 30 }),
      persona('x', 'Persona Inesistente Prova', 'sanitario', {}),
      persona('e', 'Esclusa Prova', 'accettazione', { person_id: id.escl, oreContratto: 10 }),
    ]);
    const { id: _i, denominazione: _d, ...data } = doc;
    const sv = must(await o.put(`/api/room/strutture/${id.sede}`, { data, version: cur.version }), 'salvataggio della sede');
    assert.equal(sv.schede_create, 3, 'medico, infermiera e accettista ricevono la scheda Room');
    assert.deepEqual(sv.nonAgganciati.map((x) => x.nome).sort(), ['Esclusa Prova', 'Persona Inesistente Prova']);
    assert.match(sv.nonAgganciati.find((x) => x.nome === 'Persona Inesistente Prova').motivo, /D52/);
    assert.match(sv.nonAgganciati.find((x) => x.nome === 'Esclusa Prova').motivo, /esclusa dalla pianificazione/);
    const v = await uno('SELECT p.pianificabile, e.tipo, e.profilo FROM room.professionisti_v p JOIN room.person_ext e ON e.person_id = p.id WHERE p.id=$1', [id.est]);
    assert.deepEqual([v.pianificabile, v.tipo, v.profilo], [true, 'sanitario', 'Accettazione']);
    assert.ok(must(await o.get('/api/room/personale/professionisti?pianificabili=1'), 'pianificabili').some((x) => x.id === id.est), 'subito tra i pianificabili');
    assert.equal(must(await o.get(`/api/room/strutture/${id.sede}`), 'sede').nonAgganciati.length, 2, 'avviso anche all\'apertura della sede');

    // Turni: una settimana, poi il mese
    const g = must(await o.post('/api/room/personale/turni/genera', { settimana: '2026-11-18', sede_id: id.sede }), 'genera settimana');
    assert.deepEqual([g.dal, g.al], ['2026-11-16', '2026-11-22']);
    const t1 = must(await o.get(`/api/room/personale/turni?mese=2026-11&sede_id=${id.sede}`), 'turni').turni;
    const chi = (l) => new Set(l.map((x) => x.prof_id));
    assert.deepEqual([...chi(t1)].sort(), [id.med, id.inf, id.est].sort(), 'medico, infermiera e accettista');
    assert.ok(t1.every((x) => x.data >= '2026-11-16' && x.data <= '2026-11-20'), 'solo la settimana (sabato e domenica chiusi)');
    assert.ok(t1.some((x) => x.prof_id === id.est && x.attivita.startsWith('Accettazione') && x.profilo === 'Accettazione'));
    assert.ok(t1.some((x) => x.prof_id === id.med && x.ora_da === '09:00' && x.ora_a === '13:00' && x.room_id === 'a1'));
    assert.ok(t1.some((x) => x.prof_id === id.inf && /Punto prelievi/.test(x.attivita) && /Supporto Medico Prova/.test(x.attivita)), 'prelievi 8-9 e supporto 9-13 accorpati');
    assert.deepEqual(g.nonAgganciati.map((x) => x.nome).sort(), ['Esclusa Prova', 'Persona Inesistente Prova']);
    assert.equal(g.nonAgganciati[0].diagnostica, '/admin/diagnostica'); assert.equal(g.nonAgganciati[0].link, `/room/sedi/${id.sede}`);
    const gm = must(await o.post('/api/room/personale/turni/genera', { mese: '2026-11', sede_id: id.sede }), 'genera mese');
    assert.ok(gm.created > 0 && gm.skipped === t1.length, 'la settimana già generata non si duplica');
    const solo = must(await o.post('/api/room/personale/turni/genera', { mese: '2026-12', sede_id: id.sede, tipo: 'accettazione' }), 'solo accettazione');
    const dic = must(await o.get(`/api/room/personale/turni?mese=2026-12&sede_id=${id.sede}`), 'turni dicembre').turni;
    assert.ok(solo.created > 0 && dic.every((x) => x.prof_id === id.est));

    // Presenze: giornata precompilata dai turni e dal piano, mese con le persone della sede
    const pg1 = must(await o.get(`/api/room/personale/presenze/giorno?sede_id=${id.sede}&data=2026-11-16`), 'presenze del giorno');
    assert.deepEqual([...chi(pg1.turni)].sort(), [id.med, id.inf, id.est].sort());
    assert.ok(pg1.pianificati.some((x) => x.prof_id === id.est && x.gruppo === 'accettazione'));
    assert.deepEqual(pg1.nonAgganciati.map((x) => x.nome).sort(), ['Esclusa Prova', 'Persona Inesistente Prova']);
    const pm = must(await o.get(`/api/room/personale/presenze/mese?sede_id=${id.sede}&mese=2026-11`), 'presenze del mese');
    assert.deepEqual(pm.persone.map((x) => x.prof_id).sort(), [id.med, id.inf, id.est].sort());
    assert.ok(pm.persone.every((x) => x.turni > 0 && x.in_sede));
    const t0 = pg1.turni.find((x) => x.prof_id === id.est);
    must(await o.post('/api/room/personale/presenze/conferma', { sede_id: id.sede, data: '2026-11-16', items: [{ prof_id: id.est, ora_da: t0.ora_da, ora_a: t0.ora_a, turno_id: t0.id, origine: 'TURNO' }] }), 'conferma presenza');
    assert.equal(must(await o.get(`/api/room/personale/presenze/mese?sede_id=${id.sede}&mese=2026-11`), 'mese').persone.find((x) => x.prof_id === id.est).presenze, 1);

    // Calendario: lo stesso documento della sede, nel browser, mostra il desk e il medico sulle date reali
    const N = await import(path.join(WEB, 'modules/room/lib/network.js'));
    const strutture = must(await o.get('/api/room/strutture'), 'elenco sedi');
    const w = N.datedWeek(N.buildNetwork(strutture), [], '2026-11-16');
    const lun = w.giorni[0].sessioni;
    assert.ok(lun.some((q) => q.sedeId === id.sede && q.nome === 'Accettista Prova' && q.tipo === 'accettazione'));
    assert.ok(lun.some((q) => q.sedeId === id.sede && q.nome === 'Medico Prova' && q.room === 'Ambulatorio 1'));
  });
});
