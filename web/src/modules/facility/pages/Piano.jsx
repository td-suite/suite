// Piano delle manutenzioni: calendario delle scadenze (dispositivi e obblighi degli immobili) raggruppate per mese, con filtri; scheda
// della scadenza con chiusura (esito, data, costo, rapportino), storico della serie, spostamento e annullamento per Facility
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, base, useApi, qs } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, SearchInput, useToast, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isFacility, isSite } from '../index.jsx';
import { PlanStatus, Outcome, SiteSelect, useSites, FileLink, Alert } from '../components/bits.jsx';
import { PLAN_KIND, STREAM, PERFORMER, CATEGORY, OUTCOME, itDate, eur, giorni, meseLabel, kb, ogni } from '../format.js';

const STATI = { APERTE: 'Aperte', SCADUTA: 'Scadute', PIANIFICATA: 'Pianificate', ESEGUITA: 'Eseguite', ANNULLATA: 'Annullate' };

export default function Piano() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const sites = useSites();
  const [f, setF] = useState({ site_id: sp.get('site_id') || '', status: sp.get('status') || 'APERTE', kind: '', stream: '', performer: isSite(user) ? 'SEDE' : '', category: '', q: '', from: '', to: '' });
  const { data, loading, error, reload } = useApi(`/piano${qs(f)}`, [], { silent: true });
  const openId = sp.get('id');
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const close = () => { sp.delete('id'); setSp(sp, { replace: true }); };
  const groups = [];
  for (const p of data?.rows || []) { const k = (p.done_at || p.due_date).slice(0, 7); let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, rows: [] }); g.rows.push(p); }
  const genera = async () => { try { const r = await api.post('/piano/genera'); toast(`Piano allineato: ${r.created} scadenze create`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title="Piano manutenzioni" icon="calendar" sub={isSite(user) ? 'Le scadenze della tua sede. Conferma i controlli di sede (sorveglianza mensile di estintori, porte, luci di emergenza, DAE).' : 'Controlli, manutenzioni e verifiche normative dei dispositivi e obblighi degli immobili. Alla chiusura nasce la scadenza successiva.'}
        actions={isFacility(user) && <button className="btn ghost" onClick={genera}><Icon name="refresh" />Allinea il piano</button>} />
      <div className="fa-filters">
        <SiteSelect value={f.site_id} onChange={set('site_id')} sites={sites} />
        <select className="fa-in" value={f.status} onChange={(e) => set('status')(e.target.value)}>{Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="fa-in" value={f.kind} onChange={(e) => set('kind')(e.target.value)}><option value="">Tutte le attività</option>{Object.entries(PLAN_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="fa-in" value={f.stream} onChange={(e) => set('stream')(e.target.value)}><option value="">Tutte le serie</option>{Object.entries(STREAM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="fa-in" value={f.performer} onChange={(e) => set('performer')(e.target.value)}><option value="">Chiunque esegua</option>{Object.entries(PERFORMER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="fa-in" value={f.category} onChange={(e) => set('category')(e.target.value)}><option value="">Tutte le categorie</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="fa-in" type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} title="Dal" />
        <input className="fa-in" type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} title="Al" />
        <SearchInput value={f.q} onChange={set('q')} placeholder="Attività, codice, sede" />
      </div>
      {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : !data.rows.length ? <Card><Empty icon="calendar" title="Nessuna scadenza">Le scadenze nascono dai dispositivi registrati e dagli obblighi degli immobili.</Empty></Card> : (
        <Card flush>{groups.map((g) => <div key={g.k} style={{ padding: '0 12px 8px' }}>
          <div className="fa-month">{meseLabel(g.k)} · {g.rows.length}</div>
          <table className="t fa-table fa-fixed"><tbody>{g.rows.map((p) => <tr key={p.id} className={`click ${p.effective_status === 'SCADUTA' ? 'late' : ''}`} onClick={() => { sp.set('id', p.id); setSp(sp, { replace: true }); }}>
            <td style={{ width: 110 }} className="num">{itDate(p.status === 'ESEGUITA' ? p.done_at : p.due_date)}{['PIANIFICATA', 'SCADUTA'].includes(p.status) && <div className="small muted">{giorni(p.days)}</div>}</td>
            <td><span className="strong">{p.title}</span><div className="small muted">{p.asset_code ? `${p.asset_code}${p.asset_location ? ` · ${p.asset_location}` : ''}` : 'Obbligo dell\'immobile'} · {STREAM[p.stream]}</div></td>
            <td>{p.site_name}</td><td className="small">{PLAN_KIND[p.kind]}<div className="muted">{PERFORMER[p.performer]}{p.vendor_name ? ` · ${p.vendor_name}` : ''}</div></td>
            <td>{p.status === 'ESEGUITA' ? <Outcome o={p.outcome} /> : <PlanStatus s={p.effective_status} />}</td><td className="num">{p.cost != null ? eur(p.cost) : ''}</td></tr>)}</tbody></table>
        </div>)}</Card>)}
      {openId && <PlanModal id={openId} onClose={close} onDone={() => { close(); reload(); window.dispatchEvent(new Event('suite:badges')); }} />}
    </div>
  );
}

function PlanModal({ id, onClose, onDone }) {
  const toast = useToast();
  const { data: p, error } = useApi(`/piano/${id}`);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ done_at: today, outcome: 'CONFORME', cost: '', notes: '', open_work_order: true });
  const [files, setFiles] = useState([]);
  const [move, setMove] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) setMove(p.due_date); }, [p]);
  if (error) return <Modal title="Scadenza" onClose={onClose}><Empty icon="alert" title="Errore">{error.message}</Empty></Modal>;
  if (!p) return <Modal title="Scadenza" onClose={onClose}><Loading /></Modal>;
  const chiudi = async () => {
    const fd = new FormData(); for (const [k, v] of Object.entries(f)) if (v !== '' && v != null) fd.append(k, String(v)); for (const x of files) fd.append('file', x, x.name);
    setBusy(true);
    try { const r = await api.upload(`/piano/${p.id}/chiudi`, fd); toast(`Scadenza chiusa${r.next ? `: prossima il ${itDate(r.next.due_date)}` : ''}${r.work_order ? ` · aperto l'intervento ${r.work_order.code}` : ''}${r.payments_notified ? ' · avvisato Payments' : ''}`); onDone(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const sposta = async () => { try { await api.put(`/piano/${p.id}`, { due_date: move }); toast('Scadenza spostata'); onDone(); } catch (e) { toast(e, 'err'); } };
  const annulla = async () => { const motivo = window.prompt('Motivo dell\'annullamento'); if (motivo == null) return; try { await api.post(`/piano/${p.id}/annulla`, { motivo }); toast('Scadenza annullata'); onDone(); } catch (e) { toast(e, 'err'); } };
  const open = ['PIANIFICATA', 'SCADUTA'].includes(p.status);
  return (
    <Modal wide title={p.title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button>{p.can_close && <button className="btn" disabled={busy} onClick={chiudi}><Icon name="check" />{busy ? 'Registrazione' : 'Registra l\'esecuzione'}</button>}</>}>
      <div className="fa-facts" style={{ marginBottom: 12 }}>
        <div><div className="k">Sede</div><div className="v">{p.site_name}</div></div>
        <div><div className="k">{p.asset_id ? 'Dispositivo' : 'Obbligo'}</div><div className="v">{p.asset_id ? <Link to={`${base}/dispositivi/${p.asset_id}`}>{p.asset_code}</Link> : p.obligation_title}</div>{p.type_name && <div className="small muted">{p.type_name}</div>}</div>
        <div><div className="k">Attività</div><div className="v">{PLAN_KIND[p.kind]}</div><div className="small muted">{STREAM[p.stream]} · {ogni(p.interval_months)}</div></div>
        <div><div className="k">A cura di</div><div className="v">{PERFORMER[p.performer]}</div>{p.vendor_name && <div className="small muted">{p.vendor_name}</div>}</div>
        <div><div className="k">Scadenza</div><div className="v">{itDate(p.due_date)}</div><div className="small muted">{open ? giorni(p.days) : ''}</div></div>
        <div><div className="k">Stato</div>{p.status === 'ESEGUITA' ? <Outcome o={p.outcome} /> : <PlanStatus s={p.effective_status} />}</div>
      </div>
      {p.status === 'ESEGUITA' && <div className="fa-muted-box" style={{ marginBottom: 12 }}>Eseguita il {itDate(p.done_at)} da {p.done_by_name || '–'}{p.cost != null ? ` · ${eur(p.cost)}` : ''}{p.notes ? ` · ${p.notes}` : ''}</div>}
      {p.files?.length > 0 && <div style={{ marginBottom: 12 }}><div className="small muted">Rapportini e allegati</div>{p.files.map((x) => <div key={x.id}><FileLink f={x} /> <span className="small muted">{kb(x.size)}</span></div>)}</div>}
      {p.can_close && <Card title="Registra l'esecuzione" icon="check" style={{ marginBottom: 12 }}>
        <div className="fa-grid">
          <Field label="Eseguita il"><input className="fa-in w" type="date" max={today} value={f.done_at} onChange={(e) => setF({ ...f, done_at: e.target.value })} /></Field>
          <Field label="Esito"><select className="fa-in w" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Costo (€)"><input className="fa-in w" type="number" min="0" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder={p.cost_estimate ? `stimato ${p.cost_estimate}` : ''} /></Field>
        </div>
        <Field label="Note"><textarea className="fa-note" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {f.outcome === 'NON_CONFORME' && <label className="row small" style={{ gap: 6, margin: '6px 0' }}><input type="checkbox" checked={f.open_work_order} onChange={(e) => setF({ ...f, open_work_order: e.target.checked })} />Apri un intervento correttivo (priorità alta)</label>}
        <div style={{ marginTop: 8 }}><DropZone onFiles={(xs) => setFiles([...files, ...xs])} accept=".pdf,.png,.jpg,.jpeg,.webp" compact><Icon name="upload" /><div className="small">Rapportino o foto (PDF o immagine)</div></DropZone></div>
        {files.length > 0 && <ul className="fa-list" style={{ marginTop: 8 }}>{files.map((x, i) => <li key={i}><span>{x.name} <span className="muted small">{kb(x.size)}</span></span><button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" /></button></li>)}</ul>}
        <div className="small muted" style={{ marginTop: 6 }}>Alla registrazione nasce la scadenza successiva: data di esecuzione + {p.interval_months} mesi.</div>
      </Card>}
      {open && !p.can_close && <Alert icon="lock">Questa scadenza la chiudono Facility o il manutentore; il site manager conferma solo le sorveglianze di sede.</Alert>}
      {p.can_edit && open && <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="fa-in" type="date" value={move} onChange={(e) => setMove(e.target.value)} /><button className="btn sm ghost" onClick={sposta} disabled={!move || move === p.due_date}>Sposta la scadenza</button>
        <span className="spacer" /><button className="btn sm ghost danger" onClick={annulla}>Annulla la scadenza</button>
      </div>}
      {p.history?.length > 0 && <><div className="small muted" style={{ marginBottom: 6 }}>Storico della serie</div>
        <table className="t fa-table"><tbody>{p.history.map((h) => <tr key={h.id}><td>{itDate(h.due_date)}</td><td>{h.status === 'ESEGUITA' ? `eseguita il ${itDate(h.done_at)}` : <PlanStatus s={h.effective_status} />}</td><td><Outcome o={h.outcome} /></td><td className="small">{h.done_by_name || ''}</td><td className="num">{h.cost != null ? eur(h.cost) : ''}</td></tr>)}</tbody></table></>}
    </Modal>
  );
}
