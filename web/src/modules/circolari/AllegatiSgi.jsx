// Documenti del SGI agganciati alla circolare (v0.98.0): si cercano per codice o titolo nel portale SGI della Suite; al PDF della
// circolare vengono uniti in coda, nell'ordine dell'elenco. Dopo l'anteprima si vede quali sono stati uniti.
import React, { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { api } from './api.js';

export default function AllegatiSgi({ value, onChange, esito = null, max = 12 }) {
  const lista = Array.isArray(value) ? value : [];
  const [q, setQ] = useState(''); const [ris, setRis] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRis(null); return undefined; }
    const t = setTimeout(async () => { setBusy(true); try { setRis(await api.get(`/sgi-documenti?q=${encodeURIComponent(q.trim())}`)); } catch { setRis({ disponibile: false, righe: [] }); } finally { setBusy(false); } }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const ha = (code) => lista.some((a) => a.code === code);
  const aggiungi = (d) => { if (!ha(d.code) && lista.length < max) onChange([...lista, { code: d.code, titolo: d.titolo, file: d.file }]); };
  const togli = (code) => onChange(lista.filter((a) => a.code !== code));
  const sposta = (i, d) => { const l = [...lista]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; onChange(l); };
  const esitoDi = (code) => (Array.isArray(esito) ? esito.find((x) => x.code === code) : null);
  return (
    <div className="circ-sgi">
      {lista.map((a, i) => { const e = esitoDi(a.code); return (
        <div key={a.code} className="circ-sgi-riga">
          <Icon name="pdf" />
          <div className="circ-sgi-testo"><b>{a.code}</b> {a.titolo && a.titolo !== a.code ? a.titolo : ''}
            {e && <div className={`small ${e.ok ? 'muted' : 'circ-rosso'}`}>{e.ok ? `Unito al PDF all'ultima anteprima (${e.pagine} ${e.pagine === 1 ? 'pagina' : 'pagine'})` : `Non unito al PDF: ${e.errore}`}</div>}</div>
          <a className="btn sm ghost" href={`/api/sgi/file/${a.file.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noreferrer" title="Apri il documento">Apri</a>
          <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => sposta(i, -1)} aria-label="Sposta prima"><Icon name="arrowUp" /></button>
          <button type="button" className="btn sm ghost" disabled={i === lista.length - 1} onClick={() => sposta(i, 1)} aria-label="Sposta dopo"><Icon name="arrowDown" /></button>
          <button type="button" className="btn sm ghost" onClick={() => togli(a.code)} aria-label="Togli l'allegato"><Icon name="trash" /></button>
        </div>); })}
      {!lista.length && <div className="small muted">Nessun documento del SGI agganciato.</div>}
      {lista.length < max && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nel SGI per codice o titolo: DEX005, catena di custodia…" aria-label="Cerca un documento del SGI" />}
      {busy && <div className="small muted">Cerco…</div>}
      {ris && !ris.disponibile && <div className="small circ-rosso">Il portale SGI della Suite non è caricato: gli allegati non si possono scegliere da qui.</div>}
      {ris?.disponibile && !ris.righe.length && <div className="small muted">Nessun documento trovato.</div>}
      {ris?.righe?.length > 0 && <div className="circ-sgi-ris">{ris.righe.map((d) => (
        <button key={d.code} type="button" className="circ-sgi-voce" disabled={ha(d.code)} onClick={() => aggiungi(d)}>
          <span><b>{d.code}</b> {d.titolo !== d.code ? d.titolo : ''}</span><span className="small muted">{ha(d.code) ? 'già agganciato' : d.stampabile ? 'versione stampabile' : 'documento completo'}</span>
        </button>))}</div>}
    </div>
  );
}
