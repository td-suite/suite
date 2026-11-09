// Synclab Data API: scrittura della copia locale (schema synclab, migrazione core 052). Tutte le funzioni ricevono il client della
// transazione: la pagina, l'avanzamento del cursore e il checkpoint si confermano insieme (sync.js).
// Upsert = sostituzione completa dell'aggregato e dei suoi figli (DELETE dei figli + INSERT), quindi una pagina ripetuta dà lo stesso
// risultato. Le uscite marcano la riga senza cancellarla; i figli si tolgono solo per remove/excluded_state.
import { dec } from './client.js';

export const TABELLE = { clients: 'synclab.clients', exams: 'synclab.exams', 'price-lists': 'synclab.price_lists', requests: 'synclab.requests', invoices: 'synclab.invoices' };
export const DISPONIBILITA = ['ATTIVO', 'RIMOSSO_STATO_ESCLUSO', 'FUORI_AMBITO', 'ARCHIVIATO', 'USCITA_INCERTA'];

const s = (v) => (v == null ? null : String(v));
const b = (v) => (v == null ? null : Boolean(v));
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null).map(String) : null);
const senza = (o, chiavi) => { const x = { ...o }; for (const k of chiavi) delete x[k]; return x; };
const json = (o) => (o == null ? null : JSON.stringify(o));   // rawJSON resta testo esatto

// INSERT di molte righe a blocchi (limite dei parametri di PostgreSQL)
async function inserisci(c, tabella, colonne, righe) {
  if (!righe.length) return 0;
  const per = Math.max(1, Math.floor(30000 / colonne.length));
  for (let i = 0; i < righe.length; i += per) {
    const blocco = righe.slice(i, i + per);
    const vals = []; const ph = [];
    for (const r of blocco) { ph.push(`(${colonne.map((_, j) => `$${vals.length + j + 1}`).join(',')})`); vals.push(...colonne.map((k) => r[k])); }
    await c.query(`INSERT INTO ${tabella} (${colonne.join(',')}) VALUES ${ph.join(',')} ON CONFLICT DO NOTHING`, vals);
  }
  return righe.length;
}

// upsert della testata: tutte le colonne sostituite, la riga torna ATTIVO; first_seen_at resta quello della prima volta
async function testata(c, tabella, riga) {
  const col = Object.keys(riga);
  const set = col.filter((k) => k !== 'instance_id' && k !== 'id').map((k) => `${k}=EXCLUDED.${k}`);
  await c.query(`INSERT INTO ${tabella} (${col.join(',')}) VALUES (${col.map((_, i) => `$${i + 1}`).join(',')})
    ON CONFLICT (instance_id, id) DO UPDATE SET ${set.join(', ')}, disponibilita='ATTIVO', disponibilita_reason=NULL, deleted_at=NULL, updated_at=now()`, col.map((k) => riga[k]));
}

/**
 * Sostituisce un aggregato con il contenuto ricevuto (pagina di un completo, upsert di un delta, dettaglio della riconciliazione).
 * includePatient: la proiezione dell'ambito; con false le colonne paziente e i testi storici restano vuoti anche se arrivassero.
 */
