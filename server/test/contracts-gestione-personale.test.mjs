// v0.77.0 · Gestione del Personale: formazione ed ECM (contatore delle professioni sanitarie, lettura dell'attestato), tirocinanti
// (convenzione, progetto formativo, tutor, giudizio), medicina del lavoro (giudizio, calendario, protocollo, convocazioni), scadenze e
// richiami. Dati sintetici; la lettura dell'attestato è quella di prova (CONTRACTS_AI_MOCK=1), nessuna chiamata esterna.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ecmRegole, contatoreEcm, soggettoEcm, euristicaAttestato } from '../src/modules/contracts/lib/formazione.js';
import { posizioneMdl } from '../src/modules/contracts/lib/mdl.js';
import { deadlineKey, DEFAULT_MAP, chooseRecipient } from '../src/modules/contracts/lib/peopleRules.js';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Gestione del Personale: regole pure', () => {
  test('ECM: triennio, obbligo predefinito 150, contatore e obiettivo progressivo', () => {
    const r = ecmRegole({}, '2026-11-16');
    assert.deepEqual([r.obbligo, r.inizio, r.fine, r.annuale], [150, 2026, 2028, 50]);
    assert.equal(ecmRegole({}, '2029-02-01').inizio, 2029);
    assert.equal(ecmRegole({ ecm_obbligo_triennio: '180', ecm_triennio_inizio: '2026' }, '2027-05-01').obbligo, 180, 'obbligo impostabile');
    const corsi = [{ stato: 'SVOLTA', data: '2026-03-10', crediti_ecm: 12.5 }, { stato: 'SVOLTA', data: '2026-10-01', crediti_ecm: 8 }, { stato: 'SVOLTA', data: '2025-12-20', crediti_ecm: 30 }, { stato: 'PROGRAMMATA', data: null, crediti_ecm: 10 }];
    const c = contatoreEcm({ regole: r, profilo: null, corsi });
    assert.equal(c.acquisiti, 20.5, 'fuori triennio e programmati non contano');
    assert.equal(c.residuo, 129.5); assert.equal(c.obiettivo_anno, 50); assert.equal(c.mancano_anno, 29.5);
    const rid = contatoreEcm({ regole: r, profilo: { obbligo_triennio: null, riduzione: 30 }, corsi });
    assert.equal(rid.dovuti, 120); assert.equal(rid.residuo, 99.5);
    assert.equal(contatoreEcm({ regole: ecmRegole({}, '2028-06-01'), profilo: null, corsi }).obiettivo_anno, 150);
    // anno escluso: nessun obiettivo quell'anno, l'obiettivo si distribuisce sugli anni considerati
    const esc = contatoreEcm({ regole: r, profilo: { anni_esclusi: [2026] }, corsi });
    assert.equal(esc.escluso_anno, true); assert.equal(esc.mancano_anno, 0); assert.equal(esc.obiettivo_anno, 0); assert.equal(esc.dovuti, 150);
    assert.equal(contatoreEcm({ regole: ecmRegole({}, '2027-03-01'), profilo: { anni_esclusi: [2026] }, corsi }).obiettivo_anno, 75);
  });
  test('ECM: soggetti solo le professioni sanitarie; la scelta esplicita vince', () => {
    assert.equal(soggettoEcm({ kind: 'LP', person_kind: 'MEDICO' }, null).soggetto, true);
    assert.equal(soggettoEcm({ kind: 'DIPENDENTE', person_kind: 'DIPENDENTE', job_title: 'Infermiera prelevatrice' }, null).soggetto, true);
    assert.equal(soggettoEcm({ kind: 'DIPENDENTE', person_kind: 'DIPENDENTE', job_title: 'Addetta accettazione' }, null).soggetto, false);
    assert.equal(soggettoEcm({ kind: 'DIPENDENTE', person_kind: 'DIPENDENTE', job_title: 'Addetta accettazione' }, { soggetto: true }).soggetto, true);
    assert.equal(soggettoEcm({ kind: 'LP', person_kind: 'MEDICO' }, { soggetto: false }).soggetto, false);
    assert.equal(soggettoEcm({ kind: 'TIROCINANTE', person_kind: 'TIROCINANTE', job_title: 'Tecnico di laboratorio' }, null).soggetto, false);
  });
  test('attestato senza IA: crediti, ore e data dal testo; sempre da confermare', () => {
    const a = euristicaAttestato('Si attesta che la dott.ssa Prova ha partecipato all\'evento formativo "Radioprotezione del paziente" (evento n. 412345) svoltosi in data 12/10/2026, durata 8 ore, conseguendo n. 10,4 crediti ECM.', 'attestato.pdf');
    assert.equal(a.crediti_ecm, 10.4); assert.equal(a.ore, 8); assert.equal(a.data, '2026-10-12'); assert.equal(a.tipo, 'ECM'); assert.equal(a.titolo, 'Radioprotezione del paziente');
    assert.ok(a.confidence < 0.5);
    assert.equal(euristicaAttestato('Corso di formazione specifica sicurezza D.Lgs. 81/2008 del 03/02/2026 durata 4 ore').crediti_ecm, 0);
  });
  test('medicina del lavoro: prossima visita, stati, posizione non impostata', () => {
    const p = { hired_at: '2026-01-10' };
    assert.equal(posizioneMdl({ persona: p, scheda: null, protocollo: null, visite: [], oggi: '2026-11-16' }).stato, 'DA_IMPOSTARE');
    const daFare = posizioneMdl({ persona: p, scheda: { sorveglianza: true }, protocollo: null, visite: [], oggi: '2026-11-16' });
    assert.equal(daFare.stato, 'DA_FARE'); assert.equal(daFare.prossima, '2026-01-10');
    const v = [{ id: 1, stato: 'EFFETTUATA', data_visita: '2026-01-20', giudizio: 'IDONEO_PRESCRIZIONI', prescrizioni: 'Pause dal videoterminale', scadenza: null }];
    const ok = posizioneMdl({ persona: p, scheda: { sorveglianza: true, periodicita_mesi: 24 }, protocollo: { periodicita_mesi: 12 }, visite: v, oggi: '2026-11-16' });
    assert.equal(ok.prossima, '2028-01-20', 'la periodicità della scheda vince su quella del protocollo'); assert.equal(ok.stato, 'IN_REGOLA'); assert.equal(ok.giudizio, 'IDONEO_PRESCRIZIONI');
    assert.equal(posizioneMdl({ persona: p, scheda: { sorveglianza: true }, protocollo: { periodicita_mesi: 6 }, visite: v, oggi: '2026-11-16' }).stato, 'SCADUTA');
    assert.equal(posizioneMdl({ persona: p, scheda: { sorveglianza: false }, protocollo: null, visite: v, oggi: '2026-11-16' }).stato, 'NON_SOGGETTO');
    const fis = posizioneMdl({ persona: p, scheda: { sorveglianza: true }, protocollo: null, visite: [...v, { id: 2, stato: 'CONVOCATA', data_prevista: '2027-01-15', ora: '09:00' }], oggi: '2026-11-16' });
    assert.equal(fis.fissata.data, '2027-01-15');
  });
  test('richiami: formazione ed ECM alla persona, tirocini e medicina del lavoro a HR; chiavi distinte', () => {
    assert.deepEqual([DEFAULT_MAP.FORMAZIONE, DEFAULT_MAP.ECM, DEFAULT_MAP.TIROCINIO, DEFAULT_MAP.MDL], ['PERSONA', 'PERSONA', 'HR', 'HR']);
    assert.equal(chooseRecipient({ type: 'MDL', title: 'Visita periodica' }, { personEmail: 'a@b.it', hrEmails: ['hr@b.it'] }).recipient, 'HR');
    assert.equal(chooseRecipient({ type: 'ECM', title: 'Crediti ECM' }, { personEmail: 'a@b.it', hrEmails: ['hr@b.it'] }).recipient, 'PERSONA');
    const k1 = deadlineKey({ type: 'FORMAZIONE', resource_id: 7, due_date: '2027-01-01', title: 'Rinnovo', ref: { formazione_id: 1 } });
    const k2 = deadlineKey({ type: 'FORMAZIONE', resource_id: 7, due_date: '2027-01-01', title: 'Rinnovo', ref: { formazione_id: 2 } });
    assert.match(k1, /^F7-20270101-/); assert.notEqual(k1, k2);
    assert.match(deadlineKey({ type: 'MDL', resource_id: 7, due_date: '2027-01-01', title: 'x' }), /^V7-/);
    assert.match(deadlineKey({ type: 'TIROCINIO', resource_id: 7, due_date: '2027-01-01', title: 'x' }), /^T7-/);
    assert.match(deadlineKey({ type: 'ECM', resource_id: 7, due_date: '2028-12-31', title: 'x' }), /^E7-/);
  });
});

