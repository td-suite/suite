import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth, canManage } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, PromptModal, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime } from '../format.js';
import { prettyIban } from '../words.js';

export default function Beneficiaries() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = useApi(`/beneficiaries?q=${encodeURIComponent(q)}`);
  const [verify, setVerify] = useState(null);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Beneficiari e IBAN</h1><div className="sub">Anagrafica costruita dalle istanze. Ogni IBAN nuovo o variato va confermato tramite canale indipendente (telefonata al numero noto, PEC, contratto): la conferma resta registrata qui e non viene più richiesta.</div></div></div>
      <div className="filters"><Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ragione sociale o P.IVA" style={{ minWidth: 280 }} /></Field></div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : list.data.length ? (
        <table className="t"><thead><tr><th>Beneficiario</th><th>IBAN</th><th>Conferma</th><th className="num">Istanze</th><th className="num">Autorizzato</th></tr></thead>
          <tbody>{list.data.map((b) => (
            <tr key={b.id}>
              <td><div className="strong">{b.name}</div><div className="small muted mono">{b.tax_id || '–'}</div></td>
              <td>{(b.ibans || []).map((i) => <div key={i.id} className="mono small" style={{ padding: '2px 0' }}>{prettyIban(i.iban)}{i.bank ? <span className="muted"> · {i.bank}</span> : ''}</div>)}</td>
              <td>{(b.ibans || []).map((i) => <div key={i.id} style={{ padding: '2px 0' }}>{i.verified_at ? <Badge tone="green">confermato {itDate(i.verified_at)}</Badge> : canManage(user) ? <button className="btn sm ghost" onClick={() => setVerify(i)}>Registra conferma</button> : <Badge tone="red">non confermato</Badge>}{i.verified_note && <span className="small muted"> {i.verified_note}</span>}</div>)}</td>
              <td className="num">{b.requests}</td><td className="num">{eur(b.total_authorized)}</td>
            </tr>))}</tbody></table>
      ) : <Empty>Nessun beneficiario</Empty>}</Card>
      {verify && <PromptModal title={`Conferma IBAN ${prettyIban(verify.iban)}`} label="Come è stato confermato (canale indipendente)" placeholder="es. telefonata del 21/10 al n. in anagrafica fornitore, parlato con…" confirmText="Registra" onClose={() => setVerify(null)} onConfirm={async (note) => { await api.post(`/beneficiaries/ibans/${verify.id}/verify`, { note }); toast('Conferma registrata'); list.reload(); }} />}
    </div>
  );
}