export async function upsertAggregato(c, { instanceId, dataset, d, revision = null, capturedAt = null, includePatient = false }) {
  if (!d || d.id == null) throw new Error(`Elemento di ${dataset} senza id`);
  const id = String(d.id);
  const comuni = { instance_id: instanceId, id, revision: s(revision), captured_at: capturedAt || null };
  if (dataset === 'clients') {
    const site = d.site && typeof d.site === 'object' ? d.site : {};
    await testata(c, TABELLE.clients, { ...comuni, client_code: s(d.clientCode), legal_name: s(d.legalName), billing_client_id: s(d.billingClientId), operating_company: s(d.operatingCompany),
      vat_number: s(d.vatNumber), fiscal_code: s(d.fiscalCode), address: s(d.address), city: s(d.city), province: s(d.province), postal_code: s(d.postalCode), phone1: s(d.phone1), phone2: s(d.phone2),
      email: s(d.email), invoice_email: s(d.invoiceEmail), non_conformity_email: s(d.nonConformityEmail), price_list_id: s(d.priceListId), extra_price_list_id: s(d.extraPriceListId), active: b(d.active),
      site_description: s(site.description), site_address: s(site.address), site_city: s(site.city), site_province: s(site.province), site_postal_code: s(site.postalCode), site_phone: s(site.phone), raw: json(d) });
    return;
  }
  if (dataset === 'exams') {
    await testata(c, TABELLE.exams, { ...comuni, exam_code: s(d.examCode), description: s(d.description), category: s(d.category), branch_code: s(d.branchCode), specialty_code: s(d.specialtyCode),
      regional_code: s(d.regionalCode), active: b(d.active), raw: json(d) });
    return;
  }
  if (dataset === 'price-lists') {
    await testata(c, TABELLE['price-lists'], { ...comuni, code: s(d.code), description: s(d.description), type: dec(d.type), state: dec(d.state), active: b(d.active), operating_company: s(d.operatingCompany), raw: json(senza(d, ['items'])) });
    await c.query('DELETE FROM synclab.price_list_items WHERE instance_id=$1 AND price_list_id=$2', [instanceId, id]);
    await inserisci(c, 'synclab.price_list_items', ['instance_id', 'price_list_id', 'ord', 'id', 'exam_id', 'exam_code', 'description', 'gross_unit_price_excluding_vat', 'discount_percent', 'net_unit_price_excluding_vat', 'vat_code', 'vat_rate', 'vat_amount', 'vat_treatment', 'raw'],
      (Array.isArray(d.items) ? d.items : []).map((x, i) => ({ instance_id: instanceId, price_list_id: id, ord: i, id: s(x.id), exam_id: s(x.examId), exam_code: s(x.examCode), description: s(x.description),
        gross_unit_price_excluding_vat: dec(x.grossUnitPriceExcludingVat), discount_percent: dec(x.discountPercent), net_unit_price_excluding_vat: dec(x.netUnitPriceExcludingVat), vat_code: s(x.vatCode), vat_rate: dec(x.vatRate), vat_amount: dec(x.vatAmount), vat_treatment: s(x.vatTreatment), raw: json(x) })));
    return;
  }
  if (dataset === 'requests') {
    const dem = d.demographics && typeof d.demographics === 'object' ? d.demographics : {};
    const pat = includePatient && d.patient && typeof d.patient === 'object' ? d.patient : {};
    const rawTestata = senza(d, ['items', 'samples']);
    if (!includePatient) delete rawTestata.patient;
    await testata(c, TABELLE.requests, { ...comuni, request_number: s(d.requestNumber), date: d.date || null, client_id: s(d.clientId), client_code: s(d.clientCode), operating_company: s(d.operatingCompany),
      state: dec(d.state), patient_type: s(d.patientType), occupational_medicine: b(d.occupationalMedicine), created_at_local: d.createdAtLocal || null, modified_at_local: d.modifiedAtLocal || null,
      booking_at_local: d.bookingAtLocal || null, report_at_local: d.reportAtLocal || null, source_amount: dec(d.sourceAmount), header_discount_percent: dec(d.headerDiscountPercent),
      dem_age_years: dec(dem.ageYears), dem_sex: s(dem.sex), dem_city: s(dem.city), dem_province: s(dem.province), dem_postal_code: s(dem.postalCode),
      patient_id: s(pat.id), patient_last_name: s(pat.lastName), patient_first_name: s(pat.firstName), patient_birth_date: pat.birthDate || null, patient_fiscal_code: s(pat.fiscalCode),
      invoice_ids: arr(d.invoiceIds), raw: json(rawTestata) });
    await togliFigliRichiesta(c, instanceId, id);
    const items = Array.isArray(d.items) ? d.items : [];
    await inserisci(c, 'synclab.request_items', ['instance_id', 'request_id', 'ord', 'id', 'exam_id', 'exam_code', 'description', 'historical_description', 'quantity', 'gross_unit_price_excluding_vat', 'discount_percent', 'net_unit_price_excluding_vat',
      'vat_code', 'vat_rate', 'vat_amount', 'vat_treatment', 'deleted', 'not_performed_code', 'report_ready', 'executed_at_local', 'validated_at_local', 'invoice_ids', 'sample_ids', 'raw'],
    items.map((x, i) => ({ instance_id: instanceId, request_id: id, ord: i, id: s(x.id), exam_id: s(x.examId), exam_code: s(x.examCode), description: s(x.description), historical_description: includePatient ? s(x.historicalDescription) : null,
      quantity: dec(x.quantity), gross_unit_price_excluding_vat: dec(x.grossUnitPriceExcludingVat), discount_percent: dec(x.discountPercent), net_unit_price_excluding_vat: dec(x.netUnitPriceExcludingVat),
      vat_code: s(x.vatCode), vat_rate: dec(x.vatRate), vat_amount: dec(x.vatAmount), vat_treatment: s(x.vatTreatment), deleted: b(x.deleted), not_performed_code: dec(x.notPerformedCode), report_ready: b(x.reportReady),
      executed_at_local: x.executedAtLocal || null, validated_at_local: x.validatedAtLocal || null, invoice_ids: arr(x.invoiceIds), sample_ids: arr(x.sampleIds), raw: json(includePatient ? x : senza(x, ['historicalDescription'])) })));
    await inserisci(c, 'synclab.samples', ['instance_id', 'request_id', 'ord', 'id', 'barcode', 'material', 'container', 'sample_at_local', 'collected_at_local', 'checked_in_at_local', 'prepared_at_local', 'checked_out_at_local', 'raw'],
      (Array.isArray(d.samples) ? d.samples : []).map((x, i) => ({ instance_id: instanceId, request_id: id, ord: i, id: s(x.id), barcode: s(x.barcode), material: s(x.material), container: s(x.container), sample_at_local: x.sampleAtLocal || null,
        collected_at_local: x.collectedAtLocal || null, checked_in_at_local: x.checkedInAtLocal || null, prepared_at_local: x.preparedAtLocal || null, checked_out_at_local: x.checkedOutAtLocal || null, raw: json(x) })));
    // ponti: documenti della richiesta, documenti e campioni delle righe (anche verso record non ancora arrivati)
    await inserisci(c, 'synclab.request_invoices', ['instance_id', 'request_id', 'invoice_id', 'lato'], (arr(d.invoiceIds) || []).map((inv) => ({ instance_id: instanceId, request_id: id, invoice_id: inv, lato: 'REQUEST' })));
    const rii = []; const ris = [];
    for (const x of items) {
      if (x.id == null) continue;
      for (const inv of arr(x.invoiceIds) || []) rii.push({ instance_id: instanceId, request_id: id, item_id: String(x.id), invoice_id: inv });
      for (const smp of arr(x.sampleIds) || []) ris.push({ instance_id: instanceId, request_id: id, item_id: String(x.id), sample_id: smp });
    }
    await inserisci(c, 'synclab.request_item_invoices', ['instance_id', 'request_id', 'item_id', 'invoice_id'], rii);
    await inserisci(c, 'synclab.request_item_samples', ['instance_id', 'request_id', 'item_id', 'sample_id'], ris);
    return;
  }
  if (dataset === 'invoices') {
    await testata(c, TABELLE.invoices, { ...comuni, invoice_number: s(d.invoiceNumber), source: s(d.source), document_type: s(d.documentType), source_document_type: s(d.sourceDocumentType), cancelled: b(d.cancelled), proforma: b(d.proforma),
      state: dec(d.state), date: d.date || null, competence_from: d.competenceFrom || null, competence_to: d.competenceTo || null, client_id: s(d.clientId), operating_company: s(d.operatingCompany), vat_register: s(d.vatRegister),
      source_gross_taxable_amount: dec(d.sourceGrossTaxableAmount), discount_percent: dec(d.discountPercent), net_taxable_amount: dec(d.netTaxableAmount), vat_amount: dec(d.vatAmount), stamp_duty: dec(d.stampDuty),
      pension_contribution: dec(d.pensionContribution), transport_amount: dec(d.transportAmount), total: dec(d.total), net_revenue_contribution: dec(d.netRevenueContribution), request_ids: arr(d.requestIds), raw: json(senza(d, ['items'])) });
    await togliFigliDocumento(c, instanceId, id);
    await inserisci(c, 'synclab.invoice_items', ['instance_id', 'invoice_id', 'ord', 'id', 'code', 'description', 'request_id', 'request_item_id', 'parent_code', 'prescription_id', 'quantity', 'source_unit_price_excluding_vat',
      'source_amount_excluding_vat', 'discount_percent', 'net_amount_excluding_vat', 'vat_code', 'vat_rate', 'vat_amount', 'source_vat_amount', 'vat_treatment', 'competence_date', 'raw'],
    (Array.isArray(d.items) ? d.items : []).map((x, i) => ({ instance_id: instanceId, invoice_id: id, ord: i, id: s(x.id), code: s(x.code), description: s(x.description), request_id: s(x.requestId), request_item_id: s(x.requestItemId),
      parent_code: s(x.parentCode), prescription_id: dec(x.prescriptionId), quantity: dec(x.quantity), source_unit_price_excluding_vat: dec(x.sourceUnitPriceExcludingVat), source_amount_excluding_vat: dec(x.sourceAmountExcludingVat),
      discount_percent: dec(x.discountPercent), net_amount_excluding_vat: dec(x.netAmountExcludingVat), vat_code: s(x.vatCode), vat_rate: dec(x.vatRate), vat_amount: dec(x.vatAmount), source_vat_amount: dec(x.sourceVatAmount),
      vat_treatment: s(x.vatTreatment), competence_date: x.competenceDate || null, raw: json(x) })));
    await inserisci(c, 'synclab.request_invoices', ['instance_id', 'request_id', 'invoice_id', 'lato'], (arr(d.requestIds) || []).map((rq) => ({ instance_id: instanceId, request_id: rq, invoice_id: id, lato: 'INVOICE' })));
    return;
  }
  throw new Error(`Insieme di dati sconosciuto: ${dataset}`);
}

