// Immobili: una card per sede dell'anagrafica (immobile creato al volo) con titolo di godimento, superficie, canone da Payments,
// planimetria e stato in Room Planning, dispositivi, scadenze scadute, interventi aperti, utenze e volture
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Alert } from '../components/bits.jsx';
import { SITE_KIND, TENURE, num, eur, itDate } from '../format.js';

export default function Immobili() {
  const { data, loading, error } = useApi('/immobili');
  const [q, setQ] = useState('');
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const rows = data.rows.filter((s) => !q || `${s.name} ${s.code} ${s.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHead title="Immobili" icon="building" sub="Le sedi dell'anagrafica con dati immobiliari, contratto di affitto, planimetria, dispositivi e utenze. Le sedi si creano in Amministrazione > Sedi."
        actions={<div style={{ minWidth: 260 }}><SearchInput value={q} onChange={setQ} placeholder="Cerca sede" /></div>} />
      {!data.finance && <Alert tone="warn" icon="alert">Payments non avviato: canoni e utenze non sono disponibili.</Alert>}
      {!rows.length ? <Card><Empty icon="building" title="Nessun immobile">Le sedi attive dell'anagrafica (non service) compaiono qui da sole.</Empty></Card> : (
        <div className="fa-cards">{rows.map((s) => (
          <Card key={s.site_id} className="fa-card" title={<Link to={`${base}/immobili/${s.site_id}`}>{s.name}</Link>} actions={<Badge tone={s.tenure === 'PROPRIETA' ? 'green' : s.tenure === 'OSPITATA' ? 'mauve' : 'blue'} dot={false}>{TENURE[s.tenure]}</Badge>}>
            <div className="small muted" style={{ marginBottom: 10 }}>{SITE_KIND[s.kind] || s.kind}{s.city ? ` · ${s.city}` : ''} · {s.code}{s.manager_name ? ` · ${s.manager_name}` : ''}</div>
            <div className="fa-facts">
              <div><div className="k">Superficie</div><div className="v">{s.surface_sqm ? `${num(s.surface_sqm)} m2` : <span className="muted">da indicare</span>}</div></div>
              <div><div className="k">Canone mensile</div><div className="v">{s.lease ? eur(s.lease.rent_monthly) : s.tenure === 'OSPITATA' ? (s.host_name || 'ospitata') : <span className="muted">nessun contratto</span>}</div>{s.lease?.end_date && <div className="small muted">scade il {itDate(s.lease.end_date)}</div>}</div>
              <div><div className="k">Utenze</div><div className="v">{s.n_utilities ?? '–'}</div>{s.volture_aperte > 0 && <div className="small" style={{ color: 'var(--amber)' }}>{s.volture_aperte} volture aperte</div>}</div>
            </div>
            <div className="chips">
              <span className={`fa-chip ${s.n_planimetrie ? '' : 'amber'}`}><Icon name="image" />{s.n_planimetrie ? (s.published_room_at ? 'Planimetria in Room Planning' : 'Planimetria caricata') : 'Senza planimetria'}</span>
              <span className="fa-chip"><Icon name="qr" />{s.n_assets} dispositivi</span>
              {s.n_overdue > 0 && <span className="fa-chip red"><Icon name="calendar" />{s.n_overdue} scadenze scadute</span>}
              {s.n_wo_open > 0 && <span className="fa-chip amber"><Icon name="wrench" />{s.n_wo_open} interventi aperti</span>}
              {s.n_obblighi > 0 && <span className="fa-chip"><Icon name="doc" />{s.n_obblighi} obblighi</span>}
            </div>
          </Card>))}</div>)}
    </div>
  );
}
