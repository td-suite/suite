// Label · amministrazione (profilo ADMIN): modelli dell'etichetta, validazione, impostazioni, modello per sede, registro delle stampe,
// stato del job delle identità recenti.
import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, bad, notFound, parse } from '../../../lib/util.js';
import { q, one, many, tx } from '../db.js';
import { KEY, soloAdmin, settings, setSetting, GIORNI_MAX, dataApiAttiva } from '../lib/core.js';
import { analizzaZpl, segnapostoSconosciuti, dotDaMm } from '../lib/zpl.js';
import { giroIdentita, statoJob, purga } from '../lib/identita.js';

const r = Router();
r.use(['/modelli', '/impostazioni', '/registro', '/identita'], soloAdmin);

const COLS = `m.id, m.nome, m.larghezza_mm::float AS larghezza_mm, m.altezza_mm::float AS altezza_mm, m.dpi, m.zpl, m.attivo, m.predefinito, m.note,
  m.validato_il, m.validazione_nota, m.updated_at, vu.full_name AS validato_da_nome, uu.full_name AS aggiornato_da_nome,
  (SELECT count(*)::int FROM modelli_sede s WHERE s.modello_id = m.id) AS sedi`;
const FROM = 'FROM modelli m LEFT JOIN public.users vu ON vu.id = m.validato_da LEFT JOIN public.users uu ON uu.id = m.updated_by';

r.get('/modelli', ah(async (_req, res) => res.json(await many(`SELECT ${COLS} ${FROM} ORDER BY m.attivo DESC, m.predefinito DESC, m.nome`))));

const Modello = z.object({
  nome: z.string().trim().min(2).max(80), larghezza_mm: z.number().min(10).max(120), altezza_mm: z.number().min(5).max(200),
  dpi: z.union([z.literal(203), z.literal(300)]), zpl: z.string().min(6).max(20000), attivo: z.boolean().default(true), note: z.string().max(1000).nullable().optional(),
});
/** Controlli del modello: comandi non supportati e segnaposto sconosciuti sono avvisi (si salva lo stesso); senza ^XA/^XZ è un errore. */
function controlla(b) {
  const a = analizzaZpl(b.zpl, { larghezza: dotDaMm(b.larghezza_mm, b.dpi), altezza: dotDaMm(b.altezza_mm, b.dpi) });
  if (!a.etichette.length) throw bad('Il modello deve contenere un\'etichetta tra ^XA e ^XZ');
  return { non_supportati: a.nonSupportati, segnaposto_sconosciuti: segnapostoSconosciuti(b.zpl), avvisi: a.avvisi };
}

