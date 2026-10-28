import React, { useEffect, useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useAuth, seesCosts } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, MoneyInput, Loading, Empty } from '../components/ui.jsx';
import { eur, itDate, LEVELS, LEVEL_LABEL, CONTRACT } from '../format.js';

const Line = ({ k, v, big }) => <div className={big ? 'big' : 'line'}><span>{k}</span><span className={big ? 'v' : ''}>{v}</span></div>;

export default function Payroll() {
  const { user } = useAuth();
  const costs = seesCosts(user);
  const [f, setF] = useState({ ral: 30000, level: '2', monthly_payments: 14, contract_type: 'TIND', mbo_pct: '', weekly_hours: 40, at_date: '' });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const people = useApi(costs ? '/resources?kind=DIPENDENTE' : null);
  useEffect(() => {
    const t = setTimeout(() => api.post('/ccnl/simulate', { ral: f.ral ? Number(f.ral) : null, level: f.level || null, monthly_payments: Number(f.monthly_payments), contract_type: f.contract_type, mbo_pct: f.mbo_pct === '' ? null : Number(f.mbo_pct), weekly_hours: Number(f.weekly_hours), at_date: f.at_date || null }).then((r) => { setRes(r); setErr(null); }).catch(setErr), 250);
    return () => clearTimeout(t);
  }, [f]);
  const pick = (id) => { const p = (people.data || []).find((x) => String(x.id) === id); if (p) setF({ ...f, ral: p.ral_current || p.ral, level: p.level || '', monthly_payments: p.monthly_payments || 14, contract_type: p.contract_type || 'TIND', mbo_pct: p.mbo_enabled ? p.mbo_pct : '', weekly_hours: p.weekly_hours || 40 }); };
  const dec = res?.decomposition;
  const [exporting, setExporting] = useState('');
  // Estratto DOCX o PDF della simulazione corrente (stessi parametri del calcolo a video)
  const exportDoc = async (format) => {
    setExporting(format);
    try {
      const body = { ral: f.ral ? Number(f.ral) : null, level: f.level || null, monthly_payments: Number(f.monthly_payments), contract_type: f.contract_type, mbo_pct: f.mbo_pct === '' ? null : Number(f.mbo_pct), weekly_hours: Number(f.weekly_hours), at_date: f.at_date || null };
      const r = await fetch(`${API_BASE}/ccnl/simulate/export?format=${format}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'td-suite' }, body: JSON.stringify(body) });
      if (!r.ok) { let msg = `Errore ${r.status}`; try { msg = (await r.json()).error || msg; } catch {} throw new Error(msg); }
      const cd = r.headers.get('content-disposition') || ''; const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = m ? decodeURIComponent(m[1]) : `simulazione.${format}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e); }
    setExporting('');
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Simulatore busta paga</h1><div className="sub">Replica l'Elaboratore Buste Paga: dalla RAL e dal livello ricava paga base (minimo tabellare), indennità di funzione (70% dell'eccedenza) e superminimo. Aggiunge la stima del costo azienda e del netto.</div></div>
        <div className="row tight">
          <button className="btn ghost" disabled={!res || Boolean(exporting)} onClick={() => exportDoc('docx')}>{exporting === 'docx' ? 'Preparo…' : 'Estratto DOCX'}</button>
          <button className="btn" disabled={!res || Boolean(exporting)} onClick={() => exportDoc('pdf')}>{exporting === 'pdf' ? 'Preparo…' : 'Estratto PDF'}</button>
        </div></div>
      <div className="grid g3" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
        <Card title="Parametri">
          <div className="form-grid">
            {costs && <Field label="Parti da un dipendente" className="span2"><select onChange={(e) => pick(e.target.value)} defaultValue=""><option value="">–</option>{(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name} · {p.job_title}</option>)}</select></Field>}
            <Field label="RAL (lordo annuo)" help="Vuoto = RAL minima del livello"><MoneyInput value={f.ral ?? ''} onChange={(x) => setF({ ...f, ral: x })} /></Field>
            <Field label="Livello CCNL"><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">–</option>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field>
            <Field label="Mensilità"><select value={f.monthly_payments} onChange={(e) => setF({ ...f, monthly_payments: Number(e.target.value) })}><option value={14}>14</option><option value={13}>13</option><option value={12}>12</option></select></Field>
            <Field label="Contratto"><select value={f.contract_type} onChange={(e) => setF({ ...f, contract_type: e.target.value })}>{Object.entries(CONTRACT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Ore settimanali"><input type="number" value={f.weekly_hours} onChange={(e) => setF({ ...f, weekly_hours: Number(e.target.value) })} /></Field>
            <Field label="MBO (% RAL)"><input type="number" step="0.5" value={f.mbo_pct} onChange={(e) => setF({ ...f, mbo_pct: e.target.value })} /></Field>
            <Field label="Minimi vigenti alla data"><input type="date" value={f.at_date} onChange={(e) => setF({ ...f, at_date: e.target.value })} /></Field>
          </div>
          <ErrorBox error={err} />
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!res ? <Loading /> : <>
            <Card title="Scomposizione mensile (Elaboratore Buste Paga)">
              <div className="totals">
                <Line k={`Minimo tabellare livello ${f.level || '–'}${res.minimum ? ` (dal ${itDate(res.minimum.valid_from)})` : ''}`} v={res.minimum ? eur(res.minimum.amount) : '–'} />
                <Line k="RAL" v={eur(dec.ral)} />
                <Line k={`RAL mensile (÷ ${dec.monthly})`} v={eur(dec.ral_monthly)} big />
                <Line k="Paga base" v={eur(dec.base_pay)} />
                <Line k="Indennità di funzione (70% eccedenza)" v={eur(dec.function_allowance)} />
                <Line k="Superminimo" v={eur(dec.superminimo)} />
                {res.minimum?.enac ? <Line k="ENAC (indicativo)" v={eur(res.minimum.enac)} /> : null}
              </div>
            </Card>
            {costs && (
              <Card title="Costo azienda (stima)">
                <div className="totals">
                  <Line k={`Coefficiente (INPS ${res.assumptions.cost_inps_pct}% + INAIL ${res.assumptions.cost_inail_pct}% + TFR ${res.assumptions.cost_tfr_pct}%)`} v={res.cost.coefficient} />
                  <Line k="Costo annuo" v={eur(res.cost.annual)} big />
                  <Line k="Costo mensile (÷ 12)" v={eur(res.cost.monthly)} />
                  {res.cost.mbo_max ? <Line k="MBO massimo (costo azienda)" v={eur(res.cost.mbo_max)} /> : null}
                  {res.cost.mbo_max ? <Line k="Costo annuo con MBO al 100%" v={eur(res.cost.annual_with_mbo)} /> : null}
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>Aliquote impostabili in Impostazioni; da verificare con il consulente del lavoro per il profilo contributivo effettivo (apprendisti, dirigenti, sgravi).</p>
              </Card>
            )}
            <Card title="Netto stimato per il dipendente">
              <div className="totals">
                <Line k={`Contributi INPS a carico (${res.assumptions.employee_inps_pct}%)`} v={`- ${eur(res.net.inps)}`} />
                <Line k="Imponibile IRPEF" v={eur(res.net.taxable)} />
                <Line k="IRPEF lorda" v={`- ${eur(res.net.irpef_gross)}`} />
                <Line k="Detrazioni lavoro dipendente" v={`+ ${eur(res.net.detractions)}`} />
                <Line k="Addizionali regionale e comunale" v={`- ${eur(res.net.add_regional + res.net.add_municipal)}`} />
                {res.net.bonus ? <Line k="Trattamento integrativo" v={`+ ${eur(res.net.bonus)}`} /> : null}
                <Line k="Netto annuo" v={eur(res.net.net_annual)} big />
                <Line k={`Netto medio mensile (÷ ${dec.monthly})`} v={eur(res.net.net_monthly)} />
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>{res.net.note}</p>
            </Card>
          </>}
        </div>
      </div>
    </div>
  );
}
