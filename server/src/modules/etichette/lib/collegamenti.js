// Lab Control (v0.71.0) · collegamenti fra i widget: "TUTTO interconnesso" (CEO 12/11/2026). API interna riusabile:
//   collegamenti(user, { client: { instance_id, client_id } })   → Business Hub, Retail, Listino del gestionale, Ordini, NC del cliente,
//                                                                    Accettazioni in Lab Control (e "Abbina" se il client non è abbinato)
//   collegamenti(user, { site: id })                              → Lab Control filtrato, Retail (Laboratorio in sede), Ordini, scheda sede
//   collegamenti(user, { request: { instance_id, id } })          → scheda Lab Control, Etichetta (Label), Desk NC
//   linkPrincipali(user, clients)                                 → per un elenco: il link del clic semplice sul nome (Business Hub)
//   linkLabControl(user, filtro)                                  → il link inverso "Accettazioni in Lab Control" (Business Hub, Retail, NC)
// Ogni voce: { chiave, etichetta, href, attivo, motivo }: i link si costruiscono QUI, lato server, verificando che il modulo di arrivo sia
// LIVE e che l'utente ne abbia il grant (Owner e Admin della Suite: sempre); altrimenti la voce resta, disattivata, con il motivo.
// user = utente della Suite (req.user del core: level, grants). Nessun dato del paziente nei link.
import { one, many } from '../../../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { ripartizioneClienti } from '../../../lib/synclab/letture.js';

const NOMI = { business: 'Business Hub', retail: 'Retail', orders: 'Ordini', nc: 'Non conformità', etichette: 'Lab Control' };
const suiteAdmin = (u) => u?.level === 'OWNER' || u?.level === 'ADMIN';

/** Disponibilità di un modulo per l'utente: { attivo, motivo }. stati = cache { key: mode }. */
export async function disponibile(user, key, stati = {}) {
  if (!(key in stati)) stati[key] = (await getModuleState(key).catch(() => ({ mode: 'OFF' }))).mode;
  if (stati[key] !== 'LIVE') return { attivo: false, motivo: `${NOMI[key] || key} non è attivo nella Suite` };
  if (!suiteAdmin(user) && !user?.grants?.[key]) return { attivo: false, motivo: `Non hai accesso a ${NOMI[key] || key}: chiedilo all'amministratore` };
  return { attivo: true, motivo: null };
}
const voce = (chiave, etichetta, href, d, extra = {}) => {
  if (!d.attivo) return { chiave, etichetta, href: null, attivo: false, motivo: d.motivo };
  if (!href) return { chiave, etichetta, href: null, attivo: false, motivo: extra.motivo || 'Collegamento non disponibile' };
  return { chiave, etichetta, href, attivo: true, motivo: null };
};

async function tabella(nome) { return Boolean((await one(`SELECT to_regclass($1) IS NOT NULL AS ok`, [nome]))?.ok); }

/** Account del Business Hub per Legal entity: Map org → [{ id, linea }] (una query). */
export async function accountsPerOrg(orgIds) {
  const m = new Map();
  const ids = [...new Set(orgIds.filter((x) => x != null).map(Number))];
  if (!ids.length || !(await tabella('business.accounts'))) return m;
  for (const a of await many(`SELECT id, organization_id, linea FROM business.accounts WHERE organization_id = ANY($1::int[]) ORDER BY organization_id, (linea = 'SRV') DESC, (linea = 'MDL') DESC, id`, [ids])) {
    if (!m.has(a.organization_id)) m.set(a.organization_id, []);
    m.get(a.organization_id).push({ id: a.id, linea: a.linea });
  }
  return m;
}
const LINEE = { SRV: 'Service', PP: 'Punto prelievi', MDL: 'Medicina del lavoro' };

