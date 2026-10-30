// Sedi e partner: elenco delle sedi con il quadro del mese (ultimo auto-audit, stato, ultimo interno, ultimo terze parti, punteggio e
// livello della sintesi), scheda della sede (cronologia e sintesi corrente), partner ISO 37001 (Legal entity non interne) e scheda
// partner, ricerca delle organizzazioni per il nuovo audit, cruscotto.
import { Router } from 'express';
import { one, many } from '../db.js';
import { STRUCTURE_KINDS, INTERNAL_ORG_KINDS } from '../config.js';
import { ah, forbidden } from '../../../lib/util.js';
import { isAuditor, isQualita, isSite, mySiteIds, canSeeSite, limitedToSites } from '../lib/access.js';
import { A_COLS, A_FROM, decorate, SITE_COLS, siteById, orgById, isStructure, inEsercizio } from '../lib/core.js';
import { ultimaSintesi } from '../lib/synth.js';
import { monthStart, levelLabel, levelLetter } from '../lib/scoring.js';

const r = Router();

const lastOf = (rows, pred) => rows.find(pred) || null;

// Elenco sedi con il quadro per ciascuna
r.get('/sites', ah(async (req, res) => {
  const period = monthStart(new Date());
  const params = [];
  let w = 's.active';
  if (limitedToSites(req)) { params.push(mySiteIds(req)); w += ` AND s.id = ANY($${params.length}::int[])`; }
  const sites = await many(`SELECT ${SITE_COLS}, g.score AS sgi_score, g.level AS sgi_level, g.summary AS sgi_summary, g.computed_at AS sgi_at, g.last_audit_at
    FROM sites_v s LEFT JOIN public.site_sgi_scores g ON g.site_id=s.id WHERE ${w} ORDER BY s.sort_order, s.name`, params);
  const ids = sites.map((s) => s.id);
  const audits = (await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE a.deleted_at IS NULL AND a.site_id = ANY($1::int[]) ORDER BY coalesce(a.conducted_at, a.created_at) DESC, a.id DESC`, [ids])).map(decorate);
  const out = sites.map((s) => {
    const mine = audits.filter((a) => a.site_id === s.id);
    const auto = lastOf(mine, (a) => a.kind === 'AUTO');
    const corrente = lastOf(mine, (a) => a.kind === 'AUTO' && String(a.period).slice(0, 10) === period);
    const slim = (a) => (a ? { id: a.id, status: a.status, status_label: a.status_label, period: a.period, conducted_at: a.conducted_at, score: a.score, score_verifier: a.score_verifier, effective_score: a.effective_score, level: a.level, n_nc: a.n_nc, third_party: a.third_party } : null);
    return { ...s, structure: isStructure(s), sgi_level_label: levelLabel(s.sgi_level), n_audits: mine.length,
      in_esercizio: inEsercizio(s, period), auto_corrente: slim(corrente), stato_mese: corrente ? corrente.status : (isStructure(s) ? (inEsercizio(s, period) ? 'MANCANTE' : 'NON_APERTA') : null), ultimo_auto: slim(auto),
      ultimo_interno: slim(lastOf(mine, (a) => a.kind === 'INTERNO')), ultimo_terzi: slim(lastOf(mine, (a) => a.kind === 'TERZI')),
      inviati_da_verificare: mine.filter((a) => a.kind === 'AUTO' && a.status === 'INVIATO').length };
  });
  res.json({ period, rows: out, can_conduct: isAuditor(req), can_synth: isAuditor(req) });
}));

// Scheda sede: cronologia e sintesi corrente
r.get('/sites/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!canSeeSite(req, id)) throw forbidden('Sede non assegnata');
  const site = await siteById(id);
  const sgi = await one('SELECT * FROM public.site_sgi_scores WHERE site_id=$1', [id]);
  const audits = (await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE a.deleted_at IS NULL AND a.site_id=$1 ORDER BY coalesce(a.conducted_at, a.created_at) DESC, a.id DESC LIMIT 200`, [id])).map(decorate);
  const sintesi = await ultimaSintesi('SEDE', { site_id: id });
  // andamento degli auto-audit (ultimi 12 mesi) per il grafico
  const trend = audits.filter((a) => a.kind === 'AUTO' && a.effective_score != null).slice(0, 12).reverse().map((a) => ({ period: a.period, score: a.score, score_verifier: a.score_verifier, effective_score: a.effective_score }));
  res.json({ site: { ...site, structure: isStructure(site) }, sgi, audits, sintesi, trend, can_conduct: isAuditor(req), can_synth: isAuditor(req), can_regen: isAuditor(req) });
}));

