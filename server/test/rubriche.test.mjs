// Rubriche esterne (richiesta del CEO del 07/11/2026): normalizzazione dei contatti Outlook (Microsoft Graph) e Google (People API)
// nel formato comune, maschere per log e audit, ricerca con fonti finte (timeout ed errori per fonte senza bloccare l'altra, cache
// di 60 s, al massimo 15 per fonte) e, con DATABASE_URL_TEST, gli endpoint veri: senza configurazione lo stato dice "non
// configurata" con il motivo, gli esterni non entrano, con RUBRICHE_MOCK=1 la ricerca risponde con i contatti di prova e scrive
// l'audit RUBRICA_CERCA con la query troncata e mascherata. Nessun dato reale: contatti fittizi su domini .example.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizzaOutlook, normalizzaGoogle, mascheraEmail, queryPerAudit, corrisponde, filtroOutlook, deduplica, dividiNome, cercaInFonti, MAX_PER_FONTE,
} from '../src/lib/rubriche.js';
import { SALTA, avviaSuite, client, datiProva, entra, OWNER } from './helpers/suiteTest.mjs';

test('normalizzazione Outlook: nome, email minuscole e uniche, telefoni per tipo senza doppioni, azienda e ruolo', () => {
  const c = normalizzaOutlook({ id: 'AAMk1', displayName: ' Anna  Bianchi ', givenName: 'Anna', surname: 'Bianchi',
    emailAddresses: [{ address: 'Anna.Bianchi@Clinica.example', name: 'x' }, { address: 'anna.bianchi@clinica.example' }, { address: 'non-email' }],
    businessPhones: ['055 123456', '055123456'], homePhones: [], mobilePhone: '333 1234567', companyName: 'Clinica Esempio', jobTitle: 'Direttrice sanitaria' });
  assert.deepEqual(c, { id: 'outlook:AAMk1', fonte: 'OUTLOOK', nome: 'Anna Bianchi', nome_proprio: 'Anna', cognome: 'Bianchi',
    email: ['anna.bianchi@clinica.example'], telefoni: [{ tipo: 'cellulare', numero: '333 1234567' }, { tipo: 'lavoro', numero: '055 123456' }],
    azienda: 'Clinica Esempio', ruolo: 'Direttrice sanitaria' });
  // senza nome e cognome distinti si divide il nome visualizzato; senza nome si usa l'azienda o l'email
  assert.equal(normalizzaOutlook({ id: '2', displayName: 'Mario De Rossi', emailAddresses: [] }).cognome, 'De Rossi');
  assert.equal(normalizzaOutlook({ id: '3', companyName: 'Solo Azienda' }).nome, 'Solo Azienda');
  assert.equal(normalizzaOutlook({ id: '4', emailAddresses: [{ address: 'x@y.example' }] }).nome, 'x@y.example');
  assert.equal(normalizzaOutlook({ id: '5' }), null);
  assert.equal(normalizzaOutlook(null), null);
});

test('normalizzazione Google: names/emailAddresses/phoneNumbers/organizations → formato comune', () => {
  const c = normalizzaGoogle({ resourceName: 'people/c42', names: [{ displayName: 'Luca Verdi', givenName: 'Luca', familyName: 'Verdi' }],
    emailAddresses: [{ value: 'LUCA@studio.example' }], phoneNumbers: [{ value: '+39 340 1112223', type: 'mobile' }, { value: '0571 22 33 44', type: 'work' }, { value: '+39 340 111 2223', type: 'home' }],
    organizations: [{ name: 'Studio Esempio', title: 'Titolare' }] });
  assert.deepEqual(c, { id: 'google:people/c42', fonte: 'GOOGLE', nome: 'Luca Verdi', nome_proprio: 'Luca', cognome: 'Verdi', email: ['luca@studio.example'],
    telefoni: [{ tipo: 'cellulare', numero: '+39 340 1112223' }, { tipo: 'lavoro', numero: '0571 22 33 44' }], azienda: 'Studio Esempio', ruolo: 'Titolare' });
  assert.equal(normalizzaGoogle({ resourceName: 'people/c1', phoneNumbers: [{ value: '1' }] }), null);
  assert.equal(normalizzaGoogle({ resourceName: 'people/c2', organizations: [{ name: 'Ditta' }] }).nome, 'Ditta');
  assert.equal(normalizzaGoogle({ resourceName: 'people/c3', names: [{ displayName: 'Solo' }], phoneNumbers: [{ value: '055 1', type: 'strano' }] }).telefoni[0].tipo, 'altro');
});

