// Modulo Public Affairs (chiave `affari`, area DIREZIONE), v0.96.0. Richiesta del CEO del 24/11/2026: monitoraggio di siti specifici
// (avvisi e manifestazioni di interesse delle USL toscane, altri che indicherà) e della normativa sanitaria nazionale e della Regione
// Toscana; sulla normativa il modello AI prepara la sintesi per valutarne l'utilità; email ogni giorno in caso di novità.
// Documentazione: docs/PUBLIC_AFFAIRS.md. Nativo, solo su grant (profili DIREZIONE e VIEWER; titolare = DIREZIONE).
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import { startFresh } from '../../lib/travaso.js';
import { ah, HttpError, bad, forbidden, notFound, audit as auditSuite } from '../../lib/util.js';
import { aiEnabled } from '../../lib/claude.js';
import { mailStatus } from '../../lib/mailer.js';
import { one, many, q } from './db.js';
import { KEY, CATEGORIE, LINEE, PREDEFINITE, impostazioni, salvaImpostazione, listaEmail, destinatari, caricaSeme, vociDellaFonte, leggiFonte, giro, valutaNovita, inviaGiornaliera, novitaDaInviare, oraRoma } from './lib/core.js';
import { assoluto } from './lib/estrai.js';

export const OPZIONI_UTENTE = { roleColumn: 'role', extraColumns: { defaultAdminRole: 'VIEWER' } };
const ruoloDi = (u) => (u?.grants?.affari?.profile === 'DIREZIONE' || (u?.level === 'OWNER' && !u?.grants?.affari) ? 'DIREZIONE' : 'VIEWER');
const gestisce = (req, _res, next) => (ruoloDi(req.user) === 'DIREZIONE' ? next() : next(forbidden('Operazione riservata al profilo Direzione')));
const traccia = async (req, azione, label, dati = null) => { await q('INSERT INTO audit_log (user_id, action, label, data) VALUES ($1,$2,$3,$4)', [req.user.id, azione, label, dati ? JSON.stringify(dati) : null]).catch(() => 0); await auditSuite(req, `AFFARI_${azione}`, { module: KEY, label, data: dati }).catch(() => 0); };
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad('Identificativo non valido'); return n; };

