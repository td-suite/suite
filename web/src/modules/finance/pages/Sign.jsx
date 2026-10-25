// Pagina di firma raggiunta dal link personale ricevuto via email
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../api.js';
import { base } from '../paths.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, TierBadge, useToast } from '../components/ui.jsx';
import { eur, itDateTime, ROLE_SIGNER } from '../format.js';
import { RequestView } from './RequestDetail.jsx';

export default function Sign() {
  const { token } = useParams();
  const { user, authMethod, logout } = useAuth();
  const toast = useToast();
  const st = useApi(`/sign/${token}`);
  const [done, setDone] = useState(null);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (st.error) return <div className="page"><ErrorBox error={st.error} /></div>;
  if (!st.data) return <div className="page"><Loading /></div>;
  const { ok, problem, needEntra, role, request: r } = st.data;
  const sign = async () => {
    setBusy(true); setErr(null);
    try { const out = await api.post(`/sign/${token}`); setDone(out); toast('Firma registrata'); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const doReject = async () => {
    setBusy(true); setErr(null);
    try { const out = await api.post(`/sign/${token}/reject`, { reason }); setDone({ ...out, rejected: true }); toast('Rifiuto registrato'); } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Firma dell'autorizzazione al pagamento</h1>
          <div className="sub">{r ? <>{r.protocol} · {r.beneficiary_name} · <b>{eur(r.amount)}</b> · <StatusBadge status={r.status} /> <TierBadge tier={r.tier} /></> : 'Link di firma'}</div>
        </div>
        {r && <Link className="btn ghost" to={`${base}/istanze/${r.id}`}>Apri la scheda completa</Link>}
      </div>
      {done ? (
        <div className={`alert ${done.rejected ? 'warn' : 'ok'}`} style={{ flexDirection: 'column', gap: 6 }}>
          <b>{done.rejected ? 'Rifiuto registrato.' : done.completed ? 'Firma registrata. Tutte le firme richieste sono state apposte: l\'istanza è autorizzata.' : 'Firma registrata. L\'istanza resta in attesa dell\'altra firma.'}</b>
          {!done.rejected && <span>Firmato da {user.full_name} il {itDateTime(done.signed_at)} con accesso {authMethod === 'ENTRA' ? 'Microsoft 365' : 'locale'}. {done.completed ? 'Finance Support e i firmatari ricevono il modulo PDF via email.' : ''}</span>}
          <span><Link to={`${base}/istanze/${done.request.id}`}>Vai alla scheda dell'istanza</Link> · <Link to={base}>Dashboard</Link></span>
        </div>
      ) : !ok ? (
        <div className="alert err" style={{ flexDirection: 'column', gap: 8 }}>
          <b>Non è possibile firmare da questo link.</b><span>{problem}</span>
          {needEntra && <span><button className="btn sm" onClick={async () => { await logout(); window.location.href = `/api/auth/entra/login?next=${encodeURIComponent(`${base}/firma/${token}`)}`; }}>Esci e accedi con Microsoft 365</button></span>}
          {r && <span><Link to={`${base}/istanze/${r.id}`}>Apri comunque la scheda dell'istanza</Link></span>}
        </div>
      ) : (
        <>
          <div className="alert info" style={{ marginBottom: 16 }}>
            Stai per firmare in qualità di <b>{ROLE_SIGNER[role]}</b> con l'account <b>{user.email}</b> (accesso {authMethod === 'ENTRA' ? 'Microsoft 365' : 'locale'}). Verifica i dati: con la firma dichiari di autorizzare il pagamento descritto, nei limiti dei poteri conferiti dal CdA. Data, ora, identità e impronta del contenuto vengono registrate.
          </div>
          {r.aggregation?.warning && <div className="alert err" style={{ marginBottom: 16 }}><b>Controllo anti-frazionamento.</b> {r.aggregation.warning}</div>}
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <RequestView r={r} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="totals">
                <div className="line"><span>Importo</span><b>{eur(r.amount)}</b></div>
                <div className="line"><span>Beneficiario</span><b>{r.beneficiary_name}</b></div>
                <div className="line"><span>Firme richieste</span><b>{r.required_signers.map((x) => x).join(' + ')}</b></div>
                <div className="line"><span>Già firmata da</span><b>{r.signatures.filter((s) => s.valid).map((s) => s.role).join(', ') || 'nessuno'}</b></div>
                <div className="big"><span>Tu firmi come</span><span className="v" style={{ fontSize: 18 }}>{role}</span></div>
                <ErrorBox error={err} />
                {!reject ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <button className="btn lg" disabled={busy} onClick={sign} style={{ background: 'var(--silk)', color: 'var(--jet)' }}>Firmo e autorizzo il pagamento</button>
                    <button className="btn ghost" disabled={busy} onClick={() => setReject(true)}>Rifiuto con motivazione</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <Field label={<span style={{ color: '#d7e9ec' }}>Motivazione del rifiuto</span>}><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="es. importo non coerente con il contratto; manca la delibera; IBAN non confermato" /></Field>
                    <button className="btn danger" disabled={busy || reason.trim().length < 5} onClick={doReject}>Conferma il rifiuto</button>
                    <button className="btn ghost" disabled={busy} onClick={() => setReject(false)}>Torna indietro</button>
                  </div>
                )}
              </div>
              <Card title="Documentazione di supporto">
                {r.attachments.length ? r.attachments.map((a) => <div key={a.id} style={{ padding: '4px 0' }}><a href={fileUrl(`/attachments/${a.id}`)} target="_blank" rel="noreferrer">{a.filename}</a></div>) : <span className="muted small">Nessun allegato</span>}
              </Card>
              <Card title="Cronologia">
                <ul className="timeline">{r.events.map((e) => <li key={e.id}><div className="ev">{e.kind}{e.user_name ? ` · ${e.user_name}` : ''}</div><div className="small muted">{itDateTime(e.at)}</div>{e.note && <div className="small">{e.note}</div>}</li>)}</ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
