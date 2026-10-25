import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, canOperate } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Field, ErrorBox, useApi, useToast } from '../components/ui.jsx';
import { OrdersTable, BarcodeInput, useSettingsPublic } from '../components/orders.jsx';
import { patientName, projectPath, today } from '../format.js';

export default function Returns({ project }) {
  const { t } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const pub = useSettingsPublic();
  const sites = (pub.data?.td_sites || '').split(',').map((s) => s.trim()).filter(Boolean);
  const [code, setCode] = useState('');
  const [date, setDate] = useState(today());
  const [site, setSite] = useState('');
  const [last, setLast] = useState(null);
  const [err, setErr] = useState(null);
  const waiting = useApi(`/orders${qs({ project, status: 'SHIPPED,DELIVERED', limit: 500 })}`, [last?.id]);
  const received = useApi(`/orders${qs({ project, status: project === 'ENDEAVOR' ? 'SAMPLE_RECEIVED' : 'CLOSED', limit: 50 })}`, [last?.id]);
  const p = projectPath(project);
  const register = async (c) => {
    const b = (c || code).trim();
    if (!b) return;
    setErr(null);
    try {
      const o = await api.post('/orders/sample-received', { barcode: b, received_at: date, site: project === 'LIFESTYLE' ? (site || sites[0] || null) : null });
      setLast(o); setCode(''); toast(t('ret.ok', { b: o.barcode, p: patientName(o) }));
    } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('ret.title')}</h1><div className="sub">{t('ret.sub')}</div></div></div>
      {op && (
        <Card title={t('ret.scan')} className="" >
          <ErrorBox error={err} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 260 }}><BarcodeInput autoFocus value={code} onChange={setCode} onEnter={register} /></div>
            <Field label={t('ord.sampleDate')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></Field>
            {project === 'LIFESTYLE' && <Field label={t('ret.site')}><select value={site || sites[0] || ''} onChange={(e) => setSite(e.target.value)} style={{ width: 200 }}>{sites.map((s) => <option key={s}>{s}</option>)}</select></Field>}
            <button className="btn lg" onClick={() => register()} disabled={!code}>{t('ret.register')}</button>
          </div>
          {last && <div className="bigok" style={{ marginTop: 12 }}>✓ {t('ret.ok', { b: last.barcode, p: patientName(last) })} · <Link to={`/${p}/richieste/${last.id}`}>{last.external_ref || `#${last.id}`}</Link>{project === 'ENDEAVOR' && <> · <Link to={`/${p}/laboratorio`}>{t('nav.lab')} →</Link></>}</div>}
        </Card>
      )}
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={`${t('ret.waiting')} (${waiting.data?.length ?? '…'})`} flush><OrdersTable rows={waiting.data} project={project} columns={['ref', 'patient', 'kit', 'status', 'delivered']} /></Card>
        <Card title={t('ret.todayList')} flush><OrdersTable rows={received.data} project={project} columns={['ref', 'patient', 'kit', 'status', 'sample']} /></Card>
      </div>
    </div>
  );
}
