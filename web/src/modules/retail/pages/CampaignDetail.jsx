import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, ToneBadge, Kpi, useToast, ConfirmModal } from '../components/ui.jsx';
import { Lines, HBars, C } from '../components/charts.jsx';
import { api, base } from '../api.js';
import { CampaignModal, cleanBody } from './Campaigns.jsx';
import { eur, eur0, num, pct, itDate, CAMPAIGN_CHANNEL, OBJECTIVE, CAMPAIGN_STATUS } from '../format.js';

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/campaigns/${id}`);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(false);
  const c = d.data;
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!c) return <div className="page"><Loading /></div>;
  const spent = c.spent ?? c.budget ?? 0;
  const save = async () => { try { await api.put(`/campaigns/${id}`, cleanBody(edit)); toast('Campagna aggiornata'); setEdit(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="row" style={{ gap: 8 }}><h1>{c.name}</h1><ToneBadge map={CAMPAIGN_STATUS} value={c.status} /></div><div className="sub">{CAMPAIGN_CHANNEL[c.channel] || c.channel} · {OBJECTIVE[c.objective] || c.objective || 'obiettivo non indicato'} · {itDate(c.start_date)}{c.end_date ? ` – ${itDate(c.end_date)}` : ''}{c.target_segment ? ` · target: ${c.target_segment}` : ''}{c.promo_code ? ` · codice ${c.promo_code}` : ''}{c.promotion_name ? ` · promozione: ${c.promotion_name}` : ''}</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(`${base}/campagne`)}>Tutte le campagne</button>{canWrite(user) && <button className="btn" onClick={() => setEdit({ ...c })}>Modifica</button>}{canWrite(user) && <button className="btn danger" onClick={() => setDel(true)}>Elimina</button>}</div>
      </div>
      <div className="grid g4">
        <Kpi accent label="Ricavi attribuiti" value={eur0(c.revenue)} foot={`${num(c.tickets)} prenotazioni tracciate con codice`} />
        <Kpi label="Investimento" value={eur0(spent)} foot={c.budget != null ? `budget ${eur0(c.budget)}` : ''} />
        <Kpi label="ROI" value={c.roi_pct != null ? pct(c.roi_pct) : '–'} foot="(ricavi - speso) / speso" />
        <Kpi label="Nuovi pazienti" value={num(c.new_customers)} foot={c.cost_per_customer != null ? `costo per paziente ${eur(c.cost_per_customer)}` : ''} />
      </div>
      <div className="grid g4" style={{ marginTop: 16 }}>
        <Kpi label="Impression" value={c.impressions != null ? num(c.impressions) : '–'} />
        <Kpi label="Click" value={c.clicks != null ? num(c.clicks) : '–'} foot={c.ctr_pct != null ? `CTR ${pct(c.ctr_pct, 2)}` : ''} />
        <Kpi label="Lead" value={c.leads != null ? num(c.leads) : '–'} foot={c.conversion_pct != null ? `conversione ${pct(c.conversion_pct, 1)}` : ''} />
        <Kpi label="Vendite nel periodo non tracciate" value={num(c.window_tickets)} foot={`${eur0(c.window_revenue)} sulle sedi e prestazioni della campagna, senza codice promo`} />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Andamento giornaliero">{c.trend.length ? <Lines data={c.trend.map((t) => ({ day: itDate(t.day).slice(0, 5), revenue: Number(t.revenue), tickets: t.tickets }))} keys={[{ key: 'revenue', label: 'Ricavi', color: C.teal }]} money /> : <Empty>Nessuna vendita tracciata. Usa il codice promo in accettazione per attribuire le vendite.</Empty>}</Card>
        <Card title="Prestazioni vendute">{c.products.length ? <HBars data={c.products.map((x) => ({ label: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Ricavi', color: C.blue }]} labelWidth={220} /> : <Empty>Nessuna vendita tracciata</Empty>}</Card>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Sedi">{c.sites.length ? <HBars data={c.sites.map((x) => ({ label: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Ricavi', color: C.mauve }]} labelWidth={200} /> : <Empty>Nessuna vendita tracciata</Empty>}</Card>
        <Card title="Note e lettura">
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.notes || 'Nessuna nota.'}</p>
          <p className="small muted">Le vendite si attribuiscono alla campagna quando in accettazione viene inserito il codice promo. Le "vendite nel periodo" sono una stima di contesto: tutte le vendite delle sedi e prestazioni coinvolte nel periodo della campagna, al netto di quelle tracciate. <Link to={`${base}/vendite?campaign_id=${c.id}`}>Vedi le righe tracciate</Link>.</p>
        </Card>
      </div>
      {edit && <CampaignModal value={edit} onChange={setEdit} onClose={() => setEdit(null)} onSave={save} />}
      {del && <ConfirmModal danger title="Elimina campagna" text="Le vendite collegate restano, senza attribuzione." confirmText="Elimina" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/campaigns/${id}`); toast('Campagna eliminata'); nav(`${base}/campagne`); }} />}
    </div>
  );
}
