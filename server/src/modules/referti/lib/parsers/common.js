// Funzioni comuni ai parser: intestazione di pagina (anagrafica), colonne, titoli di settore, anomalie.
// Tutto ciò che un parser non riconosce finisce in righe "testo libero" del settore corrente: mai perso.
import { colonne, RE_DATA, compattaSpazi, anagraficaAbbreviata } from '../text.js';

export const ANOMALIE = {
  ANAGRAFICA_ABBREVIATA: 'Anagrafica abbreviata: verificare cognome e nome',
  ANAGRAFICA_INCOMPLETA: 'Anagrafica incompleta: verificare i dati del paziente',
  OCR: 'OCR: verifica manuale obbligatoria',
  VALORE_RICOMPOSTO: 'Valore ricomposto da più righe',
  CARICA_ASSENTE: 'Carica batterica assente',
  DUE_MICRORGANISMI: 'Due microrganismi affiancati: separati in due tabelle',
  SOSTITUZIONE: 'Nota di sostituzione: il file precedente verrà sovrascritto',
  NOME_DOPPIO: 'Nome file già presente per un\'altra scheda',
  RIGA_NON_INTERPRETATA: 'Riga non interpretata',
  SORGENTE_ALTRO: 'Sorgente non riconosciuta, verifica (trascrizione nel corpo 1 a tre colonne)',
};
export const anomalia = (codice, dettaglio) => ({ codice, testo: dettaglio ? `${ANOMALIE[codice] || codice}: ${dettaglio}` : (ANOMALIE[codice] || codice) });

// Settori noti (titoli maiuscoli della sorgente). Qualunque altra riga maiuscola isolata è un titolo di settore nel corpo 1
// e un titolo di esame nel corpo 2.
export const SETTORI_NOTI = ['MICROBIOLOGIA', 'MICROBIOLOGIA MOLECOLARE', 'BIOLOGIA MOLECOLARE', 'ALLERGOLOGIA', 'ALLERGOLOGIA E INTOLLERANZE', 'CHIMICA CLINICA', 'FARMACI',
  'EMATOLOGIA', 'IMMUNOLOGIA', 'SIEROLOGIA', 'VIROLOGIA', 'PARASSITOLOGIA', 'MICOLOGIA', 'IMMUNOMETRIA', 'COAGULAZIONE', 'ESAMI DELLE URINE', 'TOSSICOLOGIA',
  'ENDOCRINOLOGIA', 'MARCATORI TUMORALI', 'AUTOIMMUNITÀ', 'AUTOIMMUNITA\'', 'GENETICA', 'ANATOMIA PATOLOGICA', 'CITOLOGIA'];

