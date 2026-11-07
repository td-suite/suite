// Intorno: cosa c'è intorno a ogni sede e a un indirizzo da valutare (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md).
// Lettura per tutti i profili del modulo; rilevazioni e valutazioni per ADMIN e RETAIL; impostazioni, prova della chiave,
// coordinate della sede e rilevazione mensile a mano solo per ADMIN. La chiave server non esce mai dal server: al browser va solo
// la chiave delle mappe (GOOGLE_MAPS_BROWSER_KEY) da /intorno/config.
import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { ah, bad, notFound, audit, parse } from '../lib/util.js';
import { requireRole, requireWrite } from '../lib/access.js';
import { toXlsx } from '../lib/exports.js';
import { runJob } from '../../../lib/jobs.js';
import {
  leggiImpostazioni, salvaImpostazioni, statoContatore, configPubblica, sedeIntorno, rilevaSede, rileva, dettaglio, storico, ultimaCompletata,
  confrontoSedi, valutazioni, geocodifica, provaChiave, chiaveIndirizzo, SOTTO, CATEGORIE, PREDEFINITI,
} from '../lib/intorno.js';

const r = Router();
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('Identificativo non valido'); return n; };

r.get('/intorno/config', ah(async (_req, res) => res.json(configPubblica(await leggiImpostazioni()))));

// ---- Impostazioni (Retail > Impostazioni > Intorno)
r.get('/intorno/impostazioni', requireRole('ADMIN'), ah(async (_req, res) => {
  const imp = await leggiImpostazioni();
  res.json({ impostazioni: imp, predefiniti: PREDEFINITI, contatore: await statoContatore(), config: configPubblica(imp) });
}));
const impSchema = z.object({
  tetto_giornaliero: z.number().int().min(0).max(100000).optional(),
  raggio_urbano: z.number().int().min(100).max(50000).optional(),
  raggio_extraurbano: z.number().int().min(100).max(50000).optional(),
  sottocategorie: z.array(z.string().max(40)).max(40).optional(),
});
r.put('/intorno/impostazioni', requireRole('ADMIN'), ah(async (req, res) => {
  const b = parse(impSchema, req.body);
  const sconosciute = (b.sottocategorie || []).filter((s) => !SOTTO[s]);
  if (sconosciute.length) throw bad(`Categoria sconosciuta: ${sconosciute.join(', ')}`);
  const imp = await salvaImpostazioni(b);
  await audit(req, 'INTORNO_IMPOSTAZIONI', 'intorno', null, b);
  res.json({ impostazioni: imp, contatore: await statoContatore() });
}));

// Prova la chiave: una chiamata a Google (conteggiata nel tetto) con la risposta grezza e la chiave mascherata
r.post('/intorno/prova', requireRole('ADMIN'), ah(async (req, res) => {
  const b = parse(z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), site_id: z.number().int().optional() }), req.body || {});
  let { lat, lng } = b;
  if (lat == null || lng == null) {
    const s = await one(`SELECT lat, lng FROM public.sites WHERE ${b.site_id ? 'id=$1' : 'active AND lat IS NOT NULL AND lng IS NOT NULL'} ORDER BY id LIMIT 1`, b.site_id ? [b.site_id] : []);
    if (!s || s.lat == null) throw bad('Nessuna sede con coordinate per la prova: indica lat e lng');
    ({ lat, lng } = s);
  }
  const out = await provaChiave({ lat: Number(lat), lng: Number(lng) });
  await audit(req, 'INTORNO_PROVA', 'intorno', null, { ok: out.ok, status: out.status, luoghi: out.luoghi, prova: out.prova });
  res.json(out);
}));

// Rilevazione mensile a mano (stesso lavoro dello scheduler, "Esegui ora")
r.post('/intorno/job', requireRole('ADMIN'), ah(async (req, res) => {
  const out = await runJob('retail:intorno').catch((e) => ({ error: e.message }));
  await audit(req, 'INTORNO_JOB', 'intorno', null, out);
  res.json(out);
}));

