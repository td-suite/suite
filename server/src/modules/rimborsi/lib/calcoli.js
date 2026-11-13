// Rimborso Spese · regole pure (senza database), testate in server/test/rimborsi.test.mjs: importi (km × tariffa), riepilogo della nota
// come nei moduli MOD025 e MOD029, saldo con anticipi e spese pagate con carta, controlli prima dell'invio (giustificativi, tariffa,
// date fuori dal mese o future, motivazione), doppioni, massimali (solo se configurati), finestra di invio, azioni per stato.

export const STATI = ['BOZZA', 'INVIATA', 'APPROVATA', 'IN_LIQUIDAZIONE', 'LIQUIDATA', 'ARCHIVIATA'];
export const STATO_LABEL = { BOZZA: 'Bozza', INVIATA: 'Inviata al responsabile', APPROVATA: 'Approvata', IN_LIQUIDAZIONE: 'In liquidazione', LIQUIDATA: 'Liquidata', ARCHIVIATA: 'Archiviata' };
export const METODI = { DIPENDENTE: 'Anticipata dal dipendente', CARTA_AZIENDALE: 'Carta aziendale', FUEL_CARD: 'Fuel card' };
export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

export const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
export const r1 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 10) / 10;
const iso = (d) => (d == null ? '' : String(d instanceof Date ? d.toISOString() : d).slice(0, 10));
export const itData = (d) => { const s = iso(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
export const nomeMese = (anno, mese) => `${MESI[mese - 1]} ${anno}`;
export const pad2 = (n) => String(n).padStart(2, '0');
export const primoGiorno = (anno, mese) => `${anno}-${pad2(mese)}-01`;
export const ultimoGiorno = (anno, mese) => `${anno}-${pad2(mese)}-${pad2(new Date(Date.UTC(anno, mese, 0)).getUTCDate())}`;
export const dentroMese = (data, anno, mese) => iso(data).slice(0, 7) === `${anno}-${pad2(mese)}`;

/** Km totali e importo di un viaggio: km è il percorso di sola andata, doppio con andata e ritorno; importo = km totali × tariffa */
export function importoViaggio({ km, andata_ritorno, tariffa, rimborsabile = true }) {
  const kmTot = r1(Number(km || 0) * (andata_ritorno ? 2 : 1));
  if (!rimborsabile || tariffa == null || tariffa === '') return { km_totali: kmTot, importo: 0 };
  return { km_totali: kmTot, importo: r2(kmTot * Number(tariffa)) };
}

/**
 * Riepilogo della nota (MOD025 + MOD029). categorie: Map id → { tipo }. Le righe escluse dal responsabile non contano (tot_escluso).
 * - spese documentate = spese anticipate dal dipendente con categoria di tipo SPESA o CARBURANTE (tabella del MOD025)
 * - rimborso chilometrico = somma degli importi dei viaggi rimborsabili (veicolo proprio); km = km totali dei viaggi rimborsabili
 * - pedaggi e parcheggi = spese anticipate dal dipendente con categoria PEDAGGIO / PARCHEGGIO (riepilogo del MOD029)
 * - pagato con carta aziendale o fuel card: solo riconciliazione, mai rimborsabile
 * - totale rimborsabile = spese + chilometrico + pedaggi + parcheggi; saldo = totale rimborsabile - anticipi ricevuti
 *   (positivo: a favore del dipendente; negativo: a favore dell'azienda)
 */
export function riepilogo({ spese = [], viaggi = [], anticipi = 0, categorie = new Map() }) {
  const out = { tot_spese: 0, tot_km: 0, tot_km_importo: 0, tot_pedaggi: 0, tot_parcheggi: 0, tot_carta: 0, tot_escluso: 0, km_registro: 0 };
  for (const s of spese) {
    const imp = Number(s.importo || 0);
    if (s.esclusa) { out.tot_escluso += imp; continue; }
    if (s.metodo && s.metodo !== 'DIPENDENTE') { out.tot_carta += imp; continue; }
    const tipo = categorie.get(Number(s.categoria_id))?.tipo || s.categoria_tipo || 'SPESA';
    if (tipo === 'PEDAGGIO') out.tot_pedaggi += imp;
    else if (tipo === 'PARCHEGGIO') out.tot_parcheggi += imp;
    else out.tot_spese += imp;
  }
  for (const v of viaggi) {
    const { km_totali, importo } = importoViaggio(v);
    if (v.esclusa) { out.tot_escluso += importo; continue; }
    if (v.rimborsabile === false || v.veicolo_tipo === 'AZIENDALE') { out.km_registro += km_totali; continue; }
    out.tot_km += km_totali;
    out.tot_km_importo += importo;
  }
  for (const k of Object.keys(out)) out[k] = ['tot_km', 'km_registro'].includes(k) ? r1(out[k]) : r2(out[k]);
  out.tot_mod029 = r2(out.tot_km_importo + out.tot_pedaggi + out.tot_parcheggi);
  out.tot_rimborsabile = r2(out.tot_spese + out.tot_mod029);
  out.anticipi = r2(anticipi);
  out.saldo = r2(out.tot_rimborsabile - out.anticipi);
  out.saldo_a_favore = out.saldo > 0 ? 'DIPENDENTE' : out.saldo < 0 ? 'AZIENDA' : 'NESSUNO';
  return out;
}

/** Testo del saldo come nei moduli: "a favore del dipendente" / "a favore dell'azienda" */
export const testoSaldo = (saldo) => (Number(saldo) > 0 ? `${eur(saldo)} a favore del dipendente` : Number(saldo) < 0 ? `${eur(Math.abs(saldo))} a favore dell'azienda` : 'nessun saldo');

/**
 * Doppioni: spese con stessa data, stesso importo e stessa categoria della stessa persona (nello stesso mese o in altri mesi), escluse le
 * righe escluse dal responsabile. tutte: [{ id, nota_id, data, importo, categoria_id, esclusa }]. Ritorna Map id → [id dei doppioni].
 */
export function doppioni(tutte) {
  const per = new Map();
  for (const s of tutte) {
    if (s.esclusa) continue;
    const k = `${iso(s.data)}|${r2(s.importo).toFixed(2)}|${s.categoria_id}`;
    if (!per.has(k)) per.set(k, []);
    per.get(k).push(s);
  }
  const out = new Map();
  for (const g of per.values()) if (g.length > 1) for (const s of g) out.set(s.id, g.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, nota_id: x.nota_id })));
  return out;
}

