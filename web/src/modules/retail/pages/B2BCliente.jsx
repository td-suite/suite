// Retail · Scheda cliente B2B (riordino del 09/11/2026; v0.68.5: grandezza principale = PRODUZIONE ACCETTATA con la progressione giornaliera
// dell'ultimo mese, documenti emessi come dato secondario): andamento mensile di produzione e documenti, esami più richiesti, prezzi netti
// applicati contro il listino corrente Synclab e il listino del Business Hub, documenti del periodo, NC aperte (se il modulo NC è LIVE).
// Cliente = Legal entity (id) oppure client Synclab non abbinato ('c-<id>'). Fonte: GET /api/retail/b2b/clienti/:chiave.
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { FonteSynclab, PeriodoSelect, periodoQuery, periodoIniziale, intervallo, BarreGiorni } from '../components/fonte.jsx';
import { qs, base } from '../api.js';
import { eur, eur0, num, itDate, monthLabel, today } from '../format.js';

const CLASSE = { FATTURA: { label: 'Fattura', tone: 'teal' }, NC: { label: 'Nota di credito', tone: 'mauve' }, ANNULLATO: { label: 'Annullato/proforma (escluso)', tone: 'grey' }, SCONOSCIUTO: { label: 'Tipo sconosciuto (escluso)', tone: 'red' } };
const LIV = { ATTIVO: 'Cliente attivo', CONTRATTUALIZZATO: 'Contrattualizzato', PUNTO_SERVICE: 'Punto service' };
const scost = (v, pctV) => (v == null ? <span className="muted">–</span> : <span style={{ color: Math.abs(pctV || 0) >= 5 ? '#b3372f' : 'inherit' }}>{v > 0 ? '+' : ''}{eur(v)}{pctV != null ? ` (${pctV > 0 ? '+' : ''}${String(pctV).replace('.', ',')}%)` : ''}</span>);

