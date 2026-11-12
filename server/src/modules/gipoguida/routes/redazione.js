// Guida GIPO · redazione (profilo ADMIN): sezioni (editor markdown, stato VALIDATA / DA_VALIDARE, storico delle revisioni, ripristino dal
// seme), FAQ, coda "Domande da risolvere" (la risposta diventa una FAQ pubblicata collegata a una sezione e chi aveva chiesto riceve una
// notifica nella Suite), statistiche, stato del seme e riepilogo settimanale.
import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, bad, notFound, parse, slugify } from '../../../lib/util.js';
import { notify } from '../../../lib/community.js';
import { one, many, tx, q } from '../db.js';
import { KEY, soloAdmin, IN_CODA, SQL_NUMERO, contaCoda, leggiImpostazione, riepilogoSettimanale } from '../lib/core.js';
import { caricaSeme, sezioneDelSeme, improntaSezione, improntaMeta, seme, FONTI, LIVELLI } from '../lib/seme.js';
import { rigenera } from '../lib/risposta.js';
import { invalidaPdf } from '../lib/pdf.js';
import { maschera } from '../lib/privacy.js';

const r = Router();
r.use('/redazione', soloAdmin);

// ---------------------------------------------------------------- sezioni
r.get('/redazione/sezioni', ah(async (_req, res) => {
  const righe = await many(`SELECT s.id, s.capitolo, s.ordine, s.titolo, s.slug, s.percorso_gipo, s.stato, s.origine, s.aggiornata_il, s.validata_il, s.seme_hash, s.fonte, s.livello, s.fonte_validazione,
      u.full_name AS aggiornata_da_nome, ${SQL_NUMERO} AS numero, length(s.corpo) AS caratteri,
      (SELECT count(*) FROM revisioni r WHERE r.sezione_id = s.id)::int AS revisioni, (SELECT count(*) FROM faq f WHERE f.sezione_id = s.id AND f.pubblicata)::int AS faq
    FROM sezioni s LEFT JOIN public.users u ON u.id = s.aggiornata_da ORDER BY s.capitolo, s.ordine, s.id`);
  res.json(righe.map(({ seme_hash: _h, ...s }) => s));
}));

async function dettaglio(id) {
  const s = await one(`SELECT s.*, u.full_name AS aggiornata_da_nome, v.full_name AS validata_da_nome FROM sezioni s LEFT JOIN public.users u ON u.id = s.aggiornata_da
    LEFT JOIN public.users v ON v.id = s.validata_da WHERE s.id = $1`, [id]);
  if (!s) throw notFound('Sezione inesistente');
  const dalSeme = s.origine === 'SEME' ? sezioneDelSeme(s.slug) : null;
  const hSeme = dalSeme ? improntaSezione(dalSeme) : null;
  const modificata = s.seme_hash ? improntaSezione(s) !== s.seme_hash : s.origine !== 'SEME';
  const revisioni = await many(`SELECT r.id, r.titolo, r.stato, r.fonte, r.nota, r.creata_il, u.full_name AS autore_nome, length(r.corpo) AS caratteri
    FROM revisioni r LEFT JOIN public.users u ON u.id = r.autore WHERE r.sezione_id = $1 ORDER BY r.creata_il DESC, r.id DESC LIMIT 50`, [id]);
  const { tsv: _t, ricerca_tsv: _r, ...resto } = s;
  const numero = (await one(`SELECT numero FROM (SELECT s.id, ${SQL_NUMERO} AS numero FROM sezioni s) x WHERE id = $1`, [id]))?.numero || null;
  const metaDiversa = Boolean(dalSeme && s.seme_meta_hash && improntaMeta(dalSeme) !== s.seme_meta_hash);
  return { ...resto, numero, modificata_a_mano: modificata, seme_diverso: Boolean((hSeme && hSeme !== s.seme_hash) || metaDiversa), seme_disponibile: Boolean(dalSeme), revisioni };
}
r.get('/redazione/sezioni/:id', ah(async (req, res) => res.json(await dettaglio(Number(req.params.id) || 0))));

