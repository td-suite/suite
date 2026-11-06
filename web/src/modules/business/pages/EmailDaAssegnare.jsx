// Business Hub · Email da assegnare: messaggi delle caselle di linea (service@, network@, mdl@) che il job non ha saputo abbinare a un
// account (mittente sconosciuto o presente su più account). Assegnazione manuale (con "aggiungi il mittente ai referenti"), oppure
// "crea prospect" (Legal entity Cliente + account sulla linea della casella), oppure "ignora". Registro invii delle email partite.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Card, Loading, ErrorBox, Empty, Badge, Modal, Field, useToast } from '../components/ui.jsx';
import { itDateTime, LINEE, EMAIL_STATO, SOTTOTIPO } from '../format.js';

export default function EmailDaAssegnare() {
  const toast = useToast();
  // linea fissa dalla sezione del menu (?linea=SRV|PP|MDL; senza parametro = Service): una casella per linea (CEO, 06/11/2026)
  const [sp] = useSearchParams();
  const linea = ['SRV', 'PP', 'MDL'].includes(sp.get('linea')) ? sp.get('linea') : 'SRV';
  const q0 = useApi('/hub/email/da-assegnare');
  const q = { ...q0, data: q0.data ? q0.data.filter((e) => e.linea === linea) : q0.data };
  const inv = useApi(`/hub/invii?linea=${linea}`);
  const acc0 = useApi('/hub/accounts');
  const acc = { ...acc0, data: acc0.data ? { ...acc0.data, righe: (acc0.data.righe || []).filter((a) => a.linea === linea) } : acc0.data };
  const [m, setM] = useState(null);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const assegna = async () => {
    try {
      const body = m.modo === 'nuovo' ? { crea_prospect: { nome: m.nome, city: m.city }, aggiungi_referente: m.referente } : { account_id: Number(m.account_id), aggiungi_referente: m.referente };
      if (m.modo !== 'nuovo' && !m.account_id) throw new Error('Scegli l\'account');
      await api.post(`/hub/email/${m.e.id}/assegna`, body); toast('Email registrata nel diario dell\'account'); setM(null); q.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const opzioni = (acc.data?.righe || []).filter((a) => !m || !m.cerca || a.org_name.toLowerCase().includes(m.cerca.toLowerCase())).slice(0, 200);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Email da assegnare · {LINEE[linea].label}</h1><div className="sub">Messaggi arrivati alla casella della linea senza un account riconosciuto dal mittente. Assegnali: finiscono nel diario e, se vuoi, il mittente diventa un referente (le prossime email si abbinano da sole).</div></div></div>
      <Card title={`In attesa (${q.data.length})`} flush>
        {q.data.length ? <table className="t"><thead><tr><th>Casella</th><th>Ricevuta</th><th>Mittente</th><th>Oggetto e anteprima</th><th>Motivo</th><th /></tr></thead><tbody>
          {q.data.map((e) => <tr key={e.id}>
            <td><Badge tone={LINEE[e.linea]?.tone}>{LINEE[e.linea]?.short}</Badge><div className="small muted">{e.casella}</div></td>
            <td className="small">{itDateTime(e.received_at)}{e.simulato ? <div><Badge tone="grey">simulata</Badge></div> : null}</td>
            <td><div className="strong">{e.from_name || ''}</div><div className="small">{e.from_email}</div></td>
            <td><div className="strong">{e.subject || '(senza oggetto)'}</div><div className="small muted clamp2">{e.preview}</div>{e.n_allegati ? <div className="small">{e.n_allegati} allegati</div> : null}</td>
            <td className="small muted">{e.come}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm" onClick={() => setM({ e, modo: 'esistente', account_id: '', cerca: '', nome: e.from_name || '', city: '', referente: true })}>Assegna</button> <button className="btn sm ghost" onClick={async () => { await api.post(`/hub/email/${e.id}/ignora`); q.reload(); }}>Ignora</button></td>
          </tr>)}</tbody></table> : <Empty>Nessuna email da assegnare</Empty>}
      </Card>
      <Card title="Registro invii (email partite dal Business Hub)" className="mt" flush>
        {(inv.data || []).length ? <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>Data</th><th>Account</th><th>Mittente</th><th>Destinatari</th><th>Oggetto</th><th>Esito</th></tr></thead><tbody>
          {inv.data.map((x) => <tr key={x.id} className="click" onClick={() => { window.location.href = `/business/account/${x.account_id}`; }}><td className="small">{itDateTime(x.at)}</td><td className="strong">{x.org_name}</td><td className="small">{x.email_from}</td><td className="small">{x.email_to}{x.email_cc ? <div className="muted">cc {x.email_cc}</div> : null}</td><td className="small">{x.sottotipo && SOTTOTIPO[x.sottotipo] ? <><Badge tone="silk">{SOTTOTIPO[x.sottotipo]}</Badge> </> : null}{x.oggetto}{x.n_allegati ? ` · ${x.n_allegati} allegati` : ''}</td><td><Badge tone={EMAIL_STATO[x.email_stato]?.tone}>{EMAIL_STATO[x.email_stato]?.label || x.email_stato}</Badge>{x.email_errore ? <div className="small red">{x.email_errore}</div> : null}</td></tr>)}
        </tbody></table></div> : <Empty>Nessuna email inviata dal Business Hub</Empty>}
      </Card>
      {m && <Modal title={`Assegna l'email di ${m.e.from_email}`} onClose={() => setM(null)} footer={<><button className="btn ghost" onClick={() => setM(null)}>Annulla</button><button className="btn" onClick={assegna}>{m.modo === 'nuovo' ? 'Crea prospect e registra' : 'Registra nel diario'}</button></>}>
        <div className="seg" style={{ marginBottom: 12 }}>{[['esistente', 'Account esistente'], ['nuovo', 'Crea prospect']].map(([k, l]) => <label key={k} className={m.modo === k ? 'on' : ''}><input type="radio" checked={m.modo === k} onChange={() => setM({ ...m, modo: k })} />{l}</label>)}</div>
        {m.modo === 'esistente' ? <div className="form-grid">
          <Field label="Cerca" className="span2"><input value={m.cerca} onChange={(e) => setM({ ...m, cerca: e.target.value })} autoFocus /></Field>
          <Field label="Account" className="span2"><select size={8} value={m.account_id} onChange={(e) => setM({ ...m, account_id: e.target.value })}>{opzioni.map((a) => <option key={a.id} value={a.id}>{a.org_name} · {LINEE[a.linea].short}{a.citta ? ` · ${a.citta}` : ''}</option>)}</select></Field>
        </div> : <div className="form-grid">
          <Field label="Ragione sociale del prospect" className="span2"><input value={m.nome} onChange={(e) => setM({ ...m, nome: e.target.value })} /></Field>
          <Field label="Città"><input value={m.city} onChange={(e) => setM({ ...m, city: e.target.value })} /></Field>
          <div className="small muted span2">Nasce una Legal entity di tipo Cliente con l'account {LINEE[m.e.linea]?.label} (prospect).</div>
        </div>}
        <label className="f inline" style={{ marginTop: 10 }}><input type="checkbox" checked={m.referente} onChange={(e) => setM({ ...m, referente: e.target.checked })} />Aggiungi {m.e.from_email} ai referenti dell'account</label>
      </Modal>}
    </div>
  );
}
