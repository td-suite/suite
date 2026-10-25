import React, { useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, canWrite, isAdmin } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, Modal, PromptModal, useToast, Icon } from '../components/ui.jsx';
import { EmploymentForm } from '../components/forms.jsx';
import { eur, itDate, itDateTime, LETTER_STATUS, LEVEL_LABEL } from '../format.js';

export default function LetterDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi(`/scouting/letters/${id}`);
  const sites = useApi('/work-sites');
  const [edit, setEdit] = useState(null);
  const [preview, setPreview] = useState(null);
  const [del, setDel] = useState(false);
  const fileRef = useRef(null);
  const writer = canWrite(user);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const l = d.data;
  const uploadSigned = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('category', 'LETTERA_IMPEGNO'); fd.append('signed', 'true'); fd.append('issued_at', new Date().toISOString().slice(0, 10)); fd.append('notes', `Lettera di impegno #${id} firmata`);
    try {
      await api.post(`/resources/${l.resource_id}/attachments`, fd);
      if (!['ACCETTATA', 'CONVERTITA'].includes(l.status)) await api.put(`/scouting/letters/${id}`, { status: 'ACCETTATA' });
      toast('Lettera firmata archiviata nel dossier'); d.reload();
    } catch (err) { toast(err.message, 'err'); }
  };
  const setStatus = async (status) => { try { await api.put(`/scouting/letters/${id}`, { status }); toast('Stato aggiornato'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const generate = async () => { try { const r = await api.post(`/scouting/letters/${id}/generate`); toast(`Lettera generata (v${r.version})${(r.missing || []).length ? ` · ${r.missing.length} segnaposto da completare` : ''}`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const save = async () => {
    const body = { ...edit }; for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    body.ral_steps = (body.ral_steps || []).filter((s) => s.from && s.ral);
    const keys = ['letter_date', 'start_by', 'valid_until', 'level', 'qualification', 'job_title', 'weekly_hours', 'autonomous_hours', 'ral', 'ral_steps', 'mbo_enabled', 'mbo_pct', 'work_site_id', 'contract_type', 'notes'];
    try { await api.put(`/scouting/letters/${id}`, Object.fromEntries(keys.map((k) => [k, body[k]]))); setEdit(null); toast('Lettera aggiornata: rigenera il documento per aggiornare DOCX e PDF'); d.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row"><Badge tone={LETTER_STATUS[l.status]?.tone}>{LETTER_STATUS[l.status]?.label}</Badge></div>
          <h1 style={{ marginTop: 6 }}>Lettera di impegno · {l.first_name} {l.last_name}</h1>
          <div className="sub">{l.job_title} · {LEVEL_LABEL[l.level] || l.level} · RAL {eur(l.ral)} · decorrenza non oltre il {itDate(l.start_by)} · <Link to={`${BASE}/risorse/${l.resource_id}`}>apri la scheda della risorsa</Link></div>
        </div>
        <div className="row">
          {writer && <button className="btn" onClick={generate}><Icon name="file" />Genera DOCX e PDF</button>}
          {writer && l.status !== 'CONVERTITA' && <button className="btn ghost" onClick={() => setEdit({ ...l, letter_date: String(l.letter_date || '').slice(0, 10), start_by: l.start_by ? String(l.start_by).slice(0, 10) : '', valid_until: l.valid_until ? String(l.valid_until).slice(0, 10) : '' })}><Icon name="edit" />Modifica</button>}
        </div>
      </div>
      <div className="grid g2">
        <Card title="Condizioni proposte">
          <table className="t"><tbody>
            <tr><td className="muted">Data lettera</td><td>{itDate(l.letter_date)}</td></tr>
            <tr><td className="muted">Contratto</td><td>{l.contract_type === 'TDET' ? 'Tempo determinato' : l.contract_type === 'APPRENDISTATO' ? 'Apprendistato' : 'Tempo indeterminato'}</td></tr>
            <tr><td className="muted">Qualifica / livello</td><td>{l.qualification || 'Impiegato'} · {LEVEL_LABEL[l.level] || l.level}</td></tr>
            <tr><td className="muted">Mansione</td><td>{l.job_title}</td></tr>
            <tr><td className="muted">Orario</td><td>{l.weekly_hours} ore{l.autonomous_hours ? ' · autonomia di orario' : ''}</td></tr>
            <tr><td className="muted">RAL</td><td>{eur(l.ral)}{(l.ral_steps || []).map((s, i) => <div key={i} className="small muted">dal {itDate(s.from)}: {eur(s.ral)}</div>)}</td></tr>
            {l.mbo_enabled && <tr><td className="muted">MBO</td><td>fino al {l.mbo_pct}% della RAL</td></tr>}
            <tr><td className="muted">Sede di lavoro</td><td>{l.work_site_name || <span className="muted">sede legale</span>}</td></tr>
            <tr><td className="muted">Decorrenza</td><td>non oltre il {itDate(l.start_by)}</td></tr>
            <tr><td className="muted">Validità proposta</td><td>{itDate(l.valid_until) || '–'}</td></tr>
            {l.accepted_at && <tr><td className="muted">Accettata il</td><td>{itDate(l.accepted_at)}</td></tr>}
            {l.notes && <tr><td className="muted">Note</td><td style={{ whiteSpace: 'pre-wrap' }}>{l.notes}</td></tr>}
          </tbody></table>
          {writer && (
            <div className="row" style={{ marginTop: 14 }}>
              {['BOZZA', 'INVIATA'].includes(l.status) && <button className="btn sm" onClick={() => setStatus('ACCETTATA')}>Segna come accettata</button>}
              {['BOZZA', 'INVIATA'].includes(l.status) && <button className="btn sm ghost" onClick={() => setStatus('RIFIUTATA')}>Rifiutata</button>}
              {['BOZZA', 'INVIATA'].includes(l.status) && <button className="btn sm ghost" onClick={() => setStatus('SCADUTA')}>Scaduta</button>}
              {l.status === 'ACCETTATA' && <Link className="btn sm" to={`${BASE}/risorse/nuova?kind=DIPENDENTE`}>Converti in contratto di assunzione</Link>}
              {['RIFIUTATA', 'SCADUTA'].includes(l.status) && <button className="btn sm ghost" onClick={() => setStatus('INVIATA')}>Riapri</button>}
              {isAdmin(user) && <button className="btn sm danger" onClick={() => setDel(true)}>Elimina lettera</button>}
            </div>
          )}
        </Card>
        <Card title="Documenti generati" flush>
          {!l.documents.length ? <Empty>Nessun documento generato: usa "Genera DOCX e PDF".</Empty> : (
            <table className="t"><thead><tr><th>Versione</th><th>Generato</th><th className="num">Azioni</th></tr></thead>
              <tbody>{l.documents.map((doc) => <tr key={doc.id}><td className="strong">v{doc.version}{(doc.missing || []).length > 0 && <div className="small" style={{ color: '#9a5b00', fontWeight: 400 }}>segnaposto: {doc.missing.join(', ').toLowerCase()}</div>}</td><td className="small muted">{itDateTime(doc.generated_at)}</td><td className="num">{doc.has_pdf && <button className="btn sm ghost" onClick={() => setPreview(doc)}>Anteprima</button>} {doc.has_pdf && <a className="btn sm ghost" href={`${API_BASE}/documents/${doc.id}/download?format=pdf`}>PDF</a>} <a className="btn sm ghost" href={`${API_BASE}/documents/${doc.id}/download?format=docx`}>DOCX</a></td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Lettera di impegno firmata" className="span2" actions={writer && l.status !== 'CONVERTITA' ? <><button className="btn sm" onClick={() => fileRef.current?.click()}>Carica lettera firmata</button><input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={uploadSigned} /></> : null}>
          {!(l.signed_files || []).length ? <Empty>Nessuna copia firmata caricata. Caricando il PDF firmato dal candidato la lettera passa in stato "Accettata" e il file finisce nel dossier della risorsa.</Empty> : (
            <table className="t"><thead><tr><th>File</th><th>Data firma</th><th>Caricato</th><th className="num">Azioni</th></tr></thead>
              <tbody>{l.signed_files.map((a) => <tr key={a.id}><td className="strong">{a.filename}</td><td>{a.issued_at ? itDate(a.issued_at) : '–'}</td><td className="small muted">{itDateTime(a.uploaded_at)}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}</td><td className="num"><a className="btn sm ghost" href={`${API_BASE}/resources/${l.resource_id}/attachments/${a.id}/download`}>Apri</a></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      {edit && (
        <Modal title="Modifica lettera di impegno" onClose={() => setEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
          <div className="form-grid" style={{ marginBottom: 12 }}><Field label="Data della lettera"><input type="date" value={edit.letter_date || ''} onChange={(e) => setEdit({ ...edit, letter_date: e.target.value })} /></Field><Field label="Note interne" className="span2"><input value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
          <EmploymentForm value={edit} onChange={setEdit} letter sites={sites.data || []} />
        </Modal>
      )}
      {preview && <Modal title={`${preview.title} v${preview.version}`} onClose={() => setPreview(null)} wide><iframe title="pdf" src={`${API_BASE}/documents/${preview.id}/download?format=pdf&inline=1`} style={{ width: '100%', height: '70vh', border: 0 }} /></Modal>}
      {del && <PromptModal danger title="Elimina lettera di impegno" label="Motivazione" confirmText="Elimina" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/scouting/letters/${id}`); nav(`${BASE}/scouting/lettere`); }} />}
    </div>
  );
}
