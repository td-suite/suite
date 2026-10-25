// Organigramma generato dai ruoli registrati: aree (tre livelli), referenti, linee di riporto e personale.
import { many } from '../db.js';

const fullName = (p) => `${p.first_name} ${p.last_name}`;

/** Carica aree e persone attive con tutto ciò che serve a costruire gli organigrammi. */
export async function loadOrgModel() {
  const areas = await many(`SELECT a.id, a.name, a.parent_id, a.level, a.kind, a.head_resource_id, t.path, t.sort_path FROM areas a JOIN areas_tree t ON t.id=a.id ORDER BY t.sort_path, a.name`);
  const people = await many(`SELECT r.id, r.kind, r.status, r.first_name, r.last_name, r.area_id, r.manager_id, r.approver_id,
      coalesce(e.job_title, l.discipline) AS job_title, e.contract_type, e.level,
      coalesce((SELECT array_agg(ra.area_id) FROM resource_areas ra WHERE ra.resource_id=r.id), '{}') AS extra_area_ids
    FROM resources r LEFT JOIN employments e ON e.resource_id=r.id LEFT JOIN lp_contracts l ON l.resource_id=r.id
    WHERE r.status IN ('ATTIVO','IMPEGNO') ORDER BY r.last_name, r.first_name`);
  const areaById = Object.fromEntries(areas.map((a) => [a.id, a]));
  const childrenOf = {};
  for (const a of areas) (childrenOf[a.parent_id || 0] = childrenOf[a.parent_id || 0] || []).push(a);
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]));
  const reportsOf = {};
  for (const p of people) if (p.manager_id) (reportsOf[p.manager_id] = reportsOf[p.manager_id] || []).push(p);
  // appartenenza: area principale + funzioni aggiuntive
  const membersOf = {};
  for (const p of people) for (const aid of new Set([p.area_id, ...(p.extra_area_ids || [])].filter(Boolean))) (membersOf[aid] = membersOf[aid] || []).push(p);
  const subtreeIds = (id) => { const out = [id]; for (const c of childrenOf[id] || []) out.push(...subtreeIds(c.id)); return out; };
  const subtreeMembers = (id) => { const seen = new Set(); const out = []; for (const aid of subtreeIds(id)) for (const p of membersOf[aid] || []) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } return out; };
  const ceo = people.find((p) => !p.manager_id && p.contract_type === 'DIRIGENTE') || people.find((p) => !p.manager_id && (reportsOf[p.id] || []).length) || null;
  const headCache = {};
  /** Referente dell'area: esplicito, altrimenti chi tra i membri del sottoalbero non riporta a un membro del sottoalbero (a parità, chi ha più riporti). */
  const headOf = (area) => {
    if (headCache[area.id] !== undefined) return headCache[area.id];
    let h = area.head_resource_id ? peopleById[area.head_resource_id] || null : null;
    if (!h) {
      const members = subtreeMembers(area.id);
      const ids = new Set(members.map((p) => p.id));
      const cands = members.filter((p) => !p.manager_id || !ids.has(p.manager_id));
      const kw = /manager|responsabil|dirett|chief|head|coordinat|referent/i;
      const score = (p) => (reportsOf[p.id] || []).filter((x) => ids.has(x.id)).length * 10 + (reportsOf[p.id] || []).length * 2
        + (p.contract_type === 'DIRIGENTE' ? 6 : 0) + (p.level === 'Q' ? 3 : 0) + (kw.test(p.job_title || '') ? 3 : 0)
        + (p.kind === 'DIPENDENTE' ? 2 : 0) + ((p.extra_area_ids || []).includes(area.id) ? 2 : 0) + (p.area_id === area.id ? 1 : 0);
      cands.sort((a, b) => score(b) - score(a) || a.last_name.localeCompare(b.last_name));
      h = cands[0] || null;
      if (!h && !area.parent_id) h = ceo;
    }
    headCache[area.id] = h;
    return h;
  };
  return { areas, areaById, childrenOf, people, peopleById, reportsOf, membersOf, subtreeIds, subtreeMembers, headOf, ceo };
}

const personOut = (p) => (p ? { id: p.id, name: fullName(p), job_title: p.job_title || null, kind: p.kind, status: p.status } : null);

