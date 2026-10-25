import React, { useMemo, useState } from 'react';
import { BASE } from '../api.js';
import { useNavigate } from 'react-router-dom';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge } from '../components/ui.jsx';
import { itDate, DEADLINE_STATE } from '../format.js';

const TYPES = { DOCUMENTO: 'Documenti', CONTRATTO: 'Contratti', PROVA: 'Periodo di prova', RAL: 'Scatti RAL', MBO: 'MBO', IMPEGNO: 'Lettere di impegno', MANUALE: 'Manuali' };

export default function Deadlines() {
  const nav = useNavigate();
  const [days, setDays] = useState(365);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const list = useApi(`/stats/deadlines?days=${days}`, [days]);
  const rows = useMemo(() => (list.data || []).filter((x) => (!type || x.type === type) && (!q || (x.resource_name || '').toLowerCase().includes(q.toLowerCase()) || x.title.toLowerCase().includes(q.toLowerCase()))), [list.data, type, q]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const x of rows) { const k = x.days < 0 ? 'Scadute' : x.days <= 30 ? 'Entro 30 giorni' : x.days <= 90 ? 'Entro 90 giorni' : 'Oltre 90 giorni'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Calendario delle scadenze</h1><div className="sub">Documenti del personale (albo, polizze, identità, formazione), fine prova e contratti, scatti di RAL, valutazioni MBO, lettere di impegno e scadenze manuali.</div></div></div>
      <div className="filters">
        <Field label="Orizzonte"><select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={90}>3 mesi</option><option value={180}>6 mesi</option><option value={365}>12 mesi</option><option value={730}>24 mesi</option></select></Field>
        <Field label="Tipo"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Tutti</option>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Risorsa o scadenza" /></Field>
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Loading /> : !rows.length ? <Card><Empty>Nessuna scadenza nel periodo</Empty></Card> : groups.map(([g, items]) => (
        <Card key={g} title={`${g} · ${items.length}`} flush className="" >
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data</th><th>Risorsa</th><th>Scadenza</th><th>Tipo</th><th className="num">Stato</th></tr></thead>
            <tbody>{items.map((x, i) => (
              <tr key={i} className="click" onClick={() => x.resource_id && nav(`${BASE}/risorse/${x.resource_id}`)}>
                <td className="strong">{itDate(x.due_date)}</td>
                <td>{x.resource_name} {x.kind && <KindBadge kind={x.kind} />}</td>
                <td>{x.title}{x.detail && <div className="small muted">{x.detail}</div>}</td>
                <td><Badge>{TYPES[x.type] || x.type}</Badge></td>
                <td className="num"><Badge tone={DEADLINE_STATE[x.state]}>{x.days < 0 ? `scaduta da ${-x.days} gg` : x.days === 0 ? 'oggi' : `tra ${x.days} gg`}</Badge></td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      ))}
    </div>
  );
}
