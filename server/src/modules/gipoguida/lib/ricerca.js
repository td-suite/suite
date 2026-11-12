// Guida GIPO · ricerca full text italiano su sezioni e FAQ pubblicate (v0.71.1: recupero per le domande di back-end).
// Indice delle sezioni: ricerca_tsv (migrazione 002, trigger) con pesi A titolo e parole chiave, B sintesi, titolo del capitolo e domande
// delle FAQ collegate, C testo, D percorso in GIPO. FAQ: tsv con A domanda, B risposta.
// Ogni parola significativa della ricerca diventa un gruppo di alternative: la parola (stemming italiano), i sinonimi del dizionario
// (agenda/calendario/orario/turno, medico/specialista/dottore, periodicità/alterne/mensile, listino/prezzo/tariffa, pacchetto/distinta,
// ferie/chiusura/festivo, compenso/provvigione, ...) e, per l'ultima parola mentre si scrive, il prefisso. Alcune espressioni intere
// ("primo martedì", "ogni due settimane", "orario estivo") aggiungono un gruppo dedicato con peso doppio.
// Ricerca OR con ranking (non AND stretto): ogni gruppo vale il suo idf (più è raro nella guida, più conta), di più se la parola è nel
// titolo o nelle parole chiave; la copertura (quota pesata dei gruppi trovati) ordina i risultati. Le FAQ trovate rafforzano la sezione a
// cui sono collegate. Ripiego per trigrammi (pg_trgm) su titolo e parole chiave quando il full text non trova nulla.
// cercaGuida(q) resta l'API per la pagina, le FAQ e la ricerca globale della Suite (lib/search.js); recupera(q) serve alle risposte.
import { many, q as query } from '../db.js';

const senzaAccenti = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Parole che non distinguono un argomento (verbi di servizio delle domande, articoli e preposizioni che PostgreSQL non toglie)
export const PAROLE_VUOTE = new Set(['faccio', 'fare', 'fa', 'fai', 'posso', 'puo', 'puoi', 'devo', 'deve', 'devono', 'bisogna', 'serve', 'servono', 'vorrei', 'voglio',
  'modo', 'gipo', 'giponext', 'cosa', 'quale', 'quali', 'dove', 'come', 'quando', 'perche', 'solo', 'soltanto', 'ogni', 'anche', 'ancora', 'tutti', 'tutte', 'tutto',
  'imposto', 'impostare', 'imposta', 'gestire', 'gestisco', 'gestione', 'metto', 'mettere', 'viene', 'vengono', 'venire', 'ci', 'mi', 'si', 'ne', 'ad', 'ed', 'un', 'una',
  'uno', 'il', 'lo', 'la', 'le', 'gli', 'di', 'da', 'del', 'della', 'dei', 'delle', 'dal', 'dalla', 'per', 'con', 'su', 'in', 'nel', 'nella', 'al', 'alla', 'ai', 'che',
  'non', 'mio', 'mia', 'nostro', 'nostra', 'questo', 'questa', 'quello', 'quella', 'cui', 'qual', 'avere', 'essere', 'stato', 'sono', 'era', 'ho', 'ha', 'hanno', 'abbiamo',
  'dopo', 'prima', 'certa', 'certo', 'alcuni', 'alcune', 'qualche', 'volta', 'volte', 'sempre', 'esempio']);

