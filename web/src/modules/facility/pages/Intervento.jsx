// Scheda dell'intervento: dati, SLA, foto e allegati, cronologia; assegnazione (Facility), avanzamento e chiusura (Facility o
// manutentore assegnato), note di tutti tranne la consultazione, riapertura
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, useToast, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Priority, WoStatus, FileLink, Alert } from '../components/bits.jsx';
import { WO_STATUS, itDateTime, eur, ore, num, kb } from '../format.js';

const AZIONE = { APERTURA: 'Apertura', ASSEGNAZIONE: 'Assegnazione', STATO: 'Cambio di stato', NOTA: 'Nota', CHIUSURA: 'Chiusura', RIAPERTURA: 'Riapertura' };

export default function Intervento() {
  const { id } = useParams();
  const toast = useToast();
  const { data: w, loading, error, reload } = useApi(`/interventi/${id}`);
  const [assign, setAssign] = useState(false);
  const [close, setClose] = useState(false);
  const [note, setNote] = useState('');
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!w && loading) return <div className="page"><Loading /></div>;
  const done = () => { reload(); window.dispatchEvent(new Event('suite:badges')); };
  const stato = async (s) => { let n; if (s === 'SOSPESO') { n = window.prompt('Motivo della sospensione'); if (!n) return; } try { await api.post(`/interventi/${w.id}/stato`, { status: s, note: n }); toast(`Stato: ${WO_STATUS[s].label}`); done(); } catch (e) { toast(e, 'err'); } };
  const addNote = async () => { try { await api.post(`/interventi/${w.id}/nota`, { note }); setNote(''); done(); } catch (e) { toast(e, 'err'); } };
  const addFiles = async (xs) => { const fd = new FormData(); for (const x of xs) fd.append('file', x, x.name); try { await api.upload(`/interventi/${w.id}/files`, fd); toast('Allegati caricati'); done(); } catch (e) { toast(e, 'err'); } };
  const riapri = async () => { try { await api.post(`/interventi/${w.id}/riapri`, {}); toast('Intervento riaperto'); done(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title={`${w.code} · ${w.title}`} icon="wrench" crumb={<Link to={`${base}/interventi`}>Interventi</Link>} sub={`${w.site_name}${w.location ? ` · ${w.location}` : ''} · aperto il ${itDateTime(w.opened_at)} da ${w.reported_by_name || 'utente'}`}
        actions={<>{w.can_manage && w.status !== 'CHIUSO' && <button className="btn ghost" onClick={() => setAssign(true)}><Icon name="users" />{w.vendor_org_id || w.assigned_user_id ? 'Riassegna' : 'Assegna'}</button>}
          {w.can_work && w.status !== 'CHIUSO' && w.next.filter((s) => s !== 'CHIUSO' && s !== 'APERTO').map((s) => <button key={s} className="btn ghost" onClick={() => stato(s)}>{s === 'IN_CORSO' ? 'Inizia' : s === 'SOSPESO' ? 'Sospendi' : WO_STATUS[s].label}</button>)}
          {w.can_work && w.status !== 'CHIUSO' && <button className="btn" onClick={() => setClose(true)}><Icon name="check" />Chiudi</button>}
          {w.can_manage && w.status === 'CHIUSO' && <button className="btn ghost" onClick={riapri}>Riapri</button>}</>} />
      {w.status !== 'CHIUSO' && w.sla.late && <Alert tone="err" icon="alert">SLA superato di {ore(-w.sla.hours_left)} (scadenza {itDateTime(w.due_at)}).</Alert>}
      <div className="fa-wide">
        <Card title="Intervento" icon="info">
          <div className="fa-facts">
            <div><div className="k">Priorità</div><Priority p={w.priority} /></div>
            <div><div className="k">Stato</div><WoStatus s={w.status} /></div>
            <div><div className="k">Entro (SLA)</div><div className="v">{itDateTime(w.due_at)}</div><div className="small muted">{w.status === 'CHIUSO' ? (w.sla.late ? 'chiuso fuori SLA' : 'chiuso entro SLA') : w.sla.late ? 'superato' : `restano ${ore(w.sla.hours_left)}`}</div></div>
            <div><div className="k">Dispositivo</div><div className="v">{w.asset_id ? <Link to={`${base}/dispositivi/${w.asset_id}`}>{w.asset_code}</Link> : '–'}</div>{w.asset_type_name && <div className="small muted">{w.asset_type_name}</div>}</div>
            <div><div className="k">Manutentore</div><div className="v">{w.vendor_name || w.assigned_name || 'da assegnare'}</div>{w.vendor_name && w.assigned_name && <div className="small muted">{w.assigned_name}</div>}</div>
            <div><div className="k">Origine</div><div className="v">{w.plan_id ? <Link to={`${base}/piano?id=${w.plan_id}`}>esito non conforme</Link> : 'segnalazione'}</div></div>
            {w.closed_at && <><div><div className="k">Chiuso il</div><div className="v">{itDateTime(w.closed_at)}</div></div>
              <div><div className="k">Tempo di ripristino</div><div className="v">{ore(w.mttr_hours)}</div></div>
              <div><div className="k">Costo · fermo</div><div className="v">{w.cost != null ? eur(w.cost) : '–'} · {w.downtime_hours != null ? `${num(w.downtime_hours, 1)} h` : '–'}</div></div></>}
          </div>
          {w.description && <div className="fa-muted-box" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{w.description}</div>}
          {w.resolution && <div className="fa-alert ok" style={{ marginTop: 12 }}><Icon name="check" className="ico" /><div><b>Risoluzione</b>: {w.resolution}</div></div>}
        </Card>
        <Card title="Foto e allegati" icon="image">
          {!w.files.length ? <div className="small muted">Nessun allegato.</div> : <div style={{ display: 'grid', gap: 8 }}>{w.files.map((f) => /image/.test(f.mime) ? <a key={f.id} href={`/api/facility/files/${f.id}?inline=1`} target="_blank" rel="noreferrer"><img src={`/api/facility/files/${f.id}?inline=1`} alt={f.filename} style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, border: '1px solid var(--line)' }} /></a> : <div key={f.id}><FileLink f={f} /> <span className="small muted">{kb(f.size)}</span></div>)}</div>}
          {w.can_note && <div style={{ marginTop: 10 }}><DropZone onFiles={addFiles} accept="image/*,.pdf" compact><Icon name="upload" /><div className="small">Aggiungi foto o documenti</div></DropZone></div>}
        </Card>
      </div>
      <Card title="Cronologia" icon="clock">
        <ul className="fa-timeline">{w.events.map((e) => <li key={e.id}><b>{AZIONE[e.action] || e.action}</b>{e.to_status && e.action !== 'NOTA' ? ` · ${WO_STATUS[e.to_status]?.label || e.to_status}` : ''}{e.note && <div>{e.note}</div>}<div className="m">{itDateTime(e.at)} · {e.user_name || 'sistema'}</div></li>)}</ul>
        {w.can_note && <div className="row" style={{ gap: 8, marginTop: 12 }}><input className="fa-in" style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Aggiungi una nota" onKeyDown={(e) => e.key === 'Enter' && note.trim() && addNote()} /><button className="btn sm" disabled={!note.trim()} onClick={addNote}>Aggiungi</button></div>}
      </Card>
      {assign && <AssignModal w={w} onClose={() => setAssign(false)} onDone={() => { setAssign(false); done(); }} />}
      {close && <CloseModal w={w} onClose={() => setClose(false)} onDone={() => { setClose(false); done(); }} />}
    </div>
  );
}

