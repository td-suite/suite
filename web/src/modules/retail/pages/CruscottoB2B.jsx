// Retail · Cruscotto B2B (riordino del 09/11/2026): tutto da StudioLab (Synclab). v0.68.5 (CEO 10/11/2026): la grandezza principale è la
// PRODUZIONE EROGATA (accettazioni in stato erogato, netto di riga e sconto di testata) con l'andamento giorno per giorno del mese; i
// documenti emessi restano un dato secondario. Top 10 clienti, clienti in calo oltre il 20%, clienti senza produzione da 60 giorni, client
// Synclab non abbinati. Fonte: GET /api/retail/b2b/cruscotto.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { FonteSynclab, VarPct, BarreGiorni } from '../components/fonte.jsx';
import { qs, base } from '../api.js';
import { eur0, num, itDate, today } from '../format.js';

const vp = (c, p) => (p ? Math.round(((Number(c || 0) - Number(p)) / Math.abs(Number(p))) * 1000) / 10 : null);
export const linkCliente = (chiave) => `${base}/b2b/clienti/${encodeURIComponent(chiave)}`;

export default function CruscottoB2B() {
  const [mese, setMese] = useState(today().slice(0, 7));
  const q = useApi(`/b2b/cruscotto${qs({ mese })}`, [mese]);
  const d = q.data;
  const k = d?.kpi, ap = k?.anno_prima;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cruscotto B2B</h1><div className="sub">Service di laboratorio e medicina del lavoro, tutto da StudioLab: la grandezza è la produzione erogata (accettazioni in stato erogato); i documenti emessi sono un dato secondario.{d && d.privati_in_b2c ? ' Le accettazioni dei punti TD sono nel B2C (Laboratorio in sede).' : d ? ' Impostazione: tutto Synclab è B2B.' : ''}</div></div>
        <div className="row"><Link className="btn ghost" to={`${base}/b2b/produzione`}>Produzione</Link><Link className="btn ghost" to={`${base}/b2b/fatturato`}>Documenti emessi</Link></div>
      </div>
      {d && <FonteSynclab stato={d.stato} d={d} />}
      <div className="filters"><label className="f">Mese<input type="month" value={mese} onChange={(e) => setMese(e.target.value)} /></label><div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{itDate(d.periodo.da)} – {itDate(d.periodo.a)} · confronto con {itDate(d.periodo.prec.da)} – {itDate(d.periodo.prec.a)}</div>}</div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent" data-testid="kpi-produzione"><div className="lbl">Produzione erogata B2B</div><div className="val">{eur0(k.valore)}</div><div className="delta"><VarPct v={vp(k.valore, ap.valore)} /> <span className="muted">{k.righe_senza_prezzo ? `${num(k.righe_senza_prezzo)} esami senza prezzo` : 'netto di riga e sconto di testata'}</span></div></div>
          <div className="card kpi"><div className="lbl">Clienti con produzione</div><div className="val">{num(k.clienti)}</div><div className="delta"><VarPct v={vp(k.clienti, ap.clienti)} /> <span className="muted">anno prima {num(ap.clienti)}</span></div></div>
          <div className="card kpi"><div className="lbl">Esami erogati</div><div className="val">{num(k.esami)}</div><div className="delta"><VarPct v={vp(k.esami, ap.esami)} /> <span className="muted">{num(k.accettazioni)} accettazioni erogate</span></div></div>
          <div className="card kpi"><div className="lbl">Documenti emessi (secondario)</div><div className="val" style={{ fontSize: 20 }}>{eur0(k.fatturato.fatturato)}</div><div className="delta"><span className="muted">non sommati alla produzione · {num(k.fatturato.note_credito)} NC · {num(k.fatturato.annullati)} annullati esclusi</span></div></div>
        </div>
        {d.giornaliero && <Card title={`Produzione erogata giorno per giorno · ${eur0(d.giornaliero.totale.valore)}`} className="mb" actions={<span className="small muted">{d.aggiornato || ''}</span>}>
          <BarreGiorni giorni={d.giornaliero.giorni} fmtValore={eur0} />
        </Card>}
        <Card title="Top 10 clienti del mese" flush actions={<Link className="btn sm ghost" to={`${base}/b2b/clienti`}>Tutti</Link>}>
            {!d.top10.length ? <Empty>Nessuna produzione B2B nel mese</Empty> : <div className="table-wrap"><table className="t" data-testid="top10">
              <thead><tr><th>Cliente</th><th className="num">Esami</th><th className="num">Produzione erogata</th><th className="num">Documenti emessi</th><th className="num">Anno prima</th></tr></thead>
              <tbody>{d.top10.map((c) => <tr key={c.chiave}><td><Link className="strong" to={linkCliente(c.chiave)}>{c.cliente}</Link>{c.stato_abbinamento === 'DA_ABBINARE' && <div><Badge tone="red">client non abbinato</Badge></div>}</td>
                <td className="num">{num(c.esami)}</td><td className="num strong">{eur0(c.valore)}</td><td className="num">{eur0(c.fatturato)}</td><td className="num small">{c.anno_prima ? `${num(c.anno_prima.esami)} esami · ${eur0(c.anno_prima.valore)}` : '–'}</td></tr>)}</tbody>
            </table></div>}
        </Card>
        <Card className="mt" title={`In calo oltre il ${d.soglia_calo}% sullo stesso mese dell'anno prima`} flush>
            {!d.in_calo.length ? <Empty>Nessun cliente in calo oltre la soglia</Empty> : <div className="table-wrap"><table className="t" data-testid="in-calo">
              <thead><tr><th>Cliente</th><th className="num">Mese</th><th className="num">Anno prima</th><th className="num">Variazione</th></tr></thead>
              <tbody>{d.in_calo.map((c) => <tr key={c.chiave}><td><Link to={linkCliente(c.chiave)}>{c.cliente}</Link><div className="small muted">confronto su {c.base}</div></td>
                <td className="num">{c.base === 'valore' ? eur0(c.mese.valore || 0) : `${num(c.mese.esami)} esami`}</td><td className="num">{c.base === 'valore' ? eur0(c.anno_prima.valore) : `${num(c.anno_prima.esami)} esami`}</td><td className="num"><VarPct v={c.variazione} /></td></tr>)}</tbody>
            </table></div>}
        </Card>
        <div>
          <Card className="mt" title={`Senza produzione da ${d.giorni_senza} giorni`} flush>
            {!d.senza_produzione.length ? <Empty>Nessun cliente fermo (tra quelli con accettazioni negli ultimi 12 mesi)</Empty> : <div className="table-wrap"><table className="t" data-testid="fermi">
              <thead><tr><th>Cliente</th><th>Ultima accettazione</th><th className="num">Giorni</th><th className="num">Accettazioni 12 mesi</th></tr></thead>
              <tbody>{d.senza_produzione.map((c) => <tr key={c.chiave}><td><Link to={linkCliente(c.chiave)}>{c.cliente}</Link></td><td>{itDate(c.ultima)}</td><td className="num">{num(c.giorni)}</td><td className="num">{num(c.accettazioni_12m)}</td></tr>)}</tbody>
            </table></div>}
          </Card>
          <Card className="mt" title="Client Synclab non abbinati" flush actions={<Link className="btn sm ghost" to="/admin/connectors/synclab">Abbina in Amministrazione</Link>}>
            {!d.non_abbinati.length ? <Empty>Tutti i client Synclab hanno una Legal entity (confermata o proposta)</Empty> : <div className="table-wrap"><table className="t" data-testid="non-abbinati">
              <thead><tr><th>Codice</th><th>Ragione sociale nel gestionale</th><th className="num">Accettazioni 12 mesi</th></tr></thead>
              <tbody>{d.non_abbinati.map((c) => <tr key={c.client_id}><td className="mono">{c.client_code || '–'}</td><td>{c.legal_name || '–'}</td><td className="num">{num(c.accettazioni_12m)}</td></tr>)}</tbody>
            </table></div>}
            {d.proposti.length > 0 && <div className="small muted" style={{ padding: 12 }}>Altri {num(d.proposti.length)} client hanno una proposta automatica (codice StudioLAB della sede o partita IVA) ancora da confermare: i numeri li usano già.</div>}
          </Card>
        </div>
        <div className="small muted" style={{ marginTop: 12 }}>Produzione erogata = accettazioni in stato erogato ({d.stati_descritti}); esami = righe d'esame non cancellate; valore = Σ netto di riga × quantità × (1 − sconto di testata). Documenti emessi (secondario, mai sommato) = contributo netto di ogni documento una volta sola, note di credito comprese, annullati e proforma esclusi. Calo: sul valore quando c'è in entrambi i periodi, altrimenti sugli esami.</div>
      </>}
    </div>
  );
}
