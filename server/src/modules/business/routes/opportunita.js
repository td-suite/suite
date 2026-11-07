// Business Hub · vista navigabile del DB Opportunità (filtri, ordinamento e colonne li gestisce la pagina; export XLSX e PDF della
// selezione corrente) e import del file del CEO (Impostazioni: Prova → piano con abbinamenti e dubbi, Importa → esecuzione).
// Montate sotto /api/business/hub. Import riservato all'Admin del modulo.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { many, q } from '../db.js';
import { ah, bad, audit, parse, todayRome } from '../lib/util.js';
import { requireAdmin } from '../lib/access.js';
import { getSettings } from '../lib/rules.js';
import { COLONNE_VISTA, rigaVista, xlsxVista, pdfVista } from '../lib/esporta.js';
import { leggiFile, pianifica, esegui, accountDaContratti } from '../lib/opportunita.js';
import { svuotaCache } from '../lib/feed.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

async function righeVista(ids = null) {
  const s = await getSettings();
  const soglia = Number(s.hub_stallo_giorni) || 45;
  const oggi = todayRome();
  const acc = await many(`SELECT a.*, o.name AS org_name, o.address AS org_address, coalesce(o.city, a.sedi->0->>'citta') AS citta, coalesce(o.province, a.sedi->0->>'prov') AS prov,
      o.email AS org_email, o.pec AS org_pec, o.phone AS org_phone, uo.full_name AS owner_name,
      (SELECT string_agg(c.nome, ', ' ORDER BY c.principale DESC, c.nome) FROM contatti c WHERE c.account_id=a.id) AS referenti,
      (SELECT count(*)::int FROM contracts c WHERE c.org_id=a.organization_id AND c.kind=a.linea AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO')) AS contratti_firmati
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id LEFT JOIN public.users uo ON uo.id=a.owner_user_id
    WHERE ($1::int[] IS NULL OR a.id = ANY($1::int[])) ORDER BY o.name`, [ids]);
  return acc.map((a) => rigaVista(a, soglia, oggi));
}

r.get('/opportunita', ah(async (_req, res) => {
  res.json({ colonne: COLONNE_VISTA, righe: await righeVista() });
}));

// Export della selezione corrente: ids nell'ordine mostrato e colonne visibili
r.post('/opportunita/export', ah(async (req, res) => {
  // colonne assenti = tutte le 49 del DB (stampa dalla Pipeline e da Clienti e prospect, 07/11/2026)
  const d = parse(z.object({ formato: z.enum(['xlsx', 'pdf']), ids: z.array(z.coerce.number().int()).max(5000), colonne: z.array(z.string()).min(1).max(60).optional(), filtri: z.string().max(800).optional() }), req.body);
  const colonne = d.colonne ? d.colonne.map((k) => COLONNE_VISTA.find((c) => c.k === k)).filter(Boolean) : COLONNE_VISTA;
  if (!colonne.length) throw bad('Nessuna colonna valida');
  const tutte = await righeVista(d.ids);
  const pos = new Map(d.ids.map((id, i) => [id, i]));
  const righe = tutte.sort((a, b) => pos.get(a._id) - pos.get(b._id));
  const titolo = 'DB Opportunità B2B Laboratorio';
  const base = `DB_Opportunita_${todayRome()}`;
  if (d.formato === 'xlsx') {
    const buf = await xlsxVista(righe, colonne, { titolo, filtri: d.filtri });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(buf);
  }
  const buf = await pdfVista(righe, colonne, { titolo, filtri: d.filtri });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
  res.send(buf);
}));

// ---------------- Import del DB Opportunità ----------------
const leggi = async (req) => {
  if (!req.file) throw bad('Carica il file XLSX del DB Opportunità');
  const f = await leggiFile(req.file.buffer).catch((e) => { throw bad(e.message); });
  f.nome = req.file.originalname;
  return f;
};
const decisioniDa = (v) => { if (!v) return {}; try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? o : {}; } catch { throw bad('Decisioni sui dubbi non leggibili'); } };

r.post('/import/db/prova', requireAdmin, upload.single('file'), ah(async (req, res) => {
  const f = await leggi(req);
  const piano = await pianifica(f, decisioniDa(req.body.decisioni));
  await q(`INSERT INTO import_runs (filename, dry_run, user_id, summary, kind) VALUES ($1,TRUE,$2,$3,'DB_OPPORTUNITA')`, [f.nome, req.user.id, JSON.stringify(piano.conteggi)]);
  res.json(piano);
}));

r.post('/import/db/esegui', requireAdmin, upload.single('file'), ah(async (req, res) => {
  const f = await leggi(req);
  const rep = await esegui(f, decisioniDa(req.body.decisioni), req.user.id);
  svuotaCache();
  await q(`INSERT INTO import_runs (filename, dry_run, user_id, summary, kind) VALUES ($1,FALSE,$2,$3,'DB_OPPORTUNITA')`, [f.nome, req.user.id, JSON.stringify(rep)]);
  await audit(req, 'HUB_IMPORT_DB', 'import', null, { file: f.nome, account_creati: rep.account_creati, account_aggiornati: rep.account_aggiornati, legal_entity_nuove: rep.legal_entity_nuove, errori: rep.errori.length });
  console.log(`[business] import DB Opportunità: ${rep.account_creati} account creati, ${rep.account_aggiornati} aggiornati, ${rep.legal_entity_nuove} Legal entity nuove, ${rep.errori.length} errori`);
  res.json(rep);
}));

// Account mancanti per i contratti già presenti (PP, SRV, MDL senza account sulla stessa linea)
r.post('/import/contratti', requireAdmin, ah(async (req, res) => {
  const dry = req.body?.dry_run !== false;
  const out = await accountDaContratti(req.user.id, { dryRun: dry });
  if (!dry) await audit(req, 'HUB_ACCOUNT_DA_CONTRATTI', 'import', null, { account: out.account });
  res.json(out);
}));

r.get('/import/db/runs', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT r.id, r.filename, r.dry_run, r.at, r.summary, u.full_name AS user_name FROM import_runs r LEFT JOIN users u ON u.id=r.user_id WHERE r.kind='DB_OPPORTUNITA' ORDER BY r.at DESC LIMIT 30`));
}));

export default r;
