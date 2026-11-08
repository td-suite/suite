# Modulo Piano Ferie · piano ferie annuale per Area

Modulo nativo della Suite (chiave `ferie`, area PEOPLE, dopo Rubrica e Organigramma). Si avvia vuoto da Amministrazione > Travaso
moduli > "Avvia il modulo" (è in `FRESH_MODULES`), dopo Contratti del personale (che fornisce i contratti).
Codice: `server/src/modules/ferie`, `web/src/modules/ferie`; test: `server/test/ferie.test.mjs` (e la fonte del Cockpit in
`server/test/cockpit-scadenzario.test.mjs`).

## Il funzionamento (stabilito dal CEO, 08/11/2026)
> "Solo l'amministratore (il CEO) vede tutto. Ogni dipendente vede solo la propria area. Il dipendente inserisce il piano ferie annuale.
> Il responsabile dell'Area (approvatore) può modificare il piano dei dipendenti dell'area e poi approvarlo e renderlo definito. Questo è
> il funzionamento!" · "Serve per pianificare il piano ferie annuale per singola area in modo che sia trasparente a tutta l'area il
> piano. Visibilità solo all'interno dell'area. Approva il responsabile o il CEO."

Il modulo è organizzato intorno al **piano annuale**: un piano per persona e anno; il piano dell'area è l'insieme dei piani dei suoi
dipendenti, visibile per intero a tutti i membri dell'area (nomi e periodi, mai di altre aree). Fino alla v0.62.0 il modulo era fatto di
richieste singole approvate una per una: la migrazione 002 le ha riportate dentro i piani (vedi Produzione).

### Stati del piano (`ferie.piani`)
| Stato | Chi lavora | Periodi |
|---|---|---|
| **BOZZA** | il dipendente compila | PIANIFICATA |
| **PROPOSTO** | inviato al responsabile; il dipendente può ancora modificarlo finché non è preso in carico | PIANIFICATA |
| **IN_REVISIONE** | il responsabile lo sta modificando (vi entra con "Prendi in carico" o modificando un periodo) | PIANIFICATA |
| **APPROVATO** | approvato, ancora modificabile dal responsabile; il dipendente propone solo variazioni | APPROVATA (GODUTA a data passata) |
| **DEFINITIVO** | bloccato: cambiano i periodi solo il responsabile o l'amministratore, con motivo; ogni cambio è una variazione registrata e notificata | APPROVATA / GODUTA |

Riapertura: DEFINITIVO → APPROVATO, con motivo. `versione` cresce a ogni approvazione, definitivo, riapertura e variazione. Cronologia in
`ferie.piano_eventi` (CREATO, MIGRATO, PERIODO_AGGIUNTO/MODIFICATO/TOLTO, INVIATO, IN_REVISIONE, APPROVATO, DEFINITIVO, RIAPERTO,
VARIAZIONE_PROPOSTA/APPROVATA/RIFIUTATA, VARIAZIONE, PROMEMORIA); audit della Suite `FERIE_PIANO_*`, `FERIE_AREA_*`, `FERIE_VARIAZIONE_*`.
Regole pure in `lib/pianoAnnuale.js` (`azioniPiano`, `statoPeriodo`, `statoDopoModifica`, `statoDaRichieste`), testate.

### Periodi e variazioni (`ferie.richieste`)
- I periodi restano righe di `ferie.richieste` con `piano_id` (stessi conteggi: giorni lavorativi, mezze giornate, festivi, patrono,
  settimana del contratto; lib/calendario.js). Stati: PIANIFICATA (piano aperto), APPROVATA, GODUTA (job), ANNULLATA (tolto dopo essere
  entrato nel piano; resta come storico), RIFIUTATA (variazione non accolta), RICHIESTA (variazione o permesso ROL in attesa).
- Un periodo sta nell'anno del piano (i periodi a cavallo d'anno si dividono); nessuna sovrapposizione con altri periodi attivi; il
  dipendente non pianifica giorni passati (li registra il responsabile).
