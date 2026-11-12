=== faq
chiave: be-medico-alcuni-giorni-mese
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Come imposto un medico presente solo alcuni giorni del mese?
===
Con una **sottoconfigurazione** dell'agenda del medico:
1. **Configurazione > Agende > Configurazioni**, **Modifica** sull'agenda; nella **Configurazione base** lascia spento il giorno interessato.
2. Scheda **Sottoconfigurazioni** > **Nuova sottoconfigurazione**: Data inizio e fine validità, **Attiva sottoconfig.**, Periodicità in settimane 1, Priorità 1.
3. Nella **Configurazione** accendi il giorno (per esempio Martedì) e in **Periodicità nel mese** scegli le voci giuste (per esempio **Primo martedì** e **Terzo martedì**); aggiungi l'orario e lo **Slot (min.)**. **Salva**.
4. Controlla in **Agenda > Classica**, vista **Mese**, che gli slot compaiano solo in quei giorni.

Esempio svolto e cautele in [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni). Da provare prima su un'agenda di prova.

=== faq
chiave: be-primo-terzo-martedi
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Un medico viene solo il primo e il terzo martedì del mese: come imposto la sua agenda?
===
1. Agenda del medico (crearla se non c'è), **Configurazione base** con il martedì disattivato.
2. **Sottoconfigurazioni** > **Nuova sottoconfigurazione**: validità dalla prima data utile (per esempio 01/12/2026) alla fine dell'accordo, Attiva, Periodicità in settimane 1, Priorità 1.
3. **Configurazione**: Martedì attivo, **Periodicità nel mese** = **Primo martedì** + **Terzo martedì**, periodo 09:00-13:00, Slot 20. **Salva**.
4. Verifica: in vista Mese di dicembre 2026 slot solo martedì 1 e martedì 15.

Procedura dedotta dai campi del modulo: da provare su un'agenda di prova (vedi [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni)).

=== faq
chiave: be-orario-da-data
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Come cambio l'orario di un'agenda da una certa data?
===
Non modificare la configurazione base (cambierebbe anche le settimane prima della data): crea una **Nuova sottoconfigurazione** con **Data inizio validità** = primo giorno del nuovo orario, **Data fine validità** lontana, Periodicità in settimane 1, e nella **Configurazione** i giorni e gli orari nuovi. Fino al giorno prima resta l'orario base. Controlla in Agenda classica, vista Settimana, la settimana del cambio. Vedi [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).

=== faq
chiave: be-ferie-agenda
sezione: giorni-festivi-chiusure
ruolo: amministrazione
domanda: Come blocco un'agenda per ferie?
===
- **Ferie di un solo medico**: agenda del medico, **Nuova sottoconfigurazione** con le date delle ferie e **tutti i giorni spenti** (Priorità tale da prevalere su altre sottoconfigurazioni dello stesso periodo).
- **Chiusura di tutti**: **Configurazione > Agende > Calendario**, scheda **Giorni festivi**, **Aggiungi periodo festivo** (Dalla data, Alla data).

Poi controlla in **Agenda > Classica** che quei giorni non abbiano slot (i festivi si vedono con sfondo rosso). Che i festivi blocchino anche la prenotazione va provato. Vedi [Giorni festivi e chiusure](sezione:giorni-festivi-chiusure).

=== faq
chiave: be-settimane-alterne
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Come imposto un medico che viene a settimane alterne?
===
**Nuova sottoconfigurazione** sull'agenda del medico con **Periodicità in settimane** = 2 (una settimana sì e una no), Data inizio validità in una settimana in cui il medico c'è, il giorno attivo con il suo orario; nella configurazione base quel giorno resta spento. Verifica in vista Mese quali settimane risultano aperte: se GIPO parte dalla settimana sbagliata, sposta la data di inizio di una settimana. Vedi l'esempio 2 in [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).

=== faq
chiave: be-orario-estivo
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Come imposto l'orario estivo di un'agenda?
===
**Nuova sottoconfigurazione** dal 01/07 al 31/08 con i giorni e gli orari estivi (per esempio solo la mattina); la configurazione base resta quella normale e torna da sola dal 1° settembre. Vedi l'esempio 3 in [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).

=== faq
chiave: be-sostituzione
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: Come gestisco l'agenda quando un medico viene sostituito per qualche settimana?
===
1. Agenda del titolare: sottoconfigurazione sul periodo con tutti i giorni spenti.
2. Agenda del sostituto (duplicata da quella del titolare, con **Medico collegato** cambiato): sottoconfigurazione sullo stesso periodo con gli orari.
3. Sposta a mano gli appuntamenti già presi sul titolare in quel periodo.
Vedi l'esempio 4 in [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).

=== faq
chiave: be-priorita-sottoconfig
sezione: agenda-sottoconfigurazioni
ruolo: amministrazione
domanda: A cosa serve la Priorità di una sottoconfigurazione?
===
Quando due sottoconfigurazioni valgono negli stessi giorni (per esempio "orario estivo" e "ferie del medico"), la **Priorità** decide quale si applica. Quale numero prevale (più alto o più basso) non è stato osservato: provalo con due sottoconfigurazioni sovrapposte su un'agenda di prova prima di contarci. Vedi [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).

=== faq
chiave: be-nuova-agenda
sezione: agenda-creare
ruolo: amministrazione
domanda: Come creo una nuova agenda?
===
**Configurazione > Agende > Configurazioni** > **Aggiungi**: Nome Agenda, Sigla, Colore, Medico collegato, Risorsa, Sede, Max appuntamenti per slot; poi la **Configurazione base** (giorni, periodi, Slot) e **Salva**. Dopo il primo salvataggio: Sottoconfigurazioni, Prestazioni / Listini, Occupazioni parziali. Per un'agenda simile a una esistente usa **Duplica agenda**. Vedi [Creare un'agenda](sezione:agenda-creare).

