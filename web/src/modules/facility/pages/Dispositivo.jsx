// Scheda del dispositivo con QR stampabile (apre questa scheda), dati, registro delle scadenze (aperte e storico con esito, rapportini,
// costi) e degli interventi; modifica e dismissione per Facility. QrRedirect risolve il QR stampato sull'etichetta.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, base, useApi, apiBase } from '../api.js';
import { Card, Loading, Empty, PageHead, useToast, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isFacility, isViewer } from '../index.jsx';
import { AssetStatus, Outcome, PlanStatus, Priority, WoStatus, useSites } from '../components/bits.jsx';
import { AssetModal } from './Dispositivi.jsx';
import { CATEGORY, PLAN_KIND, STREAM, PERFORMER, itDate, itDateTime, eur, giorni, ogni } from '../format.js';

export function QrRedirect() {
  const { token } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState(null);
  useEffect(() => { api.get(`/dispositivi/qr/${encodeURIComponent(token)}`).then((r) => nav(`${base}/dispositivi/${r.id}`, { replace: true })).catch(setErr); }, [token]);
  return <div className="page">{err ? <Empty icon="alert" title="QR non valido">{err.message}</Empty> : <Loading text="Apertura della scheda del dispositivo" />}</div>;
}

export default function Dispositivo() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const sites = useSites();
  const { data: a, loading, error, reload } = useApi(`/dispositivi/${id}`);
  const [edit, setEdit] = useState(false);
  const [dismiss, setDismiss] = useState(false);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!a && loading) return <div className="page"><Loading /></div>;
  const today = new Date().toISOString().slice(0, 10);
  const open = a.plans.filter((p) => ['PIANIFICATA', 'SCADUTA'].includes(p.status));
  const hist = a.plans.filter((p) => !['PIANIFICATA', 'SCADUTA'].includes(p.status));
  return (
    <div className="page">
      <PageHead title={`${a.code} · ${a.name || a.type_name}`} icon="qr" crumb={<Link to={`${base}/dispositivi`}>Dispositivi</Link>} sub={`${a.type_name} · ${CATEGORY[a.category]} · ${a.site_name}${a.location ? ` · ${a.location}` : ''}`}
        actions={<>{!isViewer(user) && <Link className="btn ghost" to={`${base}/interventi?site_id=${a.site_id}&asset_id=${a.id}&nuovo=1`}><Icon name="wrench" />Segnala un guasto</Link>}{isFacility(user) && <><button className="btn ghost" onClick={() => setDismiss(true)}><Icon name="trash" />Dismetti</button><button className="btn" onClick={() => setEdit(true)}><Icon name="edit" />Modifica</button></>}</>} />
      <div className="fa-wide">
        <Card title="Dati del dispositivo" icon="info">
          <div className="fa-facts">
            <div><div className="k">Stato</div><AssetStatus s={a.status} /></div>
            <div><div className="k">Ultimo esito</div>{a.last_outcome ? <Outcome o={a.last_outcome} /> : <span className="muted">–</span>}</div>
            <div><div className="k">Marca e modello</div><div className="v">{[a.brand, a.model].filter(Boolean).join(' ') || '–'}</div></div>
            <div><div className="k">Matricola</div><div className="v">{a.serial || '–'}</div></div>
            <div><div className="k">Installato il</div><div className="v">{itDate(a.installed_at) || '–'}</div></div>
            <div><div className="k">Garanzia</div><div className="v" style={{ color: a.warranty_until && a.warranty_until < today ? 'var(--muted)' : undefined }}>{itDate(a.warranty_until) || '–'}</div></div>
            <div><div className="k">Manutentore</div><div className="v">{a.vendor_name || 'interno'}</div>{a.contract_ref && <div className="small muted">{a.contract_ref}</div>}</div>
            <div><div className="k">Prossimo controllo</div><div className="v">{itDate(a.next_check_due) || '–'}</div></div>
            <div><div className="k">Prossima manutenzione</div><div className="v">{itDate(a.next_maintenance_due) || '–'}</div></div>
            <div><div className="k">Costo cumulato</div><div className="v">{eur(a.costo_totale)}</div></div>
          </div>
          {a.legal_reference && <div className="small muted" style={{ marginTop: 10 }}>Riferimento normativo (indicativo): {a.legal_reference}{a.requires_certified_vendor ? ' · richiede manutentore abilitato o ente verificatore' : ''}</div>}
          {a.notes && <div className="fa-muted-box" style={{ marginTop: 10 }}>{a.notes}</div>}
        </Card>
        <Card title="QR del dispositivo" icon="qr">
          <div className="fa-qr">
            <img src={`${apiBase}/dispositivi/${a.id}/qr.png?size=300`} alt={`QR ${a.code}`} />
            <div className="small">
              <div className="strong">{a.code}</div>
              <div className="muted" style={{ margin: '4px 0 10px' }}>Inquadrando il QR con il telefono si apre questa scheda (serve l'accesso alla Suite).</div>
              <div className="row fa-noprint" style={{ gap: 6, flexWrap: 'wrap' }}>
                <a className="btn sm ghost" href={`${apiBase}/etichette.pdf?ids=${a.id}&inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" />Etichetta</a>
                <a className="btn sm ghost" href={`${apiBase}/dispositivi/${a.id}/qr.svg`} target="_blank" rel="noreferrer" download={`QR ${a.code}.svg`}><Icon name="download" />SVG</a>
                <button className="btn sm ghost" onClick={() => window.print()}><Icon name="file" />Stampa</button>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Scadenze aperte" icon="calendar" flush style={{ marginBottom: 16 }}>
        {!open.length ? <Empty compact icon="check" title="Nessuna scadenza aperta" /> : (
          <table className="t fa-table"><thead><tr><th>Scadenza</th><th>Serie</th><th>Attività</th><th>A cura di</th><th>Stato</th><th /></tr></thead>
            <tbody>{open.map((p) => <tr key={p.id} className={p.effective_status === 'SCADUTA' ? 'late' : ''}><td>{itDate(p.due_date)}<div className="small muted">{giorni(Math.round((Date.parse(p.due_date) - Date.parse(today)) / 86400000))}</div></td><td>{STREAM[p.stream]}</td><td>{PLAN_KIND[p.kind]} · {ogni(p.interval_months)}</td><td>{PERFORMER[p.performer]}</td><td><PlanStatus s={p.effective_status} /></td><td><Link className="btn sm" to={`${base}/piano?id=${p.id}`}>Apri</Link></td></tr>)}</tbody></table>)}
      </Card>
      <div className="fa-two">
        <Card title="Registro dei controlli e delle manutenzioni" icon="list" flush>
          {!hist.length ? <Empty compact icon="list" title="Nessun controllo registrato" /> : (
            <table className="t fa-table"><thead><tr><th>Eseguita</th><th>Attività</th><th>Esito</th><th>Da</th><th className="num">Costo</th><th>Rapportino</th></tr></thead>
              <tbody>{hist.map((p) => <tr key={p.id} style={{ opacity: p.status === 'ANNULLATA' ? 0.55 : 1 }}><td>{p.status === 'ANNULLATA' ? <span className="muted">annullata</span> : itDate(p.done_at)}<div className="small muted">scadenza {itDate(p.due_date)}</div></td><td>{PLAN_KIND[p.kind]}<div className="small muted">{STREAM[p.stream]}</div></td><td><Outcome o={p.outcome} /></td><td className="small">{p.done_by_name || '–'}</td><td className="num">{p.cost != null ? eur(p.cost) : ''}</td><td>{p.report_file_id ? <a href={`${apiBase}/files/${p.report_file_id}?inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" /></a> : ''}</td></tr>)}</tbody></table>)}
        </Card>
        <Card title="Interventi sul dispositivo" icon="wrench" flush>
          {!a.work_orders.length ? <Empty compact icon="check" title="Nessun intervento" /> : <ul className="fa-list" style={{ padding: 12 }}>{a.work_orders.map((w) => <li key={w.id}><span><Link className="t" to={`${base}/interventi/${w.id}`}>{w.title}</Link><div className="m">{w.code} · {itDateTime(w.opened_at)}{w.closed_at ? ` → ${itDateTime(w.closed_at)}` : ''}{w.cost != null ? ` · ${eur(w.cost)}` : ''}</div></span><span className="row" style={{ gap: 6 }}><Priority p={w.priority} /><WoStatus s={w.status} /></span></li>)}</ul>}
        </Card>
      </div>
      {edit && <AssetModal sites={sites} asset={a} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
      {dismiss && <ConfirmModal title="Dismetti il dispositivo" danger text="Le scadenze aperte vengono annullate; con uno storico il dispositivo resta nel registro come dismesso, altrimenti viene eliminato." confirmText="Dismetti"
        onConfirm={async () => { try { const r = await api.del(`/dispositivi/${a.id}`); toast(r.dismesso ? 'Dispositivo dismesso' : 'Dispositivo eliminato'); setDismiss(false); if (r.dismesso) reload(); else nav(`${base}/dispositivi`); } catch (e) { toast(e, 'err'); } }} onClose={() => setDismiss(false)} />}
    </div>
  );
}
