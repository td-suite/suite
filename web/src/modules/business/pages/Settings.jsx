import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, useToast } from '../components/ui.jsx';

const GROUPS = [
  { title: 'Società (intestazioni e firme dei documenti)', note: 'Ragione sociale, sede legale, P.IVA, codice fiscale, capitale, telefono, fax e PEC vengono dai Dati aziendali della Suite (Amministrazione, Impostazioni) e qui sono in sola lettura.', fields: [['company_name', 'Ragione sociale'], ['company_legal_address', 'Sede legale (come compare nei contratti)'], ['company_city', 'Città di sottoscrizione'], ['company_prov', 'Provincia'], ['company_vat', 'Partita IVA'], ['company_tax_code', 'Codice fiscale'], ['company_capital', 'Capitale sociale (DVR)'], ['company_phone', 'Telefono'], ['company_fax', 'Fax'], ['company_pec', 'PEC'], ['lab_address', 'Indirizzo del Laboratorio di Analisi (collegamento funzionale)']] },
  { title: 'Legale rappresentante (Modello 5, dichiarazioni, DVR e DUVRI)', note: 'I dati anagrafici compaiono solo nei documenti generati; restano nel database dell’app e non nel registro attività.', fields: [['lr_name', 'Nome e cognome'], ['lr_title', 'Titolo (dott.)'], ['lr_role', 'Ruolo (in inglese, firme delle offerte)'], ['lr_role_it', 'Ruolo (in italiano, atti e dichiarazioni)'], ['lr_birth_place', 'Luogo di nascita'], ['lr_birth_date', 'Data di nascita (gg/mm/aaaa)'], ['lr_residence', 'Residenza (comune, via, civico)'], ['lr_tax_code', 'Codice fiscale'], ['lr_phone', 'Recapito telefonico'], ['lr_email', 'E-mail']] },
  { title: 'Direttore Sanitario (Modello 6)', fields: [['ds_name', 'Nome e cognome'], ['ds_title', 'Titolo (prof., dott.)'], ['ds_birth_place', 'Luogo di nascita'], ['ds_birth_date', 'Data di nascita (gg/mm/aaaa)'], ['ds_residence', 'Residenza'], ['ds_tax_code', 'Codice fiscale'], ['ds_phone', 'Telefono'], ['ds_email', 'E-mail'], ['ds_weekly_hours', 'Impegno orario settimanale (ore)'], ['ds_degree', 'Laurea (titolo, ateneo, data)', 'wide'], ['ds_specialization', 'Specializzazione (titolo, ateneo, data)', 'wide'], ['ds_registration', 'Iscrizione all’Ordine (provincia, numero, data)', 'wide']] },
  { title: 'Sicurezza (DVR, DUVRI, Atto di condivisione)', fields: [['rspp_name', 'RSPP'], ['rls_name', 'RLS'], ['mc_name', 'Medico Competente Coordinatore']] },
  { title: 'Contratti', fields: [['protocol_prefix_PP', 'Prefisso protocollo Punti Prelievo'], ['protocol_prefix_SRV', 'Prefisso protocollo Service'], ['protocol_prefix_MDL', 'Prefisso protocollo Medicina del Lavoro'], ['pp_duration_years', 'Durata predefinita dei contratti PP (anni)'], ['payment_terms_default', 'Termini di pagamento predefiniti (offerte)', 'wide'], ['portal_url_default', 'Indirizzo predefinito del portale clienti', 'wide'], ['dirty_clean_default', 'Testo predefinito della dichiarazione sporco/pulito', 'wide'], ['duvri_costs_default', 'Testo predefinito dell’Allegato 2 (costi della sicurezza)', 'wide']] },
];

