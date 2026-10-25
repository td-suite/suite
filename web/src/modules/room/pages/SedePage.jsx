import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Loading, ErrorBox, useToast, Modal, Badge } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { Struttura, clone, DEF_C } from '../planner/planner.jsx';
import { split, sedeLabel, ADMIN_SITES } from './Sedi.jsx';
import { diffStrutture } from '../lib/network.js';

const SAVE_DELAY = 1500;
const POLL_MS = 30000;

export default function SedePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [str, setStr] = useState(null);
  const [meta, setMeta] = useState({ version: 0, updatedAt: null, updatedBy: '', canEdit: false, deletedAt: null, configurata: true });
  const [brand, setBrand] = useState({ logo: null, c: DEF_C });
  const [status, setStatus] = useState('idle'); // idle | dirty | saving | error
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState(null);
  const [cmp, setCmp] = useState({ a: null, b: null, rows: null, busy: false });
  const base = useRef(null);        // ultimo stato salvato: {lite: json string, blobs:{logo,planPdf,planImg}}
  const strRef = useRef(null); strRef.current = str;
  const metaRef = useRef(meta); metaRef.current = meta;
  const timer = useRef(null);
  const pdfLoaded = useRef(false);

  const load = useCallback(async () => {
    const r = await api.get(`/strutture/${id}`);
    const s = r.struttura;
    base.current = { lite: JSON.stringify(split(s).lite), blobs: { logo: s.logo || null, planPdf: undefined, planImg: s.plan.imgUrl || null } };
    setMeta({ version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy, canEdit: r.canEdit, deletedAt: r.deletedAt, hasPlanPdf: r.hasPlanPdf, configurata: r.configurata, active: r.active });
    setStr(s); setStatus('idle');
    pdfLoaded.current = false;
    if (r.hasPlanPdf) {
      api.get(`/strutture/${id}/blob/planPdf`, { silent: true }).then((b) => {
        if (!b.data) return;
        base.current.blobs.planPdf = b.data; pdfLoaded.current = true;
        setStr((st) => (st && !st.plan.dataUrl ? { ...st, plan: { ...st.plan, dataUrl: b.data } } : st));
      }).catch(() => {});
    } else { base.current.blobs.planPdf = null; pdfLoaded.current = true; }
  }, [id]);

  useEffect(() => {
    setStr(null); setErr(null);
    load().catch((e) => setErr(e));
    api.get('/settings', { silent: true }).then((s) => s.brand?.c && setBrand({ logo: null, c: { ...DEF_C, ...s.brand.c } })).catch(() => {});
  }, [load]);

  // Differenze rispetto all'ultimo salvataggio
  const diff = useCallback((s) => {
    if (!s || !base.current) return null;
    const { lite, blobs } = split(s);
    const liteJson = JSON.stringify(lite);
    const changedBlobs = {};
    for (const k of ['logo', 'planImg', 'planPdf']) {
      const b = base.current.blobs[k];
      if (b === undefined) continue;                     // non ancora caricato dal server: non toccare
      if ((blobs[k] || null) !== (b || null)) changedBlobs[k] = blobs[k] || null;
    }
    const dirty = liteJson !== base.current.lite || Object.keys(changedBlobs).length > 0;
    return { dirty, lite, liteJson, blobs, changedBlobs };
  }, []);

  const save = useCallback(async () => {
    const s = strRef.current; const d = diff(s);
    if (!d || !d.dirty || !metaRef.current.canEdit) return;
    setStatus('saving');
    try {
      const r = await api.put(`/strutture/${id}`, { data: d.lite, version: metaRef.current.version, blobs: d.changedBlobs }, { silent: true });
      base.current = { lite: d.liteJson, blobs: { ...base.current.blobs, ...Object.fromEntries(Object.entries(d.changedBlobs)) } };
      setMeta((m) => ({ ...m, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy }));
      setStatus(diff(strRef.current)?.dirty ? 'dirty' : 'idle');
    } catch (e) {
      setStatus('error');
      if (e.code === 'VERSION_CONFLICT') {
        toast(`${e.message}. Ricarico la versione più recente: ripeti le tue ultime modifiche.`, 'err');
        await load();
      } else toast(`Salvataggio non riuscito: ${e.message}`, 'err');
    }
  }, [id, diff, load, toast]);

  // salvataggio automatico
  useEffect(() => {
    if (!str) return;
    const d = diff(str);
    if (!d?.dirty) return;
    if (!meta.canEdit) return;
    setStatus((st) => (st === 'saving' ? st : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
    return () => clearTimeout(timer.current);
  }, [str, diff, save, meta.canEdit]);

  useEffect(() => {
    const h = (e) => { if (status === 'dirty' || status === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [status]);
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(timer.current); save(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [save]);

  // modifiche dei colleghi: ogni 30 s controlla la versione; se non ho modifiche in sospeso ricarico
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/strutture/${id}`, { silent: true });
        if (r.version !== metaRef.current.version) {
          if (diff(strRef.current)?.dirty) toast(`${r.updatedBy || 'Un collega'} ha salvato questa sede: le tue modifiche verranno segnalate in conflitto al salvataggio`, 'err');
          else { await load(); toast(`Sede aggiornata da ${r.updatedBy || 'un collega'}`); }
        }
      } catch { /* offline: riprova al prossimo giro */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [id, diff, load, toast]);

  const upd = useCallback((fn) => {
    if (!metaRef.current.canEdit) { toast('Profilo in sola consultazione: le modifiche non vengono salvate', 'err'); return; }
    setStr((st) => { const nx = clone(st); fn(nx); return nx; });
  }, [toast]);

  // La sede resta nell'anagrafica unica: qui si rimuove solo la configurazione Room (ambulatori, personale, planimetria, cronologia)
  const del = async () => {
    if (window.prompt(`Rimuovere la configurazione Room Planning di "${sedeLabel(str)}" (ambulatori, personale pianificato, planimetria e cronologia)? La sede resta nell'anagrafica della Suite. Scrivi DEFINITIVO per confermare.`) !== 'DEFINITIVO') return;
    try { await api.del(`/strutture/${id}?confirm=DEFINITIVO`); toast('Configurazione rimossa'); nav(`${base}/sedi`); } catch (e) { toast(e.message, 'err'); }
  };
  const openHistory = async () => { try { setHistory(await api.get(`/strutture/${id}/history`)); } catch (e) { toast(e.message, 'err'); } };
  const restore = async (h) => {
    if (!window.confirm(`Ripristinare la versione ${h.version} del ${itDateTime(h.at)}? Lo stato attuale resta in cronologia.`)) return;
    try { await api.post(`/strutture/${id}/history/${h.id}/restore`); setHistory(null); await load(); toast('Versione ripristinata'); } catch (e) { toast(e.message, 'err'); }
  };

  const compare = async () => {
    if (!cmp.a || !cmp.b) return;
    setCmp((c) => ({ ...c, busy: true }));
    try {
      const [ha, hb] = await Promise.all([api.get(`/strutture/${id}/history/${cmp.a}`), api.get(`/strutture/${id}/history/${cmp.b}`)]);
      const [first, second] = ha.version <= hb.version ? [ha, hb] : [hb, ha];
      setCmp((c) => ({ ...c, busy: false, rows: diffStrutture(first.data, second.data), label: `versione ${first.version} → versione ${second.version}` }));
    } catch (e) { toast(e.message, 'err'); setCmp((c) => ({ ...c, busy: false })); }
  };
  if (err) return <div className="page"><ErrorBox error={err} /><button className="btn ghost" onClick={() => nav(`${base}/sedi`)}>← Sedi</button></div>;
  if (!str) return <div className="page"><Loading text="Caricamento della sede…" /></div>;
  const st = status;
  return (
    <div className="page rp">
      <div className="savebar">
        <span className={`st ${st}`}>
          {st === 'saving' ? '● salvataggio…' : st === 'dirty' ? '● modifiche da salvare' : st === 'error' ? '● salvataggio non riuscito' : meta.canEdit ? `● salvato${meta.updatedAt ? ' ' + itDateTime(meta.updatedAt) : ''}${meta.updatedBy ? ' da ' + meta.updatedBy : ''}` : '● sola consultazione'}
        </span>
        <span className="spacer" />
        {meta.canEdit && <button className="btn sm" disabled={st !== 'dirty' && st !== 'error'} onClick={() => { clearTimeout(timer.current); save(); }} title="Le modifiche si salvano da sole dopo un attimo (Ctrl+S per forzare)">Salva ora</button>}
        <button className="btn sm ghost" onClick={openHistory}>Cronologia</button>
        <Link className="btn sm ghost" to={ADMIN_SITES} title="Denominazione, indirizzo, contatti e stato della sede si modificano nell'anagrafica unica">Apri in Amministrazione</Link>
        {user.role === 'ADMIN' && meta.configurata && <button className="btn sm ghost" style={{ color: 'var(--red)' }} onClick={del}>Rimuovi configurazione</button>}
      </div>
      {meta.active === false && <div className="alert err" style={{ marginBottom: 10 }}>Questa sede non è attiva nell'anagrafica della Suite: si consulta soltanto. Per riattivarla usa Amministrazione &gt; Sedi.</div>}
      {!meta.configurata && meta.active !== false && <div className="alert info" style={{ marginBottom: 10 }}>Sede dell'anagrafica non ancora configurata in Room Planning: aggiungi ambulatori, personale e orari. Il primo salvataggio crea la configurazione.</div>}
      <Struttura str={str} upd={upd} brand={brand} onBack={() => nav(`${base}/sedi`)} />
      {history && (
        <Modal title={`Cronologia · ${sedeLabel(str)}`} onClose={() => setHistory(null)} wide footer={<button className="btn ghost" onClick={() => setHistory(null)}>Chiudi</button>}>
          {!history.length ? <div className="muted">Nessuna versione registrata</div> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Confronta</th><th>Versione</th><th>Quando</th><th>Chi</th><th>Ambulatori</th><th>Personale</th><th>Nota</th><th /></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td><label className="f inline" style={{ gap: 4 }}><input type="radio" name="cmpA" checked={cmp.a === h.id} onChange={() => setCmp((c) => ({ ...c, a: h.id, rows: null }))} />A</label> <label className="f inline" style={{ gap: 4 }}><input type="radio" name="cmpB" checked={cmp.b === h.id} onChange={() => setCmp((c) => ({ ...c, b: h.id, rows: null }))} />B</label></td><td className="mono">{h.version}{h.version === meta.version && <> <Badge tone="green">attuale</Badge></>}</td><td className="small">{itDateTime(h.at)}</td><td>{h.user_name || '–'}</td><td className="num">{h.n_amb}</td><td className="num">{h.n_pers}</td><td className="small muted">{h.note}</td>
                  <td className="num">{meta.canEdit && h.version !== meta.version && <button className="btn sm ghost" onClick={() => restore(h)}>Ripristina</button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {history.length > 1 && <div className="row" style={{ marginTop: 10 }}><button className="btn sm" disabled={!cmp.a || !cmp.b || cmp.a === cmp.b || cmp.busy} onClick={compare}>Confronta A e B</button><span className="small muted">Seleziona due versioni: vengono elencate le differenze (anagrafica, orari, ambulatori, personale).</span></div>}
          {cmp.rows && (
            <div style={{ marginTop: 12 }}>
              <h3>Differenze · {cmp.label}</h3>
              {!cmp.rows.length ? <div className="muted small">Nessuna differenza tra le due versioni.</div> : (
                <div className="table-wrap"><table className="t"><thead><tr><th>Area</th><th>Voce</th><th>Prima (A)</th><th>Dopo (B)</th></tr></thead>
                  <tbody>{cmp.rows.map((r, i) => <tr key={i}><td><Badge>{r.area}</Badge></td><td className="strong small">{r.voce}</td><td className="small diff-del" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{String(r.prima)}</td><td className="small diff-add" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{String(r.dopo)}</td></tr>)}</tbody></table></div>)}
            </div>)}
        </Modal>
      )}
    </div>
  );
}
