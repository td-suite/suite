// Interventi: segnalazioni di guasto e correttivi con priorità, SLA e stato; segnalazione con foto (anche dal site manager)
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, base, useApi, qs } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, SearchInput, useToast, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isViewer } from '../index.jsx';
import { Priority, WoStatus, SiteSelect, useSites } from '../components/bits.jsx';
import { PRIORITY, WO_STATUS, itDateTime, eur, ore, kb } from '../format.js';

export default function Interventi() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const sites = useSites();
  const [f, setF] = useState({ site_id: sp.get('site_id') || '', status: 'APERTI', priority: '', q: '' });
  const [nuovo, setNuovo] = useState(sp.get('nuovo') === '1');
  const { data, loading, error, reload } = useApi(`/interventi${qs(f)}`, [], { silent: true });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const sla = data?.sla_hours;
  return (
    <div className="page">
      <PageHead title="Interventi" icon="wrench" sub="Guasti segnalati dalle sedi e correttivi dalle non conformità: assegnazione al manutentore interno o alla Legal entity fornitrice, SLA per priorità, chiusura con risoluzione."
        actions={!isViewer(user) && <button className="btn" onClick={() => setNuovo(true)}><Icon name="plus" />Segnala un guasto</button>} />
      <div className="fa-filters">
        <SiteSelect value={f.site_id} onChange={set('site_id')} sites={sites} />
        <select className="fa-in" value={f.status} onChange={(e) => set('status')(e.target.value)}><option value="APERTI">Aperti</option><option value="">Tutti</option>{Object.entries(WO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className="fa-in" value={f.priority} onChange={(e) => set('priority')(e.target.value)}><option value="">Tutte le priorità</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <SearchInput value={f.q} onChange={set('q')} placeholder="Codice, titolo, sede, dispositivo" />
      </div>
      {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : (
        <Card flush>
          {!data.rows.length ? <Empty icon="check" title="Nessun intervento">Con "Segnala un guasto" la sede apre una richiesta con foto: Facility la riceve subito.</Empty> : (
            <table className="t fa-table"><thead><tr><th>Codice</th><th>Intervento</th><th>Sede</th><th>Priorità</th><th>Stato</th><th>Aperto</th><th>SLA</th><th>Manutentore</th><th className="num">Costo</th></tr></thead>
              <tbody>{data.rows.map((w) => <tr key={w.id} className={`click ${w.status !== 'CHIUSO' && w.sla.late ? 'late' : ''}`} onClick={() => nav(`${base}/interventi/${w.id}`)}>
                <td><Link to={`${base}/interventi/${w.id}`} onClick={(e) => e.stopPropagation()}>{w.code}</Link></td><td className="strong">{w.title}{w.asset_code && <div className="small muted">{w.asset_code} · {w.asset_type_name}</div>}</td><td>{w.site_name}</td>
                <td><Priority p={w.priority} /></td><td><WoStatus s={w.status} /></td><td className="small">{itDateTime(w.opened_at)}<div className="muted">{w.reported_by_name}</div></td>
                <td className="small">{w.status === 'CHIUSO' ? (w.sla.late ? <span style={{ color: 'var(--red)' }}>chiuso fuori SLA</span> : <span style={{ color: 'var(--green)' }}>entro SLA · {ore(w.mttr_hours)}</span>) : w.sla.late ? <b style={{ color: 'var(--red)' }}>superato di {ore(-w.sla.hours_left)}</b> : `restano ${ore(w.sla.hours_left)}`}</td>
                <td className="small">{w.vendor_name || w.assigned_name || <span className="muted">da assegnare</span>}</td><td className="num">{w.cost != null ? eur(w.cost) : ''}</td></tr>)}</tbody></table>)}
        </Card>)}
      {nuovo && <NewWoModal sites={sites} siteId={f.site_id || sp.get('site_id')} assetId={sp.get('asset_id')} sla={sla}
        onClose={() => { setNuovo(false); ['nuovo', 'asset_id'].forEach((k) => sp.delete(k)); setSp(sp, { replace: true }); }}
        onDone={(w) => { setNuovo(false); reload(); window.dispatchEvent(new Event('suite:badges')); nav(`${base}/interventi/${w.id}`); }} />}
    </div>
  );
}

function NewWoModal({ sites, siteId, assetId, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ site_id: siteId || (sites.length === 1 ? String(sites[0].id) : ''), asset_id: assetId || '', title: '', description: '', location: '', priority: 'MEDIA', fuori_servizio: false });
  const { data: assets } = useApi(f.site_id ? `/dispositivi?site_id=${f.site_id}` : null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    if (!f.site_id) return toast('Scegli la sede', 'err');
    if (f.title.trim().length < 3) return toast('Descrivi il guasto nel titolo', 'err');
    const fd = new FormData(); for (const [k, v] of Object.entries(f)) if (v !== '' && v != null) fd.append(k, String(v)); for (const x of files) fd.append('file', x, x.name);
    setBusy(true);
    try { const w = await api.upload('/interventi', fd); toast(`Segnalazione ${w.code} inviata a Facility`); onDone(w); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title="Segnala un guasto" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={go}><Icon name="send" />{busy ? 'Invio' : 'Invia la segnalazione'}</button></>}>
      <div className="fa-grid g2">
        <Field label="Sede" required><SiteSelect className="fa-in w" value={f.site_id} onChange={(v) => setF({ ...f, site_id: v, asset_id: '' })} sites={sites} all="Scegli la sede" /></Field>
        <Field label="Dispositivo (se c'è)"><select className="fa-in w" value={f.asset_id} onChange={set('asset_id')}><option value="">Nessuno / non so</option>{(assets?.rows || []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name || a.type_name}</option>)}</select></Field>
      </div>
      <Field label="Che cosa non funziona" required><input className="fa-in w" value={f.title} onChange={set('title')} placeholder="es. Porta automatica dell'ingresso bloccata" /></Field>
      <Field label="Dettagli"><textarea className="fa-note" rows={3} value={f.description} onChange={set('description')} placeholder="Da quando, cosa succede, eventuali messaggi di errore" /></Field>
      <div className="fa-grid g2">
        <Field label="Dove"><input className="fa-in w" value={f.location} onChange={set('location')} placeholder="Locale, piano" /></Field>
        <Field label="Priorità" help="Urgente: blocca l'attività o riguarda la sicurezza (SLA 24 ore)"><select className="fa-in w" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
      </div>
      {f.asset_id && f.priority === 'URGENTE' && <label className="row small" style={{ gap: 6, margin: '6px 0' }}><input type="checkbox" checked={f.fuori_servizio} onChange={(e) => setF({ ...f, fuori_servizio: e.target.checked })} />Il dispositivo è fuori servizio</label>}
      <div style={{ marginTop: 8 }}><DropZone onFiles={(xs) => setFiles([...files, ...xs])} accept="image/*,.pdf" compact><Icon name="image" /><div className="small">Aggiungi una o più foto (anche dal telefono)</div></DropZone></div>
      {files.length > 0 && <ul className="fa-list" style={{ marginTop: 8 }}>{files.map((x, i) => <li key={i}><span>{x.name} <span className="muted small">{kb(x.size)}</span></span><button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" /></button></li>)}</ul>}
    </Modal>
  );
}
