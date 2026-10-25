import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, Modal, useToast, Kpi, Delta, MoneyInput } from '../components/ui.jsx';
import { Donut, HBars, VBars, C } from '../components/charts.jsx';
import { PeriodFilter, SiteSelect, KindSelect, LineSelect, defaultPeriod } from '../components/filters.jsx';
import { qs, api, apiBase } from '../api.js';
import { eur, eur0, num, pct, delta, monthLabel, SEX, AGE_BUCKET } from '../format.js';

export default function Products() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [p, setP] = useState(() => ({ preset: '12m', from: new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }));
  const [f, setF] = useState({ q: '', line_id: '', site_id: '', kind: '', active: '', sector: '', sold: '' });
  const [sort, setSort] = useState({ key: 'revenue', dir: -1 });
  const [open, setOpen] = useState(sp.get('open') ? Number(sp.get('open')) : null);
  const [edit, setEdit] = useState(null);
  const list = useApi(`/products${qs({ ...f, from: p.from, to: p.to })}`);
  const lines = useApi('/product-lines');
  useEffect(() => { if (sp.get('open')) { setOpen(Number(sp.get('open'))); setSp({}, { replace: true }); } }, [sp, setSp]);
  const rows = useMemo(() => { const r = [...(list.data?.rows || [])]; r.sort((a, b) => { const x = a[sort.key] ?? ''; const y = b[sort.key] ?? ''; return (typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir; }); return r; }, [list.data, sort]);
  const th = (key, label, cls = '') => <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;
  const tot = rows.reduce((a, x) => ({ revenue: a.revenue + Number(x.revenue), qty: a.qty + Number(x.qty), prev: a.prev + Number(x.revenue_prev), margin: a.margin + Number(x.margin || 0), costed: a.costed + (x.margin != null ? Number(x.revenue) : 0) }), { revenue: 0, qty: 0, prev: 0, margin: 0, costed: 0 });
  const sold = rows.filter((x) => x.qty > 0);
  const save = async () => {
    try {
      const b = { ...edit }; delete b.id; for (const k of ['price', 'price_ssn', 'cost', 'price_mdl', 'price_service']) b[k] = b[k] === '' || b[k] == null ? null : Number(b[k]); for (const k of ['duration_min', 'periodicity_months']) b[k] = b[k] === '' || b[k] == null ? null : Number(b[k]); b.line_id = b.line_id ? Number(b.line_id) : null;
      for (const k of Object.keys(b)) if (!['code', 'description', 'line_id', 'specialty', 'nomenclature', 'price', 'price_ssn', 'cost', 'duration_min', 'is_package', 'periodicity_months', 'active', 'sector', 'destination', 'price_mdl', 'price_service', 'exclude_from_counts'].includes(k)) delete b[k];
      if (edit.id) await api.put(`/products/${edit.id}`, b); else await api.post('/products', b);
      toast('Prestazione salvata'); setEdit(null); list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Prestazioni e prodotti</h1><div className="sub">Cosa funziona di più e cosa di meno: quantità, fatturato, clienti e confronto con il periodo precedente. Clicca una riga per il dettaglio (andamento, sedi, profilo di chi la compra, cosa si abbina).</div></div>
        <div className="row"><a className="btn ghost" href={`${apiBase}/products/export.xlsx${qs({ from: p.from, to: p.to })}`}>Esporta Excel</a>{canWrite(user) && <button className="btn" onClick={() => setEdit({ active: true, is_package: false })}>+ Nuova prestazione</button>}</div>
      </div>
      <PeriodFilter value={p} onChange={setP}>
        <Field label="Cerca"><input value={f.q} placeholder="Codice, descrizione, specialità" onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <LineSelect value={f.line_id} onChange={(v) => setF({ ...f, line_id: v })} />
        <SiteSelect value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} />
        <KindSelect value={f.kind} onChange={(v) => setF({ ...f, kind: v })} />
        <Field label="Settore"><select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })}><option value="">Tutti</option>{(list.data?.sectors || []).map((x) => <option key={x.label} value={x.label}>{x.label} ({x.n})</option>)}</select></Field>
        <Field label="Catalogo"><select value={f.active + (f.sold ? ':sold' : '')} onChange={(e) => { const [a, s] = e.target.value.split(':'); setF({ ...f, active: a, sold: s ? '1' : '' }); }}><option value="">Solo attive</option><option value=":sold">Solo vendute nel periodo</option><option value="all">Anche disattivate</option></select></Field>
      </PeriodFilter>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Fatturato nel periodo" value={eur0(tot.revenue)} foot={<span><Delta value={delta(tot.revenue, tot.prev)} /> vs periodo precedente</span>} />
        <Kpi label="Prestazioni erogate" value={num(tot.qty)} foot={`${num(sold.length)} codici venduti su ${num(rows.length)} in catalogo`} />
        <Kpi label="Margine sul costo diretto" value={tot.costed ? eur0(tot.margin) : '–'} foot={tot.costed ? `${pct((tot.margin / tot.costed) * 100, 1)} sulle prestazioni con costo (${pct((tot.costed / (tot.revenue || 1)) * 100, 0)} del fatturato)` : 'carica la distinta base per calcolarlo'} />
        <Kpi label="Prezzo medio realizzato" value={eur(tot.qty ? tot.revenue / tot.qty : 0)} foot={`netto per prestazione · ${num(rows.length - sold.length)} codici mai venduti nel periodo`} />
      </div>
      <ErrorBox error={list.error} />
      <Card flush>
        {!list.data ? <Loading /> : !rows.length ? <Empty>Nessuna prestazione</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr>{th('description', 'Prestazione')}{th('line_name', 'Linea')}{th('price', 'Listino', 'num')}{th('qty', 'Q.tà', 'num')}{th('revenue', 'Fatturato', 'num')}{th('revenue_prev', 'Δ periodo prec.', 'num')}{th('customers', 'Clienti', 'num')}{th('cost', 'Costo unit.', 'num')}{th('margin', 'Margine', 'num')}{th('margin_pct', '%', 'num')}</tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id} className="click" onClick={() => setOpen(x.id)}>
                <td><div className="strong">{x.description}{!x.active && <Badge tone="red">disattivata</Badge>}{x.is_package && <Badge tone="mauve">pacchetto</Badge>}</div><div className="small muted">{x.code}{x.sector ? ` · ${x.sector}` : ''}{x.specialty && x.specialty !== x.sector ? ` · ${x.specialty}` : ''}{x.destination ? ` · ${x.destination}` : ''}{x.periodicity_months ? ` · richiamo ${x.periodicity_months} mesi` : ''}{x.exclude_from_counts ? ' · escluso dai conteggi' : ''}</div></td>
                <td><span className="pill" style={{ background: `${x.line_color || '#1C505E'}22`, color: x.line_color || 'var(--teal)' }}>{x.line_name || '–'}</span></td>
                <td className="num">{eur(x.price)}</td><td className="num">{num(x.qty)}</td><td className="num strong">{eur0(x.revenue)}</td><td className="num"><Delta value={delta(x.revenue, x.revenue_prev)} /></td><td className="num">{num(x.customers)}</td>
                <td className="num small">{x.cost != null ? eur(x.cost) : <span className="muted">–</span>}</td><td className="num">{x.margin != null ? <span className={Number(x.margin) < 0 ? 'red' : ''}>{eur0(x.margin)}</span> : <span className="muted">–</span>}</td><td className="num small">{x.margin_pct != null ? <span className={Number(x.margin_pct) < 20 ? 'red' : 'muted'}>{pct(x.margin_pct, 0)}</span> : '–'}</td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={3}>Totale</td><td className="num">{num(tot.qty)}</td><td className="num">{eur0(tot.revenue)}</td><td className="num"><Delta value={delta(tot.revenue, tot.prev)} /></td><td colSpan={2} /><td className="num">{tot.costed ? eur0(tot.margin) : '–'}</td><td className="num small">{tot.costed ? pct((tot.margin / tot.costed) * 100, 0) : '–'}</td></tr></tfoot>
          </table></div>
        )}
      </Card>
      {open && <ProductDetail id={open} onClose={() => setOpen(null)} onEdit={canWrite(user) ? (x) => { setOpen(null); setEdit(x); } : null} />}
      {edit && <Modal title={edit.id ? 'Modifica prestazione' : 'Nuova prestazione'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Codice *"><input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} className="mono" /></Field>
          <Field label="Linea"><select value={edit.line_id || ''} onChange={(e) => setEdit({ ...edit, line_id: e.target.value })}><option value="">–</option>{(lines.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Descrizione *" className="span2"><input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="Settore (StudioLab)"><input value={edit.sector || ''} onChange={(e) => setEdit({ ...edit, sector: e.target.value })} /></Field>
          <Field label="Specialità / settore clinico"><input value={edit.specialty || ''} onChange={(e) => setEdit({ ...edit, specialty: e.target.value })} /></Field>
          <Field label="Destinazione (strumento / service)"><input value={edit.destination || ''} onChange={(e) => setEdit({ ...edit, destination: e.target.value })} /></Field>
          <Field label="Prezzo medicina del lavoro"><MoneyInput value={edit.price_mdl ?? ''} onChange={(x) => setEdit({ ...edit, price_mdl: x })} /></Field>
          <Field label="Prezzo service"><MoneyInput value={edit.price_service ?? ''} onChange={(x) => setEdit({ ...edit, price_service: x })} /></Field>
          <Field label="Codice nomenclatore"><input value={edit.nomenclature || ''} onChange={(e) => setEdit({ ...edit, nomenclature: e.target.value })} /></Field>
          <Field label="Prezzo listino privato"><MoneyInput value={edit.price ?? ''} onChange={(x) => setEdit({ ...edit, price: x })} /></Field>
          <Field label="Tariffa SSN"><MoneyInput value={edit.price_ssn ?? ''} onChange={(x) => setEdit({ ...edit, price_ssn: x })} /></Field>
          <Field label="Costo diretto per esame" help={edit.cost_source ? `fonte: ${edit.cost_source === 'DISTINTA' ? 'distinta base' : 'manuale'}` : 'dalla distinta base o manuale'}><MoneyInput value={edit.cost ?? ''} onChange={(x) => setEdit({ ...edit, cost: x })} /></Field>
          <Field label="Durata (minuti)"><input type="number" value={edit.duration_min ?? ''} onChange={(e) => setEdit({ ...edit, duration_min: e.target.value })} /></Field>
          <Field label="Periodicità richiamo (mesi)" help="Vuoto = nessun richiamo"><input type="number" value={edit.periodicity_months ?? ''} onChange={(e) => setEdit({ ...edit, periodicity_months: e.target.value })} /></Field>
          <Field label="Pacchetto" className="inline"><input type="checkbox" checked={Boolean(edit.is_package)} onChange={(e) => setEdit({ ...edit, is_package: e.target.checked })} /> è un pacchetto / check-up</Field>
          <Field label="Conteggi" className="inline"><input type="checkbox" checked={Boolean(edit.exclude_from_counts)} onChange={(e) => setEdit({ ...edit, exclude_from_counts: e.target.checked })} /> voce tecnica, esclusa dal conteggio esami (es. IND)</Field>
          <Field label="Attiva" className="inline"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> presente nel catalogo</Field>
        </div>
      </Modal>}
    </div>
  );
}

function ProductDetail({ id, onClose, onEdit }) {
  const d = useApi(`/products/${id}`);
  const x = d.data;
  return (
    <Modal title={x ? `${x.description}` : 'Prestazione'} onClose={onClose} wide footer={<>{onEdit && x && <button className="btn ghost" onClick={() => onEdit(x)}>Modifica scheda</button>}<button className="btn" onClick={onClose}>Chiudi</button></>}>
      {!x ? <Loading /> : <>
        <div className="small muted" style={{ marginBottom: 12 }}>{x.code} · {x.line_name || '–'}{x.specialty ? ` · ${x.specialty}` : ''} · listino {eur(x.price)}{x.price_service != null ? ` · service ${eur(x.price_service)}` : ''}{x.price_mdl != null ? ` · MDL ${eur(x.price_mdl)}` : ''}{x.cost != null ? ` · costo ${eur(x.cost)}` : ''}{x.destination ? ` · ${x.destination}` : ''}{x.duration_min ? ` · ${x.duration_min} min` : ''}{x.periodicity_months ? ` · richiamo ogni ${x.periodicity_months} mesi` : ''}</div>
        <div className="two">
          <Card title="Ultimi 12 mesi"><VBars data={x.trend.map((t) => ({ label: monthLabel(t.month), value: Number(t.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.teal }]} height={180} /></Card>
          <Card title="Per sede">{x.by_site.length ? <HBars data={x.by_site.map((s) => ({ label: s.label, value: Number(s.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.blue }]} labelWidth={170} height={Math.max(120, x.by_site.length * 26 + 20)} /> : <Empty>Nessuna vendita</Empty>}</Card>
        </div>
        <div className="two" style={{ marginTop: 16 }}>
          <Card title="Chi la compra">
            <div className="row"><div style={{ flex: 1 }}><Donut size={140} data={x.by_sex.map((s) => ({ name: SEX[s.label] || 'n.d.', value: Number(s.count), color: s.label === 'F' ? C.teal : s.label === 'M' ? C.blue : C.grey }))} /></div><div style={{ flex: 1.4 }}><VBars data={x.by_age.map((a) => ({ label: a.bucket === 'n.d.' ? 'n.d.' : AGE_BUCKET[Number(a.bucket)] || a.bucket, value: Number(a.count) }))} keys={[{ key: 'value', label: 'Pazienti', color: C.teal }]} height={140} /></div></div>
          </Card>
          <Card title="Clienti B2B e prezzo medio applicato" flush>{x.by_b2b?.length ? <table className="t"><tbody>{x.by_b2b.map((b) => <tr key={b.label}><td>{b.label}</td><td className="num small">{num(b.qty)}</td><td className="num">{eur(b.avg_price)}{x.cost != null && <span className={`small ${Number(b.avg_price) - Number(x.cost) < 0 ? 'red' : 'muted'}`}> · margine {eur(Number(b.avg_price) - Number(x.cost))}</span>}</td></tr>)}</tbody></table> : <Empty>Nessuna vendita B2B</Empty>}</Card>
        </div>
        <div className="two" style={{ marginTop: 16 }}>
          <Card title="Cosa si abbina nella stessa accettazione" flush>{x.basket.length ? <table className="t"><tbody>{x.basket.map((b) => <tr key={b.id}><td>{b.description}<div className="small muted">{b.code}</div></td><td className="num">{num(b.n)} volte</td></tr>)}</tbody></table> : <Empty>Nessun abbinamento</Empty>}</Card>
        </div>
      </>}
    </Modal>
  );
}
