// Retail · Profilo dei pazienti (laboratorio): profilazione dai dati del gestionale Synclab (copia locale in sola lettura, schema synclab
// del core), PROIEZIONE STANDARD: età, sesso e provenienza delle accettazioni, mai nome, cognome o codice fiscale (decisione del CEO del
// 09/11/2026: includePatient resta spenta). Le letture sono in lib/synclab/letture.js; qui solo l'esposizione al modulo, la mappa (comuni
// già geocodificati in cache, lib/geocode.js) e l'export Excel con i fogli dei blocchi 2-5. Documentazione: docs/RETAIL_PROFILO_PAZIENTI.md.
// Visibilità: tutti i profili del modulo, come "Clienti e profilazione" (dati aggregati, nessuna identità).
import { Router } from 'express';
import { ah, audit, bad } from '../lib/util.js';
import { requireWrite } from '../lib/access.js';
import { toXlsx } from '../lib/exports.js';
import { profiloPazienti, comuniProfilo, FASCE_ETA } from '../../../lib/synclab/letture.js';
import { comuniInCache, geocodificaComuni, normComune, normProvincia } from '../../../lib/geocode.js';
import { many } from '../../../db.js';

const r = Router();
const SESSO = { F: 'Donne', M: 'Uomini', ALTRO: 'Altro codice', ND: 'Non indicato' };

/** Dati della mappa a bolle: comuni con coordinate in cache, sedi con coordinate in anagrafica. */
async function mappa(p, query) {
  const tutti = await comuniProfilo(query);
  const cache = await comuniInCache(tutti);
  const comuni = [];
  let senza = 0, senzaN = 0;
  for (const c of tutti) {
    const g = cache.get(`${normComune(c.comune)}|${normProvincia(c.provincia)}`);
    if (g && g.esito === 'OK' && g.lat != null) comuni.push({ comune: c.comune, provincia: c.provincia, n: c.n, lat: Number(g.lat), lng: Number(g.lng), precision: g.precision, source: g.source });
    else { senza++; senzaN += c.n; }
  }
  const ids = p.provenienza.bacino.map((b) => b.site_id).filter(Boolean);
  const sedi = ids.length ? await many(`SELECT id, name, code, lat, lng FROM public.sites WHERE id = ANY($1::int[]) AND lat IS NOT NULL AND lng IS NOT NULL`, [ids]) : [];
  return { comuni, comuni_senza_coordinate: senza, accettazioni_senza_coordinate: senzaN, sedi: sedi.map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) })) };
}

r.get('/', ah(async (req, res) => {
  const p = await profiloPazienti(req.query);
  res.json({ ...p, mappa: p.sintesi.accettazioni ? await mappa(p, req.query) : null });
}));

// Geocodifica a richiesta dei comuni di provenienza senza coordinate (lotti da 15: OpenStreetMap concede 1 richiesta al secondo)
r.post('/geocodifica-comuni', requireWrite, ah(async (req, res) => {
  const lista = await comuniProfilo({ ...req.query, ...req.body });
  if (!lista.length) throw bad('Nessun comune di provenienza nel periodo scelto');
  const out = await geocodificaComuni(lista.slice(0, 200), { max: 15 });
  await audit(req, 'PROFILO_PAZIENTI_GEOCODIFICA', 'geo_comuni', null, out);
  res.json(out);
}));

