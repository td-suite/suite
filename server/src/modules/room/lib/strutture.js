// Modello dati delle sedi nell'anagrafica unica: l'anagrafica (denominazione, indirizzo, telefono, email, site manager) viene da
// public.sites; le impostazioni Room (ambulatori, personale pianificato, orari, desk, marker della planimetria, email del site
// manager, note) stanno nel documento JSON di site_ext.data; i binari (logo, planimetria PDF, immagine) in struttura_blobs.
// Il documento che viaggia verso il client ha la stessa forma di sempre (lo stesso modello del motore di pianificazione).
import { newStruttura } from './engine.js';

export const BLOB_KINDS = ['logo', 'planPdf', 'planImg'];
// Campi del documento che appartengono all'anagrafica unica: si leggono da public.sites e non si salvano in site_ext
export const ANAGRAFICA_KEYS = ['id', 'denominazione', 'nomeSede', 'indirizzo', 'telefono', 'email', 'siteManager', 'siteManagerEmailDefault'];

// Colonne di sites_v che servono alle route
export const SITE_COLS = 's.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email, s.manager_name, s.manager_email, s.active, s.sort_order, s.data, s.version, s.created_at, s.updated_at, s.updated_by, s.configurata';

export function indirizzoDi(row) {
  const parts = [row.address || ''];
  const city = row.city || '';
  if (city && !parts[0].toLowerCase().includes(city.toLowerCase())) parts.push([row.zip, city, row.province].filter(Boolean).join(' '));
  return parts.filter(Boolean).join(', ');
}

// Documento "lite" (senza binari) di una sede dell'anagrafica unica: impostazioni Room se presenti, altrimenti i valori di una sede nuova
export function liteOf(row) {
  const base = newStruttura();
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const lite = { ...base, ...data };
  for (const k of ANAGRAFICA_KEYS) delete lite[k];
  lite.plan = { markers: data.plan?.markers || {} };
  lite.logo = null;
  return { id: row.id, denominazione: row.name || '', nomeSede: '', indirizzo: indirizzoDi(row), telefono: row.phone || '', email: row.email || '', siteManager: row.manager_name || '', siteManagerEmailDefault: row.manager_email || '', ...lite,
    _code: row.code, _active: row.active, _configurata: Boolean(row.configurata) };
}

// Impostazioni Room da salvare in site_ext.data: tutto il documento tranne anagrafica, binari e campi tecnici
export function extData(lite) {
  const d = { ...lite };
  for (const k of ANAGRAFICA_KEYS) delete d[k];
  delete d.logo;
  d.plan = { markers: lite.plan?.markers || {} };
  for (const k of Object.keys(d)) if (k.startsWith('_')) delete d[k];
  return d;
}

// Divide una struttura completa (formato backup) in documento lite + blob
export function splitStruttura(s) {
  const lite = { ...s };
  delete lite.logo;
  const plan = s.plan || {};
  lite.plan = { markers: plan.markers || {} };
  const blobs = { logo: s.logo || null, planPdf: plan.dataUrl || null, planImg: plan.imgUrl || null };
  for (const k of Object.keys(lite)) if (k.startsWith('_')) delete lite[k];
  return { lite, blobs };
}

// Ricompone una struttura completa
export function joinStruttura(lite, blobs = {}) {
  return { ...lite, logo: blobs.logo || null, plan: { dataUrl: blobs.planPdf || null, imgUrl: blobs.planImg || null, markers: (lite.plan && lite.plan.markers) || {} } };
}

// Chiave di ordinamento alfabetico delle sedi: denominazione, poi nome breve, poi indirizzo
export const sortKey = (s) => `${s.denominazione || ''}\u0001${s.nomeSede || ''}\u0001${s.indirizzo || ''}`.toLowerCase();
export const sortStrutture = (list) => [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'it'));

// Controllo minimo di forma del documento (il contenuto è libero: è lo stesso modello della versione precedente)
export function validateLite(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'documento non valido';
  if (!Array.isArray(d.ambulatori) || !Array.isArray(d.personale)) return 'ambulatori e personale devono essere elenchi';
  if (d.hours && typeof d.hours !== 'object') return 'orari non validi';
  if (d.logo || (d.plan && (d.plan.dataUrl || d.plan.imgUrl))) return 'i binari vanno inviati nel campo blobs';
  if (JSON.stringify(d).length > 4_000_000) return 'documento troppo grande';
  return null;
}

/** Sedi attive dell'anagrafica unica con le impostazioni Room (solo quelle configurate se onlyConfigured). */
export async function loadSedi({ onlyConfigured = true, ids = null } = {}) {
  const { many } = await import('../db.js');
  const rows = await many(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.active AND ($1::boolean = FALSE OR s.configurata) AND ($2::int[] IS NULL OR s.id = ANY($2)) ORDER BY s.sort_order, lower(s.name)`, [onlyConfigured, ids]);
  return rows.map((r) => ({ row: r, lite: liteOf(r) }));
}

/** Modifica le impostazioni Room di una sede con un mutatore (ritorna true se ha cambiato qualcosa), creando una nuova versione in cronologia. */
export async function mutateStruttura(id, mutator, user, note = 'aggiornamento automatico') {
  const { one, tx } = await import('../db.js');
  const row = await one(`SELECT ${SITE_COLS} FROM sites_v s WHERE s.id=$1 AND s.active`, [id]);
  if (!row) return false;
  const data = liteOf(row);
  if (!mutator(data)) return false;
  const newVersion = (row.version || 0) + 1;
  const ext = extData(data);
  await tx(async (c) => {
    await c.query(`INSERT INTO site_ext (site_id, data, version, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (site_id) DO UPDATE SET data=EXCLUDED.data, version=EXCLUDED.version, updated_at=now(), updated_by=EXCLUDED.updated_by`, [id, JSON.stringify(ext), newVersion, user?.id || null]);
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name) VALUES ($1,$2,$3,$4,$5)', [id, newVersion, JSON.stringify(ext), user?.id || null, `${user?.full_name || 'sistema'} · ${note}`]);
    await c.query('DELETE FROM struttura_history WHERE struttura_id=$1 AND id NOT IN (SELECT id FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 500)', [id]);
  });
  return true;
}
