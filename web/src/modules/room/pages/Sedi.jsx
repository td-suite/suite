import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, Empty, ErrorBox, useToast, Badge } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { newStruttura, computePlan } from '../planner/planner.jsx';

export const sedeLabel = (s) => (s.nomeSede ? `${s.denominazione} · ${s.nomeSede}` : s.denominazione || 'Sede senza nome');

export default function Sedi() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi('/strutture');
  const [filter, setFilter] = useState('');
  const canCreate = user.role === 'ADMIN' || (user.role === 'PLANNER' && !(user.struttura_ids || []).length);
  const list = useMemo(() => (data || []).filter((s) => !filter || `${s.denominazione} ${s.nomeSede || ''} ${s.indirizzo} ${s.siteManager || ''}`.toLowerCase().includes(filter.toLowerCase())), [data, filter]);
  const create = async () => {
    const s = newStruttura();
    s.denominazione = 'Nuova sede';
    try {
      const { lite } = split(s);
      await api.post('/strutture', { data: lite, blobs: {} });
      toast('Sede creata'); nav(`${base}/sedi/${s.id}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi e ambulatori</h1><div className="sub">Le strutture del network in ordine alfabetico. Apri una sede per anagrafica, ambulatori, personale, planimetria e pianificazione.</div></div>
        <div className="row">
          <input placeholder="Cerca sede, indirizzo, responsabile…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
          {canCreate && <button className="btn" onClick={create}>+ Nuova sede</button>}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <div className="card"><Empty>{filter ? 'Nessuna sede corrisponde alla ricerca' : 'Nessuna sede configurata'}</Empty></div> : (
        <div className="grid g2">
          {list.map((s) => <SedeCard key={s.id} s={s} onOpen={() => nav(`${base}/sedi/${s.id}`)} />)}
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
          <div className="muted small">{s.indirizzo || 'Indirizzo da inserire'}{s.siteManager ? ` · Resp. ${s.siteManager}` : ''}</div>
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
