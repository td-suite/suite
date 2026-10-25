import React, { useState } from 'react';
import { useApi, Loading, Empty, Field } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { qs } from '../api.js';

const ACTION = {
  ACTIVITY_UPDATED: 'Attività modificata', ACTIVITY_CREATED: 'Attività aggiunta', ACTIVITY_DELETED: 'Attività eliminata', ACTIVITIES_REORDERED: 'Attività riordinate',
  TARGET_UPDATED: 'Scheda target modificata', TARGET_CREATED: 'Target aggiunta', TARGET_DELETED: 'Target eliminata', TEAM_UPDATED: 'Registro ruoli',
  PLAN_IMPORTED: 'Import da file', PLAN_RESTORED: 'Ripristino snapshot', PLAN_SEEDED: 'Migrazione iniziale', SNAPSHOT_CREATED: 'Snapshot',
  LOGIN: 'Accesso', LOGOUT: 'Uscita', LOGIN_FAILED: 'Accesso fallito', USER_CREATED: 'Utente creato', USER_UPDATED: 'Utente modificato',
  USER_SELF_REGISTERED: 'Primo accesso Microsoft', USER_PASSWORD_RESET: 'Reset password', PASSWORD_CHANGED: 'Password cambiata',
};

export default function Audit() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const { data } = useApi(`/audit${qs({ action, target, limit: 500 })}`);
  const targets = [...new Set((data || []).map((a) => a.target_id).filter(Boolean))].sort();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Registro attività</h1><div className="sub">Chi ha fatto cosa e quando: ogni modifica al piano con il valore prima e dopo, accessi, import e ripristini. Questo registro sostituisce il "registro revisioni" del vecchio file.</div></div></div>
      <div className="filters">
        <Field label="Azione"><select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Tutte</option>{Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Target"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Tutte</option>{targets.map((t) => <option key={t}>{t}</option>)}</select></Field>
      </div>
      <div className="card">
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna attività</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Dettaglio</th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(a.at)}</td>
              <td>{a.full_name || <span className="muted">sistema</span>}<div className="small muted">{a.email}</div></td>
              <td className="small"><span className="badge b-grey">{ACTION[a.action] || a.action}</span></td>
              <td className="small">{a.label || `${a.entity || ''} ${a.entity_id || ''}`}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
