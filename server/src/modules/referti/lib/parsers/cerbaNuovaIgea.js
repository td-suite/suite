// Cerba HealthCare Toscana – Nuova Igea (Firenze) (variante A, corpo 2): blocchi esame (URINOCOLTURA, ESAME MICROSCOPICO DIVERSI…)
// con Metodo/Materiale/Sede, coppie etichetta/valore, antibiogramma tabellare "Microrganismo #n: specie" + "Carica Batterica" +
// legenda + righe "ANTIBIOTICO | S/I/R | MIC"; con due microrganismi le colonne affiancate "#1 MIC #2 MIC" diventano due tabelle.
import { anagraficaA, anomalieAnagrafica, separaIntestazione, chiaveAnagrafica, testoRiquadro, segmenti, isMaiuscola, isSettoreNoto, isSottoriga, isNota, isSostituzione, anomalia, compattaSpazi, isPieDiPagina } from './common.js';

export const SORGENTE = 'CERBA_NUOVA_IGEA';
export const riconosci = (testo) => /Nuova\s+Igea/i.test(testo) || /Duccio\s+di\s+Buoninsegna/i.test(testo) || /Cerba\s+HealthCare\s+Toscana/i.test(testo);

const FINE_INTESTAZIONE = /Data\s*Acc|Indirizzo|Residen|Domicilio|Luogo\s+di\s+nascita|Nat[oa]\s+(a|in)\b|Medico\s+richiedente/i;
const RE_MICRO = /Microrganismo\s*#?\s*(\d+)\s*:?\s*(.*)$/i;
const RE_CARICA = /^(Carica\s+(?:Batterica|Microbica|Fungina)(?:\s+Totale)?)\s*:?\s*(.*)$/i;
const RE_SIR = /^[SIR]$/;
const RE_TESTATA_AB = /^ANTIBIOTIC[OI]\b|^ANTIMICOTIC[OI]\b|^FARMACO\b/i;

export function pagina(testo) {
  const righe = testo.split('\n');
  const { testa, corpo } = separaIntestazione(righe, { testataColonne: null, fineIntestazione: FINE_INTESTAZIONE });
  const anagrafica = anagraficaA(testa.length ? testa : righe.slice(0, 8));
  return { anagrafica, chiave: chiaveAnagrafica(anagrafica), corpo };
}

// Stato del parser tra le pagine: settori, esami, antibiogrammi, blocco corrente (l'antibiogramma può proseguire a pagina 2)
function nuovoStato() { return { settori: [], esami: [], antibiogrammi: [], note: [], settore: -1, esame: -1, blocchi: [], colonneAb: null, inTabella: false, ultimoCampo: null, posValore: null }; }

