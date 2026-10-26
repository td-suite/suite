import { Router } from 'express';
import { many, one } from '../db.js';
import { ah } from '../lib/util.js';
import { completeness } from '../lib/dossier.js';

const r = Router();

r.get('/summary', ah(async (_req, res) => {
  const byKind = await many(`SELECT kind, status, count(*)::int AS n FROM contracts GROUP BY kind, status`);
  // organizzazioni dell'anagrafica unica con almeno un contratto non annullato
  const organizations = (await one(`SELECT count(DISTINCT org_id)::int AS n FROM contracts WHERE status<>'ANNULLATO'`)).n;
  // controparte (Legal entity) e sede TD: una delle due può mancare
  const PARTY = 'LEFT JOIN public.organizations p ON p.id=c.org_id LEFT JOIN public.sites s ON s.id=c.site_id';
  const recent = await many(`SELECT c.id, c.kind, c.protocol, c.status, c.title, c.proposal_date, c.updated_at, p.name AS org_name, s.name AS site_name FROM contracts c ${PARTY} ORDER BY c.updated_at DESC LIMIT 8`);
  const monthly = await many(`SELECT to_char(date_trunc('month', proposal_date), 'YYYY-MM') AS month, kind, count(*)::int AS n FROM contracts WHERE proposal_date >= date_trunc('month', current_date) - interval '11 months' AND status<>'ANNULLATO' GROUP BY 1, 2 ORDER BY 1`);
  // fascicoli (dei contratti non annullati o cessati, e quelli delle sedi TD senza contratto) con completamento
  const dossiers = await many(`SELECT d.*, coalesce(d.title, c.title, s.name, o.name) AS label, c.kind, c.protocol, c.status AS contract_status, o.name AS org_name, s.name AS site_name
    FROM dossiers d LEFT JOIN contracts c ON c.id=d.contract_id LEFT JOIN public.organizations o ON o.id=d.org_id LEFT JOIN public.sites s ON s.id=d.site_id
    WHERE c.id IS NULL OR c.status NOT IN ('ANNULLATO','CESSATO') ORDER BY d.created_at DESC`);
  const files = await many('SELECT dossier_id, doc_key, source FROM dossier_files');
  const dossierRows = dossiers.map((d) => {
    const comp = completeness(d, files.filter((f) => f.dossier_id === d.id));
    return { id: d.id, contract_id: d.contract_id, kind: d.kind, protocol: d.protocol, title: d.label, org_name: d.org_name, site_name: d.site_name, status: d.status, contract_status: d.contract_status, pct: comp.pct, done: comp.done, required: comp.required, missing: comp.rows.filter((x) => x.required && x.status === 'MANCANTE').map((x) => x.key) };
  });
  const missingLists = await many(`SELECT c.id, c.kind, c.protocol, c.title, p.name AS org_name, s.name AS site_name FROM contracts c ${PARTY}
    WHERE c.kind IN ('SRV','MDL') AND c.status IN ('PROPOSTA','FIRMATO','ATTIVO') AND NOT EXISTS (SELECT 1 FROM contract_files f WHERE f.contract_id=c.id AND f.category IN ('LISTINO_XLSX','LISTINO_PDF')) ORDER BY c.created_at DESC LIMIT 20`);
  const missingCreds = await many(`SELECT c.id, c.kind, c.protocol, c.title, p.name AS org_name, s.name AS site_name FROM contracts c ${PARTY}
    WHERE c.kind IN ('SRV','MDL') AND c.status IN ('FIRMATO','ATTIVO') AND NOT EXISTS (SELECT 1 FROM portal_credentials k WHERE k.contract_id=c.id AND k.username IS NOT NULL) ORDER BY c.created_at DESC LIMIT 20`);
  const toSign = await many(`SELECT c.id, c.kind, c.protocol, c.title, c.proposal_date, p.name AS org_name, s.name AS site_name FROM contracts c ${PARTY} WHERE c.status='PROPOSTA' ORDER BY c.proposal_date`);
  const sites = (await one(`SELECT count(DISTINCT site_id)::int AS n FROM contracts WHERE status<>'ANNULLATO' AND site_id IS NOT NULL`)).n;
  res.json({ byKind, organizations, sites, recent, monthly, dossiers: dossierRows, missingLists, missingCreds, toSign, year: new Date().getFullYear() });
}));

export default r;
