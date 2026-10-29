# Audit SGI (widget HQS)

Richiesta del CEO (29/10/2026), testuale: "Costruisci un nuovo widget sotto HQS che serve per la conduzione, archiviazione e gestione degli
AUDIT di SGI. Gli audit possono essere verso le nostre strutture (Punti Prelievo, Centri Medici + Laboratorio) [...]. L'audit può essere
AUTO-AUDIT che chiediamo ad ogni sede mensilmente e deve essere compilato dal Site Manager della sede (al Site Manager manda alert ogni 17
del mese!). Sullo stesso AUTO-AUDIT permetti la compilazione di una colonna parallela da parte del verificatore [...]. L'audit può anche
essere Internal AUDIT [...]. In ultimo permetti di caricare sulle sedi eventuali AUDIT di terze parti (PDF) [...]. Utilizzando poi le API
Anthropic, genera giudizio di sintesi [...]. L'esito numerico invialo al widget Retail Assistant sullo spazio relativo ad ogni singola SEDE.
Proponimi inoltre, in linea con la ISO 37001, un audit da fare alle Legal Entity come partner, soci in affari [...]. Archivio di tutti gli
audit con possibilità di eliminare la riga (cestino in fondo alla riga) e download di EXCEL + PDF. Anche qui, con API Anthropic, giudizio
di sintesi su TD e sulle legal entity."

