import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, canEditKind, isAdmin } from '../auth.jsx';
import { api, qs, BASE } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, StatusBadge, KindBadge, ConfirmModal, Icon, useToast } from '../components/ui.jsx';
import { itDate, STATUS, KIND, DOSSIER_STATUS } from '../format.js';

const SUB = {
  PP: 'Contratti di appalto con le strutture ospitanti dei punti prelievo decentrati: proposta, sottoscrizione, fascicolo di autorizzazione sanitaria, attivazione.',
  SRV: 'Lettere di offerta per esami di laboratorio in service (TD-SGI-MOD230): anagrafica, logistica dei ritiri, privacy, listino e credenziali del portale.',
  MDL: 'Lettere di offerta per prestazioni di Medicina del Lavoro (TD-SGI-MOD231): anagrafica, riferimenti, privacy, listino e credenziali del portale.',
  SEDE: 'Sedi intestate a Toscana Diagnostica con contratto di locazione (laboratorio, punti prelievo e centri polidiagnostici flagship): canone, contratto e allegati, fascicolo di autorizzazione.',
};

export default function Contracts({ kind }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const status = sp.get('status') || '';
  const year = sp.get('year') || '';
  const list = useApi(`/contracts${qs({ kind, status, year, q })}`);
  const rows = list.data || [];
  const toast = useToast();
  const [del, setDel] = useState(null);
  // Cestino a fine riga: bozze per chi gestisce la sezione, contratti protocollati solo per il Superamministratore
  const canDelete = (r) => (r.status === 'BOZZA' ? canEditKind(user, r.kind) : isAdmin(user));
  const doDelete = async () => { try { await api.del(`/contracts/${del.id}`); toast('Contratto eliminato'); list.reload(); } catch (e) { toast(e.message, 'err'); } setDel(null); };
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const years = [2026, 2027, 2028, 2029, 2030];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{kind ? KIND[kind].label : 'Tutti i contratti'}</h1><div className="sub">{kind ? SUB[kind] : 'Punti prelievo, service di laboratorio e medicina del lavoro in un unico elenco.'}</div></div>
        {kind && canEditKind(user, kind) && <Link className="btn" to={`${BASE}/contratti/nuovo/${kind}`}>{kind === 'SEDE' ? '+ Nuova sede' : '+ Nuova proposta'}</Link>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="controparte, sede TD, protocollo…" style={{ minWidth: 260 }} /></Field>
        <Field label="Stato"><select value={status} onChange={(e) => set('status', e.target.value)}><option value="">Tutti</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Anno"><select value={year} onChange={(e) => set('year', e.target.value)}><option value="">Tutti</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        <div className="spacer" />
        <div className="small muted">{rows.length} contratti</div>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Protocollo</th>{!kind && <th>Sezione</th>}<th>Controparte</th><th>Sede TD</th><th>Oggetto</th><th>Proposta</th><th>Firma</th><th>Documenti</th><th>Stato</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => nav(`${BASE}/contratti/${r.id}`)}>
              <td className="mono">{r.protocol || <span className="muted">bozza #{r.id}</span>}</td>
              {!kind && <td><KindBadge kind={r.kind} /></td>}
              <td>{r.org_name ? <><div className="strong">{r.org_name}</div><div className="small muted">{[r.org_city, r.org_prov].filter(Boolean).join(' ')}{r.org_vat ? ` · P.IVA ${r.org_vat}` : ''}</div></> : <span className="muted">–</span>}</td>
              <td>{r.site_name ? <><div className="strong">{r.site_name}</div><div className="small muted">{[r.site_street, r.site_city].filter(Boolean).join(', ')}{r.site_code ? ` · ${r.site_code}` : ''}</div></> : <span className="muted">–</span>}</td>
              <td className="small">{r.title}</td>
              <td>{itDate(r.proposal_date)}</td>
              <td>{r.signed_at ? itDate(r.signed_at) : <span className="muted">–</span>}</td>
              <td>
                {r.signed_files > 0 && <Badge tone="green">firmato</Badge>}{' '}
                {['SRV', 'MDL'].includes(r.kind) && (r.price_lists > 0 ? <Badge tone="blue">listino</Badge> : r.status !== 'BOZZA' ? <Badge tone="red">senza listino</Badge> : null)}{' '}
                {r.dossier_status && <Badge tone={DOSSIER_STATUS[r.dossier_status].tone}>fascicolo: {DOSSIER_STATUS[r.dossier_status].label.toLowerCase()}</Badge>}
              </td>
              <td><StatusBadge status={r.status} /></td>
              <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(r) && <button className="iconbtn danger" title="Elimina il contratto" aria-label="Elimina" onClick={() => setDel(r)}><Icon name="trash" /></button>}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessun contratto con questi filtri</Empty>}</Card>
      {del && <ConfirmModal danger title="Eliminare il contratto?" confirmText="Elimina" onClose={() => setDel(null)} onConfirm={doDelete}
        text={`${del.protocol ? `${del.protocol} · ` : ''}${del.title || ''}${del.org_name ? ` (${del.org_name})` : ''}: vengono cancellati definitivamente documenti, cronologia, credenziali e, se c'è, il fascicolo di autorizzazione collegato. La Legal entity resta in Amministrazione.`} />}
    </div>
  );
}
