# Modulo Rimborso Spese · nota spese mensile e rimborso chilometrico

Modulo nativo della Suite (chiave `rimborsi`, area PEOPLE, widget "Rimborso Spese", tagline "Nota spese e rimborso chilometrico"), v0.72.0.
Si attiva da solo all'avvio (`afterStart`: schema `rimborsi`, LIVE, seme delle eccezioni). Codice: `server/src/modules/rimborsi`,
`web/src/modules/rimborsi`; benefit vettura e fuel card in `server/src/modules/contracts` (migrazione 021, `lib/benefitAuto.js`,
`routes/benefit.js`) e `web/src/modules/contracts/components/BenefitAuto.jsx`. Test: `server/test/rimborsi.test.mjs`.

## Richiesta del CEO (13/11/2026)
> Widget "Rimborso Spese" nell'area HR (PEOPLE), accessibile SOLO ai dipendenti e a nessun altro; approvazione secondo l'organigramma;
> compilazione mensile, archiviazione, invio al responsabile, approvazione del responsabile; nella stessa scheda Rimborso Chilometrico e
> Rimborso Spese; assegnare al personale l'eventuale vettura aziendale definita in Contratti del Personale quando c'è il benefit e le Fuel
> Card (DKV, di cui si riportano i numeri); fotografia dello scontrino e relativa archiviazione, obbligatoria per tutti TRANNE Epifani,
> Zezza, Malenchini e Corradi, per i quali è facoltativa.

Riferimenti SGI: **TD-SGI-MOD025** Modulo Rimborso Spese e **TD-SGI-MOD029** Modulo Rimborso Chilometrico, revisione 00 del 12/04/2026,
procedura **TD-SGI-PRO024** (con TD-SGI-IDL006 CCNL e TD-SGI-IDL008 TeamSystem HR). I due PDF in uso sono copiati come risorse del modulo
(`server/src/modules/rimborsi/assets/TD-SGI-MOD025_00_Rimborso_Spese.pdf`, `TD-SGI-MOD029_00_Rimborso_Chilometrico.pdf`) e si scaricano
da ogni pagina principale e dalla scheda mensile ("Scarica il modulo cartaceo MOD025 / MOD029", `GET /api/rimborsi/moduli/MOD025.pdf`,
stessi permessi del modulo). Se lo specchio del SGI Management (modulo `sgi`, LIVE) contiene il codice, accanto c'è il link
`/sgi/doc/TD-SGI-MOD025` (nessuna logica duplicata: si legge solo `sgi.contenuti` chiave `docs`).

## Chi entra (regola SOLO_DIPENDENTI)
- Solo utenti **interni** collegati a una persona `people.kind = 'DIPENDENTE'` in stato `ATTIVO` o `IMPEGNO` (`isDipendente` in
  `lib/access.js`; i dirigenti sono dipendenti dal 09/11/2026, migrazione core 054). Nessun altro: liberi professionisti, medici e
  sanitari, accessi esterni, amministratori e titolare della Suite **se non sono dipendenti**. Il widget non compare in Home né nel
  catalogo (`SOLO_DIPENDENTI` in `routes/core.js`), l'API risponde 403 (`soloDipendenti`), la ricerca globale toglie la voce del modulo.
- Nessun grant da assegnare. Ruoli **calcolati**:
  - **DIPENDENTE**: le proprie note;
  - **RESPONSABILE**: chi ha riporti diretti in organigramma (approva le loro note, vede in sola lettura quelle dei livelli sotto; le bozze
    mai inviate restano del dipendente);
  - **P&C**: dipendenti con il grant ADMIN di Contratti del personale oppure scelti in Impostazioni (`pc_person_ids`): liquidazione,
    archivio completo, impostazioni, export;
  - **TITOLARE**: livello OWNER della Suite (se dipendente): vede tutto, in sola lettura sulle note altrui salvo sia il responsabile.
