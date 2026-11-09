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

## Chi approva: il superiore diretto dell'organigramma (stabilito dal CEO, 09/11/2026)
> "Dobbiamo recepire non solo le aree ma anche il secondo livello. Esempio: Masseria la approva Malenchini, non io. Le mie ferie non
> devono essere approvate perché non ho nessuno sopra in organigramma. Segui pedissequamente quanto indicato in organigramma. Segui quindi
> chi approva, come indicato in organigramma."

1. **Approvatore = superiore diretto** della persona nell'anagrafica: `public.people_manager(id)`, cioè "Dipende da" di Amministrazione >
   Persone (per chi ha incarichi il responsabile calcolato dall'organigramma, per gli altri `people.manager_person_id` impostato a mano,
   che prevale; NULL per il vertice). Nessun altro criterio: non più il dossier HR (`contracts.person_ext.approver_id`, campo tolto dal
   form di Contratti del personale e ignorato), né il responsabile della sede o dell'unità di primo livello, né il grant RESPONSABILE, né le
   aree forzate. Restano le **deleghe a tempo** (`ferie.deleghe`: il delegato approva i diretti del delegante durante la delega) e
   l'**ADMIN**, che interviene sempre. Il modulo legge l'anagrafica e basta: nessuna tabella propria, nessuna copia dell'organigramma
   (lib/superiori.js, `nodiSuperiori` in lib/perimetro.js con una query ricorsiva su `people_manager`; cache del perimetro di 30 secondi).
2. **Risalita**: se il superiore è cessato o non ha un accesso attivo alla Suite, approva il superiore del superiore (e così via); la
   scheda lo dice ("risale a X: Y è cessato"). Se nessuno è raggiungibile, decide l'amministratore (notifiche agli amministratori).
3. **Il vertice** (persona senza superiore con un accesso OWNER attivo: il CEO) non ha approvazione: all'invio il piano diventa subito
   **DEFINITIVO** con l'annotazione "senza approvatore in organigramma" (`nota_approvatore`, eventi INVIATO e DEFINITIVO con
   `senza_approvatore`); le sue variazioni entrano subito nel piano con la stessa annotazione. Il bottone è "Rendi definitivo".
4. **Senza superiore e non vertice**: anomalia dell'anagrafica (Diagnostica D43). L'invio funziona ma avvisa il dipendente e gli
   amministratori; il piano non ha un approvatore e lo decide solo l'amministratore (contatore dell'ADMIN).
5. **Catena**: il responsabile modifica, approva e rende definitivi i piani dei **diretti**; i livelli sotto (diretti dei diretti, e così
   via, dall'albero dell'anagrafica) li vede con stato e saldi in **sola lettura** (403 sulle azioni: "lo approva X"). Nessuno approva il
   proprio piano, nemmeno l'ADMIN (`puoGestire(pid)` è falso su sé stessi).
6. La **vista per area** resta per la trasparenza interna all'area; ogni riga dice "approva: <nome>". Nuova vista **La mia catena**
   (`/ferie/catena`): albero dei riporti con stato del piano, spettanti, pianificati, da pianificare e le azioni sui diretti; l'ADMIN
   sceglie da quale persona partire. "Il mio piano" mostra in cima chi approva e da dove viene.
7. Il caso "Stabile aggancialo a me": in Amministrazione > Persone, Stabile Federico → Dipende da = Epifani (`manager_person_id`): il Piano
   Ferie lo legge da lì e il piano va a Epifani (verificato nel collaudo).

Il modulo è organizzato intorno al **piano annuale**: un piano per persona e anno; il piano dell'area è l'insieme dei piani dei suoi
dipendenti, visibile per intero a tutti i membri dell'area (nomi e periodi, mai di altre aree). Fino alla v0.62.0 il modulo era fatto di
richieste singole approvate una per una: la migrazione 002 le ha riportate dentro i piani (vedi Produzione).

### Stati del piano (`ferie.piani`)
| Stato | Chi lavora | Periodi |
|---|---|---|
| **BOZZA** | il dipendente compila | PIANIFICATA |
| **PROPOSTO** | inviato al superiore diretto; il dipendente può ancora modificarlo finché non è preso in carico | PIANIFICATA |
| **IN_REVISIONE** | il responsabile lo sta modificando (vi entra con "Prendi in carico" o modificando un periodo) | PIANIFICATA |
| **APPROVATO** | approvato, ancora modificabile dal responsabile; il dipendente propone solo variazioni | APPROVATA (GODUTA a data passata) |
| **DEFINITIVO** | bloccato: cambiano i periodi solo il responsabile o l'amministratore, con motivo; ogni cambio è una variazione registrata e notificata | APPROVATA / GODUTA |

