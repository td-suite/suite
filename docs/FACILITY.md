# Facility e Manutenzioni (widget OPERATIONS)

Richiesta del CEO (31/10/2026), testuale: "In Operations voglio un nuovo WIDGET. L'obiettivo è includere sia attività di Facility Management
che di Gestione delle Manutenzioni. Pertanto è necessario includere in Amministrazione il Catalogo dei Dispositivi sotto manutenzione, ivi
inclusi quelli di sicurezza (penso a porte antincendio, estintori, maniglioni antipanico, ...). Inoltre, cataloghiamo tutti gli immobili da
noi gestiti con contratti di affitto, salvando la planimetria che poi mettiamo a disposizione di Room Planning. Per ogni struttura il widget
deve registrare le utenze, il canone di affitto, gli eventuali obblighi di controllo previsti dal contratto. Le utenze devono poi essere
ribaltate nella sezione di Payments sullo scadenzario dei pagamenti già elaborato. Utilizza informazioni di benchmark per tutte le sezioni
che ad oggi non ho previsto. Immagina sotto Facility tutto quello che può essere utile e necessario in termini di Energy Management che ha
effetti diretti per noi sulle certificazioni di qualità in corso; prevedi quindi statistiche possibili, confronti tra gli anni, analisi dei
consumi per sede e tra le sedi a parità di attività, ... tutto!"

