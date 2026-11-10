// Synclab Data API · abbinamento automatico dei client del gestionale alle Legal entity e alle SEDI della Suite (v0.68.5, CEO 10/11/2026:
// "Perché in Business Hub lato service e lato Punti Prelievo non li associ correttamente al codice StudioLab relativo? Correggi!").
//
// Fonte unica del codice StudioLAB resta public.sites.studiolab_code (sede SERVICE del cliente o sede TD del punto); synclab.client_map
// (vista clients_td) è l'abbinamento client Synclab ↔ Legal entity e sede. Per ogni client Synclab ATTIVO nella copia:
//   - già abbinato (client_map con Legal entity): si completa la sede se manca e si scrive il codice nella sede se manca;
//   - abbinamento tolto a mano (client_map con fonte MANUALE e senza Legal entity): non si tocca;
//   - non abbinato: Legal entity con la prima regola che dà un risultato, in quest'ordine:
//       R0 CODICE_STUDIOLAB  clientCode = codice StudioLAB di una sede (dà anche la sede);
//       R1 CODICE            clientCode = codice della Legal entity (es. SER0033) o di una sede (dà la sede);
//       R2 PARTITA_IVA       partita IVA / codice fiscale del client = quelli della Legal entity (partite IVA tutte a zero ignorate);
//       R3 NOME_COMUNE       ragione sociale normalizzata identica e stesso comune (della Legal entity o di una sua sede);
//     una regola con più Legal entity candidate = AMBIGUO (elenco con scelta manuale), nessuna = nessun candidato (D48).
//   - sede: quella data dalla regola; altrimenti fra le sedi attive della Legal entity del tipo giusto (SERVICE per i clienti, sedi non
//     SERVICE per Toscana Diagnostica e le società del gruppo) la sola che c'è, oppure la sola con lo stesso indirizzo, poi stesso comune,
//     poi nome della sede contenuto nella descrizione della `site` del client. Una Legal entity con più sedi service (es. un gruppo con due
//     case di cura) può avere più client Synclab: ciascuno va alla SUA sede. Sede non univoca = Legal entity abbinata, sede da scegliere.
//   - codice: se la sede scelta non ha studiolab_code, il client è attivo e nessun'altra sede ha quel codice, si scrive con saveSite
//     (audit "codice StudioLAB dal gestionale"); un codice diverso già presente non si sovrascrive mai (elenco dei conflitti).
// Esito dell'ultima esecuzione in app_settings 'synclab.abbinamenti' (conteggi, ambigui con i candidati: nessun dato di pazienti).
// Esecuzione: job synclab:abbinamenti (dopo ogni ciclo riuscito dei clients e ogni 6 ore), "Riallinea abbinamenti" in Dati Synclab.
import { one, many, q } from '../../db.js';