=== faq
chiave: be-durata-slot
sezione: agenda-orario-base
ruolo: amministrazione
domanda: Come cambio la durata degli slot di un'agenda?
===
Nella scheda dell'agenda, **Configurazione base**, su ogni periodo cambia **Slot (min.)** (da 5 a 60). Per cambiarla solo da una data o per un periodo usa una sottoconfigurazione. Controlla gli appuntamenti futuri: con slot diversi possono finire a cavallo di due slot. Vedi [Orario settimanale](sezione:agenda-orario-base).

=== faq
chiave: be-pausa-pranzo
sezione: agenda-orario-base
ruolo: amministrazione
domanda: Come imposto mattina e pomeriggio con la pausa pranzo?
===
Nello stesso giorno della **Configurazione base** premi **Aggiungi** due volte: Periodo 1 (per esempio 08:00-13:00) e Periodo 2 (14:30-18:30). La pausa è lo spazio tra i due. Con **Altre azioni > Copia configurazione su tutti i giorni attivi** la copi sugli altri giorni. Vedi [Orario settimanale](sezione:agenda-orario-base).

=== faq
chiave: be-limitare-prestazioni-agenda
sezione: agenda-prestazioni-prenotabili
ruolo: amministrazione
domanda: Come limito le prestazioni prenotabili su un'agenda?
===
Scheda dell'agenda > **Prestazioni / Listini** > **Aggiungi** una riga per ogni prestazione (ed eventualmente listino) prenotabile. Verifica nel **Wizard** che le prestazioni escluse non trovino slot su quell'agenda. Cosa succede con l'elenco vuoto non è stato osservato: provalo su un'agenda di prova. Vedi [Prestazioni prenotabili](sezione:agenda-prestazioni-prenotabili).

=== faq
chiave: be-occupazioni-parziali
sezione: agenda-occupazioni-parziali
ruolo: amministrazione
domanda: Come faccio occupare a una prestazione solo una parte dello slot?
===
Scheda dell'agenda > **Occupazioni parziali** > **Aggiungi**: scegli la **Prestazione** e il **Peso (%)** (per esempio 50 per metà slot). Comportamento dedotto dal nome: provalo su un'agenda di prova. Vedi [Occupazioni parziali](sezione:agenda-occupazioni-parziali).

