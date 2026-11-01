// Test del Portale Service (modules/service/lib/regole.js): funzioni pure. Link stabili /p /m /doc con le stesse regole di app.py
// del sito di origine, percorsi ammessi nella cache, JSON canonico e confronto build/sha dello specchio, radice dello ZIP del repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, costruisciIndice, cercaDocumento, risolviLink, percorsoValido, urlFile, canonico, shaJson, confrontaSpecchio, validaContenuti, radiceZip, normalizzaNomeZip, senzaNul, CHIAVI } from '../src/modules/service/lib/regole.js';

// Estratto fedele di data/docs.json e data/preparazioni.json del sito (campi usati dalle regole)
const DOCS = [
  { code: 'TD-SGI-MOD252_01', pdf: '17-Accettazione/TD-SGI-MOD252_01 - Richiesta Materiale.pdf', stampabile: 'TD-SGI-MOD252_01 - Richiesta Materiale.pdf' },
  { code: 'TD-SGI-PRO042_03', pdf: '18-Laboratorio-di-Analisi/TD-SGI-PRO042_03 - Fase preanalitica.pdf', stampabile: null },
  { code: 'TD-SGI-INF001_00', pdf: '17-Accettazione/TD-SGI-INF001_00 - Informativa.pdf', stampabile: 'TD-SGI-INF001_00_Informativa_raccolta_campioni_Paziente.pdf' },
  { code: 'TD-SGI-INF001_0a', pdf: null, stampabile: 'TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf', prep_only: true },
  { code: 'TD-SGI-DEX003_00', pdf: null, stampabile: null },
];
const L = (code, file) => ({ code, title: code, file });
const PREP = { righe: [
  { codice: '841125', shortcut: '1079', descrizione: 'Curva standard glicemica da carico', link: [L('TD-SGI-INF001_0a', 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf')] },
  { codice: 'ECO003', shortcut: 'ECO003', descrizione: 'Ecografia', link: [L('TD-SGI-INF020_00', 'stampabili/A.pdf'), L('TD-SGI-INF021_00', 'stampabili/B.pdf')] },
  { codice: '9001', shortcut: '', descrizione: 'Senza shortcut', link: [L('X', 'stampabili/C.pdf')] },
  { codice: '7777', shortcut: '7777', descrizione: 'Senza preparazione', link: [] },
] };

test('slug come app.py: accenti tolti, separatori unificati, trattini ai bordi', () => {
  assert.equal(slug('ECO003'), 'ECO003');
  assert.equal(slug(' Curva glicémica / 75 g '), 'Curva-glicemica-75-g');
  assert.equal(slug('--1079--'), '1079');
  assert.equal(slug(null), '');
});

test('/p/<shortcut>: una preparazione → PDF; più preparazioni → elenco; .pdf forza il primo; codice GIPO come alias', () => {
  const idx = costruisciIndice(DOCS, PREP);
  assert.deepEqual(risolviLink('p', '1079', idx), { file: 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf' });
  assert.deepEqual(risolviLink('p', '841125', idx), risolviLink('p', '1079', idx), 'il codice GIPO numerico è un alias');
  assert.deepEqual(risolviLink('p', 'eco003', idx), { elenco: 'ECO003' }, 'più preparazioni: elenco della prestazione (maiuscole indifferenti)');
  assert.deepEqual(risolviLink('p', 'ECO003.pdf', idx), { file: 'stampabili/A.pdf' });
  assert.deepEqual(risolviLink('p', '9001', idx), { file: 'stampabili/C.pdf' }, 'senza shortcut vale il codice');
  assert.deepEqual(risolviLink('p', '7777', idx), { elenco: '7777' }, 'senza link la prestazione non è nell\'indice: elenco con avviso');
  assert.deepEqual(risolviLink('p', 'INESISTENTE', idx), { elenco: 'INESISTENTE' });
});

test('/m/<codice>: stampabile se c\'è, altrimenti PDF; /doc/<codice>: solo PDF; codice senza revisione e suffissi _0a', () => {
  const idx = costruisciIndice(DOCS, PREP);
  assert.deepEqual(risolviLink('m', 'TD-SGI-MOD252', idx), { file: 'stampabili/TD-SGI-MOD252_01 - Richiesta Materiale.pdf' });
  assert.deepEqual(risolviLink('m', 'td-sgi-mod252', idx), { file: 'stampabili/TD-SGI-MOD252_01 - Richiesta Materiale.pdf' }, 'minuscolo accettato');
  assert.deepEqual(risolviLink('m', 'TD-SGI-PRO042', idx), { file: 'docs/18-Laboratorio-di-Analisi/TD-SGI-PRO042_03 - Fase preanalitica.pdf' });
  assert.deepEqual(risolviLink('doc', 'TD-SGI-PRO042_03', idx), { file: 'docs/18-Laboratorio-di-Analisi/TD-SGI-PRO042_03 - Fase preanalitica.pdf' }, 'anche con la revisione');
  assert.deepEqual(risolviLink('m', 'TD-SGI-INF001_0A', idx), { file: 'stampabili/TD-SGI-INF001_0a_Curva Glicemica e Curva Glicemica in Gravidanza.pdf' }, 'ultima lettera minuscola (_0a)');
  assert.deepEqual(risolviLink('m', 'TD-SGI-INF001', idx), { file: 'stampabili/TD-SGI-INF001_00_Informativa_raccolta_campioni_Paziente.pdf' }, 'INF001 senza suffisso = informativa _00, non _0a');
  assert.equal(risolviLink('doc', 'TD-SGI-INF001_0a', idx), null, 'solo stampabile: /doc risponde 404');
  assert.equal(risolviLink('m', 'TD-SGI-DEX003', idx), null, 'nessun file: 404');
  assert.equal(risolviLink('doc', 'TD-SGI-XXX999', idx), null);
  assert.equal(cercaDocumento('TD-SGI-MOD252.pdf', idx)?.code, 'TD-SGI-MOD252_01', '.pdf finale ignorato');
  assert.equal(risolviLink('zz', 'TD-SGI-MOD252', idx), null);
});

test('percorsi della cache: solo cartelle del sito, niente risalite, PDF (e loghi PNG in static)', () => {
  assert.equal(percorsoValido('stampabili/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1#U00b0 Trimestre.pdf'), 'stampabili/TD-SGI-DEX010_00 - Richiesta Screening Combinato di 1#U00b0 Trimestre.pdf');
  assert.equal(percorsoValido('/docs/17-Accettazione/x.pdf'), 'docs/17-Accettazione/x.pdf');
  assert.equal(percorsoValido('vademecum/Toscana Diagnostica - Vademecum degli esami.pdf'), 'vademecum/Toscana Diagnostica - Vademecum degli esami.pdf');
  assert.equal(percorsoValido('static/logo-iso9001.png'), 'static/logo-iso9001.png');
  assert.equal(percorsoValido('static/app.js'), null);
  assert.equal(percorsoValido('static/sub/logo.png'), null);
  assert.equal(percorsoValido('docs/../app.py'), null);
  assert.equal(percorsoValido('docs/..\\..\\x.pdf'), null);
  assert.equal(percorsoValido('data/docs.json'), null);
  assert.equal(percorsoValido('certificati/x.exe'), null);
  assert.equal(percorsoValido('docs'), null);
  assert.equal(percorsoValido(''), null);
  assert.equal(urlFile('https://service.toscanadiagnostica.it/', 'stampabili/a #1, b.pdf'), 'https://service.toscanadiagnostica.it/stampabili/a%20%231%2C%20b.pdf');
});

test('JSON canonico: lo sha non dipende da spazi e ordine delle chiavi (Flask jsonify le ordina)', () => {
  const a = { n_pdf: 190, build: '30/10/2026 07:52', aree: ['16', '17'], x: { b: 1, a: 2 } };
  const b = JSON.parse('{"x":{"a":2,"b":1},"aree":["16","17"],"build":"30/10/2026 07:52","n_pdf":190}');
  assert.equal(canonico(a), canonico(b));
  assert.equal(shaJson(a), shaJson(b));
  assert.notEqual(shaJson(a), shaJson({ ...a, aree: ['17', '16'] }), 'l\'ordine degli elenchi conta');
  assert.equal(canonico({ a: undefined, b: null }), '{"b":null}');
});

test('confronto dello specchio: primo caricamento, build cambiata, JSON redazionale cambiato a build ferma, nessun cambiamento', () => {
  const sha = Object.fromEntries(CHIAVI.map((k) => [k, `s-${k}`]));
  assert.deepEqual(confrontaSpecchio(null, { build: 'B1', sha }), { cambiato: true, motivi: ['primo caricamento'] });
  assert.deepEqual(confrontaSpecchio({ build: 'B1', sha }, { build: 'B1', sha }), { cambiato: false, motivi: [] });
  const c1 = confrontaSpecchio({ build: 'B1', sha }, { build: 'B2', sha: { ...sha, meta: 'nuovo' } });
  assert.equal(c1.cambiato, true);
  assert.deepEqual(c1.motivi, ['build B1 → B2', 'meta.json modificato']);
  const c2 = confrontaSpecchio({ build: 'B1', sha }, { build: 'B1', sha: { ...sha, menu: 'x' } });
  assert.deepEqual(c2, { cambiato: true, motivi: ['menu.json modificato'] }, 'menu.json caricato via web senza rilanciare il batch');
});

test('validazione dei contenuti e radice dello ZIP di GitHub', () => {
  const ok = Object.fromEntries(CHIAVI.map((k) => [k, {}]));
  Object.assign(ok, { meta: { build: 'B' }, docs: [], preparazioni: { righe: [] } });
  assert.deepEqual(validaContenuti(ok), []);
  const ko = validaContenuti({ meta: { n: 1 }, docs: {}, preparazioni: {} });
  assert.ok(ko.includes('meta.json senza "build"') && ko.includes('docs.json non è un elenco') && ko.includes('fulltext.json mancante'));
  assert.equal(radiceZip(['td-service-portale-main/', 'td-service-portale-main/data/meta.json', 'td-service-portale-main/static/x/data/meta.json']), 'td-service-portale-main/');
  assert.equal(radiceZip(['data/meta.json', 'docs/a.pdf']), '');
  assert.equal(radiceZip(['README.md']), null);
});

test('nomi dei file nello ZIP: sequenze #Uxxxx ridecodificate e forma NFC, come in docs.json', () => {
  assert.equal(normalizzaNomeZip('stampabili/TD-SGI-DEX014_00 - Richiesta Test di Paternit#U00e0.pdf'), 'stampabili/TD-SGI-DEX014_00 - Richiesta Test di Paternità.pdf');
  assert.equal(normalizzaNomeZip('docs/x di 1#U00b0 Trimestre.pdf'), 'docs/x di 1° Trimestre.pdf');
  assert.equal(normalizzaNomeZip('Qualita\u0300'), 'Qualità', 'NFD (macOS) → NFC');
  assert.equal(normalizzaNomeZip('docs/a.pdf'), 'docs/a.pdf');
});

test('carattere NUL tolto dalle stringhe (jsonb non lo accetta: compare nel testo estratto dai PDF)', () => {
  assert.deepEqual(senzaNul({ 'TD-SGI-PRO001_00': 'testo\u0000 del pdf', n: 3, l: ['a\u0000', null] }), { 'TD-SGI-PRO001_00': 'testo del pdf', n: 3, l: ['a', null] });
  assert.equal(shaJson(senzaNul({ a: 'x\u0000' })), shaJson({ a: 'x' }), 'stesso sha che arrivi dal sito o dallo ZIP');
});