test('maschere per log e audit, filtro OData, corrispondenza senza accenti, deduplica', () => {
  assert.equal(mascheraEmail('errore per mario.rossi@clinica.example e a@b.example'), 'errore per m***@clinica.example e a***@b.example');
  assert.equal(queryPerAudit('  mario.rossi@clinica.example   con un testo molto lungo che supera i quaranta caratteri'), 'm***@clinica.example con un testo molto ');
  assert.equal(queryPerAudit('x'.repeat(100)).length, 40);
  assert.match(filtroOutlook("D'Amico"), /startswith\(surname,'D''Amico'\)/);
  assert.doesNotMatch(filtroOutlook('Rossi'), /emailAddresses/);
  assert.match(filtroOutlook('A@B.example'), /emailAddresses\/any\(a:a\/address eq 'a@b.example'\)/);
  const c = normalizzaOutlook({ id: '1', displayName: 'Niccolò Bàrberi', emailAddresses: [{ address: 'nb@labo.example' }], companyName: 'Labo Città' });
  assert.ok(corrisponde(c, 'niccolo barberi'));
  assert.ok(corrisponde(c, 'citta'));
  assert.ok(corrisponde(c, 'nb@labo'));
  assert.ok(!corrisponde(c, 'rossi'));
  assert.ok(!corrisponde(c, '   '));
  assert.deepEqual(dividiNome('Mario'), { nome_proprio: 'Mario', cognome: '' });
  const lista = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, email: [i % 2 ? `a${i}@e.example` : 'stessa@e.example'] }));
  const d = deduplica(lista);
  assert.ok(d.length <= MAX_PER_FONTE);
  assert.equal(d.filter((x) => x.email[0] === 'stessa@e.example').length, 1);
});

test('ricerca con fonti finte: errori e timeout per fonte senza bloccare le altre, cache di 60 secondi, massimo 15', async () => {
  let chiamate = 0;
  const molti = Array.from({ length: 40 }, (_, i) => normalizzaOutlook({ id: `o${i}`, displayName: `Prova ${i}`, emailAddresses: [{ address: `p${i}@o.example` }] }));
  const fonti = {
    outlook: async () => { chiamate++; return molti; },
    google: async () => { throw Object.assign(new Error('Google People 403: x'), { motivo: 'API People non abilitata (utente a@b.example)' }); },
    lenta: () => new Promise(() => {}),
  };
  let t = 1_000_000;
  const cache = new Map();
  const inizio = Date.now();
  const r = await cercaInFonti('prova', fonti, { timeoutMs: 80, cache, ora: () => t });
  assert.ok(Date.now() - inizio < 2000, 'la fonte lenta non deve bloccare la risposta');
  assert.equal(r.risultati.outlook.length, MAX_PER_FONTE);
  assert.deepEqual(r.risultati.google, []);
  assert.equal(r.errori.google, 'API People non abilitata (utente a***@b.example)');
  assert.match(r.errori.lenta, /nessuna risposta entro/);
  assert.equal(r.errori.outlook, undefined);
  // stessa query (anche con maiuscole e spazi) entro 60 s: dalla cache, nessuna nuova chiamata
  t += 30_000;
  const r2 = await cercaInFonti('  PROVA ', fonti, { timeoutMs: 80, cache, ora: () => t });
  assert.equal(chiamate, 1);
  assert.equal(r2.dallaCache.outlook, true);
  assert.equal(r2.risultati.outlook.length, MAX_PER_FONTE);
  // dopo 60 s si interroga di nuovo; gli errori non si mettono in cache
  t += 31_000;
  await cercaInFonti('prova', fonti, { timeoutMs: 80, cache, ora: () => t });
  assert.equal(chiamate, 2);
  assert.equal(cache.has('google|prova'), false);
});

