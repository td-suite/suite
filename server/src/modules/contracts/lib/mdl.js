// Medicina del lavoro (v0.77.0, richiesta del CEO del 16/11/2026): sorveglianza sanitaria ex art. 41 D.Lgs. 81/2008 per dipendenti e
// tirocinanti. In Suite stanno SOLO il giudizio di idoneità alla mansione, le eventuali prescrizioni o limitazioni, il protocollo
// sanitario assegnato e il calendario delle visite. Mai diagnosi, esiti di accertamenti, cartella sanitaria e di rischio: restano al
// medico competente. La sezione è visibile ai profili ADMIN e HR e al titolare; le convocazioni le fanno gli amministratori del modulo.
import { many, one, q, tx } from '../db.js';
import { sendFromPeople, hrEmails, peopleSettings } from './peopleMail.js';
import { layout } from '../../../lib/mailer.js';

export const GIUDIZI = { IDONEO: 'Idoneo', IDONEO_PRESCRIZIONI: 'Idoneo con prescrizioni', IDONEO_LIMITAZIONI: 'Idoneo con limitazioni', NON_IDONEO_TEMPORANEO: 'Non idoneo temporaneo', NON_IDONEO_PERMANENTE: 'Non idoneo permanente' };
export const TIPI_VISITA = { PREVENTIVA: 'Preventiva', PERIODICA: 'Periodica', CAMBIO_MANSIONE: 'Cambio mansione', RIENTRO: 'Rientro dopo assenza superiore a 60 giorni', RICHIESTA_LAVORATORE: 'Su richiesta del lavoratore', CESSAZIONE: 'Alla cessazione', STRAORDINARIA: 'Straordinaria' };
export const STATI_VISITA = { PROGRAMMATA: 'Programmata', CONVOCATA: 'Convocata', EFFETTUATA: 'Effettuata', ANNULLATA: 'Annullata', NON_PRESENTATO: 'Non presentato' };
export const soggettiMdl = ['DIPENDENTE', 'TIROCINANTE'];

const iso = (d) => (d instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d) : d ? String(d).slice(0, 10) : null);
const addMonths = (d, n) => { const x = new Date(`${iso(d)}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const itDate = (d) => { const s = iso(d); return s ? s.split('-').reverse().join('/') : ''; };
const giorni = (d, oggi) => Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${oggi}T12:00:00Z`)) / 86400000);

/**
 * Posizione di una persona (calcolo puro): ultimo giudizio, prossima visita dovuta e visita già fissata.
 * - prossima = scadenza dell'ultima visita effettuata; se manca, data della visita + periodicità (scheda, protocollo, 12 mesi);
 * - senza alcuna visita effettuata e con sorveglianza attiva: visita preventiva dovuta all'ingresso;
 * - un giudizio di non idoneità temporanea senza scadenza chiede la rivalutazione entro la periodicità.
 */
