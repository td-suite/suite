// Liste di distribuzione automatiche e testo dell'email di invio (v0.99.4, richiesta del CEO del 26/11/2026).
// Una lista automatica non ha un elenco salvato: i destinatari si calcolano dall'anagrafica della Suite ogni volta (anteprima e invio),
// così chi entra o esce è già a posto. Gli indirizzi aggiunti a mano (copia e incolla) restano nella lista e si sommano.
//  - SERVICE: Legal entity dei clienti service ATTIVI (regola unica della Suite, lib/clienti.js) e sedi di tipo SERVICE attive, con email.
//  - PUNTI_PRELIEVO: SOLO le sedi di tipo PUNTO_PRELIEVI attive, con email (v0.99.5, correzione del CEO: le Legal entity che ospitano
//    un punto sono soggetti amministrativi, non coinvolti nel processo, e non ricevono le circolari).
//  - INTERNI: A SCELTA (v0.99.5, variazione del CEO): i destinatari si spuntano dall'elenco del personale (liste.persone = id delle
//    persone). In elenco: dipendenti e liberi professionisti attivi con un utente interno attivo della Suite. L'indirizzo è quello
//    di lavoro dell'utente, letto a ogni invio; chi cessa o perde l'utente esce da solo. Nessuna regola aggiunge persone da sola.
import { one, many } from '../db.js';
import { many as suiteMany } from '../../../db.js';
import { clientiAttivi } from '../../../lib/clienti.js';

