// Piccoli componenti condivisi del modulo Facility e Manutenzioni: badge di stato, selettori di sede e anno, avvisi, link ai file
import React from 'react';
import { Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, apiBase } from '../api.js';
import { PLAN_STATUS, OUTCOME, WO_STATUS, PRIORITY, ASSET_STATUS, TRANSFER, BENCH, TARGET, thisYear } from '../format.js';

const B = (map, k) => (k && map[k] ? <Badge tone={map[k].tone}>{map[k].label}</Badge> : null);
export const PlanStatus = ({ s }) => B(PLAN_STATUS, s);
export const Outcome = ({ o }) => B(OUTCOME, o);
export const WoStatus = ({ s }) => B(WO_STATUS, s);
export const Priority = ({ p }) => B(PRIORITY, p);
export const AssetStatus = ({ s }) => B(ASSET_STATUS, s);
export const Transfer = ({ s }) => B(TRANSFER, s);
export const Bench = ({ p }) => B(BENCH, p);
export const Target = ({ s }) => B(TARGET, s);

export function Alert({ tone = '', icon = 'info', children }) {
  return <div className={`fa-alert ${tone}`}><Icon name={icon} className="ico" /><div>{children}</div></div>;
}

// Sedi del perimetro dell'utente (dall'elenco degli immobili; per il manutentore dai dispositivi)
export function useSites() {
  const { data } = useApi('/immobili', [], { silent: true });
  return (data?.rows || []).map((r) => ({ id: r.site_id, name: r.name, kind: r.kind, code: r.code }));
}
export function SiteSelect({ value, onChange, sites, all = 'Tutte le sedi', className = 'fa-in' }) {
  return <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>{all && <option value="">{all}</option>}{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
}
export function YearSelect({ value, onChange }) {
  const y = thisYear();
  return <select className="fa-in" value={value} onChange={(e) => onChange(Number(e.target.value))}>{[y + 1, y, y - 1, y - 2, y - 3].map((x) => <option key={x} value={x}>{x}</option>)}</select>;
}
export const fileUrl = (id, inline = true) => `${apiBase}/files/${id}${inline ? '?inline=1' : ''}`;
export const docUrl = (id, inline = true) => `${apiBase}/documenti/${id}${inline ? '?inline=1' : ''}`;
export function FileLink({ f, doc }) {
  return <a className="fa-file" href={doc ? docUrl(f.id) : fileUrl(f.id)} target="_blank" rel="noreferrer"><Icon name={/pdf/.test(f.mime || '') ? 'pdf' : /image/.test(f.mime || '') ? 'image' : 'file'} />{f.title || f.filename}</a>;
}
// Barra di avanzamento (obiettivi)
export function Progress({ value, target }) {
  const v = Math.max(0, Math.min(100, ((value || 0) / (target || 1)) * 100));
  return <div className="fa-bar" title={`${value ?? 0}% su ${target}%`}><i style={{ width: `${v}%` }} className={v >= 100 ? 'ok' : v >= 50 ? 'mid' : 'low'} /></div>;
}
