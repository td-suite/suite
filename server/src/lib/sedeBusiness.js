// Eliminazione dei contratti SEDE dal Business Hub (correzione A3 del programma "anagrafica unica", review sezione 5; decisione 3 del CEO
// dell'08/11/2026: per ogni differenza tra canone del contratto Business e canone di Sedi vale SEDI). Operazione una tantum in
// Amministrazione > Diagnostica anagrafica: "Prova" produce il rapporto delle differenze senza scrivere nulla; "Esegui" (solo titolare),
// per ogni contratto kind = 'SEDE', in una transazione:
//   1. stacca i fascicoli di autorizzazione (dossiers.contract_id = NULL, restano sede e Legal entity; evento nel fascicolo): senza questo
//      passo la cancellazione li porterebbe via in cascata (dossiers_contract_id_fkey ON DELETE CASCADE);
//   2. porta i file in public.site_documents RIUSANDO i byte o il blob (nessuna copia, nessun blob cancellato): FIRMATO → contratto di
//      locazione se la sede non ne ha uno (altrimenti ALTRO), PLANIMETRIA → planimetria se la sede non ne ha (altrimenti ALTRO; mai
//      sostituire la corrente, pubblicata in Room), ASSICURAZIONE e altri → ALTRO; un file con lo stesso sha256 già nella sede si salta;
//   3. riempie SOLO i campi vuoti della locazione della sede (sede in LOCAZIONE) con la funzione unica del core (scriviSede: regole del
//      titolo, audit SITE_UPDATED con origine "migrazione contratto SEDE"); spese, registrazione e note si accodano alle note delle
//      garanzie; dove Sedi ha già un valore diverso vale Sedi (riportato nel rapporto);
//   4. registra in audit_log BUSINESS_SEDE_MIGRATED il contratto completo (protocollo, stato, dati, eventi, file): nulla si perde;
//   5. cancella il contratto con SQL diretto (mai con la route DELETE, che cancellerebbe anche i blob).
// Dopo l'ultimo: vincoli contracts_kind_check senza SEDE e contracts_site_required_check solo PP. Idempotente: rieseguita non trova
// più contratti SEDE e si limita ai vincoli.
import { one, many, q, tx } from '../db.js';
import { audit, bad } from './util.js';
import { scriviSede } from './sites.js';

// data.rent del contratto SEDE → campi della sede
const MAPPA = [
  ['amount', 'rent_amount', 'canone'], ['period', 'rent_period', 'periodicità'], ['vat', 'rent_vat', 'IVA'], ['deposit', 'deposit_amount', 'deposito'],
  ['duration_years', 'lease_years', 'durata (anni)'], ['renewal_years', 'lease_renewal_years', 'rinnovo (anni)'], ['notice_months', 'lease_notice_months', 'preavviso (mesi)'],
];
const vuoto = (v) => v == null || v === '';
const uguale = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a ?? '') === String(b ?? ''));

export async function businessPronto() {
  return Boolean((await one(`SELECT to_regclass('business.contracts') IS NOT NULL AND to_regclass('business.dossiers') IS NOT NULL AND to_regclass('business.contract_files') IS NOT NULL AS ok`))?.ok);
}

