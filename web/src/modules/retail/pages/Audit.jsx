import React from 'react';
import { useApi, Card, Loading, ErrorBox } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

export default function Audit() {
  const list = useApi('/audit?limit=300');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Registro attività</h1><div className="sub">Ultime 300 operazioni: accessi, inserimenti, generazioni, caricamenti ed eliminazioni.</div></div></div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Oggetto</th><th>Dettagli</th></tr></thead>
          <tbody>{list.data.map((a) => <tr key={a.id}><td className="small">{itDateTime(a.at)}</td><td>{a.user_name || '–'}</td><td className="mono">{a.action}</td><td className="small muted">{a.entity} {a.entity_id}</td><td className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data ? JSON.stringify(a.data) : ''}</td></tr>)}</tbody></table></div>
      )}</Card>
    </div>
  );
}
