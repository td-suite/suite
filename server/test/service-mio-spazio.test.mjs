// Test di "Il mio spazio" del Portale Service (01/11/2026): funzioni pure.
// - riconoscimento del Cliente service (lib/esterni.js) contro Partner ospitante, CLIENTE senza service, interni;
// - composizione dei riquadri KPI e dei conteggi per stato;
// - mapping delle fasi degli ordini a "in corso".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riconosciClienteService, isExternal, PROFILO_CLIENTE, PROFILO_PARTNER } from '../src/lib/esterni.js';
import { faseOrdine, statiOrdiniInCorso, conteggiPer, componiKpi, FASI_ORDINE } from '../src/modules/service/lib/mioSpazioRegole.js';

const DOM = ['toscanadiagnostica.it'];

test('riconosciClienteService: esterno + Legal entity CLIENTE + profilo Cliente service + almeno una sede SERVICE', () => {
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: [PROFILO_CLIENTE], sediService: 2 }), true);
  // anche un CLIENTE che ospita punti prelievo (con entrambi i profili) resta un cliente service
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: [PROFILO_PARTNER, PROFILO_CLIENTE], sediService: 1 }), true);
});

test('riconosciClienteService: Partner ospitante mai (anche con Legal entity CLIENTE o profilo sbagliato)', () => {
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'PARTNER', profiliSistema: [PROFILO_PARTNER], sediService: 0 }), false);
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'PARTNER', profiliSistema: [PROFILO_CLIENTE], sediService: 3 }), false);
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: [PROFILO_PARTNER], sediService: 3 }), false);
});

test('riconosciClienteService: CLIENTE senza service (nessuna sede SERVICE, o nessun profilo Cliente service) escluso', () => {
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: [PROFILO_CLIENTE], sediService: 0 }), false);
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE', profiliSistema: [], sediService: 2 }), false);
  assert.equal(riconosciClienteService({ esterno: true, orgKind: 'CLIENTE' }), false);
});

test('riconosciClienteService: interni e tipi diversi da CLIENTE esclusi', () => {
  assert.equal(riconosciClienteService({ esterno: false, orgKind: 'CLIENTE', profiliSistema: [PROFILO_CLIENTE], sediService: 2 }), false);
  for (const k of ['GRUPPO', 'SOCIETA', 'FORNITORE', 'ALTRO', null]) assert.equal(riconosciClienteService({ esterno: true, orgKind: k, profiliSistema: [PROFILO_CLIENTE], sediService: 2 }), false);
  // l'esterno lo decide isExternal: un amministratore o un dominio aziendale non lo sono mai
  assert.equal(isExternal({ level: 'ADMIN', email: 'x@cliente.it', organization_kind: 'CLIENTE', internal_domains: DOM }), false);
  assert.equal(isExternal({ level: 'USER', email: 'x@toscanadiagnostica.it', organization_kind: 'CLIENTE', internal_domains: DOM }), false);
});

test('faseOrdine: fasi 1-5 in corso, chiuso e annullato conclusi; per un CLIENTE la consegna conclude il processo', () => {
  assert.deepEqual(faseOrdine('BOZZA', 'CLIENTE'), { n: 1, label: FASI_ORDINE.BOZZA.label, in_corso: true });
  assert.equal(faseOrdine('INVIATO', 'CLIENTE').n, 2);
  assert.equal(faseOrdine('APPROVATO', 'CLIENTE').n, 3);
  assert.equal(faseOrdine('PRESO_IN_CARICO', 'CLIENTE').in_corso, true);
  assert.equal(faseOrdine('SPEDITO', 'CLIENTE').n, 4);
  assert.equal(faseOrdine('CONSEGNATO', 'CLIENTE').in_corso, false);
  assert.equal(faseOrdine('CONSEGNATO', 'SEDE').in_corso, true);   // struttura TD: manca il carico interno (fase 5)
  assert.equal(faseOrdine('IMMAGAZZINATO', 'SEDE').n, 5);
  assert.equal(faseOrdine('CHIUSO', 'CLIENTE').in_corso, false);
  assert.equal(faseOrdine('ANNULLATO', 'SEDE').in_corso, false);
  assert.equal(faseOrdine('STATO_IGNOTO', 'CLIENTE').in_corso, false);   // uno stato sconosciuto non si mostra come in corso
});

test('statiOrdiniInCorso: elenco per il filtro SQL', () => {
  assert.deepEqual(statiOrdiniInCorso('CLIENTE'), ['BOZZA', 'INVIATO', 'APPROVATO', 'PRESO_IN_CARICO', 'SPEDITO', 'IMMAGAZZINATO']);
  assert.ok(statiOrdiniInCorso('SEDE').includes('CONSEGNATO'));
  for (const k of ['CLIENTE', 'SEDE', 'LAB']) { assert.ok(!statiOrdiniInCorso(k).includes('CHIUSO')); assert.ok(!statiOrdiniInCorso(k).includes('ANNULLATO')); }
});

test('conteggiPer e componiKpi: conteggi dalle sezioni, null (non 0) per le sezioni non disponibili', () => {
  assert.deepEqual(conteggiPer([{ stato: 'INVIATA_SEDE' }, { stato: 'INVIATA_SEDE' }, { stato: 'RISPOSTA_SEDE' }], 'stato'), { INVIATA_SEDE: 2, RISPOSTA_SEDE: 1 });
  assert.deepEqual(conteggiPer([], 'stato'), {});
  assert.deepEqual(conteggiPer(null, 'stato'), {});
  const kpi = componiKpi({
    nc: { disponibile: true, totale: 3 }, ordini: { disponibile: true, totale: 0 },
    circolari: { disponibile: true, totale: 7, da_leggere: 4 }, ticket: { disponibile: false, motivo: 'Modulo non ancora avviato nella Suite' },
  });
  assert.deepEqual(kpi, { nc_aperte: 3, ordini_in_corso: 0, circolari_da_leggere: 4, ticket_aperti: null });
  assert.deepEqual(componiKpi({}), { nc_aperte: null, ordini_in_corso: null, circolari_da_leggere: null, ticket_aperti: null });
});
