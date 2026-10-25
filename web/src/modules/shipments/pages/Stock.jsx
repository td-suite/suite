import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, canOperate } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Kpi, Modal, Field, ErrorBox, Loading, Empty, PromptModal, useApi, useToast } from '../components/ui.jsx';
import { KitBadge, BarcodeInput, useDebounce } from '../components/orders.jsx';
import { fdate, fdt, num, projectPath, today } from '../format.js';
import { ScanButton } from '../components/scan.jsx';

const KSTATES = ['IN_STOCK', 'ASSIGNED', 'SHIPPED', 'DELIVERED', 'SAMPLE_RECEIVED', 'SHIPPED_TO_LAB', 'CLOSED', 'DISCARDED'];

export default function Stock({ project }) {
  const { t } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('IN_STOCK');
  const [lotId, setLotId] = useState('');
  const dq = useDebounce(q);
  const summary = useApi(`/kits/summary?project=${project}`);
  const kits = useApi(`/kits${qs({ project, status, q: dq, lot_id: lotId, limit: 500 })}`);
  const types = useApi('/kit-types');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(null);
  const [discard, setDiscard] = useState(null);
  const [err, setErr] = useState(null);
  const p = projectPath(project);
  const reload = () => { summary.reload(); kits.reload(); };
  const byStatus = Object.fromEntries((summary.data?.byStatus || []).map((x) => [x.status, x.n]));
  const codes = (form?.codes || '').split(/[\n,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const uniq = [...new Set(codes)];
  const load = async () => {
    setErr(null);
    try {
      if (form.lot_id) { await api.post(`/kits/lots/${form.lot_id}/kits`, { barcodes: uniq }); } else { await api.post('/kits/lots', { project, supplier: form.supplier, received_at: form.received_at, reference: form.reference || null, notes: form.notes || null, kit_type_id: form.kit_type_id ? Number(form.kit_type_id) : null, barcodes: uniq }); }
      toast(t('stock.loaded', { n: uniq.length })); setModal(null); reload();
    } catch (e) { setErr(e); }
  };
  const addCode = (c) => setForm((f) => ({ ...f, codes: (f.codes ? f.codes.replace(/\s*$/, '') + '\n' : '') + c.toUpperCase() + '\n' }));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('stock.title')}</h1><div className="sub">{t('stock.sub')}</div></div>
        {op && <button className="btn" onClick={() => { setErr(null); setForm({ supplier: project === 'ENDEAVOR' ? 'Endeavor DNA' : 'Toscana Diagnostica', received_at: today(), reference: '', notes: '', kit_type_id: '', codes: '' }); setModal('lot'); }}>+ {t('stock.new')}</button>}
      </div>
      <ErrorBox error={err} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label={t('stock.inStock')} value={num(byStatus.IN_STOCK || 0)} accent />
        <Kpi label={t('kst.ASSIGNED')} value={num(byStatus.ASSIGNED || 0)} />
        <Kpi label={`${t('kst.SHIPPED')} / ${t('kst.DELIVERED')}`} value={num((byStatus.SHIPPED || 0) + (byStatus.DELIVERED || 0))} />
        <Kpi label={t('kst.DISCARDED')} value={num(byStatus.DISCARDED || 0)} />
      </div>
      <div className="grid g3">
        <Card title={t('stock.lots')} flush>
          {!summary.data ? <Loading /> : !summary.data.lots.length ? <Empty>{t('c.none')}</Empty> : (
            <table className="t"><thead><tr><th>{t('stock.receivedAt')}</th><th>{t('stock.reference')}</th><th className="num">{t('stock.kits')}</th><th /></tr></thead>
              <tbody>{summary.data.lots.map((l) => (
                <tr key={l.id} className={`click ${lotId === String(l.id) ? 'sel' : ''}`} onClick={() => { setLotId(lotId === String(l.id) ? '' : String(l.id)); setStatus(''); }}>
                  <td>{fdate(l.received_at)}<div className="small muted">{l.supplier}</div></td><td className="small">{l.reference || '–'}{l.notes && <div className="muted">{l.notes}</div>}</td><td className="num"><b>{l.in_stock}</b> / {l.kits}</td>
                  <td className="num">{op && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setErr(null); setForm({ lot_id: l.id, codes: '' }); setModal('lot'); }}>+</button>}</td>
                </tr>))}</tbody></table>
          )}
        </Card>
        <Card title={t('stock.kits')} className="span2" flush>
          <div className="inner tight">
            <div className="filters" style={{ marginBottom: 10 }}>
              <Field label={t('stock.lookup')}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.barcode')} /></Field>
              <Field label={t('stock.filter')}><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('c.all')}</option>{KSTATES.map((s) => <option key={s} value={s}>{t(`kst.${s}`)}</option>)}</select></Field>
              {lotId && <button className="btn sm ghost" onClick={() => setLotId('')}>{t('stock.lots')}: #{lotId} ✕</button>}
            </div>
          </div>
          {!kits.data ? <Loading /> : !kits.data.length ? <Empty>{t('c.none')}</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>{t('c.barcode')}</th><th>{t('c.status')}</th><th>{t('stock.receivedAt')}</th><th>{t('ord.title')}</th><th /></tr></thead>
              <tbody>{kits.data.map((k) => (
                <tr key={k.id}>
                  <td className="mono strong">{k.barcode}{k.kit_type && <div className="small muted" style={{ fontFamily: 'var(--font)' }}>{k.kit_type}</div>}</td>
                  <td><KitBadge status={k.status} />{k.discard_reason && <div className="small red">{k.discard_reason}</div>}</td>
                  <td className="small">{fdate(k.lot_received_at)}{k.lot_reference && <div className="muted">{k.lot_reference}</div>}</td>
                  <td className="small">{k.order_id ? <Link to={`/${p}/richieste/${k.order_id}`} className="strong">{k.external_ref || `#${k.order_id}`}</Link> : <span className="muted">–</span>}{k.patient_last_name && <div className="muted">{k.patient_last_name} {k.patient_first_name}</div>}</td>
                  <td className="num">{op && k.status === 'IN_STOCK' && <button className="btn sm danger" onClick={() => setDiscard(k)}>{t('stock.discard')}</button>}{op && k.status === 'DISCARDED' && <button className="btn sm ghost" onClick={async () => { await api.post(`/kits/${k.id}/restore`); reload(); }}>{t('stock.restore')}</button>}</td>
                </tr>))}</tbody></table></div>
          )}
        </Card>
      </div>
      {modal === 'lot' && form && (
        <Modal title={form.lot_id ? t('stock.addToLot') : t('stock.new')} wide onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>{t('c.cancel')}</button><button className="btn" disabled={!uniq.length || (!form.lot_id && !form.received_at)} onClick={load}>{t('stock.load', { n: uniq.length })}</button></>}>
          <ErrorBox error={err} />
          {!form.lot_id && <div className="form-grid" style={{ marginBottom: 12 }}>
            <Field label={t('stock.supplier')}><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
            <Field label={t('stock.receivedAt')}><input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} /></Field>
            <Field label={t('stock.reference')}><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label={t('stock.kitType')}><select value={form.kit_type_id} onChange={(e) => setForm({ ...form, kit_type_id: e.target.value })}><option value="">—</option>{(types.data || []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label={t('c.notes')} className="span2"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>}
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><div className="small muted">{t('stock.codesHelp')}</div><ScanButton label={t('c.scan')} title={t('c.barcode')} onCode={addCode} /></div>
          <Field label={`${t('stock.codes')} · ${t('stock.count', { n: uniq.length })}`}><textarea rows={10} autoFocus value={form.codes} onChange={(e) => setForm({ ...form, codes: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 14, textTransform: 'uppercase' }} /></Field>
        </Modal>
      )}
      {discard && <PromptModal danger title={`${t('stock.discardTitle')} ${discard.barcode}`} label={t('c.reason')} placeholder={t('stock.discardHelp')} confirmText={t('stock.discard')} onClose={() => setDiscard(null)} onConfirm={async (reason) => { await api.post(`/kits/${discard.id}/discard`, { reason }); reload(); }} />}
    </div>
  );
}
