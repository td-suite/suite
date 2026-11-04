// JSON della scheda (motore del 03/11/2026, richiesta del CEO): rispecchia ESATTAMENTE le chiamate del generatore del progetto
// (lib/formatTD.js), non il vecchio schema dei parser.
//   { anagrafica: { cognome_nome, righe: [[etichetta, valore], ...] },     righe del riquadro come vanno stampate
//     blocchi: [ { tipo: 'settore', titolo }
//              | { tipo: 'titolo_esame', testo }
//              | { tipo: 'paragrafo', testo, stile: 'small'|'normale', before, after }
//              | { tipo: 'tabella1', righe: [{ nome, risultato, riferimento, bold_name, small: [], unit }] }      corpo 1
//              | { tipo: 'esame2', nome, metodo: [] }                                                          corpo 2
//              | { tipo: 'tabella2', righe: [{ etichetta, valore, riferimento? }] }
//              | { tipo: 'antibiogramma', specie, n, carica, carica_lbl, legenda, righe: [[antibiotico, sir, mic]] }
//              | { tipo: 'spacer' } ],
//     nome_file, sorgente, note_anomalie: [] }
// Qui: validazione zod (lettura con Claude, PATCH della scheda, correzione), colonne di ricerca dall'anagrafica, anomalie automatiche,
// conteggi, conversione dall'uscita dei parser di riserva. Funzioni pure (nessun accesso al database), provate con node --test.
import { z } from 'zod';
import { anagraficaAbbreviata, compattaSpazi } from './text.js';
import { LEG_DEFAULT } from './formatTD.js';
import { anomalia } from './parsers/common.js';

export const SORGENTI_AMMESSE = ['BIANALISI', 'CERBA_RDI', 'CERBA_NUOVA_IGEA', 'ALTRO'];
export const TIPI_BLOCCO = ['settore', 'titolo_esame', 'paragrafo', 'tabella1', 'esame2', 'tabella2', 'antibiogramma', 'spacer'];

// Solo le legature tipografiche (regola della specifica): nessun'altra modifica al testo, per non rompere la parità col generatore
const LEGATURE = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
export const senzaLegature = (s) => String(s).replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, (c) => LEGATURE[c]);

const txt = (max = 20000) => z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => (v == null ? '' : senzaLegature(v))).pipe(z.string().max(max));
const intero = (min, max, def) => z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v) => (v == null || v === '' ? def : Number(v))).pipe(z.number().int().min(min).max(max));
const lista = (max) => z.union([z.array(txt(2000)), z.string(), z.null(), z.undefined()]).transform((v) => (v == null ? [] : Array.isArray(v) ? v : String(v).split('\n'))).pipe(z.array(z.string()).max(max));

// Riga del riquadro: [etichetta, valore] (accettato anche { etichetta, valore })
const rigaAnagrafica = z.union([z.tuple([txt(100), txt(500)]), z.object({ etichetta: txt(100), valore: txt(500) }).transform((o) => [o.etichetta, o.valore])]);
export const anagraficaSchema = z.object({ cognome_nome: txt(200), righe: z.array(rigaAnagrafica).max(20).default([]) });

