// Business Hub · caselle di posta per linea (richiesta del CEO del 06/11/2026): "Per Service di Laboratorio metti in ascolto e usa
// per inviare service@toscanadiagnostica.it; per Punti Prelievo network@; per MDL mdl@. L'invio al cliente voglio farlo da qui in modo
// che l'istanza venga effettivamente registrata."
// - Lettura (job business:inbox ogni 10 minuti, lib condivisa server/src/lib/graphInbox.js come Contracts e Referti): ogni messaggio
//   nuovo si abbina all'account per indirizzo del mittente (referenti, persone e utenti della Legal entity, email e PEC della Legal
//   entity, sedi del gruppo) o per dominio (lib/hub.js abbinaEmail). Abbinato → attività EMAIL_IN nel diario (oggetto, anteprima del
//   testo, allegati nell'archivio del modulo) e notifica in app all'owner; non abbinato → "Email da assegnare" nel cruscotto.
// - Invio: "Scrivi al cliente" dalla scheda account, mittente = casella della linea (sendMail con from), copie fisse per linea
//   (Impostazioni, sempre presenti), allegati dai documenti dell'account o dai contratti della Legal entity; attività EMAIL_OUT con
//   esito INVIATO / REGISTRATO (posta in modalità registro) / FALLITO e riferimento al registro email della Suite.
// Privacy: nei log del server solo linea, id ed esiti; mai oggetto, corpo o indirizzi. Nel registro email della Suite l'oggetto è
// "Business Hub · account N".
import { randomUUID } from 'node:crypto';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { config as suite } from '../../../config.js';
import { sendMail } from '../../../lib/mailer.js';
import { notify } from '../../../lib/community.js';
import { graphConfigured, graphToken, tokenRoles, resolveMailbox, messaggiDa, allegatiFile, provaCasella, motivoLettura, motivoInvio } from '../../../lib/graphInbox.js';
import { getSettings } from './rules.js';
import { LINEE, LINEE_KEYS, abbinaEmail, indirizzi, emailValida } from './hub.js';
import { storeBuffer } from './storage.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MAX_ALLEGATO = 20 * 1024 * 1024;
export async function setSetting(k, v) { await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v ?? '')]); }

export function casella(linea, s) {
  if (config.mailboxEnv[linea]) return { address: config.mailboxEnv[linea], source: 'env' };
  const a = String(s?.[`hub_casella_${linea}`] || '').trim().toLowerCase();
  return { address: a || LINEE[linea].casella, source: a && a !== LINEE[linea].casella ? 'setting' : 'default' };
}
export const ccFissi = (linea, s) => indirizzi(s?.[`hub_cc_${linea}`] || '');
export const letturaAttiva = (linea, s) => String(s?.[`hub_lettura_${linea}`] ?? 'true') !== 'false';

export async function statoCaselle() {
  const s = await getSettings();
  const mi = await many(`SELECT linea, count(*)::int AS letti, count(*) FILTER (WHERE stato='ABBINATO')::int AS abbinati, count(*) FILTER (WHERE stato='DA_ASSEGNARE')::int AS da_assegnare,
    count(*) FILTER (WHERE simulato)::int AS simulati FROM email_in GROUP BY linea`);
  const mo = await many(`SELECT a.linea, count(*) FILTER (WHERE x.email_stato='INVIATO')::int AS inviati, count(*) FILTER (WHERE x.email_stato='REGISTRATO')::int AS registrati,
    count(*) FILTER (WHERE x.email_stato='FALLITO')::int AS falliti, max(x.at) AS ultimo_invio FROM activities x JOIN accounts a ON a.id=x.account_id WHERE x.tipo='EMAIL_OUT' GROUP BY a.linea`);
  return {
    graph_configured: graphConfigured(), mail_provider: suite.mail.provider, intervallo_minuti: config.inboxMinutes, simulazione: process.env.NODE_ENV !== 'production',
    caselle: LINEE_KEYS.map((l) => {
      const mb = casella(l, s);
      return { linea: l, label: LINEE[l].label, address: mb.address, source: mb.source, lettura: letturaAttiva(l, s), cc: ccFissi(l, s),
        ultima_lettura: s[`hub_ultima_lettura_${l}`] || null, errore: s[`hub_errore_${l}`] || null,
        messaggi: mi.find((x) => x.linea === l) || { letti: 0, abbinati: 0, da_assegnare: 0, simulati: 0 },
        invii: mo.find((x) => x.linea === l) || { inviati: 0, registrati: 0, falliti: 0, ultimo_invio: null } };
    }),
  };
}

