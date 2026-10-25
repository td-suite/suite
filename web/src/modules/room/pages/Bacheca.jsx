import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast, Card } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { sedeLabel } from './Sedi.jsx';
import { itD, DAYS, DAYS_S } from '../lib/personale.js';

const STATO = { APERTA: ['Aperta', 'green'], ASSEGNATA: ['Assegnata', 'teal'], CHIUSA: ['Chiusa', 'grey'] };
const CAND = { INVIATA: ['Candidatura inviata', 'amber'], ACCETTATA: ['Accettata', 'green'], RIFIUTATA: ['Non accettata', 'grey'] };

// Bacheca delle posizioni aperte: per la gestione (pubblica, valuta candidature) e per i professionisti (portale: si candidano)
export default function Bacheca({ portale = false }) {
  const { user } = useAuth(); const toast = useToast();
  const gest = !portale && ['ADMIN', 'RESP_SAN'].includes(user.role);
  const { data, error, reload } = useApi(portale ? '/portale/posizioni' : '/personale/posizioni');
  const sedi = useApi(portale ? '/portale/sedi' : '/strutture');
  const [edit, setEdit] = useState(null); const [cands, setCands] = useState(null);
  const sm = Object.fromEntries((sedi.data || []).map((s) => [s.id, s.label || sedeLabel(s)]));
  const candidati = async (po) => { const nota = window.prompt(`Candidatura per "${po.titolo}": aggiungi una nota (facoltativa)`, ''); if (nota === null) return; try { await api.post(`/portale/posizioni/${po.id}/candidati`, { nota }); toast('Candidatura inviata'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const ritira = async (po) => { try { await api.del(`/portale/posizioni/${po.id}/candidati`); toast('Candidatura ritirata'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const quando = (po) => [po.dal ? (po.al && po.al !== po.dal ? `dal ${itD(po.dal)} al ${itD(po.al)}` : itD(po.dal)) : '', po.giorni?.length ? po.giorni.map((g) => DAYS_S[g]).join(', ') : '', po.ora_da ? `${po.ora_da}–${po.ora_a}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Bacheca posizioni aperte</h1><div className="sub">{portale ? 'Turni scoperti e attività proposte dalle strutture: candidati a quelle che ti interessano.' : 'Turni scoperti e attività da coprire proposte ai professionisti; qui si valutano le candidature.'}</div></div>
        {gest && <button className="btn" onClick={() => setEdit({ titolo: '', sede_id: '', profilo: '', descrizione: '', dal: '', al: '', giorni: [], ora_da: '', ora_a: '' })}>Nuova posizione</button>}</div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <div className="card"><div className="bd empty">Nessuna posizione aperta al momento.</div></div> : (
        <div className="grid g2">{data.map((po) => (
          <div key={po.id} className="card"><div className="bd">
            <div className="row" style={{ alignItems: 'flex-start' }}><div style={{ flex: 1 }}><h2 style={{ fontSize: 16, margin: 0 }}>{po.titolo}</h2><div className="small muted">{po.sede || sm[po.sede_id] || 'qualsiasi sede'}{po.profilo ? ` · ${po.profilo}` : ''}</div></div><Badge tone={STATO[po.stato]?.[1]}>{STATO[po.stato]?.[0]}</Badge></div>
            {quando(po) && <div className="small" style={{ marginTop: 6 }}><b>Quando:</b> {quando(po)}</div>}
            {po.descrizione && <p className="small" style={{ margin: '6px 0' }}>{po.descrizione}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small muted">pubblicata {itDateTime(po.created_at)}</span><span className="spacer" />
              {portale ? (po.mia_candidatura ? <><Badge tone={CAND[po.mia_candidatura]?.[1]}>{CAND[po.mia_candidatura]?.[0]}</Badge>{po.mia_candidatura === 'INVIATA' && <button className="btn sm ghost" onClick={() => ritira(po)}>Ritira</button>}</> : po.stato === 'APERTA' && <button className="btn sm" onClick={() => candidati(po)}>Mi candido</button>)
                : gest && <><button className="btn sm ghost" onClick={() => setCands(po)}>Candidature {po.n_candidature ? `(${po.n_candidature}${po.n_nuove ? `, ${po.n_nuove} nuove` : ''})` : ''}</button><button className="btn sm ghost" onClick={() => setEdit({ ...po, dal: po.dal || '', al: po.al || '', ora_da: po.ora_da || '', ora_a: po.ora_a || '', sede_id: po.sede_id || '', profilo: po.profilo || '', descrizione: po.descrizione || '' })}>Modifica</button></>}
              {!portale && !gest && po.n_candidature > 0 && <span className="small muted">{po.n_candidature} candidature</span>}
            </div>
          </div></div>))}</div>)}
      {edit && <PosModal po={edit} sedi={sedi.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} toast={toast} />}
      {cands && <CandModal po={cands} onClose={() => setCands(null)} onChanged={reload} toast={toast} />}
    </div>
  );
}

function PosModal({ po, sedi, onClose, onSaved, toast }) {
  const [f, setF] = useState(po);
  const save = async () => { try { const body = { ...f, sede_id: f.sede_id || null, profilo: f.profilo || null, dal: f.dal || null, al: f.al || null, ora_da: f.ora_da || null, ora_a: f.ora_a || null, turno_id: f.turno_id || null }; if (f.id) await api.put(`/personale/posizioni/${f.id}`, body); else await api.post('/personale/posizioni', body); toast('Posizione salvata'); onSaved(); } catch (e) { toast(e.message, 'err'); } };
  const del = async () => { if (!window.confirm('Eliminare la posizione e le candidature?')) return; try { await api.del(`/personale/posizioni/${f.id}`); onSaved(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={f.id ? 'Posizione' : 'Nuova posizione'} onClose={onClose} wide footer={<>{f.id && <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={del}>Elimina</button>}<span className="spacer" /><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={f.titolo.trim().length < 3} onClick={save}>Salva</button></>}>
      <div className="form-grid">
        <Field label="Titolo"><input value={f.titolo} onChange={(e) => setF({ ...f, titolo: e.target.value })} placeholder="es. Infermiere per punto prelievi del lunedì" /></Field>
        <Field label="Sede"><select value={f.sede_id} onChange={(e) => setF({ ...f, sede_id: e.target.value })}><option value="">Qualsiasi</option>{sedi.map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select></Field>
        <Field label="Profilo richiesto"><input value={f.profilo} list="profili-pos" onChange={(e) => setF({ ...f, profilo: e.target.value })} /><datalist id="profili-pos">{['Medico', 'Infermiere', 'Tecnico di radiologia', 'Ostetrica', 'OSS'].map((p) => <option key={p} value={p} />)}</datalist></Field>
        {f.id && <Field label="Stato"><select value={f.stato || 'APERTA'} onChange={(e) => setF({ ...f, stato: e.target.value })}>{Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></Field>}
        <Field label="Dal"><input type="date" value={f.dal} onChange={(e) => setF({ ...f, dal: e.target.value })} /></Field>
        <Field label="Al"><input type="date" value={f.al} onChange={(e) => setF({ ...f, al: e.target.value })} /></Field>
        <Field label="Dalle"><input type="time" value={f.ora_da} onChange={(e) => setF({ ...f, ora_da: e.target.value })} /></Field>
        <Field label="Alle"><input type="time" value={f.ora_a} onChange={(e) => setF({ ...f, ora_a: e.target.value })} /></Field>
      </div>
      <Field label="Giorni della settimana (per attività ricorrenti)"><div className="row" style={{ gap: 10 }}>{DAYS.map((d, i) => <label key={i} className="f inline"><input type="checkbox" checked={(f.giorni || []).includes(i)} onChange={(e) => setF({ ...f, giorni: e.target.checked ? [...(f.giorni || []), i].sort() : f.giorni.filter((x) => x !== i) })} />{d}</label>)}</div></Field>
      <Field label="Descrizione"><textarea rows={4} value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} placeholder="attività, requisiti, compenso proposto…" /></Field>
    </Modal>
  );
}

function CandModal({ po, onClose, onChanged, toast }) {
  const { data, reload } = useApi(`/personale/posizioni/${po.id}/candidature`);
  const act = async (c, esito) => { try { await api.post(`/personale/candidature/${c.id}/${esito}`); toast(esito === 'accetta' ? `Candidatura di ${c.nome} accettata${po.turno_id ? ': turno assegnato' : ''}` : 'Candidatura rifiutata'); reload(); onChanged(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={`Candidature · ${po.titolo}`} onClose={onClose} wide footer={<button className="btn ghost" onClick={onClose}>Chiudi</button>}>
      {!data ? <Loading /> : !data.length ? <div className="empty">Nessuna candidatura</div> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Professionista</th><th>Profilo</th><th>Email</th><th>Nota</th><th>Quando</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((c) => <tr key={c.id}><td className="strong">{c.nome}</td><td>{c.profilo}</td><td className="small">{c.email}</td><td className="small">{c.nota}</td><td className="small">{itDateTime(c.created_at)}</td><td><Badge tone={CAND[c.stato]?.[1]}>{CAND[c.stato]?.[0]}</Badge></td>
            <td className="num" style={{ whiteSpace: 'nowrap' }}>{c.stato === 'INVIATA' && <><button className="btn sm" onClick={() => act(c, 'accetta')}>Accetta</button> <button className="btn sm ghost" onClick={() => act(c, 'rifiuta')}>Rifiuta</button></>}</td></tr>)}</tbody></table></div>)}
    </Modal>
  );
}
