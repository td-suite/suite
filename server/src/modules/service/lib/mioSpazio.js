// "Il mio spazio" del Portale Service (richiesta del CEO, 01/11/2026): per il solo accesso esterno Cliente service, in un'unica risposta
// ciò che riguarda la sua Legal entity letto dai widget della Suite: non conformità aperte, ordini in corso, circolari recenti del
// segmento Clienti service con presa visione, ticket aperti dall'utente. Il cliente apre il widget (scheda nuova) solo per agire.
//
// Isolamento: nessuna regola di accesso è riscritta qui. Per ogni sezione si costruisce l'utente del modulo con la stessa funzione
// e le stesse opzioni del modulo (moduleUser + OPZIONI_UTENTE) e si applica il perimetro del modulo:
// - NC: perimetroSedi (scope ORG = la Legal entity, punti SERVICE → Legal entity) + perimetroSedeSql (comunicate, non annullate);
// - Ordini: strutturaDiUtente (struttura dell'ambito del grant: la Legal entity) e solo profili di struttura;
// - Circolari: perimetro/filtro di lib/visibilita.js (segmenti dell'utente) e in più segmento CLIENTI_SERVICE;
// - Ticket: userContext/visibleSql del modulo e in più richiedente = l'utente.
// Se il modulo non è avviato o l'utente non ha il grant, la sezione è { disponibile: false }.
//
// Vista come Legal entity (personale TD, richiesta del CEO 01/11/2026: "se ci clicca un utente di TD, fai scegliere con quale legal entity
// visualizzare"): stesse letture parametrizzate sull'organizzazione invece che sull'utente (mioSpazioVista). Il perimetro del cliente
// si ricava con le stesse funzioni dei moduli applicate a un ambito ORG sulla Legal entity; in più ogni sezione rispetta i grant
// dell'utente TD (sezioneVistaNegata: senza grant "widget non assegnato"; Owner e Admin vedono tutto) e il suo perimetro nel widget.
import { getModuleState, moduleUser } from '../../../lib/modules.js';
import { OPZIONI_UTENTE as OPZ_NC } from '../../nc/index.js';
import { OPZIONI_UTENTE as OPZ_ORDERS } from '../../orders/index.js';
import { OPZIONI_UTENTE as OPZ_CIRC } from '../../circolari/index.js';
import { OPZIONI_UTENTE as OPZ_TICKET } from '../../ticket/index.js';
import * as ncDb from '../../nc/db.js';
import { perimetroSedi } from '../../nc/lib/sedi.js';
import { perimetroSedeSql, isSede } from '../../nc/lib/access.js';
import { APERTE as NC_APERTE, STATO_LABEL as NC_STATO } from '../../nc/lib/nc.js';
import * as ordDb from '../../orders/db.js';
import { strutturaDiUtente, STRUTTURA_ROLES } from '../../orders/lib/access.js';
import * as circDb from '../../circolari/db.js';
import { perimetro, filtro } from '../../circolari/lib/visibilita.js';
import * as tkDb from '../../ticket/db.js';
import { userContext, visibleSql } from '../../ticket/lib/access.js';
import { STATO_LABEL as TK_STATO } from '../../ticket/lib/core.js';
import { many as manyCore } from '../../../db.js';
import { isAdmin } from '../../../lib/access.js';
import { faseOrdine, statiOrdiniInCorso, conteggiPer, componiKpi, sezioneVistaNegata } from './mioSpazioRegole.js';

// ---------------------------------------------------------------- letture (per sezione, con il perimetro del modulo)

const NON_DISPONIBILE = (motivo) => ({ disponibile: false, motivo });

// Modulo avviato (MIRROR o LIVE con schema) e utente del modulo costruito come nel modulo: altrimenti null con il motivo
async function utenteModulo(key, su, opzioni) {
  const st = await getModuleState(key);
  if (st.mode === 'OFF' || !st.schema_ready) return { motivo: 'Modulo non ancora avviato nella Suite' };
  try { return { mu: await moduleUser(key, su, opzioni) }; }
  catch (e) { if (e.status === 403) return { motivo: 'Modulo non assegnato al tuo accesso' }; throw e; }
}

export async function sezioneNc(su) {
  const { mu, motivo } = await utenteModulo('nc', su, OPZ_NC);
  if (!mu) return NON_DISPONIBILE(motivo);
  if (!isSede(mu)) return NON_DISPONIBILE('Profilo NC diverso da Sede');   // solo il perimetro di sede, mai l'elenco completo
  return ncAperte(await perimetroSedi(su));
}

