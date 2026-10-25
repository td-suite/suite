import React from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { useT } from '../i18n.jsx';
import { Card, Kpi, Loading, ErrorBox, useApi, Badge } from '../components/ui.jsx';
import { StatusBadge } from '../components/orders.jsx';
import { eur, fdate, fdt, daysSince, num, projectPath, patientName } from '../format.js';

const EVENT_LABEL = {
  it: { CREATED: 'Richiesta creata', ASSIGNED: 'Kit assegnato', UNASSIGNED: 'Kit sganciato', SHIPPED: 'Kit spedito', HANDOVER: 'Kit consegnato a mano', DELIVERED: 'Consegnato', SAMPLE_RECEIVED: 'Campione ricevuto', LAB_ADDED: 'Inserito in spedizione FedEx', LAB_REMOVED: 'Tolto dalla spedizione FedEx', SHIPPED_TO_LAB: 'Spedito al laboratorio', LAB_DELIVERED: 'Consegnato al laboratorio', CLOSED: 'Chiuso', CANCELLED: 'Annullato', UNDO: 'Passaggio annullato', TRACKING: 'Aggiornamento tracciamento', TRACKING_EDIT: 'Tracking modificato', EDITED: 'Dati modificati', STOCK_IN: 'Carico a magazzino', DISCARDED: 'Kit scartato', RESTORED: 'Kit ripristinato' },
  en: { CREATED: 'Request created', ASSIGNED: 'Kit assigned', UNASSIGNED: 'Kit released', SHIPPED: 'Kit shipped', HANDOVER: 'Kit handed over', DELIVERED: 'Delivered', SAMPLE_RECEIVED: 'Sample received', LAB_ADDED: 'Added to FedEx shipment', LAB_REMOVED: 'Removed from FedEx shipment', SHIPPED_TO_LAB: 'Shipped to laboratory', LAB_DELIVERED: 'Delivered to laboratory', CLOSED: 'Closed', CANCELLED: 'Cancelled', UNDO: 'Step undone', TRACKING: 'Tracking update', TRACKING_EDIT: 'Tracking edited', EDITED: 'Details edited', STOCK_IN: 'Stock intake', DISCARDED: 'Kit discarded', RESTORED: 'Kit restored' },
};
export const eventLabel = (e, lang) => EVENT_LABEL[lang === 'en' ? 'en' : 'it'][e] || e;