describe('endpoint delle rubriche senza configurazione (integrazione)', { skip: SALTA }, () => {
  let S, D;
  before(async () => { S = await avviaSuite({ env: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', RUBRICHE_MOCK: '' } }); D = await datiProva(S.base); }, { timeout: 180000 });
  after(async () => { await S?.stop(); });

  test('stato "non configurata" con il motivo per Outlook e Gmail; la ricerca risponde comunque con la Suite', async () => {
    const st = await D.o.get('/api/rubriche/stato');
    assert.equal(st.s, 200);
    assert.equal(st.j.outlook.configurata, false);
    assert.equal(st.j.outlook.casella, 'francesco.epifani@toscanadiagnostica.it');
    assert.match(st.j.outlook.errore, /Credenziali Microsoft Graph/);
    assert.equal(st.j.google.configurata, false);
    assert.match(st.j.google.errore, /GOOGLE_CLIENT_ID/);
    assert.equal(st.j.google.account_atteso, 'fraepi@gmail.com');
    const r = await D.o.get('/api/rubriche/cerca?q=Internotest');
    assert.equal(r.s, 200);
    assert.deepEqual([r.j.outlook, r.j.google], [[], []]);
    assert.match(r.j.errori.outlook, /^Non configurata/);
    assert.match(r.j.errori.google, /^Non configurata/);
    assert.equal(r.j.suite[0]?.cognome, 'Internotest');
    assert.equal((await D.o.get('/api/rubriche/cerca?q=a')).s, 400);
    const po = await D.o.post('/api/rubriche/outlook/prova');
    assert.equal(po.j.ok, false); assert.match(po.j.message, /Credenziali Microsoft Graph/);
    const pg_ = await D.o.post('/api/rubriche/google/prova');
    assert.equal(pg_.j.ok, false); assert.match(pg_.j.message, /GOOGLE_CLIENT_ID/);
    // avvio del consenso senza credenziali: ritorno alle Impostazioni con il motivo, nessun redirect verso Google
    const av = await D.o.get('/api/rubriche/google/avvia');
    assert.equal(av.s, 302);
    assert.match(av.headers.get('location'), /^\/admin\/settings\?rubriche_google=errore/);
    // callback senza avvio: rifiutato
    const cb = await D.o.get('/api/rubriche/google/callback?code=x&state=y');
    assert.match(cb.headers.get('location'), /scaduta%20o%20non%20valida/);
  });

  test('gli esterni non usano le rubriche; le impostazioni sono degli amministratori', async () => {
    assert.equal((await D.cliente.get('/api/rubriche/stato')).s, 403);
    assert.equal((await D.cliente.get('/api/rubriche/cerca?q=pro')).s, 403);
    assert.equal((await D.cliente.put('/api/rubriche/impostazioni', { outlook_casella: 'x@y.example' })).s, 403);
    assert.equal((await D.o.put('/api/rubriche/impostazioni', { outlook_casella: 'non valida' })).s, 400);
    const s = await D.o.put('/api/rubriche/impostazioni', { outlook_casella: 'rubrica.prova@toscanadiagnostica.it' });
    assert.equal(s.j.outlook_casella, 'rubrica.prova@toscanadiagnostica.it');
    assert.equal((await D.o.get('/api/rubriche/stato')).j.outlook.casella, 'rubrica.prova@toscanadiagnostica.it');
    // la chiave non compare nell'editor generico come segreto, il token Google non c'è
    const set = await D.o.get('/api/settings');
    assert.ok(!Object.keys(set.j).some((k) => k.startsWith('secret:')));
  });
});

describe('ricerca con RUBRICHE_MOCK=1 (integrazione)', { skip: SALTA }, () => {
  let S, o;
  before(async () => { S = await avviaSuite({ env: { RUBRICHE_MOCK: '1' } }); o = await entra(client(S.base), OWNER.email, OWNER.password, OWNER.finale); }, { timeout: 120000 });
  after(async () => { await S?.stop(); });

  test('contatti di prova dalle due fonti, audit con query troncata e mascherata', async () => {
    const st = await o.get('/api/rubriche/stato');
    assert.equal(st.j.mock, true);
    const r = await o.get('/api/rubriche/cerca?q=prova');
    assert.equal(r.s, 200);
    assert.ok(r.j.outlook.length >= 1 && r.j.outlook.every((c) => c.fonte === 'OUTLOOK' && /prova/i.test(c.nome)));
    assert.ok(r.j.google.length >= 1 && r.j.google.every((c) => c.fonte === 'GOOGLE'));
    const e = await o.get('/api/rubriche/email?indirizzo=laura.prova@rubrica-di-prova.example');
    assert.equal(e.j.trovato?.fonte, 'OUTLOOK');
    assert.equal(e.j.trovato.cognome, 'Prova');
    assert.equal((await o.get('/api/rubriche/email?indirizzo=nessuno@altrove.example')).j.trovato, null);
    const audit = await o.get('/api/audit?action=RUBRICA_CERCA');
    const righe = (Array.isArray(audit.j) ? audit.j : audit.j?.rows || []).filter((x) => x.action === 'RUBRICA_CERCA');
    assert.ok(righe.length >= 1);
    assert.ok(righe.every((x) => !JSON.stringify(x).includes('laura.prova@')), 'nessuna email in chiaro nell\'audit');
  });
});
