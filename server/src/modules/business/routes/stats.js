import { Router } from 'express';
import { many, one } from '../db.js';
import { ah } from '../lib/util.js';
import { completeness } from '../lib/dossier.js';

const r = Router();

r.get('/summary', ah(async (_req, res) => {
  const byKind = await many(`SELECT kind, status, count(*)::int AS n FROM contracts GROUP BY kind, status`);
  const partners = (await one('SELECT count(*)::int AS n FROM partners WHERE active')).n;
  const recent = await many(`SELECT c.id, c.kind, c.protocol, c.status, c.title, c.proposal_date, c.updated_at, p.name AS partner_name FROM contracts c JOIN partners p ON p.id=c.partner_id ORDER BY c.updated_at DESC LIMIT 8`);
  const monthly = await many(`SELECT to_char(date_trunc('month', proposal_date), 'YYYY-MM') AS month, kind, count(*)::int AS n FROM contracts WHERE proposal_date >= date_trunc('month', current_date) - interval '11 months' AND status<>'ANNULLATO' GROUP BY 1, 2 ORDER BY 1`);
  // fascicoli dei punti prelievo con completamento
  const dossiers = await many(`SELECT d.*, c.id AS contract_id, c.kind, c.protocol, c.title, c.status AS contract_status, p.name AS partner_name FROM dossiers d JOIN contracts c ON c.id=d.contract_id JOIN partners p ON p.id=c.partner_id WHERE c.status NOT IN ('ANNULLATO','CESSATO') ORDER BY c.created_at DESC`);
  const files = await many('SELECT dossier_id, doc_key, source FROM dossier_files');
  const dossierRows = dossiers.map((d) => {
    const comp = completeness(d, files.filter((f) => f.dossier_id === d.id));
    return { contract_id: d.contract_id, kind: d.kind, protocol: d.protocol, title: d.title, partner_name: d.partner_name, status: d.status, contract_status: d.contract_status, pct: comp.pct, done: comp.done, required: comp.required, missing: comp.rows.filter((x) => x.required && x.status === 'MANCANTE').map((x) => x.key) };
  });
  const missingLists = await many(`SELECT c.id, c.kind, c.protocol, c.title, p.name AS partner_name FROM contracts c JOIN partners p ON p.id=c.partner_id
    WHERE c.kind IN ('SRV','MDL') AND c.status IN ('PROPOSTA','FIRMATO','ATTIVO') AND NOT EXISTS (SELECT 1 FROM contract_files f WHERE f.contract_id=c.id AND f.category IN ('LISTINO_XLSX','LISTINO_PDF')) ORDER BY c.created_at DESC LIMIT 20`);
  const missingCreds = await many(`SELECT c.id, c.kind, c.protocol, c.title, p.name AS partner_name FROM contracts c JOIN partners p ON p.id=c.partner_id
    WHERE c.kind IN ('SRV','MDL') AND c.status IN ('FIRMATO','ATTIVO') AND NOT EXISTS (SELECT 1 FROM portal_credentials k WHERE k.contract_id=c.id AND k.username IS NOT NULL) ORDER BY c.created_at DESC LIMIT 20`);
  const toSign = await many(`SELECT c.id, c.kind, c.protocol, c.title, c.proposal_date, p.name AS partner_name FROM contracts c JOIN partners p ON p.id=c.partner_id WHERE c.status='PROPOSTA' ORDER BY c.proposal_date`);
  res.json({ byKind, partners, recent, monthly, dossiers: dossierRows, missingLists, missingCreds, toSign, year: new Date().getFullYear() });
}));

export default r;
