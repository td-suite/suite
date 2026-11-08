// Scadenzario unico di direzione nel Cockpit (decisione del CEO, 08/11/2026). Accesso: titolare, amministratori e chi ha il modulo
// Cockpit (grant cockpit). Le righe dei moduli con dati personali (Contratti del personale, Piano Ferie, professionisti di Room) solo a chi
// ha anche il grant di quel modulo. Logica e fonti in lib/scadenzario.js; elenco dei campi letti in docs/COCKPIT.md.
import { Router } from 'express';
import { z } from 'zod';
import { many, q } from '../db.js';
import { ah, audit, parse, forbidden, bad, setSetting } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import {
  scadenzeDirezione, visibiliA, applicaViste, visteUtente, filtra, riepilogo, puoVedere, oggiRoma, addGiorni, iso, vistaPredefinita,
  impostazioniScadenzario, IMPOSTAZIONI_DEFAULT, svuotaCacheScadenzario, eseguiNotificaScadenzario, AREE, STATI,
} from '../lib/scadenzario.js';
import { scadenzarioXlsx, scadenzarioPdf } from '../lib/scadenzarioExport.js';
import { invalidateCaches } from '../lib/legacy.js';

const r = Router();
const solo = (req, _res, next) => (puoVedere(req.user) ? next() : next(forbidden('Lo scadenzario di direzione è riservato alla direzione (Cockpit)')));

const filtriSchema = z.object({
  da: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  area: z.string().max(200).optional(), modulo: z.string().max(300).optional(), q: z.string().max(200).optional(),
  stati: z.string().max(100).optional(), viste: z.enum(['0', '1']).optional(), fresco: z.enum(['0', '1']).optional(),
});

// Righe per l'utente con i filtri della pagina. `viste=1` include anche le righe segnate viste (con vista_fino_a).
async function carica(req) {
  const f = parse(filtriSchema, req.query);
  const oggi = oggiRoma();
  const d = await scadenzeDirezione({ da: f.da, a: f.a, oggi, fresco: f.fresco === '1' }).catch((e) => { throw e.status === 400 ? bad(e.message) : e; });
  const mie = applicaViste(visibiliA(d.righe, req.user), await visteUtente(req.user.id, oggi), oggi);
  // il riepilogo (scadute, oggi, entro 7, entro 30) segue area, modulo e ricerca ma non il filtro per stato, che si sceglie proprio dal riepilogo
  const senzaStati = filtra(mie, { area: f.area, modulo: f.modulo, q: f.q }).filter((x) => !x.vista_fino_a);
  const filtrate = filtra(mie, { area: f.area, modulo: f.modulo, q: f.q, stati: f.stati });
  const attive = filtrate.filter((x) => !x.vista_fino_a);
  const nascoste = filtrate.length - attive.length;
  // fonti: quelle dei moduli riservati solo a chi le può vedere (altrimenti "riservata")
  const admin = req.user.level === 'OWNER' || req.user.level === 'ADMIN';
  const fonti = d.fonti.map((x) => (['contracts', 'ferie', 'room'].includes(x.modulo) && !admin && !req.user.grants?.[x.modulo] ? { ...x, stato: 'RISERVATA', nota: 'Riservata a chi ha il modulo', righe: 0 } : x));
  const moduli = [...new Map(mie.map((x) => [x.modulo, { key: x.modulo, nome: x.modulo_nome.split(' · ')[0], area: x.area }])).values()].sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
  return { f: { ...f, da: d.da, a: d.a }, d, righe: f.viste === '1' ? filtrate : attive, attive, senzaStati, nascoste, fonti, moduli };
}

r.get('/cockpit/scadenzario', solo, ah(async (req, res) => {
  const x = await carica(req);
  const imp = await impostazioniScadenzario();
  res.json({ da: x.d.da, a: x.d.a, oggi: x.d.oggi, generated_at: x.d.generated_at, riepilogo: riepilogo(x.senzaStati), nascoste: x.nascoste, righe: x.righe,
    fonti: x.fonti, scartate: x.d.scartate, moduli: x.moduli, aree: Object.entries(AREE).map(([key, nome]) => ({ key, nome })), stati: STATI,
    soglie: { proposte_giorni: imp.proposte_giorni, ordini_giorni: imp.ordini_giorni, circolari_giorni: imp.circolari_giorni } });
}));