/** Confronto campo per campo (funzione pura, provata in test/sedeBusiness.test.mjs). Ritorna { campi, riempi } */
export function confrontoLocazione(c, sede) {
  const rent = c.data?.rent || {};
  const voci = [...MAPPA.map(([da, a, label]) => ({ campo: a, label, business: rent[da] ?? null })),
    { campo: 'lease_start', label: 'decorrenza', business: c.start_date ? String(c.start_date).slice(0, 10) : null },
    { campo: 'lease_landlord_org_id', label: 'locatore', business: c.org_id ?? null }];
  const campi = []; const riempi = {};
  const locazione = sede && sede.tenure === 'LOCAZIONE';
  for (const v of voci) {
    const sedi = sede ? sede[v.campo] ?? null : null;
    let azione;
    if (vuoto(v.business)) azione = 'niente da portare';
    else if (!sede) azione = 'sede mancante';
    else if (vuoto(sedi)) { if (locazione) { azione = 'riempi'; riempi[v.campo] = v.business; } else azione = `sede ${sede.tenure}: non si scrive`; }
    else azione = uguale(sedi, v.business) ? 'uguale' : 'diverso: vale Sedi';
    campi.push({ ...v, sedi, azione });
  }
  const testo = [rent.expenses && `spese: ${rent.expenses}`, rent.registration && `registrazione: ${rent.registration}`, rent.notes && `note: ${rent.notes}`].filter(Boolean).join('; ');
  return { campi, riempi, note: testo || null, istat: Boolean(rent.istat) };
}

/** Destinazione di un file del contratto in site_documents (funzione pura). docs = documenti già nella sede. */
export function destinazioneFile(f, docs) {
  if (docs.some((d) => d.sha256 === f.sha256)) return { kind: null, motivo: 'già nella sede (stesso contenuto)' };
  if (f.category === 'FIRMATO') return docs.some((d) => d.kind === 'CONTRATTO_LOCAZIONE') ? { kind: 'ALTRO', motivo: 'la sede ha già un contratto di locazione' } : { kind: 'CONTRATTO_LOCAZIONE' };
  if (f.category === 'PLANIMETRIA') return docs.some((d) => d.kind === 'PLANIMETRIA') ? { kind: 'ALTRO', motivo: 'la sede ha già una planimetria (resta la corrente)' } : { kind: 'PLANIMETRIA' };
  if (['GENERATO_DOCX', 'GENERATO_PDF'].includes(f.category)) return { kind: 'ALTRO', motivo: 'documento generato dal Business Hub' };
  return { kind: 'ALTRO' };
}

const LABEL_CAT = { FIRMATO: 'Contratto di locazione firmato', PLANIMETRIA: 'Planimetria', ASSICURAZIONE: 'Assicurazione', ALTRO: 'Allegato', GENERATO_DOCX: 'Contratto generato (DOCX)', GENERATO_PDF: 'Contratto generato (PDF)', LISTINO_XLSX: 'Listino', LISTINO_PDF: 'Listino' };

/** Rapporto (anche in prova) per tutti i contratti SEDE. */
export async function rapporto() {
  if (!(await businessPronto())) return { pronto: false, contratti: [] };
  const cs = await many(`SELECT c.*, o.name AS org_name FROM business.contracts c LEFT JOIN public.organizations o ON o.id=c.org_id WHERE c.kind='SEDE' ORDER BY c.id`);
  const out = [];
  for (const c of cs) {
    const sede = c.site_id ? await one('SELECT * FROM public.sites WHERE id=$1', [c.site_id]) : null;
    const files = await many('SELECT id, category, filename, mime, size, sha256, (data IS NOT NULL) AS in_db, blob_path, created_at FROM business.contract_files WHERE contract_id=$1 ORDER BY id', [c.id]);
    const docs = sede ? await many('SELECT id, kind, sha256 FROM public.site_documents WHERE site_id=$1', [sede.id]) : [];
    const piano = []; const visti = [...docs];
    for (const f of files) { const d = destinazioneFile(f, visti); piano.push({ file_id: f.id, category: f.category, filename: f.filename, size: f.size, sha256: f.sha256, ...d }); if (d.kind) visti.push({ kind: d.kind, sha256: f.sha256 }); }
    const fascicoli = await many(`SELECT d.id, d.status, d.site_id, d.org_id, coalesce(d.title, '') AS title, (SELECT count(*)::int FROM business.dossier_files x WHERE x.dossier_id=d.id) AS file FROM business.dossiers d WHERE d.contract_id=$1`, [c.id]);
    const cf = confrontoLocazione(c, sede);
    out.push({ id: c.id, protocol: c.protocol, status: c.status, title: c.title, org_name: c.org_name, site: sede ? { id: sede.id, code: sede.code, name: sede.name, tenure: sede.tenure } : null,
      file: piano, fascicoli, confronto: cf.campi, riempi: cf.riempi, note_accodate: cf.note, istat: cf.istat,
      differenze: cf.campi.filter((x) => x.azione.startsWith('diverso')).length, bloccato: !sede ? 'contratto senza sede: si sistema a mano prima di eseguire' : null });
  }
  return { pronto: true, contratti: out, vincoli: await vincoli() };
}

