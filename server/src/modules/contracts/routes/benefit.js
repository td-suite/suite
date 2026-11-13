// Sezione "Benefit: vettura e fuel card" della scheda della persona (v0.72.0, richiesta del CEO del 13/11/2026). Solo P&C (profili ADMIN e
// HR del modulo) e il titolare: VIEWER non la vede (403). Ogni lettura è registrata nel read_log della Suite, ogni scrittura nell'audit del
// modulo e della Suite. Il PIN della carta non si salva mai: un campo "pin" nella richiesta è rifiutato. Nessun dato reale nel seme.
import { Router } from 'express';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { ah, bad, notFound, forbidden, parse, audit } from '../lib/util.js';
import { readLog } from '../lib/access.js';
import { audit as suiteAudit, today } from '../../../lib/util.js';
import { assegnazioniPersona, allineaBenefit, numeroPulito, mascheraNumero, numeroLeggibile, attivaIl } from '../lib/benefitAuto.js';

const r = Router();
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const opt = (s) => z.preprocess((v) => (v === '' ? null : v), s.optional().nullable());
// P&C = profili ADMIN e HR del modulo; il titolare della Suite sempre
export const vedeBenefit = (u) => u?.suite_level === 'OWNER' || ['ADMIN', 'HR'].includes(u?.role);
const soloPc = (req, _res, next) => (vedeBenefit(req.user) ? next() : next(forbidden('Sezione riservata a P&C (profili Amministratore e Risorse umane) e al titolare')));
const senzaPin = (req, _res, next) => (req.body && Object.keys(req.body).some((k) => /pin/i.test(k)) ? next(bad('Il PIN della carta non si registra nella Suite')) : next());
const suiteReq = (req) => ({ user: req.suiteUser || req.user, ip: req.ip });

const vetturaSchema = z.object({
  marca: z.string().trim().min(1).max(60), modello: z.string().trim().min(1).max(80),
  targa: z.string().trim().min(4).max(12).transform((v) => v.toUpperCase().replace(/\s+/g, '')),
  alimentazione: opt(z.string().trim().max(40)), dal: z.string().regex(dateRe, 'data non valida'), al: opt(z.string().regex(dateRe, 'data non valida')),
  uso_promiscuo: z.boolean().default(false), note: opt(z.string().trim().max(1000)),
}).strict();
const fuelSchema = z.object({
  circuito: z.string().trim().min(2).max(40), numero: z.string().trim().max(40).transform(numeroPulito).refine((v) => /^\d{8,24}$/.test(v), 'numero della carta: da 8 a 24 cifre'),
  dal: z.string().regex(dateRe, 'data non valida'), al: opt(z.string().regex(dateRe, 'data non valida')), vettura_id: opt(z.coerce.number().int()), note: opt(z.string().trim().max(1000)),
}).strict();

const persona = async (id) => {
  const p = await one('SELECT id, last_name, first_name, kind, status FROM public.people WHERE id=$1', [id]);
  if (!p) throw notFound('Persona inesistente');
  return p;
};
const vista = (a) => ({
  ...a,
  vetture: a.vetture.map((v) => ({ ...v, in_corso: attivaIl(v, today()) })),
  fuel_card: a.fuel_card.map((f) => ({ ...f, numero: numeroLeggibile(f.numero), numero_mascherato: mascheraNumero(f.numero), in_corso: attivaIl(f, today()) })),
});

r.get('/persona/:id', soloPc, ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  await readLog(req, 'benefit_auto', p.id);
  const a = await assegnazioniPersona(p.id);
  const emp = await one('SELECT benefits FROM employments WHERE resource_id=$1', [p.id]);
  res.json({ persona: p, ...vista(a), benefits_contratto: emp?.benefits || null });
}));