function parseCorpo2(righe, st, anomalie) {
  const settore = () => {
    if (st.settore < 0) { st.settori.push({ titolo: '', righe: [] }); st.settore = st.settori.length - 1; }   // nessun settore predefinito: titolo solo se la sorgente lo ha
    return st.settore;
  };
  const esame = () => {
    if (st.esame < 0) { st.esami.push({ settore: settore(), titolo: 'ESAME', metodo: '', materiale: '', sede: '', nota: '', campi: [] }); st.esame = st.esami.length - 1; }
    return st.esami[st.esame];
  };
  for (const raw of righe) {
    const riga = raw.replace(/\s+$/, '');
    if (!riga.trim()) { st.ultimoCampo = null; st.titoloAperto = false; continue; }
    if (isPieDiPagina(riga)) continue;
    const seg = segmenti(riga);
    const testo = compattaSpazi(riga);
    if (isNota(testo)) { st.note.push(testo); if (isSostituzione(testo)) anomalie.push(anomalia('SOSTITUZIONE')); st.ultimoCampo = null; continue; }

    // Microrganismo #n: specie (uno o due per riga)
    if (seg.some((s) => RE_MICRO.test(s.testo))) {
      st.blocchi = []; st.inTabella = false; st.colonneAb = null;
      esame();
      for (const s of seg) {
        const m = s.testo.match(RE_MICRO); if (!m) continue;
        const n = Number(m[1]); const specie = compattaSpazi(m[2]);
        // stesso microrganismo ripetuto a pagina seguente (la tabella prosegue con la testata ripetuta): si continua il blocco esistente
        const gia = st.antibiogrammi.find((x) => x.esame === st.esame && x.n === n && x.specie.toLowerCase() === specie.toLowerCase());
        const b = gia || { esame: st.esame, n, specie, carica: '', carica_label: '', legenda: '', righe: [] };
        if (!gia) st.antibiogrammi.push(b);
        st.blocchi.push(b);
      }
      if (st.blocchi.length >= 2) anomalie.push(anomalia('DUE_MICRORGANISMI'));
      // "Carica Batterica: 1.000.000 UFC/ml" sulla stessa riga del microrganismo (layout reale Nuova Igea)
      seg.filter((s) => RE_CARICA.test(s.testo)).forEach((s, i) => { const m = s.testo.match(RE_CARICA); const b = st.blocchi[i] || st.blocchi[0]; b.carica_label = m[1]; b.carica = compattaSpazi(m[2]); });
      st.ultimoCampo = null; continue;
    }
    // Intestazione di colonna con il solo nome della specie (anche spezzato su due righe: "Pseudomonas" / "aeruginosa"): non è un dato
    if (st.blocchi.length && !st.inTabella && seg.length && seg.every((s) => st.blocchi.some((b) => b.specie && (b.specie.toLowerCase().includes(s.testo.toLowerCase()) || s.testo.toLowerCase().includes(b.specie.toLowerCase()))))) continue;
    // Carica Batterica (per blocco, nell'ordine)
    if (st.blocchi.length && seg.some((s) => RE_CARICA.test(s.testo))) {
      const car = seg.filter((s) => RE_CARICA.test(s.testo));
      car.forEach((s, i) => { const m = s.testo.match(RE_CARICA); const b = st.blocchi[i] || st.blocchi[0]; b.carica_label = m[1]; b.carica = compattaSpazi(m[2]); });
      continue;
    }
    // Legenda della testata (copiare quella della sorgente)
    if (st.blocchi.length && /^R\s*:\s*Resistente/i.test(testo)) {
      // la legenda può portare in coda le colonne "#1  MIC [#2  MIC]": è la testata della tabella (layout reale Nuova Igea)
      const cols = [];
      for (const s of seg) { if (/^#\s*\d+$/.test(s.testo)) cols.push({ sir: s.da, mic: null }); else if (/^MIC\b/i.test(s.testo) && cols.length) cols[cols.length - 1].mic = s.da; }
      const legenda = compattaSpazi(seg.filter((s) => !/^#\s*\d+$/.test(s.testo) && !/^MIC\b/i.test(s.testo)).map((s) => s.testo).join(' '));
      for (const b of st.blocchi) b.legenda = legenda;
      if (cols.length) { st.colonneAb = cols; st.inTabella = true; }
      continue;
    }
    // Testata della tabella: ANTIBIOTICO  #1  MIC  [#2  MIC]  oppure  ANTIBIOTICO  S/I/R  MIC
    if (st.blocchi.length && seg.length && RE_TESTATA_AB.test(seg[0].testo)) {
      const cols = [];
      for (const s of seg.slice(1)) { if (/^#\s*\d+$/.test(s.testo) || /^(S\/I\/R|SIR|ESITO|RISULTATO)$/i.test(s.testo)) cols.push({ sir: s.da, mic: null }); else if (/^MIC\b/i.test(s.testo) && cols.length) cols[cols.length - 1].mic = s.da; }
      st.colonneAb = cols.length ? cols : [{ sir: null, mic: null }];
      st.inTabella = true; continue;
    }
    // Righe della tabella: nome | S | MIC | [S | MIC] (anche senza testata esplicita, se c'è un microrganismo aperto)
    if (st.blocchi.length && seg.length >= 2 && RE_SIR.test(seg[1].testo)) {
      st.inTabella = true;
      const nome = seg[0].testo;
      const valori = seg.slice(1);
      if (st.blocchi.length === 1 || !st.colonneAb || st.colonneAb.length < 2) {
        for (let i = 0; i < valori.length; i += 2) { const sir = valori[i]?.testo; const mic = valori[i + 1]?.testo || ''; const b = st.blocchi[Math.min(i / 2, st.blocchi.length - 1)]; if (sir && RE_SIR.test(sir)) b.righe.push({ antibiotico: nome, sir, mic }); }
      } else {
        // assegna per posizione alla colonna #1 / #2 (tolleranza di 4 caratteri)
        for (const v of valori) {
          if (!RE_SIR.test(v.testo)) continue;
          let idx = 0; let best = Infinity;
          st.colonneAb.forEach((c, i) => { const d = Math.abs((c.sir ?? 0) - v.da); if (d < best) { best = d; idx = i; } });
          const b = st.blocchi[Math.min(idx, st.blocchi.length - 1)];
          const next = valori[valori.indexOf(v) + 1];
          const mic = next && !RE_SIR.test(next.testo) ? next.testo : '';
          b.righe.push({ antibiotico: nome, sir: v.testo, mic });
        }
      }
      continue;
    }
    // Fine tabella: qualunque altra riga
    if (st.inTabella && !(seg.length >= 2 && RE_SIR.test(seg[1].testo))) { st.inTabella = false; st.blocchi = []; }

    // Titolo maiuscolo isolato: settore noto oppure titolo di esame (un titolo lungo va a capo: la riga maiuscola che segue subito
    // un titolo di esame ancora vuoto ne è la continuazione, es. "ESAME MICROBIOLOGICO DEL SECRETO" / "VAGINALE")
    if (seg.length === 1 && isMaiuscola(seg[0].testo) && !isSottoriga(seg[0].testo)) {
      const cur = st.esame >= 0 ? st.esami[st.esame] : null;
      if (isSettoreNoto(seg[0].testo)) { st.settori.push({ titolo: seg[0].testo.toUpperCase(), righe: [] }); st.settore = st.settori.length - 1; st.esame = -1; }
      else if (cur && st.titoloAperto && !cur.metodo && !cur.materiale && !cur.campi.length && seg[0].da <= 2) cur.titolo = `${cur.titolo} ${seg[0].testo.toUpperCase()}`;
      else { st.esami.push({ settore: settore(), titolo: seg[0].testo.toUpperCase(), metodo: '', materiale: '', sede: '', nota: '', campi: [] }); st.esame = st.esami.length - 1; }
      st.titoloAperto = !isSettoreNoto(seg[0].testo);
      st.ultimoCampo = null; continue;
    }
    st.titoloAperto = false;
    // Metodo / Materiale / Sede Anatomica / Nuova descrizione (anche due per riga)
    if (seg.length && isSottoriga(seg[0].testo)) {
      const e = esame();
      for (const s of seg) {
        const m = s.testo.match(/^(Metodo|Materiale|Sede Anatomica|Sede|Campione|Nuova descrizione dell'esame[^:]*)\s*:?\s*(.*)$/i);
        if (!m) { e.nota = compattaSpazi(`${e.nota} ${s.testo}`); continue; }
        const k = m[1].toLowerCase();
        if (k.startsWith('metodo')) e.metodo = m[2]; else if (k.startsWith('materiale') || k.startsWith('campione')) e.materiale = m[2]; else if (k.startsWith('sede')) e.sede = m[2]; else e.nota = compattaSpazi(`${e.nota} ${s.testo}`);
      }
      st.ultimoCampo = null; continue;
    }
    // Etichetta incollata al valore nel testo estratto ("Esame microscopico dopo colorazione di GramScarsi lattobacilli;")
    if (seg.length === 1) {
      const m = seg[0].testo.match(/^(.*\b(?:Gram|Giemsa|Ziehl[- ]Neelsen|Papanicolaou))([A-Z][a-zà-ü].*)$/);
      if (m) { const e = esame(); const campo = { etichetta: compattaSpazi(m[1]), valore: compattaSpazi(m[2]) }; e.campi.push(campo); st.ultimoCampo = campo; st.posValore = seg[0].da + m[1].length; continue; }
    }
    // Coppia etichetta / valore
    if (seg.length >= 2) {
      const e = esame();
      const campo = { etichetta: seg[0].testo, valore: seg.slice(1).map((s) => s.testo).join(' ') };
      e.campi.push(campo); st.ultimoCampo = campo; st.posValore = seg[1].da; continue;
    }
    // Continuazione del valore (riga che inizia nella colonna del valore)
    if (seg.length === 1 && st.ultimoCampo && seg[0].da >= Math.max(10, (st.posValore || 0) - 3)) {
      st.ultimoCampo.valore = compattaSpazi(`${st.ultimoCampo.valore} ${seg[0].testo}`); continue;
    }
    // Riga non interpretata: testo libero nell'esame corrente
    const e = esame();
    e.campi.push({ etichetta: '', valore: testo, libero: true }); anomalie.push(anomalia('RIGA_NON_INTERPRETATA', testo.slice(0, 60))); st.ultimoCampo = null;
  }
}

export function scheda(pagine) {
  const anomalie = [];
  const st = nuovoStato();
  let anagrafica = null;
  const corpi = [];
  for (const p of pagine) {
    const pg = pagina(p.testo);
    if (!anagrafica) anagrafica = pg.anagrafica; else for (const [k, v] of Object.entries(pg.anagrafica)) if (v && !anagrafica[k]) anagrafica[k] = v;
    parseCorpo2(pg.corpo, st, anomalie);
    corpi.push(pg.corpo);
  }
  anagrafica = anagrafica || { variante: 'A' };
  anomalie.unshift(...anomalieAnagrafica(anagrafica));
  for (const b of st.antibiogrammi) if (!b.carica) anomalie.push(anomalia('CARICA_ASSENTE', `microrganismo #${b.n}`));
  // antibiotici nel testo grezzo del riquadro: righe con un segmento S/I/R in seconda posizione (ogni colonna conta uno)
  let nAb = 0;
  for (const r of corpi.flat()) { const s = segmenti(r); if (s.length >= 2 && RE_SIR.test(s[1].testo)) nAb += s.slice(1).filter((x) => RE_SIR.test(x.testo)).length; }
  const testo_sorgente = testoRiquadro(anagrafica, corpi);   // solo riquadro risultati + riga anagrafica
  return { sorgente: SORGENTE, variante: 'A', corpo: 2, anagrafica, settori: st.settori, esami: st.esami, antibiogrammi: st.antibiogrammi, note: st.note, anomalie,
    conteggi: { antibiotici_sorgente: nAb }, testo_sorgente };
}
