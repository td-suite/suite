// Amministrazione > Diagnostica anagrafica (correzione A13), operazione una tantum "Contratti SEDE del Business Hub" (A3) e operazione
// "Crea le sedi SERVICE mancanti" (A7, blocco 2).
// Lettura agli amministratori; correzioni agli amministratori (Admin e titolare) con conferma esplicita; l'eliminazione dei contratti SEDE
// ("Esegui") solo al titolare. Ogni correzione scrive l'audit DIAGNOSTICA_CORREZIONE con prima e dopo; l'esportazione CSV
// DIAGNOSTICA_EXPORT; l'esecuzione salvata una riga in diagnostica_runs.
import { Router } from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { ah, bad, audit, parse, forbidden } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { esegui, riepilogo, salvaEsito, cresciuti, correggi, controllo, csv, AREE, CONTROLLI } from '../lib/diagnostica.js';
import * as sedeBusiness from '../lib/sedeBusiness.js';

const r = Router();
r.use('/admin/diagnostica', requireAdmin);
r.use('/admin/migrazioni', requireAdmin);

r.get('/admin/diagnostica', ah(async (_req, res) => {
  const risultati = await esegui({ limite: 50 });
  const ultimo = await one('SELECT id, at, bloccanti FROM diagnostica_runs ORDER BY at DESC LIMIT 1');
  res.json({ at: new Date().toISOString(), aree: AREE, riepilogo: riepilogo(risultati), risultati, ultimo_salvato: ultimo });
}));
// Esegue e salva l'esito (come il lavoro giornaliero core:diagnostica), con l'avviso se crescono i bloccanti
r.post('/admin/diagnostica/salva', ah(async (req, res) => {
  const risultati = await esegui({ limite: 0 });
  const { run, precedente } = await salvaEsito(risultati, req.user.id);
  const cr = cresciuti(risultati, precedente);
  await audit(req, 'DIAGNOSTICA_ESEGUITA', { entity: 'diagnostica', entityId: run.id, label: `Diagnostica anagrafica: ${riepilogo(risultati).bloccanti} controlli bloccanti`, data: { riepilogo: riepilogo(risultati), cresciuti: cr } });
  res.json({ run, riepilogo: riepilogo(risultati), cresciuti: cr });
}));
r.get('/admin/diagnostica/storico', ah(async (_req, res) => {
  res.json(await many('SELECT d.id, d.at, d.bloccanti, u.full_name AS by_name FROM diagnostica_runs d LEFT JOIN users u ON u.id=d.by_user ORDER BY d.at DESC LIMIT 60'));
}));
// Rapporto completo in CSV (tutti i controlli, tutte le righe fino a 5000 per controllo)
r.get('/admin/diagnostica/export.csv', ah(async (req, res) => {
  const risultati = await esegui({ limite: 5000 });
  const righe = [];
  for (const k of risultati) {
    const base = { controllo: k.id, area: AREE[k.area], gravita: k.gravita, titolo: k.titolo, stato: k.stato, conteggio: k.n ?? '', nota: k.nota || '' };
    if (!k.righe.length) righe.push({ ...base, riga: '' });
    for (const x of k.righe) { const { __link, ...d } = x; righe.push({ ...base, riga: d, link: __link || '' }); }
  }
  await audit(req, 'DIAGNOSTICA_EXPORT', { entity: 'diagnostica', label: 'Rapporto della Diagnostica anagrafica (CSV)', data: { controlli: risultati.length, righe: righe.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Diagnostica_anagrafica_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(righe, [['controllo', 'Controllo'], ['area', 'Area'], ['gravita', 'Gravità'], ['titolo', 'Titolo'], ['stato', 'Stato'], ['conteggio', 'Righe'], ['nota', 'Nota'], ['riga', 'Dati della riga'], ['link', 'Dove si corregge']]));
}));
r.get('/admin/diagnostica/:id', ah(async (req, res) => {
  const k = controllo(req.params.id); if (!k) throw bad('Controllo inesistente');
  res.json((await esegui({ ids: [k.id], limite: 5000 }))[0]);
}));
r.get('/admin/diagnostica/:id/export.csv', ah(async (req, res) => {
  const k = controllo(req.params.id); if (!k) throw bad('Controllo inesistente');
  const x = (await esegui({ ids: [k.id], limite: 5000 }))[0];
  const cols = x.righe.length ? Object.keys(x.righe[0]).filter((c) => c !== '__link').map((c) => [c, c]) : [['nota', 'nota']];
  await audit(req, 'DIAGNOSTICA_EXPORT', { entity: 'diagnostica', entityId: k.id, label: `Diagnostica ${k.id} (CSV)`, data: { righe: x.righe.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Diagnostica_${k.id}_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(x.righe.length ? x.righe : [{ nota: x.nota || 'nessuna riga' }], cols));
}));
// Correzione: { ids, conferma: 'CORREGGI', opzioni } (opzioni: azione per D18b, sede per "Crea la sede dal nodo", includi_admin per D19)
r.post('/admin/diagnostica/:id/correggi', ah(async (req, res) => {
  const k = controllo(req.params.id); if (!k) throw bad('Controllo inesistente');
  const b = parse(z.object({ ids: z.array(z.union([z.number(), z.string()])).max(5000).optional(), conferma: z.string().optional(), opzioni: z.record(z.any()).optional() }), req.body);
  if (k.correggi?.conferma !== false && b.conferma !== 'CORREGGI') throw bad('Conferma la correzione (conferma: "CORREGGI")');
  if (b.opzioni?.includi_admin && req.user.level !== 'OWNER' && req.user.level !== 'ADMIN') throw forbidden();
  const out = await correggi(k.id, { ids: b.ids || [], opzioni: b.opzioni || {}, req });
  await audit(req, 'DIAGNOSTICA_CORREZIONE', { entity: 'diagnostica', entityId: k.id, label: `Diagnostica ${k.id}: ${k.correggi.etichetta} (${out.prima.righe.length} righe, ${out.prima.n} → ${out.dopo.n})`, data: { opzioni: b.opzioni || {}, prima: out.prima, esito: out.esito, dopo: out.dopo } });
  res.json(out);
}));
r.get('/admin/diagnostica-catalogo', ah(async (_req, res) => {
  res.json(CONTROLLI.map((k) => ({ id: k.id, area: k.area, gravita: k.gravita, titolo: k.titolo, spiegazione: k.spiegazione, correggi: Boolean(k.correggi), correggi_dopo: k.correggiDopo || null, attivo_dopo: k.attivoDopo || null })));
}));

// ---- A3: contratti SEDE del Business Hub → Sedi. "Prova" (amministratori) e "Esegui" (titolare, con conferma)
r.get('/admin/migrazioni/sede-business', ah(async (req, res) => {
  const rep = await sedeBusiness.rapporto();
  await audit(req, 'BUSINESS_SEDE_PROVA', { entity: 'migration', entityId: 'sede-business', label: `Contratti SEDE: prova (${rep.contratti.length} contratti)`, data: { contratti: rep.contratti.map((c) => ({ id: c.id, protocol: c.protocol, differenze: c.differenze, file: c.file.length, fascicoli: c.fascicoli.length })) } });
  res.json(rep);
}));
r.post('/admin/migrazioni/sede-business', ah(async (req, res) => {
  if (req.query.prova === '1' || req.body?.prova === true) return res.json(await sedeBusiness.rapporto());
  if (req.user.level !== 'OWNER') throw forbidden('L\'eliminazione dei contratti SEDE la esegue il titolare');
  if (req.body?.conferma !== 'ESEGUI') throw bad('Conferma l\'operazione (conferma: "ESEGUI")');
  const out = await sedeBusiness.esegui({ req });
  await audit(req, 'BUSINESS_SEDE_MIGRAZIONE', { entity: 'migration', entityId: 'sede-business', label: `Contratti SEDE migrati in Sedi: ${out.eseguiti.filter((x) => x.esito === 'migrato').length}`, data: { eseguiti: out.eseguiti.map(({ file, ...x }) => ({ ...x, file: (file || []).map((f) => ({ id: f.file_id, esito: f.esito })) })), verifiche: out.verifiche } });
  res.json(out);
}));

// ---- A7: "Crea le sedi SERVICE mancanti" (richiesta del CEO dell'08/11/2026). "Prova" (rapporto, nessuna scrittura) ed "Esegui"
// (amministratori, con conferma): per ogni cliente di clienti_attivi_v senza sede SERVICE una sede con l'indirizzo della Legal entity,
// e una sede per ogni struttura del gruppo attivata (accounts.sedi). Idempotente.
r.get('/admin/migrazioni/sedi-service', ah(async (_req, res) => {
  const { sediServiceMancanti } = await import('../lib/clienti.js');
  res.json(await sediServiceMancanti({ esegui: false }));
}));
r.post('/admin/migrazioni/sedi-service', ah(async (req, res) => {
  const { sediServiceMancanti } = await import('../lib/clienti.js');
  if (req.body?.conferma !== 'ESEGUI') throw bad('Conferma l\'operazione (conferma: "ESEGUI")');
  const out = await sediServiceMancanti({ esegui: true, req, actorId: req.user.id });
  await audit(req, 'SEDI_SERVICE_CREATE', { entity: 'migration', entityId: 'sedi-service', label: `Sedi SERVICE mancanti: ${out.creati} create${out.errori ? `, ${out.errori} errori` : ''}`,
    data: { piano: out.piano.map((p) => ({ org_id: p.org_id, tipo: p.tipo, nome: p.nome, esito: p.esito, site_id: p.site_id || null, motivo: p.esito === 'errore' ? p.motivo : undefined })), strutture_in_attesa: out.strutture_in_attesa.length } });
  res.json(out);
}));

export default r;
