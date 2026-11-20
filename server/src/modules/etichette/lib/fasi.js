// Lab Control · fasi di lavorazione di un'accettazione StudioLab (v0.71.0). Funzioni PURE (nessun database): le usano l'elenco, la scheda,
// il cruscotto, i test e le query (statiDellaFase, SQL_FASE).
//
// Una sola regola, `faseAccettazione`, dallo STATO dell'accettazione (docs/synclab-data-api/02_DIZIONARIO_BI.md) e dalle DATE disponibili:
//
//   indice  fase          stati      data della fase (se il gestionale la dà)
//   0       PRENOTATA     10, 30     bookingAtLocal, altrimenti createdAtLocal
//   1       ACCETTATA     15         createdAtLocal
//   (dalla v0.90.2 lo stato 18 "prelievo eseguito" sta in ACCETTATA: nessuna tappa Prelievo)
//   3       LAVORAZIONE   20         primo checkedInAtLocal dei campioni, altrimenti primo executedAtLocal delle righe
//   4       FIRMA         25         ultimo validatedAtLocal delle righe (tutte le righe valide validate: l'ultimo validato apre la firma)
//   5       REFERTO       40         reportAtLocal
//   6       CHIUSO        50         nessuna data nel contratto: si mostra modifiedAtLocal quando lo stato è 50 ("chiuso entro il")
//   fuori   NC            11         "NC, campione mai arrivato" (in rosso, fuori dalla linea)
//
// Le fasi prima di quella corrente sono "raggiunte" anche senza data (lo stato del gestionale fa fede); una data di una fase successiva a
// quella corrente non sposta la fase (es. campione già raccolto in stato 15: la data si mostra, la fase resta "Accettata").
// Uno stato sconosciuto (il dizionario dice di non scartarli) ha fase null e l'etichetta "Stato N del gestionale".
// Le righe d'esame cancellate (deleted) non contano; una riga con notPerformedCode è "non eseguita" e non blocca la firma.

export const FASI = [
  { key: 'PRENOTATA', label: 'Prenotata', breve: 'Prenot.', stati: [10, 30] },
  // v0.90.2 (CEO, 20/11/2026): la fase "Prelievo eseguito" non è una tappa a sé. Nessun gestionale fornisce in modo affidabile l'ora del
  // prelievo (nella scheda compariva 00:00); lo stato 18 del gestionale resta dentro "Accettata / in attesa".
  { key: 'ACCETTATA', label: 'Accettata / in attesa', breve: 'Accett.', stati: [15, 18] },
  { key: 'LAVORAZIONE', label: 'In lavorazione', breve: 'Lavoraz.', stati: [20] },
  { key: 'FIRMA', label: 'In firma', breve: 'Firma', stati: [25] },
  { key: 'REFERTO', label: 'Referto pronto', breve: 'Referto', stati: [40] },
  { key: 'CHIUSO', label: 'Chiuso', breve: 'Chiuso', stati: [50] },
];
export const FASE_NC = { key: 'NC', label: 'NC, campione mai arrivato', breve: 'NC', stati: [11] };
export const STATO_LABEL = { 10: 'Prenotata', 11: 'NC mai arrivato', 15: 'In attesa', 18: 'Prelievo eseguito', 20: 'In lavorazione', 25: 'In firma', 30: 'Attende prelievo', 40: 'Referto pronto', 50: 'Chiusa' };
/** Stati "aperti" (accettazione in corso: c'è un campione o ci sarà a breve, nessun referto): base dei ritardi e di "in lavorazione ora". */
export const STATI_IN_CORSO = [15, 18, 20, 25];
/** Stati con il referto pronto (40) o chiusi (50). */
export const STATI_REFERTATI = [40, 50];

const indicePerStato = new Map(FASI.flatMap((f, i) => f.stati.map((s) => [s, i])));
export const indiceFase = (stato) => (stato == null ? null : indicePerStato.has(Number(stato)) ? indicePerStato.get(Number(stato)) : null);
/** Stati di una fase (chiave) per i filtri; NC = [11]; chiave sconosciuta = []. */
export function statiDellaFase(key) {
  if (key === 'NC') return [...FASE_NC.stati];
  return [...(FASI.find((f) => f.key === key)?.stati || [])];
}
/** Espressione SQL dell'indice di fase da una colonna di stato (null per 11 e per gli stati sconosciuti): per l'ordinamento. */
export const SQL_FASE = (col = 'r.state') => `CASE ${FASI.map((f, i) => `WHEN ${col} IN (${f.stati.join(',')}) THEN ${i}`).join(' ')} END`;

