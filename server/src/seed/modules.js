// Catalogo dei moduli (widget) della Suite. I profili dei moduli legacy sono i ruoli delle app di oggi:
// il codice migrato continuerà a leggerli, cambia solo la sorgente (grant della Suite al posto della tabella users locale).
const P = (key, label, scoped = false) => ({ key, label, scoped });

export const MODULES = [
  // ---- Aree: DIREZIONE, FINANCE, RETAIL_FLOW, OPERATIONS, HQS, PEOPLE (ordine deciso da Francesco il 24/10/2026)
  // ---- (i commenti di area sotto sono storici: l'area effettiva è nel campo area)
  { key: 'business', area: 'RETAIL_FLOW', name: 'Contratti B2C/B2B', tagline: 'Punti prelievo, locazioni, service, medicina del lavoro', icon: 'contracts-b2b', kind: 'LEGACY', legacy_url: 'https://business.toscanadiagnostica.it', sort_order: 10,
    profiles: [P('ADMIN', 'Amministratore'), P('SERVICE', 'Service'), P('RETAIL', 'Retail'), P('MDL', 'Medicina del Lavoro'), P('HQS', 'HQS'), P('VIEWER', 'Sola lettura')] },
  { key: 'finance', area: 'FINANCE', name: 'Payments', tagline: 'Firma congiunta CEO e CFO, poteri per importo', icon: 'finance-sign', kind: 'LEGACY', legacy_url: 'https://finance.toscanadiagnostica.it', sort_order: 10,
    profiles: [P('CEO', 'Amministratore Delegato'), P('CFO', 'CFO'), P('SUPPORT', 'Finance Support'), P('VIEWER', 'Sola lettura')] },
  { key: 'integration', area: 'FINANCE', name: 'Integration M&A', tagline: 'Post closing dei target, GANTT e avanzamento', icon: 'integration-plan', kind: 'LEGACY', legacy_url: 'https://integration.toscanadiagnostica.it', sort_order: 30,
    profiles: [P('ADMIN', 'Amministratore'), P('EDITOR', 'Editor'), P('VIEWER', 'Sola lettura')] },
  { key: 'cockpit', area: 'DIREZIONE', name: 'Cockpit direzionale', tagline: 'Incassi, fatturato, ordini, NC, ambulatori, M&A in una pagina', icon: 'cockpit', kind: 'NATIVE', route: '/cockpit', sort_order: 10,
    profiles: [P('DIREZIONE', 'Direzione'), P('VIEWER', 'Sola lettura')] },

  // ---- Operations
  { key: 'cash', area: 'FINANCE', name: 'Cash Management', tagline: 'Rendiconti, flusso contante, royalty, SEPA', icon: 'cash', kind: 'LEGACY', legacy_url: 'https://cash.toscanadiagnostica.it', sort_order: 20, scope_type: 'SITE',
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('ADMIN', 'Amministratore di sede'), P('CASSIERE', 'Cassiere', true), P('FINANCE', 'Finance Specialist'), P('OPERATOR', 'Operatore di sede', true), P('PARTNER', 'Partner', true)] },
  { key: 'orders', area: 'OPERATIONS', name: 'Ordini e Magazzino', tagline: 'Materiale di consumo in otto fasi, giacenze, produzione', icon: 'orders', kind: 'LEGACY', legacy_url: 'https://orders.toscanadiagnostica.it', sort_order: 10, scope_type: 'SITE',
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('PROCUREMENT', 'Area Operations'), P('CLIENTE', 'Cliente Service', true), P('SEDE', 'Sede del network', true), P('LAB', 'Laboratorio')] },
  { key: 'shipments', area: 'OPERATIONS', name: 'Spedizioni e Kit', tagline: 'Endeavor DNA e Lifestyle: kit, tracking, rendicontazione', icon: 'shipments', kind: 'LEGACY', legacy_url: 'https://shipments.toscanadiagnostica.it', sort_order: 20,
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('ADMIN', 'Amministratore'), P('ENDEAVOR', 'Endeavor'), P('VIEWER', 'Sola lettura')] },
  { key: 'room', area: 'RETAIL_FLOW', name: 'Room Planning', tagline: 'Ambulatori, medici, turni e presenze delle sedi', icon: 'room', kind: 'LEGACY', legacy_url: 'https://planning.toscanadiagnostica.it', sort_order: 20, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('PLANNER', 'Planner', true), P('RESP_SAN', 'Responsabile sanitario', true), P('PROF', 'Professionista'), P('VIEWER', 'Sola lettura')] },

  // ---- HQS
  { key: 'nc', area: 'HQS', name: 'Non conformità', tagline: 'NC preanalitiche in cinque fasi, dialogo con le sedi', icon: 'nc', kind: 'LEGACY', legacy_url: 'https://nc.toscanadiagnostica.it', sort_order: 30, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('QUALITA', 'Qualità'), P('LAB', 'Laboratorio'), P('SEDE', 'Sede o cliente', true), P('VIEWER', 'Sola lettura')] },
  { key: 'sgi', area: 'HQS', name: 'SGI Management', tagline: 'Procedure, moduli, informative, preparazioni agli esami', icon: 'sgi', kind: 'PUBLIC', legacy_url: 'https://sgi.toscanadiagnostica.it', sort_order: 10,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Gestione documenti')] },
  { key: 'service', area: 'HQS', name: 'Portale Service', tagline: 'Certificazioni, VEQ, documenti per i laboratori clienti', icon: 'service', kind: 'PUBLIC', legacy_url: 'https://service.toscanadiagnostica.it', sort_order: 20,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Gestione contenuti')] },

  // ---- People
  { key: 'contracts', area: 'PEOPLE', name: 'Contratti del Personale', tagline: 'Dipendenti e liberi professionisti, dossier, CCNL, scadenze', icon: 'contracts-hr', kind: 'LEGACY', legacy_url: 'https://contracts.toscanadiagnostica.it', sort_order: 10, restricted: true,
    profiles: [P('ADMIN', 'Amministratore'), P('HR', 'Risorse umane'), P('VIEWER', 'Sola lettura')] },
  { key: 'rubrica', area: 'PEOPLE', name: 'Rubrica e Organigramma', tagline: 'Chi fa cosa nella rete, contatti, scrivi su Teams', icon: 'rubrica', kind: 'NATIVE', route: '/people', sort_order: 20,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Aggiornamento schede')] },

  // ---- Retail e Comunicazione
  { key: 'retail', area: 'RETAIL_FLOW', name: 'Retail Assistant', tagline: 'Clienti B2C e B2B, campagne, promozioni, esposizione in sede', icon: 'retail', kind: 'LEGACY', legacy_url: 'https://retail.toscanadiagnostica.it', sort_order: 30, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('RETAIL', 'Retail'), P('SEDE', 'Sede', true), P('VIEWER', 'Sola lettura')] },
  { key: 'comunicazione', area: 'RETAIL_FLOW', name: 'Comunicazione', tagline: 'News, circolari, blog, avvisi, frase del giorno', icon: 'comunicazione', kind: 'NATIVE', route: '/community/manage', sort_order: 40,
    profiles: [P('EDITOR', 'Redazione'), P('PUBLISHER', 'Pubblicazione e circolari')] },

  { key: 'circolari', area: 'HQS', name: 'Circolari', tagline: 'Protocollo TD-AAAA/NNN, impaginazione su carta intestata, archivio e invio ai clienti', icon: 'doc', kind: 'LEGACY', legacy_url: null, sort_order: 40,
    profiles: [P('ADMIN', 'Amministratore'), P('PUBBLICATORE', 'Pubblicazione e invio'), P('REDATTORE', 'Redazione bozze'), P('VIEWER', 'Consultazione')] },
  // Ticket: aperto a tutti gli utenti autenticati (open_to_all: widget in home e accesso senza grant, ruolo implicito UTENTE)
  { key: 'ticket', area: 'HQS', name: 'Ticket', tagline: 'Richieste e segnalazioni ai responsabili: SLA, cronologia, statistiche', icon: 'ticket', kind: 'LEGACY', legacy_url: null, sort_order: 50, scope_type: null, open_to_all: true,
    profiles: [P('ADMIN', 'Amministratore'), P('RESPONSABILE', 'Responsabile di unità'), P('VIEWER', 'Consultazione')] },

  // ---- Amministrazione (nativo, visibile a Owner e Admin)
  { key: 'admin', area: 'DIREZIONE', name: 'Amministrazione', tagline: 'Utenti e profili, anagrafiche, importazioni, audit', icon: 'admin', kind: 'NATIVE', route: '/admin', sort_order: 20,
    profiles: [P('ADMIN', 'Amministratore')] },
];

// Mappatura ruoli delle tabelle users legacy → profilo del modulo in Suite (dove il nome non coincide)
export const LEGACY_ROLE_MAP = {
  finance: { SUPPORT: 'SUPPORT', CEO: 'CEO', CFO: 'CFO', VIEWER: 'VIEWER' },
  cash: { SUPERADMIN: 'SUPERADMIN', ADMIN: 'ADMIN', OPERATOR: 'OPERATOR', CASSIERE: 'CASSIERE', FINANCE: 'FINANCE', PARTNER: 'PARTNER' },
};

// Proposte di grant per area organizzativa (da Contracts): area → [modulo, profilo]
export const AREA_GRANT_PROPOSALS = {
  finance: [['finance', 'SUPPORT'], ['cash', 'FINANCE'], ['cockpit', 'VIEWER']],
  operations: [['orders', 'PROCUREMENT'], ['shipments', 'ADMIN'], ['cash', 'ADMIN'], ['room', 'PLANNER']],
  'flow & back office': [['orders', 'PROCUREMENT'], ['shipments', 'ADMIN']],
  'retail & communications': [['retail', 'RETAIL'], ['comunicazione', 'EDITOR'], ['circolari', 'PUBBLICATORE']],
  retail: [['retail', 'RETAIL'], ['comunicazione', 'EDITOR']],
  hsq: [['nc', 'QUALITA'], ['sgi', 'EDITOR'], ['service', 'EDITOR']],
  hqs: [['nc', 'QUALITA'], ['sgi', 'EDITOR'], ['service', 'EDITOR']],
  'direzione sanitaria': [['nc', 'QUALITA'], ['room', 'RESP_SAN']],
  legal: [['business', 'VIEWER']],
  'legal people and organization': [['business', 'VIEWER']],
  laboratorio: [['nc', 'LAB'], ['orders', 'LAB'], ['circolari', 'REDATTORE']],
};
