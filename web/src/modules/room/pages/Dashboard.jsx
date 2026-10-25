import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Kpi, Card, Badge } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { computePlan, durTxt } from '../planner/planner.jsx';
import { buildNetwork } from '../lib/network.js';
import { pdfReportDirezione, xlsxReportDirezione } from '../lib/exports.js';
import { sedeLabel } from './Sedi.jsx';
import { base } from '../api.js';

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error } = useApi('/strutture');
  const crit = useApi('/criticita');
  const net = useMemo(() => (data ? buildNetwork(data) : null), [data]);
  const over = (crit.data?.sedi || []).filter((s) => s.sopraSoglia);
  const rows = useMemo(() => (data || []).map((s) => {
    let plan = null; try { plan = computePlan(s); } catch { plan = null; }
    const med = s.personale.filter((p) => p.tipo === 'medico' && p.nome.trim()).length;
    const free = plan ? plan.free.reduce((t, f) => t + (f.e - f.s), 0) : 0;
    const util = plan ? Math.round(Object.values(plan.roomStats).reduce((t, r) => t + r.util, 0) / Math.max(1, Object.keys(plan.roomStats).length)) : 0;
    return { s, plan, med, free, util, alte: plan ? plan.crit.filter((c) => c.lv === 'alta').length : 0, medie: plan ? plan.crit.filter((c) => c.lv === 'media').length : 0 };
  }), [data]);
  const tot = rows.reduce((t, r) => ({ sedi: t.sedi + 1, amb: t.amb + r.s.ambulatori.length, med: t.med + r.med, sess: t.sess + (r.plan ? r.plan.assigns.length : 0), alte: t.alte + r.alte, free: t.free + r.free }), { sedi: 0, amb: 0, med: 0, sess: 0, alte: 0, free: 0 });
  return (
    <div className="page">
      <div className="page-head"><div><h1>Cruscotto</h1><div className="sub">Ciao {(user.first_name || user.full_name.split(' ').slice(-1)[0])}: lo stato della pianificazione di tutte le sedi, ricalcolato adesso sui dati condivisi.</div></div>
        {net && <div className="row"><button className="btn ghost" onClick={() => { const { doc, filename } = pdfReportDirezione(net); doc.save(filename); }}>Report direzione PDF</button><button className="btn ghost" onClick={() => xlsxReportDirezione(net)}>Report direzione Excel</button></div>}
      </div>
      <ErrorBox error={error} />
      {over.length > 0 && <div className="alert err" style={{ marginBottom: 14 }}>Sopra la soglia di {crit.data.soglia} criticità alte: {over.map((s) => <span key={s.id} className="chip" style={{ background: '#fff', cursor: 'pointer' }} onClick={() => nav(`${base}/sedi/${s.id}`)}>{s.denominazione}{s.nomeSede ? ' · ' + s.nomeSede : ''} ({s.alte})</span>)}{user.role === 'ADMIN' && <span className="small"> · soglia e avvisi email in Impostazioni</span>}</div>}
      {!data ? <Loading /> : <>
        <div className="grid g5" style={{ marginBottom: 18 }}>
          <Kpi label="Sedi" value={tot.sedi} />
          <Kpi label="Ambulatori" value={tot.amb} />
          <Kpi label="Medici" value={tot.med} />
          <Kpi label="Sessioni / settimana" value={tot.sess} foot={`${durTxt(tot.free)} ancora libere`} />
          <Kpi label="Criticità alte" value={tot.alte} accent={tot.alte > 0} />
        </div>
        <Card title="Sedi in ordine alfabetico" flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Sede</th><th>Responsabile</th><th className="num">Ambulatori</th><th className="num">Medici</th><th className="num">Sessioni</th><th className="num">Utilizzo</th><th className="num">Libero</th><th>Criticità</th><th>Ultimo salvataggio</th></tr></thead>
            <tbody>{rows.map(({ s, plan, med, free, util, alte, medie }) => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => nav(`${base}/sedi/${s.id}`)}>
                <td className="strong">{sedeLabel(s)}<div className="small muted" style={{ fontWeight: 400 }}>{s.indirizzo}</div></td>
                <td>{s.siteManager || <span className="muted">–</span>}</td>
                <td className="num">{s.ambulatori.length}</td><td className="num">{med}</td><td className="num">{plan ? plan.assigns.length : '–'}</td>
                <td className="num">{plan ? `${util}%` : '–'}</td><td className="num">{plan ? durTxt(free) : '–'}</td>
                <td>{alte ? <Badge tone="red">{alte} alte</Badge> : null} {medie ? <Badge tone="mauve">{medie} medie</Badge> : null} {!alte && !medie && plan && <Badge tone="green">nessuna</Badge>}</td>
                <td className="small muted">{itDateTime(s._updatedAt)}{s._updatedBy ? <div>{s._updatedBy}</div> : null}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      </>}
    </div>
  );
}
