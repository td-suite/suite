import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, canWrite, isAdmin } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, Modal, useToast, Kpi } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { eur0, num, SITE_KIND } from '../format.js';

export default function Sites() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const list = useApi('/sites?all=1');
  const [edit, setEdit] = useState(null);
  const rows = list.data || [];
  const byKind = Object.entries(SITE_KIND).map(([k, l]) => [l, rows.filter((s) => s.active && s.kind === k).length]).filter((x) => x[1]);
  const save = async () => {
    try {
      const b = { ...edit }; delete b.id; for (const k of ['exposure_items', 'exposure_ok', 'revenue_ytd', 'created_at', 'updated_at']) delete b[k];
      b.lat = b.lat === '' || b.lat == null ? null : Number(b.lat); b.lng = b.lng === '' || b.lng == null ? null : Number(b.lng); b.sqm_waiting = b.sqm_waiting === '' || b.sqm_waiting == null ? null : Number(b.sqm_waiting); b.sort_order = Number(b.sort_order) || 100;
      for (const k of Object.keys(b)) if (b[k] === '') b[k] = null;
      if (edit.id) await api.put(`/sites/${edit.id}`, b); else await api.post('/sites', b);
      toast('Sede salvata'); setEdit(null); list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi del network</h1><div className="sub">Punti prelievo, centri diagnostici, poliambulatori e laboratorio. Clicca una sede per la scheda struttura: profilo, persone, orari, dotazioni, bacino e chi vende di più.</div></div>
        {canWrite(user) && <button className="btn" onClick={() => setEdit({ kind: 'PUNTO_PRELIEVI', active: true, sort_order: 100 })}>+ Nuova sede</button>}
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Sedi attive" value={num(rows.filter((s) => s.active && s.kind !== 'HEADQUARTER').length)} foot={byKind.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(' · ')} />
        <Kpi label="Fatturato anno in corso" value={eur0(rows.reduce((a, s) => a + Number(s.revenue_ytd || 0), 0))} foot="tutte le sedi" />
        <Kpi label="Province" value={num(new Set(rows.filter((s) => s.active).map((s) => s.province)).size)} foot={[...new Set(rows.filter((s) => s.active).map((s) => s.province))].join(', ')} />
        <Kpi label="Insegne integrate" value={num(new Set(rows.map((s) => s.legacy_brand).filter(Boolean)).size)} foot={[...new Set(rows.map((s) => s.legacy_brand).filter(Boolean))].join(', ')} />
      </div>
      <ErrorBox error={list.error} />
      <Card flush>
        {!list.data ? <Loading /> : !rows.length ? <Empty>Nessuna sede</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th>Tipologia</th><th>Indirizzo</th><th>Site manager</th><th>Insegna precedente</th><th className="num">Fatturato YTD</th><th className="num">Esposizione</th><th /></tr></thead>
            <tbody>{rows.map((s) => <tr key={s.id} className={`click ${!s.active ? 'muted' : ''}`} onClick={() => nav(`${base}/sedi/${s.id}`)}>
              <td><div className="strong">{s.name}</div><div className="small muted">{s.code}{!s.active && <Badge tone="red">disattivata</Badge>}</div></td><td className="small">{SITE_KIND[s.kind]}</td><td className="small">{s.address}{s.city ? `, ${s.zip || ''} ${s.city} (${s.province})` : ''}</td><td className="small">{s.manager || <span className="muted">da definire</span>}</td><td className="small">{s.legacy_brand || '–'}</td>
              <td className="num">{eur0(s.revenue_ytd)}</td><td className="num">{s.kind !== 'HEADQUARTER' && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); nav(`${base}/esposizione/${s.id}`); }}>{s.exposure_ok}/{s.exposure_items}</button>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{canWrite(user) && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setEdit({ ...s }); }}>Modifica</button>} {isAdmin(user) && <button className="btn sm danger" onClick={async (e) => { e.stopPropagation(); if (!window.confirm(`Eliminare o disattivare ${s.name}?`)) return; try { const r = await api.del(`/sites/${s.id}`); toast(r.deactivated ? 'Sede disattivata (ha vendite collegate)' : 'Sede eliminata'); list.reload(); } catch (e) { toast(e.message, 'err'); } }}>Elimina</button>}</td>
            </tr>)}</tbody></table></div>
        )}
      </Card>
      {edit && <Modal title={edit.id ? 'Modifica sede' : 'Nuova sede'} onClose={() => setEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.code || !edit.name} onClick={save}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Codice *" help="Usato negli import (colonna sede)"><input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} className="mono" /></Field>
          <Field label="Tipologia"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(SITE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Nome *" className="span2"><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Indirizzo" className="span2"><input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Comune"><input value={edit.city || ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
          <Field label="Provincia"><input value={edit.province || ''} maxLength={2} onChange={(e) => setEdit({ ...edit, province: e.target.value.toUpperCase() })} /></Field>
          <Field label="CAP"><input value={edit.zip || ''} onChange={(e) => setEdit({ ...edit, zip: e.target.value })} /></Field>
          <Field label="Site manager"><input value={edit.manager || ''} onChange={(e) => setEdit({ ...edit, manager: e.target.value })} /></Field>
          <Field label="Insegna precedente"><input value={edit.legacy_brand || ''} onChange={(e) => setEdit({ ...edit, legacy_brand: e.target.value })} /></Field>
          <Field label="Telefono"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Email"><input value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Orari" className="span2"><input value={edit.opening_hours || ''} onChange={(e) => setEdit({ ...edit, opening_hours: e.target.value })} /></Field>
          <Field label="Latitudine"><input type="number" step="0.000001" value={edit.lat ?? ''} onChange={(e) => setEdit({ ...edit, lat: e.target.value })} /></Field>
          <Field label="Longitudine"><input type="number" step="0.000001" value={edit.lng ?? ''} onChange={(e) => setEdit({ ...edit, lng: e.target.value })} /></Field>
          <Field label="Sala d'attesa (mq)"><input type="number" value={edit.sqm_waiting ?? ''} onChange={(e) => setEdit({ ...edit, sqm_waiting: e.target.value })} /></Field>
          <Field label="Ordine"><input type="number" value={edit.sort_order ?? 100} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field>
          <Field label="Attiva" className="inline"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> sede operativa</Field>
          <Field label="Note" className="span2"><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
