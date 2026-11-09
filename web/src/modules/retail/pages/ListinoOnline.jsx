// Retail · "Listino online vs prezzo di cassa" (TuoTempo, Fase 1 del piano, CEO 09/11/2026): per ogni prestazione prenotabile su TuoTempo il
// prezzo pubblicato online contro il prezzo medio delle vendite GIPO (incasso netto diviso quantità, vendite private, ultimi N mesi). Il
// fatturato resta di GIPO: qui solo il confronto dei prezzi. Fonte: GET /api/retail/tuotempo/listino.
import React, { useState } from 'react';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { eur, num } from '../format.js';

export default function ListinoOnline() {
  const [mesi, setMesi] = useState(12);
  const [solo, setSolo] = useState('');
  const q = useApi(`/tuotempo/listino?mesi=${mesi}`, [mesi]);
  const d = q.data;
  const righe = (d?.righe || []).filter((r) => !solo || (solo === 'diversi' ? r.differenza_pct != null && Math.abs(r.differenza_pct) >= 5 : solo === 'senza' ? !r.n_vendite : !r.tt_hidden));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Listino online vs prezzo di cassa</h1><div className="sub">Prezzo pubblicato su TuoTempo per la prenotazione online e prezzo medio incassato in cassa (vendite GIPO private: netto diviso quantità). Una differenza ampia è un'incoerenza da verificare con il listino.</div></div></div>
      <div className="filters">
        <label className="f">Periodo delle vendite<select value={mesi} onChange={(e) => setMesi(Number(e.target.value))}>{[3, 6, 12, 24].map((m) => <option key={m} value={m}>ultimi {m} mesi</option>)}</select></label>
        <label className="f">Mostra<select value={solo} onChange={(e) => setSolo(e.target.value)}><option value="">Tutte le prestazioni TuoTempo</option><option value="online">Solo visibili online</option><option value="diversi">Differenza di almeno il 5%</option><option value="senza">Senza vendite GIPO nel periodo</option></select></label>
        <div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{d.con_vendite} con vendite · {d.senza_vendite} senza vendite nel periodo</div>}
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!d ? <Loading /> : !righe.length ? <Empty>Nessuna prestazione TuoTempo: esegui "Allinea adesso" in Connettori</Empty> : <div className="table-wrap"><table className="t" data-testid="listino-online">
        <thead><tr><th>Prestazione</th><th>Tipologia</th><th className="num">Prezzo online</th><th className="num">Prezzo medio di cassa</th><th className="num">Differenza</th><th className="num">Vendite</th><th className="num">Listino Suite</th></tr></thead>
        <tbody>{righe.map((r) => <tr key={r.id} style={r.tt_hidden ? { opacity: 0.6 } : undefined}>
          <td><div className="strong">{r.description}</div><div className="small muted mono">{r.code}{r.tt_hidden ? ' · nascosta online' : ''}</div></td>
          <td className="small">{r.tipologia || '–'}</td>
          <td className="num">{eur(r.tt_price)}</td>
          <td className="num">{r.prezzo_medio != null ? eur(r.prezzo_medio) : <span className="muted">–</span>}</td>
          <td className="num">{r.differenza != null ? <Badge tone={Math.abs(r.differenza_pct || 0) >= 5 ? 'amber' : 'green'}>{r.differenza > 0 ? '+' : ''}{eur(r.differenza)}{r.differenza_pct != null ? ` (${r.differenza_pct > 0 ? '+' : ''}${String(r.differenza_pct).replace('.', ',')}%)` : ''}</Badge> : <span className="muted">–</span>}</td>
          <td className="num">{r.n_vendite ? `${num(r.quantita)} in ${num(r.n_vendite)} righe` : <span className="muted">0</span>}</td>
          <td className="num">{eur(r.listino)}</td>
        </tr>)}</tbody>
      </table></div>}</Card>
    </div>
  );
}
