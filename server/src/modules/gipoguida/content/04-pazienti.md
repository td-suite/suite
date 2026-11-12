---
capitolo: 4
titolo: Pazienti
intro: Nuova anagrafica, consensi, tessera sanitaria, archivio pazienti, documenti MultiDoc e storico delle firme.
---

=== sezione
ordine: 1
slug: nuovo-paziente
titolo: Nuovo paziente: la scheda anagrafica
percorso_gipo: /Pazienti/Create
parole_chiave: nuovo paziente, anagrafica, creare paziente, codice fiscale, dati paziente, inserire paziente, registrare paziente, azienda, minorenne, non autonomo, medico di base, documento, fonte marketing
sintesi: Crea l'anagrafica di un paziente nuovo, necessaria per prenotare, accettare, fatturare e refertare.
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
===
### A cosa serve
Crea l'anagrafica di un paziente nuovo, necessaria per prenotare, accettare, fatturare e refertare.

### Dove si trova
Menu **Pazienti > Nuovo paziente** (percorso /Pazienti/Create). Dall'archivio pazienti: **Aggiungi**.

### Cosa c'è nella schermata
Schede **Anagrafica** e **Note**. Pulsanti **Indietro**, **Salva**, **Informazioni** e la lettura della tessera sanitaria.

Campi della scheda Anagrafica:
- Consensi e condivisione: **Consenso Marketing**, **Consenso al trattamento dei dati**, **Consenti condivisione su MD** (MioDottore).
- Tipo di soggetto: **Azienda** (il paziente è un'azienda), **Soggetto minorenne o non autonomo**, **Tipo di cliente**.
- Identità: **Codice Cliente**, **Titolo**, **Cognome**, **Nome**, **Ragione sociale**, **Sesso** (M/F), **Codice fiscale**, **Codice Identificativo Regionale Assistito**, **Partita IVA**, **P.A.**, **Data** (di nascita).
- Residenza: **Indirizzo**, **Comune**, **CAP**, **Provincia**, **Nazione**, **Distretto sanitario residenza**, **Sede**.
- Contatti: **Telefono fisso**, **Telefono cellulare**, **Indirizzo email principale**, **Indirizzo PEC**, **Altri indirizzi email**.
- Professione: **Professione**, **Dettagli professione**.
- Fatturazione: **Listino predefinito**, **Metodo di pagamento**, **Condizione di pagamento**, "Non controllare Codice fiscale\Piva in fattura", **Esigibilità IVA**, **Codice destinatario Fatt-e**, **Assicurazione**.
- Medici: **Medico di base**, **Medico curante**.
- Stato: **Stato paziente**, **Invalidità**.
- Documento: **Tipo Documento**, **Numero Documento**, **Rilasciato da**, **Data rilascio**, **Data scadenza**.
- Marketing: **Fonte marketing**, **Dettagli fonte marketing**.

### Come si fa
1. Prima di creare il paziente cercalo nell'archivio (vedi [Archivio pazienti](sezione:archivio-pazienti)): i doppioni creano problemi in fatturazione e nei referti.
2. Apri **Pazienti > Nuovo paziente**.
3. Se hai la tessera sanitaria, usa la lettura della tessera per riempire i dati (vedi [Lettura della tessera sanitaria](sezione:paziente-tessera-sanitaria)); altrimenti compila **Cognome**, **Nome**, **Sesso**, **Data** di nascita, **Codice fiscale**.
4. Compila residenza e contatti (almeno un telefono o un'email, secondo le regole interne).
5. Registra i consensi (vedi [Consensi e privacy](sezione:paziente-consensi)).
6. Se il paziente è un'azienda spunta **Azienda** e compila **Ragione sociale** e **Partita IVA**; se è minorenne o non autonomo spunta **Soggetto minorenne o non autonomo**.
7. Premi **Salva**.

### Salvare
I pulsanti di salvataggio sono **Salva**, **Salva e chiudi** e **Salva e nuova assegnazione** (salva il paziente e apre subito la pratica: è la via più rapida allo sportello). C'è anche il pulsante **Lettura tessera sanitaria**.

### Regole TD dal manuale operativo
- Leggi la tessera sanitaria quando possibile; per un paziente già censito verifica e aggiorna i dati.
- Con inserimento manuale (per esempio paziente straniero) sono obbligatori nome, cognome, data e luogo di nascita, codice fiscale, residenza o domicilio, telefono ed e-mail (vedi [Fase 1: anagrafica e consensi](sezione:fase1-anagrafica-consensi)).

### Attenzioni
- I campi obbligatori non sono stati osservati: se il salvataggio non riesce, GIPO dovrebbe indicare il campo mancante (da verificare).
- "Non controllare Codice fiscale\Piva in fattura" disattiva un controllo: usalo solo con indicazione dell'amministrazione.
- **Codice destinatario Fatt-e** e **Indirizzo PEC** servono alla fattura elettronica, soprattutto per aziende e P.A.
- Come vengono gestiti i dati del tutore di un minorenne non è stato osservato: da verificare con il referente.

=== sezione
ordine: 2
slug: paziente-consensi
titolo: Consensi, privacy e modulistica del paziente
percorso_gipo: /Pazienti/Index
sintesi: Registrare i consensi del paziente e raccogliere i moduli da firmare.
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
parole_chiave: consenso, privacy, trattamento dati, marketing, condivisione miodottore, modulistica, firma, informativa, gdpr, giposign, firma grafometrica, rifirmare, consenso informato
===
### A cosa serve
Registrare i consensi del paziente e raccogliere i moduli da firmare.

### Cosa c'è
- Nella scheda paziente: **Consenso Marketing**, **Consenso al trattamento dei dati**, **Consenti condivisione su MD** (condivisione dei documenti su MioDottore).
- Nell'archivio pazienti le colonne **Consenso marketing**, **Consenso al trattamento dati** e **Consenso condivisione su MD** permettono di controllare la situazione di tutti.
- Nell'assegnazione e nella fattura: pulsante **Modulistica** e finestra **Privacy paziente** (nell'assegnazione).
- I moduli disponibili si configurano in **Configurazione > Modulistica** (tipi Altro, Consenso, Firme terapia, Anamnesi, Privacy; vedi [Modulistica](sezione:config-modulistica)).
- Le firme raccolte su tavoletta grafometrica sono nello **Storico firme** (vedi [Storico firme](sezione:storico-firme)).

### Come si fa
1. Alla prima visita del paziente spunta i consensi espressi nella scheda anagrafica e salva.
2. Dall'assegnazione apri **Modulistica** e scegli il modulo da far firmare (per esempio il consenso o l'informativa privacy).
3. Se in sede c'è la tavoletta di firma grafometrica, il paziente firma sulla tavoletta; la firma comparirà nello Storico firme (da verificare il passaggio esatto).

