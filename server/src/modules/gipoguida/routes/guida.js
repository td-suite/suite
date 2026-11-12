// Guida GIPO · route di consultazione (tutti gli interni: LETTORE e ADMIN): indice, sezioni, FAQ, ricerca, domande, valutazione, PDF.
import { Router } from 'express';
import { z } from 'zod';
import { ah, parse, notFound, bad } from '../../../lib/util.js';
import { many, one } from '../db.js';
import { contesto, linkGipo, SQL_NUMERO, contaCoda } from '../lib/core.js';
import { cercaGuida, registraRicerca } from '../lib/ricerca.js';
import { maschera, senzaSegnaposto } from '../lib/privacy.js';
import { chiedi, valuta } from '../lib/risposta.js';
import { pdfGuida } from '../lib/pdf.js';

const r = Router();

// Contatori del menu del modulo (Shell della Suite: GET /api/<modulo>/badges): domande in coda, solo per la redazione
r.get('/badges', ah(async (req, res) => res.json(contesto(req).isAdmin ? { coda: await contaCoda() } : {})));

// Indice: capitoli con le sezioni (numero, titolo, slug, stato, fonte, livello), senza il corpo
r.get('/indice', ah(async (_req, res) => {
  const capitoli = await many('SELECT numero, titolo, intro FROM capitoli ORDER BY numero');
  const sezioni = await many(`SELECT s.id, s.capitolo, s.titolo, s.slug, s.stato, s.percorso_gipo, s.fonte, s.livello, ${SQL_NUMERO} AS numero FROM sezioni s ORDER BY s.capitolo, s.ordine, s.id`);
  const tot = await one(`SELECT (SELECT count(*) FROM sezioni)::int AS sezioni, (SELECT count(*) FROM sezioni WHERE stato = 'DA_VALIDARE')::int AS da_validare, (SELECT count(*) FROM faq WHERE pubblicata)::int AS faq,
    (SELECT count(*) FROM sezioni WHERE livello = 'BACK_END')::int AS back_end, (SELECT count(*) FROM sezioni WHERE fonte IN ('MANUALE_TD', 'INTERFACCIA+MANUALE'))::int AS dal_manuale,
    (SELECT max(aggiornata_il) FROM sezioni) AS aggiornata_il`);
  res.json({ capitoli: capitoli.map((k) => ({ ...k, sezioni: sezioni.filter((s) => s.capitolo === k.numero) })), totali: tot });
}));

// Una sezione: corpo markdown, link "Apri in GIPO" (solo consultazione), FAQ collegate, precedente e successiva
r.get('/sezioni/:slug', ah(async (req, res) => {
  const tutte = await many(`SELECT s.id, s.slug, s.titolo, s.capitolo, ${SQL_NUMERO} AS numero FROM sezioni s ORDER BY s.capitolo, s.ordine, s.id`);
  const i = tutte.findIndex((x) => x.slug === req.params.slug);
  if (i < 0) throw notFound('Sezione inesistente');
  const s = await one(`SELECT s.*, k.titolo AS capitolo_titolo, u.full_name AS aggiornata_da_nome, v.full_name AS validata_da_nome FROM sezioni s
    LEFT JOIN capitoli k ON k.numero = s.capitolo LEFT JOIN public.users u ON u.id = s.aggiornata_da LEFT JOIN public.users v ON v.id = s.validata_da WHERE s.id = $1`, [tutte[i].id]);
  const faq = await many('SELECT id, domanda, risposta, origine FROM faq WHERE sezione_id = $1 AND pubblicata ORDER BY ordine, id', [s.id]);
  const numeri = Object.fromEntries(tutte.map((x) => [x.slug, { numero: x.numero, titolo: x.titolo }]));
  res.json({ ...s, tsv: undefined, ricerca_tsv: undefined, seme_hash: undefined, seme_meta_hash: undefined, numero: tutte[i].numero, link_gipo: linkGipo(s.percorso_gipo), faq, sezioni: numeri,
    precedente: tutte[i - 1] || null, successiva: tutte[i + 1] || null });
}));

