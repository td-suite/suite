// Programma "anagrafica unica" (blocco 1, 08/11/2026): regole pure di A0 (titolo di godimento), A1 (coerenza contratto PP ↔ Sedi),
// A3 (confronto della locazione e destinazione dei file dei contratti SEDE) e catalogo della Diagnostica (A13). Senza database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regoleTitolo } from '../src/lib/sites.js';
import { leaseEnd } from '../src/lib/leaseSync.js';
import { coerenzaPP } from '../src/modules/business/lib/contrattoSede.js';
import { confrontoLocazione, destinazioneFile } from '../src/lib/sedeBusiness.js';
import { CONTROLLI, AREE } from '../src/lib/diagnostica.js';

test('A0: sede ospitata senza ospitante rifiutata', () => {
  const { errore } = regoleTitolo({ tenure: 'OSPITATA' }, { tenure: 'LOCAZIONE', host_organization_id: null });
  assert.match(errore, /ospitante/);
});

test('A0: l\'ospitante indicato rende la sede OSPITATA e svuota il canone', () => {
  const { b, errore } = regoleTitolo({ host_organization_id: 7 }, { tenure: 'LOCAZIONE', rent_amount: 1000, host_organization_id: null });
  assert.equal(errore, null);
  assert.equal(b.tenure, 'OSPITATA');
  assert.equal(b.rent_amount, null);
});

test('A0: il titolo che esce da OSPITATA ripulisce l\'ospitante (prima restava, D03)', () => {
  const { b, errore } = regoleTitolo({ tenure: 'LOCAZIONE' }, { tenure: 'OSPITATA', host_organization_id: 7 });
  assert.equal(errore, null);
  assert.equal(b.host_organization_id, null);
  assert.equal(b.tenure, 'LOCAZIONE');
});

test('A0: nessun campo del titolo toccato → nessuna modifica', () => {
  const { b } = regoleTitolo({ phone: '055' }, { tenure: 'OSPITATA', host_organization_id: 7 });
  assert.deepEqual(b, { phone: '055' });
});

test('A0: canone in locazione con decorrenza e durata calcola la fine del primo periodo', () => {
  const { b } = regoleTitolo({ rent_amount: 1200, lease_start: '2026-01-01', lease_years: 6 }, { tenure: 'LOCAZIONE' });
  assert.equal(b.lease_end, leaseEnd('2026-01-01', 6));   // stessa regola del form Sedi e di Payments
});

test('A1: coerenza del contratto PP con la sede', () => {
  assert.equal(coerenzaPP({ sede: { tenure: 'OSPITATA', host_organization_id: 5 }, orgId: 5 }).stato, 'OK');
  assert.equal(coerenzaPP({ sede: { tenure: 'LOCAZIONE', host_organization_id: null }, orgId: 5 }).stato, 'DA_IMPOSTARE');
  assert.equal(coerenzaPP({ sede: { tenure: 'OSPITATA', host_organization_id: 9, host_name: 'Altra' }, orgId: 5 }).stato, 'CONFLITTO');
  assert.equal(coerenzaPP({ sede: { tenure: 'LOCAZIONE', host_organization_id: 5 }, orgId: 5 }).stato, 'DA_IMPOSTARE');
  assert.equal(coerenzaPP({ sede: null, orgId: 5 }).stato, 'SENZA_SEDE');
});

test('A3: confronto della locazione, vale Sedi dove c\'è un valore diverso, si riempiono solo i vuoti', () => {
  const c = { org_id: 40, start_date: '2025-03-01', data: { rent: { amount: 7300, period: 'MESE', vat: 'PIU_IVA', deposit: 14600, duration_years: 6, renewal_years: 6, notice_months: 12, istat: true, expenses: 'condominio a carico', notes: 'n' } } };
  const sede = { tenure: 'LOCAZIONE', rent_amount: 7000, rent_period: 'MESE', rent_vat: null, deposit_amount: null, lease_years: 6, lease_renewal_years: null, lease_notice_months: null, lease_start: null, lease_landlord_org_id: 40 };
  const r = confrontoLocazione(c, sede);
  const az = Object.fromEntries(r.campi.map((x) => [x.campo, x.azione]));
  assert.equal(az.rent_amount, 'diverso: vale Sedi');
  assert.equal(az.rent_period, 'uguale');
  assert.equal(az.lease_landlord_org_id, 'uguale');
  assert.deepEqual(r.riempi, { rent_vat: 'PIU_IVA', deposit_amount: 14600, lease_renewal_years: 6, lease_notice_months: 12, lease_start: '2025-03-01' });
  assert.match(r.note, /condominio/);
  assert.equal(r.istat, true);
});

test('A3: sede non in locazione: nessun campo scritto', () => {
  const r = confrontoLocazione({ data: { rent: { amount: 100 } } }, { tenure: 'PROPRIETA', rent_amount: null });
  assert.deepEqual(r.riempi, {});
  assert.match(r.campi[0].azione, /PROPRIETA/);
});

test('A3: destinazione dei file del contratto SEDE (mai sostituire contratto o planimetria correnti)', () => {
  assert.equal(destinazioneFile({ category: 'FIRMATO', sha256: 'a' }, []).kind, 'CONTRATTO_LOCAZIONE');
  assert.equal(destinazioneFile({ category: 'FIRMATO', sha256: 'a' }, [{ kind: 'CONTRATTO_LOCAZIONE', sha256: 'b' }]).kind, 'ALTRO');
  assert.equal(destinazioneFile({ category: 'FIRMATO', sha256: 'a' }, [{ kind: 'ALTRO', sha256: 'a' }]).kind, null);
  assert.equal(destinazioneFile({ category: 'PLANIMETRIA', sha256: 'p' }, []).kind, 'PLANIMETRIA');
  assert.equal(destinazioneFile({ category: 'PLANIMETRIA', sha256: 'p' }, [{ kind: 'PLANIMETRIA', sha256: 'q' }]).kind, 'ALTRO');
  assert.equal(destinazioneFile({ category: 'ASSICURAZIONE', sha256: 'z' }, []).kind, 'ALTRO');
});

test('A13: catalogo dei controlli della Diagnostica (sezione 6 della review)', () => {
  const ids = CONTROLLI.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, 'id unici');
  for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10a', 'D10b', 'D10c', 'D11', 'D12', 'D13', 'D14', 'D15a', 'D15b', 'D16a', 'D16b', 'D16c', 'D17',
    'D18a', 'D18b', 'D18c', 'D18d', 'D18e', 'D19', 'D20', 'D21a', 'D21b', 'D22a', 'D22b', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28', 'D29', 'D30', 'D31', 'D33', 'D34', 'D35', 'D36', 'D39', 'D40']) assert.ok(ids.includes(id), `manca ${id}`);
  for (const k of CONTROLLI) {
    assert.ok(AREE[k.area], `${k.id}: area`);
    assert.ok(['BLOCCANTE', 'ATTENZIONE', 'INFO'].includes(k.gravita), `${k.id}: gravità`);
    assert.ok(/^\s*(SELECT|WITH)\b/i.test(k.sql), `${k.id}: solo letture`);
    assert.ok(!/\b(UPDATE|DELETE|INSERT|ALTER|DROP)\b/i.test(k.sql), `${k.id}: nessuna scrittura nella query`);
    if (k.correggi) assert.equal(typeof k.correggi.fn, 'function', `${k.id}: funzione di correzione`);
  }
});
