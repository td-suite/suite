import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, Empty, Badge, Modal, ErrorBox, Card, Icon, useToast } from '../components/ui.jsx';
import { KIND, monthLabel } from '../format.js';

// Strutture: anagrafica unica della Suite (public.sites, con l'organizzazione cliente per le strutture Service) e impostazioni
// Ordini della sede (site_ext). Qui non si creano, rinominano o disattivano sedi: si fa in Amministrazione > Sedi. Si modificano
// solo i campi operativi del modulo: ruolo nel flusso ordini, codice Silva, giorno limite della giacenza, referente consegne, note.
const ADMIN_SITES = '/admin/sites';
const SITE_KIND = { HEADQUARTER: 'Direzione', LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', SERVICE: 'Struttura cliente Service', CENTRO_MEDICO: 'Centro medico', ALTRO: 'Altro' };
const FIELDS = ['kind', 'silva_code', 'stock_deadline_day', 'referente', 'referente_phone', 'delivery_mode', 'delivery_notes', 'notes'];

export default function Strutture() {
  const { user } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [show, setShow] = useState('active');   // active | all
  const { data, reload } = useApi(`/strutture${show === 'all' ? '?all=1' : ''}`, [show]);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const rows = (data || []).filter((s) => (!kind || s.kind === kind) && (!search || `${s.code} ${s.name} ${s.city || ''} ${s.organization_name || ''} ${s.silva_code || ''} ${s.studiolab_code || ''}`.toLowerCase().includes(search.toLowerCase())));
  const unconfigured = (data || []).filter((s) => !s.configured).length;
  const openEdit = (s) => setEdit({ id: s.id, code: s.code, name: s.name, site_kind: s.site_kind, configured: s.configured, kind: s.kind, silva_code: s.silva_code || '', stock_deadline_day: s.stock_deadline_day, referente: s.referente || '', referente_phone: s.referente_phone || '', delivery_mode: s.delivery_mode || 'GIRO', delivery_notes: s.delivery_notes || '', notes: s.notes || '' });
  const save = async () => {
    setErr(null);
    const b = Object.fromEntries(FIELDS.map((k) => [k, edit[k] === '' ? null : edit[k]]));
    b.stock_deadline_day = Number(b.stock_deadline_day) || null;
    try { await api.put(`/strutture/${edit.id}`, b); toast(edit.configured ? 'Impostazioni Ordini salvate' : 'Sede configurata in Ordini'); setEdit(null); reload(); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Strutture</h1><div className="sub">Sedi e strutture clienti dell'anagrafica unica della Suite con le impostazioni di Ordini e Magazzino: ruolo nel flusso (cliente Service ordina dal catalogo, sede del network dichiara la giacenza entro il 15, laboratorio TD entro il 30), codice Silva, referente per le consegne. Nome, indirizzo, contatti e stato si modificano in Amministrazione.</div></div>
        <div className="row">
          <Field label="Cerca"><input placeholder="Codice, nome, città, cliente" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Ruolo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutti</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Mostra"><select value={show} onChange={(e) => setShow(e.target.value)}><option value="active">Sedi attive</option><option value="all">Anche disattivate</option></select></Field>
          <a className="btn ghost" href={ADMIN_SITES} title="Creare, rinominare o disattivare una sede si fa in Amministrazione"><Icon name="building" size={16} />Apri in Amministrazione</a>
        </div>
      </div>
      <ErrorBox error={err} />
      {unconfigured > 0 && <div className="alert info" style={{ marginBottom: 12 }}>{unconfigured} {unconfigured === 1 ? 'sede usa' : 'sedi usano'} le impostazioni predefinite (ruolo dedotto dal tipo di sede, giacenza entro il 15 o il 30): apri "Impostazioni" per confermarle o cambiarle.</div>}
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna sede{data && !data.length && <>: le sedi si caricano in <a href={ADMIN_SITES}>Amministrazione</a></>}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice</th><th>Sede</th><th>Ruolo in Ordini</th><th>Referente consegne</th><th>Codici</th><th className="num">Ordini aperti</th><th className="num">In giacenza</th><th>Stato</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{s.code}</td>
                <td><div className="strong">{s.name}</div><div className="small muted">{[SITE_KIND[s.site_kind] || s.site_kind, s.organization_name, s.city].filter(Boolean).join(' · ')}</div>{s.email && <div className="small muted">{s.email}</div>}</td>
                <td>{KIND[s.kind]}{s.kind !== 'CLIENTE' && <div className="small muted">giacenza entro il {s.stock_deadline_day}{s.last_stock_month ? ` · ultima ${monthLabel(s.last_stock_month)}` : ''}</div>}{!s.configured && <div className="small"><Badge tone="mauve">predefinito</Badge></div>}</td>
                <td className="small">{s.referente || <span className="muted">–</span>}{s.referente_phone && <div className="muted">{s.referente_phone}</div>}{s.delivery_mode === 'RITIRO' && <div className="muted">ritiro presso TD</div>}</td>
                <td className="mono small" style={{ whiteSpace: 'nowrap' }}><div title="Codice StudioLab">SL {s.studiolab_code || '–'}</div><div title="Codice Silva">SV {s.silva_code || '–'}</div></td>
                <td className="num"><Link to={`${BASE}/ordini?struttura_id=${s.id}`}>{s.open_orders}</Link></td>
                <td className="num">{s.packs_in_stock}</td>
                <td>{s.active ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Disattiva</Badge>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><Link className="btn sm ghost" to={`${BASE}/giacenza?struttura_id=${s.id}`}>Giacenza</Link> <button className="btn sm ghost" onClick={() => openEdit(s)}>Impostazioni</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && (
        <Modal title={`Impostazioni Ordini · ${edit.name}`} onClose={() => setEdit(null)} wide footer={<><a className="btn ghost" href={ADMIN_SITES}>Dati anagrafici in Amministrazione</a><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 12 }}>Sede {edit.code} · {SITE_KIND[edit.site_kind] || edit.site_kind}. Nome, indirizzo di consegna, email e telefono vengono dall'anagrafica unica.</div>
          <div className="form-grid">
            <Field label="Ruolo nel flusso ordini" help="Cliente Service ordina dal catalogo; sede del network e laboratorio TD caricano, scaricano e dichiarano la giacenza mensile"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value, stock_deadline_day: e.target.value === 'LAB' ? 30 : e.target.value === 'SEDE' ? 15 : edit.stock_deadline_day })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Codice cliente Silva (magazzino)" help="Destinazione comunicata al fornitore; se vuoto si usa il codice della sede"><input value={edit.silva_code} onChange={(e) => setEdit({ ...edit, silva_code: e.target.value.toUpperCase() })} /></Field>
            {edit.kind !== 'CLIENTE' && <Field label="Giacenza mensile entro il giorno"><input type="number" min="1" max="31" value={edit.stock_deadline_day} onChange={(e) => setEdit({ ...edit, stock_deadline_day: e.target.value })} /></Field>}
            <Field label="Modalità di consegna"><select value={edit.delivery_mode} onChange={(e) => setEdit({ ...edit, delivery_mode: e.target.value })}><option value="GIRO">Giro logistico TD</option><option value="RITIRO">Ritiro presso TD</option></select></Field>
            <Field label="Referente per le consegne"><input value={edit.referente} onChange={(e) => setEdit({ ...edit, referente: e.target.value })} /></Field>
            <Field label="Telefono referente"><input value={edit.referente_phone} onChange={(e) => setEdit({ ...edit, referente_phone: e.target.value })} /></Field>
            <Field label="Note per la consegna" className="span2"><textarea value={edit.delivery_notes} onChange={(e) => setEdit({ ...edit, delivery_notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
            <Field label="Note interne" className="span2"><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
