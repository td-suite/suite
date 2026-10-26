// Statistiche: KPI, tabelle per categoria, casella e struttura, barre CSS per l'andamento mensile e il backlog, rapporto PDF.
import React, { useState } from 'react';
import { apiBase, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { UnitSelect } from '../components.jsx';
import { STATO, PRIORITA } from '../format.js';

const Kpi = ({ label, value, foot, tone }) => <div className={`card kpi tk-kpi ${tone || ''}`}><div className="lbl">{label}</div><div className="val">{value ?? '-'}</div>{foot && <div className="foot">{foot}</div>}</div>;
const pct = (v) => (v == null ? '-' : `${v}%`);
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export default function Statistiche() {
  const y = new Date().getFullYear();
  const [da, setDa] = useState(`${y}-01-01`);
  const [a, setA] = useState('');
  const [unitId, setUnitId] = useState(null);
  const cat = useApi('/catalogo');
  const f = { da, a, unit_id: unitId || '' };
  const url = `/stats${qs(f)}`;
  const { data: s, error, loading } = useApi(url, [url]);
  const maxM = s ? Math.max(1, ...s.mesi.map((m) => Math.max(m.aperti, m.chiusi))) : 1;
  const maxB = s ? Math.max(1, ...Object.values(s.backlog)) : 1;
  return (
    <div className="page">
      <PageHead title="Statistiche" icon="stats" sub="Volumi, tempi e rispetto degli SLA sui ticket che puoi vedere. Il rapporto PDF riporta le stesse tabelle, una pagina per sezione." actions={<a className="btn ghost" href={`${apiBase}/export/rapporto.pdf${qs(f)}`} target="_blank" rel="noopener"><Icon name="pdf" />Rapporto PDF</a>} />
      <div className="filters">
        <Field label="Dal"><input type="date" value={da} onChange={(e) => setDa(e.target.value)} /></Field>
        <Field label="Al"><input type="date" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Casella (con le sottostanti)" className="tk-f-unit"><UnitSelect units={cat.data?.unita || []} value={unitId} onChange={setUnitId} emptyLabel="Tutte le caselle" /></Field>
      </div>
      {error && <Empty icon="alert" title="Dati non disponibili">{error.message}</Empty>}
      {!s && loading && <Loading />}
      {s && (
        <>
          <div className="tk-kpis">
            <Kpi label="Ticket nel periodo" value={s.totale} foot={`${s.aperti} non chiusi`} />
            <Kpi label="Prima risposta media" value={s.tempi.ore_prima_risposta != null ? `${s.tempi.ore_prima_risposta} h` : '-'} foot="dall'apertura" />
            <Kpi label="Risoluzione media" value={s.tempi.ore_risoluzione != null ? `${s.tempi.ore_risoluzione} h` : '-'} foot="al netto delle attese" />
            <Kpi label="SLA prima risposta" value={pct(s.sla.pct_risposta)} foot={`${s.sla.risposte_ok} su ${s.sla.risposte}`} tone={s.sla.pct_risposta != null && s.sla.pct_risposta < 80 ? 'late' : 'ok'} />
            <Kpi label="SLA risoluzione" value={pct(s.sla.pct_risoluzione)} foot={`${s.sla.risoluzioni_ok} su ${s.sla.risoluzioni}`} tone={s.sla.pct_risoluzione != null && s.sla.pct_risoluzione < 80 ? 'late' : 'ok'} />
            <Kpi label="In ritardo adesso" value={s.sla.in_ritardo_ora} foot="oltre una scadenza" tone={s.sla.in_ritardo_ora > 0 ? 'warn' : ''} />
            <Kpi label="Valutazione media" value={s.valutazione.media != null ? `${s.valutazione.media} / 5` : '-'} foot={`${s.valutazione.n} valutazioni`} />
          </div>
          <div className="grid tk-two">
            <Card title="Andamento ultimi 12 mesi" icon="stats">
              <div className="tk-bars">
                {s.mesi.map((m) => { const [yy, mm] = m.mese.split('-'); return (
                  <div key={m.mese} className="col" title={`${m.mese}: ${m.aperti} aperti, ${m.chiusi} risolti o chiusi`}>
                    <div className="stack"><i className="a" style={{ height: `${(m.aperti / maxM) * 100}%` }} /><i className="c" style={{ height: `${(m.chiusi / maxM) * 100}%` }} /></div>
                    <div className="lbl">{MESI[Number(mm) - 1]}<br /><span className="muted">{yy.slice(2)}</span></div>
                  </div>); })}
              </div>
              <div className="row tight small"><span className="tk-leg a">Aperti</span><span className="tk-leg c">Risolti o chiusi</span></div>
            </Card>
            <Card title="Backlog aperto per età" icon="clock">
              <div className="tk-hbars">
                {Object.entries(s.backlog).map(([k, v]) => <div key={k} className="hrow"><span className="k">{k} giorni</span><div className="bar"><i style={{ width: `${(v / maxB) * 100}%` }} /></div><span className="v">{v}</span></div>)}
              </div>
              <h4 style={{ margin: '14px 0 6px' }}>Per stato</h4>
              <div className="tk-hbars">
                {Object.keys(STATO).map((k) => <div key={k} className="hrow"><span className="k">{STATO[k].label}</span><div className="bar"><i className={`st-${k}`} style={{ width: `${((s.stati[k] || 0) / Math.max(1, s.totale)) * 100}%` }} /></div><span className="v">{s.stati[k] || 0}</span></div>)}
              </div>
            </Card>
          </div>
          <div className="grid tk-two">
            <Card title="Per categoria" icon="list" flush>
              <div className="table-wrap"><table className="t"><thead><tr><th>Categoria</th><th className="num">Ticket</th><th className="num">Aperti</th></tr></thead>
                <tbody>{s.categorie.map((c, i) => <tr key={i}><td>{c.nome || 'Senza categoria'}</td><td className="num">{c.n}</td><td className="num">{c.aperti}</td></tr>)}{!s.categorie.length && <tr><td colSpan={3} className="muted">Nessun dato</td></tr>}</tbody></table></div>
            </Card>
            <Card title="Per priorità e top 5 caselle per carico" icon="alert" flush>
              <div className="table-wrap"><table className="t"><thead><tr><th>Priorità</th><th className="num">Ticket</th><th className="num">Aperti</th></tr></thead>
                <tbody>{s.priorita.map((p) => <tr key={p.priorita}><td>{PRIORITA[p.priorita]?.label || p.priorita}</td><td className="num">{p.n}</td><td className="num">{p.aperti}</td></tr>)}</tbody></table></div>
              <div className="table-wrap"><table className="t"><thead><tr><th>Casella (carico aperto)</th><th className="num">Aperti</th></tr></thead>
                <tbody>{s.top5.map((u, i) => <tr key={i}><td title={u.path}>{u.nome}</td><td className="num">{u.n}</td></tr>)}{!s.top5.length && <tr><td colSpan={2} className="muted">Nessun ticket aperto</td></tr>}</tbody></table></div>
            </Card>
          </div>
          <Card title="Per casella dell'organigramma" icon="tree" flush>
            <div className="table-wrap"><table className="t"><thead><tr><th>Casella</th><th>Percorso</th><th className="num">Ticket</th><th className="num">Aperti</th><th className="num">Sforati</th><th className="num">Ore medie di risoluzione</th></tr></thead>
              <tbody>{s.unita.map((u) => <tr key={u.id}><td className="strong">{u.nome}</td><td className="small muted">{u.path}</td><td className="num">{u.n}</td><td className="num">{u.aperti}</td><td className={`num ${u.sforati ? 'tk-late' : ''}`}>{u.sforati}</td><td className="num">{u.ore_medie_risoluzione ?? '-'}</td></tr>)}{!s.unita.length && <tr><td colSpan={6} className="muted">Nessun dato</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per struttura (sede o Legal entity per conto di cui si è aperto il ticket)" icon="building" flush>
            <div className="table-wrap"><table className="t"><thead><tr><th>Struttura</th><th>Tipo</th><th className="num">Ticket</th><th className="num">Aperti</th></tr></thead>
              <tbody>{s.strutture.map((x, i) => <tr key={i}><td>{x.nome}</td><td className="small muted">{x.tipo}</td><td className="num">{x.n}</td><td className="num">{x.aperti}</td></tr>)}{!s.strutture.length && <tr><td colSpan={4} className="muted">Nessun dato</td></tr>}</tbody></table></div>
          </Card>
        </>
      )}
    </div>
  );
}
