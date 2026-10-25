// Analisi degli scostamenti budget/consuntivo: ipotesi esterne dai dati di mercato e dai segnali interni, con narrativa facoltativa via API Claude
import { many, one } from '../db.js';
import { config } from '../config.js';
import { METRIC_LABEL } from './marketSeed.js';

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

// Raccoglie i segnali per un mese: giorni lavorati, promo, campagne, esposizione, anno precedente, mercato del bacino
export async function collectSignals({ year, month, siteId, lineId }) {
  const sig = [];
  const wd = await one('SELECT planned, actual_override FROM working_days WHERE year=$1 AND month=$2 AND coalesce(site_id,0)=$3', [year, month, siteId || 0]);
  const actualDays = (await one(`SELECT count(DISTINCT sale_date)::int AS n FROM sales WHERE date_part('year', sale_date)=$1 AND date_part('month', sale_date)=$2 ${siteId ? 'AND site_id=$3' : ''}`, siteId ? [year, month, siteId] : [year, month])).n;
  const days = { planned: wd?.planned ?? null, actual: wd?.actual_override ?? actualDays };
  const now = new Date(); const inProgress = year === now.getFullYear() && month === now.getMonth() + 1;
  if (inProgress) sig.push({ kind: 'INTERNA', weight: 0.05, text: `Mese in corso: ${days.actual} giorni lavorati su ${days.planned || '–'} pianificati. Il confronto va letto sul budget pro rata.` });
  else if (days.planned && days.actual != null && days.actual < days.planned) sig.push({ kind: 'INTERNA', weight: Math.min(1, (days.planned - days.actual) / days.planned * 3), text: `Giorni lavorati inferiori al pianificato: ${days.actual} su ${days.planned} (${pct(days.actual, days.planned)}%). A parità di produttività giornaliera il fatturato sconta circa ${Math.abs(pct(days.actual, days.planned))}%.` });
  const promo = await one("SELECT name, status, discount_type FROM promotions WHERE year=$1 AND month=$2 AND status<>'ANNULLATA' ORDER BY id LIMIT 1", [year, month]);
  if (!promo) sig.push({ kind: 'INTERNA', weight: 0.4, text: 'Nessuna promozione pianificata nel mese: manca la leva di spinta commerciale.' });
  else if (promo.status === 'BOZZA') sig.push({ kind: 'INTERNA', weight: 0.3, text: `Promozione "${promo.name}" rimasta in bozza: probabilmente non attivata in sede e sui canali.` });
  const camp = await one("SELECT count(*)::int AS n, coalesce(sum(coalesce(spent, budget)),0) AS spent FROM campaigns WHERE start_date <= make_date($1,$2,28) AND coalesce(end_date, start_date + 30) >= make_date($1,$2,1) AND status<>'SOSPESA'", [year, month]);
  const campPrev = await one("SELECT coalesce(sum(coalesce(spent, budget)),0) AS spent FROM campaigns WHERE start_date <= make_date($1,$2,28) AND coalesce(end_date, start_date + 30) >= make_date($1,$2,1)", [month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1]);
  if (Number(camp.spent) === 0) sig.push({ kind: 'INTERNA', weight: 0.3, text: 'Nessun investimento in campagne attivo nel mese.' });
  else if (Number(campPrev.spent) > 0 && Number(camp.spent) < Number(campPrev.spent) * 0.6) sig.push({ kind: 'INTERNA', weight: 0.3, text: `Investimento in campagne in calo rispetto al mese precedente (${Math.round(camp.spent)} € contro ${Math.round(campPrev.spent)} €).` });
  const expo = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='INSTALLATO')::int AS ok FROM exposure_items WHERE status<>'RIMOSSO' ${siteId ? 'AND site_id=$1' : ''}`, siteId ? [siteId] : []);
  if (expo.total && expo.ok / expo.total < 0.7) sig.push({ kind: 'INTERNA', weight: 0.3, text: `Esposizione in sede sotto standard: ${Math.round((expo.ok / expo.total) * 100)}% dei materiali installati.` });
  // Stagionalità: stesso mese dell'anno precedente e media degli altri mesi
  const py = await one(`SELECT coalesce(sum(s.net_amount),0) AS v FROM sales s ${lineId ? 'JOIN products p ON p.id=s.product_id' : ''} WHERE date_part('year', s.sale_date)=$1 AND date_part('month', s.sale_date)=$2 ${siteId ? `AND s.site_id=${Number(siteId)}` : ''} ${lineId ? `AND p.line_id=${Number(lineId)}` : ''}`, [year - 1, month]);
  const pyAvg = await one(`SELECT coalesce(sum(s.net_amount),0)/greatest(count(DISTINCT date_trunc('month', s.sale_date)),1) AS v FROM sales s ${lineId ? 'JOIN products p ON p.id=s.product_id' : ''} WHERE date_part('year', s.sale_date)=$1 ${siteId ? `AND s.site_id=${Number(siteId)}` : ''} ${lineId ? `AND p.line_id=${Number(lineId)}` : ''}`, [year - 1]);
  if (Number(py.v) > 0 && Number(pyAvg.v) > 0) { const idx = pct(py.v, pyAvg.v); if (idx != null && Math.abs(idx) >= 12) sig.push({ kind: 'ESTERNA', weight: 0.4, text: `Stagionalità: nell'anno precedente questo mese valeva ${idx > 0 ? '+' : ''}${idx}% rispetto alla media mensile.` }); }
  // Mercato del bacino: reddito dei comuni rispetto alla regione, imprese/addetti per ATECO se caricati
  const cities = siteId ? ((await one('SELECT catchment_cities, city FROM sites WHERE id=$1', [siteId])) || {}) : null;
  const list = cities ? [...new Set([cities.city, ...(cities.catchment_cities || '').split(',').map((x) => x.trim())].filter(Boolean))] : (await many("SELECT DISTINCT city FROM sites WHERE active AND city IS NOT NULL")).map((x) => x.city);
  const market = await many(`SELECT territory, metric, value, year, ateco FROM market_data WHERE territory_kind='COMUNE' AND lower(territory) = ANY($1) ORDER BY year DESC`, [list.map((x) => x.toLowerCase())]);
  const bench = await one("SELECT value FROM market_data WHERE territory_kind='REGIONE' AND metric='reddito_medio' ORDER BY year DESC LIMIT 1");
  const seen = new Set(); const marketFacts = [];
  for (const m of market) { const k = `${m.territory}|${m.metric}|${m.ateco || ''}`; if (seen.has(k)) continue; seen.add(k); marketFacts.push(m); }
  for (const m of marketFacts.filter((x) => x.metric === 'reddito_medio' && !x.ateco)) {
    if (bench) { const d = pct(Number(m.value), Number(bench.value)); if (d != null && d <= -5) sig.push({ kind: 'ESTERNA', weight: 0.3, text: `Bacino ${m.territory}: reddito medio ${Math.round(m.value).toLocaleString('it-IT')} €, ${d}% sotto la media regionale (${m.year}): minore propensione alla spesa sanitaria privata, maggiore sensibilità al prezzo.` }); else if (d != null && d >= 8) sig.push({ kind: 'ESTERNA', weight: 0.2, text: `Bacino ${m.territory}: reddito medio ${d > 0 ? '+' : ''}${d}% sopra la media regionale (${m.year}): il potenziale privato è alto, uno scostamento negativo è più probabilmente interno (offerta, agenda, comunicazione).` }); }
  }
  for (const m of marketFacts.filter((x) => x.metric === 'quota_redditi_bassi' && !x.ateco)) if (Number(m.value) >= 0.32) sig.push({ kind: 'ESTERNA', weight: 0.2, text: `Bacino ${m.territory}: ${Math.round(m.value * 100)}% dei contribuenti sotto 15.000 €: spinge sul SSN e sui pacchetti a prezzo fisso più che sulla specialistica a listino.` });
  // ATECO: variazione imprese/addetti (se caricata) incide sulla medicina del lavoro e sul B2B
  for (const m of marketFacts.filter((x) => x.ateco && ['var_imprese_pct', 'var_addetti_pct'].includes(x.metric))) {
    if (Number(m.value) <= -3) sig.push({ kind: 'ESTERNA', weight: 0.4, text: `${m.territory}, ATECO ${m.ateco}: ${METRIC_LABEL[m.metric] || m.metric} ${m.value}% (${m.year}): contrazione del tessuto produttivo che riduce visite di medicina del lavoro e welfare aziendale.` });
    if (Number(m.value) >= 3) sig.push({ kind: 'ESTERNA', weight: 0.3, text: `${m.territory}, ATECO ${m.ateco}: ${METRIC_LABEL[m.metric] || m.metric} +${m.value}% (${m.year}): bacino B2B in crescita, opportunità di sviluppo convenzioni.` });
  }
  const atecoFacts = marketFacts.filter((x) => x.ateco && ['imprese_attive', 'addetti'].includes(x.metric));
  if (!atecoFacts.length) sig.push({ kind: 'ESTERNA', weight: 0.1, text: 'Dati ATECO del bacino non caricati: importa imprese attive e addetti per comune e sezione ATECO (Camera di Commercio / ISTAT ASIA) per valutare il mercato della medicina del lavoro.' });
  return { signals: sig.sort((a, b) => b.weight - a.weight), days: { ...days, in_progress: inProgress }, market: marketFacts.slice(0, 40) };
}

export async function narrative({ year, month, label, budget, actual, variancePct, signals, notes }) {
  if (!config.anthropicKey) return null;
  const prompt = `Sei il controller retail di Toscana Diagnostica (rete sanitaria toscana: laboratorio, imaging, specialistica, medicina del lavoro). Scrivi in italiano, tono aziendale, diretto, senza elenchi puntati, massimo 120 parole.
Scostamento ${month}/${year} per ${label}: budget ${Math.round(budget)} €, consuntivo ${Math.round(actual)} €, scostamento ${variancePct}%.
Segnali rilevati: ${signals.map((s) => `[${s.kind}] ${s.text}`).join(' ')}
Motivazioni annotate dal management: ${notes.map((n) => `[${n.kind}] ${n.note}`).join(' ') || 'nessuna'}.
Scrivi una lettura dello scostamento che distingua cause esterne (mercato, stagionalità, territorio) e interne (operatività, promozioni, esposizione, giorni lavorati) e chiuda con l'azione più utile il mese prossimo.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: config.anthropicModel, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('') || null;
}