// Partner ISO 37001: Legal entity non interne con almeno un audit (o tutte con ricerca)
r.get('/partners', ah(async (req, res) => {
  if (limitedToSites(req)) throw forbidden('Gli audit sui partner non riguardano le sedi');
  const qs = String(req.query.q || '').trim();
  const params = [INTERNAL_ORG_KINDS];
  let w = `NOT (o.kind = ANY($1)) AND o.active`;
  if (qs) { params.push(`%${qs}%`); w += ` AND (o.name ILIKE $${params.length} OR o.vat_number ILIKE $${params.length} OR o.city ILIKE $${params.length})`; }
  else w += ` AND EXISTS (SELECT 1 FROM audits a WHERE a.organization_id=o.id AND a.kind='LEGAL_ENTITY' AND a.deleted_at IS NULL)`;
  const orgs = await many(`SELECT o.id, o.kind, o.code, o.name, o.vat_number, o.city, o.province,
      (SELECT count(*)::int FROM audits a WHERE a.organization_id=o.id AND a.kind='LEGAL_ENTITY' AND a.deleted_at IS NULL) AS n_audits,
      (SELECT row_to_json(x) FROM (SELECT a.id, a.status, a.conducted_at, a.score, a.report, a.header FROM audits a WHERE a.organization_id=o.id AND a.kind='LEGAL_ENTITY' AND a.deleted_at IS NULL ORDER BY coalesce(a.conducted_at, a.created_at) DESC LIMIT 1) x) AS ultimo,
      (SELECT row_to_json(y) FROM (SELECT sy.id, sy.score, sy.level, sy.generated_at, sy.result->>'rischio_residuo' AS rischio_residuo FROM syntheses sy WHERE sy.scope='LEGAL_ENTITY' AND sy.organization_id=o.id ORDER BY sy.generated_at DESC LIMIT 1) y) AS sintesi
    FROM public.organizations o WHERE ${w} ORDER BY o.name LIMIT 300`, params);
  const complessiva = await ultimaSintesi('LEGAL_ENTITIES');
  res.json({ rows: orgs.map((o) => ({ ...o, ultimo: o.ultimo ? { ...o.ultimo, level: levelLetter(o.ultimo.score) } : null })), complessiva, can_conduct: isAuditor(req) });
}));

// Ricerca Legal entity per il nuovo audit partner (tutte quelle non interne)
r.get('/organizations', ah(async (req, res) => {
  if (limitedToSites(req)) throw forbidden();
  const qs = String(req.query.q || '').trim();
  const params = [INTERNAL_ORG_KINDS];
  let w = `NOT (o.kind = ANY($1)) AND o.active`;
  if (qs) { params.push(`%${qs}%`); w += ` AND (o.name ILIKE $${params.length} OR o.vat_number ILIKE $${params.length})`; }
  res.json(await many(`SELECT o.id, o.kind, o.name, o.vat_number, o.city FROM public.organizations o WHERE ${w} ORDER BY o.name LIMIT 50`, params));
}));