async function togliFigliRichiesta(c, instanceId, id) {
  for (const t of ['request_items', 'samples', 'request_item_invoices', 'request_item_samples']) await c.query(`DELETE FROM synclab.${t} WHERE instance_id=$1 AND request_id=$2`, [instanceId, id]);
  await c.query(`DELETE FROM synclab.request_invoices WHERE instance_id=$1 AND request_id=$2 AND lato='REQUEST'`, [instanceId, id]);
}
async function togliFigliDocumento(c, instanceId, id) {
  await c.query('DELETE FROM synclab.invoice_items WHERE instance_id=$1 AND invoice_id=$2', [instanceId, id]);
  await c.query(`DELETE FROM synclab.request_invoices WHERE instance_id=$1 AND invoice_id=$2 AND lato='INVOICE'`, [instanceId, id]);
}
/** Figli e ponti dichiarati dall'aggregato (solo per remove/excluded_state). */
export async function togliFigli(c, { instanceId, dataset, id }) {
  if (dataset === 'requests') return togliFigliRichiesta(c, instanceId, id);
  if (dataset === 'invoices') return togliFigliDocumento(c, instanceId, id);
  if (dataset === 'price-lists') return c.query('DELETE FROM synclab.price_list_items WHERE instance_id=$1 AND price_list_id=$2', [instanceId, id]);
  return null;
}

