// Ricerca prospect · indirizzi email. Si usa ciò che l'azienda pubblica; dallo schema degli indirizzi pubblicati si ricava una PROPOSTA
// per i decisori senza indirizzo, marcata IPOTESI. Nessuna prova di consegna verso i server di posta: si controlla solo che il dominio
// riceva posta (record MX). Mai un'ipotesi quando due persone darebbero lo stesso indirizzo, mai senza un indirizzo che insegni lo schema.
import dns from 'node:dns/promises';
import { eGenerica, ePec, eWebmail } from './estrai.js';

const pulisci = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '');
/** Nome e cognome per gli schemi: il primo nome e l'ultimo cognome (con le particelle attaccate: "De Rossi" → derossi) */
export function partiNome(nome) {
  const p = pulisci(nome).split(/\s+/).filter(Boolean);
  if (p.length < 2) return null;
  return { n: p[0], c: p.slice(1).join('') };
}
export const SCHEMI = {
  'nome.cognome': (x) => `${x.n}.${x.c}`, 'n.cognome': (x) => `${x.n[0]}.${x.c}`, ncognome: (x) => `${x.n[0]}${x.c}`, 'cognome.nome': (x) => `${x.c}.${x.n}`,
  nomecognome: (x) => `${x.n}${x.c}`, cognome: (x) => x.c, nome: (x) => x.n, 'cognome.n': (x) => `${x.c}.${x.n[0]}`, nome_cognome: (x) => `${x.n}_${x.c}`, cognomenome: (x) => `${x.c}${x.n}`, 'nome-cognome': (x) => `${x.n}-${x.c}`,
};
/**
 * Abbina gli indirizzi pubblicati alle persone e impara lo schema del dominio.
 * @returns {{ persone: [...con email, email_stato], schema: string|null, dominio: string|null, generali: [email], pec: [email] }}
 */
export function abbinaEmail(persone, emails, dominioSito) {
  const tutte = [...new Set(emails.map((e) => (typeof e === 'string' ? e : e.email).toLowerCase()))];
  const pec = tutte.filter(ePec);
  const normali = tutte.filter((e) => !ePec(e));
  const delDominio = (e) => dominioSito && (e.endsWith(`@${dominioSito}`) || e.split('@')[1].endsWith(`.${dominioSito}`));
  const out = persone.map((p) => ({ ...p }));
  const voti = {}; const usate = new Set();
  // un indirizzo dichiarato nei dati della persona vale come pubblicato
  for (const p of out) if (p.email) { p.email = p.email.toLowerCase(); p.email_stato = 'PUBBLICATA'; usate.add(p.email); }
  for (const e of normali.filter((x) => !eGenerica(x) && !eWebmail(x))) {
    const [locale, dom] = e.split('@');
    const candidati = [];
    for (const p of out) {
      const x = partiNome(p.nome); if (!x) continue;
      for (const [k, f] of Object.entries(SCHEMI)) if (f(x) === locale) candidati.push({ p, k });
    }
    const persone1 = [...new Set(candidati.map((c) => c.p))];
    if (persone1.length !== 1) continue;                    // di nessuno, o di due persone possibili: non insegna e non si assegna
    const { p, k } = candidati[0];
    if (!p.email) { p.email = e; p.email_stato = 'PUBBLICATA'; usate.add(e); }
    // lo schema vale per il dominio dell'indirizzo che lo insegna (spesso la posta sta su un dominio diverso dal sito); schemi ambigui pesano meno
    voti[`${k}@${dom}`] = (voti[`${k}@${dom}`] || 0) + (['cognome', 'nome'].includes(k) ? 0.4 : 1) + (delDominio(e) ? 0.1 : 0);
  }
  const migliore = Object.entries(voti).sort((a, b) => b[1] - a[1])[0];
  let schema = null; let dominio = null;
  if (migliore && migliore[1] >= 1) {
    [schema, dominio] = migliore[0].split('@');
    const proposte = new Map();
    for (const p of out) { if (p.email) continue; const x = partiNome(p.nome); if (x) { const e = `${SCHEMI[schema](x)}@${dominio}`; proposte.set(e, [...(proposte.get(e) || []), p]); } }
    for (const [e, ps] of proposte) if (ps.length === 1 && !usate.has(e)) { ps[0].email = e; ps[0].email_stato = 'IPOTESI'; }
  }
  const ordine = ['direzione', 'segreteria', 'amministrazione', 'acquisti', 'commerciale', 'info', 'contatti'];
  const peso = (e) => { const l = e.split('@')[0]; const i = ordine.findIndex((o) => l.startsWith(o)); return (delDominio(e) ? 0 : 100) + (i < 0 ? 50 : i); };
  const generali = normali.filter((e) => eGenerica(e) || (!usate.has(e) && eWebmail(e))).filter((e) => !/^(privacy|dpo|noreply|no-reply|webmaster|cv|curriculum|job|lavoraconnoi)/.test(e)).sort((a, b) => peso(a) - peso(b));
  return { persone: out, schema, dominio, generali, pec };
}
/** Il dominio riceve posta? (record MX; nessun collegamento ai server di posta) */
export async function dominioRicevePosta(dominio, { resolveMx = dns.resolveMx } = {}) {
  if (!dominio) return null;
  try { const mx = await resolveMx(dominio); return mx.some((m) => m.exchange && m.exchange !== '.'); } catch (e) { return ['ENOTFOUND', 'ENODATA'].includes(e.code) ? false : null; }
}