/** Voce "Business Hub" di un client: account unico, più account (elenco), Legal entity senza account, client da abbinare. */
function voceBusiness(user, c, accounts, d) {
  if (!c?.organization_id) {
    const href = `/admin/connectors/synclab?tab=clienti&q=${encodeURIComponent(c?.client_code || c?.cliente || '')}`;
    return suiteAdmin(user) ? { chiave: 'abbina', etichetta: 'Abbina a una Legal entity', href, attivo: true, motivo: 'Client del gestionale non abbinato: si abbina in Amministrazione > Clienti Synclab', da_abbinare: true }
      : { chiave: 'abbina', etichetta: 'Abbina a una Legal entity', href: null, attivo: false, motivo: 'Client del gestionale non abbinato a una Legal entity: l\'abbinamento lo fa un amministratore della Suite', da_abbinare: true };
  }
  const acc = accounts.get(Number(c.organization_id)) || [];
  if (!d.attivo) return voce('business', 'Business Hub', null, d);
  if (acc.length === 1) return voce('business', 'Business Hub', `/business/account/${acc[0].id}`, d);
  if (acc.length > 1) return { chiave: 'business', etichetta: 'Business Hub', href: `/business/account/${acc[0].id}`, attivo: true, motivo: null, opzioni: acc.map((a) => ({ etichetta: `Business Hub · ${LINEE[a.linea] || a.linea}`, href: `/business/account/${a.id}` })) };
  return { chiave: 'business', etichetta: 'Legal entity (nessun account nel Business Hub)', href: `/organizations/${c.organization_id}`, attivo: true, motivo: null };
}

/** Clic semplice sul nome del cliente in un elenco: Map 'instance|client' → { href, titolo } (Business Hub, o Abbina). */
export async function linkPrincipali(user, clients) {
  const stati = {};
  const d = await disponibile(user, 'business', stati);
  const accounts = await accountsPerOrg(clients.map((c) => c.organization_id));
  const out = new Map();
  for (const c of clients) {
    const v = voceBusiness(user, c, accounts, d);
    out.set(`${c.instance_id}|${c.client_id}`, { href: v.attivo ? v.href : null, titolo: v.attivo ? v.etichetta : v.motivo, da_abbinare: Boolean(v.da_abbinare) });
  }
  return out;
}

/** Riga di clients_td con sede e ripartizione (Laboratorio in sede / B2B, regola di Retail) di un client. */
async function client(instanceId, clientId) {
  const privati = await (async () => {
    if (!(await tabella('retail.app_settings'))) return true;
    const r = await one(`SELECT value FROM retail.app_settings WHERE key = 'synclab_privati_in_b2c'`).catch(() => null);
    return !(r && String(r.value).trim().toLowerCase() === 'false');
  })();
  const tutti = await ripartizioneClienti({ privatiInB2c: privati });
  const c = tutti.find((x) => x.instance_id === instanceId && x.client_id === clientId) || tutti.find((x) => x.client_id === clientId);
  if (!c) return null;
  const pl = await one(`SELECT price_list_id, extra_price_list_id FROM synclab.clients_td WHERE instance_id = $1 AND client_id = $2`, [c.instance_id, c.client_id]).catch(() => null);
  return { ...c, price_list_id: pl?.price_list_id || null, extra_price_list_id: pl?.extra_price_list_id || null, cliente: c.legal_name || c.client_code || c.client_id };
}

