// "Vedi come profilo" (solo titolare, sola lettura). La vista scelta vive in sessionStorage (si chiude con la scheda o uscendo dal widget)
// e viaggia verso il server nell'intestazione X-Vedi-Come delle sole richieste /api/<widget>/...: il server la accetta solo dal titolare
// e rifiuta ogni modifica (server/src/lib/vediCome.js).
const K = 'td-vedi-come';
export function vistaAttiva() {
  try { const v = JSON.parse(sessionStorage.getItem(K) || 'null'); return v && v.key && v.profile ? v : null; } catch { return null; }
}
export function impostaVista(v) {
  try { if (v) sessionStorage.setItem(K, JSON.stringify(v)); else sessionStorage.removeItem(K); } catch { /* storage non disponibile */ }
  window.dispatchEvent(new Event('suite:vedicome'));
}
const intestazione = (v) => `${v.key}:${v.profile}${v.site_id ? `:${v.site_id}` : ''}`;
// L'utente come lo vede l'interfaccia mentre la vista è attiva: utente ordinario con il solo grant del widget
export function utenteVista(user, v) {
  if (!user || !v || user.level !== 'OWNER') return user;
  return { ...user, level: 'USER', grants: { [v.key]: { profile: v.profile, scopes: v.site_id ? [{ type: 'SITE', id: v.site_id }] : [] } }, vedi_come: v };
}
// Tutte le richieste del widget passano da fetch (client della Suite e client dei moduli): l'intestazione si aggiunge qui, in un punto solo
export function installaVediCome() {
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const v = vistaAttiva();
    if (!v) return orig(input, init);
    let path = '';
    try { path = new URL(typeof input === 'string' ? input : input.url, location.origin); path = path.origin === location.origin ? path.pathname : ''; } catch { path = ''; }
    if (!(path === `/api/${v.key}` || path.startsWith(`/api/${v.key}/`))) return orig(input, init);
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
    headers.set('X-Vedi-Come', intestazione(v));
    return orig(input, { ...init, headers });
  };
}