// Sinonimi: radice (inizio della parola senza accenti; "=parola" = parola esatta) → alternative da cercare insieme alla parola
export const SINONIMI = [
  // dal brief v0.70.0
  { radici: ['prenot'], alternative: ['appuntamento', 'agenda'] },
  { radici: ['appuntament'], alternative: ['prenotazione'] },
  { radici: ['incass'], alternative: ['cassa'] },
  { radici: ['cassa', 'casse'], alternative: ['incasso'] },
  { radici: ['storn'], alternative: ['nota di credito'] },
  { radici: ['ricett'], alternative: ['impegnativa'] },
  { radici: ['impegnativ'], alternative: ['ricetta'] },
  { radici: ['disdett', 'disdir'], alternative: ['annulla appuntamento'] },
  { radici: ['scontrin'], alternative: ['fattura'] },
  // v0.71.1: agende e presenze
  { radici: ['calendar', 'turn', 'disponib', 'presenz', 'present'], alternative: ['agenda', 'orario'] },
  { radici: ['orari'], alternative: ['configurazione base', 'agenda'] },
  { radici: ['agend'], alternative: ['configurazione agenda'] },
  { radici: ['specialist', 'dottor', 'professionist', 'radiolog', 'cardiolog', 'dermatolog', 'ginecolog', 'ortoped', 'oculist', '=doc'], alternative: ['medico'] },
  { radici: ['ricorren', 'periodic', 'altern', 'mensil', 'quindicinal', 'bisettiman'], alternative: ['periodicità', 'sottoconfigurazione'] },
  { radici: ['settiman'], alternative: ['periodicità in settimane'] },
  { radici: ['luned', 'marted', 'mercoled', 'gioved', 'venerd', 'sabat', 'domenic'], alternative: ['configurazione base', 'sottoconfigurazione'] },
  { radici: ['sottoconfig'], alternative: ['periodicità'] },
  { radici: ['estiv', 'estat', 'invern', 'stagion'], alternative: ['orario estivo', 'sottoconfigurazione', 'validità'] },
  { radici: ['sostitu', 'rimpiazz', 'supplen'], alternative: ['sostituzione', 'sottoconfigurazione'] },
  { radici: ['feri', 'vacanz', 'chius', 'festiv', 'ponte', 'natal', 'ferragost', 'assenz'], alternative: ['giorni festivi', 'periodo festivo', 'chiusura', 'ferie'] },
  { radici: ['blocc', 'sospend'], alternative: ['chiusura', 'giorni festivi'] },
  { radici: ['slot', 'durat', 'minut'], alternative: ['slot', 'tempo previsto'] },
  { radici: ['duplic', 'clon', '=copiare', '=copio', '=copia'], alternative: ['duplica'] },
  { radici: ['limit', 'prenotabil', 'abilit', 'esclud'], alternative: ['prestazioni prenotabili', 'prestazioni listini'] },
  { radici: ['occupazion', '=meta', '=peso', '=parziale', '=parzialmente'], alternative: ['occupazioni parziali'] },
  // prestazioni, listini e prezzi
  { radici: ['esam', 'visit', 'analis'], alternative: ['prestazione'] },
  { radici: ['tariff', 'prezz', '=costo', '=costi', '=costa'], alternative: ['listino', 'prezzo'] },
  { radici: ['listin'], alternative: ['prezzo'] },
  { radici: ['aument', 'increment', 'rincar', 'rialz', 'ritocc'], alternative: ['incremento', 'copia prezzi'] },
  { radici: ['pacchett', 'bundle', 'checkup', 'check', 'compost'], alternative: ['pacchetto', 'distinta base'] },
  { radici: ['distint'], alternative: ['pacchetto'] },
  { radici: ['consens', 'liberator', 'informativ'], alternative: ['consenso', 'moduli collegati', 'modulistica'] },
  { radici: ['modul'], alternative: ['modulistica', 'moduli collegati'] },
  { radici: ['colleg'], alternative: ['collegato', 'moduli collegati'] },
  { radici: ['preparazion', 'digiun'], alternative: ['note preparazione'] },
  // medici, compensi, utenti
  { radici: ['compens', 'provvigion', 'retribu', 'onorar'], alternative: ['compenso', 'provvigioni', 'regole compenso'] },
  { radici: ['=collega', '=colleghi', 'utent', 'account', 'permess', 'operator'], alternative: ['utente', 'invita utente'] },
  { radici: ['credenzial', 'password'], alternative: ['credenziali', 'modulo credenziali'] },
  // sedi, fatturazione, assicurazioni
  { radici: ['=sede', '=sedi', 'struttur', 'poliambulator', 'filial', '=centro', '=centri'], alternative: ['sede'] },
  { radici: ['sezional', 'numerazion'], alternative: ['sezionale'] },
  { radici: ['rat', 'rateizz', 'dilazion'], alternative: ['rate', 'scadenze', 'scadenzario'] },
  { radici: ['metod'], alternative: ['metodo di pagamento'] },
  { radici: ['pagament'], alternative: ['metodo di pagamento', 'scadenze'] },
  { radici: ['convenzion', '=fondo', '=fondi'], alternative: ['assicurazione', 'listino'] },
  { radici: ['assicur'], alternative: ['convenzione'] },
  { radici: ['boll', 'marca'], alternative: ['natura bollo', 'bollo'] },
  { radici: ['tracciat', 'fluss', 'rendicont'], alternative: ['tracciati', 'riepilogo asl'] },
  { radici: ['=asl'], alternative: ['riepilogo asl', 'tracciati'] },
  { radici: ['tabell'], alternative: ['in riga'] },
  // percorso del paziente (manuale TD)
  { radici: ['refert'], alternative: ['referto', 'refertazione'] },
  { radici: ['idoneit', 'certificat'], alternative: ['idoneità', 'certificato'] },
  { radici: ['assegn'], alternative: ['assegnazione'] },
  { radici: ['controll', 'verific'], alternative: ['verifica', 'controlli'] },
];

