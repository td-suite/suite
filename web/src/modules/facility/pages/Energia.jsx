// Energy management: quadro per sede o di rete (consumi e costi per vettore, CO2, intensità, anno su anno, anomalie), confronto tra
// sedi a parità di attività e superficie con fasce di benchmark indicative, attività per sede e mese, obiettivi di riduzione, analisi
// con Claude e rapporti per la certificazione (PDF e XLSX)
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi, qs, apiBase } from '../api.js';
import { Card, Loading, Empty, PageHead, Kpi, Tabs, Field, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isFacility, isSite } from '../index.jsx';
import { Alert, Bench, Target, Progress, SiteSelect, YearSelect, useSites } from '../components/bits.jsx';
import { MonthlyCompare, RankBars } from '../components/Charts.jsx';
import { VECTOR, SITE_KIND, MESI, num, eur, pct, itDateTime, meseLabel, thisYear } from '../format.js';

const URG = { ALTA: 'red', MEDIA: 'amber', BASSA: 'teal' };

export default function Energia() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const sites = useSites();
  const [year, setYear] = useState(Number(sp.get('year')) || thisYear());
  const [siteId, setSiteId] = useState(sp.get('site_id') || (isSite(user) && user.site_ids?.length === 1 ? String(user.site_ids[0]) : ''));
  const [tab, setTab] = useState(sp.get('tab') || 'quadro');
  const { data: e, loading, error, reload } = useApi(`/energia${qs({ year, site_id: siteId })}`, [], { silent: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const n = new URLSearchParams(); if (siteId) n.set('site_id', siteId); if (year !== thisYear()) n.set('year', year); if (tab !== 'quadro') n.set('tab', tab); setSp(n, { replace: true }); }, [siteId, year, tab]);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!e && loading) return <div className="page"><Loading /></div>;
  if (!e.finance) return <div className="page"><PageHead title="Energia" icon="sun" /><Alert tone="warn" icon="alert">{e.message}</Alert></div>;
  const s = siteId ? e.sites.find((x) => String(x.site.id) === String(siteId)) : null;
  const blk = s || e.network;
  const analisi = async () => { setBusy(true); try { await api.post('/energia/analisi', { year, site_id: siteId || null }); toast('Analisi generata'); reload(); } catch (x) { toast(x, 'err'); } setBusy(false); };
  const repQ = qs({ year, site_id: siteId });
  return (
    <div className="page">
      <PageHead title="Energia" icon="sun" sub={`${s ? s.site.name : 'Rete Toscana Diagnostica'} · ${year}. Consumi da bollette (Payments) e letture, intensità a parità di attività, anomalie e obiettivi: evidenze per ISO 9001 e, se intraprese, ISO 14001 / 50001.`}
        actions={<><a className="btn ghost" href={`${apiBase}/report/energia.pdf${repQ}&inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" />Rapporto PDF</a><a className="btn ghost" href={`${apiBase}/report/energia.xlsx${repQ}`}><Icon name="sheet" />XLSX</a></>} />
      <div className="fa-filters">
        <SiteSelect value={siteId} onChange={setSiteId} sites={sites} all={e.limited ? null : 'Rete (tutte le sedi)'} />
        <YearSelect value={year} onChange={setYear} />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'quadro', label: 'Quadro' }, ...(e.limited ? [] : [{ value: 'confronti', label: 'Confronto tra sedi' }]), { value: 'attivita', label: 'Attività' }, { value: 'obiettivi', label: 'Obiettivi' }, { value: 'analisi', label: 'Analisi con Claude' }]} />
      </div>
      {tab === 'quadro' && <Quadro e={e} s={s} blk={blk} year={year} />}
      {tab === 'confronti' && <Confronti e={e} year={year} />}
      {tab === 'attivita' && <Attivita year={year} sites={sites} siteId={siteId} canEdit={e.can_edit} />}
      {tab === 'obiettivi' && <Obiettivi e={e} sites={sites} year={year} canEdit={e.can_edit} reload={reload} />}
      {tab === 'analisi' && <Card title="Analisi dei consumi con Claude" icon="sparkle" actions={isFacility(user) && <button className="btn" disabled={busy || !e.ai.enabled && !e.ai.mock} onClick={analisi}><Icon name="sparkle" />{busy ? 'Analisi in corso' : e.analisi ? 'Rigenera' : 'Genera l\'analisi'}</button>}>
        {e.ai.message && <Alert tone={e.ai.mock ? '' : 'warn'} icon="info">{e.ai.message}</Alert>}
        {!e.analisi ? <Empty compact icon="sparkle" title="Nessuna analisi per questo ambito e anno">Claude commenta consumi, costi e anomalie e propone azioni di efficientamento ordinate per urgenza. Nel prompt vanno solo dati aggregati.</Empty> : <>
          <div className="small muted" style={{ marginBottom: 8 }}>Generata il {itDateTime(e.analisi.generated_at)} · {e.analisi.model}</div>
          <p style={{ marginTop: 0 }}>{e.analisi.result.commento}</p>
          {e.analisi.result.anomalie?.length > 0 && <><div className="fa-month">Anomalie</div><ul className="fa-list">{e.analisi.result.anomalie.map((a, i) => <li key={i}><span>{a.descrizione}<div className="m">{a.possibile_causa}</div></span></li>)}</ul></>}
          {e.analisi.result.azioni?.length > 0 && <><div className="fa-month">Azioni di efficientamento</div><table className="t fa-table"><thead><tr><th>Urgenza</th><th>Azione</th><th>Beneficio atteso</th><th>Sede</th></tr></thead><tbody>{e.analisi.result.azioni.map((a, i) => <tr key={i}><td><span className={`badge b-${URG[a.urgenza]}`}>{a.urgenza.toLowerCase()}</span></td><td className="strong">{a.azione}</td><td>{a.beneficio_atteso}</td><td className="small">{a.sede}</td></tr>)}</tbody></table></>}
          {e.analisi.result.note_certificazione && <div className="fa-muted-box" style={{ marginTop: 10 }}>{e.analisi.result.note_certificazione}</div>}
          <div className="small muted" style={{ marginTop: 8 }}>Supporto all'analisi: va verificato da Facility e dalla funzione Qualità.</div>
        </>}
      </Card>}
    </div>
  );
}

function Quadro({ e, s, blk, year }) {
  const anom = new Set(blk.anomalies.filter((a) => a.month.startsWith(String(year))).map((a) => a.month));
  const elettrico = blk.vectors.find((v) => v.vector === 'ELETTRICO');
  return <>
    {!blk.totals.kwh && <Alert icon="info">Nessun consumo nel {year} per questo ambito: registra le bollette con i consumi (Utenze) o le letture dei contatori.</Alert>}
    <div className="fa-kpis">
      <Kpi accent label="Energia (kWh equivalenti)" value={num(blk.totals.kwh)} foot={`${pct(blk.delta_kwh_pct)} sugli stessi mesi del ${year - 1} (${num(blk.prev_ytd.kwh)}) · ${blk.totals.months} mesi con dati`} />
      <Kpi label="Spesa" value={eur(blk.totals.cost)} foot={`${eur(blk.prev_ytd.cost)} negli stessi mesi del ${year - 1}`} />
      <Kpi label="CO2 equivalente" value={`${num(blk.totals.co2 / 1000, 2)} t`} foot={blk.intensity.co2_m2 != null ? `${num(blk.intensity.co2_m2, 1)} kg per m2` : 'fattori indicativi'} />
      <Kpi label="kWh per m2 all'anno" value={num(blk.intensity.kwh_m2_anno, 1)} foot={blk.sqm ? `${num(blk.sqm)} m2${blk.intensity.annualizzato ? ' · annualizzato' : ''}` : 'superficie da indicare negli Immobili'}>{s?.benchmark?.position && <div style={{ marginTop: 4 }}><Bench p={s.benchmark.position} /></div>}</Kpi>
      <Kpi label="kWh per accettazione" value={num(blk.intensity.kwh_per_acc, 2)} foot={blk.activity.accettazioni ? `${num(blk.activity.accettazioni)} accettazioni` : 'attività da registrare'} />
      <Kpi label="kWh per ora di apertura" value={num(blk.intensity.kwh_per_ora, 2)} foot={blk.activity.ore ? `${num(blk.activity.ore)} ore` : 'ore da indicare'} />
    </div>
    <div className="fa-wide">
      <Card title={`Consumi mensili ${year} e ${year - 1} (kWh equivalenti)`} icon="stats">
        <MonthlyCompare monthly={blk.monthly} year={year} anomalie={anom} />
        <div className="fa-legend">In rosso i mesi con anomalia. Gas convertito in kWh con {num(e.factors.kwh.GAS, 2)} kWh/Smc.</div>
      </Card>
      <Card title="Vettori" icon="bolt" flush>
        {!blk.vectors.length ? <Empty compact icon="bolt" title="Nessuna utenza energetica" /> : <table className="t fa-table"><thead><tr><th>Vettore</th><th className="num">Quantità</th><th className="num">Spesa</th><th className="num">Costo unitario</th><th className="num">Var.</th></tr></thead>
          <tbody>{blk.vectors.map((v) => <tr key={v.vector}><td className="strong">{VECTOR[v.vector]}<div className="small muted">{v.utilities} utenz{v.utilities === 1 ? 'a' : 'e'}</div></td><td className="num">{num(v.qty)} {v.unit}</td><td className="num">{eur(v.cost)}</td><td className="num">{v.unit_cost != null ? `${num(v.unit_cost, 4)} €/${v.unit}` : '–'}</td><td className="num">{pct(v.delta_pct)}</td></tr>)}</tbody></table>}
        {s?.benchmark?.band && <div className="small muted" style={{ padding: 12 }}>Fascia indicativa per {s.benchmark.band.label.toLowerCase()}: {s.benchmark.band.min}-{s.benchmark.band.max} kWh/m2 anno. {e.benchmark.source}</div>}
        {elettrico && s && <div className="small muted" style={{ padding: '0 12px 12px' }}>Solo elettrico: {num(s.intensity_elettrico?.kwh_m2_anno, 1)} kWh/m2 anno · {num(s.intensity_elettrico?.kwh_per_acc, 2)} kWh per accettazione.</div>}
      </Card>
    </div>
    <div className="fa-two">
      <Card title="Anno su anno" icon="calendar" flush>
        <table className="t fa-table"><thead><tr><th>Mese</th><th className="num">{year}</th><th className="num">{year - 1}</th><th className="num">Variazione</th></tr></thead>
          <tbody>{blk.yoy.months.map((m) => <tr key={m.month}><td>{MESI[Number(m.month.slice(5)) - 1]}</td><td className="num">{num(m.cur)}</td><td className="num">{num(m.prev)}</td><td className="num" style={{ color: m.delta_pct > 20 ? 'var(--red)' : m.delta_pct < 0 ? 'var(--green)' : undefined }}>{pct(m.delta_pct)}</td></tr>)}
            <tr><td className="strong">Da inizio anno ({blk.yoy.ytd.months} mesi)</td><td className="num strong">{num(blk.yoy.ytd.cur)}</td><td className="num strong">{num(blk.yoy.ytd.prev)}</td><td className="num strong">{pct(blk.yoy.ytd.delta_pct)}</td></tr></tbody></table>
      </Card>
      <Card title="Anomalie" icon="alert" flush>
        {!blk.anomalies.length ? <Empty compact icon="check" title="Nessuna anomalia" /> : <table className="t fa-table"><thead><tr><th>Mese</th><th>Utenza</th><th className="num">Valore</th><th className="num">Riferimento</th><th className="num">Scarto</th></tr></thead>
          <tbody>{blk.anomalies.map((a, i) => <tr key={i}><td>{meseLabel(a.month)}</td><td>{s ? '' : `${e.sites.find((x) => x.site.id === a.site_id)?.site.name || ''} · `}{VECTOR[a.vector]}</td><td className="num">{num(a.value)} {a.unit}</td><td className="num">{num(a.ref)}<div className="small muted">{a.ref_kind === 'ANNO_PRECEDENTE' ? 'anno prima' : 'media 3 mesi'}</div></td><td className="num" style={{ color: 'var(--red)' }}>{pct(a.delta_pct)}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  </>;
}

function Confronti({ e, year }) {
  const r = e.classifica;
  const media = (rows, k) => { const xs = rows.filter((x) => x[k] != null); return xs.length ? xs.reduce((a, x) => a + x[k], 0) / xs.length : null; };
  const toBars = (rows, k) => rows.filter((x) => x.rank).map((x) => ({ name: `${x.rank}. ${x.name}`, value: x[k], tone: x.benchmark === 'SOPRA' ? 'amber' : null }));
  return <>
    <Alert icon="info">Confronto a parità di attività (kWh per accettazione), di superficie (kWh per m2 all'anno) e di apertura (kWh per ora). Più basso è più efficiente; in arancio le sedi sopra la fascia indicativa della propria tipologia. {e.benchmark.source}</Alert>
    <div className="fa-three">
      <Card title="kWh per accettazione" icon="users"><RankBars rows={toBars(r.per_accettazione, 'kwh_per_acc')} unit="kWh/acc." media={media(r.per_accettazione, 'kwh_per_acc')} /></Card>
      <Card title="kWh per m2 all'anno" icon="building"><RankBars rows={toBars(r.per_m2, 'kwh_m2_anno')} unit="kWh/m2" media={media(r.per_m2, 'kwh_m2_anno')} /></Card>
      <Card title="kWh per ora di apertura" icon="clock"><RankBars rows={toBars(r.per_ora, 'kwh_per_ora')} unit="kWh/h" media={media(r.per_ora, 'kwh_per_ora')} /></Card>
    </div>
    <Card title={`Sedi ${year}`} icon="list" flush>
      <table className="t fa-table"><thead><tr><th>Sede</th><th>Tipologia</th><th className="num">kWh eq.</th><th className="num">Var. stessi mesi</th><th className="num">m2</th><th className="num">kWh/m2 anno</th><th className="num">kWh/acc.</th><th className="num">kWh/ora</th><th className="num">CO2 t</th><th className="num">Spesa</th><th>Benchmark</th></tr></thead>
        <tbody>{e.sites.map((x) => <tr key={x.site.id}><td className="strong">{x.site.name}</td><td className="small">{SITE_KIND[x.site.kind]}</td><td className="num">{num(x.totals.kwh)}</td><td className="num">{pct(x.delta_kwh_pct)}</td><td className="num">{num(x.sqm)}</td><td className="num">{num(x.intensity.kwh_m2_anno, 1)}</td><td className="num">{num(x.intensity.kwh_per_acc, 2)}</td><td className="num">{num(x.intensity.kwh_per_ora, 2)}</td><td className="num">{num(x.totals.co2 / 1000, 2)}</td><td className="num">{eur(x.totals.cost)}</td><td><Bench p={x.benchmark.position} /></td></tr>)}
          <tr><td className="strong">Rete</td><td /><td className="num strong">{num(e.network.totals.kwh)}</td><td className="num strong">{pct(e.network.delta_kwh_pct)}</td><td className="num">{num(e.network.sqm)}</td><td className="num strong">{num(e.network.intensity.kwh_m2_anno, 1)}</td><td className="num strong">{num(e.network.intensity.kwh_per_acc, 2)}</td><td className="num strong">{num(e.network.intensity.kwh_per_ora, 2)}</td><td className="num">{num(e.network.totals.co2 / 1000, 2)}</td><td className="num">{eur(e.network.totals.cost)}</td><td /></tr></tbody></table>
    </Card>
  </>;
}

function Attivita({ year, sites, siteId, canEdit }) {
  const toast = useToast();
  const { data, reload } = useApi(`/energia/attivita${qs({ year, site_id: siteId })}`);
  const [draft, setDraft] = useState({});
  if (!data) return <Loading />;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const list = siteId ? sites.filter((x) => String(x.id) === String(siteId)) : sites;
  const val = (sid, m) => { const k = `${sid}:${m}`; if (draft[k] !== undefined) return draft[k]; const r = data.rows.find((x) => x.site_id === sid && x.month === m); return r?.accettazioni ?? ''; };
  const src = (sid, m) => data.rows.find((x) => x.site_id === sid && x.month === m)?.source;
  const save = async () => {
    const rows = Object.entries(draft).map(([k, v]) => { const [sid, m] = k.split(':'); const r = data.rows.find((x) => x.site_id === Number(sid) && x.month === m) || {}; return { site_id: Number(sid), month: m, accettazioni: v === '' ? null : Number(v), prestazioni: r.prestazioni ?? null, ore_apertura: r.ore_apertura ?? null, giorni_apertura: r.giorni_apertura ?? null }; });
    if (!rows.length) return;
    try { await api.put('/energia/attivita', { rows }); toast(`${rows.length} valori salvati`); setDraft({}); reload(); } catch (e) { toast(e, 'err'); }
  };
  const sync = async () => { try { const r = await api.post('/energia/attivita/sync', {}); toast(r.note || `Attività da ${r.source}: ${r.rows} mesi aggiornati`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <Card title={`Accettazioni per sede e mese · ${year}`} icon="users" flush actions={canEdit && <><button className="btn sm ghost" onClick={sync}><Icon name="refresh" />Aggiorna da {data.source === 'AUTO' ? (data.availability.retail ? 'Retail' : data.availability.cash ? 'Cash' : 'sorgente') : data.source.toLowerCase()}</button><button className="btn sm" disabled={!Object.keys(draft).length} onClick={save}>Salva</button></>}>
      <div className="small muted" style={{ padding: '10px 12px 0' }}>Misura dell'attività per gli indicatori "a parità di attività". Fonte impostata: {data.source === 'AUTO' ? 'automatica (Retail Assistant, poi Cash Management, poi manuale)' : data.source.toLowerCase()}. Retail {data.availability.retail ? 'avviato' : 'non avviato'}, Cash {data.availability.cash ? 'avviato' : 'non avviato'}. I valori inseriti a mano non vengono sovrascritti.</div>
      <div style={{ overflowX: 'auto', padding: 12 }}>
        <table className="t fa-table"><thead><tr><th>Sede</th>{months.map((m) => <th key={m} className="num">{MESI[Number(m.slice(5)) - 1]}</th>)}</tr></thead>
          <tbody>{list.map((x) => <tr key={x.id}><td className="strong" style={{ whiteSpace: 'nowrap' }}>{x.name}</td>{months.map((m) => <td key={m} className="num" title={src(x.id, m) ? `fonte: ${src(x.id, m).toLowerCase()}` : ''}>
            {canEdit ? <input className="fa-in" style={{ width: 70, textAlign: 'right' }} type="number" min="0" value={val(x.id, m)} onChange={(ev) => setDraft({ ...draft, [`${x.id}:${m}`]: ev.target.value })} /> : num(val(x.id, m) === '' ? null : val(x.id, m))}</td>)}</tr>)}</tbody></table>
      </div>
    </Card>
  );
}

function Obiettivi({ e, sites, year, canEdit, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ site_id: '', year, vector: '', target_pct_reduction: 5, baseline_year: year - 1, notes: '' });
  const add = async () => { try { await api.post('/energia/obiettivi', f); toast('Obiettivo salvato'); reload(); } catch (x) { toast(x, 'err'); } };
  const del = async (t) => { try { await api.del(`/energia/obiettivi/${t.id}`); reload(); } catch (x) { toast(x, 'err'); } };
  return <>
    <Card title="Obiettivi di riduzione" icon="star" flush style={{ marginBottom: 16 }}>
      {!e.obiettivi.length ? <Empty compact icon="star" title="Nessun obiettivo">Fissa una riduzione percentuale rispetto a un anno base, per la rete o per sede, sull'energia totale o su un vettore.</Empty> : (
        <table className="t fa-table"><thead><tr><th>Ambito</th><th>Anno</th><th>Vettore</th><th className="num">Obiettivo</th><th>Anno base</th><th className="num">Riduzione ottenuta</th><th style={{ width: 160 }}>Avanzamento</th><th>Stato</th>{canEdit && <th />}</tr></thead>
          <tbody>{e.obiettivi.map((t) => <tr key={t.id}><td className="strong">{t.site_name || 'Rete'}</td><td>{t.year}</td><td>{t.vector ? VECTOR[t.vector] : 'Energia totale'}</td><td className="num">-{num(t.target_pct_reduction, 1)}%</td><td>{t.baseline_year}</td>
            <td className="num">{t.progress.reduction_pct != null ? `${num(t.progress.reduction_pct, 1)}%` : '–'}<div className="small muted">{t.progress.months} mesi confrontati</div></td><td><Progress value={t.progress.reduction_pct} target={Number(t.target_pct_reduction)} /></td><td><Target s={t.progress.status} /></td>
            {canEdit && <td><button className="iconbtn" title="Elimina" onClick={() => del(t)}><Icon name="trash" /></button></td>}</tr>)}</tbody></table>)}
    </Card>
    {canEdit && <Card title="Nuovo obiettivo" icon="plus">
      <div className="fa-grid">
        <Field label="Ambito"><SiteSelect className="fa-in w" value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} sites={sites} all="Rete" /></Field>
        <Field label="Vettore"><select className="fa-in w" value={f.vector} onChange={(ev) => setF({ ...f, vector: ev.target.value })}><option value="">Energia totale (kWh eq.)</option>{Object.entries(VECTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Riduzione (%)"><input className="fa-in w" type="number" min="0" max="100" step="0.5" value={f.target_pct_reduction} onChange={(ev) => setF({ ...f, target_pct_reduction: ev.target.value })} /></Field>
        <Field label="Anno dell'obiettivo"><input className="fa-in w" type="number" value={f.year} onChange={(ev) => setF({ ...f, year: ev.target.value })} /></Field>
        <Field label="Anno base"><input className="fa-in w" type="number" value={f.baseline_year} onChange={(ev) => setF({ ...f, baseline_year: ev.target.value })} /></Field>
        <div style={{ alignSelf: 'end' }}><button className="btn" onClick={add}><Icon name="plus" />Salva obiettivo</button></div>
      </div>
      <div className="small muted">Il confronto usa gli stessi mesi dell'anno base: un anno in corso si valuta sui mesi già fatturati o letti.</div>
    </Card>}
  </>;
}
