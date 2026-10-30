// Interpretazione degli articoli Silva (richiesta del CEO, 30/10/2026: "dagli un'icona per interpretazione"): dalla descrizione del
// magazzino si ricavano la categoria del catalogo (che porta l'icona disegnata da components/art.jsx) e un colore. Funzione pura, con
// test. Chi non rientra in nessuna regola resta in MAGAZZINO (icona kit). L'Area Operations può sempre cambiare categoria a mano.
export const CATEGORIE_INTERPRETATE = [
  { code: 'PROVETTE', name: 'Provette e contenitori per prelievo', icon: 'tube', sort: 10, color: '#F2C94C',
    re: /\b(provett|vacutainer|vacuette|monovette|microtain|edta|citrato|eparin|litio|fluoruro|siero\b|gel\b|sst\b|k2e|k3e|tappo\s+(rosso|viola|verde|azzurro|grigio|giallo|nero))/i },
  { code: 'AGHI', name: 'Aghi, holder e farfalle', icon: 'needle', sort: 20, color: '#71B1BD',
    re: /\b(ag[oh]i?\b|aghi|butterfly|farfall|holder|camicia|lancett|pungidito|siring|cannul)/i },
  { code: 'CONTENITORI', name: 'Contenitori per campioni', icon: 'jar', sort: 30, color: '#9B51E0',
    re: /\b(contenitor|barattol|urin[ae]\b|feci|coprocolt|escreat|espettor|raccolta\s+24|sterile\s+da)/i },
  { code: 'TAMPONI', name: 'Tamponi e terreni di trasporto', icon: 'swab', sort: 40, color: '#2D9CDB',
    re: /\b(tampon|swab|amies|stuart|eswab|terreno\s+di\s+trasporto|uretral|vaginal|faring|nasal|rettal)/i },
  { code: 'TRASPORTO', name: 'Buste, sacchetti e trasporto campioni', icon: 'bag', sort: 50, color: '#27AE60',
    re: /\b(bust[ae]|sacchett|transbag|biohazard|borsa\s+termic|frigo\s+box|ghiaccio|refrigerant|contenitore\s+(di\s+)?trasporto|rack|portaprovett)/i },
  { code: 'VETRINI', name: 'Vetrini, citologia e istologia', icon: 'slide', sort: 60, color: '#EB5757',
    re: /\b(vetrin|citolog|thinprep|pap\s*test|cytobrush|spatol|ayre|fissativ|formalin|istolog|biocassett)/i },
  { code: 'REAGENTI', name: 'Disinfettanti, reagenti e soluzioni', icon: 'bottle', sort: 70, color: '#F2994A',
    re: /\b(disinfett|alcol|clorexidin|amuchin|soluzion|reagent|glucosio|soluzione\s+glucosata|acqua\s+ossigenat|gel\s+ecograf|lubrificant|detergent|igienizz|sanific)/i },
  { code: 'MODULISTICA', name: 'Etichette, modulistica e cancelleria', icon: 'doc', sort: 80, color: '#5B6B70',
    re: /\b(etichett|modul[oi]\b|modulistic|registr|blocco|cart[ae]\b|penna|pennarell|nastro|rotol|stampant|toner|busta\s+(da\s+)?letter|cancelleri)/i },
  { code: 'DPI', name: 'Dispositivi di protezione e medicazione', icon: 'kit', sort: 85, color: '#56CCF2',
    re: /\b(guant|mascherin|ffp2|camice|calzar|cuffi|visier|occhial|cotone|garz[ae]|cerott|benda|laccio|emostatic|cerotto|medicaz|telin|lenzuolin|carta\s+lettino)/i },
];

export function interpreta(descrizione, codice = '') {
  const testo = `${descrizione || ''} ${codice || ''}`;
  for (const c of CATEGORIE_INTERPRETATE) if (c.re.test(testo)) return { category_code: c.code, icon: c.icon, color: c.color };
  return { category_code: 'MAGAZZINO', icon: 'kit', color: '#71B1BD' };
}

/** Crea le categorie interpretate se mancano (idempotente). client = connessione/pool con .query */
export async function assicuraCategorie(client) {
  for (const c of CATEGORIE_INTERPRETATE) {
    await client.query('INSERT INTO categories (code, name, icon, sort) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [c.code, c.name, c.icon, c.sort]);
  }
}
