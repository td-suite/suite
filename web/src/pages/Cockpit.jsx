import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icons.jsx';
import { AREA_COLORS } from '../format.js';
import './cockpit-monitor.css';

// Cockpit direzionale · Monitor a schermo unico. v0.68.6 (CEO, 10/11/2026): "Troppa enfasi sulle attività in scadenza, poca sui numeri e
// sui grafici della produzione che mi interessano ben di più. Aggiungi almeno una statistica significativa per ogni widget."
// UNA schermata senza scorrimento a 1920×1080 e 1366×768, tema scuro/chiaro, ?monitor=1, aggiornamento ogni 5 minuti, fonte sotto ogni
// numero, nessun link ai moduli. Dall'alto:
//   - ~60% produzione: 4 grandi KPI (Ricavi oggi e del mese = B2C GIPO + laboratorio StudioLab; Produzione laboratorio oggi e del mese =
//     tutto Synclab, B2B + in sede) con il confronto con l'anno prima e le statistiche (vs media giornaliera, proiezione a fine mese, vs mese
//     prima); grafici SVG leggeri (nessuna libreria): barre giornaliere del mese (B2B e in sede impilate, B2C affiancato, linee della media e
//     del mese precedente), ultimi 12 mesi, TOP 5 clienti Service, ripartizione B2B / in sede / B2C;
//   - ~25% operatività: tessere compatte, ognuna con numero e statistica;
//   - ~15% scadenze: una fascia con i contatori (questa settimana, prossima, scadute) e le 3 più vicine.
// Dati: GET /api/cockpit/monitor → `schermo` (server/src/lib/cockpitMonitor.js, in cache 60 secondi). Scadenzario completo: /cockpit/scadenzario.
const OGNI_MS = 5 * 60_000;
const IT = 'it-IT';
const GRAV = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const ora = (d) => d.toLocaleTimeString(IT, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const dataLunga = (d) => d.toLocaleDateString(IT, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
const ggmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dataFonte = (d) => { if (!d) return 'n.d.'; if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return ggmm(String(d)); const t = new Date(d); return `${t.toLocaleDateString(IT, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })} ${ora(t)}`; };
const giornoSett = (d) => GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** Valore leggibile: euro senza decimali, percentuali con un decimale, numeri con i separatori. */
function fmt(v, unita) {
  if (v == null) return '–';
  const n = Number(v);
  if (unita === 'EUR') return n.toLocaleString(IT, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
  if (unita === '%' || unita === 'pt') return `${n.toLocaleString(IT, { maximumFractionDigits: 1 })}`;
  return n.toLocaleString(IT, { maximumFractionDigits: unita === 'n' ? 2 : 1, useGrouping: 'always' });
}
/** Euro abbreviati per gli assi e le etichette dei grafici: 1,2k, 34k, 1,1M. */
function eurK(v) {
  if (v == null) return '–';
  const n = Number(v), a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString(IT, { maximumFractionDigits: 1 })}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3).toLocaleString(IT)}k`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString(IT, { maximumFractionDigits: 1 })}k`;
  return Math.round(n).toLocaleString(IT);
}
const SUFFISSO = { '%': '%', giorni: 'gg', anni: 'anni', pt: 'pt', ore: 'ore' };

function Delta({ c, unita }) {
  if (!c) return null;
  const testo = c.punti ? `${c.delta > 0 ? '+' : ''}${c.delta.toLocaleString(IT, { maximumFractionDigits: 1 })} pt`
    : c.delta_pct != null ? `${c.delta_pct > 0 ? '+' : ''}${c.delta_pct.toLocaleString(IT, { maximumFractionDigits: 1 })}%`
      : c.segno === 'pari' ? '=' : `${c.delta > 0 ? '+' : '−'}${fmt(Math.abs(c.delta), unita)}`;
  return (
    <span className={`ckx-delta ${c.esito}`} title={`Rispetto a ${c.etichetta}: ${fmt(c.valore_precedente, unita)}`}>
      <Icon name={c.segno === 'su' ? 'arrowUp' : c.segno === 'giu' ? 'arrowDown' : 'arrowRight'} />{testo}
    </span>
  );
}

