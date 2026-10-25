import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { useT } from '../i18n.jsx';
import { Card, Field, Loading, useApi } from '../components/ui.jsx';
import { StatusBadge, KitBadge } from '../components/orders.jsx';
import { eur, num, today } from '../format.js';
import { qs, API_BASE } from '../api.js';

export default function Quantitative({ project }) {
  const { t, lang } = useT();
  const [f, setF] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const { data } = useApi(`/reports/quantitative${qs({ project, ...f })}`);
  const cols = ['stock_in', 'requests', 'shipped', 'delivered', 'samples', ...(project === 'ENDEAVOR' ? ['to_lab'] : []), 'closed', 'cancelled'];
  const L = { stock_in: t('qty.stockIn'), requests: t('qty.requests'), shipped: t('qty.shipped'), delivered: t('qty.delivered'), samples: t('qty.samples'), to_lab: t('qty.toLab'), closed: t('qty.closed'), cancelled: t('qty.cancelled') };
  const sum = (k) => (data?.perMonth || []).reduce((a, m) => a + Number(m[k] || 0), 0);
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('qty.title')}</h1><div className="sub">{t('qty.sub')} · {t(`proj.${project}`)}</div></div><a className="btn ghost" href={`${API_BASE}/reports/orders.csv${qs({ project, ...f })}`}>{t('qty.csv')}</a></div>
      <div className="filters"><Field label={t('c.from')}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label={t('c.to')}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      {!data ? <Loading /> : <>
        <Card title={t('qty.perMonth')} flush>
          <div className="inner"><div style={{ height: 220 }}><ResponsiveContainer><BarChart data={data.perMonth} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf2f3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="requests" name={L.requests} fill="#01212C" radius={[4, 4, 0, 0]} /><Bar dataKey="shipped" name={L.shipped} fill="#1C505E" radius={[4, 4, 0, 0]} /><Bar dataKey="samples" name={L.samples} fill="#71B1BD" radius={[4, 4, 0, 0]} />{project === 'ENDEAVOR' && <Bar dataKey="to_lab" name={L.to_lab} fill="#DEC0F1" radius={[4, 4, 0, 0]} />}</BarChart></ResponsiveContainer></div></div>
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.month')}</th>{cols.map((c) => <th key={c} className="num">{L[c]}</th>)}</tr></thead>
            <tbody>{data.perMonth.map((m) => <tr key={m.month}><td className="strong">{m.month}</td>{cols.map((c) => <td key={c} className="num">{num(m[c])}</td>)}</tr>)}</tbody>
            <tfoot><tr><td>{t('c.total')}</td>{cols.map((c) => <td key={c} className="num">{num(sum(c))}</td>)}</tr></tfoot></table></div>
        </Card>
        <div className="grid g3" style={{ marginTop: 16 }}>
          <Card title={t('qty.byMode')} flush>
            <table className="t"><thead><tr><th>{project === 'ENDEAVOR' ? t('c.mode') : t('c.type')}</th><th className="num">{t('c.quantity')}</th>{project === 'ENDEAVOR' && <th className="num">€</th>}</tr></thead>
              <tbody>{data.byMode.map((m) => <tr key={m.code}><td>{project === 'ENDEAVOR' ? (lang === 'en' ? m.name_en : m.name_it) : t(`type.${m.code}`)}</td><td className="num">{num(m.n)}</td>{project === 'ENDEAVOR' && <td className="num">{eur(m.fees, lang)}</td>}</tr>)}{!data.byMode.length && <tr><td colSpan={3} className="muted">{t('c.none')}</td></tr>}</tbody></table>
          </Card>
          <Card title={t('qty.times')} flush>
            <table className="t"><tbody>{Object.entries(data.times || {}).filter(([k]) => project === 'ENDEAVOR' || k !== 'sample_to_lab').map(([k, v]) => <tr key={k}><td>{t(`qty.t.${k}`)}</td><td className="num strong">{v == null ? '–' : Number(v).toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT')}</td></tr>)}</tbody></table>
          </Card>
          <Card title={project === 'LIFESTYLE' ? t('qty.bySite') : t('qty.open')} flush>
            <table className="t"><tbody>{project === 'LIFESTYLE' ? data.bySite.map((s) => <tr key={s.site}><td>{s.site}</td><td className="num strong">{num(s.n)}</td></tr>) : data.open.map((s) => <tr key={s.status}><td><StatusBadge status={s.status} /></td><td className="num strong">{num(s.n)}</td></tr>)}</tbody></table>
            {project === 'LIFESTYLE' && <table className="t" style={{ marginTop: 8 }}><tbody>{data.open.map((s) => <tr key={s.status}><td><StatusBadge status={s.status} /></td><td className="num strong">{num(s.n)}</td></tr>)}</tbody></table>}
          </Card>
        </div>
        <div style={{ marginTop: 16 }}><Card title={t('qty.stock')} flush><table className="t"><tbody><tr>{data.stock.map((s) => <td key={s.status}><KitBadge status={s.status} /> <b>{num(s.n)}</b></td>)}</tr></tbody></table></Card></div>
      </>}
    </div>
  );
}
