// Lab Control (v0.71.0) · scheda dell'accettazione: cosa è stato richiesto (righe d'esame con stato, date e prezzi; campioni con il legame
// esame ↔ campione), linea del tempo delle fasi, totali, documenti economici collegati, NC del modulo Non conformità, stampe di Label.
// Fonte: copia Synclab; se l'utente ha premuto "Aggiorna dal gestionale" e la lettura puntuale (etichette.lc_letture, senza paziente) è più
// recente della copia, la scheda usa la lettura puntuale e lo dice. Paziente: solo l'identità recente di Label.
import { q, one, many } from '../db.js';
import { dettaglio } from '../../../lib/synclab/client.js';
import { statiErogati, scontoTestata } from '../../../lib/synclab/letture.js';
import { dataApiAttiva, settings, oggiRoma, adessoRoma, nomeSede } from './core.js';
import { senzaPaziente } from './accettazioni.js';
import { salvaIdentita, identitaDi } from './identita.js';
import { faseAccettazione, ritardo, statoEsame, tsLocale, minutiTra } from './fasi.js';
import { ncDisponibile, SQL_PC } from './lab.js';

const n2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const num = (v) => (v == null || v === '' ? null : Number(v));
const arr = (v) => (Array.isArray(v) ? v : []);

/** Testata, righe e campioni dalla copia (colonne della copia). */
async function daCopia(instanceId, id) {
  const t = await one(`SELECT r.*, r.date::text AS data FROM synclab.requests r WHERE r.instance_id = $1 AND r.id = $2 AND r.deleted_at IS NULL`, [instanceId, id]);
  if (!t) return null;
  const righe = await many(`SELECT i.*, coalesce((SELECT array_agg(l.sample_id ORDER BY l.sample_id) FROM synclab.request_item_samples l WHERE l.instance_id = i.instance_id AND l.request_id = i.request_id AND l.item_id = i.id), i.sample_ids, '{}') AS campioni_ids
    FROM synclab.request_items i WHERE i.instance_id = $1 AND i.request_id = $2 ORDER BY i.ord`, [instanceId, id]);
  const campioni = await many(`SELECT * FROM synclab.samples WHERE instance_id = $1 AND request_id = $2 ORDER BY ord`, [instanceId, id]);
  return { fonte: 'COPIA', t, righe, campioni };
}

/** Stessa forma da un elemento `requests` della Data API (lettura puntuale). */
export function daLettura(instanceId, x) {
  const t = {
    instance_id: instanceId, id: String(x.id), request_number: x.requestNumber ?? null, data: String(x.date || '').slice(0, 10) || null, client_id: x.clientId ?? null, client_code: x.clientCode ?? null,
    state: num(x.state), patient_type: x.patientType ?? null, occupational_medicine: x.occupationalMedicine ?? null, created_at_local: x.createdAtLocal ?? null, modified_at_local: x.modifiedAtLocal ?? null,
    booking_at_local: x.bookingAtLocal ?? null, report_at_local: x.reportAtLocal ?? null, header_discount_percent: num(x.headerDiscountPercent), source_amount: num(x.sourceAmount),
    dem_age_years: x.demographics?.ageYears ?? null, dem_sex: x.demographics?.sex ?? null, invoice_ids: arr(x.invoiceIds).map(String), disponibilita: 'ATTIVO',
  };
  const righe = arr(x.items).map((i, k) => ({
    ord: k, id: i.id != null ? String(i.id) : null, exam_code: i.examCode ?? null, description: i.description ?? null, quantity: num(i.quantity), gross_unit_price_excluding_vat: num(i.grossUnitPriceExcludingVat),
    discount_percent: num(i.discountPercent), net_unit_price_excluding_vat: num(i.netUnitPriceExcludingVat), deleted: Boolean(i.deleted), not_performed_code: num(i.notPerformedCode), report_ready: i.reportReady ?? null,
    executed_at_local: i.executedAtLocal ?? null, validated_at_local: i.validatedAtLocal ?? null, invoice_ids: arr(i.invoiceIds).map(String), campioni_ids: arr(i.sampleIds).map(String),
  }));
  const campioni = arr(x.samples).map((s, k) => ({ ord: k, id: s.id != null ? String(s.id) : null, barcode: s.barcode ?? null, material: s.material ?? null, container: s.container ?? null,
    sample_at_local: s.sampleAtLocal ?? null, collected_at_local: s.collectedAtLocal ?? null, checked_in_at_local: s.checkedInAtLocal ?? null, prepared_at_local: s.preparedAtLocal ?? null, checked_out_at_local: s.checkedOutAtLocal ?? null }));
  return { fonte: 'GESTIONALE', t, righe, campioni };
}

