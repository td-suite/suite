// Casella People: lettura di people@toscanadiagnostica.it (job contracts:people-inbox, ogni 10 minuti, come la casella recruitment@)
// e approvazione dei documenti ricevuti. Ogni messaggio nuovo con allegati PDF, Word o immagini diventa una riga di people_inbox
// DA_APPROVARE con i file in people_inbox_files (archivio a due vie della Suite: blob se configurato, altrimenti database).
// Abbinamento: [TD-SCAD-<chiave>] nel soggetto o nel corpo (scadenza e persona), altrimenti email del mittente = email della persona,
// altrimenti nome completo nel soggetto, altrimenti intestatario letto dal documento; se nulla torna resta "da assegnare".
// Proposta per file (categoria del dossier, scadenza, intestatario, confidenza, citazione): askJson kind 'contracts_people_doc' con la
// chiave Anthropic della Suite; CONTRACTS_AI_MOCK=1 (mai in produzione) o senza chiave: regole di lib/peopleRules.js.
// NESSUN upload automatico: l'allegato entra nel dossier e la scadenza si chiude solo con "Approva" del CEO o dell'HR Manager.
// Nei log solo identificativi e conteggi: il testo dei documenti (che può contenere dati sanitari) non viene salvato né registrato.
import { one, many, q, tx } from '../db.js';
import { config as suite } from '../../../config.js';
import { askJson } from '../../../lib/claude.js';
import { notify } from '../../../lib/community.js';
import { storeBuffer, readBuffer } from '../../../lib/moduleStorage.js';
import { audit, bad, notFound } from './util.js';
import { CATEGORY_LABELS } from './seedData.js';
import { computeDeadlines } from './deadlines.js';
import { extractText } from './cv.js';
import { graphConfigured, graph, resolveMailbox } from './inbox.js';
import { acceptedFile, parseScadKey, matchByEmail, matchByName, heuristicProposal, cleanProposal, scadTag, normEmail } from './peopleRules.js';
import { setting, setSetting, peopleMailbox, peopleSettings, peopleDirectory, sendFromPeople, aiMock } from './peopleMail.js';
import { layout } from '../../../lib/mailer.js';

const SKIP_NAMES = /^(image\d*|logo|firma|signature|outlook|banner)/i;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const itDate = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y ? `${d}/${m}/${y}` : ''; };
const CATEGORIES = Object.keys(CATEGORY_LABELS);

// ---------------- proposta per file ----------------
const SYSTEM = [
  'Sei l\'assistente dell\'ufficio People di Toscana Diagnostica. Ricevi il testo di un documento inviato da un collaboratore per',
  'rinnovare una scadenza del suo dossier (attestati, certificati, idoneità, polizze, documenti di identità, permessi di soggiorno).',
  'Rispondi esclusivamente con un oggetto JSON: {"category": una delle categorie indicate, "expires_at": "AAAA-MM-GG" o null,',
  '"holder": "Cognome Nome" dell\'intestatario o null, "confidence": numero da 0 a 1, "quote": la sola frase del documento che riporta la',
  'scadenza o l\'intestatario, al massimo 160 caratteri}. Non riportare mai diagnosi, patologie, prescrizioni o altri dati sanitari,',
  'nemmeno nella citazione. Se un dato non c\'è usa null: non inventare.',
].join(' ');

async function propose({ buf, mime, filename, people, userId, inboxId, fileNo }) {
  let text = '';
  try { text = await extractText(buf, mime, filename); } catch { text = ''; }
  if (aiMock()) return { ...heuristicProposal({ text, filename, categories: CATEGORIES, people }), method: 'mock' };
  if (text && text.replace(/\s/g, '').length > 30 && suite.anthropic.enabled) {
    try {
      const user = `Categorie ammesse: ${CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join('; ')}.\nNome del file: ${filename}\n\nTesto del documento:\n${text.slice(0, 6000)}`;
      // query in ai_log: solo identificativi, mai il testo
      const raw = await askJson({ kind: 'contracts_people_doc', system: SYSTEM, user, maxTokens: 400, userId, query: `people_inbox ${inboxId} file ${fileNo}`, timeoutMs: 45_000 });
      const p = cleanProposal(raw, CATEGORIES);
      const h = p.holder ? matchByName(p.holder, people) : null;
      return { ...p, holder_id: h?.id || null, method: 'claude' };
    } catch (e) { console.error(`[people inbox] proposta AI non riuscita per il messaggio ${inboxId}: ${e.status || ''}`); }
  }
  const h = heuristicProposal({ text, filename, categories: CATEGORIES, people });
  return { ...h, method: text ? 'euristica' : 'nessuna' };
}

