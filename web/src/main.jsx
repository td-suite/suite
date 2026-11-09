import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/manrope';
import './styles.css';
import App from './App.jsx';

// Dopo ogni rilascio i file in /assets cambiano nome: una scheda rimasta aperta con la versione precedente, al primo cambio di pagina,
// chiede un chunk che non esiste più ("Failed to fetch dynamically imported module"). Qui si ricarica la pagina una volta sola: il
// browser prende l'index nuovo e i chunk giusti. (Segnalazione del CEO, 09/11/2026: "perché spesso viene fuori questo?")
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const k = 'td-ricaricata-per-rilascio';
  try { if (sessionStorage.getItem(k) === location.href) return; sessionStorage.setItem(k, location.href); } catch { /* storage non disponibile */ }
  location.reload();
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* flag di React Router v7 attivati ora (L16): transizioni di stato e link relativi dentro le route /modulo/* come in v7 */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// PWA: service worker solo in produzione (il dev server di Vite serve i sorgenti)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
