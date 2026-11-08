// Piano Ferie: test delle funzioni pure (calendario, saldi, area dall'organigramma, copertura minima).
// Esecuzione: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pasqua, festiviNazionali, festiviPer, settimanaDaContratto, contaGiorni, quotaInData, isoWeekday } from '../src/modules/ferie/lib/calendario.js';
import { mesiLavorati, spettanza, saldo, avvisiSaldo } from '../src/modules/ferie/lib/saldi.js';
import { areaPersona } from '../src/modules/ferie/lib/perimetro.js';
import { regoleDelGruppo, scoperture, valutaRichiesta } from '../src/modules/ferie/lib/copertura.js';

test('Pasqua e Lunedì dell\'Angelo (date note)', () => {
  assert.equal(pasqua(2024), '2024-03-31');
  assert.equal(pasqua(2025), '2025-04-20');
  assert.equal(pasqua(2026), '2026-04-05');
  assert.equal(pasqua(2027), '2027-03-28');
  assert.ok(festiviNazionali(2026).some((f) => f.data === '2026-04-06' && /Angelo/.test(f.nome)));
});

test('festivi nazionali: 11 fino al 2025, 12 dal 2026 con il 4 ottobre (disattivabile)', () => {
  assert.equal(festiviNazionali(2025).length, 11);
  assert.equal(festiviNazionali(2026).length, 12);
  assert.ok(festiviNazionali(2026).some((f) => f.data === '2026-10-04'));
  assert.equal(festiviNazionali(2026, { quattroOttobre: false }).length, 11);
  const f = festiviPer([2026], { patrono: { giorno: '06-24', santo: 'San Giovanni' }, aggiunti: [{ data: '2026-12-24', nome: 'Vigilia' }], esclusi: ['2026-10-04'] });
  assert.ok(f.has('2026-06-24') && f.has('2026-12-24') && !f.has('2026-10-04'));
});

