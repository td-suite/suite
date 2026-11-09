// Retail · B2C · Laboratorio in sede (riordino del 09/11/2026): accettazioni Synclab dei client abbinati alle sedi TD (punti prelievo e
// centri), per sede e mese, esami più richiesti, confronto con lo stesso periodo dell'anno prima. Esiste con l'impostazione
// `synclab_privati_in_b2c` a true; a false la pagina lo dice (tutto Synclab è B2B). Fonte: GET /api/retail/laboratorio.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo, VarPct } from '../components/fonte.jsx';
import { qs, base } from '../api.js';
import { num, eur0, monthLabel, today } from '../format.js';

export default function Laboratorio() {
  const oggi = today();
  const [p, setP] = useState(periodoIniziale(oggi));
  const q = useApi(`/laboratorio${qs({ periodo: periodoQuery(p) })}`, [p.tipo, p.mese, p.trimestre, p.anno]);
  const d = q.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Laboratorio in sede</h1><div className="sub">Accettazioni del laboratorio fatte nei punti prelievo e nei centri TD (client StudioLab abbinati a una sede TD): per sede e mese, esami più richiesti, confronto con l'anno prima.</div></div>
        <div className="row"><Link className="btn ghost" to={`${base}/b2b/profilo-pazienti?perimetro=LAB_SEDE`}>Profilo dei pazienti</Link></div></div>
      {d && <FonteSynclab stato={d.stato} insiemi={['requests']} />}
      <div className="filters"><PeriodoSelect value={p} onChange={setP} oggi={oggi} /><div className="spacer" />{d?.attivo && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)} · anno prima {intervallo(d.periodo.prec)}</div>}</div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : !d.attivo ? <div className="alert info"><div>{d.motivo}. Si cambia in Retail &gt; Impostazioni.</div></div> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent"><div className="lbl">Accettazioni</div><div className="val">{num(d.totale.accettazioni)}</div><div className="delta"><VarPct v={d.var_accettazioni} /> <span className="muted">anno prima {num(d.anno_prima.accettazioni)}</span></div></div>
          <div className="card kpi"><div className="lbl">Esami</div><div className="val">{num(d.totale.esami)}</div><div className="delta"><span className="muted">anno prima {num(d.anno_prima.esami)}</span></div></div>
          <div className="card kpi"><div className="lbl">Sedi con accettazioni</div><div className="val">{num(d.sedi.filter((s) => s.totale.accettazioni).length)}</div><div className="delta"><span className="muted">nel periodo</span></div></div>
          <div className="card kpi"><div className="lbl">Valore (netti di riga)</div><div className="val">{eur0(d.totale.valore)}</div><div className="delta"><span className="muted">{d.totale.righe_senza_prezzo ? `${num(d.totale.righe_senza_prezzo)} righe senza prezzo` : 'dal gestionale'}</span></div></div>
        </div>
        <Card title="Accettazioni per sede e mese" flush>
          {!d.sedi.length ? <Empty>Nessuna accettazione dei punti TD nel periodo (i client StudioLab vanno abbinati alle sedi in Amministrazione &gt; Connettori &gt; Dati Synclab)</Empty> : <div className="table-wrap"><table className="t" data-testid="lab-sedi">
            <thead><tr><th>Sede</th>{d.mesi.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Totale</th><th className="num">Anno prima</th><th className="num">Variazione</th></tr></thead>
            <tbody>{d.sedi.map((s) => <tr key={s.site_id ?? 'nd'}><td>{s.site_id ? <Link to={`${base}/b2c/sedi/${s.site_id}`}>{s.sede}</Link> : <span className="muted">{s.sede}</span>}</td>
              {d.mesi.map((m) => <td key={m} className="num">{s.mesi[m] ? num(s.mesi[m].accettazioni) : <span className="muted">–</span>}</td>)}
              <td className="num strong">{num(s.totale.accettazioni)}</td><td className="num">{num(s.anno_prima.accettazioni)}</td><td className="num"><VarPct v={s.var_accettazioni} /></td></tr>)}
              <tr className="strong"><td>Totale</td>{d.per_mese.map((m) => <td key={m.mese} className="num">{num(m.accettazioni)}</td>)}<td className="num">{num(d.totale.accettazioni)}</td><td className="num">{num(d.anno_prima.accettazioni)}</td><td className="num"><VarPct v={d.var_accettazioni} /></td></tr></tbody>
          </table></div>}
        </Card>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Esami più richiesti (rete)" flush>
            {!d.esami.length ? <Empty>Nessun esame</Empty> : <table className="t" data-testid="lab-esami"><thead><tr><th>Esame</th><th className="num">Esami</th><th className="num">Anno prima</th><th className="num">Variazione</th></tr></thead>
              <tbody>{d.esami.map((e) => <tr key={e.codice}><td>{e.descrizione || e.codice}<div className="small muted mono">{e.codice}</div></td><td className="num">{num(e.esami)}</td><td className="num">{num(e.anno_prima)}</td><td className="num"><VarPct v={e.variazione} /></td></tr>)}</tbody></table>}
          </Card>
          <Card title="Primi 5 esami per sede" flush>
            {!d.esami_per_sede.length ? <Empty>Nessun esame</Empty> : <table className="t"><thead><tr><th>Sede</th><th>Esami</th></tr></thead>
              <tbody>{d.esami_per_sede.map((s) => <tr key={s.site_id ?? 'nd'}><td>{s.sede}</td><td className="small">{s.esami.map((e) => `${e.descrizione || e.codice} (${num(e.esami)})`).join(', ') || '–'}</td></tr>)}</tbody></table>}
          </Card>
        </div>
      </>}
    </div>
  );
}
