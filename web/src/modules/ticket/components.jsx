// Componenti condivisi del modulo Ticket: tendina ad albero delle caselle, badge di stato e priorità, barra SLA, stelle.
import React, { useMemo } from 'react';
import { Badge } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { STATO, PRIORITA, itDateTime, residuo } from './format.js';

// Tendina ad albero: le unità dell'organigramma in ordine di profondità, con rientro e percorso completo nel title
export function UnitSelect({ units = [], value, onChange, allowEmpty = true, emptyLabel = 'Scegli la casella', onlyWithHead = false, disabled }) {
  const rows = useMemo(() => {
    const byParent = new Map();
    for (const u of units) { const k = u.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(u); }
    const coll = new Intl.Collator('it');
    const out = [];
    const walk = (pid, depth) => {
      const kids = (byParent.get(pid) || []).slice().sort((a, b) => (a.sort_order - b.sort_order) || coll.compare(a.name, b.name));
      for (const u of kids) { out.push({ ...u, depth }); walk(u.id, depth + 1); }
    };
    walk(0, 0);
    // unità orfane (padre non attivo): in coda
    const seen = new Set(out.map((u) => u.id));
    for (const u of units) if (!seen.has(u.id)) out.push({ ...u, depth: 0 });
    return out;
  }, [units]);
  const sel = rows.find((u) => u.id === Number(value));
  return (
    <div className="tk-unitsel">
      <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled}>
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {rows.map((u) => <option key={u.id} value={u.id} title={u.path} disabled={onlyWithHead && !u.has_head}>{'   '.repeat(u.depth)}{u.depth ? '› ' : ''}{u.name}{u.has_head ? '' : ' (senza responsabile)'}</option>)}
      </select>
      {sel && <div className="small muted tk-unitpath">{sel.path}{sel.responsabili ? ` · responsabile: ${sel.responsabili}` : ' · nessun responsabile assegnato'}</div>}
    </div>
  );
}

export const StatoBadge = ({ stato }) => <Badge tone={STATO[stato]?.tone || 'grey'}>{STATO[stato]?.label || stato}</Badge>;
export const PrioBadge = ({ priorita, full }) => <Badge tone={PRIORITA[priorita]?.tone || 'grey'} dot={false}>{full ? PRIORITA[priorita]?.label : PRIORITA[priorita]?.short || priorita}</Badge>;

// Barra SLA: quota di tempo consumata tra apertura e scadenza; rossa oltre la scadenza; verde se già soddisfatto
export function SlaBar({ label, start, deadline, done, stato, paused }) {
  const total = new Date(deadline) - new Date(start);
  const used = (done ? new Date(done) : new Date()) - new Date(start);
  const pct = Math.max(0, Math.min(100, total > 0 ? (used / total) * 100 : 100));
  const late = done ? new Date(done) > new Date(deadline) : (Date.now() > new Date(deadline).getTime() && !['CHIUSO', 'ANNULLATO'].includes(stato));
  const cls = done ? (late ? 'late' : 'ok') : late ? 'late' : pct > 75 ? 'warn' : '';
  return (
    <div className={`tk-sla ${cls}`}>
      <div className="row between tight"><span className="small strong">{label}</span><span className="small muted">{done ? (late ? 'fuori tempo' : 'nei tempi') : paused ? 'in attesa: scadenza congelata' : ['CHIUSO', 'ANNULLATO'].includes(stato) ? 'chiuso' : residuo(deadline)}</span></div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="small muted">scadenza {itDateTime(deadline)}{done ? ` · ${label.toLowerCase()} ${itDateTime(done)}` : ''}</div>
    </div>
  );
}

export function Stelle({ value, onChange, size = 22 }) {
  return <div className="tk-stelle" role={onChange ? 'radiogroup' : undefined}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= (value || 0) ? 'on' : ''} disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} su 5`}><Icon name="star" size={size} /></button>)}</div>;
}
