---
capitolo: 12
titolo: Configurazione
intro: Una sezione per ogni voce del menu Configurazione: referti, SSN, medicina dello sport, aziende e medici, fatturazione, prestazioni e listini, agende, assicurazioni, modulistica, grafometrica, templates, sedi, utenti e MioDottore.
---

=== sezione
ordine: 1
slug: config-panoramica
titolo: La configurazione: cosa contiene e chi la tocca
parole_chiave: configurazione, impostazioni, amministratore, permessi, voci configurazione
===
### A cosa serve
Il menu **Configurazione** contiene le impostazioni che valgono per tutti: modelli, tabelle SSN, medici, pagamenti, prestazioni e listini, agende, moduli, stampe, sedi, utenti.

### Le voci
- **Referti**: Modelli referto, Layout predefinito.
- **SSN**: Tipi ticket, Codici esenzione, Codici diagnosi, Generali, Budget, FSE.
- **Med. dello sport**: Modelli anamnesi, Modelli esame, Tipi certificato, Tipi visita.
- **Aziende**: Ruoli personale, Medici, Frasi costanti.
- **Fatturazione**: Metodo di pagamento, Condizioni pagamento, Sezionali documento, Anagrafiche, Generali.
- **Prestazioni**: Prestazioni, Prodotti, Listini, Specialità, Gruppi, Aree.
- **Agende**: Configurazioni, Calendario, Risorse, Centri di lavoro.
- **Assicurazioni**, **Modulistica**, **Grafometrica**, **Templates**.
- **Sedi**: Gestione sedi, Gestione utenze sedi.
- **Permessi**: Utenti, Team.
- **MioDottore**: Mappatura prestazioni, Condivisione file.

### Attenzioni
- Una modifica in configurazione cambia il lavoro di tutte le sedi: va fatta solo da chi ne ha la responsabilità, di norma con il profilo Amministratore.
- Prima di cambiare listini, sezionali o tabelle SSN parlane con l'amministrazione.

=== sezione
ordine: 2
slug: config-referti
titolo: Referti: modelli, layout e frasi costanti
percorso_gipo: /referti/modelli
parole_chiave: modelli referto, layout predefinito, intestazione referto, piè di pagina, frasi costanti, nuova frase, configurazione referti
===
### A cosa serve
Prepara i modelli dei referti e la loro impaginazione.

### Dove si trova
- **Configurazione > Referti > Modelli referto** (percorso /referti/modelli): elenco con la colonna **Nome modello**.
- **Configurazione > Referti > Layout predefinito** (percorso /referti/configurazione): carica il file per intestazione e piè di pagina della stampa.
- **Configurazione > Aziende > Frasi costanti**: frasi ricorrenti da richiamare (comando **Nuova frase**).

### Come si fa
1. Per un nuovo tipo di referto crea il modello in **Modelli referto**.
2. Per cambiare la carta intestata dei referti carica il nuovo file in **Layout predefinito**.
3. Le frasi usate spesso dai medici si aggiungono con **Nuova frase** in **Frasi costanti**.

### Attenzioni
- Il formato del file del layout (immagine, PDF, Word) non è stato osservato: da verificare prima di caricarlo.
- Nella scheda di ogni medico esiste anche un'**Intestazione referto** personale (vedi [Aziende e medici](sezione:config-aziende-medici)).

=== sezione
ordine: 3
slug: config-ssn
titolo: SSN: impostazioni generali
percorso_gipo: /ConfigurazioniGeneraliSSN/Index
parole_chiave: configurazione ssn, generali ssn, importo ticket, quota fissa, numero massimo prestazioni per impegnativa, conferma impegnative di default, tipo ticket obbligatorio, codice esenzione, ricetta dematerializzata, codice reparto, codice mittente, fse configurazione
===
### A cosa serve
Le regole con cui GIPO tratta le impegnative SSN.

