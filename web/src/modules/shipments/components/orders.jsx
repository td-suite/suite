import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n.jsx';
import { Badge, Field, useApi } from './ui.jsx';
import { ScanButton } from './scan.jsx';
import { STATUS_TONE, TRACK_TONE, KIT_TONE, LAB_TONE, BILL_TONE, fdate, modeName, patientName, projectPath } from '../format.js';

export function StatusBadge({ status }) { const { t } = useT(); return <Badge tone={STATUS_TONE[status] || 'grey'}>{t(`st.${status}`)}</Badge>; }
export function KitBadge({ status }) { const { t } = useT(); return <Badge tone={KIT_TONE[status] || 'grey'}>{t(`kst.${status}`)}</Badge>; }
export function TrackBadge({ status }) { const { t } = useT(); return status ? <Badge tone={TRACK_TONE[status] || 'grey'}>{t(`tr.${status}`)}</Badge> : null; }
export function LabBadge({ status }) { const { t } = useT(); return <Badge tone={LAB_TONE[status] || 'grey'}>{t(`lab.${status}`)}</Badge>; }
export function BillBadge({ status }) { const { t } = useT(); return <Badge tone={BILL_TONE[status] || 'grey'}>{t(`bill.${status}`)}</Badge>; }

export function ModeOrType({ o }) {
  const { t, lang } = useT();
  if (o.project === 'LIFESTYLE') return <span className="pill">{t(`type.${o.order_type}`)}</span>;
  return <span>{modeName(o, lang) || <span className="muted">–</span>}</span>;
}

// Tabella richieste riutilizzata in più pagine
export function OrdersTable({ rows, project, columns = ['ref', 'patient', 'kit', 'mode', 'status', 'tracking', 'date'], empty, actions }) {
  const { t } = useT();
  const H = { ref: t('c.ref'), patient: t('c.patient'), kit: t('c.kit'), mode: project === 'LIFESTYLE' ? t('c.type') : t('c.mode'), status: t('c.status'), tracking: t('ord.tracking'), date: t('c.created'), shipped: t('ship.shippedAt'), delivered: t('ord.deliveredOn'), sample: t('ord.sampleOn') };
  if (!rows) return <div className="empty">{t('c.loading')}</div>;
  if (!rows.length) return <div className="empty">{empty || t('c.none')}</div>;
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr>{columns.map((c) => <th key={c}>{H[c]}</th>)}{actions && <th />}</tr></thead>
      <tbody>{rows.map((o) => (
        <tr key={o.id}>
          {columns.map((c) => {
            if (c === 'ref') return <td key={c}><Link to={`/${projectPath(o.project)}/richieste/${o.id}`} className="strong mono">{o.external_ref || `#${o.id}`}</Link></td>;
            if (c === 'patient') return <td key={c}><div className="strong">{patientName(o)}</div><div className="small muted">{[o.city, o.province].filter(Boolean).join(' ')}</div></td>;
            if (c === 'kit') return <td key={c} className="mono">{o.barcode || <span className="muted">–</span>}</td>;
            if (c === 'mode') return <td key={c}><ModeOrType o={o} /></td>;
            if (c === 'status') return <td key={c}><StatusBadge status={o.status} />{o.handover ? <div className="mini">{t('ord.handover').split(':')[0]}</div> : null}</td>;
            if (c === 'tracking') return <td key={c} className="small">{o.out_tracking && <div><span className="mono">{o.out_tracking}</span> <TrackBadge status={o.out_status} /></div>}{o.ret_tracking && <div className="muted"><span className="mono">{o.ret_tracking}</span> <TrackBadge status={o.ret_status} /></div>}{!o.out_tracking && !o.ret_tracking && <span className="muted">–</span>}</td>;
            if (c === 'date') return <td key={c} className="small muted">{fdate(o.created_at)}</td>;
            if (c === 'shipped') return <td key={c} className="small">{fdate(o.shipped_at)}</td>;
            if (c === 'delivered') return <td key={c} className="small">{fdate(o.delivered_at)}</td>;
            if (c === 'sample') return <td key={c} className="small">{fdate(o.sample_received_at)}</td>;
            return <td key={c} />;
          })}
          {actions && <td className="num">{actions(o)}</td>}
        </tr>))}</tbody>
    </table></div>
  );
}

