// Rimborso Spese · eccezioni al giustificativo obbligatorio (richiesta del CEO del 13/11/2026: "obbligatoria per tutti TRANNE Epifani, Zezza,
// Malenchini e Corradi, per i quali è facoltativa"). Seme: le persone ATTIVE con quel cognome, SOLO se trovate in anagrafica in modo
// univoco per cognome; altrimenti la voce resta senza persona (person_id NULL) e la Diagnostica D58 lo segnala. Il seme si riprova a ogni
// avvio per le voci non abbinate (l'anagrafica può arrivare dopo); una voce del seme eliminata da P&C non torna (seme_rimossi).
// Da lì in poi le eccezioni le gestiscono P&C e il titolare in Impostazioni.
import { q, one, many } from '../db.js';
import { settings, setSetting, invalidaPerimetro } from './core.js';

export const SEME_COGNOMI = ['Epifani', 'Zezza', 'Malenchini', 'Corradi'];

/** Esito dell'abbinamento per cognome (funzione pura): candidati = persone attive con quel cognome */
export function abbina(cognome, candidati) {
  if (candidati.length === 1) return { person_id: candidati[0].id, nota: `abbinata per cognome a ${candidati[0].last_name} ${candidati[0].first_name}` };
  if (!candidati.length) return { person_id: null, nota: `nessuna persona attiva con cognome ${cognome}` };
  return { person_id: null, nota: `${candidati.length} persone attive con cognome ${cognome}: abbinamento non univoco, da scegliere in Impostazioni` };
}

export async function caricaSemeEccezioni() {
  const s = await settings();
  const rimossi = new Set((s.seme_rimossi || []).map((x) => String(x).toLowerCase()));
  const out = { abbinate: 0, non_abbinate: 0, gia: 0 };
  for (const cognome of SEME_COGNOMI) {
    if (rimossi.has(cognome.toLowerCase())) continue;
    const ex = await one(`SELECT * FROM eccezioni WHERE origine='SEME' AND lower(cognome_seme)=lower($1)`, [cognome]);
    if (ex?.person_id) { out.gia++; continue; }
    const cand = await many(`SELECT id, last_name, first_name FROM public.people WHERE status = 'ATTIVO' AND lower(unaccent(last_name)) = lower(unaccent($1)) ORDER BY id`, [cognome]);
    const a = abbina(cognome, cand);
    // una persona già in eccezione a mano: la voce del seme si considera abbinata senza duplicare
    if (a.person_id && (await one('SELECT 1 FROM eccezioni WHERE person_id=$1', [a.person_id]))) {
      if (ex) await q('DELETE FROM eccezioni WHERE id=$1', [ex.id]);
      out.gia++; continue;
    }
    if (ex) await q('UPDATE eccezioni SET person_id=$2, nota=$3, updated_at=now() WHERE id=$1', [ex.id, a.person_id, a.nota]);
    else await q(`INSERT INTO eccezioni (person_id, cognome_seme, origine, nota) VALUES ($1,$2,'SEME',$3)`, [a.person_id, cognome, a.nota]);
    if (a.person_id) out.abbinate++; else out.non_abbinate++;
  }
  await setSetting('seme_eccezioni', { at: new Date().toISOString(), ...out });
  invalidaPerimetro();
  return out;
}

/** P&C elimina una voce: se è del seme, il cognome non torna più al prossimo avvio */
export async function eliminaEccezione(id) {
  const e = await one('SELECT * FROM eccezioni WHERE id=$1', [id]);
  if (!e) return null;
  await q('DELETE FROM eccezioni WHERE id=$1', [id]);
  if (e.origine === 'SEME' && e.cognome_seme) {
    const s = await settings();
    await setSetting('seme_rimossi', [...new Set([...(s.seme_rimossi || []), e.cognome_seme])]);
  }
  return e;
}