// NC aperte delle sedi invianti indicate (chiavi unificate), con il filtro di sede del modulo (comunicate, non annullate)
async function ncAperte(sedi) {
  const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [...perimetroSedeSql(sedi, p), `n.stato = ANY(${p(NC_APERTE)}::text[])`];
  const rows = await ncDb.many(`SELECT n.id, n.codice, n.opened_at, n.sent_at, n.macro, n.gravita, n.stato, n.sla_due_at, coalesce(t.label, n.tipo_altro) AS tipo, s.nome AS sede
      FROM nc n JOIN sedi_v s ON s.id = n.sede_id LEFT JOIN nc_tipi t ON t.id = n.tipo_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE n.stato WHEN 'INVIATA_SEDE' THEN 0 WHEN 'RISPOSTA_SEDE' THEN 1 ELSE 2 END, n.opened_at DESC`, params);
  return {
    disponibile: true, totale: rows.length, per_stato: conteggiPer(rows, 'stato'), etichette_stato: NC_STATO,
    righe: rows.slice(0, 50).map((n) => ({ id: n.id, numero: n.codice, data: n.opened_at, tipo: n.tipo, macro: n.macro, gravita: n.gravita, stato: n.stato, stato_label: NC_STATO[n.stato] || n.stato, sede: n.sede, sla_scaduta: n.stato === 'INVIATA_SEDE' && n.sla_due_at && new Date(n.sla_due_at) < new Date(), link: `/nc/nc/${n.id}` })),
    link: '/nc/nc',
  };
}

export async function sezioneOrdini(su) {
  const { mu, motivo } = await utenteModulo('orders', su, OPZ_ORDERS);
  if (!mu) return NON_DISPONIBILE(motivo);
  if (!STRUTTURA_ROLES.includes(mu.role)) return NON_DISPONIBILE('Profilo Ordini diverso da Cliente');   // i profili Operations vedono tutto: mai qui
  return ordiniStruttura(await strutturaDiUtente(mu, su));
}

// Ordini in corso di una struttura (chiave di strutture_v: < 0 Legal entity)
async function ordiniStruttura(struttura) {
  if (struttura == null) return { disponibile: true, totale: 0, per_fase: {}, righe: [], struttura: null, link: '/orders/ordini', nota: 'Nessuna struttura collegata al tuo accesso' };
  const s = await ordDb.one('SELECT id, name, code, kind FROM strutture_v WHERE id=$1', [struttura]);
  if (!s) return { disponibile: true, totale: 0, per_fase: {}, righe: [], struttura: null, link: '/orders/ordini', nota: 'Struttura non trovata' };
  const rows = await ordDb.many(`SELECT o.id, o.number, o.created_at, o.submitted_at, o.status, o.urgent, o.ddt_number, st.name AS struttura
      FROM orders o JOIN strutture_v st ON st.id = o.struttura_id
     WHERE o.struttura_id = $1 AND o.status = ANY($2::text[]) ORDER BY o.created_at DESC`, [s.id, statiOrdiniInCorso(s.kind)]);
  const righe = rows.map((o) => { const f = faseOrdine(o.status, s.kind); return { id: o.id, numero: o.number, data: o.submitted_at || o.created_at, stato: o.status, fase: f.n, fase_label: f.label, urgente: o.urgent, ddt: o.ddt_number, struttura: o.struttura, link: `/orders/ordini/${o.id}` }; });
  return { disponibile: true, totale: righe.length, per_fase: conteggiPer(righe, 'fase_label'), righe: righe.slice(0, 50), struttura: { name: s.name, code: s.code }, link: '/orders/ordini' };
}

