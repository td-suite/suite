import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, ToneBadge, Kpi, useToast, ConfirmModal, Progress, Icon, MoneyInput } from '../components/ui.jsx';
import { Lines, HBars, C } from '../components/charts.jsx';
import { api, base } from '../api.js';
import { eur, eur0, num, itDate, delta, MONTHS, PROMO_STATUS, DISCOUNT, MATERIAL_STATUS, EXPO_STATUS } from '../format.js';
import { Delta } from '../components/ui.jsx';

const PUSH_CHANNELS = ['INSTORE', 'ACCETTAZIONE', 'SMS', 'EMAIL', 'META', 'GOOGLE', 'MMG', 'B2B', 'SITO', 'STAMPA', 'RADIO', 'EVENTO', 'MISURA'];

export default function PromotionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/promotions/${id}`);
  const sites = useApi('/sites');
  const products = useApi('/products?active=all');
  const [v, setV] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [claims, setClaims] = useState(null);
  const [del, setDel] = useState(false);
  useEffect(() => { if (d.data) { setV({ ...d.data, kpi_target: d.data.kpi_target || {} }); setDirty(false); } }, [d.data]);
  const p = d.data;
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!p || !v) return <div className="page"><Loading /></div>;
  const writer = canWrite(user);
  const s = (k, x) => { setV({ ...v, [k]: x }); setDirty(true); };
  const save = async (patch) => {
    const body = patch || { name: v.name, theme: v.theme, claim: v.claim, claim_short: v.claim_short, body: v.body, target: v.target, channel_scope: v.channel_scope, discount_type: v.discount_type || null, discount_value: v.discount_value === '' || v.discount_value == null ? null : Number(v.discount_value), bundle_price: v.bundle_price === '' || v.bundle_price == null ? null : Number(v.bundle_price), start_date: v.start_date, end_date: v.end_date, product_ids: v.product_ids || [], site_ids: v.site_ids || [], push_plan: v.push_plan || [], materials: v.materials || [], kpi_target: { bookings: n(v.kpi_target?.bookings), revenue: n(v.kpi_target?.revenue), new_customers: n(v.kpi_target?.new_customers) }, status: v.status, promo_code: v.promo_code, notes: v.notes };
    try { await api.put(`/promotions/${id}`, body); toast('Promozione salvata'); d.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const n = (x) => (x === '' || x == null ? null : Number(x));
  const genClaims = async () => { try { setClaims({ loading: true }); setClaims(await api.post(`/promotions/${id}/claims`)); } catch (e) { setClaims(null); toast(e.message, 'err'); } };
  const togglePlan = async (i) => { const plan = v.push_plan.map((a, j) => (j === i ? { ...a, done: !a.done } : a)); setV({ ...v, push_plan: plan }); await save({ push_plan: plan }); };
  const setMaterial = async (i, status) => { const m = v.materials.map((a, j) => (j === i ? { ...a, status } : a)); setV({ ...v, materials: m }); await save({ materials: m }); };
  const target = v.kpi_target || {};
  const prodMap = Object.fromEntries((products.data?.rows || []).map((x) => [x.id, x]));
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="row" style={{ gap: 8 }}><h1>{MONTHS[p.month - 1]} {p.year} · {p.name}</h1><ToneBadge map={PROMO_STATUS} value={p.status} /></div><div className="sub">{p.discount_label} · {itDate(p.start_date)} – {itDate(p.end_date)} · codice <span className="mono">{p.promo_code}</span>{p.target ? ` · target: ${p.target}` : ''} · {p.channel_scope}</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(`${base}/promozioni`)}>Calendario</button>{writer && <button className="btn" disabled={!dirty} onClick={() => save()}>Salva modifiche</button>}{writer && <button className="btn danger" onClick={() => setDel(true)}>Elimina</button>}</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        <div className="claimbox">
          <div className="small" style={{ color: 'var(--blue)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Claim</div>
          <div className="big">{v.claim || <span style={{ opacity: .6 }}>Scrivi il claim o genera proposte</span>}</div>
          <div className="sub">{v.body || ''}</div>
          {v.claim_short && <div className="silk small" style={{ marginTop: 8 }}>Versione breve: {v.claim_short}</div>}
        </div>
        <div className="grid g3">
          {[['Prenotazioni', p.tickets, target.bookings, false], ['Fatturato', p.revenue, target.revenue, true], ['Nuovi pazienti', p.new_customers, target.new_customers, false]].map(([l, val, t, m]) => (
            <div key={l} className="card kpi sm"><div className="lbl">{l}</div><div className="val">{m ? eur0(val) : num(val)}</div><div className="foot">{t ? `obiettivo ${m ? eur0(t) : num(t)}` : 'nessun obiettivo'}</div>{t ? <Progress value={val} max={t} /> : null}</div>
          ))}
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Impostazione" actions={writer && <button className="btn sm ghost" onClick={genClaims}><Icon name="refresh" />Proposte di claim</button>}>
          <div className="form-grid">
            <Field label="Nome"><input value={v.name || ''} disabled={!writer} onChange={(e) => s('name', e.target.value)} /></Field>
            <Field label="Stato"><select value={v.status} disabled={!writer} onChange={(e) => s('status', e.target.value)}>{Object.entries(PROMO_STATUS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></Field>
            <Field label="Tema" className="span2"><input value={v.theme || ''} disabled={!writer} onChange={(e) => s('theme', e.target.value)} /></Field>
            <Field label="Claim" className="span2"><input value={v.claim || ''} disabled={!writer} maxLength={120} onChange={(e) => s('claim', e.target.value)} /></Field>
            <Field label="Claim breve (social, cavaliere)"><input value={v.claim_short || ''} disabled={!writer} maxLength={40} onChange={(e) => s('claim_short', e.target.value)} /></Field>
            <Field label="Target"><input value={v.target || ''} disabled={!writer} onChange={(e) => s('target', e.target.value)} /></Field>
            <Field label="Testo esteso" className="span2"><textarea value={v.body || ''} disabled={!writer} onChange={(e) => s('body', e.target.value)} /></Field>
            <Field label="Meccanica"><select value={v.discount_type || ''} disabled={!writer} onChange={(e) => s('discount_type', e.target.value)}><option value="">–</option>{Object.entries(DISCOUNT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Valore (% o €)"><input type="number" step="0.5" value={v.discount_value ?? ''} disabled={!writer} onChange={(e) => s('discount_value', e.target.value)} /></Field>
            <Field label="Prezzo pacchetto"><MoneyInput value={v.bundle_price ?? ''} disabled={!writer} onChange={(x) => s('bundle_price', x)} /></Field>
            <Field label="Canale"><select value={v.channel_scope} disabled={!writer} onChange={(e) => s('channel_scope', e.target.value)}><option value="B2C">B2C</option><option value="B2B">B2B</option><option value="ENTRAMBI">Entrambi</option></select></Field>
            <Field label="Dal"><input type="date" value={v.start_date || ''} disabled={!writer} onChange={(e) => s('start_date', e.target.value)} /></Field>
            <Field label="Al"><input type="date" value={v.end_date || ''} disabled={!writer} onChange={(e) => s('end_date', e.target.value)} /></Field>
            <Field label="Codice promo" help="Da inserire in accettazione per tracciare le vendite"><input value={v.promo_code || ''} disabled={!writer} className="mono" onChange={(e) => s('promo_code', e.target.value.toUpperCase())} /></Field>
            <Field label="Obiettivo prenotazioni"><input type="number" value={target.bookings ?? ''} disabled={!writer} onChange={(e) => s('kpi_target', { ...target, bookings: e.target.value })} /></Field>
            <Field label="Obiettivo fatturato"><MoneyInput value={target.revenue ?? ''} disabled={!writer} onChange={(x) => s('kpi_target', { ...target, revenue: x })} /></Field>
            <Field label="Obiettivo nuovi pazienti"><input type="number" value={target.new_customers ?? ''} disabled={!writer} onChange={(e) => s('kpi_target', { ...target, new_customers: e.target.value })} /></Field>
            <Field label="Note" className="span2"><textarea value={v.notes || ''} disabled={!writer} onChange={(e) => s('notes', e.target.value)} /></Field>
          </div>
          {claims && <div style={{ marginTop: 12 }}>
            <div className="subhead">Proposte {claims.source === 'claude' ? '(API Claude)' : claims.loading ? '' : '(schemi standard: con ANTHROPIC_API_KEY arrivano proposte su misura)'}</div>
            {claims.loading ? <Loading text="Generazione…" /> : <table className="t"><tbody>{claims.claims.map((c, i) => <tr key={i}><td><div className="strong">{c.claim}</div><div className="small muted">{c.claim_short} · SMS: {c.sms}</div></td><td className="num"><button className="btn sm ghost" onClick={() => { setV({ ...v, claim: c.claim, claim_short: c.claim_short }); setDirty(true); }}>Usa</button></td></tr>)}</tbody></table>}
          </div>}
        </Card>
        <div>
          <Card title="Prestazioni in promozione" actions={<span className="small muted">{(v.product_ids || []).length} selezionate</span>}>
            {writer && <select multiple size={7} value={(v.product_ids || []).map(String)} onChange={(e) => s('product_ids', [...e.target.selectedOptions].map((o) => Number(o.value)))} style={{ height: 'auto' }}>{(products.data?.rows || []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.description} · {eur(x.price)}</option>)}</select>}
            <div className="row" style={{ marginTop: 8 }}>{(v.product_ids || []).map((pid) => prodMap[pid] ? <span key={pid} className="chip">{prodMap[pid].description}</span> : null)}</div>
            {p.prev_year?.revenue > 0 && <p className="small muted" style={{ marginTop: 8 }}>Stesso mese dell'anno scorso sulle stesse prestazioni: {eur0(p.prev_year.revenue)} ({num(p.prev_year.tickets)} accettazioni) · <Delta value={delta(p.revenue, p.prev_year.revenue)} /></p>}
          </Card>
          <Card title="Sedi coinvolte" className="card mt" actions={<span className="small muted">nessuna selezione = tutte</span>}>
            <div className="row">{(sites.data || []).filter((x) => x.kind !== 'HEADQUARTER').map((x) => <label key={x.id} className="f inline small"><input type="checkbox" disabled={!writer} checked={(v.site_ids || []).includes(x.id)} onChange={() => s('site_ids', (v.site_ids || []).includes(x.id) ? v.site_ids.filter((i) => i !== x.id) : [...(v.site_ids || []), x.id])} />{x.name}</label>)}</div>
          </Card>
          <Card title="Campagne collegate" className="card mt" flush>{p.campaigns.length ? <table className="t"><tbody>{p.campaigns.map((c) => <tr key={c.id} className="click" onClick={() => nav(`${base}/campagne/${c.id}`)}><td>{c.name}<div className="small muted">{c.channel} · {c.status}</div></td><td className="num">{eur0(c.spent ?? c.budget)}</td></tr>)}</tbody></table> : <Empty>Nessuna campagna collegata. <Link to={`${base}/campagne`}>Crea una campagna</Link> e collegala a questa promozione.</Empty>}</Card>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Piano di spinta" actions={<span className="small muted">{(v.push_plan || []).filter((a) => a.done).length}/{(v.push_plan || []).length} fatte</span>}>
          <ul className="checklist">{(v.push_plan || []).map((a, i) => <li key={i} className={a.done ? 'done' : ''}>
            <input type="checkbox" checked={Boolean(a.done)} disabled={!writer} onChange={() => togglePlan(i)} />
            {writer ? <select value={a.channel} onChange={(e) => s('push_plan', v.push_plan.map((x, j) => (j === i ? { ...x, channel: e.target.value } : x)))} style={{ height: 30, minHeight: 30, fontSize: 12 }}>{PUSH_CHANNELS.map((c) => <option key={c}>{c}</option>)}</select> : <span className="pill">{a.channel}</span>}
            {writer ? <input className="act" value={a.action} onChange={(e) => s('push_plan', v.push_plan.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} style={{ height: 30 }} /> : <span className="act">{a.action}</span>}
            {writer ? <input type="date" value={a.when || ''} onChange={(e) => s('push_plan', v.push_plan.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))} style={{ height: 30, fontSize: 12 }} /> : <span className="small">{itDate(a.when)}</span>}
            <span className="row" style={{ gap: 4 }}>{writer ? <input value={a.owner || ''} placeholder="owner" onChange={(e) => s('push_plan', v.push_plan.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))} style={{ height: 30, fontSize: 12 }} /> : <span className="small muted">{a.owner}</span>}{writer && <button className="iconbtn" onClick={() => s('push_plan', v.push_plan.filter((_, j) => j !== i))}><Icon name="trash" /></button>}</span>
          </li>)}</ul>
          {writer && <div style={{ marginTop: 8 }}><button className="btn sm ghost" onClick={() => s('push_plan', [...(v.push_plan || []), { channel: 'INSTORE', action: '', when: p.start_date, owner: '', done: false }])}>+ Azione</button></div>}
        </Card>
        <Card title="Materiali" actions={<span className="small muted">{(v.materials || []).filter((m) => ['CONSEGNATO', 'PUBBLICATO', 'INVIATO', 'ATTIVO', 'FATTO'].includes(m.status)).length}/{(v.materials || []).length} pronti</span>}>
          <table className="t"><tbody>{(v.materials || []).map((m, i) => <tr key={i}><td>{writer ? <input value={m.type} onChange={(e) => s('materials', v.materials.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} style={{ height: 30 }} /> : m.type}</td><td style={{ width: 160 }}>{writer ? <select value={m.status} onChange={(e) => setMaterial(i, e.target.value)} style={{ height: 30, minHeight: 30, fontSize: 12 }}>{MATERIAL_STATUS.map((x) => <option key={x}>{x}</option>)}</select> : <Badge tone={m.status === 'DA_FARE' ? 'grey' : 'green'}>{m.status}</Badge>}</td>{writer && <td className="num"><button className="iconbtn" onClick={() => s('materials', v.materials.filter((_, j) => j !== i))}><Icon name="trash" /></button></td>}</tr>)}</tbody></table>
          {writer && <div style={{ marginTop: 8 }}><button className="btn sm ghost" onClick={() => s('materials', [...(v.materials || []), { type: '', status: 'DA_FARE' }])}>+ Materiale</button></div>}
          <div className="subhead">Esposizione in sede</div>
          {p.exposure.length ? <div className="row">{p.exposure.map((e) => <Badge key={e.status} tone={EXPO_STATUS[e.status]?.tone}>{EXPO_STATUS[e.status]?.label}: {e.n}</Badge>)} <Link className="small" to={`${base}/esposizione`}>Book retail</Link></div> : <p className="small muted">Nessun materiale di questa promozione nel book retail: dalla pagina Esposizione usa "Cambio mese" per aggiornare le locandine di tutte le sedi.</p>}
        </Card>
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <Card title="Andamento">{p.trend.length ? <Lines data={p.trend.map((t) => ({ day: itDate(t.day).slice(0, 5), revenue: Number(t.revenue) }))} keys={[{ key: 'revenue', label: 'Fatturato', color: C.teal }]} money /> : <Empty>Nessuna vendita con il codice {p.promo_code}</Empty>}</Card>
        <Card title="Per prestazione">{p.sales_by_product.length ? <HBars data={p.sales_by_product.map((x) => ({ label: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.blue }]} labelWidth={190} /> : <Empty>Nessuna vendita</Empty>}</Card>
        <Card title="Per sede">{p.sales_by_site.length ? <HBars data={p.sales_by_site.map((x) => ({ label: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.mauve }]} labelWidth={190} /> : <Empty>Nessuna vendita</Empty>}</Card>
      </div>
      {del && <ConfirmModal danger title="Elimina promozione" text="Le vendite collegate restano, senza attribuzione." confirmText="Elimina" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/promotions/${id}`); toast('Promozione eliminata'); nav(`${base}/promozioni`); }} />}
    </div>
  );
}
