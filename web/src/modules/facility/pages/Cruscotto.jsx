// Cruscotto: KPI delle manutenzioni, scadenze dei prossimi 30 giorni, interventi aperti, anomalie dei consumi, immobili senza planimetria
import React from 'react';
import { Link } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Kpi } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isSite, isManutentore } from '../index.jsx';
import { PlanStatus, Priority, WoStatus, Alert } from '../components/bits.jsx';
import { itDate, num, eur, pct, giorni, ore, meseLabel, VECTOR, SITE_KIND, PERFORMER } from '../format.js';

export default function Cruscotto() {
  const { user } = useAuth();
  const { data: d, loading, error } = useApi('/dashboard');
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!d && loading) return <div className="page"><Loading /></div>;
  const k = d.kpi;
  const site = isSite(user); const mnt = isManutentore(user);
  return (
    <div className="page">
      <PageHead title="Cruscotto" icon="stats" sub={site ? 'La tua sede: scadenze, controlli da confermare, guasti segnalati e consumi.' : mnt ? 'Le scadenze e gli interventi affidati a te o alla tua azienda.' : `Facility e manutenzioni della rete, anno ${d.year}.`}
        actions={!mnt && <Link className="btn" to={`${base}/interventi?nuovo=1`}><Icon name="plus" />Segnala un guasto</Link>} />
      {!d.finance && !mnt && <Alert tone="warn" icon="alert">Payments non avviato: utenze, bollette, canoni ed energia restano disattivati finché lo Scadenziario strutture di Payments non è attivo.</Alert>}
      <div className="fa-kpis">
        <Kpi accent label="Scadenze scadute" value={k.scadute} foot={`${k.prossimi30} nei prossimi 30 giorni`} />
        <Kpi label="Scadenze rispettate" value={k.rispettate_pct == null ? '–' : `${num(k.rispettate_pct, 1)}%`} foot={`${k.eseguite} eseguite nel ${d.year}`} />
        <Kpi label="Interventi aperti" value={k.interventi_aperti} foot={`${k.interventi_urgenti_aperti} urgenti o ad alta priorità`} />
        <Kpi label="MTTR" value={ore(k.mttr_ore)} foot={k.sla_pct == null ? 'tempo medio di ripristino' : `${num(k.sla_pct, 1)}% chiusi entro lo SLA`} />
        <Kpi label="Dispositivi non conformi" value={k.non_conformi} foot={`${k.dispositivi} in servizio · ${k.fuori_servizio} fuori servizio`} />
        {d.energia && <Kpi label={`Energia ${d.year} (kWh)`} value={num(d.energia.kwh)} foot={`${pct(d.energia.delta_pct)} sugli stessi mesi del ${d.year - 1} · ${eur(d.energia.cost)} · ${num((d.energia.co2 || 0) / 1000, 1)} t CO2`} />}
      </div>
      <div className="fa-wide">
        <Card title="Scadenze dei prossimi 30 giorni" icon="calendar" flush actions={<Link className="btn sm ghost" to={`${base}/piano`}>Piano</Link>}>
          {!d.scadenze.length ? <Empty compact icon="check" title="Nessuna scadenza nei prossimi 30 giorni" /> : (
            <table className="t fa-table"><thead><tr><th>Scadenza</th><th>Attività</th><th>Sede</th><th>A cura di</th><th>Stato</th></tr></thead>
              <tbody>{d.scadenze.map((p) => <tr key={p.id} className={p.days < 0 ? 'late' : ''}><td className="num">{itDate(p.due_date)}<div className="small muted">{giorni(p.days)}</div></td><td><Link to={`${base}/piano?id=${p.id}`}>{p.title}</Link>{p.asset_code && <div className="small muted">{p.asset_code}</div>}</td><td>{p.site_name}</td><td className="small">{PERFORMER[p.performer]}</td><td><PlanStatus s={p.effective_status} /></td></tr>)}</tbody></table>)}
        </Card>
        <Card title="Interventi aperti" icon="wrench" flush actions={<Link className="btn sm ghost" to={`${base}/interventi`}>Tutti</Link>}>
          {!d.interventi.length ? <Empty compact icon="check" title="Nessun intervento aperto" /> : <ul className="fa-list" style={{ padding: 12 }}>{d.interventi.map((w) => <li key={w.id}><span><Link className="t" to={`${base}/interventi/${w.id}`}>{w.title}</Link><div className="m">{w.code} · {w.site_name} · {w.sla.late ? <b style={{ color: 'var(--red)' }}>SLA superato</b> : `entro ${ore(w.sla.hours_left)}`}</div></span><span className="row" style={{ gap: 6 }}><Priority p={w.priority} /><WoStatus s={w.status} /></span></li>)}</ul>}
        </Card>
      </div>
      {!mnt && <div className="fa-two">
        <Card title="Anomalie dei consumi (ultimi 12 mesi)" icon="alert" flush actions={<Link className="btn sm ghost" to={`${base}/energia`}>Energia</Link>}>
          {!d.finance ? <Empty compact icon="bolt" title="Payments non avviato" /> : !d.anomalie?.length ? <Empty compact icon="check" title="Nessuna anomalia">Nessun mese oltre la soglia rispetto all'anno prima o alla media dei tre mesi precedenti.</Empty> :
            <ul className="fa-list" style={{ padding: 12 }}>{d.anomalie.map((a, i) => <li key={i}><span><span className="t">{a.site_name} · {VECTOR[a.vector]}</span><div className="m">{meseLabel(a.month)}: {num(a.value)} {a.unit} contro {num(a.ref)} ({a.ref_kind === 'ANNO_PRECEDENTE' ? 'stesso mese anno prima' : 'media 3 mesi'})</div></span><b style={{ color: 'var(--red)' }}>{pct(a.delta_pct)}</b></li>)}</ul>}
        </Card>
        <Card title="Immobili senza planimetria" icon="building" flush actions={<Link className="btn sm ghost" to={`${base}/immobili`}>Immobili</Link>}>
          {!d.senza_planimetria.length ? <Empty compact icon="check" title="Tutti gli immobili hanno la planimetria" /> : <ul className="fa-list" style={{ padding: 12 }}>{d.senza_planimetria.map((s) => <li key={s.id}><span><span className="t">{s.name}</span><div className="m">{SITE_KIND[s.kind] || s.kind}</div></span><Link className="btn sm ghost" to={`${base}/immobili/${s.id}`}>Carica</Link></li>)}</ul>}
          {!d.room && <div className="small muted" style={{ padding: '0 12px 12px' }}>Room Planning non è avviato: le planimetrie restano nell'anagrafica Sedi e si pubblicano quando Room sarà attivo.</div>}
        </Card>
      </div>}
      {k.costi_per_sede.length > 0 && <Card title={`Costi di manutenzione ${d.year}`} icon="stats" flush>
        <table className="t fa-table"><thead><tr><th>Sede</th><th className="num">Costo</th><th>Tipologia</th><th className="num">Costo</th></tr></thead><tbody>
          {Array.from({ length: Math.max(k.costi_per_sede.length, k.costi_per_tipo.length) }, (_, i) => <tr key={i}><td>{k.costi_per_sede[i]?.name}</td><td className="num">{k.costi_per_sede[i] ? eur(k.costi_per_sede[i].costo) : ''}</td><td>{k.costi_per_tipo[i]?.name}</td><td className="num">{k.costi_per_tipo[i] ? eur(k.costi_per_tipo[i].costo) : ''}</td></tr>)}
        </tbody></table>
      </Card>}
    </div>
  );
}
