// Pezzi comuni delle pagine del Portale Service: icone del sito (shell.js, stessi tracciati e spessore), piè di pagina del sito
// (footer() di shell.js), stato "da caricare", errori di lettura.
import React from 'react';
import { Link } from 'react-router-dom';
import { Empty, Loading } from '../../../components/ui.jsx';
import { useServizio } from '../index.jsx';
import { base } from '../dati.js';

// Tracciati delle icone di shell.js del sito (viewBox 24, tratto 1,8)
const P = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  folder: 'M3 6h6l2 2h10v11H3z',
  shield: 'M12 3 4 6v6c0 5 3.5 8.3 8 9 4.5-.7 8-4 8-9V6l-8-3z',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  chart: 'M4 20h16M7 16V9M12 16V5M17 16v-4',
  x: 'M6 6l12 12M18 6 6 18',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  book: 'M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14 7 22l5-3 5 3-1.5-8',
  flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7 15h10',
  pin: 'M12 21s-6-5.4-6-11a6 6 0 1 1 12 0c0 5.6-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  // solo nella Suite: "si apre in una scheda nuova"
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
};

/** icon(n, s) del sito: svg senza classe, dimensione in linea se indicata */
export function Ico({ n, s, className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}
      style={s ? { width: s, height: s } : undefined} aria-hidden="true"><path d={P[n] || ''} /></svg>
  );
}

/** footer() di shell.js del sito */
export function Piede({ meta }) {
  if (!meta) return null;
  return (
    <footer className="foot">Toscana Diagnostica S.r.l. · Portale Service di Laboratorio · P. IVA 07528130482 · Via di Pratignone 13/4, 50019 Sesto Fiorentino (FI) · documenti del Sistema di Gestione Integrato, indice REG006 rev. {meta.reg006_rev} del {meta.reg006_data} · pubblicazione del {meta.build} · <a href="https://www.toscanadiagnostica.it" target="_blank" rel="noopener">www.toscanadiagnostica.it</a></footer>
  );
}

/** Caricamento, errore o specchio vuoto: null se i dati ci sono */
export function StatoDati({ st }) {
  const { user } = useServizio();
  if (st.loading) return <div className="page"><Loading /></div>;
  if (!st.error) return null;
  if (st.error.code === 'SPECCHIO_VUOTO' || st.error.status === 404) {
    return (
      <div className="page">
        <Empty icon="import" title="Portale Service da caricare">
          La Suite non ha ancora letto i contenuti del sito service.toscanadiagnostica.it (lo specchio parte all'avvio e ogni 6 ore).
          {user?.editor ? <> Da <Link to={`${base}/impostazioni`}>Impostazioni</Link> puoi provare l'origine, premere "Aggiorna adesso" oppure caricare lo ZIP del repository.</> : ' Riprova tra qualche minuto o avvisa la Qualità (HQS).'}
        </Empty>
      </div>
    );
  }
  return <div className="page"><div className="alert warn">Errore nel caricamento dei dati del portale. {st.error.message}</div></div>;
}

/** Evidenzia la ricerca come hl() del sito (<span class="mark">) */
export function Evid({ t, q }) {
  if (!q) return <>{t}</>;
  const parti = String(t ?? '').split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{parti.map((p, i) => (i % 2 ? <span key={i} className="mark">{p}</span> : p))}</>;
}

/** Casella di ricerca del sito (.searchbox con lente e pulsante "Cancella") */
export function Ricerca({ value, onChange, placeholder, autoFocus, onFocus, inputProps }) {
  return (
    <div className="searchbox">
      <Ico n="search" />
      <input type="text" value={value} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus} onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onChange('')} {...inputProps} />
      <button type="button" className={`iconbtn clear ${value ? 'on' : ''}`} title="Cancella" aria-label="Cancella ricerca" onClick={() => onChange('')}><Ico n="x" s={14} /></button>
    </div>
  );
}