/** Nodo di un'area: referente, personale diretto (esclusi referente e referenti delle sotto-aree), sotto-aree. */
export function areaNode(M, area, { depth = Infinity, collapseChildren = false } = {}) {
  const head = M.headOf(area);
  const kids = (M.childrenOf[area.id] || []);
  const childHeads = new Set(kids.map((c) => M.headOf(c)?.id).filter(Boolean));
  const staff = (M.membersOf[area.id] || []).filter((p) => p.id !== head?.id && !childHeads.has(p.id));
  const node = {
    id: area.id, name: area.name, level: area.level, kind: area.kind, path: area.path,
    head: personOut(head),
    staff: staff.map(personOut),
    headcount: M.subtreeMembers(area.id).length,
    staff_units: [], // tecnostruttura (funzioni di staff): in alto
    children: [], // aree operative: nel pettine
  };
  if (depth > 0) {
    const mk = (c) => areaNode(M, c, { depth: collapseChildren ? 0 : depth - 1, collapseChildren });
    node.staff_units = kids.filter((c) => c.kind === 'STAFF').map(mk);
    node.children = kids.filter((c) => c.kind !== 'STAFF').map(mk);
  }
  return node;
}

/** Catena dal vertice fino all'area (CEO → aree superiori → area): ogni sezione parte dall'Amministratore Delegato. */
export function chainTo(M, area, leaf) {
  const chain = []; let a = area.parent_id ? M.areaById[area.parent_id] : null;
  while (a) { chain.unshift(a); a = a.parent_id ? M.areaById[a.parent_id] : null; }
  const nodes = chain.map((x) => ({ id: x.id, name: x.name, level: x.level, kind: x.kind, head: personOut(M.headOf(x)), staff: [], staff_units: [], children: [] }));
  if (M.ceo && (nodes[0] ? nodes[0].head?.id !== M.ceo.id : leaf.head?.id !== M.ceo.id)) nodes.unshift({ id: 0, name: 'Amministratore Delegato', level: 0, kind: 'LINEA', head: personOut(M.ceo), staff: [], staff_units: [], children: [] });
  nodes.push(leaf);
  const dedup = [];
  for (const n of nodes) { const prev = dedup[dedup.length - 1]; if (prev && prev.head && n.head && prev.head.id === n.head.id && n !== leaf) { prev.name = `${prev.name} · ${n.name}`; continue; } dedup.push(n); }
  for (let i = 0; i < dedup.length - 1; i++) dedup[i].children = [dedup[i + 1]];
  return dedup[0];
}

/** Catena verticale dell'unità produttiva: CEO → ... → area madre (referente) → unità (referente) → personale. */
export function unitChain(M, area) {
  const head = M.headOf(area);
  const leaf = { id: area.id, name: area.name, level: area.level, kind: area.kind, head: personOut(head), staff: M.subtreeMembers(area.id).filter((p) => p.id !== head?.id).map(personOut), staff_units: [], children: [] };
  return chainTo(M, area, leaf);
}

/** Sezioni dell'organigramma: struttura completa, direzione, una per linea con sotto-aree. */
export function buildSections(M) {
  const roots = M.childrenOf[0] || [];
  const sections = [];
  if (!roots.length) return sections;
  const root = roots[0];
  sections.push({ key: 'completo', title: 'Struttura completa', subtitle: 'Tecnostruttura, aree operative, referenti e personale', tree: roots.length === 1 ? areaNode(M, root) : { id: 0, name: 'Toscana Diagnostica', head: personOut(M.ceo), staff: [], staff_units: [], children: roots.map((r) => areaNode(M, r)) } });
  const level2 = M.childrenOf[root.id] || [];
  const dirNode = areaNode(M, root, { depth: 0 });
  dirNode.staff_units = level2.filter((a) => a.kind === 'STAFF').map((a) => areaNode(M, a, { depth: 0 }));
  dirNode.children = level2.filter((a) => a.kind !== 'STAFF').map((a) => ({ ...areaNode(M, a, { depth: 0 }), staff: [], collapsed: true }));
  sections.push({ key: 'direzione', title: root.name, subtitle: 'Tecnostruttura in alto, aree operative nel pettine', tree: dirNode });
  for (const a of level2.filter((a) => a.kind !== 'STAFF' && (M.childrenOf[a.id] || []).length)) sections.push({ key: `area-${a.id}`, title: a.name, subtitle: 'Dal vertice all\'area: referente, sotto-aree e personale', tree: chainTo(M, a, areaNode(M, a)) });
  return sections;
}