- Menu in due sezioni separate (v0.72.2): **Personale** (Le mie note spese, Veicoli e fuel card, Il mio archivio: solo le proprie
  note, per chiunque) e **Approvatore** (Da approvare, Archivio approvazioni: solo le note degli altri, mai le proprie né le bozze non
  inviate; catena dei riporti per il responsabile, tutte per P&C e titolare). API: `GET /archivio?ambito=personale|approvatore`
  (default `personale`; `approvatore` risponde 403 a chi non è responsabile, P&C o titolare).

## Chi approva
Il superiore diretto dell'anagrafica (`public.people_manager`, "Dipende da"), come il Piano Ferie (`lib/organigramma.js`, funzioni pure):
- se il superiore è **cessato**, **non ha un accesso** attivo, **non è dipendente** (un LP non entra nel modulo) o è **in ferie oggi** nel
  Piano Ferie (impostazione `risali_se_in_ferie`, predefinita sì), si sale al superiore successivo e la scheda dice perché;
- il responsabile si **congela all'invio** (`note.responsabile_person_id`); P&C o il titolare possono "Ricalcola il responsabile";
- **nessuno approva né liquida la propria nota** (anche P&C);
- il **vertice** dell'organigramma (nessun superiore) che è il titolare (OWNER dipendente) ha l'**approvazione automatica alla
  conferma** (CEO, 13/11/2026: "La mia nota spese è automaticamente approvata dopo la mia conferma"): l'invio porta la nota subito ad
  APPROVATA (eventi INVIATA e APPROVATA "Approvata automaticamente: nessun superiore in organigramma", approvatore = sé stesso con la
  dicitura "approvazione automatica del vertice", colonna `approvazione_automatica`), poi IN LIQUIDAZIONE come le altre; nel PDF la casella
  Responsabile riporta "Approvazione automatica (vertice dell'organigramma)". Il pulsante diventa "Conferma e approva"; P&C può solo
  rimandarla al dipendente;
