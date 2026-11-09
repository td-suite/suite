import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import moduleCss from './vite.plugin.modcss.js';
import { readFileSync } from 'node:fs';

// Versione della Suite dentro la build (per capire quando il browser ha una versione vecchia): la stessa di server/src/version.js
// (nel Dockerfile il file viene copiato in web/version.js prima della build; in locale si legge dal server; senza nessuno dei due '0.0.0')
function leggiVersione() {
  for (const f of ['./version.js', '../server/src/version.js']) {
    try { const m = readFileSync(new URL(f, import.meta.url), 'utf8').match(/'(\d+\.\d+\.\d+)'/); if (m) return m[1]; } catch { /* prossimo */ }
  }
  return process.env.APP_VERSION || '0.0.0';
}
const APP_VERSION = leggiVersione();

// Librerie in chunk separati (debug pre-produzione M8): la pagina di login scarica solo React, il router e l'avvio della Suite;
// grafici, mappe, SheetJS, PDF e il visore PDF arrivano solo nelle pagine che li usano (import dinamici e moduli a richiesta)
const CHUNK = [
  ['react', /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
  ['grafici', /node_modules\/(recharts|recharts-scale|react-smooth|d3-[^/]+|victory-vendor|decimal\.js-light|lodash|fast-equals|eventemitter3|tiny-invariant|react-transition-group|dom-helpers|clsx|internmap)\//],
  ['mappe', /node_modules\/leaflet\//],
  ['xlsx', /node_modules\/xlsx\//],
  ['pdf', /node_modules\/(jspdf|jspdf-autotable|html2canvas|canvg)\//],
  ['pdfjs', /node_modules\/pdfjs-dist\//],
];

export default defineConfig({
  plugins: [moduleCss(), react()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,   // l'unico chunk oltre 600 kB è jsPDF (con html2canvas), scaricato solo agli export PDF di Room
    rollupOptions: {
      output: {
        manualChunks(id) {
          // aiutanti di Vite e Rollup usati da tutti (precaricamento dei chunk, interop CommonJS): con l'avvio, mai dentro il chunk
          // di una libreria pesante (altrimenti la pagina di login scaricherebbe anche quella)
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers') || id.includes('vite/modulepreload-polyfill')) return 'react';
          if (!id.includes('node_modules')) return undefined;
          for (const [nome, re] of CHUNK) if (re.test(id)) return nome;
          return undefined;
        },
      },
    },
  },
});
