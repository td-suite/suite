import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Badge, SegmentBadge, Kpi, useToast, ConfirmModal } from '../components/ui.jsx';
import { Donut, HBars, C } from '../components/charts.jsx';
import { api, base } from '../api.js';
import { CustomerModal } from './Customers.jsx';
import { eur, eur0, num, itDate, SEX, CHANNEL, PAYMENT, B2B_TYPE, SOURCE } from '../format.js';

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/customers/${id}`);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(false);
  const c = d.data;
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!c) return <div className="page"><Loading /></div>;
  const isB2B = c.kind === 'B2B';
  const name = isB2B ? c.company_name : `${c.last_name} ${c.first_name}`;
  const save = async () => {
    try { const body = { ...edit }; delete body.id; delete body.kind; body.employees = body.employees === '' || body.employees == null ? null : Number(body.employees); body.home_site_id = body.home_site_id ? Number(body.home_site_id) : null; await api.put(`/customers/${id}`, body); toast('Scheda aggiornata'); setEdit(null); d.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  // raggruppa le righe per accettazione
  const tickets = []; const byRef = new Map();
  for (const s of c.sales) { const k = `${s.source}:${s.external_ref}`; if (!byRef.has(k)) { byRef.set(k, { key: k, ref: s.external_ref, date: s.sale_date, time: s.sale_time, site: s.site_name, payment: s.payment_kind, channel: s.booking_channel, promo: s.promotion_name, campaign: s.campaign_name, lines: [], net: 0 }); tickets.push(byRef.get(k)); } const t = byRef.get(k); t.lines.push(s); t.net += Number(s.net_amount); }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><h1>{name}</h1><Badge tone={isB2B ? 'mauve' : 'teal'}>{c.kind}</Badge><SegmentBadge segment={c.segment} /></div>
          <div className="sub">{isB2B ? `${B2B_TYPE[c.b2b_type] || c.b2b_type || ''}${c.sector ? ` · ${c.sector}` : ''}${c.employees ? ` · ${num(c.employees)} dipendenti` : ''}` : `${c.sex ? SEX[c.sex] : ''}${c.age != null ? `, ${c.age} anni` : ''}${c.birth_date ? ` (${itDate(c.birth_date)})` : ''}${c.tax_code ? ` · ${c.tax_code}` : ''}`} · origine {SOURCE[c.source] || c.source}{c.external_id ? ` #${c.external_id}` : ''}</div>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => nav(-1)}>Indietro</button>
          {canWrite(user) && <button className="btn" onClick={() => setEdit({ ...c })}>Modifica</button>}
          {canWrite(user) && !c.sales.length && <button className="btn danger" onClick={() => setDel(true)}>Elimina</button>}
        </div>
      </div>
      <div className="grid g4">
        <Kpi accent label="Fatturato complessivo" value={eur0(c.revenue)} foot={`${num(c.visits)} accettazioni · medio ${eur0(c.visits ? c.revenue / c.visits : 0)}`} />
        <Kpi label="Prima visita" value={itDate(c.first_visit) || '–'} foot={c.home_site_name ? `sede di riferimento: ${c.home_site_name}` : ''} />
        <Kpi label="Ultima visita" value={itDate(c.last_visit) || '–'} foot={c.last_visit ? `${Math.round((Date.now() - new Date(c.last_visit)) / 86400000)} giorni fa` : ''} />
        <Kpi label="Contatti" value={c.phone || c.email || '–'} foot={`${c.email && c.phone ? c.email : ''}${!isB2B ? ` · consenso marketing ${c.marketing_consent ? 'sì' : c.marketing_consent === false ? 'no' : 'n.d.'}` : c.contact_name ? ` · referente ${c.contact_name}` : ''}`} />
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <Card title="Anagrafica">
          <table className="t"><tbody>
            <tr><td className="muted">Residenza</td><td>{[c.address, c.zip, c.city, c.province ? `(${c.province})` : ''].filter(Boolean).join(' ') || '–'}</td></tr>
            {!isB2B && <tr><td className="muted">Canale di acquisizione</td><td>{CHANNEL[c.acquisition_channel] || c.acquisition_channel || '–'}</td></tr>}
            {isB2B && <tr><td className="muted">Partita IVA</td><td className="mono">{c.vat_number || '–'}</td></tr>}
            <tr><td className="muted">Note</td><td>{c.notes || '–'}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Cosa compra">
          {c.by_line.length ? <><Donut size={160} data={c.by_line.map((x) => ({ name: x.label, value: Number(x.revenue) }))} money /><table className="t"><tbody>{c.by_line.map((x) => <tr key={x.label}><td>{x.label}</td><td className="num">{num(x.count)} prest.</td><td className="num strong">{eur0(x.revenue)}</td></tr>)}</tbody></table></> : <Empty>Nessun acquisto</Empty>}
        </Card>
        <Card title="Dove">
          {c.by_site.length ? <HBars data={c.by_site.map((x) => ({ label: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.teal }]} labelWidth={180} /> : <Empty>Nessun acquisto</Empty>}
        </Card>
      </div>
      {!isB2B && <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Richiami periodici" flush actions={<span className="small muted">esami con periodicità, dalla scheda prodotto</span>}>
          {c.recalls.length ? <table className="t"><thead><tr><th>Esame</th><th>Ultima volta</th><th>Prossimo</th><th /></tr></thead><tbody>{c.recalls.map((r) => <tr key={r.product_id}><td>{r.description}<div className="small muted">ogni {r.periodicity_months} mesi</div></td><td>{itDate(r.last_date)}</td><td>{itDate(r.due_date)}</td><td className="num">{r.due_date < today ? <Badge tone="red">scaduto</Badge> : r.due_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) ? <Badge tone="mauve">entro 30 gg</Badge> : <Badge tone="grey">pianificato</Badge>}</td></tr>)}</tbody></table> : <Empty>Nessun esame periodico nello storico</Empty>}
        </Card>
        <Card title="Proposte di cross-selling" flush actions={<span className="small muted">più acquistate da pazienti con profilo simile</span>}>
          {c.suggestions.length ? <table className="t"><tbody>{c.suggestions.map((s) => <tr key={s.id} className="click" onClick={() => nav(`${base}/prodotti?open=${s.id}`)}><td>{s.description}<div className="small muted">{s.code}</div></td><td className="num small muted">{num(s.n)} pazienti simili</td></tr>)}</tbody></table> : <Empty>Nessuna proposta disponibile</Empty>}
        </Card>
      </div>}
      <div style={{ marginTop: 16 }}>
        <Card title={`Storico accettazioni (${tickets.length})`} flush>
          {tickets.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Data</th><th>Accettazione</th><th>Sede</th><th>Prestazioni</th><th>Regime · canale</th><th className="num">Netto</th></tr></thead>
            <tbody>{tickets.map((t) => <tr key={t.key}><td>{itDate(t.date)}{t.time ? <div className="small muted">{String(t.time).slice(0, 5)}</div> : null}</td><td className="mono small">{t.ref}</td><td className="small">{t.site || '–'}</td><td>{t.lines.map((l) => <div key={l.id}>{l.quantity > 1 ? `${l.quantity} × ` : ''}{l.product_description || l.product_code}{l.discount > 0 ? <span className="small muted"> (sconto {eur(l.discount)})</span> : null}</div>)}{t.promo && <span className="chip">{t.promo}</span>}{t.campaign && <span className="chip">{t.campaign}</span>}</td><td className="small">{PAYMENT[t.payment] || t.payment || '–'}<div className="muted">{CHANNEL[t.channel] || t.channel || ''}</div></td><td className="num strong">{eur(t.net)}</td></tr>)}</tbody></table></div> : <Empty>Nessuna accettazione registrata</Empty>}
        </Card>
      </div>
      {edit && <CustomerModal value={edit} onChange={setEdit} onClose={() => setEdit(null)} onSave={save} />}
      {del && <ConfirmModal danger title="Elimina cliente" text={`Eliminare definitivamente ${name}?`} confirmText="Elimina" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/customers/${id}`); toast('Cliente eliminato'); nav(isB2B ? `${base}/clienti/b2b` : `${base}/clienti`); }} />}
    </div>
  );
}
