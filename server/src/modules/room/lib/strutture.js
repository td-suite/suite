// Modello dati delle strutture: il documento "lite" (JSONB) e i binari (logo, planimetria PDF, immagine) separati
export const BLOB_KINDS = ['logo', 'planPdf', 'planImg'];

// Divide una struttura completa (formato della versione precedente / backup) in documento lite + blob
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
  if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(d.id)) return 'id non valido';
  if (!Array.isArray(d.ambulatori) || !Array.isArray(d.personale)) return 'ambulatori e personale devono essere elenchi';
  if (d.hours && typeof d.hours !== 'object') return 'orari non validi';
  if (d.logo || (d.plan && (d.plan.dataUrl || d.plan.imgUrl))) return 'i binari vanno inviati nel campo blobs';
  if (JSON.stringify(d).length > 4_000_000) return 'documento troppo grande';
  return null;
}

/** Modifica il documento di una sede con un mutatore (ritorna true se ha cambiato qualcosa), creando una nuova versione in cronologia. */
export async function mutateStruttura(id, mutator, user, note = 'aggiornamento automatico') {
  const { one, tx } = await import('../db.js');
  const row = await one('SELECT data, version FROM strutture WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!row) return false;
  const data = JSON.parse(JSON.stringify(row.data));
  if (!mutator(data)) return false;
  const newVersion = row.version + 1;
  await tx(async (c) => {
    await c.query('UPDATE strutture SET data=$2, version=$3, updated_at=now(), updated_by=$4 WHERE id=$1', [id, JSON.stringify(data), newVersion, user?.id || null]);
    await c.query('INSERT INTO struttura_history (struttura_id, version, data, user_id, user_name) VALUES ($1,$2,$3,$4,$5)', [id, newVersion, JSON.stringify(data), user?.id || null, `${user?.full_name || 'sistema'} · ${note}`]);
    await c.query('DELETE FROM struttura_history WHERE struttura_id=$1 AND id NOT IN (SELECT id FROM struttura_history WHERE struttura_id=$1 ORDER BY id DESC LIMIT 500)', [id]);
  });
  return true;
}