const rigaAntibiotico = z.union([
  z.tuple([txt(200), txt(40), txt(100)]),
  z.object({ antibiotico: txt(200), sir: txt(40), mic: txt(100) }).transform((o) => [o.antibiotico, o.sir, o.mic]),
]);
export const bloccoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('settore'), titolo: txt(300) }),
  z.object({ tipo: z.literal('titolo_esame'), testo: txt(500) }),
  z.object({ tipo: z.literal('paragrafo'), testo: txt(5000), stile: z.enum(['small', 'normale']).default('small'), before: intero(0, 2000, 0), after: intero(0, 2000, 0) }),
  z.object({ tipo: z.literal('tabella1'), righe: z.array(z.object({ nome: txt(2000), risultato: txt(3000), riferimento: txt(3000), bold_name: z.boolean().default(false), small: lista(30), unit: txt(100) })).max(300) }),
  z.object({ tipo: z.literal('esame2'), nome: txt(500), metodo: lista(20) }),
  z.object({ tipo: z.literal('tabella2'), righe: z.array(z.object({ etichetta: txt(500), valore: txt(5000), riferimento: txt(500).optional() }).transform((r) => (r.riferimento ? r : { etichetta: r.etichetta, valore: r.valore }))).max(200) }),
  z.object({ tipo: z.literal('antibiogramma'), specie: txt(300), n: intero(1, 20, 1), carica: txt(200), carica_lbl: txt(100).transform((v) => v || 'Carica Batterica'), legenda: txt(300).transform((v) => v || LEG_DEFAULT), righe: z.array(rigaAntibiotico).max(120) }),
  z.object({ tipo: z.literal('spacer'), sz: intero(1, 40, 2).optional() }),
]);
export const datiSchema = z.object({
  anagrafica: anagraficaSchema,
  blocchi: z.array(bloccoSchema).max(500),
  nome_file: txt(150).optional(),
  sorgente: z.union([z.enum(SORGENTI_AMMESSE), z.string(), z.null(), z.undefined()]).transform((v) => (SORGENTI_AMMESSE.includes(v) ? v : undefined)).optional(),
  note_anomalie: z.union([z.array(txt(500)), z.null(), z.undefined()]).transform((v) => v || []).pipe(z.array(z.string()).max(30)).optional(),
});

// Risposta della lettura: { schede: [{ pagine, dati }] } oppure { non_referto: true, motivo }
export const rispostaLetturaSchema = z.union([
  z.object({ non_referto: z.literal(true), motivo: txt(1000) }),
  z.object({ schede: z.array(z.object({ pagine: z.array(intero(1, 500, 1)).default([]), dati: datiSchema })).min(1).max(50) }),
]);

// Validazione con messaggio leggibile (percorso del primo errore)
export function validaDati(dati) {
  const r = datiSchema.safeParse(dati);
  if (r.success) return { ok: true, dati: r.data };
  const e = r.error.issues[0];
  return { ok: false, errore: `${(e.path || []).join('.') || 'dati'}: ${e.message}` };
}

export const isSchemaBlocchi = (dati) => Boolean(dati && Array.isArray(dati.blocchi) && dati.anagrafica && Array.isArray(dati.anagrafica.righe));

// ---- Colonne di ricerca della scheda (cognome_nome, data_nascita, sesso, accettazione, data_acc, referto) dalle righe del riquadro
export function colonneAnagrafica(a = {}) {
  const out = { cognome_nome: compattaSpazi(a.cognome_nome || ''), data_nascita: null, eta: null, sesso: null, accettazione: null, data_acc: null, referto_codice: null, referto_data: null, luogo_nascita: null, indirizzo: null };
  const del = (v) => { const m = String(v || '').match(/^(.*?)\s+del\s+(\d{2}\/\d{2}\/\d{4})\s*$/); return m ? [m[1].trim(), m[2]] : [String(v || '').trim(), null]; };
  for (const [etichetta, valore] of a.righe || []) {
    const k = compattaSpazi(etichetta).toLowerCase().replace(/:$/, '');
    const v = compattaSpazi(valore);
    if (!v) continue;
    if (k === 'data di nascita') { const m = v.match(/(\d{2}\/\d{2}\/\d{4})(?:\s*\(anni\s*(\d+)\))?/); out.data_nascita = m ? m[1] : v; if (m?.[2]) out.eta = Number(m[2]); }
    else if (k === 'sesso') out.sesso = v.slice(0, 10);
    else if (k === 'accettazione n°' || k === 'accettazione n.' || k === 'accettazione n') out.accettazione = v;
    else if (k === 'data acc.' || k === 'data acc') out.data_acc = v;
    else if (k === 'accettazione') { const [c, d] = del(v); out.accettazione = c; if (d) out.data_acc = d; }
    else if (k === 'referto') { const [c, d] = del(v); out.referto_codice = c; out.referto_data = d; }
    else if (k === 'luogo di nascita') out.luogo_nascita = v;
    else if (k === 'indirizzo') out.indirizzo = v;
  }
  return out;
}

