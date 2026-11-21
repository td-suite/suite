// Non conformità · azioni assegnate a una persona (v0.93.0, CEO 21/11/2026). Il responsabile di un'azione correttiva o preventiva è una
// persona dell'anagrafica (dipendente o libero professionista): alla assegnazione riceve una notifica della Suite e trova l'azione in
// "Le mie azioni" del widget NC, dove ne aggiorna lo stato (pianificata, in corso, completata) con una nota. Chi non ha un profilo sul
// widget entra con il profilo implicito AZIONI, che vede SOLO le proprie azioni: della NC gli arrivano codice, tipologia e sede, mai
// i dati dell'accettazione o del paziente.
import { one, many, q } from '../db.js';
import { bad } from './util.js';
import { notify } from '../../../lib/community.js';

export const STATI_RESPONSABILE = ['PIANIFICATA', 'IN_CORSO', 'COMPLETATA'];
const APERTE = `('PIANIFICATA','IN_CORSO')`;

/** Personale assegnabile: dipendenti e liberi professionisti attivi, con l'indicazione se hanno un accesso alla Suite. */
export async function personaleAssegnabile() {
  return many(`SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.kind, p.job_title,
      EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = p.id AND u.status = 'ACTIVE') AS ha_accesso
    FROM public.people p WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP') ORDER BY p.last_name, p.first_name`);
}

/** Persona assegnabile per id: { id, nome, user_ids } oppure null. */
export async function personaAssegnabile(id) {
  const p = await one(`SELECT p.id, p.last_name || ' ' || p.first_name AS nome FROM public.people p WHERE p.id = $1 AND p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP')`, [Number(id)]);
  if (!p) return null;
  const us = await many(`SELECT id FROM public.users WHERE person_id = $1 AND status = 'ACTIVE'`, [p.id]);
  return { ...p, user_ids: us.map((u) => u.id) };
}

const itDate = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y ? `${d}/${m}/${y}` : ''; };
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/** Notifica al responsabile (campanella della Suite, con il link a "Le mie azioni"). Ritorna quanti utenti sono stati avvisati. */
export async function avvisaResponsabile(azione, nc, persona) {
  if (!persona?.user_ids?.length) return 0;
  const tipo = azione.tipo === 'PREVENTIVA' ? 'preventiva' : 'correttiva';
  const n = await notify(persona.user_ids, { kind: 'TASK', module_key: 'nc', title: `Azione ${tipo} assegnata a te · ${nc.codice}`,
    body: `${String(azione.descrizione).slice(0, 300)}${azione.scadenza ? ` · entro il ${itDate(iso(azione.scadenza))}` : ''}`, link: '/nc/mie-azioni' });
  await q('UPDATE nc_azioni SET assegnata_at = now() WHERE id = $1', [azione.id]);
  return n;
}

const COLONNE = `a.id, a.nc_id, a.tipo, a.descrizione, a.scadenza::text AS scadenza, a.stato, a.note, a.resp_nota, a.resp_aggiornata_at, a.completata_at, a.created_at, a.assegnata_at,
  n.codice AS nc_codice, n.stato AS nc_stato, coalesce(t.label, n.tipo_altro) AS nc_tipo, s.nome AS sede, cu.full_name AS assegnata_da`;
const DA = `FROM nc_azioni a JOIN nc n ON n.id = a.nc_id LEFT JOIN nc_tipi t ON t.id = n.tipo_id LEFT JOIN sedi_v s ON s.id = n.sede_id LEFT JOIN users cu ON cu.id = a.created_by`;

/** Le azioni di una persona: prima le aperte per scadenza, poi le chiuse più recenti. */
export async function mieAzioni(personId) {
  if (!personId) return [];
  return many(`SELECT ${COLONNE}, (a.stato IN ${APERTE} AND a.scadenza < CURRENT_DATE) AS scaduta ${DA}
    WHERE a.responsabile_person_id = $1 AND n.stato <> 'ANNULLATA'
    ORDER BY (a.stato IN ${APERTE}) DESC, a.scadenza NULLS LAST, a.created_at DESC LIMIT 300`, [Number(personId)]);
}
export async function contaMieAperte(personId) {
  if (!personId) return 0;
  return (await one(`SELECT count(*)::int AS n FROM nc_azioni a JOIN nc n ON n.id = a.nc_id WHERE a.responsabile_person_id = $1 AND a.stato IN ${APERTE} AND n.stato <> 'ANNULLATA'`, [Number(personId)])).n;
}
export async function haAzioni(personId) {
  if (!personId) return false;
  return Boolean(await one('SELECT 1 FROM nc_azioni WHERE responsabile_person_id = $1 LIMIT 1', [Number(personId)]));
}

/** Aggiornamento del responsabile: stato e nota della propria azione. Avvisa chi l'ha assegnata e la Qualità. */
export async function aggiornaMia(personId, azioneId, { stato, nota }, chi) {
  const cur = await one(`SELECT a.*, n.codice, n.stato AS nc_stato FROM nc_azioni a JOIN nc n ON n.id = a.nc_id WHERE a.id = $1 AND a.responsabile_person_id = $2`, [Number(azioneId), Number(personId)]);
  if (!cur) return null;
  if (cur.stato === 'ANNULLATA' || cur.nc_stato === 'ANNULLATA') throw bad('Azione annullata: non si aggiorna');
  const a = await one(`UPDATE nc_azioni SET stato = coalesce($2, stato), resp_nota = coalesce($3, resp_nota), resp_aggiornata_at = now(),
      completata_at = CASE WHEN coalesce($2, stato) = 'COMPLETATA' THEN coalesce(completata_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1 RETURNING *`,
  [cur.id, stato ?? null, nota != null ? String(nota).trim() || null : null]);
  await q('UPDATE nc SET version = version + 1, updated_at = now() WHERE id = $1', [cur.nc_id]);
  // avviso a chi ha assegnato l'azione e ai profili Qualità del widget (utenti Suite con la stessa email dell'utente del modulo)
  const dest = await many(`SELECT DISTINCT su.id FROM users mu JOIN public.users su ON lower(su.email) = lower(mu.email) AND su.status = 'ACTIVE'
    WHERE (mu.id = $1 OR mu.role = 'QUALITA') AND su.id <> $2`, [cur.created_by, chi?.suite_user_id || 0]);
  if (dest.length && (stato && stato !== cur.stato || nota)) {
    const et = { PIANIFICATA: 'pianificata', IN_CORSO: 'in corso', COMPLETATA: 'completata' }[a.stato] || a.stato;
    await notify(dest.map((d) => d.id), { kind: 'INFO', module_key: 'nc', title: `${cur.codice} · azione ${et}${chi?.full_name ? ` (${chi.full_name})` : ''}`,
      body: [String(cur.descrizione).slice(0, 160), nota ? `Nota: ${String(nota).slice(0, 300)}` : null].filter(Boolean).join(' · '), link: `/nc/nc/${cur.nc_id}` });
  }
  return { prima: cur, dopo: a };
}

/** Contatore della Home per chi non ha un profilo sul widget: le azioni aperte assegnate a lui (chi ha un profilo tiene il contatore del modulo). */
export async function contatoreHome(user) {
  if (!user?.person_id || user.grants?.nc || user.level === 'OWNER' || user.level === 'ADMIN') return null;
  const st = await one(`SELECT mode FROM public.module_state WHERE key = 'nc'`);
  if (st?.mode !== 'LIVE') return null;
  const n = await contaMieAperte(user.person_id);
  return n ? { value: n, label: n === 1 ? 'Azione da fare' : 'Azioni da fare' } : null;
}
