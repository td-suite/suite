// Perimetro del Piano Ferie e Area di ogni persona (decisione del CEO, 08/11/2026: "solo dipendenti; piano ferie per Area:
// Direzione, Laboratorio, Sedi").
// Perimetro: persone dell'anagrafica unica (public.people) di tipo DIPENDENTE (e DIRIGENTE, impostazione includi_dirigenti) in stato
// ATTIVO con un contratto di lavoro subordinato in Contratti del personale (contracts.employments). I liberi professionisti sono fuori.
// Area (gruppo) derivata dall'organigramma (public.org_units, public.org_positions), a meno di una forzatura (ferie.aree_forzate):
//   LAB  = l'unità della persona sta in una sede di tipo LABORATORIO, o sotto un'area che si chiama "Laboratorio..."
//   DIR  = l'unità di primo livello sotto la radice è di tecnostruttura (STAFF), la persona afferisce alla radice, o la sede è HEADQUARTER
//   SEDE:<id> = tutte le altre, una colonna per sede (la sede dell'unità, o la sede di lavoro della persona)
//   DA_ASSEGNARE = nessun indizio (né unità con sede né sede di lavoro): HR la forza da Impostazioni > Aree forzate
// Approvatore: approvatore ferie del dossier HR (contracts.person_ext.approver_id) se c'è; altrimenti il responsabile della sede
// (SEDE) o dell'unità di primo livello (DIR, LAB) dall'organigramma; altrimenti il responsabile calcolato (people_manager). HR (ADMIN
// del modulo) approva sempre, i delegati (ferie.deleghe) durante il periodo della delega.
import { many, one } from '../db.js';

export const GRUPPI_FISSI = { DIR: 'Direzione', LAB: 'Laboratorio' };
export const isGruppo = (g) => /^(DIR|LAB|SEDE:\d+)$/.test(String(g || ''));
export const siteDiGruppo = (g) => (/^SEDE:(\d+)$/.test(String(g || '')) ? Number(g.slice(5)) : null);

/**
 * Area di una persona (funzione pura). chain: unità dalla persona alla radice ([0] = unità della persona); site: sede dell'unità
 * (org_unit_site) con il tipo; personSite: sede di lavoro della persona. Ritorna { gruppo, origine, site_id, primo_livello_id }.
 */
export function areaPersona({ chain = [], site = null, personSite = null, forzata = null }) {
  if (forzata && isGruppo(forzata)) return { gruppo: forzata, origine: 'forzata', site_id: siteDiGruppo(forzata), primo_livello_id: null };
  const valida = (s) => s && s.kind !== 'SERVICE' && s.active !== false;
  if (chain.length) {
    const root = chain[chain.length - 1];
    const primo = chain.length >= 2 ? chain[chain.length - 2] : null;   // unità di primo livello sotto la radice
    const pl = primo ? primo.id : null;
    if (valida(site) && site.kind === 'LABORATORIO') return { gruppo: 'LAB', origine: 'sede laboratorio', site_id: site.id, primo_livello_id: pl };
    if (!primo) return { gruppo: 'DIR', origine: 'radice dell\'organigramma', site_id: null, primo_livello_id: root.id };
    if (primo.branch === 'STAFF') return { gruppo: 'DIR', origine: `tecnostruttura: ${primo.name}`, site_id: null, primo_livello_id: pl };
    if (valida(site) && site.kind === 'HEADQUARTER') return { gruppo: 'DIR', origine: 'sede direzionale', site_id: null, primo_livello_id: pl };
    if (chain.some((u) => u.kind === 'AREA' && /^laborator/i.test(String(u.name || '').trim()))) return { gruppo: 'LAB', origine: 'area Laboratorio', site_id: valida(site) ? site.id : null, primo_livello_id: pl };
    if (valida(site)) return { gruppo: `SEDE:${site.id}`, origine: 'sede dell\'unità', site_id: site.id, primo_livello_id: pl };
  }
  if (valida(personSite)) {
    if (personSite.kind === 'LABORATORIO') return { gruppo: 'LAB', origine: 'sede di lavoro', site_id: personSite.id, primo_livello_id: null };
    if (personSite.kind === 'HEADQUARTER') return { gruppo: 'DIR', origine: 'sede di lavoro', site_id: null, primo_livello_id: null };
    return { gruppo: `SEDE:${personSite.id}`, origine: 'sede di lavoro', site_id: personSite.id, primo_livello_id: null };
  }
  return { gruppo: 'DA_ASSEGNARE', origine: 'nessuna unità con sede né sede di lavoro', site_id: null, primo_livello_id: null };
}

