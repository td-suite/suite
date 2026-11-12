---
capitolo: 14
titolo: Back-end: configurare GIPO
intro: Le procedure complete per chi configura GIPO: agende e orari, sottoconfigurazioni (periodi, settimane alterne, giorni del mese), festivi, prestazioni, listini e prezzi, pacchetti, consensi, medici e compensi, tabelle, sedi, sezionali e utenti. Ogni procedura dice cosa controllare dopo.
---

=== sezione
ordine: 1
slug: backend-mappa
titolo: Back-end: cosa si configura e dove
parole_chiave: back-end, back office, configurare, configurazione, impostare, dove si imposta, mappa, amministratore, procedure di configurazione
sintesi: Mappa delle configurazioni di GIPO: per ogni esigenza (orari, giorni del mese, ferie, prezzi, pacchetti, consensi, compensi, sedi) la voce di menu e la sezione con la procedura.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
È il punto di partenza per chi configura GIPO: dice dove si interviene per ogni esigenza e rimanda alla procedura completa.

### Cosa voglio fare, dove si fa
| Esigenza | Dove in GIPO | Procedura |
|---|---|---|
| Creare l'agenda di un medico, di un ambulatorio o di una macchina | Configurazione > Agende > Configurazioni > Aggiungi | [Creare un'agenda](sezione:agenda-creare) |
| Orario normale della settimana, durata degli slot | Scheda agenda > Dati generali > Configurazione base | [Orario settimanale](sezione:agenda-orario-base) |
| Medico presente solo alcuni giorni del mese (es. primo e terzo martedì), settimane alterne, orario estivo, orario da una certa data | Scheda agenda > Sottoconfigurazioni | [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni) |
| Quali prestazioni si prenotano su un'agenda | Scheda agenda > Prestazioni / Listini | [Prestazioni prenotabili](sezione:agenda-prestazioni-prenotabili) |
| Una prestazione che occupa solo una parte dello slot | Scheda agenda > Occupazioni parziali | [Occupazioni parziali](sezione:agenda-occupazioni-parziali) |
| Copiare un'agenda | Configurazioni agende > Altre azioni > Duplica agenda | [Duplicare un'agenda](sezione:agenda-duplicare) |
| Festività e chiusure | Configurazione > Agende > Calendario > Giorni festivi | [Giorni festivi e chiusure](sezione:giorni-festivi-chiusure) |
| Nuova prestazione | Configurazione > Prestazioni > Prestazioni | [Creare una prestazione](sezione:prestazione-nuova) |
| Prezzo di una prestazione in un listino, anche da una certa data | Scheda prestazione > Listini | [Listini e prezzi con validità](sezione:prestazione-listini-prezzi) |
| Nuovo listino, aumento dei prezzi in % o in euro | Configurazione > Prestazioni > Listini | [Listini: creare e copiare](sezione:listini-creare-copiare) |
| Pacchetto di prestazioni | Scheda prestazione > Distinta base | [Pacchetti](sezione:pacchetti-distinta-base) |
| Consenso o modulo da far firmare per una prestazione | Scheda prestazione > Moduli collegati | [Moduli e consensi](sezione:prestazione-moduli-consensi) |
| Nuovo medico e prestazioni che esegue | Configurazione > Aziende > Medici | [Nuovo medico](sezione:medico-nuovo) |
| Compenso del medico | Scheda medico > Compensi | [Regole di compenso](sezione:medico-compensi-regole) |
| Assicurazione o convenzione | Configurazione > Assicurazioni e Listini | [Assicurazioni e convenzioni](sezione:assicurazione-convenzione) |
| Sede, utenza di sede, sezionale | Configurazione > Sedi, Configurazione > Fatturazione > Sezionali documento | [Sedi e sezionali](sezione:sede-sezionale-nuovi) |
| Metodi di pagamento, tipi ticket, specialità e altre tabelle | griglie modificabili in riga | [Tabelle in riga](sezione:tabelle-in-riga) |
| Nuovo collega che deve entrare in GIPO | Configurazione > Permessi > Utenti | [Accesso di un nuovo collega](sezione:utenti-nuovo-collega) |

### Regole per chi configura
1. Prova ogni modifica prima su un'agenda o una prestazione **di prova** (per esempio un'agenda creata apposta, non visibile ai servizi esterni), poi applicala a quella vera.
2. Dopo ogni modifica fai le verifiche descritte in [Dopo una modifica: cosa controllare](sezione:backend-verifiche).
3. Una modifica in configurazione vale per tutte le sedi: concordala con chi coordina le agende e con l'amministrazione per prezzi, sezionali e tabelle SSN.
4. Il **Log attività** registra chi ha fatto cosa (vedi [Log attività](sezione:log-attivita)).

### Attenzioni
- Le procedure di questo capitolo sono ricavate dai campi e dai pulsanti visti dal vivo nelle schede di configurazione (analisi del 12 e 13/11/2026, in sola lettura): sono scritte per intero ma vanno provate prima su un'agenda o una prestazione di prova.

=== sezione
ordine: 2
slug: agenda-creare
titolo: Creare un'agenda
percorso_gipo: /Agende/Configurazioni
parole_chiave: nuova agenda, creare agenda, aggiungere agenda, agenda medico, agenda nuovo medico, agenda ambulatorio, agenda macchina, nuova configurazione agenda, sigla, colore, risorsa, sede, medico collegato
sintesi: Procedura completa per creare una nuova agenda (Configurazione > Agende > Configurazioni > Aggiungi): dati generali, medico, risorsa, sede, orario base, prestazioni.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Creare l'agenda su cui si prenotano gli appuntamenti di un medico, di un ambulatorio, di una stanza o di una macchina.

### Dove si trova
**Configurazione > Agende > Configurazioni** (percorso /Agende/Configurazioni), pulsante **Aggiungi**: si apre **Nuova configurazione agenda** (/Agende/CreateConfigurazione). Dall'agenda classica ci si arriva anche con **Configurazione > Agende e disponibilità**.

Se esiste già un'agenda simile, conviene partire da quella: vedi [Duplicare un'agenda](sezione:agenda-duplicare).

### Come si fa
1. Apri **Configurazione > Agende > Configurazioni** e premi **Aggiungi**.
2. Scheda **Dati generali**, compila:
   - **Nome Agenda** (per esempio "Cardiologia Dr. Cognome, sede di Calenzano") e **Sigla** (breve, compare nelle viste affollate);
   - **Colore** (per riconoscerla nell'agenda classica);
   - **Medico collegato**: scrivi cognome o nome nel campo "Digita Cognome o Nome medico da collegare..." e scegli il medico (deve esistere in archivio, vedi [Nuovo medico](sezione:medico-nuovo));
   - **Risorsa** (il tipo: Medico, Ambulatorio, Macchina, Stanza...; le risorse si gestiscono in Configurazione > Agende > Risorse);
   - **Sede**: la sede in cui l'agenda lavora;
   - **Nota** ("Nota facoltativa in agenda") e **Luogo** ("Nome e indirizzo completo del luogo"), se servono;
   - **Max appuntamenti per slot**: quanti pazienti si possono mettere nello stesso slot (1 per una visita singola).
3. Lascia spenti, finché la direzione non decide, **Mostra in servizi esterni**, **Abilita condivisione calendar** e **Agenda Cup** (con il "Codice identificativo Agenda esterna nel CUP"): espongono l'agenda a canali esterni.
4. Sempre in **Dati generali**, imposta la **Configurazione base**, cioè l'orario normale della settimana: vedi [Orario settimanale di un'agenda](sezione:agenda-orario-base).
5. Premi **Salva** (resti nella scheda) oppure **Salva e chiudi**.
6. Dopo il primo salvataggio completa le altre schede:
   - **Sottoconfigurazioni** per orari diversi in certi periodi, settimane alterne o solo alcuni giorni del mese ([Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni));
   - **Prestazioni / Listini** per indicare cosa si prenota ([Prestazioni prenotabili](sezione:agenda-prestazioni-prenotabili));
   - **Occupazioni parziali** se una prestazione occupa solo una parte dello slot ([Occupazioni parziali](sezione:agenda-occupazioni-parziali)).

### Esempio
Nuovo dermatologo nella sede di Quarrata, il lunedì pomeriggio: Nome Agenda "Dermatologia Quarrata", Sigla "DERM-QU", Medico collegato il dermatologo, Risorsa Medico, Sede Quarrata, Max appuntamenti per slot 1; Configurazione base: Lunedì attivo, periodo 14:00-18:00, Slot 20; Prestazioni / Listini: la visita dermatologica e il controllo nei.

