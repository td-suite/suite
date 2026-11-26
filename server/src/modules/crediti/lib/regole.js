// Recupero Crediti · regole pure (nessun database): scadenza dai termini di pagamento, scala di sollecito, aging, riconoscimento dei
// bonifici, lettura delle risposte senza modello. Coperte da server/test/crediti-regole.test.mjs.

export const FASI = [
  { n: 1, key: 'AVVISO', label: 'Avviso di scadenza', giorni_key: 'giorni_avviso' },
  { n: 2, key: 'SOLLECITO_1', label: '1° sollecito', giorni_key: 'giorni_sollecito_1' },
  { n: 3, key: 'SOLLECITO_2', label: '2° sollecito', giorni_key: 'giorni_sollecito_2' },
  { n: 4, key: 'CHIAMATA', label: 'Chiamata del referente commerciale', giorni_key: 'giorni_chiamata' },
  { n: 5, key: 'LEGALE', label: 'Area legale', giorni_key: 'giorni_legale' },
];
export const FASE_LABEL = Object.fromEntries(FASI.map((f) => [f.n, f.label]));
// Valori del memo "Modello di sollecito clienti B2B": giorni rispetto alla scadenza (avviso: giorni PRIMA)
export const PREDEFINITE = {
  modalita: 'PROVA',                 // PROVA: tutto viene preparato e mostrato, nulla esce. ATTIVA: gli invii partono
  giorni_avviso: 7, giorni_sollecito_1: 10, giorni_sollecito_2: 25, giorni_chiamata: 35, giorni_legale: 60,
  giorni_termine_1: 7, giorni_termine_2: 5, // termine dato al cliente nel 1° e nel 2° sollecito (giorni dalla data di invio)
  giorni_piano_dopo_chiamata: 5,     // giorni lavorativi per ottenere un impegno dopo la chiamata
  giorni_invio: [1, 4],              // revisione dell'aging: lunedì e giovedì (1 = lunedì ... 7 = domenica)
  ora_invio_da: 9, ora_invio_a: 17,
  ore_banca_fresca: 26,              // i movimenti devono essere stati letti da meno di N ore per un invio automatico
  giorni_bonifici_dubbi: 10,         // bonifici non abbinati dello stesso cliente negli ultimi N giorni fermano l'invio automatico
  tolleranza_promessa: 2,            // giorni dopo la data promessa prima di dichiararla non rispettata
  giorni_attesa_pagato: 5,           // "ho già pagato": attesa dell'incasso (giorni lavorativi)
  soglia_minima: 0,                  // sotto questo scaduto complessivo il cliente non si sollecita
  soglia_dir: 10000,                 // pratica legale sopra questa cifra: serve anche la Direzione
  termini_predefiniti: '30 gg f.m. data fattura',
  fatture_dal: null,                 // fatture Synclab da questa data (predefinito: 1° gennaio dell'anno di attivazione)
  riconciliazione_automatica: true,  // conferma da sola solo i bonifici con numero di fattura in causale e importo esatto
  risposta_automatica: false,        // conferma di ricezione al cliente che risponde
  iban: '', intestatario: 'Toscana Diagnostica S.r.l.',
  firma_att: 'Amministrazione · Toscana Diagnostica', telefono_att: '', firma_raf_nome: '', firma_raf_ruolo: 'Responsabile Amministrazione e Finanza',
  cc_fissi: '',                      // indirizzi sempre in copia
  tasso_mora_pct: null,              // tasso degli interessi di mora (D.Lgs. 231/2002): vuoto = non calcolati
  casella: null,
  // traccia per la chiamata del referente commerciale (modificabile nelle Impostazioni)
  traccia_chiamata: `1. Presentati e chiedi della persona che segue i pagamenti; spiega che chiami per le fatture scadute già sollecitate due volte per iscritto.
2. Verifica che fatture e solleciti siano arrivati e che non ci siano contestazioni sulle prestazioni o sugli importi.
3. Chiedi una data certa di pagamento. Se il cliente non riesce a saldare tutto, raccogli una proposta di piano di rientro con date e importi.
4. Riepiloga l'impegno preso e avvisa che lo riceverà per iscritto dall'Amministrazione.
5. Il blocco delle forniture non si annuncia: lo decide il Responsabile Amministrazione e Finanza con il commerciale, mai in automatico.`,
};