r.post('/modelli', ah(async (req, res) => {
  const b = parse(Modello, req.body);
  const controllo = controlla(b);
  const m = await one(`INSERT INTO modelli (nome, larghezza_mm, altezza_mm, dpi, zpl, attivo, note, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [b.nome, b.larghezza_mm, b.altezza_mm, b.dpi, b.zpl, b.attivo, b.note || null, req.user.id]);
  await audit(req, 'ETICHETTE_MODELLO', { module: KEY, entity: 'modello', entityId: m.id, label: `Nuovo modello di etichetta "${b.nome}" (${b.larghezza_mm}×${b.altezza_mm} mm, ${b.dpi} dpi)` });
  res.json({ ...(await one(`SELECT ${COLS} ${FROM} WHERE m.id = $1`, [m.id])), controllo });
}));

// Modifica: se cambiano disegno, misure o risoluzione la validazione decade (la validazione riguarda quel disegno)
r.put('/modelli/:id', ah(async (req, res) => {
  const b = parse(Modello, req.body);
  const cur = await one('SELECT * FROM modelli WHERE id = $1', [Number(req.params.id) || 0]);
  if (!cur) throw notFound('Modello inesistente');
  const controllo = controlla(b);
  const disegnoCambiato = cur.zpl !== b.zpl || Number(cur.larghezza_mm) !== b.larghezza_mm || Number(cur.altezza_mm) !== b.altezza_mm || cur.dpi !== b.dpi;
  if (cur.predefinito && !b.attivo) throw bad('Il modello predefinito non si disattiva: scegline prima un altro come predefinito');
  await q(`UPDATE modelli SET nome=$2, larghezza_mm=$3, altezza_mm=$4, dpi=$5, zpl=$6, attivo=$7, note=$8, updated_by=$9, updated_at=now()
           ${disegnoCambiato ? ', validato_il = NULL, validato_da = NULL, validazione_nota = NULL' : ''} WHERE id=$1`,
  [cur.id, b.nome, b.larghezza_mm, b.altezza_mm, b.dpi, b.zpl, b.attivo, b.note || null, req.user.id]);
  await audit(req, 'ETICHETTE_MODELLO', { module: KEY, entity: 'modello', entityId: cur.id, label: `Modello di etichetta "${b.nome}" modificato${disegnoCambiato && cur.validato_il ? ': validazione tolta (disegno cambiato)' : ''}` });
  res.json({ ...(await one(`SELECT ${COLS} ${FROM} WHERE m.id = $1`, [cur.id])), controllo, validazione_tolta: Boolean(disegnoCambiato && cur.validato_il) });
}));

r.post('/modelli/:id/predefinito', ah(async (req, res) => {
  const m = await one('SELECT id, nome, attivo FROM modelli WHERE id = $1', [Number(req.params.id) || 0]);
  if (!m) throw notFound('Modello inesistente');
  if (!m.attivo) throw bad('Un modello disattivato non può essere il predefinito');
  await tx(async (c) => { await c.query('UPDATE modelli SET predefinito = FALSE WHERE predefinito AND id <> $1', [m.id]); await c.query('UPDATE modelli SET predefinito = TRUE, updated_at = now() WHERE id = $1', [m.id]); });
  await audit(req, 'ETICHETTE_MODELLO', { module: KEY, entity: 'modello', entityId: m.id, label: `Modello di etichetta predefinito: "${m.nome}"` });
  res.json({ ok: true });
}));

// Validazione del laboratorio: confronto con l'etichetta di StudioLab e lettura con gli strumenti (nota obbligatoria: chi e come)
r.post('/modelli/:id/valida', ah(async (req, res) => {
  const b = parse(z.object({ nota: z.string().trim().min(5).max(500) }), req.body);
  const m = await one('SELECT id, nome, attivo FROM modelli WHERE id = $1', [Number(req.params.id) || 0]);
  if (!m) throw notFound('Modello inesistente');
  if (!m.attivo) throw bad('Un modello disattivato non si valida');
  await q('UPDATE modelli SET validato_il = now(), validato_da = $2, validazione_nota = $3 WHERE id = $1', [m.id, req.user.id, b.nota]);
  await audit(req, 'ETICHETTE_MODELLO_VALIDATO', { module: KEY, entity: 'modello', entityId: m.id, label: `Modello di etichetta "${m.nome}" validato dal laboratorio`, data: { nota: b.nota } });
  res.json(await one(`SELECT ${COLS} ${FROM} WHERE m.id = $1`, [m.id]));
}));
r.delete('/modelli/:id/valida', ah(async (req, res) => {
  const m = await one('UPDATE modelli SET validato_il = NULL, validato_da = NULL, validazione_nota = NULL WHERE id = $1 RETURNING id, nome', [Number(req.params.id) || 0]);
  if (!m) throw notFound('Modello inesistente');
  await audit(req, 'ETICHETTE_MODELLO_VALIDATO', { module: KEY, entity: 'modello', entityId: m.id, label: `Validazione tolta al modello di etichetta "${m.nome}"` });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- impostazioni
const sediDisponibili = () => many(`SELECT s.id, s.code, s.name, s.kind, ms.modello_id FROM public.sites s LEFT JOIN modelli_sede ms ON ms.site_id = s.id
  WHERE s.active AND s.kind <> 'SERVICE' ORDER BY s.code NULLS LAST, s.name`);
r.get('/impostazioni', ah(async (_req, res) => {
  const [imp, sedi, job, da, n] = await Promise.all([settings(), sediDisponibili(), statoJob(), dataApiAttiva(),
    one(`SELECT (SELECT count(*) FROM pazienti_recenti WHERE cognome IS NOT NULL OR nome IS NOT NULL)::int AS identita, (SELECT min(letto_il) FROM pazienti_recenti) AS piu_vecchia,
                (SELECT count(*) FROM accettazioni_dirette)::int AS letture_dirette`)]);
  res.json({ ...imp, giorni_max: GIORNI_MAX, sedi, job, data_api: da, conservati: n });
}));
r.put('/impostazioni', ah(async (req, res) => {
  const b = parse(z.object({
    giorni_identita: z.number().int().min(1).max(GIORNI_MAX).optional(), etichetta_richiesta: z.boolean().optional(),
    modelli_sede: z.array(z.object({ site_id: z.number().int().positive(), modello_id: z.number().int().positive().nullable() })).max(500).optional(),
  }), req.body);
  const prima = await settings();
  if (b.giorni_identita != null) await setSetting('giorni_identita', b.giorni_identita);
  if (b.etichetta_richiesta != null) await setSetting('etichetta_richiesta', b.etichetta_richiesta);
  if (b.modelli_sede) {
    await tx(async (c) => {
      for (const x of b.modelli_sede) {
        if (x.modello_id == null) await c.query('DELETE FROM modelli_sede WHERE site_id = $1', [x.site_id]);
        else {
          const ok = (await c.query('SELECT 1 FROM modelli WHERE id = $1 AND attivo', [x.modello_id])).rowCount;
          if (!ok) throw bad(`Modello ${x.modello_id} inesistente o disattivato`);
          await c.query(`INSERT INTO modelli_sede (site_id, modello_id) VALUES ($1,$2) ON CONFLICT (site_id) DO UPDATE SET modello_id = EXCLUDED.modello_id, updated_at = now()`, [x.site_id, x.modello_id]);
        }
      }
    });
  }
  // meno giorni: le identità oltre il nuovo limite si tolgono subito
  const purgate = b.giorni_identita != null && b.giorni_identita < prima.giorni_identita ? await purga(b.giorni_identita) : null;
  await audit(req, 'ETICHETTE_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: `Impostazioni di Label: ${Object.keys(b).join(', ')}`, data: { giorni_identita: b.giorni_identita, etichetta_richiesta: b.etichetta_richiesta, modelli_sede: b.modelli_sede?.length } });
  res.json({ ok: true, purgate });
}));

// ---------------------------------------------------------------- identità recenti
r.get('/identita', ah(async (_req, res) => res.json({ job: await statoJob(), data_api: await dataApiAttiva() })));
r.post('/identita/esegui', ah(async (req, res) => {
  const out = await giroIdentita({ forza: true });
  await audit(req, 'ETICHETTE_IDENTITA', { module: KEY, entity: 'job', label: 'Aggiornamento delle identità recenti eseguito a mano', data: out });
  res.json(out);
}));

// ---------------------------------------------------------------- registro delle stampe (nessun dato del paziente)
r.get('/registro', ah(async (req, res) => {
  const p = parse(z.object({ da: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), site_id: z.coerce.number().int().positive().optional(),
    esito: z.enum(['OK', 'ERRORE']).optional(), q: z.string().max(60).optional(), pagina: z.coerce.number().int().min(1).max(1000).default(1) }), req.query);
  const w = [];
  const v = [];
  if (p.da) { v.push(p.da); w.push(`(s.at AT TIME ZONE 'Europe/Rome')::date >= $${v.length}`); }
  if (p.a) { v.push(p.a); w.push(`(s.at AT TIME ZONE 'Europe/Rome')::date <= $${v.length}`); }
  if (p.site_id) { v.push(p.site_id); w.push(`s.site_id = $${v.length}`); }
  if (p.esito) { v.push(p.esito); w.push(`s.esito = $${v.length}`); }
  if (p.q) { v.push(`%${p.q}%`); w.push(`(s.request_number ILIKE $${v.length} OR s.stampante ILIKE $${v.length})`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const tot = await one(`SELECT count(*)::int AS n, coalesce(sum(n_etichette * copie) FILTER (WHERE esito = 'OK'), 0)::int AS etichette FROM stampe s ${where}`, v);
  v.push((p.pagina - 1) * 100);
  const righe = await many(`SELECT s.id, s.at, s.request_number, s.n_etichette, s.copie, s.stampante, s.metodo, s.esito, s.errore, s.ristampa, s.site_id,
      st.code AS sede_code, st.name AS sede_name, u.full_name AS utente, m.nome AS modello
      FROM stampe s LEFT JOIN public.sites st ON st.id = s.site_id LEFT JOIN public.users u ON u.id = s.user_id LEFT JOIN modelli m ON m.id = s.modello_id
      ${where} ORDER BY s.at DESC, s.id DESC LIMIT 100 OFFSET $${v.length}`, v);
  res.json({ totale: tot.n, etichette: tot.etichette, pagina: p.pagina, righe });
}));

export default r;
