import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, Empty, ErrorBox, Badge, Field, MoneyInput, Modal, useToast } from '../components/ui.jsx';
import { useCompany } from '../components/company.jsx';
import { eur, ROLE } from '../format.js';

// Sostituisce la pagina Utenti dell'app: gli account, i profili e le sedi assegnate si gestiscono nella Suite
// (Amministrazione > Utenti). Qui resta il fondo cassa personale dell'operatore, dato del processo di cassa.
export default function Operators() {
  const { user } = useAuth();
  const toast = useToast();
  const { company, Selector } = useCompany();
  const list = useApi(user.role === 'SUPERADMIN' && company ? `/users?company_id=${company}` : '/users');
  const sites = useApi('/sites?all=1');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const siteName = (id) => sites.data?.find((s) => s.id === id)?.name || `#${id}`;
  const rows = list.data || [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Operatori e fondo cassa</h1><div className="sub">Utenti del modulo con ruolo, azienda e sedi assegnate. Account, profili e sedi si gestiscono nella Suite (Amministrazione, Utenti); qui si imposta il fondo cassa personale degli operatori.</div></div>
        <Selector />
      </div>
      <ErrorBox error={err || list.error} />
      {!list.data ? <Loading /> : !rows.length ? <div className="card"><Empty>Nessun utente</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th>{user.role === 'SUPERADMIN' && <th>Azienda</th>}<th>Sedi</th><th className="num">Fondo cassa</th><th>Stato</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} style={{ opacity: u.active ? 1 : .55 }}>
              <td className="strong">{u.full_name}</td>
              <td className="small" style={{ wordBreak: 'break-all' }}>{u.email}</td>
              <td><Badge tone={u.role === 'SUPERADMIN' ? 'teal' : u.role === 'ADMIN' ? 'blue' : 'grey'}>{ROLE[u.role] || u.role}</Badge></td>
              {user.role === 'SUPERADMIN' && <td className="small muted">{u.company_name || '–'}</td>}
              <td className="small">{(u.site_ids || []).length ? (u.site_ids || []).map((id) => <span key={id} className="chip" style={{ whiteSpace: 'nowrap' }}>{siteName(id)}</span>) : <span className="muted">{['ADMIN', 'FINANCE', 'SUPERADMIN'].includes(u.role) ? 'tutta l\'azienda' : '–'}</span>}</td>
              <td className="num">{u.role === 'OPERATOR' ? (u.cash_float != null ? eur(u.cash_float) : <span className="muted">fondo della sede</span>) : <span className="muted">–</span>}</td>
              <td>{u.active ? <Badge tone="green">Attivo</Badge> : <Badge>Disattivato</Badge>}</td>
              <td className="num">{u.role === 'OPERATOR' && <button className="btn sm ghost" onClick={() => setEdit(u)}>Fondo cassa</button>}</td>
            </tr>))}</tbody>
        </table></div></div>
      )}
      {edit && <FloatModal u={edit} onClose={() => setEdit(null)} onSave={async (v) => { setErr(null); try { await api.put(`/users/${edit.id}/cash-float`, { cash_float: v === '' ? null : Number(v) }); toast('Fondo cassa aggiornato'); setEdit(null); list.reload(); } catch (e) { setErr(e); } }} />}
    </div>
  );
}

function FloatModal({ u, onClose, onSave }) {
  const [v, setV] = useState(u.cash_float ?? '');
  return (
    <Modal title={`Fondo cassa di ${u.full_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={() => onSave(v)}>Salva</button></>}>
      <Field label="Fondo cassa dell'operatore" help="Vuoto: vale il fondo cassa della sede. Si applica ai rendiconti aperti da ora in poi."><MoneyInput value={v} onChange={setV} autoFocus /></Field>
    </Modal>
  );
}