// ---- Sede
r.get('/sedi/:id/intorno', ah(async (req, res) => {
  const s = await sedeIntorno(id(req.params.id));
  if (!s) throw notFound('Sede non trovata');
  const ultima = await ultimaCompletata(`sede:${s.id}`);
  res.json({ sede: s, ultima: ultima ? await dettaglio(ultima.id) : null, storico: await storico(`sede:${s.id}`), config: configPubblica(await leggiImpostazioni()) });
}));
r.post('/sedi/:id/intorno/rileva', requireWrite, ah(async (req, res) => {
  const out = await rilevaSede(id(req.params.id), { origine: 'MANUALE', userId: req.user.id });
  await audit(req, 'INTORNO_RILEVA', 'site', out.site_id, { rilevazione_id: out.id, stato: out.stato, n_chiamate: out.n_chiamate, luoghi: out.luoghi.filter((l) => l.presente).length, confronto: out.confronto, prova: out.prova });
  res.status(201).json(out);
}));
// Geocodifica della sede senza coordinate: propone l'indirizzo trovato; si salva solo con la conferma (PUT coordinate)
r.post('/sedi/:id/intorno/geocodifica', requireRole('ADMIN'), ah(async (req, res) => {
  const s = await sedeIntorno(id(req.params.id));
  if (!s) throw notFound('Sede non trovata');
  const testo = [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.province, 'Italia'].filter(Boolean).join(', ');
  if (!s.address && !s.city) throw bad('La sede non ha indirizzo né città in Amministrazione > Sedi');
  const g = await geocodifica(testo);
  if (!g) throw bad(`Indirizzo non trovato da Google: ${testo}`);
  res.json({ cercato: testo, ...g });
}));
r.put('/sedi/:id/intorno/coordinate', requireRole('ADMIN'), ah(async (req, res) => {
  const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().max(400).nullable().optional() }), req.body);
  const s = await one('UPDATE public.sites SET lat=$2, lng=$3, updated_at=now() WHERE id=$1 RETURNING id, name, code, lat, lng', [id(req.params.id), b.lat, b.lng]);
  if (!s) throw notFound('Sede non trovata');
  await audit(req, 'INTORNO_COORDINATE_SEDE', 'site', s.id, { label: `${s.name} (${s.code})`, lat: b.lat, lng: b.lng, indirizzo_trovato: b.label || null });
  res.json(s);
}));

