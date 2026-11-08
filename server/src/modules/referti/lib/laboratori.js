// C12 (programma anagrafica unica, 08/11/2026): i laboratori di origine dei referti esterni (sorgenti Bianalisi, Cerba RDI, Nuova Igea)
// sono Legal entity dell'anagrafica (Amministrazione > Legal entity). Il collegamento si salva nelle impostazioni del modulo
// (laboratori_origine = { SORGENTE: org_id }); finché manca la Suite propone la Legal entity con il nome più simile (nessuna scrittura).
import { many, one } from '../db.js';
import { settings, setSetting } from './core.js';

export const SORGENTI = { BIANALISI: 'Bianalisi', CERBA_RDI: 'Cerba RDI (Rete Diagnostica Italiana)', CERBA_NUOVA_IGEA: 'Nuova Igea' };
const CHIAVI = { BIANALISI: 'bianalisi', CERBA_RDI: 'rdi', CERBA_NUOVA_IGEA: 'nuova igea' };

export async function laboratoriOrigine() {
  const imp = await settings();
  const map = imp.laboratori_origine && typeof imp.laboratori_origine === 'object' ? imp.laboratori_origine : {};
  const out = [];
  for (const [k, label] of Object.entries(SORGENTI)) {
    const id = Number(map[k]) || null;
    const org = id ? await one('SELECT id, name, vat_number, kind FROM public.organizations WHERE id=$1', [id]) : null;
    const proposta = org ? null : await one(`SELECT id, name, vat_number, kind FROM public.organizations WHERE active AND (name ILIKE $1 OR similarity(lower(name), $2) >= 0.4)
        ORDER BY similarity(lower(name), $2) DESC LIMIT 1`, [`%${CHIAVI[k]}%`, CHIAVI[k]]).catch(() => null);
    out.push({ sorgente: k, label, org, proposta });
  }
  return out;
}

export async function salvaLaboratori(mappa, userId) {
  const imp = await settings();
  const cur = imp.laboratori_origine && typeof imp.laboratori_origine === 'object' ? { ...imp.laboratori_origine } : {};
  for (const [k, v] of Object.entries(mappa || {})) {
    if (!SORGENTI[k]) continue;
    if (v == null || v === '') { delete cur[k]; continue; }
    if (!(await one('SELECT 1 FROM public.organizations WHERE id=$1', [Number(v)]))) throw Object.assign(new Error('Legal entity inesistente'), { status: 400 });
    cur[k] = Number(v);
  }
  await setSetting('laboratori_origine', cur, userId);
  return laboratoriOrigine();
}