### Regole TD dal manuale operativo
1. Al primo accesso, e quando cambiano i moduli per motivi normativi o si aggiungono trattamenti, il paziente firma: informativa privacy (art. 13 GDPR), consenso al trattamento dei dati sanitari, consenso marketing, consenso alle modalità di trasmissione del referto, consenso informato per le prestazioni che lo richiedono (mezzo di contrasto, prelievo ematico, ecc.).
2. La firma si raccoglie su tablet con l'app GipoSign: il modulo si apre da GIPO e il paziente firma con lo stilo.
3. La firma resta archiviata nel profilo del paziente: agli accessi successivi non si rifirma, salvo modifiche ai moduli o nuovi trattamenti.
4. A ogni accesso verifica telefono ed e-mail.
Dettaglio in [Fase 1: anagrafica e consensi](sezione:fase1-anagrafica-consensi); per far proporre un consenso con una prestazione vedi [Moduli e consensi collegati a una prestazione](sezione:prestazione-moduli-consensi).

### Attenzioni
- **Consenti condivisione su MD** incide sulla condivisione dei referti su MioDottore (vedi [Condivisione su MioDottore](sezione:referto-miodottore)): non spuntarlo senza il consenso del paziente.
- I moduli obbligatori per ogni prestazione sono decisi dall'azienda, non da GIPO: chiedi al referente quali raccogliere.

=== sezione
ordine: 3
slug: paziente-tessera-sanitaria
titolo: Lettura della tessera sanitaria
percorso_gipo: /Pazienti/Create
parole_chiave: tessera sanitaria, lettore, strisciare, banda magnetica, codice fiscale, compilazione automatica
sintesi: Riempire i dati anagrafici leggendo la tessera sanitaria con il lettore, riducendo gli errori di battitura su nome e codice fiscale.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Riempire i dati anagrafici leggendo la tessera sanitaria con il lettore, riducendo gli errori di battitura su nome e codice fiscale.

### Dove si trova
La lettura è disponibile in **Nuovo paziente** (/Pazienti/Create), in **Nuova assegnazione** e nell'**Agenda classica**. Durante la lettura compare il messaggio "Strisciare la tessera sanitaria nel lettore...".

### Come si fa
1. Apri la schermata (per esempio **Pazienti > Nuovo paziente**).
2. Avvia la lettura della tessera.
3. Quando compare "Strisciare la tessera sanitaria nel lettore..." passa la tessera nel lettore.
4. Controlla i dati riempiti e completa gli altri campi.

