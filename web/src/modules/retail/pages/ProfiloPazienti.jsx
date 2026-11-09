// Profilo dei pazienti del laboratorio (Synclab, proiezione standard): età, sesso, provenienza, andamento, esami e orari delle
// accettazioni. Nessun dato identificativo: l'unità è l'accettazione, non la persona. Documentazione: docs/RETAIL_PROFILO_PAZIENTI.md.
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Kpi, useToast } from '../components/ui.jsx';
import { VBars, HBars, Lines, C, PALETTE } from '../components/charts.jsx';
import { useAuth, canWrite } from '../auth.jsx';
import { api, qs, apiBase } from '../api.js';
import { num, pct, monthLabel, itDateTime, today } from '../format.js';

const MappaComuni = React.lazy(() => import('../components/MappaComuni.jsx'));
const SESSO = { F: 'Donne', M: 'Uomini', ALTRO: 'Altro codice', ND: 'Non indicato' };
const FASCE = ['0-17', '18-29', '30-44', '45-59', '60-74', '75+', 'ND'];
const fasciaLbl = (f) => (f === 'ND' ? 'Età n.d.' : f);
const d1 = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 }));
const variaz = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
function Var({ cur, prev, suffix = '' }) {
  if (prev == null) return <span className="muted">–</span>;
  const v = variaz(cur, prev);
  if (v == null) return <span className="muted">–</span>;
  return <span style={{ color: v > 0 ? C.green : v < 0 ? C.red : 'inherit', fontWeight: 650 }}>{v > 0 ? '+' : ''}{d1(v)}%{suffix}</span>;
}

