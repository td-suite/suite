import React from 'react';
import { useT } from '../i18n.jsx';
import { Card, Loading, useApi } from '../components/ui.jsx';
import { fdt } from '../format.js';

export default function Emails() {
  const { t } = useT();
  const { data } = useApi('/email-log');
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('em.title')}</h1></div></div>
      <Card flush>{!data ? <Loading /> : <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.date')}</th><th>{t('em.kind')}</th><th>{t('em.to')}</th><th>{t('inbox.subject')}</th><th>{t('c.status')}</th></tr></thead>
        <tbody>{data.map((e) => <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(e.sent_at)}</td><td className="mono small">{e.kind}</td><td className="small">{e.to_addr}{e.cc_addr && <div className="muted">cc {e.cc_addr}</div>}</td><td>{e.subject}</td><td><span className={`badge ${e.status === 'INVIATA' ? 'b-green' : e.status === 'FALLITA' ? 'b-red' : 'b-grey'}`}>{e.status}</span>{e.error && <div className="small red">{e.error}</div>}</td></tr>)}</tbody></table></div>}</Card>
    </div>
  );
}
