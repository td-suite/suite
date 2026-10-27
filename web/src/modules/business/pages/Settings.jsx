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
        </tbody></table>
      </Card>
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
