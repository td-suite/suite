// Guida GIPO · componenti comuni: avviso fisso sui dati dei pazienti, bollino di stato, testo markdown con i collegamenti interni
// (sezione:slug → pagina della guida, aperti con il router), elenco dei risultati della ricerca con evidenziazione.
import React, { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import Markdown from '../../components/Markdown.jsx';
import { sanitizeSnippet } from '../../format.js';
import { base } from './api.js';

export const AVVISO_DATI = 'Non scrivere nomi o dati di pazienti: le domande vengono registrate e lette dalla redazione.';
export function AvvisoDati({ testo }) {
  return <div className="alert warn gg-avviso" role="note"><Icon name="lock" /><span><b>Niente dati dei pazienti.</b> {testo || AVVISO_DATI} Codici fiscali, telefoni ed email vengono rimossi in automatico.</span></div>;
}

export function Bollino({ stato, compatto }) {
  if (stato === 'VALIDATA') return <Badge tone="green" title="Procedura confermata da un referente GIPO">validata</Badge>;
  return <Badge tone="amber" title="Procedura ricavata dall'interfaccia, non ancora confermata da chi usa GIPO ogni giorno">{compatto ? 'da validare' : 'da validare con un referente GIPO'}</Badge>;
}

/** Converte i collegamenti interni [testo](sezione:slug) in percorsi della guida */
export const conLinkGuida = (src) => String(src || '').replace(/\]\(sezione:([a-z0-9-]+)\)/g, `](${base}/guida/$1)`);

/** Markdown della guida: i collegamenti interni si aprono con il router (niente ricaricamento della pagina) */
export function TestoGuida({ source, className = '' }) {
  const navigate = useNavigate();
  const onClick = useCallback((e) => {
    const a = e.target.closest?.('a');
    const href = a?.getAttribute('href');
    if (href && href.startsWith(`${base}/`) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(href); }
  }, [navigate]);
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
  return <div onClick={onClick}><Markdown source={conLinkGuida(source)} className={`gg-md ${className}`} /></div>;
}

export const linkRisultato = (r) => (r.tipo === 'sezione' ? `${base}/guida/${r.slug}` : `${base}/faq?voce=${r.id}`);

export function Risultati({ risultati, vuoto = 'Nessun risultato nella guida.', onApri }) {
  if (!risultati) return null;
  if (!risultati.length) return <div className="gg-vuoto muted"><Icon name="info" /> {vuoto}</div>;
  return (
    <ul className="gg-risultati">
      {risultati.map((r) => (
        <li key={`${r.tipo}-${r.id}`}>
          <Link to={linkRisultato(r)} onClick={onApri}>
            <span className="gg-tipo">{r.tipo === 'faq' ? 'FAQ' : `Sezione${r.capitolo != null ? ` · cap. ${r.capitolo}` : ''}`}</span>
            <span className="gg-tit">{r.titolo}</span>
            {r.stato && r.tipo === 'sezione' && <Bollino stato={r.stato} compatto />}
            {r.snippet && <span className="gg-snip" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export const itDataOra = (s) => (s ? new Date(s).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const itData = (s) => (s ? new Date(s).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '');
export const ESITO = {
  RISPOSTA: { label: 'risposta', tone: 'green' },
  SOLO_RICERCA: { label: 'solo ricerca', tone: 'blue' },
  SENZA_RISPOSTA: { label: 'senza risposta', tone: 'amber' },
};