const Sezione = z.object({
  titolo: z.string().trim().min(3).max(160), corpo: z.string().max(60000), percorso_gipo: z.string().trim().max(200).nullable().optional(),
  parole_chiave: z.string().trim().max(500).nullable().optional(), stato: z.enum(['VALIDATA', 'DA_VALIDARE']).optional(), nota: z.string().trim().max(500).optional().nullable(),
  capitolo: z.number().int().min(0).max(99).optional(), ordine: z.number().int().min(0).max(999).optional(),
  fonte: z.enum(FONTI).optional(), livello: z.enum(LIVELLI).optional(), sintesi: z.string().trim().max(400).nullable().optional(),
});
const percorsoValido = (p) => { if (p && !/^\/[A-Za-z0-9/_-]*$/.test(p)) throw bad('Percorso in GIPO non valido: deve iniziare con / (es. /Fatture/Index)'); return p || null; };

// Modifica: la versione precedente va nello storico; stato VALIDATA registra chi e quando
r.put('/redazione/sezioni/:id', ah(async (req, res) => {
  const b = parse(Sezione, req.body);
  const id = Number(req.params.id) || 0;
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM sezioni WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('Sezione inesistente');
    const stato = b.stato || cur.stato;
    await c.query(`INSERT INTO revisioni (sezione_id, titolo, corpo, percorso_gipo, parole_chiave, stato, fonte, nota, autore) VALUES ($1,$2,$3,$4,$5,$6,'MANUALE',$7,$8)`,
      [cur.id, cur.titolo, cur.corpo, cur.percorso_gipo, cur.parole_chiave, cur.stato, b.nota || null, req.user.id]);
    // fonte, livello e sintesi: se cambiano a mano, i rilasci del seme non li toccano più (impronta seme_meta_hash diversa)
    await c.query(`UPDATE sezioni SET titolo = $2, corpo = $3, percorso_gipo = $4, parole_chiave = $5, stato = $6, capitolo = $7, ordine = $8, aggiornata_il = now(), aggiornata_da = $9,
        validata_il = CASE WHEN $6 = 'VALIDATA' AND stato <> 'VALIDATA' THEN now() WHEN $6 = 'VALIDATA' THEN validata_il ELSE NULL END,
        validata_da = CASE WHEN $6 = 'VALIDATA' AND stato <> 'VALIDATA' THEN $9 WHEN $6 = 'VALIDATA' THEN validata_da ELSE NULL END,
        fonte_validazione = CASE WHEN $6 = 'VALIDATA' AND stato <> 'VALIDATA' THEN NULL WHEN $6 = 'VALIDATA' THEN fonte_validazione ELSE NULL END,
        fonte = $10, livello = $11, sintesi = $12 WHERE id = $1`,
    [cur.id, b.titolo, b.corpo, percorsoValido(b.percorso_gipo), b.parole_chiave || null, stato, b.capitolo ?? cur.capitolo, b.ordine ?? cur.ordine, req.user.id,
      b.fonte || cur.fonte, b.livello || cur.livello, b.sintesi !== undefined ? (b.sintesi || null) : cur.sintesi]);
    await audit(req, 'GIPOGUIDA_SEZIONE', { module: KEY, entity: 'sezione', entityId: cur.id, label: `Guida GIPO: sezione "${b.titolo}" modificata${stato !== cur.stato ? ` (${stato === 'VALIDATA' ? 'validata' : 'da validare'})` : ''}` }, c);
  });
  invalidaPdf();
  res.json(await dettaglio(id));
}));

