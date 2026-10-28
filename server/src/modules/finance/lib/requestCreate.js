// Creazione di un'istanza di pagamento: schema dei dati, preparazione (IBAN, scaglione, conto di addebito), anagrafica dei
// beneficiari e inserimento. Usata da POST /requests (routes/requests.js) e dallo Scadenziario strutture (routes/schedule.js:
// istanza da una scadenza), così le regole restano in un solo posto.
import { z } from 'zod';
import { one, tx } from '../db.js';
import { bad } from './util.js';
import { getSettings, computeTier, normalizeIban, validIban } from './rules.js';
import { addEvent, loadRequest } from './workflow.js';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida');
const optStr = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().max(max).nullable());
const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr.nullable());

export const requestSchema = z.object({
  request_date: dateStr,
  requester: z.string().trim().min(2).max(160),
  cost_center: optStr(160),
  beneficiary_name: z.string().trim().min(2).max(200),
  beneficiary_tax_id: optStr(40),
  beneficiary_iban: z.string().trim().min(10).max(40),
  beneficiary_bic: optStr(20),
  beneficiary_bank: optStr(160),
  amount: z.coerce.number().positive().max(999999999.99),
  purpose: z.string().trim().min(3).max(600),
  doc_type: z.enum(['FATTURA', 'CONTRATTO', 'ORDINE', 'ALTRO']),
  doc_other: optStr(120),
  doc_number: optStr(80),
  doc_date: optDate,
  bank_account_id: z.coerce.number().int().positive().nullable().optional(),
  payment_method: z.enum(['SEPA', 'URGENTE', 'ESTERO', 'F24', 'ALTRO']),
  payment_method_other: optStr(120),
  value_date: optDate,
  single_signer: z.enum(['CEO', 'CFO']).nullable().optional(),
  board_number: optStr(80),
  board_date: optDate,
  prior_approval: z.boolean().default(false),
  prior_approval_ref: optStr(300),
  checks: z.object({ budget: z.boolean().default(false), aggregation: z.boolean().default(false), documents: z.boolean().default(false), related_party: z.boolean().default(false), cfo_consent: z.boolean().default(false), iban_verified: z.boolean().default(false) }).default({}),
  iban_verified_note: optStr(300),
  notes: optStr(2000),
});

export const editable = (st) => ['BOZZA', 'RIFIUTATA', 'IN_FIRMA'].includes(st);

// Anagrafica beneficiario: riconosce la controparte per P.IVA/CF o nome; segnala IBAN mai visto o non confermato
export async function upsertBeneficiary(d, client) {
  let b = null;
  if (d.beneficiary_tax_id) b = (await client.query('SELECT * FROM beneficiaries WHERE lower(tax_id)=lower($1)', [d.beneficiary_tax_id])).rows[0];
  if (!b) b = (await client.query('SELECT * FROM beneficiaries WHERE lower(name)=lower($1)', [d.beneficiary_name])).rows[0];
  if (!b) b = (await client.query('INSERT INTO beneficiaries(name, tax_id) VALUES ($1,$2) RETURNING *', [d.beneficiary_name, d.beneficiary_tax_id || null])).rows[0];
  else if (!b.tax_id && d.beneficiary_tax_id) await client.query('UPDATE beneficiaries SET tax_id=$2 WHERE id=$1', [b.id, d.beneficiary_tax_id]);
  let ib = (await client.query('SELECT * FROM beneficiary_ibans WHERE beneficiary_id=$1 AND iban=$2', [b.id, d.beneficiary_iban])).rows[0];
  const known = (await client.query('SELECT count(*)::int AS n FROM beneficiary_ibans WHERE beneficiary_id=$1 AND id<>coalesce($2,0)', [b.id, ib?.id || null])).rows[0].n;
  if (!ib) ib = (await client.query('INSERT INTO beneficiary_ibans(beneficiary_id, iban, bic, bank) VALUES ($1,$2,$3,$4) RETURNING *', [b.id, d.beneficiary_iban, d.beneficiary_bic || null, d.beneficiary_bank || null])).rows[0];
  // "nuovo IBAN": coordinate mai confermate tramite canale indipendente (prima volta o variazione rispetto a IBAN già noti)
  return { beneficiary: b, iban: ib, new_iban: !ib.verified_at, changed: known > 0 && !ib.verified_at };
}

export async function prepare(d, s) {
  d.beneficiary_iban = normalizeIban(d.beneficiary_iban);
  if (!validIban(d.beneficiary_iban)) throw bad('IBAN del beneficiario non valido (controllo formale fallito)');
  d.tier = computeTier(d.amount, s);
  if (d.tier !== 'SINGOLA') d.single_signer = null;
  if (d.doc_type !== 'ALTRO') d.doc_other = null;
  if (d.payment_method !== 'ALTRO') d.payment_method_other = null;
  if (!d.prior_approval) d.prior_approval_ref = null;
  let debit = null;
  if (d.bank_account_id) {
    const b = await one('SELECT * FROM bank_accounts WHERE id=$1 AND active', [d.bank_account_id]);
    if (!b) throw bad('Conto di addebito non valido');
    debit = `${b.bank_name} – IBAN ${b.iban}`;
  }
  d.debit_account = debit;
  return d;
}

// Inserimento dell'istanza in bozza (dati già validati con requestSchema): anagrafica beneficiario, riga, evento CREATA
export const REQUEST_INSERT_COLS = ['request_date', 'requester', 'cost_center', 'beneficiary_id', 'beneficiary_name', 'beneficiary_tax_id', 'beneficiary_iban', 'beneficiary_bic', 'beneficiary_bank', 'amount', 'purpose', 'doc_type', 'doc_other', 'doc_number', 'doc_date', 'bank_account_id', 'debit_account', 'payment_method', 'payment_method_other', 'value_date', 'tier', 'single_signer', 'board_number', 'board_date', 'prior_approval', 'prior_approval_ref', 'checks', 'new_iban', 'iban_verified_note', 'notes'];
export async function createRequest(data, user, { client } = {}) {
  const s = await getSettings();
  const d = await prepare(data, s);
  const insert = async (c) => {
    const b = await upsertBeneficiary(d, c);
    const cols = [...REQUEST_INSERT_COLS, 'created_by'];
    const vals = { ...d, beneficiary_id: b.beneficiary.id, new_iban: b.new_iban, checks: JSON.stringify(d.checks || {}), created_by: user.id };
    return (await c.query(`INSERT INTO payment_requests(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((k) => vals[k] ?? null))).rows[0];
  };
  const row = client ? await insert(client) : await tx(insert);
  await addEvent(row.id, 'CREATA', user.id, 'Istanza creata in bozza', undefined, client);
  return { id: row.id, data: d, load: () => loadRequest(row.id) };
}
