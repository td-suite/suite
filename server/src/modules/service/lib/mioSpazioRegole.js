// Regole pure di "Il mio spazio" del Portale Service (nessun database: test in server/test/service-mio-spazio.test.mjs).
// Il riconoscimento del Cliente service è in lib/esterni.js (riconosciClienteService).

// Fasi degli ordini (come web/src/modules/orders/format.js PHASES): 1 Ordine (bozza), 2 Verifica TD, 3 Al magazzino, 4 Consegna,
// 5 Carico interno (solo strutture TD), chiuso. Per un cliente service la consegna conclude il processo (CHIUSO): CONSEGNATO di un
// ordine CLIENTE è comunque concluso. Le fasi 6-8 (scarico, giacenza mensile, giacenza per struttura) non sono stati dell'ordine.
export const FASI_ORDINE = {
  BOZZA: { n: 1, label: 'Ordine (bozza da inviare)' },
  INVIATO: { n: 2, label: 'Verifica TD' },
  APPROVATO: { n: 3, label: 'Al magazzino' },
  PRESO_IN_CARICO: { n: 3, label: 'Al magazzino · in preparazione' },
  SPEDITO: { n: 4, label: 'Consegna · spedito' },
  CONSEGNATO: { n: 4, label: 'Consegnato' },
  IMMAGAZZINATO: { n: 5, label: 'Carico interno' },
  CHIUSO: { n: 9, label: 'Chiuso' },
  ANNULLATO: { n: 0, label: 'Annullato' },
};
export const ORDINI_CONCLUSI = ['CHIUSO', 'ANNULLATO'];

/** Fase di un ordine: { n, label, in_corso }. kind = tipo della struttura (CLIENTE, SEDE, LAB). */
export function faseOrdine(status, kind) {
  const f = FASI_ORDINE[status] || { n: null, label: status || 'Sconosciuto' };
  const concluso = ORDINI_CONCLUSI.includes(status) || (status === 'CONSEGNATO' && kind === 'CLIENTE') || !FASI_ORDINE[status];
  return { n: f.n, label: f.label, in_corso: !concluso };
}
/** Stati degli ordini "in corso" (fasi non concluse) per un tipo di struttura: per il filtro SQL. */
export const statiOrdiniInCorso = (kind) => Object.keys(FASI_ORDINE).filter((s) => faseOrdine(s, kind).in_corso);

/** Conteggi per valore di un campo: { valore: n } (righe già filtrate dal perimetro). */
export function conteggiPer(rows, campo) {
  const out = {};
  for (const r of rows || []) { const k = r?.[campo] ?? 'ALTRO'; out[k] = (out[k] || 0) + 1; }
  return out;
}

/**
 * Riquadri KPI dalle quattro sezioni: NC aperte, Ordini in corso, Circolari da leggere, Ticket aperti.
 * Una sezione non disponibile dà valore null (il riquadro lo dice), mai 0 inventato.
 */
export function componiKpi({ nc, ordini, circolari, ticket } = {}) {
  const v = (s, k) => (s?.disponibile ? Number(s[k] || 0) : null);
  return { nc_aperte: v(nc, 'totale'), ordini_in_corso: v(ordini, 'totale'), circolari_da_leggere: v(circolari, 'da_leggere'), ticket_aperti: v(ticket, 'totale') };
}