/** Accettazione per la scheda: copia, lettura puntuale più recente, oppure lettura diretta di Label (accettazione non ancora nella copia). */
export async function caricaPerScheda(instanceId, id) {
  const copia = await daCopia(instanceId, id);
  const lettura = await one(`SELECT raw, letto_il FROM lc_letture WHERE instance_id = $1 AND id = $2`, [instanceId, id]);
  if (lettura && (!copia || new Date(lettura.letto_il) > new Date(copia.t.updated_at))) return { ...daLettura(instanceId, lettura.raw), letto_il: lettura.letto_il, copia_il: copia?.t.updated_at || null };
  if (copia) return { ...copia, copia_il: copia.t.updated_at, letto_il: lettura?.letto_il || null };
  const d = await one(`SELECT raw, letto_il FROM accettazioni_dirette WHERE instance_id = $1 AND id = $2`, [instanceId, id]);
  return d ? { ...daLettura(instanceId, d.raw), letto_il: d.letto_il, copia_il: null } : null;
}

/** Cliente e sede (clients_td) di un client. */
export async function clienteDi(instanceId, clientId) {
  if (!clientId) return null;
  return one(`WITH ${SQL_PC} SELECT * FROM pc WHERE instance_id = $1 AND client_id = $2`, [instanceId, clientId]);
}

/**
 * Scheda completa. ctx = contesto dell'utente (perimetro): ritorna null se non trovata, { fuori: true } se fuori perimetro.
 */
