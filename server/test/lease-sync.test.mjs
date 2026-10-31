// Titolo di godimento e locazione della sede (Amministrazione > Sedi, fonte unica per Payments e Facility): funzioni pure di
// server/src/lib/leaseSync.js e della lettura del contratto (server/src/lib/leaseAnalysis.js). Nessun database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaseEnd, periodMonths, rentPeriodOf, mergeProposal, tenureIssue, suggestedTenure, normalizeLeaseFields, leaseFieldsFromSite, siteFieldsFromLease, planRentChange, leaseKindOf } from '../src/lib/leaseSync.js';
import { siteFieldsFromExtract, mockExtract } from '../src/lib/leaseAnalysis.js';

test('fine del primo periodo: decorrenza + anni, fine mese rispettata, vuota se manca un dato', () => {
  assert.equal(leaseEnd('2026-04-15', 6), '2032-04-15');
  assert.equal(leaseEnd('2024-02-29', 1), '2025-02-28');
  assert.equal(leaseEnd('2026-04-15', null), null);
  assert.equal(leaseEnd(null, 6), null);
  assert.equal(leaseEnd('2026-04-15', 0), null);
});

test('periodo del canone ↔ periodicità della rata in Payments', () => {
  assert.equal(periodMonths('MESE'), 1); assert.equal(periodMonths('TRIMESTRE'), 3); assert.equal(periodMonths('SEMESTRE'), 6); assert.equal(periodMonths('ANNO'), 12);
  assert.equal(periodMonths(null), 1);
  assert.deepEqual(rentPeriodOf(3), { rent_period: 'TRIMESTRE', divisor: 1 });
  assert.deepEqual(rentPeriodOf(2), { rent_period: 'MESE', divisor: 2 });   // il bimestrale non c'è in anagrafica: rata mensile
  // anagrafica → contratto e ritorno
  const s = { tenure: 'LOCAZIONE', rent_amount: 7300, rent_period: 'MESE', lease_start: '2026-04-15', lease_years: 6, lease_renewal_years: 6, lease_notice_months: 12, lease_landlord_org_id: 9, deposit_amount: 21900, lease_registration: 'IMPOSTA_ANNUALE' };
  const l = leaseFieldsFromSite(s);
  assert.deepEqual(l, { landlord_org_id: 9, start_date: '2026-04-15', first_term_years: 6, renewal_years: 6, notice_months: 12, period_months: 1, deposit: 21900, registration: 'IMPOSTA_ANNUALE', kind: 'COMMERCIALE_6_6' });
  const back = siteFieldsFromLease({ ...l, period_months: 2 }, 1000);
  assert.equal(back.rent_amount, 500); assert.equal(back.rent_period, 'MESE'); assert.equal(back.tenure, 'LOCAZIONE'); assert.equal(back.lease_end, '2032-04-15'); assert.equal(back.lease_landlord_org_id, 9);
  assert.equal(leaseKindOf('LOCAZIONE', 9, 9), 'COMMERCIALE_9_9'); assert.equal(leaseKindOf('COMODATO', 6, 6), 'COMODATO'); assert.equal(leaseKindOf('LOCAZIONE', 1, 0), 'TRANSITORIO');
});

test('fusione della proposta letta dal PDF con il form', () => {
  const cur = { rent_amount: '5000', rent_vat: '', lease_start: '2026-01-01', guarantee_bank_amount: '', notes: 'x' };
  const prop = { rent_amount: 7300, rent_vat: 'ESENTE', lease_start: null, guarantee_bank_amount: 73000, campo_ignoto: 1 };
  assert.deepEqual(mergeProposal(cur, prop), { rent_amount: 7300, rent_vat: 'ESENTE', lease_start: '2026-01-01', guarantee_bank_amount: 73000, notes: 'x' });
  assert.deepEqual(mergeProposal(cur, prop, { overwrite: false }), { rent_amount: '5000', rent_vat: 'ESENTE', lease_start: '2026-01-01', guarantee_bank_amount: 73000, notes: 'x' });
});

test('coerenza titolo di godimento / Legal entity ospitante', () => {
  assert.match(tenureIssue({ tenure: 'OSPITATA', host_organization_id: null }), /Legal entity ospitante/);
  assert.equal(tenureIssue({ tenure: 'OSPITATA', host_organization_id: 4 }), null);
  assert.equal(tenureIssue({ tenure: 'LOCAZIONE', host_organization_id: null }), null);
  assert.match(tenureIssue({ tenure: 'AFFITTO' }), /non valido/);
  assert.equal(suggestedTenure({ host_organization_id: 4 }), 'OSPITATA');
  assert.equal(suggestedTenure({ host_organization_id: null, tenure: 'PROPRIETA' }), 'PROPRIETA');
  // proprietà: niente canone né garanzie; comodato: durata sì, canone no; locazione: fine calcolata e aliquota predefinita
  const p = normalizeLeaseFields({ tenure: 'PROPRIETA', rent_amount: 100, deposit_amount: 5, lease_start: '2026-01-01' });
  assert.equal(p.rent_amount, null); assert.equal(p.deposit_amount, null); assert.equal(p.lease_start, null);
  const c = normalizeLeaseFields({ tenure: 'COMODATO', rent_amount: 100, lease_start: '2026-01-01', lease_years: 4 });
  assert.equal(c.rent_amount, null); assert.equal(c.lease_end, '2030-01-01');
  const l = normalizeLeaseFields({ tenure: 'LOCAZIONE', rent_amount: 100, rent_vat: 'PIU_IVA', rent_vat_rate: null, lease_start: '2026-04-15', lease_years: 6, lease_end: null });
  assert.equal(l.rent_vat_rate, 22); assert.equal(l.lease_end, '2032-04-15');
});