export const isMaiuscola = (s) => { const t = compattaSpazi(s); return t.length >= 3 && /^[A-ZÀ-Ü0-9 .,'&/()-]+$/.test(t) && /[A-ZÀ-Ü]{3}/.test(t); };
export const isSettoreNoto = (s) => SETTORI_NOTI.includes(compattaSpazi(s).toUpperCase());
export const isPieDiPagina = (s) => /^\s*Pagina\s+\d+\s+(di|\/)\s+\d+/i.test(s) || /^\s*Pag\.\s*\d+/i.test(s);
export const isSottoriga = (s) => /^(Metodo|Materiale|Sede Anatomica|Sede|Campione|Nuova descrizione dell'esame)\b/i.test(compattaSpazi(s));
export const isLegenda = (s) => /^(S|I|R|MIC)\s*[=:]\s*\S/.test(compattaSpazi(s)) || /^R:\s*Resistente/i.test(compattaSpazi(s));

// Testo del laboratorio esterno che NON fa parte del riquadro dei risultati (indicazione del CEO del 29/10/2026: si trascrive solo il
// riquadro): intestazione e piè del laboratorio, direttore/medico/richiedente, firme, diciture legali, partita IVA, contatti, righe di
// piè con codice di referto/accettazione + nome. Queste righe non vengono né trascritte né salvate. Le note interne al riquadro
// ("(1) Esame eseguito…", "annulla e sostituisce…") restano: isNota ha la precedenza.
const RE_LAB = [
  /^(BIANALISI\b|Cerba\s+HealthCare|Rete\s+Diagnostica\s+Italiana|Nuova\s+Igea\b|Laboratorio\s+(di\s+)?analisi|Laboratorio\s+Firenze)/i,
  /Toscana\s+Diagnostica\s*(S\.?\s?r\.?\s?l\.?)?/i,              // laboratorio cliente indicato nell'intestazione esterna (e sue varianti)
  /^(Cliente|Committente|Destinatario|Mittente|Struttura\s+richiedente|Centro\s+prelievi)\b/i,
  /^(Il\s+)?(Direttore|Dirett\.|Responsabile)\b/i,
  /^(Medico\s+)?(richiedente|prescrittore|curante)\b/i, /^Reparto\b/i, /^Dott\.?(ssa)?\s/i, /^Dr\.?(ssa)?\s/i,
  /^Il\s+presente\s+(referto|documento|rapporto)\b/i, /^Documento\s+(firmato|informatico|sottoscritto)/i,   // (la nota "annulla e sostituisce" è esclusa a monte da isNota)
  /\b(P\.?\s?IVA|Partita\s+IVA|Cod(ice)?\.?\s*Fisc(ale)?\.?|C\.F\.)\s*:?\s*\d/i,
  /^(Tel\.?|Telefono|Fax|e-?mail|PEC|www\.)\b/i,
  /^(Referto|Accettazione)\s+n?[°o.]?\s*[A-Z0-9][A-Z0-9/.-]{3,}\s*(del\s+\d{2}\/\d{2}\/\d{4})?\s*[-–]\s*\S/i,   // piè "Referto R3YE… - COGNOME NOME"
  /^(Via|Viale|Piazza|P\.zza|Corso|Largo)\s.+\b\d{5}\b.*(Direttore|Tel|Fax|P\.?IVA)/i,
];
// Righe di firma (anche digitale) e diciture legali/privacy: la prima di queste chiude il riquadro dei risultati
const RE_FIRMA = [
  /^(Firma|Firmato|Validato|Refertato|Validazione|Refertazione)\b/i, /Firmat[oa]\s+digitalmente/i, /Referto\s+firmato\s+da/i, /\bSN\s*=\s*\d+/i,
  /Emesso\s+dall'?\s*Ente\s+Certificatore/i, /InfoCamere/i, /Qualified\s+Electronic\s+Signature/i, /^\d{2}[-/.]\d{2}[-/.]\d{4}\s+\d{1,2}[.:]\d{2}\b.*(SN|firm|cert)/i,
  /^(Il\s+)?Direttore\b/i,
];
const RE_LEGALE = [
  /^I\s+risultati\s+di\s+questo\s+referto/i, /^I\s+dati\s+personali/i, /^Regolamento\b/i, /^Il\s+laboratorio\s+dove\s+sono\s+state\s+ottenute/i,
  /\bGDPR\b/i, /\bart\.?\s*13\b/i, /\bD\.?\s?Lgs\.?\s*\d/i, /^Informativa\b/i, /^Il\s+presente\s+(referto|documento|rapporto)\b/i,
];
export const isFirma = (s) => { const t = compattaSpazi(s); return Boolean(t) && !isNota(t) && RE_FIRMA.some((re) => re.test(t)); };
export const isDicituraLegale = (s) => { const t = compattaSpazi(s); return Boolean(t) && !isNota(t) && RE_LEGALE.some((re) => re.test(t)); };
// Testata di tabella (Esame | Risultato | U.M. | Valori di Riferimento, Analisi | Risultati | Intervalli di Riferimento… in qualunque combinazione)
const PAROLE_TESTATA = /^(esam[ei]|analisi|test|descrizione|risultat[oi]|valor[ei]|esito|u\.?m\.?|unità|unita'?|unità di misura|um|valori di riferimento|intervalli di riferimento|intervallo di riferimento|riferimento|riferimenti|range|v\.?r\.?|note|metodo|metodica|precedent[ei]|\*)$/i;
export const isTestataTabella = (s) => { const seg = segmenti(s).map((x) => compattaSpazi(x.testo)); return seg.length >= 2 && seg.every((x) => PAROLE_TESTATA.test(x)) && seg.some((x) => /risultat|riferimento|analisi|esam/i.test(x)); };
export function isTestoLaboratorio(s) {
  const t = compattaSpazi(s);
  if (!t || isNota(t)) return false;
  return RE_LAB.some((re) => re.test(t)) || isFirma(t) || isDicituraLegale(t) || isTestataTabella(s) || isPieDiPagina(s);
}
// Fine del riquadro dei risultati: prima riga di firma, dicitura legale o piè di pagina
export const isFineRiquadro = (s) => isPieDiPagina(s) || isFirma(s) || isDicituraLegale(s);

// Segmenti di una riga con la posizione di inizio (carattere), per assegnarli alle colonne del layout
export function segmenti(riga) {
  const out = [];
  const s = String(riga || '');
  const re = /\s{2,}/g;
  let start = 0; let m;
  const push = (a, b) => { const t = s.slice(a, b); const lead = t.length - t.trimStart().length; const testo = t.trim(); if (testo) out.push({ testo, da: a + lead }); };
  while ((m = re.exec(s)) !== null) { push(start, m.index); start = m.index + m[0].length; }
  push(start, s.length);
  return out;
}

// ---- Anagrafica
// Dati del paziente da salvare (indicazione del CEO del 29/10/2026): cognome e nome, sesso, data e luogo di nascita, indirizzo se c'è.
// I codici di referto/accettazione del laboratorio esterno si leggono solo come riferimento interno (registro), mai nel DOCX.

// Luogo di nascita e indirizzo nell'intestazione paziente: "nato/a a", "Luogo di nascita", comune accanto alla data ("Nato il gg/mm/aaaa a …"),
// "Indirizzo", "Residenza", "Domicilio", "Residente a/in". Nei PDF Bianalisi la riga "F-16/04/1974 (anni 52) TOLAFI" porta un codice di
// sede dopo l'età, non il luogo di nascita: non si legge.
const fino = (s) => compattaSpazi(String(s || '').split(/\s{2,}/)[0]).replace(/[;,]\s*$/, '');
export function datiPaziente(righe, a) {
  for (const r of righe) {
    let m = r.match(/(?:Nat[oa]\s*(?:\/\s*a)?\s+(?:a|in)|Luogo\s+di\s+nascita|Comune\s+di\s+nascita|Nascita\s*\(luogo\))\s*:?\s*(.+)$/i);
    if (!m) m = r.match(/Nat[oa]\s*(?:\/\s*a)?\s+il\s*:?\s*\d{2}\/\d{2}\/\d{4}\s+(?:a|in)\s+(.+)$/i);
    if (!m) m = r.match(/Data\s+di\s+nascita\s*:?\s*\d{2}\/\d{2}\/\d{4}\s+(?:a|in)\s+(.+)$/i);
    if (m && !a.luogo_nascita) { const v = fino(m[1]); if (v && !RE_DATA.test(v) && !/^(il|:)/i.test(v)) a.luogo_nascita = v; }
    m = r.match(/(?:Indirizzo|Residenza|Domicilio|Residente\s+(?:a|in))\s*:?\s*(.+)$/i);
    if (m && !a.indirizzo) { const v = fino(m[1]); if (v) a.indirizzo = v; }
  }
  return a;
}

// Riga anagrafica sintetica (dati del paziente estratti) che accompagna il testo del riquadro nel testo sorgente della scheda: serve al
// controllo di coerenza (i numeri del riquadro anagrafico del DOCX — data, età, CAP, civico — devono esistere nella sorgente).
export const rigaAnagrafica = (a) => [a.cognome_nome, a.sesso, a.data_nascita, a.eta != null && a.eta !== '' ? `(anni ${a.eta})` : '', a.luogo_nascita, a.indirizzo,
  a.accettazione_n, a.data_acc, a.referto_codice, a.referto_data, a.accettazione_codice, a.accettazione_data].filter(Boolean).join('  ');

// Variante B (Bianalisi): "Referto R3YE… del gg/mm/aaaa", "Accettazione A3YE… del gg/mm/aaaa", "F-16/04/1974 (anni 52) TOLAFI"
export function anagraficaB(righe) {
  const a = { variante: 'B' };
  datiPaziente(righe, a);
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    let m = r.match(/Referto\s+([A-Z0-9][A-Z0-9/-]{3,})\s+del\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m && !a.referto_codice) { a.referto_codice = m[1]; a.referto_data = m[2]; }
    m = r.match(/Accettazione\s+([A-Z0-9][A-Z0-9/-]{3,})\s+del\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m && !a.accettazione_codice) { a.accettazione_codice = m[1]; a.accettazione_data = m[2]; }
    m = r.match(/\b([FM])\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*\(anni\s*(\d+)\)/i);
    if (m && !a.data_nascita) {
      a.sesso = m[1].toUpperCase(); a.data_nascita = m[2]; a.eta = Number(m[3]);
      const prima = r.slice(0, m.index).trim();
      const seg = segmenti(prima);
      let nome = seg.length ? seg[0].testo : '';
      if (!nome) { for (let j = i - 1; j >= 0 && !nome; j--) { const s = segmenti(righe[j]); if (s.length && isMaiuscola(s[0].testo) && !/Referto|Accettazione|BIANALISI/i.test(s[0].testo) && !isEtichettaNome(s[0].testo)) nome = s[0].testo; } }
      if (nome && isEtichettaNome(nome)) nome = nomeRigaSeguente(righe, i);
      a.cognome_nome = compattaSpazi(nome).toUpperCase();
    }
  }
  return a;
}

// Variante A (Cerba RDI / Nuova Igea): "Paziente: …", "Nato il: gg/mm/aaaa", "Sesso: F", "Accettazione n° …", "Data Acc. gg/mm/aaaa"
const RE_ETICHETTA_NOME = /^(Paziente|Cognome e nome|Cognome|Nome|Nominativo|Assistit[oa]|Intestatario)\s*:?$/i;
export const isEtichettaNome = (s) => RE_ETICHETTA_NOME.test(compattaSpazi(s));
// Prima riga utile dopo l'etichetta: il nome del paziente (maiuscolo, non una data, non un'altra etichetta)
function nomeRigaSeguente(righe, i) {
  for (let j = i + 1; j < Math.min(righe.length, i + 4); j++) {
    const seg = segmenti(righe[j]); if (!seg.length) continue;
    const t = seg[0].testo.replace(/^(Paziente|Nominativo)\s*:\s*/i, '');
    if (isEtichettaNome(t) || RE_DATA.test(t) || /^(Sesso|Nat[oa]|Data|Accettazione|Luogo|Indirizzo|Residen)/i.test(t)) continue;
    if (isMaiuscola(t)) return compattaSpazi(t).toUpperCase();
    return '';
  }
  return '';
}
export function anagraficaA(righe) {
  const a = { variante: 'A' };
  datiPaziente(righe, a);
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    let m = r.match(/(?:Paziente|Cognome e nome|Nominativo|Assistit[oa])\s*:?\s+(.+?)(?:\s{2,}|\s+(?:Nat[oa] (?:il|a|in)|Data di nascita|Luogo di nascita|Sesso|Indirizzo|Residen|Accettazione|Data Acc)\b|$)/i);
    if (m && !a.cognome_nome && !isEtichettaNome(m[1]) && !RE_DATA.test(m[1]) && !/^[FM]$/i.test(compattaSpazi(m[1]))) a.cognome_nome = compattaSpazi(m[1]).toUpperCase();
    // etichetta "PAZIENTE" da sola (o seguita solo da data/sesso): il nome è nella riga che segue, mai l'etichetta
    if (!a.cognome_nome && segmenti(r).length && isEtichettaNome(segmenti(r)[0].testo)) { const n = nomeRigaSeguente(righe, i); if (n) a.cognome_nome = n; }
    m = r.match(/(?:Nat[oa] il|Data di nascita|Nascita)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m && !a.data_nascita) a.data_nascita = m[1];
    m = r.match(/Sesso\s*:?\s*([FM])\b/i);
    if (m && !a.sesso) a.sesso = m[1].toUpperCase();
    m = r.match(/Accettazione\s*n[°o.]?\s*:?\s*([A-Z0-9][A-Z0-9/.-]*)/i);
    if (m && !a.accettazione_n && !isPieDiPagina(r)) a.accettazione_n = m[1];
    m = r.match(/Data\s*Acc\.?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m && !a.data_acc) a.data_acc = m[1];
    // Senza etichetta "Paziente": la riga che porta nascita e sesso inizia con il nome
    if (!a.cognome_nome && /\d{2}\/\d{2}\/\d{4}/.test(r) && /\b[FM]\b/.test(r) && !/Acc/i.test(r)) {
      const s = segmenti(r);
      if (s.length && isMaiuscola(s[0].testo) && !RE_DATA.test(s[0].testo) && !isEtichettaNome(s[0].testo)) a.cognome_nome = compattaSpazi(s[0].testo).toUpperCase();
      // layout Nuova Igea reale (PDF del 29/10/2026): il nome è da solo nella riga precedente ("DINE KATERINA   DINE KATERINA"),
      // la riga "Data di nascita: … Sesso: F" segue
      if (!a.cognome_nome) {
        for (let j = i - 1; j >= Math.max(0, i - 3) && !a.cognome_nome; j--) {
          const sj = segmenti(righe[j]); if (!sj.length) continue;
          const n = sj[0].testo;
          if (isMaiuscola(n) && !RE_DATA.test(n) && !isEtichettaNome(n) && !/\d/.test(n) && !isTestoLaboratorio(n) && !/^(Rev\.|Pagina)/i.test(n)) a.cognome_nome = compattaSpazi(n).toUpperCase();
        }
      }
    }
  }
  return a;
}

export const chiaveAnagrafica = (a) => (a.cognome_nome ? `${a.cognome_nome}|${a.accettazione_n || a.accettazione_codice || a.referto_codice || ''}` : '');

// Campi obbligatori dell'anagrafica (cognome e nome, sesso, data di nascita, riferimento di accettazione); luogo di nascita e indirizzo
// si riportano solo se presenti nella sorgente (modello del CEO del 29/10/2026)
export const CAMPI_ANAGRAFICA = { cognome_nome: 'cognome e nome', sesso: 'sesso', data_nascita: 'data di nascita' };
export const campiMancanti = (a) => {
  const out = Object.entries(CAMPI_ANAGRAFICA).filter(([k]) => !String(a?.[k] || '').trim()).map(([, v]) => v);
  if (!['accettazione_n', 'accettazione_codice', 'referto_codice'].some((k) => String(a?.[k] || '').trim())) out.push('accettazione');
  return out;
};

export function anomalieAnagrafica(a) {
  const out = [];
  const mancanti = campiMancanti(a);
  if (mancanti.length) out.push(anomalia('ANAGRAFICA_INCOMPLETA', `manca ${mancanti.join(', ')}`));
  if (a.cognome_nome && anagraficaAbbreviata(a.cognome_nome)) out.push(anomalia('ANAGRAFICA_ABBREVIATA', a.cognome_nome));
  return out;
}

// Note a piè del corpo: "(1) …" e frasi di sostituzione
export const isNota = (s) => /^\(\d+\)\s+\S/.test(compattaSpazi(s)) || /annulla e sostituisce/i.test(s);
export const isSostituzione = (s) => /annulla e sostituisce/i.test(String(s || ''));

// Isola il riquadro dei risultati: toglie dal testo della pagina l'intestazione del laboratorio esterno (fino alla riga di testata
// delle colonne o all'ultima riga dell'anagrafica), il piè di pagina ("Pagina N di M" in poi) e ogni altra riga del laboratorio
// esterno (firme, diciture legali, medico/richiedente, contatti: isTestoLaboratorio). Il corpo restituito è SOLO il riquadro.
// Restituisce { testa: [righe di intestazione], corpo: [righe del riquadro], testataColonne }
export function separaIntestazione(righe, { testataColonne, fineIntestazione }) {
  let fine = -1;
  const MAX = Math.min(righe.length, 40);
  for (let i = 0; i < MAX; i++) {
    if ((testataColonne && testataColonne.test(righe[i])) || isTestataTabella(righe[i])) { fine = i; break; }
  }
  if (fine < 0 && fineIntestazione) {
    for (let i = 0; i < MAX; i++) if (fineIntestazione.test(righe[i])) fine = i;
  }
  const testa = righe.slice(0, fine + 1);
  let corpo = righe.slice(fine + 1);
  // il riquadro finisce alla prima riga di firma, dicitura legale o piè di pagina ("Pagina N di M")
  const idxFine = corpo.findIndex((r) => isFineRiquadro(r));
  if (idxFine >= 0) corpo = corpo.slice(0, idxFine);
  // altre righe del laboratorio esterno (ragione sociale esterna o del cliente, testate di tabella, contatti…): scartate, non trascritte né salvate
  corpo = corpo.filter((r) => !isTestoLaboratorio(r));
  // code vuote
  while (corpo.length && !corpo[corpo.length - 1].trim()) corpo.pop();
  return { testa, corpo, testataColonne: fine >= 0 ? righe[fine] : null };
}

// Testo sorgente della scheda (schede.testo_sorgente): riga anagrafica sintetica + righe del riquadro risultati di tutte le pagine.
// Niente altro del PDF (il PDF intero resta come file di partenza nell'archivio).
export const testoRiquadro = (anagrafica, corpi) => [rigaAnagrafica(anagrafica || {}), ...corpi.flat()].join('\n').replace(/\n{3,}/g, '\n\n');

export { colonne, compattaSpazi };