## Modulo
Key `facility`, area OPERATIONS (sort_order 70), nome "Facility e Manutenzioni", tagline "Immobili, utenze ed energia, dispositivi e
manutenzioni programmate, scadenze normative", kind LEGACY con legacy_url null (nativo: FRESH_MODULES, si avvia vuoto e LIVE con "Avvia"
da Amministrazione > Travaso moduli), `open_to_all` FALSE, `scope_type` SITE, icona `facility` (edificio con chiave inglese).
Codice: `server/src/modules/facility` (index.js, config.js, db.js, migrations/001_init.sql, lib/{access,calc,core,energy,activity,room,ai,
alerts,kpi,export}.js, routes/{properties,utilities,energy,assets,plans,workorders,reports,settings}.js) e `web/src/modules/facility`
(meta.js, index.jsx, api.js, format.js, styles.css, components/{bits,Charts,PdfPreview}.jsx, pages/*). Core: migrazione
`033_asset_types.sql`, seed `server/src/seed/assetTypes.js` (seminato una volta da migrate.js), route `server/src/routes/assetTypes.js`,
pagina `web/src/pages/admin/AssetTypes.jsx`. Registrazioni: config.js (LEGACY_KEYS, FRESH_MODULES), seed/modules.js, migrate.js (etichetta
della sorgente), lib/grantRules.js (regole e RANK), lib/accessProfiles.js (RANK), lib/legacy.js (COUNTER_QUERIES.facility), Icons.jsx
(`facility`, e le icone di interfaccia `bolt`, `wrench`, `qr`), Shell.jsx e Admin.jsx (voce Catalogo dispositivi).

## Profili
| Profilo | Chi | Poteri |
| --- | --- | --- |
| ADMIN | Owner e Admin della Suite | tutto |
| FACILITY | Operations, Flow & Back Office (regole di accesso) | gestione completa: immobili, documenti e planimetrie, obblighi, utenze e bollette (in Payments), dispositivi, piano, interventi, energia, obiettivi, analisi, impostazioni |
| MANUTENTORE | manutentore interno o di un fornitore (accesso esterno dalla Legal entity) | vede piano, dispositivi e interventi; se la sua organizzazione non è del gruppo vede solo dispositivi e interventi della sua Legal entity (o assegnati a lui); chiude le scadenze, avanza e chiude gli interventi; niente immobili, utenze, energia, impostazioni |
| SITE (ambito sede) | ruolo Site Manager (regola di accesso), o manager della sede nell'organigramma | solo le proprie sedi: cruscotto, scheda immobile, dispositivi, piano; conferma le sorveglianze di sede (esecutore SEDE), segnala guasti con foto, registra letture dei contatori; 403 su sedi altrui e Impostazioni |
| VIEWER | HSQ Management (regola di accesso) | consultazione e report; 403 su ogni scrittura |

Le regole di accesso nuove (Operations e Flow & Back Office → FACILITY ALL, HSQ Management → VIEWER ALL, ruolo Site Manager → SITE SITE)
si seminano solo con `grant_rules` vuota: in produzione vanno aggiunte da Amministrazione > Regole di accesso o assegnate a mano.

## Modello dati
Core: `public.asset_types` (Catalogo dispositivi: code UNIQUE, name, category tra SICUREZZA_ANTINCENDIO, SICUREZZA_LUOGHI, IMPIANTI,
CLIMA_ENERGIA, ELETTROMEDICALE, DIAGNOSTICA_IMMAGINI, LABORATORIO, IT, ARREDI, EMERGENZA, IGIENE_AMBIENTE; description;
`surveillance_months` (sorveglianza interna a cura della sede, colonna aggiunta al brief per gli estintori e simili),
`check_interval_months` con `check_kind` CONTROLLO | VERIFICA_NORMATIVA (aggiunta: distingue il controllo del manutentore dalla verifica
dell'ente), `maintenance_interval_months`, legal_reference, requires_certified_vendor, applies_to_kinds TEXT[], benchmark_note, active, sort).
Schema `facility` (nessuna anagrafica propria):
- `users` riga tecnica (moduleUser); `sites_v` sedi non SERVICE con il site manager dall'organigramma.
- `properties` un immobile per sede (`site_id` UNIQUE → public.sites), `lease_id` = finance.lease_contracts.id (riferimento logico: se
  vuoto vale il contratto attivo della sede collegato all'anagrafica; se indicato si verifica che sia della sede), superficie, piani,
  locali, catasto (JSON), classe e scadenza APE, riscaldamento, raffrescamento, anno, giorni e ore di apertura settimanali, note. Creati
  al volo per le sedi attive non SERVICE. Titolo di godimento (PROPRIETA | LOCAZIONE | COMODATO | OSPITATA), canone con IVA, durata,
  garanzie, locatore e contratto in PDF NON sono dell'immobile: si leggono dall'anagrafica Sedi (`public.sites.tenure` e colonne della
  locazione, `public.site_documents`; docs/ANAGRAFICA.md "Sedi: titolo di godimento e locazione"). Migrazione 002 (31/10/2026): tolte
  `properties.tenure` e `properties.landlord_org_id` (prima l'immobile nasceva LOCAZIONE per ogni sede senza ospitante e Montemurlo,
  Poggio a Caiano, Calenzano risultavano in locazione); i valori scelti a mano in Facility (proprietà o comodato di una sede non
  ospitata, locatore diverso dall'ospitante) sono passati in anagrafica. La scheda mostra titolo, canone, IVA, garanzie, locatore, PDF
  (`GET /api/facility/immobili/:siteId/contratto-pdf`, non per i manutentori) e il contratto Payments collegato, con il pulsante
  "Modifica in Amministrazione > Sedi" (`/admin/sites?sede=<id>` apre il form della sede); nel form "Dati dell'immobile" il titolo non c'è più.
- `property_obligations` obblighi CONTRATTUALE | NORMATIVO | ASSICURATIVO con periodicità, prima scadenza, responsabile, tipo di dispositivo
  collegato, costo stimato; `property_documents` (PLANIMETRIA, CONTRATTO, CERTIFICAZIONE, VERBALE, ALTRO; file a due vie con
  lib/moduleStorage.js; `valid_until`; `published_room_at`).
- `assets` dispositivi (sede, tipo → asset_types.code ON UPDATE CASCADE, codice interno generato `<sede>-<tipo>-NNN`, marca, modello,
  matricola, locale, installazione, garanzia, manutentore = Legal entity, contratto, stato IN_SERVIZIO | FUORI_SERVIZIO | DISMESSO,
  periodicità proprie facoltative, prossime date, ultimo esito, `qr_code` token casuale).
- `maintenance_plans` scadenze: serie (`stream`) SORVEGLIANZA | CONTROLLO | MANUTENZIONE | OBBLIGO, kind CONTROLLO | MANUTENZIONE |
  VERIFICA_NORMATIVA | COLLAUDO, esecutore SEDE | MANUTENTORE | ENTE, due_date, stato PIANIFICATA | ESEGUITA | SCADUTA | ANNULLATA, done_at,
  done_by, esito CONFORME | NON_CONFORME | CON_PRESCRIZIONI, rapportino (`files`), costo, `generated_from`, `work_order_id`. Indici unici
  parziali: una sola scadenza aperta per serie (dispositivo+serie, obbligo). `plan_reminders` (scadenza, stadio D30 | D7 | D0) per non
  ripetere i promemoria.
- `work_orders` (codice WO-AAAA-NNNN, sede, dispositivo, scadenza d'origine, priorità URGENTE | ALTA | MEDIA | BASSA, stato APERTO |
  ASSEGNATO | IN_CORSO | SOSPESO | CHIUSO, segnalato da, manutentore utente e/o Legal entity, aperto, assegnato, iniziato, scadenza SLA,
  chiuso, risoluzione, costo, ore di fermo), `work_order_events` (cronologia), `files` (allegati di scadenze e interventi).
- Energia: `utility_meta` (estensione delle utenze di Payments: `utility_id` = finance.utilities.id, vettore ELETTRICO | GAS | ACQUA |
  TELERISCALDAMENTO | GASOLIO | ALTRO, POD/PDR, potenza impegnata, tariffa, fattore CO2 proprio, unità), `meter_readings` (MANUALE |
  BOLLETTA | SMART, una per utenza e data), `activity_metrics` (sede e mese: accettazioni, prestazioni, ore e giorni di apertura, fonte
  RETAIL | CASH | MANUALE), `energy_targets` (sede o rete, anno, vettore o totale, riduzione %, anno base), `energy_analyses`,
  `anomaly_notified`, `app_settings`.

## Integrazioni (relazioni tra schemi)
- **Payments (finance)**: fonte unica di contratti di affitto, utenze e bollette. Facility legge e scrive `finance.utilities` e
  `finance.utility_bills` nello stesso database (modulo finance LIVE; altrimenti la sezione mostra "Payments non avviato" e risponde 400
  `FINANCE_OFF`). Un'utenza creata in Facility nasce in Payments con tipo dal vettore (ELETTRICO→ENERGIA, GAS→GAS, ACQUA→ACQUA, gli altri
  ALTRO) e codice = POD/PDR, quindi entra nelle scadenze ricorrenti; una bolletta registrata in Facility (periodo, scadenza di pagamento,
  importo, consumo, unità) compare da sola nello Scadenziario strutture (collaudo: `GET /api/finance/scadenziario/events`). Una bolletta già
  pagata non si elimina da Facility. Il canone, gli scatti, la scadenza con rinnovi taciti e il locatore si leggono da
  `finance.lease_contracts` / `lease_steps` con le funzioni pure di `finance/lib/schedule.js` (`stepAt`, `contractEnd`); le prossime
  bollette attese con `buildEvents`. Se il contratto manca, "Crea in Payments" porta a `/finance/scadenziario?site_id=`.
- **Obblighi con costo**: alla chiusura di una scadenza di obbligo con costo (o costo stimato) Facility avvisa in app i profili Payments
  CEO, CFO, SUPPORT ("Costo da pagare ..."). Non crea l'istanza con `lib/requestCreate.js`: serve beneficiario con IBAN e fattura del
  fornitore, che Facility non conosce; l'istanza la crea Payments (scelta documentata).
- **Room Planning (room)**: Facility è la fonte della planimetria. La PLANIMETRIA più recente caricata nella scheda dell'immobile si
  scrive in `room.struttura_blobs` della stessa sede (chiave `struttura_id` = public.sites.id dalla migrazione room/005): PDF → `planPdf`
  (e si toglie `planImg`, la vecchia resa che Room rigenera), immagine → `planImg` (e si toglie `planPdf`), come data URL base64 (il brief
  diceva `planImage`: nel codice di Room il tipo è `planImg`). Non si toccano `site_ext` (marker degli ambulatori, versione) né la
  cronologia: Room continua a funzionare e mostra la planimetria (`GET /api/room/strutture/:id/blob/planPdf`, `hasPlanPdf`). Room non
  avviato: la pubblicazione si salta e si ripete con "Pubblica in Room Planning". Eliminando la planimetria pubblicata va in Room la più
  recente rimasta; se non ne restano Room conserva l'ultima. Limite di pubblicazione 20 MB (Room avvisa già oltre 3,8 MB).
- **Retail / Cash**: attività per sede e mese. Retail: `retail.sales` → accettazioni = numeri di accettazione distinti (`external_ref`),
  prestazioni = somma delle quantità. Cash: `cash.cash_reports` non in bozza → giorni con rendiconto. Impostazione `activity_source` AUTO
  (Retail, poi Cash, poi manuale), RETAIL, CASH, MANUALE; le righe MANUALE non vengono sovrascritte.
- **Anagrafica**: sedi `public.sites` (kind, opened_at, host_organization_id, organization_id, indirizzo), Legal entity
  `public.organizations` (locatore, fornitore, manutentore), utenti e grant del core.

## Catalogo dispositivi (benchmark da confermare)
46 voci seminate in `public.asset_types`, ciascuna con la nota "Benchmark indicativo, da confermare con RSPP e Qualità": estintori a polvere
e CO2 (sorveglianza mensile interna, controllo semestrale UNI 9994-1, revisione e collaudo secondo il tipo), porte REI e maniglioni
antipanico (semestrale), rilevazione fumi, idranti e naspi, sprinkler, illuminazione di emergenza, segnaletica, piano di emergenza e prova di
evacuazione (annuale), servoscala, videosorveglianza, impianto elettrico e di terra (D.P.R. 462/2001, biennale nei locali medici), quadri,
UPS, gruppo elettrogeno, ascensori (D.P.R. 162/1999), porte automatiche, climatizzazione e pompe di calore (gas fluorurati, controllo perdite
secondo la carica), caldaie (D.P.R. 74/2013), UTA, fotovoltaico, contatori, legionella, area rifiuti sanitari, disinfestazione, DAE, cassetta
di pronto soccorso (D.M. 388/2003), lavaocchi, frigoriferi per campioni e farmaci, centrifughe, autoclavi, cappe biologiche e chimiche,
strumentazione di laboratorio, elettromedicali (CEI EN 62353), ecografi, elettrocardiografi, elettromiografi, arredi sanitari, RX,
mammografi, MOC, TC, RM (D.Lgs. 101/2020; D.M. 14/1/2021 per la RM), reti e server IT. Norme citate senza articoli dove non serve
precisione; le periodicità che dipendono da carica, potenza o fabbricante lo dicono nella nota. Il seed parte una volta sola
(`app_settings` `facility.asset_types_seeded`): da lì comanda Amministrazione; un tipo in uso non si elimina (si disattiva).

## Piano, promemoria, interventi
- Registrando un dispositivo nascono le serie previste dal catalogo (o dalle periodicità proprie): prima scadenza = data indicata, altrimenti
  installazione + periodicità, e se è già passata (storia sconosciuta) oggi. Cambiare tipo o periodicità annulla e ricrea le serie aperte;
  dismettere annulla le aperte. "Allinea il piano" crea le serie mancanti di tutti i dispositivi e obblighi.
- Chiusura con esito, data (non futura), costo, note e rapportino (PDF o immagine): nasce la successiva = data di esecuzione + periodicità.
  Esito NON_CONFORME → intervento correttivo ALTA (salvo rinuncia) e `last_outcome` del dispositivo. Il site manager chiude solo le
  sorveglianze di sede delle proprie sedi.
- Interventi: SLA dalle impostazioni (URGENTE 24 ore, ALTA 72, MEDIA 240, BASSA 720: benchmark da confermare), notifiche in app a Facility
  all'apertura (URGENTE anche ai site manager della sede), al manutentore e agli utenti MANUTENTORE della Legal entity all'assegnazione, a
  chi ha segnalato e a Facility alla chiusura; un URGENTE su dispositivo può segnarlo FUORI_SERVIZIO e la chiusura lo rimette in servizio.
- Job `facility:scadenze` (giornaliero, solo LIVE, fermato da DISABLE_SCHEDULER): scadute; promemoria a 30, 7 e 0 giorni mai doppi (uno per
  sede e stadio, a Facility e ai site manager, email per D7 e D0 se il mailer è configurato; una scadenza nata a 5 giorni riceve solo D7 e
  D30 non parte più); attività dalla fonte impostata; anomalie degli ultimi sei mesi notificate una volta per utenza e mese.
  `POST /api/facility/jobs/scadenze/run { today }` con data di prova fuori produzione.
- KPI: scadenze rispettate % (eseguite entro la data), scadute aperte, prossime 30 giorni, interventi per sede, MTTR (media chiusura -
  apertura in ore), interventi chiusi entro SLA %, costi per sede e per tipologia, dispositivi non conformi e fuori servizio.

## Energy management: formule
- Consumi mensili per utenza: dalle bollette con consumo, ripartendo consumo e importo sui giorni del periodo di fatturazione (senza periodo:
  nel mese precedente la scadenza); se le bollette non riportano consumi, dalle letture (differenza tra letture consecutive ripartita sui
  giorni; un valore in calo è un contatore sostituito e si scarta). I costi vengono sempre dalle bollette.
- kWh equivalenti = quantità × fattore (elettrico e teleriscaldamento 1, gas 10,69 kWh/Smc, gasolio 10 kWh/l, acqua 0). CO2 = quantità ×
  fattore (elettrico ~0,26 kg/kWh, gas ~1,98 kg/Smc, gasolio ~2,65 kg/l, teleriscaldamento ~0,20 kg/kWh: indicativi, modificabili nelle
  impostazioni o per utenza). Costo unitario = spesa / quantità (€/kWh, €/Smc, €/m3).
- Intensità: kWh/m2 anno = kWh dell'anno × 12 / mesi con dati / superficie (annualizzato se i mesi sono meno di 12); kWh per accettazione e
  per ora di apertura sui soli mesi con consumi (ore da attività o stimate dalle ore settimanali dell'immobile × giorni del mese / 7);
  kgCO2/m2. Per la rete contano solo le sedi con consumi.
- Anno su anno: mese per mese e cumulato da inizio anno sugli stessi mesi; la variazione nei KPI confronta gli stessi mesi (non l'anno
  precedente intero).
- Anomalie: mese oltre la soglia (predefinita +20%) rispetto allo stesso mese dell'anno prima o alla media dei tre mesi precedenti.
- Classifica tra sedi a parità di attività: kWh per accettazione, per m2 anno, per ora; posizione e scarto dalla media.
- Fasce di benchmark per tipologia (kWh/m2 anno, ampie e da tarare, "letteratura di settore / ENEA", non limiti normativi): punti prelievo
  60-200, centri medici e poliambulatori 80-250, diagnostica per immagini 120-400, laboratori 150-500, uffici 50-180.
- Obiettivi: riduzione ottenuta = (base - anno) / base sugli stessi mesi; stato RAGGIUNTO (≥ obiettivo), IN_LINEA (≥ metà), FUORI_LINEA.
- Analisi con Claude (facoltativa, Facility): `askJson` kind `facility_energia`, solo dati aggregati; commento, anomalie, azioni per
  urgenza, note per il riesame; senza chiave 400 "Intelligenza artificiale non configurata"; `FACILITY_AI_MOCK=1` solo fuori produzione.
- Report: `GET /report/energia.pdf|xlsx?year&site_id` (PDF con KPI, istogramma mensile anno su anno con i mesi anomali in rosso, vettori,
  confronto, classifiche a barre, anomalie, obiettivi, analisi, metodo; XLSX con Riepilogo, Mensile, Vettori, Classifica, Anomalie,
  Obiettivi, Note), `GET /report/manutenzioni.pdf|xlsx` (KPI, scadenze, interventi, costi), `GET /etichette.pdf` (QR, 2 × 7 per foglio).

## API principali (/api/facility)
state, badges (`scadute`, `urgenti`), dashboard, kpi; immobili, immobili/:siteId (GET, PUT), immobili/:siteId/obblighi, obblighi/:id,
immobili/:siteId/documenti (multipart), documenti/:id (GET, DELETE), documenti/:id/pubblica-room, immobili/:siteId/contratti; utenze (GET,
POST), utenze/:id (GET, PUT), utenze/:id/bollette, bollette/:id, utenze/:id/letture, letture/:id, organizations; energia, energia/attivita
(GET, PUT), energia/attivita/sync, energia/obiettivi, energia/analisi; catalogo, dispositivi (GET, POST), dispositivi/:id (GET, PUT,
DELETE), dispositivi/qr/:token, dispositivi/:id/qr.png|svg, etichette.pdf; piano, piano/:id (GET, PUT), piano/:id/chiudi (multipart),
piano/:id/annulla, piano/genera, piano/:id/files, files/:id; interventi (GET, POST multipart), interventi/:id, /assegna, /stato, /chiudi,
/riapri, /nota, /files, manutentori; report/*; settings (GET, PUT), jobs/scadenze/run. Core: `/api/asset-types` (GET per tutti, scrittura
Owner/Admin). Il QR stampato apre `/facility/qr/<token>`.

## Collaudo (31/10/2026, locale)
Database `suite_fac_t`, porta 3129, FACILITY_AI_MOCK=1, DISABLE_SCHEDULER=true; moduli facility, room, retail avviati con
`POST /api/travaso/<key>/run`; finance creato a mano applicando le sue migrazioni con psql e `module_state` LIVE. Sedi Quarrata (punto
prelievi, 120 m2), Prato (centro medico, 400 m2), Sesto (laboratorio, 900 m2), Legal entity locatore e manutentore, utenti FACILITY, SITE
(grant su Prato), VIEWER, MANUTENTORE esterno. 116 controlli API superati: catalogo con 46 voci e CRUD solo admin; 3 immobili creati al volo;
contratto di Prato in Payments → canone 3.200 € fino al 01/03/2030 nella scheda; utenze elettrica e gas create da Facility → in
`/api/finance/scadenziario/utilities`; 6 bollette su due anni più una da pagare → nello scadenziario di Payments con canone e bolletta;
letture mensili di Quarrata e Sesto, lettura del site manager (403 su sede altrui); attività manuale; indicatori di Prato (142,3 kWh/m2 anno,
2,37 kWh per accettazione, 20,6 kWh per ora), anomalie aprile-giugno 2026 sul trimestre gonfiato (+35%), classifica tra 3 sedi, obiettivo di
rete, analisi simulata, PDF rete e sede (controllati come PNG) e XLSX; 5 dispositivi a Prato con 12 scadenze, controllo dell'estintore
chiuso dal manutentore esterno con rapportino → successiva al 30/04/2027, sorveglianza confermata dal site manager, 403 del site manager
su una manutenzione, registro e QR PNG, etichette, il manutentore esterno vede solo i 2 dispositivi della sua Legal entity, porta REI non
conforme → intervento correttivo; obbligo contrattuale semestrale → scadenza e successiva, avviso a Payments; planimetria PDF su Prato →
`room.struttura_blobs` planPdf e Room la restituisce (`hasPlanPdf`); segnalazione URGENTE del site manager con foto → notifica a Facility,
SLA 24 ore, assegnazione alla Legal entity con notifica al manutentore, in corso, nota, chiusura con MTTR 6 ore entro SLA; KPI e registro
PDF/XLSX; permessi (SITE 403 su sede altrui e Impostazioni, VIEWER 403 in scrittura, MANUTENTORE 403 su Energia e Impostazioni); job con
data forzata: promemoria, nessun doppio allo stesso giorno, scadute a dicembre; badge e contatore della Home. Test
`server/test/facility.test.mjs` (13), build Vite, schermate `docs/screens/facility-{cruscotto,immobile,energia,piano,dispositivo,
catalogo-admin}.png` a 1400x900, nessun errore JavaScript sulle 20 pagine aperte.

## Da verificare / non fatto
- Benchmark del catalogo, SLA, fattori CO2 e fasce di intensità: da confermare con RSPP, Qualità e i dati reali della rete.
- Analisi con la chiave Anthropic reale (qui solo mock); email reali dei promemoria (qui MAIL_PROVIDER=log).
- Nessuna istanza di pagamento automatica dagli obblighi (solo avviso a Payments); nessuna lettura automatica di bollette PDF o di contatori
  intelligenti (le letture SMART si inseriscono come le manuali).
- Regole di accesso nuove solo su `grant_rules` vuota; in produzione aggiungerle a mano.
- Il QR richiede l'accesso alla Suite (nessuna pagina pubblica del dispositivo).
