// Dotazione di avvio delle sedi e visibilità a quattro tipologie (lib/dotazione.js): funzioni pure
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPOLOGIE, tipologiaDaSiteKind, colonnaVisibilita, clausolaVisibilita, statoDotazione, totaliDotazione, giorniAllApertura, daAttenzionare, contaBadge } from '../src/modules/orders/lib/dotazione.js';

test('tipologia dal tipo di sede: quattro tipologie, Legal entity = SERVICE, Direzione e Altro senza dotazione', () => {
  assert.deepEqual(TIPOLOGIE.map((t) => t.kind), ['PUNTO_PRELIEVI', 'POLIDIAGNOSTICO', 'LABORATORIO', 'SERVICE']);
  assert.equal(tipologiaDaSiteKind('PUNTO_PRELIEVI'), 'PUNTO_PRELIEVI');
  for (const k of ['CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO']) assert.equal(tipologiaDaSiteKind(k), 'POLIDIAGNOSTICO', k);
  assert.equal(tipologiaDaSiteKind('LABORATORIO'), 'LABORATORIO');
  assert.equal(tipologiaDaSiteKind('SERVICE'), 'SERVICE');
  assert.equal(tipologiaDaSiteKind(null, 'ORG'), 'SERVICE');
  assert.equal(tipologiaDaSiteKind('HEADQUARTER'), null);
  assert.equal(tipologiaDaSiteKind('ALTRO'), null);
});

test('colonna di visibilità dalla struttura: quattro colonne, ripiego sul ruolo nel flusso', () => {
  assert.equal(colonnaVisibilita({ site_kind: 'PUNTO_PRELIEVI', origin: 'SITE', kind: 'SEDE' }), 'visible_sedi');
  assert.equal(colonnaVisibilita({ site_kind: 'CENTRO_MEDICO', origin: 'SITE', kind: 'SEDE' }), 'visible_poli');
  assert.equal(colonnaVisibilita({ site_kind: 'LABORATORIO', origin: 'SITE', kind: 'LAB' }), 'visible_lab');
  assert.equal(colonnaVisibilita({ site_kind: null, origin: 'ORG', kind: 'CLIENTE' }), 'visible_service');
  assert.equal(colonnaVisibilita({ site_kind: 'HEADQUARTER', origin: 'SITE', kind: 'SEDE' }), 'visible_sedi');
  assert.equal(colonnaVisibilita({ site_kind: 'ALTRO', origin: 'SITE', kind: 'LAB' }), 'visible_lab');
  assert.equal(colonnaVisibilita({}), 'visible_sedi');
  assert.equal(clausolaVisibilita({ site_kind: 'POLIAMBULATORIO', origin: 'SITE' }, 'x'), '(x.visible_all OR x.visible_poli)');
});

test('stato della dotazione', () => {
  assert.equal(statoDotazione(null), 'NON_PIANIFICATA');
  assert.equal(statoDotazione({ status: 'NON_PIANIFICATA' }), 'NON_PIANIFICATA');
  assert.equal(statoDotazione({ status: 'PIANIFICATA' }), 'PIANIFICATA');
  assert.equal(statoDotazione({ status: 'CONSEGNATA' }), 'CONSEGNATA');
  assert.equal(statoDotazione({ status: 'PIANIFICATA', delivered_at: '2026-11-20T11:00:00Z' }), 'CONSEGNATA');
});

test('totali: articoli con quantità, confezioni pianificate e consegnate', () => {
  assert.deepEqual(totaliDotazione([]), { articoli: 0, pianificate: 0, consegnate: 0 });
  assert.deepEqual(totaliDotazione([{ packs_planned: 4 }, { packs_planned: 0 }, { packs_planned: 2, packs_delivered: 3 }, { packs: 5 }]), { articoli: 3, pianificate: 11, consegnate: 3 });
  assert.deepEqual(totaliDotazione([{ packs_planned: '2', packs_delivered: null }]), { articoli: 1, pianificate: 2, consegnate: 0 });
});

test('badge: apertura entro 60 giorni o già aperta, senza Giacenza 0', () => {
  const oggi = '2026-10-31';
  assert.equal(giorniAllApertura('2026-11-20', oggi), 20);
  assert.equal(giorniAllApertura('2026-10-01', oggi), -30);
  assert.equal(giorniAllApertura(null, oggi), null);
  const sedi = [
    { name: 'Quarrata', opened_at: '2026-11-20' },                                         // entro 60 giorni, non pianificata
    { name: 'Prato', opened_at: '2025-03-01', status: 'PIANIFICATA' },                       // già aperta, pianificata
    { name: 'Sesto', opened_at: '2026-12-30' },                                              // esattamente 60 giorni
    { name: 'Empoli', opened_at: '2027-01-15' },                                             // oltre 60 giorni
    { name: 'Calenzano', opened_at: '2026-10-01', status: 'CONSEGNATA' },                    // Giacenza 0 registrata
    { name: 'Senza data', opened_at: null },
  ];
  assert.deepEqual(sedi.filter((s) => daAttenzionare(s, oggi)).map((s) => s.name), ['Quarrata', 'Prato', 'Sesto']);
  assert.equal(contaBadge(sedi, oggi), 3);
  assert.equal(contaBadge(sedi, oggi, 20), 2);
});