- chi ha un superiore **non raggiungibile** (o un dipendente senza superiore che non è il titolare, anomalia dell'anagrafica) continua a
  salire e va a **P&C**, che fa da secondo controllo (`al_pc`).

## La nota mensile
Una per dipendente e mese (`UNIQUE (person_id, anno, mese)`), mai per mesi futuri. Nella stessa scheda:
- **A · Spese (MOD025)**: data, descrizione, categoria, importo (EUR), pagamento (anticipata dal dipendente / carta aziendale / fuel card),
  motivazione, cliente (Legal entity, facoltativo) o progetto, giustificativi (uno o più file).
- **B · Chilometri (MOD029)**: data, tratta da-a, andata e ritorno, motivazione, km del percorso (sola andata; raddoppiati con A/R),
  veicolo, tariffa congelata sulla riga, importo = km totali × tariffa (2 decimali). Pedaggi e parcheggi sono spese di categoria Pedaggi o
  Parcheggi, collegabili al viaggio, e finiscono nel riepilogo del MOD029.
- **Riepilogo**: spese documentate (MOD025, senza pedaggi e parcheggi), totale km e rimborso chilometrico, pedaggi, parcheggi, totale
  rimborsabile, anticipi ricevuti, pagato con carta aziendale o fuel card (non rimborsabile, solo riconciliazione), righe escluse,
  **saldo = totale rimborsabile - anticipi** (positivo a favore del dipendente, negativo a favore dell'azienda). Funzione pura
  `riepilogo` in `lib/calcoli.js`, totali salvati sulla nota a ogni modifica.

### Tariffa chilometrica
`tariffa_km_default` è **vuota**: nessuna tariffa inventata. La tariffa sta sul **veicolo proprio** del dipendente (marca, modello, targa,
alimentazione, tariffa EUR/km e **fonte obbligatoria**, es. "tabelle ACI 2026, modello"), inserita dal dipendente o da P&C. Senza tariffa
il viaggio si registra ma la nota **non si invia**; quando la tariffa arriva completa i viaggi delle bozze rimasti senza.

### Vettura aziendale e fuel card (Contratti del personale)
Nella scheda della persona di Contratti del personale, sezione **"Benefit: vettura e fuel card"** (solo profili ADMIN e HR del modulo, e
il titolare): vettura (marca, modello, targa, alimentazione, dal, al, uso promiscuo, note) e fuel card (circuito, es. DKV; numero per
intero, mostrato mascherato con "Mostra"; **PIN mai salvato**, un campo pin è rifiutato; dal, al; vettura collegata). Tabelle
`contracts.benefit_vetture` e `contracts.benefit_fuel_card` (migrazione 021, idempotente). L'assegnazione aggiunge al jsonb
`employments.benefits` la voce "Vettura aziendale" / "Fuel card" (se manca una voce equivalente) e la toglie quando non ce n'è più
nessuna in corso. **Nessun dato reale nel seme**: targhe e numeri li inserisce il CEO.
Nel Rimborso Spese (`assegnazioniPersona`, lettura diretta, nessuna copia):
- con una vettura in corso nel mese la sezione Chilometri dice "Hai una vettura aziendale: i chilometri non sono rimborsabili" e ogni
  viaggio diventa registro dei viaggi di servizio (AZIENDALE, importo 0);
- il carburante pagato con la fuel card è una spesa con pagamento "Fuel card" e la carta scelta: non rimborsabile;
- il numero è per intero al dipendente assegnatario, a P&C e al titolare; mascherato (ultime 4 cifre) al responsabile.
- Pagine "Le mie note spese" e "Veicoli e fuel card": "La tua vettura aziendale", "Le tue fuel card".

### Giustificativi
Dal telefono: "Scatta la foto" (`<input type="file" accept="image/*,application/pdf" capture="environment">`) e "Carica file" (galleria,
PDF), anteprima, più file per riga (fino a 6), **compressione nel browser** (lato lungo 1600 px, JPEG; un HEIC che il browser non decodifica
si carica com'è). Archivio a due vie della Suite (`lib/moduleStorage.js`: Azure Blob se configurato, altrimenti nel database), SHA-256,
dimensione, chi e quando. Tipo riconosciuto dalla firma dei byte (JPEG, PNG, WEBP, PDF; HEIC dall'estensione). Si eliminano solo in
bozza. Download e anteprima con gli stessi permessi della nota (404 a chi non la vede). ZIP della nota con indice e impronte.
**Obbligatorio** per inviare, per ogni spesa di categoria con il flag "giustificativo obbligatorio", per tutti tranne chi ha
l'**eccezione** (`rimborsi.eccezioni`). Testo fisso in pagina e nel PDF: "Allegare tutti i giustificativi originali (ricevute, fatture,
scontrini). I rimborsi senza giustificativo non saranno liquidati." (con la nota "facoltativo" per le eccezioni).

### Eccezioni (seme del CEO)
Seme: le persone **attive** con cognome Epifani, Zezza, Malenchini, Corradi **solo se trovate in modo univoco per cognome**; altrimenti la
voce resta senza persona e compare in Diagnostica **D58**, che segnala anche le eccezioni abbinate a persone che non sono dipendenti attivi
(nell'anagrafica del 25/10/2026 Malenchini e Corradi risultano LP: se è ancora così non entrano nel modulo e l'eccezione non ha effetto).
Il seme si riprova a ogni avvio per le voci non abbinate; P&C e titolare abbinano a mano (omonimi), aggiungono o eliminano (una voce del
seme eliminata non torna).

### Categorie
Seme: Vitto, Alloggio, Trasporti pubblici, Taxi/NCC, Carburante, Pedaggi, Parcheggi, Rappresentanza, Materiale di consumo, Formazione, Altro.
Massimale per spesa e al giorno **vuoti** (nessun importo di policy inventato): se P&C li imposta, il superamento è un avviso al dipendente
e al responsabile, non un blocco. Giustificativo obbligatorio sì per tutte (modificabile).

## Flusso e regole
| Stato | Chi | Cosa |
|---|---|---|
| BOZZA | dipendente | compila; solo lui modifica |
| INVIATA | responsabile (P&C se nessun superiore è raggiungibile; il vertice salta allo stato APPROVATA) | approva, respinge con motivo (torna in BOZZA con lo storico), esclude righe con motivo |
| APPROVATA | P&C | prende in carico, liquida, rimanda al responsabile o al dipendente con motivo |
| IN_LIQUIDAZIONE | P&C | liquida (data, importo, riferimento del cedolino o del bonifico), rimanda |
| LIQUIDATA | P&C | archivia |
| ARCHIVIATA | tutti in lettura | PDF definitivo salvato con la nota (`pdf_allegato_id`) |

- **Finestra di invio**: entro il giorno N del mese successivo (`giorno_limite`, predefinito 10); oltre, l'invio resta possibile con
  l'avviso e il segno "in ritardo". Un mese non finito si invia con l'avviso che poi non si aggiunge nulla.
- **Bloccanti dell'invio**: nota vuota, date fuori dal mese o future (bloccate anche all'inserimento), giustificativo mancante (salvo
  eccezione), tariffa mancante, motivazione mancante (sulla riga o generale della nota).
- **Avvisi**: doppioni (stessa data, importo e categoria nello stesso mese o in altri mesi), massimali, ritardo.
- Nessuna modifica dopo l'invio se non tramite respingimento o rimando; **mesi liquidati bloccati** (la nota del mese esiste già e non è in
  bozza; le date fuori mese non passano).
- Storico completo in `rimborsi.eventi` (CREATA, INVIATA, RESPINTA, RIGA_ESCLUSA, RIGA_INCLUSA, APPROVATA, IN_LIQUIDAZIONE, RIMANDATA_*,
  LIQUIDATA, ARCHIVIATA, RESPONSABILE_RICALCOLATO, PROMEMORIA) e audit della Suite `RIMBORSI_*` e `CONTRACTS_BENEFIT_*`.
- **Notifiche** nella Suite ed **email** (impostazione `email_attiva`, predefinita sì, solo agli utenti con email e notify_email):
  invio al responsabile, approvazione, respingimento, rimandi, liquidazione.
- **Job `rimborsi:promemoria`** (ogni ora, dalle 8, solo LIVE, `DISABLE_SCHEDULER` lo ferma): al dipendente con la bozza del mese precedente
  dal giorno N-3 (una volta al giorno); al responsabile con note in attesa da più di 5 giorni (`promemoria_responsabile_giorni`); a P&C il
  riepilogo delle approvate da liquidare (una volta al giorno). Avvio a mano da Impostazioni.

## Pagine
- **Le mie note spese** (`/rimborsi`): mese corrente in evidenza, "Nuova spesa" (foto, importo, categoria, data; descrizione facoltativa;
  la spesa va nella nota del mese della data) e "Nuovo viaggio" pensati per il telefono, elenco dei mesi con stato e saldo, apertura della
  nota di un mese passato, vettura e fuel card, regole e modulistica.
- **Scheda mensile** (`/rimborsi/nota/:id`): dati della nota, A Spese, B Chilometri, riepilogo, firme elettroniche e storico, PDF, ZIP,
  azioni del ruolo.
- **Veicoli e fuel card**, **Archivio** (per anno, mese, stato, ricerca; P&C e titolare tutti), **Da approvare** (responsabili),
  **Liquidazione** (P&C, export Excel), **Impostazioni** (P&C e titolare: generali, P&C, categorie, eccezioni, approvatori, promemoria).
- Telefono prima di tutto per il dipendente (nessuno scorrimento orizzontale, pulsanti alti 52-56 px, campi a 16 px), colonne su schermo
  largo per approvazione e liquidazione. Schermate: `docs/screens/rimborsi-mese.png`, `rimborsi-mobile-nuova-spesa.png`,
  `rimborsi-da-approvare.png`.

## Invio del PDF di approvazione (destinatari esterni)
Richiesta del CEO del 13/11/2026: "Dopo che il rimborso spese è stato approvato, invia il PDF di approvazione a Poggiali Angela e Caiani
Matteo. Invia la mail da people@toscanadiagnostica.it."
- **Attenzione: a ogni approvazione parte verso l'esterno dell'azienda (consulente del lavoro) un documento con i dati di spesa del
  dipendente** (righe, chilometri, saldo, nome). Lo dicono anche Impostazioni e, prima dell'approvazione, la scheda della nota ("All'approvazione
  il PDF viene inviato a: …").
- A ogni passaggio ad APPROVATA (manuale o automatico del vertice) la Suite invia **una** email con allegato il PDF della nota approvata
  (quello che riproduce MOD025 e MOD029 con le attestazioni di invio e approvazione). Oggetto "Rimborso spese approvato · Cognome Nome ·
  mese anno"; corpo con dipendente, mese, totale rimborsabile, approvato da e quando, "in allegato la nota spese approvata", firma "People ·
  Toscana Diagnostica". Solo il PDF; i giustificativi solo con l'impostazione `allega_giustificativi` (predefinita no).
- Mittente `mittente_approvazione` (predefinito people@toscanadiagnostica.it) con `sendMail` della Suite (parametro `from`: Graph
  `/users/<mittente>/sendMail`, la stessa via dei richiami di Contratti; registro `email_log` con `from_addr` e `ref` =
  `rimborsi:<nota>:approvazione`). Serve il permesso Mail.Send dell'applicazione anche su people@ (se c'è una Application Access Policy,
  deve includerla).
