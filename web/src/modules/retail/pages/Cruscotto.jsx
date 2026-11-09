// Retail · Cruscotto complessivo di rete (riordino del 09/11/2026, decisione del CEO): B2C e B2B affiancati nello stesso periodo, confronto
// con lo stesso periodo dell'anno prima, quota fuori area, stato dei tre connettori (GIPO, TuoTempo, StudioLAB/Synclab) e link alle due
// sezioni. Niente grafici decorativi: tabella e indicatori essenziali. Fonte: GET /api/retail/stats/rete.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Badge } from '../components/ui.jsx';
import { PeriodoSelect, periodoQuery, periodoIniziale, intervallo, VarPct } from '../components/fonte.jsx';
import { qs, base } from '../api.js';
import { eur0, num, pct, itDateTime, itDate, today } from '../format.js';

const d1 = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 }));
const quota = (fa) => (fa?.quota == null ? <span className="muted">non valutabile</span> : <>{pct(fa.quota, 1)} <span className="small muted">({num(fa.fuori)} su {num(fa.valutabili)})</span></>);

export default function Cruscotto() {
  const oggi = today();
  const [p, setP] = useState(periodoIniziale(oggi, 'mese'));
  const q = useApi(`/stats/rete${qs({ periodo: periodoQuery(p) })}`, [p.tipo, p.mese, p.trimestre, p.anno]);
  const d = q.data;
  const g = d?.b2c.gipo, tt = d?.b2c.tuotempo, lab = d?.b2c.laboratorio, b2b = d?.b2b.synclab;
  // righe della tabella: [sezione, voce, valore, anno prima, variazione, fonte]
  const righe = d ? [
    ['B2C', 'Accettazioni GIPO', num(g.accettazioni), num(g.anno_prima.accettazioni), g.var_accettazioni, 'GIPO'],
    ['B2C', 'Vendite GIPO (netto)', eur0(g.vendite), eur0(g.anno_prima.vendite), g.var_vendite, 'GIPO'],
    ['B2C', 'Prestazioni vendute GIPO', num(g.prestazioni), num(g.anno_prima.prestazioni), g.anno_prima.prestazioni ? Math.round(((g.prestazioni - g.anno_prima.prestazioni) / g.anno_prima.prestazioni) * 1000) / 10 : null, 'GIPO'],
    ['B2C', 'Prenotazioni online', <span className="muted small">non ancora disponibili</span>, '–', null, 'TuoTempo'],
    ['B2C', `Prima disponibilità, mediana di rete${tt.ultimo_giorno ? ` (${itDate(tt.ultimo_giorno)})` : ''}`, tt.attesa_mediana == null ? <span className="muted">nessuno storico</span> : `${d1(tt.attesa_mediana)} giorni`, tt.attesa_settimana_prima == null ? '–' : `${d1(tt.attesa_settimana_prima)} gg (7 giorni prima)`, null, 'TuoTempo'],
    ...(lab && !lab.spento ? [
      ['B2C', 'Laboratorio in sede: accettazioni', num(lab.accettazioni), num(lab.anno_prima.accettazioni), lab.var_accettazioni, 'StudioLab'],
      ['B2C', 'Laboratorio in sede: esami', num(lab.esami), num(lab.anno_prima.esami), lab.anno_prima.esami ? Math.round(((lab.esami - lab.anno_prima.esami) / lab.anno_prima.esami) * 1000) / 10 : null, 'StudioLab'],
    ] : []),
    ...(b2b ? [
      ['B2B', 'Accettazioni', num(b2b.accettazioni), num(b2b.anno_prima.accettazioni), b2b.var_accettazioni, 'StudioLab'],
      ['B2B', 'Esami', num(b2b.esami), num(b2b.anno_prima.esami), b2b.anno_prima.esami ? Math.round(((b2b.esami - b2b.anno_prima.esami) / b2b.anno_prima.esami) * 1000) / 10 : null, 'StudioLab'],
      ['B2B', 'Valore della produzione', eur0(b2b.valore), eur0(b2b.anno_prima.valore), b2b.var_valore, 'StudioLab'],
      ['B2B', 'Clienti con produzione', num(b2b.clienti), num(b2b.anno_prima.clienti), null, 'StudioLab'],
      ['B2B', 'Fatturato da documenti', eur0(b2b.documenti.fatturato), eur0(b2b.anno_prima.documenti.fatturato), b2b.anno_prima.documenti.fatturato ? Math.round(((Number(b2b.documenti.fatturato || 0) - b2b.anno_prima.documenti.fatturato) / Math.abs(b2b.anno_prima.documenti.fatturato)) * 1000) / 10 : null, 'StudioLab'],
    ] : []),
  ] : [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cruscotto di rete</h1><div className="sub">B2C (centri medici e punti prelievo: GIPO e TuoTempo{d?.privati_in_b2c ? ', più il laboratorio in sede' : ''}) e B2B (service e medicina del lavoro: tutto da StudioLab), nello stesso periodo e con lo stesso periodo dell'anno prima.</div></div>
        <div className="row"><Link className="btn ghost" to={`${base}/b2c`}>Sezione B2C</Link><Link className="btn ghost" to={`${base}/b2b`}>Sezione B2B</Link></div>
      </div>
      <div className="filters"><PeriodoSelect value={p} onChange={setP} oggi={oggi} /><div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)}{d.periodo.troncato ? ' (fino a oggi)' : ''} · anno prima {intervallo(d.periodo.prec)}</div>}</div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent"><div className="lbl">B2C · accettazioni GIPO</div><div className="val">{num(g.accettazioni)}</div><div className="delta"><VarPct v={g.var_accettazioni} /> <span className="muted">vs anno prima · {eur0(g.vendite)}</span></div></div>
          <div className="card kpi"><div className="lbl">B2C · prima disponibilità</div><div className="val">{tt.attesa_mediana == null ? '–' : `${d1(tt.attesa_mediana)} gg`}</div><div className="delta"><span className="muted">{tt.ultimo_giorno ? `mediana di rete al ${itDate(tt.ultimo_giorno)} · ${num(tt.prestazioni)} prestazioni` : 'nessuno storico TuoTempo'}</span></div></div>
          <div className="card kpi"><div className="lbl">B2B · accettazioni StudioLab</div><div className="val">{b2b ? num(b2b.accettazioni) : '–'}</div><div className="delta">{b2b ? <><VarPct v={b2b.var_accettazioni} /> <span className="muted">vs anno prima · {num(b2b.clienti)} clienti</span></> : <span className="muted">{d.b2b.nota}</span>}</div></div>
          <div className="card kpi"><div className="lbl">B2B · fatturato da documenti</div><div className="val">{b2b ? eur0(b2b.documenti.fatturato) : '–'}</div><div className="delta"><span className="muted">{b2b ? `produzione ${eur0(b2b.valore)} · ${num(b2b.documenti.note_credito)} NC · ${num(b2b.documenti.annullati)} annullati esclusi` : 'nessun documento'}</span></div></div>
        </div>
        <Card title="B2C e B2B affiancati" flush>
          <div className="table-wrap"><table className="t" data-testid="rete">
            <thead><tr><th>Sezione</th><th>Indicatore</th><th className="num">Periodo</th><th className="num">Anno prima</th><th className="num">Variazione</th><th>Fonte</th></tr></thead>
            <tbody>{righe.map(([s, v, val, prev, vr, f], i) => <tr key={i}><td><Badge tone={s === 'B2C' ? 'teal' : 'mauve'}>{s}</Badge></td><td>{v}</td><td className="num strong">{val}</td><td className="num">{prev}</td><td className="num"><VarPct v={vr} /></td><td className="small">{f}</td></tr>)}</tbody>
          </table></div>
          {lab?.spento && <div className="small muted" style={{ padding: 12 }}>{lab.nota}</div>}
          {!b2b && <div className="small muted" style={{ padding: 12 }}>{d.b2b.nota}</div>}
          <div className="small muted" style={{ padding: '4px 12px 12px' }}>{tt.nota_prenotazioni}. Valore della produzione = somma dei netti di riga del gestionale; fatturato = contributo netto una volta per documento (note di credito comprese, annullati esclusi).</div>
        </Card>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Quota fuori area" flush>
            <table className="t"><thead><tr><th>Perimetro</th><th className="num">Fuori area</th></tr></thead><tbody>
              <tr><td>B2C · clienti GIPO</td><td className="num">{quota(g.fuori_area)}</td></tr>
              {lab && !lab.spento && <tr><td>B2C · laboratorio in sede</td><td className="num">{quota(lab.fuori_area)}</td></tr>}
              <tr><td>B2B · pazienti StudioLab</td><td className="num">{quota(b2b?.fuori_area)}</td></tr>
            </tbody></table>
            <div className="small muted" style={{ padding: 12 }}>Fuori area = comune di residenza diverso da quello della sede e provincia diversa; non valutabili i casi senza sede o senza comune.</div>
          </Card>
          <Card title="Connettori" flush>
            <table className="t" data-testid="connettori"><thead><tr><th>Connettore</th><th>Serve a</th><th>Ultimo aggiornamento</th></tr></thead><tbody>
              {d.connettori.map((c) => <tr key={c.chiave}><td><div className="strong">{c.nome}</div><Badge tone={c.attivo ? 'green' : 'grey'}>{c.attivo ? 'attivo' : 'non attivo'}</Badge></td><td className="small">{c.ruolo}</td>
                <td className="small">{c.ultimo_aggiornamento ? itDateTime(c.ultimo_aggiornamento) : <span className="muted">mai</span>}<div className="muted">{c.dettaglio}</div><Link to={c.link}>Apri</Link></td></tr>)}
            </tbody></table>
          </Card>
        </div>
      </>}
    </div>
  );
}
