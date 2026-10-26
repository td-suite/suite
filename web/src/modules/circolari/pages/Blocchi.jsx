// Editor dei blocchi del corpo: titolo di sezione, paragrafo, elenco, tabella. Ordine modificabile, aggiunta e rimozione.
import React from 'react';
import { Icon } from '../../../components/Icons.jsx';
import { BLOCCHI } from '../format.js';

const NEW = { titolo: () => ({ type: 'titolo', text: '' }), paragrafo: () => ({ type: 'paragrafo', text: '' }), elenco: () => ({ type: 'elenco', items: [''] }), tabella: () => ({ type: 'tabella', colonne: ['Colonna 1', 'Colonna 2', 'Colonna 3'], righe: [['', '', '']] }) };

export default function Blocchi({ value = [], onChange, readOnly }) {
  const set = (i, b) => onChange(value.map((x, j) => (j === i ? b : x)));
  const del = (i) => onChange(value.filter((_, j) => j !== i));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= value.length) return; const a = [...value]; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  const add = (type, at) => { const a = [...value]; a.splice(at ?? a.length, 0, NEW[type]()); onChange(a); };
  if (readOnly) return <Lettura blocchi={value} />;
  return (
    <div className="circ-blocchi">
      {value.map((b, i) => (
        <div key={i} className={`circ-blocco ${b.type}`}>
          <div className="bh">
            <span className="tipo">{BLOCCHI[b.type] || b.type}</span><span className="spacer" />
            <button type="button" className="iconbtn" title="Sposta su" aria-label="Sposta su" onClick={() => move(i, -1)} disabled={i === 0}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} /></button>
            <button type="button" className="iconbtn" title="Sposta giù" aria-label="Sposta giù" onClick={() => move(i, 1)} disabled={i === value.length - 1}><Icon name="chevron" /></button>
            <button type="button" className="iconbtn" title="Elimina" aria-label="Elimina" onClick={() => del(i)}><Icon name="trash" /></button>
          </div>
          {b.type === 'titolo' && <input value={b.text} onChange={(e) => set(i, { ...b, text: e.target.value })} placeholder="1. Titolo di sezione" maxLength={200} />}
          {b.type === 'paragrafo' && <textarea value={b.text} onChange={(e) => set(i, { ...b, text: e.target.value })} placeholder="Testo del paragrafo" />}
          {b.type === 'elenco' && (
            <div className="grid" style={{ gap: 6 }}>
              {b.items.map((it, k) => <div key={k} className="row tight"><span className="muted">–</span><input style={{ flex: 1 }} value={it} onChange={(e) => set(i, { ...b, items: b.items.map((x, m) => (m === k ? e.target.value : x)) })} placeholder="Voce dell'elenco" maxLength={800} /><button type="button" className="iconbtn" aria-label="Togli voce" onClick={() => set(i, { ...b, items: b.items.filter((_, m) => m !== k) })}><Icon name="x" /></button></div>)}
              <div><button type="button" className="btn sm ghost" onClick={() => set(i, { ...b, items: [...b.items, ''] })}><Icon name="plus" />Voce</button></div>
            </div>
          )}
          {b.type === 'tabella' && <Tabella b={b} onChange={(nb) => set(i, nb)} />}
        </div>
      ))}
      <div className="circ-add">
        <span className="small muted" style={{ alignSelf: 'center' }}>Aggiungi:</span>
        {Object.entries(BLOCCHI).map(([k, v]) => <button key={k} type="button" className="btn sm ghost" onClick={() => add(k)}><Icon name="plus" />{v}</button>)}
      </div>
    </div>
  );
}

function Tabella({ b, onChange }) {
  const n = b.colonne.length;
  const setCol = (k, v) => onChange({ ...b, colonne: b.colonne.map((x, m) => (m === k ? v : x)) });
  const setCell = (r, k, v) => onChange({ ...b, righe: b.righe.map((row, rr) => (rr === r ? row.map((x, m) => (m === k ? v : x)) : row)) });
  const addRow = () => onChange({ ...b, righe: [...b.righe, Array(n).fill('')] });
  const delRow = (r) => onChange({ ...b, righe: b.righe.filter((_, rr) => rr !== r) });
  const addCol = () => onChange({ ...b, colonne: [...b.colonne, `Colonna ${n + 1}`], righe: b.righe.map((row) => [...row, '']) });
  const delCol = () => n > 1 && onChange({ ...b, colonne: b.colonne.slice(0, -1), righe: b.righe.map((row) => row.slice(0, -1)) });
  return (
    <div>
      <div className="circ-tab"><table>
        <thead><tr>{b.colonne.map((c, k) => <th key={k}><input value={c} onChange={(e) => setCol(k, e.target.value)} maxLength={120} /></th>)}<th style={{ width: 34 }} /></tr></thead>
        <tbody>{b.righe.map((row, r) => <tr key={r}>{b.colonne.map((_, k) => <td key={k}><input value={row[k] ?? ''} onChange={(e) => setCell(r, k, e.target.value)} maxLength={400} /></td>)}<td><button type="button" className="iconbtn" aria-label="Togli riga" onClick={() => delRow(r)}><Icon name="x" /></button></td></tr>)}</tbody>
      </table></div>
      <div className="row tight" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm ghost" onClick={addRow}><Icon name="plus" />Riga</button>
        <button type="button" className="btn sm ghost" onClick={addCol}><Icon name="plus" />Colonna</button>
        <button type="button" className="btn sm ghost" onClick={delCol} disabled={n <= 1}>Togli ultima colonna</button>
        <span className="small muted">{n > 5 ? 'Più di 5 colonne: la circolare va in orizzontale (se orientamento automatico).' : ''}</span>
      </div>
    </div>
  );
}

export function Lettura({ blocchi }) {
  return (
    <div className="circ-lettura">
      {(blocchi || []).map((b, i) => b.type === 'titolo' ? <h3 key={i} style={{ margin: '14px 0 4px' }}>{b.text}</h3>
        : b.type === 'paragrafo' ? <p key={i} style={{ margin: '0 0 8px' }}>{b.text}</p>
        : b.type === 'elenco' ? <ul key={i} style={{ margin: '0 0 8px 18px' }}>{b.items.map((x, k) => <li key={k}>{x}</li>)}</ul>
        : b.type === 'tabella' ? <div key={i} className="table-wrap" style={{ margin: '6px 0 10px' }}><table className="t"><thead><tr>{b.colonne.map((c, k) => <th key={k}>{c}</th>)}</tr></thead><tbody>{b.righe.map((r, rr) => <tr key={rr}>{b.colonne.map((_, k) => <td key={k} className="small">{r[k]}</td>)}</tr>)}</tbody></table></div>
        : null)}
    </div>
  );
}
