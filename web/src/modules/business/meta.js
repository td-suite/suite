// Modulo Business Hub (ex "Contratti B2C/B2B", 06/11/2026): voci di navigazione disegnate dalla Suite (la sidebar dell'app non si porta).
// La chiave resta `business`: percorsi /business, API /api/business, grant e profili invariati.
// 06/11/2026, sera: "gli altri [le altre linee] non servono qui, semmai replicalo per ogni sezione": Cruscotto, Pipeline, Clienti e prospect,
// Email da assegnare e Clienti sono replicati in ogni sezione con la linea fissa nell'indirizzo (?linea=…); nessuna vista "tutte le linee".
// 07/11/2026: niente elenchi di contratti per linea ("una replica" di Tutti i contratti, CEO): i contratti si leggono nella scheda
// dell'account (Clienti e prospect), dove si apre il dettaglio senza uscire dall'account (/business/account/:id/contratti/:cid).
// 07/11/2026: 'DB Opportunità' tolto dal menu (il file è assorbito negli account): la stampa PDF/XLSX a 49 colonne sta in Pipeline e in
// Clienti e prospect (pulsanti Stampa PDF / XLSX / Tabella); la tabella completa resta raggiungibile da lì (/business/db-opportunita).
// Menu del CEO (06/11/2026): "Prima sezione: Management con Panoramica contratti e Tutti i contratti e Organizzazione e Sedi. Poi Service di
// Laboratorio con Cruscotto, Pipeline, Clienti e prospect, DB Opportunità, Email da assegnare, Clienti. Poi Punti Prelievo con Punti Prelievo
// e Sedi TD in locazione. Poi Medicina del Lavoro. Infine Amministrazione." Cruscotto e Pipeline della sezione Service sono filtrati sulla
// linea SRV (?linea=SRV, dalla pagina si vedono anche tutte le linee); i Fascicoli autorizzazione si aprono dalla pagina Punti Prelievo.
// 09/11/2026 (CEO: "Sedi TD in locazione non serve. I punti prelievo/centri medici li hai già: sono sedi"): via "Sedi TD in locazione" (la pagina
// /business/sedi resta raggiungibile da Amministrazione > Sedi, link "Locazioni") e "Punti e centri attivi" e "Punti Prelievo" diventano una
// pagina sola, "Punti Prelievo e Centri", che parte dalle sedi dell'anagrafica. Il contatore resta "fascicoli aperti".
// Una voce con `to` che inizia per "?" resta sulla pagina principale del modulo con il filtro nell'indirizzo (components/Shell.jsx).
export default {
  key: 'business',
  title: 'Business Hub',
  kicker: 'Business',
  area: 'RETAIL_FLOW',
  nav: [
    { group: 'Management' },
    { to: 'contratti-panoramica', icon: 'grid', label: 'Panoramica contratti' },
    { to: 'contratti', icon: 'list', label: 'Tutti i contratti', badge: 'contratti_in_scadenza' },
    { to: 'organizzazioni', icon: 'building', label: 'Organizzazioni e sedi' },
    { group: 'Service di Laboratorio' },
    { to: '?linea=SRV', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'pipeline?linea=SRV', icon: 'stats', label: 'Pipeline' },
    { to: 'clienti?linea=SRV', icon: 'users', label: 'Clienti e prospect', badge: 'da_confermare' },
    { to: 'email?linea=SRV', icon: 'mail', label: 'Email da assegnare', badge: 'email_da_assegnare' },
    { to: 'clienti-attivi?linea=SRV', icon: 'check', label: 'Clienti', badge: 'da_verificare' },
    { group: 'Punti Prelievo' },
    { to: '?linea=PP', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'pipeline?linea=PP', icon: 'stats', label: 'Pipeline' },
    { to: 'clienti?linea=PP', icon: 'users', label: 'Partner e prospect' },
    { to: 'punti-prelievo', icon: 'pin', label: 'Punti Prelievo e Centri', badge: 'fascicoli_aperti' },
    { to: 'email?linea=PP', icon: 'mail', label: 'Email da assegnare' },
    { group: 'Medicina del Lavoro' },
    { to: '?linea=MDL', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'pipeline?linea=MDL', icon: 'stats', label: 'Pipeline' },
    { to: 'clienti?linea=MDL', icon: 'users', label: 'Aziende e prospect' },
    { to: 'email?linea=MDL', icon: 'mail', label: 'Email da assegnare' },
    { to: 'clienti-attivi?linea=MDL', icon: 'check', label: 'Clienti' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ],
};
