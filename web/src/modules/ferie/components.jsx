// Componenti condivisi del Piano Ferie: badge di stato (periodo e piano), riepilogo dei giorni, calendario annuale del dipendente
// (12 mesi, selezione cliccando o trascinando), griglie del piano dell'area (persone × giorni, persone × settimane, persone × mesi),
// finestra del periodo con il conteggio dei giorni, legenda.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Modal, Field } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { api, base } from './api.js';
import { STATO, STATO_PIANO, MESI, MESI_BREVI, GG, num, itData, periodo, quantita, giorniTra, weekday, quotaInData, oggiIso, giorniMese, addDays } from './format.js';

export const StatoBadge = ({ stato }) => <Badge tone={STATO[stato]?.tone || 'grey'}>{STATO[stato]?.label || stato}</Badge>;
export const StatoPianoBadge = ({ stato, breve }) => <Badge tone={STATO_PIANO[stato]?.tone || 'grey'}>{(breve ? STATO_PIANO[stato]?.breve : STATO_PIANO[stato]?.label) || stato || 'Bozza'}</Badge>;

// Riepilogo dei giorni del piano: da pianificare, spettanza, anno precedente, pianificati, goduti, variazioni in attesa, maturato
export function Saldo({ s, compatto }) {
  if (!s) return null;
  const voci = [
    { k: 'da_pianificare', l: 'Da pianificare', v: s.da_pianificare, cls: s.da_pianificare < 0 ? 'neg' : 'main', foot: s.da_pianificare < 0 ? 'oltre la spettanza: anticipo di ferie' : 'giorni ancora da mettere nel piano' },
    { k: 'spettanza', l: `Spettanti ${s.anno}`, v: s.spettanza, foot: s.mesi < 12 ? `${s.mesi} mesi su 12 · ${num(s.giorni_annui)} giorni annui` : `${num(s.giorni_annui)} giorni annui` },
    { k: 'residuo_ap', l: 'Residuo anno prec.', v: s.residuo_ap, foot: s.residuo_ap_fonte ? (s.residuo_ap_fonte === 'XLSX' ? 'da file HR' : 'inserito da HR') : 'non ancora inserito da HR' },
    { k: 'pianificato_totale', l: 'Pianificati', v: s.pianificato_totale, foot: 'tutti i periodi del piano' },
    { k: 'goduto', l: 'Goduti', v: s.goduto, foot: 'approvati e già passati' },
    ...(s.in_attesa ? [{ k: 'in_attesa', l: 'Variazioni in attesa', v: s.in_attesa, foot: 'da decidere dal responsabile' }] : []),
    { k: 'maturato', l: 'Maturati a oggi', v: s.maturato, foot: `${s.mesi_maturati} mesi conclusi` },
  ];
  return (
    <div className={`fe-saldo ${compatto ? 'compatto' : ''}`}>
      {voci.map((x) => <div key={x.k} className={`fe-kpi ${x.cls || ''}`}><div className="l">{x.l}</div><div className="v">{num(x.v)}<small>gg</small></div>{x.foot && !compatto && <div className="f">{x.foot}</div>}</div>)}
      {s.rol && <div className="fe-kpi rol"><div className="l">ROL e permessi</div><div className="v">{s.rol.residuo == null ? '-' : num(s.rol.residuo)}<small>h</small></div>{!compatto && <div className="f">{s.rol.spettanza == null ? 'ore annue da impostare (HR)' : `spettanza ${num(s.rol.spettanza)} h · godute ${num(s.rol.goduto)} h`}</div>}</div>}
    </div>
  );
}

export function Avvisi({ avvisi }) {
  if (!avvisi?.length) return null;
  return <div className="fe-avvisi">{avvisi.map((a, i) => <div key={i} className={`alert ${a.grave ? 'err' : 'warn'}`}><Icon name="alert" /><span>{a.testo}</span></div>)}</div>;
}