- Destinatari `destinatari_approvazione` (nome ed email, seme: Poggiali Angela <a.poggiali@confindustriaservizicentroecosta.it>, Caiani
  Matteo <m.caiani@confindustriaservizicentroecosta.it>), modificabili da P&C e titolare; interruttore `invio_approvazione_attivo`
  (predefinito acceso). Ogni modifica è nell'audit `RIMBORSI_IMPOSTAZIONI`.
- **Un errore d'invio non annulla l'approvazione**: l'errore va in `email_log` (FAILED), nell'esito sulla nota (`email_approvazione_*`,
  migrazione rimborsi 002) e nello storico; la scheda mostra "Email al consulente non inviata: <errore>" con **Reinvia** per P&C e titolare.
- Storico: evento PDF_APPROVAZIONE "PDF di approvazione inviato a …" con l'esito. Una nota approvata, rimandata indietro da P&C e
  riapprovata riparte con l'oggetto "… (aggiornata)".

## Documenti
- **PDF della nota** (`GET /api/rimborsi/note/:id/pdf`): intestazione SGI con i codici TD-SGI-MOD025_00 e TD-SGI-MOD029_00 e i riferimenti,
  dati del richiedente, tabella delle spese, spese con carta, tabella dei chilometri, pedaggi e parcheggi, riepilogo, le tre "firme" come
  attestazioni elettroniche (invio, approvazione, liquidazione: nome, data e ora), testo fisso sui giustificativi, elenco dei giustificativi
  con miniatura (foto) o tipo (PDF) e impronta SHA-256; dati aziendali da Impostazioni > Dati aziendali. Provvisorio fino all'archiviazione.
