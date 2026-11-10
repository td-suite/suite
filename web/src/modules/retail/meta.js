// Retail Assistant dentro la Suite: voci di menu disegnate dalla Suite (nessuna sidebar propria).
// Riordino del 09/11/2026 (decisione del CEO): un cruscotto complessivo e due sezioni separate, B2C (TuoTempo + GIPO) e B2B (tutto da
// StudioLab), più i dati e l'amministrazione. Mappa del modulo: docs/RETAIL.md.
// Profili: ADMIN (tutto), RETAIL (tutto tranne connettori, impostazioni e registro), SEDE (lettura e book della propria sede), VIEWER (sola lettura).
const WRITERS = ['ADMIN', 'RETAIL'];
export default {
  key: 'retail',
  title: 'Retail Assistant',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { group: 'B2C · centri medici e punti prelievo (TuoTempo + GIPO)' },
    { to: 'b2c', icon: 'stats', label: 'Cruscotto B2C', end: true },
    { to: 'b2c/clienti', icon: 'users', label: 'Clienti e profilazione' },
    { to: 'b2c/richiami', icon: 'bell', label: 'Richiami periodici', badge: 'richiami_scaduti' },
    { to: 'b2c/prodotti', icon: 'list', label: 'Prestazioni e prodotti' },
    { to: 'b2c/listino-online', icon: 'cash', label: 'Listino online vs cassa' },
    { to: 'b2c/vendite', icon: 'cash', label: 'Accettazioni e vendite (GIPO)' },
    { to: 'b2c/prenotazioni', icon: 'calendar', label: 'Prenotazioni online e prima disponibilità' },
    // visibile solo con l'impostazione synclab_privati_in_b2c a true (GET /api/retail/badges → laboratorio_in_sede)
    { to: 'b2c/laboratorio', icon: 'building', label: 'Laboratorio in sede', flag: 'laboratorio_in_sede' },
    { to: 'b2c/campagne', icon: 'megaphone', label: 'Campagne', badge: 'campagne_attive' },
    { to: 'b2c/promozioni', icon: 'calendar', label: 'Calendario promozionale' },
    { to: 'b2c/esposizione', icon: 'image', label: 'Esposizione e book retail' },
    { to: 'b2c/sedi', icon: 'pin', label: 'Sedi del network' },
    { to: 'b2c/budget', icon: 'stats', label: 'Budget e scostamenti (GIPO)' },
    { group: 'B2B · service e medicina del lavoro (StudioLab)' },
    { to: 'b2b', icon: 'stats', label: 'Cruscotto B2B', end: true },
    { to: 'b2b/clienti', icon: 'building', label: 'Aziende e strutture' },
    { to: 'b2b/produzione', icon: 'list', label: 'Produzione per cliente e mese' },
    { to: 'b2b/fatturato', icon: 'cash', label: 'Documenti emessi' },
    { to: 'b2b/listini', icon: 'cash', label: 'Listini applicati' },
    { to: 'b2b/profilo-pazienti', icon: 'users', label: 'Profilo dei pazienti' },
    { to: 'b2b/budget', icon: 'stats', label: 'Budget B2B' },
    { group: 'Dati e amministrazione' },
    { to: 'import', icon: 'upload', label: 'Import dai gestionali', profiles: WRITERS },
    { to: 'connettori', icon: 'cloud', label: 'Connettori', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