function AssignModal({ w, onClose, onDone }) {
  const toast = useToast();
  const { data } = useApi('/manutentori');
  const [f, setF] = useState({ assigned_user_id: w.assigned_user_id || '', vendor_org_id: w.vendor_org_id || '', note: '' });
  const go = async () => { try { const r = await api.post(`/interventi/${w.id}/assegna`, { assigned_user_id: f.assigned_user_id ? Number(f.assigned_user_id) : null, vendor_org_id: f.vendor_org_id ? Number(f.vendor_org_id) : null, note: f.note || undefined }); toast(`Intervento assegnato${r.notified ? `: ${r.notified} notifiche` : ''}`); onDone(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title="Assegna l'intervento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={go}>Assegna</button></>}>
      <Field label="Legal entity fornitrice" help="Ricevono la notifica gli utenti con profilo Manutentore della Legal entity"><select className="fa-in w" value={f.vendor_org_id} onChange={(e) => setF({ ...f, vendor_org_id: e.target.value })}><option value="">Nessuna (manutenzione interna)</option>{(data?.vendors || []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.n_assets ? ` · ${o.n_assets} dispositivi` : ''}</option>)}</select></Field>
      <Field label="Manutentore (utente)"><select className="fa-in w" value={f.assigned_user_id} onChange={(e) => setF({ ...f, assigned_user_id: e.target.value })}><option value="">Nessuno</option>{(data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.organization_name ? ` · ${u.organization_name}` : ''} ({u.profile.toLowerCase()})</option>)}</select></Field>
      <Field label="Nota"><textarea className="fa-note" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

function CloseModal({ w, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ resolution: '', cost: '', downtime_hours: '', rimetti_in_servizio: true });
  const go = async () => { try { const r = await api.post(`/interventi/${w.id}/chiudi`, { resolution: f.resolution, cost: f.cost === '' ? null : Number(f.cost), downtime_hours: f.downtime_hours === '' ? null : Number(f.downtime_hours), rimetti_in_servizio: f.rimetti_in_servizio }); toast(`Intervento chiuso in ${ore(r.mttr_hours)}`); onDone(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title="Chiudi l'intervento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={go}>Chiudi</button></>}>
      <Field label="Risoluzione" required><textarea className="fa-note" rows={3} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} placeholder="Che cosa è stato fatto" /></Field>
      <div className="fa-grid g2">
        <Field label="Costo (€)"><input className="fa-in w" type="number" min="0" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        <Field label="Fermo dell'attività (ore)"><input className="fa-in w" type="number" min="0" step="0.5" value={f.downtime_hours} onChange={(e) => setF({ ...f, downtime_hours: e.target.value })} /></Field>
      </div>
      {w.asset_id && <label className="row small" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={f.rimetti_in_servizio} onChange={(e) => setF({ ...f, rimetti_in_servizio: e.target.checked })} />Rimetti in servizio il dispositivo</label>}
    </Modal>
  );
}
