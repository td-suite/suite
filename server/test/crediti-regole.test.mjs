// v0.95.0 · Recupero Crediti: regole pure (nessun database). Scadenza dai termini, scala del memo, riconoscimento dei bonifici,
// lettura delle risposte, testi. Dati sintetici.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { scadenzaDaTermini, faseDovuta, PREDEFINITE, proponiAbbinamento, causaleCita, classificaRisposta, dataNelTesto, piuLavorativi, fasciaAging, compila, somiglianzaNome } from '../src/modules/crediti/lib/regole.js';
import { componi, MODELLI } from '../src/modules/crediti/lib/testi.js';
import { numeroIt, dataIt } from '../src/modules/crediti/lib/fatture.js';

const imp = { ...PREDEFINITE };

describe('Recupero Crediti: regole', () => {
  test('scadenza dai termini del Business Hub', () => {
    assert.deepEqual(scadenzaDaTermini('2026-01-10', 'Bonifico bancario 30 gg f.m. data fattura'), { scadenza: '2026-02-28', origine: 'TERMINI' });
    assert.equal(scadenzaDaTermini('2026-01-31', 'Bonifico bancario 60 gg f.m. data fattura').scadenza, '2026-03-31');
    assert.equal(scadenzaDaTermini('2026-03-05', 'Bonifico bancario a vista fattura').scadenza, '2026-03-05');
    assert.equal(scadenzaDaTermini('2026-03-05', '30 giorni data fattura').scadenza, '2026-04-04');
    assert.equal(scadenzaDaTermini('2026-03-05', 'RID/SDD 30 gg f.m.').scadenza, '2026-04-30');
    // termini assenti o non leggibili: predefiniti, e l'origine lo dichiara (un sollecito su questa scadenza non parte da solo)
    assert.deepEqual(scadenzaDaTermini('2026-03-05', ''), { scadenza: '2026-04-30', origine: 'PREDEFINITA' });
    assert.equal(scadenzaDaTermini('2026-03-05', 'come da accordi').origine, 'PREDEFINITA');
  });

  test('scala del memo: -7, +10, +25, +35, +60, sempre in ordine e mai a salti', () => {
    const f = (scadenza, fase = 0, fase_at = null) => ({ scadenza, fase, fase_at });
    assert.equal(faseDovuta(f('2026-12-10'), imp, '2026-12-02'), null, 'otto giorni prima: niente');
    assert.equal(faseDovuta(f('2026-12-10'), imp, '2026-12-03'), 1, 'sette giorni prima: avviso');
    assert.equal(faseDovuta(f('2026-12-10'), imp, '2026-12-09'), 1);
    assert.equal(faseDovuta(f('2026-12-10', 1, '2026-12-03'), imp, '2026-12-09'), null, 'avviso già fatto');
    assert.equal(faseDovuta(f('2026-12-10'), imp, '2026-12-10'), null, 'il giorno della scadenza non è un ritardo');
    assert.equal(faseDovuta(f('2026-12-10', 1), imp, '2026-12-19'), null, '+9');
    assert.equal(faseDovuta(f('2026-12-10', 1), imp, '2026-12-20'), 2, '+10: primo sollecito');
    assert.equal(faseDovuta(f('2026-12-10', 0), imp, '2026-12-20'), 2, 'anche senza avviso');
    // fattura entrata nel widget già scaduta da 90 giorni: riparte dal 1° sollecito, non dall'area legale
    assert.equal(faseDovuta(f('2026-09-01', 0), imp, '2026-11-30'), 2);
    // dopo il 1° sollecito devono passare 15 giorni veri prima del 2°, anche se la fattura è scaduta da molto
    assert.equal(faseDovuta(f('2026-09-01', 2, '2026-11-30'), imp, '2026-12-10'), null);
    assert.equal(faseDovuta(f('2026-09-01', 2, '2026-11-30'), imp, '2026-12-15'), 3);
    assert.equal(faseDovuta(f('2026-11-01', 2, '2026-11-11'), imp, '2026-11-25'), null, '+24');
    assert.equal(faseDovuta(f('2026-11-01', 2, '2026-11-11'), imp, '2026-11-26'), 3, '+25');
    assert.equal(faseDovuta(f('2026-11-01', 3, '2026-11-26'), imp, '2026-12-05'), null, '+34');
    assert.equal(faseDovuta(f('2026-11-01', 3, '2026-11-26'), imp, '2026-12-06'), 4, '+35: chiamata');
    assert.equal(faseDovuta(f('2026-11-01', 4, '2026-12-06'), imp, '2026-12-30'), null, '+59');
    assert.equal(faseDovuta(f('2026-11-01', 4, '2026-12-06'), imp, '2026-12-31'), 5, '+60: area legale');
    assert.equal(faseDovuta(f('2026-11-01', 5, '2026-12-31'), imp, '2027-03-01'), null);
  });

  test('bonifici: si conferma da sola solo la corrispondenza certa', () => {
    const fatture = [
      { id: 1, organization_id: 10, org_nome: 'Poliambulatorio Aurora S.r.l.', numero: 'FT 000123/2026', data: '2026-09-30', scadenza: '2026-10-31', residuo: 1220 },
      { id: 2, organization_id: 10, org_nome: 'Poliambulatorio Aurora S.r.l.', numero: '140/2026', data: '2026-10-31', scadenza: '2026-11-30', residuo: 800 },
      { id: 3, organization_id: 20, org_nome: 'Centro Medico Beta S.p.A.', numero: '0000200', data: '2026-10-31', scadenza: '2026-11-30', residuo: 1220 },
    ];
    const a = proponiAbbinamento({ importo: 1220, controparte: 'POLIAMBULATORIO AURORA SRL', causale: 'SALDO FATT. 123/2026' }, fatture);
    assert.equal(a.esito, 'AUTO'); assert.deepEqual(a.righe, [{ fattura_id: 1, importo: 1220 }]);
    // due fatture citate, importo uguale alla somma
    const b = proponiAbbinamento({ importo: 2020, controparte: 'Poliambulatorio Aurora', causale: 'Pagamento fatture 123 e 140 del 2026' }, fatture);
    assert.equal(b.esito, 'AUTO'); assert.equal(b.righe.length, 2);
    // stesso importo ma nessun numero in causale: solo proposta
    const c = proponiAbbinamento({ importo: 800, controparte: 'Poliambulatorio Aurora srl', causale: 'bonifico a vostro favore' }, fatture);
    assert.equal(c.esito, 'PROPOSTO'); assert.equal(c.righe[0].fattura_id, 2);
    // fattura citata ma importo diverso: pagamento parziale da confermare
    const d = proponiAbbinamento({ importo: 500, controparte: 'Poliambulatorio Aurora srl', causale: 'acconto fattura 140/2026' }, fatture);
    assert.equal(d.esito, 'PROPOSTO'); assert.deepEqual(d.righe, [{ fattura_id: 2, importo: 500 }]);
    // fattura citata e importo esatto, ma l'ordinante è un altro soggetto: non si conferma da sola
    const e = proponiAbbinamento({ importo: 1220, controparte: 'Rossi Mario', causale: 'fattura 0000200' }, fatture);
    assert.equal(e.esito, 'PROPOSTO'); assert.equal(e.organization_id, 20);
    // ordinante sconosciuto, nessuna fattura: niente
    assert.equal(proponiAbbinamento({ importo: 1220, controparte: 'Gamma Trasporti', causale: 'saldo' }, fatture).esito, 'NESSUNO');
    // IBAN già usato dal cliente: lo riconosce anche con un ordinante scritto diversamente
    const g = proponiAbbinamento({ importo: 800, controparte: 'P.A. AURORA', controparte_iban: 'IT00X', causale: 'saldo' }, fatture, { ibanNoti: new Map([['IT00X', 10]]) });
    assert.equal(g.esito, 'PROPOSTO'); assert.equal(g.organization_id, 10);
    // un numero dentro un altro numero non è una citazione; un progressivo corto vuole una parola chiave
    assert.equal(causaleCita('rif 91234', '123/2026', '2026'), false);
    assert.equal(causaleCita('saldo 140', '140/2026', '2026'), true);
    assert.equal(causaleCita('ordine 140 pezzi', '140/2026', '2026'), false);
    assert.ok(somiglianzaNome('POLIAMBULATORIO AURORA SRL', 'Poliambulatorio Aurora S.r.l.') === 1);
  });

  test('risposte dei clienti senza modello: prudenza', () => {
    const oggi = '2026-11-24';
    assert.equal(classificaRisposta({ oggetto: 'Risposta automatica: Sollecito', testo: 'Sono fuori ufficio fino al 30/11' }, oggi).classe, 'FUORI_UFFICIO');
    assert.equal(classificaRisposta({ testo: 'Buongiorno, il bonifico è stato effettuato ieri, allego contabile' }, oggi).classe, 'PAGATO');
    const p = classificaRisposta({ testo: 'Provvederemo al pagamento entro il 5 dicembre' }, oggi);
    assert.equal(p.classe, 'PROMESSA'); assert.equal(p.promessa_data, '2026-12-05');
    assert.equal(classificaRisposta({ testo: 'La fattura è errata, l\'importo è diverso da quanto concordato' }, oggi).classe, 'CONTESTAZIONE');
    // contestazione e pagamento insieme: vince la contestazione (è il caso che richiede una persona)
    assert.equal(classificaRisposta({ testo: 'Abbiamo già pagato ma contestiamo due esami non dovuti' }, oggi).classe, 'CONTESTAZIONE');
    assert.equal(classificaRisposta({ testo: 'Potete inviarci copia della fattura?' }, oggi).classe, 'RICHIESTA');
    assert.equal(classificaRisposta({ testo: 'Grazie, cordiali saluti' }, oggi).classe, 'ALTRO');
    assert.equal(dataNelTesto('pagheremo il 10/01', '2026-12-20'), '2027-01-10', 'data senza anno già passata: anno successivo');
    assert.equal(dataNelTesto('fattura del 10/10/2026', oggi), null, 'una data passata non è una promessa');
    assert.equal(piuLavorativi('2026-11-27', 5), '2026-12-04', 'cinque giorni lavorativi da venerdì');
    assert.equal(fasciaAging(0), 'NON_SCADUTO'); assert.equal(fasciaAging(31), 'G31_60'); assert.equal(fasciaAging(120), 'OLTRE_90');
  });

  test('testi del memo: segnaposto, tabella, riferimento nell\'oggetto; un testo incompleto si dichiara', () => {
    const righe = [{ numero: '123/2026', data: '2026-09-30', scadenza: '2026-10-31', residuo: 1220.5, giorni: 24 }, { numero: '140/2026', data: '2026-10-15', scadenza: '2026-11-10', residuo: 800, giorni: 14 }];
    const v = { referente: 'Dott.ssa Bianchi', iban: 'IT60X0542811101000000123456', 'codice cliente': 'C123', entro: '01/12/2026', firma: 'Amministrazione', telefono: '055 000000', email: 'amministrazione@toscanadiagnostica.it' };
    const s = componi(2, imp, v, righe, 'AB12CD34EF');
    assert.match(s.oggetto, /^Sollecito di pagamento – fattura n\. 123\/2026, 140\/2026 scaduta il 31\/10\/2026 \[TD-CRED-AB12CD34EF\]$/);
    assert.equal(s.totale, 2020.5); assert.deepEqual(s.mancanti, []);
    assert.ok(s.testo.includes('Gentile Dott.ssa Bianchi') && s.testo.includes('Totale: € 2.020,50') && s.testo.includes('IT60X0542811101000000123456'));
    assert.ok(s.html.includes('<table') && s.html.includes('1.220,50'));
    // senza IBAN e senza telefono il testo lo dichiara: la comunicazione non parte da sola
    const m = componi(2, imp, { ...v, iban: '', telefono: '' }, righe, 'X');
    assert.deepEqual(m.mancanti.sort(), ['iban', 'telefono']);
    // 2° sollecito: firma del RAF e giorni di ritardo in tabella
    const t = componi(3, imp, { ...v, 'data 1° sollecito': '10/11/2026', 'firma raf': 'Nome Cognome', 'ruolo raf': 'Responsabile Amministrazione e Finanza' }, righe, 'Y');
    assert.ok(t.testo.includes('24 giorni di ritardo') && t.testo.includes('D.Lgs. 231/2002') && t.testo.includes('Nome Cognome'));
    assert.deepEqual(t.mancanti, []);
    // avviso per una sola fattura: come nel memo, senza tabella
    const a = componi(1, imp, v, [righe[0]], 'Z');
    assert.ok(!a.html.includes('<table') && a.testo.includes('fattura n. 123/2026 del 30/09/2026, di importo pari a € 1.220,50.'));
    assert.equal(compila('Gentile [referente], [ignoto]', { referente: 'A' }), 'Gentile A, [ignoto]');
    assert.ok(MODELLI.modello_5_testo.includes('costituiamo formalmente in mora'));
  });

  test('lettura del partitario: numeri e date all\'italiana', () => {
    assert.equal(numeroIt('1.234,56'), 1234.56); assert.equal(numeroIt('€ 800,00'), 800); assert.equal(numeroIt(12.5), 12.5); assert.equal(numeroIt('1.220'), 1220); assert.equal(numeroIt('abc'), null);
    assert.equal(dataIt('31/10/2026'), '2026-10-31'); assert.equal(dataIt('2026-10-31'), '2026-10-31'); assert.equal(dataIt('1.10.26'), '2026-10-01'); assert.equal(dataIt('boh'), null);
  });
});