export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, OPZIONI_UTENTE));
  r.get('/state', ah(async (req, res) => res.json({ mode: (await getModuleState(KEY)).mode, user: { id: req.user.id, full_name: req.user.full_name, ruolo: ruoloDi(req.user), gestisce: ruoloDi(req.user) === 'DIREZIONE' }, categorie: CATEGORIE, linee: LINEE, ai: aiEnabled() })));
  r.get('/badges', ah(async (_req, res) => res.json({ novita: (await one(`SELECT count(*)::int AS n FROM voci v JOIN fonti f ON f.id = v.fonte_id WHERE NOT v.preesistente AND v.stato = 'NUOVA' AND (f.categoria = 'BANDI' OR v.utilita IN ('ALTA','MEDIA') OR v.utilita IS NULL)`)).n, fonti_errore: (await one('SELECT count(*)::int AS n FROM fonti WHERE attiva AND errore IS NOT NULL')).n })));
  r.use(blockWritesInMirror);

  // ---- novità
  r.get('/voci', ah(async (req, res) => {
    const P = []; const W = ['NOT v.preesistente']; const p = (v) => { P.push(v); return `$${P.length}`; };
    const vista = String(req.query.vista || 'RILEVANTI');
    if (vista === 'RILEVANTI') W.push(`v.stato <> 'ARCHIVIATA' AND (f.categoria = 'BANDI' OR v.utilita IN ('ALTA','MEDIA') OR v.utilita IS NULL)`);
    else if (vista === 'EVIDENZA') W.push(`v.stato = 'IN_EVIDENZA'`); else if (vista === 'SCARSA') W.push(`v.utilita = 'BASSA' AND f.categoria <> 'BANDI' AND v.stato <> 'ARCHIVIATA'`); else if (vista === 'ARCHIVIO') W.push(`v.stato = 'ARCHIVIATA'`);
    if (CATEGORIE[req.query.categoria]) W.push(`f.categoria = ${p(req.query.categoria)}`);
    if (req.query.fonte) W.push(`f.id = ${p(id(req.query.fonte))}`);
    if (req.query.cerca) W.push(`(v.titolo ILIKE '%' || ${p(String(req.query.cerca).slice(0, 80))} || '%' OR v.sintesi ILIKE '%' || $${P.length} || '%')`);
    const righe = await many(`SELECT v.id, v.titolo, v.url, v.descrizione, v.pubblicata::text AS pubblicata, v.scadenza::text AS scadenza, v.vista_at, v.ai_stato, v.utilita, v.linee, v.sintesi, v.motivo, v.azione, v.approfondita, v.ai_errore, v.stato, v.nota, v.inviata_at, f.id AS fonte_id, f.nome AS fonte, f.categoria
        FROM voci v JOIN fonti f ON f.id = v.fonte_id WHERE ${W.join(' AND ')} ORDER BY (v.stato = 'IN_EVIDENZA') DESC, v.vista_at::date DESC, CASE v.utilita WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 WHEN 'BASSA' THEN 3 ELSE 2 END, v.id DESC LIMIT 300`, P);
    res.json({ righe, fonti: await many('SELECT id, nome, categoria FROM fonti ORDER BY categoria, nome'), ultimo_invio: await one('SELECT giorno::text AS giorno, at, voci, esito, destinatari FROM invii ORDER BY giorno DESC LIMIT 1'),
      ultima_lettura: (await one('SELECT max(letta_ok_at) AS at FROM fonti WHERE attiva')).at, in_attesa_di_invio: (await novitaDaInviare(await impostazioni())).dentro.length });
  }));
  // Stato di lettura della voce: lo segna chiunque abbia il widget (è il suo modo di lavorare l'elenco); la nota e l'archivio restano a chi gestisce
  r.put('/voci/:id', ah(async (req, res) => {
    const b = req.body || {}; const stato = ['NUOVA', 'LETTA', 'IN_EVIDENZA', 'ARCHIVIATA'].includes(b.stato) ? b.stato : null;
    if ((stato === 'ARCHIVIATA' || b.nota !== undefined) && ruoloDi(req.user) !== 'DIREZIONE') throw forbidden('Operazione riservata al profilo Direzione');
    const v = await one('UPDATE voci SET stato = coalesce($2, stato), nota = CASE WHEN $4 THEN $3 ELSE nota END WHERE id = $1 RETURNING id', [id(req.params.id), stato, String(b.nota || '').trim().slice(0, 1000) || null, b.nota !== undefined]);
    if (!v) throw notFound('Voce non trovata');
    res.json({ ok: true });
  }));
  r.post('/voci/lette', ah(async (req, res) => { const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger); res.json({ aggiornate: ids.length ? (await q(`UPDATE voci SET stato = 'LETTA' WHERE id = ANY($1::bigint[]) AND stato = 'NUOVA'`, [ids])).rowCount : 0 }); }));
  r.post('/voci/:id/rivaluta', gestisce, ah(async (req, res) => {
    const v = await one(`UPDATE voci SET ai_stato = 'DA_VALUTARE', approfondita = FALSE, ai_errore = NULL WHERE id = $1 AND NOT preesistente RETURNING id`, [id(req.params.id)]);
    if (!v) throw notFound('Voce non trovata');
    res.json(await valutaNovita(await impostazioni(), { limite: 20, limiteTesti: 3 }));
  }));

  // ---- fonti
  r.get('/fonti', ah(async (_req, res) => res.json({ righe: await many(`SELECT f.*, (SELECT count(*)::int FROM voci v WHERE v.fonte_id = f.id AND NOT v.preesistente) AS novita, (SELECT count(*)::int FROM voci v WHERE v.fonte_id = f.id) AS voci FROM fonti f ORDER BY f.categoria, f.nome`) })));
  const leggiCorpoFonte = (b) => {
    const url = assoluto(String(b.url || '').trim(), undefined); if (!url) throw bad('Indirizzo non valido: deve iniziare con http:// o https://');
    const nome = String(b.nome || '').trim(); if (nome.length < 3) throw bad('Dai un nome alla fonte');
    if (!CATEGORIE[b.categoria]) throw bad('Categoria non valida');
    return { nome: nome.slice(0, 200), url, tipo: b.tipo === 'RSS' ? 'RSS' : 'PAGINA', categoria: b.categoria, filtro: String(b.filtro || '').trim().slice(0, 200) || null };
  };
  // Prova di lettura senza salvare: quante voci vede la Suite e quali sono le prime
  r.post('/fonti/prova', gestisce, ah(async (req, res) => {
    const f = leggiCorpoFonte({ nome: 'prova', categoria: 'ALTRO', ...req.body });
    const x = await vociDellaFonte(f);
    res.json({ ok: x.ok, errore: x.errore || null, tipo: x.tipo || null, trovate: x.voci.length, esempi: x.voci.slice(0, 12) });
  }));
  r.post('/fonti', gestisce, ah(async (req, res) => {
    const f = leggiCorpoFonte(req.body || {});
    const riga = await one('INSERT INTO fonti (nome, url, tipo, categoria, filtro, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO NOTHING RETURNING *', [f.nome, f.url, f.tipo, f.categoria, f.filtro, req.user.id]);
    if (!riga) throw bad('Questa fonte è già in elenco');
    const prima = await leggiFonte(riga, await impostazioni());   // prima lettura subito: ciò che c'è ora non è una novità
    await traccia(req, 'FONTE_AGGIUNTA', `Fonte aggiunta: ${f.nome}`, { url: f.url });
    res.json({ id: riga.id, prima_lettura: prima });
  }));
  r.put('/fonti/:id', gestisce, ah(async (req, res) => {
    const b = req.body || {}; const cur = await one('SELECT * FROM fonti WHERE id = $1', [id(req.params.id)]); if (!cur) throw notFound('Fonte non trovata');
    const f = leggiCorpoFonte({ ...cur, ...b });
    // indirizzo o filtro cambiati: la fonte riparte dalla prima lettura (altrimenti tutto ciò che c'è sarebbe "novità")
    const riparte = f.url !== cur.url || (f.filtro || '') !== (cur.filtro || '') || f.tipo !== cur.tipo;
    await q('UPDATE fonti SET nome = $2, url = $3, tipo = $4, categoria = $5, filtro = $6, attiva = $7, inizializzata = CASE WHEN $8 THEN FALSE ELSE inizializzata END, errore = CASE WHEN $8 THEN NULL ELSE errore END WHERE id = $1', [cur.id, f.nome, f.url, f.tipo, f.categoria, f.filtro, b.attiva === undefined ? cur.attiva : Boolean(b.attiva), riparte]);
    await traccia(req, 'FONTE_MODIFICATA', `Fonte modificata: ${f.nome}`);
    res.json({ ok: true, riparte });
  }));
  r.delete('/fonti/:id', gestisce, ah(async (req, res) => {
    const f = await one('DELETE FROM fonti WHERE id = $1 RETURNING nome', [id(req.params.id)]); if (!f) throw notFound('Fonte non trovata');
    await traccia(req, 'FONTE_ELIMINATA', `Fonte eliminata: ${f.nome}`);
    res.json({ ok: true });
  }));
  r.post('/fonti/:id/leggi', gestisce, ah(async (req, res) => {
    const f = await one('SELECT * FROM fonti WHERE id = $1', [id(req.params.id)]); if (!f) throw notFound('Fonte non trovata');
    const imp = await impostazioni(); const out = await leggiFonte(f, imp);
    res.json({ ...out, valutazione: out.nuove ? await valutaNovita(imp) : null });
  }));

  // ---- giro, email, impostazioni
  r.post('/giro', gestisce, ah(async (req, res) => { const out = await giro({ tutte: true, invia: false }); await traccia(req, 'GIRO', `Lettura a mano: ${out.nuove} novità`); res.json(out); }));
  r.post('/email/invia', gestisce, ah(async (req, res) => { const out = await inviaGiornaliera(await impostazioni(), { forza: true }); await traccia(req, 'EMAIL', out.inviata ? `Email inviata: ${out.voci} novità` : `Email non inviata: ${out.saltata || out.errore}`); res.json(out); }));
  r.get('/impostazioni', ah(async (req, res) => {
    const imp = await impostazioni();
    res.json({ valori: imp, predefinite: PREDEFINITE, destinatari_effettivi: await destinatari(imp), modificabili: ruoloDi(req.user) === 'DIREZIONE', ai: aiEnabled(), posta: mailStatus(), ora_adesso: oraRoma(),
      invii: await many('SELECT giorno::text AS giorno, at, voci, esito, destinatari, errore FROM invii ORDER BY giorno DESC LIMIT 15'), registro: await many('SELECT a.at, a.label, u.full_name AS utente FROM audit_log a LEFT JOIN public.users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 40') });
  }));
  r.put('/impostazioni', gestisce, ah(async (req, res) => {
    const b = req.body || {}; const cambiate = [];
    for (const k of ['destinatari', 'ora_invio', 'ore_lettura', 'invio_attivo', 'soglia_normativa', 'profilo', 'max_novita_fonte']) {
      if (b[k] === undefined) continue;
      let v = b[k];
      if (k === 'destinatari') { v = listaEmail(v).join(', '); if (String(b[k]).trim() && !v) throw bad('Indirizzi dei destinatari non validi'); }
      if (k === 'profilo') { v = String(v || '').trim(); if (v.length < 50) throw bad('Il profilo dell\'azienda è troppo breve: è ciò su cui il modello giudica l\'utilità'); v = v.slice(0, 4000); }
      if (k === 'soglia_normativa' && !['ALTA', 'MEDIA', 'BASSA'].includes(v)) throw bad('Soglia non valida');
      if (['ora_invio', 'ore_lettura', 'max_novita_fonte'].includes(k)) { v = Number(v); if (!Number.isFinite(v)) throw bad('Valore numerico non valido'); }
      if (k === 'invio_attivo') v = Boolean(v);
      await salvaImpostazione(k, v, req.user.id); cambiate.push(k);
    }
    if (cambiate.length) await traccia(req, 'IMPOSTAZIONI', `Impostazioni cambiate: ${cambiate.join(', ')}`);
    res.json({ cambiate });
  }));
  r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint inesistente')));
  app.use(`/api/${KEY}`, r);

  // Ogni ora dalle 5 alle 22: legge le fonti scadute, valuta le novità e, all'ora stabilita, invia l'email del giorno (solo se ce ne sono)
  registerJob(`${KEY}:giro`, 60, async () => {
    if ((await getModuleState(KEY)).mode !== 'LIVE') return { saltato: 'modulo non attivo' };
    const h = oraRoma(); if (h < 5 || h > 22) return { saltato: 'fuori orario' };
    return giro();
  });
}

export async function afterStart() {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') { await startFresh(KEY, null); console.log('[affari] modulo Public Affairs attivato (nativo)'); }
  const n = await caricaSeme();
  if (n) console.log(`[affari] fonti proposte caricate: ${n}`);
}