// Espressioni intere (testo senza accenti, minuscolo) → gruppo dedicato con peso doppio
export const FRASI = [
  { re: /\b(primo|secondo|terzo|quarto|ultimo|prima|seconda|terza|quarta|ultima)\b[^.?!]{0,30}\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|settimana)\b/, cerca: ['periodicità nel mese', 'sottoconfigurazione'] },
  { re: /\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b[^.?!]{0,30}\b(del|di ogni|al|nel|ogni) mese\b/, cerca: ['periodicità nel mese', 'sottoconfigurazione'] },
  { re: /\b(alcuni|certi|determinati|pochi) giorni\b|\bgiorni del mese\b|\bvolt[ae] al mese\b|\bal mese\b/, cerca: ['periodicità nel mese', 'sottoconfigurazione'] },
  { re: /\bogni (due|2|tre|3|quattro|4) settimane\b|\bsettimane alterne\b|\bsettimana si e (una )?no\b|\ba settimane\b|\bquindici giorni\b|\bquindicinal/, cerca: ['periodicità in settimane', 'sottoconfigurazione'] },
  { re: /\b(da|dal|a partire da|dalla) (una )?(certa )?(data|giorno|mese|prossimo|1|primo)\b|\bda (lunedi|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b|\bper un periodo\b/, cerca: ['data inizio validità', 'validità'] },
  { re: /\borario (estivo|invernale)\b|\b(d'estate|in estate|d'inverno)\b|\bluglio\b.*\bagosto\b/, cerca: ['orario estivo', 'sottoconfigurazione'] },
  { re: /\b(del|di) \d+ ?%|\b\d+ ?(%|per ?cento)\b/, cerca: ['incremento', 'copia prezzi di listino'] },
  { re: /\bin riga\b|\bnon (trovo|c'e) (la pagina|il pulsante)\b/, cerca: ['tabelle in riga'] },
  { re: /\bnatura (del )?bollo\b|\bn4\b/, cerca: ['natura bollo'] },
];

/** Parole della ricerca (minuscole, almeno 2 caratteri, al più 10, senza parole vuote e numeri) e alternative per ciascuna. Funzione pura. */
export function gruppiRicerca(testo, { vuote = true } = {}) {
  const tutte = (String(testo || '').toLowerCase().replace(/[’']/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
  let parole = vuote ? tutte.filter((p) => !PAROLE_VUOTE.has(senzaAccenti(p))) : tutte;
  if (!parole.length) parole = tutte;
  parole = [...new Set(parole)].slice(0, 10);
  return parole.map((p) => {
    const base = senzaAccenti(p);
    const alt = new Set();
    for (const s of SINONIMI) if (s.radici.some((r) => (r.startsWith('=') ? base === r.slice(1) : base.startsWith(r)))) s.alternative.forEach((a) => alt.add(a));
    return { parola: p, alternative: [...alt] };
  });
}

/** Espressioni intere riconosciute nel testo → gruppi aggiuntivi. Funzione pura. */
export function frasiRicerca(testo) {
  const t = senzaAccenti(String(testo || '').toLowerCase()).replace(/[’']/g, '\'');
  const out = [];
  for (const f of FRASI) if (f.re.test(t)) out.push({ frase: true, parola: f.cerca[0], alternative: f.cerca.slice(1) });
  return out;
}

/**
 * Gruppi della ricerca come tsquery (stringhe): per ogni gruppo le alternative in OR, normalizzate da plainto_tsquery('italian') (le
 * parole vuote di PostgreSQL spariscono). Ritorna [{ parola, frase, q, qAB }] dove qAB è la stessa tsquery ristretta ai pesi A e B
 * (titolo, parole chiave, sintesi, FAQ collegate). prefisso: l'ultima parola vale anche come prefisso (risultati mentre si scrive).
 */
export async function tsqueryDi(testo, { prefisso = true, frasi = true } = {}) {
  const gruppi = [...gruppiRicerca(testo), ...(frasi ? frasiRicerca(testo) : [])];
  if (!gruppi.length) return [];
  const voci = [...new Set(gruppi.flatMap((g) => [g.parola, ...g.alternative]))];
  const norm = new Map((await many(`SELECT t, plainto_tsquery('italian', t)::text AS q FROM unnest($1::text[]) t`, [voci])).map((r) => [r.t, r.q]));
  const parole = gruppi.filter((g) => !g.frase);
  return gruppi.map((g) => {
    const alt = [g.parola, ...g.alternative].map((v) => norm.get(v)).filter(Boolean).map((x) => (x.includes('&') ? `( ${x} )` : x));
    const ultima = !g.frase && g === parole[parole.length - 1];
    const pulita = senzaAccenti(g.parola).replace(/[^a-z0-9]/g, '');
    if (prefisso && ultima && pulita.length >= 3) alt.push(`'${pulita.slice(0, Math.max(3, Math.min(pulita.length, pulita.length >= 7 ? pulita.length - 2 : pulita.length)))}':*`);
    if (!alt.length) return null;
    const q = alt.length > 1 ? `( ${[...new Set(alt)].join(' | ')} )` : alt[0];
    const qAB = q.replace(/'((?:[^']|'')*)'(:\*)?/g, (_m, l, p) => `'${l}':${p ? '*' : ''}AB`);
    return { parola: g.parola, frase: Boolean(g.frase), q, qAB };
  }).filter(Boolean);
}

// Corpo senza segni markdown e senza destinazioni dei collegamenti, per l'evidenziazione
const CORPO_PULITO = `regexp_replace(regexp_replace(regexp_replace(regexp_replace(%s, '\\[([^\\]]*)\\]\\((sezione:|https?:)[^)]*\\)', '\\1', 'g'), '(^|\\n)\\s*>\\s?', '\\1', 'g'), '[#*_\`|]+', ' ', 'g'), '\\s+', ' ', 'g')`;
const HL = `'MaxWords=32, MinWords=14, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … ", StartSel=<b>, StopSel=</b>'`;

/**
 * Punteggio di sezioni o FAQ per i gruppi dati. Per ogni gruppo: idf = ln(1 + N / righe che lo contengono); trovato vale 0.65 + 0.35 se
 * è nei pesi A/B; le frasi valgono doppio. copertura = somma pesata dei trovati / somma degli idf. score = copertura + 0.25 * ts_rank
 * della OR + 0.3 * somiglianza del titolo (trigrammi). Ritorna righe { id, score, copertura, trovati }.
 */
async function punteggi(tab, gruppi, lq, { soglia = 0, limite = 40, ids = null }) {
  const tsv = tab === 'sezioni' ? 'ricerca_tsv' : 'tsv';
  const titolo = tab === 'sezioni' ? `lower(titolo || ' ' || coalesce(parole_chiave, ''))` : 'lower(domanda)';
  const filtro = tab === 'faq' ? 'pubblicata' : 'TRUE';
  const n = gruppi.length;
  const p = [lq];
  const pq = gruppi.map((g) => { p.push(g.q); return `$${p.length}::tsquery`; });
  const pab = gruppi.map((g) => { p.push(g.qAB); return `$${p.length}::tsquery`; });
  // idf dei gruppi
  let idf = gruppi.map(() => 1);
  if (n) {
    const r = (await many(`SELECT count(*)::int AS tot, ${gruppi.map((_g, i) => `count(*) FILTER (WHERE ${tsv} @@ $${i + 1}::tsquery)::int AS g${i}`).join(', ')} FROM ${tab} WHERE ${filtro}`, gruppi.map((g) => g.q)))[0];
    idf = gruppi.map((g, i) => Math.log(1 + (r.tot || 1) / Math.max(1, r[`g${i}`])) * (g.frase ? 2 : 1));
  }
  const somma = idf.reduce((a, b) => a + b, 0) || 1;
  const orq = n ? `(${pq.join(' || ')})` : null;
  const espr = n ? gruppi.map((_g, i) => `(CASE WHEN ${tsv} @@ ${pq[i]} THEN ${idf[i]} * (0.65 + 0.35 * (${tsv} @@ ${pab[i]})::int) ELSE 0 END)`).join(' + ') : '0';
  const trovati = n ? gruppi.map((_g, i) => `(${tsv} @@ ${pq[i]})::int`).join(' + ') : '0';
  let extra = '';
  if (ids) { p.push(ids); extra = ` AND id = ANY($${p.length}::int[])`; }
  p.push(limite);
  return many(`SELECT * FROM (SELECT id, (${espr}) / ${somma} AS copertura, (${trovati}) AS trovati,
      (${espr}) / ${somma} + ${orq ? `0.25 * ts_rank(${tsv}, ${orq})` : '0'} + 0.3 * similarity(${titolo}, $1) AS score, similarity(${titolo}, $1) AS sim
    FROM ${tab} WHERE ${filtro}${extra}) x WHERE (trovati > 0 OR sim > 0.3) AND score > ${soglia} ORDER BY score DESC, id LIMIT $${p.length}`, p);
}

/** Dettagli (titolo, capitolo, snippet evidenziato, testo) delle sezioni e FAQ trovate, nello stesso ordine */
async function dettagli(sezIds, faqIds, gruppi) {
  const hl = gruppi.length ? `(${gruppi.map((g) => g.q).join(' | ')})` : '';
  const p = [sezIds, faqIds, hl];
  const sez = sezIds.length ? await many(`SELECT 'sezione' AS tipo, s.id, s.titolo, s.slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, s.fonte, s.livello, s.sintesi,
      NULL::int AS sezione_id, NULL::text AS sezione_slug,
      coalesce(CASE WHEN $3 <> '' THEN ts_headline('italian', ${CORPO_PULITO.replace('%s', 's.corpo')}, $3::tsquery, ${HL}) END, left(${CORPO_PULITO.replace('%s', 's.corpo')}, 240)) AS snippet,
      s.corpo AS testo
    FROM sezioni s LEFT JOIN capitoli k ON k.numero = s.capitolo WHERE s.id = ANY($1::int[]) AND $2::int[] IS NOT NULL`, p) : [];
  const faq = faqIds.length ? await many(`SELECT 'faq' AS tipo, f.id, f.domanda AS titolo, NULL::text AS slug, s.capitolo, k.titolo AS capitolo_titolo, s.percorso_gipo, s.stato, s.fonte, s.livello, NULL::text AS sintesi,
      f.sezione_id, s.slug AS sezione_slug,
      coalesce(CASE WHEN $3 <> '' THEN ts_headline('italian', ${CORPO_PULITO.replace('%s', 'f.risposta')}, $3::tsquery, ${HL}) END, left(${CORPO_PULITO.replace('%s', 'f.risposta')}, 240)) AS snippet,
      f.risposta AS testo
    FROM faq f LEFT JOIN sezioni s ON s.id = f.sezione_id LEFT JOIN capitoli k ON k.numero = s.capitolo WHERE f.id = ANY($2::int[]) AND $1::int[] IS NOT NULL`, p) : [];
  return { sez: new Map(sez.map((x) => [x.id, x])), faq: new Map(faq.map((x) => [x.id, x])) };
}

export const linkSezione = (slug) => `/gipoguida/guida/${slug}`;
export const linkFaq = (id) => `/gipoguida/faq?voce=${id}`;

/**
 * Recupero ordinato di sezioni e FAQ (OR con ranking). Le FAQ trovate aggiungono metà del loro punteggio alla sezione collegata.
 * Ritorna { sezioni: [...], faq: [...], gruppi } con i campi di dettagli() più score, copertura, trovati, parziale (non tutti i gruppi
 * di parole trovati), link. livello: 'BACK_END' per limitare le sezioni a quelle di configurazione.
 */
export async function recupera(testo, { limiteSezioni = 12, limiteFaq = 8, prefisso = false, tipi = ['sezione', 'faq'], livello = null } = {}) {
  const t = String(testo || '').trim().slice(0, 300);
  if (t.length < 2) return { sezioni: [], faq: [], gruppi: [] };
  const gruppi = await tsqueryDi(t, { prefisso });
  const lq = senzaAccenti(t.toLowerCase()).slice(0, 200);
  const parole = gruppi.filter((g) => !g.frase).length;
  const faqScore = tipi.includes('faq') || tipi.includes('sezione') ? await punteggi('faq', gruppi, lq, { limite: 30 }) : [];
  let sezScore = tipi.includes('sezione') ? await punteggi('sezioni', gruppi, lq, { limite: 60 }) : [];
  if (livello) {
    const ok = new Set((await many('SELECT id FROM sezioni WHERE livello = $1', [livello])).map((r) => r.id));
    sezScore = sezScore.filter((x) => ok.has(x.id));
  }
  // rinforzo dalle FAQ: la sezione collegata a una FAQ molto pertinente sale
  const faqSez = faqScore.length ? new Map((await many('SELECT id, sezione_id FROM faq WHERE id = ANY($1::int[])', [faqScore.map((f) => f.id)])).map((r) => [r.id, r.sezione_id])) : new Map();
  const bonus = new Map();
  for (const f of faqScore) { const sid = faqSez.get(f.id); if (sid) bonus.set(sid, Math.max(bonus.get(sid) || 0, Number(f.score) * 0.5)); }
  const mappa = new Map(sezScore.map((x) => [x.id, { ...x, score: Number(x.score) }]));
  for (const [sid, b] of bonus) {
    const x = mappa.get(sid);
    if (x) x.score += b;
    else if (b > 0.2 && (!livello || sezScore.length === 0)) mappa.set(sid, { id: sid, score: b, copertura: 0, trovati: 0 });
  }
  if (livello && bonus.size) {   // le sezioni rinforzate dalle FAQ devono comunque essere del livello richiesto
    const ok = new Set((await many('SELECT id FROM sezioni WHERE livello = $1', [livello])).map((r) => r.id));
    for (const k of [...mappa.keys()]) if (!ok.has(k)) mappa.delete(k);
  }
  const sezOrd = [...mappa.values()].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limiteSezioni);
  const faqOrd = tipi.includes('faq') ? faqScore.slice(0, limiteFaq) : [];
  const d = await dettagli(sezOrd.map((x) => x.id), faqOrd.map((x) => x.id), gruppi);
  const arricchisci = (x, det) => ({ ...det, score: Number(x.score) || 0, copertura: Number(x.copertura) || 0, trovati: Number(x.trovati) || 0,
    parziale: Number(x.trovati) < parole, link: det.tipo === 'sezione' ? linkSezione(det.slug) : linkFaq(det.id) });
  return {
    sezioni: sezOrd.filter((x) => d.sez.has(x.id)).map((x) => arricchisci(x, d.sez.get(x.id))),
    faq: faqOrd.filter((x) => d.faq.has(x.id)).map((x) => arricchisci(x, d.faq.get(x.id))),
    gruppi,
  };
}

/**
 * Ricerca nella guida per la pagina, le FAQ e la ricerca globale: sezioni e FAQ pubblicate, i più pertinenti per primi (stesso ranking
 * di recupera). Ritorna [{ tipo, id, titolo, slug, capitolo, capitolo_titolo, percorso_gipo, stato, fonte, livello, sezione_slug, snippet,
 * testo, score, copertura, parziale, link }]: parziale = non tutte le parole della ricerca sono state trovate.
 */
export async function cercaGuida(testo, { limite = 10, tipi = ['sezione', 'faq'], prefisso = true, livello = null } = {}) {
  const r = await recupera(testo, { limiteSezioni: limite, limiteFaq: limite, prefisso, tipi, livello });
  const tutti = [...r.sezioni, ...r.faq.map((f) => ({ ...f, score: f.score * 1.05 }))];
  // prima chi contiene tutte le parole, poi per punteggio
  return tutti.sort((a, b) => Number(a.parziale) - Number(b.parziale) || b.score - a.score || (a.tipo === b.tipo ? 0 : a.tipo === 'sezione' ? -1 : 1))
    .slice(0, limite).map((x) => ({ ...x, testo: String(x.testo || '').slice(0, 4000) }));
}

/**
 * Registra una ricerca per le statistiche (testo già mascherato). Le battute successive della stessa ricerca (stesso utente, entro 60
 * secondi, testo che estende o accorcia il precedente) aggiornano la riga invece di aggiungerne una.
 */
export async function registraRicerca(utente, testo, risultati) {
  const t = String(testo || '').trim().slice(0, 200);
  if (t.length < 2) return;
  const ult = (await query(`SELECT id, testo FROM ricerche WHERE utente IS NOT DISTINCT FROM $1 AND aggiornata_il > now() - interval '60 seconds' ORDER BY aggiornata_il DESC LIMIT 1`, [utente || null])).rows[0];
  const a = t.toLowerCase(); const b = ult?.testo?.toLowerCase();
  if (ult && (a.startsWith(b) || b.startsWith(a))) {
    await query('UPDATE ricerche SET testo = $2, risultati = $3, aggiornata_il = now() WHERE id = $1', [ult.id, t, risultati]);
  } else {
    await query('INSERT INTO ricerche (utente, testo, risultati) VALUES ($1,$2,$3)', [utente || null, t, risultati]);
  }
}