/** Statistica di un widget: valore (con segno per le variazioni) + etichetta; "non disponibile" con il motivo nel tooltip. */
function Stat({ s }) {
  if (!s) return null;
  if (s.valore == null) return <div className="ckx-stat nd" title={s.testo || ''}><b>n.d.</b> <span>{s.etichetta}</span></div>;
  // le variazioni ("vs …") hanno il segno; quote, tassi e proiezioni no
  const segno = /^vs /.test(s.etichetta) && Number(s.valore) > 0 ? '+' : '';
  const testo = s.unita === 'EUR' ? fmt(s.valore, 'EUR') : `${segno}${fmt(s.valore, s.unita)}${s.unita === '%' ? '%' : s.unita === 'pt' ? ' pt' : s.unita === 'giorni' ? ' gg' : s.unita === 'ore' ? ' ore' : ''}`;
  return <div className={`ckx-stat ${s.esito || ''}`} title={s.testo || ''}><b>{testo}</b> <span>{s.etichetta}</span></div>;
}

/** Grande KPI della fascia alta: valore, confronto con l'anno prima, componenti, statistiche, fonte. */
function Kpi({ x }) {
  if (!x) return null;
  if (x.non_disponibile) {
    return (
      <div className="ckx-kpi nd" role="group" aria-label={`${x.titolo}: non disponibile`}>
        <div className="lbl">{x.titolo}</div><div className="val nd">Non disponibile</div><div className="fonte" title={x.motivo}>{x.motivo}</div>
      </div>
    );
  }
  const tip = [x.titolo, x.confronto ? `Rispetto a ${x.confronto.etichetta}: ${fmt(x.confronto.valore_precedente, x.unita)}` : null, x.dettaglio, x.nota, ...(x.statistiche || []).map((s) => `${s.etichetta}: ${s.testo || ''}`), `Fonte: ${x.fonte}`].filter(Boolean).join('\n');
  return (
    <div className="ckx-kpi" role="group" aria-label={x.titolo} title={tip} data-testid={`kpi-${x.chiave}`}>
      <div className="testa"><div className="lbl">{x.titolo}</div><Delta c={x.confronto} unita={x.unita} /></div>
      <div className="val">{fmt(x.valore, x.unita)}</div>
      {x.parti && <div className="comp">{x.parti.map((p) => <span key={p.etichetta}><i>{p.etichetta}</i><b>{p.valore == null ? 'n.d.' : fmt(p.valore, x.unita)}</b></span>)}</div>}
      <div className="stats">{(x.statistiche || []).map((s) => <Stat key={s.etichetta} s={s} />)}</div>
      <div className="fonte">{x.confronto ? `anno prima ${fmt(x.confronto.valore_precedente, x.unita)} · ` : ''}{x.nota ? <em>{x.nota} · </em> : null}{x.fonte}</div>
    </div>
  );
}

/** Tessera dell'operatività: numero, una o due statistiche, fonte. */
function Tessera({ x }) {
  if (!x) return null;
  if (x.non_disponibile) {
    return (
      <div className="ckx-tess nd" role="group" aria-label={`${x.titolo}: non disponibile`} title={x.motivo}>
        <div className="lbl">{x.titolo}</div><div className="val nd">n.d.</div><div className="fonte">{x.motivo}</div>
      </div>
    );
  }
  const tip = [x.titolo, x.dettaglio, x.nota, ...(x.statistiche || []).map((s) => `${s.etichetta}: ${s.testo || ''}`), `Fonte: ${x.fonte}`].filter(Boolean).join('\n');
  return (
    <div className="ckx-tess" role="group" aria-label={x.titolo} title={tip} data-testid={`tessera-${x.chiave}`}>
      <div className="lbl">{x.titolo}</div>
      <div className="riga"><div className="val">{fmt(x.valore, x.unita)}{SUFFISSO[x.unita] && <small>{SUFFISSO[x.unita]}</small>}</div>
        <div className="stats">{(x.statistiche || []).map((s) => <Stat key={s.etichetta} s={s} />)}</div></div>
      <div className="fonte">{x.fonte}</div>
    </div>
  );
}