- **Variazioni** (dopo l'approvazione, solo il dipendente): aggiunta (riga RICHIESTA con `variazione = true`), spostamento o rimozione
  di un periodo approvato non ancora iniziato (`variazione_proposta` sul periodo). Il responsabile le approva o le rifiuta una per una
  (motivo obbligatorio), il dipendente può ritirarle. Approvata, la variazione entra nel piano (versione +1).
- Chiusure collettive (`ferie.chiusure`, per area o TUTTE): proposte nel piano del dipendente ("Aggiungi al piano") e mostrate nel piano
  dell'area; non creano periodi da sole.

## Chi vede e chi fa cosa
- **ADMIN** (Owner e Admin della Suite = il CEO; HR solo se ha il grant `ferie` ADMIN): tutte le aree e tutti i piani, tutte le azioni
  del responsabile su ogni area (anche sul proprio piano: sopra il CEO non c'è nessuno), Impostazioni, cruscotto completo.
- **Responsabile di area** = approvatore: dal dossier HR (`contracts.person_ext.approver_id`) se c'è, altrimenti il responsabile del nodo
  Sede (per le sedi) o dell'unità di primo livello (Direzione, Laboratorio) dall'organigramma, altrimenti `people_manager()`; deleghe a
  tempo (`ferie.deleghe`); grant RESPONSABILE: tutta l'area delle sedi dell'ambito del grant (`grant_scopes` SITE: laboratorio → LAB,
  sede direzionale → DIR, altre → la sede), senza ambito la propria area. Mai sé stesso. Vede solo le aree dei dipendenti che gestisce
  (piani, saldi e note); modifica i periodi (con nota; motivo obbligatorio nel definitivo), approva, rende definitivo (anche "Approva
  tutta l'area" e "Rendi definitivi"), riapre con motivo, decide le variazioni; copertura e chiusure della propria area; export XLSX/PDF.
  In Direzione, dove le unità di primo livello hanno più responsabili, ciascuno gestisce i propri e vede tutta l'area.
- **Dipendente** (ruolo implicito, `open_to_all`): solo la propria area: il proprio piano (compila, modifica in BOZZA e PROPOSTO non
  preso in carico, invia; poi variazioni) e il piano dei colleghi della propria area (nomi, date e stato, senza saldi, note né giorni;
  le variazioni in attesa dei colleghi non si vedono). Le altre aree rispondono 403 (piano, export) o non compaiono negli elenchi.
- **VIEWER**: consultazione di tutto, sola lettura.
- Cruscotto, storico dei periodi, elenco dipendenti e saldi: ADMIN e VIEWER tutto, il responsabile filtrato sulle proprie aree, il
  dipendente 403. "Oggi e prossimi 14 giorni": solo le aree visibili. Regole di copertura: fuori da ADMIN/VIEWER solo quelle delle aree
  visibili.
- Esterni (partner, clienti service): 403 su tutte le API senza un grant esplicito; la Home li nasconde.

## Interfaccia
- **Il mio piano** (`/ferie?anno=`): calendario dei 12 mesi in cui si aggiungono i periodi trascinando (o cliccando un giorno e
  correggendo la fine); un clic su un periodo lo sposta o lo toglie (o, se approvato, propone la variazione). Riepilogo: da pianificare,
  spettanti, residuo anno precedente, pianificati, goduti, variazioni in attesa, maturati. Stato del piano con la scadenza di invio,
  "Invia al responsabile", chiusure collettive, cronologia; sotto, **Il piano della mia area** (persone × mesi, solo periodi).
- **Piano dell'area** (`/ferie/area?gruppo=&anno=`): conteggio dei piani per stato, giorni scoperti, griglie persone × mesi, persone ×
  settimane, persone × giorni del mese (modifica nella griglia), tabella delle persone con stato, spettanti, pianificati, da pianificare e
  azioni (Prendi in carico, Approva, Rendi definitivo, Riapri), "Approva tutta l'area", "Rendi definitivi", variazioni da decidere,
  copertura minima (rosso), chiusure, export XLSX/PDF. Selettore delle aree per l'ADMIN (e per chi gestisce più aree).
- **Cruscotto** (`/ferie/cruscotto`): piani per stato per area, piani e variazioni da approvare, residui a rischio, non goduto da
  smaltire, saldo per persona con il residuo dell'anno precedente (inserimento a mano o da XLSX, ADMIN).
- Altre pagine: I miei periodi, Variazioni da decidere, Storico dei periodi, Oggi e prossimi 14 giorni, Impostazioni, Guida. Le vecchie
  route (`/ferie/nuova`, `/ferie/piano`, `/ferie/richieste`, `/ferie/approvare`) rimandano alle nuove; `/ferie/richieste/:id` resta il
  dettaglio di un periodo (link delle notifiche della versione precedente).
- Screenshot: `docs/screens/ferie-mio-piano.png`, `docs/screens/ferie-piano-area-responsabile.png`.

## API principali (`/api/ferie`)
`GET /mio-piano?anno`, `GET /aree?anno`, `GET /area?gruppo&anno`; `POST /piani/:id/calcola`; `POST|PUT|DELETE /piani/:id/periodi[/:rid]`
(`nota`: nota o motivo del responsabile); `POST /piani/:id/invia | prendi-in-carico | approva | definitivo | riapri`;
`POST /area/approva | /area/definitivi` (`{ gruppo, anno }`); `POST /piani/:id/variazioni` (`tipo` AGGIUNTA, SPOSTAMENTO, RIMOZIONE);
`POST /variazioni/:rid/approva | rifiuta | ritira`; `GET /richieste?vista=mie|da_approvare|tutte`, `GET /richieste/:id`; `GET /cruscotto`,
`/saldi`, `/persone`; `GET /export/piano.xlsx|pdf?gruppo=<DIR|LAB|SEDE:id|SEDI|TUTTI>&anno[&mese]` (solo aree visibili; codici F
approvato, ½ mezza giornata, N nel piano da approvare, A variazione in attesa, P permesso ROL; colonna dello stato del piano).

## Perimetro e Area
- **Chi c'è**: persone di `public.people` di tipo DIPENDENTE (e DIRIGENTE, impostazione `includi_dirigenti`, predefinita sì) in stato
  ATTIVO con una riga in `contracts.employments`. Liberi professionisti, medici e sanitari a incarico esclusi. Senza Contratti del
  personale avviato il perimetro è vuoto e il modulo lo dice.
- **Area** (lib/perimetro.js `areaPersona`), dall'unità della persona risalendo l'organigramma: Laboratorio se la sede dell'unità è di tipo
  LABORATORIO o un'unità della catena è un'AREA "Laboratorio..."; Direzione se la persona afferisce al vertice, l'unità di primo livello
  è di tecnostruttura (STAFF) o la sede è HEADQUARTER; altrimenti la sede dell'unità (un'area per sede, mai un punto SERVICE); senza
  unità, la sede di lavoro; senza nulla, "Da assegnare" (cruscotto). Impostazioni > Aree forzate prevale.

## Giorni e saldo (lib/saldi.js, lib/core.js `saldoPersona`)
- Giorni annui da `ferie.spettanze` per CCNL e livello (riga più specifica); riga generale seminata a **26 giorni come ipotesi** da
  verificare sul CCNL; forzatura per persona e anno. Spettanza = giorni annui × mesi lavorati / 12 (un mese conta con almeno
  `soglia_mese_giorni`, 15, ipotesi); maturato a oggi sui mesi conclusi.
- **Pianificato** = somma dei periodi del piano dell'anno (`pianificato_totale`); **goduto** = giorni approvati già passati;
  **residuo** = spettanza + residuo anno precedente − goduto − pianificato futuro; **da pianificare** = residuo − variazioni in attesa
  (mostrato sempre al dipendente e, per ognuno, al responsabile). I periodi di un piano non ancora approvato non diventano "goduti".
- Residuo dell'anno precedente: a mano o da XLSX (modello precompilato, prova senza scrittura, abbinamento per codice fiscale, email,
  Cognome Nome). Avvisi: anno precedente entro `scadenza_ap` (06-30 come indicato dal CEO; il D.Lgs. 66/2003 art. 10 prevede almeno due
  settimane nell'anno e il resto entro 18 mesi: confermare con il consulente del lavoro), residui a rischio (`mesi_rischio` ottobre e
  novembre, da `soglia_rischio_giorni` 10), saldo negativo (anticipo, non bloccato).
- ROL e permessi in ore: voce facoltativa (`rol_attivi`), restano richieste singole (variazione con `tipo_periodo` ROL).

## Copertura minima
`ferie.coperture`: ambito DIR, LAB, SEDE:<id> o KIND:<tipo sede>, ruolo (`job_roles`, della scheda o di un incarico; vuoto = chiunque),
minimo di presenti. Nel piano dell'area contano come assenze tutti i periodi del piano (anche non ancora approvati: il piano si costruisce
guardando la copertura); una variazione si valuta con anche le altre in attesa. Mai bloccante: giorni rossi nelle griglie, avviso sul
periodo (`sotto_copertura`, `copertura`) e nell'export (foglio Copertura). Mezza giornata = mezza presenza.

