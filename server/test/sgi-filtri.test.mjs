// Test dei filtri del cruscotto SGI (web/src/modules/sgi/filtri.js, funzioni pure condivise con le pagine React): famiglie e riquadri,
// ricerca full-text, area, versioni stampabili, ultime emissioni (40 più recenti), documenti cardine, preparazioni. Stesse regole di
// static/app.js e static/preparazioni.html del sito sgi.toscanadiagnostica.it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMIGLIE, RIQUADRI, DOCUMENTI_CARDINE, filtraDocumenti, haFiltri, famiglieAttive, ultimeEmissioni, documentiCardine, conteggi, chiaveData, titoloRisultati, filtraPrestazioni, prestazioneDaCodice, gruppoPrestazione, norm } from '../../web/src/modules/sgi/filtri.js';

const D = (code, famiglia, area, data, extra = {}) => ({ code, famiglia, area, data, rev: code.split('_')[1], title: `Titolo ${code}`, sintesi: '', famiglia_nome: famiglia, pdf: `x/${code}.pdf`, stampabile: null, ...extra });
const DOCS = [
  D('TD-SGI-POL001_02', 'POL', '01. Gestione del Sistema', '29/10/2026', { title: 'Politica Integrata' }),
  D('TD-SGI-MAN005_00', 'MAN', '01. Gestione del Sistema', '29/10/2026', { title: 'Mappa Concettuale del SGI' }),
  D('TD-SGI-REG006_83', 'REG', '01. Gestione del Sistema', '29/10/2026'),
  D('TD-SGI-RPT001_00', 'RPT', '10. Audit', '01/03/2026'),
  D('TD-SGI-PLN001_01', 'PLN', '01. Gestione del Sistema', '15/01/2026'),
  D('TD-SGI-PRO042_02', 'PRO', '18. Laboratorio di Analisi', '07/10/2026', { title: 'Gestione Fase Preanalitica', sintesi: 'ricezione e check-in dei campioni' }),
  D('TD-SGI-PRO001_00', 'PRO', '01. Gestione del Sistema', '02/02/2025'),
  D('TD-SGI-IDL036_01', 'IDL', '18. Laboratorio di Analisi', '10/09/2026', { title: 'Emocromo: istruzione' }),
  D('TD-SGI-MOD252_01', 'MOD', '17. Accettazione', '01/10/2026', { stampabile: 'TD-SGI-MOD252_01 - Richiesta Materiale.pdf' }),
  D('TD-SGI-INF001_00', 'INF', '17. Accettazione', '20/09/2026', { stampabile: 'TD-SGI-INF001_00.pdf' }),
  D('TD-SGI-DEX010_00', 'DEX', '17. Accettazione', '28/09/2026', { title: 'Richiesta Screening Combinato di 1° Trimestre', stampabile: 'TD-SGI-DEX010_00.pdf' }),
];
const FT = { 'TD-SGI-PRO042_02': 'Il campione per EMOCROMO va in provetta EDTA.', 'TD-SGI-MOD252_01': 'Richiesta materiale: provette per emocròmo' };
const codici = (r) => r.map((d) => d.code);

test('senza filtri nessun elenco (il cruscotto mostra documenti cardine e aree); qualunque filtro lo attiva', () => {
  assert.equal(haFiltri({}), false);
  assert.deepEqual(filtraDocumenti(DOCS, {}), []);
  assert.equal(haFiltri({ q: '  ' }), false);
  for (const f of [{ q: 'x' }, { riquadro: 'tutti' }, { famiglia: 'PRO' }, { area: '10. Audit' }, { speciale: 'recenti' }]) assert.equal(haFiltri(f), true, JSON.stringify(f));
});

test('i quattro riquadri: tutti, PRO+IDL, MOD+INF+DEX, POL+MAN+PLN+REG+RPT; il riquadro prevale sulla barra delle famiglie', () => {
  assert.equal(filtraDocumenti(DOCS, { riquadro: 'tutti' }).length, DOCS.length);
  assert.deepEqual(codici(filtraDocumenti(DOCS, { riquadro: 'operativi' })), ['TD-SGI-IDL036_01', 'TD-SGI-PRO001_00', 'TD-SGI-PRO042_02']);
  assert.deepEqual(codici(filtraDocumenti(DOCS, { riquadro: 'moduli' })), ['TD-SGI-DEX010_00', 'TD-SGI-INF001_00', 'TD-SGI-MOD252_01']);
  assert.deepEqual(new Set(filtraDocumenti(DOCS, { riquadro: 'governo' }).map((d) => d.famiglia)), new Set(['POL', 'MAN', 'PLN', 'REG', 'RPT']));
  assert.deepEqual(famiglieAttive({ riquadro: 'operativi', famiglia: 'MOD' }), ['PRO', 'IDL']);
  assert.deepEqual(famiglieAttive({ famiglia: 'MOD' }), ['MOD']);
  assert.equal(famiglieAttive({ famiglia: 'all' }), null);
  assert.deepEqual(Object.keys(RIQUADRI), ['tutti', 'operativi', 'moduli', 'governo']);
  assert.equal(FAMIGLIE.length, 11, 'Tutti + 10 famiglie');
  const c = conteggi(DOCS);
  assert.equal(c.gruppo('tutti'), DOCS.length);
  assert.equal(c.gruppo('operativi'), 3);
  assert.equal(c.gruppo('governo'), 5);
});

