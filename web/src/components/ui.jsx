import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, isUnavailable } from '../api.js';
import { Icon } from './Icons.jsx';
import { initials, nameColor } from '../format.js';

// ---------- Toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg: msg?.message || String(msg), kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}><Icon name={t.kind === 'err' ? 'alert' : 'check'} />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Indicatore di attività ----------
export function BusyBar() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = (e) => setN(e.detail);
    window.addEventListener('suite:busy', h);
    return () => window.removeEventListener('suite:busy', h);
  }, []);
  return <div className={`busybar ${n > 0 ? 'on' : ''}`} role="progressbar" aria-hidden={n === 0}><i /></div>;
}

// ---------- Caricamento dati ----------
export function useApi(url, deps = [], opts = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const load = useCallback(async () => {
    if (!url) return setState({ data: null, error: null, loading: false });
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api.get(url, { silent: opts.silent !== false }), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, unavailable: isUnavailable(state.error), reload: load };
}

// ---------- Stati ----------
export function Skeleton({ lines = 3, block }) {
  if (block) return <span className="sk block" aria-hidden="true" />;
  return <div aria-hidden="true">{Array.from({ length: lines }).map((_, i) => <span key={i} className={`sk line ${i === lines - 1 ? 'w60' : i % 2 ? 'w80' : ''}`} />)}</div>;
}
export function Loading({ text = 'Caricamento in corso' }) { return <div className="empty"><Skeleton lines={2} /><span className="small">{text}</span></div>; }
export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert err" role="alert"><Icon name="alert" /><span>{error.message || String(error)}</span></div>;
}
export function Empty({ icon = 'info', title, children, compact }) {
  return <div className={`empty ${compact ? 'compact' : ''}`}><Icon name={icon} />{title && <div className="t">{title}</div>}{children && <div className="small">{children}</div>}</div>;
}
// Servizio non ancora collegato (endpoint 404/503): mai una schermata rotta
export function Coming({ what = 'Questa sezione', compact }) {
  return <div className={`coming ${compact ? 'compact' : ''}`}><Badge tone="silk">In arrivo</Badge><div>{what} sarà disponibile a breve.</div></div>;
}

// ---------- Primitive ----------
export function Badge({ tone = 'grey', children, dot = true, title }) { return <span className={`badge b-${tone} ${dot ? '' : 'nodot'}`} title={title}>{children}</span>; }
export function Field({ label, help, children, className = '', required }) {
  return (
    <label className={`f ${className}`}>
      <span>{label}{required && <span className="req"> *</span>}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}
export function Card({ title, icon, actions, children, flush, className = '', style, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`card ${className}`} style={style} {...rest}>
      {(title || actions) && <div className="hd"><h2>{icon && <Icon name={icon} />}{title}</h2><div className="spacer" />{actions}</div>}
      <div className={`bd ${flush ? 'flush' : ''}`}>{children}</div>
    </Tag>
  );
}
export function Kpi({ label, value, unit, foot, accent, delta, children, unavailable, hint }) {
  const d = delta == null ? null : Number(delta);
  return (
    <div className={`card kpi ${accent ? 'accent' : ''} ${unavailable ? 'unavailable' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{unavailable ? 'Sorgente non collegata' : value}{!unavailable && unit && <small>{unit}</small>}</div>
      {d != null && !unavailable && <div><span className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`}><Icon name={d > 0 ? 'arrowUp' : d < 0 ? 'arrowDown' : 'arrowRight'} />{d > 0 ? '+' : ''}{d.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</span></div>}
      {(foot || hint) && <div className="foot">{foot || hint}</div>}
      {children}
    </div>
  );
}
export function Switch({ checked, onChange, disabled, label }) {
  return <span className="switch"><input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange?.(e.target.checked)} disabled={disabled} aria-label={label} /><i /></span>;
}
export function Avatar({ name, fileId, size, className = '' }) {
  const n = name || '?';
  return (
    <span className={`avatar ${size || ''} ${className}`} style={{ background: fileId ? 'var(--teal-050)' : nameColor(n) }} aria-hidden="true">
      {fileId ? <img src={`/api/files/${fileId}`} alt="" /> : initials(n)}
    </span>
  );
}
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mh"><h2>{title}</h2><div className="spacer" /><button className="iconbtn" onClick={onClose} aria-label="Chiudi"><Icon name="x" /></button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}
export function ConfirmModal({ title, text, confirmText = 'Conferma', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const go = async () => { setBusy(true); setErr(null); try { await onConfirm(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className={`btn ${danger ? 'danger' : ''}`} disabled={busy} onClick={go}>{confirmText}</button></>}>
      <ErrorBox error={err} />
      <p>{text}</p>
    </Modal>
  );
}
export function PromptModal({ title, label, placeholder, confirmText = 'Conferma', onConfirm, onClose, minLength = 1, type = 'text', help }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async (e) => { e?.preventDefault(); setBusy(true); setErr(null); try { await onConfirm(v.trim()); onClose(); } catch (e2) { setErr(e2); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || v.trim().length < minLength} onClick={go}>{confirmText}</button></>}>
      <ErrorBox error={err} />
      <form onSubmit={go}><Field label={label} help={help}>{type === 'textarea' ? <textarea autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} /> : <input autoFocus type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />}</Field></form>
    </Modal>
  );
}