## Notifiche, job, Home, Cockpit
- Notifiche in app (`notify`, kind FERIE; email solo con `email_attiva`, spenta): invio del piano → responsabile (e delegati; senza
  responsabile gli amministratori), link al piano dell'area; modifica del responsabile, approvazione, definitivo, riapertura, variazione
  decisa → dipendente, link a "Il mio piano"; variazione proposta → responsabile.
- Job `ferie:promemoria` (giornaliero, modulo LIVE; Impostazioni > "Esegui ora"): GODUTA ai periodi approvati conclusi; promemoria ai
  dipendenti con il piano in BOZZA da `promemoria_scadenza_giorni` (7) prima della scadenza di invio dell'anno (`scadenze_piano`,
  `{ 'AAAA': 'AAAA-MM-GG' }`, Impostazioni > Generali > Piano annuale; nessun valore predefinito) e dopo, al massimo uno ogni
  `promemoria_giorni`; promemoria al responsabile per i piani inviati e le variazioni in attesa da più di `promemoria_giorni` (3), al
  massimo uno al giorno.
- Home (`lib/home.js`, contatore per utente): ADMIN = piani (e variazioni) da approvare di tutte le aree; responsabile = quelli dei
  dipendenti che gestisce (se zero, i propri giorni da pianificare); dipendente = "giorni da pianificare" dell'anno, o "piano definitivo".