describe('Finance: quadratura delle uscite con le autorizzazioni al pagamento', () => {
  test('importo più IBAN, CRO o nome; il solo importo vale se il candidato è unico', async () => {
    const { abbinaUscite } = await import('../src/modules/finance/lib/quadratura.js');
    const uscite = [{ id: 1, data: '2026-11-10', importo: 430, controparte: 'Fornitore Reagenti', controparte_iban: 'IT22B', causale: 'ft 55' }, { id: 2, data: '2026-11-11', importo: 430, controparte: 'Altro', controparte_iban: 'IT99Z', causale: '' },
      { id: 3, data: '2026-11-12', importo: 1000, controparte: 'Studio Rossi', controparte_iban: null, causale: 'TRN 0123456789' }, { id: 4, data: '2026-11-20', importo: 77, controparte: 'Sconosciuto', controparte_iban: null, causale: '' }];
    const istanze = [{ id: 10, status: 'ESEGUITA', amount: 430, beneficiary_iban: 'IT22 B', beneficiary_name: 'X', executed_at: '2026-11-10' }, { id: 11, status: 'ESEGUITA', amount: 1000, beneficiary_iban: 'IT00', beneficiary_name: 'Y', executed_at: '2026-11-12', cro_trn: '0123456789' },
      { id: 12, status: 'FIRMATA', amount: 77, beneficiary_iban: 'IT01', beneficiary_name: 'Z', signed_at: '2026-11-18' }, { id: 13, status: 'ESEGUITA', amount: 430, beneficiary_iban: 'IT55', beneficiary_name: 'W', executed_at: '2026-11-30' }];
    const r = abbinaUscite(uscite, istanze);
    const di = (i) => r.find((c) => c.istanza === i);
    assert.equal(di(10).uscita, 1); assert.equal(di(10).per, 'importo e IBAN del beneficiario');
    assert.equal(di(11).uscita, 3); assert.equal(di(11).per, 'importo e CRO/TRN');
    assert.equal(di(12).uscita, 4); assert.equal(di(12).p, 40, 'solo importo, candidato unico: abbinamento debole');
    assert.equal(di(13), undefined, 'fuori dalla finestra di 5 giorni');
    assert.ok(!r.some((c) => c.uscita === 2));
  });
});