export async function sezioneCircolari(su) {
  const { mu, motivo } = await utenteModulo('circolari', su, OPZ_CIRC);
  if (!mu) return NON_DISPONIBILE(motivo);
  const per = await perimetro({ suiteUser: su, user: mu });
  const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
  const fv = filtro(per, p);
  const uid = p(su.id);
  // il filtro del modulo usa le colonne senza alias (stato, segmento): esistono solo in circolari, nessuna ambiguità con prese_visione
  const where = [`c.stato = 'PUBBLICATA'`, `c.segmento = 'CLIENTI_SERVICE'`, ...(fv ? [fv] : [])];
  const w = where.join(' AND ');
  const rows = await circDb.many(`SELECT c.id, c.protocollo, c.titolo, c.data, c.published_at, pv.at AS presa_visione_at
      FROM circolari c LEFT JOIN prese_visione pv ON pv.circolare_id = c.id AND pv.user_id = ${uid}
     WHERE ${w} ORDER BY c.published_at DESC NULLS LAST, c.id DESC LIMIT 10`, params);
  const n = await circDb.one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prese_visione pv WHERE pv.circolare_id = c.id AND pv.user_id = ${uid}))::int AS da_leggere
      FROM circolari c WHERE ${w}`, params);
  return {
    disponibile: true, totale: n.totale, da_leggere: n.da_leggere,
    righe: rows.map((c) => ({ id: c.id, protocollo: c.protocollo, titolo: c.titolo, data: c.published_at || c.data, presa_visione: Boolean(c.presa_visione_at), presa_visione_at: c.presa_visione_at, link: `/circolari/${c.id}` })),
    link: '/circolari/archivio',
  };
}

export async function sezioneTicket(su) {
  const { mu, motivo } = await utenteModulo('ticket', su, OPZ_TICKET);
  if (!mu) return NON_DISPONIBILE(motivo);
  const ctx = await userContext({ user: su, moduleUser: mu });
  const params = [su.id];
  const vis = visibleSql(ctx, params);
  const rows = await tkDb.many(`SELECT t.id, t.protocollo, t.titolo, t.stato, t.priorita, t.created_at FROM tickets t
     WHERE t.richiedente_user_id = $1 AND t.stato NOT IN ('CHIUSO','ANNULLATO') AND ${vis} ORDER BY t.created_at DESC`, params);
  return {
    disponibile: true, totale: rows.length, per_stato: conteggiPer(rows, 'stato'), etichette_stato: TK_STATO,
    righe: rows.slice(0, 50).map((t) => ({ id: t.id, numero: t.protocollo, oggetto: t.titolo, stato: t.stato, stato_label: TK_STATO[t.stato] || t.stato, priorita: t.priorita, data: t.created_at, link: `/ticket/${t.id}` })),
    link: '/ticket/miei',
  };
}

// ---------------------------------------------------------------- vista come Legal entity (personale TD)

// Grant dell'utente TD sul widget (Owner e Admin: tutto) e utente del modulo per il suo perimetro
async function utenteModuloVista(key, su, opzioni) {
  const negata = sezioneVistaNegata({ admin: isAdmin(su), grant: su.grants?.[key] });
  if (negata) return { negata };
  const { mu, motivo } = await utenteModulo(key, su, opzioni);
  return mu ? { mu } : { negata: NON_DISPONIBILE(motivo) };
}
// Il cliente visto dal modulo: un ambito ORG sulla sua Legal entity (come il grant del profilo Cliente service)
const clienteComeUtente = (orgId) => ({ grants: { nc: { scopes: [{ type: 'ORG', id: orgId }] } }, org_ids: [orgId] });
// Accessi esterni della Legal entity (utenti collegati all'organizzazione, livello USER)
const accessiOrg = async (orgId) => (await manyCore(`SELECT DISTINCT u.id FROM users u LEFT JOIN people p ON p.id = u.person_id
    WHERE coalesce(p.organization_id, u.organization_id) = $1 AND u.level = 'USER'`, [orgId])).map((r) => r.id);

export async function vistaNc(su, orgId) {
  const { mu, negata } = await utenteModuloVista('nc', su, OPZ_NC);
  if (negata) return negata;
  let sedi = await perimetroSedi(clienteComeUtente(orgId));
  // un utente TD con profilo Sede vede nel widget solo le sue sedi: la vista non va oltre
  if (isSede(mu)) { const mie = new Set(await perimetroSedi(su)); sedi = sedi.filter((x) => mie.has(x)); }
  return ncAperte(sedi);
}

export async function vistaOrdini(su, orgId) {
  const { mu, negata } = await utenteModuloVista('orders', su, OPZ_ORDERS);
  if (negata) return negata;
  const struttura = await strutturaDiUtente({ role: 'CLIENTE', site_ids: [] }, clienteComeUtente(orgId));
  // profili di struttura del personale (Sede, Lab): nel widget vedono solo la loro struttura
  if (STRUTTURA_ROLES.includes(mu.role) && (await strutturaDiUtente(mu, su)) !== struttura) return NON_DISPONIBILE('Legal entity fuori dal perimetro del tuo widget Ordini');
  return ordiniStruttura(struttura);
}

export async function vistaCircolari(su, orgId) {
  const { mu, negata } = await utenteModuloVista('circolari', su, OPZ_CIRC);
  if (negata) return negata;
  const per = await perimetro({ suiteUser: su, user: mu });
  const accessi = await accessiOrg(orgId);
  const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
  const fv = filtro(per, p);
  const ids = p(accessi);
  const w = [`c.stato = 'PUBBLICATA'`, `c.segmento = 'CLIENTI_SERVICE'`, ...(fv ? [fv] : [])].join(' AND ');
  // presa visione = lettori tra gli accessi esterni della Legal entity (mai quella dell'utente TD)
  const lettori = `(SELECT count(*)::int FROM prese_visione pv WHERE pv.circolare_id = c.id AND pv.user_id = ANY(${ids}::int[]))`;
  const rows = await circDb.many(`SELECT c.id, c.protocollo, c.titolo, c.data, c.published_at, ${lettori} AS lettori
      FROM circolari c WHERE ${w} ORDER BY c.published_at DESC NULLS LAST, c.id DESC LIMIT 10`, params);
  const n = await circDb.one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE ${lettori} = 0)::int AS da_leggere FROM circolari c WHERE ${w}`, params);
  return {
    disponibile: true, totale: n.totale, da_leggere: n.da_leggere, accessi: accessi.length, vista: true,
    righe: rows.map((c) => ({ id: c.id, protocollo: c.protocollo, titolo: c.titolo, data: c.published_at || c.data, lettori: c.lettori, accessi: accessi.length, presa_visione: c.lettori > 0, link: `/circolari/${c.id}` })),
    link: '/circolari/archivio',
  };
}