// ---------------- Esportazione PPTX / PDF ----------------
const PETROL = '1B505F', TEAL = '71B1BD', LIGHT = 'EDF5F7', INK = '1A3C47', GREY = '666666';
const MAX_STAFF = 12;

const clone = (n) => ({ ...n, staff_units: (n.staff_units || []).map(clone), children: (n.children || []).map(clone) });

/** Layout ad albero (pollici): larghezza dei sottoalberi, altezze per riga, posizioni centrate. */
function layout(tree, { boxW, gapX, showStaff }) {
  const cpl = Math.max(10, Math.floor(boxW * 13)); // caratteri per riga a 8 pt circa
  const rows = (t, k = 1) => Math.ceil(((t || '').length || 1) / (cpl * k));
  const boxH = (n) => 0.22 + rows(n.name) * 0.15 + rows(n.head?.name || 'Referente da definire') * 0.14 + (n.head?.job_title ? rows(n.head.job_title, 1.15) * 0.12 : 0) + (n.collapsed || (!showStaff && n.headcount > 1 && !(n.children || []).length) ? 0.12 : 0)
    + (showStaff && n.staff?.length ? n.staff.slice(0, MAX_STAFF).reduce((a, p) => a + rows(`${p.name}${p.job_title ? ` · ${p.job_title}` : ''}`, 1.2) * 0.12, 0) + (n.staff.length > MAX_STAFF ? 0.12 : 0) + 0.06 : 0);
  const STAFF_GAP = 0.6;
  const staffRowW = (units) => { const nHalf = Math.ceil(units.length / 2); return 2 * (nHalf * boxW + Math.max(0, nHalf - 1) * gapX) + STAFF_GAP; };
  const width = (n) => {
    // tecnostruttura di un nodo non radice: riga virtuale tra il nodo e il suo pettine
    if (!n._root && !n._staffRow && (n.staff_units || []).length) {
      const virt = { _staffRow: true, name: '', staff_units: n.staff_units, children: n.children || [] };
      n._kids = [virt];
    } else n._kids = n.children || [];
    const kidsW = n._kids.length ? n._kids.reduce((a, c) => a + width(c), 0) + gapX * (n._kids.length - 1) : 0;
    n._w = Math.max(boxW, kidsW, n._staffRow ? staffRowW(n.staff_units) : 0);
    return n._w;
  };
  width(tree);
  const place = (n, x0, depth) => { n._depth = depth; n._x = x0 + n._w / 2; n._h = n._staffRow ? Math.max(...n.staff_units.map(boxH)) : boxH(n); let x = x0 + (n._w - (n._kids.reduce((a, c) => a + c._w, 0) + gapX * (n._kids.length - 1))) / 2; for (const c of n._kids) { place(c, x, depth + 1); x += c._w + gapX; } };
  place(tree, 0, 0);
  const all = []; const walk = (n) => { all.push(n); n._kids.forEach(walk); }; walk(tree);
  const rowH = []; for (const n of all) rowH[n._depth] = Math.max(rowH[n._depth] || 0, n._h);
  return { all, rowH, totalW: tree._w, boxH };
}

function header(slide, { title, subtitle }) {
  slide.background = { color: 'FFFFFF' };
  slide.addText('TOSCANA DIAGNOSTICA S.r.l.', { x: 0.4, y: 0.2, w: 8, h: 0.3, fontFace: 'Arial', fontSize: 11, bold: true, color: PETROL });
  slide.addText(title.toUpperCase(), { x: 0.4, y: 0.45, w: 10, h: 0.4, fontFace: 'Arial', fontSize: 16, bold: true, color: PETROL });
  slide.addText(`Organigramma · ${subtitle || ''} · aggiornato al ${new Date().toLocaleDateString('it-IT')}`, { x: 0.4, y: 0.82, w: 10, h: 0.25, fontFace: 'Arial', fontSize: 9, color: GREY });
  slide.addText('Toscana Diagnostica S.r.l. · Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI) · P.IVA e C.F. 07528130482 · Generato da TD Contracts dai ruoli registrati', { x: 0.4, y: 7.1, w: 12.5, h: 0.25, fontFace: 'Arial', fontSize: 7, color: PETROL, align: 'center' });
}

