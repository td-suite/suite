// Clienti del servizio e sedi SERVICE (programma "anagrafica unica", blocco 2, 08/11/2026; correzioni A5 e A7, decisioni 1 e 5 del CEO).
// - clientiAttivi({ linea, livello }): l'UNICA lettura dei clienti attivi e contrattualizzati per il codice della Suite (vista
//   public.clienti_attivi_v, migrazione core 044). Le viste dei moduli (Ordini, NC) usano la stessa vista tramite la funzione SQL
//   public.cliente_livello(org_id).
// - creaSedeService: la sede SERVICE del cliente (kind SERVICE, Legal entity = cliente, nome = ragione sociale, indirizzo del contratto
//   se indicato altrimenti quello della Legal entity, orari di ritiro dal contratto, codice StudioLAB se noto), sempre con saveSite.
//   La chiamano la contrattualizzazione SRV e MDL (Business Hub) e l'operazione "Crea le sedi SERVICE mancanti" (Diagnostica).
// - sediServiceMancanti: rapporto ed esecuzione dell'operazione (richiesta del CEO dell'08/11/2026: "In Sedi/Strutture clienti service
//   genera anche tutte le Legal entity che non hanno sede, perché vuol dire che hanno una sede sola, quella della Legal entity; in
//   indirizzo, se non espressamente indicato, riporta sempre quello della Legal entity").
// - allineaSediDaOrg: cambio d'indirizzo della Legal entity → sedi SERVICE con l'indirizzo ereditato (address_from_org) aggiornate.
import { one, many } from '../db.js';
import { saveSite } from './sites.js';

const has = async (t) => Boolean((await one('SELECT to_regclass($1) IS NOT NULL AS ok', [t]))?.ok);
export const LINEE_CLIENTE = ['SRV', 'MDL'];
export const LIVELLI = ['ATTIVO', 'CONTRATTUALIZZATO'];

/**
 * Clienti del Service e della Medicina del Lavoro. livello: 'ATTIVO' (fase 7 confermata dal CEO), 'CONTRATTUALIZZATO' o null
 * (entrambi); linea: 'SRV' | 'MDL' | null (entrambe); orgId: una sola Legal entity. Righe: { org_id, org_name, org_kind, linea,
 * livello, dal, fonte, account_id }.
 */
export async function clientiAttivi({ linea = null, livello = null, orgId = null } = {}) {
  if (linea && !LINEE_CLIENTE.includes(linea)) throw Object.assign(new Error('Linea non valida (SRV o MDL)'), { status: 400 });
  if (livello && !LIVELLI.includes(livello)) throw Object.assign(new Error('Livello non valido (ATTIVO o CONTRATTUALIZZATO)'), { status: 400 });
  return many(`SELECT v.org_id, o.name AS org_name, o.kind AS org_kind, v.linea, v.livello, v.dal, v.fonte, v.account_id
      FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id
     WHERE ($1::text IS NULL OR v.linea = $1) AND ($2::text IS NULL OR v.livello = $2) AND ($3::int IS NULL OR v.org_id = $3)
     ORDER BY lower(o.name), v.linea`, [linea, livello, orgId]);
}

/** Livello di cliente del servizio di una Legal entity: 'ATTIVO' | 'CONTRATTUALIZZATO' | 'PUNTO_SERVICE' | null (stessa regola delle viste). */
export async function livelloCliente(orgId) {
  if (!orgId) return null;
  return (await one('SELECT public.cliente_livello($1) AS l', [Number(orgId)]))?.l || null;
}

