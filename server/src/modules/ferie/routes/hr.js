// Cruscotto HR e saldi: richieste da approvare, residui a rischio, residui dell'anno precedente da smaltire, saldo per persona,
// inserimento del residuo dell'anno precedente a mano o da XLSX (modello precompilato con il perimetro). HR = profilo ADMIN;
// VIEWER consulta; i responsabili vedono i saldi delle persone che approvano.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { q, one, many } from '../db.js';
import { ah, parse, audit, forbidden, bad, normName } from '../../../lib/util.js';
import { KEY, userContext, saldoPersona, oggi, R_COLS, R_FROM } from '../lib/core.js';
import { nomeGruppo, invalidaPerimetro } from '../lib/perimetro.js';
import { config } from '../config.js';
import { annoQ } from './richieste.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxXlsxBytes, files: 1 } });
const hr = async (req) => { const ctx = await userContext(req); if (!ctx.isAdmin) throw forbidden('Operazione riservata a HR (amministratore del modulo)'); return ctx; };

/** Saldi di un insieme di persone del perimetro (in sequenza: il perimetro è piccolo, poche decine di persone) */
async function saldiDi(ctx, persone, anno) {
  const out = [];
  for (const p of persone) {
    const s = await saldoPersona(p, anno, ctx.settings);
    out.push({ person_id: p.id, persona: p.nome, ruolo: p.role_name, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti), approvatore: p.approvatore_nome || null, contratto: p.contratto, ...s });
  }
  return out;
}

// Persone del perimetro (HR, consultazione e responsabili per le persone che approvano): area, origine dell'area, approvatore
r.get('/persone', ah(async (req, res) => {
  const ctx = await userContext(req);
  const rows = [...ctx.perim.persone.values()].filter((p) => ctx.vedeSaldo(p.id)).map((p) => ({
    id: p.id, nome: p.nome, ruolo: p.role_name, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti), area_origine: p.area_origine,
    approvatore: p.approvatore_nome || null, approvatore_origine: p.approvatore_origine || null, contratto: p.contratto, inizio: p.inizio, fine: p.fine, ha_accesso: Boolean(p.user_id),
  }));
  res.json({ rows, contratti: ctx.perim.contratti });
}));

r.get('/saldi', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.tutto && !ctx.isApprovatore) throw forbidden('I saldi delle altre persone li vedono HR e i responsabili');
  const anno = annoQ(req.query.anno);
  const persone = [...ctx.perim.persone.values()].filter((p) => ctx.vedeSaldo(p.id) && p.id !== (ctx.tutto ? -1 : ctx.personId) && (!req.query.gruppo || p.gruppo === req.query.gruppo));
  res.json({ anno, rows: await saldiDi(ctx, persone, anno) });
}));

