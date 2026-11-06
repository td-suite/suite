// Business Hub · feed dagli altri widget, in sola lettura, per Legal entity (organization_id) dell'account. Il perimetro di ciascun
// modulo resta il suo: NC e Ordini usano la loro chiave unificata (org_id = Legal entity, site_id = sede; i punti SERVICE della
// Legal entity contano come la Legal entity, docs/ANAGRAFICA.md), Ticket il "per conto di" e gli utenti della Legal entity (mai i
// ticket riservati), Circolari il segmento della linea con invii e prese visione degli utenti della Legal entity, Portale gli
// accessi esterni (public.users.is_external) con l'ultimo accesso e l'ultima lettura (read_log). Un modulo non avviato risponde
// { attivo: false } ("widget non attivo"). Cache di 60 secondi per Legal entity e sezione.
// Referti esterni: nessun legame con la Legal entity (i referti sono per paziente e mittente email): la sezione non c'è.
import { many } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { LINEE } from './hub.js';

const TTL = 60_000;
const cache = new Map();
export const svuotaCache = () => cache.clear();

async function moduloAttivo(key) {
  const st = await getModuleState(key);
  return Boolean(st.schema_ready) && ['LIVE', 'MIRROR'].includes(st.mode);
}
async function conCache(k, fn) {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = await fn();
  cache.set(k, { at: Date.now(), v });
  if (cache.size > 2000) for (const [key, x] of cache) if (Date.now() - x.at > TTL) cache.delete(key);
  return v;
}
const sezione = (modulo, orgIds, fn, extra = '') => conCache(`${modulo}:${[].concat(orgIds).join(',')}:${extra}`, async () => {
  if (!(await moduloAttivo(modulo))) return { attivo: false, righe: [] };
  try { return { attivo: true, righe: await fn([].concat(orgIds).map(Number)) }; }
  catch (e) { console.error(`[business] feed ${modulo}:`, e.message); return { attivo: true, errore: 'Lettura non riuscita', righe: [] }; }
});

// Sedi della Legal entity (punti SERVICE e sedi ospitate) per i moduli con chiave unificata
const SEDI_ORG = `SELECT id FROM public.sites WHERE organization_id = ANY($1::int[]) OR host_organization_id = ANY($1::int[])`;
// Utenti della Legal entity (scheda persona o utente)
const UTENTI_ORG = `SELECT u.id FROM public.users u LEFT JOIN public.people p ON p.id = u.person_id WHERE coalesce(p.organization_id, u.organization_id) = ANY($1::int[])`;

export const ncDiOrg = (orgId) => sezione('nc', orgId, (ids) => many(`
  SELECT n.id, n.codice, n.opened_at, n.macro, coalesce(t.label, n.tipo_altro) AS tipo, n.gravita, n.stato, n.sent_at, n.first_response_at,
         n.closed_at, n.sla_due_at, n.ricorrente, s.name AS sede
    FROM nc.nc n LEFT JOIN nc.nc_tipi t ON t.id = n.tipo_id LEFT JOIN public.sites s ON s.id = n.site_id
   WHERE n.org_id = ANY($1::int[]) OR n.site_id IN (${SEDI_ORG})
   ORDER BY n.opened_at DESC LIMIT 200`, [ids]));

export const ordiniDiOrg = (orgId) => sezione('orders', orgId, (ids) => many(`
  SELECT o.id, o.number, o.kind, o.status, o.urgent, o.created_at, o.submitted_at, o.approved_at, ua.full_name AS approvato_da,
         o.picked_at, o.shipped_at, o.delivered_at, o.ddt_number, o.cancelled_at, ur.full_name AS richiesto_da, s.name AS sede,
         CASE WHEN o.approved_at IS NOT NULL AND o.submitted_at IS NOT NULL THEN round(extract(epoch FROM o.approved_at - o.submitted_at) / 3600.0, 1) END AS ore_risposta,
         CASE WHEN o.status = 'INVIATO' AND o.submitted_at IS NOT NULL THEN floor(extract(epoch FROM now() - o.submitted_at) / 86400)::int END AS giorni_in_attesa
    FROM orders.orders o LEFT JOIN orders.users ua ON ua.id = o.approved_by LEFT JOIN orders.users ur ON ur.id = o.requested_by
         LEFT JOIN public.sites s ON s.id = o.site_id
   WHERE o.status <> 'BOZZA' AND (o.org_id = ANY($1::int[]) OR o.site_id IN (${SEDI_ORG}))
   ORDER BY coalesce(o.submitted_at, o.created_at) DESC LIMIT 200`, [ids]));

