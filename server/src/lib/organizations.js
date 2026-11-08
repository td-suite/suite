// Funzione unica di creazione delle Legal entity (correzione B5 del programma "anagrafica unica", decisione 8 del CEO dell'08/11/2026).
// Regola di governo (docs/ANAGRAFICA.md): ogni Legal entity nuova nasce da createOrganization, che
//   1. cerca un doppione per partita IVA, poi per codice fiscale, poi per nome uguale (normalizzato: senza accenti, forme societarie e
//      punteggiatura): se lo trova NON crea nulla e restituisce quella esistente (created = false, come = criterio);
//   2. altrimenti crea la riga; se esiste un nome molto simile (pg_trgm, somiglianza >= 0,8) la nuova nasce con needs_review = TRUE e la
//      nota "Possibile doppione di #id" (si rivede in Amministrazione > Legal entity e si unisce con la fusione, B5b);
//   3. scrive l'audit ORG_CREATED con l'origine e l'esito della ricerca e indicizza la riga per la ricerca.
// Tipi decisi dal CEO (decisione 8): locatore = FORNITORE, partner del punto prelievi = PARTNER, cliente o prospect = CLIENTE. Il tipo di
// una Legal entity già esistente non si cambia da qui (una Legal entity che è sia cliente sia partner resta CLIENTE, vedi la migrazione 045).
// La usano: Amministrazione > Legal entity (POST /api/organizations), Business Hub (nuovo prospect, email da assegnare, DB Opportunità,
// pacchetti), Spedizioni (richiedente), Payments e lettura del contratto in Sedi (locatore), connettore e file Legal entity.
import { one, many, tx } from '../db.js';
import { audit } from './util.js';
import { cfOrVat, norm } from './anagraficaMatch.js';
import { indexOrg } from './search.js';

export const ORG_KINDS = ['GRUPPO', 'SOCIETA', 'CLIENTE', 'PARTNER', 'FORNITORE', 'TARGET', 'ALTRO'];
export const SOGLIA_SIMILI = 0.8;
const COLONNE = ['kind', 'code', 'name', 'vat_number', 'tax_code', 'sdi', 'pec', 'email', 'phone', 'address', 'zip', 'city', 'province', 'website', 'active', 'notes',
  'iban', 'bic', 'bank_name', 'needs_review', 'legacy_refs'];

/** Doppione certo: { id, name, kind, come } oppure null. c = client della transazione (facoltativo). */
export async function cercaDoppione(dati, c = null) {
  const run = async (sql, p) => (c ? (await c.query(sql, p)).rows : await many(sql, p));
  const vat = cfOrVat(dati.vat_number); const cf = cfOrVat(dati.tax_code);
  if (vat && vat.length >= 11) { const r = await run(`SELECT id, name, kind FROM public.organizations WHERE regexp_replace(regexp_replace(upper(coalesce(vat_number,'')), '[^A-Z0-9]', '', 'g'), '^IT', '')=$1 ORDER BY active DESC, id LIMIT 1`, [vat]); if (r[0]) return { ...r[0], come: 'partita IVA' }; }
  if (cf && cf.length >= 11) { const r = await run(`SELECT id, name, kind FROM public.organizations WHERE regexp_replace(upper(coalesce(tax_code,'')), '[^A-Z0-9]', '', 'g')=$1 OR regexp_replace(regexp_replace(upper(coalesce(vat_number,'')), '[^A-Z0-9]', '', 'g'), '^IT', '')=$1 ORDER BY active DESC, id LIMIT 1`, [cf]); if (r[0]) return { ...r[0], come: 'codice fiscale' }; }
  const n = norm(dati.name);
  // nome uguale solo se la nuova non porta P.IVA/CF diversi da quelli della riga trovata (stesso nome, P.IVA diversa = soggetti diversi)
  if (n) {
    const cand = await run(`SELECT id, name, kind, vat_number, tax_code FROM public.organizations WHERE lower(unaccent(name)) % lower(unaccent($1)) OR lower(unaccent(name)) = lower(unaccent($1)) ORDER BY active DESC, id`, [dati.name]).catch(() => []);
    const ugu = cand.filter((x) => norm(x.name) === n && !(vat && cfOrVat(x.vat_number) && cfOrVat(x.vat_number) !== vat) && !(cf && cfOrVat(x.tax_code) && cfOrVat(x.tax_code) !== cf));
    if (ugu[0]) return { id: ugu[0].id, name: ugu[0].name, kind: ugu[0].kind, come: 'nome' };
  }
  return null;
}

