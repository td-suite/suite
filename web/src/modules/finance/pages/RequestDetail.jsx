import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../api.js';
import { base } from '../paths.js';
import { useAuth, canManage } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, TierBadge, Modal, ConfirmModal, PromptModal, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime, bytes, today, DOC_TYPE, PAY_METHOD, CHECKS, ROLE_SIGNER, EVENT, STATUS } from '../format.js';
import { amountToWords, prettyIban } from '../words.js';

function Row({ k, v, mono }) { return <tr><td className="muted small" style={{ width: 220 }}>{k}</td><td className={mono ? 'mono' : ''}>{v || <span className="muted">–</span>}</td></tr>; }

export function RequestView({ r }) {
  const c = r.checks || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="1. Dati del pagamento" flush>
        <table className="t"><tbody>
          <Row k="Protocollo" v={r.protocol} mono /><Row k="Data richiesta" v={itDate(r.request_date)} /><Row k="Richiedente / Funzione" v={r.requester} /><Row k="Centro di costo / voce di budget" v={r.cost_center} />
          <Row k="Beneficiario" v={<b>{r.beneficiary_name}</b>} /><Row k="P.IVA / Codice Fiscale" v={r.beneficiary_tax_id} mono /><Row k="IBAN" v={prettyIban(r.beneficiary_iban)} mono /><Row k="Banca / BIC" v={[r.beneficiary_bank, r.beneficiary_bic].filter(Boolean).join(' · ')} />
          <Row k="Importo" v={<b style={{ fontSize: 16 }}>{eur(r.amount)}</b>} /><Row k="Importo in lettere" v={`Euro ${amountToWords(r.amount)}`} /><Row k="Causale" v={r.purpose} />
          <Row k="Documento di riferimento" v={`${DOC_TYPE[r.doc_type]}${r.doc_other ? ` (${r.doc_other})` : ''}${r.doc_number ? ` n. ${r.doc_number}` : ''}${r.doc_date ? ` del ${itDate(r.doc_date)}` : ''}`} />
          <Row k="Conto di addebito" v={r.debit_account} /><Row k="Modalità di pagamento" v={`${PAY_METHOD[r.payment_method]}${r.payment_method_other ? ` (${r.payment_method_other})` : ''}`} /><Row k="Data valuta / esecuzione richiesta" v={r.value_date ? itDate(r.value_date) : ''} />
        </tbody></table>
      </Card>
      <Card title="2. Scaglione applicabile" flush>
        <table className="t"><tbody>
          <Row k="Scaglione" v={<TierBadge tier={r.tier} />} />
          <Row k="Firme richieste" v={(r.required_signers || []).map((x) => ROLE_SIGNER[x]).join(' + ')} />
          {r.tier === 'CDA' && <Row k="Delibera CdA" v={r.board_number ? `n. ${r.board_number} del ${itDate(r.board_date)}` : ''} />}
          <Row k="Già specificamente approvato" v={r.prior_approval ? `Sì · ${r.prior_approval_ref}` : 'No'} />
        </tbody></table>
      </Card>
      <Card title="3. Verifiche preliminari" flush>
        <table className="t"><tbody>
          {CHECKS.map(([k, label]) => <tr key={k}><td style={{ width: 40, fontSize: 18 }}>{c[k] ? '☒' : '☐'}</td><td className={c[k] ? '' : 'muted'}>{label}</td></tr>)}
          {r.new_iban && <tr><td /><td><Badge tone={r.iban_verified_note ? 'green' : 'red'}>IBAN nuovo o variato</Badge> {r.iban_verified_note ? <span className="small">Conferma: {r.iban_verified_note}</span> : <span className="small red">conferma via canale indipendente non indicata</span>}</td></tr>}
        </tbody></table>
      </Card>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const req = useApi(`/requests/${id}`);
  const cfg = useApi('/settings');   // stato dei servizi (conversione PDF)
  const r = req.data;
  const [modal, setModal] = useState(null); // submit | cancel | execute | links
  const [links, setLinks] = useState(null);
  const [exec, setExec] = useState({ executed_at: today(), cro_trn: '', executed_by: user.full_name });
  const [err, setErr] = useState(null);
  const fileRef = useRef();
  useEffect(() => { if (sp.get('invia') && r?.editable) { setModal('submit'); sp.delete('invia'); setSp(sp, { replace: true }); } }, [r]); // eslint-disable-line
  if (req.error) return <div className="page"><ErrorBox error={req.error} /></div>;
  if (!r) return <div className="page"><Loading /></div>;
  const manager = canManage(user);
  const closed = ['ESEGUITA', 'ANNULLATA'].includes(r.status);
  const act = async (fn, msg) => { setErr(null); try { const out = await fn(); if (out?.links && Object.keys(out.links).length) setLinks(out.links); toast(msg); req.reload(); } catch (e) { setErr(e); req.reload(); throw e; } };
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData(); for (const f of files) fd.append('files', f);
    try { await api.upload(`/requests/${id}/attachments`, fd); toast('Allegati caricati'); req.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const agg = r.status === 'IN_FIRMA' && r.aggregation ? r.aggregation : r.aggregation_live;
  const pdfOff = cfg.data && cfg.data.pdfEnabled === false;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><h1>{r.protocol || `Bozza #${r.id}`}</h1><StatusBadge status={r.status} /><TierBadge tier={r.tier} />{r.version > 1 && <Badge tone="grey">v{r.version}</Badge>}</div>
          <div className="sub">{r.beneficiary_name} · {eur(r.amount)} · inserita da {r.created_by_name} il {itDateTime(r.created_at)}{r.submitted_at ? ` · in firma dal ${itDateTime(r.submitted_at)}` : ''}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={fileUrl(`/requests/${id}/preview`)} target="_blank" rel="noreferrer" title={pdfOff ? 'Conversione PDF non disponibile: il modulo viene scaricato in formato DOCX' : 'Apre il modulo compilato con i dati attuali'}><Icon name="file" />Anteprima modulo{pdfOff ? ' (DOCX)' : ''}</a>
          {manager && r.editable && <Link className="btn ghost" to={`${base}/istanze/${id}/modifica`}><Icon name="edit" />Modifica</Link>}
          {manager && ['BOZZA', 'RIFIUTATA'].includes(r.status) && <button className="btn" onClick={() => setModal('submit')}><Icon name="mail" />Invia in firma</button>}
          {manager && r.status === 'IN_FIRMA' && <button className="btn ghost" onClick={() => act(() => api.post(`/requests/${id}/resend`), 'Link di firma reinviati').catch(() => {})}><Icon name="mail" />Reinvia link</button>}
          {manager && r.status === 'FIRMATA' && <button className="btn" onClick={() => setModal('execute')}><Icon name="bank" />Registra esecuzione</button>}
          {manager && !closed && <button className="btn danger" onClick={() => setModal('cancel')}>Annulla istanza</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {err?.details?.length ? <ul className="alert err" style={{ margin: '8px 0 0', paddingLeft: 30 }}>{err.details.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      {pdfOff && <div className="alert info small" style={{ marginBottom: 16 }}>Conversione PDF (LibreOffice) non disponibile su questo server: anteprime e moduli vengono prodotti in formato DOCX. Firme, archiviazione ed email proseguono regolarmente.</div>}
      {r.status === 'RIFIUTATA' && <div className="alert err" style={{ marginBottom: 16 }}><b>Rifiutata.</b> {r.rejected_reason} — correggi l'istanza e inviala nuovamente in firma.</div>}
      {r.status === 'ANNULLATA' && <div className="alert warn" style={{ marginBottom: 16 }}><b>Annullata</b> il {itDateTime(r.cancelled_at)}: {r.cancel_reason}</div>}
      {agg?.warning && <div className="alert err" style={{ marginBottom: 16 }}><b>Controllo anti-frazionamento.</b> {agg.warning}</div>}
      {r.editable && r.submit_errors.length > 0 && manager && (
        <div className="alert warn" style={{ marginBottom: 16, flexDirection: 'column', gap: 4 }}><b>Per inviare in firma manca:</b>{r.submit_errors.map((x, i) => <div key={i}>· {x}</div>)}</div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <RequestView r={r} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="4. Firme">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(r.required_signers.length ? r.required_signers : ['CEO', 'CFO']).map((role) => {
                const s = r.signatures.find((x) => x.role === role && x.valid);
                const p = r.pending.find((x) => x.role === role);
                return (
                  <div key={role} className="msg" style={{ background: s ? 'var(--green-100)' : undefined }}>
                    <div className="who">{ROLE_SIGNER[role]}</div>
                    {s ? <><div className="strong">{s.user_name}</div><div className="small">firmato il {itDateTime(s.signed_at)} · {s.auth_method === 'ENTRA' ? 'Microsoft 365' : 'accesso locale'} · {s.user_email}</div><div className="small muted mono">impronta {s.content_hash.slice(0, 20)}… · v{s.version}</div></>
                      : r.status === 'IN_FIRMA' ? <><div className="strong">{p?.user_name || 'in attesa'}</div><div className="small muted">{p ? `link inviato il ${itDateTime(p.sent_at)}, valido fino al ${itDate(p.expires_at)}${p.reminder ? ' (sollecito)' : ''}` : 'nessun link attivo: reinvia'}</div></>
                        : <div className="small muted">{closed ? 'non apposta' : 'in attesa di invio in firma'}</div>}
                  </div>
                );
              })}
              {r.signatures.filter((x) => !x.valid).length > 0 && <div className="small muted">Firme annullate: {r.signatures.filter((x) => !x.valid).map((x) => `${x.user_name} (${x.role}) del ${itDateTime(x.signed_at)}: ${x.voided_reason}`).join('; ')}</div>}
              {['CEO', 'CFO'].includes(user.role) && r.status === 'IN_FIRMA' && r.missing_signers.includes(user.role) && <div className="alert info small">La firma si appone dal link personale ricevuto via email. Non lo trovi? Chiedi a Finance Support di reinviarlo.</div>}
            </div>
          </Card>
          {(r.status === 'ESEGUITA' || r.status === 'FIRMATA') && (
            <Card title="5. Esecuzione (tesoreria)" flush>
              <table className="t"><tbody><Row k="Eseguito da" v={r.executed_by} /><Row k="Data esecuzione" v={r.executed_at ? itDate(r.executed_at) : ''} /><Row k="CRO / TRN" v={r.cro_trn} mono /><Row k="Allegati" v={String(r.attachments_count)} /></tbody></table>
            </Card>
          )}
          <Card title="Documentazione di supporto" actions={manager && !closed && <><input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /><button className="btn sm" onClick={() => fileRef.current.click()}><Icon name="upload" />Carica</button></>}>
            {r.attachments.length ? r.attachments.map((a) => (
              <div key={a.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <a href={fileUrl(`/attachments/${a.id}`)} target="_blank" rel="noreferrer" style={{ flex: 1 }}><Icon name="file" /> {a.filename}</a>
                <span className="small muted">{bytes(a.size)} · {itDate(a.created_at)}</span>
                {manager && r.editable && <button className="iconbtn" title="Elimina" onClick={() => act(() => api.del(`/requests/${id}/attachments/${a.id}`), 'Allegato eliminato').catch(() => {})}><Icon name="trash" /></button>}
              </div>
            )) : <div className="muted small">Nessun allegato. Per l'invio in firma serve almeno un documento (fattura, contratto, ordine, SAL, delibera).</div>}
          </Card>
          <Card title="Modulo generato">
            {r.documents.length ? r.documents.map((d) => (
              <div key={d.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <a href={fileUrl(`/documents/${d.id}`)} target="_blank" rel="noreferrer" style={{ flex: 1 }}><Icon name="download" /> {d.filename}</a>
                <span className="small muted">{d.kind === 'MODULO_FIRMATO' ? 'firmato' : 'con esecuzione'} · {itDateTime(d.created_at)}</span>
              </div>
            )) : <div className="muted small">Il modulo PDF con le firme viene generato e archiviato al completamento delle firme.</div>}
          </Card>
          {agg?.related?.length > 0 && (
            <Card title={`Stessa controparte negli ultimi ${agg.days} giorni`} flush>
              <table className="t"><thead><tr><th>Protocollo</th><th>Data</th><th className="num">Importo</th><th>Stato</th></tr></thead><tbody>
                {agg.related.map((x) => <tr key={x.id} className="click" onClick={() => nav(`${base}/istanze/${x.id}`)}><td className="mono">{x.protocol || `#${x.id}`}</td><td>{itDate(x.request_date)}</td><td className="num">{eur(x.amount)}</td><td><StatusBadge status={x.status} /></td></tr>)}
                <tr><td colSpan={2} className="strong">Totale aggregato</td><td className="num strong">{eur(agg.total)}</td><td /></tr>
              </tbody></table>
            </Card>
          )}
          <Card title="Cronologia">
            <ul className="timeline">{r.events.map((e) => <li key={e.id}><div className="ev">{EVENT[e.kind] || e.kind}{e.user_name ? ` · ${e.user_name}` : ''}</div><div className="small muted">{itDateTime(e.at)}</div>{e.note && <div className="small">{e.note}</div>}</li>)}</ul>
          </Card>
          {r.notes && <Card title="Note interne"><div style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</div></Card>}
        </div>
      </div>

      {modal === 'submit' && (
        <Modal title="Invia in firma" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={r.submit_errors.length > 0} onClick={() => act(() => api.post(`/requests/${id}/submit`), 'Istanza inviata in firma').then(() => setModal(null)).catch(() => {})}>Conferma e invia le email</button></>}>
          {r.submit_errors.length ? <div className="alert err" style={{ flexDirection: 'column', gap: 4 }}><b>Istanza incompleta</b>{r.submit_errors.map((x, i) => <div key={i}>· {x}</div>)}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0 }}>L'istanza riceve il protocollo e viene inviata a <b>{r.required_signers.map((x) => ROLE_SIGNER[x]).join(' e ')}</b> da amministrazione@toscanadiagnostica.it, con il link personale per firmare con accesso Microsoft 365.</p>
              <p style={{ margin: 0 }} className="small muted">Importo {eur(r.amount)} · {r.beneficiary_name} · {prettyIban(r.beneficiary_iban)}. Potrai ancora modificare l'istanza fino alla prima firma: i link vengono rigenerati.</p>
              {agg?.warning && <div className="alert err small">{agg.warning} L'avviso viene riportato ai firmatari.</div>}
            </div>
          )}
        </Modal>
      )}
      {modal === 'cancel' && <PromptModal title="Annulla istanza" label="Motivazione" danger confirmText="Annulla istanza" onClose={() => setModal(null)} onConfirm={(reason) => act(() => api.post(`/requests/${id}/cancel`, { reason }), 'Istanza annullata')} />}
      {modal === 'execute' && (
        <Modal title="Registra esecuzione del pagamento" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={exec.cro_trn.trim().length < 3} onClick={() => act(() => api.post(`/requests/${id}/execute`, exec), 'Esecuzione registrata: istanza archiviata').then(() => setModal(null)).catch(() => {})}>Registra e archivia</button></>}>
          <div className="form-grid">
            <Field label="Data esecuzione"><input type="date" value={exec.executed_at} onChange={(e) => setExec({ ...exec, executed_at: e.target.value })} /></Field>
            <Field label="CRO / TRN"><input value={exec.cro_trn} onChange={(e) => setExec({ ...exec, cro_trn: e.target.value })} className="mono" /></Field>
            <Field label="Eseguito da" className="span2"><input value={exec.executed_by} onChange={(e) => setExec({ ...exec, executed_by: e.target.value })} /></Field>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Viene generata la versione del modulo con la sezione 5 compilata; l'istanza passa in archivio.</p>
        </Modal>
      )}
      {links && (
        <Modal title="Link di firma (modalità senza invio email)" onClose={() => setLinks(null)} footer={<button className="btn" onClick={() => setLinks(null)}>Chiudi</button>}>
          <p className="small muted">L'invio email non è configurato (MAIL_MODE diverso da GRAPH): i link personali sono mostrati qui solo per l'ambiente di prova.</p>
          {Object.entries(links).map(([role, url]) => <p key={role}><b>{ROLE_SIGNER[role]}</b><br /><a href={url} className="mono small">{url}</a></p>)}
        </Modal>
      )}
    </div>
  );
}