// FAQ pubblicate per capitolo (con ricerca facoltativa)
r.get('/faq', ah(async (req, res) => {
  const p = parse(z.object({ q: z.string().trim().max(200).optional() }), req.query);
  let filtro = null;
  if (p.q && p.q.length >= 2) {
    const { testo } = maschera(p.q);
    const trovate = await cercaGuida(senzaSegnaposto(testo), { limite: 60, tipi: ['faq'] });
    filtro = new Map(trovate.map((x, k) => [x.id, { k, snippet: x.snippet }]));
    await registraRicerca(req.user.id, testo, trovate.length).catch(() => {});
  }
  const righe = await many(`SELECT f.id, f.domanda, f.risposta, f.origine, f.ruolo, f.sezione_id, s.slug AS sezione_slug, s.titolo AS sezione_titolo, s.capitolo, s.stato AS sezione_stato,
      k.titolo AS capitolo_titolo FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id LEFT JOIN capitoli k ON k.numero = s.capitolo
    WHERE f.pubblicata ORDER BY s.capitolo NULLS LAST, f.ordine, f.id`);
  const voci = filtro ? righe.filter((x) => filtro.has(x.id)).map((x) => ({ ...x, snippet: filtro.get(x.id).snippet })).sort((a, b) => filtro.get(a.id).k - filtro.get(b.id).k) : righe;
  res.json({ q: p.q || '', totale: righe.length, voci });
}));

// Ricerca immediata (mentre si scrive) su sezioni e FAQ
r.get('/cerca', ah(async (req, res) => {
  const p = parse(z.object({ q: z.string().trim().min(2, 'scrivi almeno due caratteri').max(200), registra: z.enum(['0', '1']).optional(), livello: z.enum(['BACK_END', 'OPERATIVO']).optional() }), req.query);
  const { testo, mascherati } = maschera(p.q);
  const risultati = await cercaGuida(senzaSegnaposto(testo), { limite: 12, livello: p.livello || null });
  if (p.registra !== '0') await registraRicerca(req.user.id, testo, risultati.length).catch(() => {});
  res.json({ q: testo, mascherati, risultati: risultati.map((x) => ({ ...x, testo: undefined, score: Math.round(x.score * 1000) / 1000 })) });
}));

// Domanda con risposta (vedi lib/risposta.js): limite orario, mascheramento, registrazione
r.post('/chiedi', ah(async (req, res) => {
  const b = parse(z.object({ domanda: z.string().trim().min(1, 'scrivi la domanda').max(1000, 'domanda troppo lunga (al massimo 1000 caratteri)') }), req.body);
  res.json(await chiedi(b.domanda, { userId: req.user.id }));
}));

// Le domande recenti dell'utente (pagina Chiedi)
r.get('/domande/mie', ah(async (req, res) => {
  res.json(await many(`SELECT d.id, d.testo, d.esito, d.risolta_dalla_guida, d.rigenerata_il, d.risposta, d.fonti, d.utile, d.nota_utente, d.creata_il, d.risolta_il, d.chiusa_il, d.risolta_con_faq_id, f.domanda AS faq_domanda
    FROM domande d LEFT JOIN faq f ON f.id = d.risolta_con_faq_id WHERE d.utente = $1 ORDER BY d.creata_il DESC LIMIT 20`, [req.user.id]));
}));
r.get('/domande/:id', ah(async (req, res) => {
  const d = await one(`SELECT d.id, d.testo, d.esito, d.risposta, d.fonti, d.utile, d.nota_utente, d.creata_il, d.risolta_il, d.risolta_con_faq_id, d.risolta_dalla_guida, d.rigenerata_il,
      f.domanda AS faq_domanda, f.risposta AS faq_risposta
    FROM domande d LEFT JOIN faq f ON f.id = d.risolta_con_faq_id WHERE d.id = $1 AND (d.utente = $2 OR $3)`, [Number(req.params.id) || 0, req.user.id, contesto(req).isAdmin]);
  if (!d) throw notFound('Domanda inesistente');
  res.json(d);
}));

// "Mi è stata utile: sì / no" (+ nota): solo chi ha posto la domanda; "no" la mette nella coda della redazione
r.post('/domande/:id/valuta', ah(async (req, res) => {
  const b = parse(z.object({ utile: z.boolean(), nota: z.string().trim().max(1000).optional().nullable() }), req.body);
  const d = await valuta(Number(req.params.id) || 0, req.user.id, b);
  if (!d) throw bad('Puoi valutare solo le tue domande');
  res.json({ ok: true, in_coda: d.utile === false || d.esito === 'SENZA_RISPOSTA' });
}));

// PDF completo della guida (dalla cache se nulla è cambiato); ?scarica=1 per salvarlo invece di aprirlo
r.get('/guida.pdf', ah(async (req, res) => {
  const p = await pdfGuida();
  const nome = `Guida_GipoNext_TD_${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.scarica === '1' ? 'attachment' : 'inline'}; filename="${nome}"`);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Pagine', String(p.pagine));
  res.send(p.buffer);
}));

export default r;