const scrivi = (tabella, schema, tipo) => ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const b = parse(schema, req.body || {});
  if (b.al && b.al < b.dal) throw bad('La data di fine precede quella di inizio');
  if (tabella === 'benefit_fuel_card' && b.vettura_id) {
    const v = await one('SELECT id FROM benefit_vetture WHERE id=$1 AND person_id=$2', [b.vettura_id, p.id]);
    if (!v) throw bad('La vettura collegata non è assegnata a questa persona');
  }
  const id = req.params.bid ? Number(req.params.bid) : null;
  const out = await tx(async (c) => {
    let row;
    const cols = Object.keys(b);
    if (id) {
      const ex = (await c.query(`SELECT id FROM ${tabella} WHERE id=$1 AND person_id=$2`, [id, p.id])).rows[0];
      if (!ex) throw notFound('Assegnazione inesistente');
      row = (await c.query(`UPDATE ${tabella} SET ${cols.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_by=$2, updated_at=now() WHERE id=$1 RETURNING id`,
        [id, req.suiteUser?.id || null, ...cols.map((k) => b[k] ?? null)])).rows[0];
    } else {
      row = (await c.query(`INSERT INTO ${tabella} (person_id, ${cols.join(', ')}, created_by, updated_by) VALUES ($1, ${cols.map((_, i) => `$${i + 3}`).join(', ')}, $2, $2) RETURNING id`,
        [p.id, req.suiteUser?.id || null, ...cols.map((k) => b[k] ?? null)])).rows[0];
    }
    await allineaBenefit(p.id, today(), c.query.bind(c));
    return row;
  }).catch((e) => { if (e.code === '23505') throw bad('Questa carta è già registrata'); throw e; });
  const dati = tipo === 'FUEL' ? { circuito: b.circuito, numero: mascheraNumero(b.numero), dal: b.dal, al: b.al || null } : { marca: b.marca, modello: b.modello, targa: b.targa, dal: b.dal, al: b.al || null };
  await audit(req, id ? `BENEFIT_${tipo}_MODIFICATO` : `BENEFIT_${tipo}_ASSEGNATO`, 'person', p.id, dati);
  await suiteAudit(suiteReq(req), id ? `CONTRACTS_BENEFIT_${tipo}_MODIFICATO` : `CONTRACTS_BENEFIT_${tipo}_ASSEGNATO`, { module: 'contracts', entity: 'person', entityId: p.id, label: `${p.last_name} ${p.first_name}`, data: dati });
  res.status(id ? 200 : 201).json({ id: out.id, ...vista(await assegnazioniPersona(p.id)) });
});

const elimina = (tabella, tipo) => ah(async (req, res) => {
  const p = await persona(Number(req.params.id));
  const id = Number(req.params.bid);
  await tx(async (c) => {
    const del = await c.query(`DELETE FROM ${tabella} WHERE id=$1 AND person_id=$2`, [id, p.id]);
    if (!del.rowCount) throw notFound('Assegnazione inesistente');
    await allineaBenefit(p.id, today(), c.query.bind(c));
  });
  await audit(req, `BENEFIT_${tipo}_ELIMINATO`, 'person', p.id, { id });
  await suiteAudit(suiteReq(req), `CONTRACTS_BENEFIT_${tipo}_ELIMINATO`, { module: 'contracts', entity: 'person', entityId: p.id, label: `${p.last_name} ${p.first_name}`, data: { id } });
  res.json(vista(await assegnazioniPersona(p.id)));
});

r.post('/persona/:id/vetture', soloPc, senzaPin, scrivi('benefit_vetture', vetturaSchema, 'VETTURA'));
r.put('/persona/:id/vetture/:bid', soloPc, senzaPin, scrivi('benefit_vetture', vetturaSchema, 'VETTURA'));
r.delete('/persona/:id/vetture/:bid', soloPc, elimina('benefit_vetture', 'VETTURA'));
r.post('/persona/:id/fuel-card', soloPc, senzaPin, scrivi('benefit_fuel_card', fuelSchema, 'FUEL'));
r.put('/persona/:id/fuel-card/:bid', soloPc, senzaPin, scrivi('benefit_fuel_card', fuelSchema, 'FUEL'));
r.delete('/persona/:id/fuel-card/:bid', soloPc, elimina('benefit_fuel_card', 'FUEL'));

export default r;