/** Data di una spesa o di un viaggio: dentro il mese della nota e non futura. Ritorna il messaggio d'errore o null. */
export function controllaData(data, { anno, mese, oggi }) {
  const d = iso(data);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Data non valida';
  if (d > oggi) return `La data ${itData(d)} è futura: si registrano solo spese già sostenute`;
  if (!dentroMese(d, anno, mese)) return `La data ${itData(d)} è fuori dal mese della nota (${nomeMese(anno, mese)}): registrala nella nota del suo mese`;
  return null;
}

/** Finestra di invio: entro il giorno N del mese successivo. Ritorna { scadenza, in_ritardo, mese_in_corso } */
export function finestraInvio({ anno, mese, oggi, giornoLimite = 10 }) {
  const ny = mese === 12 ? anno + 1 : anno, nm = mese === 12 ? 1 : mese + 1;
  const g = Math.min(Math.max(1, Number(giornoLimite) || 10), 28);
  const scadenza = `${ny}-${pad2(nm)}-${pad2(g)}`;
  return { scadenza, in_ritardo: oggi > scadenza, mese_in_corso: oggi <= ultimoGiorno(anno, mese) };
}

/** Massimali configurati (vuoti di default): avvisi per spesa e per giorno della stessa categoria. Ritorna Map id spesa → [testi]. */
export function controllaMassimali(spese, categorie) {
  const out = new Map();
  const add = (id, t) => { if (!out.has(id)) out.set(id, []); out.get(id).push(t); };
  const giorno = new Map();
  for (const s of spese) {
    if (s.esclusa) continue;
    const c = categorie.get(Number(s.categoria_id));
    if (!c) continue;
    if (c.massimale_spesa != null && Number(s.importo) > Number(c.massimale_spesa)) add(s.id, `oltre il massimale per spesa di ${c.nome} (${eur(c.massimale_spesa)})`);
    if (c.massimale_giorno != null) { const k = `${s.categoria_id}|${iso(s.data)}`; giorno.set(k, [...(giorno.get(k) || []), s]); }
  }
  for (const [k, g] of giorno) {
    const c = categorie.get(Number(k.split('|')[0]));
    const tot = r2(g.reduce((a, s) => a + Number(s.importo), 0));
    if (tot > Number(c.massimale_giorno)) for (const s of g) add(s.id, `${c.nome} del ${itData(s.data)}: ${eur(tot)} oltre il massimale giornaliero (${eur(c.massimale_giorno)})`);
  }
  return out;
}

