// Test del Portale SGI (modules/sgi/lib/regole.js e lib/specchioRegole.js): funzioni pure. Link stabili /doc /m /p con le regole di
// app.py del sito sgi.toscanadiagnostica.it, percorsi ammessi nella cache (docs e stampabili), intestazione HTTP Basic per l'origine
// protetta (SGI_USER/SGI_PASSWORD), validazione dei quattro JSON, confronto dello specchio, codici per il rimando dal Portale Service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIAVI, costruisciIndice, risolviLink, percorsoValido, validaContenuti, confrontaSpecchio, autorizzazioneSgi, codiciBase, urlConCredenziali, normalizzaNomeZip, urlFile } from '../src/modules/sgi/lib/regole.js';
import { intestazioneBasic } from '../src/lib/specchioRegole.js';

// Estratto fedele di data/docs.json e data/preparazioni.json del sito SGI (pubblicazione del 30/10/2026)
const DOCS = [
  { code: 'TD-SGI-PRO042_02', pdf: '18-Laboratorio-di-Analisi/TD-SGI-PRO042_02 - Gestione Fase Preanalitica.pdf', stampabile: null, allegati: ['18-Laboratorio-di-Analisi/TD-SGI-PRO042_02 - Allegato 1 - Workflow check-in dei campioni.pdf'] },
  { code: 'TD-SGI-REG006_83', pdf: '01-Gestione-del-Sistema/TD-SGI-REG006_83 - Indice del Sistema di Gestione Integrato.pdf', stampabile: null },
  { code: 'TD-SGI-DEX010_00', pdf: '17-Accettazione/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf', stampabile: 'TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf' },
  { code: 'TD-SGI-INF001_00', pdf: '17-Accettazione/TD-SGI-INF001_00 - Informativa.pdf', stampabile: 'TD-SGI-INF001_00_Informativa.pdf' },
  { code: 'TD-SGI-INF001_0a', pdf: '17-Accettazione/TD-SGI-INF001_0a - Curva Glicemica.pdf', stampabile: 'TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf' },
];
const L = (code, file) => ({ code, title: code, file });
const PREP = { righe: [
  { codice: '841125', shortcut: '1079', descrizione: 'Curva standard glicemica da carico', link: [L('TD-SGI-INF001_0a', 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf')], url: '/p/1079' },
  { codice: '857352', shortcut: 'MAM004', descrizione: 'Mammografia ed ecografia', link: [L('TD-SGI-INF030_00', 'stampabili/A.pdf'), L('TD-SGI-INF031_00', 'stampabili/B.pdf')], url: '/p/MAM004' },
] };

test('/sgi/doc/<codice>: PDF corrente senza revisione nel link (TD-SGI-PRO042 → _02), anche in minuscolo', () => {
  const idx = costruisciIndice(DOCS, PREP);
  assert.deepEqual(risolviLink('doc', 'TD-SGI-PRO042', idx), { file: 'docs/18-Laboratorio-di-Analisi/TD-SGI-PRO042_02 - Gestione Fase Preanalitica.pdf' });
  assert.deepEqual(risolviLink('doc', 'td-sgi-reg006', idx), { file: 'docs/01-Gestione-del-Sistema/TD-SGI-REG006_83 - Indice del Sistema di Gestione Integrato.pdf' });
  assert.equal(risolviLink('doc', 'TD-SGI-PRO999', idx), null, 'documento inesistente: 404 → cruscotto con avviso');
});

test('/sgi/m/<codice>: versione stampabile se c\'è, altrimenti PDF; INF001 e INF001_0a restano distinti', () => {
  const idx = costruisciIndice(DOCS, PREP);
  assert.deepEqual(risolviLink('m', 'TD-SGI-DEX010', idx), { file: 'stampabili/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf' });
  assert.deepEqual(risolviLink('m', 'TD-SGI-PRO042', idx), { file: 'docs/18-Laboratorio-di-Analisi/TD-SGI-PRO042_02 - Gestione Fase Preanalitica.pdf' }, 'senza stampabile: PDF');
  assert.deepEqual(risolviLink('m', 'TD-SGI-INF001', idx), { file: 'stampabili/TD-SGI-INF001_00_Informativa.pdf' });
  assert.deepEqual(risolviLink('m', 'TD-SGI-INF001_0A', idx), { file: 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf' });
});

test('/sgi/p/<shortcut>: una preparazione → PDF; più preparazioni o codice sconosciuto → pagina Preparazioni; GIPO come alias', () => {
  const idx = costruisciIndice(DOCS, PREP);
  assert.deepEqual(risolviLink('p', '1079', idx), { file: 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf' });
  assert.deepEqual(risolviLink('p', '841125', idx), risolviLink('p', '1079', idx));
  assert.deepEqual(risolviLink('p', 'mam004', idx), { elenco: 'MAM004' });
  assert.deepEqual(risolviLink('p', 'MAM004.pdf', idx), { file: 'stampabili/A.pdf' }, '.pdf forza il primo');
  assert.deepEqual(risolviLink('p', 'XYZ', idx), { elenco: 'XYZ' });
});

test('percorsi della cache del SGI: solo docs/ e stampabili/, solo PDF, niente risalite', () => {
  assert.equal(percorsoValido('docs/17-Accettazione/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf'), 'docs/17-Accettazione/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf');
  assert.equal(percorsoValido('/stampabili/x.pdf'), 'stampabili/x.pdf');
  assert.equal(percorsoValido('certificati/x.pdf'), null, 'cartella del Portale Service, non del SGI');
  assert.equal(percorsoValido('static/logo-light.svg'), null);
  assert.equal(percorsoValido('data/fulltext.json'), null);
  assert.equal(percorsoValido('docs/../app.py'), null);
  assert.equal(urlFile('http://127.0.0.1:7042', 'stampabili/1° Trimestre #2.pdf'), 'http://127.0.0.1:7042/stampabili/1%C2%B0%20Trimestre%20%232.pdf');
  assert.equal(normalizzaNomeZip('stampabili/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1#U00b0 Trimestre.pdf'), 'stampabili/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1° Trimestre.pdf', 'nomi dello ZIP come in docs.json');
});

test('HTTP Basic: intestazione solo con la password; utente vuoto = "sgi" come app.py; UTF-8; niente ":" nell\'utente', () => {
  assert.equal(autorizzazioneSgi('', ''), null, 'sito pubblico: nessuna intestazione');
  assert.equal(autorizzazioneSgi('mario', null), null);
  assert.equal(autorizzazioneSgi('', 'segreta'), `Basic ${Buffer.from('sgi:segreta').toString('base64')}`);
  assert.equal(autorizzazioneSgi(' qualita ', 'p:w'), `Basic ${Buffer.from('qualita:p:w').toString('base64')}`, 'i due punti sono ammessi nella password');
  assert.equal(intestazioneBasic('qualità', 'perché'), `Basic ${Buffer.from('qualità:perché', 'utf8').toString('base64')}`);
  assert.equal(Buffer.from(autorizzazioneSgi('sgi', 'Prova!').slice(6), 'base64').toString('utf8'), 'sgi:Prova!');
  assert.throws(() => autorizzazioneSgi('a:b', 'x'), /":"/);
  assert.equal(urlConCredenziali('https://sgi:pw@sgi.toscanadiagnostica.it'), true, 'le credenziali non vanno nell\'indirizzo');
  assert.equal(urlConCredenziali('https://sgi.toscanadiagnostica.it'), false);
});

test('validazione dei quattro JSON del SGI e confronto dello specchio', () => {
  assert.deepEqual(CHIAVI, ['meta', 'docs', 'preparazioni', 'fulltext']);
  assert.deepEqual(validaContenuti({ meta: { build: 'B' }, docs: [], preparazioni: { righe: [] }, fulltext: {} }), []);
  const ko = validaContenuti({ meta: { build: 'B' }, docs: [], preparazioni: { righe: [] }, fulltext: [] });
  assert.ok(ko.some((e) => e.startsWith('fulltext.json non è un oggetto')));
  assert.ok(validaContenuti({ meta: {}, docs: [], preparazioni: { righe: [] } }).includes('fulltext.json mancante'));
  const sha = { meta: 'm', docs: 'd', preparazioni: 'p', fulltext: 'f' };
  assert.deepEqual(confrontaSpecchio({ build: '30/10/2026 07:44', sha }, { build: '30/10/2026 07:44', sha }), { cambiato: false, motivi: [] });
  assert.deepEqual(confrontaSpecchio({ build: '30/10/2026 07:44', sha }, { build: '01/11/2026 09:00', sha: { ...sha, docs: 'd2' } }).motivi, ['build 30/10/2026 07:44 → 01/11/2026 09:00', 'docs.json modificato']);
});

test('codici base per il rimando dal Portale Service: senza revisione, suffissi _0a conservati', () => {
  assert.deepEqual(codiciBase(DOCS), ['TD-SGI-DEX010', 'TD-SGI-INF001', 'TD-SGI-INF001_0a', 'TD-SGI-PRO042', 'TD-SGI-REG006']);
  assert.deepEqual(codiciBase(null), []);
});
