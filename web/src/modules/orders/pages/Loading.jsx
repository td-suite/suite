import React, { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, isOps } from '../auth.jsx';
import { api, BASE } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, PromptModal, Icon, useToast, ErrorBox, Field } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { ScanButton } from '../components/scan.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime, PKG_STATUS, STATUS } from '../format.js';
import { iconFor } from './OrderDetail.jsx';

// Fase 5 · Carico nel magazzino interno (strutture TD): si leggono i codici a barre di tutte le confezioni consegnate
const IN_ARRIVO = 'APPROVATO,PRESO_IN_CARICO,SPEDITO,CONSEGNATO';
export default function LoadingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const ops = isOps(user);
  const [sp, setSp] = useSearchParams();
  const sid = ops ? sp.get('struttura_id') || '' : '';
  const strutture = useApi(ops ? '/strutture' : null);
  // ordini della struttura in arrivo o consegnati: la struttura ricevente carica quanto effettivamente arrivato
  const { data, reload } = useApi(`/orders?status=${IN_ARRIVO}${sid ? `&struttura_id=${sid}` : ''}`, [sid]);
  const consegnati = (data || []).filter((o) => o.status === 'CONSEGNATO');
  const inArrivo = (data || []).filter((o) => o.status !== 'CONSEGNATO');
  return (
    <div className="page">
      <PhaseBanner n="5" title="Carico nel magazzino interno" desc="Per ogni ordine consegnato, leggi il codice a barre di ogni confezione (o spuntala): entra in giacenza con lotto e scadenza. Alla conferma le confezioni non lette vengono segnalate come mancanti all'Area Operations." next="Fase 6: scarico ad ogni utilizzo" />
      {id ? <LoadOrder id={id} onDone={() => { reload(); nav(`${BASE}/carico${sid ? `?struttura_id=${sid}` : ''}`); }} /> : (<>
        {ops && <div className="row mb"><Field label="Struttura"><select value={sid} onChange={(e) => setSp(e.target.value ? { struttura_id: e.target.value } : {})}><option value="">Tutte le strutture</option>{(strutture.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'CLIENTE' ? ' · cliente' : ''}</option>)}</select></Field></div>}
        <Card title="Consegne da caricare" flush>
          {!data ? <Loading /> : !consegnati.length ? <Empty>Nessuna consegna in attesa di carico{inArrivo.length ? ': gli ordini in arrivo sono qui sotto, apri quello arrivato e registra la consegna' : ''}</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Struttura</th><th className="num">Confezioni</th><th className="num">Già lette</th><th>DDT</th><th>Consegnato</th><th /></tr></thead>
              <tbody>{consegnati.map((o) => <tr key={o.id} className="click" onClick={() => nav(`${BASE}/carico/${o.id}`)}><td className="mono strong">{o.number}</td><td className="small">{o.struttura_name}</td><td className="num">{o.packs_delivered}</td><td className="num">{o.packs_received}</td><td className="mono small">{o.ddt_number || '–'}</td><td className="small muted">{itDateTime(o.delivered_at)}</td><td className="num"><button className="btn sm"><Icon name="barcode" size={14} />Carica</button></td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="Ordini in arrivo dal Magazzino Centrale" flush>
          {!data ? <Loading /> : !inArrivo.length ? <Empty>Nessun ordine in arrivo</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Struttura</th><th>Stato</th><th className="num">Confezioni approvate</th><th>Aggiornato</th><th /></tr></thead>
              <tbody>{inArrivo.map((o) => <tr key={o.id} className="click" onClick={() => nav(`${BASE}/carico/${o.id}`)}><td className="mono strong">{o.number}</td><td className="small">{o.struttura_name}</td><td><Badge tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label || o.status}</Badge></td><td className="num">{o.packs_total ?? '–'}</td><td className="small muted">{itDateTime(o.updated_at)}</td><td className="num"><button className="btn sm" onClick={(e) => { e.stopPropagation(); nav(`${BASE}/carico/${o.id}`); }}>È arrivato</button></td></tr>)}</tbody></table></div>
          )}
          <div className="inner small muted">Se il materiale è arrivato prima che il magazzino segnasse la consegna, apri l'ordine e registra la consegna: poi carichi le confezioni effettivamente ricevute.</div>
        </Card>
      </>)}
    </div>
  );
}

