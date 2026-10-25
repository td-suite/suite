import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Kpi, Icon, Progress, Modal } from '../components/ui.jsx';
import { api, base, apiBase } from '../api.js';
import { num, itDate, SITE_KIND } from '../format.js';

export default function Exposure() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const ov = useApi('/exposure/overview');
  const std = useApi('/exposure/standards');
  const zones = useApi('/exposure/zones');
  const [tab, setTab] = useState('sedi');
  const [edit, setEdit] = useState(null);
  const rows = ov.data || [];
  const tot = rows.reduce((a, s) => ({ total: a.total + s.total, ok: a.ok + s.ok, issues: a.issues + s.bad + s.to_replace, missing: a.missing + s.to_install }), { total: 0, ok: 0, issues: 0, missing: 0 });
  const rollover = async () => { try { const r = await api.post('/exposure/rollover'); toast(`${r.updated} materiali promo aggiornati con "${r.promotion}" e segnati da sostituire`); ov.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveStd = async () => {
    try { const b = { ...edit, zone_id: Number(edit.zone_id), quantity: Number(edit.quantity) || 1, sort_order: Number(edit.sort_order) || 100 }; delete b.id; delete b.zone_name; delete b.zone_code; if (edit.id) await api.put(`/exposure/standards/${edit.id}`, b); else await api.post('/exposure/standards', b); toast('Standard salvato'); setEdit(null); std.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const kinds = ['TUTTE', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'PUNTO_PRELIEVI', 'LABORATORIO'];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Esposizione e book retail</h1><div className="sub">Lo standard espositivo per tipologia di sede (il book tipo) e lo stato reale di ogni sede: cosa è esposto, dove, da quando, se è conforme. I site manager aggiornano il book della propria sede.</div></div>
        <div className="row">
          <a className="btn ghost" href={`${apiBase}/exposure/book.pptx`}><Icon name="download" />Book retail del network (PPTX)</a>
          {canWrite(user) && <button className="btn" onClick={rollover} title="Aggiorna le locandine promo del mese in tutte le sedi con la promozione corrente"><Icon name="refresh" />Cambio mese</button>}
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Conformità del network" value={tot.total ? `${Math.round((tot.ok / tot.total) * 100)}%` : '–'} foot={`${num(tot.ok)} materiali installati su ${num(tot.total)}`} />
        <Kpi label="Da sostituire o non conformi" value={num(tot.issues)} foot="interventi da fare in sede" />
        <Kpi label="Da installare" value={num(tot.missing)} foot="materiali previsti e non ancora esposti" />
        <Kpi label="Sedi senza verifiche recenti" value={num(rows.filter((s) => !s.last_check || (Date.now() - new Date(s.last_check)) / 86400000 > 30).length)} foot="nessuna verifica negli ultimi 30 giorni" />
      </div>
      <div className="tabs"><button className={tab === 'sedi' ? 'on' : ''} onClick={() => setTab('sedi')}>Sedi</button><button className={tab === 'std' ? 'on' : ''} onClick={() => setTab('std')}>Standard espositivo (book tipo)</button></div>
      <ErrorBox error={ov.error} />
      {tab === 'sedi' && (
        <Card flush>
          {!ov.data ? <Loading /> : !rows.length ? <Empty>Nessuna sede attiva</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th>Tipologia</th><th>Site manager</th><th>Conformità</th><th className="num">Installati</th><th className="num">Da sostituire</th><th className="num">Non conformi</th><th className="num">Da installare</th><th>Ultima verifica</th></tr></thead>
              <tbody>{rows.map((s) => <tr key={s.id} className="click" onClick={() => nav(`${base}/esposizione/${s.id}`)}>
                <td><div className="strong">{s.name}</div><div className="small muted">{s.code} · {s.city}</div></td><td className="small">{SITE_KIND[s.kind]}</td><td className="small">{s.manager || <span className="muted">da definire</span>}</td>
                <td style={{ minWidth: 140 }}><div className="row" style={{ gap: 8 }}><Progress value={s.ok} max={s.total} /><span className="small strong">{s.compliance_pct}%</span></div>{s.total === 0 && <span className="small muted">book non ancora applicato ({s.standard_required} materiali previsti)</span>}</td>
                <td className="num">{num(s.ok)}</td><td className="num">{s.to_replace ? <span className="strong" style={{ color: '#b8860b' }}>{num(s.to_replace)}</span> : '0'}</td><td className="num">{s.bad ? <span className="red strong">{num(s.bad)}</span> : '0'}</td><td className="num">{num(s.to_install)}</td>
                <td className="small">{s.last_check ? itDate(s.last_check) : <Badge tone="red">mai</Badge>}</td>
              </tr>)}</tbody></table></div>
          )}
        </Card>
      )}
      {tab === 'std' && (
        <Card title="Standard espositivo per tipologia di sede" flush actions={canWrite(user) && <button className="btn sm" onClick={() => setEdit({ site_kind: 'TUTTE', zone_id: zones.data?.[0]?.id || '', quantity: 1, mandatory: true, sort_order: 100 })}>+ Materiale standard</button>}>
          {!std.data ? <Loading /> : kinds.map((k) => { const list = std.data.filter((x) => x.site_kind === k); if (!list.length) return null; return (
            <div key={k} style={{ padding: '0 18px' }}>
              <div className="subhead">{k === 'TUTTE' ? 'Tutte le sedi' : SITE_KIND[k]}</div>
              <table className="t"><thead><tr><th>Zona</th><th>Materiale</th><th>Formato</th><th className="num">Q.tà</th><th>Regola espositiva</th><th>Obbligatorio</th>{canWrite(user) && <th />}</tr></thead>
                <tbody>{list.map((x) => <tr key={x.id}><td className="strong">{x.zone_name}</td><td>{x.material}</td><td className="small">{x.format || '–'}</td><td className="num">{x.quantity}</td><td className="small muted">{x.rule || '–'}</td><td>{x.mandatory ? <Badge tone="teal">sì</Badge> : <Badge tone="grey">facoltativo</Badge>}</td>{canWrite(user) && <td className="num" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEdit({ ...x })}>Modifica</button> <button className="iconbtn" onClick={async () => { if (!window.confirm('Rimuovere dallo standard?')) return; await api.del(`/exposure/standards/${x.id}`); std.reload(); }}><Icon name="trash" /></button></td>}</tr>)}</tbody></table>
            </div>); })}
          <p className="small muted" style={{ padding: 18 }}>Lo standard definisce cosa deve esserci in ogni zona per tipologia di sede. Dalla pagina della sede, "Applica standard" crea le voci mancanti; il book si compila poi con stato, contenuto esposto e foto.</p>
        </Card>
      )}
      {edit && <Modal title={edit.id ? 'Modifica materiale standard' : 'Nuovo materiale standard'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.material || !edit.zone_id} onClick={saveStd}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Tipologia di sede"><select value={edit.site_kind} onChange={(e) => setEdit({ ...edit, site_kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{k === 'TUTTE' ? 'Tutte le sedi' : SITE_KIND[k]}</option>)}</select></Field>
          <Field label="Zona"><select value={edit.zone_id} onChange={(e) => setEdit({ ...edit, zone_id: e.target.value })}>{(zones.data || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
          <Field label="Materiale *" className="span2"><input value={edit.material || ''} onChange={(e) => setEdit({ ...edit, material: e.target.value })} /></Field>
          <Field label="Formato"><input value={edit.format || ''} placeholder="A3, 70x100, monitor 43''" onChange={(e) => setEdit({ ...edit, format: e.target.value })} /></Field>
          <Field label="Quantità"><input type="number" min="1" value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} /></Field>
          <Field label="Regola espositiva" className="span2"><input value={edit.rule || ''} placeholder="es. altezza occhi, sostituire entro il 1° del mese" onChange={(e) => setEdit({ ...edit, rule: e.target.value })} /></Field>
          <Field label="Obbligatorio" className="inline"><input type="checkbox" checked={edit.mandatory !== false} onChange={(e) => setEdit({ ...edit, mandatory: e.target.checked })} /> conta nella conformità</Field>
          <Field label="Ordine"><input type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