### Dove si trova
**Configurazione > SSN > Generali** (percorso /ConfigurazioniGeneraliSSN/Index). Nello stesso menu: Tipi ticket, Codici esenzione, Codici diagnosi, Budget (/BudgetSSN) e FSE (/referti/fse/configurazione); le tabelle sono descritte in [Tipi ticket, esenzioni, diagnosi e budget](sezione:ssn-tabelle).

### Cosa c'è nella schermata
- **Descrizione fattura Quota Fissa**, **Importo ticket**, **Numero massimo prestazioni per impegnativa**, **Percentuale maggiorazione**.
- **Data inizio/fine terapia come data creazione Assegnazione**; **Data impegnativa/prenotazione come Data Inizio Terapia**.
- **Raggruppa prestazioni impegnative in fattura**.
- **Conferma impegnative di default**.
- **Proponi Cdl precedente** (centro di lavoro).
- **Tipo Ticket obbligatorio**.
- **Alert inserimento stesso esame impegnativa**.
- **Nascondi prezzi in Fattura**.
- **Destinatario stampa riepilogo prestazioni**.
- **Abilita controllo codice esenzione**.
- **Prescrizione fruita**.
- **Marca prestazioni come chiuse quando una ricetta dematerializzata viene erogata**.
- **Codice reparto**, **Codice mittente**.

### Attenzioni
- Sono impostazioni con effetti economici e di rendicontazione verso l'Asl: si cambiano solo con l'amministrazione.

=== sezione
ordine: 4
slug: config-sport
titolo: Medicina dello sport: modelli e tipi
parole_chiave: modelli anamnesi, modelli esame, tipi certificato, tipi visita, idoneità, validità del rilascio, configurazione medicina dello sport
===
### A cosa serve
Prepara i modelli usati nelle visite sportive.

### Cosa c'è (Configurazione > Med. dello sport)
- **Modelli anamnesi**: **Nuovo**, **Azioni**, "Cerca modelli".
- **Modelli esame**.
- **Tipi certificato**: Nome, Idoneità, Validità del rilascio, Data creazione.
- **Tipi visita**: Nome, Idoneità.

### Attenzioni
- La **Validità del rilascio** del tipo certificato determina la **Data scadenza** che compare nell'elenco delle visite (vedi [Elenco visite](sezione:sport-elenco-visite)): va impostata secondo la normativa, con il medico responsabile.

=== sezione
ordine: 5
slug: config-aziende-medici
titolo: Aziende: ruoli del personale e archivio medici
percorso_gipo: /Medici/Index
parole_chiave: medici, archivio medici, scheda medico, nuovo medico, ruoli personale, intramoenia, albo, utente collegato, sezionale fattura medico, codice prescrittore, compensi medico
===
### A cosa serve
Gestire l'anagrafica dei medici (usata da agende, referti, fatture e compensi) e i ruoli del personale.

### Dove si trova
- **Configurazione > Aziende > Medici** (percorso /Medici/Index).
- **Configurazione > Aziende > Ruoli personale** (colonna Nome).
- **Configurazione > Aziende > Frasi costanti** (vedi [Configurazione dei referti](sezione:config-referti)).

### Cosa c'è nell'archivio medici
Colonne: Cognome, Nome, Tipo, Specialità, Cellulare, Email, PEC, Numero iscrizione Albo, Codice fiscale, P. IVA, Scadenza Assicurazione, Intramoenia, Intestazione referto, Note intestazione fattura, Sezionale fattura.

### La scheda del medico
Schede: **Dati generali**, **Referto**, **Prestazioni**, **Compensi**.

Campi: Tipo di medico, Specialità medico, Cognome, Nome, Numero iscrizione Albo, Scadenza assicurazione, Intramoenia, Cellulare, Email, PEC, Altri indirizzi email, **Utente collegato**, Codice fiscale, P. IVA, Sezionale fattura, Codice presidio appartenenza, Codice soggetto prescrittore, Codice specialità, Matricola, Tipologia soggetto prescrittore.

