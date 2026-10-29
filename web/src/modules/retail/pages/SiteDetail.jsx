import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Kpi, Icon, Modal } from '../components/ui.jsx';
import { HBars, C } from '../components/charts.jsx';
import { api, base } from '../api.js';
import { eur0, num, pct, itDate, SITE_KIND, WEEKDAYS, ADMIN_SITES, ADMIN_PERSON } from '../format.js';

const ROLES = ['Site manager', 'Accettazione', 'Infermiere', 'Tecnico di radiologia', 'Tecnico di laboratorio', 'Medico', 'Anestesista', 'Biologo', 'Amministrativo', 'Pulizie', 'Altro'];
const ASSET_KINDS = { RM: 'Risonanza magnetica', TC: 'TC', MAMMOGRAFO: 'Mammografo', ECOGRAFO: 'Ecografo', RX: 'Radiologia', MOC: 'MOC / densitometro', EMG: 'Elettromiografo', AMBULATORIO: 'Ambulatorio', BOX_PRELIEVO: 'Box prelievo', MONITOR: 'Monitor', TOTEM: 'Totem', ALTRO: 'Altro' };
const KIND_LABEL = { DIPENDENTE: 'Dipendente', LP: 'Libero professionista', MEDICO: 'Medico', SANITARIO: 'Sanitario', ESTERNO: 'Esterno', DIRIGENTE: 'Dirigente' };

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
  useEffect(() => { if (d.data) { const s = d.data.site; setProfile({ surface_sqm: s.surface_sqm, rooms: s.rooms, boxes: s.boxes, parking: s.parking, accessibility: s.accessibility, services: s.services, commercial_description: s.commercial_description, catchment_cities: s.catchment_cities, sqm_waiting: s.sqm_waiting, notes: s.notes }); setHours(Array.from({ length: 7 }, (_, i) => { const h = d.data.hours.find((x) => x.weekday === i + 1); return { weekday: i + 1, closed: h ? h.closed : true, open1: h?.open1 || '', close1: h?.close1 || '', open2: h?.open2 || '', close2: h?.close2 || '', note: h?.note || '' }; })); } }, [d.data]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data || !profile || !hours) return <div className="page"><Loading /></div>;
  const { site, year, assets, operators, market, fte, can_edit, sgi } = d.data;
  // Allineamento SGI (modulo Audit SGI): A verde, B teal, C ambra, D rosso
  const SGI_LEVEL = { A: { label: 'Allineato', color: '#2f7d5b' }, B: { label: 'Sostanzialmente allineato', color: '#1C505E' }, C: { label: 'Parzialmente allineato', color: '#a35a00' }, D: { label: 'Critico', color: '#b3372f' } };
  const staffList = d.data.staff;
  const saveProfile = async () => { try { const b = { ...profile }; for (const k of ['surface_sqm', 'rooms', 'boxes', 'sqm_waiting']) b[k] = b[k] === '' || b[k] == null ? null : Number(b[k]); await api.put(`/structure/sites/${id}/profile`, b); toast('Profilo salvato'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveHours = async () => { try { await api.put(`/structure/sites/${id}/hours`, { hours: hours.map((h) => ({ weekday: h.weekday, note: h.note || null })) }); toast('Note salvate'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveStaff = async () => { try { const b = { retail_role: staff.retail_role || null, weekly_hours: staff.weekly_hours === '' || staff.weekly_hours == null ? null : Number(staff.weekly_hours), days: staff.days || null, notes: staff.notes || null, sort_order: Number(staff.sort_order) || 100 }; await api.put(`/structure/people/${staff.id}`, b); toast('Piano di lavoro salvato'); setStaff(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveAsset = async () => { try { const b = { ...asset }; delete b.id; delete b.site_id; b.quantity = Number(b.quantity) || 1; if (asset.id) await api.put(`/structure/assets/${asset.id}`, b); else await api.post(`/structure/sites/${id}/assets`, b); toast('Dotazione salvata'); setAsset(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const weeklyHours = hours.filter((h) => !h.closed).reduce((a, h) => { const t = (x) => (x ? Number(x.slice(0, 2)) + Number(x.slice(3)) / 60 : 0); return a + Math.max(0, t(h.close1) - t(h.open1)) + Math.max(0, t(h.close2) - t(h.open2)); }, 0);
  const byRole = Object.entries(staffList.filter((s) => s.active).reduce((a, s) => { const k = s.role || 'ruolo da definire'; a[k] = (a[k] || 0) + 1; return a; }, {}));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{site.name}</h1><div className="sub">{SITE_KIND[site.kind] || site.kind} · {site.address || ''}{site.city ? `, ${site.zip || ''} ${site.city} (${site.province})` : ''} · codice {site.code}{site.legacy_brand ? ` · ex ${site.legacy_brand}` : ''}{site.opened_at ? ` · aperta dal ${itDate(site.opened_at)}` : ''}</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(`${base}/sedi`)}>Tutte le sedi</button><Link className="btn ghost" to={`${base}/esposizione/${id}`}>Book retail</Link><Link className="btn ghost" to={`${base}/budget?tab=variance`}>Scostamenti</Link><Link className="btn ghost" to={ADMIN_SITES} title="Denominazione, indirizzo, contatti, site manager e stato della sede si modificano nell'anagrafica unica"><Icon name="external" size={16} />Apri in Amministrazione</Link></div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Fatturato anno in corso" value={eur0(year.revenue)} foot={`${num(year.tickets)} accettazioni · ${num(year.customers)} pazienti · ${num(year.days)} giorni lavorati`} />
        <Kpi label="Persone" value={num(staffList.filter((s) => s.active).length)} foot={`${fte} FTE · ${byRole.map(([r, n]) => `${n} ${r.toLowerCase()}`).join(', ')}`} />
        <Kpi label="Apertura settimanale" value={`${Math.round(weeklyHours)} h`} foot={`${hours.filter((h) => !h.closed).length} giorni su 7${site.saturday_open ? ' · sabato aperto' : ''}`} />
        <Kpi label="Struttura" value={site.surface_sqm ? `${num(site.surface_sqm)} mq` : '–'} foot={`${site.rooms || 0} ambulatori · ${site.boxes || 0} box prelievo · ${assets.filter((a) => a.active).reduce((a, x) => a + x.quantity, 0)} dotazioni`} />
      </div>
      <div className="tabs">{[['profilo', 'Profilo'], ['persone', 'Persone'], ['orari', 'Orari'], ['dotazioni', 'Dotazioni'], ['bacino', 'Bacino e vendite']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'profilo' && <div className="grid g2">
        <Card title="Anagrafica (Amministrazione)" actions={<Link className="btn sm ghost" to={ADMIN_SITES}>Apri in Amministrazione</Link>}>
          <div className="form-grid">
            <Field label="Codice"><input value={site.code || ''} disabled className="mono" /></Field>
            <Field label="Tipologia"><input value={SITE_KIND[site.kind] || site.kind || ''} disabled /></Field>
            <Field label="Site manager"><input value={site.manager || ''} disabled placeholder="da definire in Amministrazione" /></Field>
            <Field label="Insegna precedente"><input value={site.legacy_brand || ''} disabled /></Field>
            <Field label="Telefono"><input value={site.phone || ''} disabled /></Field>
            <Field label="Email"><input value={site.email || ''} disabled /></Field>
            <Field label="Orario ufficiale" help="Testo sintetico dell'anagrafica; il dettaglio per giorno è nella scheda Orari" className="span2"><input value={site.opening_hours || ''} disabled /></Field>
            <Field label="Indirizzo" className="span2"><input value={[site.address, site.zip, site.city, site.province && `(${site.province})`].filter(Boolean).join(' ')} disabled /></Field>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Codice, nome, tipologia, indirizzo, contatti, site manager e stato attivo sono dell'anagrafica unica della Suite e si modificano in Amministrazione, Sedi.</p>
        </Card>
        <Card title="Allineamento SGI" actions={<Link className="btn sm ghost" to={`/audit/sedi/${id}`}>Apri gli audit della sede</Link>}>
          {sgi && sgi.score != null ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: SGI_LEVEL[sgi.level]?.color || 'var(--ink)' }}>{Number(sgi.score).toLocaleString('it-IT', { maximumFractionDigits: 1 })}<span style={{ fontSize: 18, fontWeight: 600 }}>%</span></div>
              <div>
                <div style={{ fontWeight: 800, color: SGI_LEVEL[sgi.level]?.color || 'var(--ink)' }}>{sgi.level ? `${sgi.level} · ${SGI_LEVEL[sgi.level]?.label || ''}` : 'Livello non disponibile'}</div>
                <div className="small muted">Sintesi del {sgi.computed_at ? new Date(sgi.computed_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '–'}{sgi.last_audit_at ? ` · ultimo audit ${itDate(sgi.last_audit_at)}` : ''}</div>
                {sgi.summary && <div className="small" style={{ marginTop: 6 }}>{sgi.summary}</div>}
              </div>
            </div>
          ) : <Empty>Nessuna sintesi: avviala dal widget Audit SGI.</Empty>}
        </Card>
        <Card title="Profilo della struttura (Retail)" actions={can_edit && <button className="btn sm" onClick={saveProfile}>Salva</button>}>
          <div className="form-grid">
            <Field label="Apertura (data)" help="Dall'anagrafica della sede (Amministrazione, Sedi)"><input value={site.opened_at ? itDate(site.opened_at) : ''} disabled placeholder="non indicata in Amministrazione" /></Field>
            <Field label="Superficie (mq)"><input type="number" value={profile.surface_sqm ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, surface_sqm: e.target.value })} /></Field>
            <Field label="Sala d'attesa (mq)"><input type="number" value={profile.sqm_waiting ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, sqm_waiting: e.target.value })} /></Field>
            <Field label="Ambulatori"><input type="number" value={profile.rooms ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, rooms: e.target.value })} /></Field>
            <Field label="Box prelievo"><input type="number" value={profile.boxes ?? ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, boxes: e.target.value })} /></Field>
            <Field label="Parcheggio"><input value={profile.parking || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, parking: e.target.value })} /></Field>
            <Field label="Accessibilità"><input value={profile.accessibility || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, accessibility: e.target.value })} /></Field>
            <Field label="Comuni del bacino" help="Separati da virgola: alimentano i dati di mercato della sede" className="span2"><input value={profile.catchment_cities || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, catchment_cities: e.target.value })} /></Field>
            <Field label="Servizi offerti" className="span2"><textarea value={profile.services || ''} disabled={!can_edit} placeholder="es. prelievi, ecografie, visite specialistiche (cardiologia, ginecologia), medicina del lavoro" onChange={(e) => setProfile({ ...profile, services: e.target.value })} /></Field>
            <Field label="Descrizione commerciale" help="Testo per il book retail e la scheda sede (non è l'anagrafica)" className="span2"><textarea value={profile.commercial_description || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, commercial_description: e.target.value })} /></Field>
            <Field label="Note Retail" className="span2"><textarea value={profile.notes || ''} disabled={!can_edit} onChange={(e) => setProfile({ ...profile, notes: e.target.value })} /></Field>
          </div>
        </Card>
      </div>}

      {tab === 'persone' && <Card title="Persone che lavorano in sede" flush actions={<span className="small muted">dall'anagrafica unica (persone con questa sede) · si assegnano in <Link to="/people">Amministrazione, Persone</Link></span>}>
        {!staffList.length ? <Empty>Nessuna persona assegnata a questa sede in anagrafica: imposta la sede sulla scheda persona in <Link to="/people">Amministrazione, Persone</Link>.</Empty> : <table className="t"><thead><tr><th>Nome</th><th>Ruolo in sede</th><th>Rapporto</th><th>Disciplina</th><th className="num">Ore/sett.</th><th>Giorni</th><th>Contatti</th><th /></tr></thead>
          <tbody>{staffList.map((s) => <tr key={s.id} className={!s.active ? 'muted' : ''}><td className="strong">{s.title ? `${s.title} ` : ''}{s.last_name} {s.first_name}{!s.active && <> <Badge tone="grey">{s.status === 'IMPEGNO' ? 'in arrivo' : 'non attivo'}</Badge></>}</td><td>{s.role || <span className="muted">da definire</span>}{s.retail_role && s.job_title && s.retail_role !== s.job_title && <div className="small muted">{s.job_title}</div>}</td><td className="small">{KIND_LABEL[s.kind] || s.kind}</td><td className="small">{s.discipline || '–'}</td><td className="num">{s.weekly_hours ?? '–'}</td><td className="small">{s.days || '–'}</td><td className="small muted">{[s.phone || s.phone_office, s.email].filter(Boolean).join(' · ')}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{can_edit && <button className="btn sm ghost" onClick={() => setStaff({ ...s, weekly_hours: s.weekly_hours ?? '', days: s.days || '', retail_role: s.retail_role || '', notes: s.notes || '', sort_order: s.sort_order ?? 100 })}>Piano di lavoro</button>} <Link className="btn sm ghost" to={ADMIN_PERSON(s.id)} title="Scheda persona in Amministrazione">Scheda</Link></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>Totale attivi: {staffList.filter((s) => s.active).length} · {fte} FTE (su 40 h, dalle ore del piano di lavoro Retail)</td><td className="num">{staffList.filter((s) => s.active).reduce((a, s) => a + Number(s.weekly_hours || 0), 0)}</td><td colSpan={3} /></tr></tfoot></table>}
      </Card>}

      {tab === 'orari' && <Card title="Orari di apertura" actions={<>{can_edit && <button className="btn sm" onClick={saveHours}>Salva le note</button>}<Link className="btn sm ghost" to={ADMIN_SITES}>Apri in Amministrazione</Link></>}>
        <table className="t hours"><thead><tr><th>Giorno</th><th>Mattina</th><th>Pomeriggio</th><th>Nota operativa Retail</th></tr></thead>
          <tbody>{hours.map((h, i) => <tr key={h.weekday}><td className="strong">{WEEKDAYS[h.weekday]}</td>
            <td className="small">{h.closed ? <span className="muted">chiuso</span> : h.open1 ? `${h.open1} – ${h.close1}` : '–'}</td>
            <td className="small">{h.closed ? '' : h.open2 ? `${h.open2} – ${h.close2}` : '–'}</td>
            <td><input value={h.note} disabled={!can_edit} placeholder="es. prelievi 7:30-10:30" style={{ height: 32 }} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></td></tr>)}</tbody></table>
        <p className="small muted" style={{ marginTop: 8 }}>Le fasce di apertura sono quelle dell'anagrafica unica (orario ufficiale: <b>{site.opening_hours || 'non indicato'}</b>) e si modificano in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link>; qui restano solo le note operative Retail per giorno. Il sabato aperto o chiuso, che determina i giorni lavorabili nel calendario di Budget, deriva dagli stessi orari.</p>
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

      {staff && <Modal title={`Piano di lavoro Retail · ${staff.last_name} ${staff.first_name}`} onClose={() => setStaff(null)} footer={<><button className="btn ghost" onClick={() => setStaff(null)}>Annulla</button><button className="btn" onClick={saveStaff}>Salva</button></>}>
        <div className="alert" style={{ marginBottom: 12 }}><span>{KIND_LABEL[staff.kind] || staff.kind}{staff.job_title ? ` · ${staff.job_title}` : ''}{staff.discipline ? ` · ${staff.discipline}` : ''}. Nome, rapporto, contatti e sede si modificano nella <Link to={ADMIN_PERSON(staff.id)}>scheda persona</Link> in Amministrazione o in Contratti del personale.</span></div>
        <div className="form-grid">
          <Field label="Ruolo in sede" help="Come compare nella scheda struttura e nel book"><input list="roles" value={staff.retail_role} placeholder={staff.job_title || 'es. Accettazione'} onChange={(e) => setStaff({ ...staff, retail_role: e.target.value })} /><datalist id="roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist></Field>
          <Field label="Ordine"><input type="number" value={staff.sort_order} onChange={(e) => setStaff({ ...staff, sort_order: e.target.value })} /></Field>
          <Field label="Ore settimanali in sede"><input type="number" step="0.5" value={staff.weekly_hours} onChange={(e) => setStaff({ ...staff, weekly_hours: e.target.value })} /></Field>
          <Field label="Giorni"><input value={staff.days} placeholder="lun-ven, mar/gio" onChange={(e) => setStaff({ ...staff, days: e.target.value })} /></Field>
          <Field label="Note" className="span2"><textarea value={staff.notes} onChange={(e) => setStaff({ ...staff, notes: e.target.value })} /></Field>
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