// Solo lo stato (pulsante "Segna come validata" / "Torna da validare"): anche questo nello storico
r.post('/redazione/sezioni/:id/stato', ah(async (req, res) => {
  const b = parse(z.object({ stato: z.enum(['VALIDATA', 'DA_VALIDARE']), nota: z.string().trim().max(500).optional().nullable() }), req.body);
  const id = Number(req.params.id) || 0;
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM sezioni WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('Sezione inesistente');
    if (cur.stato === b.stato) return;
    if (b.stato === 'VALIDATA' && !(b.nota && b.nota.length >= 3)) throw bad('Per validare scrivi chi ha verificato la procedura in GIPO (nota)');
    await c.query(`INSERT INTO revisioni (sezione_id, titolo, corpo, percorso_gipo, parole_chiave, stato, fonte, nota, autore) VALUES ($1,$2,$3,$4,$5,$6,'STATO',$7,$8)`,
      [cur.id, cur.titolo, cur.corpo, cur.percorso_gipo, cur.parole_chiave, cur.stato, b.nota || null, req.user.id]);
    await c.query(`UPDATE sezioni SET stato = $2, aggiornata_il = now(), aggiornata_da = $3, validata_il = CASE WHEN $2 = 'VALIDATA' THEN now() END,
      validata_da = CASE WHEN $2 = 'VALIDATA' THEN $3::int END, fonte_validazione = NULL WHERE id = $1`, [cur.id, b.stato, req.user.id]);
    await audit(req, 'GIPOGUIDA_SEZIONE', { module: KEY, entity: 'sezione', entityId: cur.id, label: `Guida GIPO: sezione "${cur.titolo}" ${b.stato === 'VALIDATA' ? 'validata' : 'riportata a da validare'}`, data: { nota: b.nota } }, c);
  });
  invalidaPdf();
  res.json(await dettaglio(id));
}));

// Nuova sezione (redazione): nasce DA_VALIDARE salvo diversa scelta
r.post('/redazione/sezioni', ah(async (req, res) => {
  const b = parse(Sezione.extend({ capitolo: z.number().int().min(0).max(99) }), req.body);
  if (!(await one('SELECT 1 AS ok FROM capitoli WHERE numero = $1', [b.capitolo]))) throw bad('Capitolo inesistente');
  let slug = slugify(b.titolo); let n = 2;
  while (await one('SELECT 1 AS ok FROM sezioni WHERE slug = $1', [slug])) slug = `${slugify(b.titolo)}-${n++}`;
  const ordine = b.ordine ?? ((await one('SELECT coalesce(max(ordine), 0) + 1 AS o FROM sezioni WHERE capitolo = $1', [b.capitolo])).o);
  const s = await one(`INSERT INTO sezioni (capitolo, ordine, titolo, slug, corpo, percorso_gipo, parole_chiave, stato, origine, aggiornata_da, fonte, livello, sintesi, validata_il, validata_da)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REDAZIONE',$9,$10,$11,$12, CASE WHEN $8 = 'VALIDATA' THEN now() END, CASE WHEN $8 = 'VALIDATA' THEN $9::int END) RETURNING id`,
  [b.capitolo, ordine, b.titolo, slug, b.corpo, percorsoValido(b.percorso_gipo), b.parole_chiave || null, b.stato || 'DA_VALIDARE', req.user.id, b.fonte || 'REDAZIONE', b.livello || 'OPERATIVO', b.sintesi || null]);
  await audit(req, 'GIPOGUIDA_SEZIONE', { module: KEY, entity: 'sezione', entityId: s.id, label: `Guida GIPO: nuova sezione "${b.titolo}"` });
  invalidaPdf();
  res.json(await dettaglio(s.id));
}));

