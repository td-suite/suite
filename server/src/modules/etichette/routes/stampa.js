// Label · ricerca, anteprima e registrazione delle stampe (OPERATORE e ADMIN). La stampa vera avviene nel browser (Zebra Browser Print
// sul PC della sede, o PDF di ripiego): il server prepara lo ZPL dal modello e registra l'esito, senza dati del paziente.
import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, bad, forbidden, notFound, parse } from '../../../lib/util.js';
import { one } from '../db.js';
import { KEY, contesto, settings, modelloPerSede } from '../lib/core.js';
import { caricaAccettazione, clienteESede, costruisciEtichette } from '../lib/accettazioni.js';
import { identitaPerApertura } from '../lib/identita.js';
import { tipoRicerca, cercaCodice, cercaCognome } from '../lib/ricerca.js';

const r = Router();

// Ricerca: q = numero di accettazione, barcode del campione o cognome (+ data facoltativa per il cognome)
r.get('/cerca', ah(async (req, res) => {
  const ctx = contesto(req);
  const testo = String(req.query.q || '').trim().slice(0, 80);
  const tipo = tipoRicerca(testo);
  if (!tipo) return res.json({ tipo: null, risultati: [], fuori: 0, messaggio: 'Scrivi o leggi con il lettore il numero di accettazione o il barcode, oppure almeno 2 lettere del cognome' });
  if (!ctx.isAdmin && !ctx.siteIds.length) return res.json({ tipo, risultati: [], fuori: 0, messaggio: 'Il tuo profilo Label non ha sedi nel perimetro: chiedi all\'amministratore di assegnare la sede' });
  const out = tipo === 'CODICE' ? await cercaCodice(testo, ctx) : await cercaCognome(testo, ctx, { data: req.query.data || null });
  if (!out.risultati.length && out.fuori && !out.messaggio) out.messaggio = `Accettazione trovata ma fuori dal tuo perimetro di sedi (${out.fuori})`;
  res.json(out);
}));

const chiaveOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200;

/** Accettazione con etichette pronte (anteprima): perimetro, identità (lettura puntuale se manca), modello della sede. */
async function preparaAccettazione(req, instanceId, id) {
  const ctx = contesto(req);
  if (!chiaveOk(instanceId) || !chiaveOk(id)) throw bad('Accettazione non valida');
  const acc = await caricaAccettazione(instanceId, id);
  if (!acc) throw notFound('Accettazione non trovata nella copia Synclab né tra le letture dal gestionale');
  const cs = await clienteESede(instanceId, acc.testata.client_id);
  if (!ctx.vede(cs.site_id)) throw forbidden('Accettazione fuori dal tuo perimetro di sedi');
  const imp = await settings();
  const id2 = await identitaPerApertura(instanceId, id, { numero: acc.testata.numero });
  const modello = await modelloPerSede(cs.site_id);
  const etichette = costruisciEtichette(acc, id2.identita, { richiesta: imp.etichetta_richiesta, cliente: cs.cliente, sede: cs.sede, modello });
  return { ctx, acc, cs, id2, modello, etichette };
}

r.get('/accettazioni/:inst/:id', ah(async (req, res) => {
  const { acc, cs, id2, modello, etichette } = await preparaAccettazione(req, req.params.inst, req.params.id);
  const stampe = await one(`SELECT count(*) FILTER (WHERE esito = 'OK')::int AS ok, max(at) FILTER (WHERE esito = 'OK') AS ultima FROM stampe WHERE instance_id = $1 AND request_id = $2`, [acc.testata.instance_id, acc.testata.id]);
  const p = id2.identita;
  res.json({
    fonte: acc.fonte, accettazione: { ...acc.testata, cliente: cs.cliente, site_id: cs.site_id, sede: cs.sede },
    paziente: p && (p.cognome || p.nome) ? { cognome: p.cognome, nome: p.nome, nascita: p.nascita, sesso: p.sesso } : null,
    paziente_esito: id2.esito, paziente_messaggio: id2.messaggio || null,
    modello: modello ? { id: modello.id, nome: modello.nome, larghezza_mm: Number(modello.larghezza_mm), altezza_mm: Number(modello.altezza_mm), dpi: modello.dpi, validato: Boolean(modello.validato_il) } : null,
    etichette: etichette.map((e) => ({ chiave: e.chiave, n: e.n, tipo: e.tipo, barcode: e.barcode, materiale: e.materiale, contenitore: e.contenitore, esami: e.esami, avvisi: e.avvisi, zpl: e.zpl })),
    stampe: { ok: stampe?.ok || 0, ultima: stampe?.ultima || null },
  });
}));

