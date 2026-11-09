// TuoTempo Fase 1 e richieste del CEO del 09/11/2026: regole pure dell'abbinamento aree ↔ sedi e risorse ↔ persone, prima disponibilità,
// linea della scheda dall'anagrafica, tipo del punto per il processo avviato con un partner. Nessun database: funzioni pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTesto, normCap, normTel, parseTs, giorniAttesa, mediana, proponiSede, proponiPersona, paroleNome, telefonoArea, TT_FIELDS, ttUserAgent } from '../src/modules/retail/lib/tuotempo.js';
import { lineaDaCodice } from '../src/modules/business/lib/schedeAnagrafica.js';
import { tipoPunto, SEDI_PUNTO } from '../src/modules/business/lib/processo.js';
import { orariDaTesto, hoursText } from '../src/lib/sites.js';
import { APP_VERSION } from '../src/version.js';

test('normalizzazione di indirizzi, CAP e telefoni (stessa regola della funzione SQL tt_norm)', () => {
  assert.equal(normTesto('V.le dei Mille, 12'), normTesto('Viale dei Mille 12'));
  assert.equal(normTesto('P.zza Garibaldi 3'), normTesto('Piazza Garibaldi, 3'));
  assert.equal(normTesto('Via Città di Castello'), 'viacittadicastello');
  assert.equal(normTesto(''), null);
  assert.equal(normCap(' 57121 '), '57121');
  assert.equal(normTel('+39 0586 123456'), '0586123456');
  assert.equal(normTel('0586/123456'), '0586123456');
  assert.equal(telefonoArea({ landline: '', mobile: '333 1234567' }), '333 1234567');
});

test('prima disponibilità: timestamp Unix o data, giorni di attesa e mediana', () => {
  const ora = new Date('2026-11-09T22:00:00Z');
  assert.equal(parseTs('1794304800').toISOString(), new Date(1794304800 * 1000).toISOString());
  assert.equal(parseTs(null), null);
  assert.equal(giorniAttesa(String(Math.floor(ora.getTime() / 1000) + 3 * 86400), ora), 3);
  assert.equal(giorniAttesa('2026-11-11 10:00:00', new Date('2026-11-10T10:00:00')), 1);
  assert.equal(giorniAttesa(String(Math.floor(ora.getTime() / 1000) - 3600), ora), 0);   // slot già passato: zero, mai negativo
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), null);
});

test('proposta della sede per un\'area: salvato, legacyid, indirizzo + CAP, nome simile', () => {
  const sedi = [
    { id: 1, code: 'PP-FI1', address: 'Via Roma 1', zip: '50100', area_fonte: 'A1' },
    { id: 2, code: 'PP-PO', address: 'Viale Vittorio Veneto 10', zip: '59100' },
    { id: 3, code: 'CM-SE', address: 'Via Gramsci 5', zip: '50019' },
    { id: 4, code: 'PP-PT', address: 'Via Fiume 2', zip: '51100', area_specchio: 'A9' },
  ];
  const occupate = new Set([1]);
  assert.deepEqual(proponiSede({ areaid: 'A1' }, sedi, { occupate }), { site_id: 1, metodo: 'SALVATO' });
  assert.deepEqual(proponiSede({ areaid: 'A9' }, sedi, { occupate }), { site_id: 4, metodo: 'SALVATO' });   // solo nello specchio: proposta
  assert.deepEqual(proponiSede({ areaid: 'A2', legacyid: 'pp-po' }, sedi, { occupate }), { site_id: 2, metodo: 'LEGACYID' });
  assert.deepEqual(proponiSede({ areaid: 'A3', indirizzo: 'V. Gramsci, 5', cap: '50019' }, sedi, { occupate }), { site_id: 3, metodo: 'INDIRIZZO' });
  assert.equal(proponiSede({ areaid: 'A3', indirizzo: 'V. Gramsci, 5', cap: '50100' }, sedi, { occupate }), null);   // CAP diverso
  assert.deepEqual(proponiSede({ areaid: 'A5' }, sedi, { occupate, simili: [{ site_id: 3, sim: 0.62 }, { site_id: 2, sim: 0.4 }] }), { site_id: 3, metodo: 'NOME', punteggio: 0.62 });
  assert.equal(proponiSede({ areaid: 'A6', legacyid: 'PP-FI1' }, sedi, { occupate }), null);   // sede già abbinata ad altra area
  assert.equal(proponiSede({ areaid: 'A7' }, sedi, { occupate, simili: [{ site_id: 2, sim: 0.3 }] }), null);
});

