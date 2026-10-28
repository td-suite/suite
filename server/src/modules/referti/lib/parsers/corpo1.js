// Parser del "corpo 1" (tabella Nome esame | Risultato | [U.M.] | Riferimento): Bianalisi e Cerba RDI Limena.
// Produce settori[] con righe di tipo esame, antibiotico (Bianalisi: "Sensibile - MIC <=4"), legenda, testo.
// Difensivo: ogni riga non riconosciuta diventa una riga "testo" nel settore corrente con anomalia "riga non interpretata".
import { segmenti, isMaiuscola, isSottoriga, isLegenda, isNota, isSostituzione, anomalia, compattaSpazi, isPieDiPagina } from './common.js';

const RE_ANTIBIOTICO = /^(Sensibile|Resistente|Intermedio|S|I|R)\s*[-–:]\s*MIC\s*(.+)$/i;
const ESITO = { S: 'Sensibile', I: 'Intermedio', R: 'Resistente' };

// Posizioni delle colonne dalla riga di testata ("Analisi … Risultati … Intervalli di Riferimento" / "Esame … Risultato … U.M. … Valori di Riferimento")
export function colonneDaTestata(testata) {
  if (!testata) return null;
  const pos = (re) => { const m = testata.match(re); return m ? m.index : -1; };
  const ris = pos(/Risultat[oi]/i);
  const um = pos(/\bU\.?M\.?\b/i);
  const rif = pos(/(Intervalli|Valori)\s+di\s+Riferimento|Riferimento/i);
  if (ris < 0) return null;
  return { ris, um: um >= 0 ? um : null, rif: rif >= 0 ? rif : null };
}

// Colonna di un segmento in base alla posizione di inizio (tolleranza di 3 caratteri a sinistra)
function colonnaDi(seg, pos) {
  const d = seg.da + 3;
  if (pos.rif != null && d >= pos.rif) return 'rif';
  if (pos.um != null && d >= pos.um) return 'um';
  if (d >= pos.ris) return 'ris';
  return 'nome';
}

// Senza testata: la colonna del risultato è la più frequente posizione del secondo segmento
function stimaColonne(righe) {
  const conta = new Map();
  for (const r of righe) { const s = segmenti(r); if (s.length >= 2) conta.set(s[1].da, (conta.get(s[1].da) || 0) + 1); }
  let best = null;
  for (const [k, v] of conta) if (!best || v > best[1]) best = [k, v];
  return best ? { ris: best[0], um: null, rif: null } : { ris: 40, um: null, rif: null };
}