export async function scheda(instanceId, id, ctx) {
  const acc = await caricaPerScheda(instanceId, id);
  if (!acc) return null;
  const { t } = acc;
  const cli = await clienteDi(instanceId, t.client_id);
  if (!ctx.vede(cli?.site_id ?? null)) return { fuori: true };
  const imp = await settings();
  const oggi = oggiRoma(), adesso = adessoRoma();
  const fase = faseAccettazione(t, acc.campioni, acc.righe);
  const rit = ritardo({ ...t, data: t.data }, { ...imp, dal: null }, adesso);
  // descrizioni del catalogo per le righe senza descrizione
  const senza = [...new Set(acc.righe.filter((r) => !r.description && r.exam_code).map((r) => r.exam_code))];
  const cat = senza.length ? new Map((await many(`SELECT DISTINCT ON (exam_code) exam_code, description FROM synclab.exams WHERE exam_code = ANY($1::text[]) ORDER BY exam_code, (disponibilita = 'ATTIVO') DESC, updated_at DESC`, [senza])).map((x) => [x.exam_code, x.description])) : new Map();
  const campById = new Map(acc.campioni.map((c) => [String(c.id), c]));
  const stati = await statiErogati();
  const applica = (await scontoTestata()) === 'APPLICA';
  const h = Number(t.header_discount_percent || 0);
  const righe = acc.righe.map((r) => {
    const st = statoEsame(r);
    const q = r.quantity == null ? null : Number(r.quantity);
    const lordo = r.gross_unit_price_excluding_vat != null && q != null ? Number(r.gross_unit_price_excluding_vat) * q : null;
    const netto = r.net_unit_price_excluding_vat != null && q != null ? Number(r.net_unit_price_excluding_vat) * q : null;
    return {
      id: r.id, codice: r.exam_code, descrizione: r.description || cat.get(r.exam_code) || null, stato: st.key, stato_label: st.label, cancellata: Boolean(r.deleted),
      eseguito_il: tsLocale(r.executed_at_local), validato_il: tsLocale(r.validated_at_local), referto_pronto: r.report_ready === true, non_eseguito_codice: r.not_performed_code ?? null,
      quantita: q, prezzo_lordo: n2(r.gross_unit_price_excluding_vat), sconto_pct: r.discount_percent == null ? null : Number(r.discount_percent), prezzo_netto: n2(r.net_unit_price_excluding_vat),
      lordo: n2(lordo), sconto_riga: lordo != null && netto != null ? n2(lordo - netto) : null, netto: n2(netto),
      campioni: arr(r.campioni_ids).map(String).map((sid) => ({ id: sid, barcode: campById.get(sid)?.barcode || null })),
    };
  });
  const vive = righe.filter((r) => !r.cancellata);
  const somma = (f) => { const v = vive.map(f).filter((x) => x != null); return v.length ? n2(v.reduce((s, x) => s + Number(x), 0)) : null; };
  const nettoRighe = somma((r) => r.netto);
  const erogata = stati.includes(Number(t.state));
  const totali = {
    lordo: somma((r) => r.lordo), sconti_riga: somma((r) => r.sconto_riga), netto_righe: nettoRighe,
    sconto_testata_pct: h || null, sconto_testata: nettoRighe != null && h ? n2(nettoRighe * h / 100) : null, sconto_testata_applicato: applica,
    valore: erogata && nettoRighe != null ? n2(nettoRighe * (applica ? 1 - h / 100 : 1)) : null, valore_erogata: erogata,
    righe_senza_prezzo: vive.filter((r) => r.netto == null).length, importo_testata: n2(t.source_amount),
  };
  const campioni = acc.campioni.map((c) => ({
    id: c.id, barcode: c.barcode, materiale: c.material, contenitore: c.container, prelevato_il: tsLocale(c.sample_at_local), raccolto_il: tsLocale(c.collected_at_local),
    checkin_il: tsLocale(c.checked_in_at_local), preparato_il: tsLocale(c.prepared_at_local), checkout_il: tsLocale(c.checked_out_at_local),
    esami: righe.filter((r) => !r.cancellata && r.campioni.some((x) => x.id === String(c.id))).map((r) => r.codice).filter(Boolean),
  }));
  // documenti economici collegati (testata e ponte)
  const invIds = [...new Set([...arr(t.invoice_ids).map(String), ...(acc.fonte === 'COPIA' ? (await many(`SELECT invoice_id FROM synclab.request_invoices WHERE instance_id = $1 AND request_id = $2`, [instanceId, id])).map((x) => x.invoice_id) : [])])];
  const doc = invIds.length ? await many(`SELECT id, invoice_number, document_type, date::text AS data, cancelled, proforma, total FROM synclab.invoices WHERE instance_id = $1 AND id = ANY($2::text[])`, [instanceId, invIds]) : [];
  const D = new Map(doc.map((x) => [x.id, x]));
  const fatture = invIds.map((fid) => { const x = D.get(fid); return { id: fid, numero: x?.invoice_number || null, tipo: x?.document_type || null, data: x?.data || null, annullato: Boolean(x?.cancelled || x?.proforma), totale: n2(x?.total), nella_copia: Boolean(x) }; });
  // NC (modulo NC LIVE): per numero di accettazione
  const ncOk = await ncDisponibile();
  const nc = ncOk && t.request_number ? await many(`SELECT n.id, n.codice, n.stato, n.gravita, n.opened_at, coalesce(tp.label, n.tipo_altro) AS tipo FROM nc.nc n LEFT JOIN nc.nc_tipi tp ON tp.id = n.tipo_id WHERE n.accettazione_id = $1 AND n.stato <> 'ANNULLATA' ORDER BY n.opened_at DESC`, [t.request_number]).catch(() => []) : null;
  const stampe = await one(`SELECT count(*) FILTER (WHERE esito = 'OK')::int AS ok, max(at) FILTER (WHERE esito = 'OK') AS ultima FROM stampe WHERE instance_id = $1 AND request_id = $2`, [instanceId, id]);
  const p = await identitaDi(instanceId, id);
  const identita = p && (p.cognome || p.nome) ? { cognome: p.cognome, nome: p.nome, nascita: p.nascita, sesso: p.sesso } : null;
  return {
    fonte: acc.fonte, letto_il: acc.letto_il || null, copia_il: acc.copia_il || null, oggi, adesso,
    accettazione: {
      instance_id: instanceId, id: String(t.id), numero: t.request_number, data: t.data, creata_il: tsLocale(t.created_at_local), aggiornata_il: tsLocale(t.modified_at_local), prenotata_il: tsLocale(t.booking_at_local),
      referto_il: tsLocale(t.report_at_local), stato: t.state, tipo_paziente: t.patient_type || null, medicina_lavoro: t.occupational_medicine === true,
      eta: t.dem_age_years ?? null, sesso: t.dem_sex || null, client_id: t.client_id, client_code: t.client_code,
      cliente: cli?.cliente || t.client_code || t.client_id, organization_id: cli?.organization_id || null, org_name: cli?.org_name || null, abbinamento: cli?.stato_abbinamento || 'DA_ABBINARE',
      site_id: cli?.site_id || null, sede: cli?.site_id ? nomeSede({ code: cli.sede_code, name: cli.sede_name }) : null,
    },
    paziente: identita,
    fase: { ...fase, tappe: fase.tappe }, ritardo: rit, tat_min: minutiTra(t.created_at_local, t.report_at_local), soglia: { ore_ritardo: imp.ore_ritardo, soglie_fase: imp.soglie_fase },
    righe, campioni, totali, fatture, nc: ncOk ? nc : null, nc_disponibile: ncOk, stampe: { ok: stampe?.ok || 0, ultima: stampe?.ultima || null },
  };
}

