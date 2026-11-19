// "Vedi come profilo" (v0.90.0, richiesta del CEO del 19/11/2026): il titolare della Suite (livello OWNER) guarda un widget come lo vede
// uno dei suoi profili, per formare il personale e documentare la guida. Regole:
// - solo OWNER; chiunque altro mandi l'intestazione viene ignorato;
// - solo dentro il widget indicato (/api/<chiave>/...), solo con un profilo previsto dal catalogo dei moduli;
// - SOLA LETTURA: ogni richiesta che non sia GET/HEAD/OPTIONS è rifiutata (403 VEDI_COME), quindi dalla vista non si modifica nulla;
// - per la richiesta l'utente diventa un utente ordinario (livello USER) con il solo grant del widget: profilo scelto e, se indicata, la
//   sede scelta come ambito. I controlli di ogni modulo lavorano come per un utente vero con quel profilo;
// - l'attivazione è scritta nel registro (VEDI_COME_ATTIVATA) da POST /api/vedi-come.
// Limite dichiarato: i dati legati alla persona (le proprie ferie, i propri rimborsi, il portale del professionista) restano quelli del
// titolare; alcune letture hanno effetti propri (registro delle letture, creazione dell'auto-audit del mese).
import { Router } from 'express';
import { z } from 'zod';
import { MODULES } from '../seed/modules.js';
import { ah, audit, parse, bad, forbidden, HttpError } from './util.js';

export const HEADER = 'X-Vedi-Come';
const catalogo = (key) => MODULES.find((m) => m.key === key);

// chiave:PROFILO[:idSede]
export function leggiVista(valore) {
  const m = /^([a-z]+):([A-Z_]+)(?::(\d+))?$/.exec(String(valore || '').trim());
  if (!m) return null;
  const mod = catalogo(m[1]);
  const prof = mod?.profiles?.find((p) => p.key === m[2]);
  if (!prof) return null;
  return { key: m[1], profile: m[2], label: prof.label, site_id: m[3] ? Number(m[3]) : null };
}

export function vediCome(req, _res, next) {
  const raw = req.get(HEADER);
  if (!raw || req.user?.level !== 'OWNER') return next();
  const v = leggiVista(raw);
  if (!v) return next();
  if (!(req.path === `/${v.key}` || req.path.startsWith(`/${v.key}/`))) return next();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next(Object.assign(new HttpError(403, `Stai guardando il widget come profilo «${v.label}»: la vista è in sola lettura. Torna al tuo profilo per modificare.`), { code: 'VEDI_COME' }));
  }
  const scopes = v.site_id ? [{ type: 'SITE', id: v.site_id }] : [];
  req.realUser = req.user;
  req.user = { ...req.user, level: 'USER', grants: { [v.key]: { profile: v.profile, scopes, area: null, kind: 'VEDI_COME' } },
    site_ids: v.site_id ? [v.site_id] : [], vedi_come: v };
  next();
}

const r = Router();
// Profili di un widget per il selettore (solo titolare)
r.get('/vedi-come/:key', ah(async (req, res) => {
  if (req.user.level !== 'OWNER') throw forbidden('Funzione riservata al titolare della Suite');
  const mod = catalogo(req.params.key);
  if (!mod) throw bad('Widget inesistente');
  res.json({ key: mod.key, nome: mod.name, per_sede: mod.scope_type === 'SITE', profili: (mod.profiles || []).map((p) => ({ key: p.key, label: p.label, scoped: Boolean(p.scoped) })) });
}));
// Attivazione della vista: solo la traccia nel registro (la vista vive nel browser e si chiude uscendo dal widget)
r.post('/vedi-come', ah(async (req, res) => {
  if (req.user.level !== 'OWNER') throw forbidden('Funzione riservata al titolare della Suite');
  const b = parse(z.object({ key: z.string().max(40), profile: z.string().max(40), site_id: z.coerce.number().int().positive().nullish() }), req.body);
  const v = leggiVista(`${b.key}:${b.profile}${b.site_id ? `:${b.site_id}` : ''}`);
  if (!v) throw bad('Profilo non previsto per questo widget');
  await audit(req, 'VEDI_COME_ATTIVATA', { module: v.key, entity: 'profile', entityId: v.profile, label: v.label, data: { site_id: v.site_id } });
  res.json({ ok: true, vista: v });
}));
export default r;