async function vincoli() {
  return many(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='business.contracts'::regclass AND conname IN ('contracts_kind_check','contracts_site_required_check') ORDER BY conname`);
}

/** Esegue la migrazione. Ritorna { rapporto (prima), eseguiti: [...], vincoli }. */
export async function esegui({ req }) {
  if (!(await businessPronto())) throw bad('Business Hub non avviato: nessun contratto SEDE da migrare');
  const prima = await rapporto();
  const eseguiti = [];
  for (const r of prima.contratti) {
    if (r.bloccato) { eseguiti.push({ id: r.id, protocol: r.protocol, esito: 'saltato', motivo: r.bloccato }); continue; }
    const origine = `migrazione contratto SEDE ${r.protocol || `#${r.id}`} (Business Hub)`;
    const res = await tx(async (c) => {
      const ct = (await c.query('SELECT * FROM business.contracts WHERE id=$1 AND kind=$2 FOR UPDATE', [r.id, 'SEDE'])).rows[0];
      if (!ct) return { esito: 'già migrato' };
      // 1. fascicoli staccati (restano sede e Legal entity; se mancano entrambe prende la sede del contratto)
      const fasc = (await c.query(`UPDATE business.dossiers SET site_id=coalesce(site_id, CASE WHEN org_id IS NULL THEN $2::int END), contract_id=NULL,
          extra = jsonb_set(coalesce(extra,'{}'::jsonb), '{eventi}', coalesce(extra->'eventi','[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'testo', $3::text))), updated_at=now()
          WHERE contract_id=$1 RETURNING id`, [ct.id, ct.site_id, `Contratto di locazione ${ct.protocol || `#${ct.id}`} spostato in Amministrazione > Sedi`])).rows.map((x) => x.id);
      // 2. file in site_documents, riusando data / blob_path
      const portati = [];
      for (const p of r.file) {
        if (!p.kind) { portati.push({ ...p, esito: 'saltato' }); continue; }
        const d = (await c.query(`INSERT INTO public.site_documents (site_id, kind, filename, mime, size, sha256, data, blob_path, uploaded_by, created_at, source, label, origin)
          SELECT $2, $3, f.filename, coalesce(f.mime, 'application/pdf'), f.size, f.sha256, f.data, f.blob_path, NULL, f.created_at, $4, $5, $6 FROM business.contract_files f WHERE f.id=$1
            AND NOT EXISTS (SELECT 1 FROM public.site_documents x WHERE x.site_id=$2 AND x.sha256=f.sha256) RETURNING id`,
        [p.file_id, r.site.id, p.kind, `Business Hub, contratto SEDE ${ct.protocol || `#${ct.id}`}`, LABEL_CAT[p.category] || p.category, `business.contract_files#${p.file_id}`])).rows[0];
        portati.push({ ...p, esito: d ? `in Sedi (${p.kind}, documento #${d.id})` : 'già presente', document_id: d?.id || null });
      }
      // 3. campi vuoti della locazione con la funzione unica del core (vale Sedi dove c'è un valore)
      const data = { ...r.riempi };
      if (r.note_accodate) {
        const cur = (await c.query('SELECT guarantee_notes, tenure FROM public.sites WHERE id=$1', [r.site.id])).rows[0];
        if (cur?.tenure === 'LOCAZIONE') data.guarantee_notes = [cur.guarantee_notes, `Dal contratto SEDE ${ct.protocol || `#${ct.id}`}: ${r.note_accodate}`].filter(Boolean).join('\n').slice(0, 2000);
      }
      const sede = Object.keys(data).length ? await scriviSede(c, { id: r.site.id, data, origine, req }) : null;
      // 4. traccia completa
      const eventi = (await c.query('SELECT kind, at, note, data FROM business.contract_events WHERE contract_id=$1 ORDER BY id', [ct.id]).catch(() => ({ rows: [] }))).rows;
      await audit(req, 'BUSINESS_SEDE_MIGRATED', { module: 'business', entity: 'contract', entityId: ct.id, label: `Contratto SEDE ${ct.protocol || `#${ct.id}`} migrato in Sedi`,
        data: { contratto: { id: ct.id, protocol: ct.protocol, status: ct.status, title: ct.title, org_id: ct.org_id, site_id: ct.site_id, start_date: ct.start_date, end_date: ct.end_date, data: ct.data, notes: ct.notes, signed_at: ct.signed_at }, eventi, file: portati, fascicoli: fasc, campi_riempiti: data, confronto: r.confronto } }, c);
      // 5. cancellazione diretta (i blob riusati restano)
      await c.query(`DELETE FROM business.contracts WHERE id=$1 AND kind='SEDE'`, [ct.id]);
      return { esito: 'migrato', fascicoli: fasc, file: portati, campi: data, effetti: sede?.effetti || null, planimetria: portati.some((x) => x.kind === 'PLANIMETRIA' && x.document_id) };
    });
    const dopo = res.effetti ? await res.effetti().catch((e) => ({ avvisi: [e.message] })) : null;
    if (r.istat && dopo?.lease_sync?.lease_id) await q('UPDATE finance.lease_contracts SET istat=TRUE WHERE id=$1 AND NOT istat', [dopo.lease_sync.lease_id]).catch(() => {});
    if (res.planimetria) { const { publishCurrentPlan } = await import('./roomPlan.js'); await publishCurrentPlan(r.site.id).catch(() => null); }
    eseguiti.push({ id: r.id, protocol: r.protocol, esito: res.esito, fascicoli: res.fascicoli, file: res.file, campi: res.campi, lease_sync: dopo?.lease_sync || null });
  }
  // vincoli: solo quando non resta nessun contratto SEDE
  const restano = (await one(`SELECT count(*)::int AS n FROM business.contracts WHERE kind='SEDE'`)).n;
  if (!restano) {
    await q(`ALTER TABLE business.contracts DROP CONSTRAINT IF EXISTS contracts_kind_check`);
    await q(`ALTER TABLE business.contracts ADD CONSTRAINT contracts_kind_check CHECK (kind IN ('PP','SRV','MDL'))`);
    await q(`ALTER TABLE business.contracts DROP CONSTRAINT IF EXISTS contracts_site_required_check`);
    await q(`ALTER TABLE business.contracts ADD CONSTRAINT contracts_site_required_check CHECK (kind <> 'PP' OR site_id IS NOT NULL)`);
  }
  // verifiche della sezione 5.5
  const verifiche = {
    contratti_sede: restano,
    fascicoli_senza_sede_ne_legal_entity: (await one(`SELECT count(*)::int AS n FROM business.dossiers WHERE site_id IS NULL AND org_id IS NULL`)).n,
    firmati_in_sedi: prima.contratti.flatMap((c) => c.file.filter((f) => f.category === 'FIRMATO')).length
      ? (await one(`SELECT count(*)::int AS n FROM unnest($1::text[]) s WHERE EXISTS (SELECT 1 FROM public.site_documents d WHERE d.sha256=s)`, [prima.contratti.flatMap((c) => c.file.filter((f) => f.category === 'FIRMATO').map((f) => f.sha256))])).n : 0,
    firmati_attesi: prima.contratti.flatMap((c) => c.file.filter((f) => f.category === 'FIRMATO')).length,
  };
  return { rapporto: prima, eseguiti, vincoli: await vincoli(), verifiche };
}

