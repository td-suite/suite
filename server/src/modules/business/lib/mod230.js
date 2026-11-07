// Contratto Service di Laboratorio (TD-SGI-MOD230): regole pure della lettera di offerta e delle Condizioni Generali (richiesta del
// CEO del 07/11/2026). Nessun accesso al database: le usano docgen.js, la generazione del contratto (routes/contracts.js), lo script
// che ha riscritto il template e i test.
// - Allegati: l'1 "Elenco analisi" e il 2 "Prezzi e Condizioni Economiche" sono diventati un solo allegato, gli altri scalano di uno
//   (la Politica della Qualità, ultima, passa da 9 a 8). rinumeraRichiami() riscrive i richiami del testo con la mappa.
// - Allegato 2 "Ritiro campioni": precompilato con la sede operativa del contratto se indicata, altrimenti con la sede legale della
//   Legal entity; referente, telefono ed e-mail dal referente principale dell'account.
// - Allegato 8 "Politica della Qualità": il documento dello specchio SGI nella revisione più aggiornata.
// - Firma di TD nel PDF: il riquadro tra la qualifica e il nome del firmatario nella colonna di Toscana Diagnostica dei blocchi firme.

// ---------------------------------------------------------------- allegati
/** Allegati del MOD230 dopo l'accorpamento del 07/11/2026 (numero, titolo della Lista degli allegati). */
export const ALLEGATI_MOD230 = [
  { n: 1, titolo: 'Elenco delle analisi, prezzi e condizioni economiche' },
  { n: 2, titolo: 'Ritiro campioni' },
  { n: 3, titolo: 'Trasporto materiali infettivi e campioni diagnostici (Circ. Min. Salute n. 3 del 08/05/2003 + ADR 2025 UN3373)' },
  { n: 4, titolo: 'Guida agli Esami' },
  { n: 5, titolo: 'Interfacciamento informatico' },
  { n: 6, titolo: 'Terzi Incaricati' },
  { n: 7, titolo: 'Ruolo privacy del Cliente' },
  { n: 8, titolo: 'Politica della Qualità di Toscana Diagnostica' },
];
/** Vecchio numero → nuovo numero (1 e 2 accorpati nell'1). */
export const MAPPA_ALLEGATI_MOD230 = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8 };

/**
 * Riscrive i richiami agli allegati di un testo con la mappa vecchio → nuovo numero: "Allegato n. 3", "Allegato 7", "ALLEGATO 6 —",
 * "All. 4", "Allegati n. 3 e 4" e il conteggio "(con relativi 9 Allegati)" (diventa il numero di allegati della nuova lista).
 * Un numero fuori mappa resta com'è. Va applicata una volta sola al testo con la vecchia numerazione (l'ha fatto lo script di
 * riscrittura del template, vedi docs/BUSINESS_HUB.md): applicata di nuovo scalerebbe ancora i numeri.
 */
export function rinumeraRichiami(testo, mappa = MAPPA_ALLEGATI_MOD230, totale = ALLEGATI_MOD230.length) {
  const nuovo = (n) => (mappa[n] != null ? String(mappa[n]) : String(n));
  return String(testo ?? '')
    // conteggio: "relativi 9 Allegati"
    .replace(/\b(\d+)(\s+Allegati)\b/g, (_m, _n, resto) => `${totale}${resto}`)
    // "Allegato n. 3", "Allegato 7", "ALLEGATO 6", "All. 4", "Allegati n. 3 e 4"
    .replace(/\b(Allegat[oi]|ALLEGAT[OI]|All\.)(\s+n\.)?(\s+)(\d+)((?:\s*(?:,|e|ed)\s*\d+)*)/g, (_m, parola, nPunto, sp, n, altri) =>
      `${parola}${nPunto || ''}${sp}${nuovo(Number(n))}${altri.replace(/\d+/g, (x) => nuovo(Number(x)))}`);
}

// ---------------------------------------------------------------- Allegato 2: ritiro campioni
/**
 * "Via Roma 1, 50100 Firenze (FI)" → { via: 'Via Roma 1', citta: '50100 Firenze (FI)' }: la città è l'ultima parte dopo una virgola
 * se contiene lettere; senza virgole tutto è la via.
 */
