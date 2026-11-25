// Intestazioni delle tabelle sempre visibili (v0.99.0, richiesta del 25/11/2026: negli elenchi lunghi, scorrendo, si perdeva la riga
// con i nomi delle colonne). Vale per ogni tabella della Suite, in tutti i widget, senza toccare le pagine: a ogni scorrimento la riga
// d'intestazione delle tabelle più alte dello spazio visibile viene spostata (transform sulle celle) così da restare sotto la barra
// della Suite, o in cima al riquadro che scorre (finestre, riquadri con altezza propria). Lo scorrimento orizzontale resta com'è.
// Esclusioni: class "no-sticky" sulla tabella o su un suo contenitore; tabelle senza thead; stampa.
const SELETTORE = 'table';
let attesa = false;

function riquadroCheScorre(el) {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (p.scrollHeight - p.clientHeight > 4) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') return p; }
  }
  return null;
}
function fondoBarra() {
  const b = document.querySelector('.topbar, header.top, .app-top');
  if (!b) return 0;
  const r = b.getBoundingClientRect(); const pos = getComputedStyle(b).position;
  return (pos === 'fixed' || pos === 'sticky') && r.top <= 1 ? Math.max(0, r.bottom) : 0;
}
function ferma(celle, dy) {
  for (const c of celle) {
    if (dy > 0) { c.style.transform = `translateY(${dy}px)`; c.classList.add('th-ferma'); }
    else if (c.classList.contains('th-ferma')) { c.style.transform = ''; c.classList.remove('th-ferma'); }
  }
}
function aggiorna() {
  attesa = false;
  const barra = fondoBarra(); const altezza = window.innerHeight;
  for (const t of document.querySelectorAll(SELETTORE)) {
    const testa = t.tHead; if (!testa || !testa.rows.length) continue;
    const celle = testa.querySelectorAll('th, td');
    if (t.closest('.no-sticky')) { ferma(celle, 0); continue; }
    const r = t.getBoundingClientRect();
    if (r.bottom < 0 || r.top > altezza || r.height < 240) { ferma(celle, 0); continue; }   // fuori vista o tabella corta
    const box = riquadroCheScorre(t);
    const cima = box ? Math.max(box.getBoundingClientRect().top, barra) : barra;
    const hTesta = testa.getBoundingClientRect().height;
    // la riga non scende oltre l'ultima riga della tabella
    const dy = Math.min(Math.max(0, cima - r.top), Math.max(0, r.height - hTesta - 36));
    ferma(celle, Math.round(dy));
  }
}
function chiedi() { if (!attesa) { attesa = true; requestAnimationFrame(aggiorna); } }

export function installaIntestazioni() {
  if (typeof window === 'undefined' || window.__tdIntestazioni) return;
  window.__tdIntestazioni = true;
  window.addEventListener('scroll', chiedi, { capture: true, passive: true });   // capture: anche i riquadri interni che scorrono
  window.addEventListener('resize', chiedi, { passive: true });
  // il contenuto cambia (filtri, righe aggiunte): si ricalcola
  new MutationObserver(chiedi).observe(document.body, { childList: true, subtree: true });
}
