import React, { useState } from 'react';
import { api, BASE } from '../api.js';
import { useApi, Badge, Card, Modal, ErrorBox, Icon, useToast } from './ui.jsx';
import { itDateTime } from '../format.js';

// Trasmissione a Silva (Guida tecnica API ordini v1, 09/11/2026): badge della colonna "Silva" e riquadro del dettaglio ordine.
const ora = (d) => (d ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '');

/** Etichetta, tono e dettaglio dello stato Silva di un ordine (null = non riguarda Silva) */
export function silvaInfo(o) {
  const s = o.silva_send_status;
  if (s === 'INVIATO') {
    const rif = o.silva_reference ? `rif. ${o.silva_reference}` : '';
    switch (o.silva_stato) {
      case 'EVASO': return { label: 'evaso (DDT)', tone: 'green', detail: `DDT emesso, rilevato il ${itDateTime(o.silva_stato_dal)}${rif ? ` · ${rif}` : ''}` };
      case 'IN_PREPARAZIONE': return { label: 'in preparazione', tone: 'blue', detail: `presso Silva dal ${itDateTime(o.silva_stato_dal)}${rif ? ` · ${rif}` : ''}` };
      case 'ANNULLATO': return { label: 'annullato', tone: 'red', detail: `annullato presso Silva (rilevato il ${itDateTime(o.silva_stato_dal)})` };
      case 'NON_DISPONIBILE': return { label: 'stato non disponibile', tone: 'mauve', detail: `Silva non determina lo stato: si riprova (controllo del ${itDateTime(o.silva_stato_at)})` };
      case 'ASSENTE': return { label: 'non trovato da Silva', tone: 'red', detail: o.silva_stato_msg || 'GET stato 404 dopo la ricevuta: segnalato' };
      default: return { label: 'inviato', tone: 'green', detail: `${rif}${rif ? ' · ' : ''}ricevuto alle ${itDateTime(o.silva_received_at || o.silva_sent_at)}` };
    }
  }
  if (s === 'IN_CODA') return { label: 'in coda', tone: 'mauve', detail: o.silva_retry_at ? `ritenta alle ${ora(o.silva_retry_at)}${o.silva_send_attempts ? ` · ${o.silva_send_attempts} tentativi` : ''}` : o.silva_send_message };
  if (s === 'ERRORE_DATI') return { label: o.silva_error_code === 'immutable_order' ? 'già presso Silva con dati diversi' : 'errore dati', tone: 'red', detail: o.silva_send_message };
  if (s === 'ERRORE_CHIAVE') return { label: 'errore chiave', tone: 'red', detail: o.silva_send_message };
  if (s === 'BLOCCATO') return { label: 'dati da completare', tone: 'red', detail: o.silva_send_message };
  if (o.status === 'APPROVATO') return { label: 'da trasmettere', tone: 'mauve', detail: s === 'ERRORE' ? `tentativo della versione precedente non riuscito: ${o.silva_send_message || ''}` : null };
  return null;
}

export function SilvaBadge({ o, detail = true }) {
  const i = silvaInfo(o);
  if (!i) return <span className="muted">–</span>;
  return <><Badge tone={i.tone}>{i.label}</Badge>{detail && i.detail && <div className="small muted" style={{ maxWidth: 280 }} title={i.detail}>{i.detail.length > 90 ? `${i.detail.slice(0, 88)}…` : i.detail}</div>}</>;
}