r.get('/export.xlsx', ah(async (req, res) => {
  const p = await profiloPazienti(req.query);
  const n = (k, header, width) => ({ key: k, header, int: true, width });
  const pc = (k, header) => ({ key: k, header, width: 12 });
  const fascia = { key: 'etichetta', header: 'Fascia d\'età', width: 22 };
  const sheets = [
    { name: 'Fasce età e sesso', columns: [fascia, n('F', 'Donne'), n('M', 'Uomini'), n('ALTRO', 'Altro codice'), n('ND', 'Sesso non indicato'), n('totale', 'Totale'), pc('quota', 'Quota %'), n('ap_F', 'Donne anno prima'), n('ap_M', 'Uomini anno prima'), n('ap_totale', 'Totale anno prima'), n('delta', 'Differenza'), pc('delta_pct', 'Variazione %')],
      rows: p.fasce.map((x) => ({ ...x, ap_F: x.anno_prima.F, ap_M: x.anno_prima.M, ap_totale: x.anno_prima.totale })) },
    { name: 'Provenienza province', columns: [{ key: 'etichetta', header: 'Provincia', width: 26 }, n('n', 'Accettazioni'), pc('quota', 'Quota %'), n('fuori_area', 'Di cui fuori area')], rows: p.provenienza.province },
    { name: 'Provenienza comuni', columns: [{ key: 'comune', header: 'Comune', width: 30 }, { key: 'provincia', header: 'Provincia', width: 10 }, n('n', 'Accettazioni'), pc('quota', 'Quota %')],
      rows: [...p.provenienza.comuni.top, ...(p.provenienza.comuni.altri ? [{ comune: `Altri ${p.provenienza.comuni.altri.comuni} comuni`, provincia: null, n: p.provenienza.comuni.altri.n, quota: p.provenienza.comuni.altri.quota }] : []),
        ...(p.provenienza.comuni.non_disponibile ? [{ comune: 'Comune non disponibile', provincia: null, n: p.provenienza.comuni.non_disponibile, quota: null }] : [])] },
    { name: 'Bacino per sede', columns: [{ key: 'sede', header: 'Sede / punto prelievi', width: 32 }, { key: 'sede_comune', header: 'Comune della sede', width: 18 }, n('n', 'Accettazioni'), n('stesso_comune', 'Stesso comune'), n('stessa_provincia', 'Altro comune, stessa provincia'), n('fuori_area', 'Fuori area'), n('non_valutabili', 'Non valutabili'), pc('quota_fuori_area', 'Quota fuori area %'), pc('eta_mediana', 'Età mediana'), { key: 'comuni_txt', header: 'Comuni principali', width: 60 }],
      rows: p.provenienza.bacino.map((b) => ({ ...b, comuni_txt: b.comuni.map((c) => `${c.comune}${c.provincia ? ` (${c.provincia})` : ''} ${c.n}`).join(', ') })) },
  ];
  if (p.provenienza.cap) sheets.push({ name: 'CAP della sede', columns: [{ key: 'cap', header: 'CAP', width: 10 }, { key: 'comuni', header: 'Comuni', width: 40 }, n('n', 'Accettazioni'), pc('quota', 'Quota %')], rows: p.provenienza.cap.map((c) => ({ ...c, cap: c.cap || 'CAP non disponibile' })) });
  const sedi = p.andamento.per_sede.serie;
  sheets.push({ name: 'Andamento per sede', columns: [{ key: 'mese', header: 'Mese', width: 10 }, ...sedi.map((s) => n(s.key, s.label, Math.max(14, Math.min(36, s.label.length + 2))))], rows: p.andamento.per_sede.righe });
  const tipi = p.andamento.per_tipo.serie;
  sheets.push({ name: 'Andamento per tipo', columns: [{ key: 'mese', header: 'Mese', width: 10 }, ...tipi.map((s) => n(s.key, s.label, Math.max(14, s.label.length + 2))), n('mdl', 'Medicina del lavoro (a parte)', 22)],
    rows: p.andamento.per_tipo.righe.map((x, i) => ({ ...x, mdl: p.andamento.medicina_lavoro[i]?.n || 0 })) });
  const esami = [];
  const push = (ambito, lista) => { (lista || []).forEach((e, i) => esami.push({ ambito, pos: i + 1, ...e })); };
  push('Tutte le accettazioni', p.esami.top);
  for (const f of [...FASCE_ETA.map((x) => x.key), 'ND']) push(`Fascia ${f === 'ND' ? 'età non disponibile' : f}`, p.esami.per_fascia[f]);
  for (const s of ['F', 'M', 'ALTRO', 'ND']) push(SESSO[s], p.esami.per_sesso[s]);
  for (const [k, lista] of Object.entries(p.esami.per_fascia_sesso)) { const [f, s] = k.split('|'); push(`Fascia ${f === 'ND' ? 'età n.d.' : f} · ${SESSO[s]}`, lista); }
  sheets.push({ name: 'Esami top 15', columns: [{ key: 'ambito', header: 'Ambito', width: 30 }, n('pos', 'Pos.', 6), { key: 'codice', header: 'Codice', width: 12 }, { key: 'descrizione', header: 'Descrizione', width: 40 }, n('esami', 'Esami'), n('accettazioni', 'Accettazioni')], rows: esami });
  const perSede = [];
  for (const s of p.esami.per_sede) s.esami.forEach((e, i) => perSede.push({ sede: s.sede, pos: i + 1, ...e }));
  sheets.push({ name: 'Esami per sede', columns: [{ key: 'sede', header: 'Sede / punto prelievi', width: 32 }, n('pos', 'Pos.', 6), { key: 'codice', header: 'Codice', width: 12 }, { key: 'descrizione', header: 'Descrizione', width: 40 }, n('esami', 'Esami'), n('accettazioni', 'Accettazioni')], rows: perSede });
  sheets.push({ name: 'Note', columns: [{ key: 'k', header: 'Voce', width: 28 }, { key: 'v', header: 'Valore', width: 100 }], rows: [
    { k: 'Fonte', v: 'Synclab Data API (gestionale del laboratorio), proiezione standard: nessun dato identificativo dei pazienti' },
    { k: 'Unità', v: 'Accettazioni, non persone: senza identità i pazienti distinti non sono calcolabili' },
    { k: 'Periodo', v: `${p.periodo.etichetta} (${p.periodo.da} - ${p.periodo.a}); anno prima ${p.periodo.prec.da} - ${p.periodo.prec.a}` },
    { k: 'Accettazioni', v: String(p.sintesi.accettazioni) },
    { k: 'Fuori area', v: p.provenienza.fuori_area.regola },
    { k: 'Perimetro', v: 'Dati del laboratorio (Synclab). I centri medici (GIPO/TuoTempo) non sono compresi finché Docplanner non apre le API dei pazienti' },
    { k: 'Ultimo checkpoint accettazioni', v: p.stato.checkpoint_at ? new Date(p.stato.checkpoint_at).toISOString() : 'nessuno' },
  ] });
  const buf = await toXlsx(sheets);
  await audit(req, 'PROFILO_PAZIENTI_EXPORT', 'synclab', null, { periodo: p.periodo.etichetta, filtri: p.filtri, accettazioni: p.sintesi.accettazioni });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="profilo-pazienti-laboratorio_${p.periodo.da}_${p.periodo.a}.xlsx"`);
  res.send(buf);
}));

export default r;
