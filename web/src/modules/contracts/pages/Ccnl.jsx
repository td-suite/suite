import React, { useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useAuth, isAdmin, seesCosts } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Modal, ConfirmModal, useToast, Icon } from '../components/ui.jsx';
import { eur, itDate, bytes, itDateTime } from '../format.js';

export default function Ccnl() {
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi('/ccnl');
  const [tab, setTab] = useState('sintesi');
  const [edit, setEdit] = useState(null);
  const [upload, setUpload] = useState(false);
  const [del, setDel] = useState(null);
  const admin = isAdmin(user);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { levels, dates, current_from, ral, sections, documents, cost_coefficient } = d.data;
  const saveSection = async () => {
    try {
      if (edit.id) await api.put(`/ccnl/sections/${edit.id}`, { title: edit.title, body: edit.body }); else await api.post('/ccnl/sections', { title: edit.title, body: edit.body });
      setEdit(null); d.reload(); toast('Paragrafo salvato');
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>CCNL di riferimento</h1><div className="sub">CCNL Studi Professionali (Confprofessioni): testo integrale, sintesi per argomento e tabelle dei minimi e delle RAL. Il personale dirigente segue il CCNL Dirigenti Industria.</div></div>
        {admin && <button className="btn" onClick={() => setUpload(true)}><Icon name="upload" />Carica PDF</button>}
      </div>
      <div className="tabs">{[['sintesi', 'Sintesi per argomento'], ['tabelle', 'Minimi tabellari e RAL'], ['documenti', `Documenti (${documents.length})`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'sintesi' && (
        <div className="grid g2">
          {sections.map((s) => (
            <Card key={s.id} title={s.title} actions={admin && <button className="btn sm ghost" onClick={() => setEdit(s)}>Modifica</button>}>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{s.body}</p>
            </Card>
          ))}
          {admin && <Card title="Nuovo paragrafo"><p className="muted">Aggiungi un argomento (es. ferie, preavviso, malattia) con il testo di sintesi tratto dal CCNL.</p><button className="btn ghost" onClick={() => setEdit({ title: '', body: '' })}>+ Paragrafo</button></Card>}
        </div>
      )}

      {tab === 'tabelle' && (
        <div className="grid" style={{ gap: 16 }}>
          <Card title="Minimi tabellari mensili per livello" flush actions={<span className="small muted">valori vigenti dal {itDate(current_from)} evidenziati</span>}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Livello</th><th>Prova (gg max)</th>{dates.map((dt) => <th key={dt} className="num" style={dt === current_from ? { color: 'var(--teal)' } : undefined}>dal {itDate(dt)}</th>)}<th className="num">ENAC</th></tr></thead>
              <tbody>{levels.map((l) => <tr key={l.id}><td className="strong">{l.description} ({l.level})</td><td>{l.probation_days}</td>{dates.map((dt) => <td key={dt} className="num" style={dt === current_from ? { fontWeight: 700 } : undefined}>{l.minimums[dt] ? eur(l.minimums[dt].amount) : '–'}</td>)}<td className="num">{l.minimums[current_from]?.enac ? eur(l.minimums[current_from].enac) : '–'}</td></tr>)}</tbody>
            </table></div>
          </Card>
          <Card title="Tabella RAL (minimo × 14 mensilità) e costo azienda stimato" flush actions={<span className="small muted">coefficiente di costo {cost_coefficient}</span>}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Livello</th><th className="num">Minimo mensile</th><th className="num">RAL minima (14 mensilità)</th>{seesCosts(user) && <th className="num">Costo annuo azienda</th>}</tr></thead>
              <tbody>{ral.map((r) => <tr key={r.level}><td className="strong">{r.description}</td><td className="num">{eur(r.monthly)}</td><td className="num">{eur(r.ral_14)}</td>{seesCosts(user) && <td className="num">{eur(r.cost_annual)}</td>}</tr>)}</tbody>
            </table></div>
            <div className="bd small muted">Le RAL effettive dei contratti aziendali aggiungono superminimo e indennità di funzione al minimo tabellare (vedi Simulatore busta paga).</div>
          </Card>
        </div>
      )}

      {tab === 'documenti' && (
        <Card title="Testo del CCNL e accordi" flush>
          {!documents.length ? <Empty>Nessun documento caricato. Carica il PDF del CCNL Studi Professionali e l'accordo integrativo aziendale.</Empty> : (
            <table className="t"><thead><tr><th>Titolo</th><th>File</th><th>Caricato</th><th className="num">Azioni</th></tr></thead>
              <tbody>{documents.map((x) => <tr key={x.id}><td className="strong">{x.title}</td><td>{x.filename} <span className="small muted">({bytes(x.size)})</span></td><td className="small muted">{itDateTime(x.uploaded_at)} · {x.uploaded_by_name}</td><td className="num"><a className="btn sm ghost" href={`${API_BASE}/ccnl/documents/${x.id}/download?inline=1`} target="_blank" rel="noreferrer">Apri</a> <a className="btn sm ghost" href={`${API_BASE}/ccnl/documents/${x.id}/download`}>Scarica</a> {admin && <button className="iconbtn" onClick={() => setDel(x)}><Icon name="trash" /></button>}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}

      {edit && <Modal title={edit.id ? 'Modifica paragrafo' : 'Nuovo paragrafo'} onClose={() => setEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={saveSection}>Salva</button></>}>
        <Field label="Titolo"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
        <Field label="Testo" className="" ><textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} style={{ minHeight: 220, marginTop: 10 }} /></Field>
      </Modal>}
      {upload && <UploadDoc onClose={() => setUpload(false)} onSaved={() => { setUpload(false); d.reload(); }} />}
      {del && <ConfirmModal danger title="Elimina documento" text={`Eliminare "${del.title}"?`} confirmText="Elimina" onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/ccnl/documents/${del.id}`); d.reload(); }} />}
    </div>
  );
}

function UploadDoc({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => { if (!file) return setErr(new Error('Seleziona un file')); try { const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name); await api.upload('/ccnl/documents', fd); onSaved(); } catch (e) { setErr(e); } };
  return <Modal title="Carica documento CCNL" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Carica</button></>}><ErrorBox error={err} /><div className="form-grid"><Field label="Titolo" className="span2"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CCNL Studi Professionali 2024-2027" /></Field><Field label="File PDF" className="span2"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field></div></Modal>;
}