// ---------------- abbinamento ----------------
/** Risorsa di una chiave TD-SCAD: dal registro dei richiami, dall'allegato o dalla scadenza manuale, altrimenti dal calendario. */
export async function resolveKey(key) {
  if (!key) return null;
  const r = await one('SELECT resource_id FROM deadline_reminders WHERE deadline_key=$1 AND resource_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1', [key]);
  if (r) return r.resource_id;
  let m = key.match(/^A(\d+)$/);
  if (m) return (await one('SELECT resource_id FROM attachments WHERE id=$1', [Number(m[1])]))?.resource_id || null;
  m = key.match(/^M(\d+)$/);
  if (m) return (await one('SELECT resource_id FROM deadlines WHERE id=$1', [Number(m[1])]))?.resource_id || null;
  m = key.match(/^[A-Z](\d+)-\d{8}-/);
  if (m) return (await one('SELECT id FROM resources_v WHERE id=$1', [Number(m[1])]))?.id || null;
  return null;
}

/** Scadenza documentale della persona compatibile con la categoria proposta (una sola): suggerita quando manca il TD-SCAD. */
function suggestDeadline(items, category) {
  if (!category || category === 'ALTRO') return null;
  const label = CATEGORY_LABELS[category];
  const c = items.filter((i) => i.type === 'DOCUMENTO' && (i.title === `Scadenza ${label}` || (category === 'POLIZZA_RC' && /polizza/i.test(i.title))));
  return c.length === 1 ? c[0].key : null;
}

/**
 * Registra un messaggio in arrivo (lettura Graph o simulazione di collaudo): riga DA_APPROVARE, file archiviati, proposte.
 * files: [{ filename, mime, buffer }]. Restituisce { id } oppure { duplicate } / { skipped }.
 */
export async function ingestMessage({ graphId, receivedAt, fromEmail, fromName, subject, bodyText, files, source = 'GRAPH', userId = null }) {
  if (await one('SELECT id FROM people_inbox WHERE graph_id=$1', [graphId])) return { duplicate: true };
  const useful = (files || []).filter((f) => f?.buffer?.length && acceptedFile(f.filename, f.mime));
  if (!useful.length) return { skipped: 'nessun_allegato_utile' };
  const people = await peopleDirectory();
  let key = parseScadKey(subject, bodyText);
  let resourceId = null; let method = null;
  if (key) { resourceId = await resolveKey(key); method = 'TD-SCAD'; if (!resourceId) key = null; }
  if (!resourceId) { const p = matchByEmail(fromEmail, people); if (p) { resourceId = p.id; method = 'EMAIL'; } }
  if (!resourceId) { const p = matchByName(subject, people); if (p) { resourceId = p.id; method = 'NOME'; } }
  const row = await one(`INSERT INTO people_inbox (graph_id, received_at, from_email, from_name, subject, body_text, resource_id, deadline_key, match_method, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
  [graphId, receivedAt || new Date(), normEmail(fromEmail) || null, fromName || null, (subject || '').slice(0, 500), (bodyText || '').slice(0, 4000) || null, resourceId, key, method, source]);
  let n = 0; const props = [];
  for (const f of useful) {
    n++;
    const mime = f.mime || 'application/octet-stream';
    const st = await storeBuffer('contracts', 'people-inbox', f.filename, mime, f.buffer);
    const p = await propose({ buf: f.buffer, mime, filename: f.filename, people, userId, inboxId: row.id, fileNo: n });
    props.push(p);
    await q(`INSERT INTO people_inbox_files (inbox_id, filename, mime, size, sha256, data, blob_path, proposed_category, proposed_expires_at, proposed_holder, confidence, quote, method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [row.id, f.filename, mime, st.size, st.sha256, st.data, st.blob_path, p.category, p.expires_at, p.holder, p.confidence, p.quote, p.method]);
  }
  // nessun abbinamento dal messaggio: l'intestatario letto dal documento (da verificare all'approvazione)
  if (!resourceId) {
    const ids = [...new Set(props.map((p) => p.holder_id).filter(Boolean))];
    if (ids.length === 1) { resourceId = ids[0]; method = 'INTESTATARIO'; }
  }
  if (resourceId && !key) {
    const items = await computeDeadlines({ resourceId });
    const k = suggestDeadline(items, props[0]?.category);
    if (k) { key = k; method = `${method}+CATEGORIA`; }
  }
  await q('UPDATE people_inbox SET resource_id=$2, deadline_key=$3, match_method=$4 WHERE id=$1', [row.id, resourceId, key, method]);
  console.log(`[people inbox] messaggio ${row.id}: ${n} allegati, abbinamento ${method || 'da assegnare'}`);
  return { id: row.id, files: n, resource_id: resourceId, deadline_key: key, match_method: method };
}