test('proposta della persona per una risorsa: email, poi nome senza titoli; macchine escluse', () => {
  const persone = [{ id: 10, first_name: 'Maria', last_name: 'Rossi', email: 'm.rossi@toscanadiagnostica.it' }, { id: 11, first_name: 'Luca', last_name: 'Bianchi', email: null },
    { id: 12, first_name: 'Anna', last_name: 'Verdi', email: 'a@x.it' }, { id: 13, first_name: 'Anna', last_name: 'Verdi', email: 'b@x.it' }];
  assert.deepEqual(proponiPersona({ email: 'M.Rossi@ToscanaDiagnostica.it', name: 'Altro' }, persone), { person_id: 10, come: 'EMAIL' });
  assert.deepEqual(proponiPersona({ email: null, name: 'Dott. Luca Bianchi' }, persone), { person_id: 11, come: 'NOME' });
  assert.equal(proponiPersona({ name: 'Dr.ssa Anna Verdi' }, persone), null);   // due omonime: nessuna proposta
  assert.equal(proponiPersona({ name: 'Ecografo 1', is_machine: '1' }, persone), null);
  assert.equal(paroleNome('Prof. Mario Rossi'), paroleNome('ROSSI MARIO'));
});

test('chiamate a TuoTempo: fields per ogni risorsa e User-Agent TD-Suite/<versione>', () => {
  for (const k of ['activities', 'areas', 'resources', 'insurances', 'activities_id', 'resources_id']) assert.ok(TT_FIELDS[k] && TT_FIELDS[k].length > 5, k);
  for (const f of ['duration', 'price', 'price_rules', 'preparation', 'isHidden', 'first_availability', 'first_availability_areaTitle', 'legacyid']) assert.ok(TT_FIELDS.activities.split(',').includes(f), f);
  for (const f of ['resourceid', 'name', 'email', 'rphone', 'status', 'isHidden', 'is_machine', 'satisfaction', 'areas']) assert.ok(TT_FIELDS.resources.split(',').includes(f), f);
  assert.equal(ttUserAgent(), `TD-Suite/${APP_VERSION}`);
});

test('orari di TuoTempo nel formato della Suite (interpretabili o no)', () => {
  const o = orariDaTesto('Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00');
  assert.equal(hoursText(o), 'Lun-Ven 7:30-12:30, 15:00-18:00; Sab 7:30-11:00');
  assert.equal(orariDaTesto('dal lunedì al venerdì mattina'), null);
});

test('scheda dall\'anagrafica: linea dedotta dal codice della Legal entity', () => {
  assert.equal(lineaDaCodice('SER0033'), 'SRV');
  assert.equal(lineaDaCodice('mdl0012'), 'MDL');
  assert.equal(lineaDaCodice('PP0004'), 'PP');
  assert.equal(lineaDaCodice('CLI-77'), 'SRV');
  assert.equal(lineaDaCodice(null), 'SRV');
});

test('punti e centri: processo avviato con un partner su una sede non ancora ospitata = corner previsto', () => {
  assert.deepEqual(SEDI_PUNTO, ['PUNTO_PRELIEVI', 'CENTRO_MEDICO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO']);
  const sedeLoc = { kind: 'CENTRO_MEDICO', tenure: 'LOCAZIONE', host_organization_id: null, organization_id: 1 };
  assert.equal(tipoPunto({ sede: sedeLoc }).tipo, 'FLAGSHIP');
  assert.equal(tipoPunto({ sede: sedeLoc, previsto: 'CORNER' }).tipo, 'FLAGSHIP', 'senza account del partner vale la sede');
  assert.equal(tipoPunto({ sede: sedeLoc, previsto: 'CORNER', orgAccount: 1 }).tipo, 'FLAGSHIP', 'account sulla Legal entity della sede: vale la sede');
  const t = tipoPunto({ sede: sedeLoc, previsto: 'CORNER', orgAccount: 9 });
  assert.equal(t.tipo, 'CORNER'); assert.equal(t.fonte, 'previsto');
  assert.equal(tipoPunto({ sede: { kind: 'PUNTO_PRELIEVI', tenure: 'OSPITATA', host_organization_id: 5 } }).tipo, 'CORNER');
  assert.equal(tipoPunto({ sede: { kind: 'POLIAMBULATORIO', tenure: 'PROPRIETA' } }).avvisi.length, 0);
});
