// Scheda partner: cronologia degli audit ISO 37001 della Legal entity e sintesi corrente (livello di conformità, rischio residuo, azioni)
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiBase, base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, useToast, ConfirmModal, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor } from '../index.jsx';
import { Score, Level, StatusBadge, RischioBadge } from '../components/Score.jsx';
import Sintesi from '../components/Sintesi.jsx';
import { itDate, ESITO_LE, RELAZIONE, pct } from '../format.js';

export default function PartnerDetail() {
  const { orgId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi(`/partners/${orgId}`);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const { org, audits, sintesi } = data;
  const auditor = isAuditor(user);
  const gen = async () => { setBusy(true); try { const r = await api.post(`/sintesi/partner/${orgId}`); toast(`Sintesi generata: ${pct(r.score)} (${r.level})`); reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const nuovo = async () => { try { const r = await api.post('/audits', { kind: 'LEGAL_ENTITY', organization_id: Number(orgId) }); nav(`${base}/audit/${r.id}`); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title={org.name} icon="shield" crumb={<Link to={`${base}/partner`}>Partner ISO 37001</Link>} sub={`${org.kind}${org.vat_number ? ` · P.IVA ${org.vat_number}` : ''}${org.city ? ` · ${org.city}` : ''}`}
        actions={<>{auditor && <button className="btn sm ghost" onClick={nuovo}><Icon name="plus" />Nuovo audit</button>}{auditor && <button className="btn sm" disabled={busy || !audits.length} onClick={gen}><Icon name="sparkle" />{sintesi ? 'Rigenera sintesi' : 'Genera sintesi'}</button>}</>} />
      <Sintesi sintesi={sintesi} scope="LEGAL_ENTITY" title="Sintesi ISO 37001 del partner" actions={auditor && <button className="btn sm" disabled={busy || !audits.length} onClick={gen}><Icon name="sparkle" />{sintesi ? 'Rigenera' : 'Genera con Claude'}</button>} />
      <Card title="Audit del partner" icon="clock" flush style={{ marginTop: 14 }}>
        {!audits.length ? <Empty icon="folder" title="Nessun audit">Avvia il primo audit ISO 37001 con "Nuovo audit".</Empty> : <div className="table-wrap"><table className="t au-table">
          <thead><tr><th>Data</th><th>Relazione</th><th>Condotto da</th><th>Stato</th><th>Punteggio</th><th>Livello</th><th>Rischio iniziale</th><th>Rischio finale</th><th>Esito</th><th>Criticità</th><th></th></tr></thead>
          <tbody>{audits.map((a) => <tr key={a.id}><td><Link className="strong" to={`${base}/audit/${a.id}`}>{itDate(a.conducted_at || a.created_at)}</Link></td><td className="small">{RELAZIONE[a.header?.relazione] || '–'}</td><td className="small">{a.header?.effettuato_da || a.conducted_by_name || '–'}</td><td><StatusBadge s={a.status} /></td><td><Score value={a.score} /></td><td><Level letter={a.level} short /></td><td><RischioBadge r={a.header?.livello_rischio_iniziale} /></td><td><RischioBadge r={a.report?.livello_rischio_finale} /></td><td className="small">{ESITO_LE[a.report?.esito] || '–'}</td><td>{a.n_nc || 0}</td>
            <td className="actions au-acts"><a className="iconbtn" href={`${apiBase}/audits/${a.id}/export.pdf?inline=1`} target="_blank" rel="noopener" title="PDF"><Icon name="pdf" /></a>{auditor && <button className="iconbtn trash" title="Elimina" onClick={() => setDel(a)}><Icon name="trash" /></button>}</td></tr>)}</tbody></table></div>}
      </Card>
      {del && <ConfirmModal title="Elimina l'audit" danger confirmText="Elimina" text={`L'audit del ${itDate(del.conducted_at)} viene spostato nel cestino. Gli audit chiusi li elimina solo Qualità.`} onConfirm={async () => { await api.del(`/audits/${del.id}`); toast('Audit eliminato'); reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}
