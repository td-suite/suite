// Retail · B2B · Produzione per cliente e mese (riordino del 09/11/2026): tabella cliente × mese con esami e valore dalle accettazioni di
// StudioLab (Synclab), export Excel. Fonte: GET /api/retail/b2b/produzione (e /produzione/export.xlsx).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo } from '../components/fonte.jsx';
import { qs, apiBase } from '../api.js';
import { eur0, num, monthLabel, today } from '../format.js';
import { linkCliente } from './CruscottoB2B.jsx';

export default function B2BProduzione() {
  const oggi = today();
  const [p, setP] = useState(periodoIniziale(oggi));
  const [vista, setVista] = useState('valore');
  const query = { periodo: periodoQuery(p) };
  const q = useApi(`/b2b/produzione${qs(query)}`, [p.tipo, p.mese, p.trimestre, p.anno]);
  const d = q.data;
  const cella = (x) => (!x ? <span className="muted">–</span> : vista === 'valore' ? eur0(x.valore) : num(x.esami));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produzione per cliente e mese</h1><div className="sub">Esami (righe d'esame non cancellate) e valore (netti di riga del gestionale) delle accettazioni B2B, cliente per cliente e mese per mese.</div></div>
        <div className="row">{d && <a className="btn ghost" href={`${apiBase}/b2b/produzione/export.xlsx${qs(query)}`}>Esporta Excel</a>}</div>
      </div>
      {d && <FonteSynclab stato={d.stato} insiemi={['requests']} />}
      <div className="filters">
        <PeriodoSelect value={p} onChange={setP} oggi={oggi} />
        <div className="seg" style={{ alignSelf: 'end' }}>{[['valore', 'Valore'], ['esami', 'Esami']].map(([k, l]) => <label key={k} className={vista === k ? 'on' : ''}><input type="radio" checked={vista === k} onChange={() => setVista(k)} />{l}</label>)}</div>
        <div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)} · {num(d.clienti.length)} clienti · {num(d.totale.esami)} esami · {eur0(d.totale.valore)}</div>}
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!d ? <Loading /> : !d.clienti.length ? <Empty>Nessuna produzione B2B nel periodo</Empty> : <div className="table-wrap"><table className="t" data-testid="produzione">
        <thead><tr><th>Cliente</th>{d.mesi.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Totale</th></tr></thead>
        <tbody>{d.clienti.map((c) => <tr key={c.chiave}><td><Link className="strong" to={linkCliente(c.chiave)}>{c.cliente}</Link>{c.stato_abbinamento === 'DA_ABBINARE' && <div><Badge tone="red">non abbinato</Badge></div>}</td>
          {d.mesi.map((m) => <td key={m} className="num">{cella(c.mesi[m])}</td>)}<td className="num strong">{cella(c.totale)}</td></tr>)}
          <tr className="strong"><td>Totale</td>{d.mesi.map((m) => <td key={m} className="num">{cella(d.per_mese[m])}</td>)}<td className="num">{cella(d.totale)}</td></tr></tbody>
      </table></div>}</Card>
      {d?.totale.righe_senza_prezzo > 0 && <div className="small muted" style={{ marginTop: 10 }}>{num(d.totale.righe_senza_prezzo)} righe d'esame senza prezzo nel gestionale: il valore è parziale.</div>}
    </div>
  );
}
