// Business Hub · DB Opportunità: la vista navigabile del file del CEO con TUTTE le 49 colonne (più Linea e Cliente attivo), costruita dagli
// account (dati vivi della Suite). Ricerca, filtro per colonna (elenco dei valori quando sono pochi), ordinamento, colonne nascondibili
// (ricordate nel browser), export XLSX e PDF su carta intestata TD della selezione corrente (righe filtrate nell'ordine mostrato).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scarica } from '../api.js';
import { useApi, Loading, ErrorBox, Icon, Modal, useToast } from '../components/ui.jsx';

const LS = 'business.dbopp.nascoste';
const leggiNascoste = () => { try { return new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch { return new Set(); } };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const itData = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : s);
function testo(c, v) {
  if (v == null || v === '') return '';
  if (c.t === 'd') return itData(v);
  if (c.k === 'sconto_medio' && typeof v === 'number') return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(v * 100)}%`;
  if (c.t === 'n' && typeof v === 'number') return new Intl.NumberFormat('it-IT', { maximumFractionDigits: c.k === 'prezzo_medio_esame' ? 2 : 0, useGrouping: 'always' }).format(v);
  return String(v);
}

export default function Opportunita() {
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi('/hub/opportunita');
  const [cerca, setCerca] = useState('');
  const [filtri, setFiltri] = useState({});
  const [sort, setSort] = useState({ k: 'ragione_sociale', dir: 1 });
  const [nascoste, setNascoste] = useState(leggiNascoste);
  const [scegli, setScegli] = useState(false);
  const [busy, setBusy] = useState('');
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify([...nascoste])); } catch { /* archivio del browser non disponibile */ } }, [nascoste]);
  const colonne = q.data?.colonne || [];
  const visibili = colonne.filter((c) => !nascoste.has(c.k));
  // valori distinti per le colonne con pochi valori: filtro a tendina
  const distinti = useMemo(() => {
    const out = {};
    for (const c of colonne) { const s = new Set((q.data?.righe || []).map((r) => testo(c, r[c.k])).filter(Boolean)); if (s.size > 0 && s.size <= 25 && c.t !== 'd') out[c.k] = [...s].sort(); }
    return out;
  }, [q.data]);
  const righe = useMemo(() => {
    const t = norm(cerca);
    const l = (q.data?.righe || []).filter((r) => (!t || colonne.some((c) => norm(testo(c, r[c.k])).includes(t)))
      && Object.entries(filtri).every(([k, v]) => { if (!v) return true; const c = colonne.find((x) => x.k === k); const x = testo(c, r[k]); return distinti[k] ? (v === '∅' ? !x : x === v) : norm(x).includes(norm(v)); }));
    const c = colonne.find((x) => x.k === sort.k);
    return [...l].sort((a, b) => {
      const x = a[sort.k]; const y = b[sort.k];
      if ((x == null || x === '') && (y == null || y === '')) return 0; if (x == null || x === '') return 1; if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : c?.k === 'id' ? Number(String(x).split(',')[0]) - Number(String(y).split(',')[0]) : String(x).localeCompare(String(y), 'it')) * sort.dir;
    });
  }, [q.data, cerca, filtri, sort, distinti]);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const descr = [cerca && `ricerca "${cerca}"`, ...Object.entries(filtri).filter(([, v]) => v).map(([k, v]) => `${colonne.find((c) => c.k === k)?.h}: ${v}`)].filter(Boolean).join(' · ');
  const esporta = async (formato) => {
    setBusy(formato);
    try { const n = await scarica('/hub/opportunita/export', { formato, ids: righe.map((r) => r._id), colonne: visibili.map((c) => c.k), filtri: descr || undefined }, `DB_Opportunita.${formato}`); toast(`Scaricato ${n}`); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const nFiltri = Object.values(filtri).filter(Boolean).length;
  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>DB Opportunità</h1><div className="sub">Il DB Opportunità B2B Laboratorio del CEO, navigabile: {righe.length} di {q.data.righe.length} righe · {visibili.length} di {colonne.length} colonne. Fasi, owner e prossime azioni sono quelli registrati nel Business Hub; Fase Attuale, Ultimo avanzamento, Giorni e Alert stallo si ricalcolano.</div></div>
        <div className="row">
          <button className="btn ghost" onClick={() => setScegli(true)}><Icon name="eye" />Colonne</button>
          <button className="btn ghost" disabled={Boolean(busy) || !righe.length} onClick={() => esporta('xlsx')}><Icon name="download" />{busy === 'xlsx' ? 'Preparo…' : 'XLSX'}</button>
          <button className="btn" disabled={Boolean(busy) || !righe.length} onClick={() => esporta('pdf')}><Icon name="print" />{busy === 'pdf' ? 'Preparo…' : 'PDF'}</button>
        </div>
      </div>
      <div className="filters">
        <label className="f" style={{ flex: 1, minWidth: 260 }}>Cerca in tutte le colonne<input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Nome, città, fornitore, note…" /></label>
        {(nFiltri > 0 || cerca) && <button className="btn sm ghost" style={{ alignSelf: 'center' }} onClick={() => { setFiltri({}); setCerca(''); }}>Azzera {nFiltri ? `${nFiltri} filtri` : 'la ricerca'}</button>}
        <div className="small muted" style={{ alignSelf: 'center' }}>Clic sull'intestazione per ordinare · la seconda riga filtra la colonna · clic sulla riga per aprire l'account</div>
      </div>
      <div className="card"><div className="table-wrap dbopp" style={{ maxHeight: 'calc(100vh - 270px)' }}>
        <table className="t">
          <thead>
            <tr>{visibili.map((c) => <th key={c.k} className={`sortable ${c.t === 'n' || c.t === 'i' ? 'num' : ''} ${c.suite ? 'suite' : ''}`} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? -s.dir : 1 }))} title={c.suite ? 'Colonna della Suite (non nel file)' : c.h}>{c.h}{sort.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr>
            <tr className="fil">{visibili.map((c) => <th key={c.k}>{distinti[c.k]
              ? <select value={filtri[c.k] || ''} onChange={(e) => setFiltri({ ...filtri, [c.k]: e.target.value })}><option value="">tutti</option><option value="∅">(vuoto)</option>{distinti[c.k].map((v) => <option key={v}>{v}</option>)}</select>
              : <input value={filtri[c.k] || ''} onChange={(e) => setFiltri({ ...filtri, [c.k]: e.target.value })} placeholder="filtra" />}</th>)}</tr>
          </thead>
          <tbody>
            {righe.map((r) => (
              <tr key={r._id} className="click" onClick={() => nav(`/business/account/${r._id}`)}>
                {visibili.map((c) => <td key={c.k} className={`${c.t === 'n' || c.t === 'i' ? 'num' : ''} ${c.k === 'ragione_sociale' ? 'strong' : ''} ${c.k === 'alert_stallo' && r[c.k] ? 'red strong' : ''}`} title={String(r[c.k] ?? '')}>{testo(c, r[c.k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {scegli && <Modal wide title="Colonne visibili" onClose={() => setScegli(false)} footer={<><button className="btn ghost" onClick={() => setNascoste(new Set())}>Mostra tutte</button><button className="btn ghost" onClick={() => setNascoste(new Set(colonne.filter((c) => !['id', 'ragione_sociale', 'citta', 'prov', 'tipologia', 'priorita', 'fase_attuale', 'fatturato_fy_atteso', 'owner'].includes(c.k)).map((c) => c.k)))}>Solo le principali</button><button className="btn" onClick={() => setScegli(false)}>Fatto</button></>}>
        <div className="colsel">{colonne.map((c) => <label key={c.k} className="f inline"><input type="checkbox" checked={!nascoste.has(c.k)} onChange={(e) => { const n = new Set(nascoste); if (e.target.checked) n.delete(c.k); else n.add(c.k); setNascoste(n); }} />{c.h}{c.suite ? <span className="small muted"> (Suite)</span> : ''}</label>)}</div>
        <div className="small muted" style={{ marginTop: 10 }}>L'export XLSX e PDF contiene le colonne visibili e le righe filtrate, nell'ordine mostrato.</div>
      </Modal>}
    </div>
  );
}
