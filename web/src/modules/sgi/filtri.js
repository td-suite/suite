// Portale SGI · filtri del cruscotto, riscritti da static/app.js del sito sgi.toscanadiagnostica.it con le stesse regole (copia conforme).
// Funzioni pure, senza import: le usano le pagine React del modulo e i test del server (server/test/sgi-filtri.test.mjs).

// Famiglie documentali nell'ordine della barra del sito
export const FAMIGLIE = [['all', 'Tutti'], ['POL', 'Politiche'], ['MAN', 'Manuali'], ['REG', 'Regolamenti e Registri'], ['PLN', 'Piani'],
  ['PRO', 'Procedure'], ['IDL', 'Istruzioni'], ['MOD', 'Moduli'], ['INF', 'Informative'], ['DEX', 'Doc. esterni'], ['RPT', 'Report']];

// I quattro riquadri in alto: sono filtri (un secondo clic li disattiva)
export const RIQUADRI = {
  tutti: { label: 'Tutti i documenti', fam: null },
  operativi: { label: 'Procedure e istruzioni', fam: ['PRO', 'IDL'] },
  moduli: { label: 'Moduli, informative e documenti esterni', fam: ['MOD', 'INF', 'DEX'] },
  governo: { label: 'Documenti di governo del sistema', fam: ['POL', 'MAN', 'PLN', 'REG', 'RPT'] },
};

// Documenti cardine (TOP_CODES del sito), nell'ordine del sito
export const DOCUMENTI_CARDINE = ['TD-SGI-POL001', 'TD-SGI-MAN001', 'TD-SGI-MAN002', 'TD-SGI-MAN003', 'TD-SGI-MAN004', 'TD-SGI-MAN005', 'TD-SGI-REG006',
  'TD-SGI-REG013', 'TD-SGI-REG016', 'TD-SGI-REG020', 'TD-SGI-PLN001', 'TD-SGI-PLN015', 'TD-SGI-MOD229', 'TD-SGI-PRO001', 'TD-SGI-PRO042',
  'TD-SGI-PRO070', 'TD-SGI-PRO085', 'TD-SGI-PRO111', 'TD-SGI-PRO086', 'TD-SGI-PRO107', 'TD-SGI-IDL036', 'TD-SGI-INF001', 'TD-SGI-INF055', 'TD-SGI-MOD252'];

// Scorciatoie che sul sito aprono un PDF: Indice REG006, Mappa concettuale (MAN005), Politica integrata (POL001)
export const DOC_SCORCIATOIE = { reg006: 'TD-SGI-REG006', mappa: 'TD-SGI-MAN005', politica: 'TD-SGI-POL001' };

export const ULTIME_EMISSIONI = 40;
export const LIMITE_RISULTATI = 150;

/** norm() del sito: minuscolo e senza accenti. */
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Chiave ordinabile della data "gg/mm/aaaa" del documento (aaaammgg); "00000000" se manca. */
export const chiaveData = (d) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d?.data || ''); return m ? m[3] + m[2] + m[1] : '00000000'; };
/** Codice senza revisione (TD-SGI-PRO042_02 → TD-SGI-PRO042), come i link stabili del sito. */
export const codiceBase = (code) => String(code || '').split('_')[0];
/** find() del sito: il documento il cui codice inizia con "<base>_" (la revisione in vigore). */
export const trovaDocumento = (docs, base) => (docs || []).find((d) => String(d.code || '').startsWith(`${base}_`)) || null;

/** Famiglie attive: un riquadro prevale sulla barra delle famiglie; null = tutte. */
export function famiglieAttive({ riquadro = null, famiglia = 'all' } = {}) {
  if (riquadro && RIQUADRI[riquadro]) return RIQUADRI[riquadro].fam;
  return famiglia && famiglia !== 'all' ? [famiglia] : null;
}

/** C'è un filtro attivo? Senza filtri il cruscotto mostra la home (documenti cardine e aree), non l'elenco. */
export function haFiltri({ q = '', riquadro = null, famiglia = 'all', area = 'all', speciale = null } = {}) {
  return Boolean(String(q).trim() || riquadro || (famiglia && famiglia !== 'all') || (area && area !== 'all') || speciale);
}

/**
 * search() del sito. f: { q, riquadro, famiglia, area, speciale: 'recenti'|'stampabili'|'cardine'|null }; fulltext: { codice: testo } o null
 * (finché non è caricato la ricerca opera su codice, titolo, sintesi, area e famiglia).
 * Ogni parola deve comparire nei metadati o nel testo integrale. Ordine: prima i documenti che contengono la frase nel codice o nel
 * titolo, poi per codice. "recenti" = i 40 più recenti per data (a parità, per codice); "cardine" = i documenti cardine nell'ordine del sito.
 */
