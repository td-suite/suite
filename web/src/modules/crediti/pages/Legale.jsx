// Area legale: pratiche proposte dal motore o dall'Amministrazione, autorizzate dal Responsabile Amministrazione e Finanza (CFO; il CEO
// può sostituirlo) e, sopra la soglia, dalla Direzione. Nulla parte verso il cliente da qui: il fascicolo va all'area legale.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Modal, ErrorBox, CopyButton } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { Modalita, LinkCliente, useAzione, api, Modulo } from '../components.jsx';
import { eur, itData, itDataOra, FASE, STATO_PRATICA, ESITO } from '../format.js';

function Fascicolo({ id }) {
  const d = useApi(`/legale/${id}/fascicolo`, [id]);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const x = d.data;
  return (
    <div>
      <p className="small"><strong>{x.pratica.cliente}</strong>{x.pratica.vat_number ? ` · P.IVA ${x.pratica.vat_number}` : ''}{x.pratica.pec ? ` · PEC ${x.pratica.pec}` : ''} · {[x.pratica.address, x.pratica.zip, x.pratica.city, x.pratica.province].filter(Boolean).join(' ')}</p>
      <h3>Fatture</h3>
      <table className="t"><thead><tr><th>Numero</th><th>Data</th><th>Scadenza</th><th className="num">Residuo</th><th className="num">Giorni</th></tr></thead><tbody>{x.fatture.map((f) => <tr key={f.id}><td className="strong">{f.numero}</td><td>{itData(f.data)}</td><td>{itData(f.scadenza)}</td><td className="num">{eur(f.residuo)}</td><td className="num">{f.giorni}</td></tr>)}</tbody></table>
      <h3>Solleciti inviati</h3>
      {x.comunicazioni.length ? <ul className="cr-eventi">{x.comunicazioni.map((k) => <li key={k.id}><div className="q">{itDataOra(k.inviata_at)} · {FASE[k.fase]} · a {k.destinatari}{k.pec_stato === 'INVIATA' ? ` · PEC del ${itDataOra(k.pec_at)}` : ''}</div>{k.oggetto}</li>)}</ul> : <p className="small muted">Nessuna comunicazione inviata dalla Suite.</p>}
      <h3>Chiamate e risposte</h3>
      <ul className="cr-eventi">{x.chiamate.map((c, i) => <li key={`c${i}`}><div className="q">{itData(c.data)} · chiamata di {c.utente}</div>{ESITO[c.esito]}{c.nota ? `: ${c.nota}` : ''}</li>)}{x.risposte.map((r, i) => <li key={`r${i}`}><div className="q">{itDataOra(r.ricevuta_at)} · risposta da {r.da_email}</div>{r.sintesi}</li>)}{!(x.chiamate.length + x.risposte.length) && <li className="muted small">Nessuna</li>}</ul>
      <h3>Bozza della messa in mora</h3>
      <div className="alert warn" style={{ marginBottom: 8 }}><span>{x.messa_in_mora.avvertenza}</span></div>
      {x.messa_in_mora.mancanti.length > 0 && <p className="cr-rosso small">Dati mancanti nella bozza: {x.messa_in_mora.mancanti.join(', ')}</p>}
      <div className="cr-testo">{x.messa_in_mora.testo}</div>
      <div style={{ marginTop: 8 }}><CopyButton text={`${x.messa_in_mora.oggetto}\n\n${x.messa_in_mora.testo}`} label="Copia la bozza" /></div>
      <h3>Registro dei contatti</h3>
      <ul className="cr-eventi">{x.eventi.map((e, i) => <li key={i}><div className="q">{itDataOra(e.at)}{e.utente ? ` · ${e.utente}` : ' · automatico'}</div>{e.testo}</li>)}</ul>
    </div>
  );
}

