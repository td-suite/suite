# Impostazioni senza doppia compilazione

Richiesta del CEO (27/10/2026): i moduli non chiedono di nuovo dati già presenti nell'anagrafica unica (`public.sites`,
`public.organizations`, `public.people`) o nelle impostazioni generali della Suite (`public.app_settings`). Regola: un campo è
del modulo solo se è specifico del modulo; se è un dato generale della sede, della Legal entity, della persona o dell'azienda
si legge dal core e si modifica solo lì (pulsante o link "Apri in Amministrazione"). Le viste `<key>.sites_v`, `sedi_v`,
`strutture_v`, `orgs_v`, `companies_v`, `resources_v`, `professionisti_v` conservano i nomi di colonna che il codice dei moduli
si aspetta, ma le colonne duplicate sono calcolate dal core.

**Room · `professionisti_v` (migrazione room 013, v0.68.1)**: una persona di tipo ESTERNO è `professionista` (e, se attiva e non esclusa,
`pianificabile`) quando ha un ruolo del catalogo (`role_id`, qualunque, anche Accettazione), una disciplina, una sede di lavoro (`site_id`),
una scheda Room (`person_ext.tipo`) o un ruolo sanitario; restano fuori solo gli esterni senza niente di tutto questo (referenti dei
clienti e fornitori). Il personale delle sedi si aggancia alla persona **prima per `person_id`** della riga (scelta dall'anagrafica,
v0.67.3) e poi per chiave del nome: `lib/network.js` `buildNetwork`/`reteDi` (Specialisti e Professionisti: "nelle sedi" e il quadratino
dell'invio; senza, il segnaposto con il tooltip "nessun piano da inviare: non è nel personale di una sede"), lato server
`room/lib/personale.js` `stessaPersona`/`indicePersone` (scheda, sedi della persona, "Collega i sanitari delle sedi", generazione dei
turni, presenze, allineamento del profilo in `strutture.js`). Diagnostica **D52** "Personale di sede non agganciato all'anagrafica"
(righe senza `person_id` e senza omonimo, link alla sede).

## Core: cosa è stato aggiunto (migrazione 026_sites_opened_at.sql)
- `sites.opened_at` (data di apertura della sede): campo "Data di apertura" nel form Sedi di Amministrazione e colonna
  `opened_at` nel modello XLSX Sedi. Era copiato in Cash (`start_date`) e Retail (`opened_at`).
- `organizations.iban`, `bic`, `bank_name`: campi IBAN, BIC, Banca nel form Legal entity e colonne nel modello XLSX Legal
  entity. Erano copiati in Business (`iban`, `bank_name`) e Cash (`iban`, `bic`).
- `app_settings.company`: dati aziendali (name, legal_name, vat, tax_code, rea, share_capital, address, zip, city, province,
  phone, fax, email, pec, website, health_director, footer) seminati con i valori finora cablati nel codice. Editor dedicato
  "Dati aziendali" in Amministrazione > Impostazioni; `GET /api/company` per i moduli web; `getCompany()` in
  `server/src/lib/company.js` (con `address_full`, `footer_text` composto dai campi se `footer` è vuoto, `splitTitle` per
  "prof. Gian Luigi Taddei"). I moduli che stampano carte intestate, piè di pagina, firme o intestazioni la usano: business
  (rules.js: `company_*`, `ds_name`, `ds_title`), finance (`company_name`), shipments (pdf/common.js `COMPANY` aggiornato da
  `newDoc`), circolari (render.js: intestazione, piè di pagina, firma, contatti; ai.js), contracts (payroll.getSettings
  `company_*`, `health_director`; orgChart.js), orgchartExport.js (XLSX, PPTX, PDF), ticket (export PDF), retail (PPTX),
  orders (`companyInfo`). Le costanti restano solo come ripiego se la chiave manca.

## Audit dei moduli
Legenda: DUPLICATO = rimosso dal modulo e letto dal core; SPECIFICO = resta nel modulo; CABLATO = costante nel codice sostituita
da `getCompany()`.

| Modulo | Tabella / pagina | Campo | Decisione | Dettaglio |
| --- | --- | --- | --- | --- |
| cash | site_ext | hours | DUPLICATO | `core_hours(sites.opening_hours_json)` nella vista (apertura = prima fascia, chiusura = ultima); il sollecito dopo la chiusura usa questi orari. Migrazione 013. |
| cash | site_ext | hours_note | DUPLICATO | `sites.opening_hours` (testo riassuntivo del core). |
| cash | site_ext | operating_days | DUPLICATO | `core_operating_days(sites.opening_hours_json)`; senza orari in anagrafica vale lunedì-sabato (predefinito storico), segnalato nella pagina. |
| cash | site_ext | site_email | DUPLICATO | `sites.email`. |
| cash | site_ext | start_date | DUPLICATO | `sites.opened_at` (valori esistenti riportati nel core se vuoti); se manca, la data di configurazione in Cash. |
| cash | site_ext | host_name, host_vat, host_email | DUPLICATO | `host_org_id -> public.organizations` (tendina delle Legal entity, dati dal core); la migrazione aggancia per P.IVA o nome e crea come PARTNER (needs_review) i partner mancanti, così nessun valore va perso. |
| cash | site_ext | company_id, cash_float, pos_terminals, ownership, expected_registers, royalty_* | SPECIFICO | Parametri di cassa e royalty. |
| cash | org_ext | iban, bic | DUPLICATO | `organizations.iban/bic` (riportati nel core se vuoti). |
| cash | org_ext | letterhead_footer, logo, sepa_mandate_*, is_franchisor | SPECIFICO | Carta intestata della distinta e mandato SEPA. |
| cash | company_bank_accounts | elenco conti per gli accrediti | SPECIFICO | Più conti per azienda con etichetta e predefinito: diverso dall'IBAN unico della Legal entity. |
| cash | Impostazioni | creditor_name, creditor_iban, creditor_bic | SPECIFICO (forzatura) | Se vuoti valgono la capofila (`is_franchisor`, IBAN della Legal entity) e `company.legal_name`; `creditor_id` resta solo di Cash. |
| cash | user_ext | cash_float | SPECIFICO | Fondo cassa personale. |
| room | site_ext | data (ambulatori, planimetria) | SPECIFICO | Configurazione degli ambulatori. |
| room | person_ext.dati.anagrafica | luogoNascita, partitaIva, indirizzo, cap, citta, provincia | DUPLICATO | `people.birth_place, vat_number, address, zip, city, province` (migrazione 007, valori riportati nel core se vuoti); scheda in sola lettura, portale senza auto-modifica della residenza. |
| room | person_ext.dati.anagrafica | pec, iban, intestatarioConto, contattoEmergenza | SPECIFICO | Dati per i rendiconti del professionista (il core non ha IBAN né PEC personali). |
| room | person_ext | tipo, profilo, disponibilità, compenso, contratto, assicurazione, documenti, planning_excluded | SPECIFICO | Scheda Room. |
| nc | site_ext | codice_lis | DUPLICATO | `sites.studiolab_code` (valori riportati nel core se vuoti; migrazione 005). È lo stesso codice cliente StudioLAB. |
| nc | org_ext | codice_lis | SPECIFICO | Il core non prevede un codice StudioLAB sulle Legal entity (i codici sono dei punti): serve quando il LIS usa un codice proprio del cliente. |
| nc | site_ext, org_ext | pec | DUPLICATO | `organizations.pec` (per una sede TD la PEC della sua Legal entity). |
| nc | site_ext, org_ext | email_nc | SPECIFICO | Casella NC dedicata; etichetta "se vuota si usa l'email della sede / Legal entity in Amministrazione" e fallback in `email_effettiva` della vista (usata dall'invio). |
| nc | site_ext, org_ext | canale, email_cc, sla_ore, attiva, note, lis_json | SPECIFICO | Parametri NC. |
| orders | site_ext, org_ext | referente, referente_phone | DUPLICATO | Sede TD: responsabile del nodo Sede dell'organigramma con telefono della persona (cellulare, poi ufficio) o della sede; Legal entity: telefono ed email di `organizations`. Migrazione 006; la vista espone anche `referente_person_id`, `referente_role`. |
| orders | site_ext, org_ext | kind, silva_code (destinazione Silva: codice numerico della GET destinazioni, v0.68.2), stock_deadline_day, delivery_mode, delivery_notes, notes | SPECIFICO | Flusso ordini e consegne. |
| orders | company | name, vat_number, address... | DUPLICATO | `companyInfo()` legge `getCompany()`; della tabella restano logo e piè di pagina personalizzato. |
| retail | site_ext | studiolab_code | DUPLICATO | `sites.studiolab_code` (migrazione 008, valori riportati nel core). |
| retail | site_ext | saturday_open | DUPLICATO | Derivato da `sites.opening_hours_json` (sabato con una fascia); senza orari vale aperto. |
| retail | site_ext | opened_at | DUPLICATO | `sites.opened_at`. |
| retail | site_ext | description | SPECIFICO (rinominato) | `commercial_description`, etichetta "Descrizione commerciale" (book retail e scheda sede). |
| retail | site_ext | in_network, tuotempo_area_id, gipo_site_code, catchment_cities, sqm_waiting, surface_sqm, rooms, boxes, parking, accessibility, services, notes | SPECIFICO | Scheda struttura e connettori. |
| retail | site_hours | closed, open1, close1, open2, close2 | DUPLICATO | Fasce da `sites.opening_hours_json` (le fasce esistenti completano il core se vuoto); resta solo `note` operativa per giorno. |
| retail | person_ext | retail_role, weekly_hours, days, notes, sort_order | SPECIFICO | Piano di lavoro Retail. |
| business | org_ext | iban, bank_name | DUPLICATO | `organizations.iban/bank_name/bic` (migrazione 006, valori riportati nel core). |
| business | org_ext | legal_rep, signer, signer_role, contatti commerciali/service/procurement, condizioni di pagamento, portale, note | SPECIFICO | Dati del contratto. |
| business | Impostazioni | company_name, company_legal_address, company_city, company_prov, company_vat, company_tax_code, company_capital, company_phone, company_fax, company_pec, ds_name, ds_title | CABLATO -> core | Sovrascritti da `getCompany()` in `getSettings()`, in sola lettura nella pagina, ignorati dal PUT. |
| business | Impostazioni | lab_address, lr_*, ds_* (altri), rspp, rls, mc, protocolli, testi | SPECIFICO | Legale rappresentante, titoli del DS, sicurezza, contratti. |
| business | Impostazioni (Business Hub) | hub_stallo_giorni, hub_ordini_giorni, hub_casella_*, hub_lettura_*, hub_cc_* | SPECIFICO | Soglie del CRM e caselle di linea (06/11/2026, docs/BUSINESS_HUB.md). |
| business | Impostazioni (Business Hub) | hub_pp_dest_*, hub_pp_dotazione_elenco | SPECIFICO | Processo Punti Prelievo: destinatari interni dell'avvio del punto prelievi ed elenco della dotazione (06/11/2026). |
| business | Impostazioni (Firmatario dei contratti) | firma_nome, firma_qualifica, tabella firma_td | SPECIFICO | Firmatario di TD nei blocchi firme di MOD230 e MOD231 (vuoti = lr_name, lr_role) e immagine della firma apposta nel PDF (07/11/2026). |
| cash | Impostazioni | default_cash_float | SPECIFICO | Fondo cassa predefinito di una sede nuova, letto dal Business Hub per l'email all'amministrazione quando la sede non è ancora configurata in Cash (06/11/2026). |
| business | accounts | anagrafica commerciale del DB Opportunità (tipologia, segmento, fornitore, priorità, fasi, valori) | SPECIFICO | Ragione sociale, indirizzo, email, PEC e telefono restano della Legal entity (`public.organizations`). |
| finance | Impostazioni | company_name | CABLATO -> core | `legal_name`; in sola lettura. |
| finance | Impostazioni | soglie, titoli, testi, mail_cc, prefisso | SPECIFICO | Poteri di firma. |
| finance | Impostazioni (Scadenziario strutture, 28/10/2026) | schedule_alert_days (7), schedule_istat_pct (1.5), schedule_utility_growth_pct (0), schedule_notify_roles (CEO,CFO,SUPPORT) | SPECIFICO | Anticipo degli avvisi in app, ipotesi di rivalutazione ISTAT e di crescita delle utenze per la previsione, profili Finance Management che ricevono gli avvisi. Sedi e Legal entity (locatori, fornitori, IBAN) vengono dall'anagrafica unica; i beneficiari dall'anagrafica Finance Management: nessun dato ridigitato. Migrazione finance 002. |
| finance | Impostazioni (Controllo di gestione, 08/11/2026) | pl_coefficiente_oneri (1.28), pl_sedi_centrali (vuoto = sedi direzionali), pl_chiave_ripartizione (RICAVI), pl_iva_costi (COSTO), srv_costo_ritiro e srv_costo_medio_esame (vuoti = da indicare), tabella finance.costi_esami (XLSX) | SPECIFICO | Ipotesi del conto economico di sede e del margine per cliente Service, dichiarate nella nota "Come è calcolato" (docs/FINANCE.md). Sedi, persone, RAL, listini e volumi attesi vengono dai moduli e dall'anagrafica: nessun dato ridigitato. Migrazione finance 006. |
| shipments | pdf/common.js | COMPANY (name, footer, website) | CABLATO -> core | `refreshCompany()` in `newDoc`; l'email resta la casella del modulo (SHIPMENTS_GRAPH_INBOX) con ripiego su `company.email`. |
| circolari | config.footer, config.contacts, render.js, ai.js | ragione sociale, piè di pagina, contatti | CABLATO -> core | `renderDocx` carica `getCompany()`; config resta ripiego. |
| contracts | person_ext | birth_place, vat_number, address, zip, city, province | DUPLICATO | `people.*` (migrazione 017, valori riportati nel core); nel form Nuova persona sono "Dati personali (anagrafica unica)" e si scrivono in `public.people` tramite `lib/people.js`. |
| contracts | person_ext | mobile_company, iban, badge_number, nationality, emergency_contact, area_id, approver_id, cv, termination_*, interview_notes, notes | SPECIFICO | Dossier HR. |
| contracts | Nuova persona | nomi, sesso, titolo, data di nascita, CF, email, telefoni, interno, sede, responsabile, stato | già core | Scritti in `public.people` (`PEOPLE_COLS`); l'area è `areas` del modulo (legacy interna). |
| contracts | work_sites | tabella sedi | già sparita | Migrazione 016 (`work_site_id -> public.sites`); `WORK_SITES` in seedData.js non è più usato. |
| contracts | Impostazioni | company_name, company_legal_address, company_vat, company_rea, company_capital, company_phone, company_email, company_pec, company_website, health_director | CABLATO -> core | Sovrascritti da `getCompany()`; in sola lettura; PUT li ignora. `company_address` (sede di lavoro predefinita) resta del modulo, con ripiego sulla sede legale. |
| contracts | orgChart.js | intestazione e piè di pagina PPTX | CABLATO -> core | `getCompany()`. |
| integration | org_ext | position, status, ref, fatt, pfn, ev, linee, loi, prelim, closing, hor, note | SPECIFICO | Piano di integrazione (ref = referente M&A testuale). |
| integration | person_ext | position, r, f, color | SPECIFICO | Ruolo nel piano. |
| integration | web lib/ipm-engine.js | docFooter "Toscana Diagnostica S.r.l." | residuo (lato client) | Piè di pagina dei documenti generati nel browser; punto dubbio: da leggere da `GET /api/company`. |
| ticket | export.js | Author dei PDF | CABLATO -> core | `getCompany()`. |
| ferie | Impostazioni (Piano Ferie, 08/11/2026) | ferie.impostazioni (includi_dirigenti, soglia_mese_giorni 15, scadenza_ap 06-30, mesi_rischio [10,11], soglia_rischio_giorni 10, promemoria_giorni 3, email_attiva false, festa_4_ottobre, festivi aggiunti/esclusi, rol_attivi, avviso_dipendenti), ferie.spettanze (giorni annui per CCNL/livello, 26 come ipotesi), coperture, chiusure, aree_forzate, patroni, deleghe | SPECIFICO | Perimetro, area, approvatore, contratto e settimana lavorativa vengono da public.people, organigramma e contracts.employments/person_ext (approver_id): nessun dato ridigitato. Migrazione ferie 001 (docs/FERIE.md). |
| cartella | nessuna estensione | | | FK verso `public.users`. |
| core | lib/orgchartExport.js | "Toscana Diagnostica S.r.l." in XLSX, PPTX, PDF | CABLATO -> core | `getCompany()`. |
| core | routes/ingest.js | PERSONAL_SQL eseguito anche per sedi, organizzazioni e news | bug corretto | Scriveva residenza e dati personali sulla persona con lo stesso id della sede/organizzazione/news. |

## Migrazioni
- core `026_sites_opened_at.sql`; cash `013_impostazioni_core.sql`; retail `008_impostazioni_core.sql`; nc `005_impostazioni_core.sql`;
  orders `006_impostazioni_core.sql`; business `006_impostazioni_core.sql`; contracts `017_impostazioni_core.sql`; room `007_impostazioni_core.sql`.
  Tutte riportano prima i valori esistenti nel core (solo dove lì manca) e poi eliminano le colonne; le viste vengono ricreate.

## Punti dubbi
- Cash senza orari in anagrafica assume lunedì-sabato come giorni operativi (il predefinito storico `1111110`): compilare gli
  orari in Amministrazione > Sedi per ogni sede Cash.
- Cash `start_date` mancante nel core: vale la data di configurazione in Cash finché la Data di apertura non viene compilata.
- Contracts aveva come sede legale predefinita "Viale Belfiore, 55, Firenze" mentre i dati aziendali dicono Sesto Fiorentino:
  ora prevale il core; se la sede legale è davvero Firenze va corretta in Dati aziendali.
- Room: il professionista dal portale non modifica più da solo la residenza (è nell'anagrafica unica, scritta solo da
  Amministrazione > Persone o Contratti del personale).
- Business `lab_reference` ha ancora come valore iniziale l'indirizzo del laboratorio nel form (campo del contratto).

## Audit SGI (29/10/2026)
Variabili d'ambiente (tutte facoltative): `AUDIT_AI_MOCK=1` sintesi simulata senza chiave Anthropic, costruita dai punteggi reali con
testi standard, attiva solo con `NODE_ENV` diverso da production (per il collaudo; con la chiave configurata non ha effetto);
`AUDIT_MAX_FILE_MB` (25) e `AUDIT_MAX_FILES` (10) limiti dei PDF di terze parti e delle evidenze; `AUDIT_TERZI_TEXT_MAX` (60000) caratteri
di testo estratto conservati per PDF; `AUDIT_JOB_MINUTES` (60) intervallo del job `audit:alert17`. Impostazioni in app (`audit.app_settings`,
Audit SGI > Impostazioni, profili QUALITA/ADMIN): `alert_day` (17), `reminder_every_days` (5). Sedi, Legal entity, persone e site manager
vengono dall'anagrafica unica (nessuna doppia compilazione); i modelli di checklist sono del modulo (nuove revisioni in JSON).

## Shipments: casella in arrivo (30/10/2026)
La casella letta per le richieste Endeavor è shipments@toscanadiagnostica.it per impostazione predefinita; si cambia in Shipments > Impostazioni > Email (`inbox_address`), salvo la variabile SHIPMENTS_GRAPH_INBOX su Render che ha la precedenza. La lettura parte solo con le credenziali Microsoft Graph della Suite (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET o le GRAPH_*) e richiede sull'app registration il permesso applicativo Mail.Read con consenso amministratore (se esiste una Application Access Policy, deve includere la casella). "Prova la casella" legge un messaggio e dice esattamente cosa manca (credenziali, casella inesistente, permesso).

## Shipments: richieste da PDF o email (30/10/2026)
- La lettura assistita delle richieste Lifestyle usa la chiave Anthropic della Suite (Amministrazione > Impostazioni o
  ANTHROPIC_API_KEY): senza chiave il caricamento Lifestyle risponde 400 "Intelligenza artificiale non configurata"; il caricamento
  Endeavor (riconoscitore delle email Affinity) non ne ha bisogno. Ogni lettura è in ai_log con kind `shipments_lifestyle_request`.
- `SHIPMENTS_AI_MOCK=1`: solo per collaudo e sviluppo, ignorata con NODE_ENV=production; sostituisce il modello con un estrattore a
  espressioni regolari. Non impostarla su Render.
- Limiti di caricamento: fino a 10 file per volta, 20 MB ciascuno (413 oltre), PDF/.eml/.txt; .msg non supportato (salvare come .eml
  o PDF); testo letto fino a 40.000 caratteri. OCR dei PDF scansionati con le impostazioni condivise di lib/pdftext.js
  (PDF_OCR_LANG, PDF_OCR_SOGLIA, PDFTOTEXT_BIN, TESSERACT_BIN). Archivio dei file: blob della Suite se configurato, altrimenti database.

## Facility e Manutenzioni (31/10/2026)
Variabili d'ambiente (facoltative): `FACILITY_AI_MOCK=1` analisi dei consumi simulata senza chiave Anthropic, attiva solo con `NODE_ENV`
diverso da production (collaudo; non impostarla su Render); `FACILITY_MAX_FILE_MB` (25) e `FACILITY_MAX_FILES` (10) limiti di documenti,
planimetrie, rapportini e foto delle segnalazioni (413 oltre); `FACILITY_JOB_MINUTES` (1440) intervallo del job `facility:scadenze`. La
planimetria pubblicata in Room Planning ha un limite di 20 MB (Room avvisa già oltre 3,8 MB). Impostazioni in app (`facility.app_settings`,
Facility e Manutenzioni > Impostazioni, profili FACILITY/ADMIN): `sla_hours` (URGENTE 24, ALTA 72, MEDIA 240, BASSA 720), `co2_factors` e
`kwh_factors` per vettore (indicativi), `reminder_days` (30, 7, 0), `anomaly_pct` (20), `activity_source` (AUTO, RETAIL, CASH, MANUALE),
`notify_site_managers`. Nessun dato chiesto due volte: sedi, Legal entity ospitante, persone e site manager dall'anagrafica; contratti di
affitto, utenze e bollette da Finance Management; il Catalogo dispositivi è in Amministrazione. Dati del modulo: superficie, catasto, APE, ore di
apertura (proprietà dell'immobile, non dell'anagrafica sede), estensione energetica delle utenze, letture, attività manuale, obiettivi.


## Contracts: casella People (31/10/2026)
Variabili d'ambiente (facoltative): `CONTRACTS_PEOPLE_MAILBOX` casella dei richiami e dei documenti in arrivo (predefinita
people@toscanadiagnostica.it; se impostata prevale sull'impostazione del modulo, che in Impostazioni diventa in sola lettura);
`CONTRACTS_AI_MOCK=1` lettura simulata dei documenti in arrivo (categoria, scadenza, intestatario per parole chiave), attiva solo con
`NODE_ENV` diverso da production: per collaudo e sviluppo, non impostarla su Render. Impostazioni in app (`contracts.app_settings`,
Contracts > Impostazioni, profili ADMIN e HR): `people_mailbox`, `people_send_enabled` (false all'installazione), `people_read_enabled`
(true), `people_reminder_days` (60,30,7,0), `people_hr_cc` (vuota = utenti con profilo HR sul modulo), `people_reminder_map` (JSON tipo →
PERSONA / HR / NESSUNO); stato interno `people_inbox_since`, `people_inbox_last`, `people_inbox_error`, `people_send_last`,
`people_send_error`. Richiede sull'app registration della Suite Mail.Read e Mail.Send (applicativi) sulla casella people@ e, con una
Application Access Policy, l'inclusione di people@. Migrazioni: contracts 019_people_inbox.sql, core 035_email_log_mittente.sql.

## Claude: modello e prova (31/10/2026)
In Amministrazione > Impostazioni > Claude, oltre alla chiave, si imposta il modello in uso (`anthropic_model` in public.app_settings, prevale su ANTHROPIC_MODEL; predefinito claude-sonnet-4-5) e "Prova la configurazione" elenca i modelli disponibili per la chiave e fa una richiesta minima. Gli errori del servizio arrivano agli utenti in chiaro (422 AI_ERROR: chiave non valida, modello non disponibile, credito esaurito, risposta troncata) invece di "Errore interno del server".

## Portale Service: specchio del sito pubblico (01/11/2026)
Il modulo `service` è la copia conforme di service.toscanadiagnostica.it (docs/SERVICE_PORTALE.md): nessun contenuto si compila nella
Suite, i dati arrivano dal sito. Variabili d'ambiente (facoltative): `SERVICE_PORTAL_URL` origine dello specchio (predefinita
https://service.toscanadiagnostica.it; se impostata prevale sull'origine salvata in Portale Service > Impostazioni, che diventa in sola
lettura); `SERVICE_VADEMECUM_URL` Vademecum online da incorporare (predefinito https://referti.toscanadiagnostica.it/vademecum; solo da
variabile perché la sua origine entra nella CSP della Suite all'avvio); `SERVICE_SPECCHIO_MINUTES` intervallo del job `service:specchio`
(360); `SERVICE_TIMEOUT_MS` (20000) e `SERVICE_FRAME_TIMEOUT_MS` (8000) timeout delle letture e della verifica dell'iframe;
`SERVICE_ZIP_MAX_MB` (200) limite dello ZIP del repository; `SERVICE_FILE_MAX_MB` (60) limite di un singolo PDF. Impostazioni in app
(`service.impostazioni`, profilo EDITOR e amministratori): `origine`. Stato interno in `service.stato` (build, REG006, fonte, ultima
lettura, ultimo cambiamento, ultimo errore). Migrazioni: service 001_init.sql, core 037_service_nativo.sql.

## SGI Management: specchio del sito pubblico (01/11/2026)
Il modulo `sgi` (widget HQS "SGI Management") è la copia conforme di sgi.toscanadiagnostica.it (docs/SGI_PORTALE.md), con la stessa
meccanica del Portale Service (`server/src/lib/specchioPortale.js`): nessun contenuto si compila nella Suite. Variabili d'ambiente
(facoltative): `SGI_PORTAL_URL` origine dello specchio (predefinita https://sgi.toscanadiagnostica.it; se impostata prevale sull'origine
salvata in SGI Management > Impostazioni, che diventa in sola lettura); `SGI_PORTAL_USER` e `SGI_PORTAL_PASSWORD` credenziali HTTP Basic
dell'origine, da impostare solo se sul sito è attiva `SGI_PASSWORD` (utente predefinito `sgi`, come il sito; se la password è impostata
qui prevalgono su quelle salvate in app, che diventano in sola lettura); `SGI_SPECCHIO_MINUTES` intervallo del job `sgi:specchio` (360);
`SGI_TIMEOUT_MS` (30000) timeout delle letture (fulltext.json pesa circa 6 MB); `SGI_ZIP_MAX_MB` (400) limite dello ZIP del repository
(circa 105 MB compresso); `SGI_FILE_MAX_MB` (60) limite di un singolo PDF. Impostazioni in app (`sgi.impostazioni`, profilo EDITOR e
amministratori): `origine`, `utente` e `password` dell'origine. La password è cifrata AES-256-GCM con `lib/secrets.js` (CREDENTIALS_KEY,
in sua assenza la chiave derivata da SESSION_SECRET, come le altre credenziali della Suite): l'API restituisce solo "impostata sì/no",
il registro attività solo l'operazione e l'utente, i messaggi d'errore solo l'URL e il codice HTTP. Stato interno in `sgi.stato`.
Migrazioni: sgi 001_init.sql, core 038_sgi_nativo.sql.

## Referti esterni: casella template@ (31/10/2026)
Variabili d'ambiente (facoltative): `REFERTI_MAILBOX` casella letta e mittente dei referti riprodotti (predefinita
template@toscanadiagnostica.it; se impostata prevale sull'impostazione del modulo, che in Impostazioni diventa in sola lettura);
`REFERTI_INBOX_MINUTES` intervallo della lettura (10). Impostazioni in app (`referti.app_settings`, Referti esterni > Impostazioni,
profili QUALITA e admin): `casella_indirizzo`, `casella_lettura` (true), `invio_mittente` (true: richiesta del CEO); stato interno
`casella_since`, `casella_ultima_lettura`, `casella_errore`. Richiede sull'app registration della Suite i permessi applicativi Microsoft
Graph **Mail.Read** e **Mail.Send** con consenso amministratore e, se c'è una Application Access Policy, l'inclusione di template@
(altrimenti "Prova la casella" / "Prova l'invio" rispondono 403 con il motivo). Con `MAIL_PROVIDER=log` gli invii restano nel registro
email (stato REGISTRATO). `POST /api/referti/inbox/simula` funziona solo con `NODE_ENV` diverso da production. Migrazione: referti
004_casella_invii_riapertura.sql.

## Referti esterni: lettura con Claude e "Chiedi una correzione" (03/11/2026)
Il PDF del laboratorio esterno lo legge Claude con la chiave e il modello della Suite (`ANTHROPIC_API_KEY`, Amministrazione >
Impostazioni > Claude: nessuna chiave propria del modulo); il DOCX lo scrive il porting del generatore del progetto sul template
predefinito "Format TD (BARONI VERA)" (`server/src/modules/referti/templates/formatTD_BARONI_VERA.docx`) o su quello caricato in
Referti esterni > Impostazioni. Variabili d'ambiente (facoltative): `REFERTI_AI_MAX_TOKENS` spazio di risposta di una lettura o di una
correzione (16000); `REFERTI_AI_TIMEOUT_MS` tempo massimo (180000). **`REFERTI_AI_MOCK=1`** (solo con `NODE_ENV` diverso da
production, ignorata in produzione: non impostarla su Render) simula lettura e correzione con i JSON attesi delle fixture
`server/test/fixtures/referti/lettura/*.json` (`REFERTI_AI_MOCK_DIR` per un'altra cartella): serve ai test e al collaudo senza chiave.
Senza chiave Anthropic e senza mock la lettura usa i parser di riserva (anomalia "parser di riserva" nella scheda) e "Chiedi una
correzione" risponde 400. Test di parità con i referti del progetto: `REFERTI_PACCHETTO` (cartella del pacchetto "Referti EXT su
format TD", predefinita /home/claude/referti-pacchetto) e `REFERTI_PDF_SORGENTI` (cartella dei PDF sorgente dei tre merge Nuova Igea);
se mancano, quei confronti vengono saltati. Migrazione: referti 005_lettura_claude_versioni.sql (schede.lettura,
antibiotici_sorgente, da_rielaborare; tabella scheda_versioni; bozze del motore precedente marcate da rielaborare).

## Informative: Privacy e uso dell'intelligenza artificiale (05/11/2026)
Chiavi in `public.app_settings` (migrazione core 039_consensi.sql), modificabili solo dal riquadro "Informative" di Amministrazione >
Impostazioni (Owner/Admin; nascoste dall'elenco JSON generico): `consensi.privacy_url` (predefinito
https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf), `consensi.privacy_versione` ('2026-11'), `consensi.ia_url`
('/informativa-ia', la pagina pubblica della Suite; si sostituisce con il link del sito quando il CEO pubblica il DOCX), `consensi.ia_versione`
('1.0'). Cambiare una versione = tutti riaccettano quel documento; la data mostrata accanto alla versione è quella dell'ultimo
salvataggio della chiave. Nessuna variabile d'ambiente e nessun mock: la presa d'atto non usa Claude. Il riquadro mostra quanti utenti
attivi hanno preso atto e quanti no ed esporta il CSV del registro. Il testo dell'informativa IA (`web/src/pages/informativaIATesto.js`)
va rivisto dal consulente privacy; il DOCX si rigenera con `node server/scripts/informativaIA-docx.mjs <uscita.docx>`. Dettagli in
docs/ANAGRAFICA.md, sezione Consensi.

## Impostazioni aggiunte dal debug pre-produzione (05/11/2026)
- `accounts.domini_automatici` (app_settings, elenco JSON di domini): l'account nasce da solo solo per le persone con email di questi
  domini (predefinito: `AUTO_INTERNAL_DOMAINS`). Si modifica con `PUT /api/settings/accounts.domini_automatici` (amministratori).
- Referti esterni > Impostazioni > Conservazione dei PDF sorgente: `retention_mesi` (predefinito 24, 0 = mai eliminati), al posto dei
  giorni; il job `referti:retention` elimina i PDF sorgente più vecchi, restano la scheda e i file prodotti.
- Retail > Impostazioni > Set dimostrativo: le righe del set sono marcate (`demo`, migrazione retail 009); "Rimuovi" toglie solo quelle.
  In produzione caricamento e rimozione li fa solo il titolare, scrivendo il testo di conferma.

## Business Hub: caselle di linea e soglie (06/11/2026)
Variabili d'ambiente (facoltative): `BUSINESS_MAILBOX_SRV` (predefinita service@toscanadiagnostica.it), `BUSINESS_MAILBOX_PP`
(network@toscanadiagnostica.it), `BUSINESS_MAILBOX_MDL` (mdl@toscanadiagnostica.it): casella letta e mittente delle email ai clienti della
linea; se impostate prevalgono sull'indirizzo salvato in Business Hub > Impostazioni, che diventa in sola lettura. `BUSINESS_INBOX_MINUTES`
intervallo del job `business:inbox` (10); `BUSINESS_AVVISI_MINUTES` intervallo del job `business:avvisi` (30). Impostazioni in app
(`business.app_settings`, Business Hub > Impostazioni, Admin del modulo): `hub_casella_SRV|PP|MDL`, `hub_lettura_SRV|PP|MDL` ('true'),
`hub_cc_SRV|PP|MDL` (copie fisse su ogni email inviata dal widget: SRV francesco.epifani@ e rosetta.greco@, PP francesco.epifani@ e
silvia.sansoni@, MDL francesco.epifani@ e angelica.corradi@, precisazione del CEO del 06/11/2026), `hub_stallo_giorni` (45),
`hub_ordini_giorni` (3); stato interno `hub_since_*`, `hub_ultima_lettura_*`, `hub_errore_*` (ignorato dal PUT). Richiede sull'app
registration della Suite **Mail.Read** e **Mail.Send** applicativi con consenso amministratore e, se c'è una Application Access Policy,
l'inclusione delle tre caselle. Con `MAIL_PROVIDER=log` gli invii restano nel registro email (esito REGISTRATO).
`POST /api/business/inbox/simula` funziona solo con `NODE_ENV` diverso da production. Migrazioni: business 008_business_hub.sql, core
041_business_hub.sql.

## Business Hub: processo Service (06/11/2026)
Impostazioni in app (`business.app_settings`, Business Hub > Impostazioni > "processo Service", Admin del modulo, "Salva impostazioni"):
`hub_offerta_validita_giorni` (60, validità proposta nell'offerta economica), `hub_b2b_token_giorni` (60, validità del collegamento alla
form online, rinnovabile dalla scheda account), `hub_dest_contrattualizzazione` (francesco.epifani@ e rosetta.greco@: email "Avvenuta
contrattualizzazione"), `hub_dest_laboratorio` (laboratorio@ e valentina.zezza@: email "Nuovo cliente contrattualizzato"),
`hub_giorni_lavorativi` (250: volumi giornalieri = volume FY atteso / giorni, se l'account non ha "Volumi giornalieri attesi"),
`hub_richiamo_attivo` ('false': interruttore generale del richiamo dei prospect, lo accende il CEO), `hub_richiamo_giorni` (60: il CEO
ha scritto "ogni 60 mesi", inteso come **ogni 60 giorni, modificabile**), `hub_richiamo_limite` (20 invii al giorno),
`hub_richiamo_recapiti` (francesco.epifani@ e rosetta.greco@: nome, ruolo e telefono si leggono dall'anagrafica; il primo è l'indirizzo
"a cui scrivere" oltre a service@). Stato interno `hub_richiamo_ultimo_giorno` (ignorato dal PUT).
Con le route dedicate (Admin del modulo): `flusso.modelli` (JSON, solo i testi modificati: oggetto e testo del kit di proposta, della
email interna, del benvenuto al cliente, dell'email al laboratorio, del richiamo, lettera di presentazione del pacchetto; dal 07/11/2026
"Revisione dell'offerta economica" (`revisione_oggetto`, `revisione_testo`: email "Invia per la firma" dell'offerta rivista, segnaposto
`{{cliente}}`, `{{versione}}`, `{{righe_cambiate}}`, `{{data}}`);
`GET|PUT /api/business/hub/flusso/modelli`, "Ripristina i testi predefiniti"), `b2b.allegati` (JSON per linea: allegati del contratto
richiesti nella form, titolo e obbligatorio; il contratto firmato c'è sempre; `GET|PUT /api/business/hub/b2b/allegati`),
`listino.mapping` (mapping delle colonne del listino StudioLAB scelto a video, `DELETE /api/business/hub/listino/mapping` lo azzera).
Job `business:richiamo-prospect` (controllo ogni ora, invio una volta al giorno dopo le 9 ora di Roma, solo con l'interruttore acceso e
il modulo LIVE). Migrazione: business 010_service_flow.sql.

## Business Hub: processo Punti Prelievo (06/11/2026)
Impostazioni in app (`business.app_settings`, Business Hub > Impostazioni > "processo Punti Prelievo", Admin del modulo, "Salva
impostazioni"; indirizzi separati da virgola, validati): `hub_pp_dest_conferma` (francesco.epifani@ e silvia.sansoni@: b) "Contratto punto
prelievi firmato"), `hub_pp_dest_avvio` (laboratorio@ e valentina.zezza@: c) "Avvio del nuovo punto prelievi"), `hub_pp_dest_dotazione`
(valentina.zezza@: e) dotazione), `hub_pp_dest_amministrazione` (amministrazione@: f) fondo cassa e POS), `hub_pp_dest_rifiuti`
(iacopo.cupelli@: g) rifiuti speciali), `hub_pp_dotazione_elenco` (una voce per riga: "Acquisto di un PC fisso", "Ordine della stampante
RICOH", "Boccione Culligan"; va nell'oggetto e nel testo dell'email della dotazione, senza prezzi né fornitori). Mittente sempre la
casella della linea (`hub_casella_PP`, network@) con le copie fisse `hub_cc_PP`; l'invito con la password provvisoria parte senza copie.
I testi sono nei modelli `flusso.modelli` (schede "PP ·": contratto al partner, credenziali e benvenuto al partner, contratto firmato
interna, avvio al laboratorio, dotazione, fondo cassa e POS, rifiuti speciali) con i segnaposto; gli allegati richiesti nella form del
partner sono in `b2b.allegati` (linea PP). Cash > Impostazioni: `default_cash_float` (vuoto = "da definire"), usato solo se la sede
del punto non è configurata in Cash. Job `business:avvio-pp` (ogni 30 minuti, modulo LIVE): riprende i passi in attesa della sede o della
data; i passi non riusciti aspettano "Riprova". Migrazione: business 011_pp_flow.sql.

## Business Hub: firmatario dei contratti (07/11/2026)
Business Hub > Impostazioni > "Firmatario dei contratti" (Admin del modulo). `firma_nome` e `firma_qualifica` (`business.app_settings`,
predefiniti vuoti = `lr_name` e `lr_role` del legale rappresentante; si salvano con "Salva impostazioni") compaiono nei tre blocchi firme
di Toscana Diagnostica della lettera di offerta Service (MOD230) e Medicina del Lavoro (MOD231). L'immagine della firma (PNG con sfondo
trasparente o JPG, al massimo 1 MB; tipo riconosciuto dai primi byte, dimensioni lette con pdf-lib) sta nella tabella `business.firma_td`
(una riga, archivio a due vie come i documenti: Azure Blob se configurato, altrimenti bytea) e si carica, sostituisce e rimuove subito,
con anteprima: `GET /api/business/settings/firma` (metadati e firmatario in uso), `GET /api/business/settings/firma/immagine`,
`POST /api/business/settings/firma` (multipart `file`), `DELETE /api/business/settings/firma`; registro `SETTINGS_FIRMA`,
`SETTINGS_FIRMA_RIMOSSA`. Nessuna firma caricata = PDF senza firma (il DOCX resta sempre con lo spazio vuoto). Migrazione: business
013_firma_td.sql. Dettagli in docs/BUSINESS_HUB.md, "Contratto Service MOD230".

Termini di pagamento delle lettere di offerta: le voci della tendina sono nel codice (`web/src/modules/business/format.js`,
`TERMINI_PAGAMENTO`), non in Impostazioni: sono le voci standard del format. `payment_terms_default` resta il testo usato quando il
campo del contratto è vuoto (prima voce della tendina, "Predefinito: ...").

## Rubriche esterne: Outlook e Gmail (07/11/2026)
Amministrazione > Impostazioni > "Rubriche esterne" (amministratori). Chiave `app_settings.rubriche` (esclusa dall'editor generico):
`outlook_casella` (casella di cui leggere i contatti con Microsoft Graph, predefinita francesco.epifani@toscanadiagnostica.it) e
`google_account` (unico account Google ammesso al consenso, predefinito fraepi@gmail.com). Nella stessa card: stato di ciascuna
rubrica con il motivo se non è configurata, "Prova la rubrica Outlook" (credenziali, permesso Contacts.Read, casella, lettura) e "Prova
la rubrica Gmail" (credenziali OAuth, consenso, token, lettura), "Collega l'account Google" (apre il consenso di Google) e "Scollega"
(revoca presso Google e cancella il token), URI di reindirizzamento da registrare in Google Cloud con il pulsante Copia. Il refresh token
è in `app_settings.secret:rubriche_google`, cifrato con CREDENTIALS_KEY come le altre credenziali. Variabili su Render (sync:false):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; facoltativa `GOOGLE_REDIRECT_URI`. Nessun dato chiesto due volte: le credenziali Microsoft
sono quelle già usate per le caselle. Audit: `RUBRICA_IMPOSTAZIONI`, `RUBRICA_GOOGLE_COLLEGATA`, `RUBRICA_GOOGLE_RIFIUTATA`,
`RUBRICA_GOOGLE_SCOLLEGATA`. Guida completa (permessi Graph, Application Access Policy, progetto Google Cloud): docs/RUBRICHE.md.

## Retail > Intorno: cosa c'è intorno alle sedi (07/11/2026)
Retail > Impostazioni > "Intorno" (profilo ADMIN del modulo). Chiavi in `retail.app_settings` (non nell'editor delle impostazioni
dell'app): `retail.intorno.tetto_giornaliero` (300), `retail.intorno.raggio_urbano` (3000 m), `retail.intorno.raggio_extraurbano`
(10000 m), `retail.intorno.sottocategorie` (categorie attive separate da virgola; assente = tutte). Nella stessa card: contatore delle
chiamate di oggi e del mese (`retail.intorno_chiamate`), "Prova la chiave" (una chiamata con la risposta grezza, chiave mascherata),
"Esegui ora la rilevazione mensile" (job `retail:intorno`, anche in Amministrazione > Moduli > Lavori di sfondo). Le chiavi Google NON
sono impostazioni: solo variabili d'ambiente su Render (sync:false) `GOOGLE_MAPS_SERVER_KEY` e `GOOGLE_MAPS_BROWSER_KEY`; la pagina
dice solo se ci sono. Nessun dato chiesto due volte: "Sede extraurbana" è un campo dell'anagrafica unica (`public.sites.extraurbana`,
migrazione core 042, Amministrazione > Sedi) e le coordinate restano `public.sites.lat/lng` (geocodifica Google con conferma dalla scheda
Intorno o dal form Sedi). Audit: `INTORNO_IMPOSTAZIONI`, `INTORNO_PROVA`, `INTORNO_JOB`, `INTORNO_RILEVA`, `INTORNO_VALUTA`,
`INTORNO_COORDINATE_SEDE`, `INTORNO_VALUTAZIONE_ELIMINATA`. Guida completa: docs/RETAIL_INTORNO.md.

## Anagrafica unica, blocco 1 (08/11/2026)
- `company_org_id` (app_settings, numero): Legal entity di Toscana Diagnostica. Si imposta in Impostazioni > Dati aziendali (riquadro
  "Legal entity di Toscana Diagnostica", proposta automatica) o dalla correzione D22a; non dal generico `PUT /api/settings/:key`
  (rifiutato). Il salvataggio di `company` aggiorna quella Legal entity (ragione sociale, P.IVA, CF, indirizzo, PEC, SDI).
- Lavoro `core:diagnostica` (ogni 24 ore): esito della Diagnostica anagrafica in `diagnostica_runs`, notifica agli amministratori se
  crescono i controlli bloccanti.
- Migrazioni: core 043 (`sites.closed_at`, funzione `responsabili_solo_attivi`, indice `org_units_sede_site_uq` se non ci sono doppioni,
  `diagnostica_runs`, `site_documents.label/origin`), cash 016 (titolo e ospitante solo dal core), audit 003, facility 004, orders 012,
  room 010 (responsabile di sede solo attivo). Tutte idempotenti e non distruttive, con rapporto `MIGRAZIONE_RAPPORTO` in audit_log.
- Cash: titolo di godimento e struttura ospitante non sono più impostazioni di Cash (Amministrazione > Sedi).

## Anagrafica unica, blocco 2 (08/11/2026)
- Profili di accesso: l'assegnazione da Amministrazione ha la spunta "Sostituisci i permessi esistenti" (accesa di base, modalità
  `sovrascrivi`): per i widget del profilo il permesso che la persona aveva viene sostituito (ruolo e ambito) e l'ambito dei widget per
  sede è la sede della persona (anagrafica, altrimenti contratto di lavoro); senza sede il rapporto rimanda ad Anagrafica > Persone. Il
  profilo Default dei nuovi account resta additivo. Dettagli in docs/ANAGRAFICA.md (blocco 2).
- Codice StudioLAB del cliente: si inserisce nella scheda account del Business Hub (riquadro "Codice StudioLAB") o in Amministrazione >
  Sedi (sede SERVICE); non è un'impostazione di Ordini o NC. `sites.address_from_org`: indirizzo della sede SERVICE ereditato dalla Legal
  entity (lo segue quando cambia).
- Migrazioni: core 044 (`clienti_attivi_v`, `cliente_livello`, `sites.address_from_org`), business 018 (`accounts.studiolab_code`,
  `attivo_dal` completata dalla fase 7), orders 013 e nc 007 (strutture e sedi invianti solo clienti, le altre Legal entity con dati
  restano disattivate). Idempotenti e non distruttive, con rapporto `MIGRAZIONE_RAPPORTO`.


## Anagrafica unica, blocco 3 (08/11/2026)
- Business Hub `lab_address` e NC `lab_nome`/`lab_indirizzo`: non sono più impostazioni da compilare, vengono dalla sede LABORATORIO di
  Amministrazione > Sedi (in sola lettura nelle pagine dei moduli; senza quella sede vale il valore del modulo o il predefinito). Email e
  telefono del laboratorio in NC restano impostazioni del modulo (canale delle notifiche).
- Contratti del personale `letter_city` (luogo delle lettere): è la città dei Dati aziendali, in sola lettura.
- Spedizioni `td_sites`: non più letta (le sedi di ricezione sono quelle dell'anagrafica); `return_address` vuoto o uguale al testo
  iniziale = indirizzo dei Dati aziendali.
- Cash: l'azienda della sede non si sceglie più (è la Legal entity proprietaria della sede); le royalties si possono precompilare dal
  contratto PP ("Proposta dal contratto PP", con conferma).
- Room: orari di apertura e planimetria non sono più impostazioni di Room (Amministrazione > Sedi); Retail: superficie, ambulatori e box
  non sono più impostazioni di Retail (Facility e Room); Facility: ore e giorni di apertura settimanali calcolati dagli orari della sede.
- Contratti del personale: le aree sono le unità di primo livello dell'organigramma (Amministrazione > Organizzazione), "Allinea al core".
- Referti esterni: `laboratori_origine` (Impostazioni > Laboratori di origine e Legal entity).
- Migrazioni: core 045, business 019, cash 017, retail 011-013, room 011, nc 008, facility 005, contracts 020, shipments 006, finance 005
  (dettagli e verifiche in docs/ANAGRAFICA.md, blocco 3).