// date "AAAA-MM-GGTHH:MM[:SS]" del gestionale (ora locale di Roma, senza fuso) oppure Date del driver (TIMESTAMP senza fuso)
export function tsLocale(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4] || '00'}` : null;
}
/** Minuti fra due istanti locali (stesso fuso: differenza "di orologio"); null se manca uno dei due. */
export function minutiTra(a, b) {
  const x = tsLocale(a), y = tsLocale(b);
  if (!x || !y) return null;
  return Math.round((Date.parse(`${y}Z`) - Date.parse(`${x}Z`)) / 60000);
}
const minimo = (lista) => lista.map(tsLocale).filter(Boolean).sort()[0] || null;
const massimo = (lista) => { const v = lista.map(tsLocale).filter(Boolean).sort(); return v.length ? v[v.length - 1] : null; };

/**
 * Avanzamento delle righe d'esame (non cancellate): { totale, eseguiti, validati, pronti, non_eseguiti, da_fare }.
 * eseguito = executedAtLocal; validato = validatedAtLocal; pronto = reportReady; non eseguito = notPerformedCode valorizzato.
 */
export function avanzamentoEsami(righe = []) {
  const vive = righe.filter((r) => !r.cancellata && !r.deleted);
  const ne = (r) => r.non_eseguito_codice != null || r.not_performed_code != null;
  const out = { totale: vive.length, eseguiti: 0, validati: 0, pronti: 0, non_eseguiti: 0, da_fare: 0 };
  for (const r of vive) {
    if (ne(r)) { out.non_eseguiti++; continue; }
    if (r.eseguito_il || r.executed_at_local) out.eseguiti++;
    if (r.validato_il || r.validated_at_local) out.validati++;
    if (r.referto_pronto === true || r.report_ready === true) out.pronti++;
    if (!(r.validato_il || r.validated_at_local) && !(r.referto_pronto === true || r.report_ready === true)) out.da_fare++;
  }
  return out;
}

/** Stato di una singola riga d'esame: NON_ESEGUITO | PRONTO | VALIDATO | ESEGUITO | DA_ESEGUIRE | CANCELLATO, con l'etichetta. */
export function statoEsame(r) {
  if (r.cancellata || r.deleted) return { key: 'CANCELLATO', label: 'Cancellato' };
  const np = r.non_eseguito_codice ?? r.not_performed_code;
  if (np != null) return { key: 'NON_ESEGUITO', label: `Non eseguito (codice ${np})` };
  if (r.referto_pronto === true || r.report_ready === true) return { key: 'PRONTO', label: 'Referto pronto' };
  if (r.validato_il || r.validated_at_local) return { key: 'VALIDATO', label: 'Validato' };
  if (r.eseguito_il || r.executed_at_local) return { key: 'ESEGUITO', label: 'Eseguito' };
  return { key: 'DA_ESEGUIRE', label: 'Da eseguire' };
}

/**
 * Fase e linea del tempo di un'accettazione.
 * t: { stato, creata_il, prenotata_il, referto_il, modificata_il } (o le colonne della copia: state, created_at_local, booking_at_local,
 * report_at_local, modified_at_local); campioni: [{ raccolto_il|collected_at_local, prelevato_il|sample_at_local, checkin_il|checked_in_at_local }];
 * righe: [{ cancellata|deleted, eseguito_il|executed_at_local, validato_il|validated_at_local, non_eseguito_codice|not_performed_code, referto_pronto|report_ready }].
 * Ritorna { key, label, indice, fuori_linea, stato, stato_label, tappe: [{ key, label, data, raggiunta, corrente, durata_min }], esami }.
 */
export function faseAccettazione(t = {}, campioni = [], righe = []) {
  const stato = t.stato ?? t.state ?? null;
  const idx = indiceFase(stato);
  const nc = Number(stato) === 11;
  const creata = tsLocale(t.creata_il ?? t.created_at_local);
  const vive = righe.filter((r) => !r.cancellata && !r.deleted);
  const valide = vive.filter((r) => (r.non_eseguito_codice ?? r.not_performed_code) == null);
  const tutteValidate = valide.length > 0 && valide.every((r) => r.validato_il || r.validated_at_local);
  const validate = valide.filter((r) => r.validato_il || r.validated_at_local);
  const ultimaValidazione = validate.length ? massimo(validate.map((r) => r.validato_il ?? r.validated_at_local)) : null;
  const refertoIl = tsLocale(t.referto_il ?? t.report_at_local);
  const date = [
    tsLocale(t.prenotata_il ?? t.booking_at_local) || creata,
    creata,
    minimo(campioni.map((c) => c.checkin_il ?? c.checked_in_at_local)) || minimo(valide.map((r) => r.eseguito_il ?? r.executed_at_local)),
    // Firma: il gestionale non dà un'ora di firma dell'accettazione; dà l'ora di validazione di ogni esame (validatedAtLocal). Si mostra
    // l'ultima validazione registrata, anche quando non tutti gli esami sono validati (nota "ultima validazione, N di M esami").
    ultimaValidazione,
    // Referto: reportAtLocal; se il gestionale non lo dà e il referto risulta pronto, l'ultima validazione (con la nota)
    refertoIl || (Number(stato) >= 40 ? ultimaValidazione : null),
    Number(stato) === 50 ? tsLocale(t.modificata_il ?? t.modified_at_local) : null,
  ];
  // una prenotazione con data uguale all'accettazione non è una fase a sé: la data resta solo su "Accettata"
  if (idx != null && idx >= 1 && date[0] === creata) date[0] = null;
  const tappe = FASI.map((f, i) => ({ key: f.key, label: f.label, breve: f.breve, data: date[i], raggiunta: idx != null && i <= idx, corrente: idx === i, durata_min: null }));
  const iF = FASI.findIndex((f) => f.key === 'FIRMA'); const iR = FASI.findIndex((f) => f.key === 'REFERTO');
  if (tappe[iF].data) tappe[iF].nota = tutteValidate ? 'ultima validazione degli esami' : `ultima validazione, ${validate.length} di ${valide.length} esami`;
  if (tappe[iR].data && !refertoIl) tappe[iR].nota = 'ora dell\'ultima validazione: il gestionale non dà l\'ora del referto';
  // durata di ogni fase raggiunta: dalla sua data alla data della fase raggiunta successiva che ne ha una
  for (let i = 0; i < tappe.length; i++) {
    if (!tappe[i].raggiunta || !tappe[i].data) continue;
    const dopo = tappe.slice(i + 1).find((x) => x.raggiunta && x.data);
    if (dopo) tappe[i].durata_min = minutiTra(tappe[i].data, dopo.data);
  }
  const fase = nc ? FASE_NC : idx != null ? FASI[idx] : null;
  return {
    key: fase?.key || null, label: fase?.label || (stato == null ? 'Stato non disponibile' : `Stato ${stato} del gestionale`), indice: nc ? null : idx, fuori_linea: nc || idx == null,
    stato: stato == null ? null : Number(stato), stato_label: stato == null ? null : STATO_LABEL[Number(stato)] || `Stato ${stato} del gestionale`,
    tappe, esami: avanzamentoEsami(righe),
    accettazione_referto_min: minutiTra(creata, refertoIl),
  };
}

/** Data "AAAA-MM-GG" più n giorni di calendario. */
export const piuGiorni = (d, n) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00Z`); if (Number.isNaN(x.getTime())) return null; x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** Giorni di calendario fra due date "AAAA-MM-GG" (b - a). */
export const giorniTra = (a, b) => { const x = Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`), y = Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`); return Number.isNaN(x) || Number.isNaN(y) ? null : Math.round((y - x) / 86400000); };
/** Scadenza di refertazione (regola del CEO del 20/11/2026): data di accettazione + giorni di refertazione - 1 (il giorno dell'accettazione è il primo). */
export const scadenzaRefertazione = (dataAccettazione, giorni) => piuGiorni(dataAccettazione, Math.max(1, Number(giorni) || 1) - 1);
/** Una riga d'esame è ancora da refertare: non cancellata, non "non eseguita", senza validazione né referto pronto. */
export const esameDaRefertare = (r) => !(r.deleted ?? r.cancellata) && (r.not_performed_code ?? null) == null && !(r.validated_at_local ?? r.validato_il) && !(r.report_ready ?? r.referto_pronto);
/** Giorni di refertazione di un codice esame: tabella lc_tempi_esame (Map codice maiuscolo -> giorni), altrimenti il predefinito. */
export const giorniEsame = (codice, tempi, predefinito = 3) => { const g = tempi?.get?.(String(codice ?? '').trim().toUpperCase()); return Number(g) > 0 ? Number(g) : predefinito; };

