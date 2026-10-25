// Centralino (file "Toscana Diagnostica - Centralino Telefonico", Rev01 del 06/10/2026): i numeri diretti sono 055 776 + interno,
// l'interno sono le ultime tre cifre. Regole applicate dopo ogni importazione di Persone e Organigramma e a ogni salvataggio di persona:
// 1. interno personale alla persona (per cognome e nome, solo se non ne ha uno); 2. numero d'ufficio = prefisso + interno, se manca;
// 3. interno di reparto sull'unità omonima dell'organigramma (Preanalitica, Core Lab, ...).
import { q } from '../db.js';
import { PERSONAL_EXT, DEPARTMENT_EXT } from '../seed/centralino.js';

export const SWITCHBOARD_PREFIX = '055 776';
export const directNumber = (ext) => (ext && /^\d{3}$/.test(String(ext).trim()) ? `${SWITCHBOARD_PREFIX}${String(ext).trim()}` : null);

const DEPT_ALIASES = { 'Core Lab': ['Core Lab', 'Corelab', 'CoreLab'] };

export async function applyCentralino(personId = null) {
  if (personId == null) {
    for (const [last, first, ext] of PERSONAL_EXT) {
      await q(`UPDATE people SET phone_ext=$3, updated_at=now() WHERE phone_ext IS NULL AND lower(unaccent(last_name))=lower(unaccent($1)) AND lower(unaccent(first_name))=lower(unaccent($2))`, [last, first, ext]);
    }
    for (const d of DEPARTMENT_EXT) {
      if (/centralino|citofono/i.test(d.name)) continue;
      const names = DEPT_ALIASES[d.name] || [d.name];
      await q(`UPDATE org_units SET phone_ext=$1, updated_at=now() WHERE phone_ext IS NULL AND lower(name) = ANY($2::text[])`, [d.ext, names.map((n) => n.toLowerCase())]);
    }
  }
  // numero diretto dall'interno (solo tre cifre) quando il telefono d'ufficio manca
  await q(`UPDATE people SET phone_office = $1 || phone_ext, updated_at=now() WHERE phone_office IS NULL AND phone_ext ~ '^[0-9]{3}$' ${personId != null ? 'AND id=$2' : ''}`, personId != null ? [SWITCHBOARD_PREFIX, personId] : [SWITCHBOARD_PREFIX]);
}
