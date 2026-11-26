// Liste di distribuzione automatiche e testo dell'email di invio (v0.99.4, richiesta del CEO del 26/11/2026).
// Una lista automatica non ha un elenco salvato: i destinatari si calcolano dall'anagrafica della Suite ogni volta (anteprima e invio),
// così chi entra o esce è già a posto. Gli indirizzi aggiunti a mano (copia e incolla) restano nella lista e si sommano.
//  - SERVICE: Legal entity dei clienti service ATTIVI (regola unica della Suite, lib/clienti.js) e sedi di tipo SERVICE attive, con email.
//  - PUNTI_PRELIEVO: sedi di tipo PUNTO_PRELIEVI attive e Legal entity che ospitano un punto prelievi attivo, con email.
//  - INTERNI: dipendenti e liberi professionisti attivi con un utente attivo della Suite (indirizzo di lavoro dell'utente, mai quello
//    della scheda) che lavorano in una sede Laboratorio o Punto Prelievi, oppure con ruolo, titolo o unità Back Office, Flow Manager,
//    Retail Manager, CEO (Chief Executive Officer) o COO (Chief Operating Officer).
import { one, many } from '../db.js';
import { many as suiteMany } from '../../../db.js';
import { clientiAttivi } from '../../../lib/clienti.js';

export const AUTOMATICHE = ['SERVICE', 'PUNTI_PRELIEVO', 'INTERNI'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const senzaDoppioni = (arr) => { const visti = new Set(); return arr.filter((d) => d.email && EMAIL.test(d.email) && !visti.has(d.email) && visti.add(d.email)); };
// ruoli degli interni oltre a chi lavora in Laboratorio e nei Punti Prelievo (regola del CEO)
export const RUOLI_INTERNI = /back\s*-?\s*office|flow\s+manager|retail\s+manager|chief\s+executive|\bceo\b|chief\s+operating|\bcoo\b/i;

export async function destinatariAutomatici(tipo) {
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
    const osp = await suiteMany(`SELECT lower(o.email) AS email, o.name AS nome, o.name AS organizzazione, 'ospita un punto prelievi attivo' AS perche FROM public.organizations o
       WHERE o.active AND coalesce(o.email, '') <> '' AND o.id IN (SELECT s.host_organization_id FROM public.sites s WHERE s.active AND s.kind = 'PUNTO_PRELIEVI' AND s.host_organization_id IS NOT NULL) ORDER BY lower(o.name)`).catch(() => []);
    return senzaDoppioni([...sedi, ...osp]);
  }
  if (tipo === 'INTERNI') {
    const rows = await suiteMany(`SELECT lower(u.email) AS email, p.first_name || ' ' || p.last_name AS nome, p.kind, s.kind AS site_kind, s.name AS site_name,
        concat_ws(' | ', u.title, p.job_title, (SELECT jr.name FROM public.job_roles jr WHERE jr.id = p.role_id),
          (SELECT string_agg(concat_ws(' ', jr.name, ou.name), ' | ') FROM public.org_positions op LEFT JOIN public.job_roles jr ON jr.id = op.role_id LEFT JOIN public.org_units ou ON ou.id = op.unit_id WHERE op.person_id = p.id),
          (SELECT ou.name FROM public.org_units ou WHERE ou.id = p.unit_id)) AS ruoli
      FROM public.people p JOIN public.users u ON u.person_id = p.id AND u.status = 'ACTIVE' AND NOT coalesce(u.is_external, FALSE)
      LEFT JOIN public.sites s ON s.id = coalesce(p.site_id, u.site_id)
     WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP') ORDER BY p.last_name, p.first_name`);
    const out = [];
    for (const r of rows) {
      const ruolo = String(r.ruoli || '').match(RUOLI_INTERNI)?.[0];
      const perche = r.site_kind === 'LABORATORIO' ? `Laboratorio (${r.site_name})` : r.site_kind === 'PUNTO_PRELIEVI' ? `Punto Prelievi (${r.site_name})` : ruolo ? `ruolo: ${ruolo}` : null;
      if (perche) out.push({ email: r.email, nome: r.nome, organizzazione: 'Toscana Diagnostica', perche: `${r.kind === 'LP' ? 'LP' : 'dipendente'} · ${perche}` });
    }
    return senzaDoppioni(out);
  }
  return [];
}

/** Destinatari effettivi di una lista: quelli automatici (se la lista lo è) più quelli aggiunti a mano, senza doppioni. */
export async function destinatariLista(lista) {
  const auto = lista.automatica ? (await destinatariAutomatici(lista.automatica)).map((d) => ({ ...d, origine: 'AUTO' })) : [];
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