export default function Dashboard({ project }) {
  const { t, lang } = useT();
  const { data, error } = useApi(`/reports/dashboard?project=${project}`);
  const p = projectPath(project);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const n = (st) => data.byStatus.filter((x) => x.status === st).reduce((a, x) => a + x.n, 0);
  const ms = data.monthStats;
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('dash.title')}</h1><div className="sub">{t(`proj.${project}`)} · {new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div></div>
      <div className="grid g5" style={{ marginBottom: 16 }}>
        <Link to={`${'/' + p}/magazzino`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.stock')} value={num(data.stock)} foot={data.lowStock ? `${t('dash.lowStock')} ${data.minStock}` : ' '} accent={data.lowStock} /></Link>
        {project === 'ENDEAVOR' && <Link to={`/${p}/richieste`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.inbox')} value={num(data.inbox)} foot={`${t('dash.toAssign')}: ${n('NEW')}`} /></Link>}
        {project === 'LIFESTYLE' && <Link to={`/${p}/richieste`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.toAssign')} value={num(n('NEW'))} /></Link>}
        <Link to={`/${p}/invio`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.toShip')} value={num(n('ASSIGNED'))} foot={`${t('dash.inTransit')}: ${n('SHIPPED')}`} /></Link>
        <Link to={`/${p}/ricezione`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.waitingSample')} value={num(n('DELIVERED'))} foot={data.overdue.length ? `${t('dash.overdue')}: ${data.overdue.length}` : ' '} /></Link>
        {project === 'ENDEAVOR' ? <Link to={`/${p}/laboratorio`} style={{ textDecoration: 'none' }}><Kpi label={t('dash.awaitingLab')} value={num(n('SAMPLE_RECEIVED'))} foot={`${t('st.SHIPPED_TO_LAB')}: ${n('SHIPPED_TO_LAB')}`} /></Link>
          : <Kpi label={t('st.CLOSED')} value={num(n('CLOSED'))} />}
      </div>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Card title={`${t('dash.month')} · ${new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { month: 'long', year: 'numeric' })}`}>
          <div className="grid g2">
            <div className="kpi" style={{ padding: 0 }}><div className="lbl">{t('dash.created')}</div><div className="val sm">{num(ms.created)}</div></div>
            <div className="kpi" style={{ padding: 0 }}><div className="lbl">{t('dash.shipped')}</div><div className="val sm">{num(ms.shipped)}</div></div>
            <div className="kpi" style={{ padding: 0 }}><div className="lbl">{t('dash.samples')}</div><div className="val sm">{num(ms.samples)}</div></div>
            {project === 'ENDEAVOR' ? <div className="kpi" style={{ padding: 0 }}><div className="lbl">{t('dash.toLab')}</div><div className="val sm">{num(ms.to_lab)}</div></div> : <div className="kpi" style={{ padding: 0 }}><div className="lbl">{t('qty.delivered')}</div><div className="val sm">{num(ms.delivered)}</div></div>}
            {project === 'ENDEAVOR' && <div className="kpi span2" style={{ padding: 0 }}><div className="lbl">{t('dash.revenue')}</div><div className="val sm">{eur(ms.revenue, lang)}</div></div>}
          </div>
        </Card>
        <Card title={t('dash.trend')} className="span2">
          <div style={{ height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={data.trend} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf2f3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="shipped" name={t('qty.shipped')} fill="#1C505E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="samples" name={t('qty.samples')} fill="#71B1BD" radius={[4, 4, 0, 0]} />
                {project === 'ENDEAVOR' && <Bar dataKey="to_lab" name={t('qty.toLab')} fill="#DEC0F1" radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Card title={t('dash.overdue')} flush>
          <div className="inner tight"><div className="small muted">{t('dash.overdueSub', { d: data.retDays })}</div></div>
          {!data.overdue.length ? <div className="empty">{t('dash.allGood')}</div> : <table className="t"><tbody>{data.overdue.slice(0, 10).map((o) => (
            <tr key={o.id}><td><Link to={`/${p}/richieste/${o.id}`} className="strong mono">{o.external_ref || `#${o.id}`}</Link><div className="small">{patientName(o)}</div></td><td className="mono small">{o.barcode}</td><td className="small muted">{t('dash.deliveredOn')} {fdate(o.delivered_at)}</td><td className="num"><Badge tone="red">{daysSince(o.delivered_at)} {t('c.days')}</Badge></td></tr>))}</tbody></table>}
        </Card>
        {project === 'ENDEAVOR' ? (
          <Card title={t('dash.awb')} flush>
            <div className="inner tight"><div className="small muted">{t('dash.awbSub', { d: data.awbDays })}</div></div>
            {!data.awaiting.length ? <div className="empty">{t('dash.allGood')}</div> : <table className="t"><tbody>{data.awaiting.slice(0, 10).map((o) => (
              <tr key={o.id}><td><Link to={`/${p}/richieste/${o.id}`} className="strong mono">{o.external_ref || `#${o.id}`}</Link><div className="small">{patientName(o)}</div></td><td className="mono small">{o.barcode}</td><td className="small muted">{t('dash.receivedOn')} {fdate(o.sample_received_at)}</td><td className="num"><Badge tone="mauve">{daysSince(o.sample_received_at)} {t('c.days')}</Badge></td></tr>))}</tbody></table>}
          </Card>
        ) : (
          <Card title={t('dash.trackIssues')} flush>
            {!data.trackingIssues.length ? <div className="empty">{t('dash.allGood')}</div> : <table className="t"><tbody>{data.trackingIssues.map((s) => (
              <tr key={s.id}><td><Link to={`/${p}/richieste/${s.order_id}`} className="strong mono">{s.external_ref || `#${s.order_id}`}</Link></td><td className="mono small">{s.tracking_number}</td><td className="small red">{s.last_status_text}</td></tr>))}</tbody></table>}
          </Card>
        )}
      </div>
      {project === 'ENDEAVOR' && data.trackingIssues.length > 0 && (
        <Card title={t('dash.trackIssues')} flush className="" >
          <table className="t"><tbody>{data.trackingIssues.map((s) => (
            <tr key={s.id}><td><Link to={`/${p}/richieste/${s.order_id}`} className="strong mono">{s.external_ref || `#${s.order_id}`}</Link></td><td className="mono small">{s.tracking_number}</td><td className="small red">{s.last_status_text}</td><td className="small muted">{fdt(s.last_event_at)}</td></tr>))}</tbody></table>
        </Card>
      )}
      <Card title={t('dash.recent')} flush>
        {!data.recent.length ? <div className="empty">{t('c.none')}</div> : <table className="t"><tbody>{data.recent.map((e) => (
          <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(e.at)}</td><td className="strong">{eventLabel(e.event, lang)}</td><td>{e.order_id ? <Link to={`/${p}/richieste/${e.order_id}`} className="mono">{e.external_ref || `#${e.order_id}`}</Link> : null} {e.barcode && <span className="mono small muted">{e.barcode}</span>}</td><td className="small muted">{e.full_name || (e.data?.source === 'AUTO' ? 'auto' : '')}</td></tr>))}</tbody></table>}
      </Card>
    </div>
  );
}
