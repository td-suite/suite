// Test degli accessi esterni (lib/esterni.js): funzioni pure. Chi è esterno, profilo proposto dal tipo di Legal entity e dalle sedi,
// risoluzione degli ambiti dei grant dall'organizzazione (Cash → sedi ospitate, NC → Legal entity, altri → sedi dell'organizzazione),
// filtro della scheda persona in Rubrica (solo nome, ruolo, email e telefono ufficio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExternal, proposeProfileKey, resolveExternalScopes, filterRubricaRow, RUBRICA_EXTERNAL_FIELDS, PROFILO_PARTNER, PROFILO_CLIENTE } from '../src/lib/esterni.js';

const DOM = ['toscanadiagnostica.it'];

test('isExternal: Owner e Admin mai esterni; GRUPPO/SOCIETA e dominio aziendale interni; partner e clienti esterni', () => {
  assert.equal(isExternal({ level: 'OWNER', email: 'x@farmaciarossi.it', organization_kind: 'PARTNER', internal_domains: DOM }), false);
  assert.equal(isExternal({ level: 'ADMIN', email: 'x@farmaciarossi.it', organization_kind: null, internal_domains: DOM }), false);
  assert.equal(isExternal({ level: 'USER', email: 'anna@toscanadiagnostica.it', organization_kind: null, internal_domains: DOM }), false);
  assert.equal(isExternal({ level: 'USER', email: 'anna@gmail.com', organization_kind: 'SOCIETA', internal_domains: DOM }), false);
  assert.equal(isExternal({ level: 'USER', email: 'mario.rossi@farmaciarossi.it', organization_kind: 'PARTNER', internal_domains: DOM }), true);
  assert.equal(isExternal({ level: 'USER', email: 'lab@bianchi.it', organization_kind: 'CLIENTE', internal_domains: DOM }), true);
  assert.equal(isExternal({ level: 'USER', email: 'x@altro.it', organization_kind: null, internal_domains: DOM }), true);
  assert.equal(isExternal(null), false);
});

test('proposeProfileKey: sedi ospitate → Partner ospitante anche per un CLIENTE; sedi SERVICE → Cliente service; per tipo senza sedi', () => {
  assert.equal(proposeProfileKey({ kind: 'PARTNER', hostedSites: 1 }), PROFILO_PARTNER);
  assert.equal(proposeProfileKey({ kind: 'CLIENTE', hostedSites: 2, serviceSites: 3 }), PROFILO_PARTNER);
  assert.equal(proposeProfileKey({ kind: 'CLIENTE', hostedSites: 0, serviceSites: 3 }), PROFILO_CLIENTE);
  assert.equal(proposeProfileKey({ kind: 'PARTNER' }), PROFILO_PARTNER);
  assert.equal(proposeProfileKey({ kind: 'CLIENTE' }), PROFILO_CLIENTE);
  assert.equal(proposeProfileKey({ kind: 'FORNITORE' }), null);
  assert.equal(proposeProfileKey({ kind: 'SOCIETA' }), null);
});

test('resolveExternalScopes: Cash → le sedi ospitate (SITE), con avviso se nessuna', () => {
  const cash = { key: 'cash', scope_type: 'SITE' };
  const r = resolveExternalScopes(cash, { orgId: 7, hostedSiteIds: [12, 3, 12], orgSiteIds: [99] });
  assert.deepEqual(r.scopes, [{ type: 'SITE', id: 3 }, { type: 'SITE', id: 12 }]);   // senza doppioni, ordinati
  assert.equal(r.warning, null);
  const empty = resolveExternalScopes(cash, { orgId: 7, hostedSiteIds: [], orgSiteIds: [99] });
  assert.deepEqual(empty.scopes, []);
  assert.match(empty.warning, /non ospita nessun punto prelievi/);
});

test('resolveExternalScopes: NC → la Legal entity (scope ORG), mai le sedi', () => {
  const r = resolveExternalScopes({ key: 'nc', scope_type: 'SITE' }, { orgId: 7, hostedSiteIds: [1], orgSiteIds: [5, 6] });
  assert.deepEqual(r.scopes, [{ type: 'ORG', id: 7 }]);
  assert.equal(r.warning, null);
});

test('resolveExternalScopes: altri moduli per sede → le sedi dell\'organizzazione; senza sedi avviso solo se il profilo è scoped', () => {
  const orders = { key: 'orders', scope_type: 'SITE' };
  assert.deepEqual(resolveExternalScopes(orders, { orgId: 7, orgSiteIds: [5, 6] }).scopes, [{ type: 'SITE', id: 5 }, { type: 'SITE', id: 6 }]);
  assert.match(resolveExternalScopes(orders, { orgId: 7, orgSiteIds: [] }, true).warning, /non ha sedi collegate/);
  assert.equal(resolveExternalScopes(orders, { orgId: 7, orgSiteIds: [] }, false).warning, null);
});

test('resolveExternalScopes: moduli senza ambito → nessuno scope; esterno senza Legal entity → avviso', () => {
  assert.deepEqual(resolveExternalScopes({ key: 'circolari', scope_type: null }, { orgId: 7 }), { scopes: [], warning: null });
  const r = resolveExternalScopes({ key: 'cash', scope_type: 'SITE' }, { orgId: null, hostedSiteIds: [1] });
  assert.deepEqual(r.scopes, []);
  assert.match(r.warning, /non ha una Legal entity/);
});

test('filterRubricaRow: restano solo nome, ruolo, email e telefono ufficio; niente cellulare, sede, responsabile, dati personali', () => {
  const row = { id: 4, last_name: 'Greco', first_name: 'Anna', title: 'Dott.ssa', job_title: 'Responsabile', unit_name: 'Flow & Back Office', email: 'a@td.it', phone_office: '055 776100', phone_ext: '100',
    phone: '333 1234567', site_name: 'HQ', manager_name: 'Taddei', tax_code: 'XXX', birth_date: '1980-01-01', positions: [{ id: 1 }], organization_name: 'TD', avatar_file_id: null };
  const out = filterRubricaRow(row);
  assert.deepEqual(Object.keys(out).sort(), [...RUBRICA_EXTERNAL_FIELDS.filter((k) => k in row), 'phone'].sort());
  assert.equal(out.phone, null);
  assert.equal(out.site_name, undefined);
  assert.equal(out.manager_name, undefined);
  assert.equal(out.tax_code, undefined);
  assert.equal(out.positions, undefined);
  assert.equal(out.email, 'a@td.it');
  assert.equal(out.phone_office, '055 776100');
  assert.equal(filterRubricaRow(null), null);
});
