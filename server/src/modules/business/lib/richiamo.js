// Business Hub · richiamo periodico dei prospect (richiesta del CEO del 06/11/2026): "sulla pipeline, ogni 60 [giorni] parte una mail a chi
// non è cliente invitandoli a diventare nostri clienti, presentando loro l'azienda, i servizi, l'offerta, il portale service e invitandoli
// a contattarci rispondendo a service@ e francesco.epifani@, oltre a fornire i nostri recapiti (Francesco Epifani, Rosetta Greco)".
// Il CEO ha scritto "60 mesi": interpretato come 60 giorni, modificabile in Impostazioni (hub_richiamo_giorni). Job giornaliero
// business:richiamo-prospect (lo scheduler lo controlla ogni ora, parte una volta al giorno dopo le 9 ora di Roma), interruttore generale
// hub_richiamo_attivo spento di default, limite giornaliero hub_richiamo_limite (20). Ogni invio: da service@ con le copie fisse, il
// pacchetto di presentazione in allegato (variante PROSPECT: senza credenziali né offerta, Vademecum come link), EMAIL_OUT "RICHIAMO" nel
// diario, data dell'ultimo richiamo sull'account. I recapiti vengono dall'anagrafica (persone e utenti) per gli indirizzi indicati in
// Impostazioni (hub_richiamo_recapiti): nome, ruolo, telefono d'ufficio se ci sono, altrimenti solo l'email. Nessun dato inventato.
import { one, many, q } from '../db.js';
import { getSettings } from './rules.js';
import { indirizzi } from './hub.js';
import { casella, inviaAlCliente } from './caselle.js';
import { readBuffer } from './storage.js';
import { todayRome } from './util.js';
import { prospectDaRichiamare, compila } from './processo.js';
import { modelliFlusso } from './pacchettoGenera.js';

const CHIAVE_GIORNO = 'hub_richiamo_ultimo_giorno';

/** Candidati con l'email da usare (referente principale con email, altrimenti email della Legal entity) e l'ultima email inviata. */
async function candidati() {
  return many(`SELECT a.id, a.linea, a.fase_corrente, a.cliente_attivo, a.non_contattare, a.contrattualizzato_at, a.ultimo_richiamo_at, a.priorita, o.name AS org_name,
      c.id AS contatto_id, c.nome AS contatto_nome, coalesce(c.email, nullif(o.email,'')) AS email,
      (SELECT max(x.at) FROM activities x WHERE x.account_id=a.id AND x.tipo='EMAIL_OUT' AND coalesce(x.sottotipo,'') <> 'INVITO_SUITE') AS ultima_email_at
    FROM accounts a JOIN public.organizations o ON o.id=a.organization_id
    LEFT JOIN LATERAL (SELECT id, nome, email FROM contatti WHERE account_id=a.id AND email IS NOT NULL ORDER BY principale DESC, id LIMIT 1) c ON TRUE
    WHERE a.linea='SRV'`);
}

/** Recapiti per l'email (Impostazioni hub_richiamo_recapiti): "Nome Cognome, ruolo · email · telefono" dai soli dati presenti. */
export async function recapiti(s) {
  const out = [];
  for (const e of indirizzi(s.hub_richiamo_recapiti)) {
    const p = await one(`SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)),''), u.full_name) AS nome,
        nullif(p.job_title,'') AS ruolo, coalesce(nullif(p.phone_office,''), nullif(u.phone,'')) AS telefono
      FROM public.users u FULL JOIN public.people p ON p.id=u.person_id WHERE lower(coalesce(u.email, p.email))=$1 LIMIT 1`, [e]);
    const ruolo = p?.ruolo || (e === String(s.lr_email || '').toLowerCase() ? s.lr_role : null);
    out.push(`- ${[p?.nome ? `${p.nome}${ruolo ? `, ${ruolo}` : ''}` : null, e, p?.telefono].filter(Boolean).join(' · ')}`);
  }
  return out.join('\n');
}

/** Richiami già partiti oggi (ora di Roma), anche a mano: il limite è giornaliero. */
async function richiamiDiOggi() {
  return Number((await one(`SELECT count(*)::int AS n FROM activities WHERE sottotipo='RICHIAMO' AND (at AT TIME ZONE 'Europe/Rome')::date = (now() AT TIME ZONE 'Europe/Rome')::date`)).n);
}

