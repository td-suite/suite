// Retail · B2B · Documenti emessi (ex "Fatturato da documenti", riordino del 09/11/2026; v0.68.5: dato SECONDARIO, la grandezza principale è la
// produzione erogata): per cliente e mese dai documenti economici di StudioLab (Synclab):
// contributo netto una volta per documento, note di credito separate, annullati/proforma e tipo sconosciuto esclusi e contati.
// Fonte: GET /api/retail/b2b/fatturato.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo } from '../components/fonte.jsx';
import { qs } from '../api.js';
import { eur0, num, monthLabel, today } from '../format.js';
import { linkCliente } from './CruscottoB2B.jsx';

export default function B2BFatturato() {
  const oggi = today();
  const [p, setP] = useState(periodoIniziale(oggi));
  const q = useApi(`/b2b/fatturato${qs({ periodo: periodoQuery(p) })}`, [p.tipo, p.mese, p.trimestre, p.anno]);
  const d = q.data;
  const t = d?.totale;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Documenti emessi</h1><div className="sub">Dato secondario: la grandezza dei ricavi B2B è la produzione erogata (B2B &gt; Produzione). Documenti economici B2B del gestionale per cliente e mese. Le note di credito sono separate (importi negativi), i documenti annullati e i proforma sono esclusi e contati.</div></div></div>
      {d && <FonteSynclab stato={d.stato} insiemi={['invoices']} />}
      <div className="filters"><PeriodoSelect value={p} onChange={setP} oggi={oggi} /><div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)}</div>}</div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent"><div className="lbl">Documenti emessi (netto)</div><div className="val">{eur0(t.fatturato)}</div><div className="delta"><span className="muted">fatture {eur0(t.fatturato_fatture)} · NC {eur0(t.importo_nc || 0)}</span></div></div>
          <div className="card kpi"><div className="lbl">Fatture</div><div className="val">{num(t.fatture)}</div><div className="delta"><span className="muted">{num(t.documenti)} documenti in tutto</span></div></div>
          <div className="card kpi"><div className="lbl">Note di credito</div><div className="val">{num(t.note_credito)}</div><div className="delta"><span className="muted">{eur0(t.importo_nc || 0)}</span></div></div>
          <div className="card kpi"><div className="lbl">Esclusi</div><div className="val">{num(t.annullati + t.tipo_sconosciuto + t.senza_contributo)}</div><div className="delta"><span className="muted">{num(t.annullati)} annullati/proforma · {num(t.tipo_sconosciuto)} tipo sconosciuto · {num(t.senza_contributo)} senza contributo</span></div></div>
        </div>
        <Card flush>{!d.clienti.length ? <Empty>Nessun documento B2B nel periodo</Empty> : <div className="table-wrap"><table className="t" data-testid="fatturato">
          <thead><tr><th>Cliente</th>{d.mesi.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Fatture</th><th className="num">Note di credito</th><th className="num">Netto</th><th className="num">Esclusi</th></tr></thead>
          <tbody>{d.clienti.map((c) => <tr key={c.chiave}><td><Link className="strong" to={linkCliente(c.chiave)}>{c.cliente}</Link></td>
            {d.mesi.map((m) => <td key={m} className="num">{c.mesi[m] ? eur0(c.mesi[m].fatturato) : <span className="muted">–</span>}</td>)}
            <td className="num">{eur0(c.totale.fatturato_fatture)}</td><td className="num">{c.totale.importo_nc ? eur0(c.totale.importo_nc) : '–'}</td><td className="num strong">{eur0(c.totale.fatturato)}</td><td className="num small">{c.totale.annullati + c.totale.tipo_sconosciuto ? `${num(c.totale.annullati + c.totale.tipo_sconosciuto)}` : '–'}</td></tr>)}
            <tr className="strong"><td>Totale</td>{d.mesi.map((m) => <td key={m} className="num">{d.per_mese[m]?.fatturato != null ? eur0(d.per_mese[m].fatturato) : '–'}</td>)}<td className="num">{eur0(t.fatturato_fatture)}</td><td className="num">{eur0(t.importo_nc || 0)}</td><td className="num">{eur0(t.fatturato)}</td><td className="num">{num(t.annullati + t.tipo_sconosciuto)}</td></tr></tbody>
        </table></div>}</Card>
        <div className="small muted" style={{ marginTop: 10 }}>Regola: {d.regola}.</div>
      </>}
    </div>
  );
}
