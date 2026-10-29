// Punteggio con colore del livello, badge del livello, barra, badge di tipo e stato
import React from 'react';
import { Badge } from '../../../components/ui.jsx';
import { LEVEL, KIND, STATUS, URGENZA, RISCHIO, levelOf, pct } from '../format.js';

export function Score({ value, big, level, suffix }) {
  const l = level || levelOf(value);
  return <span className={`au-score ${l ? `lvl-${l}` : ''} ${big ? 'au-big' : ''}`}>{value == null ? '–' : Number(value).toLocaleString('it-IT', { maximumFractionDigits: 1 })}{value != null && <small>%</small>}{suffix && <small> {suffix}</small>}</span>;
}
export function Level({ letter, value, short }) {
  const l = letter || levelOf(value);
  if (!l) return <span className="muted small">n.d.</span>;
  return <span className={`au-lvl lvl-${l}`} title={LEVEL[l].label}><i>{l}</i>{!short && <span>{LEVEL[l].label}</span>}</span>;
}
export function Bar({ value, level }) {
  const l = level || levelOf(value);
  return <div className={`au-bar ${l ? `lvl-${l}` : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} /></div>;
}
export const KindBadge = ({ k }) => <Badge tone={KIND[k]?.tone || 'grey'} dot={false}>{KIND[k]?.label || k}</Badge>;
export const StatusBadge = ({ s }) => <Badge tone={STATUS[s]?.tone || 'grey'}>{STATUS[s]?.label || s}</Badge>;
export const UrgenzaBadge = ({ u }) => <Badge tone={URGENZA[u]?.tone || 'grey'} dot={false}>{URGENZA[u]?.label || u}</Badge>;
export const RischioBadge = ({ r }) => (r ? <Badge tone={RISCHIO[r]?.tone || 'grey'} dot={false}>Rischio {RISCHIO[r]?.label || r}</Badge> : null);
export const ScoreCell = ({ a }) => (a.kind === 'TERZI' ? <span className="small muted">{a.third_party?.esito ? a.third_party.esito.replace(/_/g, ' ').toLowerCase() : 'n.c.'}</span>
  : <span title={a.score_source === 'VERIFICA' ? `Sede ${pct(a.score)} · verifica ${pct(a.score_verifier)} (fa fede la verifica)` : 'Colonna della sede / auditor'}><Score value={a.effective_score} />{a.kind === 'AUTO' && a.score_verifier != null && <span className="small muted"> ({pct(a.score)} sede{a.score_delta != null ? `, ${a.score_delta >= 0 ? '+' : ''}${a.score_delta}` : ''})</span>}</span>);