/** Marca la disponibilità di un aggregato già presente (nessuna cancellazione della riga). Ritorna true se la riga c'era. */
export async function marca(c, { instanceId, dataset, id, disponibilita, reason = null, revision = null, rimosso = false }) {
  const r = await c.query(`UPDATE ${TABELLE[dataset]} SET disponibilita=$3, disponibilita_reason=$4, revision=coalesce($5, revision), deleted_at=CASE WHEN $6 THEN coalesce(deleted_at, now()) ELSE deleted_at END, updated_at=now()
      WHERE instance_id=$1 AND id=$2`, [instanceId, String(id), disponibilita, reason, revision, rimosso]);
  return r.rowCount > 0;
}

/** Appartenenza del record all'ambito (stato per ambito: un out_of_scope vale solo qui). */
export async function appartenenza(c, { scopeId, id, stato, reason = null, revision = null, operation = null }) {
  await c.query(`INSERT INTO synclab.scope_records (scope_id, id, stato, reason, revision, operation) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (scope_id, id) DO UPDATE SET stato=EXCLUDED.stato, reason=EXCLUDED.reason, revision=EXCLUDED.revision, operation=EXCLUDED.operation, updated_at=now()`, [scopeId, String(id), stato, reason, revision, operation]);
}

/** Il record è ATTIVO in un altro ambito della stessa istanza e dello stesso insieme di dati? */
export async function attivoAltrove(c, { scopeId, instanceId, dataset, id }) {
  const r = await c.query(`SELECT 1 FROM synclab.scope_records r JOIN synclab.sync_scope s ON s.id = r.scope_id
     WHERE s.instance_id=$1 AND s.dataset=$2 AND r.id=$3 AND r.scope_id<>$4 AND r.stato='ATTIVO' LIMIT 1`, [instanceId, dataset, String(id), scopeId]);
  return r.rowCount > 0;
}

