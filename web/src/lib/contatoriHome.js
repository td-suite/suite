// Contatori dei widget in Home (v0.99.13, review del CEO del 27/11/2026: "le notifiche non tornano").
// REGOLA UNICA: il numero di un widget in Home è la SOMMA dei contatori che l'utente vede nel menu di quel widget, letti dalla stessa
// chiamata che usa il menu (GET /api/<widget>/badges). Così Home e menu non possono più dire due cose diverse: prima la Home aveva
// conteggi propri, scritti a parte, che misuravano altro (Recupero Crediti: Home 0, menu 55 incassi da abbinare; Ordini: Home 5
// "da evadere", menu 0; Gestione del Personale: Home 0, menu 2 scadenze, 25 CV, 1 lettera).
// I widget senza contatori nel menu (Cockpit, SGI, Portale Service, Comunicazione) tengono il numero calcolato dal server.
import { MODULES, vociModulo } from '../modules/registry.js';

/** Voci di menu con contatore visibili all'utente, una per chiave (la stessa chiave può stare su due voci: si conta una volta). */
export function vociConContatore(key, user) {
  const mod = MODULES[key];
  if (!mod) return [];
  const viste = new Set();
  return vociModulo(mod, user).filter((i) => i.badge && !viste.has(i.badge) && viste.add(i.badge));
}

/** Contatore del widget dai contatori del suo menu: { value, label, dettaglio } oppure null se il widget non ha contatori nel menu. */
export function contatoreDaMenu(key, user, badges) {
  const voci = vociConContatore(key, user);
  if (!voci.length || !badges) return null;
  const dettaglio = voci.map((i) => ({ label: i.label, n: Number(badges[i.badge]) || 0 })).filter((x) => x.n > 0);
  const value = dettaglio.reduce((s, x) => s + x.n, 0);
  const label = !dettaglio.length ? 'niente in attesa' : dettaglio.length === 1 ? dettaglio[0].label : dettaglio.map((x) => `${x.label} ${x.n}`).join(', ');
  return { value, label, dettaglio };
}