// Righe del riquadro dal vecchio oggetto anagrafica dei parser (varianti A e B della specifica)
export function righeDaAnagraficaParser(a = {}) {
  const v = (x) => String(x ?? '').trim();
  const conData = (codice, data) => [v(codice), v(data) ? `del ${v(data)}` : ''].filter(Boolean).join(' ');
  const out = [];
  if (v(a.data_nascita)) out.push(['Data di nascita', v(a.eta) ? `${v(a.data_nascita)} (anni ${v(a.eta)})` : v(a.data_nascita)]);
  if (v(a.sesso)) out.push(['Sesso', v(a.sesso)]);
  if (v(a.referto_codice) || v(a.referto_data)) out.push(['Referto', conData(a.referto_codice, a.referto_data)]);
  if (v(a.accettazione_codice) || v(a.accettazione_data)) out.push(['Accettazione', conData(a.accettazione_codice, a.accettazione_data)]);
  if (v(a.accettazione_n)) out.push(['Accettazione n°', v(a.accettazione_n)]);
  if (v(a.data_acc)) out.push(['Data Acc.', v(a.data_acc)]);
  if (v(a.luogo_nascita)) out.push(['Luogo di nascita', v(a.luogo_nascita)]);
  if (v(a.indirizzo)) out.push(['Indirizzo', v(a.indirizzo)]);
  return out;
}

// ---- Conteggi e testi
const RE_ESITO_AB = /^(Sensibile|Resistente|Intermedio)\b/i;
// Antibiotici del referto: righe delle tabelle antibiogramma (corpo 2) + righe "Sensibile/Resistente/Intermedio - MIC" della tabella del
// corpo 1 (antibiogramma Bianalisi come righe della stessa tabella)
export const contaAntibiotici = (dati) => (dati?.blocchi || []).reduce((n, b) => n
  + (b.tipo === 'antibiogramma' ? (b.righe || []).length : 0)
  + (b.tipo === 'tabella1' ? (b.righe || []).filter((r) => RE_ESITO_AB.test(String(r.risultato || '').trim())).length : 0), 0);
export const contaMicrorganismi = (dati) => (dati?.blocchi || []).filter((b) => b.tipo === 'antibiogramma').length;
export const testiParagrafi = (dati) => (dati?.blocchi || []).filter((b) => b.tipo === 'paragrafo').flatMap((b) => String(b.testo || '').split('\n'));

// Primo esame (per il suffisso del nome file): titolo dell'esame del corpo 2 o primo esame della tabella del corpo 1
export function primoEsame(dati) {
  for (const b of dati?.blocchi || []) {
    if (b.tipo === 'esame2' && b.nome) return b.nome;
    if (b.tipo === 'titolo_esame' && b.testo) return b.testo;
    if (b.tipo === 'tabella1' && b.righe?.[0]?.nome) return String(b.righe[0].nome).split('\n')[0];
  }
  return '';
}

