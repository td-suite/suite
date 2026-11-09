// Business Hub · schede dei clienti dall'anagrafica (richiesta del CEO del 09/11/2026: "Legal entity che ho in anagrafica come cliente non le
// ritrovo in Business Hub B2B", es. UNIFARM SPA, codice SER0033). Regola: ogni Legal entity di tipo CLIENTE attiva ha almeno un account nel
// Business Hub. L'account mancante nasce come prospect in fase 0 (censito), con la linea dedotta dal codice della Legal entity (SER → Service,
// MDL → Medicina del Lavoro, PP → Punti Prelievo; altrimenti Service), fonte del censimento "Anagrafica" e l'attività SISTEMA "Scheda creata
// dall'anagrafica". Chi la chiama: il core alla creazione della Legal entity e al cambio di tipo in CLIENTE (hookLegalEntity, import
// dinamico con try/catch: nessuna dipendenza rigida del core dal modulo), il job business:schede-da-anagrafica (all'avvio e ogni ora), la
// correzione D47 della Diagnostica ("Crea le schede"), "Aggiungi la linea …" dalla scheda Legal entity in Amministrazione.
// Docs: docs/BUSINESS_HUB.md, "Legal entity cliente sempre nel Business Hub".
import { one, many } from '../db.js';
import { attivita } from './flusso.js';
import { LINEE } from './hub.js';

export const FONTE_ANAGRAFICA = 'Anagrafica';
export const LINEE_AGGIUNGIBILI = ['SRV', 'MDL'];   // i Punti Prelievo hanno un account per sede (pagina "Punti Prelievo e Centri")

/** Linea dedotta dal codice della Legal entity: SER… → SRV, MDL… → MDL, PP… → PP, altrimenti SRV. */
export function lineaDaCodice(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.startsWith('SER')) return 'SRV';
  if (c.startsWith('MDL')) return 'MDL';
  if (c.startsWith('PP')) return 'PP';
  return 'SRV';
}

const SENZA_SCHEDA = `SELECT o.id, o.code, o.name, o.city FROM public.organizations o
  WHERE o.kind = 'CLIENTE' AND coalesce(o.active, TRUE) AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.organization_id = o.id)`;

/** Legal entity CLIENTE attive senza nessun account (con la linea che si creerebbe). */
export async function legalEntitySenzaScheda() {
  return (await many(`${SENZA_SCHEDA} ORDER BY lower(o.name)`)).map((o) => ({ ...o, linea: lineaDaCodice(o.code) }));
}

/**
 * Crea l'account della linea per la Legal entity se manca (idempotente). Ritorna { account_id, creato, linea }.
 * opts: { linea (predefinita: dal codice), fonte (testo per il diario), userId (utente del modulo, facoltativo) }.
 */
export async function creaScheda(orgId, { linea = null, fonte = 'anagrafica', userId = null } = {}) {
  const o = await one('SELECT id, code, name, kind, active FROM public.organizations WHERE id=$1', [orgId]);
  if (!o) throw Object.assign(new Error('Legal entity non trovata'), { status: 404 });
  const l = linea || lineaDaCodice(o.code);
  if (!LINEE[l]) throw Object.assign(new Error('Linea non valida'), { status: 400 });
  const esiste = l === 'PP'
    ? await one(`SELECT id FROM accounts WHERE organization_id=$1 AND linea='PP' AND pp_site_id IS NULL AND pp_nome IS NULL`, [o.id])
    : await one('SELECT id FROM accounts WHERE organization_id=$1 AND linea=$2', [o.id, l]);
  if (esiste) return { account_id: esiste.id, creato: false, linea: l };
  const row = await one(`INSERT INTO accounts (organization_id, linea, prospect, fase_corrente, fonte_censimento, created_by) VALUES ($1,$2,TRUE,0,$3,$4) RETURNING id`, [o.id, l, FONTE_ANAGRAFICA, userId]);
  await attivita(row.id, { tipo: 'SISTEMA', oggetto: 'Scheda creata dall\'anagrafica', testo: `Legal entity ${o.name}${o.code ? ` (${o.code})` : ''} di tipo CLIENTE in Amministrazione > Legal entity: scheda ${LINEE[l].label} creata come prospect censito (fase 0)${linea ? '' : `, linea dedotta dal codice${o.code ? ` ${o.code}` : ' (nessun codice: Service)'}`}. Origine: ${fonte}.`, dati: { origine: fonte, linea: l } }, userId);
  return { account_id: row.id, creato: true, linea: l };
}

/** Job e Diagnostica: crea le schede mancanti (esegui = true) o restituisce l'elenco. */
export async function schedeDaAnagrafica({ esegui = false, fonte = 'job business:schede-da-anagrafica', ids = null } = {}) {
  let righe = await legalEntitySenzaScheda();
  if (ids) { const w = new Set(ids.map(Number)); righe = righe.filter((r) => w.has(Number(r.id))); }
  if (!esegui) return righe;
  const out = [];
  for (const r of righe) {
    try { const x = await creaScheda(r.id, { fonte }); out.push({ id: r.id, esito: `scheda ${LINEE[x.linea].label} ${x.creato ? 'creata' : 'già presente'} #${x.account_id}` }); }
    catch (e) { out.push({ id: r.id, esito: 'errore', motivo: e.message }); }
  }
  return out;
}

/**
 * Hook chiamato dal core (lib/organizations.js e PUT /api/organizations/:id) quando una Legal entity nasce o diventa CLIENTE (o torna
 * attiva). Solo se la Legal entity è CLIENTE, attiva e senza account. Ritorna l'esito di creaScheda o null.
 */
export async function hookLegalEntity(orgId, { evento = 'creazione' } = {}) {
  const o = await one(`${SENZA_SCHEDA} AND o.id = $1`, [orgId]);
  if (!o) return null;
  return creaScheda(o.id, { fonte: evento === 'creazione' ? 'creazione della Legal entity in anagrafica' : 'Legal entity diventata CLIENTE in anagrafica' });
}

/** Account della Legal entity per la scheda in Amministrazione ("Apri nel Business Hub", "Aggiungi la linea …"). */
export async function accountsDiLegalEntity(orgId) {
  const rows = await many(`SELECT a.id, a.linea, a.fase_corrente, a.prospect, a.cliente_attivo, a.fonte_censimento, a.pp_site_id, coalesce(s.name, a.pp_nome) AS punto
    FROM accounts a LEFT JOIN public.sites s ON s.id = a.pp_site_id WHERE a.organization_id=$1 ORDER BY a.linea, a.id`, [orgId]);
  const presenti = new Set(rows.map((r) => r.linea));
  return { accounts: rows.map((r) => ({ ...r, linea_label: LINEE[r.linea]?.label || r.linea })), aggiungibili: LINEE_AGGIUNGIBILI.filter((l) => !presenti.has(l)).map((l) => ({ linea: l, label: LINEE[l].label })) };
}