export function posizioneMdl({ persona, scheda, protocollo, visite, oggi }) {
  const attiva = scheda ? scheda.sorveglianza !== false : true;
  const periodicita = Number(scheda?.periodicita_mesi || protocollo?.periodicita_mesi || 12);
  const fatte = visite.filter((v) => v.stato === 'EFFETTUATA' && v.data_visita).sort((a, b) => iso(b.data_visita).localeCompare(iso(a.data_visita)));
  const ultima = fatte[0] || null;
  const fissata = visite.filter((v) => ['PROGRAMMATA', 'CONVOCATA'].includes(v.stato) && v.data_prevista).sort((a, b) => iso(a.data_prevista).localeCompare(iso(b.data_prevista)))[0] || null;
  let prossima = null, motivo = null;
  if (attiva) {
    if (ultima) { prossima = iso(ultima.scadenza) || addMonths(ultima.data_visita, periodicita); motivo = 'Visita periodica'; }
    else { prossima = iso(persona.hired_at) || oggi; motivo = 'Visita preventiva'; }
  }
  const gg = prossima ? giorni(prossima, oggi) : null;
  // Posizione impostata = l'ufficio ha aperto la scheda o registrato almeno una visita. Finché non lo è, la persona compare in elenco come
  // "da impostare" ma non genera scadenze né richiami: al primo avvio nessuno ha visite registrate e sarebbero tutti falsi allarmi.
  const impostata = Boolean(scheda) || visite.length > 0;
  const stato = !attiva ? 'NON_SOGGETTO' : !impostata ? 'DA_IMPOSTARE' : !ultima ? 'DA_FARE' : gg < 0 ? 'SCADUTA' : gg <= 30 ? 'IMMINENTE' : gg <= 90 ? 'PROSSIMA' : 'IN_REGOLA';
  return { sorveglianza: attiva, impostata, periodicita_mesi: periodicita, ultima_visita: ultima ? iso(ultima.data_visita) : null, giudizio: ultima?.giudizio || null, prescrizioni: ultima?.prescrizioni || null,
    prossima, giorni: gg, motivo, stato, fissata: fissata ? { id: fissata.id, data: iso(fissata.data_prevista), ora: fissata.ora, luogo: fissata.luogo, stato: fissata.stato } : null };
}

/** Elenco dei soggetti a sorveglianza (dipendenti e tirocinanti attivi o in ingresso) con la posizione di ciascuno. */
export async function elencoMdl({ resourceId = null, oggi = null } = {}) {
  const t = oggi || iso(new Date());
  const persone = await many(`SELECT r.id, r.last_name, r.first_name, r.kind, r.status, r.email, r.hired_at, r.terminated_at, coalesce(e.job_title, r.person_job_title) AS job_title,
      coalesce(a.name, r.area_label) AS area_name, s.name AS site_name
    FROM resources_v r LEFT JOIN employments e ON e.resource_id=r.id LEFT JOIN areas a ON a.id=r.area_id LEFT JOIN public.sites s ON s.id=r.site_id
    WHERE r.kind = ANY($1) AND ${resourceId ? 'r.id=$2' : "r.status IN ('ATTIVO','IMPEGNO')"} ORDER BY r.last_name, r.first_name`, resourceId ? [soggettiMdl, resourceId] : [soggettiMdl]);
  if (!persone.length) return [];
  const ids = persone.map((p) => p.id);
  const schede = new Map((await many('SELECT * FROM mdl_schede WHERE resource_id = ANY($1)', [ids])).map((x) => [x.resource_id, x]));
  const protocolli = new Map((await many('SELECT * FROM mdl_protocolli')).map((x) => [x.id, x]));
  const visite = await many('SELECT * FROM mdl_visite WHERE resource_id = ANY($1)', [ids]);
  const perPersona = new Map(); for (const v of visite) { if (!perPersona.has(v.resource_id)) perPersona.set(v.resource_id, []); perPersona.get(v.resource_id).push(v); }
  return persone.map((p) => {
    const scheda = schede.get(p.id) || null; const protocollo = scheda?.protocollo_id ? protocolli.get(scheda.protocollo_id) || null : null;
    return { id: p.id, nome: `${p.last_name} ${p.first_name}`, last_name: p.last_name, first_name: p.first_name, kind: p.kind, status: p.status, email: p.email, mansione: scheda?.mansione || p.job_title || null,
      area: p.area_name, sede: p.site_name, protocollo: protocollo?.nome || null, ...posizioneMdl({ persona: p, scheda, protocollo, visite: perPersona.get(p.id) || [], oggi: t }) };
  });
}