const iso = (d) => d.toISOString().slice(0, 10);
const dt = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
export const piuGiorni = (data, n) => { const d = dt(data); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const giorniTra = (a, b) => Math.round((dt(b) - dt(a)) / 86400000);
export const fineMese = (data, mesi = 0) => { const d = dt(data); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + mesi, 0, 12))); };
export const giornoSettimana = (data) => { const g = dt(data).getUTCDay(); return g === 0 ? 7 : g; };
/** Data dopo n giorni lavorativi (lunedì-venerdì; le festività non sono considerate). */
export function piuLavorativi(data, n) { let d = String(data).slice(0, 10); let k = 0; while (k < n) { d = piuGiorni(d, 1); if (giornoSettimana(d) <= 5) k++; } return d; }

/**
 * Scadenza dai termini di pagamento della Legal entity (Business Hub). Regola:
 *  - "a vista" / "rimessa diretta" / "ricevimento fattura": la data della fattura;
 *  - "N gg" (o giorni) con "f.m." / "fine mese": fine del mese della fattura più N giorni, portata a fine mese quando N è multiplo
 *    di 30 (30 gg f.m. su fattura del 10 gennaio = 28 febbraio);
 *  - "N gg" senza fine mese: data della fattura più N giorni;
 *  - termini non riconosciuti o vuoti: si usano i termini predefiniti del widget (origine PREDEFINITA).
 * Ritorna { scadenza, origine: 'TERMINI' | 'PREDEFINITA' }.
 */
