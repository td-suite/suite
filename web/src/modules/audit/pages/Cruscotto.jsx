// Cruscotto: auto-audit del mese mancanti, inviati da verificare, totali, livelli delle sedi, ultima sintesi TD, attività recente
import React from 'react';
import { Link } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Kpi, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor, isSite } from '../index.jsx';
import { Score, Level, KindBadge, StatusBadge, ScoreCell } from '../components/Score.jsx';
import { mese, dataAudit, soggetto, itDateTime, LEVEL } from '../format.js';

export default function Cruscotto() {
  const { user } = useAuth();
  const { data, loading, error } = useApi('/dashboard');
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const d = data;
  const site = isSite(user);
  return (
    <div className="page">
      <PageHead title="Cruscotto" icon="stats" sub={`Audit SGI · mese di ${mese(d.period)}. ${site ? 'Le tue sedi: compila l\'auto-audit del mese entro fine mese.' : 'Auto-audit mensili, audit interni, terze parti e partner ISO 37001 della rete.'}`} />
      <div className="au-kpis">
        <Kpi accent label={site ? 'Auto-audit da compilare' : 'Auto-audit del mese mancanti'} value={d.mancanti.length} foot={`${d.strutture} sedi struttura attive`} />
        {!site && <Kpi label="Inviati da verificare" value={d.da_verificare.length} foot="colonna Verifica da compilare" />}
        <Kpi label="Audit ultimi 12 mesi" value={d.totali.ultimi12} foot={`${d.totali.auto} auto · ${d.totali.interni} interni · ${d.totali.terzi} terze parti${site ? '' : ` · ${d.totali.partner} partner`}`} />
        <Kpi label="NC negli ultimi 3 mesi" value={d.nc_3m} foot="non conformità registrate nei report" />
      </div>
      <div className="grid au-two">
        <Card title={site ? 'Auto-audit del mese' : 'Sedi senza auto-audit inviato'} icon="building" flush>
          {!d.mancanti.length ? <Empty icon="check" compact title="Tutte le sedi hanno inviato l'auto-audit del mese" /> : <ul className="au-list" style={{ padding: 12 }}>{d.mancanti.map((s) => <li key={s.id}><span><b>{s.name}</b> <span className="small muted">{s.status === 'BOZZA' ? 'bozza iniziata' : 'non iniziato'}</span></span>{s.audit_id ? <Link className="btn sm" to={`${base}/miei/${s.audit_id}`}>Apri</Link> : <Link className="btn sm ghost" to={`${base}/sedi`}>Sede</Link>}</li>)}</ul>}
        </Card>
        {!site ? <Card title="Auto-audit inviati da verificare" icon="check" flush>
          {!d.da_verificare.length ? <Empty icon="check" compact title="Nessun auto-audit in attesa di verifica" /> : <ul className="au-list" style={{ padding: 12 }}>{d.da_verificare.map((a) => <li key={a.id}><span><b>{a.site_name}</b> <span className="small muted">{mese(a.period)} · sede {a.score ?? '–'}% · inviato {itDateTime(a.conducted_at)}</span></span><Link className="btn sm" to={`${base}/miei/${a.id}`}>Verifica</Link></li>)}</ul>}
        </Card> : <Card title="Livello della tua sede" icon="sparkle">{d.classifica.length ? d.classifica.map((s) => <div key={s.id} style={{ display: 'flex', gap: 14, alignItems: 'center' }}><Score value={s.score} big level={s.level} /><div><b>{s.name}</b><div><Level letter={s.level} /></div><div className="small muted">sintesi del {itDateTime(s.computed_at)} · <Link to={`${base}/sedi/${s.id}`}>apri la scheda</Link></div></div></div>) : <Empty compact icon="sparkle" title="Nessuna sintesi per la tua sede">La sintesi la genera Qualità dal widget Audit SGI.</Empty>}</Card>}
      </div>
      {!site && <div className="grid au-two">
        <Card title="Allineamento SGI delle sedi" icon="sparkle" actions={<Link className="btn sm ghost" to={`${base}/sintesi`}>Sintesi TD</Link>}>
          {!d.classifica.length ? <Empty compact icon="sparkle" title="Nessuna sintesi di sede">Dalla pagina Sedi genera la sintesi con Claude per ogni sede.</Empty> : <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{['A', 'B', 'C', 'D'].map((l) => <Badge key={l} tone={LEVEL[l].tone} dot={false}>{l} {LEVEL[l].label}: {d.livelli.find((x) => x.level === l)?.n || 0}</Badge>)}</div>
            <table className="t au-table"><tbody>{d.classifica.map((s, i) => <tr key={s.id}><td className="muted">{i + 1}</td><td><Link className="strong" to={`${base}/sedi/${s.id}`}>{s.name}</Link></td><td><Score value={s.score} /></td><td><Level letter={s.level} /></td><td className="small muted">{itDateTime(s.computed_at)}</td></tr>)}</tbody></table>
          </>}
        </Card>
        <Card title="Sintesi della rete" icon="stats" actions={<Link className="btn sm ghost" to={`${base}/sintesi`}>Apri</Link>}>
          {d.sintesi_td ? <div style={{ display: 'flex', gap: 16 }}><div><Score value={d.sintesi_td.score} big level={d.sintesi_td.level} /><div><Level letter={d.sintesi_td.level} /></div></div><div><div className="au-giudizio">{d.sintesi_td.giudizio}</div><div className="small muted" style={{ marginTop: 6 }}>Generata il {itDateTime(d.sintesi_td.generated_at)}</div></div></div> : <Empty compact icon="sparkle" title="Nessuna sintesi TD">Generala dalla pagina Sintesi TD quando le sedi hanno audit o sintesi.</Empty>}
        </Card>
      </div>}
      <Card title="Attività recente" icon="clock" flush>
        {!d.recenti.length ? <Empty compact icon="folder" title="Nessun audit">Il primo auto-audit nasce dalla pagina I miei audit o Sedi.</Empty> : <table className="t au-table"><thead><tr><th>Data / mese</th><th>Tipo</th><th>Sede / partner</th><th>Stato</th><th>Punteggio</th><th>Livello</th><th>Aggiornato</th></tr></thead>
          <tbody>{d.recenti.map((a) => <tr key={a.id}><td><Link to={`${base}/audit/${a.id}`}>{dataAudit(a)}</Link></td><td><KindBadge k={a.kind} /></td><td className="strong">{soggetto(a)}</td><td><StatusBadge s={a.status} /></td><td><ScoreCell a={a} /></td><td><Level letter={a.level} short /></td><td className="small muted">{itDateTime(a.updated_at)}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}