### Cosa verificare dopo
- In **Agenda > Classica** l'agenda compare nell'elenco a sinistra (sotto la sua sede o risorsa) e mostra gli slot nei giorni attivi.
- **Trova spazio libero** propone spazi su quell'agenda.
- Nel **Wizard** le prestazioni previste trovano slot sull'agenda.

### Attenzioni
- Se il medico non compare in **Medico collegato**, va prima creato in Configurazione > Aziende > Medici.
- Da provare prima su un'agenda di prova: l'ordine esatto dei passi e quali campi sono obbligatori non sono stati osservati con un salvataggio reale.

=== sezione
ordine: 3
slug: agenda-orario-base
titolo: Orario settimanale di un'agenda (configurazione base)
percorso_gipo: /Agende/Configurazioni
parole_chiave: configurazione base, orario agenda, orari, orario settimanale, giorni della settimana, attiva disattiva configurazione, periodo, aggiungi periodo, rimuovi periodo, slot, durata slot, minuti, mattina pomeriggio, copia configurazione su tutti i giorni attivi, cambiare orario
sintesi: Come impostare l'orario normale della settimana di un'agenda: giorni attivi, periodi orari (mattina, pomeriggio), durata dello slot da 5 a 60 minuti, copia su tutti i giorni.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
La **Configurazione base** è l'orario normale e ricorrente dell'agenda: per ogni giorno della settimana dice se l'agenda lavora, in quali fasce orarie e con quale durata di slot. Vale sempre, salvo i periodi coperti da una sottoconfigurazione.

### Dove si trova
Scheda dell'agenda (**Configurazione > Agende > Configurazioni**, **Modifica** sulla riga), scheda **Dati generali**, riquadro **Configurazione base**.

### Cosa c'è
Per ogni giorno, da **Lunedì** a **Domenica**:
- l'interruttore **Attiva\Disattiva configurazione**;
- **Aggiungi**, che crea un periodo ("Periodo 1", "Periodo 2"...) con **dalle ore** / **alle ore** e **Slot (min.)**, a scelta fra 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60;
- **Rimuovi periodo** su ogni periodo;
- in **Altre azioni**: **Copia configurazione su tutti i giorni attivi**.

### Come si fa
1. Apri la scheda dell'agenda e vai al riquadro **Configurazione base**.
2. Accendi **Attiva\Disattiva configurazione** sui giorni in cui l'agenda lavora; lascia spenti gli altri.
3. Sul primo giorno premi **Aggiungi** e imposta il periodo (per esempio 08:00-13:00) e lo **Slot (min.)** (per esempio 15).
4. Se il giorno ha anche il pomeriggio premi di nuovo **Aggiungi** (Periodo 2, per esempio 14:30-18:30). La pausa pranzo è semplicemente lo spazio tra i due periodi.
5. Se gli altri giorni hanno lo stesso orario usa **Altre azioni > Copia configurazione su tutti i giorni attivi**, poi correggi i giorni diversi.
6. Premi **Salva** o **Salva e chiudi**.

### Esempio
Ecografia dal lunedì al venerdì 08:00-13:00 e il mercoledì anche 15:00-18:00, slot da 20 minuti: attiva da Lunedì a Venerdì; sul Lunedì Aggiungi 08:00-13:00 Slot 20; Copia configurazione su tutti i giorni attivi; sul Mercoledì Aggiungi 15:00-18:00 Slot 20; Salva.

### Per cambiare l'orario
- **Per sempre**: modifica i periodi della configurazione base.
- **Da una certa data in poi** o **solo per un periodo** (estate, sostituzione, un mese diverso): non toccare la base, crea una sottoconfigurazione con le date di validità (vedi [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni)). Così il vecchio orario resta valido fino al giorno prima.

### Cosa verificare dopo
- **Agenda > Classica**, vista **Settimana**: gli slot devono comparire solo nei giorni e nelle ore impostati e con la durata scelta.
- Se la durata dello slot cambia, controlla che le prestazioni prenotabili abbiano una durata compatibile.

### Attenzioni
- Cambiare orari o slot di un'agenda che ha già appuntamenti può lasciare appuntamenti fuori orario o a cavallo di due slot: concordalo con la sede e controlla gli appuntamenti futuri in vista Lista.
- Nell'elenco del primo rilievo lo slot andava da 5 a 50 minuti; nel modulo osservato il 13/11/2026 arriva a 60.
- Da provare prima su un'agenda di prova.

=== sezione
ordine: 4
slug: agenda-sottoconfigurazioni
titolo: Sottoconfigurazioni: periodi di validità, settimane alterne, giorni del mese
percorso_gipo: /Agende/Configurazioni
parole_chiave: sottoconfigurazione, sottoconfigurazioni, nuova sottoconfigurazione, periodicità nel mese, primo martedì, terzo martedì, secondo, quarto, ultimo giorno del mese, solo alcuni giorni del mese, periodicità in settimane, settimane alterne, ogni due settimane, una settimana sì e una no, quindicinale, priorità, data inizio validità, data fine validità, orario estivo, orario invernale, cambio orario da una data, sostituzione, ferie medico, medico presente solo alcuni giorni, ricorrenza, mensile
sintesi: Come dare a un'agenda orari diversi da quelli base in un periodo, a settimane alterne o solo in certi giorni del mese (primo, secondo, terzo, quarto, ultimo giorno): esempi svolti per primo e terzo martedì, settimane alterne, orario estivo, sostituzione, ferie.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Una **sottoconfigurazione** è un orario alternativo dell'agenda che vale solo in un periodo (dalla data di inizio alla data di fine validità) e che può ripetersi a settimane alterne o solo in certi giorni del mese. Nel periodo di validità **sostituisce la configurazione base**: GIPO lo dice nella scheda con l'avviso "Il periodo di validità di una sottoconfigurazione sovrascrive la configurazione base."

È lo strumento per tutti i casi in cui l'orario non è uguale ogni settimana:
- medico presente solo alcuni giorni del mese (per esempio il primo e il terzo martedì);
- medico a settimane alterne;
- orario estivo o invernale;
- cambio di orario da una certa data;
- sostituzione temporanea o ferie di un solo medico.

### Dove si trova
Scheda dell'agenda (**Configurazione > Agende > Configurazioni**, **Modifica** sulla riga), scheda **Sottoconfigurazioni**.

### Cosa c'è
Elenco delle sottoconfigurazioni dell'agenda con le colonne **Attiva**, **Data inizio validità**, **Data fine validità**, **Periodicità**, **Priorità**, e il pulsante **Nuova sottoconfigurazione** (/SottoConfigurazioniAgenda/Create).

Il modulo **Nuova sottoconfigurazione** ha due parti.

**Dati generali**:
- **Data inizio validità** e **Data fine validità**;
- **Attiva sottoconfig.** (se spenta, la sottoconfigurazione resta salvata ma non vale);
- **Periodicità in settimane**: un numero da 1 a 4. 1 = ogni settimana, 2 = una settimana sì e una no, 3 = una ogni tre, 4 = una ogni quattro;
- **Priorità**: un numero, serve quando più sottoconfigurazioni valgono negli stessi giorni.

**Configurazione**, per ogni giorno della settimana:
- l'interruttore **Attiva\Disattiva**;
- **Periodicità nel mese**: menu a scelta multipla, predefinito **Tutti**; le voci sono **Primo**, **Secondo**, **Terzo**, **Quarto**, **Ultimo** di quel giorno (per il martedì: "Primo martedì", "Secondo martedì", "Terzo martedì", "Quarto martedì", "Ultimo martedì");
- i periodi orari con **Slot (min.)**, **Aggiungi** e **Rimuovi periodo**, come nella configurazione base.

In fondo **Indietro** e **Salva**.

