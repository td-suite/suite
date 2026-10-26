import React, { useMemo, useState } from 'react';
import { Card, Field } from './ui.jsx';
import { useApi } from './ui.jsx';
import { ORG_KIND } from './OrgExtForm.jsx';
import { SITE_KIND } from '../format.js';

// Selettori sull'anagrafica unica per contratti e fascicoli: Controparte (Legal entity, public.organizations) e Sede TD
// (public.sites con kind diverso da SERVICE). Qui si scelgono, non si creano: i pulsanti portano all'Amministrazione.

// Elenco delle sedi TD (attive più quella già selezionata) e della controparte già scelta, per i form
export function useParties(orgQ, siteEnabled = true) {
  const orgs = useApi(`/organizations${orgQ ? `?q=${encodeURIComponent(orgQ)}` : ''}`);
  const sites = useApi(siteEnabled ? '/sites?all=1' : null);
  return { orgs, sites };
}

export function OrgPicker({ orgs, value, onChange, org, label = 'Controparte', help = 'Legal entity dell’anagrafica unica della Suite', disabled }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = (orgs || []).filter((p) => (p.active || p.id === Number(value)) && (!ql || `${p.name} ${p.vat || ''} ${p.city || ''}`.toLowerCase().includes(ql)));
  return (
    <>
      <div className="form-grid">
        <Field label="Cerca nell'anagrafica"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ragione sociale, P.IVA, città" disabled={disabled} /></Field>
        <Field label={label} className="span2" help={help}>
          <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
            <option value="">Nessuna controparte</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind ? ` · ${ORG_KIND[p.kind] || p.kind}` : ''}{p.city ? ` · ${p.city}` : ''}{p.vat ? ` · ${p.vat}` : ''}</option>)}
          </select>
        </Field>
      </div>
      {org && (
        <div className="alert info small" style={{ marginTop: 12 }}>
          <b>{org.name}</b> · {[org.street, org.zip, org.city, org.prov ? `(${org.prov})` : ''].filter(Boolean).join(', ')}<br />
          P.IVA {org.vat || '–'} · C.F. {org.tax_code || org.vat || '–'} · PEC {org.pec || '–'} · SDI {org.sdi || '–'}<br />
          Legale rappresentante: {org.legal_rep || '–'}{org.signer ? ` · firmatario: ${org.signer}${org.signer_role ? ` (${org.signer_role})` : ''}` : ''}
          {(!org.vat && !org.tax_code) || !org.street || !(org.signer || org.legal_rep) ? <div className="red" style={{ marginTop: 4 }}>Dati incompleti per la generazione del documento: P.IVA o C.F. e indirizzo in Amministrazione, Legal entity, firmatario nelle impostazioni Business dell'organizzazione.</div> : null}
        </div>
      )}
    </>
  );
}

// Selettore della sede TD sull'anagrafica unica (public.sites), con ricerca per nome, codice o comune
export function SitePicker({ sites, value, onChange, site, label = 'Sede TD', help = 'sedi di Toscana Diagnostica dell’anagrafica unica (non i punti dei clienti service)', disabled }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = useMemo(() => (sites || []).filter((x) => (x.active || x.id === Number(value)) && (!ql || `${x.name} ${x.code} ${x.city || ''} ${x.address || ''}`.toLowerCase().includes(ql))), [sites, ql, value]);
  return (
    <>
      <div className="form-grid">
        <Field label="Cerca la sede"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome, codice, comune" disabled={disabled} /></Field>
        <Field label={label} className="span2" help={help}>
          <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
            <option value="">Nessuna sede</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.city ? ` · ${x.city}` : ''}{x.code ? ` · ${x.code}` : ''}{x.kind ? ` · ${SITE_KIND[x.kind] || x.kind}` : ''}</option>)}
          </select>
        </Field>
      </div>
      {site && <div className="alert info small" style={{ marginTop: 10 }}><b>{site.name}</b>{site.code ? <span className="mono muted"> · {site.code}</span> : null} · {[site.address || site.street, site.zip, site.city, (site.province || site.prov) ? `(${site.province || site.prov})` : ''].filter(Boolean).join(', ') || 'indirizzo non indicato'}{site.organization_name ? ` · ${site.organization_name}` : ''}{!(site.address || site.street) || !site.city ? <div className="red" style={{ marginTop: 4 }}>Completa indirizzo e comune della sede in Amministrazione &gt; Sedi: compaiono nel contratto e nel fascicolo.</div> : null}</div>}
    </>
  );
}

// Le due card affiancate (Controparte e Sede TD) con i pulsanti verso l'Amministrazione. Almeno una delle due va indicata.
export function PartyCards({ orgs, sites, orgId, siteId, onOrg, onSite, org, site, orgTitle = 'Controparte (Legal entity)', siteTitle = 'Sede TD', orgHelp, siteHelp, orgNote, siteNote, siteRequired, orgDisabled, siteDisabled, className = '' }) {
  return (
    <div className={`grid g2 ${className}`}>
      <Card title={orgTitle} actions={<a className="btn sm ghost" href="/admin/organizations">Apri in Legal entity</a>}>
        <OrgPicker orgs={orgs} value={orgId} onChange={onOrg} org={org} help={orgHelp} disabled={orgDisabled} />
        {orgNote && <div className="small muted" style={{ marginTop: 8 }}>{orgNote}</div>}
      </Card>
      <Card title={siteRequired ? `${siteTitle} (obbligatoria)` : siteTitle} actions={<a className="btn sm ghost" href="/admin/sites">Apri in Sedi</a>}>
        <SitePicker sites={sites} value={siteId} onChange={onSite} site={site} help={siteHelp} disabled={siteDisabled} />
        {siteNote && <div className="small muted" style={{ marginTop: 8 }}>{siteNote}</div>}
      </Card>
    </div>
  );
}