export const ticketDiOrg = (orgId) => sezione('ticket', orgId, (ids) => many(`
  SELECT t.id, t.protocollo, t.titolo, t.stato, t.priorita, t.created_at, t.prima_risposta_at, t.risolto_at, t.chiuso_at,
         t.sla_risoluzione_sforato, u.full_name AS richiedente
    FROM ticket.tickets t LEFT JOIN public.users u ON u.id = t.richiedente_user_id
   WHERE NOT t.riservato AND (t.per_conto_org_id = ANY($1::int[]) OR t.richiedente_user_id IN (${UTENTI_ORG}))
   ORDER BY t.created_at DESC LIMIT 200`, [ids]));

export const circolariDiOrg = (orgId, linea, emails = []) => sezione('circolari', orgId, (ids) => many(`
  SELECT c.id, c.protocollo, c.titolo, c.segmento, c.published_at,
         EXISTS (SELECT 1 FROM circolari.invii i, jsonb_array_elements(i.destinatari) d WHERE i.circolare_id = c.id AND lower(d->>'email') = ANY($3::text[])) AS inviata,
         (SELECT max(i.inviato_at) FROM circolari.invii i, jsonb_array_elements(i.destinatari) d WHERE i.circolare_id = c.id AND lower(d->>'email') = ANY($3::text[])) AS inviata_at,
         (SELECT count(*)::int FROM circolari.prese_visione pv WHERE pv.circolare_id = c.id AND pv.user_id IN (${UTENTI_ORG})) AS prese_visione,
         (SELECT max(pv.at) FROM circolari.prese_visione pv WHERE pv.circolare_id = c.id AND pv.user_id IN (${UTENTI_ORG})) AS letta_at
    FROM circolari.circolari c
   WHERE c.stato IN ('PUBBLICATA','SUPERATA') AND (c.segmento = $2 OR EXISTS (SELECT 1 FROM circolari.invii i, jsonb_array_elements(i.destinatari) d WHERE i.circolare_id = c.id AND lower(d->>'email') = ANY($3::text[])))
   ORDER BY c.published_at DESC NULLS LAST LIMIT 100`, [ids, LINEE[linea]?.segmento || 'CLIENTI_SERVICE', emails.map((e) => String(e).toLowerCase())]), `${linea}:${emails.join(',')}`);

// Accessi esterni della Legal entity al Portale (nessun modulo da avviare: anagrafica della Suite)
export const portaleDiOrg = (orgId) => conCache(`portale:${orgId}`, async () => ({ attivo: true, righe: await many(`
  SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, (SELECT max(r.at) FROM public.read_log r WHERE r.user_id = u.id) AS ultima_lettura
    FROM public.users u LEFT JOIN public.people p ON p.id = u.person_id
   WHERE u.is_external AND coalesce(p.organization_id, u.organization_id) = $1
   ORDER BY u.last_login_at DESC NULLS LAST, u.full_name`, [Number(orgId)]) }));

// Contatori per il cruscotto: NC aperte e ordini in attesa di risposta sulle Legal entity indicate (clienti attivi)
export async function contatoriFeed(orgIds, giorniOrdini = 3) {
  const ids = [...new Set(orgIds.map(Number))];
  const out = { nc: { attivo: false, aperte: [] }, ordini: { attivo: false, in_attesa: [] } };
  if (!ids.length) return out;
  return conCache(`contatori:${giorniOrdini}:${ids.join(',')}`, async () => {
    if (await moduloAttivo('nc')) {
      out.nc = { attivo: true, aperte: await many(`
        SELECT n.id, n.codice, n.opened_at, n.gravita, n.stato, coalesce(n.org_id, s.organization_id, s.host_organization_id) AS organization_id
          FROM nc.nc n LEFT JOIN public.sites s ON s.id = n.site_id
         WHERE n.stato NOT IN ('CHIUSA','VERIFICATA','ANNULLATA') AND (n.org_id = ANY($1::int[]) OR n.site_id IN (${SEDI_ORG}))
         ORDER BY n.opened_at DESC LIMIT 100`, [ids]).catch(() => []) };
    }
    if (await moduloAttivo('orders')) {
      out.ordini = { attivo: true, soglia_giorni: giorniOrdini, in_attesa: await many(`
        SELECT o.id, o.number, o.submitted_at, o.urgent, coalesce(o.org_id, s.organization_id) AS organization_id,
               floor(extract(epoch FROM now() - o.submitted_at) / 86400)::int AS giorni
          FROM orders.orders o LEFT JOIN public.sites s ON s.id = o.site_id
         WHERE o.status = 'INVIATO' AND (o.org_id = ANY($1::int[]) OR o.site_id IN (SELECT id FROM public.sites WHERE organization_id = ANY($1::int[])))
         ORDER BY o.submitted_at LIMIT 100`, [ids]).catch(() => []) };
    }
    return out;
  });
}