r.get('/cruscotto', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.tutto && !ctx.isApprovatore) throw forbidden('Cruscotto riservato a HR e ai responsabili');
  const anno = annoQ(req.query.anno);
  const persone = [...ctx.perim.persone.values()].filter((p) => ctx.vedeSaldo(p.id) && (ctx.tutto || p.id !== ctx.personId));
  const saldi = await saldiDi(ctx, persone, anno);
  const ids = persone.map((p) => p.id);
  const daApprovare = ids.length ? await many(`SELECT ${R_COLS} FROM ${R_FROM} WHERE r.stato='RICHIESTA' AND r.person_id = ANY($1::int[]) ORDER BY r.created_at LIMIT 50`, [ids]) : [];
  const g = oggi();
  const assentiOggi = ids.length ? (await one(`SELECT count(DISTINCT person_id)::int AS n FROM richieste WHERE person_id = ANY($1::int[]) AND stato IN ('APPROVATA','GODUTA') AND tipo='FERIE' AND $2::date BETWEEN data_inizio AND data_fine`, [ids, g])).n : 0;
  const perArea = new Map();
  for (const s of saldi) {
    const k = s.gruppo;
    if (!perArea.has(k)) perArea.set(k, { gruppo: k, nome: s.gruppo_nome, persone: 0, residuo: 0, goduto: 0, pianificato: 0, in_attesa: 0 });
    const a = perArea.get(k); a.persone++; a.residuo += s.residuo; a.goduto += s.goduto; a.pianificato += s.pianificato; a.in_attesa += s.in_attesa;
  }
  res.json({
    anno, oggi: g, persone: persone.length, assenti_oggi: assentiOggi,
    da_approvare: daApprovare.map((x) => ({ ...x, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti), giorni_attesa: Math.floor((Date.now() - new Date(x.created_at).getTime()) / 86400000), puo_decidere: ctx.puoDecidere(x.person_id) })),
    a_rischio: saldi.filter((s) => s.avvisi.some((a) => a.tipo === 'RISCHIO')).sort((a, b) => b.disponibile - a.disponibile),
    ap_da_smaltire: saldi.filter((s) => s.avvisi.some((a) => a.tipo === 'AP_SCADENZA')).sort((a, b) => b.ap_non_goduto - a.ap_non_goduto),
    negativi: saldi.filter((s) => s.disponibile < 0),
    senza_residuo_ap: ctx.isAdmin ? saldi.filter((s) => !s.residuo_ap_fonte).length : undefined,
    per_area: [...perArea.values()].map((a) => ({ ...a, residuo: Math.round(a.residuo * 100) / 100, goduto: Math.round(a.goduto * 100) / 100, pianificato: Math.round(a.pianificato * 100) / 100, in_attesa: Math.round(a.in_attesa * 100) / 100 })),
    da_assegnare: ctx.tutto ? saldi.filter((s) => s.gruppo === 'DA_ASSEGNARE').map((s) => ({ person_id: s.person_id, persona: s.persona })) : [],
    saldi,
  });
}));

// ---------------------------------------------------------------- residuo dell'anno precedente e forzature (HR)
const saldoSchema = z.object({
  residuo_ap: z.coerce.number().min(-60).max(200).optional(), rol_residuo_ap_ore: z.coerce.number().min(-400).max(2000).optional().nullable(),
  giorni_annui: z.coerce.number().min(0).max(60).optional().nullable(), rol_ore_annue: z.coerce.number().min(0).max(400).optional().nullable(), note: z.string().trim().max(500).optional().nullable(),
});
r.put('/saldi/:personId/:anno', ah(async (req, res) => {
  const ctx = await hr(req);
  const pid = Number(req.params.personId), anno = annoQ(req.params.anno);
  const p = ctx.perim.persone.get(pid);
  if (!p) throw bad('Persona fuori dal perimetro del Piano Ferie');
  const b = parse(saldoSchema, req.body || {});
  const cur = await one('SELECT * FROM saldi WHERE person_id=$1 AND anno=$2', [pid, anno]);
  const v = { residuo_ap: b.residuo_ap ?? cur?.residuo_ap ?? 0, rol_residuo_ap_ore: b.rol_residuo_ap_ore !== undefined ? b.rol_residuo_ap_ore : cur?.rol_residuo_ap_ore ?? null,
    giorni_annui: b.giorni_annui !== undefined ? b.giorni_annui : cur?.giorni_annui ?? null, rol_ore_annue: b.rol_ore_annue !== undefined ? b.rol_ore_annue : cur?.rol_ore_annue ?? null, note: b.note !== undefined ? b.note : cur?.note ?? null };
  await q(`INSERT INTO saldi (person_id, anno, residuo_ap, rol_residuo_ap_ore, giorni_annui, rol_ore_annue, note, fonte, updated_by_user_id, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'MANUALE',$8,now())
      ON CONFLICT (person_id, anno) DO UPDATE SET residuo_ap=EXCLUDED.residuo_ap, rol_residuo_ap_ore=EXCLUDED.rol_residuo_ap_ore, giorni_annui=EXCLUDED.giorni_annui, rol_ore_annue=EXCLUDED.rol_ore_annue, note=EXCLUDED.note, fonte='MANUALE', updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`,
  [pid, anno, v.residuo_ap, v.rol_residuo_ap_ore, v.giorni_annui, v.rol_ore_annue, v.note, ctx.uid]);
  await audit(req, 'FERIE_SALDO', { module: KEY, entity: 'saldo', entityId: `${pid}:${anno}`, label: `${p.nome} ${anno}`, data: { prima: cur ? { residuo_ap: cur.residuo_ap, giorni_annui: cur.giorni_annui } : null, dopo: v } });
  res.json(await saldoPersona(p, anno, ctx.settings));
}));

