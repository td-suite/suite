// Recupero Crediti: pezzi comuni alle pagine
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, useToast, Modal, Field, ErrorBox } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { api, base } from './api.js';
import { useAuth } from './auth.jsx';
import { STATO_CLIENTE } from './format.js';

/** Avviso fisso della modalità: in Prova nulla esce. */
export function Modalita() {
  const { state } = useAuth();
  if (state?.modalita === 'ATTIVA') return null;
  return <div className="cr-prova"><Icon name="info" /><div><strong>Modalità Prova.</strong> Le comunicazioni vengono preparate e mostrate, ma nessuna email parte e nessuna fase avanza. La modalità Attiva la decidono CEO o CFO dalle Impostazioni.</div></div>;
}
export const StatoCliente = ({ stato }) => { const s = STATO_CLIENTE[stato] || { label: stato, tone: 'grey' }; return <Badge tone={s.tone}>{s.label}</Badge>; };
export const LinkCliente = ({ id, children }) => <Link to={`${base}/clienti/${id}`} className="cr-link">{children}</Link>;

/** Esegue una chiamata con messaggio di esito, aggiorna i contatori del menu e ricarica. */
export function useAzione(reload) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const fai = async (fn, ok = 'Fatto') => {
    setBusy(true);
    try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok); window.dispatchEvent(new Event('suite:badges')); await reload?.(); return r; }
    catch (e) { toast(e.message, 'err'); return null; } finally { setBusy(false); }
  };
  return { fai, busy };
}
export { api };

/** Finestra con campi semplici: campi = [{ k, label, type, required, help, options }]. */
export function Modulo({ title, campi, iniziale = {}, conferma = 'Conferma', onConfirm, onClose, intro, danger }) {
  const [v, setV] = useState(iniziale); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const manca = campi.some((c) => c.required && !String(v[c.k] ?? '').trim());
  const go = async (e) => { e?.preventDefault(); setBusy(true); setErr(null); try { await onConfirm(v); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className={`btn ${danger ? 'danger' : ''}`} disabled={busy || manca} onClick={go}>{conferma}</button></>}>
      <ErrorBox error={err} />
      {intro && <p className="small">{intro}</p>}
      <form onSubmit={go} className="form-grid">
        {campi.map((c) => (
          <Field key={c.k} label={c.label} help={c.help} required={c.required}>
            {c.type === 'textarea' ? <textarea value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />
              : c.type === 'select' ? <select value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: e.target.value })}><option value="">Scegli</option>{c.options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
                : <input type={c.type || 'text'} step={c.type === 'number' ? '0.01' : undefined} value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />}
          </Field>))}
      </form>
    </Modal>
  );
}
