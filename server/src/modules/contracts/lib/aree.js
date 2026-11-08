// Aree del modulo Contratti del personale = unità di primo livello dell'organigramma del core (correzione B8 del programma "anagrafica
// unica", 08/11/2026). L'organigramma si governa in Amministrazione > Organizzazione; qui si allineano le aree del modulo (usate dalle
// schede delle risorse, dalle statistiche e dal CV Box): per ogni unità di primo livello un'area collegata (core_unit_id) con lo stesso
// nome e la stessa collocazione (tecnostruttura o linea). Le aree senza unità restano (con le loro persone) e si elencano: nessuna
// area si elimina da sola.
import { many, one, q } from '../db.js';

export async function allineaAreeDalCore() {
  const primo = await many(`SELECT u.id, u.name, u.branch, u.sort_order FROM public.org_units u
     WHERE u.active AND u.parent_id IN (SELECT r.id FROM public.org_units r WHERE r.parent_id IS NULL) ORDER BY u.sort_order, u.name`);
  const out = { create: [], rinominate: [], senza_unita: [] };
  for (const u of primo) {
    const a = await one('SELECT id, name FROM areas WHERE core_unit_id=$1', [u.id]);
    if (a) {
      if (a.name !== u.name) { await q('UPDATE areas SET name=$2 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM areas x WHERE lower(x.name)=lower($2) AND x.id<>$1)', [a.id, u.name]); out.rinominate.push({ area_id: a.id, da: a.name, a: u.name }); }
      continue;
    }
    const omonima = await one('SELECT id FROM areas WHERE lower(unaccent(name))=lower(unaccent($1)) AND core_unit_id IS NULL', [u.name]);
    if (omonima) { await q('UPDATE areas SET core_unit_id=$2 WHERE id=$1', [omonima.id, u.id]); out.create.push({ area_id: omonima.id, unita: u.name, collegata: true }); continue; }
    const r = await one(`INSERT INTO areas (name, sort_order, parent_id, level, kind, core_unit_id) VALUES ($1,$2,NULL,1,$3,$4) RETURNING id`, [u.name, u.sort_order ?? 100, u.branch === 'STAFF' ? 'STAFF' : 'LINEA', u.id]);
    out.create.push({ area_id: r.id, unita: u.name });
  }
  out.senza_unita = await many(`SELECT a.id, a.name, (SELECT count(*)::int FROM resources_v r WHERE r.area_id=a.id) AS persone FROM areas a WHERE a.core_unit_id IS NULL ORDER BY a.name`);
  return out;
}
