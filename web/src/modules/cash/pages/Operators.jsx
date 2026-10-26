import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, Empty, ErrorBox, Badge, Field, MoneyInput, Modal, Icon, useToast } from '../components/ui.jsx';
import { useCompany } from '../components/company.jsx';
import { eur, ROLE } from '../format.js';

// Nessuna seconda anagrafica degli operatori: gli operatori di Cash sono gli utenti della Suite con un grant sul modulo
// (Amministrazione > Utenti). Qui l'elenco è in sola lettura: cognome e nome, email, profilo Cash, sedi del perimetro, stato,
// con il collegamento alla scheda utente per modificare. L'unico campo di Cash per persona è il fondo cassa dell'operatore.
const ADMIN_USERS = '/admin/users';
const STATUS = { ACTIVE: ['Attivo', 'green'], PENDING: ['In attesa', 'amber'], DISABLED: ['Disattivato', 'grey'] };

export default function Operators() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { company, Selector } = useCompany();
  const list = useApi(sup && company ? `/users?company_id=${company}` : '/users');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = (list.data || []).filter((u) => !q || [u.full_name, u.email, ROLE[u.role], ...(u.sites || []).map((s) => `${s.name} ${s.code}`)].join(' ').toLowerCase().includes(q));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Operatori</h1><div className="sub">Le persone con accesso al modulo Cash sono gli utenti della Suite: profilo, sedi e stato si modificano in Amministrazione, Utenti. Qui si imposta solo il fondo cassa personale degli operatori.</div></div>
        <div className="row">
          <Selector />
          <Link className="btn ghost" to={ADMIN_USERS}><Icon name="external" size={16} />Apri in Utenti</Link>
        </div>
      </div>
      <ErrorBox error={err || list.error} />
      {!list.data ? <Loading /> : !list.data.length ? <div className="card"><Empty>Nessun utente con accesso al modulo Cash. Gli accessi si assegnano in <Link to={ADMIN_USERS}>Amministrazione, Utenti</Link>.</Empty></div> : (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}><input placeholder="Cerca per nome, email, profilo o sede" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} /><span className="small muted">{rows.length} {rows.length === 1 ? 'persona' : 'persone'}</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Cognome e nome</th><th>Email</th><th>Profilo Cash</th>{sup && <th>Azienda</th>}<th>Sedi</th><th className="num">Fondo cassa</th><th>Stato</th><th /></tr></thead>
            <tbody>{rows.map((u) => {
              const [label, tone] = STATUS[u.status] || [u.status, 'grey'];
              return (
                <tr key={u.id} style={{ opacity: u.active ? 1 : .55 }}>
                  <td className="strong">{u.full_name}</td>
                  <td className="small" style={{ minWidth: 200, overflowWrap: 'anywhere' }}>{u.email}</td>
                  <td><Badge tone={u.role === 'SUPERADMIN' ? 'teal' : u.role === 'ADMIN' ? 'blue' : 'grey'}>{ROLE[u.role] || u.role}</Badge></td>
                  {sup && <td className="small muted">{u.company_name || '–'}</td>}
                  <td className="small">{(u.sites || []).length ? u.sites.map((s) => <span key={s.id} className="chip" style={{ whiteSpace: 'nowrap' }} title={s.code}>{s.name} <span className="mono muted">{s.code}</span></span>) : <span className="muted">{['ADMIN', 'FINANCE', 'SUPERADMIN'].includes(u.role) ? 'tutta l\'azienda' : 'nessuna sede'}</span>}</td>
                  <td className="num">{u.role === 'OPERATOR' ? (u.cash_float != null ? eur(u.cash_float) : <span className="muted">fondo della sede</span>) : <span className="muted">–</span>}</td>
                  <td><Badge tone={tone}>{label}</Badge></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {u.role === 'OPERATOR' && <button className="btn sm ghost" onClick={() => setEdit(u)}>Fondo cassa</button>}
                    {' '}<Link className="btn sm ghost" to={`${ADMIN_USERS}/${u.id}`} title="Modifica profilo, sedi e stato nella Suite"><Icon name="external" size={14} />Apri in Utenti</Link>
                  </td>
                </tr>);
            })}</tbody>
          </table></div>
        </div>
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
