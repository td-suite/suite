import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, isManager } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, StatusBadge, KindBadge, useToast, ConfirmModal } from '../components/ui.jsx';
import { PartnerModal } from '../components/PartnerForm.jsx';

export default function Partners() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = useApi(`/partners${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [openId, setOpenId] = useState(null);
  const rows = list.data || [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Partner e clienti B2B</h1><div className="sub">Anagrafica unica sul tracciato TD-SGI-MOD173: strutture ospitanti dei punti prelievo, laboratori e strutture clienti del service, imprese della medicina del lavoro.</div></div>
        {isManager(user) && <button className="btn" onClick={() => setEdit({})}>+ Nuova anagrafica</button>}
      </div>
      <div className="filters"><Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ragione sociale, P.IVA, città" style={{ minWidth: 280 }} /></Field><div className="spacer" /><div className="small muted">{rows.length} anagrafiche</div></div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Ragione sociale</th><th>P.IVA / C.F.</th><th>Sede</th><th>Riferimenti</th><th>Contratti</th><th className="num">Azioni</th></tr></thead>
          <tbody>{rows.map((p) => (
            <React.Fragment key={p.id}>
              <tr className="click" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <td><div className="strong">{p.name}</div><div className="small muted">{p.legal_rep ? `Legale rappr. ${p.legal_rep}` : ''}{p.signer && p.signer !== p.legal_rep ? ` · firma ${p.signer}` : ''}</div>{!p.active && <Badge tone="red">disattivata</Badge>}</td>
                <td className="mono small">{p.vat || '–'}{p.tax_code && p.tax_code !== p.vat ? <div>{p.tax_code}</div> : null}</td>
                <td className="small">{[p.street, p.zip, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')}</td>
                <td className="small">{p.pec && <div>PEC {p.pec}</div>}{p.email && <div>{p.email}</div>}{p.phone && <div>{p.phone}</div>}</td>
                <td>{p.contracts ? <Badge tone="teal">{p.contracts}</Badge> : <span className="muted">–</span>}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{isManager(user) && <><button className="btn sm ghost" onClick={() => setEdit(p)}>Modifica</button> {!p.contracts && <button className="btn sm danger" onClick={() => setDel(p)}>Elimina</button>}</>}</td>
              </tr>
              {openId === p.id && (
                <tr><td colSpan={6} style={{ background: '#fafcfc' }}>
                  <div className="grid g3">
                    <div><div className="subhead">Gestione del servizio</div><div className="small">{p.svc_contact || '–'}<br />{p.svc_email}<br />{p.svc_mobile}</div></div>
                    <div><div className="subhead">Approvvigionamento</div><div className="small">{p.proc_contact || '–'}<br />{p.proc_email}<br />{p.proc_mobile}</div></div>
                    <div><div className="subhead">Pagamento</div><div className="small">{p.pay_method || '–'} {p.pay_terms ? `· ${p.pay_terms}` : ''}<br />{p.bank_name} {p.iban ? <span className="mono">{p.iban}</span> : ''}<br />SDI {p.sdi || '–'}{p.split_payment ? ' · split payment' : ''}{p.withholding ? ' · ritenuta' : ''}</div></div>
                  </div>
                  {p.contract_list?.length ? <div style={{ marginTop: 10 }}><div className="subhead">Contratti</div>{p.contract_list.map((c) => <div key={c.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => nav(`${BASE}/contratti/${c.id}`)}><KindBadge kind={c.kind} /><span className="mono small">{c.protocol || `bozza #${c.id}`}</span><span className="small">{c.title}</span><StatusBadge status={c.status} /></div>)}</div> : null}
                  {p.notes && <div className="small muted" style={{ marginTop: 8 }}>{p.notes}</div>}
                </td></tr>
              )}
            </React.Fragment>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna anagrafica</Empty>}</Card>
      {edit && <PartnerModal partner={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Anagrafica salvata'); }} />}
      {del && <ConfirmModal danger title="Elimina anagrafica" text={`Eliminare ${del.name}? L'operazione è possibile solo senza contratti collegati.`} confirmText="Elimina" onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/partners/${del.id}`); list.reload(); toast('Anagrafica eliminata'); }} />}
    </div>
  );
}