export default function Settings() {
  const toast = useToast();
  const cfg = useApi('/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (cfg.data) setF({ ...cfg.data.settings }); }, [cfg.data]);
  const save = async () => { try { await api.put('/settings', f); toast('Impostazioni salvate'); cfg.reload(); } catch (e) { toast(e.message, 'err'); } };
  if (!f || !cfg.data) return <div className="page">{cfg.error ? <ErrorBox error={cfg.error} /> : <Loading />}</div>;
  const d = cfg.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Dati che compaiono nei documenti generati, prefissi di protocollo, testi predefiniti, stato dei servizi.</div></div><button className="btn" onClick={save}>Salva impostazioni</button></div>
      <Card title="Stato dei servizi">
        <table className="t"><tbody>
          <tr><td>Accesso e utenti</td><td><Badge tone="green">gestiti dalla Suite TD (profili del modulo)</Badge></td></tr>
          <tr><td>Conversione PDF (LibreOffice)</td><td>{d.pdfEnabled ? <Badge tone="green">disponibile</Badge> : <Badge tone="red">non disponibile: i documenti vengono generati solo in DOCX</Badge>}</td></tr>
          <tr><td>Cifratura delle credenziali dei portali</td><td>{d.credentialsKeySet ? <Badge tone="green">chiave dedicata (CREDENTIALS_KEY)</Badge> : <Badge tone="mauve">chiave di sviluppo: imposta CREDENTIALS_KEY (la stessa dell'app di origine) in produzione</Badge>}</td></tr>
          <tr><td>Dimensione massima dei file</td><td>{d.maxUploadMb} MB</td></tr>
          <tr><td>Archivio dei documenti</td><td>{d.storage === 'blob' ? <Badge tone="green">Azure Blob Storage (nel database solo i metadati)</Badge> : <Badge tone="mauve">database: configura AZURE_STORAGE_CONNECTION_STRING per i fascicoli e i pacchetti di caricamento</Badge>}</td></tr>
        </tbody></table>
      </Card>
      <ImportPack storage={d.storage} />
      {GROUPS.map((g) => (
        <Card key={g.title} title={g.title} className="mt">
          {g.note && <div className="small muted" style={{ marginBottom: 10 }}>{g.note}</div>}
          <div className="form-grid">
            {g.fields.map(([k, label, wide]) => (d.coreKeys || []).includes(k)
              ? <Field key={k} label={label} className={wide ? 'span2' : ''} help={<>Dai Dati aziendali della Suite: si modifica in <a href="/admin/settings">Amministrazione, Impostazioni</a></>}><input value={f[k] ?? ''} disabled /></Field>
              : <Field key={k} label={label} className={wide ? 'span2' : ''} help={f[k] !== d.defaults[k] && d.defaults[k] ? 'modificato rispetto al valore predefinito' : ''}>{wide && String(f[k] || '').length > 80 ? <textarea value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ minHeight: 56 }} /> : <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
          </div>
        </Card>
      ))}
      <div className="row end" style={{ marginTop: 16 }}><button className="btn lg" onClick={save}>Salva impostazioni</button></div>
    </div>
  );
}


// Caricamento dello status quo dai pacchetti ZIP preparati dalle cartelle OneDrive (manifest.json + files/): prova senza scrivere, poi importa
function ImportPack({ storage }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [rep, setRep] = useState(null);
  const runs = useApi('/import/runs');
  // più pacchetti insieme: si caricano in sequenza (nell'ordine dei nomi) e il rapporto somma i risultati
  const uniq = (list) => { const seen = new Set(); return list.filter((x) => { const k = x.key || x.name; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const merge = (a, b) => !a ? b : { ...b, organizations: { matched: uniq([...a.organizations.matched, ...b.organizations.matched]), created: uniq([...a.organizations.created, ...b.organizations.created]) },
    contracts: { created: a.contracts.created + b.contracts.created, updated: a.contracts.updated + b.contracts.updated, skipped: [...a.contracts.skipped, ...b.contracts.skipped] },
    dossiers: { created: a.dossiers.created + b.dossiers.created, updated: a.dossiers.updated + b.dossiers.updated, skipped: [...a.dossiers.skipped, ...b.dossiers.skipped] },
    files: { stored: a.files.stored + b.files.stored, skipped_existing: a.files.skipped_existing + b.files.skipped_existing, missing: [...a.files.missing, ...b.files.missing], bytes: a.files.bytes + b.files.bytes, planned: (a.files.planned || 0) + (b.files.planned || 0) },
    warnings: [...a.warnings, ...b.warnings] };
  const run = async (dry) => {
    if (!files.length) return toast('Scegli uno o più pacchetti ZIP', 'err');
    setBusy(dry ? 'dry' : 'go'); setRep(null);
    let acc = null; let n = 0;
    const list = [...files].sort((x, y) => x.name.localeCompare(y.name));
    for (const f of list) {
      n++; setProgress(`${n} di ${list.length}: ${f.name}`);
      try { const fd = new FormData(); fd.append('file', f); fd.append('dry_run', dry ? '1' : '0'); const r = await api.upload('/import/pack', fd); acc = merge(acc, r); setRep(acc); }
      catch (e) { toast(`${f.name}: ${e.message}`, 'err'); acc = merge(acc, { organizations: { matched: [], created: [] }, contracts: { created: 0, updated: 0, skipped: [] }, dossiers: { created: 0, updated: 0, skipped: [] }, files: { stored: 0, skipped_existing: 0, missing: [], bytes: 0 }, warnings: [`${f.name}: ${e.message}`], dry_run: dry }); setRep(acc); }
    }
    setProgress(''); toast(dry ? 'Prova completata: controlla il piano' : 'Caricamento completato'); runs.reload();
    setBusy('');
  };
  const Num = ({ k, v }) => <div className="kpi"><div className="lbl">{k}</div><div className="val">{v}</div></div>;
  return (
    <Card title="Caricamento dello status quo (pacchetti)" className="mt">
      <div className="small muted" style={{ marginBottom: 10 }}>Pacchetti ZIP preparati dalle cartelle OneDrive (Punti Prelievo e Centri Medici, Service di Laboratorio, Medicina del Lavoro, Autorizzazioni Sanitarie): controparti come Legal entity, contratti con documenti, fascicoli di autorizzazione per sede TD. Ripetere un pacchetto non duplica nulla. Prima "Prova" mostra il piano (abbinamenti di sedi e organizzazioni, cosa manca) senza scrivere; poi "Importa".{storage !== 'blob' && <> <strong>Archivio file non configurato:</strong> si accettano solo pacchetti piccoli.</>}</div>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".zip" multiple onChange={(e) => setFiles([...e.target.files])} />
        <button className="btn ghost" disabled={!files.length || Boolean(busy)} onClick={() => run(true)}>{busy === 'dry' ? 'Verifico…' : 'Prova (senza scrivere)'}</button>
        <button className="btn" disabled={!files.length || Boolean(busy)} onClick={() => run(false)}>{busy === 'go' ? 'Carico…' : `Importa${files.length > 1 ? ` (${files.length} pacchetti)` : ''}`}</button>
        {progress && <span className="small muted">{progress}</span>}
      </div>
      {rep && (
        <div className="mt">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Num k="Legal entity abbinate" v={rep.organizations.matched.length} /><Num k="Legal entity nuove" v={rep.organizations.created.length} />
            <Num k={rep.dry_run ? 'Contratti da creare' : 'Contratti creati'} v={rep.contracts.created} /><Num k={rep.dry_run ? 'Contratti da aggiornare' : 'Contratti aggiornati'} v={rep.contracts.updated} />
            <Num k={rep.dry_run ? 'Fascicoli da creare' : 'Fascicoli creati'} v={rep.dossiers.created} /><Num k={rep.dry_run ? 'Fascicoli da aggiornare' : 'Fascicoli aggiornati'} v={rep.dossiers.updated} />
            <Num k={rep.dry_run ? 'Documenti previsti' : 'Documenti caricati'} v={rep.dry_run ? rep.files.planned : rep.files.stored} />{!rep.dry_run && <Num k="Documenti già presenti" v={rep.files.skipped_existing} />}
          </div>
          {rep.contracts.skipped.length > 0 && <div className="mt"><div className="strong">Contratti non caricati ({rep.contracts.skipped.length})</div><ul className="small">{rep.contracts.skipped.map((x, i) => <li key={i}><strong>{x.title || x.key}</strong>: {x.reason}</li>)}</ul></div>}
          {rep.dossiers.skipped.length > 0 && <div className="mt"><div className="strong">Fascicoli non caricati ({rep.dossiers.skipped.length})</div><ul className="small">{rep.dossiers.skipped.map((x, i) => <li key={i}><strong>{x.title || x.key}</strong>: {x.reason}</li>)}</ul></div>}
          {rep.organizations.matched.length > 0 && <details className="mt"><summary className="small">Legal entity abbinate a quelle esistenti ({rep.organizations.matched.length})</summary><ul className="small">{rep.organizations.matched.map((x, i) => <li key={i}>{x.name} → <strong>{x.org_name}</strong> ({x.how})</li>)}</ul></details>}
          {rep.organizations.created.length > 0 && <details className="mt"><summary className="small">Legal entity {rep.dry_run ? 'da creare' : 'create'} ({rep.organizations.created.length})</summary><ul className="small">{rep.organizations.created.map((x, i) => <li key={i}>{x.name} ({x.kind}{x.vat_number ? `, P.IVA ${x.vat_number}` : ''})</li>)}</ul></details>}
          {rep.warnings.length > 0 && <details className="mt"><summary className="small">Dettagli e avvisi ({rep.warnings.length})</summary><ul className="small">{rep.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {rep.files.missing.length > 0 && <div className="mt small" style={{ color: 'var(--red)' }}>File indicati nel manifesto ma assenti nello zip: {rep.files.missing.length}</div>}
        </div>
      )}
      {runs.data?.length > 0 && <details className="mt"><summary className="small">Caricamenti precedenti ({runs.data.length})</summary><table className="t small"><tbody>{runs.data.map((x) => <tr key={x.id}><td>{new Date(x.at).toLocaleString('it-IT')}</td><td>{x.filename}</td><td>{x.dry_run ? 'prova' : 'caricamento'}</td><td>{x.user_name}</td><td>{x.summary?.contracts ? `${x.summary.contracts.created + x.summary.contracts.updated} contratti, ${x.summary.dossiers.created + x.summary.dossiers.updated} fascicoli, ${x.summary.files?.stored ?? x.summary.files?.planned ?? 0} documenti` : ''}</td></tr>)}</tbody></table></details>}
    </Card>
  );
}
