// Retail · B2B · Listini applicati (riordino del 09/11/2026): prezzo netto medio per esame e cliente dalle accettazioni di StudioLab, contro
// il listino corrente di Synclab del client e il listino corrente del Business Hub: scostamenti. Fonte: GET /api/retail/b2b/listini.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo } from '../components/fonte.jsx';
import { qs } from '../api.js';
import { eur, num, today } from '../format.js';
import { linkCliente } from './CruscottoB2B.jsx';

const scost = (v, p) => (v == null ? <span className="muted">–</span> : <span style={{ color: Math.abs(p || 0) >= 5 ? '#b3372f' : 'inherit', fontWeight: Math.abs(p || 0) >= 5 ? 650 : 400 }}>{v > 0 ? '+' : ''}{eur(v)}{p != null ? ` (${p > 0 ? '+' : ''}${String(p).replace('.', ',')}%)` : ''}</span>);

export default function B2BListini() {
  const oggi = today();
  const [sp, setSp] = useSearchParams();
  const [p, setP] = useState(periodoIniziale(oggi));
  const [chiave, setChiave] = useState(sp.get('chiave') || '');
  const [soglia, setSoglia] = useState('');
  const q = useApi(`/b2b/listini${qs({ periodo: periodoQuery(p), chiave, soglia })}`, [p.tipo, p.mese, p.trimestre, p.anno, chiave, soglia]);
  const d = q.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Listini applicati</h1><div className="sub">Prezzo netto medio applicato per esame e cliente (accettazioni del gestionale) contro il listino corrente di Synclab e il listino del Business Hub.</div></div></div>
      {d && <FonteSynclab stato={d.stato} d={d} insiemi={['requests', 'price-lists']} extra={d.hub?.nota || undefined} />}
      <div className="filters">
        <PeriodoSelect value={p} onChange={setP} oggi={oggi} />
        <label className="f">Cliente<select value={chiave} onChange={(e) => { setChiave(e.target.value); setSp(e.target.value ? { chiave: e.target.value } : {}, { replace: true }); }}><option value="">Tutti i clienti B2B</option>{(d?.clienti || []).map((c) => <option key={c.chiave} value={c.chiave}>{c.cliente}</option>)}</select></label>
        <label className="f">Mostra<select value={soglia} onChange={(e) => setSoglia(e.target.value)}><option value="">Tutti gli esami</option><option value="5">Scostamento di almeno il 5%</option><option value="10">Scostamento di almeno il 10%</option></select></label>
        <div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)} · {num(d.righe.length)} righe</div>}
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!d ? <Loading /> : !d.righe.length ? <Empty>Nessun esame B2B nel periodo con i filtri scelti</Empty> : <div className="table-wrap"><table className="t" data-testid="listini">
        <thead><tr><th>Cliente</th><th>Esame</th><th className="num">Quantità</th><th className="num">Prezzo netto medio</th><th className="num">Listino Synclab</th><th className="num">Scostamento</th><th className="num">Listino Business Hub</th><th className="num">Scostamento</th></tr></thead>
        <tbody>{d.righe.map((x) => <tr key={`${x.chiave}|${x.codice}`}><td><Link to={linkCliente(x.chiave)}>{x.cliente}</Link></td><td>{x.descrizione || x.codice}<div className="small muted mono">{x.codice}{x.righe_senza_prezzo ? ` · ${x.righe_senza_prezzo} righe senza prezzo` : ''}</div></td>
          <td className="num">{num(x.quantita)}</td><td className="num strong">{eur(x.prezzo_medio)}{x.prezzo_min != null && x.prezzo_min !== x.prezzo_max && <div className="small muted">{eur(x.prezzo_min)} – {eur(x.prezzo_max)}</div>}</td>
          <td className="num">{eur(x.listino_synclab)}</td><td className="num">{scost(x.scost_synclab, x.scost_synclab_pct)}</td><td className="num">{eur(x.listino_hub)}{x.versione_hub ? <div className="small muted">v{x.versione_hub}</div> : null}</td><td className="num">{scost(x.scost_hub, x.scost_hub_pct)}</td></tr>)}</tbody>
      </table></div>}</Card>
      {d && <div className="small muted" style={{ marginTop: 10 }}>{d.regola}.</div>}
    </div>
  );
}
