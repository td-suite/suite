import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Kpi, Icon, Modal } from '../components/ui.jsx';
import { HBars, C } from '../components/charts.jsx';
import { api, base } from '../api.js';
import { eur0, num, pct, itDate, SITE_KIND, WEEKDAYS } from '../format.js';

const ROLES = ['Site manager', 'Accettazione', 'Infermiere', 'Tecnico di radiologia', 'Tecnico di laboratorio', 'Medico', 'Anestesista', 'Biologo', 'Amministrativo', 'Pulizie', 'Altro'];
const ASSET_KINDS = { RM: 'Risonanza magnetica', TC: 'TC', MAMMOGRAFO: 'Mammografo', ECOGRAFO: 'Ecografo', RX: 'Radiologia', MOC: 'MOC / densitometro', EMG: 'Elettromiografo', AMBULATORIO: 'Ambulatorio', BOX_PRELIEVO: 'Box prelievo', MONITOR: 'Monitor', TOTEM: 'Totem', ALTRO: 'Altro' };
const KIND_LABEL = { DIPENDENTE: 'Dipendente', LP: 'Libero professionista', ESTERNO: 'Esterno' };

export default function SiteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const d = useApi(`/structure/sites/${id}/structure`);
  const [tab, setTab] = useState('profilo');
  const [profile, setProfile] = useState(null);
  const [hours, setHours] = useState(null);
  const [staff, setStaff] = useState(null);
  const [asset, setAsset] = useState(null);
  useEffect(() => { if (d.data) { const s = d.data.site; setProfile({ surface_sqm: s.surface_sqm, rooms: s.rooms, boxes: s.boxes, parking: s.parking, accessibility: s.accessibility, services: s.services, description: s.description, opened_at: s.opened_at, catchment_cities: s.catchment_cities, phone: s.phone, email: s.email, opening_hours: s.opening_hours, manager: s.manager, sqm_waiting: s.sqm_waiting }); setHours(Array.from({ length: 7 }, (_, i) => { const h = d.data.hours.find((x) => x.weekday === i + 1); return { weekday: i + 1, closed: h ? h.closed : i === 6, open1: h?.open1?.slice(0, 5) || '', close1: h?.close1?.slice(0, 5) || '', open2: h?.open2?.slice(0, 5) || '', close2: h?.close2?.slice(0, 5) || '', note: h?.note || '' }; })); } }, [d.data]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data || !profile || !hours) return <div className="page"><Loading /></div>;
  const { site, year, assets, operators, market, fte, can_edit } = d.data;
  const staffList = d.data.staff;
  const saveProfile = async () => { try { const b = { ...profile }; for (const k of ['surface_sqm', 'rooms', 'boxes', 'sqm_waiting']) b[k] = b[k] === '' || b[k] == null ? null : Number(b[k]); if (b.opened_at === '') b.opened_at = null; await api.put(`/structure/sites/${id}/profile`, b); toast('Profilo salvato'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveHours = async () => { try { await api.put(`/structure/sites/${id}/hours`, { hours: hours.map((h) => ({ ...h, open1: h.open1 || null, close1: h.close1 || null, open2: h.open2 || null, close2: h.close2 || null, note: h.note || null })) }); toast('Orari salvati'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveStaff = async () => { try { const b = { ...staff }; delete b.id; delete b.site_id; b.weekly_hours = b.weekly_hours === '' || b.weekly_hours == null ? null : Number(b.weekly_hours); if (staff.id) await api.put(`/structure/staff/${staff.id}`, b); else await api.post(`/structure/sites/${id}/staff`, b); toast('Persona salvata'); setStaff(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveAsset = async () => { try { const b = { ...asset }; delete b.id; delete b.site_id; b.quantity = Number(b.quantity) || 1; if (asset.id) await api.put(`/structure/assets/${asset.id}`, b); else await api.post(`/structure/sites/${id}/assets`, b); toast('Dotazione salvata'); setAsset(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const weeklyHours = hours.filter((h) => !h.closed).reduce((a, h) => { const t = (x) => (x ? Number(x.slice(0, 2)) + Number(x.slice(3)) / 60 : 0); return a + Math.max(0, t(h.close1) - t(h.open1)) + Math.max(0, t(h.close2) - t(h.open2)); }, 0);
  const byRole = Object.entries(staffList.filter((s) => s.active).reduce((a, s) => { a[s.role] = (a[s.role] || 0) + 1; return a; }, {}));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{site.name}</h1><div className="sub">{SITE_KIND[site.kind]} · {site.address || ''}{site.city ? `, ${site.zip || ''} ${site.city} (${site.province})` : ''} · codice {site.code}{site.legacy_brand ? ` · ex ${site.legacy_brand}` : ''}{site.opened_at ? ` · aperta dal ${itDate(site.opened_at)}` : ''}</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(`${base}/sedi`)}>Tutte le sedi</button><Link className="btn ghost" to={`${base}/esposizione/${id}`}>Book retail</Link><Link className="btn ghost" to={`${base}/budget?tab=variance`}>Scostamenti</Link></div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Fatturato anno in corso" value={eur0(year.revenue)} foot={`${num(year.tickets)} accettazioni · ${num(year.customers)} pazienti · ${num(year.days)} giorni lavorati`} />
        <Kpi label="Persone" value={num(staffList.filter((s) => s.active).length)} foot={`${fte} FTE · ${byRole.map(([r, n]) => `${n} ${r.toLowerCase()}`).join(', ')}`} />
        <Kpi label="Apertura settimanale" value={`${Math.round(weeklyHours)} h`} foot={`${hours.filter((h) => !h.closed).length} giorni su 7${site.saturday_open ? ' · sabato aperto' : ''}`} />
        <Kpi label="Struttura" value={site.surface_sqm ? `${num(site.surface_sqm)} mq` : '–'} foot={`${site.rooms || 0} ambulatori · ${site.boxes || 0} box prelievo · ${assets.filter((a) => a.active).reduce((a, x) => a + x.quantity, 0)} dotazioni`} />
      </div>
      <div className="tabs">{[['profilo', 'Profilo'], ['persone', 'Persone'], ['orari', 'Orari'], ['dotazioni', 'Dotazioni'], ['bacino', 'Bacino e vendite']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'profilo' && <Card title="Profilo della struttura" actions={can_edit && <button className="btn sm" onClick={saveProfile}>Salva</button>}>
        <div className="form-grid">
          <Field label="Site manager"><input value={profile.manager || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, manager: e.target.value })} /></Field>
          <Field label="Telefono"><input value={profile.phone || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
          <Field label="Email"><input value={profile.email || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
          <Field label="Apertura (data)"><input type="date" value={profile.opened_at || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, opened_at: e.target.value })} /></Field>
          <Field label="Superficie (mq)"><input type="number" value={profile.surface_sqm ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, surface_sqm: e.target.value })} /></Field>
          <Field label="Sala d'attesa (mq)"><input type="number" value={profile.sqm_waiting ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, sqm_waiting: e.target.value })} /></Field>
          <Field label="Ambulatori"><input type="number" value={profile.rooms ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, rooms: e.target.value })} /></Field>
          <Field label="Box prelievo"><input type="number" value={profile.boxes ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, boxes: e.target.value })} /></Field>
          <Field label="Parcheggio"><input value={profile.parking || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, parking: e.target.value })} /></Field>
          <Field label="Accessibilità"><input value={profile.accessibility || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, accessibility: e.target.value })} /></Field>
          <Field label="Comuni del bacino" help="Separati da virgola: alimentano i dati di mercato della sede" className="span2"><input value={profile.catchment_cities || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, catchment_cities: e.target.value })} /></Field>
          <Field label="Servizi offerti" className="span2"><textarea value={profile.services || ''} disabled={!can_edit} placeholder="es. prelievi, ecografie, visite specialistiche (cardiologia, ginecologia), medicina del lavoro" onChange={(e) => setProfile({ ...profile, services: e.target.value })} /></Field>
          <Field label="Descrizione" className="span2"><textarea value={profile.description || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, description: e.target.value })} /></Field>
        </div>
      </Card>}

      {tab === 'persone' && <Card title="Persone che lavorano in sede" flush actions={can_edit && <button className="btn sm" onClick={() => setStaff({ name: '', role: 'Accettazione', kind: 'DIPENDENTE', weekly_hours: 40, days: 'lun-ven', active: true })}>+ Persona</button>}>
        {!staffList.length ? <Empty>Nessuna persona registrata</Empty> : <table className="t"><thead><tr><th>Nome</th><th>Ruolo</th><th>Rapporto</th><th>Specialità</th><th className="num">Ore/sett.</th><th>Giorni</th><th>Contatti</th>{can_edit && <th />}</tr></thead>
          <tbody>{staffList.map((s) => <tr key={s.id} className={!s.active ? 'muted' : ''}><td className="strong">{s.name}{!s.active && <Badge tone="red">non attivo</Badge>}</td><td>{s.role}</td><td className="small">{KIND_LABEL[s.kind]}</td><td className="small">{s.specialty || '–'}</td><td className="num">{s.weekly_hours ?? '–'}</td><td className="small">{s.days || '–'}</td><td className="small muted">{[s.phone, s.email].filter(Boolean).join(' · ')}</td>{can_edit && <td className="num" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setStaff({ ...s })}>Modifica</button> <button className="iconbtn" onClick={async () => { if (!window.confirm(`Rimuovere ${s.name}?`)) return; await api.del(`/structure/staff/${s.id}`); d.reload(); }}><Icon name="trash" /></button></td>}</tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>Totale attivi: {staffList.filter((s) => s.active).length} · {fte} FTE (su 40 h)</td><td className="num">{staffList.filter((s) => s.active).reduce((a, s) => a + Number(s.weekly_hours || 0), 0)}</td><td colSpan={can_edit ? 3 : 2} /></tr></tfoot></table>}
      </Card>}

      {tab === 'orari' && <Card title="Orari di apertura" actions={can_edit && <button className="btn sm" onClick={saveHours}>Salva</button>}>
        <table className="t hours"><thead><tr><th>Giorno</th><th>Chiuso</th><th>Mattina</th><th>Pomeriggio</th><th>Note</th></tr></thead>
          <tbody>{hours.map((h, i) => <tr key={h.weekday}><td className="strong">{WEEKDAYS[h.weekday]}</td>
            <td><input type="checkbox" checked={h.closed} disabled={!can_edit} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))} /></td>
            <td className="row" style={{ gap: 6 }}><input type="time" value={h.open1} disabled={!can_edit || h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open1: e.target.value } : x)))} /> – <input type="time" value={h.close1} disabled={!can_edit || h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close1: e.target.value } : x)))} /></td>
            <td><div className="row" style={{ gap: 6 }}><input type="time" value={h.open2} disabled={!can_edit || h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open2: e.target.value } : x)))} /> – <input type="time" value={h.close2} disabled={!can_edit || h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close2: e.target.value } : x)))} /></div></td>
            <td><input value={h.note} disabled={!can_edit} placeholder="es. prelievi 7:30-10:30" style={{ height: 32 }} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></td></tr>)}</tbody></table>
        <p className="small muted" style={{ marginTop: 8 }}>Il sabato aperto o chiuso determina i giorni lavorabili della sede nel calendario di Budget.</p>
      </Card>}

      {tab === 'dotazioni' && <Card title="Dotazioni e ambienti" flush actions={can_edit && <button className="btn sm" onClick={() => setAsset({ kind: 'ECOGRAFO', name: '', quantity: 1, active: true })}>+ Dotazione</button>}>
        {!assets.length ? <Empty>Nessuna dotazione registrata</Empty> : <table className="t"><thead><tr><th>Tipo</th><th>Dotazione</th><th className="num">Q.tà</th><th>Dettagli</th>{can_edit && <th />}</tr></thead>
          <tbody>{assets.map((a) => <tr key={a.id} className={!a.active ? 'muted' : ''}><td><Badge tone="teal">{ASSET_KINDS[a.kind] || a.kind}</Badge></td><td className="strong">{a.name}</td><td className="num">{a.quantity}</td><td className="small muted">{a.details || '–'}</td>{can_edit && <td className="num" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setAsset({ ...a })}>Modifica</button> <button className="iconbtn" onClick={async () => { if (!window.confirm('Rimuovere?')) return; await api.del(`/structure/assets/${a.id}`); d.reload(); }}><Icon name="trash" /></button></td>}</tr>)}</tbody></table>}
      </Card>}

      {tab === 'bacino' && <div className="grid g2">
        <Card title="Chi vende di più in questa sede" flush actions={<span className="small muted">anno in corso</span>}>
          {operators.length ? <table className="t"><thead><tr><th>#</th><th>Operatore</th><th className="num">Accettazioni</th><th className="num">Fatturato</th><th className="num">Medio</th></tr></thead><tbody>{operators.map((o, i) => <tr key={o.label}><td className="muted">{i + 1}</td><td className="strong">{o.label}</td><td className="num">{num(o.tickets)}</td><td className="num strong">{eur0(o.revenue)}</td><td className="num">{eur0(o.tickets ? o.revenue / o.tickets : 0)}</td></tr>)}</tbody></table> : <Empty>Nessun operatore nelle vendite: mappa la colonna "Operatore" nell'import</Empty>}
        </Card>
        <Card title="Bacino: dati di mercato" flush actions={<Link className="btn sm ghost" to={`${base}/budget?tab=market`}>Gestisci</Link>}>
          {market.length ? <table className="t"><thead><tr><th>Comune</th><th>Indicatore</th><th className="num">Valore</th><th>Anno</th></tr></thead><tbody>{market.map((m) => <tr key={m.territory + m.metric + (m.ateco || '') + m.year}><td className="strong">{m.territory}{m.ateco ? <span className="small muted"> · ATECO {m.ateco}</span> : ''}</td><td className="small">{m.metric}</td><td className="num">{Number(m.value) < 1 && Number(m.value) > 0 ? pct(Number(m.value) * 100) : num(m.value)}</td><td className="small muted">{m.year}</td></tr>)}</tbody></table> : <Empty>Nessun dato per {site.city}: imposta i comuni del bacino nel profilo e carica i dati in Budget › Dati di mercato</Empty>}
        </Card>
      </div>}

      {staff && <Modal title={staff.id ? 'Modifica persona' : 'Nuova persona'} onClose={() => setStaff(null)} footer={<><button className="btn ghost" onClick={() => setStaff(null)}>Annulla</button><button className="btn" disabled={!staff.name || !staff.role} onClick={saveStaff}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Nome e cognome *" className="span2"><input value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} /></Field>
          <Field label="Ruolo *"><input list="roles" value={staff.role} onChange={(e) => setStaff({ ...staff, role: e.target.value })} /><datalist id="roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist></Field>
          <Field label="Rapporto"><select value={staff.kind} onChange={(e) => setStaff({ ...staff, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Specialità"><input value={staff.specialty || ''} onChange={(e) => setStaff({ ...staff, specialty: e.target.value })} /></Field>
          <Field label="Ore settimanali"><input type="number" step="0.5" value={staff.weekly_hours ?? ''} onChange={(e) => setStaff({ ...staff, weekly_hours: e.target.value })} /></Field>
          <Field label="Giorni"><input value={staff.days || ''} placeholder="lun-ven, mar/gio" onChange={(e) => setStaff({ ...staff, days: e.target.value })} /></Field>
          <Field label="Telefono"><input value={staff.phone || ''} onChange={(e) => setStaff({ ...staff, phone: e.target.value })} /></Field>
          <Field label="Email"><input value={staff.email || ''} onChange={(e) => setStaff({ ...staff, email: e.target.value })} /></Field>
          <Field label="Attivo" className="inline"><input type="checkbox" checked={staff.active !== false} onChange={(e) => setStaff({ ...staff, active: e.target.checked })} /> in servizio</Field>
          <Field label="Note" className="span2"><textarea value={staff.notes || ''} onChange={(e) => setStaff({ ...staff, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
      {asset && <Modal title={asset.id ? 'Modifica dotazione' : 'Nuova dotazione'} onClose={() => setAsset(null)} footer={<><button className="btn ghost" onClick={() => setAsset(null)}>Annulla</button><button className="btn" disabled={!asset.name} onClick={saveAsset}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Tipo"><select value={asset.kind} onChange={(e) => setAsset({ ...asset, kind: e.target.value })}>{Object.entries(ASSET_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Quantità"><input type="number" min="1" value={asset.quantity} onChange={(e) => setAsset({ ...asset, quantity: e.target.value })} /></Field>
          <Field label="Nome *" className="span2"><input value={asset.name} placeholder="es. Risonanza magnetica 1,5 T" onChange={(e) => setAsset({ ...asset, name: e.target.value })} /></Field>
          <Field label="Dettagli" className="span2"><input value={asset.details || ''} placeholder="modello, anno, note" onChange={(e) => setAsset({ ...asset, details: e.target.value })} /></Field>
          <Field label="Attiva" className="inline"><input type="checkbox" checked={asset.active !== false} onChange={(e) => setAsset({ ...asset, active: e.target.checked })} /> in uso</Field>
        </div>
      </Modal>}
    </div>
  );
}