=== faq
chiave: be-duplica-agenda
sezione: agenda-duplicare
ruolo: amministrazione
domanda: Come duplico un'agenda?
===
**Configurazione > Agende > Configurazioni**, sulla riga: **Altre azioni > Duplica agenda**; poi apri la copia e cambia Nome Agenda, Sigla, Colore, Medico collegato e controlla orari, sottoconfigurazioni e prestazioni. Vedi [Duplicare un'agenda](sezione:agenda-duplicare).

=== faq
chiave: be-festivi
sezione: giorni-festivi-chiusure
ruolo: amministrazione
domanda: Come inserisco le festività e le chiusure aziendali?
===
**Configurazione > Agende > Calendario**, scheda **Giorni festivi**, **Aggiungi periodo festivo** con Dalla data e Alla data, poi **Aggiungi**: il periodo compare in **Periodi attivi** e nel calendario con sfondo rosso. Vedi [Giorni festivi e chiusure](sezione:giorni-festivi-chiusure).

=== faq
chiave: be-prestazione-listino
sezione: prestazione-listini-prezzi
ruolo: amministrazione
domanda: Come aggiungo una prestazione a un listino?
===
Due strade:
1. Dalla prestazione: **Configurazione > Prestazioni > Prestazioni**, **Modifica**, scheda **Listini**, aggiungi una riga con il **Listino**, **Validità Dal**, **Valido**, **Prezzo netto** (e **Quota assicurazione** per i listini delle assicurazioni). **Salva**.
2. Dal listino: **Configurazione > Prestazioni > Listini**, **Modifica articoli listino** sulla riga del listino.
Verifica in una Nuova assegnazione di prova il prezzo proposto. Vedi [Listini e prezzi con validità](sezione:prestazione-listini-prezzi).

=== faq
chiave: be-prezzo-da-data
sezione: prestazione-listini-prezzi
ruolo: amministrazione
domanda: Come cambio il prezzo di una prestazione da una certa data?
===
Scheda della prestazione > **Listini**: chiudi la riga attuale con **Validità Al** al giorno prima e aggiungi una riga dello stesso listino con **Validità Dal** = data del cambio e il nuovo **Prezzo netto**. Non lasciare validità sovrapposte. Vedi [Listini e prezzi con validità](sezione:prestazione-listini-prezzi).

=== faq
chiave: be-aumento-5
sezione: listini-creare-copiare
ruolo: amministrazione
domanda: Come aumento tutti i prezzi di un listino del 5%?
===
1. Esporta il listino con **Excel** (copia di sicurezza).
2. Crea un listino nuovo (Configurazione > Prestazioni > Listini > **Aggiungi**, riga nuova).
3. **Copia prezzi di listino** dal listino attuale a quello nuovo con incremento **in %** = 5.
4. Controlla qualche prezzo con **Modifica articoli listino** (100 euro diventano 105).
5. Al momento del passaggio spegni **Attivo** sul vecchio e accendilo sul nuovo.
I campi esatti della finestra di copia non sono stati osservati: prova prima su un listino di prova. Vedi [Listini: creare e copiare](sezione:listini-creare-copiare).

=== faq
chiave: be-nuovo-listino
sezione: listini-creare-copiare
ruolo: amministrazione
domanda: Come creo un nuovo listino, per esempio per una convenzione?
===
**Configurazione > Prestazioni > Listini** > **Aggiungi** (riga nuova): Nome, Codice shortcut, **Assicurazione collegata** o **Sede collegata** se serve, **Attivo**; poi i prezzi con **Copia prezzi di listino** o **Modifica articoli listino**. Vedi [Listini: creare e copiare](sezione:listini-creare-copiare).

=== faq
chiave: be-pacchetto
sezione: pacchetti-distinta-base
ruolo: amministrazione
domanda: Come creo un pacchetto?
===
1. Crea la prestazione del pacchetto (per esempio "Check-up") con il prezzo nei listini.
2. Scheda **Distinta base** > **Aggiungi** le prestazioni che lo compongono con **Qta**, **Incidenza %** (totale 100) e **Ordine**.
3. Scegli le opzioni **Calcolo compensi su singola prestazione.** e **Inserisci prestazioni a quantità 1 in Assegnazione - Split pacchetto**. **Salva**.
4. Verifica in una Nuova assegnazione di prova.
Vedi [Pacchetti con la distinta base](sezione:pacchetti-distinta-base).

=== faq
chiave: be-consenso-prestazione
sezione: prestazione-moduli-consensi
ruolo: amministrazione
domanda: Come collego un consenso a una prestazione?
===
1. Se manca, crea il modulo in **Configurazione > Modulistica** (Tipo "Consenso").
2. Scheda della prestazione > **Moduli collegati** > **Aggiungi** e scegli il **Modulo**. **Salva**.
3. Verifica che **Modulistica** in un'assegnazione di prova lo proponga.
Vedi [Moduli e consensi collegati](sezione:prestazione-moduli-consensi).

=== faq
chiave: be-nuova-prestazione
sezione: prestazione-nuova
ruolo: amministrazione
domanda: Come creo una nuova prestazione?
===
**Configurazione > Prestazioni > Prestazioni** > **Aggiungi**; scheda **Generale** (Descrizione, Descrizione in fattura, codici, Specialità, Gruppo, Iva e Natura, Tempo previsto, Note preparazione, Attiva), poi le schede **Listini**, **Distinta base**, **Moduli collegati**; infine abilitala sulle agende e sui medici. Vedi [Creare una prestazione](sezione:prestazione-nuova).

=== faq
chiave: be-durata-prestazione
sezione: prestazione-nuova
ruolo: amministrazione
domanda: Dove imposto la durata di una prestazione?
===
Nella scheda della prestazione, campo **Tempo previsto (minuti)** (ci sono anche **Tempo uomo** e **Minuti lavorati**); per il singolo medico, **Tempo previsto** nella scheda **Prestazioni** del medico. Che la durata proposta in prenotazione venga da qui è verosimile ma da verificare. Vedi [Creare una prestazione](sezione:prestazione-nuova).

=== faq
chiave: be-note-preparazione
sezione: prestazione-nuova
ruolo: amministrazione
domanda: Dove scrivo le istruzioni di preparazione di un esame (per esempio il digiuno)?
===
Nella scheda della prestazione, campo **Note preparazione**: è il testo che si vede in assegnazione nella finestra **Note preparazione**. Vedi [Creare una prestazione](sezione:prestazione-nuova).

=== faq
chiave: be-compenso-medico
sezione: medico-compensi-regole
ruolo: amministrazione
domanda: Come imposto il compenso di un medico?
===
Scheda del medico > **Compensi**: Base di calcolo, Data di riferimento, IVA e ritenuta, **In percentuale**, Solo prestazioni erogabili; poi **Aggiungi** le regole (Prestazione / Prodotto, Listino, Gruppo, Compenso, Ruolo medico, Valida dal, Valida al, Priorità). Serve almeno una prestazione nella scheda **Prestazioni** del medico. Verifica con **Compensi > Calcolo** e **Riepilogo** su un periodo breve. Vedi [Regole di compenso del medico](sezione:medico-compensi-regole).

=== faq
chiave: be-compenso-percentuale
sezione: medico-compensi-regole
ruolo: amministrazione
domanda: Come do a un medico una percentuale diversa per una prestazione?
===
Nella scheda **Compensi** del medico aggiungi una regola specifica per quella **Prestazione / Prodotto** con il suo **Compenso** e una **Priorità** che la faccia prevalere sulla regola generale (quale numero prevale va verificato). Vedi [Regole di compenso del medico](sezione:medico-compensi-regole).

=== faq
chiave: be-compensi-zero
sezione: medico-compensi-regole
ruolo: amministrazione
domanda: Perché il calcolo dei compensi di un medico non trova nulla?
===
Controlla: (1) la scheda **Prestazioni** del medico ha almeno una riga (altrimenti GIPO avvisa "Effettua la configurazione di almeno una prestazione per poter calcolare i compensi del medico."); (2) la scheda **Compensi** ha regole valide nel periodo (**Valida dal** / **Valida al**); (3) le righe di assegnazioni e fatture hanno il medico (**Associa medico**). Vedi [Regole di compenso](sezione:medico-compensi-regole).

=== faq
chiave: be-nuovo-medico
sezione: medico-nuovo
ruolo: amministrazione
domanda: Come registro un nuovo medico e le prestazioni che esegue?
===
**Configurazione > Aziende > Medici** > **Aggiungi**: dati del medico e **Utente collegato**; **Salva**; poi schede **Dati generali** (codice fiscale, P. IVA, sezionale, codici prescrittore), **Referto**, **Prestazioni** (le prestazioni che esegue, con Listino e Tempo previsto) e **Compensi**. Infine crea la sua agenda. Vedi [Nuovo medico](sezione:medico-nuovo).

=== faq
chiave: be-sede-sezionale
sezione: sede-sezionale-nuovi
ruolo: amministrazione
domanda: Come aggiungo una sede o un sezionale?
===
- Sede: **Configurazione > Sedi > Gestione sedi** > **Aggiungi** (Denominazione, Codice, Codice ASL, Codice Struttura); utenti in **Gestione utenze sedi**.
- Sezionale: **Configurazione > Fatturazione > Sezionali documento** > **Aggiungi** (Descrizione, Codice aggiuntivo, Inserisci codice come, Anagrafica fatturazione, Limita a sede, Predefinito per sede).
Si lavora in riga nella griglia; con l'amministrazione. Vedi [Aggiungere una sede o un sezionale](sezione:sede-sezionale-nuovi).

=== faq
chiave: be-metodo-pagamento
sezione: tabelle-in-riga
ruolo: amministrazione
domanda: Come aggiungo un metodo di pagamento?
===
**Configurazione > Fatturazione > Metodo di pagamento** > **Aggiungi**: riga nuova con Descrizione, Codice, **Tipologia Sdi**, **Pagamento tracciato**. Con l'amministrazione. Regola TD: non si accettano assegni. Vedi [Tabelle in riga](sezione:tabelle-in-riga).

=== faq
chiave: be-condizione-pagamento
sezione: tabelle-in-riga
ruolo: amministrazione
domanda: Come creo una condizione di pagamento a rate?
===
**Configurazione > Fatturazione > Condizioni pagamento** > **Aggiungi**: Codice, Descrizione e **Prima rata Bollo**. Come si definiscono numero e scadenze delle rate della condizione non è stato annotato: le rate si vedono e si correggono nella scheda **Scadenze\Pagamenti** della fattura. Vedi [Tabelle in riga](sezione:tabelle-in-riga) e [Rate e pagamenti in fattura](sezione:fattura-rate-pagamenti).

=== faq
chiave: be-tabelle-in-riga
sezione: tabelle-in-riga
ruolo: amministrazione
domanda: Perché non trovo la pagina per creare una specialità, un tipo ticket o un centro di lavoro?
===
Perché non c'è: queste tabelle (risorse, centri di lavoro, assicurazioni, sedi, utenze, metodi e condizioni di pagamento, sezionali, anagrafiche, tipi ticket, codici esenzione, specialità, gruppi, aree, ruoli) si modificano **in riga**: **Aggiungi** crea una riga nuova nella griglia. Vedi [Tabelle che si modificano in riga](sezione:tabelle-in-riga).

=== faq
chiave: be-assicurazione
sezione: assicurazione-convenzione
ruolo: amministrazione
domanda: Come configuro una nuova assicurazione o convenzione?
===
1. **Configurazione > Assicurazioni** > **Aggiungi**: Ente assicurativo, Nome visualizzato, Condizione di pagamento associata, Bollo a carico dell'ente.
2. **Configurazione > Prestazioni > Listini**: listino con **Assicurazione collegata**.
3. Prezzi e **Quota assicurazione** nella scheda Listini delle prestazioni.
Vedi [Assicurazioni e convenzioni](sezione:assicurazione-convenzione).

=== faq
chiave: be-nuovo-utente
sezione: utenti-nuovo-collega
ruolo: amministrazione
domanda: Come do accesso a GIPO a un nuovo collega?
===
**Configurazione > Permessi > Utenti** > **Invita utente** con il profilo (Medico, Segreteria, Amministratore); poi **Gestione utenze sedi** per la sede e, per i medici, **Utente collegato** nella scheda medico. Quando lascia l'azienda: stato **Bloccato**. Vedi [Accesso di un nuovo collega](sezione:utenti-nuovo-collega).

=== faq
chiave: be-verifiche
sezione: backend-verifiche
ruolo: amministrazione
domanda: Cosa devo controllare dopo aver cambiato la configurazione di un'agenda?
===
**Agenda > Classica** sull'agenda, viste **Mese** e **Settimana**: slot solo nei giorni e orari previsti, con la durata giusta; **Trova spazio libero** su tre mesi; nel **Wizard** una prestazione abilitata deve trovare gli stessi giorni. Vedi [Dopo una modifica: cosa controllare](sezione:backend-verifiche).

=== faq
chiave: be-agenda-prova
sezione: backend-verifiche
ruolo: amministrazione
domanda: Come provo una configurazione senza rischi?
===
Crea un'agenda "PROVA" senza **Mostra in servizi esterni** né **Agenda Cup** e prova lì sottoconfigurazioni, priorità e occupazioni parziali; per le prestazioni lavora con **Attiva** spenta. Non salvare fatture di prova (non si cancellano). Vedi [Dopo una modifica](sezione:backend-verifiche).

=== faq
chiave: be-mappa
sezione: backend-mappa
ruolo: amministrazione
domanda: Dove si configura cosa in GIPO?
===
Parti dalla tabella di [Back-end: cosa si configura e dove](sezione:backend-mappa): per ogni esigenza (agende, orari, giorni del mese, ferie, prezzi, pacchetti, consensi, compensi, sedi, sezionali, utenti) c'è la voce di menu e la procedura.

=== faq
chiave: be-tracciati-asl
sezione: ssn-tracciati-asl
ruolo: amministrazione
domanda: Come genero i tracciati mensili per la ASL?
===
**SSN > Riepilogo Asl**: nella scheda **Impegnative** imposta i filtri del mese e conferma o scarta le impegnative; nella scheda **Elaborazione e stampe** usa **Verifica tracciati**, poi **Elabora e scarica tracciati** e segui lo **Stato** nell'elenco delle operazioni; **Stampa riepilogo** per la stampa di accompagnamento. Vedi [Tracciati ASL](sezione:ssn-tracciati-asl).

=== faq
chiave: be-rate-fattura
sezione: fattura-rate-pagamenti
ruolo: amministrazione
domanda: Come divido una fattura in rate?
===
In **Nuova fattura** scegli la **Condizione di pagamento** e controlla la scheda **Scadenze\Pagamenti** (Data scadenza, Calcola %, Dare, Ricevuto, Saldo, Data pagamento, Modalità di pagamento); registra le rate pagate dopo dallo **Scadenzario** con **Imposta data pagamento rata**. Vedi [Rate e pagamenti in fattura](sezione:fattura-rate-pagamenti).

=== faq
chiave: be-note-interne
sezione: assegnazione-schede-interne
ruolo: accettazione
domanda: Dove scrivo una nota interna su una pratica?
===
Nell'assegnazione, scheda **Note Interne** (colonne Testo, Utente, Data creazione): resta con autore e data. La scheda **Note** contiene le note della pratica. Vedi [Schede interne dell'assegnazione](sezione:assegnazione-schede-interne).