// Campo barcode con scansione
export function BarcodeInput({ value, onChange, onEnter, placeholder, autoFocus }) {
  const { t } = useT();
  return (
    <div className="scanbox">
      <input value={value} autoFocus={autoFocus} placeholder={placeholder || t('c.barcode')} onChange={(e) => onChange(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }} />
      <ScanButton label={t('c.scan')} title={t('c.barcode')} onCode={(c) => { onChange(c.toUpperCase()); setTimeout(() => onEnter?.(c.toUpperCase()), 50); }} />
    </div>
  );
}

// Form dati richiesta (nuova manuale, modifica, conferma da email)
export const emptyOrder = (project) => ({ project, order_type: project === 'ENDEAVOR' ? 'ENDEAVOR' : 'KIT_ONLY', external_ref: '', shipping_mode_id: '', patient_title: '', patient_first_name: '', patient_last_name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'Italia', phone: '', email: '', lang: project === 'ENDEAVOR' ? 'en' : 'it', notes: '', barcode: '' });

export function OrderForm({ value, onChange, project, modes, showKit = true, lockMode = false, compact = false }) {
  const { t, lang } = useT();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const ms = (modes || []).filter((m) => m.project === 'ENDEAVOR');
  return (
    <div className="form-grid">
      <Field label={t('ord.extRef')} help={compact ? null : t('ord.extRefHelp')}><input value={value.external_ref || ''} onChange={set('external_ref')} /></Field>
      {project === 'ENDEAVOR'
        ? <Field label={t('ord.mode')}><select value={value.shipping_mode_id || ''} onChange={(e) => onChange({ ...value, shipping_mode_id: Number(e.target.value) || '' })} disabled={lockMode}><option value="">—</option>{ms.map((m) => <option key={m.id} value={m.id}>{lang === 'en' ? m.name_en : m.name_it} · {Number(m.price).toFixed(2)} €</option>)}</select></Field>
        : <Field label={t('ord.type')}><select value={value.order_type} onChange={set('order_type')} disabled={lockMode}><option value="KIT_ONLY">{t('type.KIT_ONLY')}</option><option value="KIT_AND_EXAM">{t('type.KIT_AND_EXAM')}</option></select></Field>}
      <Field label={t('ord.title_')}><input value={value.patient_title || ''} onChange={set('patient_title')} placeholder="Ms / Mr / Sig.ra" /></Field>
      <Field label={t('ord.first')}><input value={value.patient_first_name || ''} onChange={set('patient_first_name')} required /></Field>
      <Field label={t('ord.last')}><input value={value.patient_last_name || ''} onChange={set('patient_last_name')} required /></Field>
      <Field label={t('ord.addr1')} className="span2"><input value={value.address1 || ''} onChange={set('address1')} required /></Field>
      <Field label={t('ord.addr2')}><input value={value.address2 || ''} onChange={set('address2')} /></Field>
      <Field label={t('ord.zip')}><input value={value.zip || ''} onChange={set('zip')} /></Field>
      <Field label={t('c.city')}><input value={value.city || ''} onChange={set('city')} required /></Field>
      <Field label={t('ord.prov')}><input value={value.province || ''} onChange={set('province')} maxLength={40} /></Field>
      <Field label={t('ord.country')}><input value={value.country || ''} onChange={set('country')} /></Field>
      <Field label={t('c.phone')}><input value={value.phone || ''} onChange={set('phone')} /></Field>
      <Field label={t('c.email')}><input type="email" value={value.email || ''} onChange={set('email')} /></Field>
      <Field label={t('ord.langP')}><select value={value.lang || 'it'} onChange={set('lang')}><option value="it">Italiano</option><option value="en">English</option></select></Field>
      {showKit && <Field label={t('inbox.assignNow')} help={t('ord.assignHelp')}><input className="mono" value={value.barcode || ''} onChange={(e) => onChange({ ...value, barcode: e.target.value.toUpperCase() })} /></Field>}
      <Field label={t('c.notes')} className="span2"><input value={value.notes || ''} onChange={set('notes')} /></Field>
    </div>
  );
}

export function useModes() { return useApi('/modes'); }
export function useSettingsPublic() { return useApi('/settings/public'); }

// Date input con default oggi
export function DateField({ label, value, onChange }) {
  return <Field label={label}><input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} /></Field>;
}

export function useDebounce(v, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]); return d; }
