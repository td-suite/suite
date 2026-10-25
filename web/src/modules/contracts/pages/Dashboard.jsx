import React, { useState } from 'react';
import { BASE } from '../api.js';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, seesCosts, canWrite } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge, KindBadge, StatusBadge, Modal } from '../components/ui.jsx';
import { Donut, HBars, Trend, Legend, C } from '../components/charts.jsx';
import { eur, itDate, DEADLINE_STATE, CONTRACT, LEVEL_LABEL } from '../format.js';

const DIMS = [
  { key: 'by_area', label: 'Area aziendale', group: 'area_name' },
  { key: 'by_contract', label: 'Tipologia contrattuale', group: 'contract_type' },
  { key: 'by_level', label: 'Livello CCNL', group: 'level' },
  { key: 'by_discipline', label: 'Disciplina (LP)', group: 'discipline' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const s = useApi('/stats/summary');
  const [dim, setDim] = useState('by_area');
  const [metric, setMetric] = useState('count');
  const [drill, setDrill] = useState(null); // { title, people }
  const d = s.data;
  const costs = seesCosts(user);
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const t = d.totals;
  const people = d.people || [];
  const openDrill = (title, filter) => setDrill({ title, people: people.filter(filter) });
  const dimData = (d[dim] || []).map((g) => ({ ...g, label: g.label || g.key, value: metric === 'count' ? g.count : g.cost_annual }));
  const dimDef = DIMS.find((x) => x.key === dim);
  const groupKey = (p) => (dim === 'by_contract' ? (p.kind === 'LP' ? 'LP' : p.contract_type || 'TIND') : dim === 'by_level' ? (p.level || 'n.d.') : dim === 'by_discipline' ? (p.discipline || 'n.d.') : (p.area_group || p.area_name || 'Non assegnata'));
  const pct = (v) => (t.total ? Math.round((v / t.total) * 100) : 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno, {(user.first_name || user.full_name.split(' ').slice(-1)[0])}</h1>
          <div className="sub">Organico di Toscana Diagnostica: {t.employees} dipendenti e {t.lp} liberi professionisti attivi{t.pending ? `, ${t.pending} in impegno` : ''}. Clicca su un numero o su un grafico per scendere nel dettaglio.</div>
        </div>
        {canWrite(user) && <Link className="btn" to={`${BASE}/risorse/nuova`}>+ Inserimento nuova risorsa</Link>}
      </div>

      <div className="grid g4">
        <div onClick={() => openDrill('Risorse attive', () => true)} style={{ cursor: 'pointer' }}><Kpi accent label="Risorse attive" value={t.total} foot={`${t.employees} dipendenti · ${t.lp} LP`} /></div>
        <div onClick={() => openDrill('Donne', (p) => p.sex === 'F')} style={{ cursor: 'pointer' }}><Kpi label="Donne" value={t.female} foot={`${pct(t.female)}% dell'organico`} bar={pct(t.female)} /></div>
        <div onClick={() => openDrill('Uomini', (p) => p.sex === 'M')} style={{ cursor: 'pointer' }}><Kpi label="Uomini" value={t.male} foot={`${pct(t.male)}% dell'organico${t.total - t.female - t.male ? ` · ${t.total - t.female - t.male} n.d.` : ''}`} bar={pct(t.male)} /></div>
        <Kpi label="Età media" value={d.avg_age ? `${Math.round(d.avg_age)} anni` : '–'} foot="sulle risorse con data di nascita" />
      </div>
      {costs && (
        <div className="grid g4" style={{ marginTop: 16 }}>
          <div onClick={() => openDrill('Costo annuo per l\'azienda', () => true)} style={{ cursor: 'pointer' }}><Kpi accent label="Costo annuo per l'azienda" value={eur(t.cost_annual)} foot={`dipendenti ${eur(t.cost_employees_annual)} · LP ${eur(t.cost_lp_annual)}`} /></div>
          <Kpi label={`Costo esercizio ${t.year}`} value={eur(t.cost_year)} foot={`pro rata su ingressi e cessazioni (${t.leaving ? `${t.leaving} cessazion${t.leaving === 1 ? 'e' : 'i'} programmat${t.leaving === 1 ? 'a' : 'e'}, ` : ''}mensile a regime ${eur(t.cost_monthly)})`} />
          <Kpi label="Monte RAL dipendenti" value={eur(t.ral_total)} foot="RAL vigenti alla data odierna" />
          <Kpi label="MBO massimo erogabile" value={eur(t.cost_mbo_max)} foot="premi al 100% degli obiettivi, costo azienda" />
        </div>
      )}
      <div className="grid g4" style={{ marginTop: 16 }}>
        <div onClick={() => nav(`${BASE}/scadenze`)} style={{ cursor: 'pointer' }}><Kpi label="Scadenze scadute" value={d.deadlines_overdue} foot="documenti e adempimenti oltre la data" /></div>
        <div onClick={() => nav(`${BASE}/scadenze`)} style={{ cursor: 'pointer' }}><Kpi label="Scadenze entro 30 giorni" value={d.deadlines_soon} foot="da gestire a breve" /></div>
        <div onClick={() => nav(`${BASE}/scouting/lettere`)} style={{ cursor: 'pointer' }}><Kpi label="Lettere di impegno aperte" value={d.letters.open} foot={`${d.letters.accepted} accettate da convertire in assunzione`} /></div>
        <div onClick={() => nav(`${BASE}/scouting/cv`)} style={{ cursor: 'pointer' }}><Kpi label="CV Box" value={d.cv.total} foot={`${d.cv.new} nuovi da valutare`} /></div>
      </div>

      <div className="grid g3" style={{ marginTop: 16, gridTemplateColumns: '2fr 1fr' }}>
        <Card title="Organico per dimensione" actions={<div className="row">
          <select value={dim} onChange={(e) => setDim(e.target.value)} style={{ width: 'auto', minHeight: 32 }}>{DIMS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          {costs && <div className="seg"><label className={metric === 'count' ? 'on' : ''}><input type="radio" checked={metric === 'count'} onChange={() => setMetric('count')} />Persone</label><label className={metric === 'cost' ? 'on' : ''}><input type="radio" checked={metric === 'cost'} onChange={() => setMetric('cost')} />Costo annuo</label></div>}
        </div>}>
          {dimData.length ? <HBars data={dimData} money={metric === 'cost'} keys={[{ key: 'value', label: metric === 'count' ? 'Risorse' : 'Costo annuo', color: C.teal }]} onClick={(row) => openDrill(`${dimDef.label}: ${row.label}`, (p) => groupKey(p) === row.key)} /> : <Empty>Nessun dato</Empty>}
          <div className="small muted" style={{ marginTop: 8 }}>Clicca una barra per vedere le persone del gruppo.</div>
        </Card>
        <Card title="Composizione" >
          <div className="subhead" style={{ marginTop: 0 }}>Per sesso</div>
          <Donut size={170} data={[{ name: 'Donne', value: t.female, color: C.teal }, { name: 'Uomini', value: t.male, color: C.blue }, { name: 'n.d.', value: t.total - t.female - t.male, color: C.grey }]} onClick={(x) => openDrill(x.name, (p) => (x.name === 'Donne' ? p.sex === 'F' : x.name === 'Uomini' ? p.sex === 'M' : !p.sex))} />
          <Legend items={[{ label: 'Donne', color: C.teal }, { label: 'Uomini', color: C.blue }]} />
          <div className="subhead">Dipendenti e LP</div>
          <Donut size={150} data={[{ name: 'Dipendenti', value: t.employees, color: C.teal }, { name: 'Liberi professionisti', value: t.lp, color: C.mauve }]} onClick={(x) => openDrill(x.name, (p) => (x.name === 'Dipendenti' ? p.kind === 'DIPENDENTE' : p.kind === 'LP'))} />
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Andamento dell'organico" actions={<span className="small muted">ultimi 12 mesi e prossimi 3</span>}>
          <Trend data={d.trend} costs={costs} />
        </Card>
        <Card title="Scadenze in evidenza" flush actions={<Link className="btn sm ghost" to={`${BASE}/scadenze`}>Calendario completo</Link>}>
          {d.deadlines.length ? (
            <div className="table-wrap" style={{ maxHeight: 300 }}><table className="t">
              <thead><tr><th>Data</th><th>Risorsa</th><th>Scadenza</th><th /></tr></thead>
              <tbody>{d.deadlines.slice(0, 12).map((x, i) => (
                <tr key={i} className="click" onClick={() => x.resource_id && nav(`${BASE}/risorse/${x.resource_id}`)}>
                  <td>{itDate(x.due_date)}</td><td>{x.resource_name}</td><td>{x.title}</td>
                  <td className="num"><Badge tone={DEADLINE_STATE[x.state]}>{x.days < 0 ? `${-x.days} gg fa` : `${x.days} gg`}</Badge></td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Nessuna scadenza nel periodo di allerta</Empty>}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Dossier incompleti" flush actions={<span className="small muted">documenti obbligatori mancanti nel dossier online</span>}>
          {d.incomplete_dossiers.length ? (
            <div className="table-wrap" style={{ maxHeight: 320 }}><table className="t">
              <thead><tr><th>Risorsa</th><th>Tipo</th><th className="num">Mancanti</th><th>Documenti</th></tr></thead>
              <tbody>{d.incomplete_dossiers.map((x) => (
                <tr key={x.id} className="click" onClick={() => nav(`${BASE}/risorse/${x.id}`)}>
                  <td className="strong">{x.name}</td><td><KindBadge kind={x.kind} /></td><td className="num">{x.missing}</td>
                  <td>{x.items.map((i) => <span className="chip" key={i}>{i}</span>)}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Tutti i dossier sono completi</Empty>}
        </Card>
      </div>

      {drill && (
        <Modal title={`${drill.title} · ${drill.people.length}`} onClose={() => setDrill(null)} wide>
          <div className="table-wrap" style={{ maxHeight: '60vh' }}><table className="t">
            <thead><tr><th>Risorsa</th><th>Tipo</th><th>Area</th><th>Ruolo</th><th>Ingresso</th>{costs && <th className="num">Costo annuo</th>}</tr></thead>
            <tbody>{drill.people.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`${BASE}/risorse/${p.id}`)}>
                <td className="strong">{p.last_name} {p.first_name}</td><td><KindBadge kind={p.kind} /> <StatusBadge status={p.status} /></td><td>{p.area_name || '–'}</td>
                <td>{p.job_title || p.discipline || '–'}{p.level ? <span className="small muted"> · {LEVEL_LABEL[p.level] || p.level}</span> : ''}{p.contract_type && p.contract_type !== 'TIND' ? <span className="small muted"> · {CONTRACT[p.contract_type]}</span> : ''}</td>
                <td>{itDate(p.hired_at)}</td>{costs && <td className="num">{eur(p.cost_annual)}</td>}
              </tr>))}</tbody>
          </table></div>
        </Modal>
      )}
    </div>
  );
}
