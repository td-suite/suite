// Pagina pubblica /informativa-ia (leggibile anche senza login): Informativa sull'uso dell'intelligenza artificiale nella Suite TD.
// Il testo sta in informativaIATesto.js (fonte unica anche del DOCX da pubblicare sul sito). Montata in App.jsx prima di ogni controllo
// di accesso, così il link della presa d'atto si apre anche in una scheda nuova mentre la presa d'atto è ancora da fare.
import React, { useEffect } from 'react';
import { Logo } from '../components/ui.jsx';
import { TITOLO, SEZIONI, NOTA_VERSIONE } from './informativaIATesto.js';

export default function InformativaIA() {
  useEffect(() => { const t = document.title; document.title = `${TITOLO} · Toscana Diagnostica`; return () => { document.title = t; }; }, []);
  return (
    <div className="informativa">
      <article className="informativa-doc">
        <Logo className="logo" />
        <h1>{TITOLO}</h1>
        {SEZIONI.map((s) => (
          <section key={s.titolo}>
            <h2>{s.titolo}</h2>
            {s.paragrafi.map((p, i) => <p key={i}>{p}</p>)}
          </section>
        ))}
        <p className="versione">{NOTA_VERSIONE}</p>
      </article>
    </div>
  );
}
