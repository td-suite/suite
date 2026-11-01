// Scrivi alla Qualità: sul sito è la voce "Supporto" della barra laterale (mailto a qualita@ con oggetto "[Portale SGI] Richiesta").
// Nella Suite è una pagina con lo stesso indirizzo e oggetto, più l'oggetto precompilato per segnalare un documento. Classi del sito.
import React from 'react';
import { useDati, EMAIL_QUALITA } from '../dati.js';
import { Piede, Ico } from './comuni.jsx';

const mailto = (oggetto, corpo = '') => `mailto:${EMAIL_QUALITA}?subject=${encodeURIComponent(oggetto)}${corpo ? `&body=${encodeURIComponent(corpo)}` : ''}`;

export default function Contatti() {
  const st = useDati('meta');
  const META = st.data?.meta || null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scrivi alla Qualità</h1>
          <div className="sub">Domande sui documenti del Sistema di Gestione Integrato, segnalazioni di errori o di documenti mancanti, richieste di nuove revisioni: scrivi all'Ufficio Qualità.</div>
        </div>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="hd"><h2>Ufficio Qualità</h2></div>
          <div className="bd">
            <div className="doc-title">Ufficio Qualità · Toscana Diagnostica</div>
            <div style={{ marginTop: 6 }}><a href={mailto('[Portale SGI] Richiesta')}><Ico n="mail" s={15} /> {EMAIL_QUALITA}</a></div>
            <div className="row" style={{ marginTop: 14 }}>
              <a className="btn" href={mailto('[Portale SGI] Richiesta')}><Ico n="mail" s={16} /> Scrivi una richiesta</a>
              <a className="btn ghost" href={mailto('[Portale SGI] Segnalazione su un documento', 'Codice del documento (es. TD-SGI-PRO042):\n\nCosa segnalo:\n')}><Ico n="info" s={16} /> Segnala un documento</a>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="hd"><h2>Come si aggiorna il SGI</h2></div>
          <div className="bd small muted">
            <p style={{ marginTop: 0 }}>I documenti si emettono con la routine dell'Ufficio Qualità (indice REG006) e si pubblicano sul sito sgi.toscanadiagnostica.it. La Suite ne mostra la copia conforme: ogni nuova pubblicazione compare qui entro qualche ora, senza doppio inserimento. Per questo nella Suite i documenti non si modificano: le correzioni passano dalla Qualità.</p>
            {META && <p style={{ marginBottom: 0 }}>Pubblicazione in uso: {META.build} · indice REG006 rev. {META.reg006_rev} del {META.reg006_data}.</p>}
          </div>
        </div>
      </div>
      <Piede meta={META} />
    </div>
  );
}