/** Riquadro "Silva" del dettaglio ordine (solo Area Operations) */
export function SilvaCard({ o, onChanged }) {
  const toast = useToast();
  const prev = useApi(`/orders/${o.id}/silva`, [o.updated_at]);
  const [ask, setAsk] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [esito, setEsito] = useState(null);
  const p = prev.data;
  const k = p?.connettore;
  const info = silvaInfo(o);
  const inviabile = o.status === 'APPROVATO' && o.silva_send_status !== 'INVIATO' && o.silva_error_code !== 'immutable_order';
  const concordato = k && !k.primo_invio_confermato;
  const problemi = p && o.silva_send_status !== 'INVIATO' ? p.problemi : [];
  const proponi = k && k.primo_invio_at && !k.primo_invio_confermato;
  const invia = async () => {
    setBusy('push'); setErr(null);
    try {
      const r = await api.post(`/orders/${o.id}/silva-push`, { conferma: true });
      setEsito(r);
      toast(r.ok ? 'Ricevuto da Silva' : (r.message || r.skipped || 'Trasmissione non riuscita'), r.ok ? 'ok' : 'err');
      setAsk(false); setOk(false); onChanged?.(); prev.reload();
    } catch (e) { setErr(e); }
    setBusy(null);
  };
  const stato = async () => {
    setBusy('stato'); setErr(null);
    try { const r = await api.post(`/orders/${o.id}/silva-stato`); toast(`Stato Silva: ${r.stato}${r.azione ? ` · ${r.azione}` : ''}`); onChanged?.(); } catch (e) { setErr(e); }
    setBusy(null);
  };
  const automatismo = async () => {
    setBusy('auto'); setErr(null);
    try { await api.post('/silva/automatismo', { attiva: true }); toast('Trasmissione automatica attiva: gli ordini approvati da ora partono da soli'); prev.reload(); } catch (e) { setErr(e); }
    setBusy(null);
  };
  return (
    <Card title="Silva" className="mt" actions={info && <Badge tone={info.tone}>{info.label}</Badge>}>
      <ErrorBox error={err || prev.error} />
      {info?.detail && !(o.silva_send_status === 'BLOCCATO' && problemi?.length) && <div className="small">{info.detail}</div>}
      {o.silva_send_status === 'INVIATO' && (
        <div className="small" style={{ marginTop: 6 }}>
          {o.silva_reference && <div>Riferimento Silva: <span className="mono">{o.silva_reference}</span></div>}
          <div className="muted">Ricevuto alle {itDateTime(o.silva_received_at || o.silva_sent_at)}{o.silva_stato_at ? ` · ultimo controllo dello stato ${itDateTime(o.silva_stato_at)}` : ' · stato non ancora letto'}</div>
          {o.silva_stato_msg && <div className="muted">{o.silva_stato_msg}</div>}
        </div>
      )}
      {o.silva_send_status === 'ERRORE_DATI' && o.silva_error_code && <div className="small muted" style={{ marginTop: 6 }}>Codice di Silva: <span className="mono">{o.silva_error_code}</span>{o.silva_error_field ? <> · campo <span className="mono">{o.silva_error_field}</span></> : null}</div>}
      {problemi?.length > 0 && <div className="alert err small" style={{ marginTop: 8 }}><div>Non si può trasmettere:<ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{problemi.map((x) => <li key={x}>{x}</li>)}</ul><a href={`${BASE}/strutture?vista=silva`}>Destinazioni Silva</a> · <a href={`${BASE}/magazzino?scheda=articoli`}>Magazzino Centrale · Articoli ordinabili</a></div></div>}
      {p?.avvisi?.length > 0 && o.silva_send_status !== 'INVIATO' && <div className="small muted" style={{ marginTop: 6 }}>{p.avvisi.join(' · ')}</div>}
      {k && !k.chiave && <div className="small muted" style={{ marginTop: 6 }}>Chiave API Silva non impostata (Amministrazione &gt; Connettori &gt; Silva).</div>}
      {k && inviabile && !k.automatico && k.chiave && <div className="small muted" style={{ marginTop: 6 }}>{k.motivo_non_automatico}.</div>}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        {inviabile && k?.chiave && k?.attivo && <button className="btn sm" disabled={!p || problemi.length > 0 || busy} onClick={() => setAsk(true)}><Icon name="truck" size={14} />{concordato ? 'Trasmetti a Silva (invio concordato)' : 'Trasmetti a Silva'}</button>}
        {o.silva_send_status === 'INVIATO' && k?.chiave && <button className="btn sm ghost" disabled={busy === 'stato'} onClick={stato}>{busy === 'stato' ? 'Lettura…' : 'Aggiorna stato da Silva'}</button>}
      </div>
      {(proponi || esito?.proponi_automatismo) && k && !k.primo_invio_confermato && (
        <div className="alert info small" style={{ marginTop: 10 }}>
          <div>Il primo invio concordato è riuscito{k.primo_invio_numero ? ` (${k.primo_invio_numero}${k.primo_invio_riferimento ? `, rif. ${k.primo_invio_riferimento}` : ''})` : ''}. Attivare la trasmissione automatica all'approvazione? Da quel momento ogni ordine approvato da Ops parte da solo verso Silva (gli ordini approvati prima restano da trasmettere a mano).
            <div style={{ marginTop: 6 }}><button className="btn sm" disabled={busy === 'auto'} onClick={automatismo}>Attiva la trasmissione automatica</button></div></div>
        </div>
      )}
      {ask && p && (
        <Modal title={concordato ? `Invio concordato a Silva · ${o.number}` : `Trasmettere ${o.number} a Silva?`} wide onClose={() => { setAsk(false); setOk(false); }} footer={<>
          <button className="btn ghost" onClick={() => { setAsk(false); setOk(false); }}>Annulla</button>
          <button className="btn" disabled={(concordato && !ok) || busy === 'push'} onClick={invia}>{busy === 'push' ? 'Trasmissione…' : 'Trasmetti a Silva'}</button>
        </>}>
          <div className="alert warn small" style={{ marginBottom: 10 }}><span>La trasmissione <b>crea un ordine reale in preparazione</b> presso Silva. {concordato ? 'Silva chiede che il primo invio sia concordato: usa una sede e articoli concordati con Silva.' : 'Una volta ricevuto, l\'ordine non si modifica né si annulla via API.'}</span></div>
          <div className="small">Consegna a <b>{p.destinazione?.label || o.struttura_label}</b>{p.destinazione?.implicito ? ' (unica sede service attiva)' : ''} · destinazione Silva {p.destinazione?.punto ? 'del punto ' : ''}<span className="mono strong">{p.payload.destinazione?.codice}</span> · urgenza {p.payload.urgenza}{p.payload.destinazione?.noteConsegna ? ` · note di consegna: ${p.payload.destinazione.noteConsegna}` : ''}</div>
          <div className="table-wrap" style={{ marginTop: 8 }}><table className="t small"><thead><tr><th>#</th><th>Articolo</th><th>Codice Silva</th><th className="num">Confezioni</th><th className="num">Unità totali</th><th>Unità</th></tr></thead><tbody>
            {p.righe.map((r, i) => <tr key={r.codice}><td className="muted">{i + 1}</td><td>{r.nome}</td><td className="mono">{r.codice}</td><td className="num">{r.confezioni} × {r.per_confezione}</td><td className="num strong">{r.unitaTotali}</td><td>{r.unita}</td></tr>)}
          </tbody></table></div>
          {p.avvisi?.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{p.avvisi.join(' · ')}</div>}
          <details style={{ marginTop: 8 }}><summary className="small">Corpo JSON della POST /api/v1/ordini</summary><pre className="small mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(p.payload, null, 2)}</pre></details>
          {concordato && <label className="f inline" style={{ marginTop: 10 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Ho concordato con Silva questo invio (sede, articoli e quantità) e confermo che crea un ordine reale</label>}
        </Modal>
      )}
    </Card>
  );
}