### Come si fa (procedura generale)
1. Apri la scheda dell'agenda e la scheda **Sottoconfigurazioni**; premi **Nuova sottoconfigurazione**.
2. In **Dati generali** imposta **Data inizio validità** e **Data fine validità**, accendi **Attiva sottoconfig.**, scegli **Periodicità in settimane** (1 se vale ogni settimana) e una **Priorità** (1 se è l'unica).
3. In **Configurazione** accendi solo i giorni in cui l'agenda lavora in quel periodo; per ciascuno scegli la **Periodicità nel mese** (lascia **Tutti** se vale ogni settimana del mese) e aggiungi i periodi orari con lo **Slot (min.)**.
4. Spegni i giorni in cui l'agenda in quel periodo non deve lavorare: nel periodo di validità vale la sottoconfigurazione, non la base.
5. Premi **Salva** e torna all'elenco: la riga deve risultare **Attiva** con le date e la periodicità giuste.
6. Verifica in **Agenda > Classica** (vedi sotto).

### Esempio 1: medico presente il primo e il terzo martedì del mese
Il medico viene in una struttura solo il primo e il terzo martedì di ogni mese, dalle 9:00 alle 13:00, visite da 20 minuti, a partire da dicembre 2026.
1. Se l'agenda non esiste, creala ([Creare un'agenda](sezione:agenda-creare)) con il medico collegato e la sede della struttura.
2. Nella **Configurazione base** lascia il **martedì disattivato** (o senza periodi): così l'agenda non è prenotabile negli altri martedì. Se l'agenda serve solo per questo medico, tutti i giorni della base restano spenti.
3. Scheda **Sottoconfigurazioni** > **Nuova sottoconfigurazione**.
4. **Dati generali**: Data inizio validità 01/12/2026; Data fine validità 31/12/2027 (o la data fino a cui l'accordo vale); **Attiva sottoconfig.** acceso; **Periodicità in settimane** 1; **Priorità** 1.
5. **Configurazione**: accendi solo **Martedì**; in **Periodicità nel mese** togli "Tutti" e scegli **Primo martedì** e **Terzo martedì**; **Aggiungi** il periodo 09:00-13:00 con **Slot (min.)** 20.
6. Tutti gli altri giorni restano spenti. **Salva**.
7. Verifica: **Agenda > Classica**, vista **Mese**, agenda del medico: gli slot devono comparire solo il primo e il terzo martedì (dicembre 2026: martedì 1 e martedì 15; gennaio 2027: martedì 5 e martedì 19), non il secondo né il quarto né il quinto.

Se il medico viene anche nell'ultimo giovedì del mese, nella stessa sottoconfigurazione accendi **Giovedì** con Periodicità nel mese **Ultimo giovedì**.

### Esempio 2: medico a settimane alterne
Il medico viene il giovedì pomeriggio una settimana sì e una no, dalle 14:00 alle 18:00, a partire da giovedì 3 dicembre 2026.
1. Configurazione base: **Giovedì** disattivato.
2. **Nuova sottoconfigurazione**: Data inizio validità 03/12/2026 (un giovedì in cui il medico c'è), Data fine validità per esempio 30/06/2027; **Periodicità in settimane** 2; Priorità 1.
3. **Configurazione**: accendi **Giovedì**, Periodicità nel mese **Tutti**, periodo 14:00-18:00, Slot 30. **Salva**.
4. Verifica in **Agenda > Classica**, vista **Mese**: slot il 3, 17 e 31 dicembre, non il 10 e il 24. Se GIPO conta le settimane alterne partendo da un'altra settimana (non osservato), sposta la Data inizio validità di una settimana.

### Esempio 3: orario estivo dal 1° luglio al 31 agosto
D'estate l'ambulatorio lavora solo la mattina, 08:00-13:00, dal lunedì al venerdì.
1. Lascia la configurazione base con l'orario normale (mattina e pomeriggio).
2. **Nuova sottoconfigurazione**: Data inizio validità 01/07/2027, Data fine validità 31/08/2027, Periodicità in settimane 1, Priorità 1.
3. **Configurazione**: accendi da Lunedì a Venerdì, Periodicità nel mese Tutti, un solo periodo 08:00-13:00 con lo stesso slot della base. **Salva**.
4. Verifica: in vista **Settimana** su una settimana di luglio i pomeriggi non hanno slot; il 1° settembre torna l'orario base.

Lo stesso schema serve per **cambiare l'orario da una certa data**: Data inizio validità = il primo giorno del nuovo orario, Data fine validità lontana (per esempio fine dell'anno successivo); alla scadenza si aggiorna la base o si proroga la sottoconfigurazione.

### Esempio 4: sostituzione temporanea
Dal 9 al 20 febbraio un collega sostituisce il medico titolare, negli stessi orari.
1. Agenda del **titolare**: **Nuova sottoconfigurazione** dal 09/02/2027 al 20/02/2027, Priorità 1, con **tutti i giorni spenti**: in quel periodo l'agenda del titolare non è prenotabile.
2. Agenda del **sostituto**: se non esiste, duplica quella del titolare ([Duplicare un'agenda](sezione:agenda-duplicare)) e cambia **Nome Agenda** e **Medico collegato**; nella configurazione base del sostituto lascia tutti i giorni spenti.
3. Agenda del sostituto: **Nuova sottoconfigurazione** dal 09/02/2027 al 20/02/2027 con gli stessi giorni e orari del titolare. **Salva**.
4. Verifica in **Agenda > Classica** affiancando le due agende (**Affianca tutto**) su quelle due settimane: slot solo sull'agenda del sostituto.
5. Gli appuntamenti già presi sul titolare in quel periodo vanno spostati a mano (controlla in vista **Lista**).

In alternativa, se il medico collegato all'agenda conta solo per il referto e i compensi, si può tenere l'agenda e usare **Associa medico** sulle prestazioni del periodo (vedi [Cambio listino, Associa medico, Applica nota](sezione:assegnazione-listino-medico-nota)): scegli la via con l'amministrazione, perché cambia i compensi.

### Esempio 5: chiusura per ferie
- **Chiude tutta la struttura** (o l'azienda) in certi giorni: usa i **Giorni festivi** del Calendario, **Aggiungi periodo festivo** Dalla data / Alla data (vedi [Giorni festivi e chiusure](sezione:giorni-festivi-chiusure)).
- **Va in ferie un solo medico** (per esempio dal 10 al 21 agosto): agenda del medico, **Nuova sottoconfigurazione** dal 10/08/2027 al 21/08/2027 con tutti i giorni spenti e una **Priorità** che la faccia prevalere su altre sottoconfigurazioni dello stesso periodo (per esempio l'orario estivo). Verifica in vista **Mese** che quei giorni non abbiano slot.

### Priorità: quando due sottoconfigurazioni si sovrappongono
Se in uno stesso giorno valgono due sottoconfigurazioni (per esempio "orario estivo" e "ferie del medico"), GIPO usa la **Priorità** per scegliere quale applicare. Quale numero prevale (il più alto o il più basso) non è stato osservato: prima di contarci crea due sottoconfigurazioni di prova sovrapposte su un'agenda di prova e guarda in Agenda classica quale vince; annota il risultato nella guida con "Mi è stata utile: no" o tramite la redazione.

### Cosa verificare dopo
1. Nell'elenco **Sottoconfigurazioni** la riga è **Attiva**, con date, **Periodicità** e **Priorità** corrette.
2. **Agenda > Classica**, agenda interessata, vista **Mese** e poi **Settimana**: gli slot ci sono solo nei giorni previsti, con l'orario e la durata giusti; prima della data di inizio e dopo la data di fine torna la configurazione base.
3. **Trova spazio libero** su un periodo di tre mesi propone solo i giorni previsti.
4. Dal **Wizard** una prestazione prenotabile su quell'agenda trova gli stessi giorni.

### Attenzioni
- I campi e le voci sono quelli visti nel modulo "Nuova sottoconfigurazione" (13/11/2026); il comportamento nel calendario è dedotto dai campi e non è stato osservato con un salvataggio.
- Da provare prima su un'agenda di prova e verificare in Agenda classica: in particolare il conteggio delle settimane alterne, la Data fine validità lasciata vuota e quale Priorità prevale.

=== sezione
ordine: 5
slug: agenda-prestazioni-prenotabili
titolo: Prestazioni prenotabili su un'agenda
percorso_gipo: /Agende/Configurazioni
parole_chiave: prestazioni prenotabili, limitare prestazioni agenda, cosa si prenota su un'agenda, prestazioni listini agenda, abilitare prestazione su agenda, gruppo articolo, specialità, prestazione non prenotabile, slot non accetta
sintesi: Come indicare (e limitare) quali prestazioni e listini si possono prenotare su un'agenda dalla scheda Prestazioni / Listini.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Indicare quali prestazioni (e con quale listino) si possono prenotare su un'agenda, per evitare per esempio che una visita cardiologica finisca sull'agenda dell'ecografo.

### Dove si trova
Scheda dell'agenda, scheda **Prestazioni / Listini**.

### Cosa c'è
Elenco con le colonne **Prestazione / Prodotto**, **Listino**, **Gruppo Articolo**, **Specialità**; pulsanti **Aggiungi** ed **Excel**.

### Come si fa
1. Apri la scheda dell'agenda e la scheda **Prestazioni / Listini**.
2. Premi **Aggiungi**: compare una riga nuova.
3. Scegli la **Prestazione / Prodotto** e, se la regola vale solo per un listino, il **Listino**. Le colonne **Gruppo Articolo** e **Specialità** fanno pensare che si possa abilitare un intero gruppo o una specialità invece delle singole prestazioni (da verificare).
4. Ripeti per ogni prestazione da rendere prenotabile; salva la scheda.
5. Con **Excel** esporti l'elenco per controllarlo o condividerlo.

### Esempio
Agenda "Ecografo Calenzano": aggiungi le righe dell'ecografia addome completo, dell'ecografia tiroidea e dell'ecografia muscolo-tendinea, listino privato e listino SSN.

### Cosa verificare dopo
- Nel **Wizard**, scelta una prestazione inclusa, l'agenda propone slot; scelta una prestazione esclusa, l'agenda non deve proporne.
- In **Agenda > Classica** prova a prenotare una prestazione esclusa su un'agenda di prova.

### Attenzioni
- Che un'agenda **senza righe** accetti tutte le prestazioni o nessuna non è stato osservato: controllalo su un'agenda di prova prima di svuotare l'elenco.
- Funzione dedotta dal nome della scheda: da provare prima su un'agenda di prova.

=== sezione
ordine: 6
slug: agenda-occupazioni-parziali
titolo: Occupazioni parziali
percorso_gipo: /Agende/Configurazioni
parole_chiave: occupazioni parziali, peso, percentuale slot, mezzo slot, più pazienti nello slot, prestazione breve, occupa parte dello slot, max appuntamenti per slot
sintesi: Come far occupare a una prestazione solo una parte dello slot di un'agenda (scheda Occupazioni parziali, peso in percentuale).
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Dal nome e dai campi, la scheda **Occupazioni parziali** permette di dire che una prestazione occupa solo una parte dello slot (il **Peso (%)**), così nello stesso slot possono stare più prestazioni brevi.

### Dove si trova
Scheda dell'agenda, scheda **Occupazioni parziali**.

### Cosa c'è
Elenco con le colonne **Prestazione** e **Peso (%)**; pulsanti **Aggiungi** ed **Excel**.

### Come si fa
1. Apri la scheda dell'agenda e la scheda **Occupazioni parziali**.
2. Premi **Aggiungi**, scegli la **Prestazione** e indica il **Peso (%)**: per esempio 50 se la prestazione occupa metà dello slot.
3. Salva.

### Esempio
Agenda prelievi con slot da 10 minuti: il prelievo semplice con Peso 50 permette (dedotto) due prelievi nello stesso slot.

### Cosa verificare dopo
- Su un'agenda di prova prenota due volte la stessa prestazione nello stesso slot e guarda se GIPO lo accetta e come lo mostra.

### Attenzioni
- Il comportamento è dedotto dal nome della scheda e delle colonne: da verificare. Esiste anche **Max appuntamenti per slot** nei Dati generali dell'agenda: chiarisci con una prova quale delle due regole prevale.

=== sezione
ordine: 7
slug: agenda-duplicare
titolo: Duplicare un'agenda
percorso_gipo: /Agende/Configurazioni
parole_chiave: duplica agenda, copiare agenda, clonare agenda, agenda simile, nuova agenda da una esistente, elimina agenda
sintesi: Come creare una nuova agenda copiando una esistente (Altre azioni > Duplica agenda) e cosa cambiare subito dopo.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Creare in fretta un'agenda simile a una esistente (stessi orari, stesse prestazioni), per un nuovo medico, una nuova sede o un sostituto.

### Dove si trova
**Configurazione > Agende > Configurazioni**, sulla riga dell'agenda da copiare: **Altre azioni > Duplica agenda**.

### Come si fa
1. Trova l'agenda di partenza nell'elenco (colonne Colore, Nome, Sigla, Risorsa, Medico, Sede; usa **Cerca**).
2. **Altre azioni > Duplica agenda**.
3. Apri la copia con **Modifica** e cambia subito **Nome Agenda**, **Sigla**, **Colore**, **Medico collegato** e, se serve, **Sede**.
4. Controlla la **Configurazione base**, le **Sottoconfigurazioni** (togli o disattiva quelle che non valgono per la copia), **Prestazioni / Listini** e **Occupazioni parziali**.
5. **Salva e chiudi**.

### Cosa verificare dopo
- In **Agenda > Classica** ci sono due agende distinte, ciascuna con il suo nome e il suo medico; la copia mostra gli slot attesi.

### Attenzioni
- Quali schede vengono copiate (sottoconfigurazioni, prestazioni, occupazioni parziali) non è stato osservato: controllale tutte sulla copia.
- **Elimina** (sempre in Altre azioni) su un'agenda con appuntamenti è rischioso: preferisci spegnere i giorni o chiederlo all'assistenza Gipo.

=== sezione
ordine: 8
slug: giorni-festivi-chiusure
titolo: Giorni festivi e chiusure
percorso_gipo: /ConfigurazioniCalendario/Index
parole_chiave: giorni festivi, festività, festivo, chiusura, ferie, chiusura per ferie, ponte, aggiungi periodo festivo, periodi attivi, sfondo rosso, natale, ferragosto, bloccare agenda, chiudere agenda
sintesi: Come inserire festività e chiusure (Calendario > Giorni festivi > Aggiungi periodo festivo) e come chiudere per ferie una sola agenda con una sottoconfigurazione.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Segnare i giorni di festa e le chiusure, perché non si prenoti in quei giorni.

### Dove si trova
**Configurazione > Agende > Calendario** (percorso /ConfigurazioniCalendario/Index), scheda **Giorni festivi**. Dall'agenda classica: **Configurazione > Calendario e festivi**.

### Cosa c'è
- Il testo di GIPO: "I periodi festivi vengono visualizzati con sfondo rosso all'interno del Calendario, viste Giorno, Settimana e Settimana Lavorativa."
- **Aggiungi periodo festivo**, con **Dalla data**, **Alla data** e il pulsante **Aggiungi**.
- **Periodi attivi**: l'elenco dei periodi inseriti (**Dal giorno**, **Al giorno**).

### Come si fa: festività e chiusure di tutti
1. Apri **Configurazione > Agende > Calendario**, scheda **Giorni festivi**.
2. In **Aggiungi periodo festivo** metti **Dalla data** e **Alla data** (per un giorno solo, la stessa data) e premi **Aggiungi**.
3. Il periodo compare in **Periodi attivi**.
4. A inizio anno inserisci tutte le festività nazionali e i santi patroni delle sedi.

### Come si fa: ferie di un solo medico o di una sola agenda
I Giorni festivi del Calendario non hanno un campo agenda o sede: per chiudere solo un'agenda usa una **sottoconfigurazione** con tutti i giorni spenti nel periodo di ferie (vedi l'esempio 5 di [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni)).

### Esempio
Chiusura aziendale dal 24/12/2026 al 26/12/2026: Dalla data 24/12/2026, Alla data 26/12/2026, Aggiungi.

### Cosa verificare dopo
- **Agenda > Classica**, vista **Settimana**: i giorni inseriti hanno lo sfondo rosso.
- Prova **Trova spazio libero** sul periodo: non deve proporre quei giorni.

### Attenzioni
- GIPO dichiara solo che i festivi si vedono con lo sfondo rosso: che blocchino anche la prenotazione (e da Wizard e servizi esterni) non è stato osservato. Da provare su un'agenda di prova; fino ad allora, per le chiusure importanti affianca una sottoconfigurazione con i giorni spenti.
- Il Calendario vale per tutte le sedi.

=== sezione
ordine: 9
slug: prestazione-nuova
titolo: Creare una prestazione
percorso_gipo: /Prestazione/Index
parole_chiave: nuova prestazione, creare prestazione, aggiungere esame, nuovo esame, nuova visita in archivio, codice prestazione, durata prestazione, tempo previsto, iva prestazione, natura, descrizione in fattura, attiva, note preparazione
sintesi: Come creare una nuova prestazione in archivio (scheda Generale: codici, descrizione, specialità, gruppo, IVA, durata, note di preparazione) e renderla vendibile e prenotabile.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Aggiungere all'archivio un esame o una visita nuovi, perché si possano prenotare, mettere in assegnazione e fatturare.

### Dove si trova
**Configurazione > Prestazioni > Prestazioni** (percorso /Prestazione/Index).

### Come si fa
1. Apri l'archivio prestazioni e premi **Aggiungi** (comando comune delle griglie; il modulo di creazione non è stato aperto durante l'analisi). In alternativa apri con **Modifica** una prestazione simile per avere sotto gli occhi i campi.
2. Scheda **Generale**, i campi principali:
   - **Descrizione** e **Descrizione in fattura**;
   - **Codice shortcut** (codice breve per la ricerca), **Codice LIS** solo per gli esami di laboratorio, d'accordo con il laboratorio;
   - **Specialità**, **Gruppo**, **Area**, **Tipo spesa**;
   - **Iva** e, se esente, **Natura** e **Rif. Normativo** (per le prestazioni sanitarie l'esenzione è quella dell'art. 10 n. 18 DPR 633/72, vedi [Fase 5: fatturazione](sezione:fase5-fatturazione));
   - **Tempo previsto (minuti)**, **Q.ta proposta**, **Prestazione ciclica** e **Q.ta ciclo terapeutico** per le terapie a sedute;
   - **Codice nomenclatore SSN**, **Codice catalogo prescrizione SSN**, **Codice interno prestazione CUP** per le prestazioni SSN e CUP;
   - **Codice CoGe** e **Centro di costo** (con l'amministrazione);
   - **Note preparazione** (il testo per il paziente, per esempio "digiuno da 8 ore") e **Colore**;
   - **Attiva** acceso; **Data scadenza** solo se la prestazione deve smettere di essere vendibile.
3. **Salva**. Poi completa:
   - scheda **Listini**: il prezzo in ogni listino in cui va venduta ([Listini e prezzi](sezione:prestazione-listini-prezzi));
   - scheda **Distinta base** se è un pacchetto ([Pacchetti](sezione:pacchetti-distinta-base));
   - scheda **Moduli collegati** se richiede un consenso ([Moduli e consensi](sezione:prestazione-moduli-consensi)).
4. Rendila prenotabile sulle agende giuste ([Prestazioni prenotabili](sezione:agenda-prestazioni-prenotabili)) e aggiungila alle prestazioni dei medici che la eseguono ([Nuovo medico](sezione:medico-nuovo)).

### Cosa verificare dopo
- In **Nuova assegnazione**, campo **Prestazione - Listino**, la prestazione si trova per codice o nome con il prezzo atteso.
- Nel **Wizard** trova slot sulle agende abilitate.

### Attenzioni
- Codici SSN, CUP e LIS sbagliati bloccano rendicontazione e invio al laboratorio: compilali con chi li gestisce.
- Da provare prima su una prestazione di prova (Attiva spenta finché non è pronta).

=== sezione
ordine: 10
slug: prestazione-listini-prezzi
titolo: Prestazione: listini e prezzi con validità
percorso_gipo: /Prestazione/Index
parole_chiave: prezzo prestazione, prezzi listini, aggiungere prestazione a un listino, cambiare prezzo, prezzo da una data, validità dal, validità al, valido, prezzo netto, prezzo ivato, quota assicurazione, costo di produzione, costo fisso materiali, descrizione in fattura listino, tariffa
sintesi: Come mettere una prestazione in un listino con il suo prezzo e cambiarne il prezzo da una certa data (scheda Listini della prestazione: Validità Dal/Al, Prezzo netto, Quota assicurazione).
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Dare a una prestazione il prezzo in ciascun listino (privato, convenzioni, assicurazioni, SSN) e programmare un cambio di prezzo da una certa data.

### Dove si trova
- Scheda della prestazione (**Configurazione > Prestazioni > Prestazioni**, **Modifica**), scheda **Listini**, riquadro "Prezzi listini".
- Dall'elenco delle prestazioni: **Prezzi Listino** sulla riga.
- Dal lato del listino: **Configurazione > Prestazioni > Listini**, **Modifica articoli listino** (vedi [Listini: creare e copiare](sezione:listini-creare-copiare)).

### Cosa c'è (scheda Listini della prestazione)
Colonne: **Listino**, **Validità Dal**, **Validità Al**, **Valido**, **Descrizione in fattura (listino)**, **Prezzo netto**, **Iva**, **Costo di produzione**, **Costo fisso materiali**, **Quota assicurazione**, **Codice CoGe**, **Centro di costo**, **Prezzo ivato**.

### Come si fa: aggiungere la prestazione a un listino
1. Apri la prestazione con **Modifica** e la scheda **Listini**.
2. Aggiungi una riga (pulsante **Aggiungi** della griglia) e scegli il **Listino**.
3. Imposta **Validità Dal** (da oggi o dalla data di avvio), lascia **Validità Al** vuota se il prezzo vale fino a nuovo ordine, accendi **Valido**.
4. Inserisci il **Prezzo netto** (con l'IVA giusta; il **Prezzo ivato** ne deriva) e, per i listini delle assicurazioni, la **Quota assicurazione**.
5. Se in fattura la prestazione deve avere un nome diverso per quel listino, compila **Descrizione in fattura (listino)**.
6. **Salva** o **Salva e chiudi**.

### Come si fa: cambiare il prezzo da una certa data
1. Nella scheda **Listini** della prestazione, sulla riga del listino attuale imposta **Validità Al** al giorno prima del cambio (per esempio 31/12/2026).
2. Aggiungi una nuova riga per lo stesso listino con **Validità Dal** 01/01/2027, il nuovo **Prezzo netto** e **Valido** acceso.
3. **Salva**.

### Esempio
Visita cardiologica, listino privato: 120 euro fino al 31/12/2026, 130 euro dal 01/01/2027: due righe dello stesso listino, la prima chiusa al 31/12/2026, la seconda aperta dal 01/01/2027.

### Cosa verificare dopo
- In **Nuova assegnazione** (su un paziente di prova o senza salvare), campo **Prestazione - Listino**, il prezzo proposto è quello giusto per la data.
- Nel **Wizard** il **PREZZO** proposto coincide.

### Attenzioni
- Se due righe dello stesso listino hanno validità sovrapposte, il risultato non è prevedibile: non lasciare sovrapposizioni.
- Le assegnazioni già create mantengono verosimilmente il prezzo con cui sono nate (da verificare): per cambiarlo su una pratica aperta si usa **Cambio listino** o si corregge la riga.
- Il comportamento delle date di validità è dedotto dai campi: da provare prima su una prestazione di prova.

=== sezione
ordine: 11
slug: listini-creare-copiare
titolo: Listini: creare, copiare i prezzi con incremento
percorso_gipo: /Listini/Index
parole_chiave: nuovo listino, creare listino, copia prezzi di listino, aumentare prezzi, aumento percentuale, incremento, incremento in percentuale, incremento in euro, aumentare del 5%, rincaro, modifica articoli listino, prezzi listino, listino convenzione, listino assicurazione, listino sede, listino ssn, disattivare listino, elimina listino
sintesi: Come creare un listino (in riga: Nome, Codice shortcut, Assicurazione e Sede collegate, Attivo, SSN), modificarne gli articoli e copiare i prezzi da un listino a un altro con un incremento in % o in euro (es. aumento del 5%).
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Gestire i listini: crearne uno nuovo (per esempio per una convenzione), cambiarne i prezzi, aumentarli tutti di una percentuale o di un importo.

### Dove si trova
**Configurazione > Prestazioni > Listini** (percorso /Listini/Index).

### Cosa c'è
Griglia modificabile in riga con le colonne **Nome**, **Codice shortcut**, **Assicurazione collegata**, **Sede collegata**, **Attivo**, **SSN**. Per riga: **Modifica articoli listino**, **Elimina**. Finestre **Prezzi Listino** e **Copia prezzi di listino** (incremento in % o in €).

### Come si fa: creare un listino
1. Premi **Aggiungi**: compare una riga nuova nella griglia (non si apre una pagina separata).
2. Scrivi **Nome** e **Codice shortcut**; collega l'**Assicurazione collegata** se è il listino di un'assicurazione o di un fondo, la **Sede collegata** se vale per una sola sede; **SSN** solo per il listino del Servizio sanitario; **Attivo** acceso.
3. Conferma la riga.
4. Riempi i prezzi: o con **Copia prezzi di listino** da un listino esistente (sotto), o con **Modifica articoli listino** riga per riga.

### Come si fa: aumentare tutti i prezzi di una percentuale (es. +5%)
1. Prima di tutto esporta con **Excel** il listino attuale, come copia di sicurezza.
2. Apri **Copia prezzi di listino**.
3. Scegli il listino di origine e quello di destinazione. La via più sicura è copiare in un **listino nuovo** (per esempio "Privato 2027", creato come sopra) invece che sullo stesso listino.
4. Scegli l'incremento **in %** e scrivi 5 (oppure **in €** per un aumento fisso a prestazione).
5. Conferma e apri il listino di destinazione con **Modifica articoli listino** o **Prezzi Listino** per controllare qualche prezzo a campione (100 euro devono diventare 105).
6. Quando il nuovo listino deve entrare in uso, spegni **Attivo** sul vecchio e accendilo sul nuovo (o usa le date di validità dei prezzi, vedi [Listini e prezzi con validità](sezione:prestazione-listini-prezzi)).

### Come si fa: aggiungere o cambiare un prezzo nel listino
1. Sulla riga del listino scegli **Modifica articoli listino** (oppure **Prezzi Listino** dalla prestazione).
2. Aggiungi la prestazione o correggi il prezzo, con le date di validità se il cambio vale da una data.

### Cosa verificare dopo
- In **Nuova assegnazione** il listino compare e propone i prezzi attesi; i pazienti con **Listino predefinito** o le assicurazioni collegate ricevono il listino giusto.

### Attenzioni
- I campi esatti della finestra **Copia prezzi di listino** (scelta di origine e destinazione, arrotondamenti, prestazioni già presenti) non sono stati osservati: prova prima copiando verso un listino di prova.
- **Elimina** su un listino usato da assegnazioni aperte può creare problemi: preferisci spegnere **Attivo**.
- Un cambio di listino ha effetti economici: va deciso con l'amministrazione.

=== sezione
ordine: 12
slug: pacchetti-distinta-base
titolo: Pacchetti con la distinta base
percorso_gipo: /Prestazione/Index
parole_chiave: pacchetto, creare pacchetto, pacchetti, distinta base, prestazione composta, check up, profilo esami, prestazioni collegate, incidenza, incidenza percentuale, split pacchetto, calcolo compensi su singola prestazione, inserisci prestazioni a quantità 1
sintesi: Come creare un pacchetto (prestazione composta) con la scheda Distinta base: prestazioni collegate, quantità, incidenza %, ordine, split in assegnazione e compensi sulle singole prestazioni.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Vendere più prestazioni insieme come un unico articolo (per esempio un check-up), con un prezzo di pacchetto, sapendo comunque quali prestazioni lo compongono.

### Dove si trova
Scheda della prestazione-pacchetto (**Configurazione > Prestazioni > Prestazioni**, **Modifica**), scheda **Distinta base**.

### Cosa c'è
- Elenco delle **Prestazioni collegate** con **Qta**, **Incidenza %**, **Ordine**; pulsante **Aggiungi**.
- Opzione **Calcolo compensi su singola prestazione.**
- Opzione **Inserisci prestazioni a quantità 1 in Assegnazione - Split pacchetto**.

### Come si fa
1. Crea la prestazione che rappresenta il pacchetto (per esempio "Check-up cardiologico") come in [Creare una prestazione](sezione:prestazione-nuova), con il suo prezzo nei listini.
2. Apri la scheda **Distinta base** e premi **Aggiungi** per ogni prestazione che lo compone (per esempio visita cardiologica, ECG, ecocardiogramma).
3. Per ciascuna indica **Qta**, l'**Incidenza %** (la quota del prezzo del pacchetto attribuita a quella prestazione: il totale dovrebbe fare 100) e l'**Ordine**.
4. Se i medici vanno pagati sulle singole prestazioni e non sul pacchetto, accendi **Calcolo compensi su singola prestazione.**
5. Se in assegnazione vuoi le singole prestazioni in righe separate da quantità 1, accendi **Inserisci prestazioni a quantità 1 in Assegnazione - Split pacchetto**.
6. **Salva**.

### Esempio
Check-up cardiologico a 180 euro: visita cardiologica Qta 1 Incidenza 50, ECG Qta 1 Incidenza 20, ecocardiogramma Qta 1 Incidenza 30.

### Cosa verificare dopo
- In **Nuova assegnazione** aggiungi il pacchetto e guarda le righe (raggruppamento **Pacchetto**, comandi **Split pacchetto** e **Split quantità**, vedi [Pacchetti e cicli terapeutici](sezione:assegnazione-pacchetti-cicli)).
- Con il **Riepilogo** dei compensi su un periodo di prova controlla su quali righe viene calcolato il compenso.

### Attenzioni
- L'effetto esatto di Incidenza % su prezzi e compensi non è stato osservato: da provare prima su un pacchetto di prova.

=== sezione
ordine: 13
slug: prestazione-moduli-consensi
titolo: Moduli e consensi collegati a una prestazione
percorso_gipo: /Prestazione/Index
parole_chiave: consenso, consenso informato, collegare consenso a prestazione, modulo da firmare, moduli collegati, mezzo di contrasto, privacy, anamnesi, firme terapia, modulistica, firma grafometrica
sintesi: Come collegare a una prestazione i moduli e i consensi da far firmare (scheda Moduli collegati), dopo averli creati in Configurazione > Modulistica.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Fare in modo che, per una certa prestazione (per esempio una TAC con mezzo di contrasto), il consenso o il modulo giusto sia proposto per la firma.

### Dove si trova
- Il modulo si prepara in **Configurazione > Modulistica** (vedi [Modulistica](sezione:config-modulistica)).
- Il collegamento si fa nella scheda della prestazione, scheda **Moduli collegati**.

### Cosa c'è
Scheda **Moduli collegati**: colonne **Modulo** e **Tipo**; pulsante **Aggiungi**. I tipi di modulo sono Altro, Consenso, Firme terapia, Anamnesi, Privacy.

### Come si fa
1. Se il modulo non esiste: **Configurazione > Modulistica**, crea il modulo con **Tipo** "Consenso" (Personalizzazione standard, oppure Template avanzato con **Carica nuovo modello Word**). Il testo deve essere approvato da chi si occupa di privacy e qualità.
2. Apri la prestazione con **Modifica** e la scheda **Moduli collegati**.
3. Premi **Aggiungi** e scegli il **Modulo**; ripeti per altri moduli.
4. **Salva**.

### Esempio
"TC addome con mezzo di contrasto": collega il consenso informato al mezzo di contrasto e il questionario anamnestico (tipo Anamnesi).

### Cosa verificare dopo
- In una **Nuova assegnazione** di prova con quella prestazione apri **Modulistica**: il modulo collegato deve essere proposto.
- Dopo la firma su tavoletta il modulo compare in **Pazienti > Storico firme**.

### Attenzioni
- Che il modulo collegato venga proposto da solo all'accettazione (e non solo dal pulsante Modulistica) non è stato osservato: da provare su una prestazione di prova.
- Regola TD dal manuale operativo: il consenso informato specifico si raccoglie per le prestazioni che lo richiedono (mezzo di contrasto, prelievo ematico, ecc.), vedi [Fase 1: anagrafica e consensi](sezione:fase1-anagrafica-consensi).

=== sezione
ordine: 14
slug: medico-nuovo
titolo: Nuovo medico e sue prestazioni
percorso_gipo: /Medici/Index
parole_chiave: nuovo medico, aggiungere medico, nuovo specialista, nuovo professionista, scheda medico, prestazioni del medico, utente collegato, albo, intramoenia, tipo di medico, specialità medico, intestazione referto, sezionale fattura medico, prescrittore
sintesi: Come inserire un nuovo medico (Configurazione > Aziende > Medici), collegarlo al suo utente, indicare le prestazioni che esegue, l'intestazione del referto, e poi creargli l'agenda e i compensi.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Censire un nuovo medico perché si possa collegare alle agende, alle prestazioni, ai referti, alle fatture e ai compensi.

### Dove si trova
**Configurazione > Aziende > Medici** (percorso /Medici/Index), pulsante **Aggiungi**.

### Come si fa
1. **Configurazione > Aziende > Medici**, **Aggiungi**: si apre il modulo del nuovo medico.
2. Compila **Tipo di medico**, **Specialità medico**, **Cognome**, **Nome**, **Numero iscrizione Albo**, **Scadenza assicurazione**, **Intramoenia** (se ricorre), **Cellulare**, **Email**, **PEC**, **Altri indirizzi email**.
3. Se il medico entra in GIPO con un suo utente, scegli l'**Utente collegato** (l'utente va prima invitato, vedi [Accesso di un nuovo collega](sezione:utenti-nuovo-collega)): serve per il Riepilogo personale dei compensi e per la refertazione.
4. **Salva** (non **Salva e chiudi**): dopo il primo salvataggio la scheda mostra le altre schede.
5. Scheda **Dati generali**: completa **Codice fiscale**, **P. IVA**, **Sezionale fattura** e, se prescrive per il SSN, i codici del prescrittore (Codice presidio appartenenza, Codice soggetto prescrittore, Codice specialità, Matricola, Tipologia soggetto prescrittore).
6. Scheda **Referto**: intestazione e firma dei suoi referti.
7. Scheda **Prestazioni**: aggiungi le prestazioni che il medico esegue, con **Listino**, **Gruppo**, **Specialità** e **Tempo previsto** in minuti.
8. Scheda **Compensi**: imposta le regole (vedi [Regole di compenso del medico](sezione:medico-compensi-regole)).
9. **Salva e chiudi**. Poi crea la sua agenda ([Creare un'agenda](sezione:agenda-creare)).

### Cosa verificare dopo
- Il medico compare in **Medico collegato** delle agende e in **Associa medico** di assegnazioni e fatture.
- Accedendo con il suo utente vede **Compensi > Riepilogo Personale**.

### Attenzioni
- La scheda **Compensi** avvisa: "Effettua la configurazione di almeno una prestazione per poter calcolare i compensi del medico.": senza righe nella scheda Prestazioni i compensi non si calcolano.
- **Scadenza assicurazione** va tenuta aggiornata.
- Da provare prima con un medico di prova se non si è sicuri dell'ordine dei passi.

=== sezione
ordine: 15
slug: medico-compensi-regole
titolo: Regole di compenso del medico
percorso_gipo: /Medici/Index
parole_chiave: compenso medico, regole compenso, provvigione, percentuale medico, quanto prende il medico, base di calcolo, data di riferimento, includi iva e tasse, ritenuta d'acconto, in percentuale, solo prestazioni erogabili, ruolo medico, valida dal, valida al, priorità compenso, impostare compenso
sintesi: Come impostare le regole di compenso di un medico nella scheda Compensi (base di calcolo, data di riferimento, IVA, ritenuta, percentuale o importo, regole per prestazione, listino o gruppo con validità e priorità).
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Dire a GIPO quanto spetta al medico per le prestazioni che esegue, così che **Compensi > Calcolo** produca le provvigioni.

### Dove si trova
Scheda del medico (**Configurazione > Aziende > Medici**, **Modifica**), scheda **Compensi**.

### Cosa c'è
Opzioni generali: **Base di calcolo**, **Data di riferimento**, **Includi IVA e tasse nei calcoli**, **Includi calcolo ritenuta d'acconto**, **In percentuale**, **Solo prestazioni erogabili**.

Regole (una riga per regola, pulsante **Aggiungi**): **Prestazione / Prodotto**, **Listino**, **Gruppo**, **Compenso**, **Ruolo medico**, **Valida dal**, **Valida al**, **Priorità**.

### Come si fa
1. Verifica che il medico abbia almeno una riga nella scheda **Prestazioni** (altrimenti la scheda Compensi lo segnala).
2. Scheda **Compensi**: scegli la **Base di calcolo** e la **Data di riferimento** (le voci dei menu non sono state annotate: scegli con l'amministrazione, per esempio incassato o fatturato, data del documento o della prestazione).
3. Decidi se **Includi IVA e tasse nei calcoli**, se **Includi calcolo ritenuta d'acconto** e se il compenso è **In percentuale** (altrimenti importo fisso); **Solo prestazioni erogabili** per escludere quelle non erogate.
4. Premi **Aggiungi** per ogni regola:
   - una regola generale (per esempio solo **Listino** privato, **Compenso** 50) e regole specifiche per singole prestazioni o **Gruppo**;
   - **Ruolo medico** se lo stesso medico ha compensi diversi per ruolo (per esempio esecutore o refertante: da verificare con l'amministrazione);
   - **Valida dal** / **Valida al** per gli accordi a tempo;
   - **Priorità** per dire quale regola vale quando più regole si applicano alla stessa prestazione.
5. **Salva**.

### Esempio
Medico al 50% sulle visite del listino privato e a 25 euro fisso sull'ECG dal 01/01/2027: regola 1 Listino privato, Compenso 50 (con In percentuale); regola 2 Prestazione ECG, Compenso 25, Valida dal 01/01/2027, Priorità più alta della regola 1 (quale numero prevale va verificato).

### Cosa verificare dopo
- **Compensi > Calcolo** su un periodo breve, poi **Compensi > Riepilogo** con il filtro **Medico**: controlla le colonne **Formula**, **Compenso** e **Dovuto** su qualche riga.

### Attenzioni
- **In percentuale** è un'opzione della scheda, non della singola regola: come convivono regole a percentuale e a importo fisso non è stato osservato.
- I compensi si calcolano sul medico associato alle righe (**Associa medico**): senza medico sulla riga il compenso manca.
- Procedura dedotta dai campi: prova prima su un medico e un periodo di prova; le regole economiche vanno decise dall'amministrazione.

=== sezione
ordine: 16
slug: assicurazione-convenzione
titolo: Assicurazioni e convenzioni: configurazione
parole_chiave: assicurazione, nuova assicurazione, convenzione, fondo sanitario, ente assicurativo, listino assicurazione, quota assicurazione, bollo a carico dell'ente, condizione di pagamento associata, numero pratica, forma diretta, forma indiretta
sintesi: Come configurare un'assicurazione o una convenzione: ente in Configurazione > Assicurazioni, listino collegato, quota a carico dell'assicurazione nei prezzi, uso in assegnazione.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Preparare GIPO per lavorare con un'assicurazione o un fondo sanitario: l'ente, il suo listino, la quota a suo carico.

### Come si fa
1. **Configurazione > Assicurazioni**: premi **Aggiungi** (riga nuova nella griglia) e compila **Ente assicurativo**, **Nome visualizzato**, **Condizione di pagamento associata**, **Bollo a carico dell'ente** se il bollo lo paga l'ente.
2. **Configurazione > Prestazioni > Listini**: crea il listino della convenzione con **Assicurazione collegata** = l'ente (vedi [Listini: creare e copiare](sezione:listini-creare-copiare)).
3. Riempi i prezzi; nella scheda **Listini** delle prestazioni indica la **Quota assicurazione** (vedi [Listini e prezzi con validità](sezione:prestazione-listini-prezzi)).
4. Per il singolo paziente: campo **Assicurazione** nella scheda paziente; nell'assegnazione la scheda **Assicurazione** (Assicurazione, **Numero pratica**) e le colonne **Quota assicurazione**, **Importo ass.**, **Importo paziente**.

### Cosa verificare dopo
- Una **Nuova assegnazione** di prova con il listino dell'assicurazione divide il prezzo tra **Importo ass.** e **Importo paziente**.
- Lo **Scadenzario**, filtro **Assicurazione**, mostra le quote a carico dell'ente.

### Attenzioni
- Le regole TD di accettazione per assicurazioni e fondi (forma diretta o indiretta, autorizzazione, massimale, franchigia, intestazione della fattura) sono in [Fase 2: canale assicurazione](sezione:fase2-canale-assicurazione).
- Procedura ricavata dai campi delle griglie: da provare con un'assicurazione di prova.

=== sezione
ordine: 17
slug: sede-sezionale-nuovi
titolo: Aggiungere una sede, un'utenza di sede o un sezionale
parole_chiave: nuova sede, aggiungere sede, nuovo punto prelievi, nuova struttura, utenze sedi, utente sede, sede collegata, nuovo sezionale, sezionale documento, numerazione fatture sede, dispositivo, limita a sede, predefinito per sede, codice asl, codice struttura, anagrafica fatturazione
sintesi: Come aggiungere una sede (Gestione sedi), collegare gli utenti alle sedi (Gestione utenze sedi) e creare un sezionale di fatturazione per sede (Sezionali documento), tutto in riga.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Aprire una nuova sede in GIPO: la sede, chi ci lavora, la sua numerazione delle fatture.

### Come si fa: nuova sede
1. **Configurazione > Sedi > Gestione sedi**, **Aggiungi**: riga nuova nella griglia.
2. Compila **Denominazione**, **Codice**, **Codice ASL**, **Codice Struttura** (gli ultimi due servono alla rendicontazione SSN: chiedili all'amministrazione).
3. Conferma la riga.

### Come si fa: utenti della sede
1. **Configurazione > Sedi > Gestione utenze sedi**, **Aggiungi**.
2. Scegli **Utente** e **Sede collegata**; conferma.

### Come si fa: sezionale della sede
1. **Configurazione > Fatturazione > Sezionali documento**, **Aggiungi**.
2. Compila **Descrizione**, **Codice aggiuntivo** e **Inserisci codice come** (come il codice entra nel numero del documento), **Anagrafica fatturazione** (il soggetto che emette), **Limita a sede** e **Predefinito per sede** sulla nuova sede; **Usa come Dispositivo** solo se richiesto dall'amministrazione.
3. Conferma la riga.

### Poi
- Crea le agende della sede con **Sede** = la nuova sede ([Creare un'agenda](sezione:agenda-creare)).
- Se la sede ha prezzi propri, crea un listino con **Sede collegata** ([Listini](sezione:listini-creare-copiare)).

### Cosa verificare dopo
- Nella **Lista di lavoro** e in **Agenda > Classica** la sede compare nei filtri.
- In **Nuova fattura** di prova, con un utente della sede, il campo **Numero documento e sezionale** propone il nuovo sezionale (senza creare la fattura).

### Attenzioni
- Sezionali e anagrafiche di fatturazione hanno effetti fiscali: si creano con l'amministrazione.
- Tabelle modificabili in riga (vedi [Tabelle in riga](sezione:tabelle-in-riga)); la procedura è ricavata dalle colonne: da provare.

=== sezione
ordine: 18
slug: tabelle-in-riga
titolo: Tabelle che si modificano in riga
parole_chiave: modificare in riga, aggiungere riga, tabelle configurazione, risorse, centri di lavoro, assicurazioni, sedi, utenze sedi, metodi di pagamento, nuovo metodo di pagamento, condizioni di pagamento, sezionali, anagrafiche, tipi ticket, codici esenzione, specialità, gruppi, aree, ruoli personale, nessuna pagina di creazione
sintesi: Quali tabelle di configurazione si aggiungono e modificano direttamente nella griglia (Aggiungi crea una riga nuova) e quali colonne hanno: risorse, centri di lavoro, assicurazioni, sedi, pagamenti, sezionali, anagrafiche, ticket, esenzioni, specialità, gruppi, aree, ruoli.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Molte tabelle di configurazione non hanno una pagina di creazione: si lavora direttamente nella griglia. Qui c'è l'elenco, con le colonne da compilare.

### Come si fa (vale per tutte)
1. Apri la voce di **Configurazione**.
2. Premi **Aggiungi**: compare una riga nuova in tabella.
3. Compila le colonne della riga e confermala (il comando di conferma della riga non è stato annotato: di solito un pulsante sulla riga stessa).
4. Per modificare: **Modifica** sulla riga. Per togliere: **Altre azioni** o il comando della riga, se presente.

### Le tabelle e le colonne
| Tabella (menu) | Colonne |
|---|---|
| Agende > Risorse | Descrizione, Ordine |
| Agende > Centri di lavoro | Nome, Ciclicità conteggio, Conteggio iniziale, Attivo |
| Assicurazioni | Ente assicurativo, Nome visualizzato, Condizione di pagamento associata, Bollo a carico dell'ente |
| Sedi > Gestione sedi | Denominazione, Codice, Codice ASL, Codice Struttura |
| Sedi > Gestione utenze sedi | Utente, Sede collegata |
| Fatturazione > Metodo di pagamento | Descrizione, Codice, Tipologia Sdi, Pagamento tracciato |
| Fatturazione > Condizioni pagamento | Prima rata Bollo, Codice, Descrizione |
| Fatturazione > Sezionali documento | Descrizione, Usa come Dispositivo, Codice aggiuntivo, Inserisci codice come, Anagrafica fatturazione, Limita a sede, Predefinito per sede |
| Fatturazione > Anagrafiche | Descrizione, Ragione Sociale, Codice Fiscale, Partita IVA, indirizzo, Regime fiscale, Cassa Prev., Cassa %, Istituto Finanziario, IBAN, Note |
| SSN > Tipi ticket | Identificativo Assoluto, Descrizione, Quota Fissa, Descrizione Breve |
| SSN > Codici esenzione | Codice, Descrizione, Tipo |
| Prestazioni > Specialità | Descrizione, Codice branca, Codice branca nazionale, Codice disciplina, Codice CoGe, Codice unità erogante, Centro di costo, Generica |
| Prestazioni > Gruppi | Descrizione, Codice, Codice CoGe, Centro di Costo |
| Prestazioni > Aree | Nome |
| Prestazioni > Listini | Nome, Codice shortcut, Assicurazione collegata, Sede collegata, Attivo, SSN |
| Aziende > Ruoli personale | Nome |

### Esempio: nuovo metodo di pagamento
**Configurazione > Fatturazione > Metodo di pagamento**, **Aggiungi**, la **Descrizione** del nuovo metodo, il **Codice**, **Tipologia Sdi** (il codice del metodo per la fattura elettronica, con l'amministrazione), **Pagamento tracciato** acceso se tracciabile ai fini delle detrazioni; conferma. Regola TD dal manuale: non si accettano assegni.

### Cosa verificare dopo
- La voce nuova compare nei menu a tendina che la usano (per esempio il Metodo di pagamento in Nuova fattura).

### Attenzioni
- Pagamenti, sezionali, anagrafiche e tabelle SSN hanno effetti fiscali o di rendicontazione: si toccano con l'amministrazione.

=== sezione
ordine: 19
slug: utenti-nuovo-collega
titolo: Accesso di un nuovo collega (utenti, team, sedi)
percorso_gipo: /utenti
parole_chiave: nuovo utente, invita utente, dare accesso, nuovo collega, profilo medico, profilo segreteria, profilo amministratore, team, nuovo team, utente bloccato, invitato, attivo, permessi, utenze sedi
sintesi: Come dare l'accesso a GIPO a un nuovo collega: Invita utente con il profilo (Medico, Segreteria, Amministratore), team, sede collegata e, per i medici, collegamento alla scheda medico.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Far entrare in GIPO un nuovo collega con il profilo giusto e la sua sede.

### Come si fa
1. **Configurazione > Permessi > Utenti** (percorso /utenti), **Invita utente**.
2. Indica i dati richiesti dall'invito e il profilo: **Medico**, **Segreteria** o **Amministratore** (cosa può fare ogni profilo non è descritto nell'interfaccia: chiedi all'assistenza Gipo prima di dare Amministratore).
3. L'utente risulta **Invitato** finché non accetta, poi **Attivo**; per sospenderlo si usa **Bloccato**.
4. Se lavora in gruppi: **Configurazione > Permessi > Team**, **Nuovo team**.
5. **Configurazione > Sedi > Gestione utenze sedi**: collega l'utente alla sua **Sede collegata**.
6. Se è un medico: nella sua scheda medico imposta **Utente collegato** (vedi [Nuovo medico](sezione:medico-nuovo)).

### Cosa verificare dopo
- Al primo accesso il collega vede le agende della sua sede nella Lista di lavoro.

### Attenzioni
- Quando un collega lascia l'azienda, bloccalo subito (stato **Bloccato**).
- Procedura ricavata dall'interfaccia: da validare con l'assistenza Gipo.

=== sezione
ordine: 20
slug: backend-verifiche
titolo: Dopo una modifica: cosa controllare
parole_chiave: verificare, controllare, verifica configurazione, prova, agenda di prova, prestazione di prova, controllo dopo modifica, agenda classica controllo, trova spazio libero prova
sintesi: Le verifiche da fare dopo ogni modifica di configurazione (agende, sottoconfigurazioni, prezzi, pacchetti, consensi, compensi) e come usare un'agenda o una prestazione di prova.
fonte: INTERFACCIA
livello: BACK_END
===
### A cosa serve
Una configurazione sbagliata si scopre di solito quando il paziente è allo sportello. Queste verifiche servono a scoprirla prima.

### Le verifiche
| Hai modificato | Controlla |
|---|---|
| Orario base o sottoconfigurazione | **Agenda > Classica**, vista **Mese** e **Settimana**: slot solo nei giorni e nelle ore previsti; **Trova spazio libero** su tre mesi |
| Prestazioni prenotabili | **Wizard**: la prestazione trova slot sulle agende giuste e non sulle altre |
| Giorni festivi | sfondo rosso nei giorni inseriti; nessuna proposta in **Trova spazio libero** |
| Prezzi e listini | **Nuova assegnazione** di prova: il prezzo proposto è quello del listino e della data |
| Pacchetto | righe del pacchetto in **Nuova assegnazione**, Split pacchetto |
| Consenso collegato | **Modulistica** dell'assegnazione di prova propone il modulo |
| Compensi | **Compensi > Calcolo** su un periodo breve e **Riepilogo** del medico |
| Sede o sezionale | filtri Sede nella Lista di lavoro; numero proposto in Nuova fattura |

### Agenda e prestazione di prova
1. Crea un'agenda "PROVA" (Configurazione > Agende > Configurazioni > Aggiungi) senza **Mostra in servizi esterni** né **Agenda Cup**.
2. Prova lì sottoconfigurazioni, priorità, occupazioni parziali.
3. Per le prestazioni lavora su una prestazione con **Attiva** spenta finché non è pronta.
4. Al termine elimina o disattiva ciò che hai creato per prova e annota nella guida cosa hai scoperto (Redazione o "Mi è stata utile: no").

### Attenzioni
- Non provare su pazienti veri e non salvare fatture di prova: una fattura emessa non si cancella (si storna con nota di credito).