// ------------------------------------------------------------------ "Sedi TD in locazione" (vista in sola lettura per il Business Hub)
/** Sedi TD in LOCAZIONE con canone, scadenze, locatore, PDF e canone vigente di Finance Management (decisione 3: canone visibile a tutti gli
 *  utenti del modulo). Data ultima utile per la disdetta = fine del periodo meno il preavviso. */
export async function sediInLocazione() {
  const rows = await many(`SELECT s.id, s.code, s.name, s.city, s.province, s.kind, s.tenure, s.active, s.rent_amount, s.rent_period, s.rent_vat, s.rent_vat_rate, s.lease_start, s.lease_years,
      s.lease_renewal_years, s.lease_notice_months, s.lease_end, s.deposit_amount, lo.id AS landlord_id, lo.name AS landlord_name,
      (SELECT json_build_object('id', d.id, 'filename', d.filename, 'size', d.size, 'created_at', d.created_at) FROM site_documents d WHERE d.site_id=s.id AND d.kind='CONTRATTO_LOCAZIONE' ORDER BY d.created_at DESC LIMIT 1) AS documento,
      CASE WHEN s.lease_end IS NOT NULL AND s.lease_notice_months IS NOT NULL THEN (s.lease_end - make_interval(months => s.lease_notice_months))::date END AS disdetta_entro
    FROM sites s LEFT JOIN organizations lo ON lo.id=s.lease_landlord_org_id
    WHERE s.active AND s.kind <> 'SERVICE' AND s.tenure='LOCAZIONE' ORDER BY lower(s.name)`);
  const { registryLease } = await import('./leaseSync.js');
  const { stepAt, parseDate } = await import('../modules/finance/lib/schedule.js');
  const oggi = parseDate(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }));
  for (const r of rows) {
    const l = await registryLease(r.id).catch(() => null);
    if (!l) { r.payments = null; continue; }
    const steps = await many('SELECT valid_from, amount, reason FROM finance.lease_steps WHERE lease_id=$1 ORDER BY valid_from', [l.id]);
    const cur = stepAt(steps, oggi);
    const next = steps.find((x) => String(x.valid_from).slice(0, 10) > new Date().toISOString().slice(0, 10)) || null;
    r.payments = { lease_id: l.id, canone_vigente: cur ? Number(cur.amount) : null, prossimo_scatto: next ? { dal: String(next.valid_from).slice(0, 10), importo: Number(next.amount) } : null, period_months: l.period_months };
  }
  if (await businessPronto()) {
    for (const r of rows) r.fascicolo = await one(`SELECT id, status, authorized_at FROM business.dossiers WHERE site_id=$1 ORDER BY created_at DESC LIMIT 1`, [r.id]);
  }
  return rows;
}

/** Locazione della sede per il processo PP (flagship): avvisi non bloccanti se mancano PDF o canone (decisione 4). */
export async function locazioneSede(siteId) {
  if (!siteId) return null;
  const s = await one(`SELECT s.id, s.tenure, s.rent_amount, s.rent_period, s.lease_start, s.lease_end, lo.name AS landlord_name,
      (SELECT d.id FROM site_documents d WHERE d.site_id=s.id AND d.kind='CONTRATTO_LOCAZIONE' ORDER BY d.created_at DESC LIMIT 1) AS documento_id
    FROM sites s LEFT JOIN organizations lo ON lo.id=s.lease_landlord_org_id WHERE s.id=$1`, [siteId]);
  if (!s) return null;
  const avvisi = [];
  if (s.tenure === 'LOCAZIONE') {
    if (!s.documento_id) avvisi.push('Sede in locazione senza il contratto in PDF in Amministrazione > Sedi');
    if (s.rent_amount == null) avvisi.push('Sede in locazione senza canone in Amministrazione > Sedi');
  }
  return { ...s, avvisi };
}