test('scatti del canone: Payments conserva gli scatti successivi', () => {
  const today = '2026-10-31';
  assert.deepEqual(planRentChange([], { amount: 7300, start: '2026-04-15', today }), { type: 'insert_initial', valid_from: '2026-04-15', amount: 7300 });
  // solo lo scatto iniziale: si aggiorna
  assert.deepEqual(planRentChange([{ id: 1, valid_from: '2026-04-15', amount: 7300, reason: 'INIZIALE' }], { amount: 7500, start: '2026-04-15', today }), { type: 'update_initial', id: 1, amount: 7500, valid_from: '2026-04-15' });
  assert.equal(planRentChange([{ id: 1, valid_from: '2026-04-15', amount: 7300, reason: 'INIZIALE' }], { amount: 7300, start: '2026-04-15', today }).type, 'none');
  // rate iniziali ridotte prima dell'INIZIALE: la data dell'INIZIALE resta quella del canone a regime
  const ridotte = [{ id: 1, valid_from: '2026-04-15', amount: 2500, reason: 'ALTRO' }, { id: 2, valid_from: '2026-05-01', amount: 5000, reason: 'ALTRO' }, { id: 3, valid_from: '2026-06-01', amount: 7300, reason: 'INIZIALE' }];
  assert.deepEqual(planRentChange(ridotte, { amount: 7400, start: '2026-04-15', today }), { type: 'update_initial', id: 3, amount: 7400, valid_from: '2026-06-01' });
  // scatto ISTAT registrato in Payments: senza modifica del canone in anagrafica non si tocca nulla
  const istat = [{ id: 1, valid_from: '2026-04-15', amount: 7300, reason: 'INIZIALE' }, { id: 2, valid_from: '2027-04-15', amount: 7400, reason: 'ISTAT' }];
  assert.equal(planRentChange(istat, { amount: 7300, start: '2026-04-15', today: '2027-06-01' }).type, 'none');
  // canone cambiato in anagrafica: nuovo scatto ANAGRAFICA da oggi
  assert.deepEqual(planRentChange(istat, { amount: 8000, start: '2026-04-15', today: '2027-06-01', rentChanged: true }), { type: 'add_step', valid_from: '2027-06-01', amount: 8000 });
  assert.deepEqual(planRentChange([...istat, { id: 3, valid_from: '2027-06-01', amount: 7900, reason: 'ANAGRAFICA' }], { amount: 8000, start: '2026-04-15', today: '2027-06-01', rentChanged: true }), { type: 'update_step', id: 3, amount: 8000, valid_from: '2027-06-01' });
});

test('dal contratto letto ai campi della sede, garanzie comprese (estrattore di prova)', () => {
  const t = 'Con la presente scrittura la società (in seguito chiamata LOCATORE) ALFA IMMOBILIARE s.r.l., C.F. 01234567890, P.IVA 01234567890 con sede a Prato (PO) in Via Roma n. 1, nella persona del legale rappresentante Dr. Mario Rossi. 1) La locazione avrà la durata di anni 6 (sei) con inizio dal 01/01/2027 e con rinnovazione tacita per ulteriori sei anni, salvo disdetta da comunicarsi, dodici mesi prima della scadenza. 2) Il canone di locazione è stabilito consensualmente in Euro 12.000,00 (dodicimila/00) da pagarsi n. 12 rate mensili anticipate di Euro 1.000,00 (mille/00). Il canone è esente iva. 12) A garanzia e, quindi, a titolo di deposito cauzionale la parte conduttrice versa la somma di euro 3.000,00 pari a tre mensilità. Il conduttore si impegna a fornire al locatore idonea garanzia fideiussoria bancaria per l\'importo di 10.000,00 euro pari a n. 10 mensilità. Il conduttore consegna inoltre polizza fideiussoria assicurativa di euro 5.000,00 a garanzia degli obblighi.';
  const ex = mockExtract(t);
  assert.equal(ex.garanzie.fideiussione_bancaria.importo, 10000);
  assert.equal(ex.garanzie.fideiussione_assicurativa.importo, 5000);
  assert.equal(ex.garanzie.caparra.importo, 3000);
  const { fields, confidence } = siteFieldsFromExtract(ex, { landlordOrgId: 7 });
  assert.equal(fields.tenure, 'LOCAZIONE'); assert.equal(fields.rent_amount, 1000); assert.equal(fields.rent_period, 'MESE'); assert.equal(fields.rent_vat, 'ESENTE'); assert.equal(fields.rent_vat_rate, null);
  assert.equal(fields.lease_start, '2027-01-01'); assert.equal(fields.lease_years, 6); assert.equal(fields.lease_renewal_years, 6); assert.equal(fields.lease_notice_months, 12); assert.equal(fields.lease_end, '2033-01-01');
  assert.equal(fields.lease_landlord_org_id, 7); assert.equal(fields.guarantee_bank_amount, 10000); assert.equal(fields.guarantee_insurance_amount, 5000); assert.equal(fields.deposit_amount, 3000);
  assert.equal(confidence.rent_amount.level, 'alta'); assert.match(confidence.guarantee_bank_amount.quote, /fideiussoria bancaria/);
  // risposta del modello con le sole vecchie chiavi (canone.fideiussione, canone.deposito): restano lette
  const old = siteFieldsFromExtract({ canone: { importo: 500, periodo: 'TRIMESTRE', iva: 'PIU_IVA', fideiussione: 1500, deposito: 1000 } });
  assert.equal(old.fields.guarantee_bank_amount, 1500); assert.equal(old.fields.deposit_amount, 1000); assert.equal(old.fields.rent_vat_rate, 22); assert.equal(old.fields.rent_period, 'TRIMESTRE');
});