// ---------------------------------------------------------------- funzioni pure (provate in test/anagrafica-blocco2.test.mjs)
const GIORNI = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const GIORNO_IT = { mon: 'lunedì', tue: 'martedì', wed: 'mercoledì', thu: 'giovedì', fri: 'venerdì', sat: 'sabato' };
const ora = (v) => { const m = String(v || '').trim().match(/^(\d{1,2})[:.](\d{2})$/); return m && Number(m[1]) < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
/**
 * Orari di ritiro del contratto Service (data.pickup.days, lunedì-sabato, modalità FISSO | CHIAMATA | NO) → { json, testo }.
 * json: orari strutturati della sede (solo i giorni a orario fisso con inizio e fine); testo: riepilogo leggibile anche dei giorni
 * a chiamata o con il solo orario di inizio. Nessun ritiro indicato → { json: null, testo: null }.
 */
export function orariRitiro(days = []) {
  const json = {}; const parti = [];
  (Array.isArray(days) ? days : []).slice(0, 6).forEach((d, i) => {
    const g = GIORNI[i]; if (!d || !g) return;
    const da = ora(d.time_from); const a = ora(d.time_to);
    if (d.mode === 'FISSO') {
      if (da && a && da < a) json[g] = [{ from: da, to: a }];
      parti.push(`${GIORNO_IT[g]} ${da ? (a ? `${da}-${a}` : `dalle ${da}`) : 'orario da definire'}`);
    } else if (d.mode === 'CHIAMATA') parti.push(`${GIORNO_IT[g]} a chiamata`);
  });
  return { json: Object.keys(json).length ? json : null, testo: parti.length ? `Ritiro campioni: ${parti.join('; ')}` : null };
}

/** Codice della sede SERVICE proposto: SRV-<codice della Legal entity o id>[-<n>] (MDL- per la Medicina del Lavoro; maiuscolo, solo lettere, cifre, - e _). */
export function codiceSedeService(org, n = 0, linea = 'SRV') {
  const base = `${linea === 'MDL' ? 'MDL' : 'SRV'}-${String(org.code || org.id).toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || org.id}`;
  return n ? `${base}-${n}` : base;
}

/** Struttura del gruppo (accounts.sedi) attivata: fase del DB 6 o 7, oppure nome uguale al punto di un contratto vigente della linea. */
export function strutturaAttivata(s, puntiContratto = []) {
  const fase = parseInt(String(s?.fase || ''), 10);
  if (Number.isFinite(fase) && fase >= 6) return { si: true, motivo: `fase ${String(s.fase).trim()} nel DB Opportunità` };
  const nome = String(s?.nome || '').trim().toLowerCase();
  if (nome && puntiContratto.some((p) => String(p || '').trim().toLowerCase() === nome)) return { si: true, motivo: 'punto indicato nel contratto firmato' };
  return { si: false, motivo: 'struttura del gruppo non ancora attivata' };
}

// ---------------------------------------------------------------- sede SERVICE
async function codiceLibero(org, linea) {
  for (let n = 0; n < 200; n++) {
    const c = codiceSedeService(org, n, linea);
    if (!(await one('SELECT 1 FROM sites WHERE lower(code)=lower($1)', [c]))) return c;
  }
  throw new Error('Nessun codice libero per la sede SERVICE');
}
const codiceStudiolabLibero = async (code, siteId = null) => {
  const c = String(code || '').trim();
  if (!c) return null;
  return (await one('SELECT 1 FROM sites WHERE lower(studiolab_code)=lower($1) AND ($2::int IS NULL OR id<>$2)', [c, siteId])) ? null : c;
};

/** Dati del contratto della linea utili alla sede (Service: punto, indirizzo, ritiro). */
async function contrattoDellaLinea(orgId, linea, contrattoId = null) {
  if (!(await has('business.contracts'))) return null;
  return one(`SELECT id, protocol, kind, status, data FROM business.contracts WHERE org_id=$1 AND kind=$2 AND ($3::int IS NULL OR id=$3)
    ORDER BY (status IN ('FIRMATO','ATTIVO')) DESC, coalesce(signed_at, proposal_date) DESC NULLS LAST, id DESC LIMIT 1`, [orgId, linea, contrattoId]);
}

/**
 * Crea (se manca) la sede SERVICE del cliente con saveSite. opts: { orgId, linea ('SRV'|'MDL'), contrattoId, struttura (voce di
 * accounts.sedi: { nome, indirizzo, citta, prov, email, telefono }), origine, req, actorId }.
 * Senza struttura: una sola sede per Legal entity (se ne esiste già una SERVICE attiva non si crea nulla). Con struttura: una sede per
 * struttura, riconosciuta per nome. Ritorna { esito: 'creata' | 'esistente', site, avvisi }.
 */
export async function creaSedeService({ orgId, linea = 'SRV', contrattoId = null, struttura = null, origine = 'Business Hub, contrattualizzazione', req = null, actorId = null } = {}) {
  const org = await one('SELECT id, name, code, kind, address, zip, city, province, phone, email FROM organizations WHERE id=$1', [orgId]);
  if (!org) throw Object.assign(new Error('Legal entity inesistente'), { status: 404 });
  const avvisi = [];
  const nome = struttura ? String(struttura.nome || '').trim() || org.name : org.name;
  const esistente = struttura
    ? await one(`SELECT * FROM sites WHERE organization_id=$1 AND kind='SERVICE' AND lower(btrim(name))=lower(btrim($2)) ORDER BY active DESC, id LIMIT 1`, [org.id, nome])
    : await one(`SELECT * FROM sites WHERE organization_id=$1 AND kind='SERVICE' AND active ORDER BY id LIMIT 1`, [org.id]);
  if (esistente) return { esito: 'esistente', site: esistente, avvisi };
  const data = { code: await codiceLibero(org, linea), name: nome.slice(0, 250), kind: 'SERVICE', organization_id: org.id };
  if (struttura) {
    // struttura del gruppo: il suo indirizzo; se manca, quello della Legal entity (ereditato)
    if (struttura.indirizzo || struttura.citta) Object.assign(data, { address: struttura.indirizzo || null, city: struttura.citta || null, province: struttura.prov ? String(struttura.prov).slice(0, 4).toUpperCase() : null, address_from_org: false });
    else Object.assign(data, { address: org.address, zip: org.zip, city: org.city, province: org.province, address_from_org: true });
    if (struttura.telefono) data.phone = String(struttura.telefono).slice(0, 60);
    if (struttura.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(struttura.email)) data.email = struttura.email;
  } else {
    const k = await contrattoDellaLinea(org.id, linea, contrattoId);
    const d = k?.data || {};
    if (d.site_address) {
      // indirizzo del punto indicato espressamente nel contratto Service
      Object.assign(data, { address: String(d.site_address).slice(0, 300), city: d.pickup?.city || org.city || null, address_from_org: false });
      if (!d.pickup?.city || String(d.pickup.city).trim().toLowerCase() === String(org.city || '').trim().toLowerCase()) Object.assign(data, { zip: org.zip, province: org.province });
    } else Object.assign(data, { address: org.address, zip: org.zip, city: org.city, province: org.province, address_from_org: true });
    const ritiro = orariRitiro(d.pickup?.days);
    if (ritiro.json) data.opening_hours_json = ritiro.json;
    const note = [ritiro.testo, d.pickup?.contact ? `Referente del ritiro: ${[d.pickup.contact, d.pickup.phone, d.pickup.email].filter(Boolean).join(', ')}` : null,
      k ? `Creata dal contratto ${k.protocol || `#${k.id}`} (${origine})` : `Creata da: ${origine}`].filter(Boolean);
    data.notes = note.join('\n');
    if (d.pickup?.phone) data.phone = String(d.pickup.phone).slice(0, 60);
    if (org.phone && !data.phone) data.phone = org.phone;
    if (org.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(org.email)) data.email = org.email;
    // codice StudioLAB inserito nella scheda account prima che la sede esistesse (decisione 5)
    if (await has('business.accounts')) {
      const acc = await one(`SELECT id, studiolab_code FROM business.accounts WHERE organization_id=$1 AND linea = ANY($2::text[]) AND coalesce(studiolab_code,'') <> '' ORDER BY (linea=$3) DESC, id LIMIT 1`, [org.id, LINEE_CLIENTE, linea]);
      if (acc) {
        const libero = await codiceStudiolabLibero(acc.studiolab_code);
        if (libero) data.studiolab_code = libero; else avvisi.push(`Codice StudioLAB ${acc.studiolab_code} già usato da un'altra sede: non riportato (controllo D15b)`);
      }
    }
  }
  for (const k of Object.keys(data)) if (data[k] == null || data[k] === '') delete data[k];
  if (data.address_from_org === undefined) data.address_from_org = false;
  if (!data.address && !data.city) avvisi.push(`${org.name}: la Legal entity non ha indirizzo, la sede SERVICE nasce senza (completalo in Amministrazione > Legal entity: la sede lo eredita)`);
  if (!data.studiolab_code) avvisi.push(`${org.name}: codice StudioLAB da inserire (scheda account del Business Hub o Amministrazione > Sedi)`);
  const site = await saveSite({ data, origine, req, actorId });
  if (data.studiolab_code && await has('business.accounts')) await one(`UPDATE business.accounts SET studiolab_code=NULL, updated_at=now() WHERE organization_id=$1 AND lower(studiolab_code)=lower($2) RETURNING id`, [org.id, data.studiolab_code]);
  return { esito: 'creata', site, avvisi: [...avvisi, ...(site.avvisi || [])] };
}

/**
 * Operazione "Crea le sedi SERVICE mancanti" (Diagnostica anagrafica). Per ogni Legal entity di clienti_attivi_v (entrambi i livelli):
 * una sede per ogni struttura del gruppo attivata (accounts.sedi) che non l'ha ancora; poi, se la Legal entity resta senza sede SERVICE
 * attiva, una sede con l'indirizzo della Legal entity. Le strutture non attivate restano "strutture del gruppo" nell'account.
 * esegui = false: solo il rapporto. orgIds: limita a queste Legal entity. Idempotente.
 */
export async function sediServiceMancanti({ esegui = false, orgIds = null, req = null, actorId = null } = {}) {
  const out = { pronto: await has('business.accounts'), esegui, piano: [], strutture_in_attesa: [], creati: 0, errori: 0 };
  if (!out.pronto) return out;
  const clienti = await many(`SELECT v.org_id, o.name AS org_name, array_agg(DISTINCT v.linea ORDER BY v.linea) AS linee, array_agg(DISTINCT v.livello) AS livelli
      FROM public.clienti_attivi_v v JOIN organizations o ON o.id=v.org_id WHERE ($1::int[] IS NULL OR v.org_id = ANY($1::int[])) GROUP BY v.org_id, o.name ORDER BY lower(o.name)`, [orgIds]);
  for (const c of clienti) {
    const accounts = await many(`SELECT id, linea, sedi FROM business.accounts WHERE organization_id=$1 AND linea = ANY($2::text[]) ORDER BY linea`, [c.org_id, c.linee]);
    const punti = (await many(`SELECT data->>'site_name' AS a, data->'pickup'->>'site' AS b FROM business.contracts WHERE org_id=$1 AND kind = ANY($2::text[]) AND status IN ('FIRMATO','ATTIVO')`, [c.org_id, c.linee])).flatMap((r) => [r.a, r.b]).filter(Boolean);
    const sediEsistenti = await many(`SELECT id, code, name, active FROM sites WHERE organization_id=$1 AND kind='SERVICE'`, [c.org_id]);
    const nomi = new Set(sediEsistenti.map((s) => s.name.trim().toLowerCase()));
    const voci = [];
    for (const a of accounts) {
      for (const s of Array.isArray(a.sedi) ? a.sedi : []) {
        if (!s?.nome) continue;
        const att = strutturaAttivata(s, punti);
        if (!att.si) { out.strutture_in_attesa.push({ org_id: c.org_id, org_name: c.org_name, account_id: a.id, nome: s.nome, citta: s.citta || null, motivo: att.motivo }); continue; }
        if (nomi.has(String(s.nome).trim().toLowerCase())) continue;
        nomi.add(String(s.nome).trim().toLowerCase());
        voci.push({ org_id: c.org_id, org_name: c.org_name, linea: a.linea, tipo: 'STRUTTURA', nome: s.nome, indirizzo: [s.indirizzo, [s.citta, s.prov ? `(${s.prov})` : null].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, motivo: att.motivo, struttura: s });
      }
    }
    const haAttiva = sediEsistenti.some((s) => s.active);
    if (!haAttiva && !voci.length) {
      const o = await one('SELECT address, zip, city, province FROM organizations WHERE id=$1', [c.org_id]);
      voci.push({ org_id: c.org_id, org_name: c.org_name, linea: c.linee[0], tipo: 'LEGAL_ENTITY', nome: c.org_name, indirizzo: [o.address, [o.zip, o.city, o.province ? `(${o.province})` : null].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
        motivo: `cliente ${c.livelli.includes('ATTIVO') ? 'attivo' : 'contrattualizzato'} senza sede SERVICE: una sola sede, quella della Legal entity` });
    }
    for (const v of voci) {
      const { struttura, ...riga } = v;
      if (!esegui) { out.piano.push({ ...riga, esito: 'da creare' }); continue; }
      try {
        const r = await creaSedeService({ orgId: v.org_id, linea: v.linea, struttura: struttura || null, origine: 'Diagnostica anagrafica: Crea le sedi SERVICE mancanti', req, actorId });
        if (r.esito === 'creata') out.creati++;
        out.piano.push({ ...riga, esito: r.esito, site_id: r.site.id, code: r.site.code, avvisi: r.avvisi });
      } catch (e) { out.errori++; out.piano.push({ ...riga, esito: 'errore', motivo: e.message }); }
    }
  }
  return out;
}

/**
 * Indirizzo della Legal entity cambiato: le sue sedi SERVICE con l'indirizzo ereditato (address_from_org) lo seguono, con saveSite
 * (audit SITE_UPDATED con l'origine). Ritorna il numero di sedi aggiornate.
 */
export async function allineaSediDaOrg(orgId, { req = null, actorId = null, origine = 'Amministrazione > Legal entity (indirizzo)' } = {}) {
  const o = await one('SELECT id, address, zip, city, province FROM organizations WHERE id=$1', [orgId]);
  if (!o) return 0;
  const sedi = await many(`SELECT id FROM sites WHERE organization_id=$1 AND kind='SERVICE' AND address_from_org
    AND (address IS DISTINCT FROM $2 OR zip IS DISTINCT FROM $3 OR city IS DISTINCT FROM $4 OR province IS DISTINCT FROM $5)`, [o.id, o.address, o.zip, o.city, o.province]);
  for (const s of sedi) await saveSite({ id: s.id, data: { address: o.address, zip: o.zip, city: o.city, province: o.province ? String(o.province).slice(0, 4) : null, address_from_org: true }, origine, req, actorId });
  return sedi.length;
}