// Modello XLSX dei residui, precompilato con il perimetro e i valori già inseriti
const COLONNE = ['Cognome Nome', 'Codice fiscale', 'Email', 'Area', 'Anno', 'Residuo ferie anno precedente (giorni)', 'Residuo ROL anno precedente (ore)', 'Note'];
r.get('/saldi/modello.xlsx', ah(async (req, res) => {
  const ctx = await hr(req);
  const anno = annoQ(req.query.anno);
  const cf = new Map((await many('SELECT id, tax_code FROM public.people WHERE id = ANY($1::int[])', [[...ctx.perim.persone.keys()]])).map((x) => [x.id, x.tax_code]));
  const cur = new Map((await many('SELECT * FROM saldi WHERE anno=$1', [anno])).map((x) => [x.person_id, x]));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Suite TD';
  const ws = wb.addWorksheet('Residui');
  ws.columns = COLONNE.map((h, i) => ({ header: h, key: `c${i}`, width: [30, 20, 32, 22, 8, 22, 22, 40][i] }));
  for (const p of ctx.perim.persone.values()) {
    const s = cur.get(p.id);
    ws.addRow({ c0: p.nome, c1: cf.get(p.id) || '', c2: p.email || '', c3: nomeGruppo(p.gruppo, ctx.perim.siti), c4: anno, c5: s ? Number(s.residuo_ap) : null, c6: s?.rol_residuo_ap_ore != null ? Number(s.rol_residuo_ap_ore) : null, c7: s?.note || '' });
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  const g = wb.addWorksheet('Istruzioni');
  for (const t of ['Compila la colonna "Residuo ferie anno precedente (giorni)" con i giorni non goduti al 31/12 dell\'anno prima (dal cedolino o dal consulente del lavoro).',
    'Le persone si riconoscono dal codice fiscale, poi dall\'email, poi da Cognome Nome. Le righe senza valore vengono saltate.',
    'Il residuo ROL in ore serve solo se la voce ROL/permessi è attiva nelle Impostazioni del modulo.',
    'Ricarica il file da Piano Ferie > Saldi > Importa residui: prima la prova (nessuna scrittura), poi l\'importazione.']) g.addRow([t]);
  g.getColumn(1).width = 140;
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Piano ferie residui ${anno}.xlsx"`);
  res.end(Buffer.from(buf));
}));

const numero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.result != null) v = v.result;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const testo = (v) => (v == null ? '' : typeof v === 'object' ? String(v.text || v.result || (v.richText || []).map((x) => x.text).join('') || '') : String(v)).trim();