- Cockpit, scadenzario di direzione (`server/src/lib/scadenzario.js`, fonte `ferie`, riservata): scadenza di invio del piano con i piani
  ancora in bozza, piani inviati da approvare, piani approvati non definitivi (una riga per anno, `righeFeriePiani`), variazioni in
  attesa, chiusure, residuo dell'anno precedente (docs/COCKPIT.md).

## Produzione
1. **Migrazione `002_piano_annuale.sql`** (si applica da sola all'avvio sui moduli già avviati; idempotente, non distruttiva): crea
   `ferie.piani` e `ferie.piano_eventi`; aggiunge a `ferie.richieste` `piano_id`, `variazione`, `variazione_proposta`,
   `modificata_da_user_id`, `modificata_at`; allarga i vincoli di stato (PIANIFICATA e i nuovi eventi), nessun valore tolto. Crea un piano
   per ogni dipendente del perimetro per l'anno corrente e il prossimo, più un piano per ogni persona e anno che ha già richieste; aggancia
   ogni richiesta al suo piano: APPROVATA e GODUTA restano periodi approvati, RICHIESTA in attesa (ferie) diventa periodo proposto
   (PIANIFICATA, evento MIGRATA), RIFIUTATA e ANNULLATA restano come storico. Il piano nasce BOZZA, o APPROVATO (data e decisore
   dall'ultima approvazione) se ha almeno una richiesta attiva e sono tutte approvate. Rapporto in `public.audit_log`
   (`MIGRAZIONE_RAPPORTO`, `ferie/002_piano_annuale.sql`): piani creati dal perimetro e dalle richieste, piani per anno e stato,
   richieste da agganciare per stato, agganciate, in attesa diventate periodi proposti, senza piano.
2. Dopo la pubblicazione: leggere il rapporto; avvisare i dipendenti che avevano richieste in attesa (ora periodi del piano in bozza:
   devono inviare il piano); il catalogo aggiorna le etichette dei profili (Amministratore, Responsabile di area, Consultazione).
3. Accessi: il CEO (Owner) è ADMIN; HR vede tutto solo con il grant `ferie` ADMIN (assegnarlo o toglierlo consapevolmente); i responsabili
   dall'organigramma non hanno bisogno di grant; RESPONSABILE facoltativo.
4. Impostazioni: scadenza di invio del piano per l'anno (es. il piano 2027), giorni annui per CCNL e livello, patroni delle sedi, regole di
   copertura, chiusure, residuo dell'anno precedente (modello XLSX), `email_attiva`, scadenza del residuo.
5. Controllare nel cruscotto "Da assegnare" e i responsabili mancanti (senza responsabile approva l'amministratore).
