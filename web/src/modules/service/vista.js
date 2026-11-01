// Vista come Legal entity del personale TD (richiesta del CEO, 01/11/2026): la Legal entity cliente service scelta nel selettore
// "Visualizza come" vive nel query string (?org=<id>, link condivisibile tra colleghi) e in sessionStorage (resta mentre si naviga nel
// portale, solo in questa scheda). Senza scelta: versione standard (Toscana Diagnostica S.r.l.). Gli esterni non la usano mai: il
// server ignora org_id per loro. Modulo senza React: lo legge anche meta.js per la voce "Il mio spazio" del menu.
const CHIAVE = 'td.service.vista';

const nelPortale = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/service');
const idValido = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Legal entity della vista: { id, name } oppure null. Il query string ?org= vince su sessionStorage (?org=0 o vuoto = standard). */
export function vistaCorrente() {
  if (!nelPortale()) return null;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.has('org')) {
      const id = idValido(p.get('org'));
      const salvata = JSON.parse(sessionStorage.getItem(CHIAVE) || 'null');
      return id ? { id, name: salvata?.id === id ? salvata.name : null } : null;
    }
    const v = JSON.parse(sessionStorage.getItem(CHIAVE) || 'null');
    return v && idValido(v.id) ? { id: Number(v.id), name: v.name || null } : null;
  } catch { return null; }
}

/** Salva la vista (null = standard). */
export function salvaVista(v) {
  try {
    if (v && idValido(v.id)) sessionStorage.setItem(CHIAVE, JSON.stringify({ id: Number(v.id), name: v.name || null }));
    else sessionStorage.removeItem(CHIAVE);
  } catch { /* sessionStorage non disponibile: resta il query string */ }
}

/** Personale TD (non esterno) che sta guardando il portale come una Legal entity */
export const inVistaCome = (u) => Boolean(u) && u.is_external === false && Boolean(vistaCorrente());
