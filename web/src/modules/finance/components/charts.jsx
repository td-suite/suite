import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line, Legend as RLegend } from 'recharts';
import { eur, eurShort } from '../format.js';

export const C = { teal: '#1C505E', blue: '#71B1BD', mauve: '#DEC0F1', jet: '#01212C', silk: '#FFFAE3', grey: '#9fb3b8', green: '#2f7d5b' };
const PALETTE = [C.teal, C.blue, C.mauve, '#2f7d5b', '#b3372f', '#5b6f75', '#e0b84a', '#8a5aa8', '#3d8f9f', '#c77d4d'];

function Tip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="strong" style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p) => <div className="r" key={p.dataKey}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, marginRight: 6 }} />{p.name}</span><b>{money ? eur(p.value) : p.value}</b></div>)}
    </div>
  );
}

export function Donut({ data, size = 200, money = false, onClick }) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return <div className="empty">Nessun dato</div>;
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="none" onClick={(d) => onClick?.(d)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
          {rows.map((d, i) => <Cell key={d.name} fill={d.color || PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => (money ? eur(v) : v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, keys, height, money = false, onClick }) {
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(160, data.length * 36 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="#e7eef0" />
        <XAxis type="number" tickFormatter={money ? eurShort : undefined} tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 12, fill: '#0f2a33' }} axisLine={false} tickLine={false} />
        <Tooltip content={<Tip money={money} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {keys.map((k, i) => <Bar key={k.key} dataKey={k.key} name={k.label} stackId="a" fill={k.color || PALETTE[i]} radius={i === keys.length - 1 ? [0, 4, 4, 0] : 0} onClick={(d) => onClick?.(d)} style={{ cursor: onClick ? 'pointer' : 'default' }} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Trend({ data, height = 240, costs = true }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e7eef0" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="n" tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
        {costs && <YAxis yAxisId="c" orientation="right" tickFormatter={eurShort} tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} width={64} />}
        <Tooltip formatter={(v, n) => (n === 'Costo mensile' ? eur(v) : v)} />
        <RLegend wrapperStyle={{ fontSize: 12 }} />
        <Line yAxisId="n" type="monotone" dataKey="employees" name="Dipendenti" stroke={C.teal} strokeWidth={2.2} dot={false} />
        <Line yAxisId="n" type="monotone" dataKey="lp" name="LP" stroke={C.blue} strokeWidth={2.2} dot={false} />
        {costs && <Line yAxisId="c" type="monotone" dataKey="cost_monthly" name="Costo mensile" stroke="#8a5aa8" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Legend({ items }) {
  return <div className="legend">{items.map((s, i) => <span key={s.label}><i style={{ background: s.color || PALETTE[i] }} />{s.label}</span>)}</div>;
}
export { PALETTE };