export function parseCorpo1(paginaRighe, { testata, settorePredefinito = 'MICROBIOLOGIA', anomalie, stato }) {
  // stato: { settori, note, corrente (settore), ultimaRiga (per i valori spezzati), pos }
  const st = stato;
  if (!st.pos) st.pos = colonneDaTestata(testata) || stimaColonne(paginaRighe);
  const pos = st.pos;
  const settore = () => {
    if (!st.corrente) { st.corrente = { titolo: settorePredefinito, righe: [] }; st.settori.push(st.corrente); anomalie.push(anomalia('SETTORE_PRESUNTO')); }
    return st.corrente;
  };
  for (const raw of paginaRighe) {
    const riga = raw.replace(/\s+$/, '');
    if (!riga.trim()) { st.ultimaRiga = null; continue; }
    if (isPieDiPagina(riga)) continue;
    const seg = segmenti(riga);
    const testo = compattaSpazi(riga);
    // Note a piè del corpo
    if (isNota(testo)) { st.note.push(testo); if (isSostituzione(testo)) anomalie.push(anomalia('SOSTITUZIONE')); st.ultimaRiga = null; continue; }
    // Titolo di settore: un solo segmento, maiuscolo, in prima colonna
    if (seg.length === 1 && colonnaDi(seg[0], pos) === 'nome' && isMaiuscola(seg[0].testo) && !isSottoriga(seg[0].testo) && !/^(ESBL|MIC)\b/.test(seg[0].testo)) {
      st.corrente = { titolo: seg[0].testo.toUpperCase(), righe: [] }; st.settori.push(st.corrente); st.ultimaRiga = null; continue;
    }
    // Legenda EUCAST e simili (righe fisse)
    if (isLegenda(testo)) { settore().righe.push({ tipo: 'legenda', testo }); st.ultimaRiga = null; continue; }
    // Sottorighe Metodo / Materiale / Sede: appartengono all'ultimo esame
    if (seg.length >= 1 && colonnaDi(seg[0], pos) === 'nome' && isSottoriga(seg[0].testo)) {
      const target = st.ultimoEsame;
      const txt = seg.map((s) => s.testo).join('  ');
      if (target) { target.sotto = target.sotto || []; target.sotto.push(txt); } else settore().righe.push({ tipo: 'testo', testo: txt });
      st.ultimaRiga = null; continue;
    }
    // Colonne del segmento
    const col = { nome: [], ris: [], um: [], rif: [] };
    for (const s of seg) col[colonnaDi(s, pos)].push(s.testo);
    const nome = col.nome.join(' '); const ris = col.ris.join(' '); const um = col.um.join(' '); const rif = col.rif.join(' ');
    // Continuazione di un valore spezzato: nessun nome, solo risultato (o riferimento)
    if (!nome && (ris || rif) && st.ultimaRiga) {
      const u = st.ultimaRiga;
      if (ris) { u.risultato = compattaSpazi(`${u.risultato || ''} ${ris}`); if (!u.ricomposto) { u.ricomposto = true; anomalie.push(anomalia('VALORE_RICOMPOSTO', u.nome)); } }
      if (rif) u.riferimento = compattaSpazi(`${u.riferimento || ''} ${rif}`);
      continue;
    }
    if (nome && !ris && !rif && !um) {
      // Testo in prima colonna senza risultato: descrizione dell'esame a capo oppure riga libera
      if (st.ultimaRiga && st.ultimaRiga.tipo === 'esame' && !st.ultimaRiga.risultato) { st.ultimaRiga.nome = compattaSpazi(`${st.ultimaRiga.nome} ${nome}`); continue; }
      settore().righe.push({ tipo: 'testo', testo: nome }); anomalie.push(anomalia('RIGA_NON_INTERPRETATA', nome.slice(0, 60))); st.ultimaRiga = null; continue;
    }
    if (!nome && !ris && !rif) { settore().righe.push({ tipo: 'testo', testo }); anomalie.push(anomalia('RIGA_NON_INTERPRETATA', testo.slice(0, 60))); st.ultimaRiga = null; continue; }
    // Riga di antibiogramma testuale (Bianalisi): "Antibiotico | Sensibile - MIC <=4"
    const ma = ris.match(RE_ANTIBIOTICO);
    if (ma) {
      const esito = ESITO[ma[1].toUpperCase()] || (ma[1][0].toUpperCase() + ma[1].slice(1).toLowerCase());
      const r = { tipo: 'antibiotico', nome, esito, mic: compattaSpazi(ma[2]) };
      settore().righe.push(r); st.ultimaRiga = r; st.ultimoEsame = st.ultimoEsame || null; continue;
    }
    // Riga esame: nome | risultato | [unità] | riferimento
    const r = { tipo: 'esame', nome, risultato: ris, unita: um, riferimento: rif };
    settore().righe.push(r); st.ultimaRiga = r; st.ultimoEsame = r;
  }
  return st;
}

// Conteggio degli antibiotici nel testo grezzo (per il controllo di coerenza, indipendente dal parser)
export const contaAntibioticiTesto1 = (testo) => (String(testo || '').match(/\b(Sensibile|Resistente|Intermedio)\s*[-–:]\s*MIC\b/gi) || []).length;
