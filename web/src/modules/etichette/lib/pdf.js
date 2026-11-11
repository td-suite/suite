// Label · PDF di ripiego (Browser Print assente o stampante non raggiungibile): una pagina delle dimensioni dell'etichetta per ogni
// etichetta (e copia), con la STESSA resa dell'anteprima (SVG del renderer condiviso → immagine → jsPDF). Si stampa dal visualizzatore PDF
// scegliendo la Zebra come stampante e "dimensioni effettive" (nessun adattamento alla pagina).
import { analizzaZpl, svgEtichetta, dotDaMm } from './zpl.js';

function svgInPng(svg, larghezza, altezza, scala = 3) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = larghezza * scala; c.height = altezza * scala;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Resa dell\'etichetta non riuscita')); };
    img.src = url;
  });
}

/**
 * Crea il PDF. etichette: [{ zpl }], modello: { larghezza_mm, altezza_mm, dpi }, copie. Ritorna il Blob (application/pdf).
 */
export async function pdfEtichette(etichette, modello, { copie = 1 } = {}) {
  const { jsPDF } = await import('jspdf');
  const w = Number(modello.larghezza_mm), h = Number(modello.altezza_mm), dpi = Number(modello.dpi) || 203;
  const doc = new jsPDF({ unit: 'mm', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait', compress: true });
  let prima = true;
  for (const e of etichette) {
    const a = analizzaZpl(e.zpl, { larghezza: dotDaMm(w, dpi), altezza: dotDaMm(h, dpi) });
    for (const et of a.etichette) {
      const png = await svgInPng(svgEtichetta(et, { dpi, larghezzaMm: w, altezzaMm: h, bordo: false }), et.larghezza, et.altezza);
      for (let k = 0; k < Math.max(1, Number(copie) || 1); k++) {
        if (!prima) doc.addPage([w, h], w >= h ? 'landscape' : 'portrait');
        doc.addImage(png, 'PNG', 0, 0, w, h, undefined, 'FAST');
        prima = false;
      }
    }
  }
  doc.setProperties({ title: 'Etichette provette', creator: 'Suite TD · Label' });
  return doc.output('blob');
}

/** Apre il PDF in una scheda nuova (o lo scarica se il browser blocca l'apertura). */
export function apriPdf(blob, nome = 'etichette.pdf') {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