- **ZIP dei giustificativi** con `indice.txt`. **Export Excel** per P&C (Riepilogo, Per categoria, Spese, Chilometri). TeamSystem HR è citato
  nei moduli ma **non c'è integrazione**: solo export.

## Collegamenti
- **Scadenzario di direzione** (fonte `rimborsi`, riservata come contracts e ferie): note in attesa oltre la soglia del promemoria e note
  approvate non liquidate da oltre 10 giorni. **Cockpit**: nessuna tessera nuova, solo le scadenze.
- **Finance Management**: le note LIQUIDATE o ARCHIVIATE entrano nel conto economico di sede nella riga "Personale dipendente" (aggancio
  naturale: movimenti di `controlloData.js`), sede della persona, mese della nota, totale rimborsabile; senza il modulo LIVE la fonte è
  "non disponibile".
- **Ricerca globale**: il dipendente trova le proprie note (mese, anno, motivazione, descrizione, tratta). Mai quelle altrui.
- **Home**: contatore per utente (P&C note da liquidare, responsabile note da approvare, dipendente note in bozza).
- **Diagnostica**: D58 "Rimborsi: eccezioni giustificativo non abbinate a una persona", D59 "Note spese in attesa di approvazione da oltre 10
  giorni".

## Impostazioni (predefiniti)
`giorno_limite` 10 · `tariffa_km_default` vuota (con `tariffa_km_default_fonte`) · `pc_person_ids` [] · `promemoria_bozza_giorni_prima` 3 ·
`promemoria_responsabile_giorni` 5 · `email_attiva` sì · `risali_se_in_ferie` sì · `avviso_dipendenti` vuoto. Categorie e eccezioni in
tabella. Variabili d'ambiente facoltative: `RIMBORSI_JOB_MINUTES` (60), `RIMBORSI_MAX_FILE_MB` (15).