// Registro di una stampa (o del tentativo): nessun dato del paziente. ristampa = c'era già una stampa riuscita (o richiesta esplicita).
const Stampa = z.object({
  instance_id: z.string().min(1).max(200).optional(), request_id: z.string().min(1).max(200).optional(),
  etichette: z.number().int().min(0).max(200), copie: z.number().int().min(1).max(20).default(1),
  stampante: z.string().max(200).nullable().optional(), metodo: z.enum(['ZEBRA', 'PDF', 'PROVA']).default('ZEBRA'),
  esito: z.enum(['OK', 'ERRORE']), errore: z.string().max(500).nullable().optional(), ristampa: z.boolean().optional(),
  modello_id: z.number().int().positive().nullable().optional(),
});
r.post('/stampe', ah(async (req, res) => {
  const b = parse(Stampa, req.body);
  const ctx = contesto(req);
  let site = null, numero = null, ristampa = Boolean(b.ristampa);
  if (b.metodo === 'PROVA') {
    if (!ctx.isAdmin) throw forbidden('La stampa di prova è riservata agli amministratori di Label');
  } else {
    if (!b.instance_id || !b.request_id) throw bad('Accettazione mancante');
    const acc = await caricaAccettazione(b.instance_id, b.request_id);
    if (!acc) throw notFound('Accettazione non trovata');
    const cs = await clienteESede(b.instance_id, acc.testata.client_id);
    if (!ctx.vede(cs.site_id)) throw forbidden('Accettazione fuori dal tuo perimetro di sedi');
    site = cs.site_id; numero = acc.testata.numero;
    const prima = await one(`SELECT 1 AS si FROM stampe WHERE instance_id = $1 AND request_id = $2 AND esito = 'OK' LIMIT 1`, [b.instance_id, b.request_id]);
    if (prima) ristampa = true;
  }
  const row = await one(`INSERT INTO stampe (user_id, site_id, instance_id, request_id, request_number, n_etichette, copie, stampante, metodo, esito, errore, ristampa, modello_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, at, ristampa`,
  [ctx.userId, site, b.metodo === 'PROVA' ? null : b.instance_id, b.metodo === 'PROVA' ? null : b.request_id, numero, b.etichette, b.copie, b.stampante || null, b.metodo, b.esito,
    b.esito === 'ERRORE' ? String(b.errore || 'errore non indicato').slice(0, 500) : null, ristampa, b.modello_id || null]);
  if (b.esito === 'OK') {
    const sede = site ? await one('SELECT code, name FROM public.sites WHERE id = $1', [site]) : null;
    const dove = b.metodo === 'PDF' ? 'PDF' : `stampante ${b.stampante || 'non indicata'}`;
    const label = b.metodo === 'PROVA' ? `Stampa di prova del modello di etichetta (${dove})`
      : `Etichette ${ristampa ? 'ristampate' : 'stampate'} per l'accettazione ${numero}: ${b.etichette} provett${b.etichette === 1 ? 'a' : 'e'}${b.copie > 1 ? ` × ${b.copie} copie` : ''}, sede ${sede ? [sede.code, sede.name].filter(Boolean).join(' ') : 'non abbinata'}, ${dove}`;
    await audit(req, b.metodo === 'PROVA' ? 'ETICHETTE_PROVA' : 'ETICHETTE_STAMPA', { module: KEY, entity: 'accettazione', entityId: numero, label, data: { stampa_id: row.id, etichette: b.etichette, copie: b.copie, metodo: b.metodo, ristampa, site_id: site } });
  }
  res.json({ ok: true, id: row.id, ristampa: row.ristampa });
}));

export default r;