export function dividiIndirizzo(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return { via: '', citta: '' };
  const i = t.lastIndexOf(',');
  if (i < 0) return { via: t, citta: '' };
  const coda = t.slice(i + 1).trim(); const testa = t.slice(0, i).trim();
  if (!/[A-Za-zÀ-ÿ]/.test(coda) || !testa) return { via: t, citta: '' };
  return { via: testa, citta: coda };
}
const cittaDi = (p) => [p?.zip, p?.city].filter(Boolean).join(' ') + (p?.prov ? ` (${p.prov})` : '');

/**
 * Valori proposti per l'Allegato 2 (ritiro campioni) quando i campi del form sono vuoti: sede operativa del contratto se indicata
 * (data.site_name / data.site_address), altrimenti sede legale della Legal entity (p: name, street, zip, city, prov); referente,
 * telefono ed e-mail dal referente principale dell'account (r: { nome, telefono, email }) se c'è. Ritorna anche `fonte`.
 */
export function ritiroPredefinito(d = {}, p = {}, r = null) {
  const operativa = Boolean(String(d.site_name || '').trim() || String(d.site_address || '').trim());
  let site; let street; let city;
  if (operativa) {
    const ind = dividiIndirizzo(d.site_address);
    site = String(d.site_name || '').trim() || p?.name || '';
    street = ind.via || (d.site_address ? '' : p?.street || '');
    city = ind.citta || (d.site_address ? '' : cittaDi(p));
  } else {
    site = p?.name || ''; street = p?.street || ''; city = cittaDi(p);
  }
  return {
    site, street, city,
    contact: r?.nome || '', phone: r?.telefono || '', email: r?.email || '',
    fonte: operativa ? 'SEDE_OPERATIVA' : 'SEDE_LEGALE',
  };
}
/** Allegato 2 per il documento: i campi compilati nel form prevalgono, quelli vuoti prendono il valore proposto. */
export function ritiroPerDocumento(pickup = {}, d = {}, p = {}, r = null) {
  const pre = ritiroPredefinito(d, p, r);
  const v = (k) => (String(pickup?.[k] ?? '').trim() ? String(pickup[k]).trim() : pre[k]);
  return { site: v('site'), street: v('street'), city: v('city'), contact: v('contact'), phone: v('phone'), email: v('email') };
}

/** Nominativo del Committente (ruolo RESPONSABILE): quello indicato o, vuoto, la ragione sociale della Legal entity controparte. */
export function committente(privacy = {}, p = {}) {
  if (privacy?.role !== 'RESPONSABILE') return '-';
  return String(privacy.principal || '').trim() || p?.name || '__________';
}

// ---------------------------------------------------------------- Allegato 8: Politica della Qualità
const revNum = (x) => { const n = Number(String(x?.rev ?? '').replace(/\D/g, '')); return Number.isFinite(n) ? n : -1; };
const dataNum = (s) => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0; };
/**
 * Documento della Politica della Qualità nello specchio SGI (docs.json): prima un titolo "Politica della/per la Qualità", poi la
 * Politica Integrata (famiglia POL: nel SGI di TD la politica per la qualità è la Politica integrata multi-norma, TD-SGI-POL001),
 * sempre con un PDF. Tra più revisioni vince la più alta (a parità, la data più recente). null se non c'è.
 */
