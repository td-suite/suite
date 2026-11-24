// Archivio (v0.97.0): tutto ciò che la Suite ha registrato dalle fonti, comprese le voci che c'erano già alla prima lettura e gli avvisi
// e bandi pubblicati dal gennaio 2026, ricostruiti seguendo le pagine degli elenchi. Non sono novità e non generano email.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, SearchInput, useToast } from '../../../components/ui.jsx';
import { api, useApi } from '../api.js';
import { useStato } from '../index.jsx';

const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const TONO = { ALTA: 'red', MEDIA: 'amber', BASSA: 'grey' };

export default function Archivio() {
  const st = useStato(); const toast = useToast();
  const [f, setF] = useState({ categoria: 'BANDI', fonte: '', utilita: '', cerca: '', dal: '2026-01-01' });
  const qs = new URLSearchParams({ vista: 'STORICO', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const d = useApi(`/voci?${qs}`, [qs]); const stato = useApi('/archivio/stato');
  const [busy, setBusy] = useState(false);
  const ricostruisci = async () => {
    setBusy(true);
    try { const r = await api.post('/archivio', {}); toast(`Archivio aggiornato: ${r.fonti.reduce((a, x) => a + (x.aggiunte || 0), 0)} voci aggiunte da ${r.fonti.filter((x) => !x.errore).length} fonti su ${r.fonti.length}`); await d.reload(); await stato.reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const righe = d.data?.righe || []; const u = stato.data?.ultimo;
  return (
    <div className="page">
      <PageHead title="Archivio" icon="folder" sub="Avvisi, bandi e atti registrati dalle fonti, dal più recente. Per gli avvisi e i bandi l'archivio parte dal 1° gennaio 2026."
        actions={st.user.gestisce && <button className="btn" disabled={busy} onClick={ricostruisci}>{busy ? 'Leggo gli elenchi…' : 'Aggiorna l\'archivio'}</button>} />
      {u ? <Card className="pa-gap" title={`Ultima ricostruzione: ${itDataOra(u.at)}`}>
        <ul className="pa-elenco">{u.fonti.map((x) => <li key={x.fonte}><b>{x.nome}</b>: {x.errore ? <span className="pa-rosso">{x.errore}</span> : `${x.pagine} pagine lette, ${x.trovate} voci negli elenchi, ${x.aggiunte} aggiunte, ${x.scartate_prima} precedenti al 2026 lasciate fuori${x.senza_data ? `, ${x.senza_data} senza data tenute` : ''}`}</li>)}</ul>
        {stato.data.in_attesa > 0 && <p className="small muted">{stato.data.in_attesa} voci aspettano ancora il giudizio di utilità del modello: arriva nelle prossime letture.</p>}
        <p className="small muted">Data della voce: quella di pubblicazione quando l'elenco la riporta, altrimenti la scadenza scritta nel titolo. Le voci senza alcuna data restano in archivio perché non si può escludere che siano del periodo.</p>
      </Card> : stato.data && <div className="alert info pa-gap"><span>L'archivio dal gennaio 2026 non è ancora stato ricostruito: parte da solo poco dopo l'avvio della Suite{st.user.gestisce ? ', oppure premi "Aggiorna l\'archivio"' : ''}.</span></div>}
      <div className="filters pa-gap">
        <select style={{ width: 'auto' }} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value, fonte: '' })} aria-label="Categoria"><option value="">Tutte le categorie</option>{Object.entries(st.categorie).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select style={{ width: 'auto', maxWidth: 320 }} value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })} aria-label="Fonte"><option value="">Tutte le fonti</option>{(d.data?.fonti || []).filter((x) => !f.categoria || x.categoria === f.categoria).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
        <select style={{ width: 'auto' }} value={f.utilita} onChange={(e) => setF({ ...f, utilita: e.target.value })} aria-label="Utilità"><option value="">Ogni utilità</option><option value="ALTA">Utilità alta</option><option value="MEDIA">Utilità media</option><option value="BASSA">Utilità bassa</option></select>
        <label className="small muted">Dal <input type="date" value={f.dal} onChange={(e) => setF({ ...f, dal: e.target.value })} style={{ width: 'auto' }} aria-label="Dal giorno" /></label>
        <SearchInput value={f.cerca} onChange={(v) => setF({ ...f, cerca: v })} placeholder="Cerca nel titolo o nella sintesi" />
      </div>
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : !righe.length ? <Card><Empty icon="folder" title="Nessuna voce con questi filtri" /></Card> : (
        <Card flush title={`${righe.length}${righe.length >= 600 ? ' (le prime 600)' : ''} voci`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th style={{ width: 110 }}>Data</th><th>Voce</th><th style={{ width: 130 }}>Utilità</th></tr></thead>
            <tbody>{righe.map((v) => (
              <tr key={v.id}>
                <td>{v.pubblicata ? itData(v.pubblicata) : v.scadenza ? <span title="Data di pubblicazione non riportata dall'elenco">scad. {itData(v.scadenza)}</span> : <span className="faint">non indicata</span>}</td>
                <td><a href={v.url} target="_blank" rel="noreferrer"><b>{v.titolo}</b></a>
                  <div className="small muted">{v.fonte}{v.pubblicata && v.scadenza ? ` · scadenza ${itData(v.scadenza)}` : ''}{!v.preesistente ? ' · rilevata come novità' : ''}</div>
                  {v.sintesi && <div className="small">{v.sintesi}</div>}{v.motivo && <div className="small muted">Perché: {v.motivo}</div>}</td>
                <td>{v.utilita ? <Badge tone={TONO[v.utilita]}>{v.utilita.toLowerCase()}</Badge> : <Badge tone="grey">{v.ai_stato === 'DA_VALUTARE' ? 'in valutazione' : 'non valutata'}</Badge>}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>)}
    </div>
  );
}
