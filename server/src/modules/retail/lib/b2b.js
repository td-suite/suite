// Clienti B2B di Retail come ponte codice StudioLAB → Legal entity (correzione B15 del programma "anagrafica unica", 08/11/2026).
// Regola: i clienti B2B sono i clienti ATTIVI e CONTRATTUALIZZATI della Suite (public.clienti_attivi_v, Service e Medicina del Lavoro).
// La riga retail.customers con kind = 'B2B' tiene solo il codice cliente del gestionale (external_code), la Legal entity a cui
// corrisponde (organization_id) e i campi propri di Retail (segmento b2b_type, settore, note); ragione sociale, P.IVA, indirizzo, email e
// telefono si leggono dalla Legal entity (vista b2b_v). Abbinamento:
//   - automatico (AUTO) quando una sede della Suite ha lo stesso codice StudioLAB (public.sites.studiolab_code, di norma la sede SERVICE
//     del cliente): la Legal entity è quella della sede;
//   - manuale (MANUALE) dalla pagina "Aziende e strutture (B2B)" > Da abbinare, con il selettore della Legal entity;
//   - DA_ABBINARE finché nessuno dei due: le vendite restano agganciate al codice, nessun cliente B2B anonimo nasce più dall'import.
import { one, many, q } from '../db.js';

/** Legal entity per codice StudioLAB (sede con quel codice): { org_id, site_id, site_code } oppure null */
export async function orgDaCodice(code, client = null) {
  if (!code) return null;
  const run = async (sql, p) => (client ? (await client.query(sql, p)).rows[0] : one(sql, p));
  return run(`SELECT s.organization_id AS org_id, s.id AS site_id, s.code AS site_code FROM public.sites s
     WHERE lower(s.studiolab_code) = lower($1) AND s.organization_id IS NOT NULL ORDER BY s.active DESC, (s.kind = 'SERVICE') DESC, s.id LIMIT 1`, [String(code).trim()]);
}

/**
 * Abbinamento automatico dei B2B ancora da abbinare (o dei soli `ids`) dai codici StudioLAB delle sedi. correggiDiversi = true riallinea
 * anche i B2B già abbinati a una Legal entity diversa da quella della sede con lo stesso codice (controllo D21b).
 * Ritorna [{ id, external_code, esito, organization_id? }].
 */
export async function abbinaDaiCodici({ ids = null, correggiDiversi = false, userId = null } = {}) {
  const rows = await many(`SELECT c.id, c.external_code, c.organization_id FROM customers c WHERE c.kind='B2B' AND NOT c.demo AND coalesce(c.external_code,'') <> ''
      AND ($1::int[] IS NULL OR c.id = ANY($1::int[])) AND (c.organization_id IS NULL OR $2::boolean) ORDER BY c.id`, [ids, correggiDiversi]);
  const out = [];
  for (const r of rows) {
    const m = await orgDaCodice(r.external_code);
    if (!m) { out.push({ id: r.id, external_code: r.external_code, esito: 'da abbinare', motivo: 'nessuna sede della Suite con questo codice StudioLAB: abbina a mano' }); continue; }
    if (Number(m.org_id) === Number(r.organization_id)) { out.push({ id: r.id, external_code: r.external_code, esito: 'già abbinato' }); continue; }
    await q(`UPDATE customers SET organization_id=$2, abbinamento='AUTO', abbinato_at=now(), abbinato_by=$3, updated_at=now() WHERE id=$1`, [r.id, m.org_id, userId]);
    out.push({ id: r.id, external_code: r.external_code, esito: `abbinato alla Legal entity #${m.org_id} (sede ${m.site_code})`, organization_id: m.org_id });
  }
  return out;
}

/** Abbinamento manuale di un codice alla Legal entity scelta (null = torna da abbinare). */
export async function abbinaManuale(id, orgId, { userId = null } = {}) {
  const c = await one(`SELECT id, kind, external_code FROM customers WHERE id=$1`, [id]);
  if (!c || c.kind !== 'B2B') throw Object.assign(new Error('Cliente B2B non trovato'), { status: 404 });
  if (orgId && !(await one('SELECT 1 FROM public.organizations WHERE id=$1', [orgId]))) throw Object.assign(new Error('Legal entity inesistente'), { status: 400 });
  await q(`UPDATE customers SET organization_id=$2, abbinamento=$3, abbinato_at=now(), abbinato_by=$4, updated_at=now() WHERE id=$1`, [id, orgId || null, orgId ? 'MANUALE' : 'DA_ABBINARE', userId]);
  return one('SELECT * FROM b2b_v WHERE id=$1', [id]);
}

/**
 * Pagina B2B: clienti attivi e contrattualizzati della Suite (una riga per Legal entity, con le linee e i codici StudioLAB abbinati,
 * visite e fatturato dalle vendite), codici da abbinare e codici abbinati a Legal entity che non sono (più) clienti attivi.
 */
export async function quadroB2B({ q: testo = '' } = {}) {
  const t = testo ? `%${testo}%` : null;
  const clienti = await many(`
    WITH v AS (SELECT org_id, string_agg(DISTINCT linea, ', ' ORDER BY linea) AS linee, CASE WHEN bool_or(livello='ATTIVO') THEN 'ATTIVO' ELSE 'CONTRATTUALIZZATO' END AS livello, min(dal) AS dal
                 FROM public.clienti_attivi_v GROUP BY org_id)
    SELECT o.id AS organization_id, o.name, o.vat_number, o.city, o.province, o.email, v.linee, v.livello, v.dal,
           coalesce(json_agg(json_build_object('id', c.id, 'external_code', c.external_code, 'abbinamento', c.abbinamento) ORDER BY c.external_code) FILTER (WHERE c.id IS NOT NULL), '[]') AS codici,
           coalesce(sum(c.visits), 0)::int AS visits, coalesce(sum(c.revenue), 0) AS revenue, max(c.last_visit) AS last_visit,
           (array_agg(c.b2b_type) FILTER (WHERE c.b2b_type IS NOT NULL))[1] AS b2b_type, (array_agg(c.sector) FILTER (WHERE c.sector IS NOT NULL))[1] AS sector
      FROM v JOIN public.organizations o ON o.id = v.org_id
      LEFT JOIN customers c ON c.organization_id = o.id AND c.kind = 'B2B' AND NOT c.demo
     WHERE ($1::text IS NULL OR o.name ILIKE $1 OR o.vat_number ILIKE $1 OR o.city ILIKE $1 OR c.external_code ILIKE $1)
     GROUP BY o.id, v.linee, v.livello, v.dal ORDER BY revenue DESC, lower(o.name)`, [t]);
  const daAbbinare = await many(`SELECT id, external_code, nome_nel_file, vat_number, visits, revenue, last_visit, b2b_type FROM b2b_v
     WHERE organization_id IS NULL AND NOT demo AND ($1::text IS NULL OR nome_nel_file ILIKE $1 OR external_code ILIKE $1) ORDER BY revenue DESC NULLS LAST, external_code`, [t]);
  const nonClienti = await many(`SELECT id, external_code, organization_id, company_name, organization_kind, visits, revenue, last_visit, abbinamento FROM b2b_v
     WHERE organization_id IS NOT NULL AND cliente_livello IS NULL AND NOT demo AND ($1::text IS NULL OR company_name ILIKE $1 OR external_code ILIKE $1) ORDER BY revenue DESC NULLS LAST`, [t]);
  return { clienti, da_abbinare: daAbbinare, non_clienti: nonClienti };
}
