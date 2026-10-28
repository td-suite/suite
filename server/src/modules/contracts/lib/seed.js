// Dati di base del modulo (livelli e minimi tabellari CCNL Studi Professionali, sezioni di sintesi, requisiti del dossier,
// aree): nell'app originale venivano seminati all'avvio; con la partenza da zero sull'anagrafica unica mancavano, e senza i
// minimi tabellari la scomposizione della RAL (paga base, superminimo, indennità di funzione) non funzionava. Idempotente:
// aggiorna livelli, minimi e requisiti; le sezioni CCNL e le aree solo se la tabella è vuota (sono modificabili dall'utente).
import { one, q, many } from '../db.js';
import { CCNL_LEVELS, CCNL_SECTIONS, DOSSIER_REQUIREMENTS, AREAS, STAFF_AREAS } from './seedData.js';

export async function ensureSeed() {
  const stats = { levels: 0, minimums: 0, sections: 0, requirements: 0, areas: 0 };
  for (const [i, l] of CCNL_LEVELS.entries()) {
    const row = await one(`INSERT INTO ccnl_levels (ccnl, level, description, sort_order, probation_days) VALUES ('STUDI_PROFESSIONALI',$1,$2,$3,$4)
      ON CONFLICT (ccnl, level) DO UPDATE SET description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, probation_days=coalesce(ccnl_levels.probation_days, EXCLUDED.probation_days) RETURNING id`, [l.level, l.description, (i + 1) * 10, l.probation_days]);
    stats.levels++;
    for (const m of l.minimums || []) {
      if (m.amount == null) continue;
      const r = await q(`INSERT INTO ccnl_minimums (level_id, valid_from, amount, enac) VALUES ($1,$2,$3,$4) ON CONFLICT (level_id, valid_from) DO NOTHING`, [row.id, m.from, m.amount, m.enac ?? null]);
      stats.minimums += r.rowCount;
    }
  }
  if (!(await one('SELECT 1 FROM ccnl_sections LIMIT 1'))) {
    for (const [i, s] of CCNL_SECTIONS.entries()) { await q(`INSERT INTO ccnl_sections (ccnl, title, body, sort_order) VALUES ('STUDI_PROFESSIONALI',$1,$2,$3)`, [s.title, s.body, (i + 1) * 10]); stats.sections++; }
  }
  for (const d of DOSSIER_REQUIREMENTS) {
    const r = await q(`INSERT INTO dossier_requirements (kind, category, label, required, renew_months, sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kind, category) DO NOTHING`, [d.kind, d.category, d.label, d.required !== false, d.renew_months ?? null, d.sort_order ?? 100]);
    stats.requirements += r.rowCount;
  }
  if (!(await one('SELECT 1 FROM areas LIMIT 1'))) {
    const cols = new Set((await many(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='areas'`)).map((c) => c.column_name));
    for (const [i, a] of AREAS.entries()) {
      const name = Array.isArray(a) ? a[0] : a;
      const extra = cols.has('kind') ? `, kind` : '';
      const extraV = cols.has('kind') ? `, '${STAFF_AREAS.includes(name) ? 'STAFF' : 'LINEA'}'` : '';
      await q(`INSERT INTO areas (name, sort_order${extra}) VALUES ($1,$2${extraV}) ON CONFLICT (name) DO NOTHING`, [name, (i + 1) * 10]);
      stats.areas++;
    }
  }
  return stats;
}