function drawBox(pptx, slide, n, { x, y, w, h, s, isRoot, showStaff }) {
  const fs = (base) => Math.round(Math.max(6, base * Math.min(1, s + 0.15)) * 2) / 2;
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05, fill: { color: isRoot ? PETROL : n.collapsed ? LIGHT : 'FFFFFF' }, line: { color: isRoot ? PETROL : TEAL, width: 1 } });
  const lines = [
    { text: n.name, options: { fontSize: fs(8.5), bold: true, color: isRoot ? 'FFFFFF' : PETROL, breakLine: true } },
    { text: n.head ? n.head.name : 'Referente da definire', options: { fontSize: fs(8), color: isRoot ? 'FFFFFF' : INK, breakLine: true } },
  ];
  if (n.head?.job_title) lines.push({ text: n.head.job_title, options: { fontSize: fs(6.5), italic: true, color: isRoot ? 'DDEEF2' : GREY, breakLine: true } });
  if (n.collapsed || (!showStaff && n.headcount > 1 && !(n.children || []).length)) lines.push({ text: `${n.headcount} person${n.headcount === 1 ? 'a' : 'e'}`, options: { fontSize: fs(6.5), color: isRoot ? 'DDEEF2' : GREY, breakLine: true } });
  if (showStaff && n.staff?.length) {
    const shown = n.staff.slice(0, MAX_STAFF);
    for (const p of shown) lines.push({ text: `${p.name}${p.job_title ? ` · ${p.job_title}` : ''}`, options: { fontSize: fs(6.5), color: isRoot ? 'FFFFFF' : INK, breakLine: true, align: 'left', bullet: { code: '2022' } } });
    if (n.staff.length > shown.length) lines.push({ text: `+${n.staff.length - shown.length} altre persone`, options: { fontSize: fs(6.5), color: GREY, breakLine: true, align: 'left' } });
  }
  slide.addText(lines, { x, y, w, h, fontFace: 'Arial', margin: 3, valign: 'top', align: 'center', autoFit: false });
}

const vline = (pptx, slide, x, y1, y2) => slide.addShape(pptx.ShapeType.line, { x, y: Math.min(y1, y2), w: 0, h: Math.abs(y2 - y1) || 0.001, line: { color: TEAL, width: 1 } });
const hline = (pptx, slide, x1, x2, y) => { if (Math.abs(x2 - x1) > 0.01) slide.addShape(pptx.ShapeType.line, { x: Math.min(x1, x2), y, w: Math.abs(x2 - x1), h: 0, line: { color: TEAL, width: 1 } }); };

