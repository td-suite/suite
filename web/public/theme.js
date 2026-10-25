// Tema prima del primo paint: evita il lampeggio chiaro/scuro (file esterno per rispettare la CSP script-src 'self')
try { var t = localStorage.getItem('td-theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
