import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, API_BASE } from '../api.js';
import { useAuth, canOperate } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Modal, Field, ErrorBox, Loading, Empty, Icon, useApi, useToast } from '../components/ui.jsx';
import { LabBadge, TrackBadge, BarcodeInput, OrdersTable } from '../components/orders.jsx';
import { fdate, fdt, patientName, projectPath, today } from '../format.js';

export default function Lab({ project }) {
  const { id } = useParams();
  return id ? <LabDetail project={project} id={Number(id)} /> : <LabList project={project} />;
}

function LabList({ project }) {
  const { t } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const nav = useNavigate();
  const queue = useApi(`/orders${qs({ project, awaiting_lab: 1, limit: 500 })}`);
  const labs = useApi('/lab');
  const [sel, setSel] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ awb_number: '', awb_received_at: '', notes: '' });
  const [err, setErr] = useState(null);
  const p = projectPath(project);
  const toggle = (oid) => setSel((s) => (s.includes(oid) ? s.filter((x) => x !== oid) : [...s, oid]));
  const create = async () => {
    setErr(null);
    try { const l = await api.post('/lab', { order_ids: sel, awb_number: form.awb_number || null, awb_received_at: form.awb_received_at || null, notes: form.notes || null }); toast(t('c.saved')); nav(`/${p}/laboratorio/${l.id}`); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('labp.title')}</h1><div className="sub">{t('labp.sub')}</div></div></div>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Card title={`${t('labp.queue')} (${queue.data?.length ?? '…'})`} flush actions={op && <button className="btn" disabled={!sel.length} onClick={() => { setErr(null); setModal(true); }}>{t('labp.create', { n: sel.length })}</button>}>
          <div className="inner tight"><div className="small muted">{t('labp.createdNote')}</div>{op && queue.data?.length > 0 && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setSel(sel.length === queue.data.length ? [] : queue.data.map((o) => o.id))}>{t('labp.select')}: {t('c.all')}</button>}</div>
          {!queue.data ? <Loading /> : !queue.data.length ? <Empty>{t('c.none')}</Empty> : (
            <table className="t"><tbody>{queue.data.map((o) => (
              <tr key={o.id} className={`click ${sel.includes(o.id) ? 'sel' : ''}`} onClick={() => op && toggle(o.id)}>
                {op && <td style={{ width: 30 }}><input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} onClick={(e) => e.stopPropagation()} /></td>}
                <td className="mono strong">{o.barcode}</td><td><Link to={`/${p}/richieste/${o.id}`} onClick={(e) => e.stopPropagation()} className="mono">{o.external_ref || `#${o.id}`}</Link><div className="small">{patientName(o)}</div></td><td className="small muted">{t('ord.sampleOn')} {fdate(o.sample_received_at)}</td>
              </tr>))}</tbody></table>
          )}
        </Card>
        <Card title={t('labp.list')} flush>
          {!labs.data ? <Loading /> : !labs.data.length ? <Empty>{t('c.none')}</Empty> : (
            <table className="t"><thead><tr><th>FedEx AWB</th><th>{t('c.status')}</th><th className="num">{t('c.kit')}</th><th>{t('c.date')}</th></tr></thead><tbody>{labs.data.map((l) => (
              <tr key={l.id} className="click" onClick={() => nav(`/${p}/laboratorio/${l.id}`)}>
                <td className="mono strong">{l.awb_number || <span className="muted" style={{ fontFamily: 'var(--font)' }}>{t('labp.noAwb')}</span>}</td>
                <td><LabBadge status={l.status} /> {l.tracking_status && l.status === 'SHIPPED' && <TrackBadge status={l.tracking_status} />}</td>
                <td className="num">{l.kits}</td><td className="small muted">{l.shipped_at ? `${t('ship.shippedAt')} ${fdate(l.shipped_at)}` : `${t('c.created')} ${fdate(l.created_at)}`}</td>
              </tr>))}</tbody></table>
          )}
        </Card>
      </div>
      {modal && (
        <Modal title={t('labp.new')} onClose={() => setModal(false)} footer={<><button className="btn ghost" onClick={() => setModal(false)}>{t('c.cancel')}</button><button className="btn" onClick={create}>{t('labp.create', { n: sel.length })}</button></>}>
          <ErrorBox error={err} />
          <div className="small" style={{ marginBottom: 10 }}>{sel.map((oid) => <span key={oid} className="chip mono">{queue.data.find((o) => o.id === oid)?.barcode}</span>)}</div>
          <Field label={`${t('labp.awb')} (${t('c.optional')})`} help={t('labp.noAwb')}><input className="mono" value={form.awb_number} onChange={(e) => setForm({ ...form, awb_number: e.target.value.trim() })} /></Field>
          <Field label={t('labp.awbDate')}><input type="date" value={form.awb_received_at} onChange={(e) => setForm({ ...form, awb_received_at: e.target.value })} /></Field>
          <Field label={t('c.notes')}><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function LabDetail({ project, id }) {
  const { t, lang } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const nav = useNavigate();
  const { data: l, reload } = useApi(`/lab/${id}`);
  const [form, setForm] = useState(null);
  const [addCode, setAddCode] = useState('');
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  const p = projectPath(project);
  if (!l) return <Loading />;
  const f = form || { awb_number: l.awb_number || '', awb_received_at: l.awb_received_at || '', notes: l.notes || '' };
  const act = async (fn, msg) => { setErr(null); try { await fn(); toast(msg || t('c.saved')); setModal(null); reload(); } catch (e) { setErr(e); } };
  const upload = async (file) => { const fd = new FormData(); fd.append('file', file); await act(() => api.upload(`/lab/${id}/awb`, fd)); };
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="small muted"><Link to={`/${p}/laboratorio`}>{t('labp.title')}</Link></div>
          <h1 className="row">FedEx <span className="mono">{l.awb_number || `#${l.id}`}</span> <LabBadge status={l.status} />{l.shipment && <TrackBadge status={l.shipment.last_status} />}</h1>
          <div className="sub">{l.orders.length} {t('c.kit').toLowerCase()} · {t('c.created')} {fdt(l.created_at)} {l.created_by_name && `· ${l.created_by_name}`}{l.shipped_at && ` · ${t('ship.shippedAt')} ${fdate(l.shipped_at)}`}{l.delivered_at && ` · ${t('ord.deliveredOn')} ${fdate(l.delivered_at)}`}</div></div>
        <div className="row">
          <a className="btn ghost" href={`${API_BASE}/lab/${id}/sheet.pdf`} target="_blank" rel="noreferrer"><Icon name="print" size={16} />{t('labp.packing')}</a>
          {l.has_awb_file && <a className="btn ghost" href={`${API_BASE}/lab/${id}/awb`} target="_blank" rel="noreferrer">{t('labp.awbFile')}</a>}
          {op && l.status !== 'PREPARING' && <button className="btn ghost" onClick={() => act(() => api.post(`/lab/${id}/undo`))}>{t('c.undo')}</button>}
          {op && l.status === 'PREPARING' && <button className="btn danger" onClick={() => act(async () => { await api.del(`/lab/${id}`); nav(`/${p}/laboratorio`); })}>{t('c.delete')}</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="next" style={{ marginBottom: 16 }}>
        <div style={{ flex: 1 }}><b>{t('ord.next')}</b>{l.status === 'PREPARING' ? (l.awb_number ? t('labp.ship') : t('labp.noAwb')) : l.status === 'SHIPPED' ? t('ord.next.SHIPPED_TO_LAB') : t('ord.next.CLOSED')}</div>
        {op && l.status === 'PREPARING' && <button className="btn" disabled={!l.awb_number} onClick={() => setModal('ship')}>{t('labp.ship')}</button>}
        {op && l.status === 'SHIPPED' && <button className="btn" onClick={() => setModal('deliver')}>{t('labp.deliver')}</button>}
        {op && l.status === 'SHIPPED' && <button className="btn ghost" onClick={async () => { const r = await api.post(`/lab/${id}/refresh`); if (!r.ok) toast(t('ord.noProvider'), 'err'); reload(); }}>{t('ord.refreshTracking')}</button>}
      </div>
      <div className="grid g3">
        <Card title={t('labp.awb')}>
          <Field label={t('labp.awb')}><input className="mono" value={f.awb_number} disabled={!op} onChange={(e) => setForm({ ...f, awb_number: e.target.value.trim() })} /></Field>
          <Field label={t('labp.awbDate')}><input type="date" value={f.awb_received_at || ''} disabled={!op} onChange={(e) => setForm({ ...f, awb_received_at: e.target.value })} /></Field>
          <Field label={t('c.notes')}><textarea rows={2} value={f.notes} disabled={!op} onChange={(e) => setForm({ ...f, notes: e.target.value })} /></Field>
          {op && <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={!form} onClick={() => act(() => api.put(`/lab/${id}`, { awb_number: f.awb_number || null, awb_received_at: f.awb_received_at || null, notes: f.notes || null }).then(() => setForm(null)))}>{t('c.save')}</button>
            <label className="btn ghost">{t('labp.upload')}<input type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
          </div>}
          {l.shipment?.url && <a className="small" href={l.shipment.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 10 }}>FedEx tracking ↗</a>}
          {l.shipment?.last_status_text && <div className="small muted">{l.shipment.last_status_text}</div>}
        </Card>
        <Card title={`${t('labp.kits')} (${l.orders.length})`} className="span2" flush>
          {op && l.status === 'PREPARING' && <div className="inner tight"><div className="small muted" style={{ marginBottom: 6 }}>{t('labp.scanAdd')}</div><BarcodeInput value={addCode} onChange={setAddCode} onEnter={(c) => act(() => api.put(`/lab/${id}`, { barcodes: [c || addCode] }).then(() => setAddCode('')))} /></div>}
          <table className="t"><thead><tr><th>{t('c.kit')}</th><th>{t('c.ref')}</th><th>{t('c.patient')}</th><th>{t('ord.sampleOn')}</th><th>{t('c.status')}</th><th /></tr></thead>
            <tbody>{l.orders.map((o) => (
              <tr key={o.id}><td className="mono strong">{o.barcode}</td><td><Link to={`/${p}/richieste/${o.id}`} className="mono">{o.external_ref || `#${o.id}`}</Link></td><td>{patientName(o)}<div className="small muted">{o.city}</div></td><td className="small">{fdate(o.sample_received_at)}</td><td><span className="pill">{t(`st.${o.status}`)}</span></td>
                <td className="num">{op && l.status === 'PREPARING' && <button className="btn sm ghost" onClick={() => act(() => api.put(`/lab/${id}`, { remove_order_ids: [o.id] }))}>{t('labp.remove')}</button>}</td></tr>))}</tbody></table>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><Card title={t('labp.notify')} flush actions={op && <button className="btn sm ghost" onClick={() => act(() => api.post(`/lab/${id}/notify`))}>{t('labp.resend')}</button>}>
        {!l.emails.length ? <div className="empty">{t('c.none')}</div> : <table className="t"><tbody>{l.emails.map((e) => (
          <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fdt(e.sent_at)}</td><td><div className="strong">{e.subject}</div><div className="small muted">{e.to_addr}</div></td><td><span className={`badge ${e.status === 'INVIATA' ? 'b-green' : e.status === 'FALLITA' ? 'b-red' : 'b-grey'}`}>{e.status}</span>{e.error && <div className="small red">{e.error}</div>}</td></tr>))}</tbody></table>}
      </Card></div>
      {modal === 'ship' && (
        <Modal title={t('labp.ship')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.post(`/lab/${id}/ship`, { shipped_at: f.shipped_at || today() }))}>{t('c.confirm')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('labp.shipDate')}><input type="date" value={f.shipped_at || today()} onChange={(e) => setForm({ ...f, shipped_at: e.target.value })} /></Field>
        </Modal>
      )}
      {modal === 'deliver' && (
        <Modal title={t('labp.deliver')} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" onClick={() => act(() => api.post(`/lab/${id}/deliver`, { delivered_at: f.delivered_at || today() }))}>{t('c.confirm')}</button></>}>
          <ErrorBox error={err} />
          <Field label={t('ord.deliverDate')}><input type="date" value={f.delivered_at || today()} onChange={(e) => setForm({ ...f, delivered_at: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
