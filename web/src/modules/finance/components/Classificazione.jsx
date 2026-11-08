// Controllo di gestione: classificazione di un'istanza di pagamento per il conto economico di sede e il margine per cliente Service.
// "Sede / centro di costo" (sedi TD dell'anagrafica unica), "Cliente" (clienti Service e Medicina del Lavoro attivi o contrattualizzati)
// e "fuori dal conto economico" (pagamento già contato in un'altra riga). Tutto facoltativo; non fa parte del contenuto firmato.
import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Field, Modal, ErrorBox, Card, Badge } from './ui.jsx';

export function SelettoriPL({ value, onChange, compact = false }) {
  const sedi = useApi('/controllo/sedi');
  const clienti = useApi('/controllo/clienti');
  const v = value || {};
  const set = (k, x) => onChange({ ...v, [k]: x });
  const orgInElenco = !v.org_id || (clienti.data || []).some((c) => c.id === Number(v.org_id));
  return (
    <>
      <Field label="Sede / centro di costo (conto economico)" help={compact ? '' : 'Facoltativa. Senza sede il pagamento va tra i costi centrali, ripartiti sulle sedi in proporzione ai ricavi.'}>
        <select value={v.site_id || ''} onChange={(e) => set('site_id', e.target.value ? Number(e.target.value) : null)} aria-label="Sede / centro di costo">
          <option value="">Nessuna sede (costi centrali)</option>
          {(sedi.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (chiusa)'}</option>)}
        </select>
      </Field>
      <Field label="Cliente (margine Service)" help={compact ? '' : 'Facoltativo. Il pagamento entra nei costi diretti del cliente; senza sede va al Laboratorio.'}>
        <select value={v.org_id || ''} onChange={(e) => set('org_id', e.target.value ? Number(e.target.value) : null)} aria-label="Cliente">
          <option value="">Nessun cliente</option>
          {!orgInElenco && <option value={v.org_id}>{v.pl_org_name || `Legal entity n. ${v.org_id}`} (non più cliente attivo)</option>}
          {(clienti.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.linee}</option>)}
        </select>
      </Field>
      <Field label="Conto economico" className="span2 inline">
        <input type="checkbox" checked={Boolean(v.pl_escluso)} onChange={(e) => set('pl_escluso', e.target.checked)} />{' '}
        fuori dal conto economico: già contato altrove (stipendi e contributi, canoni e bollette dello Scadenziario, rate, imposte)
      </Field>
    </>
  );
}

// Riquadro nella scheda dell'istanza: classificazione corrente e modifica (Finance Support e amministratori), in ogni stato
export function ClassificazioneCard({ r, canEdit, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try { await api.put(`/requests/${r.id}/classificazione`, { site_id: edit.site_id || null, org_id: edit.org_id || null, pl_escluso: Boolean(edit.pl_escluso) }); setEdit(null); onSaved?.(); }
    catch (e) { setErr(e); }
  };
  return (
    <Card title="Controllo di gestione" actions={canEdit && <button className="btn sm ghost" onClick={() => setEdit({ site_id: r.site_id, org_id: r.org_id, pl_escluso: r.pl_escluso, pl_org_name: r.pl_org_name })}>Modifica</button>}>
      <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>Sede / centro di costo: <b>{r.pl_site_name || 'nessuna (costi centrali)'}</b></div>
        <div>Cliente: <b>{r.pl_org_name || 'nessuno'}</b></div>
        <div>{r.pl_escluso ? <Badge tone="mauve">fuori dal conto economico</Badge> : r.notes?.startsWith('Scadenziario:') ? <Badge>dallo Scadenziario: già in canone o utenze</Badge> : <Badge tone="teal">nel conto economico</Badge>}</div>
        <div className="muted">Non fa parte del contenuto firmato: si può correggere anche dopo firma ed esecuzione.</div>
      </div>
      {edit && (
        <Modal title="Classificazione per il controllo di gestione" onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid"><SelettoriPL value={edit} onChange={setEdit} /></div>
        </Modal>
      )}
    </Card>
  );
}
