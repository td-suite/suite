import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useApi, Card, Badge, Skeleton, Empty, Coming, PageHead } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, timeAgo } from '../../format.js';
import { UsersList, UserDetail } from './Users.jsx';
import { Sites, Organizations, PeopleAdmin } from './Registry.jsx';
import { Modules, Legacy, ApiKeys, Imports, Audit, Settings } from './System.jsx';
import { Organization } from './Registry.jsx';
import { NotFound } from '../Misc.jsx';
import { Travaso } from './Travaso.jsx';

function Overview() {
  const summary = useApi('/users/summary');
  const legacy = useApi('/legacy/sources');
  const audit = useApi('/audit');
  const s = summary.data || {};
  const sources = Array.isArray(legacy.data) ? legacy.data : legacy.data?.rows || [];
  return (
    <div className="page">
      <PageHead title="Amministrazione" icon="admin" sub="Utenti e profili, anagrafiche, importazioni e controllo della Suite" actions={<Link to="/admin/users/new" className="btn"><Icon name="plus" />Nuovo utente</Link>} />
      <div className="grid g4 mb2">
        {summary.loading ? [1, 2, 3, 4].map((i) => <div key={i} className="card kpi"><Skeleton lines={2} /></div>) : <>
          <Link to="/admin/users?status=ACTIVE" className="card kpi" style={{ color: 'inherit' }}><div className="lbl">Utenti attivi</div><div className="val">{s.active ?? 0}</div></Link>
          <Link to="/admin/users?status=PENDING" className="card kpi" style={{ color: 'inherit' }}><div className="lbl">In attesa di abilitazione</div><div className="val" style={{ color: s.pending ? 'var(--mauve-700)' : undefined }}>{s.pending ?? 0}</div>{s.pending > 0 && <div className="foot">Da abilitare</div>}</Link>
          <Link to="/admin/users?proposals=1" className="card kpi" style={{ color: 'inherit' }}><div className="lbl">Proposte di accesso</div><div className="val" style={{ color: s.with_proposals ? 'var(--amber)' : undefined }}>{s.with_proposals ?? 0}</div><div className="foot">utenti con grant da confermare</div></Link>
          <Link to="/admin/users?status=DISABLED" className="card kpi" style={{ color: 'inherit' }}><div className="lbl">Disattivati</div><div className="val muted">{s.disabled ?? 0}</div></Link>
        </>}
      </div>
      <div className="grid g2">
        <Card title="Sorgenti legacy" icon="refresh" flush actions={<Link to="/admin/legacy" className="small">Gestisci</Link>}>
          {legacy.loading && <div style={{ padding: 18 }}><Skeleton /></div>}
          {legacy.unavailable && <Coming what="Il monitoraggio delle sorgenti" compact />}
          {legacy.data && !sources.length && <Empty icon="refresh" compact title="Nessuna sorgente configurata" />}
          <div className="list">{sources.map((src) => (
            <div key={src.key} className="it" style={{ alignItems: 'center' }}>
              <Badge tone={!src.enabled ? 'grey' : src.last_status === 'OK' ? 'green' : src.last_status ? 'red' : 'amber'}>{!src.enabled ? 'Spenta' : src.last_status || 'Mai eseguita'}</Badge>
              <div style={{ flex: 1 }}><div className="t">{src.label || src.key}</div><div className="m">{src.last_sync_at ? `ultimo sync ${timeAgo(src.last_sync_at)}` : 'nessuna sincronizzazione'}</div></div>
            </div>
          ))}</div>
        </Card>
        <Card title="Ultime attività" icon="shield" flush actions={<Link to="/admin/audit" className="small">Audit completo</Link>}>
          {audit.loading && <div style={{ padding: 18 }}><Skeleton /></div>}
          {audit.data && !audit.data.length && <Empty icon="shield" compact title="Nessuna attività registrata" />}
          <div className="list">{(audit.data || []).slice(0, 10).map((a) => (
            <div key={a.id} className="it"><div style={{ flex: 1 }}><div className="t"><span className="mono small">{a.action}</span>{a.label && <span className="muted"> · {a.label}</span>}</div><div className="m">{a.user_name || 'sistema'} · {fmtDateTime(a.at)}</div></div></div>
          ))}</div>
        </Card>
      </div>
    </div>
  );
}

export default function Admin() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="users" element={<UsersList />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="sites" element={<Sites />} />
      <Route path="organizations" element={<Organizations />} />
      <Route path="people" element={<PeopleAdmin />} />
      <Route path="modules" element={<Modules />} />
      <Route path="organization" element={<Organization />} />
      <Route path="legacy" element={<Legacy />} />
      <Route path="api-keys" element={<ApiKeys />} />
      <Route path="travaso" element={<Travaso />} />
      <Route path="imports" element={<Imports />} />
      <Route path="audit" element={<Audit />} />
      <Route path="settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
