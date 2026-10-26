// Statistiche sui ticket visibili all'utente: totali per stato, categoria, unità, struttura; tempi medi; SLA rispettati;
// backlog per età; andamento 12 mesi; valutazione media; top 5 unità per carico.
import { many, one } from '../db.js';
import { visibleSql } from './access.js';

export async function computeStats(ctx, { da, a, unit_id } = {}) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [visibleSql(ctx, params)];
  if (da) where.push(`t.created_at >= ${p(da)}::date`);
  if (a) where.push(`t.created_at < (${p(a)}::date + 1)`);
  if (unit_id) where.push(`t.unit_id IN (SELECT id FROM unit_subtree(ARRAY[${p(unit_id)}]::int[]))`);
  const vis = `vis AS (SELECT t.* FROM tickets t WHERE ${where.join(' AND ')})`;
  const run = (sql) => many(`WITH ${vis} ${sql}`, params);
  const runOne = async (sql) => (await many(`WITH ${vis} ${sql}`, params))[0] || {};

  const [stati, categorie, unita, strutture, tempi, slaStat, backlog, mesi, valutazione, top, priorita] = await Promise.all([
    run(`SELECT stato, count(*)::int AS n FROM vis GROUP BY stato`),
    run(`SELECT c.id, c.nome, count(*)::int AS n, count(*) FILTER (WHERE v.stato NOT IN ('CHIUSO','ANNULLATO'))::int AS aperti FROM vis v LEFT JOIN categorie c ON c.id=v.categoria_id GROUP BY c.id, c.nome ORDER BY n DESC`),
    run(`SELECT u.id, u.name AS nome, org_unit_path(u.id) AS path, count(*)::int AS n, count(*) FILTER (WHERE v.stato NOT IN ('CHIUSO','ANNULLATO'))::int AS aperti,
           count(*) FILTER (WHERE v.sla_risoluzione_sforato)::int AS sforati, round(avg(EXTRACT(EPOCH FROM v.risolto_at - v.created_at) / 3600 - v.attesa_secondi / 3600.0) FILTER (WHERE v.risolto_at >= v.created_at)::numeric, 1) AS ore_medie_risoluzione
         FROM vis v JOIN public.org_units u ON u.id=v.unit_id GROUP BY u.id, u.name ORDER BY n DESC`),
    run(`SELECT coalesce(s.name, o.name, 'Non indicata') AS nome, CASE WHEN s.id IS NOT NULL THEN 'Sede' WHEN o.id IS NOT NULL THEN 'Legal entity' ELSE '' END AS tipo, count(*)::int AS n, count(*) FILTER (WHERE v.stato NOT IN ('CHIUSO','ANNULLATO'))::int AS aperti
         FROM vis v LEFT JOIN public.sites s ON s.id=v.per_conto_site_id LEFT JOIN public.organizations o ON o.id=v.per_conto_org_id GROUP BY 1, 2 ORDER BY n DESC`),
    runOne(`SELECT round(avg(EXTRACT(EPOCH FROM prima_risposta_at - created_at) / 3600)::numeric, 1) AS ore_prima_risposta,
                   round(avg(EXTRACT(EPOCH FROM risolto_at - created_at) / 3600 - attesa_secondi / 3600.0) FILTER (WHERE risolto_at >= created_at)::numeric, 1) AS ore_risoluzione,
                   round(avg(EXTRACT(EPOCH FROM coalesce(chiuso_at, risolto_at) - created_at) / 3600) FILTER (WHERE coalesce(chiuso_at, risolto_at) >= created_at)::numeric, 1) AS ore_chiusura
            FROM vis WHERE stato <> 'ANNULLATO'`),
    runOne(`SELECT count(*) FILTER (WHERE prima_risposta_at IS NOT NULL)::int AS risposte, count(*) FILTER (WHERE prima_risposta_at IS NOT NULL AND prima_risposta_at <= sla_risposta_scadenza)::int AS risposte_ok,
                   count(*) FILTER (WHERE risolto_at IS NOT NULL OR stato='CHIUSO')::int AS risoluzioni, count(*) FILTER (WHERE (risolto_at IS NOT NULL OR stato='CHIUSO') AND NOT sla_risoluzione_sforato)::int AS risoluzioni_ok,
                   count(*) FILTER (WHERE stato NOT IN ('CHIUSO','ANNULLATO') AND ((prima_risposta_at IS NULL AND sla_risposta_scadenza < now()) OR (risolto_at IS NULL AND stato <> 'IN_ATTESA' AND sla_risoluzione_scadenza < now())))::int AS in_ritardo_ora
            FROM vis WHERE stato <> 'ANNULLATO'`),
    runOne(`SELECT count(*) FILTER (WHERE eta <= 2)::int AS g0_2, count(*) FILTER (WHERE eta BETWEEN 3 AND 7)::int AS g3_7, count(*) FILTER (WHERE eta BETWEEN 8 AND 30)::int AS g8_30, count(*) FILTER (WHERE eta > 30)::int AS g30
            FROM (SELECT EXTRACT(DAY FROM now() - created_at)::int AS eta FROM vis WHERE stato NOT IN ('CHIUSO','ANNULLATO')) b`),
    many(`WITH ${vis}, m AS (SELECT date_trunc('month', now()) - (n || ' months')::interval AS mese FROM generate_series(0, 11) n)
          SELECT to_char(m.mese, 'YYYY-MM') AS mese, (SELECT count(*)::int FROM vis WHERE date_trunc('month', created_at) = m.mese) AS aperti,
                 (SELECT count(*)::int FROM vis WHERE date_trunc('month', coalesce(chiuso_at, risolto_at)) = m.mese AND stato IN ('RISOLTO','CHIUSO')) AS chiusi
          FROM m ORDER BY m.mese`, params),
    runOne(`SELECT round(avg(valutazione)::numeric, 2) AS media, count(valutazione)::int AS n FROM vis`),
    run(`SELECT u.name AS nome, org_unit_path(u.id) AS path, count(*)::int AS n FROM vis v JOIN public.org_units u ON u.id=v.unit_id WHERE v.stato NOT IN ('CHIUSO','ANNULLATO') GROUP BY u.id, u.name ORDER BY n DESC LIMIT 5`),
    run(`SELECT priorita, count(*)::int AS n, count(*) FILTER (WHERE stato NOT IN ('CHIUSO','ANNULLATO'))::int AS aperti FROM vis GROUP BY priorita ORDER BY priorita`),
  ]);
  const pct = (ok, n) => (n ? Math.round((ok / n) * 1000) / 10 : null);
  const totale = stati.reduce((s, x) => s + x.n, 0);
  return {
    periodo: { da: da || null, a: a || null, unit_id: unit_id || null },
    totale, aperti: stati.filter((s) => !['CHIUSO', 'ANNULLATO'].includes(s.stato)).reduce((s, x) => s + x.n, 0),
    stati: Object.fromEntries(stati.map((s) => [s.stato, s.n])), priorita,
    categorie, unita, strutture,
    tempi: { ore_prima_risposta: tempi.ore_prima_risposta != null ? Number(tempi.ore_prima_risposta) : null, ore_risoluzione: tempi.ore_risoluzione != null ? Number(tempi.ore_risoluzione) : null, ore_chiusura: tempi.ore_chiusura != null ? Number(tempi.ore_chiusura) : null },
    sla: { ...slaStat, pct_risposta: pct(slaStat.risposte_ok, slaStat.risposte), pct_risoluzione: pct(slaStat.risoluzioni_ok, slaStat.risoluzioni) },
    backlog: { '0-2': backlog.g0_2 || 0, '3-7': backlog.g3_7 || 0, '8-30': backlog.g8_30 || 0, '>30': backlog.g30 || 0 },
    mesi, valutazione: { media: valutazione.media != null ? Number(valutazione.media) : null, n: valutazione.n || 0 }, top5: top,
  };
}