export default function Legale() {
  const d = useApi('/legale'); const az = useAzione(d.reload); const [m, setM] = useState(null);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data, puoi = x.puoi;
  return (
    <div className="page">
      <PageHead title="Area legale" icon="shield" sub={`Ultimo passo della scala, a 60 giorni dalla scadenza o dopo una chiamata senza impegno. Parte solo su autorizzazione del Responsabile Amministrazione e Finanza; sopra ${eur(x.soglia_dir)} serve anche la Direzione.`} />
      <Modalita />
      <Card flush>{x.righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th className="num">Importo</th><th>Motivo</th><th>Stato</th><th></th></tr></thead>
        <tbody>{x.righe.map((p) => (
          <tr key={p.id}>
            <td><LinkCliente id={p.organization_id}>{p.cliente}</LinkCliente><div className="small muted">{p.fatture} {p.fatture === 1 ? 'fattura' : 'fatture'} · proposta il {itDataOra(p.creata_at)}</div></td>
            <td className="num strong">{eur(p.totale)}{p.serve_dir && <div className="small cr-rosso">sopra soglia</div>}</td>
            <td className="small">{p.motivo}{p.nota && <div className="muted">{p.nota}</div>}{p.esito && <div className="muted">Esito: {p.esito}</div>}</td>
            <td><Badge tone={STATO_PRATICA[p.stato]?.tone}>{STATO_PRATICA[p.stato]?.label}</Badge>{p.simulata && <div><Badge tone="grey">Prova</Badge></div>}{p.raf && <div className="small muted">RAF: {p.raf}</div>}{p.dir && <div className="small muted">Direzione: {p.dir}</div>}{p.stato === 'PROPOSTA' && p.raf && p.serve_dir && !p.dir && <div className="small cr-rosso">manca la Direzione</div>}</td>
            <td><div className="cr-azioni">
              <button className="btn sm ghost" onClick={() => setM({ t: 'fascicolo', p })}>Fascicolo</button>
              {p.stato === 'PROPOSTA' && puoi.autorizzare && !p.simulata && (!p.raf || puoi.direzione) && <button className="btn sm" disabled={az.busy} onClick={() => setM({ t: 'autorizza', p })}>Autorizza</button>}
              {p.stato === 'PROPOSTA' && puoi.autorizzare && <button className="btn sm ghost" onClick={() => setM({ t: 'respingi', p })}>Non autorizzare</button>}
              {p.stato === 'AUTORIZZATA' && puoi.trasmettere && <button className="btn sm" disabled={az.busy} onClick={() => az.fai(() => api.post(`/legale/${p.id}/trasmetti`, {}), 'Fascicolo segnato come trasmesso')}>Trasmesso</button>}
              {['AUTORIZZATA', 'TRASMESSA'].includes(p.stato) && puoi.trasmettere && <button className="btn sm ghost" onClick={() => setM({ t: 'chiudi', p })}>Chiudi</button>}
            </div></td>
          </tr>))}</tbody></table></div> : <Empty compact icon="check">Nessuna pratica</Empty>}</Card>
      {m?.t === 'fascicolo' && <Modal wide title={`Fascicolo: ${m.p.cliente}`} onClose={() => setM(null)}><Fascicolo id={m.p.id} /></Modal>}
      {m?.t === 'autorizza' && <Modulo title={`Autorizza il passaggio all'area legale: ${m.p.cliente}`} conferma="Autorizza" onClose={() => setM(null)} campi={[]} intro={`Importo ${eur(m.p.totale)}. Da questo momento i solleciti al cliente si fermano e il fascicolo va trasmesso all'area legale.${m.p.serve_dir ? ' Importo sopra la soglia: serve anche la firma della Direzione (il CEO autorizzando copre entrambe).' : ''}`}
        onConfirm={() => api.post(`/legale/${m.p.id}/autorizza`, {}).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
      {m?.t === 'respingi' && <Modulo title="Non autorizzare" onClose={() => setM(null)} intro="La scala resta ferma alla chiamata; il motore non ripropone la pratica per 30 giorni." campi={[{ k: 'nota', label: 'Motivo', type: 'textarea', required: true }]} onConfirm={(v) => api.post(`/legale/${m.p.id}/respingi`, v).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
      {m?.t === 'chiudi' && <Modulo title="Chiudi la pratica" onClose={() => setM(null)} campi={[{ k: 'esito', label: 'Esito (incassato, transazione, decreto ingiuntivo, stralcio...)', type: 'textarea', required: true }]} onConfirm={(v) => api.post(`/legale/${m.p.id}/chiudi`, v).then(d.reload)} />}
    </div>
  );
}
