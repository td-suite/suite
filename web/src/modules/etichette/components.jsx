// Label · componenti comuni: anteprima di un'etichetta (renderer ZPL condiviso, SVG), avviso di validazione, stato di Browser Print.
import React, { useMemo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { analizzaZpl, svgEtichetta, dotDaMm } from './lib/zpl.js';

/** Anteprima fedele di uno ZPL già riempito: SVG in mm reali scalato alla larghezza indicata (px). */
export function Anteprima({ zpl, modello, larghezza = 300, titolo = 'Anteprima dell\'etichetta' }) {
  const svg = useMemo(() => {
    if (!zpl || !modello) return null;
    const a = analizzaZpl(zpl, { larghezza: dotDaMm(modello.larghezza_mm, modello.dpi), altezza: dotDaMm(modello.altezza_mm, modello.dpi) });
    return a.etichette[0] ? svgEtichetta(a.etichette[0], { dpi: modello.dpi, larghezzaMm: modello.larghezza_mm, altezzaMm: modello.altezza_mm }) : null;
  }, [zpl, modello]);
  if (!svg) return <div className="et-anteprima vuota">Nessuna etichetta</div>;
  // larghezza numerica (px) oppure '100%' (riempie la scheda mantenendo le proporzioni del rotolo)
  const stile = typeof larghezza === 'number' ? { width: larghezza, height: Math.round(larghezza * Number(modello.altezza_mm) / Number(modello.larghezza_mm)) }
    : { width: larghezza, aspectRatio: `${Number(modello.larghezza_mm)} / ${Number(modello.altezza_mm)}` };
  return <div className="et-anteprima" role="img" aria-label={titolo} style={stile} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function AvvisoValidazione({ testo }) {
  if (!testo) return null;
  return <div className="alert warn et-avviso" role="note"><Icon name="alert" /><span><b>{testo}.</b></span></div>;
}

/** Stato di Zebra Browser Print: pronta (verde) o non trovato (ambra) con la guida breve. */
export function StatoZebra({ zebra, onRiprova, onScegli, aperta, setAperta }) {
  if (!zebra) return <span className="et-zebra attesa"><Icon name="refresh" />Cerco Zebra Browser Print…</span>;
  if (zebra.ok && zebra.scelta) {
    return (
      <span className="et-zebra ok">
        <Icon name="check" />Zebra pronta: <b>{zebra.scelta.name}</b>
        {zebra.stampanti.length > 1 && (
          <select aria-label="Stampante Zebra" value={zebra.scelta.uid} onChange={(e) => onScegli(zebra.stampanti.find((s) => s.uid === e.target.value))}>
            {zebra.stampanti.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}
          </select>
        )}
      </span>
    );
  }
  return (
    <span className="et-zebra ko">
      <Icon name="alert" />{zebra.ok ? 'Browser Print attivo ma nessuna stampante Zebra collegata' : 'Browser Print non trovato: installa da zebra.com e riapri'}
      <button type="button" className="btn sm ghost" onClick={onRiprova}><Icon name="refresh" />Riprova</button>
      <button type="button" className="btn sm ghost" onClick={() => setAperta(!aperta)} aria-expanded={aperta}>{aperta ? 'Chiudi la guida' : 'Come si fa'}</button>
    </span>
  );
}

export function GuidaBrowserPrint() {
  return (
    <div className="alert info et-guida-bp">
      <Icon name="info" />
      <ol>
        <li>Installa <b>Zebra Browser Print</b> sul PC della sede (zebra.com, pagina "Browser Print", versione per Windows) e avvialo: l'icona compare vicino all'orologio.</li>
        <li>Collega la Zebra via USB: in Browser Print, "Settings" deve mostrarla come stampante predefinita.</li>
        <li>Solo la prima volta apri <a href="https://127.0.0.1:9101/ssl_support" target="_blank" rel="noreferrer">https://127.0.0.1:9101/ssl_support</a> e accetta il certificato locale.</li>
        <li>Torna qui e premi <b>Riprova</b>: Browser Print chiede se consentire il sito della Suite (Sì) e il browser può chiedere l'accesso ai dispositivi locali (Consenti).</li>
        <li>Nel frattempo puoi stampare con <b>PDF</b>: scegli la Zebra come stampante e "dimensioni effettive".</li>
      </ol>
    </div>
  );
}