export function TabellaRichieste({ rows, mostraPersona = true, mostraArea = false, vuoto = 'Nessun periodo' }) {
  const nav = useNavigate();
  if (!rows?.length) return <div className="empty compact"><Icon name="calendar" /><div className="small">{vuoto}</div></div>;
  return (
    <div className="table-wrap"><table className="t fe-table">
      <thead><tr>{mostraPersona && <th>Persona</th>}{mostraArea && <th>Area</th>}<th>Periodo</th><th className="num">Quantità</th><th>Stato</th><th>Piano</th><th>Note</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className="click" onClick={() => nav(`${base}/richieste/${r.id}`)}>
          {mostraPersona && <td className="strong">{r.persona}</td>}
          {mostraArea && <td className="small">{r.gruppo_nome}</td>}
          <td style={{ whiteSpace: 'nowrap' }}>{periodo(r)}{r.variazione && <div className="small muted">variazione al piano</div>}</td>
          <td className="num" style={{ whiteSpace: 'nowrap' }}>{quantita(r)}</td>
          <td><StatoBadge stato={r.stato} />{r.variazione_proposta && <div className="small fe-warn">{r.variazione_proposta.tipo === 'RIMOZIONE' ? 'da togliere?' : 'da spostare?'}</div>}{r.sotto_copertura && ['PIANIFICATA', 'RICHIESTA', 'APPROVATA'].includes(r.stato) && <div className="small fe-warn" title="Uno o più giorni scendono sotto la copertura minima"><Icon name="alert" /> copertura</div>}</td>
          <td className="small">{r.piano_stato_label || ''}</td>
          <td className="small" style={{ maxWidth: 280 }}>{r.note}{r.nota_decisione && <div className="muted">{r.nota_decisione}</div>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

// ------------------------------------------------------------------ celle del piano
const cls = (c) => (!c ? '' : c.a.tipo === 'ROL' ? 'rol' : c.a.stato === 'RICHIESTA' ? 'att' : c.a.stato === 'PIANIFICATA' ? 'pian' : c.q < 1 ? 'half' : 'fer');
function cellaDi(periodi, pid, d) {
  let best = null;
  for (const a of periodi) {
    if (a.person_id !== pid) continue;
    const q = quotaInData(a, d);
    if (!q) continue;
    if (!best || q > best.q || (['RICHIESTA', 'PIANIFICATA'].includes(best.a.stato) && ['APPROVATA', 'GODUTA'].includes(a.stato))) best = { q, a };
  }
  return best;
}
const lavora = (p, d, fest) => (p.settimana || [1, 2, 3, 4, 5]).includes(weekday(d)) && !fest.has(d);

// Griglia del mese: persone × giorni. onCella(persona, data, periodo|null) per la modifica dal responsabile
export function Griglia({ piano, periodi, anno, mese, onCella, puoModificare = () => false }) {
  const fest = useMemo(() => new Map((piano?.festivi || []).map((f) => [f.data, f.nome])), [piano]);
  const scop = useMemo(() => { const m = new Map(); for (const s of piano?.scoperture || []) { if (!m.has(s.data)) m.set(s.data, []); m.get(s.data).push(s); } return m; }, [piano]);
  const oggi = oggiIso();
  if (!piano) return null;
  const chius = (d) => (piano.chiusure || []).find((c) => d >= c.data_inizio && d <= c.data_fine);
  const mm = String(mese).padStart(2, '0');
  const giorni = giorniTra(`${anno}-${mm}-01`, `${anno}-${mm}-${String(giorniMese(anno, mese)).padStart(2, '0')}`);
  return (
    <div className="fe-grid-wrap"><table className="fe-grid">
      <thead>
        <tr><th className="nome" rowSpan={2}>Persona</th>{giorni.map((d) => { const s = scop.get(d); return <th key={d} className={`${s ? 'scop' : ''} ${fest.has(d) || weekday(d) >= 6 ? 'we' : ''} ${d === oggi ? 'oggi' : ''}`} title={[fest.get(d), s ? `Sotto la copertura minima: ${s.map((x) => `${x.ruolo} ${num(x.presenti)}/${x.minimo}`).join(', ')}` : '', chius(d) ? `Chiusura: ${chius(d).descrizione}` : ''].filter(Boolean).join(' · ') || undefined}>{d.slice(8, 10)}</th>; })}</tr>
        <tr>{giorni.map((d) => <th key={d} className={`gg ${fest.has(d) || weekday(d) >= 6 ? 'we' : ''} ${scop.has(d) ? 'scop' : ''}`}>{GG[weekday(d)]}</th>)}</tr>
      </thead>
      <tbody>{piano.persone.map((p) => {
        const mod = puoModificare(p);
        return (
          <tr key={p.id} className={p.io ? 'io' : ''}>
            <td className="nome"><div className="strong">{p.nome}</div><div className="small muted">{p.piano ? <StatoPianoBadge stato={p.piano.stato} breve /> : null} {p.ruolo || ''}</div></td>
            {giorni.map((d) => {
              const c = cellaDi(periodi, p.id, d);
              const k = c ? cls(c) : !lavora(p, d, fest) ? (fest.has(d) ? 'fest' : 'we') : chius(d) ? 'chius' : '';
              const t = c ? `${p.nome}: ${c.a.tipo === 'ROL' ? 'permesso ROL' : c.q < 1 ? 'mezza giornata' : 'ferie'} (${STATO[c.a.stato]?.label?.toLowerCase()}) ${periodo(c.a)}${c.a.variazione_proposta ? ' · variazione proposta' : ''}` : fest.get(d) || (chius(d) ? `Chiusura collettiva: ${chius(d).descrizione}` : undefined);
              const click = mod && (c || lavora(p, d, fest));
              return <td key={d} className={`c ${k} ${d === oggi ? 'oggi' : ''} ${click ? 'click' : ''} ${c?.a.variazione_proposta ? 'varp' : ''}`} title={t}
                onClick={click ? () => onCella?.(p, d, c?.a || null) : undefined}>{c ? (c.a.tipo === 'ROL' ? 'P' : c.a.stato === 'RICHIESTA' ? 'A' : c.q < 1 ? '½' : '') : ''}</td>;
            })}
          </tr>);
      })}</tbody>
    </table></div>
  );
}

// Persone × settimane ISO dell'anno: giorni di ferie per settimana; in rosso le settimane con giorni sotto la copertura minima
export function GrigliaSettimane({ piano, periodi, anno, onSettimana }) {
  const fest = useMemo(() => new Map((piano?.festivi || []).map((f) => [f.data, f.nome])), [piano]);
  const settimane = useMemo(() => {
    const out = [];
    let d = `${anno}-01-01`;
    while (weekday(d) !== 1) d = addDays(d, -1);
    for (; d <= `${anno}-12-31`; d = addDays(d, 7)) out.push({ inizio: d, giorni: giorniTra(d, addDays(d, 6)).filter((x) => x.startsWith(String(anno))) });
    return out;
  }, [anno]);
  const scop = useMemo(() => new Set((piano?.scoperture || []).map((s) => s.data)), [piano]);
  if (!piano) return null;
  return (
    <div className="fe-grid-wrap"><table className="fe-grid sett">
      <thead><tr><th className="nome">Persona</th>{settimane.map((w, i) => <th key={w.inizio} className={w.giorni.some((d) => scop.has(d)) ? 'scop' : ''} title={`Settimana ${i + 1}: dal ${itData(w.giorni[0])} al ${itData(w.giorni[w.giorni.length - 1])}${w.giorni.some((d) => scop.has(d)) ? ' · giorni sotto la copertura minima' : ''}`}
        onClick={() => onSettimana?.(Number(w.giorni[0].slice(5, 7)))}>{i + 1}</th>)}</tr></thead>
      <tbody>{piano.persone.map((p) => (
        <tr key={p.id} className={p.io ? 'io' : ''}><td className="nome"><div className="strong">{p.nome}</div><div className="small muted">{p.piano ? <StatoPianoBadge stato={p.piano.stato} breve /> : null}</div></td>
          {settimane.map((w) => {
            let n = 0, k = '';
            for (const d of w.giorni) { if (!lavora(p, d, fest)) continue; const c = cellaDi(periodi, p.id, d); if (c && c.a.tipo !== 'ROL') { n += c.q; const kk = cls(c); if (!k || kk === 'fer') k = kk; } }
            return <td key={w.inizio} className={`w ${n ? k : ''}`} title={n ? `${p.nome}: ${num(n)} giorni` : undefined}>{n ? num(n) : ''}</td>;
          })}
        </tr>))}</tbody>
    </table></div>
  );
}

// Persone × mesi con una striscia di giorni per mese (solo periodi): vista annuale del piano dell'area
export function GrigliaMesi({ piano, periodi, anno, onMese, mostraTotale = true }) {
  const fest = useMemo(() => new Map((piano?.festivi || []).map((f) => [f.data, f.nome])), [piano]);
  const scop = useMemo(() => new Set((piano?.scoperture || []).map((s) => s.data)), [piano]);
  if (!piano) return null;
  return (
    <div className="fe-grid-wrap"><table className="fe-grid mesi">
      <thead><tr><th className="nome">Persona</th>{MESI.map((m, i) => { const sc = [...scop].some((d) => Number(d.slice(5, 7)) === i + 1); return <th key={m} className={sc ? 'scop' : ''} onClick={() => onMese?.(i + 1)} title={sc ? `${m}: giorni sotto la copertura minima` : m}>{MESI_BREVI[i]}</th>; })}{mostraTotale && <th>Giorni</th>}</tr></thead>
      <tbody>{piano.persone.map((p) => {
        let tot = 0;
        return (
          <tr key={p.id} className={p.io ? 'io' : ''}><td className="nome"><div className="strong">{p.nome}{p.io ? <span className="small muted"> (tu)</span> : ''}</div><div className="small muted">{p.piano ? <StatoPianoBadge stato={p.piano.stato} breve /> : null}</div></td>
            {MESI.map((_, i) => {
              const mm = String(i + 1).padStart(2, '0');
              const gg = giorniTra(`${anno}-${mm}-01`, `${anno}-${mm}-${String(giorniMese(anno, i + 1)).padStart(2, '0')}`);
              return <td key={mm} className="strip" onClick={() => onMese?.(i + 1)}><div className="fe-strip">{gg.map((d) => {
                const c = cellaDi(periodi, p.id, d);
                if (c && c.a.tipo !== 'ROL' && lavora(p, d, fest)) tot += c.q;
                return <i key={d} className={c ? cls(c) : !lavora(p, d, fest) ? 'we' : scop.has(d) ? 'scop' : ''} title={c ? `${itData(d)} · ${STATO[c.a.stato]?.label}` : undefined} />;
              })}</div></td>;
            })}
            {mostraTotale && <td className="tot">{num(tot)}</td>}
          </tr>);
      })}</tbody>
    </table></div>
  );
}

export function Legenda({ variazioni = true }) {
  return (
    <div className="fe-legenda small">
      <span><i className="fer" />Approvato</span><span><i className="pian" />Nel piano, da approvare</span><span><i className="half" />Mezza giornata</span>
      {variazioni && <span><i className="att" />Variazione in attesa</span>}<span><i className="we" />Festivo o riposo</span><span><i className="chius" />Chiusura collettiva</span><span><i className="scop" />Sotto la copertura minima</span>
    </div>
  );
}

// ------------------------------------------------------------------ calendario annuale del dipendente
/**
 * Dodici mesi: si seleziona un periodo trascinando (o cliccando un giorno, poi si corregge la fine nella finestra). Un clic su un
 * giorno già nel piano apre quel periodo. selezionabile: false = sola lettura.
 */
export function CalendarioAnno({ anno, periodi, festivi, settimana = [1, 2, 3, 4, 5], chiusure = [], selezionabile, onSeleziona, onPeriodo, minData }) {
  const fest = useMemo(() => new Map((festivi || []).map((f) => [f.data, f.nome])), [festivi]);
  const [sel, setSel] = useState(null);   // { da, a }
  const drag = useRef(null);
  const oggi = oggiIso();
  useEffect(() => {
    const up = () => { if (drag.current) { const { da, a } = drag.current; drag.current = null; setSel(null); onSeleziona?.(da <= a ? da : a, da <= a ? a : da); } };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [onSeleziona]);
  const periodoIn = (d) => periodi.find((p) => d >= p.data_inizio && d <= p.data_fine && ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'GODUTA'].includes(p.stato));
  const inSel = (d) => sel && d >= (sel.da <= sel.a ? sel.da : sel.a) && d <= (sel.da <= sel.a ? sel.a : sel.da);
  const giornoLibero = (d) => selezionabile && (!minData || d >= minData);
  return (
    <div className="fe-anno" onMouseLeave={() => { if (drag.current) { drag.current = null; setSel(null); } }}>
      {MESI.map((m, i) => {
        const mese = i + 1;
        const mm = String(mese).padStart(2, '0');
        const primo = `${anno}-${mm}-01`;
        const vuoti = weekday(primo) - 1;
        const gg = giorniTra(primo, `${anno}-${mm}-${String(giorniMese(anno, mese)).padStart(2, '0')}`);
        return (
          <div key={m} className="fe-mese">
            <div className="t">{m}</div>
            <div className="fe-mese-g">
              {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((x, k) => <span key={k} className="h">{x}</span>)}
              {Array.from({ length: vuoti }).map((_, k) => <span key={`v${k}`} />)}
              {gg.map((d) => {
                const p = periodoIn(d);
                const q = p ? quotaInData(p, d) : 0;
                const riposo = !settimana.includes(weekday(d)) || fest.has(d);
                const ch = chiusure.find((c) => d >= c.data_inizio && d <= c.data_fine);
                const k = [p ? (p.stato === 'RICHIESTA' ? 'att' : p.stato === 'PIANIFICATA' ? 'pian' : 'fer') : '', p && q < 1 ? 'half' : '', riposo ? 'we' : '', fest.has(d) ? 'fest' : '', ch && !p ? 'chius' : '', d === oggi ? 'oggi' : '', inSel(d) ? 'sel' : '', p?.variazione_proposta ? 'varp' : ''].filter(Boolean).join(' ');
                const title = [itData(d), fest.get(d), ch ? `Chiusura collettiva: ${ch.descrizione || ''}` : '', p ? `${STATO[p.stato]?.label}: ${periodo(p)}${p.variazione_proposta ? ' (variazione proposta)' : ''}` : ''].filter(Boolean).join(' · ');
                return (
                  <button type="button" key={d} className={`d ${k}`} title={title}
                    onMouseDown={(e) => { if (e.button !== 0) return; if (p) { onPeriodo?.(p); return; } if (!giornoLibero(d) || riposo) return; e.preventDefault(); drag.current = { da: d, a: d }; setSel({ da: d, a: d }); }}
                    onMouseEnter={() => { if (drag.current) { drag.current.a = d; setSel({ ...drag.current }); } }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (p) onPeriodo?.(p); else if (giornoLibero(d) && !riposo) onSeleziona?.(d, d); } }}
                    aria-label={title}>{Number(d.slice(8, 10))}</button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ finestra del periodo
/**
 * Inserimento o spostamento di un periodo con il conteggio dei giorni (POST /piani/:id/calcola). modo: 'piano' (periodo del piano),
 * 'variazione' (proposta al responsabile), 'responsabile' (modifica del responsabile: nota, obbligatoria nel piano definitivo).
 * onSalva(body) e, per un periodo esistente, onTogli(nota) / onSposta.
 */
export function PeriodoModal({ pianoId, titolo, iniziale, esistente, modo = 'piano', motivoObbligatorio = false, persona, avviso, onClose, onSalva, onTogli, chiusuraId }) {
  const [f, setF] = useState({ data_inizio: iniziale?.data_inizio || '', data_fine: iniziale?.data_fine || iniziale?.data_inizio || '', mezza_inizio: Boolean(iniziale?.mezza_inizio), mezza_fine: Boolean(iniziale?.mezza_fine), note: iniziale?.note || '', nota: '' });
  const [calc, setCalc] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const unGiorno = f.data_inizio && f.data_inizio === f.data_fine;
  useEffect(() => {
    setErr(null); setCalc(null);
    if (!f.data_inizio || !f.data_fine || !pianoId) return undefined;
    const t = setTimeout(() => api.post(`/piani/${pianoId}/calcola`, { data_inizio: f.data_inizio, data_fine: f.data_fine, mezza_inizio: f.mezza_inizio, mezza_fine: f.mezza_fine, escludi_id: esistente?.id || null }, { silent: true }).then(setCalc).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [f.data_inizio, f.data_fine, f.mezza_inizio, f.mezza_fine, pianoId, esistente]);
  const manca = motivoObbligatorio && f.nota.trim().length < 3;
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  const salva = () => run(() => onSalva({ data_inizio: f.data_inizio, data_fine: f.data_fine, mezza_inizio: f.mezza_inizio, mezza_fine: f.mezza_fine, note: f.note, nota: f.nota, chiusura_id: chiusuraId || null }));
  return (
    <Modal title={titolo} onClose={onClose} footer={<>
      {esistente && onTogli && <button className="btn ghost danger" disabled={busy || manca} onClick={() => run(() => onTogli(f.nota || f.note))} style={{ marginRight: 'auto' }}><Icon name="trash" />{modo === 'variazione' ? 'Proponi di togliere' : 'Togli dal piano'}</button>}
      <button className="btn ghost" onClick={onClose}>Chiudi</button>
      {onSalva && <button className="btn primary" disabled={busy || !calc || Boolean(err) || manca || calc?.conflitti?.length > 0} onClick={salva}><Icon name={modo === 'variazione' ? 'send' : 'check'} />{modo === 'variazione' ? (esistente ? 'Proponi lo spostamento' : 'Proponi la variazione') : esistente ? 'Salva lo spostamento' : 'Aggiungi al piano'}</button>}
    </>}>
      <div className="fe-form">
        {persona && <div className="small"><b>{persona}</b></div>}
        {avviso && <div className="alert info"><Icon name="info" /><span>{avviso}</span></div>}
        {onSalva && <>
          <div className="two">
            <Field label="Dal" required><input type="date" value={f.data_inizio} onChange={(e) => { set('data_inizio', e.target.value); if (!f.data_fine || f.data_fine < e.target.value) set('data_fine', e.target.value); }} /></Field>
            <Field label="Al" required><input type="date" value={f.data_fine} min={f.data_inizio || undefined} onChange={(e) => set('data_fine', e.target.value)} /></Field>
          </div>
          <div className="fe-mezze">
            <label className="fe-check"><input type="checkbox" checked={f.mezza_inizio} disabled={unGiorno && f.mezza_fine} onChange={(e) => set('mezza_inizio', e.target.checked)} /> {unGiorno ? 'Solo il pomeriggio' : 'Il primo giorno solo il pomeriggio'}</label>
            <label className="fe-check"><input type="checkbox" checked={f.mezza_fine} disabled={unGiorno && f.mezza_inizio} onChange={(e) => set('mezza_fine', e.target.checked)} /> {unGiorno ? 'Solo la mattina' : 'L\'ultimo giorno solo la mattina'}</label>
          </div>
          {modo !== 'responsabile' && <Field label="Note per il responsabile"><textarea rows={2} maxLength={1000} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Facoltative" /></Field>}
          <div className="fe-calc">
            {!calc ? <div className="small muted">{f.data_inizio ? 'Calcolo dei giorni…' : 'Scegli le date.'}</div> : <>
              <div className="big">{num(calc.giorni)} {calc.giorni === 1 ? 'giorno lavorativo' : 'giorni lavorativi'}</div>
              <div className="small">Da pianificare ora {num(calc.da_pianificare)} · dopo <b className={calc.saldo_dopo < 0 ? 'fe-neg' : ''}>{num(calc.saldo_dopo)}</b> · settimana {calc.settimana}</div>
              {calc.festivi?.length > 0 && <div className="small muted">Festivi non contati: {calc.festivi.map((x) => `${itData(x.data)} ${x.festivo}`).join(', ')}</div>}
              {calc.avvisi?.map((a, i) => <div key={i} className="alert warn"><Icon name="alert" /><span>{a}</span></div>)}
              {calc.conflitti?.length > 0 && <div className="alert err"><Icon name="alert" /><span>Si sovrappone a un periodo già nel piano</span></div>}
            </>}
          </div>
        </>}
        {(modo === 'responsabile' || (esistente && onTogli && modo !== 'variazione')) && <Field label={motivoObbligatorio ? 'Motivo (obbligatorio: il piano è definitivo, lo legge il dipendente)' : 'Nota per il dipendente (facoltativa)'}><textarea rows={2} maxLength={1000} value={f.nota} onChange={(e) => set('nota', e.target.value)} /></Field>}
        {modo === 'variazione' && esistente && onTogli && <Field label="Motivo della variazione"><textarea rows={2} maxLength={1000} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>}
        {err && <div className="alert err"><Icon name="alert" /><span>{err}</span></div>}
      </div>
    </Modal>
  );
}