export async function vistaTicket(su, orgId) {
  const { mu, negata } = await utenteModuloVista('ticket', su, OPZ_TICKET);
  if (negata) return negata;
  const ctx = await userContext({ user: su, moduleUser: mu });
  const accessi = await accessiOrg(orgId);
  const params = [accessi];
  const vis = visibleSql(ctx, params);   // il perimetro dell'utente TD nel widget Ticket
  const rows = await tkDb.many(`SELECT t.id, t.protocollo, t.titolo, t.stato, t.priorita, t.created_at, ru.full_name AS richiedente FROM tickets t
      JOIN public.users ru ON ru.id = t.richiedente_user_id
     WHERE t.richiedente_user_id = ANY($1::int[]) AND t.stato NOT IN ('CHIUSO','ANNULLATO') AND ${vis} ORDER BY t.created_at DESC`, params);
  return {
    disponibile: true, totale: rows.length, per_stato: conteggiPer(rows, 'stato'), etichette_stato: TK_STATO, vista: true,
    righe: rows.slice(0, 50).map((t) => ({ id: t.id, numero: t.protocollo, oggetto: t.titolo, stato: t.stato, stato_label: TK_STATO[t.stato] || t.stato, priorita: t.priorita, data: t.created_at, richiedente: t.richiedente, link: `/ticket/${t.id}` })),
    link: '/ticket',
  };
}

// Una sezione che va in errore non deve far cadere le altre: { disponibile: false } con il motivo (e il log nel server)
async function sicura(nome, fn) {
  try { return await fn(); } catch (e) { console.error(`[service:mio-spazio] ${nome}: ${e.message}`); return NON_DISPONIBILE('Lettura non riuscita'); }
}

// ---------------------------------------------------------------- cache per utente (60 s)
const CACHE_MS = 60_000;
const cache = new Map();   // chiave: 'u:<id utente>' (cliente) oppure 'v:<id utente>:<id Legal entity>' (vista TD) → { at, dati }
export const svuotaCacheMioSpazio = () => cache.clear();
function dallaCache(k, orgId) {
  const hit = cache.get(k);
  return hit && Date.now() - hit.at < CACHE_MS && hit.dati.legal_entity.id === orgId ? { ...hit.dati, da_cache: true } : null;
}
function inCache(k, dati) {
  cache.set(k, { at: Date.now(), dati });
  if (cache.size > 2000) for (const [kk, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(kk);
  return { ...dati, da_cache: false };
}

/** Vista come Legal entity per il personale TD (cs = organizzazioneClienteService(orgId), già verificata dal chiamante). */
export async function mioSpazioVista(su, cs, { rinnova = false } = {}) {
  const orgId = cs.org.id;
  const k = `v:${su.id}:${orgId}`;
  const hit = !rinnova && dallaCache(k, orgId);
  if (hit) return hit;
  const [nc, ordini, circolari, ticket] = await Promise.all([
    sicura('nc', () => vistaNc(su, orgId)), sicura('ordini', () => vistaOrdini(su, orgId)), sicura('circolari', () => vistaCircolari(su, orgId)), sicura('ticket', () => vistaTicket(su, orgId)),
  ]);
  const dati = { vista: true, legal_entity: cs.org, punti_service: cs.sedi_service, kpi: componiKpi({ nc, ordini, circolari, ticket }), nc, ordini, circolari, ticket, letto_at: new Date().toISOString() };
  return inCache(k, dati);
}

/** Riepilogo completo per un Cliente service (cs = clienteService(su), già verificato dal chiamante). */
export async function mioSpazio(su, cs, { rinnova = false } = {}) {
  const k = `u:${su.id}`;
  const hit = !rinnova && dallaCache(k, cs.org.id);
  if (hit) return hit;
  const [nc, ordini, circolari, ticket] = await Promise.all([
    sicura('nc', () => sezioneNc(su)), sicura('ordini', () => sezioneOrdini(su)), sicura('circolari', () => sezioneCircolari(su)), sicura('ticket', () => sezioneTicket(su)),
  ]);
  const dati = { legal_entity: cs.org, punti_service: cs.sedi_service, kpi: componiKpi({ nc, ordini, circolari, ticket }), nc, ordini, circolari, ticket, letto_at: new Date().toISOString() };
  return inCache(k, dati);
}
