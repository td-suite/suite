import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BASE } from '../api.js';
import { useAuth, isManager } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, StatusBadge, KindBadge, useToast } from '../components/ui.jsx';
import { OrgExtModal, ORG_KIND } from '../components/OrgExtForm.jsx';
import { SITE_KIND, DOSSIER_STATUS } from '../format.js';

// Organizzazioni e sedi dell'anagrafica unica, in un elenco unico con il filtro Tipo:
// - Legal entity (public.organizations): controparti dei contratti; qui si impostano i soli campi Business (org_ext).
// - Sedi TD (public.sites con kind diverso da SERVICE): sedi dei punti prelievo, in locazione, laboratorio; oggetto dei contratti e dei fascicoli.
// Nessuna creazione o modifica anagrafica nel modulo: pulsanti "Apri in Legal entity" e "Apri in Sedi" verso l'Amministrazione.
const TYPE = { '': 'Tutti', ORG: 'Legal entity', SITE: 'Sede TD' };

export default function Organizations() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [kind, setKind] = useState('');
  const [onlyLinked, setOnlyLinked] = useState(false);
  const orgs = useApi(`/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const sites = useApi(`/sites?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [edit, setEdit] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  const rows = useMemo(() => {
    const a = (type === 'SITE' ? [] : orgs.data || []).filter((o) => !kind || o.kind === kind).map((o) => ({ ...o, type: 'ORG', key: `o${o.id}`, linked: (o.contracts || 0) + (o.dossiers || 0) }));
    const b = (type === 'ORG' || kind ? [] : sites.data || []).map((s) => ({ ...s, type: 'SITE', key: `s${s.id}`, linked: (s.contracts || 0) + (s.dossiers || 0) }));
    return [...a, ...b].filter((x) => !onlyLinked || x.linked).sort((x, y) => x.name.localeCompare(y.name, 'it'));
  }, [orgs.data, sites.data, type, kind, onlyLinked]);
  const loading = !orgs.data || !sites.data;
  const nOrg = rows.filter((x) => x.type === 'ORG').length; const nSite = rows.length - nOrg;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Organizzazioni e sedi</h1><div className="sub">Anagrafica unica della Suite. Legal entity: strutture ospitanti dei punti prelievo, locatori, clienti del service e della medicina del lavoro (qui si impostano i soli dati Business: firmatario, riferimenti, condizioni, portale). Sedi TD: le sedi di Toscana Diagnostica oggetto dei contratti e dei fascicoli di autorizzazione.</div></div>
        <div className="row"><a className="btn ghost" href="/admin/organizations">Apri in Legal entity</a><a className="btn ghost" href="/admin/sites">Apri in Sedi</a></div>
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ragione sociale, P.IVA, sede, codice, città" style={{ minWidth: 280 }} /></Field>
        <Field label="Tipo"><select value={type} onChange={(e) => { setType(e.target.value); if (e.target.value === 'SITE') setKind(''); }}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {type !== 'SITE' && <Field label="Tipo di Legal entity"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutte</option>{Object.entries(ORG_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        <Field label="Solo con contratti o fascicoli" className="inline"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> sì</Field>
        <div className="spacer" /><div className="small muted">{nOrg} legal entity · {nSite} sedi TD</div>
      </div>
      <ErrorBox error={orgs.error || sites.error} />
      <Card flush>{loading ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Codice / P.IVA</th><th>Indirizzo</th><th>Riferimenti</th><th>Business</th><th>Contratti</th><th>Fascicoli</th><th className="num">Azioni</th></tr></thead>
          <tbody>{rows.map((p) => (
            <React.Fragment key={p.key}>
              <tr className="click" onClick={() => setOpenKey(openKey === p.key ? null : p.key)}>
                {p.type === 'ORG' ? <>
                  <td><div className="strong">{p.name}</div><div className="small muted">{p.legal_rep ? `Legale rappr. ${p.legal_rep}` : ''}{p.signer && p.signer !== p.legal_rep ? ` · firma ${p.signer}` : ''}</div>{!p.active && <Badge tone="red">disattivata</Badge>}</td>
                  <td><Badge tone="grey">Legal entity</Badge> <Badge tone={p.kind === 'CLIENTE' ? 'teal' : p.kind === 'PARTNER' ? 'blue' : 'grey'}>{ORG_KIND[p.kind] || p.kind}</Badge></td>
                  <td className="mono small">{p.vat || '–'}{p.tax_code && p.tax_code !== p.vat ? <div>{p.tax_code}</div> : null}</td>
                  <td className="small">{[p.street, p.zip, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')}</td>
                  <td className="small">{p.pec && <div>PEC {p.pec}</div>}{p.email && <div>{p.email}</div>}{p.phone && <div>{p.phone}</div>}</td>
                  <td>{p.configured ? <Badge tone="green">configurata</Badge> : <span className="muted small">da configurare</span>}</td>
                </> : <>
                  <td><div className="strong">{p.name}</div><div className="small muted">{p.organization_name ? `Legal entity: ${p.organization_name}` : ''}</div>{!p.active && <Badge tone="red">disattivata</Badge>}</td>
                  <td><Badge tone="teal">Sede TD</Badge> <Badge tone="grey">{SITE_KIND[p.kind] || p.kind}</Badge></td>
                  <td className="mono small">{p.code}</td>
                  <td className="small">{[p.address, p.zip, p.city, p.province ? `(${p.province})` : ''].filter(Boolean).join(', ')}</td>
                  <td className="small">{p.email && <div>{p.email}</div>}{p.phone && <div>{p.phone}</div>}</td>
                  <td><span className="muted small">–</span></td>
                </>}
                <td>{p.contracts ? <Badge tone="teal">{p.contracts}</Badge> : <span className="muted">–</span>}</td>
                <td>{p.dossiers ? <Badge tone="mauve">{p.dossiers}</Badge> : <span className="muted">–</span>}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  <div className="row end" style={{ gap: 6 }}>
                    {p.type === 'ORG' && isManager(user) && <button className="btn sm ghost" onClick={() => setEdit(p)}>Impostazioni Business</button>}
                    {p.type === 'ORG' ? <a className="btn sm ghost" href="/admin/organizations">Apri in Legal entity</a> : <a className="btn sm ghost" href="/admin/sites">Apri in Sedi</a>}
                  </div>
                </td>
              </tr>
              {openKey === p.key && (
                <tr><td colSpan={9} style={{ background: '#fafcfc' }}>
                  {p.type === 'ORG' && <>
                    <div className="grid g4">
                      <div><div className="subhead">Referente commerciale TD</div><div className="small">{p.sales_contact || '–'}<br />{p.sales_email}<br />{p.sales_phone}</div></div>
                      <div><div className="subhead">Gestione del servizio</div><div className="small">{p.svc_contact || '–'}<br />{p.svc_email}<br />{p.svc_mobile}</div></div>
                      <div><div className="subhead">Approvvigionamento</div><div className="small">{p.proc_contact || '–'}<br />{p.proc_email}<br />{p.proc_mobile}</div></div>
                      <div><div className="subhead">Pagamento</div><div className="small">{p.pay_method || '–'} {p.pay_terms ? `· ${p.pay_terms}` : ''}<br />{p.bank_name} {p.iban ? <span className="mono">{p.iban}</span> : ''}<br />SDI {p.sdi || '–'}{p.split_payment ? ' · split payment' : ''}{p.withholding ? ' · ritenuta' : ''}</div></div>
                    </div>
                    {p.portal_url || p.portal_username ? <div className="small" style={{ marginTop: 8 }}><span className="subhead">Portale</span> {p.portal_url} · utente {p.portal_username || '–'} · password {p.has_portal_password ? 'impostata' : 'assente'}</div> : null}
                  </>}
                  {p.contract_list?.length ? <div style={{ marginTop: 10 }}><div className="subhead">Contratti</div>{p.contract_list.map((c) => <div key={c.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => nav(`${BASE}/contratti/${c.id}`)}><KindBadge kind={c.kind} /><span className="mono small">{c.protocol || `bozza #${c.id}`}</span><span className="small">{c.title}</span>{p.type === 'ORG' && c.site_name ? <span className="small muted">sede {c.site_name}</span> : null}{p.type === 'SITE' && c.org_name ? <span className="small muted">controparte {c.org_name}</span> : null}<StatusBadge status={c.status} /></div>)}</div> : null}
                  {p.dossier_list?.length ? <div style={{ marginTop: 10 }}><div className="subhead">Fascicoli di autorizzazione</div>{p.dossier_list.map((d) => <div key={d.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => nav(`${BASE}/fascicoli/${d.id}`)}><span className="small">{d.title}</span>{p.type === 'ORG' && d.site_name ? <span className="small muted">sede {d.site_name}</span> : null}{p.type === 'SITE' && d.org_name ? <span className="small muted">controparte {d.org_name}</span> : null}<Badge tone={DOSSIER_STATUS[d.status]?.tone}>{DOSSIER_STATUS[d.status]?.label}</Badge></div>)}</div> : null}
                  {!p.contract_list?.length && !p.dossier_list?.length && <div className="small muted">Nessun contratto o fascicolo collegato.</div>}
                  {p.business_notes && <div className="small muted" style={{ marginTop: 8 }}>{p.business_notes}</div>}
                </td></tr>
              )}
            </React.Fragment>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna legal entity o sede TD con questi filtri: si creano in Amministrazione (Legal entity e Sedi, anche da file XLSX).</Empty>}</Card>
      {edit && <OrgExtModal org={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); orgs.reload(); toast('Impostazioni Business salvate'); }} />}
    </div>
  );
}
