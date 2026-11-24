// Cruscotto: quanto è aperto e quanto è scaduto, per fascia; cosa aspetta una decisione; la scala e lo stato di banca e motore.
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Kpi, Loading, Empty, PageHead, Badge } from '../../../components/ui.jsx';
import { useApi, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modalita, StatoCliente, LinkCliente, useAzione, api } from '../components.jsx';
import { eur, itDataOra, GIORNI, STATO_CLIENTE } from '../format.js';

export default function Cruscotto() {
  const d = useApi('/cruscotto'); const { user } = useAuth(); const az = useAzione(d.reload);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data; const i = x.indicatori; const c = x.contatori; const max = Math.max(1, ...x.fasce.map(([k]) => i.aging[k].importo));
  const daFare = [['comunicazioni', c.da_approvare, c.da_approvare === 1 ? 'sollecito in attesa' : 'solleciti in attesa', c.da_firmare ? `${c.da_firmare} da firmare (2° sollecito)` : null], ['risposte', c.risposte, c.risposte === 1 ? 'risposta da leggere' : 'risposte da leggere'],
    ['riconciliazione', c.riconciliazione, c.riconciliazione === 1 ? 'incasso da abbinare' : 'incassi da abbinare'], ['chiamate', c.chiamate, c.chiamate === 1 ? 'chiamata da fare' : 'chiamate da fare'], ['legale', c.legale, c.legale === 1 ? 'pratica legale da decidere' : 'pratiche legali da decidere'],
    ['comunicazioni?stato=PEC', c.pec, 'PEC da inviare'], ['clienti', c.piani, c.piani === 1 ? 'piano di rientro da approvare' : 'piani di rientro da approvare']].filter((r) => r[1] > 0);
  return (
    <div className="page">
      <PageHead title="Recupero Crediti" icon="stats" sub="Clienti B2B: fatture aperte, scaduto, solleciti e incassi. Fatture da Synclab e dal partitario, incassi dalla banca."
        actions={user.opera && <button className="btn ghost" disabled={az.busy} onClick={() => az.fai(() => api.post('/giro', {}), (r) => `Giro eseguito: ${r.inviate} inviate, ${r.in_attesa} in attesa${r.simulate ? `, ${r.simulate} simulate` : ''}${r.scala ? '' : ' (fuori dai giorni di invio: solo fatture e incassi)'}`)}>Aggiorna ora</button>} />
      <Modalita />
      {!x.banca.ok && <div className="alert warn cr-gap"><span>Incassi non verificabili: {x.banca.motivo}. Finché è così nessun sollecito parte da solo: resta in attesa di una persona. <Link to={`${base}/banca`}>Conti bancari</Link></span></div>}
      {i.senza_cliente > 0 && <div className="alert info cr-gap"><span>{i.senza_cliente} {i.senza_cliente === 1 ? 'fattura del partitario non è abbinata' : 'fatture del partitario non sono abbinate'} a una Legal entity: restano fuori dai solleciti. <Link to={`${base}/fatture?stato=SENZA_CLIENTE`}>Abbinale</Link></span></div>}
      <div className="grid g4 cr-gap">
        <Kpi label="Crediti aperti" value={eur(i.totale)} foot={`${i.fatture} fatture, ${i.clienti} clienti`} />
        <Kpi label="Scaduto" value={eur(i.scaduto)} accent foot={`${i.quota_scaduto.toLocaleString('it-IT')}% dei crediti aperti`} />
        <Kpi label="Giorni medi di incasso (DSO)" value={i.dso == null ? 'n.d.' : i.dso} foot={i.dso == null ? 'Serve il fatturato degli ultimi 90 giorni' : `Crediti aperti sul fatturato degli ultimi 90 giorni (${eur(i.fatturato90)})`} />
        <Kpi label="Incassato negli ultimi 30 giorni" value={eur(i.incassato30)} foot={`Promesse: ${i.promesse_mantenute} mantenute, ${i.promesse_non_rispettate} non rispettate (180 giorni)`} />
      </div>
      <Card title="Scaduto per anzianità" icon="clock" className="cr-gap">
        <div className="cr-aging">{x.fasce.map(([k, l]) => (<div key={k} className={k === 'NON_SCADUTO' ? '' : 'sc'}><div className="l">{l}</div><div className="v">{eur(i.aging[k].importo)}</div><div className="n">{i.aging[k].n} {i.aging[k].n === 1 ? 'fattura' : 'fatture'}</div><div className="bar"><i style={{ width: `${Math.round(i.aging[k].importo / max * 100)}%` }} /></div></div>))}</div>
        {i.contestato > 0 && <p className="small muted" style={{ marginTop: 10 }}>Di cui contestati {eur(i.contestato)}: fuori dalla scala fino alla chiusura della contestazione.</p>}
      </Card>
      <div className="grid g2 cr-gap">
        <Card title="Da fare" icon="check">
          {daFare.length ? <div className="list">{daFare.map(([to, n, l, extra]) => <Link key={to} to={`${base}/${to}`} className="it"><span className="strong">{n}</span>&nbsp;{l}{extra && <span className="small muted"> · {extra}</span>}</Link>)}</div> : <Empty compact icon="check">Nulla in attesa</Empty>}
        </Card>
        <Card title="Clienti per stato" icon="building">
          <div className="cr-azioni">{Object.entries(x.stati).map(([s, n]) => <Badge key={s} tone={STATO_CLIENTE[s]?.tone}>{STATO_CLIENTE[s]?.label || s}: {n}</Badge>)}{!Object.keys(x.stati).length && <span className="muted small">Nessun cliente con fatture aperte</span>}</div>
          <p className="small muted" style={{ marginTop: 10 }}>{i.esclusi} {i.esclusi === 1 ? 'cliente escluso' : 'clienti esclusi'} dai solleciti per decisione di CEO o CFO. <Link to={`${base}/esclusi`}>Registro</Link></p>
        </Card>
      </div>
      <Card title="Maggiori scaduti" icon="list" flush className="cr-gap">
        {x.maggiori.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th>Stato</th><th className="num">Scaduto</th><th className="num">Giorni</th><th>Ultima fase</th><th>Referente</th></tr></thead>
          <tbody>{x.maggiori.map((p) => <tr key={p.organization_id}><td><LinkCliente id={p.organization_id}>{p.ragione_sociale}</LinkCliente></td><td><StatoCliente stato={p.stato} /></td><td className="num strong">{eur(p.scaduto)}</td><td className="num">{p.giorni_max}</td><td>{p.fase_label || 'Nessuna'}</td><td>{p.referente || <span className="muted">non indicato</span>}</td></tr>)}</tbody></table></div> : <Empty compact icon="check">Nessun cliente con fatture scadute</Empty>}
      </Card>
      <Card title="La scala di sollecito" icon="tree">
        <div className="cr-scala">{x.scala.map((f) => <div key={f.n}><div className="g">{f.giorni < 0 ? `${-f.giorni} giorni prima` : `+${f.giorni} giorni`}</div>{f.label}<div className="small muted">{f.n <= 2 ? 'automatico, con gli incassi verificati' : f.n === 3 ? 'firma di CFO o CEO, email e PEC' : f.n === 4 ? 'referente commerciale, esito registrato' : 'autorizzazione di CFO o CEO'}</div></div>)}</div>
        <p className="small muted" style={{ marginTop: 10 }}>Invii: {x.giorni_invio.map((g) => GIORNI[g].toLowerCase()).join(', ')}, dalle {x.ora_invio[0]} alle {x.ora_invio[1]}. Ultimo giro del motore: {x.ultimo_giro ? itDataOra(x.ultimo_giro.at) : 'mai'}.{x.banca.ultimo ? ` Movimenti bancari letti il ${itDataOra(x.banca.ultimo)}.` : ''}</p>
      </Card>
    </div>
  );
}
