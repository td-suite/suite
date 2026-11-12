#!/usr/bin/env node
// Guida GIPO · stampa, per ogni domanda di prova (o per le domande passate come argomenti), le sezioni e le FAQ che il recupero passa al
// modello, con punteggio e copertura: serve alla redazione per vedere se una domanda trova la sezione giusta (v0.71.1).
// Usa il database di DATABASE_URL (schema gipoguida già attivo). Non chiama il modello: mostra il recupero full text (quello che resta
// anche senza AI; con l'AI il passaggio di pianificazione aggiunge sezioni scelte dall'indice).
// Uso:
//   DATABASE_URL=postgres://utente@/db?host=/tmp node scripts/gipoguida-domande.mjs              domande di prova, con l'esito
//   DATABASE_URL=... node scripts/gipoguida-domande.mjs "Come blocco un'agenda per ferie?"         domande libere
//   opzioni: --seme (carica prima il seme dei contenuti), --tutte (stampa tutte le sezioni recuperate, non solo le prime 6)
if (!process.env.DATABASE_URL) { console.error('Imposta DATABASE_URL (database con lo schema gipoguida).'); process.exit(2); }
const argomenti = process.argv.slice(2);
const opz = new Set(argomenti.filter((a) => a.startsWith('--')));
const libere = argomenti.filter((a) => !a.startsWith('--'));
const { preparaBrani } = await import('../src/modules/gipoguida/lib/risposta.js');
const { DOMANDE_PROVA } = await import('../src/modules/gipoguida/lib/domande-prova.js');
const { modulePool } = await import('../src/lib/modules.js');
if (opz.has('--seme')) {
  const { caricaSeme } = await import('../src/modules/gipoguida/lib/seme.js');
  const r = await caricaSeme({ forza: true });
  console.log(`Seme caricato: sezioni ${r.sezioni.nuove} nuove, ${r.sezioni.aggiornate} aggiornate; FAQ ${r.faq.nuove} nuove, ${r.faq.aggiornate} aggiornate\n`);
}
const elenco = libere.length ? libere.map((d) => ({ domanda: d, attese: [] })) : DOMANDE_PROVA;
let ok = 0;
for (const [i, x] of elenco.entries()) {
  const { sezioni, faq } = await preparaBrani(x.domanda);
  const slugs = sezioni.map((s) => s.slug);
  const trovata = x.attese.length ? x.attese.some((a) => slugs.includes(a)) : null;
  if (trovata) ok++;
  const pos = x.attese.length ? Math.min(...x.attese.map((a) => (slugs.includes(a) ? slugs.indexOf(a) + 1 : 99))) : null;
  console.log(`${String(i + 1).padStart(2)}. ${x.domanda}`);
  if (x.attese.length) console.log(`    attesa: ${x.attese.join(' o ')}  ->  ${trovata ? `TROVATA (posizione ${pos} di ${sezioni.length})` : 'NON TROVATA'}`);
  for (const [k, s] of sezioni.slice(0, opz.has('--tutte') ? 99 : 6).entries()) {
    console.log(`    ${String(k + 1).padStart(2)} ${s.slug.padEnd(34)} ${s.score.toFixed(3)}  cop ${s.copertura.toFixed(2)}  ${s.stato === 'VALIDATA' ? 'V' : '-'} ${s.titolo}`);
  }
  if (faq.length) console.log(`    FAQ: ${faq.slice(0, 3).map((f) => f.titolo).join(' | ')}`);
  console.log('');
}
if (!libere.length) console.log(`Esito: ${ok} domande su ${elenco.length} trovano la sezione attesa fra quelle passate al modello.`);
await modulePool('gipoguida').end().catch(() => {});
const { pool } = await import('../src/db.js');
await pool.end().catch(() => {});
process.exit(libere.length || ok === elenco.length ? 0 : 1);
