import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, API_BASE, BASE, qs } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Card, Badge, Icon, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime, SITE_KIND, ORG_KIND } from '../format.js';

// 0b · Dotazione di avvio sedi (richiesta del CEO, 31/10/2026): dopo il Magazzino Centrale, l'impostazione del materiale di
// start up di ogni struttura. Due schede: Modelli per tipologia (elenco completo del materiale per Punto Prelievi, Centro
// Polidiagnostico, Laboratorio di Analisi, Cliente service / Legal entity) e Sedi (sedi dell'anagrafica e Legal entity con data di
// effettiva apertura e stato della dotazione: la scheda della singola struttura registra la Giacenza 0).
export const TIPOLOGIE = [
  { kind: 'PUNTO_PRELIEVI', name: 'Punto Prelievi' },
  { kind: 'POLIDIAGNOSTICO', name: 'Centro Polidiagnostico' },
  { kind: 'LABORATORIO', name: 'Laboratorio di Analisi' },
  { kind: 'SERVICE', name: 'Cliente service / Legal entity' },
];
export const STATO_DOTAZIONE = { NON_PIANIFICATA: { label: 'Non pianificata', tone: 'grey' }, PIANIFICATA: { label: 'Pianificata', tone: 'blue' }, CONSEGNATA: { label: 'Consegnata · Giacenza 0', tone: 'green' } };
export const giorniLabel = (g) => (g == null ? '' : g > 0 ? `fra ${g} giorni` : g === 0 ? 'oggi' : `aperta da ${-g} giorni`);