// ---- Rilevazioni
r.get('/intorno/rilevazioni/:id', ah(async (req, res) => {
  const d = await dettaglio(id(req.params.id));
  if (!d) throw notFound('Rilevazione non trovata');
  res.json({ ...d, storico: await storico(d.chiave), config: configPubblica(await leggiImpostazioni()) });
}));
const NOVITA = { NUOVO: 'nuovo', SCOMPARSO: 'scomparso', CAMBIATO: 'cambiato' };
const STATO = { OPERATIONAL: 'aperto', CLOSED_TEMPORARILY: 'chiuso temporaneamente', CLOSED_PERMANENTLY: 'chiuso definitivamente' };
r.get('/intorno/rilevazioni/:id/export.xlsx', ah(async (req, res) => {
  const d = await dettaglio(id(req.params.id));
  if (!d) throw notFound('Rilevazione non trovata');
  const righe = d.luoghi.map((l) => ({ ...l, categoria: CATEGORIE[l.categoria]?.etichetta || l.categoria, sottocategoria: SOTTO[l.sottocategoria]?.etichetta || l.sottocategoria,
    novita: NOVITA[l.novita] || '', stato_attivita: STATO[l.stato_attivita] || l.stato_attivita || '', orari: (l.orari?.weekdayDescriptions || []).join(' · '), tipi: (l.tipi || []).join(', '),
    cambiamenti: (l.cambiamenti || []).map((c) => `${c.etichetta}: ${c.prima ?? '–'} → ${c.dopo ?? '–'}`).join('; ') }));
  const pun = d.punteggio || { componenti: [] };
  const buf = await toXlsx([
    { name: 'Luoghi', columns: [{ header: 'Categoria', key: 'categoria', width: 20 }, { header: 'Sottocategoria', key: 'sottocategoria', width: 26 }, { header: 'Nome', key: 'nome', width: 40 },
      { header: 'Indirizzo', key: 'indirizzo', width: 46 }, { header: 'Distanza (m)', key: 'distanza_m', int: true }, { header: 'Rating', key: 'rating' }, { header: 'Recensioni', key: 'n_recensioni', int: true },
      { header: 'Orari', key: 'orari', width: 60 }, { header: 'Sito', key: 'sito', width: 34 }, { header: 'Telefono', key: 'telefono', width: 18 }, { header: 'Stato attività', key: 'stato_attivita', width: 20 },
      { header: 'Novità', key: 'novita' }, { header: 'Cambiamenti', key: 'cambiamenti', width: 40 }, { header: 'Prima volta visto', key: 'prima_vista', date: true }, { header: 'Ultima volta visto', key: 'ultima_vista', date: true },
      { header: 'Chiuso o scomparso dal', key: 'chiuso_at', date: true }, { header: 'Tipi Google', key: 'tipi', width: 40 }, { header: 'Place ID', key: 'place_id', width: 30 }], rows: righe },
    { name: 'Attrattività', columns: [{ header: 'Componente', key: 'etichetta', width: 34 }, { header: 'Luoghi', key: 'n', int: true }, { header: 'Peso', key: 'peso' }, { header: 'Punti', key: 'punti' }],
      rows: [...pun.componenti, { etichetta: 'Totale', punti: pun.totale }, { etichetta: pun.formula || '' }] },
  ]);
  const nome = (d.site_code || d.etichetta || 'indirizzo').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="intorno_${nome}_${d.data}.xlsx"`);
  res.send(buf);
}));

r.get('/intorno/confronto', ah(async (_req, res) => res.json({ sedi: await confrontoSedi(), valutazioni: await valutazioni(), config: configPubblica(await leggiImpostazioni()) })));
r.get('/intorno/valutazioni', ah(async (_req, res) => res.json(await valutazioni())));

// ---- Valuta un indirizzo: geocodifica (passo 1, da confermare) e rilevazione (passo 2) salvata come "indirizzo valutato"
r.post('/intorno/geocodifica', requireWrite, ah(async (req, res) => {
  const b = parse(z.object({ indirizzo: z.string().trim().min(4).max(300) }), req.body);
  const g = await geocodifica(b.indirizzo);
  if (!g) throw bad('Indirizzo non trovato: controlla via, civico e comune');
  res.json({ cercato: b.indirizzo, ...g });
}));
const valutaSchema = z.object({
  indirizzo: z.string().trim().max(300).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  raggio: z.number().int().min(100).max(50000).optional(),
  geocodifica: z.object({ label: z.string().max(400).nullable().optional(), precision: z.string().max(20).nullable().optional(), place_id: z.string().max(300).nullable().optional() }).partial().nullable().optional(),
});
r.post('/intorno/valuta', requireWrite, ah(async (req, res) => {
  const b = parse(valutaSchema, req.body);
  let { lat, lng } = b; let geo = b.geocodifica || null; let indirizzo = b.indirizzo || null;
  if (lat == null || lng == null) {
    if (!indirizzo) throw bad('Indica un indirizzo oppure le coordinate (lat, lng)');
    const g = await geocodifica(indirizzo);
    if (!g) throw bad('Indirizzo non trovato: controlla via, civico e comune');
    ({ lat, lng } = g); geo = { label: g.label, precision: g.precision, place_id: g.place_id };
  }
  const etichetta = geo?.label || indirizzo || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const raggio = b.raggio || (await leggiImpostazioni()).raggio_urbano;
  const out = await rileva({ chiave: chiaveIndirizzo({ indirizzo: geo?.label || indirizzo, lat, lng }), etichetta, indirizzo: indirizzo || geo?.label || null, lat, lng, raggio,
    origine: 'VALUTAZIONE', userId: req.user.id, geocodifica: geo });
  await audit(req, 'INTORNO_VALUTA', 'intorno', out.id, { etichetta, raggio, luoghi: out.luoghi.filter((l) => l.presente).length, n_chiamate: out.n_chiamate, prova: out.prova });
  res.status(201).json(out);
}));
// Nuova rilevazione di un indirizzo già valutato (stesso punto, storico)
r.post('/intorno/rilevazioni/:id/rileva', requireWrite, ah(async (req, res) => {
  const d = await one('SELECT * FROM intorno_rilevazioni WHERE id=$1', [id(req.params.id)]);
  if (!d) throw notFound('Rilevazione non trovata');
  const out = d.site_id ? await rilevaSede(d.site_id, { userId: req.user.id })
    : await rileva({ chiave: d.chiave, etichetta: d.etichetta, indirizzo: d.indirizzo, lat: d.lat, lng: d.lng, raggio: d.raggio_m, origine: 'VALUTAZIONE', userId: req.user.id, geocodifica: d.geocodifica });
  await audit(req, 'INTORNO_RILEVA', d.site_id ? 'site' : 'intorno', d.site_id || out.id, { rilevazione_id: out.id, confronto: out.confronto, prova: out.prova });
  res.status(201).json(out);
}));
// Elimina un indirizzo valutato con tutto il suo storico (solo ADMIN; le rilevazioni delle sedi restano)
r.delete('/intorno/valutazioni/:id', requireRole('ADMIN'), ah(async (req, res) => {
  const d = await one('SELECT chiave, etichetta, site_id FROM intorno_rilevazioni WHERE id=$1', [id(req.params.id)]);
  if (!d) throw notFound('Rilevazione non trovata');
  if (d.site_id) throw bad('Le rilevazioni delle sedi non si eliminano');
  const del = await q('DELETE FROM intorno_rilevazioni WHERE chiave=$1 AND site_id IS NULL', [d.chiave]);
  await audit(req, 'INTORNO_VALUTAZIONE_ELIMINATA', 'intorno', req.params.id, { etichetta: d.etichetta, rilevazioni: del.rowCount });
  res.json({ ok: true, eliminate: del.rowCount });
}));

export default r;
