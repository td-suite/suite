// Anteprima della prima pagina di un PDF (planimetria) disegnata con pdf.js, come in Room Planning: niente visualizzatore del browser,
// che in alcuni ambienti non c'è. Clic per aprire il PDF intero.
import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfPreview({ url, maxHeight = 420 }) {
  const cv = useRef(null);
  const wrap = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const buf = await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await pdf.getPage(1);
        if (dead || !cv.current) return;
        const v0 = page.getViewport({ scale: 1 });
        const w = Math.max(240, (wrap.current?.clientWidth || 600) - 2);
        const scale = Math.min(w / v0.width, maxHeight / v0.height) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        cv.current.width = vp.width; cv.current.height = vp.height;
        cv.current.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
        await page.render({ canvasContext: cv.current.getContext('2d'), viewport: vp }).promise;
      } catch (e) { if (!dead) setErr(e); }
    })();
    return () => { dead = true; };
  }, [url, maxHeight]);
  if (err) return <div className="small muted">Anteprima non disponibile: <a href={url} target="_blank" rel="noreferrer">apri il PDF</a></div>;
  return <div ref={wrap}><a href={url} target="_blank" rel="noreferrer" title="Apri il PDF"><canvas ref={cv} className="fa-planimg" /></a></div>;
}
