// Retail · B2C · Prenotazioni online e prima disponibilità (TuoTempo), riordino del 09/11/2026. Prima disponibilità per sede e tipologia
// dall'ultimo giorno dello storico, andamento giornaliero, medici attivi e soddisfazione per area. Le prenotazioni vere non ci sono ancora
// (Docplanner non ha aperto le API): la pagina lo dice. Fonte: GET /api/retail/prenotazioni.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { FonteB2C } from '../components/fonte.jsx';
import { SiteSelect } from '../components/filters.jsx';
import { qs, base } from '../api.js';
import { num, itDate } from '../format.js';

const gg = (v) => (v == null ? '–' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })} gg`);
function Diff({ cur, prev }) {
  if (cur == null || prev == null) return <span className="muted">–</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  return <span style={{ color: d > 0 ? '#b3372f' : d < 0 ? '#2f7d5b' : 'inherit', fontWeight: 650 }}>{d > 0 ? '+' : ''}{d.toLocaleString('it-IT')} gg</span>;
}

export default function Prenotazioni() {
  const [giorni, setGiorni] = useState(30);
  const [site, setSite] = useState('');
  const q = useApi(`/prenotazioni${qs({ giorni, site_id: site })}`, [giorni, site]);
  const d = q.data;
  const maxMed = Math.max(1, ...(d?.storico || []).map((x) => Number(x.mediana || 0)));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Prenotazioni online e prima disponibilità</h1><div className="sub">Quanto bisogna aspettare per il primo posto libero, sede per sede e per tipologia di prestazione, con l'andamento giornaliero; medici attivi e soddisfazione su TuoTempo.</div></div>
        <div className="row"><Link className="btn ghost" to={`${base}/b2c/listino-online`}>Listino online vs cassa</Link><Link className="btn ghost" to={`${base}/connettori`}>Connettori</Link></div></div>
      {d && <FonteB2C fonte="TuoTempo (Key Entities, copia locale)" aggiornato={d.connettore.ultimo_allineamento} dettaglio={`connettore ${d.connettore.attivo ? 'attivo' : 'non attivo'}${d.ultimo_giorno ? ` · storico dal ${itDate(d.primo_giorno)} al ${itDate(d.ultimo_giorno)} (${num(d.giorni_storico)} giorni)` : ' · nessuno storico'}`} />}
      {d && <div className="alert warn" style={{ marginBottom: 12 }} data-testid="prenotazioni-non-disponibili"><div><b>Prenotazioni online: dato non ancora disponibile.</b> {d.prenotazioni.nota}</div></div>}
      <div className="filters">
        <label className="f">Andamento<select value={giorni} onChange={(e) => setGiorni(Number(e.target.value))}>{[14, 30, 90, 180].map((x) => <option key={x} value={x}>ultimi {x} giorni</option>)}</select></label>
        <SiteSelect value={site} onChange={setSite} />
      </div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : !d.ultimo_giorno ? <Card><Empty>Nessuno storico della prima disponibilità: si alimenta con l'allineamento TuoTempo (Retail &gt; Connettori &gt; Allinea adesso, poi ogni notte)</Empty></Card> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent"><div className="lbl">Attesa mediana {site ? 'della sede' : 'di rete'}</div><div className="val">{gg(d.rete.mediana)}</div><div className="delta"><Diff cur={d.rete.mediana} prev={d.rete.mediana_settimana_prima} /> <span className="muted">vs {d.settimana_prima ? itDate(d.settimana_prima) : 'una settimana prima'}</span></div></div>
          <div className="card kpi"><div className="lbl">Prestazioni con disponibilità</div><div className="val">{num(d.rete.prestazioni)}</div><div className="delta"><span className="muted">al {itDate(d.ultimo_giorno)}</span></div></div>
          <div className="card kpi"><div className="lbl">Prestazioni prenotabili online</div><div className="val">{num(d.rete.prestazioni_online)}</div><div className="delta"><span className="muted">su {num(d.rete.prestazioni_tuotempo)} in TuoTempo</span></div></div>
          <div className="card kpi"><div className="lbl">Aree TuoTempo abbinate</div><div className="val">{num(d.rete.aree_abbinate)}</div><div className="delta"><span className="muted">su {num(d.rete.aree)} aree nostre</span></div></div>
        </div>
        <div>
          <Card title={`Per sede (${itDate(d.ultimo_giorno)})`} flush>
            {!d.per_sede.length ? <Empty>Nessuna prestazione</Empty> : <div className="table-wrap"><table className="t" data-testid="per-sede"><thead><tr><th>Sede</th><th className="num">Prestazioni</th><th className="num">Mediana</th><th className="num">Min – max</th><th className="num">7 giorni prima</th></tr></thead>
              <tbody>{d.per_sede.map((s) => <tr key={s.site_id ?? 'nd'}><td>{s.site_id ? <Link to={`${base}/b2c/sedi/${s.site_id}`}>{s.sede}</Link> : <span className="muted">{s.sede}</span>}{s.area && <div className="small muted">area {s.area}</div>}</td><td className="num">{num(s.prestazioni)}</td><td className="num strong">{gg(s.mediana)}</td><td className="num small">{gg(s.minimo)} – {gg(s.massimo)}</td><td className="num"><Diff cur={s.mediana} prev={s.mediana_settimana_prima} /></td></tr>)}</tbody></table></div>}
          </Card>
          <Card className="mt" title={`Per tipologia (${itDate(d.ultimo_giorno)})`} flush>
            {!d.per_tipologia.length ? <Empty>Nessuna prestazione</Empty> : <div className="table-wrap"><table className="t" data-testid="per-tipologia"><thead><tr><th>Tipologia</th><th className="num">Prestazioni</th><th className="num">Mediana</th><th className="num">Min – max</th></tr></thead>
              <tbody>{d.per_tipologia.map((t) => <tr key={t.typologyid || 'nd'}><td>{t.tipologia}</td><td className="num">{num(t.prestazioni)}</td><td className="num strong">{gg(t.mediana)}</td><td className="num small">{gg(t.minimo)} – {gg(t.massimo)}</td></tr>)}</tbody></table></div>}
          </Card>
          <Card className="mt" title={`Andamento giornaliero (ultimi ${giorni} giorni)`} flush>
            {!d.storico.length ? <Empty>Nessun giorno nello storico</Empty> : <div className="table-wrap"><table className="t" data-testid="storico"><thead><tr><th>Giorno</th><th className="num">Prestazioni</th><th className="num">Mediana</th><th style={{ width: '40%' }} /></tr></thead>
              <tbody>{[...d.storico].reverse().map((x) => <tr key={x.data}><td>{itDate(x.data)}</td><td className="num">{num(x.prestazioni)}</td><td className="num">{gg(x.mediana)}</td><td><div style={{ height: 8, borderRadius: 4, background: 'var(--teal)', width: `${Math.round((Number(x.mediana || 0) / maxMed) * 100)}%` }} /></td></tr>)}</tbody></table></div>}
          </Card>
          <Card className="mt" title="Medici attivi e soddisfazione per area" flush>
            {!d.risorse.length ? <Empty>Nessuna area TuoTempo</Empty> : <div className="table-wrap"><table className="t" data-testid="risorse"><thead><tr><th>Area / sede</th><th className="num">Medici attivi</th><th className="num">Soddisfazione</th></tr></thead>
              <tbody>{d.risorse.map((r) => <tr key={r.areaid}><td>{r.sede || <span className="muted">area senza sede</span>}<div className="small muted">{r.area}</div></td><td className="num">{num(r.attive)}<span className="small muted"> / {num(r.tutte)}</span></td><td className="num">{r.soddisfazione != null ? <Badge tone={r.soddisfazione >= 4 ? 'green' : 'mauve'}>{r.soddisfazione.toLocaleString('it-IT')} su {num(r.con_soddisfazione)}</Badge> : <span className="muted">–</span>}</td></tr>)}</tbody></table></div>}
          </Card>
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>Ipotesi dichiarata: {d.ipotesi}</div>
      </>}
    </div>
  );
}