// "Aggiorna dal gestionale": al più una lettura per accettazione ogni 2 minuti (memoria del processo), come l'apertura di Label
const ultime = new Map();
export const azzeraLetture = () => ultime.clear();
export const INTERVALLO_LETTURA_MS = 2 * 60 * 1000;

/**
 * Lettura puntuale di un'accettazione dal gestionale (dettaglio opt-in, una chiamata): salva l'identità (Label) e l'accettazione SENZA
 * paziente in lc_letture. Ritorna { esito: LETTA | ATTESA | DISATTIVATA | NON_TROVATA | ERRORE, messaggio? }. Mai eccezioni.
 */
export async function aggiornaDalGestionale(instanceId, id, { numero = null } = {}) {
  const da = await dataApiAttiva();
  if (!da.ok) return { esito: 'DISATTIVATA', messaggio: `Lettura dal gestionale non disponibile: ${da.motivo}` };
  const k = `${instanceId}|${id}`;
  const prima = ultime.get(k);
  if (prima && Date.now() - prima < INTERVALLO_LETTURA_MS) return { esito: 'ATTESA', messaggio: 'Il gestionale è appena stato interrogato per questa accettazione: riprova tra un paio di minuti' };
  ultime.set(k, Date.now());
  try {
    const d = await dettaglio('requests', id, { includePatient: true });
    if (!d) return { esito: 'NON_TROVATA', messaggio: 'Il gestionale non restituisce l\'accettazione (assente o esclusa)' };
    if (String(d.id) !== String(id) && (!numero || String(d.requestNumber ?? '') !== String(numero))) return { esito: 'ERRORE', messaggio: 'Il dettaglio del gestionale non corrisponde all\'accettazione: nessun dato salvato' };
    await salvaIdentita(instanceId, { ...d, id });
    await q(`INSERT INTO lc_letture (instance_id, id, raw, letto_il) VALUES ($1,$2,$3,now()) ON CONFLICT (instance_id, id) DO UPDATE SET raw = EXCLUDED.raw, letto_il = now()`,
      [instanceId, String(id), JSON.stringify(senzaPaziente({ ...d, id }))]);
    return { esito: 'LETTA' };
  } catch (e) {
    return { esito: 'ERRORE', messaggio: `Il gestionale non ha risposto: ${String(e.message || e).slice(0, 160)}` };
  }
}

