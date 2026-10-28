# Impostazioni senza doppia compilazione

Richiesta del CEO (27/10/2026): i moduli non chiedono di nuovo dati già presenti nell'anagrafica unica (`public.sites`,
`public.organizations`, `public.people`) o nelle impostazioni generali della Suite (`public.app_settings`). Regola: un campo è
del modulo solo se è specifico del modulo; se è un dato generale della sede, della Legal entity, della persona o dell'azienda
si legge dal core e si modifica solo lì (pulsante o link "Apri in Amministrazione"). Le viste `<key>.sites_v`, `sedi_v`,
`strutture_v`, `orgs_v`, `companies_v`, `resources_v`, `professionisti_v` conservano i nomi di colonna che il codice dei moduli
si aspetta, ma le colonne duplicate sono calcolate dal core.

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
| orders | site_ext, org_ext | kind, silva_code, stock_deadline_day, delivery_mode, delivery_notes, notes | SPECIFICO | Flusso ordini e consegne. |
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
| finance | Impostazioni | company_name | CABLATO -> core | `legal_name`; in sola lettura. |
| finance | Impostazioni | soglie, titoli, testi, mail_cc, prefisso | SPECIFICO | Poteri di firma. |
| finance | Impostazioni (Scadenziario strutture, 28/10/2026) | schedule_alert_days (7), schedule_istat_pct (1.5), schedule_utility_growth_pct (0), schedule_notify_roles (CEO,CFO,SUPPORT) | SPECIFICO | Anticipo degli avvisi in app, ipotesi di rivalutazione ISTAT e di crescita delle utenze per la previsione, profili Payments che ricevono gli avvisi. Sedi e Legal entity (locatori, fornitori, IBAN) vengono dall'anagrafica unica; i beneficiari dall'anagrafica Payments: nessun dato ridigitato. Migrazione finance 002. |
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