/** Dimensioni in pixel del contenitore (i grafici si disegnano in pixel veri: testo nitido a ogni risoluzione). */
function useSize() {
  const ref = useRef(null);
  const [s, setS] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const f = () => { const r = el.getBoundingClientRect(); setS((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: Math.floor(r.width), h: Math.floor(r.height) })); };
    f();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null; ro?.observe(el);
    window.addEventListener('resize', f);
    return () => { ro?.disconnect(); window.removeEventListener('resize', f); };
  }, []);
  return [ref, s];
}
const scala = (max) => { if (!(max > 0)) return [1, [0]]; const p = 10 ** Math.floor(Math.log10(max)); const passo = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => max / k <= 4) || p * 10; const top = Math.ceil(max / passo) * passo; const t = []; for (let v = 0; v <= top + 1e-9; v += passo) t.push(v); return [top, t]; };

function Grafico({ titolo, legenda, children, fonte, nd, motivo, className = '', testid }) {
  return (
    <div className={`ckx-graf ${className} ${nd ? 'nd' : ''}`} role="group" aria-label={titolo} data-testid={testid}>
      <div className="hd"><div className="lbl">{titolo}</div>{legenda && <div className="leg">{legenda}</div>}</div>
      <div className="corpo">{nd ? <div className="vuoto">{motivo || 'Non disponibile'}</div> : children}</div>
      {fonte && <div className="fonte" title={fonte}>{fonte}</div>}
    </div>
  );
}
const Voce = ({ c, t, linea, tratt }) => <span className="voce"><i className={linea ? 'linea' : ''} style={{ '--c': `var(${c})`, ...(tratt ? { borderTopStyle: 'dashed' } : {}) }} />{t}</span>;

/** Barre giornaliere del mese: laboratorio (B2B + in sede impilate), B2C GIPO affiancato, linea della media e del mese precedente. */
function Giornaliero({ g }) {
  const [ref, { w, h }] = useSize();
  if (!g || g.non_disponibile) return <Grafico titolo="Produzione giorno per giorno" nd motivo={g?.motivo} testid="graf-giornaliero" />;
  const nGiorni = Number(g.fine_mese.slice(8, 10));
  const giorni = Array.from({ length: nGiorni }, (_, i) => { const d = `${g.mese}-${String(i + 1).padStart(2, '0')}`; return g.giorni.find((x) => x.giorno === d) || { giorno: d, futuro: true }; });
  const vals = [...giorni.map((x) => Number(x.lab || 0)), ...giorni.map((x) => Number(x.b2c || 0)), ...g.prec.map((x) => Number(x.valore || 0)), Number(g.media || 0)];
  const [top, ticks] = scala(Math.max(...vals, 1));
  const L = 34, R = 6, T = 6, B = 16;
  const iw = Math.max(1, w - L - R), ih = Math.max(1, h - T - B);
  const slot = iw / nGiorni, bw = Math.max(1, slot * (g.b2c ? 0.5 : 0.72)), bw2 = Math.max(1, slot * 0.24);
  const y = (v) => T + ih - (Number(v || 0) / top) * ih;
  const x0 = (i) => L + i * slot + (slot - (g.b2c ? bw + bw2 + 1 : bw)) / 2;
  const prec = g.prec.filter((p) => p.valore != null && p.giorno <= nGiorni);
  const passoEt = slot < 18 ? 5 : slot < 28 ? 2 : 1;
  const tot = g.giorni.reduce((t, x) => t + Number(x.lab || 0), 0);
  return (
    <Grafico titolo={`Giorno per giorno · lab ${eurK(tot)}${g.b2c ? ` · B2C ${eurK(g.giorni.reduce((t, x) => t + Number(x.b2c || 0), 0))}` : ''}`} testid="graf-giornaliero" className="g-giorni"
      legenda={<>{g.laboratorio && <Voce c="--c-b2b" t="B2B" />}{g.in_sede && <Voce c="--c-sede" t="in sede" />}{g.b2c && <Voce c="--c-b2c" t="B2C GIPO" />}{g.media != null && <Voce c="--c-media" t="media" linea tratt />}{prec.length > 0 && <Voce c="--c-prec" t={g.prec_etichetta} linea />}</>}
      fonte={`${g.media_testo} · ${g.fonte}`}>
      <div ref={ref} className="svgbox">
        {w > 0 && h > 0 && (
          <svg width={w} height={h} role="img" aria-label="Barre giornaliere della produzione del mese">
            {ticks.map((t) => <g key={t}><line x1={L} x2={w - R} y1={y(t)} y2={y(t)} className="griglia" /><text x={L - 4} y={y(t) + 3} className="asse" textAnchor="end">{eurK(t)}</text></g>)}
            {giorni.map((x, i) => {
              const d = Number(x.giorno.slice(8, 10)); const fest = [0, 6].includes(new Date(`${x.giorno}T12:00:00Z`).getUTCDay());
              const b2b = Number(x.b2b || 0), sede = Number(x.sede || 0);
              return (
                <g key={x.giorno} className={`${fest ? 'fest' : ''} ${x.giorno === g.oggi ? 'oggi' : ''}`}>
                  <title>{`${ggmm(x.giorno)}${x.futuro ? '' : `: laboratorio ${fmt(x.lab, 'EUR')} (B2B ${fmt(x.b2b, 'EUR')}${g.in_sede ? `, in sede ${fmt(x.sede, 'EUR')}` : ''})${g.b2c ? ` · B2C ${fmt(x.b2c, 'EUR')}` : ''}${x.esami != null ? ` · ${x.esami} esami` : ''}`}`}</title>
                  {!x.futuro && x.lab != null && <>
                    <rect x={x0(i)} width={bw} y={y(b2b)} height={Math.max(0, T + ih - y(b2b))} className="b-b2b" />
                    {sede > 0 && <rect x={x0(i)} width={bw} y={y(b2b + sede)} height={Math.max(0, y(b2b) - y(b2b + sede))} className="b-sede" />}
                  </>}
                  {!x.futuro && g.b2c && x.b2c != null && <rect x={x0(i) + bw + 1} width={bw2} y={y(x.b2c)} height={Math.max(0, T + ih - y(x.b2c))} className="b-b2c" />}
                  {(d === 1 || d % passoEt === 0 || x.giorno === g.oggi) && <text x={L + i * slot + slot / 2} y={h - 3} className={`asse ${x.giorno === g.oggi ? 'oggi' : ''}`} textAnchor="middle">{d}</text>}
                </g>
              );
            })}
            {prec.length > 1 && <polyline className="l-prec" points={prec.map((p) => `${L + (p.giorno - 1) * slot + slot / 2},${y(p.valore)}`).join(' ')} />}
            {g.media != null && <line className="l-media" x1={L} x2={w - R} y1={y(g.media)} y2={y(g.media)} />}
          </svg>
        )}
      </div>
    </Grafico>
  );
}

