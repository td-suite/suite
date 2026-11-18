// Chi conta per scadenze, obblighi e richiami (regola del CEO del 18/11/2026: "non vanno mai considerate le risorse non attive"):
// una risorsa è IN SERVIZIO se in anagrafica è ATTIVA, ha la posizione in Gestione del Personale (contratto, incarico o tirocinio preso
// in carico: in_hr) e la data di assunzione, se indicata, non è futura. Chi è in impegno, chi deve ancora iniziare e chi è solo in
// anagrafica senza contratto non genera scadenze, non entra negli elenchi di formazione, ECM e medicina del lavoro e non riceve richiami.
// Il datore di lavoro (impostazione datore_lavoro, "Cognome Nome") non è un lavoratore: non ha scadenze di sorveglianza e formazione.
import { many, one } from '../db.js';

const OGGI = `(now() AT TIME ZONE 'Europe/Rome')::date`;
export const inServizioSql = (a = 'r') => `(${a}.status = 'ATTIVO' AND ${a}.in_hr AND (${a}.hired_at IS NULL OR ${a}.hired_at <= ${OGGI}))`;

const piatto = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Nomi (normalizzati, "cognome nome" e "nome cognome") del datore di lavoro dalle impostazioni; più nomi separati da ";" */
export async function datoriLavoro() {
  const v = (await one(`SELECT value FROM app_settings WHERE key = 'datore_lavoro'`).catch(() => null))?.value || '';
  return new Set(String(v).split(/[;\n]/).map(piatto).filter(Boolean));
}
export const eDatore = (r, datori) => datori.size > 0 && (datori.has(piatto(`${r.last_name} ${r.first_name}`)) || datori.has(piatto(`${r.first_name} ${r.last_name}`)));

/** Risorse attive o in impegno in anagrafica che NON sono in servizio, con il motivo: servono a dire chi è rimasto fuori dalle scadenze. */
export async function nonInServizio() {
  const righe = await many(`SELECT r.id, r.last_name, r.first_name, r.kind, r.status, r.in_hr, r.hired_at::text AS hired_at FROM resources_v r
    WHERE r.status IN ('ATTIVO','IMPEGNO') AND NOT ${inServizioSql('r')} ORDER BY r.last_name, r.first_name`);
  return righe.map((r) => ({ id: r.id, nome: `${r.last_name} ${r.first_name}`, kind: r.kind,
    motivo: r.status === 'IMPEGNO' ? 'in impegno, non ancora in servizio' : !r.in_hr ? 'in anagrafica ma senza posizione in Gestione del Personale' : `inizio previsto il ${String(r.hired_at).split('-').reverse().join('/')}` }));
}