// ---------------- lettura Graph ----------------
export async function pollPeopleInbox({ force = false } = {}) {
  if (!graphConfigured()) return { skipped: 'graph_non_configurato' };
  const { address } = await peopleMailbox();
  if (!force && (await setting('people_read_enabled', 'true')) !== 'true') return { skipped: 'disattivata' };
  const since = (await setting('people_inbox_since', null)) || new Date(Date.now() - 7 * 86400000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since} and hasAttachments eq true`);
  let fetched = 0; let created = 0; let last = since;
  try {
    const userId = (await resolveMailbox(address)).id;
    const j = await graph(`/users/${userId}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=50&$select=id,receivedDateTime,from,subject,body,hasAttachments`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    for (const m of j.value || []) {
      fetched++;
      if (m.receivedDateTime > last) last = m.receivedDateTime;
      const from = m.from?.emailAddress || {};
      if (normEmail(from.address) === address) continue;
      if (await one('SELECT 1 FROM people_inbox WHERE graph_id=$1', [m.id])) continue;
      const atts = await graph(`/users/${userId}/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline`);
      const files = [];
      for (const a of atts.value || []) {
        if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
        if (!acceptedFile(a.name, a.contentType)) continue;
        if (/^image\//.test(a.contentType || '') && SKIP_NAMES.test(a.name || '') && (a.size || 0) < 40_000) continue;   // loghi e firme
        const full = await graph(`/users/${userId}/messages/${m.id}/attachments/${a.id}`);
        if (full.contentBytes) files.push({ filename: a.name, mime: a.contentType, buffer: Buffer.from(full.contentBytes, 'base64') });
      }
      const r = await ingestMessage({ graphId: m.id, receivedAt: m.receivedDateTime, fromEmail: from.address, fromName: from.name, subject: m.subject, bodyText: m.body?.content || '', files });
      if (r.id) created++;
    }
    await setSetting('people_inbox_since', last);
    await setSetting('people_inbox_last', new Date().toISOString());
    await setSetting('people_inbox_error', '');
  } catch (e) {
    let msg = e.message;
    if (/ErrorInvalidUser|ResourceNotFound|404/.test(msg)) msg = `Microsoft non trova la casella "${address}": verifica che esista come casella (anche condivisa) nel tenant della Suite. Dettaglio: ${msg}`;
    else if (/ErrorAccessDenied|Authorization_RequestDenied|403/.test(msg)) msg = `Permesso mancante: sull'app registration della Suite serve Mail.Read (applicativo) con consenso amministratore e, se c'è una Application Access Policy, deve includere ${address}. Dettaglio: ${msg}`;
    await setSetting('people_inbox_error', msg);
    throw e;
  }
  return { fetched, created };
}

// ---------------- approvazione ----------------
async function loadInbox(id) {
  const row = await one('SELECT * FROM people_inbox WHERE id=$1', [id]);
  if (!row) throw notFound('Messaggio non trovato');
  return row;
}
const suiteUserIdsOf = async (resourceId) => (await many(`SELECT id FROM public.users WHERE person_id=$1 AND status='ACTIVE'`, [resourceId])).map((u) => u.id);
async function personEmail(resourceId, fallback) {
  const p = await one(`SELECT lower(r.email) AS email, (SELECT lower(u.email) FROM public.users u WHERE u.person_id=r.id AND u.status='ACTIVE' LIMIT 1) AS user_email, r.first_name, r.last_name FROM resources_v r WHERE r.id=$1`, [resourceId]);
  return { to: fallback || p?.email || p?.user_email || null, name: p ? `${p.first_name} ${p.last_name}` : '' };
}

/**
 * Approva: carica i file inclusi nel dossier della persona (categoria e scadenza approvate) e chiude la scadenza abbinata.
 * Allegato del dossier (A<id>): il vecchio allegato è sostituito (superseded_by) dal nuovo con la nuova scadenza.
 * Scadenza manuale (M<id>): deadlines.done = TRUE. Polizza RC: lp_contracts.insurance_expiry = nuova scadenza.
 * Le altre (prova, contratto ...): chiusura con nota in deadline_closures. Poi notifica in app ed email di conferma da people@.
 */
// Chiusura della scadenza abbinata con gli allegati entrati nel dossier (usata all'approvazione e nella correzione successiva)
async function applyClosure(c, { key, item, resourceId, inboxId, newIds, note, userId }) {
  let how = null;
  if (!item) return how;
  const mA = key.match(/^A(\d+)$/); const mM = key.match(/^M(\d+)$/);
  if (mA) {
    const old = (await c.query('SELECT category FROM attachments WHERE id=$1 AND resource_id=$2', [Number(mA[1]), resourceId])).rows[0];
    const repl = newIds.find((x) => x.category === old?.category) || newIds[0];
    if (repl) {
      await c.query('UPDATE attachments SET superseded_by=$3 WHERE id=$1 AND resource_id=$2', [Number(mA[1]), resourceId, repl.id]);
      how = `allegato sostituito dal nuovo (${repl.expires_at ? `scadenza ${itDate(repl.expires_at)}` : 'senza scadenza'})`;
    } else how = `chiusa con nota${note ? `: ${note}` : ''}`;
  } else if (mM) {
    await c.query('UPDATE deadlines SET done=TRUE WHERE id=$1 AND resource_id=$2', [Number(mM[1]), resourceId]);
    how = 'scadenza manuale segnata come fatta';
  } else if (item.type === 'DOCUMENTO' && /polizza/i.test(item.title)) {
    const pol = newIds.find((x) => x.category === 'POLIZZA_RC' && x.expires_at);
    if (pol) await c.query('UPDATE lp_contracts SET insurance_expiry=$2, updated_at=now() WHERE resource_id=$1', [resourceId, pol.expires_at]);
    how = pol ? `polizza aggiornata con scadenza ${itDate(pol.expires_at)}` : 'polizza chiusa con nota (nuova scadenza non indicata)';
  } else how = `chiusa con nota${note ? `: ${note}` : ''}`;
  await c.query(`INSERT INTO deadline_closures (deadline_key, resource_id, inbox_id, note, closed_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (deadline_key) DO UPDATE SET inbox_id=EXCLUDED.inbox_id, note=EXCLUDED.note, closed_by=EXCLUDED.closed_by, closed_at=now()`, [key, resourceId, inboxId, [how, note].filter(Boolean).join(' · ').slice(0, 1000), userId]);
  return how;
}

// Correzione dopo l'approvazione (richiesta del CEO 31/10/2026): un messaggio APPROVATO senza scadenza abbinata, o abbinato a quella
// sbagliata, può essere collegato alla scadenza giusta della stessa persona; la chiusura avviene con gli allegati già nel dossier.
export async function closeApprovedMessage(req, id, body) {
  const row = await loadInbox(id);
  if (row.status !== 'APPROVATO') throw bad('La correzione della scadenza è possibile solo sui messaggi approvati');
  const resourceId = Number(row.resource_id);
  if (!resourceId) throw bad('Il messaggio approvato non ha una persona abbinata');
  const key = body.deadline_key || null;
  if (!key) throw bad('Scegli la scadenza da chiudere');
  const items = await computeDeadlines({ resourceId, includeClosed: true });
  const item = items.find((i) => i.key === key);
  if (!item) throw bad('La scadenza scelta non è tra quelle della persona');
  const newIds = (await many('SELECT attachment_id AS id, approved_category AS category, approved_expires_at AS expires_at FROM people_inbox_files WHERE inbox_id=$1 AND attachment_id IS NOT NULL ORDER BY id', [id]))
    .filter((x) => x.id);
  const note = body.note ? String(body.note).slice(0, 1000) : row.note;
  const how = await tx(async (c) => {
    const h = await applyClosure(c, { key, item, resourceId, inboxId: id, newIds, note: body.note ? String(body.note).slice(0, 1000) : null, userId: req.user.id });
    await c.query(`UPDATE people_inbox SET deadline_key=$2, match_method='MANUALE', note=$3 WHERE id=$1`, [id, key, note]);
    return h;
  });
  await audit(req, 'PEOPLE_INBOX_CLOSE_LATER', 'people_inbox', id, { resource_id: resourceId, deadline_key: key, previous_key: row.deadline_key, closure: how });
  return { ok: true, closure: how, deadline_key: key };
}

export async function approveMessage(req, id, body) {
  const row = await loadInbox(id);
  if (row.status !== 'DA_APPROVARE') throw bad(`Messaggio già ${row.status.toLowerCase().replace('_', ' ')}`);
  const resourceId = Number(body.resource_id ?? row.resource_id);
  if (!resourceId) throw bad('Abbina prima il messaggio a una persona');
  const person = await one('SELECT id, last_name, first_name, kind FROM resources_v WHERE id=$1', [resourceId]);
  if (!person) throw bad('Persona inesistente');
  const key = body.deadline_key === undefined ? row.deadline_key : (body.deadline_key || null);
  const items = await computeDeadlines({ resourceId, includeClosed: true });
  const item = key ? items.find((i) => i.key === key) : null;
  if (key && !item) throw bad('La scadenza abbinata non è (più) tra quelle della persona: scegline un\'altra o lascia "nessuna"');
  const files = await many('SELECT * FROM people_inbox_files WHERE inbox_id=$1 ORDER BY id', [id]);
  const edits = new Map((body.files || []).map((f) => [Number(f.id), f]));
  const chosen = files.map((f) => {
    const e = edits.get(f.id) || {};
    return { ...f, include: e.include === undefined ? f.include : Boolean(e.include), category: e.category || f.proposed_category, expires_at: e.expires_at === undefined ? f.proposed_expires_at : (e.expires_at || null) };
  }).filter((f) => f.include);
  if (!chosen.length) throw bad('Nessun allegato selezionato da caricare');
  for (const f of chosen) if (!CATEGORY_LABELS[f.category]) throw bad(`Categoria del dossier non valida per "${f.filename}"`);
  const note = body.note ? String(body.note).slice(0, 1000) : null;
  const from = row.from_email ? `${row.from_name ? `${row.from_name} ` : ''}<${row.from_email}>` : 'mittente sconosciuto';
  const bufs = new Map();
  for (const f of chosen) { const b = await readBuffer(f); if (!b) throw bad(`File "${f.filename}" non leggibile dall'archivio`); bufs.set(f.id, b); }

  const closure = await tx(async (c) => {
    const newIds = [];
    for (const f of chosen) {
      const a = (await c.query(`INSERT INTO attachments (resource_id, category, filename, mime, size, data, sha256, expires_at, signed, notes, uploaded_by, inbox_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11) RETURNING id`,
      [resourceId, f.category, f.filename, f.mime, f.size, bufs.get(f.id), f.sha256, f.expires_at, `Ricevuto dalla casella People il ${new Date(row.received_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} da ${from}`.slice(0, 500), req.user.id, id])).rows[0];
      newIds.push({ id: a.id, category: f.category, expires_at: f.expires_at });
      await c.query('UPDATE people_inbox_files SET approved_category=$2, approved_expires_at=$3, include=TRUE, attachment_id=$4 WHERE id=$1', [f.id, f.category, f.expires_at, a.id]);
    }
    await c.query('UPDATE people_inbox_files SET include=FALSE WHERE inbox_id=$1 AND attachment_id IS NULL', [id]);
    const how = await applyClosure(c, { key, item, resourceId, inboxId: id, newIds, note, userId: req.user.id });
    await c.query(`UPDATE people_inbox SET status='APPROVATO', resource_id=$2, deadline_key=$3, decided_by=$4, decided_at=now(), note=$5 WHERE id=$1`, [id, resourceId, key, req.user.id, note]);
    return { attachments: newIds, how };
  });

  // Notifica in app alla persona (se ha un account) ed email di conferma da people@
  const users = await suiteUserIdsOf(resourceId);
  const n = await notify(users, { kind: 'MODULO', module_key: 'contracts', title: 'Documento registrato nel tuo dossier', body: `L'ufficio People ha verificato e registrato ${chosen.length === 1 ? 'il documento inviato' : `${chosen.length} documenti inviati`}${item ? ` per "${item.title}"` : ''}.` }).catch(() => 0);
  const dest = await personEmail(resourceId, row.from_email);
  let mail = null;
  if (dest.to) {
    const list = closure.attachments.map((a) => `<li>${esc(CATEGORY_LABELS[a.category] || a.category)}${a.expires_at ? `, valido fino al ${itDate(a.expires_at)}` : ''}</li>`).join('');
    const html = layout('Documento ricevuto e registrato', `<p>Gentile ${esc(dest.name)},</p><p>abbiamo verificato e registrato nel tuo dossier:</p><ul>${list}</ul>${item ? `<p>La scadenza <b>${esc(item.title)}</b> è chiusa.</p>` : ''}<p>Grazie,<br>Ufficio People · Toscana Diagnostica</p>`, { footer: 'Ufficio People · Toscana Diagnostica' });
    mail = await sendFromPeople({ to: [dest.to], subject: `Toscana Diagnostica · documento ricevuto e registrato${key ? ` ${scadTag(key)}` : ''}`, html, text: 'Documento ricevuto e registrato nel dossier', ref: `contracts:people:approvato:${id}` });
  }
  await audit(req, 'PEOPLE_INBOX_APPROVE', 'people_inbox', id, { resource_id: resourceId, deadline_key: key, attachments: closure.attachments.map((a) => a.id), categories: closure.attachments.map((a) => a.category), closure: closure.how, notified: n, email: mail?.status || null });
  return { ok: true, attachments: closure.attachments, closure: closure.how, notified: n, email: mail?.status || null };
}

export async function rejectMessage(req, id, { reason }) {
  const row = await loadInbox(id);
  if (row.status !== 'DA_APPROVARE') throw bad('Messaggio già gestito');
  const why = String(reason || '').trim();
  if (why.length < 5) throw bad('Indica il motivo del rifiuto (cosa manca o cosa non va)');
  await q(`UPDATE people_inbox SET status='RIFIUTATO', decided_by=$2, decided_at=now(), note=$3 WHERE id=$1`, [id, req.user.id, why.slice(0, 1000)]);
  const dest = row.resource_id ? await personEmail(row.resource_id, row.from_email) : { to: row.from_email, name: row.from_name || '' };
  let mail = null;
  if (dest.to) {
    const html = layout('Documento non accettato', `<p>Gentile ${esc(dest.name)},</p><p>il documento che ci hai inviato non può essere registrato nel dossier.</p><p><b>Motivo:</b> ${esc(why)}</p><p>Rispondi a questa email allegando il documento corretto: verrà preso in carico automaticamente.</p><p>Grazie,<br>Ufficio People · Toscana Diagnostica</p>`, { footer: 'Ufficio People · Toscana Diagnostica' });
    mail = await sendFromPeople({ to: [dest.to], subject: `Toscana Diagnostica · documento da reinviare${row.deadline_key ? ` ${scadTag(row.deadline_key)}` : ''}`, html, text: `Documento non accettato. Motivo: ${why}`, ref: `contracts:people:rifiutato:${id}` });
  }
  await audit(req, 'PEOPLE_INBOX_REJECT', 'people_inbox', id, { resource_id: row.resource_id, deadline_key: row.deadline_key, email: mail?.status || null });
  return { ok: true, email: mail?.status || null };
}

export async function ignoreMessage(req, id, { note }) {
  const row = await loadInbox(id);
  if (row.status !== 'DA_APPROVARE') throw bad('Messaggio già gestito');
  await q(`UPDATE people_inbox SET status='IGNORATO', decided_by=$2, decided_at=now(), note=$3 WHERE id=$1`, [id, req.user.id, note ? String(note).slice(0, 1000) : null]);
  await audit(req, 'PEOPLE_INBOX_IGNORE', 'people_inbox', id, { from: row.from_email });
  return { ok: true };
}

export { peopleSettings };