export function cercaPoliticaQualita(docs = []) {
  const conPdf = (Array.isArray(docs) ? docs : []).filter((x) => x && x.pdf);
  const passi = [
    (x) => /politica\s+(della|per\s+la)\s+qualit/i.test(x.title || ''),
    (x) => (x.famiglia === 'POL' || /-POL\d/i.test(x.code || '')) && /politica\s+integrata/i.test(x.title || ''),
  ];
  for (const ok of passi) {
    const c = conPdf.filter(ok);
    if (c.length) return [...c].sort((a, b) => revNum(b) - revNum(a) || dataNum(b.data) - dataNum(a.data))[0];
  }
  return null;
}
/** Riferimento dell'allegato nel DOCX (titolo + revisione e data del documento SGI, oppure l'avviso). */
export function riferimentoPolitica(doc, { inCoda = false } = {}) {
  if (!doc) return 'Documento non disponibile dallo specchio SGI al momento della generazione: ne viene fornita copia al Cliente al momento della sottoscrizione del presente Contratto.';
  const codice = String(doc.code || '').replace(/_\d+$/, '');
  return `Documento di riferimento: ${codice} "${doc.title}", revisione ${doc.rev} del ${doc.data} (Sistema di Gestione Integrato di Toscana Diagnostica, Portale SGI).${inCoda ? ' Il testo integrale è riportato in coda alla versione PDF del presente documento.'
    : ' Documento non disponibile dallo specchio SGI al momento della generazione: ne viene fornita copia al Cliente al momento della sottoscrizione del presente Contratto.'}`;
}

// ---------------------------------------------------------------- firma di Toscana Diagnostica nel PDF
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
/**
 * Spazi della firma di TD nelle pagine del PDF. pagine: [{ w, h, items: [{ s, x, y, w, h }] }] (coordinate PDF, origine in basso a
 * sinistra, y = linea di base). Il blocco firme del template ha nella colonna di destra la qualifica, una riga vuota e il nome del
 * firmatario: lo spazio è il rettangolo tra la base della qualifica e la sommità del nome, largo quanto la colonna attorno al centro
 * del nome. Ritorna [{ pagina (0-based), x, y, w, h, cx }].
 */
export function spaziFirma(pagine = [], { nome, ruolo } = {}) {
  const out = [];
  const n = norm(nome); const r = norm(ruolo);
  if (!n || !r) return out;
  pagine.forEach((pg, i) => {
    const items = pg.items || [];
    for (const it of items) {
      if (norm(it.s) !== n || it.x < pg.w / 2 - 40) continue;
      const cx = it.x + (it.w || 0) / 2;
      // qualifica sopra il nome, nella stessa colonna (centro entro 60 pt), a non più di 120 pt
      const q = items.filter((z) => norm(z.s) === r && z.y > it.y + 4 && z.y - it.y < 120 && Math.abs((z.x + (z.w || 0) / 2) - cx) < 60)
        .sort((a, b) => a.y - b.y)[0];
      if (!q) continue;
      const alto = (it.h || 11) * 0.8;   // sommità delle maiuscole del nome
      const y0 = it.y + alto + 2;        // sopra il nome
      const y1 = q.y - (q.h || 11) * 0.25 - 1;   // sotto i discendenti della qualifica
      const h = y1 - y0;
      if (h < 12) continue;
      const w = Math.min(pg.w / 2 - 30, 220);
      out.push({ pagina: i, x: cx - w / 2, y: y0, w, h, cx });
    }
  });
  return out;
}
/**
 * Dimensioni della firma nel riquadro senza deformarla: altezza massima quella del riquadro (con un margine), larghezza massima 170 pt,
 * proporzioni dell'immagine conservate, centrata orizzontalmente e appoggiata in basso (sopra il nome).
 */
export function misuraFirma(spazio, imgW, imgH, { margine = 2, larghezzaMax = 170 } = {}) {
  const hMax = Math.max(1, spazio.h - margine * 2);
  const wMax = Math.min(spazio.w, larghezzaMax);
  const k = Math.min(hMax / imgH, wMax / imgW);
  const width = imgW * k; const height = imgH * k;
  return { x: spazio.cx - width / 2, y: spazio.y + margine, width, height };
}

// ---------------------------------------------------------------- Allegato 1: prezzi dell'offerta
const eur2 = (n) => (n == null || n === '' ? '' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)));
/** Righe del listino corrente dell'account per la tabella dell'Allegato 1 (codice, esame, settore, listino €, offerta €). */
export function righeListino(righe = []) {
  return (Array.isArray(righe) ? righe : []).map((x) => ({
    lst_codice: x.codice || '–', lst_esame: x.descrizione || x.codice || '', lst_settore: x.settore || '', lst_listino: eur2(x.listino), lst_offerta: eur2(x.offerto),
  }));
}