// Ripristino dal seme (versione del rilascio corrente) e ripristino di una revisione: la versione attuale va nello storico
async function sostituisci(req, id, nuovo, fonte, nota) {
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM sezioni WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('Sezione inesistente');
    await c.query(`INSERT INTO revisioni (sezione_id, titolo, corpo, percorso_gipo, parole_chiave, stato, fonte, nota, autore) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cur.id, cur.titolo, cur.corpo, cur.percorso_gipo, cur.parole_chiave, cur.stato, fonte, nota, req.user.id]);
    // ripristino dal seme: torna anche lo stato del seme (VALIDATA con la sua fonte, per le procedure del manuale TD) e la classificazione
    const validaSeme = nuovo.dal_seme && nuovo.stato === 'VALIDATA';
    await c.query(`UPDATE sezioni SET titolo = $2, corpo = $3, percorso_gipo = $4, parole_chiave = $5, stato = $8, validata_il = CASE WHEN $8 = 'VALIDATA' THEN now() END, validata_da = NULL,
      fonte_validazione = $9, seme_hash = coalesce($6, seme_hash), aggiornata_il = now(), aggiornata_da = $7,
      fonte = coalesce($10, fonte), livello = coalesce($11, livello), sintesi = CASE WHEN $12::boolean THEN $13 ELSE sintesi END, seme_meta_hash = coalesce($14, seme_meta_hash) WHERE id = $1`,
    [cur.id, nuovo.titolo, nuovo.corpo, nuovo.percorso_gipo || null, nuovo.parole_chiave || null, nuovo.seme_hash || null, req.user.id, validaSeme ? 'VALIDATA' : 'DA_VALIDARE',
      validaSeme ? nuovo.validazione : null, nuovo.dal_seme ? nuovo.fonte : null, nuovo.dal_seme ? nuovo.livello : null, Boolean(nuovo.dal_seme), nuovo.sintesi || null,
      nuovo.dal_seme ? improntaMeta(nuovo) : null]);
  });
  invalidaPdf();
}
r.post('/redazione/sezioni/:id/ripristina-seme', ah(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const s = await one('SELECT slug, titolo FROM sezioni WHERE id = $1', [id]);
  if (!s) throw notFound('Sezione inesistente');
  const x = sezioneDelSeme(s.slug);
  if (!x) throw bad('Questa sezione non viene dal seme');
  await sostituisci(req, id, { ...x, seme_hash: improntaSezione(x), dal_seme: true }, 'RIPRISTINO', 'Ripristinata la versione del seme');
  await audit(req, 'GIPOGUIDA_SEZIONE', { module: KEY, entity: 'sezione', entityId: id, label: `Guida GIPO: sezione "${s.titolo}" ripristinata dal seme` });
  res.json(await dettaglio(id));
}));
r.get('/redazione/revisioni/:id', ah(async (req, res) => {
  const v = await one(`SELECT r.*, u.full_name AS autore_nome FROM revisioni r LEFT JOIN public.users u ON u.id = r.autore WHERE r.id = $1`, [Number(req.params.id) || 0]);
  if (!v) throw notFound('Revisione inesistente');
  res.json(v);
}));
r.post('/redazione/revisioni/:id/ripristina', ah(async (req, res) => {
  const v = await one('SELECT * FROM revisioni WHERE id = $1', [Number(req.params.id) || 0]);
  if (!v) throw notFound('Revisione inesistente');
  await sostituisci(req, v.sezione_id, v, 'RIPRISTINO', `Ripristinata la revisione del ${new Date(v.creata_il).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`);
  await audit(req, 'GIPOGUIDA_SEZIONE', { module: KEY, entity: 'sezione', entityId: v.sezione_id, label: `Guida GIPO: ripristinata una revisione della sezione "${v.titolo}"` });
  res.json(await dettaglio(v.sezione_id));
}));

// ---------------------------------------------------------------- FAQ
r.get('/redazione/faq', ah(async (_req, res) => {
  res.json(await many(`SELECT f.id, f.domanda, f.risposta, f.sezione_id, f.ordine, f.origine, f.ruolo, f.pubblicata, f.aggiornata_il, s.titolo AS sezione_titolo, s.capitolo,
      u.full_name AS aggiornata_da_nome FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id LEFT JOIN public.users u ON u.id = f.aggiornata_da ORDER BY s.capitolo NULLS LAST, f.ordine, f.id`));
}));
const Faq = z.object({ domanda: z.string().trim().min(8).max(300), risposta: z.string().trim().min(5).max(20000), sezione_id: z.number().int().positive().nullable().optional(),
  pubblicata: z.boolean().default(true), ruolo: z.enum(['accettazione', 'medico', 'amministrazione']).nullable().optional() });
const sezioneEsiste = async (id) => { if (id && !(await one('SELECT 1 AS ok FROM sezioni WHERE id = $1', [id]))) throw bad('Sezione inesistente'); };
r.post('/redazione/faq', ah(async (req, res) => {
  const b = parse(Faq, req.body);
  await sezioneEsiste(b.sezione_id);
  const f = await one(`INSERT INTO faq (domanda, risposta, sezione_id, ordine, origine, ruolo, pubblicata, aggiornata_da) VALUES ($1,$2,$3,(SELECT coalesce(max(ordine), 0) + 1 FROM faq),'REDAZIONE',$4,$5,$6) RETURNING id`,
    [maschera(b.domanda).testo, b.risposta, b.sezione_id || null, b.ruolo || null, b.pubblicata, req.user.id]);
  await audit(req, 'GIPOGUIDA_FAQ', { module: KEY, entity: 'faq', entityId: f.id, label: `Guida GIPO: nuova FAQ "${b.domanda.slice(0, 80)}"` });
  invalidaPdf();
  res.json({ id: f.id });
}));
r.put('/redazione/faq/:id', ah(async (req, res) => {
  const b = parse(Faq, req.body);
  await sezioneEsiste(b.sezione_id);
  const f = await one(`UPDATE faq SET domanda = $2, risposta = $3, sezione_id = $4, ruolo = $5, pubblicata = $6, aggiornata_il = now(), aggiornata_da = $7 WHERE id = $1 RETURNING id`,
    [Number(req.params.id) || 0, maschera(b.domanda).testo, b.risposta, b.sezione_id || null, b.ruolo || null, b.pubblicata, req.user.id]);
  if (!f) throw notFound('FAQ inesistente');
  await audit(req, 'GIPOGUIDA_FAQ', { module: KEY, entity: 'faq', entityId: f.id, label: `Guida GIPO: FAQ modificata "${b.domanda.slice(0, 80)}"${b.pubblicata ? '' : ' (non pubblicata)'}` });
  invalidaPdf();
  res.json({ ok: true });
}));
r.delete('/redazione/faq/:id', ah(async (req, res) => {
  const f = await one('DELETE FROM faq WHERE id = $1 AND origine <> \'SEME\' RETURNING id, domanda', [Number(req.params.id) || 0]);
  if (!f) throw bad('FAQ inesistente o nata dal seme (quelle del seme si tolgono dalla pubblicazione, non si cancellano)');
  await audit(req, 'GIPOGUIDA_FAQ', { module: KEY, entity: 'faq', entityId: f.id, label: `Guida GIPO: FAQ eliminata "${f.domanda.slice(0, 80)}"` });
  invalidaPdf();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- coda "Domande da risolvere"
r.get('/redazione/coda', ah(async (req, res) => {
  const p = parse(z.object({ vista: z.enum(['coda', 'risolte', 'tutte']).default('coda') }), req.query);
  const where = p.vista === 'coda' ? IN_CODA : p.vista === 'risolte' ? '(d.risolta_il IS NOT NULL OR d.chiusa_il IS NOT NULL)' : 'TRUE';
  const righe = await many(`SELECT d.id, d.testo, d.mascherati, d.esito, d.risposta, d.fonti, d.utile, d.nota_utente, d.creata_il, d.presa_in_carico_il, d.risolta_il, d.chiusa_il, d.chiusa_nota,
      d.risolta_con_faq_id, d.risolta_dalla_guida, d.rigenerata_il, d.rigenerazioni, u.full_name AS utente_nome, pc.full_name AS presa_da_nome, f.domanda AS faq_domanda
    FROM domande d LEFT JOIN public.users u ON u.id = d.utente LEFT JOIN public.users pc ON pc.id = d.presa_in_carico_da LEFT JOIN faq f ON f.id = d.risolta_con_faq_id
    WHERE ${where} ORDER BY ${p.vista === 'coda' ? 'd.creata_il' : 'd.creata_il DESC'} LIMIT 300`);
  res.json({ vista: p.vista, in_coda: await contaCoda(), righe });
}));
r.post('/redazione/domande/:id/prendi', ah(async (req, res) => {
  const d = await one('UPDATE domande SET presa_in_carico_da = $2, presa_in_carico_il = now() WHERE id = $1 RETURNING id', [Number(req.params.id) || 0, req.user.id]);
  if (!d) throw notFound('Domanda inesistente');
  res.json({ ok: true });
}));
// Risposta della redazione → FAQ pubblicata collegata a una sezione; la domanda risulta risolta; notifica a chi l'aveva posta
r.post('/redazione/domande/:id/risolvi', ah(async (req, res) => {
  const b = parse(z.object({ domanda: z.string().trim().min(8).max(300), risposta: z.string().trim().min(10).max(20000), sezione_id: z.number().int().positive(),
    ruolo: z.enum(['accettazione', 'medico', 'amministrazione']).nullable().optional() }), req.body);
  await sezioneEsiste(b.sezione_id);
  const id = Number(req.params.id) || 0;
  const out = await tx(async (c) => {
    const d = (await c.query('SELECT * FROM domande WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!d) throw notFound('Domanda inesistente');
    if (d.risolta_il) throw bad('Domanda già risolta');
    const f = (await c.query(`INSERT INTO faq (domanda, risposta, sezione_id, ordine, origine, ruolo, pubblicata, aggiornata_da) VALUES ($1,$2,$3,(SELECT coalesce(max(ordine), 0) + 1 FROM faq),'DOMANDA_UTENTE',$4,TRUE,$5) RETURNING id`,
      [maschera(b.domanda).testo, b.risposta, b.sezione_id, b.ruolo || null, req.user.id])).rows[0];
    await c.query('UPDATE domande SET risolta_con_faq_id = $2, risolta_il = now(), risolta_da = $3, presa_in_carico_da = coalesce(presa_in_carico_da, $3), presa_in_carico_il = coalesce(presa_in_carico_il, now()) WHERE id = $1', [id, f.id, req.user.id]);
    await audit(req, 'GIPOGUIDA_RISPOSTA', { module: KEY, entity: 'domanda', entityId: id, label: `Guida GIPO: domanda risolta con la nuova FAQ "${b.domanda.slice(0, 80)}"`, data: { faq_id: f.id } }, c);
    return { faq_id: f.id, utente: d.utente };
  });
  let notificato = 0;
  if (out.utente && out.utente !== req.user.id) {
    notificato = await notify([out.utente], { kind: 'MODULO', module_key: KEY, title: 'Guida GIPO: c\'è la risposta alla tua domanda', body: b.domanda.slice(0, 200), link: `/gipoguida/faq?voce=${out.faq_id}` }).catch(() => 0);
  }
  invalidaPdf();
  res.json({ ok: true, faq_id: out.faq_id, notificato: notificato > 0 });
}));
// "Rigenera risposta" (v0.71.1): ripete recupero e risposta sulla domanda (già mascherata) dopo un aggiornamento della guida
r.post('/redazione/domande/:id/rigenera', ah(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const out = await rigenera(id, { userId: req.user.id });
  if (!out) throw notFound('Domanda inesistente');
  await audit(req, 'GIPOGUIDA_RISPOSTA', { module: KEY, entity: 'domanda', entityId: id, label: `Guida GIPO: risposta rigenerata (${out.esito})` });
  res.json(out);
}));
// "Segna come risolta dalla guida" (v0.71.1): la guida ora risponde (sezione aggiornata o risposta rigenerata), senza una FAQ nuova;
// chi aveva chiesto riceve una notifica con il collegamento alla sua domanda
r.post('/redazione/domande/:id/risolta-dalla-guida', ah(async (req, res) => {
  const b = parse(z.object({ nota: z.string().trim().max(500).optional().nullable() }), req.body || {});
  const id = Number(req.params.id) || 0;
  const d = await one(`UPDATE domande SET risolta_il = now(), risolta_da = $2, risolta_dalla_guida = TRUE, chiusa_nota = coalesce($3, chiusa_nota),
      presa_in_carico_da = coalesce(presa_in_carico_da, $2), presa_in_carico_il = coalesce(presa_in_carico_il, now())
    WHERE id = $1 AND risolta_il IS NULL AND chiusa_il IS NULL RETURNING id, utente, testo`, [id, req.user.id, b.nota || null]);
  if (!d) throw bad('Domanda inesistente, già risolta o chiusa');
  await audit(req, 'GIPOGUIDA_RISPOSTA', { module: KEY, entity: 'domanda', entityId: id, label: 'Guida GIPO: domanda risolta dalla guida (senza FAQ nuova)', data: { nota: b.nota || null } });
  let notificato = 0;
  if (d.utente && d.utente !== req.user.id) {
    notificato = await notify([d.utente], { kind: 'MODULO', module_key: KEY, title: 'Guida GIPO: la guida ora risponde alla tua domanda', body: d.testo.slice(0, 200), link: `/gipoguida?domanda=${id}` }).catch(() => 0);
  }
  res.json({ ok: true, notificato: notificato > 0 });
}));

// Chiusura senza FAQ (domanda non pertinente, doppione, dati da non conservare): resta nello storico con la nota
r.post('/redazione/domande/:id/chiudi', ah(async (req, res) => {
  const b = parse(z.object({ nota: z.string().trim().min(3).max(500) }), req.body);
  const d = await one('UPDATE domande SET chiusa_il = now(), chiusa_nota = $2 WHERE id = $1 AND risolta_il IS NULL RETURNING id', [Number(req.params.id) || 0, b.nota]);
  if (!d) throw bad('Domanda inesistente o già risolta');
  await audit(req, 'GIPOGUIDA_RISPOSTA', { module: KEY, entity: 'domanda', entityId: d.id, label: 'Guida GIPO: domanda chiusa senza FAQ', data: { nota: b.nota } });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- statistiche
r.get('/redazione/statistiche', ah(async (_req, res) => {
  const settimane = await many(`SELECT to_char(date_trunc('week', d.creata_il AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD') AS settimana, count(*)::int AS domande,
      count(*) FILTER (WHERE d.esito = 'RISPOSTA')::int AS con_risposta, count(*) FILTER (WHERE d.esito = 'SENZA_RISPOSTA')::int AS senza_risposta,
      count(*) FILTER (WHERE d.esito = 'SOLO_RICERCA')::int AS solo_ricerca, count(*) FILTER (WHERE d.esito = 'PARZIALE')::int AS parziali, count(*) FILTER (WHERE d.utile)::int AS utili, count(*) FILTER (WHERE d.utile = FALSE)::int AS non_utili
    FROM domande d WHERE d.creata_il > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1`);
  const tot = await one(`SELECT count(*)::int AS domande, count(*) FILTER (WHERE utile IS NOT NULL)::int AS valutate, count(*) FILTER (WHERE utile)::int AS utili,
      count(*) FILTER (WHERE esito = 'SENZA_RISPOSTA')::int AS senza_risposta, count(*) FILTER (WHERE esito = 'PARZIALE')::int AS parziali,
      count(*) FILTER (WHERE risolta_il IS NOT NULL)::int AS risolte, count(*) FILTER (WHERE risolta_dalla_guida)::int AS risolte_dalla_guida,
      count(*) FILTER (WHERE creata_il > now() - interval '7 days')::int AS ultima_settimana FROM domande`);
  const cercate = await many(`SELECT lower(testo) AS testo, count(*)::int AS volte, round(avg(risultati))::int AS risultati FROM ricerche WHERE creata_il > now() - interval '90 days'
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`);
  const vuote = await many(`SELECT lower(testo) AS testo, count(*)::int AS volte, max(aggiornata_il) AS ultima FROM ricerche WHERE risultati = 0 AND creata_il > now() - interval '90 days'
    GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 15`);
  const citate = await many(`SELECT f->>'titolo' AS titolo, f->>'slug' AS slug, count(*)::int AS volte FROM domande d, jsonb_array_elements(d.fonti) f
    WHERE f->>'tipo' = 'sezione' AND (f->>'citata')::boolean AND d.creata_il > now() - interval '90 days' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`);
  const sezioni = await one(`SELECT count(*)::int AS totale, count(*) FILTER (WHERE stato = 'VALIDATA')::int AS validate, count(*) FILTER (WHERE livello = 'BACK_END')::int AS back_end,
    count(*) FILTER (WHERE fonte IN ('MANUALE_TD', 'INTERFACCIA+MANUALE'))::int AS dal_manuale FROM sezioni`);
  const faq = await one(`SELECT count(*) FILTER (WHERE pubblicata)::int AS pubblicate, count(*) FILTER (WHERE origine = 'DOMANDA_UTENTE')::int AS da_domande FROM faq`);
  res.json({ totali: { ...tot, pct_utili: tot.valutate ? Math.round((tot.utili / tot.valutate) * 100) : null, in_coda: await contaCoda() }, settimane, cercate, vuote, citate, sezioni, faq,
    riepilogo: await leggiImpostazione('riepilogo', null) });
}));

// ---------------------------------------------------------------- seme e riepilogo
// "Ripartiamo a pulito" (CEO, 13/11/2026): cancella TUTTE le domande e le ricerche registrate, di tutti gli utenti, e con esse coda e
// statistiche. Le FAQ nate dalle domande restano. Serve la conferma scritta.
r.post('/redazione/azzera', ah(async (req, res) => {
  const b = parse(z.object({ conferma: z.literal('AZZERA') }), req.body);
  void b;
  const d = await q('DELETE FROM domande');
  const c = await q('DELETE FROM ricerche');
  await audit(req, 'GIPOGUIDA_AZZERA', { module: KEY, entity: 'domande', label: `Guida GIPO: azzerate ${d.rowCount} domande e ${c.rowCount} ricerche` });
  res.json({ ok: true, domande: d.rowCount, ricerche: c.rowCount });
}));
r.get('/redazione/seme', ah(async (_req, res) => {
  const st = await leggiImpostazione('seme', null);
  const s = seme();
  res.json({ caricato: st, rilascio: { impronta: s.impronta, capitoli: s.capitoli.length, sezioni: s.sezioni.length, faq: s.faq.length } });
}));
r.post('/redazione/seme/ricarica', ah(async (req, res) => {
  const out = await caricaSeme({ forza: true });
  await audit(req, 'GIPOGUIDA_SEME', { module: KEY, entity: 'seme', label: 'Guida GIPO: seme ricaricato', data: { sezioni: out.sezioni, faq: out.faq } });
  invalidaPdf();
  res.json(out);
}));
r.post('/redazione/riepilogo', ah(async (req, res) => {
  const out = await riepilogoSettimanale({ forza: true });
  await audit(req, 'GIPOGUIDA_RIEPILOGO', { module: KEY, entity: 'riepilogo', label: `Guida GIPO: riepilogo inviato a mano (${out.coda ?? 0} in coda)` });
  res.json(out);
}));

// testo di prova per il controllo dei dati personali dall'editor (nessun salvataggio)
r.post('/redazione/controlla-testo', ah(async (req, res) => {
  const b = parse(z.object({ testo: z.string().max(60000) }), req.body);
  res.json({ mascherati: maschera(b.testo).mascherati });
}));

export default r;