test('settimana lavorativa dal contratto', () => {
  assert.deepEqual(settimanaDaContratto(null).giorni, [1, 2, 3, 4, 5]);
  assert.deepEqual(settimanaDaContratto({ weekly_days: 6 }).giorni, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(settimanaDaContratto({ weekly_days: 5, days_label: 'dal lunedì al sabato mattina' }).giorni, [1, 2, 3, 4, 5, 6]);
  assert.equal(settimanaDaContratto({ weekly_days: 5, days_label: 'dal lunedì al venerdì' }).fonte, 'contratto');
});

test('conteggio dei giorni lavorativi con festivi e mezze giornate', () => {
  const festivi = festiviPer([2026]);
  const cal = { settimana: [1, 2, 3, 4, 5], festivi };
  assert.equal(contaGiorni({ inizio: '2026-12-07', fine: '2026-12-11' }, cal).giorni, 4, 'Immacolata martedì 8/12 non conta');
  assert.equal(contaGiorni({ inizio: '2026-12-01', fine: '2026-12-02', mezza_inizio: true }, cal).giorni, 1.5);
  assert.equal(contaGiorni({ inizio: '2026-12-21', fine: '2026-12-24', mezza_fine: true }, cal).giorni, 3.5);
  assert.equal(contaGiorni({ inizio: '2026-11-23', fine: '2026-11-23', mezza_fine: true }, cal).giorni, 0.5);
  assert.ok(contaGiorni({ inizio: '2026-11-23', fine: '2026-11-23', mezza_inizio: true, mezza_fine: true }, cal).errore);
  assert.ok(contaGiorni({ inizio: '2026-11-25', fine: '2026-11-23' }, cal).errore);
  assert.equal(contaGiorni({ inizio: '2026-11-21', fine: '2026-11-22' }, cal).giorni, 0, 'sabato e domenica');
  assert.equal(contaGiorni({ inizio: '2026-11-21', fine: '2026-11-22' }, { settimana: [1, 2, 3, 4, 5, 6], festivi }).giorni, 1, 'settimana di sei giorni: il sabato conta');
  assert.equal(isoWeekday('2026-11-08'), 7);
  assert.equal(quotaInData({ data_inizio: '2026-12-01', data_fine: '2026-12-02', mezza_inizio: true }, '2026-12-01'), 0.5);
});

test('maturazione pro rata: mesi con almeno 15 giorni di rapporto', () => {
  assert.equal(mesiLavorati(2026, {}).length, 12);
  assert.equal(mesiLavorati(2026, { inizio: '2026-03-20' }).length, 9, 'marzo con 12 giorni non conta');
  assert.equal(mesiLavorati(2026, { inizio: '2026-03-10' }).length, 10, 'marzo con 22 giorni conta');
  assert.equal(mesiLavorati(2026, { fine: '2026-06-14' }).length, 5, 'cessazione il 14 giugno: giugno non conta');
  const s = spettanza(2026, 26, { inizio: '2026-03-20', oggi: '2026-11-08' });
  assert.equal(s.spettanza, 19.5);
  assert.equal(s.mesi_maturati, 7, 'marzo escluso, aprile-ottobre conclusi');
  assert.equal(spettanza(2025, 26, { oggi: '2026-11-08' }).maturato, 26, 'anno passato: tutto maturato');
});

test('saldo: residuo, disponibile, anno precedente consumato per primo, avvisi', () => {
  const s = saldo({ residuo_ap: 4, spettanza: 26, maturato: 21.67, goduto: 3, pianificato: 5, in_attesa: 2 });
  assert.equal(s.residuo, 22);
  assert.equal(s.disponibile, 20);
  assert.equal(s.ap_non_goduto, 1);
  assert.equal(s.ap_da_pianificare, 0);
  const a = avvisiSaldo(s, { anno: 2026, oggi: '2026-11-08' });
  assert.ok(a.some((x) => x.tipo === 'AP_SCADENZA' && x.grave), 'dopo il 30 giugno: anno precedente scaduto');
  assert.ok(a.some((x) => x.tipo === 'RISCHIO'), 'novembre con 20 giorni non pianificati');
  assert.ok(!avvisiSaldo(s, { anno: 2026, oggi: '2026-05-08' }).some((x) => x.grave), 'prima della scadenza: solo promemoria');
  assert.ok(avvisiSaldo(saldo({ spettanza: 2, goduto: 5 }), { anno: 2026, oggi: '2026-03-01' }).some((x) => x.tipo === 'NEGATIVO'));
});

test('area dall\'organigramma: Direzione, Laboratorio, Sedi, Da assegnare, forzatura', () => {
  const root = { id: 1, parent_id: null, kind: 'DIREZIONE', branch: 'LINEA', name: 'Toscana Diagnostica' };
  const fin = { id: 2, parent_id: 1, kind: 'FUNZIONE', branch: 'STAFF', name: 'Finance' };
  const lab = { id: 3, parent_id: 1, kind: 'AREA', branch: 'LINEA', name: 'Laboratorio di Analisi' };
  const net = { id: 4, parent_id: 1, kind: 'AREA', branch: 'LINEA', name: 'Network Punti Prelievo' };
  const ppNode = { id: 5, parent_id: 4, kind: 'SEDE', branch: 'LINEA', name: 'Calenzano', site_id: 50 };
  const coreLab = { id: 6, parent_id: 3, kind: 'REPARTO', branch: 'LINEA', name: 'Core Lab' };
  const PP = { id: 50, kind: 'PUNTO_PRELIEVI' }, LAB = { id: 60, kind: 'LABORATORIO' }, HQ = { id: 70, kind: 'HEADQUARTER' };
  assert.equal(areaPersona({ chain: [fin, root] }).gruppo, 'DIR');
  assert.equal(areaPersona({ chain: [root] }).gruppo, 'DIR');
  assert.equal(areaPersona({ chain: [coreLab, lab, root] }).gruppo, 'LAB', 'area che si chiama Laboratorio');
  assert.equal(areaPersona({ chain: [coreLab, lab, root], site: LAB }).gruppo, 'LAB');
  assert.equal(areaPersona({ chain: [ppNode, net, root], site: PP }).gruppo, 'SEDE:50');
  assert.equal(areaPersona({ chain: [net, root], site: HQ }).gruppo, 'DIR', 'sede direzionale');
  assert.equal(areaPersona({ chain: [], personSite: PP }).gruppo, 'SEDE:50');
  assert.equal(areaPersona({ chain: [], personSite: { id: 9, kind: 'SERVICE' } }).gruppo, 'DA_ASSEGNARE', 'mai un punto cliente service');
  assert.equal(areaPersona({ chain: [net, root] }).gruppo, 'DA_ASSEGNARE');
  assert.equal(areaPersona({ chain: [fin, root], forzata: 'SEDE:50' }).gruppo, 'SEDE:50');
});

test('copertura minima: regole del gruppo e giorni sotto il minimo', () => {
  const regole = [{ id: 1, ambito: 'KIND:PUNTO_PRELIEVI', role_id: 10, minimo: 1 }, { id: 2, ambito: 'LAB', role_id: null, minimo: 2 }];
  assert.deepEqual(regoleDelGruppo(regole, 'SEDE:50', 'PUNTO_PRELIEVI').map((r) => r.id), [1]);
  assert.deepEqual(regoleDelGruppo(regole, 'LAB').map((r) => r.id), [2]);
  const membri = [{ id: 1, ruoli: [10] }, { id: 2, ruoli: [10] }, { id: 3, ruoli: [11] }];
  const assenze = [{ id: 7, person_id: 2, data_inizio: '2026-11-24', data_fine: '2026-11-25' }];
  assert.equal(scoperture({ date: ['2026-11-24'], regole: [regole[0]], membri, assenze }).length, 0);
  const val = valutaRichiesta({ richiesta: { id: null, data_inizio: '2026-11-23', data_fine: '2026-11-27' }, persona: { id: 1, ruoli: [10] },
    giorni: ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'], regole: [regole[0]], membri, assenze, festivi: new Map() });
  assert.deepEqual(val.map((x) => x.data), ['2026-11-24', '2026-11-25']);
  assert.equal(val[0].presenti, 0);
  // mezza giornata = mezza presenza
  const mezza = scoperture({ date: ['2026-11-24'], regole: [{ id: 3, ambito: 'LAB', role_id: null, minimo: 3 }], membri, assenze: [{ person_id: 3, data_inizio: '2026-11-24', data_fine: '2026-11-24', mezza_fine: true }] });
  assert.equal(mezza[0].presenti, 2.5);
  assert.equal(valutaRichiesta({ richiesta: {}, persona: { id: 3, ruoli: [11] }, giorni: ['2026-11-24'], regole: [regole[0]], membri, assenze }).length, 0, 'regola di un altro ruolo');
});

// ------------------------------------------------------------------ piano annuale (funzionamento stabilito dal CEO, 08/11/2026)
import { azioniPiano, statoPeriodo, statoDopoModifica, statoDaRichieste, contaPerStato } from '../src/modules/ferie/lib/pianoAnnuale.js';
import { gruppoDiSede } from '../src/modules/ferie/lib/core.js';

test('piano annuale: chi può fare cosa in ogni stato', () => {
  const dip = (s) => azioniPiano(s, { proprio: true });
  const resp = (s) => azioniPiano(s, { gestisce: true });
  const collega = (s) => azioniPiano(s, {});
  // il dipendente compila e invia finché è BOZZA, modifica finché è PROPOSTO non preso in carico, poi solo variazioni
  assert.ok(dip('BOZZA').modifica && dip('BOZZA').invia);
  assert.ok(dip('PROPOSTO').modifica && !dip('PROPOSTO').invia);
  assert.ok(!dip('IN_REVISIONE').modifica && !dip('IN_REVISIONE').variazione);
  for (const s of ['APPROVATO', 'DEFINITIVO']) { assert.ok(!dip(s).modifica && dip(s).variazione, s); assert.ok(!dip(s).approva && !dip(s).definitivo); }
  // il responsabile: modifica fino ad APPROVATO, nel DEFINITIVO solo con motivo; approva, rende definitivo, riapre
  for (const s of ['BOZZA', 'PROPOSTO', 'IN_REVISIONE']) assert.ok(resp(s).modifica && resp(s).approva && !resp(s).definitivo, s);
  assert.ok(resp('PROPOSTO').prendi_in_carico && !resp('BOZZA').prendi_in_carico);
  assert.ok(resp('APPROVATO').modifica && resp('APPROVATO').definitivo && !resp('APPROVATO').approva);
  assert.ok(!resp('DEFINITIVO').modifica && resp('DEFINITIVO').modifica_con_motivo && resp('DEFINITIVO').riapri);
  assert.ok(!resp('APPROVATO').variazione, 'il responsabile modifica direttamente, non propone variazioni');
  // un collega dell'area non ha nessuna azione
  for (const s of ['BOZZA', 'PROPOSTO', 'APPROVATO', 'DEFINITIVO']) assert.ok(!Object.values(collega(s)).some(Boolean), s);
});

test('piano annuale: stato dei periodi e del piano dopo le modifiche', () => {
  assert.equal(statoPeriodo('BOZZA', '2026-12-31', '2026-11-08'), 'PIANIFICATA');
  assert.equal(statoPeriodo('IN_REVISIONE', '2026-01-10', '2026-11-08'), 'PIANIFICATA', 'nei piani aperti resta da approvare anche se passato');
  assert.equal(statoPeriodo('APPROVATO', '2026-12-31', '2026-11-08'), 'APPROVATA');
  assert.equal(statoPeriodo('DEFINITIVO', '2026-11-02', '2026-11-08'), 'GODUTA');
  assert.equal(statoDopoModifica('PROPOSTO', { daResponsabile: true }), 'IN_REVISIONE', 'il responsabile che modifica prende in carico');
  assert.equal(statoDopoModifica('BOZZA', { daResponsabile: true }), 'IN_REVISIONE');
  assert.equal(statoDopoModifica('PROPOSTO', { daResponsabile: false }), 'PROPOSTO');
  assert.equal(statoDopoModifica('DEFINITIVO', { daResponsabile: true }), 'DEFINITIVO', 'nel definitivo la modifica è una variazione');
});

test('migrazione 002: stato iniziale del piano dalle richieste esistenti', () => {
  assert.equal(statoDaRichieste([]), 'BOZZA', 'senza richieste il piano nasce in bozza');
  assert.equal(statoDaRichieste([{ stato: 'APPROVATA' }, { stato: 'GODUTA' }]), 'APPROVATO');
  assert.equal(statoDaRichieste([{ stato: 'APPROVATA' }, { stato: 'PIANIFICATA' }]), 'BOZZA', 'una richiesta in attesa (ora periodo proposto) tiene il piano in bozza');
  assert.equal(statoDaRichieste([{ stato: 'APPROVATA' }, { stato: 'RIFIUTATA' }, { stato: 'ANNULLATA' }]), 'APPROVATO', 'rifiutate e annullate non contano');
  assert.equal(statoDaRichieste([{ stato: 'APPROVATA' }, { stato: 'RICHIESTA', tipo: 'ROL' }]), 'APPROVATO', 'i permessi ROL restano richieste singole');
  assert.deepEqual(contaPerStato([{ stato: 'BOZZA' }, { stato: 'BOZZA' }, { stato: 'DEFINITIVO' }, null]), { BOZZA: 2, PROPOSTO: 0, IN_REVISIONE: 0, APPROVATO: 0, DEFINITIVO: 1 });
});

test('saldo del piano: giorni da pianificare e pianificati totali', () => {
  const s = saldo({ residuo_ap: 2, spettanza: 26, goduto: 5, pianificato: 10, in_attesa: 1 });
  assert.equal(s.pianificato_totale, 15);
  assert.equal(s.residuo, 13, 'spettanza + anno precedente − goduto − pianificato futuro');
  assert.equal(s.da_pianificare, 12, 'meno le variazioni in attesa');
});

test('ambito del grant RESPONSABILE: area della sede', () => {
  assert.equal(gruppoDiSede({ id: 4, kind: 'LABORATORIO' }), 'LAB');
  assert.equal(gruppoDiSede({ id: 5, kind: 'HEADQUARTER' }), 'DIR');
  assert.equal(gruppoDiSede({ id: 7, kind: 'PUNTO_PRELIEVI' }), 'SEDE:7');
  assert.equal(gruppoDiSede({ id: 9, kind: 'SERVICE' }), null);
});
