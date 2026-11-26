// Circolari v0.99.5 (correzioni del CEO del 26/11/2026): la lista Punti Prelievo contiene SOLO i punti prelievo attivi (mai la
// Legal entity che li ospita); la lista Interni è A SCELTA: i destinatari si spuntano dall'elenco del personale e nessuna regola
// aggiunge persone da sola. Serve DATABASE_URL_TEST.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SALTA = !process.env.DATABASE_URL_TEST;

describe('Circolari: liste Punti Prelievo e Interni', { skip: SALTA }, () => {
  let H, S, db, O, D, liste;
  const must = (r, cosa) => { assert.ok(r.s < 300, `${cosa}: ${r.s} ${r.text}`); return r.j; };
  const lista = (auto) => liste.find((l) => l.automatica === auto);
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    D = await H.datiProva(S.base); O = D.o;
    must(await O.post('/api/travaso/circolari/run'), 'avvio circolari');
    // il punto prelievi e la Legal entity che lo ospita hanno entrambi un'email: solo la prima deve entrare in lista
    await db.query(`UPDATE public.sites SET email = 'punto.test@toscanadiagnostica.it' WHERE id = $1`, [D.site.pp1]);
    await db.query(`UPDATE public.organizations SET email = 'amministrazione@farmacia-test.test' WHERE id = $1`, [D.org.p1]);
    // una seconda persona interna in Laboratorio (la regola della 0.99.4 l'avrebbe messa in lista da sola) e un LP senza utente
    const lab = must(await O.post('/api/sites', { code: 'T-LAB', name: 'Laboratorio Test', kind: 'LABORATORIO', organization_id: D.org.td, city: 'Firenze', province: 'FI', address: 'Via di Prova 2' }), 'laboratorio');
    must(await O.post('/api/people', { kind: 'DIPENDENTE', status: 'ATTIVO', last_name: 'Labtest', first_name: 'Lea', email: 'lea.labtest@toscanadiagnostica.it', site_id: lab.id }), 'persona di laboratorio');
    must(await O.post('/api/people', { kind: 'LP', status: 'ATTIVO', last_name: 'Senzautente', first_name: 'Sara' }), 'LP senza utente');
    await new Promise((r) => setTimeout(r, 1500));
    liste = must(await O.get('/api/circolari/liste'), 'liste');
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('Punti Prelievo: il punto attivo sì, la Legal entity che lo ospita no', async () => {
    const l = must(await O.get(`/api/circolari/liste/${lista('PUNTI_PRELIEVO').id}`), 'lista');
    const email = l.automatici.map((d) => d.email);
    assert.deepEqual(email, ['punto.test@toscanadiagnostica.it']);
    assert.ok(!/Legal entity/i.test(l.descrizione), 'la descrizione non cita più le Legal entity');
    const prop = must(await O.get('/api/circolari/liste/proposte?segmento=PUNTI_PRELIEVO'), 'proposte').map((d) => d.email);
    assert.ok(prop.includes('punto.test@toscanadiagnostica.it') && !prop.includes('amministrazione@farmacia-test.test'), 'nemmeno tra le proposte');
    // un punto disattivato esce
    await db.query(`UPDATE public.sites SET active = FALSE WHERE id = $1`, [D.site.pp1]);
    assert.equal(must(await O.get(`/api/circolari/liste/${l.id}`), 'lista').automatici.length, 0);
    await db.query(`UPDATE public.sites SET active = TRUE WHERE id = $1`, [D.site.pp1]);
  });

  test('Interni: nasce vuota, nessuno entra per regola; in elenco solo chi ha un utente interno attivo', async () => {
    const l = must(await O.get(`/api/circolari/liste/${lista('INTERNI').id}`), 'lista');
    assert.equal(l.automatici.length, 0, 'nessun destinatario finché non si sceglie');
    assert.equal(lista('INTERNI').n_destinatari, 0);
    const nomi = l.personale.map((x) => x.nome);
    assert.ok(nomi.includes('Labtest Lea') && nomi.includes('Internotest Ivo'), `elenco: ${nomi.join(', ')}`);
    assert.ok(!nomi.includes('Senzautente Sara'), 'chi non ha utente non è selezionabile');
    assert.ok(!l.personale.some((x) => /farmacia-test|cliente-test/.test(x.email)), 'gli esterni non sono in elenco');
    assert.equal(l.personale.find((x) => x.nome === 'Labtest Lea').suggerito, true);
  });

  test('Interni: i scelti diventano destinatari, anche nell\'anteprima di invio; chi cessa esce da solo', async () => {
    const id = lista('INTERNI').id;
    const l = must(await O.get(`/api/circolari/liste/${id}`), 'lista');
    const ivo = l.personale.find((x) => x.nome === 'Internotest Ivo'); const lea = l.personale.find((x) => x.nome === 'Labtest Lea');
    const salvata = must(await O.put(`/api/circolari/liste/${id}`, { persone: [ivo.person_id, ivo.person_id, 999999] }), 'salva scelta');
    assert.deepEqual(salvata.persone.map(Number).sort(), [ivo.person_id, 999999].sort());
    let dopo = must(await O.get(`/api/circolari/liste/${id}`), 'lista');
    assert.deepEqual(dopo.automatici.map((d) => d.email), ['ivo.internotest@toscanadiagnostica.it'], 'solo Ivo: Lea è in Laboratorio ma non è stata scelta');
    // modifica di altri campi senza passare persone: la scelta resta
    must(await O.put(`/api/circolari/liste/${id}`, { descrizione: 'Interni scelti' }), 'solo descrizione');
    must(await O.put(`/api/circolari/liste/${id}`, { persone: [ivo.person_id, lea.person_id], destinatari: [{ email: 'extra@toscanadiagnostica.it' }] }), 'due scelti e uno a mano');
    liste = must(await O.get('/api/circolari/liste'), 'liste');
    assert.equal(lista('INTERNI').n_destinatari, 3); assert.equal(lista('INTERNI').n_automatici, 2); assert.equal(lista('INTERNI').n_manuali, 1);
    await db.query(`UPDATE public.people SET status = 'CESSATO' WHERE id = $1`, [lea.person_id]);
    dopo = must(await O.get(`/api/circolari/liste/${id}`), 'lista');
    assert.deepEqual(dopo.automatici.map((d) => d.email), ['ivo.internotest@toscanadiagnostica.it'], 'chi cessa esce');
    // la scelta non si applica alle altre liste
    const pp = must(await O.put(`/api/circolari/liste/${lista('PUNTI_PRELIEVO').id}`, { persone: [ivo.person_id] }), 'PP');
    assert.deepEqual(pp.persone, []);
  });

  // v0.99.10: l'Organizzazione di un destinatario è una Legal entity dell'anagrafica (id), non un testo libero
  test('destinatari collegati a una Legal entity: si salva l\'id, il nome è quello dell\'anagrafica di oggi', async () => {
    const le = must(await O.get('/api/circolari/legal-entity'), 'legal entity');
    assert.ok(le.some((o) => o.id === D.org.c1 && o.name === 'Cliente Test Uno'));
    const nuova = must(await O.post('/api/circolari/liste', { nome: 'Service attivi', segmento: 'CLIENTI_SERVICE', destinatari: [
      { email: 'Info@cliente-uno.test', organization_id: D.org.c1, organizzazione: 'testo ignorato' }, { email: 'altro@cliente.test', organizzazione: 'Scritta a mano' }, { email: 'rotto@cliente.test', organization_id: 999999 }] }), 'lista');
    let l = must(await O.get(`/api/circolari/liste/${nuova.id}`), 'lista');
    assert.deepEqual(l.destinatari.map((d) => [d.email, d.organization_id, d.organizzazione]), [['info@cliente-uno.test', D.org.c1, 'Cliente Test Uno'], ['altro@cliente.test', null, 'Scritta a mano'], ['rotto@cliente.test', null, '']]);
    await db.query(`UPDATE public.organizations SET name = 'Cliente Uno Rinominato' WHERE id = $1`, [D.org.c1]);
    l = must(await O.get(`/api/circolari/liste/${nuova.id}`), 'lista');
    assert.equal(l.destinatari[0].organizzazione, 'Cliente Uno Rinominato', 'il nome segue l\'anagrafica');
    await db.query(`UPDATE public.organizations SET name = 'Cliente Test Uno' WHERE id = $1`, [D.org.c1]);
    const prop = must(await O.get('/api/circolari/liste/proposte?segmento=PUNTI_PRELIEVO'), 'proposte');
    assert.ok(prop.every((x) => 'organization_id' in x), 'le proposte portano già la Legal entity');
  });
});