/**
 * Controlli prima dell'invio. Ritorna { bloccanti: [testi], avvisi: [testi], righe: Map 'S:id'|'V:id' → [testi] }.
 * nota: { anno, mese, motivazione }; allegati: [{ riga_tipo, riga_id }]; categorie: Map id → { nome, giustificativo_obbligatorio };
 * eccezione: giustificativo facoltativo per la persona; oggi: AAAA-MM-GG; vettura: la persona ha una vettura aziendale nel mese.
 */
export function controlliInvio({ nota, spese = [], viaggi = [], allegati = [], categorie = new Map(), eccezione = false, oggi, giornoLimite = 10, doppi = new Map(), massimali = new Map() }) {
  const bloccanti = [], avvisi = [];
  const righe = new Map();
  const add = (k, t) => { if (!righe.has(k)) righe.set(k, []); righe.get(k).push(t); };
  const conAllegato = new Set(allegati.filter((a) => a.riga_tipo !== 'NOTA').map((a) => `${a.riga_tipo === 'SPESA' ? 'S' : 'V'}:${a.riga_id}`));
  const vive = spese.filter((s) => !s.esclusa), viaggiVivi = viaggi.filter((v) => !v.esclusa);
  if (!vive.length && !viaggiVivi.length) bloccanti.push('La nota è vuota: aggiungi almeno una spesa o un viaggio');
  const generale = String(nota.motivazione || '').trim();
  let senzaGiust = 0, senzaMotivo = 0, fuori = 0, senzaTariffa = 0;
  for (const s of vive) {
    const e = controllaData(s.data, { anno: nota.anno, mese: nota.mese, oggi });
    if (e) { add(`S:${s.id}`, e); fuori++; }
    const c = categorie.get(Number(s.categoria_id));
    if (c?.giustificativo_obbligatorio && !eccezione && !conAllegato.has(`S:${s.id}`)) { add(`S:${s.id}`, 'giustificativo mancante'); senzaGiust++; }
    if (!generale && !String(s.motivazione || '').trim()) { add(`S:${s.id}`, 'motivazione mancante'); senzaMotivo++; }
    for (const t of massimali.get(s.id) || []) add(`S:${s.id}`, t);
    if (doppi.has(s.id)) add(`S:${s.id}`, 'possibile doppione (stessa data, importo e categoria)');
  }
  for (const v of viaggiVivi) {
    const e = controllaData(v.data, { anno: nota.anno, mese: nota.mese, oggi });
    if (e) { add(`V:${v.id}`, e); fuori++; }
    const rimb = v.rimborsabile !== false && v.veicolo_tipo !== 'AZIENDALE';
    if (rimb && (v.tariffa == null || Number(v.tariffa) <= 0)) { add(`V:${v.id}`, 'tariffa EUR/km mancante'); senzaTariffa++; }
    if (!String(v.motivazione || '').trim() && !generale) { add(`V:${v.id}`, 'motivazione mancante'); senzaMotivo++; }
  }
  if (fuori) bloccanti.push(`${fuori} ${fuori === 1 ? 'riga ha' : 'righe hanno'} la data fuori dal mese o futura`);
  if (senzaGiust) bloccanti.push(`${senzaGiust} ${senzaGiust === 1 ? 'spesa senza' : 'spese senza'} giustificativo: i rimborsi senza giustificativo non saranno liquidati`);
  if (senzaTariffa) bloccanti.push(`${senzaTariffa} ${senzaTariffa === 1 ? 'viaggio senza' : 'viaggi senza'} tariffa EUR/km: inserisci la tariffa ACI del veicolo (I miei veicoli) o chiedila a P&C`);
  if (senzaMotivo) bloccanti.push(`${senzaMotivo} ${senzaMotivo === 1 ? 'riga senza' : 'righe senza'} motivazione: scrivila sulla riga o come motivazione generale della nota`);
  const nDoppi = vive.filter((s) => doppi.has(s.id)).length;
  if (nDoppi) avvisi.push(`${nDoppi} ${nDoppi === 1 ? 'spesa sembra' : 'spese sembrano'} un doppione (stessa data, importo e categoria): controlla prima di inviare`);
  const nMax = vive.filter((s) => massimali.has(s.id)).length;
  if (nMax) avvisi.push(`${nMax} ${nMax === 1 ? 'spesa supera' : 'spese superano'} un massimale della categoria: il responsabile valuterà`);
  const f = finestraInvio({ anno: nota.anno, mese: nota.mese, oggi, giornoLimite });
  if (f.in_ritardo) avvisi.push(`Invio in ritardo: la nota di ${nomeMese(nota.anno, nota.mese)} andava inviata entro il ${itData(f.scadenza)}`);
  if (f.mese_in_corso) avvisi.push(`Il mese non è finito: dopo l'invio le spese di ${nomeMese(nota.anno, nota.mese)} non si possono più aggiungere (salvo respingimento)`);
  return { bloccanti, avvisi, righe, finestra: f };
}

