import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, Legend as RLegend } from 'recharts';
import { eur, eurShort, num } from '../format.js';

export const C = { teal: '#1C505E', blue: '#71B1BD', mauve: '#DEC0F1', jet: '#01212C', silk: '#FFFAE3', grey: '#9fb3b8', green: '#2f7d5b', red: '#b3372f', gold: '#e0b84a', purple: '#8a5aa8' };
const PALETTE = [C.teal, C.blue, C.mauve, C.green, C.red, '#5b6f75', C.gold, C.purple, '#3d8f9f', '#c77d4d'];
const tick = { fontSize: 11, fill: '#5b6f75' };

function Tip({ active, payload, label, money, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="strong" style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p) => <div className="r" key={p.dataKey}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, marginRight: 6 }} />{p.name}</span><b>{fmt ? fmt(p.value, p.dataKey) : money ? eur(p.value) : num(p.value)}</b></div>)}
    </div>
  );
}

export function Donut({ data, size = 200, money = false, onClick, nameKey = 'name' }) {
  const rows = data.filter((d) => Number(d.value) > 0);
  if (!rows.length) return <div className="empty">Nessun dato</div>;
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey={nameKey} innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="none" isAnimationActive={false} onClick={(d) => onClick?.(d)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
          {rows.map((d, i) => <Cell key={d[nameKey]} fill={d.color || PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => (money ? eur(v) : num(v))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, keys, height, money = false, onClick, labelWidth = 170 }) {
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(120, data.length * 32 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="#e7eef0" />
        <XAxis type="number" tickFormatter={money ? eurShort : num} tick={tick} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={labelWidth} tick={{ fontSize: 12, fill: '#0f2a33' }} axisLine={false} tickLine={false} />
        <Tooltip content={<Tip money={money} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {keys.map((k, i) => <Bar key={k.key} dataKey={k.key} name={k.label} stackId="a" isAnimationActive={false} fill={k.color || PALETTE[i]} radius={i === keys.length - 1 ? [0, 4, 4, 0] : 0} onClick={(d) => onClick?.(d)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
          {k.colorBy && data.map((d, j) => <Cell key={j} fill={d[k.colorBy] || PALETTE[j % PALETTE.length]} />)}
        </Bar>)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VBars({ data, keys, height = 220, money = false, xKey = 'label', onClick, stacked = true }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke="#e7eef0" />
        <XAxis dataKey={xKey} tick={tick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={money ? eurShort : num} tick={tick} axisLine={false} tickLine={false} width={money ? 60 : 40} />
        <Tooltip content={<Tip money={money} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {keys.length > 1 && <RLegend wrapperStyle={{ fontSize: 12 }} />}
        {keys.map((k, i) => <Bar key={k.key} dataKey={k.key} name={k.label} stackId={stacked ? 'a' : undefined} isAnimationActive={false} fill={k.color || PALETTE[i]} radius={!stacked || i === keys.length - 1 ? [4, 4, 0, 0] : 0} onClick={(d) => onClick?.(d)} style={{ cursor: onClick ? 'pointer' : 'default' }} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Andamento mensile: fatturato B2C e B2B (aree impilate) e clienti (linea)
export function Trend({ data, height = 260, keys, lines = [], xKey = 'month', money = true }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e7eef0" />
        <XAxis dataKey={xKey} tick={tick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="v" tickFormatter={money ? eurShort : num} tick={tick} axisLine={false} tickLine={false} width={64} />
        {lines.some((l) => !l.money) && <YAxis yAxisId="n" orientation="right" tick={tick} axisLine={false} tickLine={false} width={40} allowDecimals={false} />}
        <Tooltip content={<Tip fmt={(v, k) => ((keys.some((x) => x.key === k) && money) || lines.some((x) => x.key === k && x.money) ? eur(v) : num(v))} />} />
        <RLegend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => <Area key={k.key} isAnimationActive={false} yAxisId="v" type="monotone" dataKey={k.key} name={k.label} stackId="a" stroke={k.color || PALETTE[i]} fill={k.color || PALETTE[i]} fillOpacity={0.75} strokeWidth={1.5} />)}
        {lines.map((k, i) => <Line key={k.key} isAnimationActive={false} yAxisId={k.money ? 'v' : 'n'} type="monotone" dataKey={k.key} name={k.label} stroke={k.color || C.purple} strokeWidth={2} dot={false} strokeDasharray={k.dash ? '4 3' : undefined} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, keys, height = 200, xKey = 'day', money = false }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e7eef0" />
        <XAxis dataKey={xKey} tick={tick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={money ? eurShort : num} tick={tick} axisLine={false} tickLine={false} width={money ? 60 : 36} />
        <Tooltip content={<Tip money={money} />} />
        {keys.map((k, i) => <Line key={k.key} isAnimationActive={false} type="monotone" dataKey={k.key} name={k.label} stroke={k.color || PALETTE[i]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Legend({ items }) {
  return <div className="legend">{items.map((s, i) => <span key={s.label}><i style={{ background: s.color || PALETTE[i] }} />{s.label}</span>)}</div>;
}
export { PALETTE };