export function scadenzaDaTermini(dataFattura, termini, predefiniti = PREDEFINITE.termini_predefiniti) {
  const calcola = (t) => {
    const s = String(t || '').toLowerCase();
    if (!s.trim()) return null;
    if (/a vista|rimessa diretta|ricevimento( della)? fattura|vista fattura/.test(s)) return String(dataFattura).slice(0, 10);
    const m = s.match(/(\d{1,3})\s*(?:gg|giorni|g\.g\.|days)/) || s.match(/\b(30|60|90|120|150|180)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    const fm = /f\.?\s?m\.?|fine mese/.test(s);
    if (!fm) return piuGiorni(dataFattura, n);
    return n % 30 === 0 ? fineMese(dataFattura, n / 30) : piuGiorni(fineMese(dataFattura), n);
  };
  const a = calcola(termini);
  if (a) return { scadenza: a, origine: 'TERMINI' };
  return { scadenza: calcola(predefiniti) || piuGiorni(dataFattura, 30), origine: 'PREDEFINITA' };
}

/** Fascia di aging per giorni di ritardo (negativo o zero = non scaduta). */
export function fasciaAging(giorni) { return giorni <= 0 ? 'NON_SCADUTO' : giorni <= 30 ? 'G1_30' : giorni <= 60 ? 'G31_60' : giorni <= 90 ? 'G61_90' : 'OLTRE_90'; }
export const FASCE = [['NON_SCADUTO', 'Non scaduto'], ['G1_30', '1-30 giorni'], ['G31_60', '31-60 giorni'], ['G61_90', '61-90 giorni'], ['OLTRE_90', 'Oltre 90 giorni']];

/**
 * Prossima fase dovuta per una fattura aperta. La scala si percorre in ordine e mai a salti: una fattura entrata nel widget già molto
 * scaduta riparte dal 1° sollecito, e fra una fase e la successiva passa almeno la distanza prevista dal memo (15 giorni fra 1° e 2°
 * sollecito, 10 fra 2° sollecito e chiamata, 25 fra chiamata e legale), contata dalla data in cui la fase precedente è stata
 * DAVVERO eseguita. L'avviso vale solo prima della scadenza: se la finestra è passata si salta.
 * f = { scadenza, fase, fase_at }; imp = impostazioni; oggi = 'AAAA-MM-GG'. Ritorna il numero della fase dovuta oggi o null.
 */
export function faseDovuta(f, imp, oggi) {
  const g = giorniTra(f.scadenza, oggi);                      // giorni di ritardo (negativi prima della scadenza)
  const fatta = Number(f.fase) || 0;
  const dal = f.fase_at ? String(f.fase_at instanceof Date ? iso(f.fase_at) : f.fase_at).slice(0, 10) : null;
  const passati = dal ? giorniTra(dal, oggi) : Infinity;
  if (fatta === 0 && g < 0) return g >= -Number(imp.giorni_avviso) ? 1 : null;       // finestra dell'avviso: da -7 al giorno prima
  if (g <= 0) return null;                                                             // il giorno della scadenza non è un ritardo
  if (fatta <= 1) return g >= imp.giorni_sollecito_1 ? 2 : null;
  if (fatta === 2) return g >= imp.giorni_sollecito_2 && passati >= imp.giorni_sollecito_2 - imp.giorni_sollecito_1 ? 3 : null;
  if (fatta === 3) return g >= imp.giorni_chiamata && passati >= imp.giorni_chiamata - imp.giorni_sollecito_2 ? 4 : null;
  if (fatta === 4) return g >= imp.giorni_legale && passati >= imp.giorni_legale - imp.giorni_chiamata ? 5 : null;
  return null;
}

// ---------------------------------------------------------------- riconoscimento dei bonifici
const piatto = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const FORME = new Set(['srl', 'spa', 'sas', 'snc', 'srls', 'scarl', 'soc', 'coop', 'societa', 'cooperativa', 'onlus', 'studio', 'associato', 'dott', 'dr', 'di', 'e', 'c', 'il', 'la', 'del', 'della', 'dei', 's', 'r', 'l', 'p', 'a']);
export const parole = (s) => piatto(s).split(' ').filter((w) => w.length > 1 && !FORME.has(w));
/** Somiglianza fra due ragioni sociali (0..1): parole significative in comune sul nome più corto. */
export function somiglianzaNome(a, b) {
  const A = new Set(parole(a)), B = new Set(parole(b));
  if (!A.size || !B.size) return 0;
  let comuni = 0; for (const w of A) if (B.has(w)) comuni++;
  return comuni / Math.min(A.size, B.size);
}
/** Numero di fattura in forma confrontabile: solo lettere e cifre, senza zeri iniziali ("FT 000123/2026" -> "FT1232026"). */
export const normNumero = (n) => String(n ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').map((p) => p.replace(/^0+(?=\d)/, '')).join('');
/** La causale cita questa fattura? Il numero deve comparire come parola intera (non dentro un altro numero), con o senza anno. */
export function causaleCita(causale, numero, anno = null) {
  const grezzi = String(causale ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);   // parole della causale, con i loro zeri
  const senzaZeri = (p) => p.replace(/^0+(?=\d)/, '');
  const c = ` ${grezzi.map(senzaZeri).join(' ')} `;
  const parti0 = String(numero ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const parti = parti0.map(senzaZeri);
  if (!parti.length) return false;
  // parte progressiva: la più lunga (come è scritta, zeri compresi) fatta di cifre che non sia l'anno, nemmeno a due cifre
  // ("26-00022/D": il progressivo è 00022, non 26; v0.99.6)
  const anni = new Set([String(anno || ''), String(anno || '').slice(-2)].filter(Boolean));
  const cifre = parti0.filter((p) => /^\d+$/.test(p));
  const prog0 = cifre.filter((p) => !anni.has(p) && !/^20\d\d$/.test(p) && !(cifre.length > 1 && p.length === 2 && anni.has(`20${p}`))).sort((x, y) => y.length - x.length)[0] || null;
  const prog = prog0 ? senzaZeri(prog0) : parti.find((p) => /\d/.test(p));
  if (!prog || prog.length < 2) return c.includes(` ${parti.join(' ')} `);
  if (!c.includes(` ${prog} `)) return false;
  // nella causale il progressivo è scritto con almeno 4 cifre (zeri compresi, "00022"): non è un numero qualunque
  if (grezzi.some((p) => /^\d{4,}$/.test(p) && senzaZeri(p) === prog)) return true;
  // un progressivo corto (meno di 4 cifre) è ambiguo: serve anche una parola chiave o l'anno accanto
  if (prog.length < 4) return /\b(FATT|FATTURA|FT|FATT\.|FA|INVOICE|DOC|SALDO)\b/.test(c) || Boolean(anno && c.includes(` ${anno} `));
  return true;
}

/** Serie e progressivo di un numero di documento: "26-00038/D" -> { serie: "26-|/D", prog: 38 }. Senza cifre: null. */
export function serieNumero(numero) {
  const m = String(numero ?? '').trim().toUpperCase().match(/^(.*?)(\d+)(\D*)$/);
  return m ? { serie: `${m[1]}|${m[3]}`, prog: Number(m[2]) } : null;
}
/**
 * STORNO (v0.99.6): quale fattura storna questa nota di credito? Il gestionale non lo dice (nessun collegamento tra nota e fattura),
 * quindi si deduce solo quando è certo: stesso cliente, fattura aperta e mai incassata, residuo uguale al centesimo alla parte libera
 * della nota, fattura emessa PRIMA della nota (data precedente, o stessa data e progressivo più basso nella stessa serie: così la
 * fattura riemessa dopo lo storno, con lo stesso importo, non si confonde con quella stornata).
 * Se nota e fattura riportano le accettazioni e non ne hanno nessuna in comune, la fattura è scartata.
 * Più candidate: decide l'accettazione in comune (request_ids), se ne indica una sola. Altrimenti null: resta da applicare a mano.
 * nota = { organization_id, numero, data, libera, request_ids }; fatture = [{ id, organization_id, numero, data, residuo, incassato, request_ids }].
 * Ritorna { fattura, motivo } oppure { fattura: null, candidate: n }.
 */
export function fatturaStornata(nota, fatture) {
  const libera = Math.round(Number(nota.libera) * 100) / 100;
  if (!(libera > 0) || !nota.organization_id) return { fattura: null, candidate: 0 };
  const sn = serieNumero(nota.numero);
  const prima = (f) => {
    if (String(f.data) < String(nota.data)) return true;
    if (String(f.data) > String(nota.data)) return false;
    const sf = serieNumero(f.numero);
    return Boolean(sn && sf && sf.serie === sn.serie && sf.prog < sn.prog);   // stessa data: decide il progressivo; serie diverse = non si sa
  };
  const acc0 = new Set((nota.request_ids || []).map(String));
  // accettazioni note su entrambi i documenti e nessuna in comune: non è la fattura stornata (prudenza: meglio a mano che uno storno sbagliato)
  const estranea = (f) => acc0.size > 0 && (f.request_ids || []).length > 0 && !f.request_ids.some((x) => acc0.has(String(x)));
  const cand = fatture.filter((f) => f.organization_id === nota.organization_id && Math.abs(Number(f.residuo) - libera) < 0.005 && !(Number(f.incassato) > 0.005) && prima(f) && !estranea(f));
  if (cand.length === 1) return { fattura: cand[0], motivo: 'stesso importo, unica fattura emessa prima della nota' };
  if (cand.length > 1 && nota.request_ids?.length) {
    const acc = new Set(nota.request_ids.map(String));
    const stesse = cand.filter((f) => (f.request_ids || []).some((x) => acc.has(String(x))));
    if (stesse.length === 1) return { fattura: stesse[0], motivo: 'stesso importo e stessa accettazione' };
  }
  return { fattura: null, candidate: cand.length };
}

/**
 * TIPOLOGIA di un movimento in entrata (v0.99.7), letta dalla causale della banca: serve al filtro di Incassi da abbinare.
 * Le diciture sono quelle viste in produzione il 26/11/2026 ("Bonifico a vs favore", "Incassi PagoBancomat", "Incassi Internazionali
 * Numia SpA", "Versamento contante allo sportello", "Erogazione mutuo", "Giro conto"), più le forme comuni delle altre banche.
 * Decide la dicitura in testa alla causale; poi l'ordine conta: giroconto e incassi delle carte prima del bonifico. Ciò che non si riconosce è ALTRO.
 */
export const TIPI_MOVIMENTO = [
  ['BONIFICO', 'Bonifici'], ['POS', 'POS e carte'], ['CONTANTI', 'Versamenti di contante'], ['ASSEGNO', 'Assegni'], ['SDD', 'Incassi SDD e RiBa'],
  ['GIROCONTO', 'Giroconti'], ['FINANZIAMENTO', 'Mutui e finanziamenti'], ['ALTRO', 'Altro'],
];
export function tipoMovimento(causale) {
  const t = ` ${String(causale ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
  if (/ giro ?conto | giro ?fondi | girofondo /.test(t)) return 'GIROCONTO';
  // la dicitura dell'operazione è in testa alla causale: un bonifico resta un bonifico anche se nel testo libero compare "pos" o "contanti"
  if (/^ (bonifico|bonifici|accredito bonifico|bon ) /.test(t.replace(/^ (\w+) /, ' $1 ')) || /^ bonific/.test(t)) return 'BONIFICO';
  if (/ pagobancomat | pos | numia | nexi | incassi internazionali | incasso carte | carte di credito | bancomat | american express | amex | sumup | satispay | mybank /.test(t)) return 'POS';
  if (/ contant[ei] | versamento allo sportello | cassa continua /.test(t)) return 'CONTANTI';
  if (/ assegn[oi] /.test(t)) return 'ASSEGNO';
  if (/ sdd | sepa direct debit | addebito diretto | ri ba | riba | ricevut[ae] bancari[ae] | incasso effetti /.test(t)) return 'SDD';
  if (/ mutuo | finanziamento | erogaz | anticipo fatture /.test(t)) return 'FINANZIAMENTO';
  if (/ bonific[oi] | bon | giroconto | sepa credit transfer | sct | accredito | instant /.test(t)) return 'BONIFICO';
  return 'ALTRO';
}

/**
 * Proposta di abbinamento di un bonifico in entrata alle fatture aperte.
 * mov = { importo, controparte, controparte_iban, causale }; fatture = [{ id, organization_id, org_nome, numero, data, scadenza, residuo }]
 * (aperte, residuo > 0); ibanNoti = Map iban -> organization_id (da riconciliazioni già confermate).
 * Ritorna { esito: 'AUTO' | 'PROPOSTO' | 'NESSUNO', organization_id, per, righe: [{ fattura_id, importo }], punteggio, motivo, residuo }.
 * AUTO solo quando la causale cita le fatture, l'importo coincide al centesimo con il loro residuo e nulla contraddice il cliente:
 * è l'unico caso che si conferma senza una persona.
 */
export function proponiAbbinamento(mov, fatture, { ibanNoti = new Map(), tolleranza = 0.01, stornate = [] } = {}) {
  const imp = Math.round(Number(mov.importo) * 100) / 100;
  const vuoto = { esito: 'NESSUNO', organization_id: null, per: null, righe: [], punteggio: 0, motivo: 'nessuna fattura riconosciuta', residuo: imp };
  if (!(imp > 0) || !fatture.length) return vuoto;
  const uguale = (a, b) => Math.abs(a - b) <= tolleranza;
  // 1) cliente: IBAN già noto, poi ragione sociale
  let org = null, per = null;
  if (mov.controparte_iban && ibanNoti.has(mov.controparte_iban)) { org = ibanNoti.get(mov.controparte_iban); per = 'IBAN già usato da questo cliente'; }
  if (!org && mov.controparte) {
    const voti = new Map();
    for (const f of fatture) { if (!f.organization_id || voti.has(f.organization_id)) continue; voti.set(f.organization_id, somiglianzaNome(mov.controparte, f.org_nome)); }
    const ord = [...voti.entries()].filter(([, v]) => v >= 0.75).sort((a, b) => b[1] - a[1]);
    if (ord.length === 1 || (ord.length > 1 && ord[0][1] > ord[1][1])) { org = ord[0][0]; per = 'ragione sociale dell\'ordinante'; }
  }
  // 2) fatture citate in causale
  const citate = fatture.filter((f) => causaleCita(mov.causale, f.numero, String(f.data).slice(0, 4)));
  const citateOk = org ? citate.filter((f) => f.organization_id === org) : citate;
  const clientiCitati = new Set(citateOk.map((f) => f.organization_id));
  if (citateOk.length && clientiCitati.size === 1) {
    const somma = Math.round(citateOk.reduce((s, f) => s + Number(f.residuo), 0) * 100) / 100;
    const o = org || citateOk[0].organization_id;
    if (uguale(somma, imp)) {
      // contraddizione: l'ordinante ha un nome e non somiglia affatto al cliente delle fatture citate
      const stona = !org && mov.controparte && somiglianzaNome(mov.controparte, citateOk[0].org_nome) < 0.5;
      return { esito: stona ? 'PROPOSTO' : 'AUTO', organization_id: o, per: per || 'numero di fattura in causale', righe: citateOk.map((f) => ({ fattura_id: f.id, importo: Number(f.residuo) })), punteggio: stona ? 70 : (org ? 100 : 90),
        motivo: stona ? 'fatture citate e importo esatto, ma l\'ordinante non corrisponde al cliente: da confermare' : 'fatture citate in causale e importo uguale al residuo', residuo: 0 };
    }
    // importo diverso: pagamento parziale o cumulativo, dalla più vecchia
    const righe = []; let resto = imp;
    for (const f of [...citateOk].sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza)))) { if (resto <= 0) break; const q = Math.min(resto, Number(f.residuo)); righe.push({ fattura_id: f.id, importo: Math.round(q * 100) / 100 }); resto = Math.round((resto - q) * 100) / 100; }
    return { esito: 'PROPOSTO', organization_id: o, per: per || 'numero di fattura in causale', righe, punteggio: 65, motivo: 'fatture citate in causale, importo diverso dal residuo: pagamento parziale o cumulativo da confermare', residuo: Math.max(0, resto) };
  }
  // 2b) v0.99.6: la causale cita una fattura STORNATA da nota di credito (il cliente paga con il vecchio numero): il cliente è il suo,
  //     e sotto si propone la fattura aperta di pari importo che la sostituisce. Mai conferma automatica.
  let storno = null;
  if (!citateOk.length) {
    const st = stornate.filter((f) => (!org || f.organization_id === org) && causaleCita(mov.causale, f.numero, String(f.data).slice(0, 4)));
    if (st.length && new Set(st.map((f) => f.organization_id)).size === 1) { storno = st[0]; if (!org) { org = st[0].organization_id; per = `fattura n. ${st[0].numero} citata in causale, stornata`; } }
  }
  if (!org) return citate.length ? { ...vuoto, motivo: 'la causale cita fatture di clienti diversi: da abbinare a mano' } : vuoto;
  // 3) cliente riconosciuto, nessuna fattura citata: importo uguale a UNA fattura, o al totale aperto
  const sue = fatture.filter((f) => f.organization_id === org).sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza)));
  if (!sue.length) return { ...vuoto, organization_id: org, per, motivo: 'cliente riconosciuto ma senza fatture aperte' };
  const esatte = sue.filter((f) => uguale(Number(f.residuo), imp));
  if (esatte.length === 1) return { esito: 'PROPOSTO', organization_id: org, per, righe: [{ fattura_id: esatte[0].id, importo: imp }], punteggio: storno ? 85 : 75, motivo: storno ? `la causale cita la fattura n. ${storno.numero}, stornata${storno.nota_numero ? ` dalla nota di credito n. ${storno.nota_numero}` : ''}: proposta la fattura n. ${esatte[0].numero} di pari importo, da confermare` : 'cliente riconosciuto e importo uguale a una sola fattura aperta', residuo: 0 };
  const totale = Math.round(sue.reduce((s, f) => s + Number(f.residuo), 0) * 100) / 100;
  if (uguale(totale, imp)) return { esito: 'PROPOSTO', organization_id: org, per, righe: sue.map((f) => ({ fattura_id: f.id, importo: Number(f.residuo) })), punteggio: 75, motivo: 'cliente riconosciuto e importo uguale al totale delle fatture aperte', residuo: 0 };
  const righe = []; let resto = imp;
  for (const f of sue) { if (resto <= 0) break; const q = Math.min(resto, Number(f.residuo)); righe.push({ fattura_id: f.id, importo: Math.round(q * 100) / 100 }); resto = Math.round((resto - q) * 100) / 100; }
  return { esito: 'PROPOSTO', organization_id: org, per, righe, punteggio: 45, motivo: 'cliente riconosciuto, importo senza corrispondenza esatta: attribuzione dalla fattura più vecchia, da verificare', residuo: Math.max(0, resto) };
}

// ---------------------------------------------------------------- risposte dei clienti senza modello
const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
/** Prima data futura (rispetto a oggi) scritta nel testo: gg/mm/aaaa, gg/mm, "15 dicembre". */
export function dataNelTesto(testo, oggi) {
  const t = String(testo ?? '').toLowerCase();
  const anno = Number(String(oggi).slice(0, 4)); const trovate = [];
  for (const m of t.matchAll(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/g)) trovate.push({ y: m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null, mo: Number(m[2]), d: Number(m[1]) });
  for (const m of t.matchAll(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/g)) trovate.push({ y: m[3] ? Number(m[3]) : null, mo: MESI[m[2]], d: Number(m[1]) });
  for (const x of trovate) {
    if (!(x.mo >= 1 && x.mo <= 12 && x.d >= 1 && x.d <= 31)) continue;
    const fmt = (y) => `${y}-${String(x.mo).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
    // senza anno: l'anno in corso, o il prossimo se la data è già passata (una promessa a gennaio scritta a dicembre)
    const data = x.y ? fmt(x.y) : (fmt(anno) >= oggi ? fmt(anno) : fmt(anno + 1));
    if (data >= oggi && giorniTra(oggi, data) <= 200) return data;
  }
  return null;
}
/**
 * Lettura di una risposta senza modello: { classe, confidenza, promessa_data, sintesi }. Prudente: nel dubbio ALTRO, che ferma comunque
 * gli invii automatici a quel cliente finché una persona non ha letto.
 */
export function classificaRisposta({ oggetto = '', testo = '' }, oggi) {
  const t = piatto(`${oggetto} ${testo}`);
  if (/risposta automatica|fuori sede|fuori ufficio|out of office|automatic reply|assente dal|saro assente|sono assente|ferie fino/.test(t)) return { classe: 'FUORI_UFFICIO', confidenza: 0.9, promessa_data: null, sintesi: 'Risposta automatica di assenza' };
  if (/contest|non dovut|non riconosc|errat|sbagliat|non corrett|non conforme|reclamo|non abbiamo ricevuto (la )?fattur|importo (e )?divers|nota di credito|storno|mai ricevut/.test(t)) return { classe: 'CONTESTAZIONE', confidenza: 0.7, promessa_data: null, sintesi: 'Il cliente contesta o segnala un errore sulla fattura' };
  if (/gia (stato )?pagat|gia (stato )?effettuat|gia (stato )?saldat|gia (stata )?saldat|gia disposto|bonifico (e stato )?(effettuato|eseguito|disposto)|in allegato (la )?contabile|allego (la )?contabile|abbiamo (gia )?provveduto|pagamento effettuato|cro\b|trn\b/.test(t)) return { classe: 'PAGATO', confidenza: 0.7, promessa_data: null, sintesi: 'Il cliente dichiara di avere già pagato' };
  const data = dataNelTesto(`${oggetto} ${testo}`, oggi);
  if (/provvederemo|pagheremo|salderemo|sara (pagat|saldat|effettuat)|verra (pagat|saldat|effettuat)|entro (il|la|fine)|in pagamento|pagamento previsto|prevediamo|ci impegniamo|piano di rientro|ratei|rate/.test(t)) return { classe: 'PROMESSA', confidenza: data ? 0.7 : 0.5, promessa_data: data, sintesi: data ? `Il cliente promette il pagamento entro il ${data.split('-').reverse().join('/')}` : 'Il cliente promette il pagamento senza una data precisa' };
  if (/copia (della )?fattur|invia(re|teci|rci)? (la |le )?fattur|estratto conto|duplicato|non troviamo|potete inviar|potete mandar|coordinate bancarie|iban/.test(t)) return { classe: 'RICHIESTA', confidenza: 0.6, promessa_data: null, sintesi: 'Il cliente chiede documenti o informazioni' };
  return { classe: 'ALTRO', confidenza: 0.3, promessa_data: null, sintesi: 'Risposta da leggere' };
}

// ---------------------------------------------------------------- testi
/** Sostituisce i segnaposto [nome] del modello; i segnaposto senza valore restano visibili (così un testo incompleto non parte in silenzio). */
export function compila(modello, valori) {
  return String(modello ?? '').replace(/\[([a-z_0-9 °àèéìòù/+.-]+)\]/gi, (tutto, k) => { const v = valori[k.trim().toLowerCase()]; return v == null || v === '' ? tutto : String(v); });
}
/** Segnaposto rimasti senza valore in un testo compilato. */
export const segnapostoMancanti = (testo, noti) => [...new Set([...String(testo ?? '').matchAll(/\[([a-z_0-9 °àèéìòù/+.-]+)\]/gi)].map((m) => m[1].trim().toLowerCase()).filter((k) => noti.includes(k)))];

/** Interessi di mora indicativi (D.Lgs. 231/2002): capitale x tasso annuo x giorni / 365. Tasso nullo = non calcolati. */
export function interessiMora(importo, giorni, tassoPct) {
  if (!(Number(tassoPct) > 0) || !(giorni > 0)) return null;
  return Math.round(Number(importo) * (Number(tassoPct) / 100) * giorni / 365 * 100) / 100;
}

/** Indicatori del portafoglio. fatture = [{ residuo, giorni }] aperte; incassato30 / fatturato90 per il DSO. */
export function aging(fatture) {
  const out = Object.fromEntries(FASCE.map(([k]) => [k, { n: 0, importo: 0 }]));
  for (const f of fatture) { const k = fasciaAging(f.giorni); out[k].n++; out[k].importo = Math.round((out[k].importo + Number(f.residuo)) * 100) / 100; }
  return out;
}
