import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, Modal, useToast, Kpi, MoneyInput, Icon } from '../components/ui.jsx';
import { PeriodFilter, SiteSelect, KindSelect, LineSelect, defaultPeriod } from '../components/filters.jsx';
import { qs, api, base, apiBase } from '../api.js';
import { eur, eur0, num, itDate, PAYMENT, CHANNEL, SOURCE } from '../format.js';

export default function Sales() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [p, setP] = useState(() => ({ preset: '30', from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }));
  const [f, setF] = useState({ q: '', site_id: '', kind: '', line_id: '', payment_kind: '', channel: '', source: '', campaign_id: sp.get('campaign_id') || '', promotion_id: sp.get('promotion_id') || '', operator: sp.get('operator') || '', offset: 0 });
  const [add, setAdd] = useState(null);
  const list = useApi(`/sales${qs({ ...f, from: p.from, to: p.to, limit: 100 })}`);
  const d = list.data;
  const set = (k, v) => setF({ ...f, [k]: v, offset: 0 });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accettazioni e vendite</h1><div className="sub">Tutte le righe di vendita B2C (GIPO, TuoTempo) e B2B (StudioLab), importate o inserite a mano. Clicca il cliente per aprire la scheda.</div></div>
        <div className="row">
          <a className="btn ghost" href={`${apiBase}/sales/export.xlsx${qs({ ...f, from: p.from, to: p.to })}`}>Esporta Excel</a>
          {canWrite(user) && <Link className="btn ghost" to={`${base}/import`}><Icon name="upload" />Import</Link>}
          {canWrite(user) && <button className="btn" onClick={() => setAdd({ sale_date: new Date().toISOString().slice(0, 10), lines: [{ product_id: '', quantity: 1, gross_amount: '', discount: 0 }] })}>+ Accettazione manuale</button>}
        </div>
      </div>
      <PeriodFilter value={p} onChange={setP}>
        <Field label="Cerca"><input value={f.q} placeholder="Accettazione, cliente, prestazione" onChange={(e) => set('q', e.target.value)} /></Field>
        <SiteSelect value={f.site_id} onChange={(v) => set('site_id', v)} />
        <KindSelect value={f.kind} onChange={(v) => set('kind', v)} />
        <LineSelect value={f.line_id} onChange={(v) => set('line_id', v)} />
        <Field label="Regime"><select value={f.payment_kind} onChange={(e) => set('payment_kind', e.target.value)}><option value="">Tutti</option>{Object.entries(PAYMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Canale"><select value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="">Tutti</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Operatore"><input value={f.operator} placeholder="Chi ha venduto" onChange={(e) => set('operator', e.target.value)} /></Field>
        <Field label="Origine"><select value={f.source} onChange={(e) => set('source', e.target.value)}><option value="">Tutte</option>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </PeriodFilter>
      {d && <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Fatturato netto" value={eur0(d.revenue)} foot={`lordo ${eur0(d.gross)} · sconti ${eur0(d.discount)}`} />
        <Kpi label="Accettazioni" value={num(d.tickets)} foot={`${num(d.n)} righe`} />
        <Kpi label="Scontrino medio" value={eur(d.tickets ? d.revenue / d.tickets : 0)} foot="netto per accettazione" />
        <Kpi label="Sconto medio" value={d.gross ? `${Math.round((d.discount / d.gross) * 100)}%` : '–'} foot="sul lordo di listino" />
      </div>}
      <ErrorBox error={list.error} />
      <Card flush>
        {!d ? <Loading /> : !d.rows.length ? <Empty>Nessuna vendita nel periodo</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data</th><th>Accettazione</th><th>Cliente</th><th>Sede</th><th>Prestazione</th><th className="num">Q.tà</th><th className="num">Lordo</th><th className="num">Sconto</th><th className="num">Netto</th><th>Regime · canale</th><th>Operatore</th>{canWrite(user) && <th />}</tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id}>
                <td>{itDate(r.sale_date)}{r.sale_time ? <div className="small muted">{String(r.sale_time).slice(0, 5)}</div> : null}</td>
                <td className="mono small">{r.external_ref}<div className="muted">{SOURCE[r.source] || r.source}</div></td>
                <td>{r.customer_id ? <a onClick={(e) => { e.preventDefault(); nav(`${base}/clienti/${r.customer_id}`); }} href="#">{r.last_name} {r.first_name}</a> : null}{r.b2b_customer_id ? <div><a onClick={(e) => { e.preventDefault(); nav(`${base}/clienti/${r.b2b_customer_id}`); }} href="#">{r.company_name}</a> <Badge tone="mauve">B2B</Badge></div> : null}</td>
                <td className="small">{r.site_name || '–'}</td>
                <td>{r.product_description || r.product_code}<div className="small muted">{r.product_code}{r.line_name ? ` · ${r.line_name}` : ''}{r.promotion_name ? <span className="chip">{r.promotion_name}</span> : null}{r.campaign_name ? <span className="chip">{r.campaign_name}</span> : null}</div></td>
                <td className="num">{num(r.quantity)}</td><td className="num">{eur(r.gross_amount)}</td><td className="num">{Number(r.discount) ? eur(r.discount) : '–'}</td><td className="num strong">{eur(r.net_amount)}</td>
                <td className="small">{PAYMENT[r.payment_kind] || r.payment_kind || '–'}<div className="muted">{CHANNEL[r.booking_channel] || r.booking_channel || ''}</div></td>
                <td className="small">{r.operator || '–'}</td>
                {canWrite(user) && <td className="num">{r.source === 'MANUALE' && <button className="iconbtn" title="Elimina l'accettazione" onClick={async () => { if (!window.confirm(`Eliminare l'accettazione ${r.external_ref}?`)) return; try { await api.del(`/sales/ref/${r.source}/${r.external_ref}`); toast('Accettazione eliminata'); list.reload(); } catch (e) { toast(e.message, 'err'); } }}><Icon name="trash" /></button>}</td>}
              </tr>))}</tbody>
          </table></div>
        )}
        {d && d.n > d.limit && <div className="row" style={{ padding: 12, justifyContent: 'space-between' }}><span className="small muted">{d.offset + 1}–{Math.min(d.n, d.offset + d.limit)} di {num(d.n)} righe</span><div className="row"><button className="btn sm ghost" disabled={!d.offset} onClick={() => setF({ ...f, offset: Math.max(0, d.offset - d.limit) })}>Precedenti</button><button className="btn sm ghost" disabled={d.offset + d.limit >= d.n} onClick={() => setF({ ...f, offset: d.offset + d.limit })}>Successive</button></div></div>}
      </Card>
      {add && <ManualSale value={add} onChange={setAdd} onClose={() => setAdd(null)} onSaved={() => { setAdd(null); list.reload(); }} />}
    </div>
  );
}