export default function B2BCliente() {
  const { chiave } = useParams();
  const oggi = today();
  const [p, setP] = useState(periodoIniziale(oggi));
  const q = useApi(`/b2b/clienti/${encodeURIComponent(chiave)}${qs({ periodo: periodoQuery(p) })}`, [chiave, p.tipo, p.mese, p.trimestre, p.anno]);
  const d = q.data;
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="small"><Link to={`${base}/b2b/clienti`}>← Aziende e strutture</Link></div>
          <h1>{d?.org?.name || d?.cliente || 'Cliente B2B'}</h1>
          {d && <div className="sub">{[d.org?.vat_number && `P.IVA ${d.org.vat_number}`, d.org?.city && `${d.org.city}${d.org.province ? ` (${d.org.province})` : ''}`, d.org?.livello && LIV[d.org.livello], !d.org && 'client Synclab non abbinato a una Legal entity'].filter(Boolean).join(' · ')}</div>}
        </div>
        {d && <div className="row">
          {d.link.business_hub && <Link className="btn ghost" to={d.link.business_hub} title="Scheda del cliente nel Business Hub">Business Hub</Link>}
          <Link className="btn ghost" to={d.link.clienti_synclab} title="Amministrazione > Connettori > StudioLAB > Dati Synclab > Clienti Synclab">Clienti Synclab</Link>
          <Link className="btn ghost" to={`${base}/b2b/listini?chiave=${encodeURIComponent(chiave)}`}>Listini applicati</Link>
        </div>}
      </div>
      {d && <FonteSynclab stato={d.stato} d={d} />}
      <div className="filters"><PeriodoSelect value={p} onChange={setP} oggi={oggi} /><div className="spacer" />{d && <div className="small muted" style={{ alignSelf: 'center' }}>{intervallo(d.periodo)}</div>}</div>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent" data-testid="kpi-produzione"><div className="lbl">Produzione accettata</div><div className="val">{eur0(d.totale.valore)}</div><div className="delta"><span className="muted">{num(d.totale.esami)} esami{d.totale.righe_senza_prezzo ? ` (di cui ${num(d.totale.righe_senza_prezzo)} senza prezzo)` : ''} · {num(d.totale.accettazioni)} accettazioni</span></div>{d.totale.sconto_testata ? <div className="small muted" data-testid="sconti-testata">di cui sconti di testata: {eur0(d.totale.sconto_testata)} {d.sconto_testata === 'APPLICA' ? '(applicati)' : '(non applicati: importi di riga come il report)'}</div> : null}</div>
          <div className="card kpi"><div className="lbl">Documenti emessi (secondario)</div><div className="val" style={{ fontSize: 20 }}>{eur0(d.totale.documenti.fatturato)}</div><div className="delta"><span className="muted">non sommati · {num(d.totale.documenti.fatture)} fatture · NC {eur0(d.totale.documenti.importo_nc || 0)}</span></div></div>
          <div className="card kpi"><div className="lbl">Listino del Business Hub</div><div className="val">{d.hub.versione ? `v${d.hub.versione}` : '–'}</div><div className="delta"><span className="muted">{d.hub.versione ? `linea ${d.hub.linea}` : d.hub.nota || 'non disponibile'}</span></div></div>
          <div className="card kpi"><div className="lbl">NC aperte</div><div className="val">{d.nc.disponibile ? num(d.nc.aperte) : '–'}</div><div className="delta"><span className="muted">{d.nc.disponibile ? <Link to="/nc">Apri Non conformità</Link> : d.nc.nota}</span></div></div>
        </div>
        {d.giornaliero && <Card title={`Produzione accettata giorno per giorno · ${monthLabel(d.giornaliero.periodo.a.slice(0, 7))} · ${eur0(d.giornaliero.totale.valore)}`} className="mb" actions={<span className="small muted">{d.aggiornato || ''}</span>}>
          <BarreGiorni giorni={d.giornaliero.giorni} fmtValore={eur0} />
        </Card>}
        <Card title="Client Synclab collegati" flush>
          {!d.clients.length ? <Empty>Nessun client Synclab</Empty> : <table className="t"><thead><tr><th>Codice</th><th>Ragione sociale nel gestionale</th><th>Abbinamento</th><th>Perimetro</th><th>Listino corrente Synclab</th></tr></thead>
            <tbody>{d.clients.map((c) => <tr key={c.client_id}><td className="mono">{c.client_code}</td><td>{c.legal_name}{c.sede && <div className="small muted">sede {c.sede}</div>}</td><td className="small">{c.stato_abbinamento}</td>
              <td>{c.ripartizione === 'LAB_SEDE' ? <Badge tone="teal">Laboratorio in sede</Badge> : <Badge tone="mauve">B2B</Badge>}{c.perimetro_b2b && <div className="small muted">cliente attivo del Business Hub</div>}</td>
              <td className="small">{c.listino_base || '–'}{c.listino_extra ? ` · extra ${c.listino_extra}` : ''}</td></tr>)}</tbody></table>}
        </Card>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Andamento mensile" flush>
            <div className="table-wrap"><table className="t" data-testid="andamento"><thead><tr><th>Mese</th><th className="num">Accettazioni</th><th className="num">Esami</th><th className="num">Produzione accettata</th><th className="num">Documenti emessi</th></tr></thead>
              <tbody>{d.andamento.map((m) => <tr key={m.mese}><td>{monthLabel(m.mese)}</td><td className="num">{num(m.accettazioni)}</td><td className="num">{num(m.esami)}</td><td className="num strong">{eur0(m.valore)}</td><td className="num muted">{eur0(m.documenti.fatturato)}</td></tr>)}</tbody></table></div>
          </Card>
          <Card title="Esami più richiesti" flush>
            {!d.esami.length ? <Empty>Nessun esame nel periodo</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>Esame</th><th className="num">Esami</th><th className="num">Prezzo medio</th><th className="num">Valore</th></tr></thead>
              <tbody>{d.esami.map((e) => <tr key={e.codice}><td>{e.descrizione || e.codice}<div className="small muted mono">{e.codice}</div></td><td className="num">{num(e.esami)}</td><td className="num">{eur(e.prezzo_medio)}</td><td className="num">{eur0(e.valore)}</td></tr>)}</tbody></table></div>}
          </Card>
        </div>
        <Card title="Prezzi netti applicati vs listini" flush className="mt">
          {!d.prezzi.length ? <Empty>Nessun esame nel periodo</Empty> : <div className="table-wrap"><table className="t" data-testid="prezzi"><thead><tr><th>Esame</th><th className="num">Quantità</th><th className="num">Prezzo netto medio</th><th className="num">Listino Synclab</th><th className="num">Scostamento</th><th className="num">Listino Business Hub</th><th className="num">Scostamento</th></tr></thead>
            <tbody>{d.prezzi.map((x) => <tr key={x.codice}><td>{x.descrizione || x.codice}<div className="small muted mono">{x.codice}{x.prezzo_min !== x.prezzo_max && x.prezzo_min != null ? ` · da ${eur(x.prezzo_min)} a ${eur(x.prezzo_max)}` : ''}</div></td><td className="num">{num(x.quantita)}</td><td className="num strong">{eur(x.prezzo_medio)}</td>
              <td className="num">{eur(x.listino_synclab)}</td><td className="num">{scost(x.scost_synclab, x.scost_synclab_pct)}</td><td className="num">{eur(x.listino_hub)}</td><td className="num">{scost(x.scost_hub, x.scost_hub_pct)}</td></tr>)}</tbody></table></div>}
          <div className="small muted" style={{ padding: 12 }}>Prezzo netto medio = somma dei netti di riga × quantità diviso la quantità (righe con prezzo, prima dello sconto di testata: è il prezzo confrontabile con i listini). Listino Synclab = listino corrente del client (non ricostruisce i prezzi storici). Listino Business Hub = versione corrente, prezzo offerto o, se manca, di listino.</div>
        </Card>
        <Card title={`Documenti emessi nel periodo (${num(d.documenti.length)}) · dato secondario`} flush className="mt">
          {!d.documenti.length ? <Empty>Nessun documento economico nel periodo</Empty> : <div className="table-wrap"><table className="t" data-testid="documenti"><thead><tr><th>Numero</th><th>Data</th><th>Tipo</th><th className="num">Contributo al fatturato</th><th className="num">Totale documento</th></tr></thead>
            <tbody>{d.documenti.map((x) => <tr key={x.id} style={x.classe === 'ANNULLATO' || x.classe === 'SCONOSCIUTO' ? { opacity: 0.6 } : undefined}><td className="mono">{x.invoice_number || '–'}</td><td>{itDate(x.date)}</td><td><Badge tone={CLASSE[x.classe]?.tone}>{CLASSE[x.classe]?.label || x.classe}</Badge></td><td className="num">{eur(x.contributo)}</td><td className="num">{eur(x.total)}</td></tr>)}</tbody></table></div>}
        </Card>
        {d.codici_vendite?.length > 0 && <div className="small muted" style={{ marginTop: 12 }}>Codici delle vendite importate abbinati a questa Legal entity: {d.codici_vendite.map((c, i) => <span key={c.id}>{i ? ', ' : ''}<Link to={`${base}/b2b/codici/${c.id}`}>{c.external_code}</Link></span>)}</div>}
      </>}
    </div>
  );
}