### Attenzioni
- Quali campi vengono riempiti dalla tessera non è stato osservato: controlla sempre i dati prima di salvare.
- Se il messaggio resta senza risposta, controlla che il lettore sia collegato; se il problema continua apri un ticket a Gipo.

=== sezione
ordine: 4
slug: archivio-pazienti
titolo: Archivio pazienti (Gestione paziente)
percorso_gipo: /Pazienti/Index
parole_chiave: archivio pazienti, gestione paziente, cercare paziente, trovare paziente, modifica paziente, elimina paziente, multidoc, colonne, doppioni
sintesi: Cercare, aprire e correggere le anagrafiche dei pazienti.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Cercare, aprire e correggere le anagrafiche dei pazienti.

### Dove si trova
Menu **Pazienti > Gestione paziente** (percorso /Pazienti/Index).

### Cosa c'è nella schermata
Comandi **Excel**, **Aggiungi**, **Cerca**. Su ogni riga **Modifica** e **Altre azioni** con **MultiDoc** ed **Elimina**.

Colonne disponibili (da **Impostazioni colonna**): Id, Paziente, Codice cliente, Aziende, Titolo, Sesso, Indirizzo, CAP, Comune, Provincia, Codice fiscale, Codice sanitario assistito, Partita IVA, Data di nascita, Cellulare, Telefono fisso, Email, Medico curante, Medico di base, Stato, Non Autonomo, Invalidità, Consenso marketing, Consenso al trattamento dati, Nome fonte marketing, Dettaglio fonte marketing, Recapito, Tipo Cliente, Professione, Dettagli professione, Sede, Assicurazione, Data creazione, Consenso condivisione su MD.

### Come si fa
1. Scrivi cognome, nome o codice fiscale nel campo **Cerca**.
2. Per correggere un dato premi **Modifica** sulla riga, cambia il campo e salva.
3. Per vedere i documenti del paziente: **Altre azioni > MultiDoc** (vedi [MultiDoc](sezione:multidoc)).

### Attenzioni
- **Elimina** cancella l'anagrafica: non usarlo per "pulire" un doppione con prestazioni o fatture collegate. Cosa succede ai documenti collegati non è stato verificato: chiedi prima al referente.
- Se trovi due anagrafiche dello stesso paziente segnalalo al referente invece di correggerle da solo.

=== sezione
ordine: 5
slug: storico-firme
titolo: Storico firme (firma grafometrica)
percorso_gipo: /firma-grafometrica/storico-firme
parole_chiave: storico firme, firma grafometrica, tavoletta, moduli firmati, consensi firmati
sintesi: Elenca i moduli firmati dai pazienti sulla tavoletta di firma grafometrica.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Elenca i moduli firmati dai pazienti sulla tavoletta di firma grafometrica.

### Dove si trova
Menu **Pazienti > Storico firme** (percorso /firma-grafometrica/storico-firme).

### Cosa c'è nella schermata
Colonne: **Data e ora di firma**, **Paziente**, **Nome modulo**, **Tipo documento**.

### Come si fa
1. Apri **Pazienti > Storico firme**.
2. Cerca il paziente o il modulo per verificare che una firma sia stata raccolta.

### Attenzioni
- Le tavolette si associano in **Configurazione > Grafometrica** (vedi [Grafometrica](sezione:config-grafometrica)).
- Se si possa scaricare o ristampare il modulo firmato da questa pagina non è stato osservato.

=== sezione
ordine: 6
slug: paziente-multidoc
titolo: MultiDoc del paziente
percorso_gipo: /Pazienti/Index
parole_chiave: multidoc, documenti paziente, archivio documentale, allegati paziente, altre azioni
sintesi: Aprire l'archivio documentale MultiDoc filtrato sul singolo paziente.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Aprire l'archivio documentale MultiDoc filtrato sul singolo paziente.

### Dove si trova
**Pazienti > Gestione paziente**, sulla riga del paziente: **Altre azioni > MultiDoc**. L'archivio completo è in **Fatturazione > MultiDoc** (vedi [MultiDoc](sezione:multidoc)).

### Come si fa
1. Cerca il paziente in **Pazienti > Gestione paziente**.
2. Sulla sua riga apri **Altre azioni** e scegli **MultiDoc**.
3. Consulta i documenti del paziente.

### Attenzioni
- Come si caricano i documenti in MultiDoc e quali tipi di documento vi finiscono in automatico non è stato osservato: da verificare con il referente.