function ManualSale({ value: v, onChange, onClose, onSaved }) {
  const toast = useToast();
  const sites = useApi('/sites');
  const products = useApi('/products?active=all');
  const [q, setQ] = useState('');
  const found = useApi(q.length >= 2 ? `/customers?q=${encodeURIComponent(q)}&limit=8` : null, [q]);
  const s = (k, x) => onChange({ ...v, [k]: x });
  const setLine = (i, k, x) => { const lines = v.lines.map((l, j) => (j === i ? { ...l, [k]: x } : l)); if (k === 'product_id') { const pr = (products.data?.rows || []).find((p) => p.id === Number(x)); if (pr && pr.price != null) lines[i].gross_amount = Number(pr.price); } onChange({ ...v, lines }); };
  const tot = v.lines.reduce((a, l) => a + (Number(l.gross_amount) || 0) * (Number(l.quantity) || 1) - (Number(l.discount) || 0), 0);
  const save = async () => {
    try {
      await api.post('/sales', { sale_date: v.sale_date, sale_time: v.sale_time || null, site_id: Number(v.site_id), customer_id: v.customer?.kind === 'B2C' ? v.customer.id : null, b2b_customer_id: v.customer?.kind === 'B2B' ? v.customer.id : null, payment_kind: v.payment_kind || null, booking_channel: v.booking_channel || null, promo_code: v.promo_code || null, external_ref: v.external_ref || null, operator: v.operator || null,
        lines: v.lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) || 1, gross_amount: Number(l.gross_amount) * (Number(l.quantity) || 1), discount: Number(l.discount) || 0 })) });
      toast('Accettazione registrata'); onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Accettazione manuale" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!v.site_id || !v.customer || !v.lines.some((l) => l.product_id)} onClick={save}>Registra · {eur(tot)}</button></>}>
      <div className="form-grid">
        <Field label="Data *"><input type="date" value={v.sale_date} onChange={(e) => s('sale_date', e.target.value)} /></Field>
        <Field label="Ora"><input type="time" value={v.sale_time || ''} onChange={(e) => s('sale_time', e.target.value)} /></Field>
        <Field label="Sede *"><select value={v.site_id || ''} onChange={(e) => s('site_id', e.target.value)}><option value="">–</option>{(sites.data || []).filter((x) => x.kind !== 'HEADQUARTER').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Numero accettazione" help="Vuoto = generato"><input value={v.external_ref || ''} onChange={(e) => s('external_ref', e.target.value)} /></Field>
        <Field label="Cliente *" className="span2" help="Cerca per cognome, codice fiscale o ragione sociale">{v.customer ? <div className="row"><Badge tone="teal">{v.customer.kind === 'B2B' ? v.customer.company_name : `${v.customer.last_name} ${v.customer.first_name}`}</Badge><button className="btn sm link" onClick={() => s('customer', null)}>cambia</button></div> : <><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digita almeno 2 caratteri" />{found.data?.rows?.length ? <div className="card" style={{ marginTop: 4 }}><table className="t"><tbody>{found.data.rows.map((c) => <tr key={c.id} className="click" onClick={() => { s('customer', c); setQ(''); }}><td>{c.kind === 'B2B' ? c.company_name : `${c.last_name} ${c.first_name}`}<span className="small muted"> · {c.city || ''} {c.tax_code || c.vat_number || ''}</span></td></tr>)}</tbody></table></div> : null}</>}</Field>
        <Field label="Regime"><select value={v.payment_kind || ''} onChange={(e) => s('payment_kind', e.target.value)}><option value="">–</option>{Object.entries(PAYMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Canale"><select value={v.booking_channel || ''} onChange={(e) => s('booking_channel', e.target.value)}><option value="">–</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Codice promo"><input value={v.promo_code || ''} onChange={(e) => s('promo_code', e.target.value.toUpperCase())} /></Field>
        <Field label="Operatore" help="Vuoto = tu"><input value={v.operator || ''} onChange={(e) => s('operator', e.target.value)} /></Field>
      </div>
      <div className="subhead">Prestazioni</div>
      <table className="t"><thead><tr><th>Prestazione</th><th className="num">Q.tà</th><th className="num">Prezzo unitario</th><th className="num">Sconto riga</th><th /></tr></thead>
        <tbody>{v.lines.map((l, i) => <tr key={i}>
          <td><select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)}><option value="">–</option>{(products.data?.rows || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}</select></td>
          <td><input type="number" min="1" value={l.quantity} style={{ width: 70 }} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
          <td><MoneyInput value={l.gross_amount} onChange={(x) => setLine(i, 'gross_amount', x)} style={{ width: 110 }} /></td>
          <td><MoneyInput value={l.discount} onChange={(x) => setLine(i, 'discount', x)} style={{ width: 100 }} /></td>
          <td><button className="iconbtn" onClick={() => onChange({ ...v, lines: v.lines.filter((_, j) => j !== i) })}><Icon name="trash" /></button></td>
        </tr>)}</tbody></table>
      <div style={{ marginTop: 8 }}><button className="btn sm ghost" onClick={() => onChange({ ...v, lines: [...v.lines, { product_id: '', quantity: 1, gross_amount: '', discount: 0 }] })}>+ Riga</button></div>
    </Modal>
  );
}