/** Collegamenti di un client, di una sede o di un'accettazione (vedi in testa). */
export async function collegamenti(user, { client: cl = null, site = null, request = null } = {}) {
  const stati = {};
  const [dB, dR, dO, dN, dL] = [await disponibile(user, 'business', stati), await disponibile(user, 'retail', stati), await disponibile(user, 'orders', stati), await disponibile(user, 'nc', stati), await disponibile(user, 'etichette', stati)];
  if (cl) {
    const c = await client(String(cl.instance_id || ''), String(cl.client_id || ''));
    if (!c) return { tipo: 'client', trovato: false, voci: [] };
    const accounts = await accountsPerOrg([c.organization_id]);
    const chiaveB2b = c.organization_id ? String(c.organization_id) : `c-${c.client_id}`;
    const voci = [voceBusiness(user, c, accounts, dB)];
    if (c.ripartizione === 'LAB_SEDE' && c.site_id) voci.push(voce('retail', 'Retail · Laboratorio in sede', `/retail/b2c/sedi/${c.site_id}`, dR));
    else voci.push(voce('retail', 'Retail · scheda cliente B2B', `/retail/b2b/clienti/${encodeURIComponent(chiaveB2b)}`, dR));
    voci.push(voce('listino', 'Listino del gestionale', c.price_list_id || c.extra_price_list_id ? `/retail/b2b/listini?chiave=${encodeURIComponent(chiaveB2b)}` : null, dR, { motivo: 'Nessun listino del gestionale associato al client' }));
    voci.push(voce('ordini', 'Ordini', c.site_id ? `/orders/dotazione/sedi/${c.site_id}` : c.organization_id ? '/orders/strutture' : null, dO, { motivo: 'Client non abbinato a una struttura' }));
    let ncHref = null;
    if (dN.attivo) {
      try { const { sedeDaClient } = await import('../../nc/lib/synclabDesk.js'); const s = await sedeDaClient(c.instance_id, c.client_id, c.client_code); if (s?.sede_id) ncHref = `/nc/nc?sede=${encodeURIComponent(s.sede_id)}`; } catch { ncHref = null; }
    }
    voci.push(voce('nc', 'Non conformità del cliente', ncHref, dN, { motivo: 'Il client non corrisponde a una sede inviante delle NC' }));
    voci.push(voce('labcontrol', 'Accettazioni in Lab Control', `/etichette/accettazioni?cliente=${encodeURIComponent(`c-${c.client_id}`)}`, dL));
    const principale = voci.find((v) => v.attivo) || null;
    return { tipo: 'client', trovato: true, cliente: c.cliente, client_code: c.client_code, organization_id: c.organization_id, site_id: c.site_id, sede: c.sede, ripartizione: c.ripartizione, abbinamento: c.stato_abbinamento, principale: principale?.href || null, voci };
  }
  if (site != null) {
    const s = await one(`SELECT id, code, name, kind FROM public.sites WHERE id = $1`, [Number(site)]);
    if (!s) return { tipo: 'site', trovato: false, voci: [] };
    const voci = [
      voce('labcontrol', 'Accettazioni della sede in Lab Control', `/etichette/accettazioni?sede=${s.id}`, dL),
      voce('retail', 'Retail · Laboratorio in sede', s.kind === 'SERVICE' ? null : `/retail/b2c/sedi/${s.id}`, dR, { motivo: 'Punto service di un cliente: è nel B2B di Retail' }),
      voce('ordini', 'Ordini · dotazione della sede', `/orders/dotazione/sedi/${s.id}`, dO),
      { chiave: 'sede', etichetta: 'Scheda della sede', href: `/sites/${s.id}`, attivo: true, motivo: null },
    ];
    return { tipo: 'site', trovato: true, sede: [s.code, s.name].filter(Boolean).join(' '), voci };
  }
  if (request) {
    const r = await one(`SELECT instance_id, id, request_number FROM synclab.requests WHERE instance_id = $1 AND id = $2`, [String(request.instance_id || ''), String(request.id || '')]);
    if (!r) return { tipo: 'request', trovato: false, voci: [] };
    const voci = [
      voce('scheda', 'Scheda in Lab Control', `/etichette/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}`, dL),
      voce('etichetta', 'Etichette (Label)', `/etichette/label?acc=${encodeURIComponent(`${r.instance_id}|${r.id}`)}`, dL),
      voce('nc', 'Desk NC', r.request_number ? `/nc/desk/${encodeURIComponent(r.request_number)}` : null, dN, { motivo: 'Accettazione senza numero' }),
    ];
    return { tipo: 'request', trovato: true, numero: r.request_number, voci };
  }
  return { tipo: null, trovato: false, voci: [] };
}

/**
 * Link inverso "Accettazioni in Lab Control" per gli altri widget: filtro = { cliente: '<id Legal entity>' | 'c-<id client>', sede: id,
 * numero: '<numero di accettazione>' }. null se Lab Control non è LIVE o l'utente non ne ha il grant.
 */
export async function linkLabControl(user, { cliente = null, sede = null, numero = null } = {}) {
  const d = await disponibile(user, 'etichette');
  if (!d.attivo) return null;
  if (numero) {
    const r = await one(`SELECT instance_id, id FROM synclab.requests WHERE request_number = $1 AND deleted_at IS NULL ORDER BY (disponibilita = 'ATTIVO') DESC, date DESC LIMIT 1`, [String(numero)]).catch(() => null);
    return r ? `/etichette/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}` : `/etichette/accettazioni?q=${encodeURIComponent(numero)}&periodo=tutto`;
  }
  const p = new URLSearchParams();
  if (cliente != null) p.set('cliente', String(cliente));
  if (sede != null) p.set('sede', String(sede));
  return `/etichette/accettazioni${p.toString() ? `?${p}` : ''}`;
}
