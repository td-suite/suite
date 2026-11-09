import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icons.jsx';
import { AREA_COLORS } from '../format.js';
import './cockpit-monitor.css';

// Cockpit direzionale · Monitor (CEO, 08/11/2026): "Immaginati che io proietto il cockpit su un monitor fisso! e deve aggiornarsi ogni
// 5 minuti". Pagina senza link ai moduli (le card non sono cliccabili), aggiornamento automatico ogni 5 minuti con un indicatore discreto,
// data e ora grandi, scadenze della settimana in corso e della prossima a sinistra, indicatori numerici per gruppo a destra. Dati da
// GET /api/cockpit/monitor (server/src/lib/cockpitMonitor.js, in cache 60 secondi): un indicatore non disponibile è una card attenuata
// con il motivo, mai uno zero. `?monitor=1` nasconde la barra della Suite (App.jsx la rende fuori dalla Shell, come la presa d'atto);
// "Schermo intero" usa l'API Fullscreen. Lo scadenzario completo (filtri, Segna come vista, export) è in /cockpit/scadenzario.
const OGNI_MS = 5 * 60_000;
const TELA = 1920;   // larghezza della tela in modalità monitor (Full HD): scalata sullo schermo reale
const IT = 'it-IT';
const GRAV = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const ora = (d) => d.toLocaleTimeString(IT, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const dataLunga = (d) => d.toLocaleDateString(IT, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
const ggmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const giornoSett = (d) => GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** Valore leggibile: euro senza decimali, percentuali con un decimale, numeri con i separatori. */
function fmt(v, unita) {
  if (v == null) return '';
  const n = Number(v);
  if (unita === 'EUR') return n.toLocaleString(IT, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
  if (unita === '%') return `${n.toLocaleString(IT, { maximumFractionDigits: 1 })}`;
  return n.toLocaleString(IT, { maximumFractionDigits: 1, useGrouping: 'always' });
}
const UNITA_SUFFISSO = { '%': '%', sedi: 'sedi', giorni: 'gg', anni: 'anni' };

function Sparkline({ serie }) {
  if (!serie || serie.length < 2) return null;
  const v = serie.map((p) => Number(p.valore) || 0);
  const min = Math.min(...v), max = Math.max(...v);
  const W = 84, H = 26, pad = 2;
  const x = (i) => pad + (i * (W - 2 * pad)) / (v.length - 1);
  const y = (n) => (max === min ? H / 2 : H - pad - ((n - min) * (H - 2 * pad)) / (max - min));
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="none">
      {min >= 0 && <polygon className="area" points={`${x(0)},${H} ${pts} ${x(v.length - 1)},${H}`} />}
      <polyline points={pts} />
    </svg>
  );
}

function Delta({ c, unita }) {
  if (!c) return null;
  // punti percentuali per le percentuali; variazione % se il precedente non è zero; altrimenti la differenza nell'unità del valore
  const testo = c.punti ? `${c.delta > 0 ? '+' : ''}${c.delta.toLocaleString(IT, { maximumFractionDigits: 1 })} pt`
    : c.delta_pct != null ? `${c.delta_pct > 0 ? '+' : ''}${c.delta_pct.toLocaleString(IT, { maximumFractionDigits: 1 })}%`
      : c.segno === 'pari' ? '=' : `${c.delta > 0 ? '+' : '−'}${fmt(Math.abs(c.delta), unita)}`;
  return (
    <span className={`ckm-delta ${c.esito}`} title={`Rispetto a ${c.etichetta}: ${c.valore_precedente.toLocaleString(IT)}`}>
      <Icon name={c.segno === 'su' ? 'arrowUp' : c.segno === 'giu' ? 'arrowDown' : 'arrowRight'} />{testo}
    </span>
  );
}

// Larghezza della card in colonne della griglia degli indicatori (la tabella degli incassi per sede ne occupa due)
const larghezza = (x) => (x.tabella && !x.non_disponibile ? 2 : 1);

function Indicatore({ x }) {
  const w = larghezza(x);
  if (x.non_disponibile) {
    return (
      <div className="ckm-card nd" data-gruppo={x.gruppo} role="group" aria-label={`${x.titolo}: non disponibile`}>
        <div className="lbl">{x.titolo}</div>
        <div className="val">Non disponibile</div>
        <div className="mot" title={x.motivo}>{x.motivo}</div>
      </div>
    );
  }
  const testo = fmt(x.valore, x.unita);
  const sec = !x.serie?.length && x.secondario;
  return (
    <div className={`ckm-card ${w > 1 ? `w${w}` : ''}`} data-gruppo={x.gruppo} role="group" aria-label={x.titolo}>
      <div className="lbl" title={x.titolo}>{x.titolo}</div>
      {x.tabella && x.unita === 'giorni' ? (
        // attesa alla prima disponibilità (TuoTempo): mediana della rete e mediana per sede
        <>
          <div className="riga"><div className="val">{testo}<small>gg</small></div><span className="sec"><i>mediana della rete</i></span></div>
          <div className="ckm-tab">
            {x.tabella.map((r, i) => <div key={r.etichetta}><i>{i + 1}</i><span title={r.etichetta}>{r.etichetta}</span><b>{fmt(r.valore)} gg</b></div>)}
            {!x.tabella.length && <div><span>Nessuna sede con l'area TuoTempo abbinata</span></div>}
          </div>
        </>
      ) : x.tabella ? (
        <div className="ckm-tab">
          {x.tabella.map((r, i) => <div key={r.etichetta}><i>{i + 1}</i><span title={r.etichetta}>{r.etichetta}</span><b>{fmt(r.valore, 'EUR')}</b></div>)}
          {!x.tabella.length && <div><span>Nessun incasso nel mese</span></div>}
        </div>
      ) : (
        <div className="riga">
          <div className={`val ${testo.length > 9 ? 'lungo' : ''}`}>{testo}{UNITA_SUFFISSO[x.unita] && <small>{UNITA_SUFFISSO[x.unita]}</small>}</div>
          {x.parti ? (
            <div className="parti">{x.parti.map((p) => <span key={p.etichetta} title={`${p.etichetta}: ${fmt(p.valore)}`}><b>{fmt(p.valore)}</b>{p.etichetta}</span>)}</div>
          ) : sec ? (
            <span className="sec"><b>{fmt(sec.valore, sec.unita)}{sec.unita === '%' ? '%' : ''}</b><i>{sec.etichetta}</i></span>
          ) : <Sparkline serie={x.serie} />}
        </div>
      )}
      {(x.dettaglio || x.confronto) && <div className="det" title={[x.confronto ? `Rispetto a ${x.confronto.etichetta}` : null, x.dettaglio].filter(Boolean).join(' · ')}><Delta c={x.confronto} unita={x.unita} />{x.dettaglio}</div>}
      <div className="fonte" title={[x.fonte, x.nota, x.confronto ? `confronto: ${x.confronto.etichetta}` : null].filter(Boolean).join(' · ')}>{x.nota ? <><em>{x.nota}</em> · </> : null}{x.fonte}</div>
    </div>
  );
}

function BloccoScadenze({ b }) {
  return (
    <section className="ckm-scad" aria-label={`Scadenze: ${b.titolo}`}>
      <div className="hd">
        <div className="t"><h2>{b.titolo}</h2><span className="per">{b.periodo}</span><span className="tot" aria-label={`${b.conteggi.totale} scadenze`}>{b.conteggi.totale}</span></div>
        <div className="ckm-conti">
          {['CRITICA', 'ALTA', 'MEDIA', 'BASSA'].map((g) => <span key={g} className={b.conteggi[g] ? '' : 'zero'} style={{ '--g': `var(--g-${g})` }}><i />{GRAV[g]} {b.conteggi[g]}</span>)}
          {b.conteggi.scadute > 0 && <span className="scad">{b.conteggi.scadute} {b.conteggi.scadute === 1 ? 'scaduta' : 'scadute'}</span>}
        </div>
      </div>
      {!b.righe.length ? <div className="vuoto">Nessuna scadenza.</div> : (
        <ul>
          {b.righe.map((r) => (
            <li key={r.id}>
              <div className="d">{giornoSett(r.data)} {ggmm(r.data)}<small className={r.stato === 'SCADUTA' ? 'sc' : ''}>{r.stato === 'SCADUTA' ? 'scaduta' : r.stato === 'OGGI' ? 'oggi' : `tra ${r.giorni} gg`}</small></div>
              <span className="g" style={{ '--g': `var(--g-${r.gravita})` }} title={`Gravità ${GRAV[r.gravita]?.toLowerCase()}`} />
              <div className="tt"><b title={r.titolo}>{r.titolo}</b>{r.oggetto && <span>{r.oggetto}</span>}</div>
              <span className="ckm-chip" style={{ '--area': AREA_COLORS[r.area] }} title={r.modulo_nome}>{r.modulo_nome.split(' · ')[0]}</span>
            </li>
          ))}
        </ul>
      )}
      {b.altre > 0 && <div className="altre">+{b.altre} {b.altre === 1 ? 'altra' : 'altre'}</div>}
    </section>
  );
}

export default function Cockpit({ monitor = false }) {
  const [data, setData] = useState(null);
  const [errore, setErrore] = useState(null);
  const [adesso, setAdesso] = useState(() => new Date());
  const [prossimo, setProssimo] = useState(() => Date.now() + OGNI_MS);
  const [pieno, setPieno] = useState(() => Boolean(document.fullscreenElement));
  const timer = useRef(null);
  const tela = useRef(null);
  const [scala, setScala] = useState(null);

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
  // orologio e conto alla rovescia (ogni 10 secondi basta per HH:MM)
  useEffect(() => { const t = setInterval(() => setAdesso(new Date()), 10_000); return () => clearInterval(t); }, []);
  useEffect(() => { const f = () => setPieno(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const schermoIntero = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  // Modalità monitor su schermo orizzontale: la pagina si compone su una tela di 1920 px e si scala per stare tutta nello schermo
  // (1280x720, 4K...), senza barre di scorrimento. Su schermi stretti o verticali resta la pagina responsive normale.
  useLayoutEffect(() => {
    if (!monitor) return undefined;
    const calcola = () => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w < 1000 || w / h < 1.25 || !tela.current) { setScala(null); return; }
      const naturale = tela.current.scrollHeight;
      setScala(Math.min(w / TELA, h / Math.max(naturale, 1)));
    };
    calcola();
    const ro = new ResizeObserver(calcola);
    if (tela.current) ro.observe(tela.current);
    window.addEventListener('resize', calcola);
    return () => { ro.disconnect(); window.removeEventListener('resize', calcola); };
  }, [monitor, data]);
  const minuti = Math.max(0, Math.ceil((prossimo - adesso.getTime()) / 60_000));
  const ind = data?.indicatori || [];
  const nd = ind.filter((x) => x.non_disponibile).length;

  const pagina = (
    <div className={`ckm ${monitor ? 'full' : ''}`} style={scala ? { minHeight: Math.ceil(window.innerHeight / scala) } : undefined}>
      <header className="ckm-top">
        <div className="brand">
          <img className="logo-l" src="/logo-light.svg" alt="Toscana Diagnostica" /><img className="logo-d" src="/logo-dark.svg" alt="" aria-hidden="true" />
          <div><div className="k">Direzione</div><h1>Cockpit direzionale</h1></div>
        </div>
        <div className="ckm-stato" aria-live="polite">
          {data && <span>Aggiornato alle {ora(new Date(data.generato_at))} · prossimo tra {minuti} min</span>}
          {errore && <span className="err">Ultimo aggiornamento non riuscito: si riprova tra {minuti} min</span>}
          {document.fullscreenEnabled && <button type="button" onClick={schermoIntero}><Icon name={pieno ? 'zoomOut' : 'zoomIn'} />{pieno ? 'Esci dallo schermo intero' : 'Schermo intero'}</button>}
          {monitor ? <Link to="/cockpit">Mostra la barra della Suite</Link> : <Link to="/cockpit?monitor=1">Modalità monitor</Link>}
        </div>
        <div className="quando">
          <div className="ora" aria-label={`Ore ${ora(adesso)}`}>{ora(adesso)}</div>
          <div className="data">{dataLunga(adesso)}</div>
        </div>
      </header>

      {!data && !errore && <div className="ckm-load" aria-busy="true">Caricamento degli indicatori…</div>}
      {!data && errore && <div className="ckm-load">{errore.status === 403 ? 'Il Cockpit è riservato alla direzione.' : `Dati non disponibili: ${errore.message || 'errore'}`}</div>}

      {data && (
        <div className="ckm-grid">
          <div className="ckm-left">
            {data.scadenze.blocchi.map((b) => <BloccoScadenze key={b.key} b={b} />)}
            {data.scadenze.errore && <div className="ckm-foot">Scadenzario non letto: {data.scadenze.errore}</div>}
          </div>
          <div className="ckm-right">
            {data.gruppi.map((g) => {
              const xs = ind.filter((x) => x.gruppo === g.key);
              if (!xs.length) return null;
              const celle = xs.reduce((t, x) => t + larghezza(x), 0);
              const righe = (n) => ({ [`--r${n}`]: Math.ceil(celle / n) });
              return (
                <React.Fragment key={g.key}>
                  <div className="ckm-gruppo" data-gruppo={g.key} style={{ ...righe(6), ...righe(4), ...righe(3) }}><span>{g.titolo}</span></div>
                  {xs.map((x) => <Indicatore key={x.chiave} x={x} />)}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {data && (
        <footer className="ckm-foot">
          <span>{data.scadenze.fonti.lette} fonti dello scadenzario lette su {data.scadenze.fonti.totale}{data.scadenze.riservate ? ` · ${data.scadenze.riservate} scadenze di moduli riservati non mostrate` : ''}{nd ? ` · ${nd} indicatori non disponibili` : ''}</span>
          <span className="sp" />
          <Link to="/cockpit/scadenzario">Scadenzario completo</Link>
        </footer>
      )}
    </div>
  );
  if (!monitor) return pagina;
  return (
    <div className="ckm-schermo" style={scala ? { height: '100vh' } : undefined}>
      <div ref={tela} style={scala ? { width: TELA, transform: `scale(${scala})`, transformOrigin: 'top left', marginLeft: Math.max(0, (window.innerWidth - TELA * scala) / 2) } : undefined}>{pagina}</div>
    </div>
  );
}