const togliAccenti = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const FORME = new Set(['SRL', 'SRLS', 'SPA', 'SAS', 'SNC', 'SS', 'SCARL', 'SCRL', 'ONLUS', 'SAPA', 'COOP', 'SOC', 'SOCIETA', 'CONSORTILE', 'UNIPERSONALE', 'A', 'R', 'L', 'S', 'P']);
/** Ragione sociale normalizzata: maiuscole senza accenti né punteggiatura, senza forme giuridiche (S.r.l., S.p.A., …). */
export function normNome(s) {
  const t = togliAccenti(s).toUpperCase().replace(/&/g, ' E ').replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return t.filter((x) => !FORME.has(x)).join(' ');
}
export const normComune = (s) => togliAccenti(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const ABBR = [[/\bV\.?\s*LE\b/g, 'VIALE'], [/\bP\.?\s*ZZA\b/g, 'PIAZZA'], [/\bP\.?\s*ZA\b/g, 'PIAZZA'], [/\bP\.?\s*LE\b/g, 'PIAZZALE'], [/\bC\.?\s*SO\b/g, 'CORSO'], [/\bL\.?\s*GO\b/g, 'LARGO'], [/\bLOC\.?\b/g, 'LOCALITA']];
/** Indirizzo normalizzato (abbreviazioni sciolte, senza punteggiatura); senza = anche senza numeri civici. */
export function normIndirizzo(s, { senzaNumeri = false } = {}) {
  let t = togliAccenti(s).toUpperCase();
  for (const [re, v] of ABBR) t = t.replace(re, v);
  t = t.replace(/\bN\.?\s*(?=\d)/g, ' ').replace(/[^A-Z0-9]+/g, ' ');
  if (senzaNumeri) t = t.replace(/\b\d+[A-Z]?\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
export const normFiscale = (s) => { const t = String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^IT(?=\d{11}$)/, ''); return t && !/^0+$/.test(t) ? t : null; };
const ug = (x, y) => Boolean(x) && Boolean(y) && String(x).trim().toLowerCase() === String(y).trim().toLowerCase();

const SEDI_TD = (s) => s.kind !== 'SERVICE';
/** Sedi candidate di una Legal entity per un client: SERVICE per i clienti, le altre per TD e società del gruppo. */
function sediDi(org, ctx) {
  const tutte = ctx.sites.filter((s) => s.active && Number(s.organization_id) === Number(org.id));
  const interna = org.kind === 'GRUPPO' || org.kind === 'SOCIETA' || Number(org.id) === Number(ctx.tdOrgId);
  return tutte.filter((s) => (interna ? SEDI_TD(s) : s.kind === 'SERVICE'));
}

/**
 * Sede del client fra le sedi candidate (pura): { site, regola } oppure { site: null, motivo, candidati }.
 * Ordine: unica sede; stesso indirizzo; stesso indirizzo senza civici; stesso comune; nome della sede nella descrizione della site.
 */
export function scegliSede(client, sedi) {
  if (!sedi.length) return { site: null, motivo: 'nessuna sede attiva del tipo giusto per questa Legal entity', candidati: [] };
  if (sedi.length === 1) return { site: sedi[0], regola: 'UNICA_SEDE' };
  const ind = [client.site_address, client.address].filter(Boolean);
  const com = [client.site_city, client.city].filter(Boolean).map(normComune);
  const filtra = (lista, fn) => lista.filter(fn);
  let x = filtra(sedi, (s) => s.address && ind.some((a) => normIndirizzo(a) === normIndirizzo(s.address)));
  if (x.length === 1) return { site: x[0], regola: 'INDIRIZZO' };
  if (!x.length) { x = filtra(sedi, (s) => s.address && ind.some((a) => normIndirizzo(a, { senzaNumeri: true }) && normIndirizzo(a, { senzaNumeri: true }) === normIndirizzo(s.address, { senzaNumeri: true }))); if (x.length === 1) return { site: x[0], regola: 'INDIRIZZO' }; }
  const perComune = (lista) => filtra(lista, (s) => s.city && com.includes(normComune(s.city)));
  const base = x.length > 1 ? x : sedi;
  const c = perComune(base);
  if (c.length === 1) return { site: c[0], regola: 'COMUNE' };
  const desc = normNome(client.site_description || '');
  const pool = c.length > 1 ? c : base;
  if (desc) {
    const n = pool.filter((s) => { const a = normNome(s.name); const b = normNome(s.short_name || ''); return (a && (desc.includes(a) || a.includes(desc))) || (b && b.length >= 4 && desc.includes(b)); });
    if (n.length === 1) return { site: n[0], regola: 'NOME_SEDE' };
  }
  return { site: null, motivo: `${pool.length} sedi possibili: indirizzo, comune e nome non bastano a sceglierne una`, candidati: pool };
}

/**
 * Decisione per un client non abbinato (pura): { esito: 'ABBINA' | 'AMBIGUO' | 'NESSUNO', regola, org, site, regola_sede, motivo, candidati }.
 * ctx = { orgs, sites, tdOrgId }.
 */
export function decidiClient(client, ctx) {
  const orgsAttive = ctx.orgs.filter((o) => o.active !== false);
  const perId = new Map(orgsAttive.map((o) => [Number(o.id), o]));
  const code = String(client.client_code || '').trim();
  const regole = [];
  // R0: codice StudioLAB di una sede
  if (code) {
    const s = ctx.sites.filter((x) => ug(x.studiolab_code, code) && x.organization_id && perId.has(Number(x.organization_id)));
    regole.push({ regola: 'CODICE_STUDIOLAB', cand: s.map((x) => ({ org: perId.get(Number(x.organization_id)), site: x })) });
  }
  // R1: codice della Legal entity o di una sede
  if (code) {
    const o = orgsAttive.filter((x) => ug(x.code, code)).map((x) => ({ org: x, site: null }));
    const s = ctx.sites.filter((x) => x.active && ug(x.code, code) && x.organization_id && perId.has(Number(x.organization_id))).map((x) => ({ org: perId.get(Number(x.organization_id)), site: x }));
    regole.push({ regola: 'CODICE', cand: [...o, ...s] });
  }
  // R2: partita IVA / codice fiscale
  const fisc = [normFiscale(client.vat_number), normFiscale(client.fiscal_code)].filter(Boolean);
  if (fisc.length) regole.push({ regola: 'PARTITA_IVA', cand: orgsAttive.filter((o) => fisc.includes(normFiscale(o.vat_number)) || fisc.includes(normFiscale(o.tax_code))).map((o) => ({ org: o, site: null })) });
  // R3: nome normalizzato identico e stesso comune
  const nome = normNome(client.legal_name);
  const comuni = [client.city, client.site_city].filter(Boolean).map(normComune);
  if (nome && comuni.length) {
    regole.push({ regola: 'NOME_COMUNE', cand: orgsAttive.filter((o) => normNome(o.name) === nome && (comuni.includes(normComune(o.city))
      || ctx.sites.some((s) => s.active && Number(s.organization_id) === Number(o.id) && comuni.includes(normComune(s.city))))).map((o) => ({ org: o, site: null })) });
  }
  for (const r of regole) {
    const orgs = [...new Map(r.cand.map((c) => [Number(c.org.id), c.org])).values()];
    if (!orgs.length) continue;
    if (orgs.length > 1) return { esito: 'AMBIGUO', regola: r.regola, motivo: `${orgs.length} Legal entity con la regola ${r.regola.toLowerCase().replace('_', ' ')}`, candidati: orgs.map((o) => ({ organization_id: o.id, name: o.name, code: o.code })) };
    const org = orgs[0];
    const siti = [...new Map(r.cand.filter((c) => c.site).map((c) => [c.site.id, c.site])).values()];
    if (siti.length === 1) return { esito: 'ABBINA', regola: r.regola, org, site: siti[0], regola_sede: r.regola };
    const sc = scegliSede(client, sediDi(org, ctx));
    return { esito: 'ABBINA', regola: r.regola, org, site: sc.site, regola_sede: sc.regola || null, motivo_sede: sc.site ? null : sc.motivo, candidati_sede: sc.site ? [] : (sc.candidati || []).map((s) => ({ site_id: s.id, code: s.code, name: s.name, city: s.city })) };
  }
  return { esito: 'NESSUNO', motivo: 'nessuna Legal entity per codice, partita IVA o nome e comune' };
}

async function contesto() {
  const [clients, orgs, sites, map, td] = await Promise.all([
    many(`SELECT c.instance_id, c.id AS client_id, c.client_code, c.legal_name, c.vat_number, c.fiscal_code, c.address, c.city, c.province, c.active, c.site_description, c.site_address, c.site_city
            FROM synclab.clients c WHERE c.disponibilita = 'ATTIVO' ORDER BY c.client_code NULLS LAST, c.id`),
    many(`SELECT id, kind, code, name, vat_number, tax_code, city, active FROM public.organizations`),
    many(`SELECT id, code, name, short_name, kind, organization_id, address, city, province, studiolab_code, active FROM public.sites`),
    many(`SELECT instance_id, client_id, organization_id, site_id, fonte FROM synclab.client_map`),
    one(`SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::int WHEN (value #>> '{}') ~ '^[0-9]+$' THEN (value #>> '{}')::int END AS id FROM public.app_settings WHERE key = 'company_org_id'`).catch(() => null),
  ]);
  return { clients, orgs, sites, map: new Map(map.map((m) => [`${m.instance_id}|${m.client_id}`, m])), tdOrgId: td?.id ?? null };
}

/**
 * Allineamento degli abbinamenti (job synclab:abbinamenti e "Riallinea abbinamenti"). scrivi = false: solo l'anteprima.
 * Ritorna il rapporto { at, esaminati, abbinati, sedi_completate, codici_scritti, ambigui, sede_da_scegliere, conflitti, senza_candidati, gia_abbinati }.
 */
export async function allineaAbbinamenti({ scrivi = true, userId = null, req = null, origine = 'job synclab:abbinamenti' } = {}) {
  const ctx = await contesto();
  const out = { at: new Date().toISOString(), origine, esaminati: ctx.clients.length, abbinati: [], sedi_completate: [], codici_scritti: [], ambigui: [], sede_da_scegliere: [], conflitti: [], senza_candidati: 0, gia_abbinati: 0, saltati_manuali: 0 };
  const sedeUsata = new Map();   // site_id → client_id già abbinato in questo giro (o prima)
  for (const m of ctx.map.values()) if (m.site_id) sedeUsata.set(Number(m.site_id), m.client_id);
  const { saveSite } = await import('../sites.js');
  const siteById = new Map(ctx.sites.map((s) => [Number(s.id), s]));
  const codiceUsato = (code, siteId) => ctx.sites.some((s) => Number(s.id) !== Number(siteId) && ug(s.studiolab_code, code));
  const scriviCodice = async (c, site) => {
    if (!site || !c.client_code || c.active === false) return;
    if (site.studiolab_code) { if (!ug(site.studiolab_code, c.client_code)) out.conflitti.push({ client_id: c.client_id, client_code: c.client_code, site_id: site.id, site_code: site.code, site_name: site.name, codice_sede: site.studiolab_code, motivo: 'la sede ha già un altro codice StudioLAB: non sovrascritto' }); return; }
    if (codiceUsato(c.client_code, site.id)) { out.conflitti.push({ client_id: c.client_id, client_code: c.client_code, site_id: site.id, site_code: site.code, site_name: site.name, motivo: 'il codice è già di un\'altra sede' }); return; }
    if (scrivi) {
      await saveSite({ id: site.id, data: { studiolab_code: c.client_code }, origine: 'codice StudioLAB dal gestionale (Synclab, abbinamento automatico)', req, actorId: userId });
      site.studiolab_code = c.client_code;
    }
    out.codici_scritti.push({ client_id: c.client_id, client_code: c.client_code, site_id: site.id, site_code: site.code, site_name: site.name });
  };
  const salvaMap = async (c, orgId, siteId, fonte, note) => {
    if (!scrivi) return;
    await q(`INSERT INTO synclab.client_map (instance_id, client_id, organization_id, site_id, fonte, note, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (instance_id, client_id) DO UPDATE SET organization_id=EXCLUDED.organization_id, site_id=EXCLUDED.site_id, fonte=coalesce(synclab.client_map.fonte, EXCLUDED.fonte),
        note=coalesce(synclab.client_map.note, EXCLUDED.note), updated_by=coalesce(EXCLUDED.updated_by, synclab.client_map.updated_by), updated_at=now()`, [c.instance_id, c.client_id, orgId, siteId, fonte, note, userId]);
  };
  for (const c of ctx.clients) {
    const m = ctx.map.get(`${c.instance_id}|${c.client_id}`);
    if (m && m.fonte === 'MANUALE' && !m.organization_id) { out.saltati_manuali++; continue; }
    if (m?.organization_id) {
      out.gia_abbinati++;
      let site = m.site_id ? siteById.get(Number(m.site_id)) : null;
      if (!site) {
        const org = ctx.orgs.find((o) => Number(o.id) === Number(m.organization_id));
        const r0 = c.client_code ? ctx.sites.filter((s) => ug(s.studiolab_code, c.client_code) && Number(s.organization_id) === Number(m.organization_id)) : [];
        const sc = r0.length === 1 ? { site: r0[0], regola: 'CODICE_STUDIOLAB' } : org ? scegliSede(c, sediDi(org, ctx).filter((s) => !sedeUsata.has(Number(s.id)) || sedeUsata.get(Number(s.id)) === c.client_id)) : { site: null };
        if (sc.site) {
          site = sc.site; sedeUsata.set(Number(site.id), c.client_id);
          await salvaMap(c, m.organization_id, site.id, m.fonte || 'AUTO', null);
          out.sedi_completate.push({ client_id: c.client_id, client_code: c.client_code, organization_id: m.organization_id, site_id: site.id, site_name: site.name, regola: sc.regola });
        } else if (org && sediDi(org, ctx).length > 1) out.sede_da_scegliere.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, organization_id: org.id, organization_name: org.name, motivo: sc.motivo || 'sede non univoca', candidati: (sc.candidati || []).map((s) => ({ site_id: s.id, code: s.code, name: s.name, city: s.city })) });
      }
      if (site) await scriviCodice(c, site);
      continue;
    }
    const d = decidiClient(c, ctx);
    if (d.esito === 'NESSUNO') { out.senza_candidati++; continue; }
    if (d.esito === 'AMBIGUO') { out.ambigui.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, regola: d.regola, motivo: d.motivo, candidati: d.candidati }); continue; }
    let site = d.site;
    if (site && sedeUsata.has(Number(site.id)) && sedeUsata.get(Number(site.id)) !== c.client_id) {
      out.sede_da_scegliere.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, organization_id: d.org.id, organization_name: d.org.name, motivo: `la sede ${site.name} è già abbinata a un altro client Synclab`, candidati: [] });
      site = null;
    }
    await salvaMap(c, d.org.id, site?.id || null, 'AUTO', `Abbinamento automatico: regola ${d.regola}${site && d.regola_sede && d.regola_sede !== d.regola ? `, sede per ${d.regola_sede}` : ''}`);
    if (site) sedeUsata.set(Number(site.id), c.client_id);
    out.abbinati.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, organization_id: d.org.id, organization_name: d.org.name, regola: d.regola, site_id: site?.id || null, site_name: site?.name || null, regola_sede: site ? d.regola_sede : null });
    if (!site && d.motivo_sede && sediDi(d.org, ctx).length > 1) out.sede_da_scegliere.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, organization_id: d.org.id, organization_name: d.org.name, motivo: d.motivo_sede, candidati: d.candidati_sede });
    if (site) await scriviCodice(c, site);
  }
  if (scrivi) {
    const sintesi = { ...out, abbinati: out.abbinati.length, sedi_completate: out.sedi_completate.length, codici_scritti: out.codici_scritti, ambigui: out.ambigui.slice(0, 200), sede_da_scegliere: out.sede_da_scegliere.slice(0, 200), conflitti: out.conflitti.slice(0, 200) };
    await q(`INSERT INTO public.app_settings (key, value) VALUES ('synclab.abbinamenti', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(sintesi)]);
  }
  return out;
}

/** Ultimo rapporto dell'allineamento (o null). */
export async function ultimoAllineamento() {
  const r = await one(`SELECT value FROM public.app_settings WHERE key = 'synclab.abbinamenti'`).catch(() => null);
  if (!r?.value) return null;
  return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
}

/**
 * Client Synclab proposti per una Legal entity (azione "Abbina al cliente del gestionale" della scheda account): quelli non abbinati
 * che la indicano tra i candidati (ambigui) o con una regola, più quelli trovati con la ricerca libera. Per ognuno la sede proposta.
 */
export async function candidatiPerOrg(orgId, { cerca = '' } = {}) {
  const ctx = await contesto();
  const org = ctx.orgs.find((o) => Number(o.id) === Number(orgId));
  if (!org) return { org: null, candidati: [] };
  const t = String(cerca || '').trim().toLowerCase();
  const out = [];
  for (const c of ctx.clients) {
    const m = ctx.map.get(`${c.instance_id}|${c.client_id}`);
    const gia = m?.organization_id ? Number(m.organization_id) : null;
    if (gia && gia !== Number(orgId) && !t) continue;
    const d = decidiClient(c, ctx);
    const proposto = (d.esito === 'ABBINA' && Number(d.org.id) === Number(orgId)) || (d.esito === 'AMBIGUO' && d.candidati.some((x) => Number(x.organization_id) === Number(orgId)));
    const trovato = t && [c.client_code, c.legal_name, c.vat_number, c.city].some((x) => String(x || '').toLowerCase().includes(t));
    if (!proposto && !trovato && gia !== Number(orgId)) continue;
    const sc = scegliSede(c, sediDi(org, ctx));
    out.push({ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, active: c.active, city: c.city, site_description: c.site_description, site_city: c.site_city,
      abbinato_a: gia, gia_qui: gia === Number(orgId), regola: proposto ? d.regola : null, motivo: d.esito === 'AMBIGUO' ? d.motivo : null,
      sede_proposta: sc.site ? { site_id: sc.site.id, code: sc.site.code, name: sc.site.name, studiolab_code: sc.site.studiolab_code, regola: sc.regola } : null,
      sedi: sediDi(org, ctx).map((s) => ({ site_id: s.id, code: s.code, name: s.name, city: s.city, studiolab_code: s.studiolab_code })) });
    if (out.length >= 50) break;
  }
  return { org: { id: org.id, name: org.name, code: org.code }, candidati: out.sort((x, y) => Number(Boolean(y.regola)) - Number(Boolean(x.regola)) || String(x.client_code).localeCompare(String(y.client_code))) };
}

/** Abbina a mano un client a una Legal entity (e sede) e scrive il codice nella sede se manca (azione della scheda account e di Dati Synclab). */
export async function abbinaManuale({ clientId, organizationId, siteId = null, userId = null, req = null, origine = 'scelta manuale' }) {
  const c = await one(`SELECT c.instance_id, c.id AS client_id, c.client_code, c.legal_name, c.active FROM synclab.clients c WHERE c.id = $1 ORDER BY c.updated_at DESC LIMIT 1`, [String(clientId)]);
  if (!c) throw Object.assign(new Error('Client Synclab non trovato'), { status: 404 });
  if (!(await one('SELECT 1 FROM public.organizations WHERE id=$1', [organizationId]))) throw Object.assign(new Error('Legal entity inesistente'), { status: 400 });
  let site = null;
  if (siteId) {
    site = await one('SELECT id, code, name, studiolab_code, organization_id, host_organization_id FROM public.sites WHERE id=$1', [siteId]);
    if (!site || (Number(site.organization_id) !== Number(organizationId) && Number(site.host_organization_id) !== Number(organizationId))) throw Object.assign(new Error('La sede scelta non appartiene alla Legal entity'), { status: 400 });
  }
  await q(`INSERT INTO synclab.client_map (instance_id, client_id, organization_id, site_id, fonte, note, updated_by) VALUES ($1,$2,$3,$4,'MANUALE',$5,$6)
    ON CONFLICT (instance_id, client_id) DO UPDATE SET organization_id=EXCLUDED.organization_id, site_id=EXCLUDED.site_id, fonte='MANUALE', note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
  [c.instance_id, c.client_id, organizationId, site?.id || null, `Abbinato a mano (${origine})`, userId]);
  let codice = null;
  if (site && c.client_code && c.active !== false && !site.studiolab_code) {
    const dup = await one('SELECT id, code FROM public.sites WHERE lower(studiolab_code) = lower($1) AND id <> $2', [c.client_code, site.id]);
    if (!dup) {
      const { saveSite } = await import('../sites.js');
      await saveSite({ id: site.id, data: { studiolab_code: c.client_code }, origine: `codice StudioLAB dal gestionale (Synclab, ${origine})`, req, actorId: userId });
      codice = { scritto: true, codice: c.client_code };
    } else codice = { scritto: false, motivo: `il codice ${c.client_code} è già della sede ${dup.code}` };
  } else if (site?.studiolab_code && !ug(site.studiolab_code, c.client_code)) codice = { scritto: false, motivo: `la sede ha già il codice ${site.studiolab_code}: non sovrascritto` };
  return { client_id: c.client_id, client_code: c.client_code, organization_id: organizationId, site_id: site?.id || null, codice };
}
