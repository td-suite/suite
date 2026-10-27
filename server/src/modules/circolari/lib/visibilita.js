// Perimetro di lettura delle circolari (richiesta del CEO, 27/10/2026): il modulo è aperto a chiunque abbia un account.
// Chi è interno (dipendente, dirigente, libero professionista, medico, sanitario di una società del gruppo) le vede tutte.
// Chi è esterno vede solo le circolari pubblicate del proprio segmento, dedotto dall'anagrafica unica (sede di tipo SERVICE
// o Legal entity CLIENTE → Clienti service; sede PUNTO_PRELIEVI → Punti prelievo; Legal entity PARTNER → Partner) più i
// segmenti delle liste di distribuzione attive in cui compare la sua email. La redazione (ADMIN, PUBBLICATORE, REDATTORE)
// e Owner/Admin della Suite vedono sempre tutto.
import { many } from '../db.js';

const INTERNI = new Set(['DIPENDENTE', 'DIRIGENTE', 'LP', 'MEDICO', 'SANITARIO']);
const GRUPPO = new Set(['GRUPPO', 'SOCIETA']);
const REDAZIONE = new Set(['ADMIN', 'PUBBLICATORE', 'REDATTORE']);

export function isInterno(su) {
  if (!su) return false;
  if (su.level === 'OWNER' || su.level === 'ADMIN') return true;
  if (su.person_kind === 'ESTERNO') return false;
  const orgOk = !su.organization_kind || GRUPPO.has(su.organization_kind);
  return orgOk && (!su.person_kind || INTERNI.has(su.person_kind));
}

// req.suiteUser è l'utente della Suite (hydrateUser), req.user quello del modulo (ruolo)
export async function perimetro(req) {
  const su = req.suiteUser || req.user;
  const role = req.user?.role || req.moduleUser?.role;
  // Interni: tutte le circolari di tutti i segmenti; le bozze solo chi è in redazione
  if (isInterno(su) || REDAZIONE.has(role)) return { tutte: true, bozze: REDAZIONE.has(role), segmenti: null, interno: isInterno(su) };
  const seg = new Set();
  if (su.site_kind === 'SERVICE' || su.organization_kind === 'CLIENTE') seg.add('CLIENTI_SERVICE');
  if (su.site_kind === 'PUNTO_PRELIEVI') seg.add('PUNTI_PRELIEVO');
  if (su.organization_kind === 'PARTNER') seg.add('PARTNER');
  if (su.email) {
    const liste = await many(
      `SELECT DISTINCT l.segmento FROM liste l, jsonb_array_elements(l.destinatari) d
        WHERE l.attiva AND lower(d->>'email') = lower($1)`, [su.email]);
    for (const l of liste) seg.add(l.segmento);
  }
  return { tutte: false, bozze: false, segmenti: [...seg], interno: false };
}

// Condizione SQL da aggiungere alle query sulle circolari; p() registra il parametro e restituisce il segnaposto
export function filtro(per, p) {
  if (per.tutte) return per.bozze ? null : `stato <> 'BOZZA'`;
  if (!per.segmenti.length) return 'FALSE';
  return `(stato = 'PUBBLICATA' AND segmento = ANY(${p(per.segmenti)}))`;
}

export function visibile(per, c) {
  if (per.tutte) return per.bozze || c.stato !== 'BOZZA';
  return c.stato === 'PUBBLICATA' && per.segmenti.includes(c.segmento);
}
