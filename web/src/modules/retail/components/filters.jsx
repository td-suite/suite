import React from 'react';
import { Field, useApi } from './ui.jsx';
import { today, addDays } from '../format.js';

// Periodi predefiniti
export const PRESETS = [
  { key: 'ytd', label: 'Anno in corso', range: () => { const t = today(); return { from: `${t.slice(0, 4)}-01-01`, to: t }; } },
  { key: 'm', label: 'Mese corrente', range: () => { const t = today(); return { from: `${t.slice(0, 7)}-01`, to: t }; } },
  { key: 'pm', label: 'Mese scorso', range: () => { const t = new Date(today()); const f = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)); return { from: f.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) }; } },
  { key: '30', label: 'Ultimi 30 giorni', range: () => ({ from: addDays(today(), -29), to: today() }) },
  { key: '90', label: 'Ultimi 90 giorni', range: () => ({ from: addDays(today(), -89), to: today() }) },
  { key: '12m', label: 'Ultimi 12 mesi', range: () => ({ from: addDays(today(), -364), to: today() }) },
  { key: 'py', label: 'Anno scorso', range: () => { const y = Number(today().slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
];
export const defaultPeriod = () => ({ preset: 'ytd', ...PRESETS[0].range() });

export function PeriodFilter({ value, onChange, children }) {
  const setPreset = (p) => onChange({ ...value, preset: p.key, ...p.range() });
  return (
    <div className="filters">
      <div className="period">{PRESETS.map((p) => <button key={p.key} className={value.preset === p.key ? 'on' : ''} onClick={() => setPreset(p)}>{p.label}</button>)}</div>
      <Field label="Dal"><input type="date" value={value.from} onChange={(e) => onChange({ ...value, preset: null, from: e.target.value })} /></Field>
      <Field label="Al"><input type="date" value={value.to} onChange={(e) => onChange({ ...value, preset: null, to: e.target.value })} /></Field>
      {children}
    </div>
  );
}

export function SiteSelect({ value, onChange, label = 'Sede', all = 'Tutte le sedi' }) {
  const sites = useApi('/sites?network=1');
  return <Field label={label}><select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{all}</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>;
}

export function KindSelect({ value, onChange }) {
  return <Field label="Canale"><select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">B2C + B2B</option><option value="B2C">Solo B2C (pazienti)</option><option value="B2B">Solo B2B (aziende, strutture)</option></select></Field>;
}

export function LineSelect({ value, onChange }) {
  const lines = useApi('/product-lines');
  return <Field label="Linea"><select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">Tutte le linee</option>{(lines.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>;
}