const esporta = (tipo) => ah(async (req, res) => {
  const x = await carica(req);
  const args = { righe: x.attive, filtri: x.f, fonti: x.fonti, generato: x.d.generated_at };
  const buf = tipo === 'xlsx' ? await scadenzarioXlsx(args) : await scadenzarioPdf(args);
  await audit(req, 'COCKPIT_SCADENZARIO_EXPORT', { module: 'cockpit', entity: 'scadenzario', label: `Scadenzario di direzione ${tipo.toUpperCase()}`, data: { da: x.f.da, a: x.f.a, area: x.f.area || null, modulo: x.f.modulo || null, q: x.f.q || null, righe: x.attive.length } });
  const nome = `scadenzario-direzione-${x.f.da}_${x.f.a}.${tipo}`;
  res.setHeader('Content-Type', tipo === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(buf);
});
r.get('/cockpit/scadenzario/export.xlsx', solo, esporta('xlsx'));
r.get('/cockpit/scadenzario/export.pdf', solo, esporta('pdf'));

// "Segna come vista": nasconde la riga all'utente fino a una data compresa (predefinita: la data della scadenza se futura, altrimenti
// tra 7 giorni). Massimo un anno avanti; ripetere sostituisce la data.
r.post('/cockpit/scadenzario/viste', solo, ah(async (req, res) => {
  const b = parse(z.object({ chiave: z.string().min(3).max(300), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), fino_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  const oggi = oggiRoma();
  const fino = iso(b.fino_a) || vistaPredefinita(iso(b.data), oggi);
  if (!fino || fino < oggi) throw bad('La data fino a cui nascondere la scadenza non può essere passata');
  if (fino > addGiorni(oggi, 366)) throw bad('Si può nascondere una scadenza al massimo per un anno');
  await q(`INSERT INTO cockpit_scadenze_viste (user_id, chiave, fino_a) VALUES ($1,$2,$3) ON CONFLICT (user_id, chiave) DO UPDATE SET fino_a = EXCLUDED.fino_a, created_at = now()`, [req.user.id, b.chiave, fino]);
  await audit(req, 'COCKPIT_SCADENZA_VISTA', { module: 'cockpit', entity: 'scadenza', entityId: b.chiave, data: { fino_a: fino } });
  invalidateCaches();
  res.json({ ok: true, chiave: b.chiave, fino_a: fino });
}));
r.delete('/cockpit/scadenzario/viste', solo, ah(async (req, res) => {
  const chiave = String(req.query.chiave || '');
  if (chiave.length < 3) throw bad('Chiave mancante');
  const out = await q('DELETE FROM cockpit_scadenze_viste WHERE user_id = $1 AND chiave = $2', [req.user.id, chiave]);
  if (out.rowCount) await audit(req, 'COCKPIT_SCADENZA_RIPRISTINATA', { module: 'cockpit', entity: 'scadenza', entityId: chiave });
  invalidateCaches();
  res.json({ ok: true, rimosse: out.rowCount });
}));

// Impostazioni (Amministrazione > Impostazioni > Scadenzario di direzione): notifica giornaliera e soglie dichiarate
const impSchema = z.object({
  notifica_attiva: z.boolean(), notifica_ora: z.number().int().min(0).max(23),
  proposte_giorni: z.number().int().min(1).max(365), ordini_giorni: z.number().int().min(1).max(60), circolari_giorni: z.number().int().min(1).max(120),
});
r.get('/cockpit/scadenzario/impostazioni', requireAdmin, ah(async (_req, res) => {
  const ultimi = await many('SELECT giorno, utenti, righe, at FROM cockpit_scadenzario_invii ORDER BY giorno DESC LIMIT 5').catch(() => []);
  res.json({ valori: await impostazioniScadenzario(), predefiniti: IMPOSTAZIONI_DEFAULT, ultimi_invii: ultimi });
}));
r.put('/cockpit/scadenzario/impostazioni', requireAdmin, ah(async (req, res) => {
  const b = parse(impSchema, req.body);
  await setSetting('cockpit.scadenzario', b, req.user.id);
  await audit(req, 'SETTING_UPDATED', { entity: 'setting', entityId: 'cockpit.scadenzario', data: b });
  svuotaCacheScadenzario(); invalidateCaches();
  res.json({ ok: true, valori: b });
}));
// "Invia ora" (amministratori): esegue la notifica del giorno anche prima dell'ora impostata e anche se già inviata (prova)
r.post('/cockpit/scadenzario/notifica', requireAdmin, ah(async (req, res) => {
  const out = await eseguiNotificaScadenzario({ forza: true });
  await audit(req, 'COCKPIT_SCADENZARIO_NOTIFICA', { module: 'cockpit', data: out });
  res.json(out);
}));

export default r;