// Menu a tendina con chiusura al clic esterno
export function Popover({ open, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    const k = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`menu-pop ${className}`}>{children}</div>;
}

export function PageHead({ title, icon, sub, actions, crumb }) {
  return (
    <>
      {crumb && <div className="crumb">{crumb}</div>}
      <div className="page-head">
        <div><h1>{icon && <Icon name={icon} />}{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </>
  );
}

export function Tabs({ value, onChange, items }) {
  return <div className="tabs" role="tablist">{items.map((t) => <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}{t.count != null && ` (${t.count})`}</button>)}</div>;
}

export function Seg({ value, onChange, items, label }) {
  return <div className="seg" role="group" aria-label={label}>{items.map((t) => <button key={t.value} type="button" className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}</button>)}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Cerca', autoFocus, onSubmit }) {
  return (
    <div className="search-input">
      <Icon name="search" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit?.(value)} />
    </div>
  );
}

// Selettore multiplo semplice (chip + select)
export function MultiSelect({ value = [], onChange, options, placeholder = 'Aggiungi', labelOf = (o) => o.name }) {
  const chosen = options.filter((o) => value.includes(o.id));
  const rest = options.filter((o) => !value.includes(o.id));
  return (
    <div className="multi">
      {chosen.map((o) => <span key={o.id} className="chip">{labelOf(o)}<button type="button" aria-label={`Rimuovi ${labelOf(o)}`} onClick={() => onChange(value.filter((v) => v !== o.id))}><Icon name="x" /></button></span>)}
      <select value="" onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)])} aria-label={placeholder}>
        <option value="">{placeholder}</option>
        {rest.map((o) => <option key={o.id} value={o.id}>{labelOf(o)}</option>)}
      </select>
    </div>
  );
}

export function CopyButton({ text, label = 'Copia' }) {
  const toast = useToast();
  return <button type="button" className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Copiato negli appunti'); } catch { toast('Copia non riuscita', 'err'); } }}><Icon name="copy" />{label}</button>;
}

export function Pager({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span>{total} elementi · pagina {page} di {pages}</span>
      <button className="btn sm ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Precedente</button>
      <button className="btn sm ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Successiva</button>
    </div>
  );
}

// Zona di trascinamento file
export function DropZone({ onFiles, accept, multiple = true, children, compact }) {
  const [over, setOver] = useState(false);
  const ref = useRef(null);
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0} aria-label="Carica file"
      onClick={() => ref.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...e.dataTransfer.files]; if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1)); }}>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { const fs = [...e.target.files]; if (fs.length) onFiles(fs); e.target.value = ''; }} />
      {children || <><Icon name="upload" /><div className={compact ? 'small' : ''}>Trascina qui i file oppure clicca per sceglierli</div></>}
    </div>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('td-theme') || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    try { if (theme === 'auto') localStorage.removeItem('td-theme'); else localStorage.setItem('td-theme', theme); } catch { /* ignora */ }
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const toggle = () => setTheme(isDark ? 'light' : 'dark');
  return { theme, isDark, toggle, setTheme };
}

// Logo che segue il tema: versione scura su fondo chiaro, bianca su fondo scuro
export function Logo({ className = '', alt = 'Toscana Diagnostica' }) {
  return <>
    <img className={`logo-d ${className}`} src="/logo-dark.svg" alt={alt} />
    <img className={`logo-l ${className}`} src="/logo-light.svg" alt="" aria-hidden="true" />
  </>;
}
