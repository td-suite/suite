// Abbinamento alle anagrafiche uniche della Suite (docs/ANAGRAFICA.md): Legal entity (public.organizations) per partita IVA, codice
// fiscale o nome (anche simile, pg_trgm) e sedi TD (public.sites, mai le strutture SERVICE) per codice, città e nome. Nata nel
// caricamento dei pacchetti di Business (routes/imports.js), usata anche dallo Scadenziario strutture di Payments per il locatore e la
// sede letti da un contratto in PDF. Ogni esito porta `how`: il criterio con cui è stato trovato, da mostrare all'utente.
import { one, many } from '../db.js';

// Nome normalizzato per il confronto: senza accenti, forme societarie, articoli e punteggiatura
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(srl|s r l|spa|s p a|snc|s n c|sas|s a s|srls|s r l s|societa|soc|coop|cooperativa|onlus|odv|ets|di|e|and|the|il|la|le|lo|i|gli)\b/g, ' ').replace(/\s+/g, ' ').trim();
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const cfOrVat = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT/, '');

// Legal entity: { id, name, how } oppure null. o = { vat_number, tax_code, name }
export async function matchOrg(o) {
  const vat = cfOrVat(o.vat_number); const cf = cfOrVat(o.tax_code);
  if (vat && vat.length >= 11) { const hit = await one(`SELECT id, name FROM public.organizations WHERE regexp_replace(upper(coalesce(vat_number,'')), '[^A-Z0-9]', '', 'g') IN ($1, $2)`, [vat, `IT${vat}`]); if (hit) return { ...hit, how: 'partita IVA' }; }
  if (cf && cf.length >= 11) { const hit = await one(`SELECT id, name FROM public.organizations WHERE regexp_replace(upper(coalesce(tax_code,'')), '[^A-Z0-9]', '', 'g')=$1 OR regexp_replace(upper(coalesce(vat_number,'')), '[^A-Z0-9]', '', 'g')=$1`, [cf]); if (hit) return { ...hit, how: 'codice fiscale' }; }
  const n = norm(o.name);
  if (n) {
    const rows = await many('SELECT id, name FROM public.organizations WHERE active');
    const exact = rows.filter((x) => norm(x.name) === n);
    if (exact.length === 1) return { ...exact[0], how: 'nome' };
    const sim = await one(`SELECT id, name, similarity(lower(name), lower($1)) AS s FROM public.organizations WHERE active ORDER BY s DESC LIMIT 1`, [o.name]);
    if (sim && Number(sim.s) >= 0.72) return { id: sim.id, name: sim.name, how: `nome simile (${Math.round(sim.s * 100)}%)` };
  }
  return null;
}

// Sede TD: { id, code, name, city, how } oppure null. m = { code, names: [], city }
export async function matchSite(m) {
  if (!m) return null;
  if (m.code) { const hit = await one(`SELECT id, code, name, city FROM public.sites WHERE upper(code)=upper($1) AND kind <> 'SERVICE'`, [m.code]); if (hit) return { ...hit, how: 'codice' }; }
  const names = (m.names || []).map(norm).filter(Boolean);
  const city = norm(m.city);
  const all = await many(`SELECT id, code, name, short_name, city, address, kind, active FROM public.sites WHERE kind <> 'SERVICE'`);
  const byCity = city ? all.filter((s) => norm(s.city) === city) : [];
  const nameHit = (list) => list.filter((s) => names.some((n) => norm(s.name).includes(n) || norm(s.short_name).includes(n) || n.includes(norm(s.name))));
  // indirizzo (via e numero civico) della sede, quando è noto
  if (m.address && byCity.length) {
    const a = norm(m.address).replace(/\b(via|viale|piazza|piazzale|corso|largo|vicolo|strada|loc|localita|n|snc)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const addrHit = a ? byCity.filter((s) => { const b = norm(s.address).replace(/\b(via|viale|piazza|piazzale|corso|largo|vicolo|strada|loc|localita|n|snc)\b/g, ' ').replace(/\s+/g, ' ').trim(); return b && (b.includes(a) || a.includes(b)); }) : [];
    if (addrHit.length === 1) return { ...addrHit[0], how: 'città e indirizzo' };
  }
  let hits = nameHit(byCity);
  if (hits.length === 1) return { ...hits[0], how: 'città e nome' };
  if (byCity.length === 1) return { ...byCity[0], how: 'città' };
  const active = byCity.filter((s) => s.active);
  if (active.length === 1) return { ...active[0], how: 'città (unica sede attiva)' };
  hits = nameHit(all);
  if (hits.length === 1) return { ...hits[0], how: 'nome' };
  return null;
}
