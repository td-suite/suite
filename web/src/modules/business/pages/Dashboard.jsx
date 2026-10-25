import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge, StatusBadge, KindBadge } from '../components/ui.jsx';
import { itDate, itDateTime, KIND, DOSSIER_STATUS } from '../format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const s = useApi('/stats/summary');
  const d = s.data;
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const n = (kind, statuses) => d.byKind.filter((x) => (!kind || x.kind === kind) && (!statuses || statuses.includes(x.status))).reduce((a, x) => a + x.n, 0);
  const LIVE = ['PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO'];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno, {user.full_name.split(' ')[0]}</h1>
          <div className="sub">Contratti B2B di Toscana Diagnostica: proposte, sottoscrizioni, fascicoli di autorizzazione dei punti prelievo, listini e accessi ai portali. Clicca su un numero per aprire l'elenco.</div>
        </div>
        <div className="row">
          {Object.entries(KIND).filter(([k]) => canEditKind(user, k)).map(([k, v]) => <Link key={k} className="btn" to={`${BASE}/contratti/nuovo/${k}`}>+ {v.one}</Link>)}
        </div>
      </div>

      <div className="grid g4">
        {Object.entries(KIND).map(([k, v]) => (
          <div key={k} onClick={() => nav(`${BASE}/${v.path}`)} style={{ cursor: 'pointer' }}>
            <Kpi accent={k === 'PP'} label={v.label} value={n(k, LIVE)} foot={`${n(k, ['ATTIVO', 'AUTORIZZATO'])} attivi · ${n(k, ['PROPOSTA'])} proposte in attesa di firma · ${n(k, ['BOZZA'])} bozze`} />
          </div>
        ))}
        <div onClick={() => nav(`${BASE}/partner`)} style={{ cursor: 'pointer' }}><Kpi label="Partner e clienti B2B" value={d.partners} foot="anagrafiche attive" /></div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Proposte in attesa di sottoscrizione" flush>
          {d.toSign.length ? (
            <div className="table-wrap" style={{ maxHeight: 340 }}><table className="t">
              <thead><tr><th>Protocollo</th><th>Sezione</th><th>Partner</th><th>Data proposta</th></tr></thead>
              <tbody>{d.toSign.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`${BASE}/contratti/${p.id}`)}>
                  <td className="mono">{p.protocol}</td><td><KindBadge kind={p.kind} /></td><td><div className="strong">{p.partner_name}</div><div className="small muted">{p.title}</div></td><td>{itDate(p.proposal_date)}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Nessuna proposta in attesa</Empty>}
        </Card>
        <Card title="Fascicoli di autorizzazione dei punti prelievo" flush>
          {d.dossiers.length ? (
            <div className="table-wrap" style={{ maxHeight: 340 }}><table className="t">
              <thead><tr><th>Punto prelievi</th><th>Stato</th><th>Completamento</th></tr></thead>
              <tbody>{d.dossiers.map((x) => (
                <tr key={x.contract_id} className="click" onClick={() => nav(`${BASE}/contratti/${x.contract_id}/fascicolo`)}>
                  <td><div className="strong">{x.title}</div><div className="small muted">{x.partner_name} · {x.protocol || 'bozza'}</div></td>
                  <td><Badge tone={DOSSIER_STATUS[x.status]?.tone}>{DOSSIER_STATUS[x.status]?.label}</Badge></td>
                  <td style={{ minWidth: 160 }}><div className="small">{x.done}/{x.required} documenti · {x.pct}%</div><div className="bar" style={{ height: 6, borderRadius: 4, background: 'var(--teal-050)', overflow: 'hidden', marginTop: 4 }}><i style={{ display: 'block', height: '100%', width: `${x.pct}%`, background: x.pct === 100 ? 'var(--green)' : 'var(--teal)' }} /></div></td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Nessun punto prelievi in autorizzazione</Empty>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Da completare" flush>
          {(d.missingLists.length || d.missingCreds.length) ? (
            <table className="t"><tbody>
              {d.missingLists.map((x) => <tr key={`l${x.id}`} className="click" onClick={() => nav(`${BASE}/contratti/${x.id}`)}><td><KindBadge kind={x.kind} /></td><td><div className="strong">{x.partner_name}</div><div className="small muted">{x.protocol}</div></td><td className="small red">Listino non caricato</td></tr>)}
              {d.missingCreds.map((x) => <tr key={`c${x.id}`} className="click" onClick={() => nav(`${BASE}/contratti/${x.id}`)}><td><KindBadge kind={x.kind} /></td><td><div className="strong">{x.partner_name}</div><div className="small muted">{x.protocol}</div></td><td className="small red">Credenziali del portale mancanti</td></tr>)}
            </tbody></table>
          ) : <Empty>Listini e credenziali completi sui contratti firmati</Empty>}
        </Card>
        <Card title="Ultime attività" flush>
          <table className="t"><tbody>
            {d.recent.map((x) => <tr key={x.id} className="click" onClick={() => nav(`${BASE}/contratti/${x.id}`)}><td><KindBadge kind={x.kind} /></td><td><div className="strong">{x.partner_name}</div><div className="small muted">{x.title} · {x.protocol || 'bozza'}</div></td><td><StatusBadge status={x.status} /></td><td className="small muted num">{itDateTime(x.updated_at)}</td></tr>)}
            {!d.recent.length && <tr><td><Empty>Nessun contratto ancora inserito</Empty></td></tr>}
          </tbody></table>
        </Card>
      </div>
    </div>
  );
}
