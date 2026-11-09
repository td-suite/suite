import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icons.jsx';
import { AREA_COLORS } from '../format.js';
import './cockpit-monitor.css';

// Cockpit direzionale · Monitor a schermo unico (CEO, 08/11/2026 e 09/11/2026 sera, v0.68.1): UNA schermata senza scorrimento a
// 1920×1080 e 1366×768 (griglia a 12 colonne, altezze in vh, caratteri che scalano con clamp, nessuna card alta). Righe dall'alto:
//   1. intestazione sottile: data e ora, ultimo aggiornamento, versione, fonti con la data di ciascuna (GIPO, TuoTempo, Synclab);
//   2. Ricavi: oggi e mese = B2C (GIPO) + B2B (Synclab), con le due componenti e il confronto con l'anno prima;
//   3. Laboratorio (Synclab): accettazioni ieri/oggi/mese, esami del mese, fatturato B2B del giorno e del mese, TOP 5 clienti;
//   4. Retail B2C: accettazioni GIPO, scontrino medio, prima disponibilità online, quota fuori area;
//   5. Scadenze e persone: questa settimana e la prossima (al più 6 righe), ferie oggi, NC aperte, ordini in attesa.
// Ogni numero ha sotto la sua fonte. Nessun link ai moduli (le celle non sono cliccabili), aggiornamento ogni 5 minuti, `?monitor=1`
// senza la barra della Suite (App.jsx), tema chiaro e scuro della Suite. Dati: GET /api/cockpit/monitor → `schermo`
// (server/src/lib/cockpitMonitor.js, in cache 60 secondi). Lo scadenzario completo resta in /cockpit/scadenzario.
const OGNI_MS = 5 * 60_000;
const IT = 'it-IT';
const GRAV = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const ora = (d) => d.toLocaleTimeString(IT, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const dataLunga = (d) => d.toLocaleDateString(IT, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
const ggmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// data della fonte nell'intestazione: giorno e, se è un istante, l'ora (il testo completo è nel tooltip)
const dataFonte = (d) => { if (!d) return 'n.d.'; if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return ggmm(String(d)); const t = new Date(d); return `${t.toLocaleDateString(IT, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })} ${ora(t)}`; };
const giornoSett = (d) => GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** Valore leggibile: euro senza decimali, percentuali con un decimale, numeri con i separatori. */
function fmt(v, unita) {
  if (v == null) return '–';
  const n = Number(v);
  if (unita === 'EUR') return n.toLocaleString(IT, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
  if (unita === '%') return `${n.toLocaleString(IT, { maximumFractionDigits: 1 })}`;
  return n.toLocaleString(IT, { maximumFractionDigits: 1, useGrouping: 'always' });
}
const SUFFISSO = { '%': '%', giorni: 'gg', anni: 'anni' };

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

/** Cella numerica: titolo, valore (con confronto), dettaglio breve, fonte in piccolo. grande = celle dei ricavi con le componenti. */
function Cella({ x, grande = false, area }) {
  if (!x) return null;
  if (x.non_disponibile) {
    return (
      <div className={`ckx-cella nd ${grande ? 'grande' : ''}`} style={area ? { '--area': area } : undefined} role="group" aria-label={`${x.titolo}: non disponibile`}>
        <div className="lbl">{x.titolo}</div>
        <div className="val nd">Non disponibile</div>
        <div className="fonte" title={x.motivo}>{x.motivo}</div>
      </div>
    );
  }
  const testo = fmt(x.valore, x.unita);
  const tip = [x.titolo, x.confronto ? `Rispetto a ${x.confronto.etichetta}: ${fmt(x.confronto.valore_precedente, x.unita)}` : null, x.dettaglio, x.nota, `Fonte: ${x.fonte}`].filter(Boolean).join('\n');
  return (
    <div className={`ckx-cella ${grande ? 'grande' : ''}`} style={area ? { '--area': area } : undefined} role="group" aria-label={x.titolo} title={tip}>
      <div className="lbl">{x.titolo}</div>
      <div className="riga">
        <div className="val">{testo}{SUFFISSO[x.unita] && <small>{SUFFISSO[x.unita]}</small>}</div>
        <Delta c={x.confronto} unita={x.unita} />
      </div>
      {grande && x.parti ? (
        <div className="comp">{x.parti.map((p) => <span key={p.etichetta}><i>{p.etichetta}</i><b>{p.valore == null ? 'n.d.' : fmt(p.valore, x.unita)}</b></span>)}</div>
      ) : x.parti ? (
        <div className="det">{x.parti.map((p) => `${p.etichetta} ${fmt(p.valore)}`).join(' · ')}</div>
      ) : x.secondario ? (
        <div className="det">{fmt(x.secondario.valore, x.secondario.unita)}{x.secondario.unita === '%' ? '%' : ''} {x.secondario.etichetta}{x.dettaglio ? ` · ${x.dettaglio}` : ''}</div>
      ) : x.dettaglio ? <div className="det">{x.dettaglio}</div> : null}
      {grande && x.confronto && <div className="det">anno prima {fmt(x.confronto.valore_precedente, x.unita)} · {x.confronto.etichetta}</div>}
      <div className="fonte">{x.nota ? <em>{x.nota} · </em> : null}{x.fonte}</div>
    </div>
  );
}

function Top5({ t }) {
  if (!t) return null;
  return (
    <div className={`ckx-top5 ${t.non_disponibile ? 'nd' : ''}`} role="group" aria-label="TOP 5 clienti B2B per fatturato del mese">
      <div className="lbl">TOP 5 clienti Service · fatturato del mese</div>
      {t.non_disponibile ? <div className="vuoto">{t.motivo}</div> : !t.righe.length ? <div className="vuoto">Nessun documento B2B nel mese</div> : (
        <table>
          <thead><tr><th>#</th><th>Cliente</th><th className="n">Fatturato</th><th className="n">% B2B</th><th className="n">vs mese prima</th></tr></thead>
          <tbody>
            {t.righe.map((r) => (
              <tr key={r.chiave}>
                <td className="pos">{r.pos}</td>
                <td className="cli" title={r.cliente}>{r.cliente}</td>
                <td className="n b">{fmt(r.fatturato, 'EUR')}</td>
                <td className="n">{r.quota == null ? '–' : `${fmt(r.quota)}%`}</td>
                <td className="n">{r.variazione == null ? <span className="muto" title={r.mese_prima == null ? 'Nessun documento nello stesso periodo del mese prima' : 'Mese prima a zero'}>nuovo</span> : <span className={r.variazione >= 0 ? 'su' : 'giu'}>{r.variazione > 0 ? '+' : ''}{fmt(r.variazione)}%</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="fonte">{t.totale_b2b != null ? `Totale B2B del mese ${fmt(t.totale_b2b, 'EUR')} su ${t.clienti} clienti · ` : ''}{t.fonte}</div>
    </div>
  );
}

function Scadenze({ b }) {
  return (
    <section className="ckx-scad" aria-label={`Scadenze: ${b.titolo}`}>
      <div className="hd">
        <h3>{b.titolo}</h3><span className="per">{b.periodo}</span>
        <span className="conti">
          {['CRITICA', 'ALTA', 'MEDIA', 'BASSA'].filter((g) => b.conteggi[g]).map((g) => <span key={g} style={{ '--g': `var(--g-${g})` }} title={`Gravità ${GRAV[g].toLowerCase()}`}><i />{b.conteggi[g]}</span>)}
          {b.conteggi.scadute > 0 && <span className="sc">{b.conteggi.scadute} {b.conteggi.scadute === 1 ? 'scaduta' : 'scadute'}</span>}
        </span>
        <b className="tot">{b.conteggi.totale}</b>
      </div>
      {!b.righe.length ? <div className="vuoto">Nessuna scadenza.</div> : (
        <ul>
          {b.righe.map((r) => (
            <li key={r.id}>
              <span className="d">{giornoSett(r.data)} {ggmm(r.data)}</span>
              <span className="g" style={{ '--g': `var(--g-${r.gravita})` }} title={`Gravità ${GRAV[r.gravita]?.toLowerCase()}`} />
              <span className="tt" title={[r.titolo, r.oggetto].filter(Boolean).join(' · ')}><b>{r.titolo}</b>{r.oggetto ? <> · {r.oggetto}</> : null}</span>
              <span className={`st ${r.stato === 'SCADUTA' ? 'sc' : ''}`}>{r.stato === 'SCADUTA' ? 'scaduta' : r.stato === 'OGGI' ? 'oggi' : `${r.giorni} gg`}</span>
              <span className="ckx-chip" style={{ '--area': AREA_COLORS[r.area] }} title={r.modulo_nome}>{r.modulo_nome.split(' · ')[0]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="altre">{b.altre > 0 ? `+${b.altre} ${b.altre === 1 ? 'altra' : 'altre'} nello scadenzario completo` : ' '}<span className="fonte">Scadenzario di direzione</span></div>
    </section>
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

  return (
    <div className={`ckm ckx ${monitor ? 'full' : ''}`} data-testid="cockpit-monitor">
      <header className="ckx-top">
        <div className="brand">
          <img className="logo-l" src="/logo-light.svg" alt="Toscana Diagnostica" /><img className="logo-d" src="/logo-dark.svg" alt="" aria-hidden="true" />
          <h1>Cockpit direzionale</h1>
        </div>
        <div className="quando"><b>{ora(adesso)}</b><span>{dataLunga(adesso)}</span></div>
        <div className="fonti" aria-label="Fonti dei dati">
          {(S?.fonti || []).map((f) => <span key={f.chiave} className={f.ok ? '' : 'ko'} title={`${f.nome}: ${f.testo || ''}`}><i />{f.nome} <em>{dataFonte(f.data)}</em></span>)}
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
      {data && !S && <div className="ckm-load">Schermo non disponibile: aggiornare la Suite.</div>}
      {S?.errore && <div className="ckm-load">{S.errore}</div>}

      {S && !S.errore && (
        <main className="ckx-grid">
          <Riga titolo="Ricavi" area="var(--area-FINANCE)" className="r-ricavi">
            {S.ricavi.map((x) => <Cella key={x.chiave} x={x} grande />)}
          </Riga>
          <Riga titolo="Laboratorio (Synclab)" area="var(--area-OPERATIONS)" className="r-lab">
            <div className="celle">{S.laboratorio.map((x) => <Cella key={x.chiave} x={x} />)}</div>
            <Top5 t={S.top5} />
          </Riga>
          <Riga titolo="Retail B2C" area="var(--area-RETAIL_FLOW)" className="r-retail">
            {S.retail.map((x) => <Cella key={x.chiave} x={x} />)}
          </Riga>
          <Riga titolo="Scadenze e persone" area="var(--area-HQS)" className="r-scad">
            {(S.scadenze || []).map((b) => <Scadenze key={b.key} b={b} />)}
            <div className="persone">{S.persone.map((x) => <Cella key={x.chiave} x={x} />)}</div>
          </Riga>
        </main>
      )}
    </div>
  );
}