export const AUTOMATICHE = ['SERVICE', 'PUNTI_PRELIEVO', 'INTERNI'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const senzaDoppioni = (arr) => { const visti = new Set(); return arr.filter((d) => d.email && EMAIL.test(d.email) && !visti.has(d.email) && visti.add(d.email)); };
// ruoli suggeriti nella scelta degli interni, oltre a chi lavora in Laboratorio e nei Punti Prelievo
export const RUOLI_INTERNI = /back\s*-?\s*office|flow\s+manager|retail\s+manager|chief\s+executive|\bceo\b|chief\s+operating|\bcoo\b/i;

/** Elenco da cui si scelgono i destinatari della lista Interni: dipendenti e LP attivi con utente interno attivo (email di lavoro). */
export async function personaleInterno() {
  const rows = await suiteMany(`SELECT p.id AS person_id, lower(u.email) AS email, p.last_name || ' ' || p.first_name AS nome, p.kind, s.kind AS site_kind, s.name AS site_name,
      coalesce(nullif(u.title, ''), nullif(p.job_title, ''), (SELECT jr.name FROM public.job_roles jr WHERE jr.id = p.role_id), '') AS ruolo,
      concat_ws(' | ', u.title, p.job_title, (SELECT jr.name FROM public.job_roles jr WHERE jr.id = p.role_id),
        (SELECT string_agg(concat_ws(' ', jr.name, ou.name), ' | ') FROM public.org_positions op LEFT JOIN public.job_roles jr ON jr.id = op.role_id LEFT JOIN public.org_units ou ON ou.id = op.unit_id WHERE op.person_id = p.id),
        (SELECT ou.name FROM public.org_units ou WHERE ou.id = p.unit_id)) AS ruoli
    FROM public.people p JOIN public.users u ON u.person_id = p.id AND u.status = 'ACTIVE' AND NOT coalesce(u.is_external, FALSE)
    LEFT JOIN public.sites s ON s.id = coalesce(p.site_id, u.site_id)
   WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP') AND coalesce(u.email, '') <> '' ORDER BY p.last_name, p.first_name`);
  // suggerito = la regola della 0.99.4 (Laboratorio, Punti Prelievo, ruoli): ora solo un aiuto alla selezione, non aggiunge nessuno
  return rows.filter((r) => EMAIL.test(r.email || '')).map((r) => ({ person_id: Number(r.person_id), email: r.email, nome: r.nome, tipo: r.kind === 'LP' ? 'LP' : 'dipendente', sede: r.site_name || '', ruolo: r.ruolo || '',
    suggerito: r.site_kind === 'LABORATORIO' || r.site_kind === 'PUNTO_PRELIEVI' || RUOLI_INTERNI.test(String(r.ruoli || '')) }));
}

export async function destinatariAutomatici(tipo, lista = null) {
  if (tipo === 'SERVICE') {
    const ids = [...new Set((await clientiAttivi({ linea: 'SRV' }).catch(() => [])).map((c) => c.org_id))];
    const orgs = ids.length ? await suiteMany(`SELECT lower(o.email) AS email, o.name AS nome, o.name AS organizzazione, 'cliente service attivo' AS perche FROM public.organizations o WHERE o.id = ANY($1::int[]) AND coalesce(o.email, '') <> '' ORDER BY lower(o.name)`, [ids]) : [];
    const sedi = await suiteMany(`SELECT lower(s.email) AS email, s.name AS nome, coalesce(o.name, '') AS organizzazione, 'sede service attiva' AS perche FROM public.sites s LEFT JOIN public.organizations o ON o.id = s.organization_id
       WHERE s.active AND s.kind = 'SERVICE' AND coalesce(s.email, '') <> '' ORDER BY lower(s.name)`);
    return senzaDoppioni([...orgs, ...sedi]);
  }
  if (tipo === 'PUNTI_PRELIEVO') {
    const sedi = await suiteMany(`SELECT lower(s.email) AS email, s.name AS nome, coalesce(o.name, '') AS organizzazione, 'punto prelievi attivo' AS perche FROM public.sites s LEFT JOIN public.organizations o ON o.id = s.organization_id
       WHERE s.active AND s.kind = 'PUNTO_PRELIEVI' AND coalesce(s.email, '') <> '' ORDER BY lower(s.name)`);
    return senzaDoppioni(sedi);
  }
  if (tipo === 'INTERNI') {
    const scelti = new Set((lista?.persone || []).map(Number));
    if (!scelti.size) return [];
    return senzaDoppioni((await personaleInterno()).filter((x) => scelti.has(x.person_id)).map((x) => ({ email: x.email, nome: x.nome, organizzazione: 'Toscana Diagnostica', perche: [x.tipo, x.sede, x.ruolo].filter(Boolean).join(' · ') })));
  }
  return [];
}

/** Destinatari effettivi di una lista: quelli automatici (se la lista lo è) più quelli aggiunti a mano, senza doppioni. */
export async function destinatariLista(lista) {
  const auto = lista.automatica ? (await destinatariAutomatici(lista.automatica, lista)).map((d) => ({ ...d, origine: 'AUTO' })) : [];
  const mano = (lista.destinatari || []).map((d) => ({ ...d, origine: 'MANUALE' }));
  return senzaDoppioni([...auto, ...mano]);
}

// ---------------------------------------------------------------- testo dell'email di invio
export const EMAIL_PREDEFINITA = {
  email_oggetto: 'Circolare {protocollo}: {titolo}',
  email_testo: 'Gentile Cliente,\nin allegato la circolare in oggetto.\n\nLa versione digitale, sempre aggiornata, è raggiungibile dal collegamento in calce.\n\nCordiali saluti',
};
export const SEGNAPOSTO = ['protocollo', 'titolo', 'sintesi', 'data', 'decorrenza'];
export async function testoEmail() {
  const rows = await many(`SELECT key, value FROM impostazioni WHERE key IN ('email_oggetto', 'email_testo')`);
  const s = { ...EMAIL_PREDEFINITA };
  for (const r of rows) if (typeof r.value === 'string' && r.value.trim()) s[r.key] = r.value;
  return s;
}
export async function salvaTestoEmail({ email_oggetto, email_testo }) {
  for (const [k, v] of [['email_oggetto', email_oggetto], ['email_testo', email_testo]]) {
    if (v == null) continue;
    await one(`INSERT INTO impostazioni (key, value) VALUES ($1, to_jsonb($2::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() RETURNING key`, [k, String(v)]);
  }
  return testoEmail();
}
/** Sostituisce {protocollo}, {titolo}, {sintesi}, {data}, {decorrenza} con i dati della circolare. */
export const compila = (testo, c, dataIt) => String(testo || '').replace(/\{(protocollo|titolo|sintesi|data|decorrenza)\}/g, (_m, k) => (k === 'data' ? dataIt : String(c[k] ?? '')));
