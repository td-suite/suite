import React, { useState } from 'react';
import { useT } from '../i18n.jsx';
import { Card, Field, Loading, useApi } from '../components/ui.jsx';
import { useDebounce } from '../components/orders.jsx';
import { fdt } from '../format.js';
import { qs } from '../api.js';

export default function Audit() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const { data } = useApi(`/audit${qs({ q: dq })}`);
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('aud.title')}</h1></div></div>
      <div className="filters"><Field label={t('c.search')}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
      <Card flush>{!data ? <Loading /> : <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.date')}</th><th>{t('aud.who')}</th><th>{t('aud.action')}</th><th>{t('aud.entity')}</th><th>{t('aud.data')}</th></tr></thead>
        <tbody>{data.map((a) => <tr key={a.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(a.at)}</td><td>{a.full_name || '–'}</td><td className="mono small">{a.action}</td><td className="small">{a.entity} {a.entity_id}</td><td className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data ? JSON.stringify(a.data) : ''}</td></tr>)}</tbody></table></div>}</Card>
    </div>
  );
}
