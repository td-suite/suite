// Catalogo dei moduli (widget) della Suite. I profili dei moduli legacy sono i ruoli delle app di oggi:
// il codice migrato continuerà a leggerli, cambia solo la sorgente (grant della Suite al posto della tabella users locale).
const P = (key, label, scoped = false) => ({ key, label, scoped });

export const MODULES = [
  // ---- Aree: DIREZIONE, FINANCE, RETAIL_FLOW, OPERATIONS, HQS, PEOPLE (ordine deciso da Francesco il 24/10/2026)
  // ---- (i commenti di area sotto sono storici: l'area effettiva è nel campo area)
  { key: 'business', area: 'RETAIL_FLOW', name: 'Business Hub', tagline: 'Pipeline, clienti, contratti', icon: 'business-hub', kind: 'LEGACY', legacy_url: 'https://business.toscanadiagnostica.it', sort_order: 10,
    profiles: [P('ADMIN', 'Amministratore'), P('SERVICE', 'Service'), P('RETAIL', 'Retail'), P('MDL', 'Medicina del Lavoro'), P('HQS', 'HQS'), P('VIEWER', 'Sola lettura')] },
  // Lab Control (v0.71.0, CEO 12/11/2026; già Label v0.69.0): controllo del laboratorio sulle accettazioni StudioLab (cruscotto, elenco con
  // le fasi fino al referto e alla chiusura, scheda con esami, campioni, Etichetta e Fattura, ritardi, tempi di refertazione) e, come
  // sezione, Label (etichette provette, stampa Zebra). Chiave tecnica `etichette` e route /etichette invariate (docs/LAB_CONTROL.md).
  // Nativo, per sede, solo con grant; ADMIN al titolare (migrazione 001 del modulo). Subito dopo il Business Hub. Profilo LABORATORIO
  // (v0.71.0): personale del laboratorio, tutte le accettazioni, senza Impostazioni.
  { key: 'etichette', area: 'RETAIL_FLOW', name: 'Lab Control', tagline: 'Accettazioni, avanzamento, etichette', icon: 'etichette', kind: 'NATIVE', legacy_url: null, route: '/etichette', sort_order: 15, scope_type: 'SITE', open_to_all: false,
    profiles: [P('ADMIN', 'Amministratore (impostazioni, modello, registro)'), P('LABORATORIO', 'Laboratorio (tutte le accettazioni, senza impostazioni)'), P('OPERATORE', 'Operatore di sede (accettazioni, anteprima e stampa della sede)', true)] },
  // Guida GIPO (v0.70.0, CEO 12/11/2026: "widget davvero fondamentale"): guida completa di GipoNext (anche PDF), FAQ, ricerca e domande con
  // risposta sui brani della guida; le domande senza risposta vanno alla redazione e la risposta diventa una FAQ (docs/GIPO_GUIDA.md).
  // Nativo, aperto a tutti gli INTERNI (open_to_all, ruolo implicito LETTORE); gli accessi esterni no (soloInterni). Subito dopo Lab Control.
  { key: 'gipoguida', area: 'RETAIL_FLOW', name: 'Guida GIPO', tagline: 'Guida, FAQ e risposte su GipoNext', icon: 'gipoguida', kind: 'NATIVE', legacy_url: null, route: '/gipoguida', sort_order: 16, scope_type: null, open_to_all: true,
    profiles: [P('ADMIN', 'Redazione (sezioni, FAQ, domande da risolvere, statistiche)'), P('LETTORE', 'Consultazione e domande')] },
  { key: 'finance', area: 'FINANCE', name: 'Finance Management', tagline: 'Firme, scadenze, conto economico', icon: 'finance-sign', kind: 'LEGACY', legacy_url: 'https://finance.toscanadiagnostica.it', sort_order: 10,
    profiles: [P('CEO', 'Amministratore Delegato'), P('CFO', 'CFO'), P('SUPPORT', 'Finance Support'), P('VIEWER', 'Sola lettura')] },
  { key: 'integration', area: 'DIREZIONE', name: 'Integration M&A', tagline: 'Post closing, GANTT', icon: 'integration-plan', kind: 'LEGACY', legacy_url: 'https://integration.toscanadiagnostica.it', sort_order: 30,
    profiles: [P('ADMIN', 'Amministratore'), P('EDITOR', 'Editor'), P('VIEWER', 'Sola lettura')] },
  { key: 'cockpit', area: 'DIREZIONE', name: 'Cockpit direzionale', tagline: 'Indicatori e scadenzario', icon: 'cockpit', kind: 'NATIVE', route: '/cockpit', sort_order: 10,
    profiles: [P('DIREZIONE', 'Direzione'), P('VIEWER', 'Sola lettura')] },

  // ---- Operations
  { key: 'cash', area: 'FINANCE', name: 'Cash Management', tagline: 'Rendiconti, contante, royalty', icon: 'cash', kind: 'LEGACY', legacy_url: 'https://cash.toscanadiagnostica.it', sort_order: 20, scope_type: 'SITE',
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('ADMIN', 'Amministratore di sede'), P('CASSIERE', 'Cassiere', true), P('FINANCE', 'Finance Specialist'), P('OPERATOR', 'Operatore di sede', true), P('PARTNER', 'Partner', true)] },
  { key: 'orders', area: 'OPERATIONS', name: 'Ordini e Magazzino', tagline: 'Materiale, giacenze, produzione', icon: 'orders', kind: 'LEGACY', legacy_url: 'https://orders.toscanadiagnostica.it', sort_order: 10, scope_type: 'SITE',
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('PROCUREMENT', 'Area Operations'), P('CLIENTE', 'Cliente Service', true), P('SEDE', 'Sede del network', true), P('LAB', 'Laboratorio')] },
  { key: 'shipments', area: 'OPERATIONS', name: 'Spedizioni e Kit', tagline: 'Kit, tracking, rendiconti', icon: 'shipments', kind: 'LEGACY', legacy_url: 'https://shipments.toscanadiagnostica.it', sort_order: 20,
    profiles: [P('SUPERADMIN', 'Super amministratore'), P('ADMIN', 'Amministratore'), P('ENDEAVOR', 'Endeavor'), P('VIEWER', 'Sola lettura')] },
  { key: 'room', area: 'RETAIL_FLOW', name: 'Room Planning', tagline: 'Ambulatori, medici, turni', icon: 'room', kind: 'LEGACY', legacy_url: 'https://planning.toscanadiagnostica.it', sort_order: 20, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('PLANNER', 'Planner', true), P('RESP_SAN', 'Responsabile sanitario', true), P('PROF', 'Professionista'), P('VIEWER', 'Sola lettura')] },

  // ---- HQS
  { key: 'nc', area: 'HQS', name: 'Non conformità', tagline: 'NC preanalitiche, dialogo sedi', icon: 'nc', kind: 'LEGACY', legacy_url: 'https://nc.toscanadiagnostica.it', sort_order: 30, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('QUALITA', 'Qualità'), P('LAB', 'Laboratorio'), P('SEDE', 'Sede o cliente', true), P('VIEWER', 'Sola lettura')] },
  // SGI Management (01/11/2026): da vetrina esterna a modulo nativo, copia conforme del sito pubblico sgi.toscanadiagnostica.it (specchio
  // di sola lettura, docs/SGI_PORTALE.md), come il Portale Service. Aperto a tutti gli autenticati (SGI pubblico per decisione AD
  // 01/10/2026): LETTORE implicito; EDITOR = origine e credenziali, aggiornamento, ZIP del repo e cache. La migrazione core 038 porta la
  // riga di produzione a NATIVE con legacy_url NULL (il seme non azzera legacy_url).
  { key: 'sgi', area: 'HQS', name: 'SGI Management', tagline: 'Procedure, moduli, informative', icon: 'sgi', kind: 'NATIVE', legacy_url: null, route: '/sgi', sort_order: 10, open_to_all: true,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Gestione documenti')] },
  // Portale Service (01/11/2026): da vetrina esterna a modulo nativo, copia conforme del sito pubblico service.toscanadiagnostica.it
  // (specchio di sola lettura, docs/SERVICE_PORTALE.md). Aperto a tutti gli autenticati, clienti service compresi (sito pubblico per
  // decisione AD 13/10/2026): LETTORE implicito; EDITOR = origine, aggiornamento, ZIP del repo e cache. La migrazione core 037 porta la
  // riga di produzione a NATIVE con legacy_url NULL (il seme non azzera legacy_url).
  { key: 'service', area: 'HQS', name: 'Portale Service', tagline: 'Documenti per i laboratori clienti', icon: 'service', kind: 'NATIVE', legacy_url: null, route: '/service', sort_order: 20, open_to_all: true,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Gestione contenuti')] },

  // ---- People
  { key: 'contracts', area: 'PEOPLE', name: 'Contratti del Personale', tagline: 'Dipendenti, LP, dossier, CCNL', icon: 'contracts-hr', kind: 'LEGACY', legacy_url: 'https://contracts.toscanadiagnostica.it', sort_order: 10, restricted: true,
    profiles: [P('ADMIN', 'Amministratore'), P('HR', 'Risorse umane'), P('VIEWER', 'Sola lettura')] },
  { key: 'rubrica', area: 'PEOPLE', name: 'Rubrica e Organigramma', tagline: 'Chi fa cosa, contatti, Teams', icon: 'rubrica', kind: 'NATIVE', route: '/people', sort_order: 20,
    profiles: [P('LETTORE', 'Consultazione'), P('EDITOR', 'Aggiornamento schede')] },
  // Rimborso Spese (v0.72.0, CEO 13/11/2026): nota spese mensile e rimborso chilometrico (moduli SGI MOD025 e MOD029), approvazione secondo
  // l'organigramma, liquidazione di P&C (docs/RIMBORSI.md). Nativo, SOLO ai dipendenti (regola SOLO_DIPENDENTI di routes/core.js: né
  // esterni, né liberi professionisti, né amministratori della Suite che non siano dipendenti). Nessun grant: ruoli calcolati; l'unico
  // profilo serve al catalogo.
  { key: 'rimborsi', area: 'PEOPLE', name: 'Rimborso Spese', tagline: 'Nota spese e rimborso chilometrico', icon: 'rimborsi', kind: 'NATIVE', legacy_url: null, route: '/rimborsi', sort_order: 35, scope_type: null, open_to_all: true,
    profiles: [P('DIPENDENTE', 'Dipendente (responsabile, P&C e titolare si calcolano da organigramma e Contratti del personale: nessun grant da assegnare)')] },
  { key: 'ferie', area: 'PEOPLE', name: 'Piano Ferie', tagline: 'Piano annuale per area', icon: 'ferie', kind: 'LEGACY', legacy_url: null, sort_order: 30, scope_type: null, open_to_all: true, profiles: [P('ADMIN', 'Amministratore (tutte le aree)'), P('RESPONSABILE', 'Responsabile di area (vede in sola lettura le aree del suo ambito; approva solo il superiore diretto)'), P('DIPENDENTE', 'Utente (compila il proprio piano)')] },

  // ---- Retail e Comunicazione
  { key: 'retail', area: 'RETAIL_FLOW', name: 'Retail Assistant', tagline: 'Clienti, campagne, esposizione', icon: 'retail', kind: 'LEGACY', legacy_url: 'https://retail.toscanadiagnostica.it', sort_order: 30, scope_type: 'SITE',
    profiles: [P('ADMIN', 'Amministratore'), P('RETAIL', 'Retail'), P('SEDE', 'Sede', true), P('VIEWER', 'Sola lettura')] },
  { key: 'comunicazione', area: 'RETAIL_FLOW', name: 'Comunicazione', tagline: 'News, circolari, blog, avvisi', icon: 'comunicazione', kind: 'NATIVE', route: '/community/manage', sort_order: 40,
    profiles: [P('EDITOR', 'Redazione'), P('PUBLISHER', 'Pubblicazione e circolari')] },

  { key: 'circolari', area: 'HQS', name: 'Circolari', tagline: 'Protocollo, impaginazione, invio', icon: 'doc', kind: 'LEGACY', legacy_url: null, sort_order: 40, open_to_all: true,
    // Aperto a tutti gli account (richiesta del CEO, 27/10/2026): chi ha un account vede le circolari pubblicate del proprio perimetro
    // (dipendenti: tutte; clienti service, punti prelievo, partner: quelle del loro segmento e delle liste di distribuzione in cui compaiono)
    profiles: [P('ADMIN', 'Amministratore'), P('PUBBLICATORE', 'Pubblicazione e invio'), P('REDATTORE', 'Redazione bozze'), P('VIEWER', 'Consultazione')] },
  // Ticket: aperto a tutti gli utenti autenticati (open_to_all: widget in home e accesso senza grant, ruolo implicito UTENTE)
  { key: 'ticket', area: 'HQS', name: 'Ticket', tagline: 'Richieste ai responsabili, SLA', icon: 'ticket', kind: 'LEGACY', legacy_url: null, sort_order: 50, scope_type: null, open_to_all: true,
    // UTENTE (05/11/2026, debug pre-produzione A3): solo inserimento, apre ticket e vede i propri; è il profilo del Default dei dipendenti
    profiles: [P('ADMIN', 'Amministratore'), P('RESPONSABILE', 'Responsabile di unità'), P('VIEWER', 'Consultazione'), P('UTENTE', 'Inserimento (apre ticket e vede i propri)')] },
  // Cartella condivisa: documenti per chi ha il grant (open_to_all FALSE, richiesta del CEO: il widget lo vede solo chi è abilitato).
  // Il profilo Default dei dipendenti dà la sola Consultazione (VIEWER); la Gestione (ADMIN) a Retail & Communications e HSQ (A3)
  { key: 'cartella', area: 'RETAIL_FLOW', name: 'Cartella condivisa', tagline: 'Documenti condivisi, novità', icon: 'folder', kind: 'LEGACY', legacy_url: null, sort_order: 50, scope_type: null, open_to_all: false,
    profiles: [P('ADMIN', 'Gestione'), P('VIEWER', 'Consultazione')] },
  // Referti esterni (28/10/2026): referti dei laboratori esterni trascritti sul format TD. Solo personale di laboratorio: lo vede
  // soltanto chi ha il grant (open_to_all FALSE). LAB elabora e conferma; QUALITA registro e impostazioni; VIEWER consultazione.
  { key: 'referti', area: 'OPERATIONS', name: 'Referti esterni', tagline: 'Referti esterni su format TD', icon: 'referti', kind: 'LEGACY', legacy_url: null, sort_order: 60, scope_type: null, open_to_all: false,
    profiles: [P('LAB', 'Laboratorio'), P('QUALITA', 'Qualità'), P('VIEWER', 'Consultazione')] },
  // Audit SGI (29/10/2026): auto-audit mensili delle sedi (Site Manager, con verifica di Qualità/Retail/AD), audit interni, audit di
  // terze parti, audit ISO 37001 sui partner, sintesi con Claude. Solo con grant (open_to_all FALSE); "AD" = Owner della Suite.
  { key: 'audit', area: 'HQS', name: 'Audit SGI', tagline: 'Auto-audit, audit interni e partner', icon: 'audit', kind: 'LEGACY', legacy_url: null, sort_order: 15, scope_type: 'SITE', open_to_all: false,
    profiles: [P('ADMIN', 'Amministratore'), P('QUALITA', 'Qualità'), P('AUDITOR', 'Auditor (Retail, Service, MDL)'), P('SITE', 'Site manager', true), P('VIEWER', 'Consultazione')] },

  // Facility e Manutenzioni (31/10/2026): immobili e contratti di affitto (canone da Finance Management), utenze ed energia (bollette in Finance Management),
  // dispositivi dal Catalogo di Amministrazione con piano delle manutenzioni, interventi e segnalazioni guasti, scadenze normative.
  // Solo con grant (open_to_all FALSE). FACILITY = Operations; MANUTENTORE anche fornitore esterno; SITE = site manager (ambito sede).
  { key: 'facility', area: 'OPERATIONS', name: 'Facility e Manutenzioni', tagline: 'Immobili, utenze, manutenzioni', icon: 'facility', kind: 'LEGACY', legacy_url: null, sort_order: 70, scope_type: 'SITE', open_to_all: false,
    profiles: [P('ADMIN', 'Amministratore'), P('FACILITY', 'Facility (gestione completa)'), P('MANUTENTORE', 'Manutentore'), P('SITE', 'Site manager', true), P('VIEWER', 'Consultazione (Qualità, HSQ)')] },

  // ---- Amministrazione (nativo, visibile a Owner e Admin)
  { key: 'admin', area: 'DIREZIONE', name: 'Amministrazione', tagline: 'Utenti, anagrafiche, audit', icon: 'admin', kind: 'NATIVE', route: '/admin', sort_order: 20,
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
