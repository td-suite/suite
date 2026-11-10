import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, StatusBadge, PromptModal, Icon, useToast, ErrorBox } from '../components/ui.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { SilvaBadge } from '../components/silva.jsx';
import { itDateTime, KIND } from '../format.js';

// Fase 3 · Trasmissione al magazzino: ordini approvati che il fornitore legge dalle API ogni 5 minuti, presa in carico, spedizione
export default function Supplier() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, reload } = useApi('/orders?status=APPROVATO,PRESO_IN_CARICO');
  const settings = useApi('/settings');
  const [ask, setAsk] = useState(null);
  const [err, setErr] = useState(null);
  const act = async (o, path, body, msg) => { setErr(null); try { const r = await api.post(`/orders/${o.id}/${path}`, body || {}); toast(msg || 'Fatto'); if (r.error) toast(r.error, 'err'); reload(); } catch (e) { setErr(e); } };
  const waiting = (data || []).filter((o) => o.status === 'APPROVATO'); const picked = (data || []).filter((o) => o.status === 'PRESO_IN_CARICO');
  const s = settings.data?.silva;
  const Row = ({ o }) => (
    <tr key={o.id}>
      <td><span className="mono strong" style={{ cursor: 'pointer' }} onClick={() => nav(`${BASE}/ordini/${o.id}`)}>{o.number}</span>{o.urgent && <> <Badge tone="red">Urgente</Badge></>}<div className="small muted">{KIND[o.kind]}</div></td>
      <td>{o.struttura_label || o.struttura_name}<div className="small muted">{o.struttura_city}{o.delivery_site_name ? " · punto di consegna" : ""}</div></td>
      <td className="num">{o.lines_count}</td><td className="num">{o.packs_total}</td>
      <td className="small muted">{itDateTime(o.approved_at)}</td>
      <td className="small"><SilvaBadge o={o} />{!o.silva_send_status && o.polled_at && <div className="muted">letto in polling {itDateTime(o.polled_at)}</div>}</td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        {o.status === 'APPROVATO' && o.silva_send_status !== 'INVIATO' && o.silva_error_code !== 'immutable_order' && <><button className="btn sm ghost" title="Apre il dettaglio: anteprima di ciò che parte e conferma (la POST crea un ordine reale presso Silva)" onClick={() => nav(`${BASE}/ordini/${o.id}`)}>Trasmetti a Silva…</button>{' '}</>}
        {o.status === 'APPROVATO' && <><button className="btn sm ghost" onClick={() => setAsk({ o, kind: 'picked' })}>Preso in carico</button>{' '}<button className="btn sm ghost" title="Invia il PDF alla casella ordini del fornitore" onClick={() => act(o, 'email-supplier', {}, 'Email inviata al magazzino')}><Icon name="mail" size={14} /></button>{' '}</>}
        <button className="btn sm" onClick={() => setAsk({ o, kind: 'shipped' })}>Spedito</button>
      </td>
    </tr>
  );
  return (
    <div className="page">
      <PhaseBanner n="3" title="Trasmissione al magazzino (Silva Group)" desc="All'approvazione di Ops l'ordine viene trasmesso a Silva (Guida tecnica API ordini v1: POST /api/v1/ordini con la destinazione Silva della struttura e i codici del catalogo Silva; ritentativi automatici su 429, 503 e timeout). Il primo invio va concordato con Silva: finché non è confermato la trasmissione si fa dal dettaglio dell'ordine. Lo stato presso Silva (in preparazione, evaso con DDT, annullato) si legge ogni 30 minuti; presa in carico e spedizione si possono registrare anche a mano." next="Fase 4: consegna alla struttura" />
      <div className="page-head">
        <div><h1>Ordini al magazzino</h1><div className="sub">{s?.api?.connettore ? (s.api.connettore.automatico ? 'Trasmissione automatica a Silva attiva' : `Trasmissione automatica non attiva: ${s.api.connettore.motivo_non_automatico}`) : ''}{s?.api?.ultimo_invio ? ` · ultimo invio ${s.api.ultimo_invio.numero} ${itDateTime(s.api.ultimo_invio.at)}` : ''}</div></div>
        <div className="row"><a className="btn ghost" href={`${API_BASE}/stats/export/orders.xlsx`}><Icon name="download" size={16} />Excel</a></div>
      </div>
      <ErrorBox error={err} />
      <Card title={`In attesa del magazzino (${waiting.length})`} flush className="mb">
        {!data ? <Loading /> : !waiting.length ? <Empty>Nessun ordine in attesa</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Destinazione</th><th className="num">Articoli</th><th className="num">Confezioni</th><th>Approvato</th><th>Silva</th><th /></tr></thead><tbody>{waiting.map((o) => <Row key={o.id} o={o} />)}</tbody></table></div>
        )}
      </Card>
      <Card title={`In preparazione presso il magazzino (${picked.length})`} flush>
        {!data ? <Loading /> : !picked.length ? <Empty>Nessun ordine in preparazione</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Destinazione</th><th className="num">Articoli</th><th className="num">Confezioni</th><th>Approvato</th><th>Silva</th><th /></tr></thead><tbody>{picked.map((o) => <Row key={o.id} o={o} />)}</tbody></table></div>
        )}
      </Card>
      <div className="small muted mt">Silva non richiama la Suite in questa versione delle API (niente callback, annullamenti, DDT o packing list): la consegna la conferma la struttura al carico. Restano disponibili per il futuro le API in ingresso GET /api/orders/integrations/silva/orders e POST …/orders/&lt;numero&gt;/presa-in-carico, …/spedito, …/consegnato. Dettagli in docs/SILVA_API_ORDINI.md.</div>
      {ask && ask.kind === 'picked' && <PromptModal title={`Presa in carico di ${ask.o.number}`} label="Riferimento del fornitore (facoltativo)" minLength={0} confirmText="Registra" onClose={() => setAsk(null)} onConfirm={async (reference) => { await act(ask.o, 'picked', { reference }, 'Presa in carico registrata'); }} />}
      {ask && ask.kind === 'shipped' && <PromptModal title={`Spedizione di ${ask.o.number}`} label="Numero DDT (facoltativo)" minLength={0} confirmText="Registra spedizione" onClose={() => setAsk(null)} onConfirm={async (ddt) => { await act(ask.o, 'shipped', { ddt }, 'Spedizione registrata: l\'ordine passa alla fase 4'); }} />}
    </div>
  );
}
