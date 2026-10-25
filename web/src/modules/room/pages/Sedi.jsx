import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, Empty, ErrorBox, Badge } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { computePlan } from '../planner/planner.jsx';

// Le sedi vivono nell'anagrafica unica della Suite (Amministrazione > Sedi): qui si configurano ambulatori, personale e planimetria
export const ADMIN_SITES = '/admin/sites';
export const sedeLabel = (s) => (s.nomeSede ? `${s.denominazione} · ${s.nomeSede}` : s.denominazione || 'Sede senza nome');

export default function Sedi() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error } = useApi('/strutture?all=1');
  const [filter, setFilter] = useState('');
  const canEdit = user.role === 'ADMIN' || user.role === 'PLANNER';
  const match = (s) => !filter || `${s.denominazione} ${s.nomeSede || ''} ${s.indirizzo} ${s.siteManager || ''}`.toLowerCase().includes(filter.toLowerCase());
  const list = useMemo(() => (data || []).filter((s) => s._configurata && match(s)), [data, filter]);
  const altre = useMemo(() => (data || []).filter((s) => !s._configurata && match(s)), [data, filter]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi e ambulatori</h1><div className="sub">Le sedi dell'anagrafica unica della Suite con la configurazione Room Planning: ambulatori, personale pianificato, planimetria e settimana-tipo. Denominazione, indirizzo e contatti si modificano in Amministrazione.</div></div>
        <div className="row">
          <input placeholder="Cerca sede, indirizzo, responsabile…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
          <Link className="btn ghost" to={ADMIN_SITES}>Apri in Amministrazione</Link>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <div className="card"><Empty>{filter ? 'Nessuna sede configurata corrisponde alla ricerca' : 'Nessuna sede ancora configurata in Room Planning: aprine una dall\'elenco qui sotto'}</Empty></div> : (
        <div className="grid g2">
          {list.map((s) => <SedeCard key={s.id} s={s} onOpen={() => nav(`${base}/sedi/${s.id}`)} />)}
        </div>
      )}
      {data && altre.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="hd"><h2>Altre sedi dell'anagrafica</h2><span className="spacer" /><span className="small muted">{altre.length} sedi non ancora configurate in Room Planning{canEdit ? ': aprile per aggiungere ambulatori e personale' : ''}</span></div>
          <div className="bd row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {altre.map((s) => <button key={s.id} className="chip" style={{ border: 0, cursor: 'pointer' }} title={s.indirizzo || ''} onClick={() => nav(`${base}/sedi/${s.id}`)}>{sedeLabel(s)}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

function SedeCard({ s, onOpen }) {
  const plan = useMemo(() => { try { return computePlan(s); } catch { return null; } }, [s]);
  const med = s.personale.filter((p) => p.tipo === 'medico').length, san = s.personale.filter((p) => p.tipo === 'sanitario').length, acc = s.personale.filter((p) => p.tipo === 'accettazione').length;
  const alte = plan ? plan.crit.filter((c) => c.lv === 'alta').length : 0;
  return (
    <div className="card sede-card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="bd" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {s.logo ? <img src={s.logo} alt="" style={{ height: 40, maxWidth: 110, objectFit: 'contain', borderRadius: 6, flex: 'none' }} /> : <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--teal-050)', flex: 'none' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8 }}><h2 style={{ fontSize: 16 }}>{sedeLabel(s)}</h2>{alte > 0 ? <Badge tone="red">{alte} criticità</Badge> : plan && <Badge tone="green">ok</Badge>}</div>
          <div className="muted small">{s.indirizzo || 'Indirizzo da inserire in Amministrazione'}{s.siteManager ? ` · Resp. ${s.siteManager}` : ''}</div>
          <div className="row small" style={{ marginTop: 8, gap: 14 }}>
            <span><b>{s.ambulatori.length}</b> ambulatori</span><span><b>{med}</b> medici</span><span><b>{san}</b> sanitari</span><span><b>{acc}</b> accettazione</span>
            {plan && <span><b>{plan.assigns.length}</b> sessioni/sett.</span>}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Aggiornata {itDateTime(s._updatedAt)}{s._updatedBy ? ` da ${s._updatedBy}` : ''}</div>
        </div>
      </div>
    </div>
  );
}

export function split(s) {
  const lite = { ...s }; delete lite.logo;
  const plan = s.plan || {};
  lite.plan = { markers: plan.markers || {} };
  for (const k of Object.keys(lite)) if (k.startsWith('_')) delete lite[k];
  return { lite, blobs: { logo: s.logo || null, planPdf: plan.dataUrl || null, planImg: plan.imgUrl || null } };
}
