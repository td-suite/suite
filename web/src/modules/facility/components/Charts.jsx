// Grafici del modulo Facility e Manutenzioni (Recharts, già nel progetto): consumi mensili anno corrente contro anno precedente,
// classifica orizzontale tra sedi, ripartizione per vettore. Colori della Suite.
import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ReferenceLine } from 'recharts';
import { MESI, num } from '../format.js';

export const C = { teal: '#1C505E', blue: '#71B1BD', prev: '#b9cdd2', red: '#b3372f', amber: '#a35a00', green: '#2f7d5b', grid: '#e7eef0', ink: '#0f2a33', muted: '#5b6f75' };

function Tip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="strong" style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p) => <div className="r" key={p.dataKey}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, marginRight: 6 }} />{p.name}</span><b>{num(p.value, 0)} {unit}</b></div>)}
    </div>
  );
}

// monthly: [{ month: 'AAAA-MM', kwh, prev_kwh }]; anomalie: Set di mesi da evidenziare
export function MonthlyCompare({ monthly, year, anomalie = new Set(), unit = 'kWh', height = 260, curKey = 'kwh', prevKey = 'prev_kwh' }) {
  const data = monthly.map((m) => ({ label: MESI[Number(m.month.slice(5, 7)) - 1], cur: m[curKey], prev: m[prevKey], anomaly: anomalie.has(m.month) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => num(v)} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="prev" name={String(year - 1)} fill={C.prev} radius={[3, 3, 0, 0]} />
        <Bar dataKey="cur" name={String(year)} fill={C.teal} radius={[3, 3, 0, 0]}>{data.map((d) => <Cell key={d.label} fill={d.anomaly ? C.red : C.teal} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// rows: [{ name, value, tone? }]; media facoltativa come linea di riferimento
export function RankBars({ rows, unit, media, height }) {
  const data = rows.filter((r) => r.value != null);
  if (!data.length) return <div className="empty compact">Nessun dato</div>;
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(140, data.length * 34 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => num(v, v < 10 ? 1 : 0)} />
        <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 12, fill: C.ink }} axisLine={false} tickLine={false} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {media != null && <ReferenceLine x={media} stroke={C.amber} strokeDasharray="4 3" label={{ value: 'media', fontSize: 10, fill: C.amber, position: 'top' }} />}
        <Bar dataKey="value" name={unit} radius={[0, 4, 4, 0]}>{data.map((d) => <Cell key={d.name} fill={d.tone === 'red' ? C.red : d.tone === 'amber' ? C.amber : C.blue} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