test('ricerca: metadati e testo integrale, senza accenti, ogni parola; prima chi ha la frase in codice o titolo', () => {
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'emocromo' })), ['TD-SGI-IDL036_01'], 'senza fulltext solo i metadati');
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'emocromo' }, FT)), ['TD-SGI-IDL036_01', 'TD-SGI-MOD252_01', 'TD-SGI-PRO042_02'], 'con fulltext: titolo prima, poi per codice; accenti ignorati');
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'EMOCROMO edta' }, FT)), ['TD-SGI-PRO042_02'], 'tutte le parole');
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'check-in campioni' })), ['TD-SGI-PRO042_02'], 'anche la sintesi');
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'trimestre' })), ['TD-SGI-DEX010_00']);
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'emocromo', famiglia: 'PRO' }, FT)), ['TD-SGI-PRO042_02'], 'ricerca e famiglia insieme');
  assert.deepEqual(codici(filtraDocumenti(DOCS, { q: 'emocromo', area: '17. Accettazione' }, FT)), ['TD-SGI-MOD252_01'], 'ricerca e area insieme');
  assert.equal(norm('Qualità'), 'qualita');
});

test('versioni stampabili e area', () => {
  assert.deepEqual(codici(filtraDocumenti(DOCS, { speciale: 'stampabili' })), ['TD-SGI-DEX010_00', 'TD-SGI-INF001_00', 'TD-SGI-MOD252_01']);
  assert.deepEqual(codici(filtraDocumenti(DOCS, { area: '10. Audit' })), ['TD-SGI-RPT001_00']);
  assert.equal(titoloRisultati({ riquadro: 'moduli', speciale: 'stampabili', area: '17. Accettazione', q: 'materiale' }), 'Moduli, informative e documenti esterni · versioni stampabili · 17. Accettazione · "materiale"');
  assert.equal(titoloRisultati({ famiglia: 'IDL' }), 'Istruzioni');
});

test('ultime emissioni: i 40 più recenti per data gg/mm/aaaa, a parità di data per codice', () => {
  assert.equal(chiaveData({ data: '07/10/2026' }), '20261007');
  assert.equal(chiaveData({}), '00000000');
  const r = filtraDocumenti(DOCS, { speciale: 'recenti' });
  assert.deepEqual(codici(r).slice(0, 4), ['TD-SGI-MAN005_00', 'TD-SGI-POL001_02', 'TD-SGI-REG006_83', 'TD-SGI-PRO042_02']);
  assert.equal(codici(r).at(-1), 'TD-SGI-PRO001_00');
  const tanti = Array.from({ length: 60 }, (_, i) => D(`TD-SGI-MOD${String(i).padStart(3, '0')}_00`, 'MOD', '17. Accettazione', `${String((i % 28) + 1).padStart(2, '0')}/0${(i % 9) + 1}/2026`));
  assert.equal(ultimeEmissioni(tanti).length, 40);
  assert.equal(filtraDocumenti(tanti, { speciale: 'recenti' }).length, 40);
  assert.deepEqual(codici(ultimeEmissioni(DOCS, 3)), ['TD-SGI-MAN005_00', 'TD-SGI-POL001_02', 'TD-SGI-REG006_83']);
});

test('documenti cardine: quelli presenti, nell\'ordine del sito (POL001, MAN005, REG006, PLN001, PRO001, PRO042, IDL036, INF001, MOD252)', () => {
  assert.equal(DOCUMENTI_CARDINE.length, 24);
  const atteso = ['TD-SGI-POL001_02', 'TD-SGI-MAN005_00', 'TD-SGI-REG006_83', 'TD-SGI-PLN001_01', 'TD-SGI-PRO001_00', 'TD-SGI-PRO042_02', 'TD-SGI-IDL036_01', 'TD-SGI-INF001_00', 'TD-SGI-MOD252_01'];
  assert.deepEqual(codici(documentiCardine(DOCS)), atteso);
  assert.deepEqual(codici(filtraDocumenti(DOCS, { speciale: 'cardine' })), atteso);
  const conPrep = [...DOCS, D('TD-SGI-INF001_0a', 'INF', '17. Accettazione', '20/09/2026'), D('TD-SGI-INF001_0b', 'INF', '17. Accettazione', '20/09/2026')];
  assert.deepEqual(codici(filtraDocumenti(conPrep, { speciale: 'cardine' })), atteso, 'INF001 = solo l\'informativa _00, non le preparazioni _0a.._0s');
});

test('preparazioni: ricerca su codici, descrizione ed extra, gruppo senza trattino, ?codice= tra shortcut e codice GIPO', () => {
  const R = [
    { codice: '841125', shortcut: '1079', descrizione: 'Curva standard glicemica da carico', extra: { Gruppo: '- Laboratorio di Analisi' }, link: [{ code: 'TD-SGI-INF001_0a', title: 'Curva Glicemica' }] },
    { codice: '857352', shortcut: 'MAM004', descrizione: 'Mammografia bilaterale', extra: { Gruppo: '- Diagnostica per immagini' }, link: [] },
  ];
  assert.equal(gruppoPrestazione(R[0]), 'Laboratorio di Analisi');
  assert.equal(filtraPrestazioni(R, { q: 'curva glicemica' }).length, 1);
  assert.equal(filtraPrestazioni(R, { q: 'inf001' }).length, 1, 'anche il codice della preparazione');
  assert.equal(filtraPrestazioni(R, { gruppo: 'Diagnostica per immagini' })[0].shortcut, 'MAM004');
  assert.equal(filtraPrestazioni(R, {}).length, 2);
  assert.equal(prestazioneDaCodice(R, 'mam004')?.codice, '857352');
  assert.equal(prestazioneDaCodice(R, '841125')?.shortcut, '1079', 'codice GIPO come alias');
  assert.equal(prestazioneDaCodice(R, 'ECO999'), null);
});