// ---- Anomalie automatiche (casi dubbi della specifica §5.3) calcolate sul JSON
// opzioni: { ocr, ocrLingua, modo: 'CLAUDE' | 'MOCK' | 'RISERVA' }
export function anomalieAutomatiche(dati, { ocr = false, ocrLingua = null, modo = 'CLAUDE' } = {}) {
  const out = [];
  if (ocr) out.push(anomalia('OCR', ocrLingua && ocrLingua !== 'ita' ? `lingua ${ocrLingua}, pacchetto italiano non installato` : undefined));
  if (modo === 'RISERVA') out.push(anomalia('PARSER_RISERVA'));
  const a = dati?.anagrafica || {};
  const col = colonneAnagrafica(a);
  const mancano = [!col.cognome_nome && 'cognome e nome', !col.data_nascita && 'data di nascita', !col.sesso && 'sesso', !col.accettazione && !col.referto_codice && 'accettazione'].filter(Boolean);
  if (mancano.length) out.push(anomalia('ANAGRAFICA_INCOMPLETA', `manca ${mancano.join(', ')}`));
  if (col.cognome_nome && anagraficaAbbreviata(col.cognome_nome)) out.push(anomalia('ANAGRAFICA_ABBREVIATA', col.cognome_nome));
  const ab = (dati?.blocchi || []).filter((b) => b.tipo === 'antibiogramma');
  const senzaCarica = ab.filter((b) => !String(b.carica || '').trim());
  if (senzaCarica.length) out.push(anomalia('CARICA_ASSENTE', senzaCarica.map((b) => `#${b.n} ${b.specie}`.trim()).join(', ')));
  if (ab.length >= 2) out.push(anomalia('DUE_MICRORGANISMI', `${ab.length} tabelle`));
  if ((dati?.blocchi || []).some((b) => /annulla\s+e\s+sostituisce/i.test(`${b.testo || ''} ${b.tipo === 'tabella2' || b.tipo === 'tabella1' ? JSON.stringify(b.righe) : ''}`))) out.push(anomalia('SOSTITUZIONE'));
  for (const n of dati?.note_anomalie || []) if (compattaSpazi(n)) out.push(anomalia('NOTA_LETTURA', compattaSpazi(n).slice(0, 300)));
  return out;
}

// ---- Conversione dall'uscita dei parser di riserva (vecchio schema { anagrafica, settori, esami, antibiogrammi, note, corpo })
// alle stesse chiamate del generatore. Usata solo senza chiave Anthropic: la scheda porta l'anomalia "parser di riserva".
const legendaTD = (s) => compattaSpazi(s).replace(/\s+(?=[RIS]:\s)/g, '   ');
const micSenzaPrefisso = (m) => compattaSpazi(String(m || '').replace(/^MIC\s*/i, ''));
export function daParser(v = {}) {
  const anagrafica = { cognome_nome: compattaSpazi(v.anagrafica?.cognome_nome || ''), righe: righeDaAnagraficaParser(v.anagrafica || {}) };
  const blocchi = [];
  const note = (v.note || []).map((n, i) => ({ tipo: 'paragrafo', testo: n, stile: 'small', before: i === 0 ? 120 : 40, after: 0 }));
  if (Number(v.corpo) === 2) {
    (v.settori?.length ? v.settori : [{ titolo: '' }]).forEach((s, si) => {
      if (s.titolo) blocchi.push({ tipo: 'settore', titolo: s.titolo });
      const esami = (v.esami || []).map((e, ei) => ({ ...e, ei })).filter((e) => (e.settore ?? 0) === si);
      esami.forEach((e, k) => {
        if (k > 0) blocchi.push({ tipo: 'spacer' });
        const metodo = [e.metodo && `Metodo: ${e.metodo}`, e.materiale && `Materiale: ${e.materiale}`, e.sede && `Sede Anatomica: ${e.sede}`, e.nota].filter(Boolean);
        blocchi.push({ tipo: 'esame2', nome: e.titolo || '', metodo });
        blocchi.push({ tipo: 'tabella2', righe: (e.campi || []).map((c) => ({ etichetta: c.etichetta || '', valore: `${c.valore || ''}${c.unita ? ` ${c.unita}` : ''}`, ...(c.riferimento ? { riferimento: c.riferimento } : {}) })) });
        if (k === 0) blocchi.push({ tipo: 'spacer' });
        (v.antibiogrammi || []).filter((b) => (b.esame ?? 0) === e.ei).forEach((b, j) => {
          if (j > 0) blocchi.push({ tipo: 'spacer' });
          blocchi.push({ tipo: 'antibiogramma', specie: b.specie || '', n: Number(b.n) || j + 1, carica: b.carica || '', carica_lbl: b.carica_label || 'Carica Batterica', legenda: legendaTD(b.legenda || LEG_DEFAULT),
            righe: (b.righe || []).map((r) => [r.antibiotico || '', r.sir || '', r.mic || '']) });
        });
      });
    });
  } else {
    for (const s of v.settori || []) {
      if (s.titolo) blocchi.push({ tipo: 'settore', titolo: s.titolo });
      const righe = [];
      for (const r of s.righe || []) {
        if (r.tipo === 'antibiotico') { const mic = micSenzaPrefisso(r.mic); righe.push({ nome: r.nome || '', risultato: [r.esito, mic && `MIC ${mic}`].filter(Boolean).join(' - '), riferimento: '', bold_name: false, small: [], unit: '' }); }
        else if (r.tipo === 'legenda' || r.tipo === 'testo') { const prec = righe[righe.length - 1]; if (prec) prec.small.push(r.testo || ''); else righe.push({ nome: r.testo || '', risultato: '', riferimento: '', bold_name: false, small: [], unit: '' }); }
        else {
          const sotto = (r.sotto || []).filter(Boolean);
          righe.push({ nome: [r.nome, r.descrizione].filter(Boolean).join('\n'), risultato: r.risultato || '', riferimento: r.riferimento || '', bold_name: sotto.length > 0, small: sotto, unit: r.unita || '' });
        }
      }
      if (righe.length) blocchi.push({ tipo: 'tabella1', righe });
    }
  }
  blocchi.push(...note, { tipo: 'spacer' });
  return { anagrafica, blocchi, sorgente: SORGENTI_AMMESSE.includes(v.sorgente) ? v.sorgente : 'ALTRO', note_anomalie: [] };
}


