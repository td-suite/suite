// Portale Service dentro la Suite (01/11/2026): copia conforme del sito pubblico service.toscanadiagnostica.it, stesse sezioni e
// stessi testi. Aperto a tutti gli autenticati (openToAll), clienti service compresi; Impostazioni solo per EDITOR (e amministratori).
// Voci Servizi con la rimappatura del CEO: Vademecum dentro il portale; Circolari, Ordine del materiale e Portale NC aprono i widget
// della Suite in una SCHEDA NUOVA (blank, con l'icona "esterno", come le voci blank=true del sito); Check-up e promozioni segnaposto.
// Le scorciatoie e i recapiti del Laboratorio della barra laterale del sito sono in fondo al menu; i link stabili /service/doc|m/...
// aprono sempre la revisione in vigore.
// "Il mio spazio" (01/11/2026): solo per l'accesso esterno Cliente service (user.cliente_service da /api/auth/me, riconoscimento nel
// server, lib/esterni.js): è in cima al menu ed è la pagina di atterraggio (/service); per lui Preparazioni e documenti è /service/preparazioni.
// Per tutti gli altri la voce non esiste. homeSchedaNuova: per il personale TD la card in Home apre il portale in una scheda nuova con il
// menu "Apri pagina…" (voci con `to`, tranne paginaHome: false): il personale controlla i contenuti, non ci lavora dentro.
// Vista come Legal entity (01/11/2026): il personale TD che ha scelto una Legal entity cliente service nel selettore "Visualizza come"
// vede il portale come quel cliente: "Il mio spazio" in cima e atterraggio su /service (vista.js). paginaHomeExtra: voci in cima al menu
// "Apri pagina…" della card in Home.
import { inVistaCome } from './vista.js';

const clienteService = (u) => Boolean(u?.cliente_service) || inVistaCome(u);
export default {
  key: 'service',
  title: 'Portale Service',
  kicker: 'HQS',
  area: 'HQS',
  openToAll: true,
  homeSchedaNuova: true,
  paginaHomeExtra: [{ label: 'Visualizza come Legal entity…', icon: 'users', href: '/service?scegli=1' }],
  nav: [
    { to: '', icon: 'home', label: 'Il mio spazio', end: true, when: clienteService },
    { to: 'preparazioni', icon: 'heart', label: 'Preparazioni e documenti', when: clienteService, paginaHome: false },
    { to: '', icon: 'heart', label: 'Preparazioni e documenti', end: true, when: (u) => !clienteService(u) },
    { to: 'certificazioni', icon: 'shield', label: 'Certificazioni di qualità' },
    { to: 'veq', icon: 'stats', label: 'VEQ · Valutazione Esterna di Qualità' },
    { to: 'agora', icon: 'news', label: 'Agorà · blog' },
    { group: 'Servizi' },
    { to: 'servizi', icon: 'grid', label: 'Tutti i servizi', end: true },
    { to: 'vademecum', icon: 'doc', label: 'Vademecum' },
    { href: '/service/servizi/circolari', blank: true, icon: 'list', label: 'Circolari e aggiornamenti operativi' },
    { href: '/service/servizi/ordine-materiale', blank: true, icon: 'folder', label: 'Ordine del materiale' },
    { to: 'servizi/promozioni', icon: 'star', label: 'Check-up e promozioni mensili', paginaHome: false },
    { href: '/service/servizi/portale-nc', blank: true, icon: 'shield', label: 'Portale NC' },
    { to: 'contatti', icon: 'users', label: 'Contatti' },
    { group: 'Scorciatoie' },
    { href: '/service/doc/TD-SGI-IDL011', blank: true, icon: 'doc', label: 'Prelievo e trasporto campioni' },
    { href: '/service/doc/TD-SGI-PRO042', blank: true, icon: 'doc', label: 'Fase preanalitica' },
    { href: '/service/doc/TD-SGI-IDL013', blank: true, icon: 'doc', label: 'Tabella valori critici' },
    { href: '/service/doc/TD-SGI-IDL014', blank: true, icon: 'doc', label: 'Invio campioni Anatomia Patologica' },
    { href: '/service/m/TD-SGI-INF001', blank: true, icon: 'file', label: 'Informativa raccolta campioni' },
    { href: '/service/m/TD-SGI-MOD252', blank: true, icon: 'file', label: 'Richiesta materiale' },
    { group: 'Laboratorio di Analisi' },
    { href: `mailto:laboratorio@toscanadiagnostica.it?subject=${encodeURIComponent('[Portale Service] Richiesta')}`, icon: 'mail', label: 'Scrivi al laboratorio' },
    { href: 'tel:+390557765108', icon: 'phone', label: '055 7765108' },
    { group: 'Gestione', profiles: ['EDITOR'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['EDITOR'] },
  ],
};
