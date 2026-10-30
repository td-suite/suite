import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n.jsx';
import { Badge, Field, Icon, useApi } from './ui.jsx';
import { api, qs } from '../api.js';
import { ScanButton } from './scan.jsx';
import { STATUS_TONE, TRACK_TONE, KIT_TONE, LAB_TONE, BILL_TONE, fdate, modeName, patientName, requesterName, projectPath } from '../format.js';

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
  const H = { ref: t('c.ref'), patient: project === 'LIFESTYLE' ? t('req.recipient') : t('c.patient'), requester: t('req.title'), kit: t('c.kit'), mode: project === 'LIFESTYLE' ? t('c.type') : t('c.mode'), status: t('c.status'), tracking: t('ord.tracking'), date: t('c.created'), shipped: t('ship.shippedAt'), delivered: t('ord.deliveredOn'), sample: t('ord.sampleOn') };
  if (!rows) return <div className="empty">{t('c.loading')}</div>;
  if (!rows.length) return <div className="empty">{empty || t('c.none')}</div>;
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr>{columns.map((c) => <th key={c}>{H[c]}</th>)}{actions && <th />}</tr></thead>
      <tbody>{rows.map((o) => (
        <tr key={o.id}>
          {columns.map((c) => {
            if (c === 'ref') return <td key={c}><Link to={`/${projectPath(o.project)}/richieste/${o.id}`} className="strong mono">{o.external_ref || `#${o.id}`}</Link></td>;
            if (c === 'patient') return <td key={c}><div className="strong">{patientName(o)}</div><div className="small muted">{[o.city, o.province].filter(Boolean).join(' ')}</div>{o.requester_kind === 'LEGAL_ENTITY' && !columns.includes('requester') && <div className="small"><span className="muted">{t('req.short')}:</span> {requesterName(o)}</div>}</td>;
            if (c === 'requester') return <td key={c}>{o.requester_kind === 'LEGAL_ENTITY' ? <><div className="strong row" style={{ gap: 6 }}><Icon name="building" size={14} />{requesterName(o)}</div>{o.requester_contact && <div className="small muted">{o.requester_contact}</div>}</> : <><div>{patientName(o)}</div><div className="small muted">{t('req.PERSONA')}</div></>}</td>;
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
export const emptyOrder = (project) => ({ project, order_type: project === 'ENDEAVOR' ? 'ENDEAVOR' : 'KIT_ONLY', external_ref: '', shipping_mode_id: '', patient_title: '', patient_first_name: '', patient_last_name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'Italia', phone: '', email: '', lang: project === 'ENDEAVOR' ? 'en' : 'it', notes: '', barcode: '',
  requester_kind: 'PERSONA', requester_org_id: null, requester_org_name: '', requester_contact: '', requester_email: '', requester_phone: '' });

// Campi della richiesta da inviare al server (POST /orders, conferma dalla posta in arrivo, PUT): via i campi solo di interfaccia
export function orderPayload(x) {
  const { mode_text, warnings, in_stock, kit_status, legs, quantity, requester_name, requester_vat, requester_org_name, requester_org_vat, requester_org_kind, ...o } = x;
  const le = o.requester_kind === 'LEGAL_ENTITY';
  return { ...o, shipping_mode_id: o.shipping_mode_id || null, email: o.email || null, barcode: o.barcode || null, patient_first_name: o.patient_first_name || '',
    requester_kind: le ? 'LEGAL_ENTITY' : 'PERSONA', requester_org_id: le ? (o.requester_org_id || null) : null,
    requester_contact: le ? (o.requester_contact || null) : null, requester_email: le ? (o.requester_email || null) : null, requester_phone: le ? (o.requester_phone || null) : null };
}
// La richiesta è completa per il salvataggio? (stesse regole del server: routes/orders.js checkRequester)
export function orderReady(o, project) {
  if (!o.patient_last_name || !o.address1 || !o.city) return false;
  if (project === 'ENDEAVOR' && !o.shipping_mode_id) return false;
  if (o.requester_kind === 'LEGAL_ENTITY') return Boolean(o.requester_org_id);
  return Boolean(o.patient_first_name);
}

// Ricerca di una Legal entity della Suite (public.organizations, tranne gruppo e società TD) per nome, P.IVA o codice fiscale
export function OrgPicker({ value, label, onPick, autoFocus }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let on = true;
    if (dq.trim().length < 2) { setRows([]); return undefined; }
    api.get(`/organizations${qs({ q: dq })}`, { silent: true }).then((r) => on && setRows(r)).catch(() => on && setRows([]));
    return () => { on = false; };
  }, [dq]);
  if (value) {
    return <div className="row" style={{ gap: 8 }}><Icon name="building" size={16} /><span className="strong">{label || `#${value}`}</span><button type="button" className="btn sm ghost" onClick={() => { onPick(null); setQ(''); }}>{t('req.change')}</button></div>;
  }
  return (
    <div className="orgpick">
      <input value={q} autoFocus={autoFocus} placeholder={t('req.searchPh')} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} />
      {open && dq.trim().length >= 2 && <div className="list">{rows.length ? rows.map((o) => (
        <button type="button" key={o.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o); setOpen(false); setQ(''); }}>
          <div className="strong">{o.name}</div><div className="small muted">{[o.vat_number && `P.IVA ${o.vat_number}`, o.tax_code && o.tax_code !== o.vat_number && `CF ${o.tax_code}`, o.city, t(`orgKind.${o.kind}`)].filter(Boolean).join(' · ')}</div>
        </button>)) : <div className="small muted" style={{ padding: 10 }}>{t('req.noOrg')}</div>}</div>}
    </div>
  );
}

// Blocco "Richiedente" (Lifestyle): Persona (il destinatario stesso) oppure Legal entity con referente, email e telefono
export function RequesterBlock({ value, onChange, extra }) {
  const { t } = useT();
  const le = value.requester_kind === 'LEGAL_ENTITY';
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const setKind = (k) => onChange({ ...value, requester_kind: k });
  return (
    <div className="reqbox span-all">
      <div className="row" style={{ marginBottom: le ? 10 : 0 }}>
        <span className="small strong muted">{t('req.title')}</span>
        <div className="seg" role="radiogroup">{['PERSONA', 'LEGAL_ENTITY'].map((k) => <label key={k} className={value.requester_kind === k ? 'on' : ''}><input type="radio" checked={value.requester_kind === k} onChange={() => setKind(k)} />{t(`req.${k}`)}</label>)}</div>
        {!le && <span className="small muted">{t('req.personaHelp')}</span>}
        {extra}
      </div>
      {le && <div className="form-grid">
        <Field label={t('req.org')} className="span2"><OrgPicker value={value.requester_org_id} label={value.requester_org_name} onPick={(o) => onChange({ ...value, requester_org_id: o?.id || null, requester_org_name: o?.name || '', requester_email: value.requester_email || o?.email || '', requester_phone: value.requester_phone || o?.phone || '' })} /></Field>
        <Field label={t('req.contact')}><input value={value.requester_contact || ''} onChange={set('requester_contact')} /></Field>
        <Field label={t('req.email')} help={t('req.emailHelp')}><input type="email" value={value.requester_email || ''} onChange={set('requester_email')} /></Field>
        <Field label={t('req.phone')}><input value={value.requester_phone || ''} onChange={set('requester_phone')} /></Field>
      </div>}
    </div>
  );
}

export function OrderForm({ value, onChange, project, modes, showKit = true, lockMode = false, compact = false, requesterExtra }) {
  const { t, lang } = useT();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const ms = (modes || []).filter((m) => m.project === 'ENDEAVOR');
  const le = value.requester_kind === 'LEGAL_ENTITY';
  // con richiedente Legal entity il destinatario può essere la Legal entity stessa (nessun paziente nominato)
  const recipientIsOrg = () => onChange({ ...value, patient_title: '', patient_first_name: '', patient_last_name: value.requester_org_name || value.patient_last_name, email: value.email || '' });
  return (
    <div className="form-grid">
      {project === 'LIFESTYLE' && <RequesterBlock value={value} onChange={onChange} extra={requesterExtra} />}
      {project === 'LIFESTYLE' && <div className="span-all small strong muted row" style={{ marginBottom: -6 }}>{t('req.recipientTitle')}{le && value.requester_org_name && <button type="button" className="btn sm ghost" onClick={recipientIsOrg}>{t('req.recipientIsOrg')}</button>}</div>}
      <Field label={t('ord.extRef')} help={compact ? null : t('ord.extRefHelp')}><input value={value.external_ref || ''} onChange={set('external_ref')} /></Field>
      {project === 'ENDEAVOR'
        ? <Field label={t('ord.mode')}><select value={value.shipping_mode_id || ''} onChange={(e) => onChange({ ...value, shipping_mode_id: Number(e.target.value) || '' })} disabled={lockMode}><option value="">—</option>{ms.map((m) => <option key={m.id} value={m.id}>{lang === 'en' ? m.name_en : m.name_it} · {Number(m.price).toFixed(2)} €</option>)}</select></Field>
        : <Field label={t('ord.type')}><select value={value.order_type} onChange={set('order_type')} disabled={lockMode}><option value="KIT_ONLY">{t('type.KIT_ONLY')}</option><option value="KIT_AND_EXAM">{t('type.KIT_AND_EXAM')}</option></select></Field>}
      <Field label={t('ord.title_')}><input value={value.patient_title || ''} onChange={set('patient_title')} placeholder="Ms / Mr / Sig.ra" /></Field>
      <Field label={t('ord.first')} help={le && !compact ? t('req.firstHelp') : null}><input value={value.patient_first_name || ''} onChange={set('patient_first_name')} required={!le} /></Field>
      <Field label={le ? t('req.lastOrOrg') : t('ord.last')}><input value={value.patient_last_name || ''} onChange={set('patient_last_name')} required /></Field>
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