/** Disegna un albero su una slide. Restituisce false se non ci sta in modo leggibile. Con molte aree sorelle le dispone su più righe. */
function drawTree(pptx, slide, tree, { title, subtitle, showStaff }) {
  const areaW = 12.5, areaH = 5.85, top = 1.15, gapY = 0.4;
  const minS = showStaff ? 0.72 : 0.6;
  const STAFF_GAP = 0.6; // varco centrale per il tronco
  const attempt = (boxW, gapX, rowsN) => {
    tree._root = true;
    const staffUnits = tree.staff_units || [];
    const kids = tree.children || [];
    const per = Math.ceil(kids.length / rowsN);
    const groups = []; for (let i = 0; i < kids.length; i += per) groups.push(kids.slice(i, i + per));
    const forests = groups.map((g) => { const v = { name: '', children: g, _virtual: true }; const L = layout(v, { boxW, gapX, showStaff }); return { v, L }; });
    const rootL = layout({ ...tree, children: [], staff_units: [] }, { boxW, gapX, showStaff });
    const staffL = staffUnits.length ? layout({ name: '', _virtual: true, _root: true, children: staffUnits }, { boxW, gapX, showStaff }) : null;
    const nHalf = Math.ceil(staffUnits.length / 2);
    const staffW = staffL ? 2 * (nHalf * boxW + Math.max(0, nHalf - 1) * gapX) + STAFF_GAP : 0;
    const totalW = Math.max(boxW, staffW, ...forests.map((f) => f.L.totalW));
    const sW = Math.min(1, areaW / totalW);
    // altezza: radice + tecnostruttura + per ogni gruppo le sue righe (saltando la riga virtuale)
    let totalH = rootL.rowH[0] + (staffL ? gapY + staffL.rowH[1] : 0);
    for (const f of forests) totalH += gapY + f.L.rowH.slice(1).reduce((a, h) => a + h, 0) + gapY * (f.L.rowH.length - 2);
    const s = Math.min(sW, areaH / totalH);
    return { s, forests, rootL, staffL, staffUnits, boxW, gapX };
  };
  let best = null;
  for (const [boxW, gapX] of showStaff ? [[2.1, 0.2], [1.8, 0.12]] : [[1.75, 0.2], [1.45, 0.12]]) {
    for (const rowsN of [1, 2, 3]) {
      if (rowsN > 1 && (tree.children || []).length < 2 * rowsN) continue;
      const a = attempt(boxW, gapX, rowsN);
      if (!best || a.s > best.s + 0.03) best = { ...a, rowsN };
    }
  }
  if (!best || best.s < minS) return false;
  const { s, boxW, gapX } = best;
  const { forests, rootL, staffL, staffUnits } = attempt(boxW, gapX, best.rowsN); // ricalcolo: i tentativi successivi avevano sovrascritto le posizioni
  header(slide, { title, subtitle });
  const cx = 0.4 + areaW / 2;
  // radice
  const rootH = rootL.rowH[0] * s;
  drawBox(pptx, slide, tree, { x: cx - (boxW * s) / 2, y: top, w: boxW * s, h: rootH, s, isRoot: true, showStaff });
  let y = top + rootH;
  // tecnostruttura: riquadri ai lati del tronco, uniti da una barra orizzontale
  if (staffL) {
    const rowTop = y + gapY * s;
    const rowH = staffL.rowH[1] * s;
    const nL = Math.ceil(staffUnits.length / 2);
    const left = staffUnits.slice(0, nL), right = staffUnits.slice(nL);
    const place = (group, dir) => group.map((n, i) => ({ n, x: dir < 0 ? cx - STAFF_GAP * s / 2 - (i + 1) * boxW * s - i * gapX * s : cx + STAFF_GAP * s / 2 + i * (boxW + gapX) * s }));
    const boxes = [...place(left, -1), ...place(right, 1)];
    const ym = rowTop + rowH / 2;
    const xs = boxes.map((b) => b.x + (boxW * s) / 2);
    hline(pptx, slide, Math.min(cx, ...xs), Math.max(cx, ...xs), ym);
    for (const b of boxes) drawBox(pptx, slide, b.n, { x: b.x, y: rowTop, w: boxW * s, h: b.n._h * s, s, isRoot: false, showStaff });
    vline(pptx, slide, cx, top + rootH, rowTop + rowH);
    y = rowTop + rowH;
  }
  // con più righe: tronco laterale a sinistra, per non attraversare i riquadri
  const multi = forests.length > 1;
  const xl = multi ? Math.min(...forests.map((f) => cx - (f.L.totalW * s) / 2)) - 0.12 : cx;
  let firstBar = null, lastBar = null;
  for (const f of forests) {
    const rowTop = y + gapY * s;
    const offX = cx - (f.L.totalW * s) / 2;
    const rowY = []; let yy = rowTop; for (let i = 1; i < f.L.rowH.length; i++) { rowY[i] = yy; yy += (f.L.rowH[i] + gapY) * s; }
    const px = (n) => offX + (n._x - boxW / 2) * s;
    const py = (n) => rowY[n._depth];
    const ym = rowTop - (gapY * s) / 2;
    // tronco dalla radice alla barra della riga, barra orizzontale, discese
    const xs = f.v._kids.map((c) => px(c) + (boxW * s) / 2);
    if (!multi) { vline(pptx, slide, cx, y, ym); hline(pptx, slide, Math.min(cx, ...xs), Math.max(cx, ...xs), ym); }
    else { if (firstBar === null) firstBar = ym; lastBar = ym; hline(pptx, slide, xl, Math.max(...xs), ym); }
    for (const c of f.v._kids) vline(pptx, slide, px(c) + (boxW * s) / 2, ym, py(c));
    const L_boxH = f.L.boxH;
    for (const n of f.L.all) {
      if (n._virtual) continue;
      for (const c of n._kids) {
        const x1 = px(n) + (boxW * s) / 2, y1 = py(n) + n._h * s, x2 = px(c) + (boxW * s) / 2, y2 = py(c), mid = y1 + (y2 - y1) / 2;
        if (n._staffRow) { vline(pptx, slide, x1, py(n) + (n._h * s) / 2, mid); } else vline(pptx, slide, x1, y1, mid);
        hline(pptx, slide, x1, x2, mid); vline(pptx, slide, x2, mid, y2);
      }
      if (n._staffRow) {
        // riga di tecnostruttura: riquadri ai lati del tronco su una barra orizzontale
        const ccx = px(n) + (boxW * s) / 2, rowTop = py(n), ym = rowTop + (n._h * s) / 2;
        const nL = Math.ceil(n.staff_units.length / 2);
        const left = n.staff_units.slice(0, nL), right = n.staff_units.slice(nL);
        const boxes = [...left.map((u, i) => ({ u, x: ccx - STAFF_GAP * s / 2 - (i + 1) * boxW * s - i * gapX * s })), ...right.map((u, i) => ({ u, x: ccx + STAFF_GAP * s / 2 + i * (boxW + gapX) * s }))];
        const xs = boxes.map((b) => b.x + (boxW * s) / 2);
        vline(pptx, slide, ccx, rowTop, ym);
        hline(pptx, slide, Math.min(ccx, ...xs), Math.max(ccx, ...xs), ym);
        for (const b of boxes) drawBox(pptx, slide, b.u, { x: b.x, y: rowTop, w: boxW * s, h: Math.min(n._h, L_boxH(b.u)) * s, s, isRoot: false, showStaff });
        continue;
      }
      drawBox(pptx, slide, n, { x: px(n), y: py(n), w: boxW * s, h: n._h * s, s, isRoot: false, showStaff });
    }
    y = yy - gapY * s;
  }
  if (multi) { vline(pptx, slide, cx, staffL ? top + rootH : top + rootH, firstBar); vline(pptx, slide, xl, firstBar, lastBar); }
  return true;
}