// ---------------------------------------------------------------- note sui laboratori esecutori (vietate)
// Disposizione del CEO (04/11/2026): la normativa della Regione Toscana sulla pubblicità sanitaria vieta di nominare nel referto TD il
// centro che ha eseguito l'esame. Le note "(1) Esame eseguito Bianalisi Verano Brianza (MB)", "(RDI) Test eseguiti in RDI - ..." e simili
// vengono tolte, e con loro i rimandi "(1)", "(RDI)" in coda ai nomi degli esami. Vale per qualunque modo di lettura (Claude, riserva,
// correzione), così anche una trascrizione che le riporta viene ripulita prima dell'anteprima.
const RE_NOTA_LAB = /^\s*\((?:\d+|[A-Z]{2,5})\)\s*(?:esam[ei]|test|analisi|determinazion[ei])\s+esegui/i;
const RE_NOTA_LAB_2 = /\besegui[tt]\w*\s+(?:presso|in|da|dal|dalla|c\/o)\s+(?:bianalisi|cerba|rdi\b|rete diagnostica|nuova igea|synlab|lifebrain|laboratorio)/i;
const RE_RIMANDO = /\s*\((?:\d{1,2}|RDI|BA|CERBA|NI)\)\s*$/i;
export const isNotaLaboratorio = (t) => RE_NOTA_LAB.test(String(t || '')) || RE_NOTA_LAB_2.test(String(t || ''));
export const senzaRimando = (t) => String(t || '').replace(RE_RIMANDO, '');
export function senzaRimandiLaboratorio(dati) {
  if (!dati || !Array.isArray(dati.blocchi)) return dati;
  const blocchi = [];
  for (const b of dati.blocchi) {
    if (b.tipo === 'paragrafo') {
      const righe = String(b.testo || '').split('\n').filter((r) => !isNotaLaboratorio(r));
      if (!righe.length) continue;
      blocchi.push({ ...b, testo: righe.join('\n') });
    } else if (b.tipo === 'tabella1') {
      blocchi.push({ ...b, righe: (b.righe || []).map((r) => ({ ...r, nome: senzaRimando(r.nome) })) });
    } else if (b.tipo === 'esame2') {
      blocchi.push({ ...b, nome: senzaRimando(b.nome) });
    } else if (b.tipo === 'tabella2') {
      blocchi.push({ ...b, righe: (b.righe || []).map((r) => ({ ...r, etichetta: senzaRimando(r.etichetta) })) });
    } else if (b.tipo === 'titolo_esame') {
      blocchi.push({ ...b, testo: senzaRimando(b.testo) });
    } else blocchi.push(b);
  }
  return { ...dati, blocchi };
}