/** Andamento mensile degli ultimi 12 mesi: laboratorio (B2B + in sede impilate) e B2C affiancato; n.d. prima del primo dato. */
function Mensile({ m }) {
  const [ref, { w, h }] = useSize();
  if (!m || m.non_disponibile) return <Grafico titolo="Ultimi 12 mesi" nd motivo={m?.motivo} testid="graf-mensile" />;
  const vals = m.mesi.flatMap((x) => [Number(x.lab || 0), Number(x.b2c || 0)]);
  const [top, ticks] = scala(Math.max(...vals, 1));
  const L = 34, R = 4, T = 12, B = 16;
  const iw = Math.max(1, w - L - R), ih = Math.max(1, h - T - B);
  const slot = iw / m.mesi.length, bw = slot * (m.b2c ? 0.4 : 0.66), bw2 = slot * 0.3;
  const y = (v) => T + ih - (Number(v || 0) / top) * ih;
  return (
    <Grafico titolo="Ultimi 12 mesi" testid="graf-mensile" legenda={<>{m.laboratorio && <Voce c="--c-b2b" t="B2B" />}{m.in_sede && <Voce c="--c-sede" t="in sede" />}{m.b2c && <Voce c="--c-b2c" t="B2C" />}</>}
      fonte={`${m.nota ? `${m.nota} · ` : ''}${m.fonte}`}>
      <div ref={ref} className="svgbox">
        {w > 0 && h > 0 && (
          <svg width={w} height={h} role="img" aria-label="Produzione degli ultimi 12 mesi">
            {ticks.map((t) => <g key={t}><line x1={L} x2={w - R} y1={y(t)} y2={y(t)} className="griglia" /><text x={L - 4} y={y(t) + 3} className="asse" textAnchor="end">{eurK(t)}</text></g>)}
            {m.mesi.map((x, i) => {
              const xs = L + i * slot + (slot - (m.b2c ? bw + bw2 + 1 : bw)) / 2;
              const b2b = Number(x.b2b || 0), sede = Number(x.sede || 0);
              return (
                <g key={x.mese} className={x.parziale ? 'parziale' : ''}>
                  <title>{`${x.etichetta}${x.parziale ? ' (in corso)' : ''}: laboratorio ${x.lab == null ? 'n.d.' : fmt(x.lab, 'EUR')}${m.b2c ? ` · B2C ${x.b2c == null ? 'n.d.' : fmt(x.b2c, 'EUR')}` : ''}`}</title>
                  {x.lab != null ? <>
                    <rect x={xs} width={bw} y={y(b2b)} height={Math.max(0, T + ih - y(b2b))} className="b-b2b" />
                    {sede > 0 && <rect x={xs} width={bw} y={y(b2b + sede)} height={Math.max(0, y(b2b) - y(b2b + sede))} className="b-sede" />}
                  </> : m.laboratorio ? <text x={xs + bw / 2} y={T + ih - 3} className="asse nd" textAnchor="middle">n.d.</text> : null}
                  {m.b2c && x.b2c != null && <rect x={xs + bw + 1} width={bw2} y={y(x.b2c)} height={Math.max(0, T + ih - y(x.b2c))} className="b-b2c" />}
                  <text x={L + i * slot + slot / 2} y={h - 3} className="asse" textAnchor="middle">{x.etichetta.split(' ')[0]}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </Grafico>
  );
}

/** TOP 5 clienti Service: barre orizzontali con la quota sul totale B2B e la variazione sul mese prima. */
function Top5({ t }) {
  if (!t || t.non_disponibile) return <Grafico titolo="TOP 5 clienti Service" nd motivo={t?.motivo} testid="graf-top5" />;
  const max = Math.max(1, ...t.righe.map((r) => Number(r.valore || 0)));
  return (
    <Grafico titolo="TOP 5 clienti Service · mese" testid="graf-top5" className="g-top5"
      fonte={`${t.totale_b2b != null ? `Totale B2B ${fmt(t.totale_b2b, 'EUR')} su ${t.clienti} clienti · ` : ''}${t.fonte}`}>
      {!t.righe.length ? <div className="vuoto">Nessuna produzione B2B nel mese</div> : (
        <ol className="barre-h">
          {t.righe.map((r) => (
            <li key={r.chiave} title={`${r.cliente}: ${fmt(r.valore, 'EUR')} · ${r.quota == null ? '–' : `${fmt(r.quota)}%`} del B2B · ${r.variazione == null ? 'nuovo rispetto al mese prima' : `${r.variazione > 0 ? '+' : ''}${fmt(r.variazione)}% sul mese prima`}`}>
              <div className="nome"><span className="pos">{r.pos}</span><span className="cli">{r.cliente}</span><b>{eurK(r.valore)}</b></div>
              <div className="barra"><span style={{ width: `${Math.max(2, (Number(r.valore) / max) * 100)}%` }} /></div>
              <div className="meta"><span>{r.quota == null ? '–' : `${fmt(r.quota)}%`} del B2B</span>{r.variazione == null ? <span className="muto">nuovo</span> : <span className={r.variazione >= 0 ? 'su' : 'giu'}>{r.variazione > 0 ? '+' : ''}{fmt(r.variazione)}% vs mese prima</span>}</div>
            </li>
          ))}
        </ol>
      )}
    </Grafico>
  );
}

/** Ripartizione del mese: anello SVG con B2B, Laboratorio in sede e B2C e la quota di ciascuno. */
function Ripartizione({ r }) {
  if (!r || r.non_disponibile) return <Grafico titolo="Ripartizione del mese" nd motivo={r?.motivo} testid="graf-ripartizione" />;
  const COL = { B2B: '--c-b2b', LAB_SEDE: '--c-sede', B2C: '--c-b2c' };
  const parti = r.parti.filter((p) => p.valore != null && Number(p.valore) > 0);
  const tot = parti.reduce((t, p) => t + Number(p.valore), 0);
  const R0 = 40, sw = 15, C = 2 * Math.PI * R0;
  let acc = 0;
  return (
    <Grafico titolo="Ripartizione del mese" testid="graf-ripartizione" className="g-rip" fonte={`${r.nota ? `${r.nota} · ` : ''}${r.mancanti?.length ? `manca ${r.mancanti.join(', ')} · ` : ''}${r.fonte}`}>
      <div className="rip">
        <svg viewBox="0 0 100 100" className="anello" role="img" aria-label="Ripartizione B2B, in sede, B2C">
          <circle cx="50" cy="50" r={R0} className="fondo" strokeWidth={sw} fill="none" />
          {tot > 0 && parti.map((p) => { const l = (Number(p.valore) / tot) * C; const el = <circle key={p.chiave} cx="50" cy="50" r={R0} fill="none" strokeWidth={sw} style={{ stroke: `var(${COL[p.chiave]})` }} strokeDasharray={`${l} ${C - l}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)"><title>{`${p.etichetta}: ${fmt(p.valore, 'EUR')} (${fmt(p.quota)}%)`}</title></circle>; acc += l; return el; })}
          <text x="50" y="49" textAnchor="middle" className="tot">{eurK(r.totale)}</text><text x="50" y="62" textAnchor="middle" className="sub">totale</text>
        </svg>
        <ul>{r.parti.map((p) => <li key={p.chiave}><i style={{ background: `var(${COL[p.chiave]})` }} /><span>{p.etichetta}</span><b>{p.valore == null ? 'n.d.' : `${fmt(p.quota)}%`}</b></li>)}</ul>
      </div>
    </Grafico>
  );
}

/** Fascia bassa delle scadenze: contatori e le 3 più vicine (il dettaglio resta nello Scadenzario completo). */
function Scadenze({ s }) {
  if (!s) return null;
  return (
    <div className="ckx-scadx" role="group" aria-label="Scadenze" data-testid="scadenze-sintesi" title={s.fonte}>
      <div className="conti">
        <div><b>{s.questa}</b><span>questa settimana</span></div>
        <div><b>{s.prossima}</b><span>prossima</span></div>
        <div className={s.scadute ? 'sc' : ''}><b>{s.scadute}</b><span>scadute</span></div>
      </div>
      <ul>
        {s.prime.map((r) => (
          <li key={r.id} title={[r.titolo, r.oggetto, r.modulo_nome].filter(Boolean).join(' · ')}>
            <span className="g" style={{ '--g': `var(--g-${r.gravita})` }} />
            <span className="d">{giornoSett(r.data)} {ggmm(r.data)}<em>{r.stato === 'OGGI' ? 'oggi' : r.giorni != null ? `tra ${r.giorni} gg` : ''}</em></span>
            <span className="tt"><b>{r.titolo}</b>{r.oggetto ? ` · ${r.oggetto}` : ''}</span>
            <span className="ckx-chip" style={{ '--area': AREA_COLORS[r.area] }}>{(r.modulo_nome || '').split(' · ')[0]}</span>
          </li>
        ))}
        {!s.prime.length && <li className="vuoto">Nessuna scadenza nei prossimi giorni.</li>}
      </ul>
      <div className="fonte">{s.riservate ? `${s.riservate} riservate · ` : ''}{s.fonte}</div>
    </div>
  );
}

const Riga = ({ titolo, area, children, className = '' }) => (
  <section className={`ckx-riga ${className}`} style={{ '--area': area }} aria-label={titolo}>
    <h2>{titolo}</h2>
    <div className="cont">{children}</div>
  </section>
);

export default function Cockpit({ monitor = false }) {
  const [data, setData] = useState(null);
  const [errore, setErrore] = useState(null);
  const [adesso, setAdesso] = useState(() => new Date());
  const [prossimo, setProssimo] = useState(() => Date.now() + OGNI_MS);
  const [pieno, setPieno] = useState(() => Boolean(document.fullscreenElement));
  const timer = useRef(null);

  const carica = useCallback(async () => {
    try { setData(await api.get('/cockpit/monitor', { silent: true })); setErrore(null); }
    catch (e) { setErrore(e); }   // si tengono i dati precedenti: il monitor non si svuota per un errore di rete
    setProssimo(Date.now() + OGNI_MS);
  }, []);
  useEffect(() => {
    carica();
    timer.current = setInterval(carica, OGNI_MS);
    return () => clearInterval(timer.current);
  }, [carica]);
  useEffect(() => { const t = setInterval(() => setAdesso(new Date()), 10_000); return () => clearInterval(t); }, []);
  useEffect(() => { const f = () => setPieno(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const schermoIntero = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const minuti = Math.max(0, Math.ceil((prossimo - adesso.getTime()) / 60_000));
  const S = data?.schermo;
  const nuovo = Boolean(S?.kpi?.length);

  return (
    <div className={`ckm ckx ${monitor ? 'full' : ''}`} data-testid="cockpit-monitor">
      <header className="ckx-top">
        <div className="brand">
          <img className="logo-l" src="/logo-light.svg" alt="Toscana Diagnostica" /><img className="logo-d" src="/logo-dark.svg" alt="" aria-hidden="true" />
          <h1>Cockpit direzionale</h1>
        </div>
        <div className="quando"><b>{ora(adesso)}</b><span>{dataLunga(adesso)}</span></div>
        <div className="fonti" aria-label="Fonti dei dati">
          {(S?.fonti || []).map((f) => <span key={f.chiave} className={f.ok ? '' : 'ko'} title={`${f.nome}: ${f.testo || ''}`}><i />{f.nome} <em>{f.chiave === 'SYNCLAB' && /aggiornato alle/.test(f.testo || '') ? f.testo.replace(/^accettazioni /, '') : dataFonte(f.data)}</em></span>)}
          {S?.regola && <span className="regola" title={S.regola.testo}>Produzione accettata · {S.regola.sconto === 'APPLICA' ? 'netto con sconto di testata' : 'importi di riga'}</span>}
        </div>
        <div className="stato" aria-live="polite">
          {data && <span>Aggiornato alle {ora(new Date(data.generato_at))} · prossimo tra {minuti} min{S?.versione ? ` · v${S.versione}` : ''}</span>}
          {errore && <span className="err">Aggiornamento non riuscito: si riprova tra {minuti} min</span>}
          {document.fullscreenEnabled && <button type="button" onClick={schermoIntero} title={pieno ? 'Esci dallo schermo intero' : 'Schermo intero'}><Icon name={pieno ? 'zoomOut' : 'zoomIn'} /></button>}
          {monitor ? <Link to="/cockpit" title="Mostra la barra della Suite">Barra</Link> : <><Link to="/cockpit?monitor=1">Monitor</Link><Link to="/cockpit/scadenzario">Scadenzario completo</Link></>}
        </div>
      </header>

      {!data && !errore && <div className="ckm-load" aria-busy="true">Caricamento degli indicatori…</div>}
      {!data && errore && <div className="ckm-load">{errore.status === 403 ? 'Il Cockpit è riservato alla direzione.' : `Dati non disponibili: ${errore.message || 'errore'}`}</div>}
      {data && (!S || !nuovo) && !S?.errore && <div className="ckm-load">Schermo non disponibile: aggiornare la Suite.</div>}
      {S?.errore && <div className="ckm-load">{S.errore}</div>}

      {S && nuovo && !S.errore && (
        <main className="ckx-grid">
          <Riga titolo="Produzione" area="var(--area-FINANCE)" className="r-kpi">
            {S.kpi.map((x) => <Kpi key={x.chiave} x={x} />)}
          </Riga>
          <Riga titolo="Andamento" area="var(--area-OPERATIONS)" className="r-graf">
            <Giornaliero g={S.grafici?.giornaliero} />
            <Mensile m={S.grafici?.mensile} />
            <Top5 t={S.grafici?.top5} />
            <Ripartizione r={S.grafici?.ripartizione} />
          </Riga>
          <Riga titolo="Operatività" area="var(--area-RETAIL_FLOW)" className="r-op">
            {(S.operativita || []).map((x) => <Tessera key={x.chiave} x={x} />)}
          </Riga>
          <Riga titolo="Scadenze" area="var(--area-HQS)" className="r-scad">
            <Scadenze s={S.scadenze_sintesi} />
          </Riga>
        </main>
      )}
    </div>
  );
}