/** Una sezione diventa una o più slide: se con il personale non ci sta, prima la vista d'insieme e poi una slide per ogni sotto-area. */
function addSection(pptx, section, showStaff) {
  const tree = clone(section.tree);
  const slide = pptx.addSlide();
  if (drawTree(pptx, slide, tree, { ...section, showStaff })) return;
  // vista d'insieme senza personale
  const overview = clone(section.tree);
  const strip = (n) => { n.staff = []; n.children.forEach(strip); (n.staff_units || []).forEach(strip); };
  strip(overview);
  if (!drawTree(pptx, slide, overview, { title: section.title, subtitle: `${section.subtitle || ''} · vista d'insieme`, showStaff: false })) {
    const collapsed = clone(section.tree); strip(collapsed); [...collapsed.children, ...(collapsed.staff_units || [])].forEach((c) => { c.collapsed = true; c.children = []; c.staff_units = []; });
    drawTree(pptx, slide, collapsed, { title: section.title, subtitle: `${section.subtitle || ''} · vista d'insieme`, showStaff: false });
  }
  if (!showStaff) return;
  for (const c of [...(section.tree.staff_units || []), ...(section.tree.children || [])]) {
    if (!(c.staff?.length || c.children?.length || c.staff_units?.length)) continue;
    addSection(pptx, { title: `${section.title} · ${c.name}`, subtitle: `${c.path || c.name}`, tree: c }, true);
  }
}

export async function chartToPptx({ title, subtitle, tree, showStaff = true }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.author = 'TD Contracts'; pptx.company = 'Toscana Diagnostica S.r.l.'; pptx.title = title;
  addSection(pptx, { title, subtitle, tree }, showStaff);
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
