import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs, BASE, API_BASE } from '../api.js';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, Modal, ConfirmModal, useToast, Icon } from '../components/ui.jsx';
import { itDate, CV_STATUS } from '../format.js';

export default function CvBox() {
  const { user } = useAuth();
  const toast = useToast();
  const writer = canWrite(user);
  const [f, setF] = useState({ q: '', status: '', area_id: '' });
  const list = useApi(`/scouting/cv${qs(f)}`);
  const areas = useApi('/areas');
  const settings = useApi('/settings');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const cur = sel && (list.data || []).find((c) => c.id === sel);
  const analyze = async (id) => { try { await api.post(`/scouting/cv/${id}/analyze`); toast('Sintesi aggiornata'); list.reload(); } catch (e) { toast(e.message, 'err'); } };
  const upd = async (id, body) => { await api.put(`/scouting/cv/${id}`, body); list.reload(); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>CV Box</h1><div className="sub">Repository dei curriculum ricevuti, con sintesi del profilo e area di potenziale destinazione.{settings.data?.aiEnabled ? ' La sintesi viene proposta automaticamente al caricamento.' : ' Sintesi automatica non attiva (configurare ANTHROPIC_API_KEY): la sintesi si scrive a mano.'}</div></div>
        {writer && <button className="btn" onClick={() => setModal('upload')}><Icon name="upload" />Carica CV</button>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Nome, ruolo, parole della sintesi" /></Field>
        <Field label="Stato"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Tutti</option>{Object.entries(CV_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Area"><select value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}><option value="">Tutte</option>{(areas.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      </div>
      <ErrorBox error={list.error} />
      <div className="grid g3" style={{ gridTemplateColumns: cur ? '1.4fr 1fr' : '1fr' }}>
        <Card flush>
          {!list.data ? <Loading /> : !list.data.length ? <Empty>Nessun CV in archivio</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Candidato</th><th>Area / ruolo</th><th>Ricevuto</th><th>Valutazione</th><th>Stato</th></tr></thead>
              <tbody>{list.data.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSel(c.id === sel ? null : c.id)} style={c.id === sel ? { background: 'var(--teal-050)' } : undefined}>
                  <td><div className="strong">{c.last_name || '–'} {c.first_name || ''}</div><div className="small muted">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div></td>
                  <td>{c.area_name || <span className="muted">–</span>}<div className="small muted">{c.role_target}</div></td>
                  <td>{itDate(c.received_at)}</td>
                  <td>{c.rating ? '★'.repeat(c.rating) + '☆'.repeat(5 - c.rating) : <span className="muted">–</span>}</td>
                  <td><Badge tone={CV_STATUS[c.status]?.tone}>{CV_STATUS[c.status]?.label}</Badge></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
        {cur && (
          <Card title={`${cur.last_name || ''} ${cur.first_name || ''}`.trim() || cur.filename} actions={<button className="iconbtn" onClick={() => setSel(null)}>✕</button>}>
            <div className="row" style={{ marginBottom: 10 }}>
              {cur.filename && <a className="btn sm ghost" href={`${API_BASE}/scouting/cv/${cur.id}/download?inline=1`} target="_blank" rel="noreferrer">Apri CV</a>}
              {writer && settings.data?.aiEnabled && <button className="btn sm ghost" onClick={() => analyze(cur.id)}>Rigenera sintesi</button>}
              {writer && cur.status !== 'CONVERTITO' && <Link className="btn sm" to={`${BASE}/scouting/lettere/nuova?cv_id=${cur.id}`}>Lettera di impegno</Link>}
              {cur.resource_id && <Link className="btn sm ghost" to={`${BASE}/risorse/${cur.resource_id}`}>Apri risorsa</Link>}
            </div>
            <CvEditor c={cur} areas={areas.data || []} writer={writer} onSave={(body) => upd(cur.id, body)} />
            {writer && <div style={{ marginTop: 12 }}><button className="btn sm danger" onClick={() => setModal({ del: cur })}>Elimina CV</button></div>}
          </Card>
        )}
      </div>
      {modal === 'upload' && <UploadCv areas={areas.data || []} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); list.reload(); toast(r.ai_used ? 'CV caricato e sintesi generata' : r.ai_error ? `CV caricato, sintesi non riuscita: ${r.ai_error}` : 'CV caricato', r.ai_error ? 'err' : undefined); }} />}
      {modal?.del && <ConfirmModal danger title="Elimina CV" text="Eliminare il CV dall'archivio?" confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/scouting/cv/${modal.del.id}`); setSel(null); list.reload(); }} />}
    </div>
  );
}

function CvEditor({ c, areas, writer, onSave }) {
  const [v, setV] = useState(c);
  const [err, setErr] = useState(null);
  React.useEffect(() => setV(c), [c]);
  const save = async () => { try { setErr(null); await onSave({ last_name: v.last_name, first_name: v.first_name, email: v.email, phone: v.phone, area_id: v.area_id || null, role_target: v.role_target, summary: v.summary, interview_notes: v.interview_notes || null, rating: v.rating || null, status: v.status, source: v.source }); } catch (e) { setErr(e); } };
  const s = (k, x) => setV({ ...v, [k]: x });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Cognome"><input value={v.last_name || ''} onChange={(e) => s('last_name', e.target.value)} disabled={!writer} /></Field>
        <Field label="Nome"><input value={v.first_name || ''} onChange={(e) => s('first_name', e.target.value)} disabled={!writer} /></Field>
        <Field label="Email"><input value={v.email || ''} onChange={(e) => s('email', e.target.value)} disabled={!writer} /></Field>
        <Field label="Telefono"><input value={v.phone || ''} onChange={(e) => s('phone', e.target.value)} disabled={!writer} /></Field>
        <Field label="Area di potenziale destinazione"><select value={v.area_id || ''} onChange={(e) => s('area_id', e.target.value ? Number(e.target.value) : null)} disabled={!writer}><option value="">–</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Ruolo potenziale"><input value={v.role_target || ''} onChange={(e) => s('role_target', e.target.value)} disabled={!writer} /></Field>
        <Field label="Valutazione (1-5)"><select value={v.rating || ''} onChange={(e) => s('rating', e.target.value ? Number(e.target.value) : null)} disabled={!writer}><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select></Field>
        <Field label="Stato"><select value={v.status} onChange={(e) => s('status', e.target.value)} disabled={!writer}>{Object.entries(CV_STATUS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
        <Field label="Fonte"><input value={v.source || ''} onChange={(e) => s('source', e.target.value)} disabled={!writer} placeholder="es. LinkedIn, candidatura spontanea, segnalazione" /></Field>
      </div>
      <Field label="Sintesi del profilo"><textarea value={v.summary || ''} onChange={(e) => s('summary', e.target.value)} disabled={!writer} style={{ minHeight: 160 }} /></Field>
      <Field label="Note dal colloquio" help="Campo libero: impressioni, disponibilità, aspettative economiche, esito"><textarea value={v.interview_notes || ''} onChange={(e) => s('interview_notes', e.target.value)} disabled={!writer} style={{ minHeight: 120 }} placeholder="es. Colloquio del 11/10 con Zezza: ..." /></Field>
      {writer && <div><button className="btn" onClick={save}>Salva</button></div>}
    </div>
  );
}

function UploadCv({ areas, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [f, setF] = useState({ last_name: '', first_name: '', area_id: '', role_target: '', source: '', received_at: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const fd = new FormData(); if (file) fd.append('file', file); for (const [k, v] of Object.entries(f)) if (v) fd.append(k, v); const r = await api.upload('/scouting/cv', fd); onSaved(r); } catch (e) { setErr(e); }
    setBusy(false);
  };
  return <Modal title="Carica CV" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Analisi in corso…' : 'Carica'}</button></>}>
    <ErrorBox error={err} />
    <div className="form-grid">
      <Field label="File CV (PDF)" className="span2"><input type="file" accept="application/pdf,.doc,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label="Cognome" help="Se vuoto, provato dal CV"><input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
      <Field label="Nome"><input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
      <Field label="Area di potenziale destinazione"><select value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}><option value="">–</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Ruolo potenziale"><input value={f.role_target} onChange={(e) => setF({ ...f, role_target: e.target.value })} /></Field>
      <Field label="Fonte"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
      <Field label="Data ricezione"><input type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></Field>
    </div>
  </Modal>;
}
