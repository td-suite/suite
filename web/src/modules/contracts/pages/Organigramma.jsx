import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, Modal, useToast, Icon } from '../components/ui.jsx';

/** Riquadro di un'area: referente, ruolo, personale (dai ruoli registrati nelle schede). */
function AreaCard({ n, root, showStaff }) {
  const cls = root ? 'k-DIREZIONE' : n.kind === 'STAFF' ? 'k-FUNZIONE staffunit' : n.level <= 2 ? 'k-LINEA' : 'k-SEDE';
  return (
    <div className={`org-node ${cls} ${n.collapsed ? 'collapsed' : ''}`} style={{ width: 210 }}>
      <div className="unit">{n.name}</div>
      <div className="head">{n.head ? <Link to={`${BASE}/risorse/${n.head.id}`}>{n.head.name}</Link> : <span className="muted">Referente da definire</span>}</div>
      {n.head?.job_title && <div className="role">{n.head.job_title}</div>}
      <div className="meta">
        {n.headcount > 0 && <Badge tone="grey">{n.headcount} person{n.headcount === 1 ? 'a' : 'e'}</Badge>}
        {n.head?.status === 'IMPEGNO' && <Badge tone="blue">in arrivo</Badge>}
      </div>
      {showStaff && n.staff?.length > 0 && (
        <ul className="org-people">{n.staff.map((p) => <li key={p.id}><Link to={`${BASE}/risorse/${p.id}`}>{p.name}</Link>{p.job_title && <span className="muted"> · {p.job_title}</span>}</li>)}</ul>
      )}
    </div>
  );
}

function AreaTree({ n, root, showStaff }) {
  return (
    <li>
      <AreaCard n={n} root={root} showStaff={showStaff} />
      {n.staff_units?.length > 0 && <div className="org-staff" title="Tecnostruttura (funzioni di staff)">{n.staff_units.map((c) => <div key={c.id} className="org-staff-item"><AreaCard n={c} showStaff={showStaff} />{c.children?.length > 0 && <ul className="org-tree org-sub">{c.children.map((k) => <AreaTree key={k.id} n={k} showStaff={showStaff} />)}</ul>}</div>)}</div>}
      {n.children?.length > 0 && <ul>{n.children.map((c) => <AreaTree key={c.id} n={c} showStaff={showStaff} />)}</ul>}
    </li>
  );
}

/** Catena verticale dell'unità produttiva: ogni livello un riquadro, il personale in fondo come riquadri singoli. */
function UnitChain({ n, root }) {
  const next = n.children?.[0];
  return (
    <li>
      <AreaCard n={{ ...n, staff: [] }} root={root} showStaff={false} />
      {next ? <ul><UnitChain n={next} /></ul> : n.staff?.length > 0 ? (
        <ul>{n.staff.map((p) => <li key={p.id}><div className="org-node k-SEDE" style={{ width: 170 }}><div className="unit">Personale</div><div className="head"><Link to={`${BASE}/risorse/${p.id}`}>{p.name}</Link></div>{p.job_title && <div className="role">{p.job_title}</div>}</div></li>)}</ul>
      ) : null}
    </li>
  );
}

export default function Organigramma() {
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi('/org/chart');
  const [view, setView] = useState('completo');
  const [showStaff, setShowStaff] = useState(true);
  const [unitId, setUnitId] = useState('');
  const [unit, setUnit] = useState(null);
  const [busy, setBusy] = useState(false);
  const admin = isAdmin(user);
  const wrapRef = useRef(null);
  useEffect(() => { const el = wrapRef.current; if (el) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2); }, [view, d.data, unit, showStaff]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const sections = d.data.sections;
  const tabs = [...sections.map((s) => [s.key, s.title]), ['unita', 'Unità produttiva']];
  const current = sections.find((s) => s.key === view);
  const loadUnit = async (id) => {
    setUnitId(id); setUnit(null);
    if (!id) return;
    setBusy(true);
    try { setUnit(await api.get(`/org/chart/unit/${id}`)); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const scope = view === 'unita' ? (unitId ? `unit-${unitId}` : null) : view;
  const exportLinks = scope && (
    <span className="row" style={{ gap: 6 }}>
      <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={showStaff} onChange={(e) => setShowStaff(e.target.checked)} /> personale</label>
      <a className="btn sm ghost" href={`${API_BASE}/org/chart/export?scope=${scope}&format=pptx&staff=${showStaff ? 1 : 0}`} title="Scarica PowerPoint">PPTX</a>
      <a className="btn sm ghost" href={`${API_BASE}/org/chart/export?scope=${scope}&format=pdf&staff=${showStaff ? 1 : 0}`} title="Scarica PDF">PDF</a>
    </span>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Organigramma</h1><div className="sub">Generato dai ruoli registrati: aree aziendali (Impostazioni), referenti, funzioni e linee di riporto delle schede. {d.data.people} persone attive o in arrivo.</div></div>
        <div className="row">
          {admin && <Link className="btn ghost" to={`${BASE}/impostazioni`}><Icon name="edit" />Aree e referenti</Link>}
          <button className="btn" onClick={() => window.print()}><Icon name="print" />Stampa</button>
        </div>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>

      {current && (
        <Card title={current.title} flush actions={exportLinks}>
          <div className="org-wrap" ref={wrapRef}><ul className="org-tree"><AreaTree n={current.tree} root showStaff={showStaff} /></ul></div>
          <div className="bd small muted">{current.subtitle}. Ogni sezione parte dall'Amministratore Delegato; la tecnostruttura (funzioni di staff, riquadri nel riquadro tratteggiato) sta in alto, le aree operative nel pettine sottostante; tecnostruttura e operativa si impostano per area in Impostazioni. Il referente di ogni area si imposta in Impostazioni (Modifica area); se assente viene dedotto da chi, tra le persone dell'area, non riporta a un collega della stessa area. Le persone con doppia funzione compaiono in tutte le aree di appartenenza.</div>
        </Card>
      )}

      {view === 'unita' && (
        <Card title="Organigramma di riferimento per unità produttiva" flush actions={exportLinks}>
          <div className="bd">
            <div className="form-grid">
              <Field label="Unità produttiva" help="Catena di responsabilità dal vertice fino al personale dell'unità">
                <select value={unitId} onChange={(e) => loadUnit(e.target.value)}>
                  <option value="">– scegli un'area –</option>
                  {d.data.units.map((u) => <option key={u.id} value={u.id}>{'  '.repeat(u.level - 1)}{u.name}{u.head ? ` · ${u.head}` : ''} ({u.headcount})</option>)}
                </select>
              </Field>
            </div>
          </div>
          {busy && <Loading />}
          {unit && <div className="org-wrap" ref={wrapRef}><ul className="org-tree"><UnitChain n={unit.tree} root /></ul></div>}
          {!unitId && !busy && <Empty>Scegli l'unità: in cima l'Amministratore Delegato, poi i referenti delle aree di livello superiore, il referente dell'unità e in fondo il personale.</Empty>}
        </Card>
      )}
    </div>
  );
}