/**
 * Ritardo di un'accettazione in corso (stati 15, 18, 20, 25): { in_ritardo, ore, giorni_oltre, scadenza, motivo, esami }.
 * Regola (v0.91.1, CEO 20/11/2026): un esame è in ritardo quando oggi è OLTRE la sua scadenza = data di accettazione + giorni di
 * refertazione - 1 e non è ancora validato né ha il referto pronto. L'accettazione è in ritardo quando lo è almeno un suo esame; se tutti
 * gli esami sono validati e il referto non è ancora emesso, conta la scadenza più lontana fra i suoi esami. Giorni di calendario.
 * In più, se per lo stato c'è una soglia di fase: ore dall'ultimo aggiornamento del gestionale oltre la soglia.
 * righe = righe d'esame dell'accettazione; tempi = Map codice -> giorni; oggi "AAAA-MM-GG"; adesso = istante locale di Roma;
 * dal = prima data della finestra (le accettazioni precedenti non contano).
 */
export function ritardo(t, { giorni_refertazione = 3, soglie_fase = {}, dal = null, oggi = null, righe = [], tempi = null } = {}, adesso) {
  const vuoto = { in_ritardo: false, ore: null, giorni_oltre: null, scadenza: null, motivo: null, esami: [] };
  const stato = Number(t.stato ?? t.state);
  if (!STATI_IN_CORSO.includes(stato)) return vuoto;
  const creata = t.creata_il ?? t.created_at_local;
  const ore = (() => { const m = minutiTra(creata, adesso); return m == null ? null : Math.floor(m / 60); })();
  const data = String(t.data ?? t.date ?? creata ?? '').slice(0, 10);
  const og = oggi || String(adesso || '').slice(0, 10);
  // finestra (impostazione giorni_finestra): un'accettazione più vecchia non conta fra i ritardi (dati storici mai chiusi nel gestionale)
  if (dal && data && data < dal) return { ...vuoto, ore, motivo: 'fuori dalla finestra dei ritardi' };
  const vive = righe.filter((r) => !(r.deleted ?? r.cancellata) && (r.not_performed_code ?? null) == null);
  const conScadenza = (r) => { const g = giorniEsame(r.exam_code ?? r.codice, tempi, giorni_refertazione); return { codice: r.exam_code ?? r.codice ?? null, giorni: g, scadenza: scadenzaRefertazione(data, g) }; };
  const aperte = vive.filter(esameDaRefertare).map(conScadenza);
  const scadute = data && og ? aperte.filter((e) => e.scadenza && og > e.scadenza) : [];
  if (scadute.length) {
    const prima = scadute.map((e) => e.scadenza).sort()[0];
    return { in_ritardo: true, ore, giorni_oltre: giorniTra(prima, og), scadenza: prima, esami: scadute,
      motivo: `${scadute.length === 1 ? '1 esame' : `${scadute.length} esami`} oltre la data di accettazione + giorni di refertazione - 1` };
  }
  // tutti gli esami validati (o nessuna riga nella copia) e referto non emesso: scadenza più lontana fra gli esami, altrimenti il predefinito
  const tutte = vive.map(conScadenza);
  const scad = aperte.length ? aperte.map((e) => e.scadenza).sort()[0] : (tutte.map((e) => e.scadenza).sort().pop() || scadenzaRefertazione(data, giorni_refertazione));
  if (!aperte.length && data && og && scad && og > scad) {
    return { in_ritardo: true, ore, giorni_oltre: giorniTra(scad, og), scadenza: scad, esami: [], motivo: vive.length ? 'esami validati, referto non emesso oltre la scadenza di refertazione' : 'oltre la scadenza di refertazione (giorni predefiniti)' };
  }
  const sf = soglie_fase?.[stato];
  if (sf) {
    const m = minutiTra(t.modificata_il ?? t.modified_at_local ?? creata, adesso);
    if (m != null && m / 60 >= sf) return { in_ritardo: true, ore, giorni_oltre: null, scadenza: scad, esami: [], motivo: `ferma in "${STATO_LABEL[stato]}" da oltre ${sf} ore (ultimo aggiornamento del gestionale)` };
  }
  return { ...vuoto, ore, scadenza: scad };
}

/** Mediana e percentile (interpolazione lineare, come percentile_cont di PostgreSQL) di un elenco di numeri. */
export function percentile(valori, p) {
  const v = valori.filter((x) => x != null && Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