// Ricerca di un articolo attivo del catalogo Silva per codice o descrizione, con la grafica dell'articolo
export function ArticlePicker({ onPick, exclude = [], placeholder = 'Aggiungi articolo: codice o descrizione' }) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { api.get(`/dotazione/articoli${qs({ q: term.trim() })}`, { silent: true }).then((r) => alive && setRows(r)).catch(() => {}); }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [term]);
  const ex = new Set(exclude);
  const list = rows.filter((a) => !ex.has(a.id));
  return (
    <div style={{ position: 'relative', maxWidth: 520, flex: 1 }}>
      <input value={term} placeholder={placeholder} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} />
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 340, overflowY: 'auto', boxShadow: '0 10px 30px rgba(1,33,44,.18)' }}>
          {!list.length ? <div className="empty small">Nessun articolo attivo del catalogo Silva</div> : list.map((a) => (
            <button key={a.id} type="button" className="row" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(a); setTerm(''); setOpen(false); }}
              style={{ gap: 10, flexWrap: 'nowrap', width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)', padding: '6px 10px', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
              <ProductArt icon={a.icon} color={a.color} size={30} />
              <div><div className="strong small">{a.article_name}</div><div className="small muted">{a.pack_label} · <span className="mono">{a.silva_code || a.article_code}</span> · {a.category_name}</div></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dotazione() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'sedi' ? 'sedi' : 'modelli';
  return (
    <div className="page">
      <PhaseBanner n="0b" title="Dotazione di avvio sedi" desc="Il materiale di start up di ogni sede: un modello per tipologia (Punto Prelievi, Centro Polidiagnostico, Laboratorio di Analisi, Cliente service / Legal entity), poi per la singola sede o Legal entity il piano, l'eventuale ordine al Magazzino Centrale e la Giacenza 0, che apre la giacenza della struttura." next="Fase 1: le strutture ordinano dal catalogo" />
      <div className="tabs">
        <button className={tab === 'modelli' ? 'on' : ''} onClick={() => setSp({})}>Modelli per tipologia</button>
        <button className={tab === 'sedi' ? 'on' : ''} onClick={() => setSp({ tab: 'sedi' })}>Sedi e Legal entity</button>
      </div>
      {tab === 'modelli' ? <Modelli /> : <Sedi />}
    </div>
  );
}

function Modelli() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const kind = TIPOLOGIE.some((t) => t.kind === sp.get('kind')) ? sp.get('kind') : 'PUNTO_PRELIEVI';
  const elenco = useApi('/dotazione/modelli');
  const { data, reload } = useApi(`/dotazione/modelli/${kind}`, [kind]);
  const [err, setErr] = useState(null);
  const [copy, setCopy] = useState(null);
  const [edits, setEdits] = useState({});
  useEffect(() => setEdits({}), [kind, data]);
  const refresh = () => { reload(); elenco.reload(); };
  const run = async (fn, msg) => { setErr(null); try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { setErr(e); } };
  const add = (a) => run(() => api.post(`/dotazione/modelli/${kind}/righe`, { article_id: a.id, packs: 1 }), `${a.article_name} aggiunto`);
  const saveLine = (l, patch) => run(() => api.put(`/dotazione/modelli/${kind}/righe/${l.id}`, patch));
  const val = (l, k) => (edits[l.id]?.[k] ?? l[k] ?? '');
  const setVal = (l, k, v) => setEdits((e) => ({ ...e, [l.id]: { ...e[l.id], [k]: v } }));
  const commit = (l, k) => { const v = edits[l.id]?.[k]; if (v === undefined || String(v) === String(l[k] ?? '')) return; if (k === 'packs' && !(Number(v) > 0)) return setErr(new Error('Le confezioni devono essere almeno 1')); saveLine(l, { [k]: k === 'packs' ? Number(v) : v }); };
  const tip = TIPOLOGIE.find((t) => t.kind === kind);
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {TIPOLOGIE.map((t) => { const m = (elenco.data || []).find((x) => x.kind === t.kind); return (
          <button key={t.kind} className={`card kpi ${t.kind === kind ? 'accent' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setSp({ kind: t.kind })}>
            <div className="lbl">{t.name}</div><div className="val">{m ? m.packs : '–'}</div><div className="foot">{m ? `${m.lines} articoli · confezioni` : ''}</div>
          </button>); })}
      </div>
      <ErrorBox error={err} />
      <Card title={`Modello · ${tip.name}`} flush actions={<div className="row">
        <button className="btn ghost sm" onClick={() => setCopy({ from: TIPOLOGIE.find((t) => t.kind !== kind).kind, mode: 'AGGIUNGI' })}><Icon name="list" size={15} />Copia da un'altra tipologia</button>
        <a className="btn ghost sm" href={`${API_BASE}/dotazione/modelli/${kind}/export.xlsx`}><Icon name="download" size={15} />XLSX</a>
      </div>}>
        <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <ArticlePicker onPick={add} exclude={(data?.lines || []).map((l) => l.article_id)} />
          {data && <div className="small muted">{data.totali.articoli} articoli · {data.totali.pianificate} confezioni{data.updated_by_name ? ` · aggiornato da ${data.updated_by_name} il ${itDateTime(data.updated_at)}` : ''}</div>}
        </div>
        {!data ? <Loading /> : !data.lines.length ? <div className="empty">Modello vuoto: aggiungi gli articoli del catalogo Silva con la ricerca qui sopra, oppure copiali da un'altra tipologia.</div> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Articolo</th><th>Codice Silva</th><th className="num" style={{ width: 110 }}>Confezioni</th><th>Note</th><th /></tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id} className={!l.article_active ? 'warnrow' : ''}>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={l.icon} color={l.color} size={34} /><div><div className="strong">{l.article_name}{!l.article_active && <> <Badge tone="red">disattivato</Badge></>}</div><div className="small muted">{l.pack_label} · {l.category_name}</div></div></div></td>
                <td className="mono small">{l.silva_code || l.article_code}</td>
                <td className="num"><input className="qin" inputMode="numeric" value={val(l, 'packs')} onChange={(e) => setVal(l, 'packs', e.target.value.replace(/\D/g, ''))} onBlur={() => commit(l, 'packs')} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></td>
                <td><input value={val(l, 'note')} placeholder="Note" onChange={(e) => setVal(l, 'note', e.target.value)} onBlur={() => commit(l, 'note')} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></td>
                <td className="num"><button className="btn sm ghost danger" title="Togli dal modello" onClick={() => run(() => api.del(`/dotazione/modelli/${kind}/righe/${l.id}`), `${l.article_name} tolto dal modello`)}>Togli</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {copy && (
        <Modal title={`Copia nel modello ${tip.name}`} onClose={() => setCopy(null)} footer={<><button className="btn ghost" onClick={() => setCopy(null)}>Annulla</button><button className="btn" onClick={async () => { setErr(null); try { const r = await api.post(`/dotazione/modelli/${kind}/copia`, copy); toast(`${r.copiate} articoli copiati`); setCopy(null); refresh(); } catch (e) { setErr(e); } }}>Copia</button></>}>
          <div className="form-grid">
            <Field label="Da tipologia"><select value={copy.from} onChange={(e) => setCopy({ ...copy, from: e.target.value })}>{TIPOLOGIE.filter((t) => t.kind !== kind).map((t) => <option key={t.kind} value={t.kind}>{t.name}</option>)}</select></Field>
            <Field label="Modalità"><select value={copy.mode} onChange={(e) => setCopy({ ...copy, mode: e.target.value })}><option value="AGGIUNGI">Aggiungi gli articoli mancanti</option><option value="SOSTITUISCI">Sostituisci tutto il modello</option></select></Field>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Si copiano articoli, confezioni e note; gli articoli già presenti non cambiano (in "Aggiungi").</div>
        </Modal>
      )}
    </>
  );
}

function Sedi() {
  const toast = useToast();
  const { data, reload } = useApi('/dotazione/sedi');
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('TUTTE');
  const [tipo, setTipo] = useState('');
  const rows = useMemo(() => (data?.rows || []).filter((s) => (filter === 'TUTTE' || (filter === 'ATTENZIONE' ? s.attenzione : s.stato === filter)) && (!tipo || s.tipologia === tipo)), [data, filter, tipo]);
  const setData = async (s, v) => {
    setErr(null);
    try { await api.put(`/dotazione/sedi/${s.id}/apertura`, { opened_at: v || null }); toast(`${s.name}: ${s.origin === 'ORG' ? 'data di avvio' : 'data di apertura'} ${v ? itDate(v) : 'tolta'}`); reload(); window.dispatchEvent(new Event('suite:badges')); } catch (e) { setErr(e); }
  };
  const count = (st) => (data?.rows || []).filter((s) => s.stato === st).length;
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card kpi accent"><div className="lbl">Da attenzionare</div><div className="val" style={{ color: data?.badge ? 'var(--red)' : undefined }}>{data?.badge ?? '–'}</div><div className="foot">apertura entro 60 giorni o già aperte, senza Giacenza 0</div></div>
        <div className="card kpi"><div className="lbl">Non pianificate</div><div className="val">{data ? count('NON_PIANIFICATA') : '–'}</div></div>
        <div className="card kpi"><div className="lbl">Pianificate</div><div className="val">{data ? count('PIANIFICATA') : '–'}</div></div>
        <div className="card kpi"><div className="lbl">Consegnate</div><div className="val">{data ? count('CONSEGNATA') : '–'}</div><div className="foot">Giacenza 0 registrata</div></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Field label="Mostra"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="TUTTE">Tutte</option><option value="ATTENZIONE">Da attenzionare</option>{Object.entries(STATO_DOTAZIONE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Tipologia"><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Tutte</option>{TIPOLOGIE.map((t) => <option key={t.kind} value={t.kind}>{t.name}</option>)}</select></Field>
        <div className="small muted" style={{ alignSelf: 'flex-end', maxWidth: 520 }}>Sedi e Legal entity vengono dall'anagrafica (Amministrazione › Sedi e › Legal entity). La data di apertura della sede è quella dell'anagrafica e si può correggere qui; per la Legal entity è la data di avvio del rapporto.</div>
      </div>
      <ErrorBox error={err} />
      <Card flush>
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Struttura</th><th>Tipologia</th><th>Città</th><th>Data di effettiva apertura</th><th>Stato della dotazione</th><th className="num">Confezioni</th><th>Ordine</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={s.attenzione ? 'warnrow' : ''}>
                <td><Link className="strong" to={`${BASE}/dotazione/sedi/${s.id}`}>{s.name}</Link><div className="small muted">{s.origin === 'ORG' ? <>Legal entity · {ORG_KIND[s.org_kind] || s.org_kind}</> : <>Sede · {SITE_KIND[s.site_kind] || s.site_kind}</>} · <span className="mono">{s.code}</span></div></td>
                <td className="small">{s.tipologia_name}</td>
                <td className="small">{s.city || '–'}</td>
                <td><input type="date" value={s.opened_at || ''} onChange={(e) => setData(s, e.target.value)} style={{ maxWidth: 160 }} title={s.origin === 'ORG' ? 'Data di avvio del rapporto' : 'Scrive la data di apertura in anagrafica (public.sites)'} />
                  <div className="small muted">{giorniLabel(s.giorni)}{s.attenzione && <> <Badge tone="red">senza Giacenza 0</Badge></>}</div></td>
                <td><Badge tone={STATO_DOTAZIONE[s.stato].tone}>{STATO_DOTAZIONE[s.stato].label}</Badge>{s.delivered_at && <div className="small muted">{itDate(s.delivered_at)}</div>}</td>
                <td className="num strong">{s.stato === 'CONSEGNATA' ? s.packs_delivered : s.packs_planned || <span className="muted">–</span>}</td>
                <td className="small">{s.order_id ? <Link to={`${BASE}/ordini/${s.order_id}`}>{s.order_number}</Link> : <span className="muted">–</span>}</td>
                <td className="num"><Link className="btn sm ghost" to={`${BASE}/dotazione/sedi/${s.id}`}>Apri</Link></td>
              </tr>))}</tbody>
          </table>{!rows.length && <div className="empty">Nessuna struttura per questo filtro</div>}</div>
        )}
      </Card>
    </>
  );
}
