import React, { useState } from 'react';
import { useT } from '../i18n.jsx';
import { Card, Field, useApi } from '../components/ui.jsx';
import { OrdersTable, useDebounce } from '../components/orders.jsx';
import { qs, API_BASE } from '../api.js';

const STATES = ['NEW', 'ASSIGNED', 'SHIPPED', 'DELIVERED', 'SAMPLE_RECEIVED', 'SHIPPED_TO_LAB', 'CLOSED', 'CANCELLED'];
export default function Orders({ project }) {
  const { t } = useT();
  const [f, setF] = useState({ q: '', status: '', order_type: '', from: '', to: '' });
  const dq = useDebounce(f.q);
  const { data } = useApi(`/orders${qs({ project, ...f, q: dq, limit: 500 })}`);
  const csv = `${API_BASE}/reports/orders.csv${qs({ project, from: f.from, to: f.to })}`;
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('nav.orders')}</h1><div className="sub">{t(`proj.${project}`)}</div></div><a className="btn ghost" href={csv}>{t('qty.csv')}</a></div>
      <div className="filters">
        <Field label={t('c.search')}><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={`${t('c.ref')}, ${t('c.kit')}, ${t('c.patient')}`} /></Field>
        <Field label={t('c.status')}><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">{t('c.all')}</option>{STATES.filter((s) => project === 'ENDEAVOR' || s !== 'SHIPPED_TO_LAB').map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
        {project === 'LIFESTYLE' && <Field label={t('c.type')}><select value={f.order_type} onChange={(e) => setF({ ...f, order_type: e.target.value })}><option value="">{t('c.all')}</option><option value="KIT_ONLY">{t('type.KIT_ONLY')}</option><option value="KIT_AND_EXAM">{t('type.KIT_AND_EXAM')}</option></select></Field>}
        <Field label={t('c.from')}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label={t('c.to')}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      <Card flush><OrdersTable rows={data} project={project} columns={['ref', 'patient', 'kit', 'mode', 'status', 'tracking', 'date']} /></Card>
    </div>
  );
}