/**
 * Applica un'operazione (delta o riconciliazione) a un id. op: upsert | remove | archived | unavailable (| available con d).
 * Ritorna la chiave del contatore: upsert, remove, fuori_ambito, archived, unavailable, sconosciute.
 */
export async function applicaOperazione(c, { scope, instanceId, dataset, id, operation, reason = null, revision = null, data = null, capturedAt = null }) {
  const scopeId = scope.id; const includePatient = scope.include_patient;
  if (operation === 'upsert' || operation === 'available') {
    if (!data) return 'sconosciute';
    await upsertAggregato(c, { instanceId, dataset, d: data, revision, capturedAt, includePatient });
    await appartenenza(c, { scopeId, id, stato: 'ATTIVO', reason, revision, operation });
    return 'upsert';
  }
  if (operation === 'remove' && reason === 'excluded_state') {
    await marca(c, { instanceId, dataset, id, disponibilita: 'RIMOSSO_STATO_ESCLUSO', reason, revision, rimosso: true });
    await togliFigli(c, { instanceId, dataset, id: String(id) });
    await appartenenza(c, { scopeId, id, stato: 'RIMOSSO_STATO_ESCLUSO', reason, revision, operation });
    return 'remove';
  }
  if (operation === 'remove') {
    // out_of_scope (o motivo non riconosciuto: trattamento conservativo, nessuna cancellazione): fuori da questo ambito; la riga
    // diventa FUORI_AMBITO solo se nessun altro ambito la tiene attiva
    await appartenenza(c, { scopeId, id, stato: 'FUORI_AMBITO', reason, revision, operation });
    if (!(await attivoAltrove(c, { scopeId, instanceId, dataset, id }))) await marca(c, { instanceId, dataset, id, disponibilita: 'FUORI_AMBITO', reason, revision });
    return 'fuori_ambito';
  }
  if (operation === 'archived') {
    await marca(c, { instanceId, dataset, id, disponibilita: 'ARCHIVIATO', reason, revision });
    await appartenenza(c, { scopeId, id, stato: 'ARCHIVIATO', reason, revision, operation });
    return 'archived';
  }
  if (operation === 'unavailable') {
    await marca(c, { instanceId, dataset, id, disponibilita: 'USCITA_INCERTA', reason, revision });
    await appartenenza(c, { scopeId, id, stato: 'USCITA_INCERTA', reason, revision, operation });
    return 'unavailable';
  }
  return 'sconosciute';
}

/** Proiezione paziente spenta: si svuotano colonne e testi opt-in già importati (nessun dato identificativo resta nella copia). */
export async function svuotaDatiPaziente(c) {
  const a = await c.query(`UPDATE synclab.requests SET patient_id=NULL, patient_last_name=NULL, patient_first_name=NULL, patient_birth_date=NULL, patient_fiscal_code=NULL, raw = raw - 'patient', updated_at=now()
     WHERE patient_id IS NOT NULL OR patient_last_name IS NOT NULL OR patient_first_name IS NOT NULL OR patient_birth_date IS NOT NULL OR patient_fiscal_code IS NOT NULL OR raw ? 'patient'`);
  const b2 = await c.query(`UPDATE synclab.request_items SET historical_description=NULL, raw = raw - 'historicalDescription' WHERE historical_description IS NOT NULL OR raw ? 'historicalDescription'`);
  return { accettazioni: a.rowCount, righe: b2.rowCount };
}