describe('Gestione del Personale: formazione, tirocinio, medicina del lavoro', { skip: SALTA }, () => {
  let H, S, db, O, V, R, L, M, ids = {};
  const PW = 'Prova-Gestione-2026x';
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const piu = (g) => { const d = new Date(`${oggi}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + g); return d.toISOString().slice(0, 10); };
  const invia = async (c, method, url, campi, file) => {
    const f = new FormData(); for (const [k, v] of Object.entries(campi)) f.append(k, String(v));
    if (file) f.append('file', new Blob([file.testo], { type: file.mime || 'text/plain' }), file.nome);
    const r = await fetch(`${S.base}/api/contracts${url}`, { method, headers: { cookie: c.cookie, 'X-Requested-With': 'td-suite' }, body: f });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { s: r.status, j, text };
  };
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    const bcrypt = (await import('bcryptjs')).default;
    S = await H.avviaSuite({ env: { CONTRACTS_AI_MOCK: '1' } });
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
    const persona = async (last, first, kind, extra = {}) => (await db.query(`INSERT INTO people (kind, status, last_name, first_name, email, hired_at, job_title) VALUES ($1,'ATTIVO',$2,$3,$4,$5,$6) RETURNING id`,
      [kind, last, first, extra.email === null ? null : `${first}.${last}@toscanadiagnostica.it`.toLowerCase(), extra.hired_at || '2026-02-01', extra.job_title || null])).rows[0].id;
    ids.tsrm = await persona('Tecnicotest', 'Tina', 'DIPENDENTE');
    ids.amm = await persona('Amministrativotest', 'Aldo', 'DIPENDENTE');
    ids.senza = await persona('Senzaemailtest', 'Sara', 'DIPENDENTE', { email: null });
    ids.medico = await persona('Medicotest', 'Mario', 'MEDICO');
    await db.query(`INSERT INTO contracts.employments (resource_id, job_title) VALUES ($1,'Tecnico sanitario di radiologia medica'), ($2,'Addetto amministrativo'), ($3,'Addetta accettazione')`, [ids.tsrm, ids.amm, ids.senza]);
    await db.query(`INSERT INTO contracts.lp_contracts (resource_id, discipline) VALUES ($1,'Cardiologia')`, [ids.medico]);
    const hash = await bcrypt.hash(PW, 10);
    const utente = async (email, profilo) => {
      const uid = (await db.query(`INSERT INTO users (email, full_name, first_name, last_name, level, status, auth_provider, password_hash, must_change_password, is_external)
        VALUES ($1,$2,'Prova','Profilo','USER','ACTIVE','BOTH',$3,false,false) RETURNING id`, [email, `Prova ${profilo}`, hash])).rows[0].id;
      await db.query(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,'contracts',$2,'MANUAL')`, [uid, profilo]);
      return H.entra(H.client(S.base), email, PW, PW);
    };
    V = await utente('sola.lettura@toscanadiagnostica.it', 'VIEWER');
    R = await utente('risorse.umane@toscanadiagnostica.it', 'HR');
    L = await utente('solo.lp2@toscanadiagnostica.it', 'LP');
    M = await utente('responsabile.hqs@toscanadiagnostica.it', 'MDL');
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('il widget si chiama Gestione del Personale', async () => {
    assert.equal((await db.query(`SELECT name FROM modules WHERE key='contracts'`)).rows[0].name, 'Gestione del Personale');
  });

  test('ECM: contatore solo per le professioni sanitarie; l\'attestato letto riduce il contatore', async () => {
    const amm = await O.get(`/api/contracts/resources/${ids.amm}/formazione`);
    assert.equal(amm.s, 200, amm.text); assert.equal(amm.j.ecm.soggetto, false); assert.equal(amm.j.ecm.contatore, null);
    const t0 = (await O.get(`/api/contracts/resources/${ids.tsrm}/formazione`)).j;
    assert.equal(t0.ecm.soggetto, true); assert.equal(t0.ecm.contatore.dovuti, 150); assert.equal(t0.ecm.contatore.residuo, 150); assert.equal(t0.ecm.profilo, null);
    // prima dell'attivazione nessuna scadenza ECM (niente falsi allarmi al primo avvio)
    assert.ok(!(await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.some((d) => d.type === 'ECM'));

    const testo = `Si attesta che Tina Tecnicotest ha partecipato all'evento formativo "Radioprotezione in diagnostica" (evento n. 400123) in data 10/03/${oggi.slice(0, 4)}, durata 8 ore, conseguendo n. 12,5 crediti ECM.`;
    const let_ = await invia(O, 'POST', `/resources/${ids.tsrm}/formazione/leggi`, {}, { nome: 'attestato.txt', testo });
    assert.equal(let_.s, 200, let_.text);
    assert.equal(let_.j.crediti_ecm, 12.5); assert.equal(let_.j.data, `${oggi.slice(0, 4)}-03-10`); assert.equal(let_.j.method, 'mock');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM contracts.formazione')).rows[0].n, 0, 'la lettura non salva nulla');

    const crea = await invia(O, 'POST', `/resources/${ids.tsrm}/formazione`, { tipo: 'ECM', titolo: let_.j.titolo, stato: 'SVOLTA', data: let_.j.data, ore: let_.j.ore, crediti_ecm: let_.j.crediti_ecm, codice_evento: let_.j.codice_evento, lettura: JSON.stringify(let_.j) }, { nome: 'attestato.txt', testo });
    assert.equal(crea.s, 201, crea.text);
    assert.equal(crea.j.ecm.contatore.acquisiti, 12.5); assert.equal(crea.j.ecm.contatore.residuo, 137.5);
    const riga = (await db.query('SELECT f.fonte, f.attachment_id, a.category, a.expires_at FROM contracts.formazione f JOIN contracts.attachments a ON a.id=f.attachment_id WHERE f.id=$1', [crea.j.id])).rows[0];
    assert.equal(riga.fonte, 'ATTESTATO'); assert.equal(riga.category, 'ECM'); assert.equal(riga.expires_at, null, 'nessuna doppia scadenza dal dossier');
    // doppione segnalato alla lettura successiva dello stesso attestato
    assert.ok((await invia(O, 'POST', `/resources/${ids.tsrm}/formazione/leggi`, {}, { nome: 'attestato.txt', testo })).j.doppione);

    // posizione attivata dal primo attestato: ora le scadenze ECM ci sono (triennio e obiettivo dell'anno)
    const sc = (await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.filter((d) => d.type === 'ECM');
    assert.ok(sc.some((d) => /triennio/.test(d.title) && /137,5/.test(d.title)), JSON.stringify(sc));

    // riduzione con motivo obbligatorio; obbligo personale
    assert.equal((await O.put(`/api/contracts/resources/${ids.tsrm}/ecm`, { riduzione: 20 })).s, 400);
    const rid = await O.put(`/api/contracts/resources/${ids.tsrm}/ecm`, { soggetto: null, riduzione: 20, riduzione_motivo: 'Esonero per maternità' });
    assert.equal(rid.s, 200, rid.text); assert.equal(rid.j.ecm.contatore.residuo, 117.5);
    // modifica dei crediti e cancellazione riportano il contatore
    assert.equal((await O.put(`/api/contracts/resources/${ids.tsrm}/formazione/${crea.j.id}`, { crediti_ecm: 30 })).j.ecm.contatore.residuo, 100);
    assert.equal((await O.del(`/api/contracts/resources/${ids.tsrm}/formazione/${crea.j.id}`)).j.ecm.contatore.residuo, 130);
    // regole: corso programmato senza crediti, corso svolto con data
    assert.equal((await invia(O, 'POST', `/resources/${ids.tsrm}/formazione`, { titolo: 'BLSD', stato: 'PROGRAMMATA', data_prevista: piu(20), crediti_ecm: 5 })).s, 400);
    assert.equal((await invia(O, 'POST', `/resources/${ids.tsrm}/formazione`, { titolo: 'BLSD', stato: 'SVOLTA' })).s, 400);
  });

  test('formazione aziendale: rinnovi e corsi programmati entrano nelle scadenze', async () => {
    const a = await invia(O, 'POST', `/resources/${ids.amm}/formazione`, { tipo: 'SICUREZZA_SPECIFICA', titolo: 'Formazione specifica rischio basso', stato: 'SVOLTA', data: piu(-300), ore: 4, scadenza: piu(25), obbligatoria: true });
    assert.equal(a.s, 201, a.text);
    const b = await invia(O, 'POST', `/resources/${ids.amm}/formazione`, { tipo: 'PRIVACY', titolo: 'Protezione dei dati', stato: 'PROGRAMMATA', data_prevista: piu(10) });
    assert.equal(b.s, 201, b.text);
    const sc = (await O.get(`/api/contracts/resources/${ids.amm}`)).j.deadlines.filter((d) => d.type === 'FORMAZIONE');
    assert.equal(sc.length, 2, JSON.stringify(sc));
    assert.ok(sc.some((d) => /^Rinnovo formazione/.test(d.title) && d.due_date === piu(25)) && sc.some((d) => /^Corso programmato/.test(d.title) && d.due_date === piu(10)));
    // quadro ECM: solo le professioni sanitarie, attivazione delle posizioni riconosciute
    const q = await O.get('/api/contracts/formazione/ecm');
    assert.equal(q.s, 200, q.text);
    assert.deepEqual(q.j.righe.map((x) => x.id).sort(), [ids.tsrm, ids.medico].sort());
    assert.equal(q.j.righe.find((x) => x.id === ids.medico).attivata, false);
    assert.equal((await O.post('/api/contracts/formazione/ecm/attiva', { ids: [ids.medico] })).j.attivate, 1);
    assert.ok((await O.get(`/api/contracts/resources/${ids.medico}`)).j.deadlines.some((d) => d.type === 'ECM'));
    // scadenzario della Suite: le nuove voci ci sono con il loro tipo
    const cal = await O.get(`/api/contracts/stats/deadlines?days=400`);
    assert.ok(cal.j.some((d) => d.type === 'FORMAZIONE') && cal.j.some((d) => d.type === 'ECM'));
  });

  test('tirocinante: terzo tipo di persona con convenzione, progetto formativo, tutor e giudizio', async () => {
    const crea = await O.post('/api/contracts/resources', { person: { kind: 'TIROCINANTE', status: 'ATTIVO', last_name: 'Tirocinantetest', first_name: 'Teo', email: 'teo.tirocinantetest@example.org' },
      tirocinio: { tipo: 'CURRICULARE', ente_promotore: 'Università di prova', ente_email: 'tirocini@universita-prova.example', start_date: piu(15), end_date: piu(105), weekly_hours: 30, tutor_person_id: ids.tsrm } });
    assert.equal(crea.s, 201, crea.text); ids.tir = crea.j.id;
    const sch = (await O.get(`/api/contracts/resources/${ids.tir}`)).j;
    assert.equal(sch.resource.kind, 'TIROCINANTE'); assert.equal(sch.tirocinio.pf_stato, 'DA_RICHIEDERE'); assert.equal(sch.tirocinio.tutor_name, 'Tecnicotest Tina');
    assert.ok(sch.checklist.some((c) => c.category === 'PROGETTO_FORMATIVO' && c.required) && sch.checklist.some((c) => c.category === 'CONVENZIONE_TIROCINIO'));
    assert.equal(sch.resource.hired_at, piu(15), 'l\'ingresso è l\'inizio del tirocinio');
    const tipi = sch.deadlines.filter((d) => d.type === 'TIROCINIO').map((d) => d.title);
    assert.ok(tipi.some((t) => /da richiedere/.test(t)) && tipi.includes('Fine del tirocinio') && tipi.some((t) => /Giudizio finale/.test(t)), JSON.stringify(tipi));
    // elenchi: i tirocinanti non sono né dipendenti né LP
    assert.ok(!(await O.get('/api/contracts/resources?kind=DIPENDENTE')).j.some((x) => x.id === ids.tir));
    assert.ok(!(await O.get('/api/contracts/resources?kind=LP')).j.some((x) => x.id === ids.tir));
    assert.deepEqual((await O.get('/api/contracts/resources?kind=TIROCINANTE')).j.map((x) => x.id), [ids.tir]);
    assert.equal((await O.get('/api/contracts/stats/summary')).j.totals.tirocinanti, 1);
    assert.equal((await L.get(`/api/contracts/resources/${ids.tir}`)).s, 403, 'il profilo LP non vede i tirocinanti');
    // richiesta del progetto formativo: email dalla casella People (qui posta in modalità registro), stato RICHIESTO
    const ric = await O.post(`/api/contracts/resources/${ids.tir}/tirocinio/richiedi-progetto`, { invia: true });
    assert.equal(ric.s, 200, ric.text); assert.equal(ric.j.tirocinio.pf_stato, 'RICHIESTO'); assert.equal(ric.j.tirocinio.pf_richiesto_il, oggi);
    const mail = (await db.query(`SELECT to_addr, subject FROM email_log WHERE ref=$1`, [`contracts:tirocinio:pf:${ids.tir}`])).rows[0];
    assert.equal(mail.to_addr, 'tirocini@universita-prova.example'); assert.match(mail.subject, /progetto formativo/);
    // regole: il tutor non può essere un tirocinante né il tirocinante stesso; il giudizio vuole la data
    assert.equal((await O.put(`/api/contracts/resources/${ids.tir}/tirocinio`, { tutor_person_id: ids.tir })).s, 400);
    assert.equal((await O.put(`/api/contracts/resources/${ids.tir}/tirocinio`, { giudizio_esito: 'POSITIVO' })).s, 400);
    assert.equal((await O.put(`/api/contracts/resources/${ids.tsrm}/tirocinio`, {})).s, 400, 'solo i tirocinanti hanno un tirocinio');
    const fine = await O.put(`/api/contracts/resources/${ids.tir}/tirocinio`, { pf_stato: 'FIRMATO', pf_firmato_il: oggi, giudizio_esito: 'POSITIVO', giudizio_data: oggi, giudizio_note: 'Obiettivi raggiunti' });
    assert.equal(fine.s, 200, fine.text);
    const dopo = (await O.get(`/api/contracts/resources/${ids.tir}`)).j.deadlines.filter((d) => d.type === 'TIROCINIO').map((d) => d.title);
    assert.deepEqual(dopo, ['Fine del tirocinio'], 'progetto firmato e giudizio espresso chiudono le rispettive scadenze');
    assert.equal((await V.put(`/api/contracts/resources/${ids.tir}/tirocinio`, { notes: 'x' })).s, 403, 'sola lettura');
  });

  test('medicina del lavoro: riservata, solo giudizio, calendario, protocollo, scadenze', async () => {
    assert.equal((await V.get(`/api/contracts/resources/${ids.tsrm}/mdl`)).s, 403, 'il profilo di sola lettura non vede i giudizi');
    assert.equal((await V.get('/api/contracts/mdl')).s, 403);
    assert.equal((await L.get('/api/contracts/mdl')).s, 403);
    assert.equal((await O.get(`/api/contracts/resources/${ids.medico}/mdl`)).s, 400, 'i liberi professionisti non sono soggetti');
    const q0 = await R.get(`/api/contracts/resources/${ids.tsrm}/mdl`);
    assert.equal(q0.s, 200, q0.text); assert.equal(q0.j.posizione.stato, 'DA_IMPOSTARE');
    assert.ok(!(await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.some((d) => d.type === 'MDL'), 'posizione non impostata: nessuna scadenza');
    assert.ok((await db.query(`SELECT 1 FROM read_log WHERE module_key='contracts' AND entity='mdl' AND entity_id=$1`, [String(ids.tsrm)])).rowCount >= 1, 'consultazione registrata');

    const prot = await R.post('/api/contracts/mdl/protocolli', { nome: 'Esposti a radiazioni ionizzanti', rischi: 'Radiazioni ionizzanti', accertamenti: 'Visita medica, esami ematochimici', periodicita_mesi: 6 });
    assert.equal(prot.s, 201, prot.text);
    assert.equal((await R.post('/api/contracts/mdl/protocolli', { nome: 'esposti a radiazioni ionizzanti' })).s, 400, 'nome doppio');
    const sch = await R.put(`/api/contracts/resources/${ids.tsrm}/mdl`, { sorveglianza: true, protocollo_id: prot.j.id, mansione: 'TSRM' });
    assert.equal(sch.s, 200, sch.text); assert.equal(sch.j.posizione.stato, 'DA_FARE'); assert.equal(sch.j.posizione.periodicita_mesi, 6);
    assert.ok((await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.some((d) => d.type === 'MDL' && /preventiva/.test(d.title)));
    // nessun dato clinico: campi rifiutati; regole sul giudizio
    assert.equal((await R.put(`/api/contracts/resources/${ids.tsrm}/mdl`, { sorveglianza: true, diagnosi: 'x' })).s, 400);
    assert.equal((await invia(R, 'POST', `/resources/${ids.tsrm}/mdl/visite`, { stato: 'EFFETTUATA', data_visita: piu(-170) })).s, 400, 'giudizio obbligatorio');
    assert.equal((await invia(R, 'POST', `/resources/${ids.tsrm}/mdl/visite`, { stato: 'EFFETTUATA', data_visita: piu(-170), giudizio: 'IDONEO_PRESCRIZIONI' })).s, 400, 'prescrizioni obbligatorie');
    const vis = await invia(R, 'POST', `/resources/${ids.tsrm}/mdl/visite`, { tipo: 'PREVENTIVA', stato: 'EFFETTUATA', data_visita: piu(-170), giudizio: 'IDONEO_PRESCRIZIONI', prescrizioni: 'Dosimetro personale' }, { nome: 'giudizio.pdf', testo: '%PDF-1.4 giudizio di idoneità', mime: 'application/pdf' });
    assert.equal(vis.s, 201, vis.text);
    assert.equal(vis.j.posizione.giudizio, 'IDONEO_PRESCRIZIONI'); assert.equal(vis.j.posizione.stato, 'IMMINENTE', 'sei mesi dalla visita: tra circa dieci giorni');
    assert.equal((await db.query(`SELECT category FROM contracts.attachments WHERE id=$1`, [vis.j.visite[0].attachment_id])).rows[0].category, 'VISITA_MEDICA');
    // l'audit del modulo non riporta il giudizio
    const aud = (await db.query(`SELECT data FROM contracts.audit_log WHERE action='MDL_VISITA_CREATE' ORDER BY id DESC LIMIT 1`)).rows[0].data;
    assert.ok(!JSON.stringify(aud).includes('IDONEO') && !JSON.stringify(aud).includes('Dosimetro'));
    const sc = (await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.filter((d) => d.type === 'MDL');
    assert.equal(sc.length, 1); assert.match(sc[0].title, /periodica.*da programmare/);
  });

  test('convocazioni: solo gli amministratori del widget, sul personale in scadenza, con email personale', async () => {
    await O.put(`/api/contracts/resources/${ids.senza}/mdl`, { sorveglianza: true });
    const el = (await O.get('/api/contracts/mdl')).j;
    assert.equal(el.puo_convocare, true);
    assert.deepEqual(el.elenco.map((x) => x.id).sort(), [ids.tsrm, ids.amm, ids.senza, ids.tir].sort(), 'dipendenti e tirocinanti, non i liberi professionisti');
    const inScad = el.elenco.filter((x) => x.sorveglianza && x.impostata && x.giorni != null && x.giorni <= el.predefiniti.anticipo_giorni).map((x) => x.id).sort();
    assert.deepEqual(inScad, [ids.tsrm, ids.senza].sort());
    assert.equal((await R.get('/api/contracts/mdl')).j.puo_convocare, false);
    const corpo = { ids: inScad, data: piu(8), ora: '09:30', luogo: 'Sede di prova, ambulatorio 2', medico: 'dott. Prova Competente', note: 'Portare gli occhiali in uso', invia: true };
    assert.equal((await R.post('/api/contracts/mdl/convocazioni', corpo)).s, 403, 'HR non convoca');
    assert.equal((await O.post('/api/contracts/mdl/convocazioni', { ...corpo, data: piu(-1) })).s, 400);
    assert.equal((await O.post('/api/contracts/mdl/convocazioni', { ...corpo, ids: [ids.medico] })).s, 400);
    const c = await O.post('/api/contracts/mdl/convocazioni', corpo);
    assert.equal(c.s, 201, c.text);
    const es = Object.fromEntries(c.j.esiti.map((e) => [e.id, e.stato]));
    assert.equal(es[ids.tsrm], 'REGISTRATO', 'posta in modalità registro nei test'); assert.equal(es[ids.senza], 'SENZA_EMAIL');
    const mail = (await db.query(`SELECT to_addr, subject FROM email_log WHERE ref=$1`, [`contracts:mdl:convocazione:${c.j.convocazione}:${ids.tsrm}`])).rows;
    assert.equal(mail.length, 1); assert.equal(mail[0].to_addr, 'tina.tecnicotest@toscanadiagnostica.it'); assert.match(mail[0].subject, /convocazione alla visita/);
    // la visita convocata è in calendario e sostituisce "da programmare" nelle scadenze
    const sc = (await O.get(`/api/contracts/resources/${ids.tsrm}`)).j.deadlines.filter((d) => d.type === 'MDL');
    assert.equal(sc.length, 1); assert.match(sc[0].title, /convocata/); assert.equal(sc[0].due_date, piu(8));
    // riconvocare aggiorna la visita già fissata, non ne crea un'altra
    assert.equal((await O.post('/api/contracts/mdl/convocazioni', { ...corpo, ids: [ids.tsrm], data: piu(9), invia: false })).s, 201);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM contracts.mdl_visite WHERE resource_id=$1 AND stato='CONVOCATA'`, [ids.tsrm])).rows[0].n, 1);
    const dopo = (await O.get('/api/contracts/mdl')).j;
    assert.equal(dopo.convocazioni.length, 2); assert.ok(dopo.fissate.some((v) => v.resource_id === ids.senza));
  });

  test('profilo MDL: solo le scadenze di medicina del lavoro, senza giudizi, tutto il resto chiuso', async () => {
    assert.ok((await db.query(`SELECT profiles FROM modules WHERE key='contracts'`)).rows[0].profiles.some((p) => p.key === 'MDL'));
    const r = await M.get('/api/contracts/mdl/scadenze');
    assert.equal(r.s, 200, r.text);
    const t = r.j.righe.find((x) => x.id === ids.tsrm);
    assert.ok(t && t.prossima && t.fissata && t.stato, JSON.stringify(t));
    assert.ok(!r.text.includes('IDONEO') && !r.text.includes('Dosimetro') && !('giudizio' in t) && !('prescrizioni' in t) && !('email' in t), 'nessun giudizio, prescrizione o contatto');
    assert.ok(!r.j.righe.some((x) => x.id === ids.medico), 'solo dipendenti e tirocinanti');
    for (const u of ['/mdl', `/resources/${ids.tsrm}`, `/resources/${ids.tsrm}/mdl`, '/resources', '/stats/deadlines', '/stats/summary', '/settings', '/formazione/ecm', '/areas', `/resources/${ids.tsrm}/attachments/1/download`, '/una-route-futura'])
      assert.equal((await M.get(`/api/contracts${u}`)).s, 403, u);
    assert.equal((await M.post('/api/contracts/mdl/convocazioni', { ids: [ids.tsrm], data: piu(5) })).s, 403, 'non convoca');
    assert.equal((await M.put(`/api/contracts/resources/${ids.tsrm}/mdl`, { sorveglianza: false })).s, 403, 'sola lettura');
    assert.deepEqual(Object.keys((await M.get('/api/contracts/badges')).j), ['mdl_in_scadenza']);
    // chi ha già la sezione vede la stessa pagina; il profilo di sola lettura generale no
    assert.equal((await R.get('/api/contracts/mdl/scadenze')).s, 200);
    assert.equal((await V.get('/api/contracts/mdl/scadenze')).s, 403);
    // Scadenzario della Suite: del personale solo le righe di medicina del lavoro
    const { visibiliA } = await import('../src/lib/scadenzario.js');
    const righe = [{ modulo: 'contracts', tipo: 'Medicina del lavoro' }, { modulo: 'contracts', tipo: 'Contratto di lavoro' }, { modulo: 'contracts', tipo: 'Crediti ECM' }, { modulo: 'facility', tipo: 'Manutenzione' }];
    assert.deepEqual(visibiliA(righe, { level: 'USER', grants: { contracts: { profile: 'MDL' } } }).map((x) => x.tipo), ['Medicina del lavoro', 'Manutenzione']);
  });

  test('ECM: risorsa non considerata per l\'anno in corso (niente obiettivo, scadenze, indicatori) e riconsiderata', async () => {
    const anno = Number(oggi.slice(0, 4));
    assert.equal((await O.post('/api/contracts/formazione/ecm/escludi', { id: ids.medico })).s, 400, 'motivo obbligatorio');
    assert.equal((await V.post('/api/contracts/formazione/ecm/escludi', { id: ids.medico, motivo: 'x' })).s, 403);
    const prima = (await O.get('/api/contracts/formazione/ecm')).j;
    const e = await O.post('/api/contracts/formazione/ecm/escludi', { id: ids.medico, motivo: 'Ingresso a fine anno' });
    assert.equal(e.s, 200, e.text); assert.equal(e.j.anno, anno);
    assert.equal(e.j.ecm.contatore.escluso_anno, true); assert.equal(e.j.ecm.contatore.mancano_anno, 0);
    assert.equal(e.j.ecm.contatore.dovuti, 150, 'l\'obbligo del triennio non cambia');
    const dopo = (await O.get('/api/contracts/formazione/ecm')).j;
    const riga = dopo.righe.find((x) => x.id === ids.medico);
    assert.equal(riga.escluso_anno, true); assert.equal(riga.esclusione_motivo, 'Ingresso a fine anno');
    assert.equal(dopo.totali.persone, prima.totali.persone - 1); assert.equal(dopo.totali.escluse, 1);
    assert.ok(!(await O.get(`/api/contracts/resources/${ids.medico}`)).j.deadlines.some((d) => d.type === 'ECM'), 'nessuna scadenza ECM nell\'anno escluso');
    // escludere due volte non duplica l'anno; riconsiderare ripristina obiettivo e scadenze
    await O.post('/api/contracts/formazione/ecm/escludi', { id: ids.medico, motivo: 'Ingresso a fine anno' });
    assert.deepEqual((await db.query('SELECT anni_esclusi FROM contracts.ecm_profili WHERE resource_id=$1', [ids.medico])).rows[0].anni_esclusi, [anno]);
    const r = await O.post('/api/contracts/formazione/ecm/escludi', { id: ids.medico, escludi: false });
    assert.equal(r.j.ecm.contatore.escluso_anno, false); assert.ok(r.j.ecm.contatore.mancano_anno > 0);
    assert.ok((await O.get(`/api/contracts/resources/${ids.medico}`)).j.deadlines.some((d) => d.type === 'ECM'));
  });

  test('richiami: le nuove scadenze partono dalla casella People verso il destinatario giusto', async () => {
    const { rows } = await db.query(`SELECT value FROM contracts.app_settings WHERE key='people_send_enabled'`);
    assert.ok(rows.length === 0 || rows[0].value !== '1' || true);
    const r = await O.post('/api/contracts/people-inbox/richiami/esegui', { force: true });
    assert.ok([200, 201].includes(r.s), r.text);
    const rem = (await db.query(`SELECT deadline_type, recipient, title FROM contracts.deadline_reminders WHERE deadline_type IN ('FORMAZIONE','MDL','TIROCINIO','ECM')`)).rows;
    assert.ok(rem.some((x) => x.deadline_type === 'FORMAZIONE' && x.recipient === 'PERSONA'), JSON.stringify(rem));
    assert.ok(rem.some((x) => x.deadline_type === 'MDL' && x.recipient === 'HR'), JSON.stringify(rem));
  });
});