r.get('/partners/:orgId', ah(async (req, res) => {
  if (limitedToSites(req)) throw forbidden();
  const id = Number(req.params.orgId);
  const org = await orgById(id);
  const audits = (await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE a.deleted_at IS NULL AND a.organization_id=$1 AND a.kind='LEGAL_ENTITY' ORDER BY coalesce(a.conducted_at, a.created_at) DESC, a.id DESC`, [id])).map(decorate);
  const sintesi = await ultimaSintesi('LEGAL_ENTITY', { organization_id: id });
  res.json({ org, audits, sintesi, can_conduct: isAuditor(req) });
}));

// Cruscotto
r.get('/dashboard', ah(async (req, res) => {
  const period = monthStart(new Date());
  const limited = limitedToSites(req);
  const mine = mySiteIds(req);
  const siteW = limited ? 'AND s.id = ANY($2::int[])' : '';
  const params = limited ? [STRUCTURE_KINDS, mine] : [STRUCTURE_KINDS];
  const strutture = await many(`SELECT s.id, s.name, s.kind, s.code FROM sites_v s WHERE s.active AND s.kind = ANY($1) ${siteW} ORDER BY s.name`, params);
  const autoMese = await many(`SELECT site_id, id, status, score, score_verifier FROM audits WHERE kind='AUTO' AND period=$1 AND deleted_at IS NULL`, [period]);
  const mancanti = strutture.filter((s) => !autoMese.some((a) => a.site_id === s.id && a.status !== 'BOZZA'));
  const aw = limited ? 'AND a.site_id = ANY($1::int[])' : '';
  const ap = limited ? [mine] : [];
  const daVerificare = await many(`SELECT a.id, a.site_id, s.name AS site_name, a.period, a.score, a.conducted_at FROM audits a JOIN public.sites s ON s.id=a.site_id WHERE a.kind='AUTO' AND a.status='INVIATO' AND a.deleted_at IS NULL ${aw} ORDER BY a.conducted_at`, ap);
  const tot = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE a.kind='AUTO')::int AS auto, count(*) FILTER (WHERE a.kind='INTERNO')::int AS interni, count(*) FILTER (WHERE a.kind='TERZI')::int AS terzi, count(*) FILTER (WHERE a.kind='LEGAL_ENTITY')::int AS partner,
    count(*) FILTER (WHERE coalesce(a.conducted_at, a.created_at) >= now() - interval '12 months')::int AS ultimi12 FROM audits a WHERE a.deleted_at IS NULL ${aw}`, ap);
  const livelli = await many(`SELECT g.level, count(*)::int AS n FROM public.site_sgi_scores g JOIN sites_v s ON s.id=g.site_id WHERE s.active ${limited ? 'AND s.id = ANY($1::int[])' : ''} GROUP BY g.level ORDER BY g.level`, ap);
  const ncAperte = await one(`SELECT coalesce(sum(jsonb_array_length(a.ncs)),0)::int AS n FROM audits a WHERE a.deleted_at IS NULL AND coalesce(a.conducted_at, a.created_at) >= now() - interval '3 months' ${aw}`, ap);
  const recenti = (await many(`SELECT ${A_COLS} FROM ${A_FROM} WHERE a.deleted_at IS NULL ${limited ? 'AND a.kind <> \'LEGAL_ENTITY\' AND a.site_id = ANY($1::int[])' : ''} ORDER BY a.updated_at DESC LIMIT 8`, ap)).map(decorate);
  const td = limited ? null : await ultimaSintesi('TD');
  const classifica = await many(`SELECT s.id, s.name, s.kind, g.score, g.level, g.computed_at FROM public.site_sgi_scores g JOIN sites_v s ON s.id=g.site_id WHERE s.active ${limited ? 'AND s.id = ANY($1::int[])' : ''} ORDER BY g.score DESC NULLS LAST LIMIT 20`, ap);
  res.json({ period, strutture: strutture.length, mancanti: mancanti.map((s) => ({ id: s.id, name: s.name, audit_id: autoMese.find((a) => a.site_id === s.id)?.id || null, status: autoMese.find((a) => a.site_id === s.id)?.status || 'MANCANTE' })),
    da_verificare: daVerificare, totali: tot, livelli, nc_3m: ncAperte.n, recenti, sintesi_td: td ? { id: td.id, score: td.score, level: td.level, generated_at: td.generated_at, giudizio: td.result?.giudizio } : null, classifica,
    ruolo: { auditor: isAuditor(req), qualita: isQualita(req), site: isSite(req) } });
}));

export default r;
