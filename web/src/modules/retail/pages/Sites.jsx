// Sedi del network sull'anagrafica unica della Suite: l'elenco viene da public.sites, qui si modificano solo le impostazioni
// Retail della sede (site_ext). Creazione, rinomina, indirizzo, stato attivo, codice StudioLAB, orari (da cui il sabato aperto)
// e data di apertura si fanno in Amministrazione > Sedi (docs/IMPOSTAZIONI.md).
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, Modal, useToast, Kpi, Icon } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { eur0, num, SITE_KIND, ADMIN_SITES } from '../format.js';

const EXT_KEYS = ['in_network', 'tuotempo_area_id', 'gipo_site_code', 'catchment_cities', 'sqm_waiting', 'notes'];

export default function Sites() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const list = useApi('/sites?all=1');
  const [edit, setEdit] = useState(null);
  const [scope, setScope] = useState('network');
  const all = list.data || [];
  const network = all.filter((s) => s.active && s.in_network);
  const rows = scope === 'network' ? network : scope === 'active' ? all.filter((s) => s.active) : all;
  const byKind = Object.entries(SITE_KIND).map(([k, l]) => [l, network.filter((s) => s.kind === k).length]).filter((x) => x[1]);
  const openEdit = (s) => setEdit({ id: s.id, code: s.code, name: s.name, kind: s.kind, address: s.address, city: s.city, province: s.province, configured: s.configured, auto_network: s.kind !== 'HEADQUARTER' && s.kind !== 'SERVICE' && s.kind !== 'ALTRO',
    in_network: s.configured ? s.in_network : null, tuotempo_area_id: s.tuotempo_area_id || '', gipo_site_code: s.gipo_site_code || '', studiolab_code: s.studiolab_code || '', saturday_open: s.saturday_open !== false, opening_hours: s.opening_hours || '', catchment_cities: s.catchment_cities || '', sqm_waiting: s.sqm_waiting ?? '', notes: s.notes || '' });
  const save = async () => {
    try {
      const b = {};
      for (const k of EXT_KEYS) b[k] = edit[k];
      b.sqm_waiting = b.sqm_waiting === '' || b.sqm_waiting == null ? null : Number(b.sqm_waiting);
      for (const k of ['tuotempo_area_id', 'gipo_site_code', 'catchment_cities', 'notes']) if (b[k] === '') b[k] = null;
      if (b.in_network === 'auto') b.in_network = null;
      await api.put(`/sites/${edit.id}`, b);
      toast('Impostazioni Retail salvate'); setEdit(null); list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const netValue = edit ? (edit.in_network == null ? 'auto' : edit.in_network ? 'si' : 'no') : 'auto';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi del network</h1><div className="sub">Le sedi sono quelle dell'anagrafica unica della Suite. Qui si impostano i parametri Retail (perimetro del network, area TuoTempo, codici nei gestionali, sabato aperto, bacino); clicca una sede per la scheda struttura.</div></div>
        <div className="row">
          <Link className="btn ghost" to={ADMIN_SITES} title="Codice, nome, tipologia, indirizzo, contatti, site manager e stato della sede si modificano nell'anagrafica unica"><Icon name="external" size={16} />Apri in Amministrazione</Link>
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Sedi del network" value={num(network.length)} foot={byKind.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(' · ') || 'nessuna sede attiva'} />
        <Kpi label="Fatturato anno in corso" value={eur0(network.reduce((a, s) => a + Number(s.revenue_ytd || 0), 0))} foot="sedi del network" />
        <Kpi label="Province" value={num(new Set(network.map((s) => s.province).filter(Boolean)).size)} foot={[...new Set(network.map((s) => s.province).filter(Boolean))].join(', ') || '–'} />
        <Kpi label="Impostazioni Retail" value={`${num(network.filter((s) => s.configured).length)}/${num(network.length)}`} foot={`${num(network.filter((s) => s.tuotempo_area_id).length)} con area TuoTempo`} />
      </div>
      <ErrorBox error={list.error} />
      <div className="tabs" style={{ marginBottom: 12 }}>{[['network', `Network (${network.length})`], ['active', `Tutte le attive (${all.filter((s) => s.active).length})`], ['all', `Anche disattivate (${all.length})`]].map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div>
      <Card flush>
        {!list.data ? <Loading /> : !rows.length ? <Empty>Nessuna sede in anagrafica: caricale da <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link>.</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th>Tipologia</th><th>Indirizzo</th><th>Site manager</th><th className="num">Persone</th><th>Retail</th><th className="num">Fatturato YTD</th><th className="num">Esposizione</th><th /></tr></thead>
            <tbody>{rows.map((s) => <tr key={s.id} className={`click ${!s.active ? 'muted' : ''}`} onClick={() => nav(`${base}/sedi/${s.id}`)}>
              <td><div className="strong">{s.name}{s.mine && <> <Badge tone="blue">mia sede</Badge></>}</div><div className="small muted">{s.code}{s.legacy_brand ? ` · ex ${s.legacy_brand}` : ''}{!s.active && <> <Badge tone="red">disattivata</Badge></>}</div></td>
              <td className="small">{SITE_KIND[s.kind] || s.kind}</td>
              <td className="small">{s.address}{s.city ? `${s.address ? ', ' : ''}${s.zip || ''} ${s.city}${s.province ? ` (${s.province})` : ''}` : ''}</td>
              <td className="small">{s.manager || <span className="muted">da definire</span>}</td>
              <td className="num">{num(s.people_count)}</td>
              <td className="small">{!s.in_network ? <Badge tone="grey">fuori network</Badge> : s.configured ? <>{s.tuotempo_area_id && <Badge tone="teal">TuoTempo {s.tuotempo_area_id}</Badge>} {s.saturday_open === false && <Badge tone="grey">sabato chiuso</Badge>} {s.configured && !s.tuotempo_area_id && s.saturday_open !== false && <span className="muted">impostata</span>}</> : <span className="muted">predefinite</span>}</td>
              <td className="num">{eur0(s.revenue_ytd)}</td>
              <td className="num">{s.in_network && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); nav(`${base}/esposizione/${s.id}`); }}>{s.exposure_ok}/{s.exposure_items}</button>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{canWrite(user) && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); openEdit(s); }}>Impostazioni</button>}</td>
            </tr>)}</tbody></table></div>
        )}
      </Card>
      {edit && <Modal title={`Impostazioni Retail · ${edit.name}`} onClose={() => setEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <div className="alert" style={{ marginBottom: 12 }}><span><b>{edit.code}</b> · {SITE_KIND[edit.kind] || edit.kind} · {[edit.address, edit.city, edit.province && `(${edit.province})`].filter(Boolean).join(' ') || 'indirizzo non indicato'}. Codice, nome, tipologia, indirizzo, contatti, site manager e stato si modificano in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link>.</span></div>
        <div className="form-grid">
          <Field label="Sede del network Retail" help={`Automatico: ${edit.auto_network ? 'sì' : 'no'} (dalla tipologia). Le sedi fuori network non compaiono in budget, esposizione e selettori.`}>
            <select value={netValue} onChange={(e) => setEdit({ ...edit, in_network: e.target.value === 'auto' ? null : e.target.value === 'si' })}><option value="auto">Automatico dalla tipologia</option><option value="si">Sì, nel network</option><option value="no">No, fuori dal network</option></select>
          </Field>
          <Field label="Sabato" help={<>Dagli orari di apertura dell'anagrafica ({edit.opening_hours || 'non indicati: si assume aperto'}); determina i giorni lavorabili del Budget. Si modifica in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link></>}><input value={edit.saturday_open ? 'Sabato aperto' : 'Sabato chiuso'} disabled /></Field>
          <Field label="Area TuoTempo" help="Id area (Key Entities); la sincronizzazione del connettore lo abbina per nome"><input className="mono" value={edit.tuotempo_area_id} onChange={(e) => setEdit({ ...edit, tuotempo_area_id: e.target.value })} /></Field>
          <Field label="Codice sede GIPO" help="Come compare negli export GIPO (colonna sede negli import)"><input className="mono" value={edit.gipo_site_code} onChange={(e) => setEdit({ ...edit, gipo_site_code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Codice sede StudioLab" help={<>Dall'anagrafica della sede: si modifica in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link></>}><input className="mono" value={edit.studiolab_code} disabled placeholder="non indicato in Amministrazione" /></Field>
          <Field label="Sala d'attesa (mq)" help="Per il book retail"><input type="number" value={edit.sqm_waiting} onChange={(e) => setEdit({ ...edit, sqm_waiting: e.target.value })} /></Field>
          <Field label="Comuni del bacino" help="Separati da virgola: alimentano i dati di mercato e gli scostamenti" className="span2"><input value={edit.catchment_cities} onChange={(e) => setEdit({ ...edit, catchment_cities: e.target.value })} /></Field>
          <Field label="Note Retail" className="span2"><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
