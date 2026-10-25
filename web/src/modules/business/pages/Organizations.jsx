import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BASE } from '../api.js';
import { useAuth, isManager } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, StatusBadge, KindBadge, useToast } from '../components/ui.jsx';
import { OrgExtModal, ORG_KIND } from '../components/OrgExtForm.jsx';

// Organizzazioni dell'anagrafica unica (public.organizations): qui si leggono e si impostano i soli campi Business (org_ext).
// Creazione, rinomina e disattivazione si fanno in Amministrazione > Organizzazioni.
export default function Organizations() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [onlyContracts, setOnlyContracts] = useState(false);
  const params = new URLSearchParams(Object.entries({ q, kind }).filter(([, v]) => v));
  const list = useApi(`/organizations${params.toString() ? `?${params}` : ''}`);
  const [edit, setEdit] = useState(null);
  const [openId, setOpenId] = useState(null);
  const rows = (list.data || []).filter((o) => !onlyContracts || o.contracts);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Organizzazioni</h1><div className="sub">Anagrafica unica della Suite: strutture ospitanti dei punti prelievo, locatori, clienti del service e della medicina del lavoro. Qui si impostano i soli dati Business (firmatario, riferimenti, condizioni, portale, tracciato TD-SGI-MOD173).</div></div>
        <a className="btn ghost" href="/admin/organizations">Apri in Amministrazione</a>
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ragione sociale, P.IVA, città" style={{ minWidth: 280 }} /></Field>
        <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutte</option>{Object.entries(ORG_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Solo con contratti" className="inline"><input type="checkbox" checked={onlyContracts} onChange={(e) => setOnlyContracts(e.target.checked)} /> sì</Field>
        <div className="spacer" /><div className="small muted">{rows.length} organizzazioni</div>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Ragione sociale</th><th>Tipo</th><th>P.IVA / C.F.</th><th>Sede</th><th>Riferimenti</th><th>Business</th><th>Contratti</th><th className="num">Azioni</th></tr></thead>
          <tbody>{rows.map((p) => (
            <React.Fragment key={p.id}>
              <tr className="click" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <td><div className="strong">{p.name}</div><div className="small muted">{p.legal_rep ? `Legale rappr. ${p.legal_rep}` : ''}{p.signer && p.signer !== p.legal_rep ? ` · firma ${p.signer}` : ''}</div>{!p.active && <Badge tone="red">disattivata</Badge>}</td>
                <td><Badge tone={p.kind === 'CLIENTE' ? 'teal' : p.kind === 'PARTNER' ? 'blue' : 'grey'}>{ORG_KIND[p.kind] || p.kind}</Badge></td>
                <td className="mono small">{p.vat || '–'}{p.tax_code && p.tax_code !== p.vat ? <div>{p.tax_code}</div> : null}</td>
                <td className="small">{[p.street, p.zip, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')}</td>
                <td className="small">{p.pec && <div>PEC {p.pec}</div>}{p.email && <div>{p.email}</div>}{p.phone && <div>{p.phone}</div>}</td>
                <td>{p.configured ? <Badge tone="green">configurata</Badge> : <span className="muted small">da configurare</span>}</td>
                <td>{p.contracts ? <Badge tone="teal">{p.contracts}</Badge> : <span className="muted">–</span>}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{isManager(user) && <button className="btn sm ghost" onClick={() => setEdit(p)}>Impostazioni Business</button>}</td>
              </tr>
              {openId === p.id && (
                <tr><td colSpan={8} style={{ background: '#fafcfc' }}>
                  <div className="grid g4">
                    <div><div className="subhead">Referente commerciale TD</div><div className="small">{p.sales_contact || '–'}<br />{p.sales_email}<br />{p.sales_phone}</div></div>
                    <div><div className="subhead">Gestione del servizio</div><div className="small">{p.svc_contact || '–'}<br />{p.svc_email}<br />{p.svc_mobile}</div></div>
                    <div><div className="subhead">Approvvigionamento</div><div className="small">{p.proc_contact || '–'}<br />{p.proc_email}<br />{p.proc_mobile}</div></div>
                    <div><div className="subhead">Pagamento</div><div className="small">{p.pay_method || '–'} {p.pay_terms ? `· ${p.pay_terms}` : ''}<br />{p.bank_name} {p.iban ? <span className="mono">{p.iban}</span> : ''}<br />SDI {p.sdi || '–'}{p.split_payment ? ' · split payment' : ''}{p.withholding ? ' · ritenuta' : ''}</div></div>
                  </div>
                  {p.portal_url || p.portal_username ? <div className="small" style={{ marginTop: 8 }}><span className="subhead">Portale</span> {p.portal_url} · utente {p.portal_username || '–'} · password {p.has_portal_password ? 'impostata' : 'assente'}</div> : null}
                  {p.contract_list?.length ? <div style={{ marginTop: 10 }}><div className="subhead">Contratti</div>{p.contract_list.map((c) => <div key={c.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => nav(`${BASE}/contratti/${c.id}`)}><KindBadge kind={c.kind} /><span className="mono small">{c.protocol || `bozza #${c.id}`}</span><span className="small">{c.title}</span><StatusBadge status={c.status} /></div>)}</div> : null}
                  {p.business_notes && <div className="small muted" style={{ marginTop: 8 }}>{p.business_notes}</div>}
                </td></tr>
              )}
            </React.Fragment>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna organizzazione: si creano in Amministrazione &gt; Organizzazioni (anche da file XLSX).</Empty>}</Card>
      {edit && <OrgExtModal org={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Impostazioni Business salvate'); }} />}
    </div>
  );
}
