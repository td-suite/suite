// Destinatari di una circolare: uno o più segmenti (v0.97.3). Pulsanti a scelta multipla, almeno uno resta sempre selezionato.
import React from 'react';
import { SEGMENTO } from './format.js';

export default function SceltaDestinatari({ value, onChange, disabled = false }) {
  const scelti = Array.isArray(value) && value.length ? value : ['CLIENTI_SERVICE'];
  const cambia = (k) => {
    const n = scelti.includes(k) ? scelti.filter((x) => x !== k) : [...scelti, k];
    if (n.length) onChange(Object.keys(SEGMENTO).filter((x) => n.includes(x)));
  };
  return (
    <div className="circ-dest" role="group" aria-label="Destinatari">
      {Object.entries(SEGMENTO).map(([k, v]) => (
        <button key={k} type="button" className={`circ-dest-b ${scelti.includes(k) ? 'on' : ''}`} aria-pressed={scelti.includes(k)} disabled={disabled} onClick={() => cambia(k)}>
          <span className="circ-dest-q" aria-hidden="true">{scelti.includes(k) ? '✓' : ''}</span>{v}
        </button>
      ))}
    </div>
  );
}
