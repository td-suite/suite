import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Kpi, Icon, Delta, Progress, MoneyInput } from '../components/ui.jsx';
import { VBars, C } from '../components/charts.jsx';
import { SiteSelect, LineSelect } from '../components/filters.jsx';
import { qs, api, apiBase } from '../api.js';
import { eur, eur0, num, pct, MONTHS, MONTHS_SHORT, itDateTime } from '../format.js';

export default function Budget() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'budget');
  const [year, setYear] = useState(Number(sp.get('year') || new Date().getFullYear()));
  useEffect(() => { setSp({ tab, year: String(year) }, { replace: true }); }, [tab, year, setSp]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Budget e scostamenti {year}</h1><div className="sub">Budget mensile per linea e per sede, consuntivo, scostamenti con ipotesi esterne (mercato del territorio, ATECO, stagionalità) e motivazioni interne annotate; giorni lavorabili pianificati e reali; dati di mercato del bacino.</div></div>
        <div className="period"><button onClick={() => setYear(year - 1)}>‹ {year - 1}</button><button className="on">{year}</button><button onClick={() => setYear(year + 1)}>{year + 1} ›</button></div>
      </div>
      <div className="tabs">{[['budget', 'Budget'], ['variance', 'Analisi degli scostamenti'], ['days', 'Giorni lavorati'], ['market', 'Dati di mercato']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'budget' && <BudgetGrid year={year} />}
      {tab === 'variance' && <Variance year={year} />}
      {tab === 'days' && <WorkingDays year={year} />}
      {tab === 'market' && <Market />}
    </div>
  );
}

