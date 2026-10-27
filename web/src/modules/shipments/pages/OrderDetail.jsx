import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE } from '../api.js';
import { useAuth, canOperate } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Modal, Field, ErrorBox, Loading, PromptModal, Icon, useApi, useToast } from '../components/ui.jsx';
import { StatusBadge, TrackBadge, KitBadge, OrderForm, BarcodeInput, useModes, useSettingsPublic, ModeOrType } from '../components/orders.jsx';
import { eventLabel } from './Dashboard.jsx';
import { eur, fdate, fdt, patientName, projectPath, today } from '../format.js';

export default function OrderDetail({ project }) {
  const { id } = useParams();
  const { t, lang } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const nav = useNavigate();
  const { data: o, reload } = useApi(`/orders/${id}`);
  const modes = useModes();
  const pub = useSettingsPublic();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const p = projectPath(project);
  if (!o) return <Loading />;
  const legs = o.project === 'LIFESTYLE' ? { outbound: 'STANDARD', ret: o.order_type === 'KIT_AND_EXAM' ? 'STANDARD' : null } : { outbound: o.outbound_service, ret: o.return_service };
  const out = o.shipments.find((s) => s.direction === 'OUTBOUND');
  const ret = o.shipments.find((s) => s.direction === 'RETURN');
  const act = async (fn, okMsg) => { setErr(null); try { await fn(); toast(okMsg || t('c.saved')); setModal(null); reload(); } catch (e) { setErr(e); } };
  const open = (m, init = {}) => { setErr(null); setForm(init); setModal(m); };
  const sites = (pub.data?.td_sites || '').split(',').map((s) => s.trim()).filter(Boolean);
  const closed = ['CLOSED', 'CANCELLED'].includes(o.status);
  const svc = (s) => (s === 'EXPRESS' ? 'SDA Express' : s === 'STANDARD' ? 'SDA Standard' : t('ord.noLeg'));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="small muted"><Link to={`/${p}/elenco`}>{t('nav.orders')}</Link> · {t(`proj.${project}`)}</div>
          <h1 className="row">{t('ord.title')} <span className="mono">{o.external_ref || `#${o.id}`}</span> <StatusBadge status={o.status} /></h1>
          <div className="sub">{patientName(o)} · {[o.city, o.province].filter(Boolean).join(' ')} · <ModeOrType o={o} /> · {t(`ord.source.${o.source}`)} · {t('c.created')} {fdt(o.created_at)}{o.created_by_name ? ` (${o.created_by_name})` : ''}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={`${API_BASE}/orders/${o.id}/sheet.pdf?lang=${o.lang}`} target="_blank" rel="noreferrer"><Icon name="print" size={16} />{t('ord.sheet')}</a>
          {op && !closed && <button className="btn ghost" onClick={() => open('edit', { ...o, email: o.email || '', shipping_mode_id: o.shipping_mode_id || '' })}>{t('c.edit')}</button>}
          {op && !['NEW', 'CLOSED'].includes(o.status) && !(o.status === 'SHIPPED_TO_LAB') && <button className="btn ghost" onClick={() => act(() => api.post(`/orders/${o.id}/undo`))}>{t('c.undo')}</button>}
          {op && !closed && o.status !== 'SHIPPED_TO_LAB' && <button className="btn danger" onClick={() => setModal('cancel')}>{t('ord.cancel')}</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {o.anonymized_at && <div className="alert warn" style={{ marginBottom: 14 }}>{t('ord.anonymized')}</div>}
      <div className="next" style={{ marginBottom: 16 }}>
        <div style={{ flex: 1 }}><b>{t('ord.next')}</b>{t(`ord.next.${o.status}`)}</div>
        {op && o.status === 'NEW' && <button className="btn" onClick={() => open('assign', { barcode: '' })}>{t('ord.assign')}</button>}
        {op && o.status === 'ASSIGNED' && <button className="btn" onClick={() => open('ship', { outbound_tracking: '', return_tracking: '', shipped_at: today() })}>{t('ord.ship')}</button>}
        {op && o.status === 'SHIPPED' && <button className="btn" onClick={() => open('deliver', { delivered_at: today() })}>{t('ord.deliver')}</button>}
        {op && ['SHIPPED', 'DELIVERED'].includes(o.status) && <button className="btn" onClick={() => open('sample', { received_at: today(), site: sites[0] || '' })}>{t('ord.sample')}</button>}
        {op && o.status === 'SAMPLE_RECEIVED' && project === 'ENDEAVOR' && <Link className="btn" to={`/${p}/laboratorio`}>{t('nav.lab')}</Link>}
      </div>
      <div className="grid g3">
        <Card title={t('ord.patient')}>
          <div className="strong" style={{ fontSize: 16 }}>{patientName(o)}</div>
          <div>{o.address1}{o.address2 ? `, ${o.address2}` : ''}</div>
          <div>{[o.zip, o.city, o.province && `(${o.province})`].filter(Boolean).join(' ')} · {o.country}</div>
          {o.phone && <div className="small">{t('c.phone')}: {o.phone}</div>}
          {o.email && <div className="small">{t('c.email')}: {o.email}</div>}
          <div className="small muted" style={{ marginTop: 6 }}>{t('ord.langP')}: {o.lang === 'en' ? 'English' : 'Italiano'}</div>
          {o.notes && <div className="small" style={{ marginTop: 6 }}><b>{t('c.notes')}:</b> {o.notes}</div>}
        </Card>
        <Card title={t('ord.kit')}>
          {o.barcode ? <>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '.06em' }}>{o.barcode}</div>
            <div style={{ marginTop: 6 }}><KitBadge status={o.kit_status} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>{t('st.ASSIGNED')}: {fdt(o.assigned_at)}</div>
            {op && o.status === 'ASSIGNED' && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => act(() => api.post(`/orders/${o.id}/unassign`))}>{t('ord.unassign')}</button>}
          </> : <div className="muted">{t('st.NEW')}</div>}
          {project === 'ENDEAVOR' && <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="small strong muted">{t('ord.fees')}</div>
            <div className="small">{t('ord.feeShip')}: <b>{o.fee_shipping != null ? eur(o.fee_shipping, lang) : '–'}</b> {o.fee_shipping_date && <span className="muted">· {fdate(o.fee_shipping_date)}</span>}</div>
            <div className="small">{t('ord.feeSample')}: <b>{o.fee_sample != null ? eur(o.fee_sample, lang) : '–'}</b> {o.fee_sample_date && <span className="muted">· {fdate(o.fee_sample_date)}</span>}</div>
          </div>}
        </Card>
        <Card title={t('ord.legs')}>
          <div className="leg"><div className="dir">{t('ord.out')}</div><div>{legs.outbound ? <>{svc(legs.outbound)}{out && <div className="small"><span className="mono">{out.tracking_number}</span> <TrackBadge status={out.last_status} />{out.last_status_text && <div className="muted">{out.last_status_text}</div>}{out.shipped_at && <div className="muted">{t('ord.shippedOn')} {fdate(out.shipped_at)}{out.delivered_at ? ` · ${t('ord.deliveredOn')} ${fdate(out.delivered_at)}` : ''}</div>}</div>}{o.handover && <div className="small muted">{t('ord.handover')}</div>}</> : <span className="no">{t('ord.noLeg')}{o.handover && ` · ${t('ord.deliveredOn')} ${fdate(o.delivered_at)}`}</span>}</div>
            <div className="row">{out?.url && <a className="btn sm ghost" href={out.url} target="_blank" rel="noreferrer">SDA</a>}{op && out && <button className="btn sm ghost" onClick={() => open('track', { sid: out.id, tracking_number: out.tracking_number || '', shipped_at: out.shipped_at ? String(out.shipped_at).slice(0, 10) : '' })}>{t('ord.editTracking')}</button>}</div></div>
          <div className="leg"><div className="dir">{t('ord.ret')}</div><div>{legs.ret ? <>{svc(legs.ret)}{ret && <div className="small"><span className="mono">{ret.tracking_number || '–'}</span> <TrackBadge status={ret.last_status} />{ret.delivered_at && <div className="muted">{t('ord.sampleOn')} {fdate(ret.delivered_at)}</div>}</div>}</> : <span className="no">{t('ord.noLeg')}</span>}</div>
            <div className="row">{ret?.url && <a className="btn sm ghost" href={ret.url} target="_blank" rel="noreferrer">SDA</a>}{op && ret && <button className="btn sm ghost" onClick={() => open('track', { sid: ret.id, tracking_number: ret.tracking_number || '', shipped_at: ret.shipped_at ? String(ret.shipped_at).slice(0, 10) : '' })}>{t('ord.editTracking')}</button>}</div></div>
          {project === 'ENDEAVOR' && <div className="leg"><div className="dir">{t('ord.lab')}</div><div>{o.lab_shipment_id ? <><Link to={`/${p}/laboratorio/${o.lab_shipment_id}`} className="strong">FedEx {o.awb_number || `#${o.lab_shipment_id}`}</Link> <span className="small muted">{t(`lab.${o.lab_status}`)}</span></> : <span className="no">{o.sample_received_at ? t('dash.awb') : '–'}</span>}</div><div /></div>}
          {o.sample_received_at && <div className="small muted" style={{ marginTop: 8 }}>{t('ord.sampleOn')} {fdt(o.sample_received_at)}{o.sample_received_site ? ` · ${o.sample_received_site}` : ''}</div>}
          {o.closed_at && <div className="small muted">{t('ord.closedOn')} {fdt(o.closed_at)}</div>}
          {o.cancelled_at && <div className="small red">{t('ord.cancelledOn')} {fdt(o.cancelled_at)}: {o.cancel_reason}</div>}
        </Card>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={t('ord.timeline')} flush>
          <table className="t"><tbody>{o.events.map((e) => (
            <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(e.at)}</td><td><div className="strong">{eventLabel(e.event, lang)}</div>{e.data && <div className="small muted">{Object.entries(e.data).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}</td><td className="small muted">{e.full_name || (e.data?.source === 'AUTO' ? 'auto' : '')}</td></tr>))}</tbody></table>
        </Card>
        <Card title={t('ord.emails')} flush>
          {!o.emails.length ? <div className="empty">{t('c.none')}</div> : <table className="t"><tbody>{o.emails.map((e) => (
            <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(e.sent_at)}</td><td><div className="strong">{e.subject}</div><div className="small muted">{e.to_addr}</div></td><td><span className={`badge ${e.status === 'INVIATA' ? 'b-green' : e.status === 'FALLITA' ? 'b-red' : 'b-grey'}`}>{e.status}</span>{e.error && <div className="small red">{e.error}</div>}</td></tr>))}</tbody></table>}
        </Card>
      </div>

      {modal === 'assign' && (
        <Modal title={t('ord.assign')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" disabled={!form.barcode} onClick={() => act(() => api.post(`/orders/${o.id}/assign`, { barcode: form.barcode }))}>{t('c.confirm')}</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 8 }}>{t('ord.assignHelp')}</div>
          <BarcodeInput autoFocus value={form.barcode} onChange={(v) => setForm({ barcode: v })} onEnter={(v) => act(() => api.post(`/orders/${o.id}/assign`, { barcode: v || form.barcode }))} />
        </Modal>
      )}
      {modal === 'ship' && (
        <Modal title={t('ord.shipTitle')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" disabled={(legs.outbound && !form.outbound_tracking) || (!legs.outbound && o.project === 'ENDEAVOR' && !form.return_tracking)} onClick={() => act(() => api.post(`/orders/${o.id}/ship`, { ...form, outbound_tracking: form.outbound_tracking || null, return_tracking: form.return_tracking || null }))}>{t('ord.ship')}</button></>}>
          <ErrorBox error={err} />
          <div className="small" style={{ marginBottom: 10 }}>{t('ord.out')}: <b>{svc(legs.outbound)}</b> · {t('ord.ret')}: <b>{svc(legs.ret)}</b>{o.mode_price != null && project === 'ENDEAVOR' && <> · {t('ord.feeShip')}: <b>{eur(o.mode_price, lang)}</b></>}</div>
          {!legs.outbound && <div className="alert info" style={{ marginBottom: 10 }}>{t('ord.handover')}</div>}
          {legs.outbound && <Field label={t('ord.outTracking')}><input className="mono" autoFocus value={form.outbound_tracking} onChange={(e) => setForm({ ...form, outbound_tracking: e.target.value.toUpperCase().trim() })} /></Field>}
          {legs.ret && <Field label={`${t('ord.retTracking')} (${!legs.outbound && o.project === 'ENDEAVOR' ? t('c.required') : t('c.optional')})`} help={t('ord.retHelp')}><input className="mono" value={form.return_tracking} onChange={(e) => setForm({ ...form, return_tracking: e.target.value.toUpperCase().trim() })} /></Field>}
          <Field label={t('ord.shipDate')}><input type="date" value={form.shipped_at} onChange={(e) => setForm({ ...form, shipped_at: e.target.value })} /></Field>
          {!legs.outbound && <Field label={t('ord.handoverNote')}><input value={form.handover_note || ''} onChange={(e) => setForm({ ...form, handover_note: e.target.value })} /></Field>}
        </Modal>
      )}
      {modal === 'deliver' && (
        <Modal title={t('ord.deliver')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.post(`/orders/${o.id}/deliver`, form))}>{t('c.confirm')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('ord.deliverDate')}><input type="date" value={form.delivered_at} onChange={(e) => setForm({ delivered_at: e.target.value })} /></Field>
        </Modal>
      )}
      {modal === 'sample' && (
        <Modal title={t('ord.sample')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.post(`/orders/${o.id}/sample-received`, { received_at: form.received_at, site: form.site || null }))}>{t('c.confirm')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('ord.sampleDate')}><input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} /></Field>
          {project === 'LIFESTYLE' && <Field label={t('ord.site')}><select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })}>{sites.map((s) => <option key={s}>{s}</option>)}<option value="">—</option></select></Field>}
        </Modal>
      )}
      {modal === 'track' && (
        <Modal title={t('ord.editTracking')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.put(`/orders/${o.id}/shipments/${form.sid}`, { tracking_number: form.tracking_number || null, shipped_at: form.shipped_at || null }))}>{t('c.save')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('ord.tracking')}><input className="mono" value={form.tracking_number} onChange={(e) => setForm({ ...form, tracking_number: e.target.value.toUpperCase().trim() })} /></Field>
          <Field label={t('ord.shipDate')}><input type="date" value={form.shipped_at} onChange={(e) => setForm({ ...form, shipped_at: e.target.value })} /></Field>
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={async () => { setErr(null); try { const r = await api.post(`/orders/${o.id}/shipments/${form.sid}/refresh`); if (!r.ok) toast(t('ord.noProvider'), 'err'); else toast(t(`tr.${r.status}`)); reload(); } catch (e) { setErr(e); } }}>{t('ord.refreshTracking')}</button>
        </Modal>
      )}
      {modal === 'edit' && (
        <Modal title={t('c.edit')} wide onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.put(`/orders/${o.id}`, { external_ref: form.external_ref || null, shipping_mode_id: form.shipping_mode_id || null, patient_title: form.patient_title || null, patient_first_name: form.patient_first_name, patient_last_name: form.patient_last_name, address1: form.address1, address2: form.address2 || null, city: form.city, province: form.province || null, zip: form.zip || null, country: form.country, phone: form.phone || null, email: form.email || '', lang: form.lang, notes: form.notes || null }))}>{t('c.save')}</button></>}>
          <ErrorBox error={err} />
          <OrderForm value={form} onChange={setForm} project={project} modes={modes.data} showKit={false} lockMode={!['NEW', 'ASSIGNED'].includes(o.status)} />
        </Modal>
      )}
      {modal === 'cancel' && <PromptModal danger title={t('ord.cancel')} label={t('c.reason')} confirmText={t('ord.cancel')} onClose={() => setModal(null)} onConfirm={async (reason) => { await api.post(`/orders/${o.id}/cancel`, { reason }); reload(); }} />}
    </div>
  );
}
