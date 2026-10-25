import React from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis } from 'recharts';
import { useApi, Card, Skeleton, Empty, Coming, ErrorBox, PageHead, Kpi } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { fmtDateTime, fmtNum, AREA_COLORS } from '../format.js';

const MOD_COLOR = { cash: AREA_COLORS.FINANCE, orders: AREA_COLORS.OPERATIONS, shipments: AREA_COLORS.OPERATIONS, room: AREA_COLORS.RETAIL_FLOW, nc: AREA_COLORS.HQS, finance: AREA_COLORS.FINANCE, integration: AREA_COLORS.FINANCE, business: AREA_COLORS.RETAIL_FLOW, retail: AREA_COLORS.RETAIL_FLOW, contracts: AREA_COLORS.PEOPLE };

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip"><div className="muted">{label}</div><strong>{fmtNum(payload[0].value, Number.isInteger(payload[0].value) ? 0 : 1)}</strong></div>;
}

function KpiCard({ c }) {
  const color = MOD_COLOR[c.module_key] || 'var(--teal)';
  const value = typeof c.value === 'number' ? fmtNum(c.value, Number.isInteger(c.value) ? 0 : 1) : c.value ?? '';
  const body = (
    <Kpi label={c.title} value={value} unit={c.unit} delta={c.delta} hint={c.unavailable ? undefined : c.hint} unavailable={c.unavailable}>
      {!c.unavailable && c.series?.length > 1 && (
        <div className="mini" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={c.series} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
              <defs><linearGradient id={`g-${c.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
              <XAxis dataKey="label" hide />
              <Tooltip content={<Tip />} cursor={{ stroke: color, strokeOpacity: .3 }} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#g-${c.key})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {c.unavailable && <div className="foot">La sorgente dati di questo indicatore non è ancora configurata.</div>}
    </Kpi>
  );
  if (c.link && !c.unavailable) return <a href={c.link} style={{ color: 'inherit', display: 'block' }} aria-label={`${c.title}, apri il modulo`}>{body}</a>;
  return body;
}

export default function Cockpit() {
  const { data, loading, error, unavailable, reload } = useApi('/cockpit');
  return (
    <div className="page">
      <PageHead title="Cockpit direzionale" icon="cockpit" sub={data?.generated_at ? `Dati aggiornati il ${fmtDateTime(data.generated_at)}` : 'Incassi, fatturato, ordini, NC, ambulatori, M&A in una pagina'}
        actions={<button className="btn ghost" onClick={reload} disabled={loading}><Icon name="refresh" />Aggiorna</button>} />
      {loading && <div className="grid g4">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <div key={i} className="card kpi"><Skeleton lines={2} /></div>)}</div>}
      {unavailable && <Card><Coming what="Il cockpit direzionale" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {data && !data.cards?.length && <Empty icon="stats" title="Nessun indicatore disponibile">Le sorgenti legacy vanno collegate dall'Amministrazione.</Empty>}
      {data?.cards?.length > 0 && <div className="grid g4">{data.cards.map((c) => <KpiCard key={c.key} c={c} />)}</div>}
      <div className="small muted mt2">Gli indicatori sono letti in sola lettura dai database delle applicazioni della rete. Le card tratteggiate indicano una sorgente non ancora collegata.</div>
    </div>
  );
}