Riapertura: DEFINITIVO → APPROVATO, con motivo. `versione` cresce a ogni approvazione, definitivo, riapertura e variazione. Cronologia in
`ferie.piano_eventi` (CREATO, MIGRATO, PERIODO_AGGIUNTO/MODIFICATO/TOLTO, INVIATO, IN_REVISIONE, APPROVATO, DEFINITIVO, RIAPERTO,
VARIAZIONE_PROPOSTA/APPROVATA/RIFIUTATA, VARIAZIONE, PROMEMORIA, RIASSEGNATO della migrazione 003); audit della Suite `FERIE_PIANO_*`, `FERIE_AREA_*`, `FERIE_VARIAZIONE_*`.
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
- **ADMIN** (Owner e Admin della Suite = il CEO; HR solo se ha il grant `ferie` ADMIN): vede tutte le aree e tutti i piani e può
  intervenire su ogni piano al posto del superiore diretto (mai sul proprio: il CEO non ha approvazione), Impostazioni, cruscotto completo.
- **Superiore diretto** (dall'anagrafica, vedi sopra; o il suo delegato con delega attiva) = approvatore dei **diretti**: li vede con saldi e
  note, modifica i periodi (con nota; motivo obbligatorio nel definitivo), approva, rende definitivo (anche "Approva tutta l'area" e
  "Rendi definitivi", che toccano solo i suoi diretti), riapre con motivo, decide le variazioni. I **livelli sotto** della sua catena li
  vede con stato e saldi in sola lettura. Le aree visibili sono la propria e quelle dei riporti; esportazioni XLSX/PDF delle aree visibili.
- **Grant RESPONSABILE**: solo visibilità (in sola lettura) delle aree delle sedi del suo ambito (`grant_scopes` SITE: laboratorio → LAB,
  sede direzionale → DIR, altre → la sede); non approva più nessuno.
- **Dipendente** (ruolo implicito, `open_to_all`): solo la propria area: il proprio piano (compila, modifica in BOZZA e PROPOSTO non
  preso in carico, invia; poi variazioni) e il piano dei colleghi della propria area (nomi, date, stato e chi approva, senza saldi, note
  né giorni; le variazioni in attesa dei colleghi non si vedono). Le altre aree rispondono 403 (piano, export) o non compaiono.
- **DIPENDENTE (Utente)**: compila il proprio piano e vede quello della propria area; è il ruolo implicito di ogni interno, il grant esplicito serve solo a chi vuole assegnarlo a mano. Il profilo Consultazione (VIEWER) è stato tolto l'08/11/2026 su indicazione del CEO (migrazione core 049: i grant VIEWER diventano DIPENDENTE).
- Cruscotto, storico dei periodi, elenco dipendenti e saldi: ADMIN tutto, chi ha riporti la propria catena, il dipendente 403. "Oggi e
  prossimi 14 giorni": solo le aree visibili. Regole di copertura: fuori da ADMIN solo quelle delle aree visibili.
- Esterni (partner, clienti service): 403 su tutte le API senza un grant esplicito; la Home li nasconde.

## Interfaccia
- **La mia catena** (`/ferie/catena?anno=[&person_id=]`): per chi ha riporti nell'anagrafica e per l'ADMIN; screenshot
  `docs/screens/ferie-catena.png`.
- **Il mio piano** (`/ferie?anno=`): riquadro "Chi approva il tuo piano" (superiore, risalita, vertice, anomalia); calendario dei 12 mesi in cui si aggiungono i periodi trascinando (o cliccando un giorno e
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
`GET /mio-piano?anno` (persona: `superiore`, `approvatore`, `approvatore_origine`, `risalito`, `vertice`, `senza_superiore`),
`GET /aree?anno`, `GET /area?gruppo&anno` (per persona `approva`, `sola_lettura`), `GET /catena?anno[&person_id]` (albero dei riporti); `POST /piani/:id/calcola`; `POST|PUT|DELETE /piani/:id/periodi[/:rid]`
(`nota`: nota o motivo del responsabile); `POST /piani/:id/invia` (vertice → DEFINITIVO; risposta con `avviso` per risalita o senza superiore) `| prendi-in-carico | approva |
definitivo | riapri`;
`POST /area/approva | /area/definitivi` (`{ gruppo, anno }`); `POST /piani/:id/variazioni` (`tipo` AGGIUNTA, SPOSTAMENTO, RIMOZIONE);
`POST /variazioni/:rid/approva | rifiuta | ritira`; `GET /richieste?vista=mie|da_approvare|tutte`, `GET /richieste/:id`; `GET /cruscotto`,
`/saldi`, `/persone`; `GET /export/piano.xlsx|pdf?gruppo=<DIR|LAB|SEDE:id|SEDI|TUTTI>&anno[&mese]` (solo aree visibili; codici F
approvato, ½ mezza giornata, N nel piano da approvare, A variazione in attesa, P permesso ROL; colonna dello stato del piano).

## Perimetro e Area
- **Chi c'è**: persone di `public.people` di tipo DIPENDENTE (e DIRIGENTE, impostazione `includi_dirigenti`, predefinita sì) in stato
  ATTIVO con una riga in `contracts.employments`. Liberi professionisti, medici e sanitari a incarico esclusi. Senza Contratti del
  personale avviato il perimetro è vuoto e il modulo lo dice.
- **Area** (lib/perimetro.js `areaPersona`; decide solo la VISIBILITÀ del piano dell'area, mai chi approva), dall'unità della persona risalendo l'organigramma: Laboratorio se la sede dell'unità è di tipo
  LABORATORIO o un'unità della catena è un'AREA "Laboratorio..."; Direzione se la persona afferisce al vertice, l'unità di primo livello
  è di tecnostruttura (STAFF) o la sede è HEADQUARTER; altrimenti la sede dell'unità (un'area per sede, mai un punto SERVICE); senza
  unità, la sede di lavoro; senza nulla, "Da assegnare" (cruscotto). Impostazioni > Aree (visibilità) prevale.

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
- Notifiche in app (`notify`, kind FERIE; email solo con `email_attiva`, spenta): invio del piano → superiore diretto (o il primo
  superiore attivo con accesso risalendo) e i suoi delegati; senza approvatore raggiungibile gli amministratori; mai l'Owner per i piani
  che non sono dei suoi diretti; link al piano dell'area; modifica del responsabile, approvazione, definitivo, riapertura, variazione
  decisa → dipendente, link a "Il mio piano"; variazione proposta → responsabile.
- Job `ferie:promemoria` (giornaliero, modulo LIVE; Impostazioni > "Esegui ora"): GODUTA ai periodi approvati conclusi; promemoria ai
  dipendenti con il piano in BOZZA da `promemoria_scadenza_giorni` (7) prima della scadenza di invio dell'anno (`scadenze_piano`,
  `{ 'AAAA': 'AAAA-MM-GG' }`, Impostazioni > Generali > Piano annuale; nessun valore predefinito) e dopo, al massimo uno ogni
  `promemoria_giorni`; promemoria al superiore diretto (destinatari ricalcolati dall'anagrafica del giorno) per i piani inviati e le
  variazioni in attesa da più di `promemoria_giorni` (3), al massimo uno al giorno.
- Home (`lib/home.js`, contatore per utente) e badge del menu: "piani da approvare" = quelli dei **diretti** (e, per l'ADMIN, quelli
  senza approvatore raggiungibile); se zero, i propri giorni da pianificare; dipendente = "giorni da pianificare" dell'anno, o "piano definitivo".
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
6. **Migrazione `003_approvatore_superiore.sql`** (09/11/2026; si applica da sola all'avvio; idempotente e non distruttiva): vincolo degli
   eventi del piano allargato a RIASSEGNATO; per ogni persona con un piano PROPOSTO o IN_REVISIONE o con variazioni in attesa calcola
   l'approvatore effettivo (superiore diretto, con la risalita) e aggiorna `richieste.approvatore_person_id` dei periodi aperti; i piani
   inviati restano inviati con l'evento RIASSEGNATO (uno solo per piano anche se rieseguita) e il promemoria azzerato; i piani inviati del
   vertice (Owner senza superiore) diventano DEFINITIVI "senza approvatore in organigramma" con i periodi approvati (goduti se passati);
   chi non ha superiore e non è il vertice resta inviato senza approvatore (lo decide l'ADMIN) ed è elencato. Rapporto
   `MIGRAZIONE_RAPPORTO` `ferie/003_approvatore_superiore.sql`: piani riassegnati (dettaglio), periodi riassegnati, piani del vertice resi
   definitivi, senza superiore da sistemare in anagrafica, senza superiore attivo con accesso, approvatori del dossier HR non più usati,
   piani per stato. Scelta: la regola "i piani di chi non ha superiore diventano DEFINITIVI" è applicata al solo vertice (l'Owner); per
   gli altri senza superiore vale la regola della Diagnostica (il piano non può essere approvato: si sistema l'anagrafica).
7. Dopo la pubblicazione: leggere il rapporto della 003; Amministrazione > Diagnostica: **D43 "Dipendenti senza superiore in anagrafica"**
   (BLOCCANTE; esclusa l'unica persona al vertice, l'Owner) e **D44 "Superiore cessato o senza accesso"** (ATTENZIONE), con il link alla
   scheda persona: impostare "Dipende da" dove manca (es. Stabile Federico → Epifani); avvisare i responsabili della nuova vista "La mia
   catena". Il catalogo aggiorna l'etichetta del profilo RESPONSABILE (solo visibilità).