=== faq
chiave: be-scheda-ssn-assegnazione
sezione: assegnazione-schede-interne
ruolo: accettazione
domanda: Cosa fanno Fattura tutto e Conferma tutto nella scheda SSN dell'assegnazione?
===
Dai nomi: **Conferma tutto** conferma le impegnative della pratica, **Fattura tutto** e **Fattura selezionate** preparano la fattura (ticket) delle impegnative. La scheda mostra per ogni impegnativa medico prescrittore, esenzione, ticket, quota fissa e Priorità Accesso. Effetti da provare su una pratica di prova. Vedi [Schede interne dell'assegnazione](sezione:assegnazione-schede-interne).

=== faq
chiave: be-natura-bollo
sezione: fase5-fatturazione
ruolo: accettazione
domanda: Quale Natura bollo devo scegliere in fattura?
===
Regola TD (manuale operativo TD-SGI-MAN007): nel campo **Natura bollo** scegli **sempre** la voce **N4** (prestazioni esenti IVA): GIPO non la preseleziona. Sopra 77,47 euro si applica il bollo virtuale da 2 euro. Vedi [Fase 5: fatturazione e incasso](sezione:fase5-fatturazione).

=== faq
chiave: man-credenziali
sezione: fase8-credenziali
ruolo: accettazione
domanda: Come stampo il modulo con le credenziali del portale referti?
===
Dalla scheda del paziente o dall'assegnazione premi **Modulistica**, scegli "Assegnazione Credenziali Portale Paziente" (TD-SGI-MOD235) e l'icona della stampante: il PDF riporta già l'ID Paziente. Prima verifica e-mail e telefono in anagrafica. Vedi [Fase 8: credenziali](sezione:fase8-credenziali).

=== faq
chiave: man-controlli-impegnativa
sezione: fase3-impegnativa
ruolo: accettazione
domanda: Quali controlli faccio su un'impegnativa?
===
Validità e regione di prescrizione, prestazioni erogabili dalla struttura e presenti in GIPO, codice di esenzione coerente con il paziente, firma e timbro del medico prescrittore, codice fiscale uguale a documento e tessera, priorità (U 72 ore, B 10 giorni, D 30 giorni, P 120 giorni). Le impegnative con prestazioni non erogabili non si accettano. Vedi [Fase 3](sezione:fase3-impegnativa).

=== faq
chiave: man-assegni
sezione: fase2-canale-privato
ruolo: accettazione
domanda: Posso accettare un pagamento con assegno?
===
No. Regola TD (manuale operativo): si accettano contanti, POS, bonifico e pagamenti digitali, non gli assegni. Vedi [Fase 2: canale privato](sezione:fase2-canale-privato).

=== faq
chiave: man-rifirmare
sezione: fase1-anagrafica-consensi
ruolo: accettazione
domanda: Il paziente deve rifirmare i consensi a ogni accesso?
===
No: la firma grafometrica resta archiviata nel profilo del paziente; si rifirma solo se cambiano i moduli per motivi normativi o ci sono nuovi trattamenti. A ogni accesso però verifica telefono ed e-mail. Vedi [Fase 1](sezione:fase1-anagrafica-consensi).

=== faq
chiave: man-associa-medico-immagini
sezione: fase4-assegnazione
ruolo: accettazione
domanda: Perché devo usare Associa medico per gli esami di diagnostica per immagini?
===
Perché in TD il radiologo referta su GIPO, non su ZeeroMed: il medico associato all'episodio in assegnazione vede le immagini acquisite e scrive e firma il referto in GIPO. Senza Associa medico il referto non arriva al medico giusto. Vedi [Fase 4](sezione:fase4-assegnazione) e [Fase 6b](sezione:fase6b-immagini).

=== faq
chiave: man-assicurazione-diretta
sezione: fase2-canale-assicurazione
ruolo: accettazione
domanda: Con un'assicurazione in forma diretta a chi intesto la fattura?
===
All'ente assicurativo, per l'intero importo o per la parte non coperta dalla franchigia, dopo aver verificato autorizzazione, validità e massimale; in forma indiretta la fattura va al paziente per l'intero importo. Sempre esente IVA art. 10 n. 18 DPR 633/72, con bollo virtuale sopra 77,47 euro. Vedi [Fase 2: canale assicurazione](sezione:fase2-canale-assicurazione).

=== faq
chiave: man-certificato-sportivo
sezione: sport-idoneita-certificati
ruolo: medico
domanda: Come genero il certificato di idoneità sportiva?
===
Nella visita, sezione **Idoneità e Certificati**, scegli l'esito per lo sport: con "Idoneo" GIPO assegna numero e scadenza; salvata la visita, il pulsante **Certificati** genera il PDF e **Relazione sintetica** la cartella della visita. Con "Non idoneo" serve il **Motivo non idoneità** e non si genera il certificato. Vedi [Idoneità, certificati e relazione sintetica](sezione:sport-idoneita-certificati).

=== faq
chiave: man-registro-idoneita
sezione: sport-elenco-visite
ruolo: medico
domanda: Come esporto il registro delle idoneità sportive?
===
**Med. dello sport > Elenco visite**, pulsante **Registro idoneità**: esporta in Excel gli idonei in due elenchi, Agonisti e Non Agonisti. Vedi [Elenco visite](sezione:sport-elenco-visite).
