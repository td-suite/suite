// Scheda sede: cronologia degli audit, andamento degli auto-audit, sintesi corrente con aree e azioni per urgenza, piano di
// miglioramento, pulsante Rigenera; nuovo audit interno e caricamento di terze parti.
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiBase, base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Kpi, useToast, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor } from '../index.jsx';
import { Score, Level, KindBadge, StatusBadge, ScoreCell } from '../components/Score.jsx';
import Sintesi from '../components/Sintesi.jsx';
import { TerziModal } from './Sedi.jsx';
import { SITE_KIND, mese, dataAudit, itDateTime, pct } from '../format.js';

export default function Sede() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi(`/sites/${id}`);
  const [busy, setBusy] = useState(false);
  const [terzi, setTerzi] = useState(false);
  const [del, setDel] = useState(null);
  if (error) return <div className="page"><Empty icon="alert" title={error.status === 403 ? 'Sede non assegnata' : 'Errore'}>{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const { site, sgi, audits, sintesi, trend } = data;
  const auditor = isAuditor(user);
  const gen = async () => { setBusy(true); try { const r = await api.post(`/sintesi/sede/${id}`); toast(`Sintesi generata: ${pct(r.score)} (${r.level})`); reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const nuovoInterno = async () => { try { const r = await api.post('/audits', { kind: 'INTERNO', site_id: Number(id) }); nav(`${base}/audit/${r.id}`); } catch (e) { toast(e, 'err'); } };
  const ultimoAuto = audits.find((a) => a.kind === 'AUTO');
  return (
    <div className="page">
      <PageHead title={site.name} icon="building" crumb={<Link to={`${base}/sedi`}>Sedi</Link>} sub={`${SITE_KIND[site.kind] || site.kind}${site.city ? ` · ${site.city}` : ''} · ${site.code}${site.manager_name ? ` · site manager ${site.manager_name}` : ''}`}
        actions={<>{auditor && <button className="btn sm ghost" onClick={nuovoInterno}><Icon name="plus" />Nuovo audit interno</button>}{auditor && <button className="btn sm ghost" onClick={() => setTerzi(true)}><Icon name="upload" />Carica terze parti</button>}{auditor && <button className="btn sm" disabled={busy || !audits.length} onClick={gen}><Icon name="sparkle" />{sintesi ? 'Rigenera sintesi' : 'Genera sintesi'}</button>}<Link className="btn sm ghost" to={`/retail/sedi/${id}`} title="Scheda della sede in Retail Assistant"><Icon name="external" />Retail Assistant</Link></>} />
      <div className="au-kpis">
        <Kpi accent label="Allineamento SGI" value={sgi?.score != null ? pct(sgi.score) : '–'} foot={sgi ? `${sgi.level ? `${sgi.level} · ` : ''}sintesi del ${itDateTime(sgi.computed_at)}` : 'nessuna sintesi'} />
        <Kpi label="Ultimo auto-audit" value={ultimoAuto ? pct(ultimoAuto.effective_score) : '–'} foot={ultimoAuto ? `${mese(ultimoAuto.period)} · ${ultimoAuto.status_label}` : 'nessuno'} />
        <Kpi label="Audit" value={audits.length} foot={`${audits.filter((a) => a.kind === 'AUTO').length} auto · ${audits.filter((a) => a.kind === 'INTERNO').length} interni · ${audits.filter((a) => a.kind === 'TERZI').length} terze parti`} />
        <Kpi label="NC (ultimi audit)" value={audits.slice(0, 6).reduce((n, a) => n + (a.n_nc || 0), 0)} foot="negli ultimi 6 audit" />
      </div>
      {trend.length > 1 && <Card title="Andamento degli auto-audit" icon="stats" style={{ marginBottom: 14 }}>
        <div className="au-trend">{trend.map((p) => <div className="b" key={p.period} title={`${mese(p.period)}: sede ${pct(p.score)}${p.score_verifier != null ? `, verifica ${pct(p.score_verifier)}` : ''}`}><span className="small">{pct(p.effective_score)}</span><i style={{ height: `${Math.max(2, (Number(p.effective_score) || 0) * 0.5)}px` }} /><span>{String(p.period).slice(5, 7)}/{String(p.period).slice(2, 4)}</span></div>)}</div>
      </Card>}
      <Sintesi sintesi={sintesi} scope="SEDE" actions={auditor && <button className="btn sm" disabled={busy || !audits.length} onClick={gen}><Icon name="sparkle" />{sintesi ? 'Rigenera' : 'Genera con Claude'}</button>} />
      <Card title="Cronologia degli audit" icon="clock" flush style={{ marginTop: 14 }}>
        {!audits.length ? <Empty icon="folder" title="Nessun audit per questa sede">L'auto-audit del mese nasce da I miei audit; gli audit interni e di terze parti dai pulsanti in alto.</Empty> : <div className="table-wrap"><table className="t au-table">
          <thead><tr><th>Data / mese</th><th>Tipo</th><th>Condotto da</th><th>Stato</th><th>Punteggio</th><th>Livello</th><th>NC</th><th>Allegati</th><th></th></tr></thead>
          <tbody>{audits.map((a) => <tr key={a.id}><td><Link className="strong" to={`${base}/audit/${a.id}`}>{dataAudit(a)}</Link></td><td><KindBadge k={a.kind} /></td><td className="small">{a.kind === 'TERZI' ? a.third_party?.ente : (a.header?.effettuato_da || a.conducted_by_name || '–')}</td><td><StatusBadge s={a.status} /></td><td><ScoreCell a={a} /></td><td><Level letter={a.level} short /></td><td>{a.n_nc || 0}</td><td>{a.n_files || 0}</td>
            <td className="actions au-acts"><a className="iconbtn" href={`${apiBase}/audits/${a.id}/export.pdf?inline=1`} target="_blank" rel="noopener" title="PDF"><Icon name="pdf" /></a>{(auditor || a.status === 'BOZZA') && <button className="iconbtn trash" title="Elimina" onClick={() => setDel(a)}><Icon name="trash" /></button>}</td></tr>)}</tbody></table></div>}
      </Card>
      {terzi && <TerziModal site={site} onClose={() => setTerzi(false)} onDone={(aid) => { setTerzi(false); reload(); nav(`${base}/audit/${aid}`); }} />}
      {del && <ConfirmModal title="Elimina l'audit" danger confirmText="Elimina" text={`${del.kind_label} del ${dataAudit(del)}: viene spostato nel cestino (eliminazione logica) e sparisce dall'archivio. Gli audit chiusi o verificati li elimina solo Qualità.`} onConfirm={async () => { await api.del(`/audits/${del.id}`); toast('Audit eliminato'); reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}