/**
 * Azioni possibili sulla nota per l'utente (funzione pura). ruolo: { proprietario, responsabile (approva questa nota), pc, titolare }.
 * Separazione dei ruoli: nessuno approva né liquida la propria nota.
 */
export function azioni(nota, ruolo) {
  const s = nota.stato;
  const mia = Boolean(ruolo.proprietario);
  const approva = !mia && (nota.al_pc ? Boolean(ruolo.pc) : Boolean(ruolo.responsabile));
  const pc = !mia && Boolean(ruolo.pc);
  return {
    modifica: mia && s === 'BOZZA',
    invia: mia && s === 'BOZZA',
    approva: approva && s === 'INVIATA',
    respingi: approva && s === 'INVIATA',
    escludi: approva && s === 'INVIATA',
    prendi_in_carico: pc && s === 'APPROVATA',
    rimanda: pc && ['APPROVATA', 'IN_LIQUIDAZIONE'].includes(s),
    ricalcola_responsabile: (pc || Boolean(ruolo.titolare)) && !mia && s === 'INVIATA' && !nota.al_pc,
    liquida: pc && ['APPROVATA', 'IN_LIQUIDAZIONE'].includes(s),
    archivia: pc && s === 'LIQUIDATA',
  };
}

/** Destinatari del PDF di approvazione validi (nome facoltativo, email ben formata), in minuscolo */
export const destinatariValidi = (lista) => (Array.isArray(lista) ? lista : []).map((d) => ({ nome: String(d?.nome || '').trim(), email: String(d?.email || '').trim().toLowerCase() }))
  .filter((d) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email));

/** Numero di righe tra le spese e i viaggi */
export const contaRighe = (spese, viaggi) => spese.length + viaggi.length;