export function filtraDocumenti(docs, f = {}, fulltext = null) {
  if (!haFiltri(f)) return [];
  const q = norm(String(f.q || '').trim());
  const termini = q.split(/\s+/).filter(Boolean);
  const fams = famiglieAttive(f);
  const area = f.area || 'all';
  let res = (docs || []).filter((d) => {
    if (fams && !fams.includes(d.famiglia)) return false;
    if (area !== 'all' && d.area !== area) return false;
    if (f.speciale === 'stampabili' && !d.stampabile) return false;
    if (!termini.length) return true;
    const hay = norm(`${d.code} ${d.title} ${d.sintesi} ${d.area} ${d.famiglia_nome}`);
    const body = fulltext ? norm(fulltext[d.code] || '') : '';
    return termini.every((t) => hay.includes(t) || body.includes(t));
  });
  // un documento per codice cardine, come find() del sito: TD-SGI-INF001 è l'informativa _00, non le preparazioni _0a.._0s
  if (f.speciale === 'cardine') return documentiCardine(res);
  if (f.speciale === 'recenti') return res.sort((a, b) => chiaveData(b).localeCompare(chiaveData(a)) || a.code.localeCompare(b.code)).slice(0, ULTIME_EMISSIONI);
  return res.sort((a, b) => {
    const qa = q && norm(`${a.code} ${a.title}`).includes(q) ? 0 : 1;
    const qb = q && norm(`${b.code} ${b.title}`).includes(q) ? 0 : 1;
    return qa - qb || a.code.localeCompare(b.code);
  });
}

/** Le ultime emissioni (40 documenti più recenti per data), come la scorciatoia del sito. */
export const ultimeEmissioni = (docs, n = ULTIME_EMISSIONI) => [...(docs || [])].sort((a, b) => chiaveData(b).localeCompare(chiaveData(a)) || a.code.localeCompare(b.code)).slice(0, n);
/** Documenti cardine presenti nello specchio, nell'ordine del sito. */
export const documentiCardine = (docs) => DOCUMENTI_CARDINE.map((c) => trovaDocumento(docs, c)).filter(Boolean);

/** Conteggi per i riquadri e le tessere delle aree: { perFam, perArea, gruppo(chiave) }. */
export function conteggi(docs) {
  const perFam = {}; const perArea = {};
  for (const d of docs || []) { perFam[d.famiglia] = (perFam[d.famiglia] || 0) + 1; perArea[d.area] = (perArea[d.area] || 0) + 1; }
  const gruppo = (k) => (RIQUADRI[k].fam || Object.keys(perFam)).reduce((s, f) => s + (perFam[f] || 0), 0);
  return { perFam, perArea, gruppo };
}

/** Titolo dell'elenco dei risultati, come sul sito: riquadro o famiglia · vista speciale · area · "ricerca". */
export function titoloRisultati(f = {}) {
  const parti = [];
  if (f.riquadro && RIQUADRI[f.riquadro]) parti.push(RIQUADRI[f.riquadro].label);
  else if (f.famiglia && f.famiglia !== 'all') parti.push((FAMIGLIE.find((x) => x[0] === f.famiglia) || [])[1]);
  if (f.speciale === 'recenti') parti.push('ultime emissioni');
  if (f.speciale === 'stampabili') parti.push('versioni stampabili');
  if (f.speciale === 'cardine') parti.push('documenti cardine');
  if (f.area && f.area !== 'all') parti.push(f.area);
  if (String(f.q || '').trim()) parti.push(`"${String(f.q).trim()}"`);
  return parti.filter(Boolean).join(' · ') || 'Risultati';
}

/** Prestazioni della pagina Preparazioni: gruppo (extra.Gruppo senza trattino) e ricerca su codici, descrizione, extra e preparazioni. */
export const gruppoPrestazione = (r) => String((r?.extra || {}).Gruppo || '').replace(/^\s*-\s*/, '').trim();
export function filtraPrestazioni(righe, { q = '', gruppo = 'all' } = {}) {
  const termini = norm(String(q).trim()).split(/\s+/).filter(Boolean);
  return (righe || []).filter((r) => (gruppo === 'all' || gruppoPrestazione(r) === gruppo) && (!termini.length || termini.every((t) =>
    norm(`${r.codice} ${r.shortcut || ''} ${r.descrizione} ${Object.values(r.extra || {}).join(' ')} ${(r.link || []).map((l) => `${l.title} ${l.code}`).join(' ')}`).includes(t))));
}
/** slug() del sito (preparazioni.html): per riconoscere il codice di ?codice= tra shortcut e codici GIPO. */
export const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const prestazioneDaCodice = (righe, codice) => (righe || []).find((r) => slug(r.shortcut || r.codice).toLowerCase() === slug(codice).toLowerCase() || slug(r.codice).toLowerCase() === slug(codice).toLowerCase()) || null;
