import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, ToneBadge, Modal, useToast, Kpi, MoneyInput } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { eur, eur0, num, itDate, pct, CAMPAIGN_CHANNEL, OBJECTIVE, CAMPAIGN_STATUS } from '../format.js';

export default function Campaigns() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const list = useApi(`/campaigns?year=${year}`, [year]);
  const [edit, setEdit] = useState(null);
  const rows = list.data || [];
  const tot = rows.reduce((a, c) => ({ spent: a.spent + Number(c.spent ?? c.budget ?? 0), revenue: a.revenue + Number(c.revenue || 0), tickets: a.tickets + Number(c.tickets || 0), customers: a.customers + Number(c.new_customers || 0) }), { spent: 0, revenue: 0, tickets: 0, customers: 0 });
  const save = async () => {
    try { const r = await api.post('/campaigns', cleanBody(edit)); toast('Campagna creata'); setEdit(null); nav(`${base}/campagne/${r.id}`); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Campagne</h1><div className="sub">Monitoraggio delle campagne di comunicazione: budget, speso, prenotazioni e ricavi attribuiti (codice promo o attribuzione per periodo, sede e prestazioni), nuovi pazienti, ROI.</div></div>
        <div className="row"><Field label="Anno"><select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 2, year - 1, year, year + 1].sort().map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>{canWrite(user) && <button className="btn" onClick={() => setEdit({ channel: 'META', objective: 'ACQUISIZIONE', start_date: new Date().toISOString().slice(0, 10), status: 'PIANIFICATA', site_ids: [], product_ids: [] })}>+ Nuova campagna</button>}</div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Investimento" value={eur0(tot.spent)} foot={`${rows.length} campagne nel ${year}`} />
        <Kpi label="Ricavi attribuiti" value={eur0(tot.revenue)} foot={`${num(tot.tickets)} prenotazioni tracciate`} />
        <Kpi label="ROI complessivo" value={tot.spent ? pct(((tot.revenue - tot.spent) / tot.spent) * 100) : '–'} foot="(ricavi - speso) / speso" />
        <Kpi label="Nuovi pazienti acquisiti" value={num(tot.customers)} foot={tot.customers ? `costo medio ${eur0(tot.spent / tot.customers)}` : ''} />
      </div>
      <ErrorBox error={list.error} />
      <Card flush>
        {!list.data ? <Loading /> : !rows.length ? <Empty>Nessuna campagna nel {year}</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Campagna</th><th>Canale · obiettivo</th><th>Periodo</th><th>Stato</th><th className="num">Budget / speso</th><th className="num">Prenotazioni</th><th className="num">Ricavi</th><th className="num">Nuovi paz.</th><th className="num">ROI</th><th className="num">CPA</th></tr></thead>
            <tbody>{rows.map((c) => <tr key={c.id} className="click" onClick={() => nav(`${base}/campagne/${c.id}`)}>
              <td><div className="strong">{c.name}</div><div className="small muted">{c.promo_code ? <span className="chip">{c.promo_code}</span> : null}{c.promotion_name ? `promo: ${c.promotion_name}` : ''}</div></td>
              <td className="small">{CAMPAIGN_CHANNEL[c.channel] || c.channel}<div className="muted">{OBJECTIVE[c.objective] || c.objective || ''}</div></td>
              <td className="small">{itDate(c.start_date)}{c.end_date ? ` – ${itDate(c.end_date)}` : ''}</td>
              <td><ToneBadge map={CAMPAIGN_STATUS} value={c.status} /></td>
              <td className="num">{eur0(c.budget)}<div className="small muted">{c.spent != null ? eur0(c.spent) : '–'}</div></td>
              <td className="num">{num(c.tickets)}{c.window_tickets ? <div className="small muted" title="prenotazioni nel periodo sulle sedi e prestazioni della campagna, non tracciate con codice">+{num(c.window_tickets)} nel periodo</div> : null}</td>
              <td className="num strong">{eur0(c.revenue)}</td><td className="num">{num(c.new_customers)}</td>
              <td className="num">{c.roi_pct != null ? <span className={Number(c.roi_pct) >= 0 ? 'green strong' : 'red strong'}>{pct(c.roi_pct)}</span> : '–'}</td>
              <td className="num">{c.cost_per_customer != null ? eur(c.cost_per_customer) : '–'}</td>
            </tr>)}</tbody></table></div>
        )}
      </Card>
      {edit && <CampaignModal value={edit} onChange={setEdit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

export const cleanBody = (v) => {
  const b = { ...v }; delete b.id;
  for (const k of ['budget', 'spent', 'impressions', 'clicks', 'leads', 'bookings', 'promotion_id']) b[k] = b[k] === '' || b[k] == null ? null : Number(b[k]);
  for (const k of Object.keys(b)) if (!['name', 'channel', 'objective', 'target_segment', 'start_date', 'end_date', 'budget', 'spent', 'promo_code', 'status', 'impressions', 'clicks', 'leads', 'bookings', 'site_ids', 'product_ids', 'promotion_id', 'notes'].includes(k)) delete b[k];
  if (b.end_date === '') b.end_date = null;
  return b;
};

export function CampaignModal({ value: v, onChange, onClose, onSave }) {
  const s = (k, x) => onChange({ ...v, [k]: x });
  const promos = useApi(`/promotions?year=${(v.start_date || '').slice(0, 4) || new Date().getFullYear()}`);
  const sites = useApi('/sites');
  const products = useApi('/products?active=all');
  const toggle = (k, id) => s(k, (v[k] || []).includes(id) ? v[k].filter((x) => x !== id) : [...(v[k] || []), id]);
  return (
    <Modal title={v.id ? 'Modifica campagna' : 'Nuova campagna'} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!v.name || !v.start_date} onClick={onSave}>Salva</button></>}>
      <div className="form-grid">
        <Field label="Nome *" className="span2"><input value={v.name || ''} onChange={(e) => s('name', e.target.value)} /></Field>
        <Field label="Canale"><select value={v.channel} onChange={(e) => s('channel', e.target.value)}>{Object.entries(CAMPAIGN_CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Obiettivo"><select value={v.objective || ''} onChange={(e) => s('objective', e.target.value)}><option value="">–</option>{Object.entries(OBJECTIVE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Inizio *"><input type="date" value={v.start_date || ''} onChange={(e) => s('start_date', e.target.value)} /></Field>
        <Field label="Fine"><input type="date" value={v.end_date || ''} onChange={(e) => s('end_date', e.target.value)} /></Field>
        <Field label="Budget"><MoneyInput value={v.budget ?? ''} onChange={(x) => s('budget', x)} /></Field>
        <Field label="Speso"><MoneyInput value={v.spent ?? ''} onChange={(x) => s('spent', x)} /></Field>
        <Field label="Codice promo" help="Collega le accettazioni con questo codice"><input value={v.promo_code || ''} onChange={(e) => s('promo_code', e.target.value.toUpperCase())} className="mono" /></Field>
        <Field label="Stato"><select value={v.status || 'PIANIFICATA'} onChange={(e) => s('status', e.target.value)}>{Object.entries(CAMPAIGN_STATUS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></Field>
        <Field label="Promozione collegata"><select value={v.promotion_id || ''} onChange={(e) => s('promotion_id', e.target.value)}><option value="">–</option>{(promos.data || []).map((p) => <option key={p.id} value={p.id}>{p.month}/{p.year} · {p.name}</option>)}</select></Field>
        <Field label="Target"><input value={v.target_segment || ''} placeholder="es. donne 45-65, bacino Mugello" onChange={(e) => s('target_segment', e.target.value)} /></Field>
        <Field label="Impression"><input type="number" value={v.impressions ?? ''} onChange={(e) => s('impressions', e.target.value)} /></Field>
        <Field label="Click"><input type="number" value={v.clicks ?? ''} onChange={(e) => s('clicks', e.target.value)} /></Field>
        <Field label="Lead / contatti"><input type="number" value={v.leads ?? ''} onChange={(e) => s('leads', e.target.value)} /></Field>
        <Field label="Note" className="span2"><textarea value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field>
      </div>
      <div className="subhead">Sedi coinvolte (vuoto = tutte) · usate per l'attribuzione delle vendite nel periodo</div>
      <div className="row">{(sites.data || []).filter((x) => x.kind !== 'HEADQUARTER').map((x) => <label key={x.id} className="f inline small"><input type="checkbox" checked={(v.site_ids || []).includes(x.id)} onChange={() => toggle('site_ids', x.id)} />{x.name}</label>)}</div>
      <div className="subhead">Prestazioni promosse (vuoto = tutte)</div>
      <select multiple size={6} value={(v.product_ids || []).map(String)} onChange={(e) => s('product_ids', [...e.target.selectedOptions].map((o) => Number(o.value)))} style={{ height: 'auto' }}>{(products.data?.rows || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.description}</option>)}</select>
      <div className="help">Tieni premuto Ctrl (o Cmd) per selezionare più prestazioni.</div>
    </Modal>
  );
}