// Importazione dei residui da XLSX: ?prova=1 non scrive nulla e restituisce il rapporto
r.post('/saldi/import', upload.single('file'), ah(async (req, res) => {
  const ctx = await hr(req);
  if (!req.file) throw bad('Carica il file XLSX');
  const prova = req.query.prova === '1';
  const annoDef = annoQ(req.query.anno);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('Il file non è un XLSX leggibile'); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad('Il file non ha fogli');
  const head = (ws.getRow(1).values || []).map((v) => normName(testo(v)));
  const col = (re) => head.findIndex((h) => re.test(h || ''));
  const iNome = col(/^cognome nome|^persona|^nominativo/), iCf = col(/codice fiscale|^cf$/), iMail = col(/^e ?mail/), iAnno = col(/^anno/), iRes = col(/residuo ferie|^residuo$|giorni/), iRol = col(/rol/), iNote = col(/^note/);
  if (iRes < 0) throw bad('Colonna "Residuo ferie anno precedente (giorni)" non trovata nella prima riga');
  const people = await many('SELECT id, last_name, first_name, tax_code, email FROM public.people WHERE id = ANY($1::int[])', [[...ctx.perim.persone.keys()]]);
  const byCf = new Map(people.filter((p) => p.tax_code).map((p) => [p.tax_code.toUpperCase(), p]));
  const byMail = new Map(people.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
  const byNome = new Map(); for (const p of people) { const k = normName(`${p.last_name} ${p.first_name}`); byNome.set(k, byNome.has(k) ? null : p); }
  const rapporto = { righe: 0, abbinate: 0, scritte: 0, saltate: [], errori: [], dettaglio: [] };
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i); const v = row.values || [];
    const nome = iNome >= 0 ? testo(v[iNome]) : '', cf = iCf >= 0 ? testo(v[iCf]).toUpperCase() : '', mail = iMail >= 0 ? testo(v[iMail]).toLowerCase() : '';
    const res0 = numero(v[iRes]);
    if (!nome && !cf && !mail) continue;
    rapporto.righe++;
    if (res0 == null) { rapporto.saltate.push({ riga: i, persona: nome || cf || mail, motivo: 'residuo vuoto' }); continue; }
    if (Number.isNaN(res0) || res0 < -60 || res0 > 200) { rapporto.errori.push({ riga: i, persona: nome || cf || mail, motivo: 'residuo non valido' }); continue; }
    const p = (cf && byCf.get(cf)) || (mail && byMail.get(mail)) || (nome && byNome.get(normName(nome))) || null;
    if (!p) { rapporto.errori.push({ riga: i, persona: nome || cf || mail, motivo: nome && byNome.get(normName(nome)) === null ? 'omonimi: usa il codice fiscale' : 'persona non trovata nel perimetro (dipendenti attivi con contratto)' }); continue; }
    const anno = iAnno >= 0 && numero(v[iAnno]) ? Number(numero(v[iAnno])) : annoDef;
    if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) { rapporto.errori.push({ riga: i, persona: nome, motivo: 'anno non valido' }); continue; }
    const rol = iRol >= 0 ? numero(v[iRol]) : null;
    const note = iNote >= 0 ? testo(v[iNote]).slice(0, 500) : null;
    rapporto.abbinate++;
    rapporto.dettaglio.push({ riga: i, person_id: p.id, persona: `${p.last_name} ${p.first_name}`, anno, residuo_ap: res0, rol_residuo_ap_ore: Number.isNaN(rol) ? null : rol });
    if (!prova) {
      await q(`INSERT INTO saldi (person_id, anno, residuo_ap, rol_residuo_ap_ore, note, fonte, updated_by_user_id, updated_at) VALUES ($1,$2,$3,$4,$5,'XLSX',$6,now())
          ON CONFLICT (person_id, anno) DO UPDATE SET residuo_ap=EXCLUDED.residuo_ap, rol_residuo_ap_ore=coalesce(EXCLUDED.rol_residuo_ap_ore, saldi.rol_residuo_ap_ore), note=coalesce(nullif(EXCLUDED.note,''), saldi.note), fonte='XLSX', updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`,
      [p.id, anno, res0, Number.isNaN(rol) ? null : rol, note, ctx.uid]);
      rapporto.scritte++;
    }
  }
  if (!prova) { invalidaPerimetro(); await audit(req, 'FERIE_IMPORT_RESIDUI', { module: KEY, entity: 'saldo', label: `${rapporto.scritte} residui da ${req.file.originalname}`, data: { righe: rapporto.righe, errori: rapporto.errori.length } }); }
  res.json({ prova, ...rapporto });
}));

export default r;