// Indirizzi noti per l'abbinamento: { email, account_id, linea, fonte }
export async function vociAbbinamento() {
  return many(`
    SELECT lower(c.email) AS email, a.id AS account_id, a.linea, 'referente' AS fonte FROM contatti c JOIN accounts a ON a.id=c.account_id WHERE c.email IS NOT NULL
    UNION ALL SELECT lower(p.email), a.id, a.linea, 'persona della Legal entity' FROM public.people p JOIN accounts a ON a.organization_id=p.organization_id WHERE p.email IS NOT NULL
    UNION ALL SELECT lower(u.email), a.id, a.linea, 'utente della Legal entity' FROM public.users u LEFT JOIN public.people p ON p.id=u.person_id JOIN accounts a ON a.organization_id=coalesce(p.organization_id, u.organization_id) WHERE u.is_external
    UNION ALL SELECT lower(e.x), a.id, a.linea, 'Legal entity' FROM accounts a JOIN public.organizations o ON o.id=a.organization_id, LATERAL (VALUES (o.email), (o.pec)) e(x) WHERE e.x IS NOT NULL
    UNION ALL SELECT lower(e.x), a.id, a.linea, 'riferimenti Business della Legal entity' FROM accounts a JOIN org_ext x ON x.org_id=a.organization_id, LATERAL (VALUES (x.svc_email), (x.proc_email)) e(x) WHERE e.x IS NOT NULL
    UNION ALL SELECT lower(s->>'email'), a.id, a.linea, 'struttura del gruppo' FROM accounts a, jsonb_array_elements(a.sedi) s WHERE s->>'email' IS NOT NULL`);
}

async function owner(accountId) { return one('SELECT a.id, a.owner_user_id, o.name AS org_name, a.linea FROM accounts a JOIN public.organizations o ON o.id=a.organization_id WHERE a.id=$1', [accountId]); }

// Attività EMAIL_IN per un messaggio abbinato (dal job, dalla simulazione o dall'assegnazione manuale)
async function registraArrivo(m, accountId, userId = null) {
  const act = await one(`INSERT INTO activities (account_id, tipo, at, user_id, oggetto, testo, email_message_id, graph_id, email_from, email_stato, dati)
    VALUES ($1,'EMAIL_IN',$2,$3,$4,$5,$6,$7,$8,'RICEVUTO',$9) ON CONFLICT (graph_id) WHERE graph_id IS NOT NULL DO NOTHING RETURNING id`,
  [accountId, m.received_at, userId, m.subject || '(senza oggetto)', m.preview || null, m.message_id, m.graph_id, m.from_email, JSON.stringify({ casella: m.casella, linea: m.linea, from_name: m.from_name, email_in_id: m.id, simulato: m.simulato || undefined })]);
  if (!act) return null;
  await q('UPDATE email_in SET account_id=$2, activity_id=$3, stato=\'ABBINATO\' WHERE id=$1', [m.id, accountId, act.id]);
  await q('UPDATE documenti SET account_id=$2, activity_id=$3 WHERE email_in_id=$1', [m.id, accountId, act.id]);
  const o = await owner(accountId);
  if (o?.owner_user_id) await notify([o.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `Email da ${o.org_name}`.slice(0, 200), body: `Nuovo messaggio nella casella ${m.casella}: registrato nel diario dell'account.`, link: `/business/account/${accountId}` }).catch(() => 0);
  return act.id;
}

