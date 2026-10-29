// Archivio di tutti gli audit (filtri: tipo, sede/Legal entity, stato, periodo, testo) con esportazione XLSX e PDF della lista filtrata
import { Router } from 'express';
import { ah } from '../../../lib/util.js';
import { listAudits } from '../lib/core.js';
import { archivioXlsx, archivioPdf } from '../lib/export.js';
import { KINDS, STATUS_LABEL } from '../config.js';

const r = Router();

r.get('/archivio', ah(async (req, res) => res.json(await listAudits(req, req.query, { limit: 500 }))));

const descrFiltri = (qq) => [qq.kind && KINDS[qq.kind], qq.status && STATUS_LABEL[qq.status], qq.from && `dal ${qq.from}`, qq.to && `al ${qq.to}`, qq.q && `"${qq.q}"`].filter(Boolean).join(', ');
const stamp = () => new Date().toISOString().slice(0, 10);

r.get('/archivio.xlsx', ah(async (req, res) => {
  const rows = await listAudits(req, { ...req.query, limit: 5000 });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Archivio audit SGI ${stamp()}.xlsx"`);
  res.send(await archivioXlsx(rows));
}));
r.get('/archivio.pdf', ah(async (req, res) => {
  const rows = await listAudits(req, { ...req.query, limit: 2000 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="Archivio audit SGI ${stamp()}.pdf"`);
  res.send(await archivioPdf(rows, { filtri: descrFiltri(req.query) }));
}));

export default r;