function BudgetGrid({ year }) {
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi(`/budgets?year=${year}`, [year]);
  const [mode, setMode] = useState('line');
  const [edit, setEdit] = useState({});
  const [imp, setImp] = useState(null);
  const input = useRef(null);
  const writer = canWrite(user);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const rows = mode === 'line' ? d.data.byLine : d.data.bySite;
  const keyOf = (r, m) => `${mode}:${mode === 'line' ? r.line.id : r.site.id}:${m}`;
  const val = (r, mm) => (edit[keyOf(r, mm.month)] !== undefined ? edit[keyOf(r, mm.month)] : mm.budget);
  const save = async () => {
    const rowsToSave = Object.entries(edit).map(([k, v]) => { const [md, id, m] = k.split(':'); return { month: Number(m), line_id: md === 'line' ? Number(id) : null, site_id: md === 'site' ? Number(id) : null, amount: Number(v) || 0 }; });
    try { await api.put('/budgets', { year, rows: rowsToSave }); toast('Budget salvato'); setEdit({}); d.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const propose = () => { const e = { ...edit }; for (const r of rows) for (const mm of r.months) if (!mm.budget && mm.prev) e[keyOf(r, mm.month)] = Math.round(mm.prev * 1.1); setEdit(e); toast('Proposto: anno precedente +10% sui mesi vuoti'); };
  const onFile = async (f) => { if (!f) return; try { const fd = new FormData(); fd.append('file', f); fd.append('year', year); const r = await api.upload('/budgets/import', fd); setImp(r); toast(`${r.saved} valori caricati`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const totB = d.data.total.reduce((a, x) => a + x.budget, 0); const totA = d.data.total.reduce((a, x) => a + x.actual, 0); const totP = d.data.total.reduce((a, x) => a + x.prev, 0);
  const cm = d.data.current_year === year ? d.data.current_month : 12;
  const ytdB = d.data.total.filter((x) => x.month <= cm).reduce((a, x) => a + x.budget, 0);
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label={`Budget ${year}`} value={eur0(totB)} foot={`anno precedente ${eur0(totP)} (${totP ? pct(((totB - totP) / totP) * 100, 1) : '–'})`} />
        <Kpi label="Consuntivo" value={eur0(totA)} foot={ytdB ? `${pct((totA / ytdB) * 100)} del budget dei mesi trascorsi` : ''} />
        <Kpi label="Scostamento sui mesi trascorsi" value={eur0(totA - ytdB)} foot={<Delta value={ytdB ? ((totA - ytdB) / ytdB) * 100 : null} />} />
        <Kpi label="Proiezione a fine anno" value={eur0(ytdB ? totA / ytdB * totB : totA)} foot="a parità di performance sui mesi restanti" />
      </div>
      <Card title={mode === 'line' ? 'Budget per linea (network)' : 'Budget per sede'} flush actions={<div className="row">
        <div className="seg"><label className={mode === 'line' ? 'on' : ''}><input type="radio" checked={mode === 'line'} onChange={() => setMode('line')} />Per linea</label><label className={mode === 'site' ? 'on' : ''}><input type="radio" checked={mode === 'site'} onChange={() => setMode('site')} />Per sede</label></div>
        <a className="btn sm ghost" href={`${apiBase}/budgets/template.xlsx?year=${year}`}><Icon name="download" />Excel</a>
        {writer && <><button className="btn sm ghost" onClick={() => input.current?.click()}><Icon name="upload" />Carica Excel</button><input ref={input} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></>}
        {writer && <button className="btn sm ghost" onClick={propose}>Proponi da anno prec. +10%</button>}
        {writer && <button className="btn sm" disabled={!Object.keys(edit).length} onClick={save}>Salva ({Object.keys(edit).length})</button>}
      </div>}>
        <div className="table-wrap"><table className="t budget">
          <thead><tr><th>{mode === 'line' ? 'Linea' : 'Sede'}</th>{MONTHS_SHORT.map((m, i) => <th key={m} className="num" style={{ background: i + 1 === cm && d.data.current_year === year ? 'var(--silk)' : undefined }}>{m}</th>)}<th className="num">Totale</th><th className="num">Consuntivo</th><th className="num">Δ</th></tr></thead>
          <tbody>{rows.map((r) => { const id = mode === 'line' ? r.line.id : r.site.id; const name = mode === 'line' ? r.line.name : r.site.name; const tb = r.months.reduce((a, x) => a + Number(val(r, x) || 0), 0); const ta = r.months.reduce((a, x) => a + x.actual, 0); const tbY = r.months.filter((x) => x.month <= cm).reduce((a, x) => a + Number(val(r, x) || 0), 0); return (
            <tr key={id}><td className="strong" style={{ whiteSpace: 'nowrap' }}>{name}</td>
              {r.months.map((mm) => <td key={mm.month} className="num" style={{ padding: '4px 4px' }} title={`consuntivo ${eur0(mm.actual)} · anno prec. ${eur0(mm.prev)}`}>
                {writer ? <input className="money" style={{ width: 74, height: 30, fontSize: 12, padding: '0 5px', borderColor: edit[keyOf(r, mm.month)] !== undefined ? 'var(--blue)' : undefined }} value={val(r, mm) === 0 && edit[keyOf(r, mm.month)] === undefined ? '' : val(r, mm)} onChange={(e) => setEdit({ ...edit, [keyOf(r, mm.month)]: e.target.value.replace(/[^\d]/g, '') })} /> : eur0(mm.budget)}
                <div className="small muted" style={{ fontSize: 10.5 }}>{mm.actual ? eur0(mm.actual) : ''}</div>
              </td>)}
              <td className="num strong">{eur0(tb)}</td><td className="num">{eur0(ta)}</td><td className="num"><Delta value={tbY ? ((ta - tbY) / tbY) * 100 : null} /></td>
            </tr>); })}</tbody>
          <tfoot><tr><td>Totale</td>{MONTHS_SHORT.map((_, i) => { const b = rows.reduce((a, r) => a + Number(val(r, r.months[i]) || 0), 0); const ac = rows.reduce((a, r) => a + r.months[i].actual, 0); return <td key={i} className="num">{eur0(b)}<div className="small muted" style={{ fontSize: 10.5 }}>{ac ? eur0(ac) : ''}</div></td>; })}<td className="num">{eur0(rows.reduce((a, r) => a + r.months.reduce((x, m) => x + Number(val(r, m) || 0), 0), 0))}</td><td className="num">{eur0(rows.reduce((a, r) => a + r.months.reduce((x, m) => x + m.actual, 0), 0))}</td><td /></tr></tfoot>
        </table></div>
        {imp && <div className={`alert ${imp.errors?.length ? 'warn' : 'ok'}`} style={{ margin: 18, display: 'block' }}>{imp.saved} valori caricati.{imp.errors?.length ? <ul className="small">{imp.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}</div>}
        <p className="small muted" style={{ padding: '10px 18px' }}>Sotto ogni cella il consuntivo del mese. Il budget per linea è il riferimento del network; quello per sede serve alla lettura per punto vendita. Excel: scarica il format con i valori attuali, compila, ricarica.</p>
      </Card>
    </>
  );
}

function Variance({ year }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [site, setSite] = useState('');
  const [line, setLine] = useState('');
  const [ai, setAi] = useState(false);
  const d = useApi(`/variance${qs({ year, month, site_id: site, line_id: line, ai: ai ? 1 : '' })}`, [year]);
  const [note, setNote] = useState({ kind: 'INTERNA', note: '' });
  const v = d.data;
  const addNote = async () => { try { await api.post('/variance/notes', { year, month, site_id: site ? Number(site) : null, line_id: line ? Number(line) : null, kind: note.kind, note: note.note }); setNote({ kind: 'INTERNA', note: '' }); toast('Motivazione salvata'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const pr = v?.prorata_ratio != null && v.prorata_ratio < 1;
  const VTable = ({ rows, onPick, idKey }) => <div className="table-wrap"><table className="t"><thead><tr><th>Voce</th><th className="num">Budget{pr ? ' pro rata' : ''}</th><th className="num">Consuntivo</th><th className="num">Δ</th><th className="num">Δ %</th></tr></thead>
    <tbody>{rows.map((x) => <tr key={x.label} className="click" onClick={() => onPick(x[idKey])}><td className="strong" style={{ whiteSpace: 'nowrap' }}>{x.label}</td><td className="num">{eur0(x.budget_prorata)}{pr ? <div className="small muted">{eur0(x.budget)}</div> : null}</td><td className="num">{eur0(x.actual)}</td><td className={`num strong ${x.variance_prorata >= 0 ? 'green' : 'red'}`}>{x.variance_prorata >= 0 ? '+' : ''}{eur0(x.variance_prorata)}</td><td className="num"><Delta value={x.variance_prorata_pct} /></td></tr>)}</tbody></table></div>;
  return (
    <>
      <div className="filters">
        <Field label="Mese"><select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
        <SiteSelect value={site} onChange={(x) => { setSite(x); if (x) setLine(''); }} label="Sede (focus)" all="Network" />
        <LineSelect value={line} onChange={(x) => { setLine(x); if (x) setSite(''); }} />
        {v?.ai_enabled && <Field label="Lettura narrativa" className="inline"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> genera con API Claude</Field>}
      </div>
      <ErrorBox error={d.error} />
      {!v ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi accent label={`${v.focus?.label || 'Network'} · ${MONTHS[month - 1]} ${year}`} value={eur0(v.focus?.actual)} foot={pr ? `budget pro rata ${eur0(v.focus?.budget_prorata)} (mese ${eur0(v.focus?.budget)})` : `budget ${eur0(v.focus?.budget)}`} />
          <Kpi label={pr ? 'Scostamento sul pro rata' : 'Scostamento'} value={`${v.focus?.variance_prorata >= 0 ? '+' : ''}${eur0(v.focus?.variance_prorata)}`} foot={<Delta value={v.focus?.variance_prorata_pct} />} />
          <Kpi label="Stesso mese anno precedente" value={eur0(v.focus?.prev)} foot={<Delta value={v.focus?.yoy_pct} />} />
          <Kpi label="Giorni lavorati" value={`${v.days.actual ?? '–'} / ${v.days.planned ?? '–'}`} foot={v.days.in_progress ? 'mese in corso: reali finora su pianificati' : 'reali su pianificati'} />
        </div>
        <div className="grid g2">
          <Card title="Per linea" flush><VTable rows={v.byLine} idKey="line_id" onPick={(id) => { setLine(String(id)); setSite(''); }} /></Card>
          <Card title="Per sede" flush><div className="table-wrap" style={{ maxHeight: 420 }}><VTable rows={v.bySite} idKey="site_id" onPick={(id) => { setSite(String(id)); setLine(''); }} /></div></Card>
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Ipotesi: cosa può spiegare lo scostamento" actions={<span className="small muted">segnali dai dati, in ordine di rilevanza</span>}>
            {v.narrative && <div className="alert info" style={{ display: 'block', marginBottom: 12 }}>{v.narrative}</div>}
            {v.signals.length ? <ul className="timeline">{v.signals.map((s, i) => <li key={i}><div className="ev"><Badge tone={s.kind === 'ESTERNA' ? 'mauve' : 'teal'}>{s.kind === 'ESTERNA' ? 'Esterna' : 'Interna'}</Badge></div><div className="small" style={{ marginTop: 4 }}>{s.text}</div></li>)}</ul> : <Empty>Nessun segnale</Empty>}
            {v.market.length > 0 && <><div className="subhead">Dati di mercato del bacino</div><div className="table-wrap" style={{ maxHeight: 220 }}><table className="t"><tbody>{v.market.map((m) => <tr key={m.territory + m.metric + (m.ateco || '')}><td className="small">{m.territory}{m.ateco ? <span className="muted"> · ATECO {m.ateco}</span> : ''}</td><td className="small">{m.metric_label}</td><td className="num small strong">{Number(m.value) < 1 ? pct(Number(m.value) * 100) : num(m.value)}</td><td className="small muted">{m.year}</td></tr>)}</tbody></table></div></>}
          </Card>
          <Card title="Motivazioni annotate" actions={<span className="small muted">{v.notes.length} note</span>}>
            {canWrite(user) && <div className="row" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
              <select value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} style={{ width: 130 }}><option value="INTERNA">Interna</option><option value="ESTERNA">Esterna</option><option value="AZIONE">Azione</option></select>
              <textarea value={note.note} placeholder="es. medico cardiologo assente 2 settimane; apertura nuovo competitor a 500 m; campagna partita il 12 invece del 1°" onChange={(e) => setNote({ ...note, note: e.target.value })} style={{ flex: 1, minHeight: 60 }} />
              <button className="btn" disabled={note.note.trim().length < 3} onClick={addNote}>Annota</button>
            </div>}
            {v.notes.length ? <ul className="timeline">{v.notes.map((n) => <li key={n.id}><div className="ev"><Badge tone={n.kind === 'ESTERNA' ? 'mauve' : n.kind === 'AZIONE' ? 'green' : 'teal'}>{n.kind}</Badge> <span className="small muted">{n.author || ''} · {itDateTime(n.created_at)}</span>{canWrite(user) && <button className="btn sm link" style={{ marginLeft: 8 }} onClick={async () => { await api.del(`/variance/notes/${n.id}`); d.reload(); }}>elimina</button>}</div><div className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.note}</div></li>)}</ul> : <Empty>Nessuna motivazione annotata per questo mese e perimetro</Empty>}
          </Card>
        </div>
      </>}
    </>
  );
}

function WorkingDays({ year }) {
  const { user } = useAuth();
  const toast = useToast();
  const [site, setSite] = useState('');
  const d = useApi(`/working-days${qs({ year, site_id: site })}`, [year]);
  const [edit, setEdit] = useState(null);
  useEffect(() => { if (d.data) setEdit(d.data.months.map((m) => ({ month: m.month, planned: m.planned, override: m.override, notes: m.notes }))); }, [d.data]);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data || !edit) return <Loading />;
  const save = async () => { try { await api.put('/working-days', { year, site_id: site ? Number(site) : null, months: edit.map((m) => ({ month: m.month, planned: Number(m.planned) || 0, override: m.override === '' || m.override == null ? null : Number(m.override), notes: m.notes || null })) }); toast('Giorni lavorati salvati'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const applyDefault = async () => { try { await api.post('/working-days/default', { year }); toast('Calendario standard applicato a network e sedi'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const totPlanned = edit.reduce((a, m) => a + (Number(m.planned) || 0), 0); const totActual = d.data.months.reduce((a, m) => a + m.actual, 0); const totRev = d.data.months.reduce((a, m) => a + m.revenue, 0);
  return (
    <>
      <div className="filters"><SiteSelect value={site} onChange={setSite} label="Perimetro" all="Intero network" />{canWrite(user) && <div className="row" style={{ alignSelf: 'flex-end' }}><button className="btn ghost" onClick={applyDefault}>Applica calendario standard {year}</button><button className="btn" onClick={save}>Salva</button></div>}</div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Giorni lavorabili pianificati" value={num(totPlanned)} foot="lunedì-sabato meno festività, modificabile per mese" />
        <Kpi label="Giorni lavorati reali" value={num(totActual)} foot="giorni con almeno un'accettazione (o valore forzato)" />
        <Kpi label="Fatturato per giorno lavorato" value={eur0(totActual ? totRev / totActual : 0)} foot="media dell'anno" />
        <Kpi label="Giorni persi" value={num(Math.max(0, d.data.months.filter((m) => m.actual > 0).reduce((a, m) => a + (Number(edit[m.month - 1].planned) || 0), 0) - totActual))} foot="sui mesi con attività" />
      </div>
      <Card flush>
        <table className="t"><thead><tr><th>Mese</th><th className="num">Pianificati</th><th className="num">Reali (da vendite)</th><th className="num">Reali (forzato)</th><th className="num">Δ giorni</th><th className="num">Fatturato</th><th className="num">Per giorno</th><th className="num">Accettazioni/giorno</th><th>Note</th></tr></thead>
          <tbody>{d.data.months.map((m, i) => <tr key={m.month}><td className="strong">{MONTHS[m.month - 1]}</td>
            <td className="num">{canWrite(user) ? <input type="number" min="0" max="31" value={edit[i].planned} style={{ width: 70, height: 30 }} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, planned: e.target.value } : x)))} /> : m.planned}</td>
            <td className="num">{m.actual_from_sales || '–'}</td>
            <td className="num">{canWrite(user) ? <input type="number" min="0" max="31" value={edit[i].override ?? ''} placeholder="auto" style={{ width: 70, height: 30 }} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, override: e.target.value } : x)))} /> : m.override ?? '–'}</td>
            <td className={`num strong ${m.actual && m.actual < (Number(edit[i].planned) || 0) ? 'red' : ''}`}>{m.actual ? m.actual - (Number(edit[i].planned) || 0) : '–'}</td>
            <td className="num">{m.revenue ? eur0(m.revenue) : '–'}</td><td className="num">{m.revenue_per_day ? eur0(m.revenue_per_day) : '–'}</td><td className="num">{m.actual ? num(m.tickets / m.actual) : '–'}</td>
            <td>{canWrite(user) ? <input value={edit[i].notes || ''} placeholder="es. chiusura per lavori 3 gg" style={{ height: 30 }} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} /> : m.notes}</td></tr>)}</tbody>
          <tfoot><tr><td>Totale</td><td className="num">{num(totPlanned)}</td><td className="num">{num(d.data.months.reduce((a, m) => a + m.actual_from_sales, 0))}</td><td /><td className="num">{num(totActual - totPlanned)}</td><td className="num">{eur0(totRev)}</td><td className="num">{eur0(totActual ? totRev / totActual : 0)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </Card>
      <p className="small muted" style={{ marginTop: 10 }}>I giorni reali vengono contati dalle vendite importate (giorni con almeno un'accettazione); se l'import non copre il mese, forza il valore. Il sabato conta come lavorabile se la sede è aperta il sabato (scheda struttura, orari).</p>
    </>
  );
}

function Market() {
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi('/market');
  const input = useRef(null);
  const [add, setAdd] = useState({ year: new Date().getFullYear() - 1, territory_kind: 'COMUNE', territory: '', province: '', ateco: '', metric: 'popolazione', value: '', source: '' });
  const [f, setF] = useState('');
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const rows = d.data.rows.filter((x) => !f || x.territory.toLowerCase().includes(f.toLowerCase()) || (x.ateco || '').includes(f));
  const onFile = async (file) => { if (!file) return; try { const fd = new FormData(); fd.append('file', file); const r = await api.upload('/market/import', fd); toast(`${r.saved} valori caricati${r.errors.length ? `, ${r.errors.length} righe scartate` : ''}`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const save = async () => { try { await api.post('/market', { ...add, year: Number(add.year), value: Number(String(add.value).replace(',', '.')), province: add.province || null, ateco: add.ateco || null, source: add.source || null }); toast('Dato salvato'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Card title="Carica dati di mercato" actions={<a className="btn sm ghost" href={`${apiBase}/market/template.xlsx`}><Icon name="download" />Format Excel</a>}>
          <p className="small muted" style={{ marginTop: 0 }}>Per territorio (comune, provincia, regione, Italia) e per codice ATECO: popolazione, famiglie, età media, contribuenti e redditi (MEF), imprese attive e addetti per sezione ATECO (Camera di Commercio, ISTAT ASIA), variazioni annue, spesa delle famiglie. I redditi MEF 2024 dei comuni del network sono precaricati. Questi dati alimentano le ipotesi esterne nell'analisi degli scostamenti e la scheda struttura di ogni sede (bacino).</p>
          {canWrite(user) && <><button className="btn" onClick={() => input.current?.click()}><Icon name="upload" />Carica Excel o CSV</button><input ref={input} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></>}
        </Card>
        {canWrite(user) && <Card title="Inserimento manuale">
          <div className="form-grid">
            <Field label="Anno"><input type="number" value={add.year} onChange={(e) => setAdd({ ...add, year: e.target.value })} /></Field>
            <Field label="Tipo"><select value={add.territory_kind} onChange={(e) => setAdd({ ...add, territory_kind: e.target.value })}><option>COMUNE</option><option>PROVINCIA</option><option>REGIONE</option><option>ITALIA</option></select></Field>
            <Field label="Territorio"><input value={add.territory} placeholder="es. Prato" onChange={(e) => setAdd({ ...add, territory: e.target.value })} /></Field>
            <Field label="Provincia"><input value={add.province} maxLength={2} onChange={(e) => setAdd({ ...add, province: e.target.value.toUpperCase() })} /></Field>
            <Field label="ATECO (vuoto = generale)"><input value={add.ateco} placeholder="es. C, 86, 86.10" onChange={(e) => setAdd({ ...add, ateco: e.target.value })} /></Field>
            <Field label="Indicatore"><select value={add.metric} onChange={(e) => setAdd({ ...add, metric: e.target.value })}>{Object.entries(d.data.metrics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Valore"><input value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} /></Field>
            <Field label="Fonte"><input value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 10 }}><button className="btn sm" disabled={!add.territory || add.value === ''} onClick={save}>Salva</button></div>
        </Card>}
      </div>
      <Card flush title={`Dati caricati (${rows.length})`} actions={<input placeholder="Filtra per territorio o ATECO" value={f} onChange={(e) => setF(e.target.value)} style={{ width: 220, height: 32 }} />}>
        {!rows.length ? <Empty>Nessun dato</Empty> : <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t"><thead><tr><th>Territorio</th><th>Tipo</th><th>ATECO</th><th>Indicatore</th><th className="num">Valore</th><th>Anno</th><th>Fonte</th>{canWrite(user) && <th />}</tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id}><td className="strong">{x.territory}{x.province ? <span className="small muted"> ({x.province})</span> : ''}</td><td className="small">{x.territory_kind}</td><td className="small">{x.ateco || '–'}</td><td>{x.metric_label}</td><td className="num strong">{Number(x.value) < 1 && Number(x.value) > 0 ? pct(Number(x.value) * 100) : num(x.value)}</td><td>{x.year}</td><td className="small muted">{x.source}</td>{canWrite(user) && <td className="num"><button className="iconbtn" onClick={async () => { await api.del(`/market/${x.id}`); d.reload(); }}><Icon name="trash" /></button></td>}</tr>)}</tbody></table></div>}
      </Card>
    </>
  );
}
