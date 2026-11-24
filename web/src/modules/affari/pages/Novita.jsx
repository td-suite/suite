// Novità: ciò che è comparso nelle fonti dopo la prima lettura, con il giudizio di utilità e la sintesi del modello AI. Chi legge segna la
// voce come letta o in evidenza; l'originale si apre dal titolo.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Seg, SearchInput, useToast } from '../../../components/ui.jsx';
import { api, useApi } from '../api.js';
import { useStato } from '../index.jsx';

const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const TONO = { ALTA: 'red', MEDIA: 'amber', BASSA: 'grey' };
const giornoDi = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

export default function Novita() {
  const st = useStato(); const toast = useToast();
  const [f, setF] = useState({ vista: 'RILEVANTI', categoria: '', cerca: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const d = useApi(`/voci?${qs}`, [qs]);
  const [busy, setBusy] = useState(false);
  const fai = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); window.dispatchEvent(new Event('suite:badges')); await d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const righe = d.data?.righe || []; const nuove = righe.filter((v) => v.stato === 'NUOVA');
  const giorni = [...new Set(righe.map((v) => giornoDi(v.vista_at)))];
  return (
    <div className="page">
      <PageHead title="Public Affairs" icon="news" sub="Avvisi e bandi delle aziende USL, normativa sanitaria nazionale e della Regione Toscana. Una voce è una novità quando compare in una fonte dopo la prima lettura."
        actions={<>{nuove.length > 0 && <button className="btn ghost" disabled={busy} onClick={() => fai(() => api.post('/voci/lette', { ids: nuove.map((v) => v.id) }), 'Segnate come lette')}>Segna tutte come lette</button>}
          {st.user.gestisce && <button className="btn" disabled={busy} onClick={() => fai(() => api.post('/giro', {}), (r) => `${r.lette} fonti lette, ${r.nuove} novità${r.errori.length ? `, ${r.errori.length} fonti con errore` : ''}`)}>Leggi le fonti ora</button>}</>} />
      {!st.ai && <div className="alert warn pa-gap"><span>Il modello AI non è attivo su questo server: le novità vengono rilevate e inviate, ma senza sintesi né giudizio di utilità.</span></div>}
      {d.data && <p className="small muted">Ultima lettura delle fonti: {d.data.ultima_lettura ? itDataOra(d.data.ultima_lettura) : 'mai'}. Ultima email: {d.data.ultimo_invio ? `${itData(d.data.ultimo_invio.giorno)}, ${d.data.ultimo_invio.voci} novità` : 'nessuna'}. In attesa della prossima email: {d.data.in_attesa_di_invio}.</p>}
      <div className="filters pa-gap">
        <Seg value={f.vista} onChange={(v) => setF({ ...f, vista: v })} label="Vista" items={[{ value: 'RILEVANTI', label: 'Rilevanti' }, { value: 'EVIDENZA', label: 'In evidenza' }, { value: 'SCARSA', label: 'Scarsa utilità' }, { value: 'ARCHIVIO', label: 'Archivio' }]} />
        <select style={{ width: 'auto' }} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} aria-label="Categoria"><option value="">Tutte le categorie</option>{Object.entries(st.categorie).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <SearchInput value={f.cerca} onChange={(v) => setF({ ...f, cerca: v })} placeholder="Cerca nel titolo o nella sintesi" />
      </div>
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : !righe.length ? <Card><Empty icon="check" title="Nessuna novità in questa vista">Le fonti vengono lette più volte al giorno. La prima lettura di una fonte registra ciò che c'è già, senza segnalarlo.</Empty></Card>
        : giorni.map((g) => (<div key={g}><div className="pa-giorno">Rilevate il {itData(g)}</div>
          {righe.filter((v) => giornoDi(v.vista_at) === g).map((v) => (
            <div key={v.id} className={`pa-voce ${v.stato === 'NUOVA' ? 'nuova' : ''}`}>
              <div className="m"><span>{v.fonte}</span>{v.utilita ? <Badge tone={TONO[v.utilita]}>Utilità {v.utilita.toLowerCase()}</Badge> : <Badge tone="grey">{v.ai_stato === 'DA_VALUTARE' ? 'In valutazione' : 'Non valutata'}</Badge>}
                {v.stato === 'IN_EVIDENZA' && <Badge tone="blue">In evidenza</Badge>}{v.scadenza && <span className={v.scadenza < giornoDi(new Date()) ? '' : 'pa-rosso'}>scadenza {itData(v.scadenza)}</span>}{v.pubblicata && <span>pubblicata il {itData(v.pubblicata)}</span>}{(v.linee || []).map((l) => <Badge key={l} tone="teal" dot={false}>{l}</Badge>)}</div>
              <div className="t"><a href={v.url} target="_blank" rel="noreferrer" onClick={() => v.stato === 'NUOVA' && api.put(`/voci/${v.id}`, { stato: 'LETTA' }).then(() => { window.dispatchEvent(new Event('suite:badges')); d.reload(); }).catch(() => 0)}>{v.titolo}</a></div>
              {v.sintesi ? <div className="s">{v.sintesi}</div> : v.descrizione && <div className="s">{v.descrizione}</div>}
              {v.motivo && <div className="p">Perché: {v.motivo}</div>}
              {v.azione && !/^nessuna azione/i.test(v.azione) && <div className="p"><strong>Da fare:</strong> {v.azione}</div>}
              {v.sintesi && <div className="p muted">{v.approfondita && !v.ai_errore ? 'Sintesi del modello AI sul testo del documento.' : v.ai_errore || 'Giudizio del modello AI sul titolo e sulla descrizione.'} Prima di decidere va letto l'originale.</div>}
              {!v.sintesi && v.ai_errore && <div className="p pa-rosso">{v.ai_errore}</div>}
              <div className="az">
                {v.stato === 'NUOVA' && <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.put(`/voci/${v.id}`, { stato: 'LETTA' }))}>Letta</button>}
                {v.stato !== 'IN_EVIDENZA' ? <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.put(`/voci/${v.id}`, { stato: 'IN_EVIDENZA' }))}>Metti in evidenza</button> : <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.put(`/voci/${v.id}`, { stato: 'LETTA' }))}>Togli dall'evidenza</button>}
                {st.user.gestisce && v.stato !== 'ARCHIVIATA' && <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.put(`/voci/${v.id}`, { stato: 'ARCHIVIATA' }), 'Archiviata')}>Archivia</button>}
                {st.user.gestisce && st.ai && <button className="btn sm ghost" disabled={busy} onClick={() => fai(() => api.post(`/voci/${v.id}/rivaluta`, {}), 'Valutazione rifatta')}>Rivaluta</button>}
              </div>
            </div>))}</div>))}
    </div>
  );
}
