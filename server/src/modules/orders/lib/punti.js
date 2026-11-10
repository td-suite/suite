// Punto di consegna degli ordini delle Legal entity cliente con più sedi SERVICE (v0.68.3, richiesta del CEO del 10/11/2026: Kos S.p.A.
// con Ville di Nozzano e Villa dei Pini). Regola che resta (decisione A4): ordine, giacenza, produzione e dotazione stanno sulla Legal
// entity; il punto dice solo DOVE consegnare (orders.delivery_site_id) e quale destinazione Silva usare.
//   - 0 punti attivi: nessun campo, consegna all'indirizzo della Legal entity (come prima);
//   - 1 punto attivo: preselezionato (e usato se l'ordine non lo indica);
//   - 2 o più: obbligatorio alla creazione dal catalogo e all'approvazione; Ops può cambiarlo fino alla trasmissione a Silva.
// L'utente del cliente con perimetro su alcune sedi della Legal entity (ambito del grant) sceglie solo tra quelle.
import { one, many } from '../db.js';
import { bad } from './util.js';

const COLS = `p.id, p.code, p.name, p.address, p.zip, p.city, p.province, p.studiolab_code, p.silva_code, p.delivery_notes, p.delivery_mode, p.configured, p.active, p.organization_id`;

/** Punti SERVICE attivi della Legal entity della struttura (chiave negativa della vista strutture_v); [] per le sedi TD */
export async function puntiAttivi(strutturaId) {
  if (!(Number(strutturaId) < 0)) return [];
  return many(`SELECT ${COLS} FROM strutture_v p WHERE p.origin='SITE' AND p.delivery_point AND p.active AND p.organization_id=$1 ORDER BY p.sort_order, p.name`, [-Number(strutturaId)]);
}

/** Un punto (anche disattivato) per id, con la Legal entity */
export async function puntoById(siteId) {
  if (!siteId) return null;
  return one(`SELECT ${COLS}, l.name AS organization_name FROM strutture_v p LEFT JOIN strutture_v l ON l.origin='ORG' AND l.org_id=p.organization_id
    WHERE p.id=$1 AND p.origin='SITE' AND p.delivery_point`, [Number(siteId)]);
}

/** Punti che l'utente può scegliere: per i profili di struttura con sedi della Legal entity nell'ambito del grant, solo quelle */
export function puntiDellUtente(user, punti, ops) {
  if (ops) return punti;
  const mie = (user?.site_ids || []).map(Number);
  const nel = punti.filter((p) => mie.includes(p.id));
  return nel.length ? nel : punti;
}

/** Elenco per il form "Consegnare a": punti scelti, obbligatorietà e preselezione */
export async function opzioniPunto(user, strutturaId, ops) {
  const tutti = await puntiAttivi(strutturaId);
  const punti = puntiDellUtente(user, tutti, ops);
  return {
    punti: punti.map((p) => ({ id: p.id, code: p.code, name: p.name, address: p.address, zip: p.zip, city: p.city, province: p.province, ...(ops ? { silva_code: p.silva_code } : {}) })),
    totale: tutti.length,
    obbligatorio: punti.length >= 2,
    preselezionato: punti.length === 1 ? punti[0].id : null,
  };
}

/**
 * Punto di consegna da salvare sull'ordine. richiesto = la scelta è obbligatoria con 2 o più punti (catalogo, approvazione);
 * false per la Dotazione di avvio (si indica all'approvazione). Ritorna l'id del punto o null; 400 se il punto non va bene.
 */
export async function risolviPunto(user, struttura, deliverySiteId, { ops = false, richiesto = true } = {}) {
  const tutti = struttura?.origin === 'ORG' ? await puntiAttivi(struttura.id) : [];
  const id = deliverySiteId ? Number(deliverySiteId) : null;
  if (id) {
    if (struttura?.origin !== 'ORG') throw bad(`${struttura?.name || 'La struttura'} è una sede TD: il punto di consegna si indica solo per le Legal entity cliente con sedi service`);
    const p = tutti.find((x) => x.id === id);
    if (!p) throw bad(`Il punto di consegna scelto non è un punto attivo di ${struttura.name}`);
    if (!puntiDellUtente(user, tutti, ops).some((x) => x.id === id)) throw bad(`Il punto ${p.name} non è nel tuo perimetro: scegli tra le sedi assegnate`);
    return id;
  }
  const scelti = puntiDellUtente(user, tutti, ops);
  if (scelti.length === 1) return scelti[0].id;
  if (scelti.length >= 2 && richiesto) throw bad(`Indica il punto di consegna: ${struttura.name} ha ${scelti.length} sedi service attive (${scelti.map((x) => x.name).join(', ')})`);
  return null;
}

/** Etichetta "Legal entity · punto" (ordini, PDF, email, export) */
export const etichetta = (strutturaName, puntoName) => (puntoName ? `${strutturaName} · ${puntoName}` : strutturaName);
