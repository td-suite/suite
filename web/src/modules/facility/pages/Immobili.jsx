// Immobili: una card per sede dell'anagrafica (immobile creato al volo) con titolo di godimento, superficie, canone da Payments,
// planimetria (dall'anagrafica Sedi) e stato in Room Planning, dispositivi, scadenze scadute, interventi aperti, utenze e volture.
// Filtro per titolo di godimento (Tutti / Proprietà / Locazione / Comodato / Ospitata) con i conteggi, stato nel query string (?titolo=)
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Alert } from '../components/bits.jsx';
import { SITE_KIND, TENURE, num, eur, itDate } from '../format.js';

const PERIOD_MONTHS = { MESE: 1, TRIMESTRE: 3, SEMESTRE: 6, ANNO: 12 };
const TENURE_FILTER = [['', 'Tutti'], ['PROPRIETA', 'Proprietà'], ['LOCAZIONE', 'Locazione'], ['COMODATO', 'Comodato'], ['OSPITATA', 'Ospitata']];

// Titolo di godimento e canone vengono dall'anagrafica Sedi (Amministrazione), il canone vigente dal contratto di Payments se c'è
export default function Immobili() {
  const { data, loading, error } = useApi('/immobili');
  // ricerca e titolo di godimento nel query string: il link all'elenco filtrato si condivide e sopravvive al ritorno dalla scheda
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const titolo = TENURE_FILTER.some(([k]) => k && k === sp.get('titolo')) ? sp.get('titolo') : '';
  const setParam = (k, v) => setSp((cur) => { const n = new URLSearchParams(cur); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const found = data.rows.filter((s) => !q || `${s.name} ${s.code} ${s.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  const count = (k) => (k ? found.filter((s) => s.tenure === k).length : found.length);   // conteggi sulla ricerca in corso
  const rows = found.filter((s) => !titolo || s.tenure === titolo);
  return (
    <div className="page">
      <PageHead title="Immobili" icon="building" sub="Le sedi dell'anagrafica con dati immobiliari, contratto di affitto, planimetria, dispositivi e utenze. Sedi, titolo di godimento e canone si gestiscono in Amministrazione > Sedi."
        actions={<div style={{ minWidth: 260 }}><SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Cerca sede" /></div>} />
      <div className="row" role="group" aria-label="Titolo di godimento" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <span className="small muted" style={{ marginRight: 4 }}>Titolo di godimento</span>
        {TENURE_FILTER.map(([k, label]) => <button key={k || 'tutti'} type="button" className={`btn sm ${titolo === k ? '' : 'ghost'}`} aria-pressed={titolo === k} onClick={() => setParam('titolo', k)} disabled={k && !count(k) && titolo !== k}>{label} <span className="fa-count">{count(k)}</span></button>)}
      </div>
      {!data.finance && <Alert tone="warn" icon="alert">Payments non avviato: canoni e utenze non sono disponibili.</Alert>}
      {!rows.length ? <Card>{data.rows.length ? <Empty icon="building" title="Nessun immobile con questi filtri">{titolo ? <button type="button" className="btn sm ghost" onClick={() => setParam('titolo', '')}>Mostra tutti i titoli</button> : 'Cambia la ricerca.'}</Empty> : <Empty icon="building" title="Nessun immobile">Le sedi attive dell'anagrafica (non service) compaiono qui da sole.</Empty>}</Card> : (
        <div className="fa-cards">{rows.map((s) => (
          <Card key={s.site_id} className="fa-card" title={<Link to={`${base}/immobili/${s.site_id}`}>{s.name}</Link>} actions={<Badge tone={s.tenure === 'PROPRIETA' ? 'green' : s.tenure === 'OSPITATA' ? 'mauve' : s.tenure === 'COMODATO' ? 'grey' : 'blue'} dot={false}>{TENURE[s.tenure]}</Badge>}>
            <div className="small muted" style={{ marginBottom: 10 }}>{SITE_KIND[s.kind] || s.kind}{s.city ? ` · ${s.city}` : ''} · {s.code}{s.manager_name ? ` · ${s.manager_name}` : ''}</div>
            <div className="fa-facts">
              <div><div className="k">Superficie</div><div className="v">{s.surface_sqm ? `${num(s.surface_sqm)} m2` : <span className="muted">da indicare</span>}</div></div>
              <div><div className="k">Canone mensile</div><div className="v">{s.lease ? eur(s.lease.rent_monthly) : s.tenure === 'LOCAZIONE' && s.rent_amount != null ? eur(Number(s.rent_amount) / (PERIOD_MONTHS[s.rent_period] || 1)) : s.tenure === 'OSPITATA' ? (s.host_name || 'ospitata') : s.tenure === 'PROPRIETA' ? <span className="muted">di proprietà</span> : s.tenure === 'COMODATO' ? <span className="muted">comodato</span> : <span className="muted">da indicare in Sedi</span>}</div>{(s.lease?.end_date || s.lease_end) && <div className="small muted">scade il {itDate(s.lease?.end_date || s.lease_end)}</div>}</div>
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
