import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, isSuper } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Field, ErrorBox, Loading, Badge, Modal, useApi, useToast } from '../components/ui.jsx';
import { fdt } from '../format.js';

const TEXT = ['billing_customer', 'billing_customer_address', 'affinity_notify_emails', 'affinity_sender_filter', 'notify_admins_email', 'td_sites'];
const AREA = ['lab_consignee', 'return_address'];
const NUMS = ['sample_fee', 'alert_return_days', 'alert_awb_days', 'alert_stock_min', 'retention_months'];
const BOOLS = ['daily_alerts_enabled', 'notify_patient_on_ship', 'notify_affinity_on_ship', 'inbox_enabled'];
const LABEL = { sample_fee: 'set.sampleFee', billing_customer: 'set.customer', billing_customer_address: 'set.customerAddr', affinity_notify_emails: 'set.notify', affinity_sender_filter: 'set.senderFilter', lab_consignee: 'set.consignee', return_address: 'set.returnAddr', td_sites: 'set.sites', alert_return_days: 'set.alertReturn', alert_awb_days: 'set.alertAwb', alert_stock_min: 'set.alertStock', daily_alerts_enabled: 'set.dailyAlerts', notify_patient_on_ship: 'set.notifyPatient', notify_affinity_on_ship: 'set.notifyAffinityShip', notify_admins_email: 'set.adminsEmail', retention_months: 'set.retention', inbox_enabled: 'set.inbox' };

