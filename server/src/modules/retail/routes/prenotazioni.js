// Retail · B2C · "Prenotazioni online e prima disponibilità" (TuoTempo), riordino di Retail del 09/11/2026. Fino a oggi questi dati stavano
// solo nella scheda sede e nel Cockpit. Fonte: copia locale delle Key Entities di TuoTempo (Fase 1, docs/RETAIL_TUOTEMPO.md):
// retail.tuotempo_attivita (storico giornaliero della prima disponibilità per prestazione), tuotempo_aree ↔ sedi, tuotempo_risorse
// (medici attivi, soddisfazione). Le PRENOTAZIONI vere non ci sono: Docplanner non ha ancora aperto le API (Fase 2), la pagina lo dice.
// Ipotesi dichiarata (come in RETAIL_TUOTEMPO.md): la prima disponibilità è quella della prestazione su tutta la rete, attribuita alla
// sede del primo slot libero. Visibilità: tutti i profili del modulo (nessun dato personale).
import { Router } from 'express';
import { one, many } from '../db.js';
import { ah } from '../lib/util.js';
import { getConnector } from '../../../lib/connectors.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  const giorni = Math.min(365, Math.max(7, Number(req.query.giorni) || 30));
  const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const core = await getConnector('TUOTEMPO').catch(() => null);
  const conn = await one(`SELECT enabled, last_sync_at, last_status, last_message FROM connectors WHERE kind = 'TUOTEMPO'`).catch(() => null);
  const ultimo = await one('SELECT max(data) AS d, min(data) AS primo, count(DISTINCT data)::int AS giorni FROM tuotempo_attivita');
  const d = ultimo?.d || null;
  const settimanaPrima = d ? await one(`SELECT max(data) AS d FROM tuotempo_attivita WHERE data <= ($1::date - 7)`, [d]) : null;
  const fs = siteId ? 'AND t.site_id = $2' : '';
  const pf = (x) => (siteId ? [x, siteId] : [x]);
  // per sede (ultimo giorno), con la mediana della settimana prima
  const perSede = d ? await many(`SELECT t.site_id, coalesce(s.name, 'Area senza sede abbinata') AS sede, s.code, max(a.titolo) AS area, count(*)::int AS prestazioni,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY t.giorni_attesa) AS mediana, min(t.giorni_attesa) AS minimo, max(t.giorni_attesa) AS massimo
    FROM tuotempo_attivita t LEFT JOIN public.sites s ON s.id = t.site_id LEFT JOIN tuotempo_aree a ON a.areaid = t.areaid
   WHERE t.data = $1 ${fs} GROUP BY t.site_id, s.name, s.code ORDER BY mediana NULLS LAST`, pf(d)) : [];
  const perSedePrima = settimanaPrima?.d ? await many(`SELECT t.site_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY t.giorni_attesa) AS mediana FROM tuotempo_attivita t WHERE t.data = $1 ${fs} GROUP BY t.site_id`, pf(settimanaPrima.d)) : [];
  // per tipologia (ultimo giorno): nome della tipologia dal catalogo prestazioni (tt_typology)
  const perTipologia = d ? await many(`SELECT coalesce(t.typologyid, '') AS typologyid, coalesce((SELECT max(p.tt_typology) FROM products p WHERE p.tt_typology_id = t.typologyid), 'Tipologia non indicata') AS tipologia,
      count(*)::int AS prestazioni, percentile_cont(0.5) WITHIN GROUP (ORDER BY t.giorni_attesa) AS mediana, min(t.giorni_attesa) AS minimo, max(t.giorni_attesa) AS massimo
    FROM tuotempo_attivita t WHERE t.data = $1 ${fs} GROUP BY t.typologyid ORDER BY prestazioni DESC`, pf(d)) : [];
  // storico giornaliero: mediana della rete (o della sede) negli ultimi N giorni
  const storico = d ? await many(`SELECT t.data, count(*)::int AS prestazioni, percentile_cont(0.5) WITHIN GROUP (ORDER BY t.giorni_attesa) AS mediana
    FROM tuotempo_attivita t WHERE t.data > ($1::date - ${giorni}) ${fs} GROUP BY t.data ORDER BY t.data`, pf(d)) : [];
  // risorse attive e soddisfazione per area (sede abbinata)
  const risorse = await many(`SELECT a.areaid, a.titolo AS area, s.id AS site_id, s.name AS sede,
      count(x.resourceid) FILTER (WHERE x.status = 'a' AND NOT x.is_hidden)::int AS attive, count(x.resourceid)::int AS tutte,
      round(avg(x.satisfaction) FILTER (WHERE x.status = 'a' AND x.satisfaction IS NOT NULL), 2) AS soddisfazione,
      count(x.resourceid) FILTER (WHERE x.status = 'a' AND x.satisfaction IS NOT NULL)::int AS con_soddisfazione
    FROM tuotempo_aree a LEFT JOIN public.sites s ON s.legacy_refs->>'tuotempo' = a.areaid
    LEFT JOIN tuotempo_risorse x ON x.presente AND NOT x.is_machine AND x.areas ? a.areaid
   WHERE a.presente AND NOT coalesce(a.ignorata, FALSE) ${siteId ? 'AND s.id = $1' : ''} GROUP BY a.areaid, a.titolo, s.id, s.name ORDER BY s.name NULLS LAST, a.titolo`, siteId ? [siteId] : []);
  const aree = await one(`SELECT count(*) FILTER (WHERE presente AND NOT coalesce(ignorata, FALSE))::int AS aree,
      count(*) FILTER (WHERE presente AND NOT coalesce(ignorata, FALSE) AND EXISTS (SELECT 1 FROM public.sites s WHERE s.legacy_refs->>'tuotempo' = tuotempo_aree.areaid))::int AS abbinate FROM tuotempo_aree`);
  const online = await one(`SELECT count(*) FILTER (WHERE tt_activity_id IS NOT NULL AND NOT coalesce(tt_hidden, FALSE))::int AS online, count(*) FILTER (WHERE tt_activity_id IS NOT NULL)::int AS tutte FROM products`);
  const rete = d ? await one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS mediana, count(*)::int AS prestazioni FROM tuotempo_attivita t WHERE t.data = $1 ${fs}`, pf(d)) : null;
  const retePrima = settimanaPrima?.d ? await one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY giorni_attesa) AS mediana FROM tuotempo_attivita t WHERE t.data = $1 ${fs}`, pf(settimanaPrima.d)) : null;
  const r1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
  const prima = new Map(perSedePrima.map((x) => [x.site_id ?? 'ND', x.mediana]));
  res.json({
    fonte: 'TuoTempo (Key Entities, copia locale)',
    connettore: { attivo: Boolean(core?.active), ultimo_allineamento: conn?.last_sync_at || null, esito: conn?.last_status || null, messaggio: conn?.last_message || null },
    prenotazioni: { disponibile: false, nota: 'Le prenotazioni online non sono ancora disponibili: Docplanner non ha aperto le API delle prenotazioni (Fase 2 del piano TuoTempo). Qui ci sono la prima disponibilità, le prestazioni prenotabili, i medici attivi e la soddisfazione.' },
    ultimo_giorno: d, giorni_storico: ultimo?.giorni || 0, primo_giorno: ultimo?.primo || null, settimana_prima: settimanaPrima?.d || null,
    rete: { mediana: r1(rete?.mediana), prestazioni: rete?.prestazioni || 0, mediana_settimana_prima: r1(retePrima?.mediana), aree: aree.aree, aree_abbinate: aree.abbinate, prestazioni_online: online.online, prestazioni_tuotempo: online.tutte },
    per_sede: perSede.map((x) => ({ ...x, mediana: r1(x.mediana), minimo: r1(x.minimo), massimo: r1(x.massimo), mediana_settimana_prima: r1(prima.get(x.site_id ?? 'ND')) })),
    per_tipologia: perTipologia.map((x) => ({ ...x, mediana: r1(x.mediana), minimo: r1(x.minimo), massimo: r1(x.massimo) })),
    storico: storico.map((x) => ({ data: x.data, prestazioni: x.prestazioni, mediana: r1(x.mediana) })),
    risorse: risorse.map((x) => ({ ...x, soddisfazione: x.soddisfazione != null ? Number(x.soddisfazione) : null })),
    ipotesi: 'La prima disponibilità è quella della prestazione su tutta la rete, attribuita alla sede del primo slot libero (le Key Entities non danno le agende per sede: arriveranno con Availabilities, Fase 2).',
  });
}));

export default r;