function LoadOrder({ id, onDone }) {
  const toast = useToast();
  const { data: o, reload } = useApi(`/orders/${id}`);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState({});
  const [confirm, setConfirm] = useState(false);
  const inputRef = useRef(null);
  const groups = useMemo(() => { const g = new Map(); for (const p of o?.packages || []) g.set(p.article_id, [...(g.get(p.article_id) || []), p]); return [...g.values()]; }, [o]);
  if (!o) return <Loading />;
  const arrivato = async () => { setErr(null); try { await api.post(`/orders/${o.id}/arrivato`, {}); toast('Consegna registrata: ora leggi le confezioni ricevute'); reload(); } catch (e) { setErr(e); } };
  if (['APPROVATO', 'PRESO_IN_CARICO', 'SPEDITO'].includes(o.status)) return (
    <div className="alert info" style={{ alignItems: 'center' }}><Icon name="import" size={18} /><div style={{ flex: 1 }}><b>Ordine {o.number}</b> · {STATUS[o.status]?.label || o.status}: il magazzino non ha ancora segnato la consegna. Se il materiale è arrivato, registrala e poi carica le confezioni effettivamente ricevute.</div><button className="btn" onClick={arrivato}>È arrivato: registra la consegna</button><ErrorBox error={err} /></div>
  );
  if (o.status !== 'CONSEGNATO') return <div className="alert info">Ordine {o.number}: {o.status === 'IMMAGAZZINATO' ? 'carico già completato.' : 'non è in attesa di carico.'}</div>;
  // quantità ricevute per articolo: segna le prime N confezioni del gruppo come ricevute, le altre tornano da caricare
  const setReceivedCount = async (g, n) => {
    const k = Math.max(0, Math.min(g.length, Number(n) || 0));
    const packages = g.map((p, i) => ({ id: p.id, received: i < k, lot: draft[p.id]?.lot, expiry: draft[p.id]?.expiry }));
    setErr(null); try { await api.post(`/orders/${o.id}/load`, { packages }); reload(); } catch (e) { setErr(e); }
  };
  const received = o.packages.filter((p) => p.status === 'RICEVUTO').length;
  const scan = async (c) => {
    const v = (c || code).trim(); if (!v) return;
    setErr(null);
    try { const r = await api.post(`/orders/${o.id}/load-scan`, { code: v }); toast(`${o.packages.find((p) => p.id === r.id)?.article_name || 'Confezione'} caricata${r.lot ? ` · lotto ${r.lot}` : ''}`); setCode(''); reload(); inputRef.current?.focus(); } catch (e) { setErr(e); setCode(''); inputRef.current?.focus(); }
  };
  const toggle = async (p, on) => { setErr(null); try { await api.post(`/orders/${o.id}/load`, { packages: [{ id: p.id, received: on, lot: draft[p.id]?.lot, expiry: draft[p.id]?.expiry }] }); reload(); } catch (e) { setErr(e); } };
  const all = async () => { setErr(null); try { await api.post(`/orders/${o.id}/load`, { all: true }); toast('Tutte le confezioni spuntate'); reload(); } catch (e) { setErr(e); } };
  const saveLots = async () => { const packages = Object.entries(draft).map(([pid, d]) => ({ id: Number(pid), received: true, lot: d.lot, expiry: d.expiry })); if (!packages.length) return; try { await api.post(`/orders/${o.id}/load`, { packages }); toast('Lotti salvati'); setDraft({}); reload(); } catch (e) { setErr(e); } };
  return (
    <>
      <div className="page-head"><div><h1>Carico ordine {o.number}</h1><div className="sub">{o.ddt_number ? `DDT ${o.ddt_number} · ` : ''}consegnato il {itDateTime(o.delivered_at)} · {o.packages.length} confezioni</div></div><Badge tone={received === o.packages.length ? 'green' : 'blue'}>{received} / {o.packages.length} caricate</Badge></div>
      <ErrorBox error={err} />
      <div className="scanbox mb">
        <form className="row" onSubmit={(e) => { e.preventDefault(); scan(); }}>
          <input ref={inputRef} className="mono" placeholder="Leggi il codice a barre della confezione e premi Invio" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 280 }} autoFocus />
          <button className="btn lg"><Icon name="barcode" size={18} />Carica</button>
          <ScanButton onCode={scan} />
          <button type="button" className="btn ghost lg" onClick={all} disabled={received === o.packages.length}><Icon name="check" size={16} />Seleziona tutto</button>
          <button type="button" className="btn ghost lg" onClick={saveLots} disabled={!Object.keys(draft).length}>Salva lotti</button>
          <button type="button" className="btn dark lg" onClick={() => setConfirm(true)} disabled={!received}>Conferma carico</button>
        </form>
        <div className="small muted" style={{ marginTop: 8 }}>Il codice può essere quello della singola confezione (se il fornitore lo ha comunicato), il GTIN del produttore (anche GS1-128 con lotto e scadenza) o il codice articolo. Lotto e scadenza si possono anche scrivere a mano.</div>
      </div>
      <Card flush>
        <div className="table-wrap"><table className="t">
          <thead><tr><th style={{ width: 34 }} /><th>Articolo</th><th>#</th><th>Lotto</th><th>Scadenza</th><th>Codice</th><th>Stato</th></tr></thead>
          <tbody>{groups.map((g) => g.map((p, i) => (
            <tr key={p.id} className={p.status === 'RICEVUTO' ? 'rx' : ''}>
              <td><input type="checkbox" checked={p.status === 'RICEVUTO'} onChange={(e) => toggle(p, e.target.checked)} /></td>
              <td>{i === 0 ? <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={iconFor(p.article_code)} color={p.color} size={30} /><div><div className="strong">{p.article_name}</div><div className="small muted">{p.pack_label} · {g.length} confezioni · ricevute <input type="number" min="0" max={g.length} defaultValue={g.filter((x) => x.status === 'RICEVUTO').length} key={`${p.article_id}-${g.filter((x) => x.status === 'RICEVUTO').length}`} onBlur={(e) => setReceivedCount(g, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setReceivedCount(g, e.target.value); } }} style={{ width: 64, minHeight: 28, padding: '2px 6px' }} /> su {g.length}</div></div></div> : <span className="muted small">idem</span>}</td>
              <td className="muted">{p.seq}</td>
              <td><input placeholder="lotto" value={draft[p.id]?.lot ?? p.lot ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: { ...(draft[p.id] || {}), lot: e.target.value } })} style={{ minHeight: 30, padding: '3px 8px', width: 120 }} /></td>
              <td><input type="date" value={draft[p.id]?.expiry ?? p.expiry ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: { ...(draft[p.id] || {}), expiry: e.target.value } })} style={{ minHeight: 30, padding: '3px 8px', width: 150 }} /></td>
              <td className="mono small">{p.barcode}</td>
              <td><Badge tone={PKG_STATUS[p.status]?.tone}>{PKG_STATUS[p.status]?.label}</Badge></td>
            </tr>)))}</tbody>
        </table></div>
      </Card>
      {confirm && <PromptModal title="Confermare il carico?" label={`${received} confezioni caricate su ${o.packages.length}. ${o.packages.length - received ? `Le ${o.packages.length - received} non lette saranno segnalate come non ricevute.` : 'Tutto il materiale entra in giacenza.'} Note (facoltative)`} minLength={0} confirmText="Conferma carico" onClose={() => setConfirm(false)} onConfirm={async (note) => { const r = await api.post(`/orders/${o.id}/load-confirm`, { note }); toast(r.missing ? `Carico confermato con ${r.missing} confezioni mancanti` : 'Materiale caricato in giacenza'); onDone(); }} />}
    </>
  );
}

export { itDate };
