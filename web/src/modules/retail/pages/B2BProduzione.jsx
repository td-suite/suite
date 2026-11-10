// Retail · B2B · Produzione per cliente (riordino del 09/11/2026; v0.68.5, CEO 10/11/2026: PRODUZIONE EROGATA, con il dettaglio GIORNALIERO
// oltre al mensile). Vista "Mensile": cliente × mese (esami o valore) nel periodo scelto. Vista "Giornaliera": cliente × giorno di un mese
// (fino a oggi per il mese in corso) con le barre del totale giornaliero. Valore = accettazioni in stato erogato, Σ netto di riga × quantità
// × (1 − sconto di testata); export Excel per entrambe. Fonte: GET /api/retail/b2b/produzione e /produzione/giorni (con i loro export).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo, BarreGiorni } from '../components/fonte.jsx';
import { qs, apiBase } from '../api.js';
import { eur0, num, monthLabel, today } from '../format.js';
import { linkCliente } from './CruscottoB2B.jsx';

const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export default function B2BProduzione() {
  const oggi = today();
  const [vista, setVista] = useState(() => (new URLSearchParams(window.location.search).get('vista') === 'giorni' ? 'giorni' : 'mesi'));
  const [p, setP] = useState(periodoIniziale(oggi));
  const [mese, setMese] = useState(oggi.slice(0, 7));
  const [misura, setMisura] = useState('valore');
  const query = { periodo: periodoQuery(p) };
  const qm = useApi(vista === 'mesi' ? `/b2b/produzione${qs(query)}` : null, [vista, p.tipo, p.mese, p.trimestre, p.anno]);
  const qg = useApi(vista === 'giorni' ? `/b2b/produzione/giorni${qs({ mese })}` : null, [vista, mese]);
  const d = vista === 'mesi' ? qm.data : qg.data;
  const cella = (x) => (!x ? <span className="muted">–</span> : misura === 'valore' ? eur0(x.valore) : num(x.esami));
  const colonne = vista === 'mesi' ? (d?.mesi || []) : (d?.giorni || []);
  const etichetta = (k) => (vista === 'mesi' ? monthLabel(k) : <>{k.slice(8, 10)}<div className="tiny muted">{GG[new Date(`${k}T12:00:00Z`).getUTCDay()]}</div></>);
  const valoreDi = (c, k) => (vista === 'mesi' ? c.mesi[k] : c.giorni[k]);
  const totaleCol = (k) => (vista === 'mesi' ? d.per_mese[k] : d.per_giorno[k]);
  const exportUrl = vista === 'mesi' ? `${apiBase}/b2b/produzione/export.xlsx${qs(query)}` : `${apiBase}/b2b/produzione/giorni/export.xlsx${qs({ mese })}`;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produzione erogata per cliente</h1><div className="sub">Accettazioni B2B in stato erogato, cliente per cliente: mese per mese oppure giorno per giorno. Esami = righe d'esame non cancellate; valore = netto di riga con lo sconto di testata applicato una volta.</div></div>
        <div className="row">{d && <a className="btn ghost" href={exportUrl}>Esporta Excel</a>}</div>
      </div>
      {d && <FonteSynclab stato={d.stato} insiemi={['requests']} d={d} />}
      <div className="filters">
        <div className="seg" style={{ alignSelf: 'end' }} data-testid="vista-produzione">{[['mesi', 'Mensile'], ['giorni', 'Giornaliera']].map(([k, l]) => <label key={k} className={vista === k ? 'on' : ''}><input type="radio" checked={vista === k} onChange={() => setVista(k)} />{l}</label>)}</div>
        {vista === 'mesi' ? <PeriodoSelect value={p} onChange={setP} oggi={oggi} /> : <label className="f">Mese<input type="month" value={mese} max={oggi.slice(0, 7)} onChange={(e) => setMese(e.target.value || oggi.slice(0, 7))} /></label>}
        <div className="seg" style={{ alignSelf: 'end' }}>{[['valore', 'Valore'], ['esami', 'Esami']].map(([k, l]) => <label key={k} className={misura === k ? 'on' : ''}><input type="radio" checked={misura === k} onChange={() => setMisura(k)} />{l}</label>)}</div>
        <div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)} · {num(d.clienti.length)} clienti · {num(d.totale.esami)} esami · {eur0(d.totale.valore)}</div>}
      </div>
      <ErrorBox error={(vista === 'mesi' ? qm : qg).error} />
      {vista === 'giorni' && d && <Card title={`Totale B2B giorno per giorno · ${eur0(d.totale.valore)}`} className="mb" actions={<span className="small muted">{d.aggiornato || ''}</span>}>
        <BarreGiorni giorni={d.giorni.map((g) => ({ giorno: g, valore: d.per_giorno[g]?.valore || 0, esami: d.per_giorno[g]?.esami || 0 }))} fmtValore={eur0} />
      </Card>}
      <Card flush>{!d ? <Loading /> : !d.clienti.length ? <Empty>Nessuna produzione B2B erogata nel periodo</Empty> : <div className="table-wrap"><table className="t" data-testid={vista === 'mesi' ? 'produzione' : 'produzione-giorni'}>
        <thead><tr><th>Cliente</th>{colonne.map((k) => <th key={k} className="num">{etichetta(k)}</th>)}<th className="num">Totale</th></tr></thead>
        <tbody>{d.clienti.map((c) => <tr key={c.chiave}><td style={{ minWidth: 180 }}><Link className="strong" to={linkCliente(c.chiave)}>{c.cliente}</Link>{c.stato_abbinamento === 'DA_ABBINARE' && <div><Badge tone="red">non abbinato</Badge></div>}</td>
          {colonne.map((k) => <td key={k} className="num">{cella(valoreDi(c, k))}</td>)}<td className="num strong">{cella(c.totale)}</td></tr>)}
          <tr className="strong"><td>Totale</td>{colonne.map((k) => <td key={k} className="num">{cella(totaleCol(k))}</td>)}<td className="num">{cella(d.totale)}</td></tr></tbody>
      </table></div>}</Card>
      {d?.totale.righe_senza_prezzo > 0 && <div className="small muted" style={{ marginTop: 10 }}>{num(d.totale.righe_senza_prezzo)} esami senza prezzo nel gestionale: il valore è parziale.</div>}
    </div>
  );
}