/** Nomi molto simili (pg_trgm >= 0,8): [{ id, name, sim }] */
export async function nomiSimili(name, c = null, { escludi = null } = {}) {
  if (!name) return [];
  const sql = `SELECT id, name, round(similarity(lower(name), lower($1))::numeric, 2) AS sim FROM public.organizations WHERE similarity(lower(name), lower($1)) >= $2 AND ($3::int IS NULL OR id <> $3) ORDER BY sim DESC, id LIMIT 5`;
  const p = [name, SOGLIA_SIMILI, escludi];
  return (c ? (await c.query(sql, p)).rows : await many(sql, p)).map((x) => ({ ...x, sim: Number(x.sim) }));
}

/**
 * Crea (o ritrova) una Legal entity. dati: colonne di public.organizations (name obbligatorio, kind predefinito CLIENTE).
 * opts: { origine (testo per l'audit), req | actorId, c (client di una transazione già aperta), dedupe (predefinito true),
 *         simili (cerca i nomi simili, predefinito = dedupe), needsReview (forza la spunta "da rivedere") }.
 * Ritorna { org, created, come?, simili }: come = criterio del doppione trovato (partita IVA, codice fiscale, nome).
 * Esempio: await createOrganization({ kind: 'FORNITORE', name: 'Immobiliare Rossi Srl', vat_number: '01234567890' }, { origine: 'Payments > locatore', req })
 */
export async function createOrganization(dati, { origine = 'Amministrazione > Legal entity', req = null, actorId = null, c = null, dedupe = true, simili: cercaSimili = dedupe, needsReview = false } = {}) {
  if (!dati?.name || String(dati.name).trim().length < 2) throw Object.assign(new Error('Ragione sociale mancante'), { status: 400 });
  const lavora = async (cl) => {
    if (dedupe) {
      const d = await cercaDoppione(dati, cl);
      if (d) return { org: (await cl.query('SELECT * FROM public.organizations WHERE id=$1', [d.id])).rows[0], created: false, come: d.come, simili: [] };
    }
    const simili = cercaSimili ? await nomiSimili(dati.name, cl) : [];
    const row = { ...dati, kind: ORG_KINDS.includes(dati.kind) ? dati.kind : 'CLIENTE', name: String(dati.name).trim() };
    if (row.vat_number) row.vat_number = String(row.vat_number).replace(/\s+/g, '');
    if (needsReview || simili.length) row.needs_review = true;
    if (simili.length) row.notes = [row.notes, `Possibile doppione di ${simili.map((x) => `#${x.id} ${x.name} (${Math.round(x.sim * 100)}%)`).join(', ')}: verifica e, se è la stessa, unisci (Amministrazione > Legal entity > Unisci).`].filter(Boolean).join('\n');
    if (row.legacy_refs && typeof row.legacy_refs !== 'string') row.legacy_refs = JSON.stringify(row.legacy_refs);
    const cols = COLONNE.filter((k) => row[k] !== undefined);
    const org = (await cl.query(`INSERT INTO public.organizations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => row[k]))).rows[0];
    return { org, created: true, simili };
  };
  const out = c ? await lavora(c) : await tx(lavora);
  if (out.created) {
    // audit fuori dalla transazione del chiamante (un errore dell'audit non deve annullarla); utente della Suite (req.suiteUser nei moduli)
    const attore = req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null };
    await audit(attore, 'ORG_CREATED', { entity: 'organization', entityId: out.org.id, label: out.org.name, data: { origine, kind: out.org.kind, needs_review: out.org.needs_review, simili: out.simili } });
    indexOrg(out.org).catch(() => {});
  }
  return out;
}

/** Versione comoda: solo l'id (crea o ritrova). */
export const orgIdDa = async (dati, opts) => (await createOrganization(dati, opts)).org.id;
export const getOrganization = (id) => one('SELECT * FROM public.organizations WHERE id=$1', [id]);