/** Purga delle letture puntuali: più vecchie di N giorni o superate dalla copia. */
export async function purgaLetture(giorni) {
  const n = Math.max(1, Math.min(30, Number(giorni) || 7));
  const r = await q(`DELETE FROM lc_letture l WHERE l.letto_il < now() - make_interval(days => $1::int)
      OR EXISTS (SELECT 1 FROM synclab.requests r WHERE r.instance_id = l.instance_id AND r.id = l.id AND r.updated_at > l.letto_il)`, [n]);
  return r.rowCount;
}

/**
 * Documento economico della copia Synclab: testata, righe, accettazioni collegate (numeri). La Data API NON fornisce il PDF.
 * ctx: perimetro (il documento si vede se il suo client o una delle accettazioni collegate è nel perimetro).
 */
export async function documento(instanceId, id, ctx) {
  const v = await one(`SELECT v.*, v.date::text AS data, v.competence_from::text AS competenza_da, v.competence_to::text AS competenza_a FROM synclab.invoices v WHERE v.instance_id = $1 AND v.id = $2`, [instanceId, id]);
  if (!v) return null;
  const items = await many(`SELECT * FROM synclab.invoice_items WHERE instance_id = $1 AND invoice_id = $2 ORDER BY ord`, [instanceId, id]);
  const reqIds = [...new Set([...arr(v.request_ids), ...(await many(`SELECT request_id FROM synclab.request_invoices WHERE instance_id = $1 AND invoice_id = $2`, [instanceId, id])).map((x) => x.request_id)])];
  const acc = reqIds.length ? await many(`WITH ${SQL_PC} SELECT r.id, r.request_number, r.date::text AS data, r.state, pc.site_id FROM synclab.requests r LEFT JOIN pc ON pc.instance_id = r.instance_id AND pc.client_id = r.client_id
      WHERE r.instance_id = $1 AND r.id = ANY($2::text[]) ORDER BY r.date, r.request_number`, [instanceId, reqIds]) : [];
  const cli = await clienteDi(instanceId, v.client_id);
  if (!ctx.tutte && !ctx.vede(cli?.site_id ?? null) && !acc.some((a) => ctx.vede(a.site_id))) return { fuori: true };
  const tipo = { invoice: 'Fattura', credit_note: 'Nota di credito', unknown: 'Tipo non indicato' }[v.document_type] || v.document_type || 'Tipo non indicato';
  return {
    id: v.id, instance_id: v.instance_id, numero: v.invoice_number, data: v.data, tipo, document_type: v.document_type, origine: v.source === 'manual' ? 'Manuale' : 'Da accettazioni',
    stato: v.state, annullato: Boolean(v.cancelled), proforma: Boolean(v.proforma), competenza: { da: v.competenza_da, a: v.competenza_a }, registro_iva: v.vat_register,
    cliente: cli?.cliente || v.client_id, client_id: v.client_id,
    totali: { imponibile_lordo: n2(v.source_gross_taxable_amount), sconto_pct: v.discount_percent == null ? null : Number(v.discount_percent), imponibile_netto: n2(v.net_taxable_amount), iva: n2(v.vat_amount),
      bollo: n2(v.stamp_duty), cassa: n2(v.pension_contribution), trasporto: n2(v.transport_amount), totale: n2(v.total), contributo_fatturato: n2(v.net_revenue_contribution) },
    righe: items.map((i) => ({ codice: i.code, descrizione: i.description, quantita: i.quantity == null ? null : Number(i.quantity), prezzo: n2(i.source_unit_price_excluding_vat), importo: n2(i.source_amount_excluding_vat),
      sconto_pct: i.discount_percent == null ? null : Number(i.discount_percent), netto: n2(i.net_amount_excluding_vat), iva_pct: i.vat_rate == null ? null : Number(i.vat_rate), trattamento_iva: i.vat_treatment, request_id: i.request_id })),
    accettazioni: acc.map((a) => ({ id: a.id, numero: a.request_number, data: a.data, visibile: ctx.vede(a.site_id) })),
    accettazioni_non_nella_copia: reqIds.filter((x) => !acc.some((a) => a.id === x)).length,
    pdf: 'Il PDF del documento resta in StudioLab: la Data API non lo fornisce.',
  };
}