## Scelte da confermare
1. **Deciso dal CEO (13/11/2026)**: la nota del vertice (titolare) è approvata automaticamente alla conferma; resta da confermare che
   chi ha un superiore non raggiungibile vada a **P&C** come secondo controllo.
2. Il responsabile **in ferie oggi** (Piano Ferie) viene saltato a favore del superiore successivo (disattivabile).
3. P&C = grant ADMIN di Contratti del personale + elenco in Impostazioni. Il titolare ha il grant ADMIN di Contratti dal seme: se è
   dipendente è anche P&C (ma non liquida mai le proprie note).
4. P&C non liquida le proprie note: serve almeno un secondo P&C.
5. Il giustificativo obbligatorio vale anche per carta aziendale e fuel card (utile alla riconciliazione).
6. Competenza nel conto economico = mese della nota, importo = totale rimborsabile.
7. Le righe escluse dal responsabile restano escluse dopo un respingimento finché il dipendente non le modifica.
8. Il responsabile non vede le bozze mai inviate dei riporti.

## Verifiche in produzione dopo il rilascio
- Log di avvio: `[migrate] rimborsi: applicata 001_init.sql`, `[migrate] contracts: applicata 021_benefit_vetture.sql`,
  `[rimborsi] modulo Rimborso Spese attivato`, esito del seme delle eccezioni.
- `SELECT person_id, cognome_seme, nota FROM rimborsi.eccezioni;` e Diagnostica D58: le quattro persone abbinate? Malenchini e Corradi
  sono DIPENDENTE in anagrafica?
- Con un dipendente: widget in Home e `/rimborsi`; con un LP, un esterno e un amministratore non dipendente: nessun widget e 403.
- Impostazioni > Approvatori: il responsabile di ciascuno è quello atteso dall'organigramma; P&C attesi.
- In Contratti del personale inserire le vetture (Epifani, Zezza, Malenchini) e le fuel card DKV (Epifani, Zezza) e verificare in Rimborso
  Spese "La tua vettura aziendale" e la voce nel benefit del contratto.
- Invio del PDF di approvazione: con una prima approvazione controllare in `email_log` la riga con `from_addr` = people@ e stato SENT;
  se FAILED con 403, autorizzare people@ per Mail.Send dell'applicazione e usare "Reinvia". Avvisare i due destinatari esterni.
- Una nota di prova con foto dal telefono (fotocamera posteriore, compressione), invio, approvazione, liquidazione, PDF e ZIP; email nel
  registro (`email_log`) se `MAIL_PROVIDER=graph`; con Azure Blob configurato i giustificativi in `rimborsi-AAAA-MM/...`.