/** Chi riceverebbe il richiamo oggi (anteprima del cruscotto, senza scrivere). */
export async function anteprimaRichiamo() {
  const s = await getSettings();
  const giorni = Number(s.hub_richiamo_giorni) || 60; const limite = Number(s.hub_richiamo_limite) || 20;
  const fatti = await richiamiDiOggi();
  const sel = prospectDaRichiamare(await candidati(), { oggi: todayRome(), giorni, limite: Math.max(0, limite - fatti) });
  const motivi = sel.esclusi.reduce((m, x) => { m[x.motivo.replace(/ il \d{4}-\d{2}-\d{2}$/, '')] = (m[x.motivo.replace(/ il \d{4}-\d{2}-\d{2}$/, '')] || 0) + 1; return m; }, {});
  const riga = (a) => ({ id: a.id, org_name: a.org_name, fase_corrente: a.fase_corrente, priorita: a.priorita, email: a.email, contatto: a.contatto_nome, ultimo_richiamo_at: a.ultimo_richiamo_at });
  return { attivo: String(s.hub_richiamo_attivo) === 'true', giorni, limite, gia_oggi: fatti, oggi: sel.selezionati.map(riga), in_coda: sel.in_coda.length, esclusi: motivi, ultimo_giorno: s[CHIAVE_GIORNO] || null, casella: casella('SRV', s).address };
}

/**
 * Esecuzione: invia il richiamo ai selezionati di oggi (limite giornaliero). opz: { manuale (dal pulsante "Esegui ora"), userId }.
 * Il job automatico parte una volta al giorno, dopo le 9 (ora di Roma), solo con l'interruttore acceso.
 */
export async function eseguiRichiamo({ manuale = false, userId = null } = {}) {
  const s = await getSettings();
  if (String(s.hub_richiamo_attivo) !== 'true') return { skipped: 'interruttore spento' };
  const oggi = todayRome();
  const ora = Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
  if (!manuale && (s[CHIAVE_GIORNO] === oggi || ora < 9)) return { skipped: s[CHIAVE_GIORNO] === oggi ? 'già eseguito oggi' : 'prima delle 9' };
  await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_GIORNO, oggi]);
  const giorni = Number(s.hub_richiamo_giorni) || 60; const limite = Number(s.hub_richiamo_limite) || 20;
  // il limite è giornaliero: i richiami già partiti oggi (anche a mano) contano
  const fatti = await richiamiDiOggi();
  const sel = prospectDaRichiamare(await candidati(), { oggi, giorni, limite: Math.max(0, limite - fatti) });
  const { creaPacchetto } = await import('../routes/pacchetto.js');
  const { loadAccount } = await import('../routes/hub.js');
  const mod = await modelliFlusso();
  const rec = await recapiti(s);
  const contatto = indirizzi(s.hub_richiamo_recapiti)[0] || s.lr_email || '';
  const out = { inviati: 0, falliti: 0, gia_oggi: fatti, in_coda: sel.in_coda.length, dettaglio: [] };
  for (const c of sel.selezionati) {
    try {
      const a = await loadAccount(c.id);
      const pk = await creaPacchetto(a, { contatto: c.contatto_id ? { id: c.contatto_id, nome: c.contatto_nome } : null, data: oggi, variante: 'PROSPECT' }, userId);
      const doc = await one('SELECT id, filename, mime, data, blob_path FROM documenti WHERE id=$1', [pk.documento_id]);
      const valori = { cliente: a.org_name, referente: c.contatto_nome || 'Cliente', casella: casella('SRV', s).address, contatto_commerciale: contatto, recapiti: rec, data: oggi };
      const r = await inviaAlCliente({ account: a, to: [c.email], subject: compila(mod.richiamo_oggetto, valori), testo: compila(mod.richiamo_testo, valori), contattoId: c.contatto_id || null, userId,
        allegati: [{ filename: doc.filename, content: await readBuffer(doc), contentType: 'application/pdf', ref: `documento:${doc.id}` }], sottotipo: 'RICHIAMO', dati: { pacchetto_id: pk.id, manuale } });
      await q('UPDATE pacchetti SET inviato_activity_id=$2, inviato_at=now(), inviato_stato=$3 WHERE id=$1', [pk.id, r.activity_id, r.stato]);
      if (r.stato !== 'FALLITO') { await q('UPDATE accounts SET ultimo_richiamo_at=now() WHERE id=$1', [a.id]); out.inviati++; } else out.falliti++;
      out.dettaglio.push({ id: a.id, stato: r.stato });
    } catch (e) {
      out.falliti++; out.dettaglio.push({ id: c.id, stato: 'ERRORE', errore: e.message });
      console.error(`[business] richiamo account ${c.id}: non riuscito`);
    }
  }
  console.log(`[business] richiamo dei prospect: ${out.inviati} inviati, ${out.falliti} non riusciti, ${out.in_coda} in coda`);
  return out;
}