### Come si fa
1. Per un nuovo medico compila la scheda (Dati generali) e collega l'**Utente collegato** se il medico accede a GIPO (serve al Riepilogo personale dei compensi).
2. Nella scheda **Referto** imposta l'intestazione dei suoi referti.
3. Nella scheda **Compensi** imposta le regole di calcolo (i campi non sono stati annotati: da verificare con l'amministrazione).

### Attenzioni
- **Scadenza Assicurazione** è un dato da tenere aggiornato: controllalo periodicamente nell'archivio.

=== sezione
ordine: 6
slug: config-pagamenti
titolo: Fatturazione: metodi e condizioni di pagamento
parole_chiave: metodo di pagamento, condizioni di pagamento, contanti, bonifico, bonifico istantaneo, pos, bancomat, carte, tipologia sdi, pagamento tracciato, rate, prima rata bollo
===
### A cosa serve
Definisce come si può pagare (metodi) e con quali tempi (condizioni, anche a rate).

### Cosa c'è (Configurazione > Fatturazione)
- **Metodo di pagamento**: Descrizione, Codice, Tipologia Sdi, Pagamento tracciato. Metodi in uso sull'account: **Contanti**, **Bonifico**, **Bonifico istantaneo**, **POS carte/bancomat**.
- **Condizioni pagamento**: Prima rata Bollo, Codice, Descrizione.

### Attenzioni
- **Pagamento tracciato** distingue i pagamenti tracciabili (rilevante ai fini fiscali e delle detrazioni del paziente): non va cambiato senza l'amministrazione.
- Metodo e condizione predefiniti si impostano in **Generali** (vedi [Configurazione generale della fattura](sezione:config-fattura-generale)).

=== sezione
ordine: 7
slug: config-sezionali-anagrafiche
titolo: Fatturazione: sezionali e anagrafiche di fatturazione
parole_chiave: sezionali, sezionale documento, dispositivo, limita a sede, predefinito per sede, anagrafiche di fatturazione, soggetto erogante, regime fiscale, iban, cassa previdenziale
===
### A cosa serve
- I **sezionali** sono le serie di numerazione dei documenti.
- Le **anagrafiche di fatturazione** sono i soggetti che emettono le fatture (soggetto erogante).

### Cosa c'è (Configurazione > Fatturazione)
- **Sezionali documento / dispositivi**: Descrizione, Usa come Dispositivo, Codice aggiuntivo, Inserisci codice come, Anagrafica fatturazione, Limita a sede, Predefinito per sede.
- **Anagrafiche**: Descrizione, Ragione Sociale, Codice Fiscale, Partita IVA, indirizzo, Regime fiscale, Cassa Prev., Cassa %, Istituto Finanziario, IBAN, Note.

### Attenzioni
- Con **Limita a sede** e **Predefinito per sede** ogni sede usa la propria serie: per questo il numero proposto in fattura può cambiare da sede a sede.
- Il campo **Anagrafica erogante** della fattura sceglie tra queste anagrafiche.

=== sezione
ordine: 8
slug: config-fattura-generale
titolo: Fatturazione: configurazione generale della fattura
percorso_gipo: /Configurazioni/Fattura
parole_chiave: configurazione fattura, generali fattura, bollo, regime fiscale, logo, label fattura, note intestazione, fattura esente iva, sistema ts, medico obbligatorio, blocca modifiche documento, numero seriale, marca prodotto, sezionale predefinito
===
### A cosa serve
Le regole generali dei documenti fiscali.

### Dove si trova
**Configurazione > Fatturazione > Generali** (percorso /Configurazioni/Fattura).

### Cosa c'è nella schermata
- **Modalità** e **Condizione di pagamento** predefinite.
- **Escludi sempre bollo**, **Conto CoGe del bollo**, **Regime fiscale**, **Cassa Previdenziale** e percentuale.
- **Data pagamento come Data Documento** (anche solo rate Paziente), **Mostra ora in Data Documento**.
- **Scadenzario: imposta data pagamento come data documento**.
- **Blocca modifiche documento se scaricato**.
- **Medico obbligatorio in tutte le righe fattura**.
- **Istituto finanziario** e **IBAN** pagamenti.
- **Logo**, **Label fattura**, **Note intestazione**.
- Testi "Fattura esente da IVA", "Marca da Bollo inserita", "Non invio dati Sistema TS", **Descrizione Label Contributo**, **Nota predefinita in fattura**.
- **Sezionale predefinito**.
- **Inserisci marca prodotto nelle stampe**, **Inserisci numero seriale nelle stampe** di Fattura / DDT / Nota di credito.

### Attenzioni
- Sono impostazioni fiscali: si modificano solo con l'amministrazione e, se serve, con il commercialista.

=== sezione
ordine: 9
slug: config-prestazioni
titolo: Prestazioni: archivio e scheda prestazione
percorso_gipo: /Prestazione/Index
parole_chiave: prestazioni, archivio prestazioni, scheda prestazione, codice, codice lis, durata, iva, natura, nomenclatore, cup, note preparazione, prestazione ciclica, distinta base, moduli collegati, prezzi listino
===
### A cosa serve
L'archivio delle prestazioni vendibili, con codici, durate, IVA, collegamenti a SSN e CUP e note di preparazione.

### Dove si trova
**Configurazione > Prestazioni > Prestazioni** (percorso /Prestazione/Index).

### Cosa c'è nell'archivio
Colonne: Codice, Codice shortcut, Codice LIS, Descrizione, Tipo spesa, Gruppo, Specialità, Durata, Qta, Iva, Attiva, Codice CUP. Su ogni riga **Prezzi Listino**.

### La scheda prestazione
Schede: **Generale**, **Listini**, **Distinta base**, **Moduli collegati**.

Campi: Codice shortcut, Codice LIS, Prestazione ciclica, Descrizione, Descrizione in fattura, Specialità, Gruppo, Codifica Nomenclatore, Tipo spesa, Attiva, Data scadenza, Iva, Natura (se esente IVA), Rif. Normativo, Punti, Q.ta ciclo terapeutico, Q.ta proposta, Tempo previsto (minuti), Tempo uomo, Minuti lavorati, Costo fisso materiali, Codice CoGe, Centro di costo, Codice SW terze parti, Codice interscambio, Gruppo accessi, Colore, Area, Tipo codice FEPA, Codice FEPA, Acconto/Sconto, Codice nomenclatore SSN, Codice catalogo prescrizione SSN, Codice interno prestazione CUP, Note generali, **Note preparazione**.

### Attenzioni
- **Tempo previsto (minuti)** influisce verosimilmente sulla durata proposta in prenotazione (da verificare).
- **Note preparazione** è il testo che si vede in assegnazione nella finestra Note preparazione.
- **Codice LIS** collega la prestazione al sistema del laboratorio: non modificarlo senza il laboratorio.

=== sezione
ordine: 10
slug: config-listini-prodotti
titolo: Prodotti, listini, specialità, gruppi e aree
percorso_gipo: /Listini/Index
parole_chiave: listini, listino, prezzi listino, copia prezzi, incremento, modifica articoli listino, prodotti, specialità, gruppi, aree, codice branca, convenzione
===
### A cosa serve
Le tabelle che danno prezzi e classificazioni alle prestazioni.

### Cosa c'è (Configurazione > Prestazioni)
- **Prodotti**: Codice, Descrizione, Marca, Iva, Gruppo.
- **Listini** (percorso /Listini/Index): Nome, Codice shortcut, Assicurazione collegata, Sede collegata, Attivo, SSN. Azioni **Modifica articoli listino**, **Elimina**. Finestre **Prezzi Listino** e **Copia prezzi di listino** con incremento in % o in €.
- **Specialità**: Descrizione, Codice branca, Codice branca nazionale, Codice disciplina, Codice CoGe, Codice unità erogante, Centro di costo, Generica.
- **Gruppi**: Descrizione, Codice, Codice CoGe, Centro di Costo.
- **Aree**: Nome.

### Come si fa
1. Per cambiare un prezzo: **Listini**, sul listino scegli **Modifica articoli listino** (oppure **Prezzi Listino** dalla prestazione) e aggiorna il prezzo.
2. Per un aumento generale: **Copia prezzi di listino** con l'incremento in percentuale o in euro (verifica prima su quale listino di destinazione agisce).

### Attenzioni
- Un listino può essere collegato a un'assicurazione o a una sede: è così che in prenotazione e in assegnazione vengono proposti listini diversi.
- **Elimina** su un listino usato da assegnazioni aperte può creare problemi: preferisci disattivarlo (campo **Attivo**).

=== sezione
ordine: 11
slug: config-agende
titolo: Agende: configurazione delle agende
percorso_gipo: /Agende/Configurazioni
parole_chiave: configurazione agende, nuova agenda, duplica agenda, orari agenda, slot, periodi, sottoconfigurazioni, occupazioni parziali, medico collegato, max appuntamenti per slot, servizi esterni, agenda cup
===
### A cosa serve
Crea e modifica le agende: orari, durata degli slot, prestazioni prenotabili, medico e risorsa.

### Dove si trova
**Configurazione > Agende > Configurazioni** (percorso /Agende/Configurazioni). Dall'agenda classica: **Configurazione > Agende e disponibilità**.

### Cosa c'è nella schermata
Elenco: Colore, Nome, Sigla, Risorsa, Medico, Sede; azioni **Duplica agenda**, **Elimina**.

Scheda agenda, schede **Dati generali**, **Sottoconfigurazioni**, **Prestazioni / Listini**, **Occupazioni parziali**. Campi: Nome Agenda, Sigla, Colore, Nota, Medico collegato, Risorsa, Abilita condivisione calendar, Mostra in servizi esterni, Luogo, Agenda Cup, Max appuntamenti per slot, Sede.

**Configurazione base**: per ogni giorno (Lunedì ... Domenica) **Aggiungi periodi** con l'orario e lo **Slot** in minuti (da 5 a 50).

### Come si fa
1. Per una nuova agenda simile a una esistente usa **Duplica agenda** e poi modifica nome, medico e orari.
2. Negli orari di ogni giorno usa **Aggiungi periodi** (per esempio mattina e pomeriggio) e scegli lo **Slot**.
3. Nella scheda **Prestazioni / Listini** indica cosa si può prenotare su quell'agenda.

### Attenzioni
- Cambiare orari o slot di un'agenda con appuntamenti già presi può lasciare appuntamenti fuori orario: concordalo con la sede.
- **Mostra in servizi esterni** e **Agenda Cup** espongono l'agenda a canali esterni (dal nome, per esempio prenotazione online o CUP): da attivare solo su decisione della direzione.
- Il significato di **Sottoconfigurazioni** e **Occupazioni parziali** non è stato descritto nell'analisi.

=== sezione
ordine: 12
slug: config-calendario-risorse
titolo: Calendario, risorse e centri di lavoro
percorso_gipo: /ConfigurazioniCalendario/Index
parole_chiave: calendario, giorni festivi, festivi, fascia oraria, vista predefinita, risorse, centri di lavoro, ciclicità conteggio, affianca agende, incrocia agende
===
### A cosa serve
Impostazioni comuni del calendario, festività, risorse e centri di lavoro.

### Cosa c'è (Configurazione > Agende)
- **Calendario** (percorso /ConfigurazioniCalendario/Index): schede **Generale** e **Giorni festivi**; **Fascia oraria predefinita** (Dalle / Alle ore), **Affianca agende**, **Incrocia agende**, **Vista predefinita** (Giorno / Settimana lavorativa / Settimana / Mese / Lista).
- **Risorse**: Descrizione, Ordine.
- **Centri di lavoro**: Nome, Ciclicità conteggio, Conteggio iniziale, Attivo.

### Come si fa
1. A inizio anno controlla i **Giorni festivi**.
2. L'ordine delle risorse nell'agenda si cambia in **Risorse** (campo Ordine) o dall'agenda con **Configurazione > Risorse e ordinamento**.

### Attenzioni
- I **Centri di lavoro** compaiono nei filtri di Gestione assegnazioni, Gruppo assegnazioni e Riepilogo Asl; il significato di **Ciclicità conteggio** e **Conteggio iniziale** non è spiegato dall'interfaccia.

=== sezione
ordine: 13
slug: config-assicurazioni
titolo: Assicurazioni
parole_chiave: assicurazioni, ente assicurativo, fondo, convenzione assicurativa, bollo a carico dell'ente, condizione di pagamento associata
===
### A cosa serve
Elenco degli enti assicurativi con cui si lavora.

### Cosa c'è (Configurazione > Assicurazioni)
Colonne: **Ente assicurativo**, **Nome visualizzato**, **Condizione di pagamento associata**, **Bollo a carico dell'ente**.

### Attenzioni
- L'assicurazione si indica nella scheda del paziente e nella scheda **Assicurazione** dell'assegnazione; i listini possono avere un'**Assicurazione collegata**.
- Le quote a carico dell'assicurazione compaiono nello **Scadenzario** con il filtro Assicurazione.

=== sezione
ordine: 14
slug: config-modulistica
titolo: Modulistica
parole_chiave: modulistica, moduli, consenso, privacy, anamnesi, firme terapia, modello word, template avanzato, personalizzazione standard, azzera conteggi
===
### A cosa serve
I moduli che si stampano o si fanno firmare ai pazienti (consensi, privacy, anamnesi).

### Cosa c'è (Configurazione > Modulistica)
Elenco: Nome, Tipo (**Altro / Consenso / Firme terapia / Anamnesi / Privacy**), Data creazione.

Scheda modulo: **Personalizzazione standard** oppure **Template avanzato**, **Carica nuovo modello Word**, **Azzera conteggi**.

### Come si fa
1. Per un nuovo modulo scegli il tipo e la personalizzazione.
2. Con **Template avanzato** carica il file Word con **Carica nuovo modello Word**.
3. I moduli si usano poi dai pulsanti **Modulistica** di assegnazione e fattura.

### Attenzioni
- I testi dei consensi e dell'informativa privacy vanno approvati da chi si occupa di privacy in azienda: non modificarli autonomamente.
- Cosa conti **Azzera conteggi** non è spiegato dall'interfaccia.

=== sezione
ordine: 15
slug: config-grafometrica
titolo: Grafometrica: dispositivi di firma
parole_chiave: grafometrica, tavoletta firma, dispositivo firma, associa dispositivo, firma elettronica
===
### A cosa serve
Associa le tavolette per la firma grafometrica dei moduli.

### Cosa c'è (Configurazione > Grafometrica)
Comando **Associa dispositivo**; colonne **Nome dispositivo**, **ID**.

### Attenzioni
- La procedura di associazione di una nuova tavoletta non è stata osservata: fatti assistere dal referente o dall'assistenza Gipo.
- Le firme raccolte sono nello **Storico firme** (vedi [Storico firme](sezione:storico-firme)).

=== sezione
ordine: 16
slug: config-templates
titolo: Templates di stampa
percorso_gipo: /ConfigurazioneModelli/Index
parole_chiave: templates, modelli di stampa, promemoria appuntamento, riepilogo appuntamenti, preventivo, stampa fattura, stampa referto, ricetta interna
===
### A cosa serve
I modelli di stampa dei documenti prodotti da GIPO.

### Dove si trova
**Configurazione > Templates** (percorso /ConfigurazioneModelli/Index).

### Cosa c'è
Modelli: Modulistica standard, Promemoria appuntamento, Riepilogo appuntamenti, Dettaglio compensi medici (per articolo / per paziente), Riepilogo compensi medici, Dettaglio assegnazioni e fatture, Fattura, Nota di credito, Preventivo, Gestione cassa, DDT, Referto, Ricetta interna, riepiloghi richieste prestazioni SSN.

### Attenzioni
- Un template modificato cambia la stampa per tutte le sedi: prova su un documento di test prima di confermare.
- Dove si genera il **Preventivo** non è stato osservato nell'analisi delle schermate.

=== sezione
ordine: 17
slug: config-sedi
titolo: Sedi e utenze di sede
parole_chiave: sedi, gestione sedi, utenze sedi, codice asl, codice struttura, sede collegata, utente sede
===
### A cosa serve
Le sedi dell'azienda e quali utenti lavorano in quale sede.

### Cosa c'è (Configurazione > Sedi)
- **Gestione sedi**: Denominazione, Codice, Codice ASL, Codice Struttura.
- **Gestione utenze sedi**: Utente, Sede collegata.

### Attenzioni
- **Codice ASL** e **Codice Struttura** servono alla rendicontazione SSN: non modificarli senza l'amministrazione.
- Se un utente non vede le agende della sua sede, controlla la sua sede collegata in **Gestione utenze sedi**.

=== sezione
ordine: 18
slug: config-utenti-team
titolo: Utenti e team (permessi)
percorso_gipo: /utenti
parole_chiave: utenti, invita utente, profilo, medico, segreteria, amministratore, bloccato, invitato, attivo, team, nuovo team, permessi, accesso gipo
===
### A cosa serve
Gestire chi accede a GIPO e con quale profilo.

### Dove si trova
**Configurazione > Permessi > Utenti** (percorso /utenti) e **Team** (percorso /teams).

### Cosa c'è nella schermata
- **Utenti**: comando **Invita utente**; profili **Medico**, **Segreteria**, **Amministratore**; stati **Attivo**, **Invitato**, **Bloccato**.
- **Team**: comando **Nuovo team**.

### Come si fa
1. Per un nuovo collega: **Invita utente**, indica l'email e il profilo adatto (Segreteria per l'accettazione, Medico per i medici, Amministratore solo per chi gestisce la configurazione).
2. Il collega riceve l'invito (stato **Invitato**) e diventa **Attivo** al primo accesso.
3. Quando una persona lascia l'azienda, blocca l'utente (stato **Bloccato**) invece di lasciarlo attivo.
4. Per i medici collega l'utente alla scheda medico (campo **Utente collegato**).

### Attenzioni
- I permessi precisi di ciascun profilo non sono stati osservati: da verificare con l'assistenza Gipo.
- A cosa servano i **Team** non è spiegato dall'interfaccia.

=== sezione
ordine: 19
slug: config-miodottore
titolo: MioDottore: mappatura prestazioni e condivisione file
percorso_gipo: /MioDottore/Index
parole_chiave: miodottore, mappatura prestazioni, facility, condivisione file, prenotazioni online, crm
===
### A cosa serve
Il collegamento tra GIPO e MioDottore (prenotazioni e condivisione dei documenti con i pazienti).

### Dove si trova
- **Configurazione > MioDottore > Mappatura prestazioni** (percorso /MioDottore/Index).
- **Configurazione > MioDottore > Condivisione file** (percorso /miodottore/condivisione-file).
- Nel menu **Marketing**: **CRM** (MioDottore) e **MioDottore**.

### Stato sull'account di Toscana Diagnostica
Al momento dell'analisi la **Mappatura prestazioni** riportava **"Nessuna Facility collegata"**: il collegamento con MioDottore non risultava configurato.

### Attenzioni
- Finché il collegamento non è configurato non contare sulla condivisione dei referti o sulle prenotazioni da MioDottore: chiedi al referente.