export default function ProfiloPazienti() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const anno = today().slice(0, 4);
  const init = () => ({ tipo: sp.get('tipo') || '12m', mese: sp.get('mese') || today().slice(0, 7), trimestre: sp.get('trimestre') || `${anno}-Q${Math.ceil(Number(today().slice(5, 7)) / 3)}`, anno: sp.get('anno') || anno,
    site_id: sp.get('site_id') || '', patient_type: sp.get('patient_type') || '', mdl: sp.get('mdl') || '', sex: sp.get('sex') || '', fascia: sp.get('fascia') || '' });
  const [f, setF] = useState(init);
  useEffect(() => { const o = {}; for (const [k, v] of Object.entries(f)) if (v && !(k === 'tipo' && v === '12m')) o[k] = v; setSp(o, { replace: true }); }, [f, setSp]);
  const periodo = f.tipo === 'mese' ? f.mese : f.tipo === 'trimestre' ? f.trimestre : f.tipo === 'anno' ? f.anno : '12m';
  const query = { periodo, site_id: f.site_id, patient_type: f.patient_type, mdl: f.mdl, sex: f.sex, fascia: f.fascia };
  const d = useApi(`/profilo-pazienti${qs(query)}`);
  const p = d.data;
  const set = (k, v) => setF({ ...f, [k]: v });
  const [geo, setGeo] = useState(false);
  const geocodifica = async () => {
    setGeo(true);
    try { const r = await api.post(`/profilo-pazienti/geocodifica-comuni${qs(query)}`, {}); toast(`Comuni geocodificati: ${r.trovati} trovati, ${r.non_trovati} non trovati${r.errori ? `, ${r.errori} errori` : ''}${r.restanti ? ` · ne restano ${r.restanti}` : ''}`); d.reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setGeo(false); }
  };
  const anni = Array.from({ length: 4 }, (_, i) => String(Number(anno) - i));
  const trimestri = anni.flatMap((y) => [4, 3, 2, 1].map((t) => `${y}-Q${t}`));
  const vuoto = p && !p.stato.accettazioni_importate;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Profilo dei pazienti (laboratorio)</h1><div className="sub">Età, sesso e provenienza delle accettazioni del laboratorio, per sede e nel tempo: esami più richiesti e orari. Nessun nome, cognome o codice fiscale.</div></div>
        <div className="row">{p && !vuoto && <a className="btn ghost" href={`${apiBase}/profilo-pazienti/export.xlsx${qs(query)}`}>Esporta Excel</a>}</div>
      </div>
      <div className="alert info" style={{ marginBottom: 12 }}>
        <div><b>Dati del laboratorio (Synclab).</b> I centri medici (GIPO/TuoTempo) non sono compresi finché Docplanner non apre le API dei pazienti.
          {p && <span className="small"> · Ultimo checkpoint Synclab delle accettazioni: <b>{p.stato.checkpoint_at ? itDateTime(p.stato.checkpoint_at) : 'nessuno'}</b></span>}</div>
      </div>
      {vuoto && <div className="alert warn" style={{ marginBottom: 12 }}><div>Nessuna accettazione importata dal gestionale. La copia si alimenta da <Link to="/admin/connectors/synclab"><b>Amministrazione &gt; Connettori &gt; StudioLAB &gt; Dati Synclab</b></Link> (primo completo delle accettazioni).</div></div>}

      <div className="filters">
        <Field label="Periodo"><select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="12m">Ultimi 12 mesi</option><option value="mese">Mese</option><option value="trimestre">Trimestre</option><option value="anno">Anno</option></select></Field>
        {f.tipo === 'mese' && <Field label="Mese"><input type="month" value={f.mese} onChange={(e) => set('mese', e.target.value)} /></Field>}
        {f.tipo === 'trimestre' && <Field label="Trimestre"><select value={f.trimestre} onChange={(e) => set('trimestre', e.target.value)}>{trimestri.map((t) => <option key={t} value={t}>{t.slice(-1)}° trimestre {t.slice(0, 4)}</option>)}</select></Field>}
        {f.tipo === 'anno' && <Field label="Anno"><select value={f.anno} onChange={(e) => set('anno', e.target.value)}>{anni.map((y) => <option key={y}>{y}</option>)}</select></Field>}
        <Field label="Sede / punto prelievi"><select value={f.site_id} onChange={(e) => set('site_id', e.target.value)}><option value="">Tutte le sedi</option>{(p?.opzioni.sedi || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="ND">Senza sede abbinata</option></select></Field>
        <Field label="Tipo paziente"><select value={f.patient_type} onChange={(e) => set('patient_type', e.target.value)}><option value="">Tutti</option>{(p?.opzioni.tipi_paziente || []).map((t) => <option key={t.v} value={t.v}>{t.label} ({num(t.n)})</option>)}</select></Field>
        <Field label="Medicina del lavoro"><select value={f.mdl} onChange={(e) => set('mdl', e.target.value)}><option value="">Tutte</option><option value="si">Sì</option><option value="no">No</option></select></Field>
        <Field label="Sesso"><select value={f.sex} onChange={(e) => set('sex', e.target.value)}><option value="">Tutti</option>{Object.entries(SESSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Fascia d'età"><select value={f.fascia} onChange={(e) => set('fascia', e.target.value)}><option value="">Tutte</option>{(p?.opzioni.fasce || []).map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select></Field>
      </div>
      <ErrorBox error={d.error} />
      {d.loading && !p ? <Loading /> : p && <>
        <div className="small muted" style={{ margin: '0 0 10px' }}>Periodo: <b>{p.periodo.etichetta}</b> ({p.periodo.da.split('-').reverse().join('/')} – {p.periodo.a.split('-').reverse().join('/')}), confronto con lo stesso periodo dell'anno prima.</div>
        <Sintesi s={p.sintesi} />
        {!p.sintesi.accettazioni ? <Card><Empty>Nessuna accettazione nel periodo e con i filtri scelti</Empty></Card> : <>
          <Fasce p={p} />
          <Provenienza p={p} siteSel={f.site_id} onSite={(v) => set('site_id', v)} canGeo={canWrite(user)} geocodifica={geocodifica} geo={geo} />
          <Andamento a={p.andamento} />
          <Esami e={p.esami} />
          <Orari o={p.orari} />
        </>}
      </>}
    </div>
  );
}

function Sintesi({ s }) {
  const ap = s.anno_prima;
  return (
    <div className="grid g4" style={{ marginBottom: 16 }}>
      <Kpi accent label="Accettazioni" value={num(s.accettazioni)} foot={<>accettazioni, non persone · anno prima {num(ap?.accettazioni)} (<Var cur={s.accettazioni} prev={ap?.accettazioni} />)</>} />
      <Kpi label="Età mediana" value={s.eta_mediana == null ? '–' : `${d1(s.eta_mediana)} anni`} foot={`anno prima ${ap?.eta_mediana == null ? '–' : `${d1(ap.eta_mediana)} anni`} · età alla data dell'accettazione`} />
      <Kpi label="Donne / uomini" value={`${pct(s.quota_donne, 1)} / ${pct(s.quota_uomini, 1)}`} foot={`${num(s.donne)} donne · ${num(s.uomini)} uomini${s.sesso_altro ? ` · ${num(s.sesso_altro)} altro codice` : ''}${s.sesso_nd ? ` · ${num(s.sesso_nd)} non indicato` : ''}`} />
      <Kpi label="Età non disponibile" value={pct(s.quota_eta_nd, 1)} foot={`${num(s.eta_nd)} accettazioni senza età · pazienti distinti non calcolabili senza identità`} />
    </div>
  );
}

function Fasce({ p }) {
  const data = p.fasce.filter((x) => x.fascia !== 'ND').map((x) => ({ label: x.fascia, F: x.F, M: x.M, AP: x.anno_prima.totale }));
  return (
    <Card title="Fasce d'età e sesso" actions={<span className="small muted">accettazioni per fascia · confronto con l'anno prima</span>}>
      <div className="grid g2">
        <VBars data={data} stacked={false} keys={[{ key: 'F', label: 'Donne', color: C.mauve }, { key: 'M', label: 'Uomini', color: C.teal }, { key: 'AP', label: 'Totale anno prima', color: C.grey }]} height={240} />
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Fascia</th><th className="num">Donne</th><th className="num">Uomini</th><th className="num">Altro / n.i.</th><th className="num">Totale</th><th className="num">Quota</th><th className="num">Anno prima</th><th className="num">Var.</th></tr></thead>
          <tbody>{p.fasce.map((x) => <tr key={x.fascia}><td className="strong">{x.etichetta}</td><td className="num">{num(x.F)}</td><td className="num">{num(x.M)}</td><td className="num">{num(x.ALTRO + x.ND)}</td><td className="num strong">{num(x.totale)}</td><td className="num">{pct(x.quota, 1)}</td><td className="num">{num(x.anno_prima.totale)}</td><td className="num"><Var cur={x.totale} prev={x.anno_prima.totale || null} /></td></tr>)}</tbody>
        </table></div>
      </div>
    </Card>
  );
}

function Provenienza({ p, siteSel, onSite, canGeo, geocodifica, geo }) {
  const pr = p.provenienza;
  const fa = pr.fuori_area;
  const m = p.mappa;
  const provData = pr.province.slice(0, 10).map((x) => ({ label: x.etichetta, n: x.n }));
  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      <div className="grid g4">
        <Kpi label="Quota fuori area" value={pct(fa.quota, 1)} foot={`${num(fa.fuori)} su ${num(fa.valutabili)} valutabili · anno prima ${pct(fa.anno_prima?.quota, 1)}`} />
        <Kpi label="Comuni di provenienza" value={num(pr.comuni.totale_comuni)} foot={`${pr.comuni.non_disponibile ? `${num(pr.comuni.non_disponibile)} accettazioni senza comune` : 'tutte con comune'}`} />
        <Kpi label="Province" value={num(pr.province.filter((x) => x.provincia).length)} foot={`prima: ${pr.province[0]?.etichetta || '–'} (${pct(pr.province[0]?.quota, 1)})`} />
        <Kpi label="Non valutabili per l'area" value={num(fa.non_valutabili)} foot="senza sede abbinata o senza comune / provincia" />
      </div>
      <div className="grid g2">
        <Card title="Provenienza per provincia"><HBars data={provData} keys={[{ key: 'n', label: 'Accettazioni' }]} labelWidth={150} /></Card>
        <Card title="Comuni di provenienza (primi 20)" flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Comune</th><th>Prov.</th><th className="num">Accettazioni</th><th className="num">Quota</th></tr></thead>
            <tbody>{pr.comuni.top.map((c) => <tr key={`${c.comune}|${c.provincia}`}><td className="strong">{c.comune}</td><td>{c.provincia || '–'}</td><td className="num">{num(c.n)}</td><td className="num">{pct(c.quota, 1)}</td></tr>)}
              {pr.comuni.altri && <tr><td className="muted">Altri {num(pr.comuni.altri.comuni)} comuni</td><td /><td className="num">{num(pr.comuni.altri.n)}</td><td className="num">{pct(pr.comuni.altri.quota, 1)}</td></tr>}
              {pr.comuni.non_disponibile > 0 && <tr><td className="muted">Comune non disponibile</td><td /><td className="num">{num(pr.comuni.non_disponibile)}</td><td /></tr>}</tbody>
          </table></div>
        </Card>
      </div>
      <Card title="Mappa dei comuni di provenienza" actions={canGeo && m && m.comuni_senza_coordinate > 0 && <button className="btn sm ghost" disabled={geo} onClick={geocodifica}>{geo ? 'Geocodifica in corso…' : `Geocodifica i comuni mancanti (${m.comuni_senza_coordinate})`}</button>}>
        {!m || !m.comuni.length ? <div className="small muted">Nessun comune con coordinate in cache: la provenienza è nelle tabelle. {canGeo ? 'La geocodifica dei comuni (Google, OpenStreetMap o Open-Meteo, a lotti di 15) si avvia con il pulsante.' : 'La geocodifica la avvia un profilo Retail o Amministratore.'}</div> : <>
          <React.Suspense fallback={<div className="small muted">Caricamento della mappa…</div>}><MappaComuni comuni={m.comuni} sedi={m.sedi} /></React.Suspense>
          <div className="small muted" style={{ marginTop: 6 }}>Bolle proporzionali alle accettazioni (comune di residenza); punti chiari = sedi. {m.comuni_senza_coordinate ? `${num(m.comuni_senza_coordinate)} comuni (${num(m.accettazioni_senza_coordinate)} accettazioni) senza coordinate: solo in tabella.` : 'Tutti i comuni hanno le coordinate.'}</div>
        </>}
      </Card>
      {pr.cap && <Card title="CAP di provenienza della sede scelta" flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>CAP</th><th>Comuni</th><th className="num">Accettazioni</th><th className="num">Quota</th></tr></thead>
          <tbody>{pr.cap.slice(0, 30).map((c) => <tr key={c.cap || 'nd'}><td className="mono">{c.cap || 'non disponibile'}</td><td className="small">{c.comuni || '–'}</td><td className="num">{num(c.n)}</td><td className="num">{pct(c.quota, 1)}</td></tr>)}</tbody></table></div>
      </Card>}
      <Card title="Bacino d'utenza per sede" flush actions={<span className="small muted" title={fa.regola}>da dove arrivano i pazienti di ogni punto prelievi</span>}>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede / punto prelievi</th><th className="num">Accettazioni</th><th className="num">Stesso comune</th><th className="num">Stessa provincia</th><th className="num">Fuori area</th><th className="num">Quota fuori area</th><th className="num">Età mediana</th><th>Comuni principali</th></tr></thead>
          <tbody>{pr.bacino.map((b) => <tr key={b.site_id ?? 'nd'} className={b.site_id ? 'click' : ''} onClick={() => b.site_id && onSite(String(b.site_id) === String(siteSel) ? '' : String(b.site_id))}>
            <td><div className="strong">{b.sede}</div><div className="small muted">{b.sede_comune ? `${b.sede_comune}${b.sede_provincia ? ` (${b.sede_provincia})` : ''}` : b.site_id ? 'comune della sede mancante' : 'client Synclab non abbinato a una sede'}</div></td>
            <td className="num strong">{num(b.n)}</td><td className="num">{num(b.stesso_comune)}</td><td className="num">{num(b.stessa_provincia)}</td><td className="num">{num(b.fuori_area)}</td><td className="num">{pct(b.quota_fuori_area, 1)}</td><td className="num">{d1(b.eta_mediana)}</td>
            <td className="small">{b.comuni.map((c) => `${c.comune} ${pct(c.quota)}`).join(' · ') || '–'}</td></tr>)}</tbody>
        </table></div>
        <div className="small muted" style={{ padding: '8px 12px' }}>{fa.regola}. Clic su una sede per filtrare la pagina (e vedere i CAP).</div>
      </Card>
    </div>
  );
}

function Andamento({ a }) {
  const sedi = a.per_sede.serie.slice(0, 8);
  const altre = a.per_sede.serie.slice(8);
  const datiSede = a.per_sede.righe.map((r) => ({ label: monthLabel(r.mese), ...Object.fromEntries(sedi.map((s) => [s.key, r[s.key]])), ...(altre.length ? { ALTRE: altre.reduce((t, s) => t + (r[s.key] || 0), 0) } : {}) }));
  const keysSede = [...sedi.map((s, i) => ({ key: s.key, label: s.label, color: PALETTE[i % PALETTE.length] })), ...(altre.length ? [{ key: 'ALTRE', label: `Altre ${altre.length} sedi`, color: C.grey }] : [])];
  const datiTipo = a.per_tipo.righe.map((r, i) => ({ day: monthLabel(r.mese), ...Object.fromEntries(a.per_tipo.serie.map((s) => [s.key, r[s.key]])), MDL: a.medicina_lavoro[i]?.n || 0 }));
  return (
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Card title="Andamento mensile per sede"><VBars data={datiSede} keys={keysSede} height={260} /></Card>
      <Card title="Andamento mensile per tipo paziente" actions={<span className="small muted">tipi così come arrivano · medicina del lavoro a parte</span>}>
        <Lines data={datiTipo} keys={[...a.per_tipo.serie.map((s, i) => ({ key: s.key, label: s.label, color: PALETTE[i % PALETTE.length] })), { key: 'MDL', label: 'Medicina del lavoro', color: C.gold }]} height={240} />
        <div className="legend" style={{ marginTop: 6 }}>{[...a.per_tipo.serie.map((s, i) => ({ label: s.label, color: PALETTE[i % PALETTE.length] })), { label: 'Medicina del lavoro', color: C.gold }].map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>
      </Card>
    </div>
  );
}

function Esami({ e }) {
  const [fa, setFa] = useState('');
  const [sx, setSx] = useState('');
  const [sede, setSede] = useState('');
  const lista = fa && sx ? e.per_fascia_sesso[`${fa}|${sx}`] : fa ? e.per_fascia[fa] : sx ? e.per_sesso[sx] : e.top;
  const ps = e.per_sede.find((s) => String(s.site_id ?? 'ND') === sede) || e.per_sede[0];
  const Tab = ({ rows }) => (!rows?.length ? <Empty>Nessun esame</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Codice</th><th>Esame</th><th className="num">Esami</th><th className="num">Accettazioni</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.codice}><td className="muted">{i + 1}</td><td className="mono">{r.codice}</td><td>{r.descrizione || '–'}</td><td className="num strong">{num(r.esami)}</td><td className="num">{num(r.accettazioni)}</td></tr>)}</tbody></table></div>);
  return (
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Card title="Esami più richiesti (primi 15)" flush actions={<div className="row">
        <select value={fa} onChange={(ev) => setFa(ev.target.value)} style={{ minHeight: 30 }}><option value="">Tutte le età</option>{FASCE.map((x) => <option key={x} value={x}>{fasciaLbl(x)}</option>)}</select>
        <select value={sx} onChange={(ev) => setSx(ev.target.value)} style={{ minHeight: 30 }}><option value="">Tutti</option>{Object.entries(SESSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}>
        <Tab rows={lista} />
      </Card>
      <Card title="Esami più richiesti per sede" flush actions={<select value={sede || String(ps?.site_id ?? 'ND')} onChange={(ev) => setSede(ev.target.value)} style={{ minHeight: 30, maxWidth: 240 }}>{e.per_sede.map((s) => <option key={s.site_id ?? 'ND'} value={String(s.site_id ?? 'ND')}>{s.sede}</option>)}</select>}>
        <Tab rows={ps?.esami} />
      </Card>
    </div>
  );
}

function Orari({ o }) {
  const max = Math.max(1, ...o.matrice.map((x) => x.n));
  const ore = o.ore.filter((h) => o.matrice.some((x) => x.ora === h.ora));
  const cella = (dow, ora) => o.matrice.find((x) => x.dow === dow && x.ora === ora)?.n || 0;
  return (
    <Card title="Orari delle accettazioni" className="mt" actions={<span className="small muted">{o.nota}{o.senza_orario ? ` · ${num(o.senza_orario)} senza orario` : ''}</span>}>
      <div className="grid g2">
        <div><div className="small muted">Per giorno della settimana</div><VBars data={o.giorni.map((g) => ({ label: g.giorno.slice(0, 3), n: g.n }))} keys={[{ key: 'n', label: 'Accettazioni' }]} height={200} /></div>
        <div><div className="small muted">Per ora</div><VBars data={o.ore.filter((h) => h.ora >= 6 && h.ora <= 21 || h.n).map((h) => ({ label: String(h.ora).padStart(2, '0'), n: h.n }))} keys={[{ key: 'n', label: 'Accettazioni', color: C.blue }]} height={200} /></div>
      </div>
      {ore.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table className="t heat">
        <thead><tr><th />{ore.map((h) => <th key={h.ora} className="num">{String(h.ora).padStart(2, '0')}</th>)}</tr></thead>
        <tbody>{o.giorni.map((g) => <tr key={g.dow}><td className="strong small">{g.giorno.slice(0, 3)}</td>{ore.map((h) => { const n = cella(g.dow, h.ora); return <td key={h.ora} className="num small" style={{ background: n ? `rgba(28,80,94,${0.08 + 0.72 * (n / max)})` : undefined, color: n / max > 0.55 ? '#fff' : undefined }}>{n || ''}</td>; })}</tr>)}</tbody>
      </table></div>}
    </Card>
  );
}