/** Il modulo Contratti del personale è avviato (schema con i contratti di lavoro)? */
export async function contrattiDisponibili() {
  const r = await one(`SELECT to_regclass('contracts.employments') IS NOT NULL AS emp, to_regclass('contracts.person_ext') IS NOT NULL AS ext`);
  return { employments: Boolean(r?.emp), person_ext: Boolean(r?.ext) };
}

let cache = { at: 0, data: null, includiDirigenti: null };
export const invalidaPerimetro = () => { cache = { at: 0, data: null, includiDirigenti: null }; };

/**
 * Perimetro completo con area, sede, ruoli, contratto, approvatore. Cache di 30 secondi (l'organigramma cambia di rado; ogni scrittura
 * del modulo che tocca le aree la invalida). Ritorna { persone: Map(id → persona), gruppi: [...], contratti: bool }.
 */
export async function perimetro({ includiDirigenti = true } = {}) {
  if (cache.data && Date.now() - cache.at < 30_000 && cache.includiDirigenti === includiDirigenti) return cache.data;
  const disp = await contrattiDisponibili();
  if (!disp.employments) { const vuoto = { persone: new Map(), gruppi: [], contratti: false }; cache = { at: Date.now(), data: vuoto, includiDirigenti }; return vuoto; }
  const kinds = includiDirigenti ? ['DIPENDENTE', 'DIRIGENTE'] : ['DIPENDENTE'];
  const persone = await many(`SELECT p.id, p.last_name, p.first_name, p.email, p.kind, p.site_id, p.unit_id, p.role_id, p.hired_at, p.terminated_at,
        jr.name AS role_name, public.people_manager(p.id) AS manager_id,
        e.ccnl, e.level, e.contract_type, e.weekly_days, e.days_label, e.start_date, e.end_date,
        ${disp.person_ext ? 'x.approver_id' : 'NULL::int AS approver_id'},
        af.gruppo AS gruppo_forzato,
        (SELECT u.id FROM public.users u WHERE u.person_id = p.id AND u.status = 'ACTIVE' ORDER BY u.id LIMIT 1) AS user_id
      FROM public.people p
      JOIN contracts.employments e ON e.resource_id = p.id
      LEFT JOIN public.job_roles jr ON jr.id = p.role_id
      ${disp.person_ext ? 'LEFT JOIN contracts.person_ext x ON x.person_id = p.id' : ''}
      LEFT JOIN aree_forzate af ON af.person_id = p.id
     WHERE p.status = 'ATTIVO' AND p.kind = ANY($1::text[])
     ORDER BY lower(p.last_name), lower(p.first_name)`, [kinds]);
  const units = await many('SELECT id, parent_id, kind, branch, name, site_id, active, head_person_id FROM public.org_units');
  const sites = await many('SELECT id, code, name, short_name, kind, active, city FROM public.sites');
  const pos = await many('SELECT op.person_id, op.unit_id, op.role_id, op.is_head, jr.name AS role_name FROM public.org_positions op LEFT JOIN public.job_roles jr ON jr.id = op.role_id JOIN public.people pp ON pp.id = op.person_id WHERE pp.status = \'ATTIVO\' ORDER BY op.sort_order, op.id');
  const uById = new Map(units.map((u) => [u.id, u]));
  const sById = new Map(sites.map((s) => [s.id, s]));
  const catena = (uid) => { const out = []; let u = uById.get(uid); const seen = new Set(); while (u && !seen.has(u.id) && out.length < 15) { seen.add(u.id); out.push(u); u = u.parent_id ? uById.get(u.parent_id) : null; } return out; };
  const sedeUnita = (ch) => { for (const u of ch) if (u.site_id) return sById.get(u.site_id) || null; return null; };
  // responsabili di ogni unità: incarichi is_head e head_person_id allineato
  const heads = new Map();
  const addHead = (uid, pid) => { if (!uid || !pid) return; if (!heads.has(uid)) heads.set(uid, []); if (!heads.get(uid).includes(pid)) heads.get(uid).push(pid); };
  for (const p of pos) if (p.is_head) addHead(p.unit_id, p.person_id);
  for (const u of units) if (u.active && u.head_person_id) addHead(u.id, u.head_person_id);
  const posByPerson = new Map();
  for (const p of pos) { if (!posByPerson.has(p.person_id)) posByPerson.set(p.person_id, []); posByPerson.get(p.person_id).push(p); }
  const sedeNode = new Map(units.filter((u) => u.kind === 'SEDE' && u.site_id && u.active).map((u) => [u.site_id, u.id]));

  const out = new Map();
  for (const p of persone) {
    const ps = posByPerson.get(p.id) || [];
    const unitId = p.unit_id || ps[0]?.unit_id || null;
    const ch = unitId ? catena(unitId) : [];
    const area = areaPersona({ chain: ch, site: sedeUnita(ch), personSite: p.site_id ? sById.get(p.site_id) : null, forzata: p.gruppo_forzato });
    // ruoli: principale + incarichi (per la copertura minima per ruolo)
    const ruoli = [...new Set([p.role_id, ...ps.map((x) => x.role_id)].filter(Boolean))];
    // approvatore dall'organigramma
    let candidati = [];
    const sid = siteDiGruppo(area.gruppo);
    if (sid && sedeNode.has(sid)) candidati = heads.get(sedeNode.get(sid)) || [];
    else if (area.primo_livello_id) candidati = heads.get(area.primo_livello_id) || [];
    let approvatore = null, approvatore_origine = null;
    if (p.approver_id && p.approver_id !== p.id) { approvatore = p.approver_id; approvatore_origine = 'dossier HR'; }
    else if (candidati.find((x) => x !== p.id)) { approvatore = candidati.find((x) => x !== p.id); approvatore_origine = sid ? 'responsabile della sede' : 'responsabile dell\'area'; }
    else if (p.manager_id && p.manager_id !== p.id) { approvatore = p.manager_id; approvatore_origine = 'responsabile dall\'organigramma'; }
    out.set(p.id, {
      id: p.id, nome: `${p.last_name} ${p.first_name}`.trim(), last_name: p.last_name, first_name: p.first_name, email: p.email, kind: p.kind, user_id: p.user_id,
      role_id: p.role_id, role_name: p.role_name || ps.find((x) => x.role_name)?.role_name || null, ruoli,
      gruppo: area.gruppo, area_origine: area.origine, site_id: area.site_id || p.site_id || null, unit_id: unitId,
      approvatore_id: approvatore, approvatore_origine,
      contratto: { ccnl: p.ccnl, level: p.level, contract_type: p.contract_type, weekly_days: p.weekly_days, days_label: p.days_label },
      inizio: isoOrNull(p.start_date || p.hired_at), fine: isoOrNull(p.end_date || p.terminated_at),
    });
  }
  // nomi degli approvatori (anche fuori perimetro: un responsabile può essere un libero professionista o un dirigente)
  const ids = [...new Set([...out.values()].map((x) => x.approvatore_id).filter(Boolean))];
  const nomi = ids.length ? await many(`SELECT p.id, p.last_name || ' ' || p.first_name AS nome, (SELECT u.id FROM public.users u WHERE u.person_id = p.id AND u.status='ACTIVE' ORDER BY u.id LIMIT 1) AS user_id FROM public.people p WHERE p.id = ANY($1::int[])`, [ids]) : [];
  const nById = new Map(nomi.map((n) => [n.id, n]));
  for (const x of out.values()) if (x.approvatore_id) { x.approvatore_nome = nById.get(x.approvatore_id)?.nome || null; x.approvatore_user_id = nById.get(x.approvatore_id)?.user_id || null; }
  // gruppi presenti (colonne del piano): Direzione, Laboratorio, poi le sedi in ordine alfabetico, infine Da assegnare
  const gs = new Set([...out.values()].map((x) => x.gruppo));
  const gruppi = [];
  if (gs.has('DIR')) gruppi.push({ key: 'DIR', nome: 'Direzione', area: 'Direzione' });
  if (gs.has('LAB')) gruppi.push({ key: 'LAB', nome: 'Laboratorio', area: 'Laboratorio' });
  const sedi = [...gs].filter((g) => g.startsWith('SEDE:')).map((g) => { const s = sById.get(siteDiGruppo(g)); return { key: g, nome: s ? (s.short_name || s.name) : g, area: 'Sedi', site_id: s?.id || null, site_kind: s?.kind || null }; });
  sedi.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  gruppi.push(...sedi);
  if (gs.has('DA_ASSEGNARE')) gruppi.push({ key: 'DA_ASSEGNARE', nome: 'Da assegnare', area: 'Da assegnare' });
  const data = { persone: out, gruppi, contratti: true, siti: sById };
  cache = { at: Date.now(), data, includiDirigenti };
  return data;
}

const isoOrNull = (d) => { if (!d) return null; if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return String(d).slice(0, 10); };
export { isoOrNull };

/** Nome leggibile di un gruppo */
export function nomeGruppo(g, siti) {
  if (g === 'DIR') return 'Direzione';
  if (g === 'LAB') return 'Laboratorio';
  if (g === 'TUTTE') return 'Tutte le aree';
  if (g === 'DA_ASSEGNARE') return 'Da assegnare';
  const sid = siteDiGruppo(g);
  if (sid) { const s = siti?.get?.(sid); return s ? `Sede ${s.short_name || s.name}` : `Sede ${sid}`; }
  if (String(g).startsWith('KIND:')) return `Tutte le sedi di tipo ${String(g).slice(5).toLowerCase().replace(/_/g, ' ')}`;
  return g;
}
