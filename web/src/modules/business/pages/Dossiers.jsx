import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BASE, qs } from '../api.js';
import { useAuth, canEditDossier } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, StatusBadge, KindBadge } from '../components/ui.jsx';
import { DOSSIER_STATUS } from '../format.js';

// Fascicoli di autorizzazione sanitaria: ciascuno con la sua sede TD e la sua controparte (anagrafica unica).
// Nascono dai contratti di punto prelievi e di sede TD in locazione, oppure da soli su una sede TD (Nuovo fascicolo).
export default function Dossiers() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useApi(`/dossiers${qs({ q, status })}`);
  const rows = list.data || [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Fascicoli di autorizzazione</h1><div className="sub">Punti prelievo presso strutture ospitanti e sedi intestate a Toscana Diagnostica (laboratorio, punti prelievo e centri polidiagnostici): documenti del fascicolo L.R. 51/2009, liste di autovalutazione, personale, strumentazione, esito. Ogni fascicolo è collegato alla sede TD e, se c'è, alla controparte.</div></div>
        {canEditDossier(user) && <Link className="btn" to={`${BASE}/fascicoli/nuovo`}>+ Nuovo fascicolo</Link>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sede TD, controparte, protocollo" style={{ minWidth: 260 }} /></Field>
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option>{Object.entries(DOSSIER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <div className="spacer" /><div className="small muted">{rows.length} fascicoli</div>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede TD</th><th>Controparte</th><th>Origine</th><th>Contratto</th><th>Fascicolo</th><th style={{ minWidth: 200 }}>Completamento</th><th>Mancanti</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id} className="click" onClick={() => nav(`${BASE}/fascicoli/${x.id}`)}>
              <td>{x.site_name ? <><div className="strong">{x.site_name}</div><div className="small muted">{[x.site_street, x.site_city].filter(Boolean).join(', ')}{x.site_code ? ` · ${x.site_code}` : ''}</div></> : <span className="muted">–</span>}<div className="small muted">{x.label !== x.site_name ? x.label : ''}</div></td>
              <td>{x.org_name ? <><div className="strong">{x.org_name}</div><div className="small muted">{[x.org_city, x.org_prov].filter(Boolean).join(' ')}</div></> : <span className="muted">–</span>}</td>
              <td>{x.contract_kind ? <KindBadge kind={x.contract_kind} /> : <Badge tone="grey">senza contratto</Badge>}<div className="small muted mono">{x.protocol || ''}</div></td>
              <td>{x.contract_status ? <StatusBadge status={x.contract_status} /> : <span className="muted">–</span>}</td>
              <td><Badge tone={DOSSIER_STATUS[x.status]?.tone}>{DOSSIER_STATUS[x.status]?.label}</Badge></td>
              <td><div className="small">{x.done}/{x.required} documenti · {x.pct}%</div><div style={{ height: 6, borderRadius: 4, background: 'var(--teal-050)', overflow: 'hidden', marginTop: 4 }}><i style={{ display: 'block', height: '100%', width: `${x.pct}%`, background: x.pct === 100 ? 'var(--green)' : 'var(--teal)' }} /></div></td>
              <td className="small muted">{x.missing.length ? `${x.missing.length} documenti` : 'nessuno'}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessun fascicolo: nasce con un contratto di Punto Prelievi o di Sede TD in locazione, oppure da "Nuovo fascicolo" su una sede TD.</Empty>}</Card>
    </div>
  );
}