/** Testo della convocazione: appuntamento e istruzioni pratiche, nessun dato sanitario. */
export function emailConvocazione({ persona, data, ora, luogo, medico, note, tipo }) {
  const quando = `${itDate(data)}${ora ? ` alle ore ${ora}` : ''}`;
  const subject = `Toscana Diagnostica · convocazione alla visita di medicina del lavoro del ${itDate(data)}`;
  const righe = [`<p>Gentile ${esc(persona.first_name)} ${esc(persona.last_name)},</p>`,
    `<p>ti convochiamo alla <b>visita medica ${esc((TIPI_VISITA[tipo] || 'periodica').toLowerCase())}</b> prevista dalla sorveglianza sanitaria (art. 41 del D.Lgs. 81/2008).</p>`,
    `<p><b>Quando:</b> ${esc(quando)}<br>${luogo ? `<b>Dove:</b> ${esc(luogo)}<br>` : ''}${medico ? `<b>Medico competente:</b> ${esc(medico)}` : ''}</p>`,
    note ? `<p>${esc(note)}</p>` : '',
    '<p>La visita si svolge in orario di lavoro ed è un obbligo sia per l\'azienda sia per il lavoratore. Se hai un impedimento rispondi a questa email entro due giorni lavorativi: concorderemo un\'altra data. Non inviare referti o documentazione sanitaria a questo indirizzo: si consegnano solo al medico competente il giorno della visita.</p>'];
  const text = `Convocazione alla visita di medicina del lavoro: ${quando}${luogo ? `, ${luogo}` : ''}${medico ? `, medico competente ${medico}` : ''}. ${note || ''}`.trim();
  return { subject, html: layout('Convocazione alla visita di medicina del lavoro', righe.join(''), { footer: 'Ufficio People · Toscana Diagnostica' }), text };
}

/**
 * Convocazione di più persone alla stessa data: crea una visita CONVOCATA per ciascuna (o aggiorna quella già fissata) e, se richiesto,
 * invia la convocazione dalla casella People con l'HR in copia. Chi non ha un indirizzo email resta convocato ma senza invio: l'esito lo dice.
 */
export async function convoca({ personIds, data, ora, luogo, medico, note, tipo = null, invia = true, userId }) {
  const elenco = (await elencoMdl()).filter((p) => personIds.includes(p.id));
  if (!elenco.length) return { convocazione: null, esiti: [] };
  const S = await peopleSettings(); const cc = invia ? await hrEmails(S) : [];
  const conv = await one('INSERT INTO mdl_convocazioni (data, ora, luogo, medico, note, persone, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [data, ora || null, luogo || null, medico || null, note || null, elenco.length, userId || null]);
  const esiti = [];
  for (const p of elenco) {
    const t = tipo || (p.ultima_visita ? 'PERIODICA' : 'PREVENTIVA');
    await tx(async (c) => {
      if (p.fissata) await c.query(`UPDATE mdl_visite SET stato='CONVOCATA', data_prevista=$2, ora=$3, luogo=$4, medico=$5, convocazione_id=$6, updated_at=now() WHERE id=$1`, [p.fissata.id, data, ora || null, luogo || null, medico || null, conv.id]);
      else await c.query(`INSERT INTO mdl_visite (resource_id, tipo, stato, data_prevista, ora, luogo, medico, convocazione_id, created_by) VALUES ($1,$2,'CONVOCATA',$3,$4,$5,$6,$7,$8)`, [p.id, t, data, ora || null, luogo || null, medico || null, conv.id, userId || null]);
    });
    let esito = { id: p.id, nome: p.nome, email: p.email || null, stato: 'SENZA_INVIO', errore: null };
    if (invia && p.email) {
      const mail = emailConvocazione({ persona: p, data, ora, luogo, medico, note, tipo: t });
      const r = await sendFromPeople({ to: [p.email], cc: cc.filter((x) => x !== String(p.email).toLowerCase()), subject: mail.subject, html: mail.html, text: mail.text, ref: `contracts:mdl:convocazione:${conv.id}:${p.id}` });
      esito = { ...esito, stato: r.status, errore: r.error || null };
    } else if (invia) esito.stato = 'SENZA_EMAIL';
    esiti.push(esito);
  }
  await q('UPDATE mdl_convocazioni SET esiti=$2, inviate=$3 WHERE id=$1', [conv.id, JSON.stringify(esiti), esiti.filter((e) => ['INVIATO', 'REGISTRATO'].includes(e.stato)).length]);
  return { convocazione: conv.id, esiti };
}