export default function Settings() {
  const { t, lang } = useT();
  const { user } = useAuth();
  const sup = isSuper(user);
  const toast = useToast();
  const { data, reload } = useApi('/settings');
  const modes = useApi('/modes?all=1');
  const types = useApi('/kit-types');
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null);
  const [testTo, setTestTo] = useState(user.email);
  const [newType, setNewType] = useState('');
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!data || !s) return <Loading />;
  const save = async () => { setErr(null); try { await api.put('/settings', s); toast(t('c.saved')); reload(); } catch (e) { setErr(e); } };
  const run = async (job) => { setErr(null); try { const r = await api.post(`/settings/run/${job}`); toast(JSON.stringify(r).slice(0, 200)); reload(); } catch (e) { setErr(e); } };
  const saveMode = async () => {
    setErr(null);
    const b = { ...mode, price: Number(mode.price), sort: Number(mode.sort || 0), outbound_service: mode.outbound_service || null, return_service: mode.return_service || null, email_aliases: mode.email_aliases || null };
    delete b.id;
    try { if (mode.id) await api.put(`/modes/${mode.id}`, b); else await api.post('/modes', b); toast(t('c.saved')); setMode(null); modes.reload(); } catch (e) { setErr(e); }
  };
  const svc = (v) => (v === 'EXPRESS' ? 'Express' : v === 'STANDARD' ? 'Standard' : '–');
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('set.title')}</h1></div>{sup && <button className="btn" onClick={save}>{t('c.save')}</button>}</div>
      <ErrorBox error={err} />
      <div className="grid g3">
        <Card title={t('set.tariffs')} className="span2" flush actions={sup && <button className="btn sm" onClick={() => setMode({ project: 'ENDEAVOR', code: '', name_it: '', name_en: '', outbound_service: 'STANDARD', return_service: '', price: 0, email_aliases: '', active: true, sort: 100 })}>+ {t('c.new')}</button>}>
          <div className="inner tight"><div className="small muted">{t('set.tariffsSub')}</div></div>
          <table className="t"><thead><tr><th>{t('c.mode')}</th><th>{t('ord.out')}</th><th>{t('ord.ret')}</th><th className="num">{t('set.price')}</th><th>{t('set.aliases')}</th><th /></tr></thead>
            <tbody>{(modes.data || []).map((m) => (
              <tr key={m.id} style={m.active ? undefined : { opacity: .5 }}><td><div className="strong">{lang === 'en' ? m.name_en : m.name_it}</div><div className="small muted mono">{m.code}</div></td><td>{svc(m.outbound_service)}</td><td>{svc(m.return_service)}</td><td className="num strong">{Number(m.price).toFixed(2)}</td><td style={{ maxWidth: 300 }}>{String(m.email_aliases || '').split('|').map((a) => a.trim()).filter(Boolean).map((a) => <span key={a} className="chip">{a}</span>)}</td>
                <td className="num">{sup && <button className="btn sm ghost" onClick={() => setMode({ ...m, return_service: m.return_service || '', outbound_service: m.outbound_service || '', email_aliases: m.email_aliases || '' })}>{t('c.edit')}</button>}</td></tr>))}</tbody></table>
          <div className="inner fee"><Field label={t('set.sampleFee')} className="inline"><input type="number" step="0.01" value={s.sample_fee} disabled={!sup} onChange={(e) => setS({ ...s, sample_fee: e.target.value })} style={{ maxWidth: 160 }} /></Field></div>
        </Card>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title={t('set.mail')}>
            <div>{data.mail.configured ? <Badge tone="green">{data.mail.mode === 'microsoft365' ? t('set.mailOn') : t('set.mailSmtp')}</Badge> : <Badge tone="red">{t('set.mailOff')}</Badge>} {data.mail.from && <span className="small muted">{data.mail.from}</span>}</div>
            <div style={{ marginTop: 8 }} className="small">{t('set.inbox')}: {data.mail.inboxConfigured ? <Badge tone="green">{data.mail.inbox}</Badge> : <Badge>{t('set.trackingOff')}</Badge>} {data.inbox.lastPoll && <span className="muted">· {t('set.lastRun')} {fdt(data.inbox.lastPoll)}</span>}</div>
            <div style={{ marginTop: 8 }} className="small">{t('set.trackingSda')}: <Badge tone={data.tracking.sda ? 'green' : 'grey'}>{data.tracking.sda || t('set.trackingOff')}</Badge> · {t('set.trackingFedex')}: <Badge tone={data.tracking.fedex ? 'green' : 'grey'}>{data.tracking.fedex ? 'API' : t('set.trackingOff')}</Badge></div>
            <div className="small muted" style={{ marginTop: 8 }}>{t('set.env')}</div>
            {sup && <div className="row" style={{ marginTop: 10 }}><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 240 }} /><button className="btn sm ghost" onClick={async () => { const r = await api.post('/settings/test-email', { to: testTo }); toast(r.status + (r.error ? `: ${r.error}` : '')); }}>{t('set.testEmail')}</button></div>}
          </Card>
          <Card title={t('set.jobs')}>
            <div className="row"><button className="btn sm ghost" onClick={() => run('inbox')}>{t('set.runInbox')}</button><button className="btn sm ghost" onClick={() => run('tracking')}>{t('set.runTracking')}</button><button className="btn sm ghost" onClick={() => run('alerts')}>{t('set.runAlerts')}</button></div>
            {data.alerts.lastRun && <div className="small muted" style={{ marginTop: 8 }}>{t('set.runAlerts')}: {t('set.lastRun')} {data.alerts.lastRun}</div>}
          </Card>
          <Card title={t('set.kitTypes')}>
            <div className="row">{(types.data || []).map((k) => <span key={k.id} className="chip" style={k.active ? undefined : { opacity: .5 }}>{k.name}</span>)}</div>
            {sup && <div className="row" style={{ marginTop: 8 }}><input value={newType} onChange={(e) => setNewType(e.target.value)} style={{ maxWidth: 220 }} /><button className="btn sm ghost" disabled={newType.trim().length < 2} onClick={async () => { await api.post('/kit-types', { name: newType.trim() }); setNewType(''); types.reload(); }}>+</button></div>}
          </Card>
        </div>
      </div>
      <div style={{ marginTop: 16 }}><Card title={t('set.general')}>
        <div className="form-grid">
          {TEXT.map((k) => <Field key={k} label={t(LABEL[k])} className={['affinity_notify_emails', 'td_sites', 'billing_customer_address'].includes(k) ? 'span2' : ''}><input value={s[k]} disabled={!sup} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>)}
          {NUMS.filter((k) => k !== 'sample_fee').map((k) => <Field key={k} label={t(LABEL[k])}><input type="number" value={s[k]} disabled={!sup} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>)}
          {AREA.map((k) => <Field key={k} label={t(LABEL[k])}><textarea rows={5} value={s[k]} disabled={!sup} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>)}
          {BOOLS.map((k) => <label key={k} className="f inline"><input type="checkbox" checked={s[k] === 'true'} disabled={!sup} onChange={(e) => setS({ ...s, [k]: e.target.checked ? 'true' : 'false' })} />{t(LABEL[k])}</label>)}
        </div>
        {sup && <div className="row end" style={{ marginTop: 14 }}><button className="btn" onClick={save}>{t('c.save')}</button></div>}
      </Card></div>
      {mode && (
        <Modal title={mode.id ? `${t('c.edit')} ${mode.code}` : t('c.new')} onClose={() => setMode(null)} footer={<><button className="btn ghost" onClick={() => setMode(null)}>{t('c.cancel')}</button><button className="btn" disabled={!mode.code || !mode.name_it || !mode.name_en} onClick={saveMode}>{t('c.save')}</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Codice / Code"><input value={mode.code} disabled={!!mode.id} onChange={(e) => setMode({ ...mode, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /></Field>
            <Field label={t('set.price')}><input type="number" step="0.01" value={mode.price} onChange={(e) => setMode({ ...mode, price: e.target.value })} /></Field>
            <Field label="Nome (IT)"><input value={mode.name_it} onChange={(e) => setMode({ ...mode, name_it: e.target.value })} /></Field>
            <Field label="Name (EN)"><input value={mode.name_en} onChange={(e) => setMode({ ...mode, name_en: e.target.value })} /></Field>
            <Field label={t('ord.out')}><select value={mode.outbound_service} onChange={(e) => setMode({ ...mode, outbound_service: e.target.value })}><option value="">{t('ord.noLeg')}</option><option value="STANDARD">Standard</option><option value="EXPRESS">Express</option></select></Field>
            <Field label={t('ord.ret')}><select value={mode.return_service} onChange={(e) => setMode({ ...mode, return_service: e.target.value })}><option value="">{t('ord.noLeg')}</option><option value="STANDARD">Standard</option><option value="EXPRESS">Express</option></select></Field>
            <Field label={t('set.aliases')} className="span2" help="a | b | c"><input value={mode.email_aliases} onChange={(e) => setMode({ ...mode, email_aliases: e.target.value })} /></Field>
            <Field label="Ordine / Sort"><input type="number" value={mode.sort} onChange={(e) => setMode({ ...mode, sort: e.target.value })} /></Field>
            <label className="f inline"><input type="checkbox" checked={!!mode.active} onChange={(e) => setMode({ ...mode, active: e.target.checked })} />{t('c.active')}</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