/** Ingest di un messaggio (lettura Graph o simulazione di collaudo). files: [{ filename, mime, buffer }] */
export async function ingestEmail({ linea, casella: address, graphId, messageId = null, receivedAt = null, fromEmail, fromName = null, subject = '', preview = '', files = [], simulato = false }) {
  if (await one('SELECT 1 FROM email_in WHERE graph_id=$1', [graphId])) return { duplicato: true };
  const from = String(fromEmail || '').trim().toLowerCase();
  const voci = await vociAbbinamento();
  const m = abbinaEmail(from, voci, linea);
  const row = await one(`INSERT INTO email_in (linea, casella, graph_id, message_id, received_at, from_email, from_name, subject, preview, n_allegati, stato, come, account_id, simulato)
    VALUES ($1,$2,$3,$4,coalesce($5, now()),$6,$7,$8,$9,$10,'DA_ASSEGNARE',$11,NULL,$12) RETURNING *`,
  [linea, address, graphId, messageId, receivedAt, from || null, fromName ? String(fromName).slice(0, 200) : null, String(subject || '').slice(0, 500), String(preview || '').slice(0, 2000), (files || []).length, m.come, simulato]);
  for (const f of files || []) {
    if (!f?.buffer?.length || f.buffer.length > MAX_ALLEGATO) continue;
    const st = await storeBuffer('hub-email', f.filename || 'allegato', f.mime || 'application/octet-stream', f.buffer);
    await q(`INSERT INTO documenti (email_in_id, categoria, filename, mime, size, sha256, data, blob_path) VALUES ($1,'EMAIL',$2,$3,$4,$5,$6,$7)`,
      [row.id, String(f.filename || 'allegato').slice(0, 250), f.mime || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path]);
  }
  let activityId = null;
  if (m.account_id) activityId = await registraArrivo(row, m.account_id);
  console.log(`[business] casella ${linea}: messaggio ${row.id} ${m.account_id ? `abbinato all'account ${m.account_id}` : 'da assegnare'}, ${(files || []).length} allegati`);
  return { id: row.id, abbinato: Boolean(m.account_id), account_id: m.account_id || null, activity_id: activityId, come: m.come, candidati: m.candidati || [] };
}

export async function assegnaEmail(emailInId, accountId, userId) {
  const m = await one('SELECT * FROM email_in WHERE id=$1', [emailInId]);
  if (!m) throw Object.assign(new Error('Messaggio non trovato'), { status: 404 });
  if (m.stato === 'ABBINATO') throw Object.assign(new Error('Messaggio già abbinato a un account'), { status: 400 });
  await q('UPDATE email_in SET come=$2, assegnato_by=$3 WHERE id=$1', [m.id, 'assegnato a mano', userId]);
  return registraArrivo({ ...m, come: 'assegnato a mano' }, accountId, userId);
}

// ---- Lettura delle caselle (job business:inbox e "Leggi ora")
export async function pollCaselle({ force = false, solo = null } = {}) {
  if (!graphConfigured()) return { skipped: 'graph_non_configurato' };
  const s = await getSettings();
  const out = {};
  for (const l of LINEE_KEYS) {
    if (solo && solo !== l) continue;
    if (!force && !letturaAttiva(l, s)) { out[l] = { skipped: 'lettura_disattivata' }; continue; }
    const { address } = casella(l, s);
    const since = s[`hub_since_${l}`] || new Date(Date.now() - 2 * 86400000).toISOString();
    let letti = 0; let abbinati = 0; let last = since;
    try {
      const id = (await resolveMailbox(address)).id;
      for (const msg of await messaggiDa(id, since, { select: 'id,internetMessageId,receivedDateTime,from,subject,hasAttachments,bodyPreview' })) {
        letti++;
        if (msg.receivedDateTime > last) last = msg.receivedDateTime;
        const from = msg.from?.emailAddress || {};
        if (String(from.address || '').toLowerCase() === address) continue;   // i nostri invii
        if (await one('SELECT 1 FROM email_in WHERE graph_id=$1', [msg.id])) continue;
        const files = msg.hasAttachments ? await allegatiFile(id, msg.id, (a) => (a.size || 0) <= MAX_ALLEGATO) : [];
        const r = await ingestEmail({ linea: l, casella: address, graphId: msg.id, messageId: msg.internetMessageId || null, receivedAt: msg.receivedDateTime, fromEmail: from.address, fromName: from.name, subject: msg.subject, preview: msg.bodyPreview, files });
        if (r.abbinato) abbinati++;
      }
      await setSetting(`hub_since_${l}`, last);
      await setSetting(`hub_ultima_lettura_${l}`, new Date().toISOString());
      await setSetting(`hub_errore_${l}`, '');
      out[l] = { letti, abbinati };
    } catch (e) {
      await setSetting(`hub_errore_${l}`, motivoLettura(e.message, address));
      out[l] = { errore: motivoLettura(e.message, address) };
      console.error(`[business] lettura della casella ${l} non riuscita`);
    }
  }
  return out;
}

// ---- Prove dalle Impostazioni
export async function provaLettura(linea) {
  const s = await getSettings();
  return provaCasella(casella(linea, s).address, { serveInvio: true });
}
export async function provaInvio(linea, to) {
  const addr = String(to || '').trim().toLowerCase();
  if (!emailValida(addr)) return { ok: false, message: 'Indirizzo di prova non valido' };
  const s = await getSettings();
  const { address } = casella(linea, s);
  if (suite.mail.provider === 'graph' && graphConfigured()) {
    try {
      const roles = tokenRoles(await graphToken());
      if (roles && !roles.includes('Mail.Send')) return { ok: false, message: `Permesso Mail.Send mancante sull'app registration della Suite. Presenti: ${roles.join(', ') || 'nessuno'}` };
    } catch (e) { return { ok: false, message: motivoInvio(e.message, address) }; }
  }
  const out = await sendMail({ from: address, to: [addr], subject: `Toscana Diagnostica · prova di invio dalla casella ${LINEE[linea].label}`, logSubject: `Business Hub · prova casella ${linea}`,
    html: `<p>Email di prova inviata dalla casella <b>${esc(address)}</b> della Suite TD (Business Hub, ${esc(LINEE[linea].label)}).</p><p>Se la ricevi, le email ai clienti di questa linea partiranno da questo mittente.</p>`, text: 'Prova di invio del Business Hub', ref: `business:prova:${linea}` });
  if (out.ok && !out.logged) return { ok: true, message: `Email di prova inviata da ${address} a ${addr}: verifica la ricezione.` };
  if (out.ok && out.logged) return { ok: true, logged: true, message: `Posta in modalità registro (MAIL_PROVIDER=log): l'email da ${address} a ${addr} è solo nel registro email, nessun invio reale.` };
  return { ok: false, message: motivoInvio(out.error || 'Invio non riuscito', address) };
}

export function corpoHtml(testo) {
  const p = String(testo || '').split(/\n{2,}/).map((x) => `<p style="margin:0 0 12px">${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html lang="it"><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;color:#0f2a33;font-size:14px;line-height:1.55"><div style="max-width:680px;padding:8px 4px">${p}</div></body></html>`;
}

/**
 * Invio dalla scheda account. Restituisce { activity_id, stato, errore, from, to, cc, allegati }.
 * allegati: [{ filename, content, contentType, ref }]
 */
export async function inviaAlCliente({ account, to, ccExtra = [], subject, testo, allegati = [], userId, contattoId = null, contractId = null }) {
  const s = await getSettings();
  const { address } = casella(account.linea, s);
  const cc = [...new Set([...ccFissi(account.linea, s), ...indirizzi(ccExtra)])].filter((x) => !to.includes(x));
  const out = await sendMail({ from: address, to, cc, subject, html: corpoHtml(testo), text: testo, ref: `business:account:${account.id}`, logSubject: `Business Hub · account ${account.id}`,
    attachments: allegati.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) });
  const stato = !out.ok ? 'FALLITO' : out.logged ? 'REGISTRATO' : 'INVIATO';
  const errore = out.ok ? null : motivoInvio(out.error || 'Invio non riuscito', address);
  const act = await one(`INSERT INTO activities (account_id, tipo, user_id, contatto_id, con_chi, oggetto, testo, esito, email_message_id, email_from, email_to, email_cc, email_stato, email_errore, contract_id, dati)
    VALUES ($1,'EMAIL_OUT',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
  [account.id, userId, contattoId, to.join(', '), subject, testo, stato, out.logId ? `email_log:${out.logId}` : null, address, to.join(', '), cc.join(', '), stato, errore, contractId,
    JSON.stringify({ allegati: allegati.map((a) => ({ filename: a.filename, ref: a.ref })), messaggio: randomUUID() })]);
  console.log(`[business] invio email account ${account.id}: ${stato}`);
  return { activity_id: act.id, stato, errore, from: address, to, cc, allegati: allegati.map((a) => a.filename) };
}

export const nuovoIdSimulato = () => `SIM-${randomUUID()}`;
