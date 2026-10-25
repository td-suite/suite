import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BASE } from '../api.js';
import { useApi, Card, Loading, ErrorBox, Empty, Badge, StatusBadge, KindBadge } from '../components/ui.jsx';
import { DOSSIER_STATUS } from '../format.js';

export default function Dossiers() {
  const nav = useNavigate();
  const s = useApi('/stats/summary');
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!s.data) return <div className="page"><Loading /></div>;
  const rows = s.data.dossiers;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Fascicoli di autorizzazione</h1><div className="sub">Punti prelievo presso strutture ospitanti e sedi intestate a Toscana Diagnostica (laboratorio, punti prelievo e centri polidiagnostici flagship): documenti del fascicolo L.R. 51/2009, liste di autovalutazione, personale, strumentazione, esito.</div></div></div>
      <Card flush>{rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede</th><th>Sezione</th><th>Contratto</th><th>Fascicolo</th><th style={{ minWidth: 200 }}>Completamento</th><th>Mancanti</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.contract_id} className="click" onClick={() => nav(`${BASE}/contratti/${x.contract_id}/fascicolo`)}>
              <td><div className="strong">{x.title}</div><div className="small muted">{x.partner_name} · {x.protocol || 'bozza'}</div></td>
              <td><KindBadge kind={x.kind} /></td>
              <td><StatusBadge status={x.contract_status} /></td>
              <td><Badge tone={DOSSIER_STATUS[x.status]?.tone}>{DOSSIER_STATUS[x.status]?.label}</Badge></td>
              <td><div className="small">{x.done}/{x.required} documenti · {x.pct}%</div><div style={{ height: 6, borderRadius: 4, background: 'var(--teal-050)', overflow: 'hidden', marginTop: 4 }}><i style={{ display: 'block', height: '100%', width: `${x.pct}%`, background: x.pct === 100 ? 'var(--green)' : 'var(--teal)' }} /></div></td>
              <td className="small muted">{x.missing.length ? `${x.missing.length} documenti` : 'nessuno'}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessun fascicolo: si crea con un contratto di Punto Prelievi o di Sede TD in locazione</Empty>}</Card>
    </div>
  );
}
