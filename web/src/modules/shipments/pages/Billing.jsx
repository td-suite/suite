import React, { useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useAuth, canOperate, isSuper } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Kpi, Modal, Field, ErrorBox, Loading, Empty, useApi, useToast } from '../components/ui.jsx';
import { BillBadge } from '../components/orders.jsx';
import { eur, num, fdate, fdt, monthLabel, currentMonth } from '../format.js';

export default function Billing({ project }) {
  const { t, lang } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const months = useApi(`/billing?project=${project}`);
  const [month, setMonth] = useState(null);
  const m = month || months.data?.[0]?.month || currentMonth();
  const det = useApi(`/billing/${m}?project=${project}`, [months.data]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const act = async (fn) => { setErr(null); try { await fn(); toast(t('c.saved')); setModal(null); months.reload(); det.reload(); } catch (e) { setErr(e); } };
  const d = det.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('bil.title')}</h1><div className="sub">{t('bil.sub')}</div></div>
        {d && <div className="row"><a className="btn ghost" href={`${API_BASE}/billing/${m}/export.xlsx?project=${project}`}>{t('bil.xlsx')}</a><a className="btn ghost" href={`${API_BASE}/billing/${m}/statement.pdf?project=${project}&lang=${lang}`} target="_blank" rel="noreferrer">{t('bil.pdf')}</a></div>}
      </div>
      <ErrorBox error={err} />
      <div className="grid g3">
        <Card title={t('bil.months')} flush>
          {!months.data ? <Loading /> : <table className="t"><tbody>{months.data.map((x) => (
            <tr key={x.month} className={`click ${x.month === m ? 'sel' : ''}`} onClick={() => setMonth(x.month)} style={x.month === m ? { background: 'var(--teal-050)' } : undefined}>
              <td className="strong">{monthLabel(x.month, lang)}</td><td><BillBadge status={x.status} /></td><td className="num small">{num(x.shipments)} + {num(x.samples)}</td><td className="num strong">{eur(x.total, lang)}</td>
            </tr>))}</tbody></table>}
        </Card>
        <div className="span2">
          {!d ? <Loading /> : <>
            <div className="grid g3" style={{ marginBottom: 14 }}>
              <Kpi label={t('bil.shipments')} value={eur(d.totalShipping, lang)} foot={`${num(d.ship.length)} ${t('bil.shipments').toLowerCase()}`} />
              <Kpi label={t('bil.samples')} value={eur(d.totalSamples, lang)} foot={`${num(d.samples.length)} × ${eur(d.sampleUnit, lang)}`} />
              <Kpi label={`${t('c.total')} · ${monthLabel(m, lang)}`} value={eur(d.total, lang)} accent foot={d.period ? `${t(`bill.${d.period.status}`)}${d.period.invoice_ref ? ` · ${d.period.invoice_ref}` : ''}` : t('bill.OPEN')} />
            </div>
            <Card title={t('bil.summary')} flush actions={op && <div className="row">
              {(!d.period || d.period.status === 'OPEN') && <button className="btn sm" onClick={() => { if (window.confirm(t('bil.closeConfirm', { m: monthLabel(m, lang) }))) act(() => api.post(`/billing/${m}/close?project=${project}`)); }}>{t('bil.closeMonth')}</button>}
              {d.period && d.period.status !== 'OPEN' && <button className="btn sm ghost" onClick={() => { setErr(null); setForm({ invoice_ref: d.period.invoice_ref || '', invoice_date: d.period.invoice_date || '', notes: d.period.notes || '' }); setModal('invoice'); }}>{t('bil.invoice')}</button>}
              {d.period && d.period.status === 'CLOSED' && isSuper(user) && <button className="btn sm ghost" onClick={() => act(() => api.post(`/billing/${m}/reopen?project=${project}`))}>{t('bil.reopen')}</button>}
            </div>}>
              {(!d.period || d.period.status === 'OPEN') && <div className="inner tight"><div className="alert warn">{t('bil.provisional')}</div></div>}
              {d.period?.closed_at && <div className="inner tight small muted">{t('bil.closedBy')} {d.period.closed_by_name} · {fdt(d.period.closed_at)}{d.period.invoice_ref && ` · ${t('bil.invoiceRef')} ${d.period.invoice_ref}${d.period.invoice_date ? ` (${fdate(d.period.invoice_date)})` : ''}`}</div>}
              <table className="t"><thead><tr><th>{t('c.mode')}</th><th className="num">{t('c.quantity')}</th><th className="num">{t('bil.unit')}</th><th className="num">{t('c.amount')}</th></tr></thead>
                <tbody>{d.byMode.map((x) => <tr key={x.code}><td>{lang === 'en' ? x.name_en : x.name_it}</td><td className="num">{num(x.n)}</td><td className="num">{eur(x.unit, lang)}</td><td className="num">{eur(x.amount, lang)}</td></tr>)}
                  <tr><td>{t('bil.sampleLine')}</td><td className="num">{num(d.samples.length)}</td><td className="num">{eur(d.sampleUnit, lang)}</td><td className="num">{eur(d.totalSamples, lang)}</td></tr></tbody>
                <tfoot><tr><td colSpan={3}>{t('c.total')}</td><td className="num">{eur(d.total, lang)}</td></tr></tfoot></table>
            </Card>
            <div style={{ marginTop: 14 }}><Card title={`${t('bil.detailShip')} (${d.ship.length})`} flush>
              {!d.ship.length ? <Empty>{t('c.none')}</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.date')}</th><th>{t('c.ref')}</th><th>{t('c.kit')}</th><th>{t('c.patient')}</th><th>{t('c.mode')}</th><th className="num">€</th></tr></thead>
                <tbody>{d.ship.map((s) => <tr key={s.id}><td className="small">{fdate(s.date)}</td><td className="mono">{s.external_ref}</td><td className="mono">{s.barcode}</td><td>{s.patient_last_name} {s.patient_first_name}<div className="small muted">{s.city}</div></td><td className="small">{lang === 'en' ? s.mode_en : s.mode_it}</td><td className="num">{eur(s.amount, lang)}</td></tr>)}</tbody></table></div>}
            </Card></div>
            <div style={{ marginTop: 14 }}><Card title={`${t('bil.detailSmp')} (${d.samples.length})`} flush>
              {!d.samples.length ? <Empty>{t('c.none')}</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.date')}</th><th>{t('c.ref')}</th><th>{t('c.kit')}</th><th>{t('c.patient')}</th><th>FedEx AWB</th><th className="num">€</th></tr></thead>
                <tbody>{d.samples.map((s) => <tr key={s.id}><td className="small">{fdate(s.date)}</td><td className="mono">{s.external_ref}</td><td className="mono">{s.barcode}</td><td>{s.patient_last_name} {s.patient_first_name}</td><td className="mono small">{s.awb_number}</td><td className="num">{eur(s.amount, lang)}</td></tr>)}</tbody></table></div>}
            </Card></div>
          </>}
        </div>
      </div>
      {modal === 'invoice' && (
        <Modal title={t('bil.invoice')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.post(`/billing/${m}/invoice?project=${project}`, { invoice_ref: form.invoice_ref || null, invoice_date: form.invoice_date || null, notes: form.notes || null }))}>{t('c.save')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('bil.invoiceRef')}><input value={form.invoice_ref} onChange={(e) => setForm({ ...form, invoice_ref: e.target.value })} /></Field>
          <Field label={t('bil.invoiceDate')}><input type="date" value={form.invoice_date || ''} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
          <Field label={t('c.notes')}><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