## Modulo
Key `audit`, area HQS (sort_order 15, tra SGI Management e Portale Service), nome "Audit SGI", kind LEGACY con legacy_url null (nativo,
parte vuoto e LIVE con "Avvia": FRESH_MODULES), `open_to_all` FALSE, `scope_type` SITE, icona `audit` (clipboard con spunta).
Codice: `server/src/modules/audit` (index.js, config.js, db.js, data/*.json, migrations/001_init.sql, lib/{access,scoring,core,synth,
alerts,export}.js, routes/{audits,sites,synth,archive,settings}.js) e `web/src/modules/audit` (meta.js, index.jsx, api.js, format.js,
styles.css, components/{Score,Sintesi}.jsx, pages/*). Migrazione core `029_site_sgi_scores.sql`. Contatore della home in
`lib/legacy.js` (COUNTER_QUERIES.audit), regole di accesso in `lib/grantRules.js`.

## Ruoli
| Profilo | Chi | Poteri |
| --- | --- | --- |
| ADMIN | Owner e Admin della Suite ("AD" = titolare) | tutto |
| QUALITA | HSQ Management | tutto il ciclo: conduce audit interni, di terze parti e sui partner, verifica gli auto-audit, sintesi, impostazioni, modelli, elimina anche gli audit chiusi/verificati, riapre |
| AUDITOR | Retail & Communications Management, B2B (Service, MDL Manager) | conduce audit interni e sui partner, carica terze parti, verifica gli auto-audit, sintesi; elimina solo audit non chiusi |
| SITE (ambito sede) | ruolo Site Manager; responsabili di unità con sede di lavoro PUNTO_PRELIEVI / CENTRO_MEDICO / CENTRO_DIAGNOSTICO | compila e invia l'auto-audit della propria sede, vede audit e sintesi della sede, elimina solo le proprie bozze |
| VIEWER | | consultazione |

È site manager di una sede anche chi ha email = `manager_email` della sede (capo del nodo Sede dell'organigramma, stessa regola di
Amministrazione > Sedi e di room.sites_v): `audit.sites_v` calcola il manager con la LATERAL sull'organigramma e `req.managedSiteIds`
unisce ambito del grant e sedi di cui l'utente è manager. Le sedi auditabili sono le `public.sites` con kind diverso da SERVICE; l'auto-audit
mensile riguarda le sedi "struttura" (PUNTO_PRELIEVI, CENTRO_DIAGNOSTICO, CENTRO_MEDICO, POLIAMBULATORIO, LABORATORIO).

## Tipi di audit e stati
- **AUTO** (auto-audit mensile): `period` = primo del mese, UNIQUE (site_id, period) tra i non eliminati; BOZZA → INVIATO (notifica a
  QUALITA/AUDITOR/ADMIN) → VERIFICATO (colonna `verifier_answers` compilata dal verificatore, pulsante "Conferma le risposte della sede"
  che copia la colonna; notifica al site manager). Il site manager vede la colonna Verifica in sola lettura.
- **INTERNO**: QUALITA/AUDITOR/ADMIN sulla sede, modello sede attivo, colonna unica, evidenze in `audit_files`; BOZZA → CHIUSO.
- **TERZI**: PDF (fino a 25 MB, più file) con ente_tipo CERTIFICATORE|ASL|ISPETTIVO|ALTRO, ente, data, esito CONFORME|
  CONFORME_CON_RILIEVI|NON_CONFORME|ALTRO, note; il testo viene estratto con `lib/pdftext.js` (OCR se scansione) in
  `third_party.sintesi_testo` (max 60.000 caratteri); punteggio null; CARICATO → CHIUSO.
- **LEGAL_ENTITY** (ISO 37001): verso `public.organizations` con kind diverso da GRUPPO e SOCIETA (le società del gruppo non sono partner),
  modello `TD-AUD-LE` con rischio per voce (BASSO/MEDIO/ALTO facoltativo), testata (relazione, rischio iniziale), esito e rischio finale;
  BOZZA → CHIUSO.
QUALITA/ADMIN possono riaprire (VERIFICATO → INVIATO, CHIUSO → BOZZA, TERZI → CARICATO). Il cestino è un soft delete (`deleted_at`).

## Modelli
Due JSON in `data/` seminati alla prima richiesta (una riga per code+rev, attiva se non ce n'è un'altra per lo stesso kind):
- `TD-AUD-SEDE` rev. 1: derivato dal MOD002-SY Check list verifica interna punto prelievi rev. 5 (20/02/2020) adattato a TD: parti Front
  office (F1 documentazione paziente, F2 cartellonistica, F3 immagine, F4 documentazione accettazione, F5 attività amministrative), Box
  prelievo (B1 materiale e documentazione, B2 immagine box, B3 registri, B4 competenze), Sicurezza (S1); 118 voci, di cui 5 libere
  ("Altri, specificare"); voci con `rev` per il numero di revisione dei documenti.
- `TD-AUD-LE` rev. 1: proposta ISO 37001 (6 sezioni, 32 voci): identità e due diligence, governance e compliance, rapporto contrattuale,
  flussi finanziari, regali/ospitalità/sponsorizzazioni, segnalazioni e monitoraggio.
Chiave di voce: sotto-voci con la loro `key` (1a, 19p_1...), voci singole con `n` senza spazi (Sic1). `validateTemplate` controlla
chiavi uniche e campi obbligatori; dalle Impostazioni si carica una nuova revisione JSON (attivata subito), gli audit esistenti restano
legati alla loro revisione.

## Punteggio e livelli
Per voce SI = 1, NO = 0, NC = 0 (conta anche come non conformità), NA esclusa dal denominatore; voci libere non conteggiate se vuote;
voci senza risposta fuori dal denominatore. Punteggio di sezione e totale in percentuale (0-100, un decimale), salvati in `score`,
`score_verifier`, `score_by_section`. Per gli AUTO con colonna Verifica compilata fa fede `score_verifier` e si mostra lo scostamento.
Livelli: A Allineato ≥ 90, B Sostanzialmente allineato 75-89, C Parzialmente allineato 60-74, D Critico < 60. Per i partner la stessa
scala più il rischio finale. Funzioni pure in `lib/scoring.js`, test in `server/test/audit-scoring.test.mjs`.

## Alert del 17
Job `audit:alert17` ogni 60 minuti (solo modulo LIVE). Impostazioni `alert_day` (17) e `reminder_every_days` (5). Dal giorno dell'alert
fino a fine mese, per ogni sede struttura attiva senza auto-audit INVIATO/VERIFICATO nel mese: crea l'auto-audit del mese se manca,
notifica Suite (kind MODULO, link `/audit/miei/<id>`) ai site manager (email = manager_email oppure grant SITE sulla sede) e, se il mailer
è configurato, email "Auto-audit SGI di <sede>: compilazione entro fine mese"; una volta per sede e mese (`alerts_sent`), poi promemoria
ogni N giorni finché non arriva l'invio. Nessuna data cablata: `runAlert17({ today })` accetta una data di test (fuori produzione) da
`POST /api/audit/jobs/alert17/run { today, dry_run }` (Impostazioni: "Simula" / "Esegui ora").

## Sintesi con Claude
`askJson({ kind: 'audit_sintesi', maxTokens: 4000 })` di `lib/claude.js` (ogni chiamata in `ai_log`), system prompt: auditor SGI
esperto ISO 9001/37001 in sanità, fedele ai dati, nessuna invenzione, dice se i dati sono pochi (`dati_sufficienti`). Nel prompt passano
nomi di sedi e organizzazioni, punteggi per sezione, voci negative con note, NC, osservazioni e il testo dei PDF di terze parti (8.000
caratteri per PDF, 60.000 in totale con avviso `troncato`); nessun dato di pazienti. Nei log della Suite solo id e conteggi.
- (a) **Sede** `POST /api/audit/sintesi/sede/:siteId`: audit INVIATO/VERIFICATO/CHIUSO/CARICATO degli ultimi 12 mesi → `{ livello_allineamento,
  livello_lettera, giudizio, aree[{area, livello, punti_di_forza, criticita, azioni[{descrizione, urgenza, responsabile_suggerito,
  entro_giorni}]}], piano_miglioramento[{fase, obiettivo, azioni, scadenza, indicatore}], trend, note_terze_parti }`; salva in
  `audit.syntheses` e aggiorna `public.site_sgi_scores` (score, level, summary troncato a 400, synthesis_id, last_audit_at).
- (b) **TD** `POST /api/audit/sintesi/td`: classifica delle sedi, aree deboli ricorrenti, azioni trasversali, piano di rete.
- (c) **Legal entity** `POST /api/audit/sintesi/partner/:orgId` e `POST /api/audit/sintesi/partners`: livello di conformità, rischio
  corruzione residuo, azioni per urgenza, classifica.
Senza chiave: 400 "Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni".
`AUDIT_AI_MOCK=1` (solo NODE_ENV diverso da production) costruisce la sintesi dai punteggi reali con testi standard (modello "mock",
nessuna riga in ai_log perché non c'è chiamata). **Limiti**: giudizio assistito, da verificare da Qualità che resta responsabile; la
qualità dipende dai dati inseriti (note, NC); il testo dei PDF di terze parti viene troncato.

## Retail Assistant
`GET /api/retail/structure/sites/:id/structure` restituisce `sgi: { score, level, summary, computed_at, last_audit_at }` da
`public.site_sgi_scores`; `SiteDetail.jsx` mostra il riquadro "Allineamento SGI" (numero grande, livello colorato A verde, B teal, C ambra,
D rosso, data, "Apri gli audit della sede" → `/audit/sedi/<id>`; se manca: "Nessuna sintesi: avviala dal widget Audit SGI").

## Esportazioni
Archivio: `GET /api/audit/archivio.xlsx` (fogli Archivio, Punteggi per sezione, NC, stessi filtri della lista) e `/archivio.pdf` (lista
impaginata in orizzontale con intestazione TD). Singolo audit: `/audits/:id/export.xlsx` (checklist voce per voce con colonne Sede e
Verifica per gli AUTO, fogli Audit report e Punteggi) e `/audits/:id/export.pdf` (pdfkit: testata, riquadro punteggio/livello, sezioni con
tabella N. / Voce / Rev. / Sì / No / NC / N.A. / Note, per gli AUTO la doppia fascia Compilazione della sede / Verifica, pagina Audit report
con NC, osservazioni, campi di esito e firme; piè con codice e revisione del modello). Font: Lato se installato (`fonts-lato` nel
Dockerfile), altrimenti Liberation Sans degli asset di Spedizioni, altrimenti Helvetica.

## ISO 37001: la proposta di checklist
La checklist `TD-AUD-LE` traduce in voci verificabili sul singolo partner i requisiti della ISO 37001 sui soci in affari: due diligence
proporzionata al rischio, controlli anticorruzione e impegni contrattuali verso i partner, regali, ospitalità e donazioni, segnalazioni e
indagini, monitoraggio e riesame; con richiami al D.Lgs. 231/2001 (modello organizzativo e organismo di vigilanza) e al D.Lgs. 24/2023
(whistleblowing) e al divieto di comparaggio nei rapporti con il settore sanitario. I numeri di paragrafo riportati nel JSON (8.2, 8.5,
8.6, 8.7, 8.9, 9.2) seguono la struttura generale della norma (clausola 8 Attività operative, clausola 9 Valutazione delle prestazioni) e
vanno confermati sull'edizione in uso da Qualità e dalla Funzione di conformità anticorruzione prima dell'adozione formale.

## Collaudo (29/10/2026, locale)
Database `suite_audit_t`, porta 3125, AUDIT_AI_MOCK=1, moduli audit e retail avviati con `POST /api/travaso/<key>/run`. Sedi Calenzano
(PUNTO_PRELIEVI) e Prato (CENTRO_MEDICO), Legal entity "Laboratorio Analisi Mugello Srl", utenti SITE (grant con ambito Calenzano) e
QUALITA. API: auto-audit del mese creato al volo per il SITE, compilazione (61/119 voci, 2 NC, 96,7%), 403 del SITE sulla colonna Verifica
e sulle modifiche dopo l'invio, invio con notifica ai verificatori, conferma delle risposte della sede, correzioni nella colonna Verifica
(93,3%, scostamento -3,4), chiusura VERIFICATO con notifica al site manager, riapertura; audit interno su Prato (94,8%) chiuso; PDF di
terze parti (6 pagine, 14.389 caratteri estratti); sintesi sede (mock 91,3% A) → `site_sgi_scores` → Retail `sgi`; sintesi TD (93,1%);
audit partner ISO 37001 (90,6%, rischio finale MEDIO) + sintesi singola e complessiva; archivio con filtri, XLSX a 3 fogli e PDF;
singolo audit XLSX e PDF (controllati come PNG); cestino: 403 per il SITE su un audit VERIFICATO e su un audit di un'altra sede, ok per
QUALITA; job alert17 con data forzata (17: avviso, stesso giorno: niente, 22: promemoria; destinatario dal capo del nodo Sede
dell'organigramma; righe in `alerts_sent`, notifica ed email nel registro). Test `node --test`, build Vite, screenshot Playwright
`docs/screens/audit-{sedi,compila,archivio,sintesi,retail-sgi,cruscotto,partner,sede,impostazioni,home-widget}.png`.

## Da verificare / non fatto
- Sintesi con la chiave Anthropic reale (qui solo mock): formato della risposta e tempi (timeout 60 s di askJson).
- Font Lato: non installato nell'ambiente di collaudo (il PDF usa Liberation Sans); in produzione serve `fonts-lato` nel Dockerfile.
- Email reale dell'alert (qui MAIL_PROVIDER=log).
- Regole di accesso: le regole su "Site Manager" e sui responsabili di unità delle sedi struttura si seminano solo se la tabella
  `grant_rules` è vuota (`seedGrantRules`): su un database già inizializzato vanno aggiunte da Amministrazione > Regole di accesso.
- Nessun export DOCX (il brief chiede Excel e PDF); nessuna firma digitale; il cestino non ha una pagina di ripristino (si ripristina da
  database con `deleted_at = NULL`).
