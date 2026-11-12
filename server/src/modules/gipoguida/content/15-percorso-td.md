---
capitolo: 15
titolo: Percorso del paziente secondo il manuale TD
intro: Il percorso del paziente in GIPO dalla prenotazione al referto, fase per fase, come lo descrive il Manuale operativo TD-SGI-MAN007 (procedure approvate da Toscana Diagnostica), con le regole interne, i controlli obbligatori e la checklist. Dove il manuale e l'interfaccia di GIPO usano nomi diversi, una nota lo segnala.
---

=== sezione
ordine: 1
slug: percorso-perimetro
titolo: Perimetro, canali di accesso e sistemi collegati
parole_chiave: manuale operativo, td-sgi-man007, perimetro, canali di accesso, ssn, privato, assicurazione, studio lab, zeeromed, sistema tessera sanitaria, fse 2.0, referti online, sistemi integrati, laboratorio, diagnostica per immagini, visite specialistiche
sintesi: Cosa copre il manuale operativo TD (laboratorio, diagnostica per immagini, visite), i tre canali di accesso (SSN, privato, assicurazione) e i sistemi collegati a GIPO in TD (Studio Lab, ZeeroMed, STS, FSE 2.0, portale referti).
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Inquadra il percorso del paziente in GIPO come lo descrive il Manuale operativo GipoNext di Toscana Diagnostica (TD-SGI-MAN007, revisione 00 del 23/06/2026, in vigore): l'accettazione di un esame diagnostico o di laboratorio, dall'arrivo del paziente alla consegna del referto.

### Prestazioni coperte
- Esami di laboratorio analisi (ematochimici, microbiologici, ormonali, ecc.).
- Esami di diagnostica per immagini (ecografie, radiografie, TAC, RMN, mammografie, ecc.).
- Visite specialistiche ambulatoriali.

### I tre canali di accesso
- **SSN / Convenzione** con il Servizio Sanitario Nazionale (Regione Toscana).
- **Privato / Libera professione**.
- **Assicurazione / Fondi sanitari integrativi**.

### Le aree di GIPO secondo il manuale
| Area | Cosa fa |
|---|---|
| Agenda e prenotazioni | disponibilità di medici, ambulatori e macchinari; Agenda Classica per le prenotazioni standard, Wizard per la prenotazione multipla; con MioDottore o TuoTempo riceve le prenotazioni online |
| Accettazione e cartella clinica | lettore di tessera sanitaria, firma grafometrica su tablet, consensi GDPR digitali, storico del paziente |
| Refertazione | modelli, refertazione vocale, frasi preimpostate, firma digitale, invio al FSE 2.0 |
| Amministrazione e fatturazione | preventivi, fatture, pagamenti, conservazione sostitutiva, Sistema Tessera Sanitaria, rendicontazione ASL |

### I sistemi collegati a GIPO in Toscana Diagnostica
| Sistema | Funzione |
|---|---|
| GipoNext | gestionale principale: anagrafica, agenda, accettazione, fatturazione, refertazione, storico paziente |
| Studio Lab (C.B. Sistemi) | sistema del laboratorio (LIS): flusso analitico, worklist degli analizzatori, validazione, referti di laboratorio |
| ZeeroMed | RIS/PACS: acquisizione e archiviazione delle immagini DICOM, worklist verso le apparecchiature |
| Sistema Tessera Sanitaria (STS) | trasmissione delle spese sanitarie per il 730 precompilato |
| FSE 2.0 | Fascicolo Sanitario Elettronico: invio dei referti |
| www.referti.online | portale di ritiro dei referti online per il paziente |

### Attenzioni
- Fonte: Manuale operativo TD-SGI-MAN007. Le fasi sono descritte nelle sezioni successive di questo capitolo.

=== sezione
ordine: 2
slug: percorso-fasi
titolo: Le fasi del percorso, dalla prenotazione al referto
parole_chiave: percorso paziente, fasi, flusso, diagramma di flusso, prenotazione, arrivo, anagrafica, canale, impegnativa, assegnazione, fatturazione, laboratorio, immagini, refertazione, credenziali, post erogazione, accettazione completa
sintesi: Lo schema delle fasi del percorso del paziente secondo il manuale TD (fase 0 prenotazione, arrivo, fasi 1-9 fino a referto e reportistica) con il rimando alla sezione di ogni fase.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Il percorso in sintesi
| Fase | Cosa succede | Sezione |
|---|---|---|
| 0. Prenotazione | Agenda Classica (appuntamento singolo) o Agenda Wizard (specialista + sala + apparecchiatura); online via MioDottore/TuoTempo; via CUP regionale | [Fase 0](sezione:fase0-prenotazione) |
| Arrivo | il paziente arriva con impegnativa (ricetta dematerializzata NRE + codice fiscale, ricetta rossa o bianca); identificazione con documento | [Arrivo](sezione:fase-arrivo) |
| 1. Anagrafica e consensi | tessera sanitaria o codice fiscale a mano; firma grafometrica su GipoSign; minori e tutori | [Fase 1](sezione:fase1-anagrafica-consensi) |
| 2. Canale di accesso | SSN, privato o assicurazione: determina documenti, tariffe e contabilità | [SSN](sezione:fase2-canale-ssn), [Privato](sezione:fase2-canale-privato), [Assicurazione](sezione:fase2-canale-assicurazione) |
| 3. Impegnativa | validità, prestazioni, esenzione, medico prescrittore, priorità CUP | [Fase 3](sezione:fase3-impegnativa) |
| 4. Assegnazione in agenda | episodio clinico, sala, strumento, medico; Associa medico per il referto | [Fase 4](sezione:fase4-assegnazione) |
| 5. Fatturazione e incasso | SSN: ticket e STS; privato e assicurazione: fattura esente IVA con bollo virtuale | [Fase 5](sezione:fase5-fatturazione) |
| 6a. Laboratorio | ordine verso Studio Lab, etichette, validazione, ritorno del referto | [Fase 6a](sezione:fase6a-laboratorio) |
| 6b. Diagnostica per immagini | worklist verso ZeeroMed, acquisizione del TSRM, referto su GIPO | [Fase 6b](sezione:fase6b-immagini) |
| 7. Refertazione | referto su GIPO, firma digitale, FSE 2.0 | [Fase 7](sezione:fase7-refertazione) |
| 8. Credenziali e referto | modulo TD-SGI-MOD235, portale del paziente, Dossier Sanitario | [Fase 8](sezione:fase8-credenziali) |
| 9. Post-erogazione | notifiche, flussi istituzionali, reportistica | [Fase 9](sezione:fase9-post-erogazione) |

### Attenzioni
- Per i controlli rapidi allo sportello usa la [Checklist operativa](sezione:checklist-td).

=== sezione
ordine: 3
slug: fase0-prenotazione
titolo: Fase 0: prenotazione (agenda classica, wizard, online, CUP)
percorso_gipo: /Agende/Classic
parole_chiave: prenotazione, prenotare, agenda classica, agenda wizard, prenotazione multipla, miodottore, tuotempo, prenotazione online, cup regionale, centralino, sms di conferma, conferma automatica, annullamento automatico
sintesi: Come si prenota secondo il manuale TD: agenda classica per gli appuntamenti con una sola risorsa, wizard per esami con specialista, sala e apparecchiatura, prenotazioni online MioDottore/TuoTempo e CUP regionale.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Il percorso del paziente inizia dalla prenotazione, che avviene in tre modi: in struttura o al centralino con GIPO; online con MioDottore/TuoTempo integrati; dal CUP regionale con invio automatico dell'appuntamento in agenda.

### Agenda classica (una sola risorsa)
Per appuntamenti semplici con una sola risorsa (una visita con un medico, un prelievo in sala prelievi). L'operatore di accettazione o del centralino:
1. Seleziona il tipo di prestazione e il professionista o la risorsa dalla lista configurata in GIPO.
2. Guarda la disponibilità in calendario (giornaliera, settimanale, mensile) e sceglie lo slot libero.
3. Inserisce o cerca l'anagrafica del paziente (nuovo o già registrato).
4. Conferma l'appuntamento: GIPO invia in automatico un SMS di conferma al paziente.
5. Da ogni appuntamento si vedono le informazioni del paziente (fatture, documenti da firmare, ecc.) e si filtra per specializzazione, medico o orario.

Comandi in GIPO: [Agenda classica](sezione:agenda-classica), [Prenotare un appuntamento](sezione:agenda-prenotare).

### Agenda Wizard (più risorse insieme)
Per esami strumentali complessi (eco, TAC, RMN, mammografia, ecc.) che richiedono insieme lo specialista, la sala o l'ambulatorio e l'apparecchiatura:
1. Il sistema considera in automatico la disponibilità dello spazio, della macchina e dello specialista.
2. Trova il primo slot che soddisfa tutti e tre i vincoli, riducendo tempi ed errori di sovrapposizione.
3. GIPO invia WhatsApp o SMS ed e-mail di conferma dopo la prenotazione e un promemoria prima della visita.

Comandi in GIPO: [Wizard di prenotazione](sezione:agenda-wizard).

### Prenotazione online (MioDottore, TuoTempo)
Le prenotazioni fatte dal paziente sui portali compaiono da sole nell'agenda del professionista in GIPO, senza doppio inserimento, 24 ore su 24. La cancellazione di un appuntamento libera lo slot per altri pazienti.

### Da riconciliare con il manuale
- Il manuale descrive il Wizard come la ricerca in un clic del primo slot che soddisfa specialista, sala e apparecchiatura; nell'interfaccia osservata il Wizard (**Agenda > Wizard**) funziona a carrello: si aggiungono le prestazioni (**Aggiungi al carrello**), si sceglie il periodo **Dal** / **Al** e si preme **Cerca**, poi si sceglie lo slot nella griglia **Ora / Agende**. I nomi dei comandi sono quelli dell'interfaccia.
- L'invio automatico di SMS e WhatsApp dopo la conferma è descritto dal manuale; la sua configurazione non compare nelle schermate osservate.

=== sezione
ordine: 4
slug: fase-arrivo
titolo: Arrivo allo sportello: accesso, filtro sede, richiamo dell'appuntamento
percorso_gipo: /Home
parole_chiave: arrivo paziente, sportello, accesso a gipo, credenziali personali, lista di lavoro, filtro sede, richiamare appuntamento, identità, documento d'identità, accesso diretto, senza prenotazione, ricetta dematerializzata, ricetta rossa, ricetta bianca
sintesi: Cosa fa l'operatore quando arriva il paziente secondo il manuale TD: accesso con credenziali personali, Lista di lavoro filtrata per sede, richiamo dell'appuntamento, verifica dell'identità, accesso diretto senza prenotazione.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Accogliere il paziente: trovare il suo appuntamento e identificarlo. Il paziente si presenta con l'impegnativa (ricetta dematerializzata NRE + codice fiscale, ricetta rossa cartacea o ricetta bianca).

### Come si fa
1. **Accesso**: entra in GIPO con le **tue** credenziali personali (utente e password) e dal menu laterale apri la **Lista di lavoro**: mostra gli appuntamenti del giorno per sede e agenda.
2. **Filtro per sede**: nel menu a tendina **Sede** scegli la tua struttura, così vedi solo i suoi appuntamenti. Cambia sede se il paziente risulta prenotato in un'altra struttura della rete o per una nuova prenotazione in altra sede.
3. **Richiamo dell'appuntamento**: trova il paziente in lista, richiama l'appuntamento e **verifica l'identità con il documento d'identità**.
4. Se la prenotazione è arrivata online o dal CUP, l'episodio clinico è già in agenda.
5. Se il paziente **non ha prenotazione** ma è possibile l'accesso diretto, si procede subito con l'assegnazione (vedi [Nuova assegnazione](sezione:nuova-assegnazione)).

Poi: [Fase 1: anagrafica e consensi](sezione:fase1-anagrafica-consensi).

### Da riconciliare con il manuale
- Il manuale chiama la voce "Lista Lavoro"; nel menu di GIPO è **Lista di Lavoro** (vedi [La Lista di lavoro](sezione:lista-di-lavoro)).

=== sezione
ordine: 5
slug: fase1-anagrafica-consensi
titolo: Fase 1: anagrafica e consensi (tessera sanitaria, GipoSign)
percorso_gipo: /Pazienti/Index
parole_chiave: anagrafica, registrazione anagrafica, tessera sanitaria, gipo ts, lettore banda magnetica, paziente straniero, dati obbligatori, codice fiscale, recapito telefonico, email, consensi, gdpr, privacy, informativa, consenso marketing, consenso trasmissione referto, consenso informato, firma grafometrica, giposign, tablet, minore, tutore legale, rifirmare
sintesi: Regole TD per l'anagrafica (lettura della tessera con GIPO TS, dati obbligatori per l'inserimento a mano, verifica dei contatti) e per i consensi GDPR firmati su tablet con GipoSign.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
L'anagrafica corretta è il fondamento del fascicolo del paziente e condiziona tutto il resto: fatturazione, ordini a Studio Lab, worklist di ZeeroMed, invio dei referti, trasmissione al Sistema Tessera Sanitaria.

### Registrazione anagrafica
1. Il metodo più rapido è la **lettura della tessera sanitaria** con il lettore a banda magnetica (modulo GIPO TS): GIPO acquisisce nome, cognome, data di nascita, codice fiscale e codice regione.
2. Se il paziente è già censito, GIPO recupera il profilo: **verifica che tutti i dati siano corretti e aggiornali**.
3. Per un paziente straniero o con inserimento manuale compila obbligatoriamente:
   - nome, cognome, data e luogo di nascita;
   - codice fiscale (indispensabile per SSN e STS);
   - residenza o domicilio;
   - recapito telefonico (per SMS di promemoria e notifica del referto pronto);
   - indirizzo e-mail (per notifiche e credenziali di accesso ai referti online).
4. Per un minore o un soggetto non autonomo gestisci il tutore legale (in GIPO: campo **Soggetto minorenne o non autonomo**).

Comandi in GIPO: [Nuovo paziente](sezione:nuovo-paziente), [Lettura della tessera sanitaria](sezione:paziente-tessera-sanitaria).

### Privacy e consensi (GDPR) con firma grafometrica
Al primo accesso, e ogni volta che cambiano i moduli per motivi normativi o si aggiungono nuovi trattamenti, il paziente firma:
- l'informativa sul trattamento dei dati personali (art. 13 GDPR);
- il consenso al trattamento dei dati sanitari;
- il consenso marketing;
- il consenso alle modalità di trasmissione del referto;
- il consenso informato specifico per le prestazioni che lo richiedono (mezzo di contrasto, prelievo ematico, ecc.).

Come si firma:
1. L'operatore apre il modulo da GIPO e lo mostra sul tablet con l'app **GipoSign** (tablet Android).
2. Il paziente firma con lo stilo: la firma ha valore legale equivalente alla firma autografa (D.Lgs. 82/2005, CAD).
3. La firma resta archiviata nell'archivio online di GIPO, associata al paziente: **agli accessi successivi non si rifirma**, salvo modifiche normative ai moduli o nuovi trattamenti.
4. A ogni accesso verifica che telefono ed e-mail siano aggiornati.

Comandi in GIPO: [Consensi, privacy e modulistica](sezione:paziente-consensi), [Storico firme](sezione:storico-firme), [Moduli collegati a una prestazione](sezione:prestazione-moduli-consensi).

=== sezione
ordine: 6
slug: fase2-canale-ssn
titolo: Fase 2: canale SSN (impegnativa, esenzione, ticket, priorità)
percorso_gipo: /Assegnazioni/Create
parole_chiave: canale ssn, convenzione, servizio sanitario nazionale, nre, numero ricetta elettronica, ricetta dematerializzata, sac, sar, nomenclatore regionale, catalogo ssn, esenzione ticket, e00, quota ticket, priorità cup, ricevuta ticket, rendicontazione asl, accettazione ssn
sintesi: Come si accetta un paziente SSN secondo il manuale TD: NRE e codice fiscale, recupero della ricetta dal SAC/SAR, controllo delle prestazioni, esenzione, ticket, priorità CUP, ricevuta e rendicontazione ASL.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
L'identificazione del canale è la fase più critica dell'accettazione: determina il flusso documentale, tariffario e contabile dell'intero episodio.

### Come si fa (canale SSN)
1. Inserisci il codice **NRE** e il **codice fiscale** del paziente: GIPO interroga il sistema SAC/SAR e recupera la ricetta dematerializzata.
2. Verifica che tutte le prestazioni siano nel nomenclatore regionale e nel catalogo SSN convenzionato della struttura.
3. Applica il **codice di esenzione** ticket, se è sull'impegnativa (es. E00 reddito, codici di patologia cronica, invalidità).
4. Calcola la **quota ticket** a carico dell'assistito o conferma l'esenzione totale.
5. Seleziona la **priorità CUP**, per rispettare i tempi massimi di garanzia regionali.
6. Al termine: stampa la ricevuta del ticket; la pratica entra nella rendicontazione per l'ASL.

Prima dell'accettazione fai i controlli di [Fase 3: impegnativa](sezione:fase3-impegnativa).

Comandi in GIPO: scheda **SSN** dell'assegnazione con le colonne Num. Impegnativa, Codice esenzione, Ticket, Quota fissa, Priorità Accesso (vedi [Schede interne dell'assegnazione](sezione:assegnazione-schede-interne) e [Impegnativa e Budget SSN](sezione:assegnazione-ssn)); rendicontazione in [Riepilogo Asl](sezione:ssn-riepilogo-asl).

### Da riconciliare con il manuale
- Il manuale parla di "priorità CUP"; nella scheda SSN dell'assegnazione e nel Riepilogo Asl il campo si chiama **Priorità Accesso** (Riepilogo Asl: filtro Priorità accesso).

=== sezione
ordine: 7
slug: fase2-canale-privato
titolo: Fase 2: canale privato (listino, pagamento, fattura esente)
percorso_gipo: /Assegnazioni/Create
parole_chiave: canale privato, libera professione, listino privato, listino convenzionato, convenzione, pagamento, contanti, pos, bonifico, digitale, assegni, fattura esente iva, art. 10, bollo, 77,47, accettazione privata
sintesi: Come si accetta un paziente privato secondo il manuale TD: niente impegnativa obbligatoria, listino privato o convenzionato, pagamento (contanti, POS, bonifico, digitale; no assegni), fattura esente IVA art. 10 con bollo da 2 euro sopra 77,47 euro.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Come si fa (canale privato)
1. Nessuna impegnativa obbligatoria (salvo indicazione specifica della struttura o del professionista).
2. Seleziona le prestazioni dal **listino privato** configurato in GIPO o dal listino previsto dalla convenzione.
3. Seleziona la modalità di pagamento: **contanti, POS, bonifico, digitale**. **Non si accettano assegni.**
4. Emetti la fattura con la dicitura: esente IVA ai sensi dell'art. 10 n. 18 del DPR 26/10/1972 n. 633 (prestazioni sanitarie).
5. Per importi superiori a **77,47 euro** applica l'imposta di bollo da **2,00 euro** assolta in modo virtuale (art. 15 D.P.R. 642/1972 e D.M. 17/06/2014).

Dettaglio della fattura: [Fase 5: fatturazione e incasso](sezione:fase5-fatturazione). Comandi in GIPO: [Fatturare dalla Lista di lavoro](sezione:fatturare-da-lista), [Nuova fattura](sezione:nuova-fattura).

### Attenzioni
- Le fatture emesse in GIPO **non sono modificabili**: in caso di errore si fa nota di credito e nuova fattura. Verifica canale, prestazioni e dati fiscali prima di fatturare.

=== sezione
ordine: 8
slug: fase2-canale-assicurazione
titolo: Fase 2: canale assicurazione e fondi sanitari
percorso_gipo: /Assegnazioni/Create
parole_chiave: assicurazione, fondo sanitario integrativo, forma diretta, forma indiretta, autorizzazione ente, numero autorizzazione, massimale, franchigia, codice convenzione, piano assicurativo, copertura parziale, fattura intestata all'ente, accettazione assicurazione
sintesi: Come si accetta un paziente con assicurazione o fondo secondo il manuale TD: forma diretta (autorizzazione, massimale, franchigia, fattura all'ente) o indiretta (fattura al paziente), codice convenzione, copertura.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Come si fa (canale assicurazione)
1. Verifica se l'accesso è in **forma diretta** o **indiretta**:
   - forma diretta: verifica l'autorizzazione dell'ente (numero di autorizzazione, data di validità, massimale di copertura, eventuale franchigia);
   - forma indiretta: procedi con l'accettazione.
2. Inserisci in GIPO il codice convenzione specifico dell'assicurazione o del fondo.
3. Verifica che la prestazione sia inclusa nel piano assicurativo del paziente.
4. Se la copertura è parziale, informa il paziente della quota a suo carico **prima** di procedere.
5. Forma diretta: fattura intestata all'ente assicurativo per l'intero importo o parziale (se c'è una franchigia), esente IVA art. 10 n. 18 DPR 633/72, con bollo virtuale sopra 77,47 euro.
6. Forma indiretta: fattura intestata al paziente per l'intero importo, esente IVA art. 10 n. 18 DPR 633/72, con bollo virtuale sopra 77,47 euro.

Comandi in GIPO: scheda **Assicurazione** dell'assegnazione (Assicurazione, Numero pratica), colonne Quota assicurazione, Importo ass., Importo paziente; campo **Fatturare a** della testata (vedi [Schede interne dell'assegnazione](sezione:assegnazione-schede-interne) e [Assicurazioni e convenzioni](sezione:assicurazione-convenzione)).

### Da riconciliare con il manuale
- Il manuale dice "inserire il codice convenzione"; nell'interfaccia la convenzione si esprime con il **listino** collegato all'assicurazione e con la scheda **Assicurazione** (campo **Numero pratica**): dove si scrive il numero di autorizzazione dell'ente va confermato con il referente.

### Attenzioni
- Le fatture non sono modificabili dopo l'emissione: in caso di errore nota di credito e nuova fattura.

=== sezione
ordine: 9
slug: fase3-impegnativa
titolo: Fase 3: controlli obbligatori sull'impegnativa
percorso_gipo: /Assegnazioni/Create
parole_chiave: controlli impegnativa, verifica impegnativa, ricetta, validità ricetta, regione di prescrizione, prestazioni prescritte, codice esenzione, medico prescrittore, codice fiscale, priorità cup, urgente, breve, differibile, programmabile, u b d p, prestazioni non erogabili
sintesi: I controlli obbligatori sull'impegnativa secondo il manuale TD: validità e regione, prestazioni erogabili, esenzione, medico prescrittore, codice fiscale, priorità CUP (U 72 ore, B 10 giorni, D 30 giorni, P 120 giorni).
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Quasi tutte le impegnative sono dematerializzate: il paziente mostra il promemoria con il Numero Ricetta Elettronica (NRE) e il codice fiscale. La ricetta rossa cartacea è ancora accettata ma è l'eccezione.

### I controlli
| Elemento | Cosa verificare |
|---|---|
| Validità temporale | in Regione Toscana la ricetta ha una validità normata dalla data di emissione: verifica sempre data e regione di prescrizione |
| Prestazioni prescritte | devono corrispondere a quanto la struttura eroga ed essere nel catalogo di GIPO |
| Codice di esenzione | se c'è, deve essere sull'impegnativa e corrispondere al profilo del paziente (reddito, patologia, invalidità) |
| Medico prescrittore | firma e timbro leggibili e completi: indispensabili per la rendicontazione SSN |
| Codice fiscale del paziente | deve corrispondere al documento d'identità e alla tessera sanitaria |
| Priorità CUP | U = Urgente (72 ore), B = Breve (10 giorni), D = Differibile (30 giorni), P = Programmabile (120 giorni) |

### Attenzioni
- Le impegnative con prestazioni **non erogabili** dalla struttura **non si accettano**: informa il paziente e indirizzalo alla struttura competente.
- In GIPO la configurazione SSN prevede anche **Alert inserimento stesso esame impegnativa** e **Abilita controllo codice esenzione** (vedi [SSN: impostazioni generali](sezione:config-ssn)).

=== sezione
ordine: 10
slug: fase4-assegnazione
titolo: Fase 4: assegnazione in agenda e Associa medico
percorso_gipo: /Assegnazioni/Create
parole_chiave: assegnazione, episodio clinico, risorsa, sala prelievi, apparecchiatura, ambulatorio, priorità, associa medico, medico refertante, radiologo, smartq, monitor sala d'attesa, cruscotto operativo, coda
sintesi: Cosa fa l'operatore nell'assegnazione secondo il manuale TD: scelta della risorsa, data nel rispetto della priorità, Associa medico per il medico refertante (obbligatorio per la diagnostica per immagini), SmartQ e cruscotto.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
All'accettazione si crea o si conferma l'episodio clinico a cui si collegano tutte le attività successive. GIPO gestisce le agende di sale, apparecchiature e professionisti.

### Come si fa
1. Seleziona la risorsa appropriata: **sala prelievi** per il laboratorio, **apparecchiatura** per la diagnostica per immagini, **ambulatorio** per le visite specialistiche.
2. Assegna data e orario rispettando la priorità CUP dell'impegnativa.
3. **Associa medico**: in fase di assegnazione associa il **medico refertante** all'episodio. Per la diagnostica per immagini è fondamentale: il radiologo vedrà le immagini acquisite da ZeeroMed e referterà direttamente su GIPO.
4. Il modulo GIPO SmartQ gestisce il monitor della sala d'attesa (coda, numero chiamato, ambulatorio) in tempo reale.

Comandi in GIPO: [Nuova assegnazione](sezione:nuova-assegnazione), pulsante **Associa medico** ([Cambio listino, Associa medico, Applica nota](sezione:assegnazione-listino-medico-nota)), **Prenota** e **Prenota Wizard** ([Prenotare dall'assegnazione](sezione:assegnazione-prenota-referta)).

### Da riconciliare con il manuale
- Il manuale cita SmartQ e un cruscotto operativo (pazienti in sala d'attesa, distribuzione per canale, ritardo medio, durata media delle visite, avanzamento degli esami del giorno): nel menu di GIPO osservato sull'account TD non compaiono voci con questi nomi. Chiedi al referente dove si aprono.

=== sezione
ordine: 11
slug: fase5-fatturazione
titolo: Fase 5: fatturazione e incasso (esenzione IVA, bollo, Natura bollo)
percorso_gipo: /Fatture/Create
parole_chiave: fatturazione, incasso, fattura ticket, ssn, sistema tessera sanitaria, sts, 730, fattura privato, fattura assicurazione, esenzione iva, art. 10 n. 18, dpr 633, imposta di bollo, bollo virtuale, 77,47, 2 euro, natura bollo, n4, prestazioni esenti iva, fattura non modificabile, nota di credito, conservazione sostitutiva
sintesi: Regole TD di fatturazione: SSN con fattura del ticket e trasmissione STS; privato e assicurazione con fattura esente IVA art. 10 n. 18 e bollo virtuale da 2 euro sopra 77,47 euro; nel campo Natura bollo scegliere sempre N4; fatture non modificabili.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
La fatturazione avviene insieme all'accettazione; GIPO gestisce i flussi documentali e fiscali di ogni canale.

### Canale SSN
1. Emetti la fattura per il pagamento del **ticket** con l'importo a carico dell'assistito (o importo zero con esenzione completa).
2. GIPO trasmette i dati al Sistema Tessera Sanitaria (STS) per il 730 precompilato.
3. La rendicontazione resta archiviata per la trasmissione periodica alla ASL (modulo GIPO SSN).

### Canale privato e assicurazione
Le fatture per prestazioni sanitarie riportano obbligatoriamente:
- l'esenzione IVA: "Operazione esente ai sensi dell'art. 10 n. 18 del DPR 26/10/1972 n. 633" (prestazioni di diagnosi, cura e riabilitazione rese alla persona);
- per importi superiori a 77,47 euro, l'imposta di bollo: "Imposta di bollo assolta in modo virtuale ai sensi dell'articolo 15 del D.P.R. 642/1972 e del D.M. 17/06/2014".

GIPO produce le fatture in PDF con conservazione digitale (firma digitale e marca temporale); la trasmissione al Sistema Tessera Sanitaria vale anche per le fatture private.

### Il campo Natura bollo
**Importante**: durante l'emissione della fattura, nel campo **Natura bollo** seleziona **sempre** la voce **N4** (prestazioni esenti IVA): GIPO **non** la preseleziona in automatico.

### Prima di confermare
1. Verifica i dati fiscali (codice fiscale o partita IVA, indirizzo) e il canale.
2. Verifica la tipologia di esenzione e il bollo.
3. Le fatture **non sono modificabili dopo l'emissione**: in caso di errore si fa una [nota di credito](sezione:nota-di-credito) e una nuova fattura.

Comandi in GIPO: [Nuova fattura](sezione:nuova-fattura), [Righe, sconti, bollo](sezione:fattura-righe-bollo).

### Da riconciliare con il manuale
- Il manuale scrive la voce come "N4-Pretsazioni esenti IVA" (refuso); il testo esatto della voce nel menu **Natura bollo** non è stato annotato: scegli la voce che inizia con N4.
- Il manuale dà per attiva la trasmissione automatica al Sistema Tessera Sanitaria; sull'account TD la voce **Invio spese Gipo730** risulta "Account non configurato per l'invio delle spese verso Gipo730" (vedi [Invio spese Gipo730](sezione:gipo730)): da chiarire con l'amministrazione come avviene oggi l'invio.

=== sezione
ordine: 12
slug: fase6a-laboratorio
titolo: Fase 6a: esami di laboratorio con Studio Lab
parole_chiave: laboratorio, studio lab, lis, hl7, ordine analitico, provette, etichette barcode, colore tappo, viola, giallo, azzurro, bianco, verde, check-in campioni, sala prelievi, validazione tecnica, validazione clinica, referto di laboratorio, anomalie interfaccia, hiv, referto parziale
sintesi: Il flusso degli esami di laboratorio secondo il manuale TD: ordine automatico da GIPO a Studio Lab (HL7), etichette e colori dei tappi, check-in dei campioni, validazione a due livelli, ritorno del referto in GIPO, anomalie HL7, esami HIV.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Per gli esami di laboratorio GIPO dialoga in entrambe le direzioni con Studio Lab (LIS di C.B. Sistemi) con il protocollo HL7/CDA2.

### Il flusso
1. **Ordine analitico**: a fine accettazione GIPO genera da solo l'ordine verso Studio Lab con dati del paziente, esami con i codici analitici, canale di accesso, eventuale urgenza, notizie cliniche (digiuno, terapia, allergie).
2. **Sala prelievi**: Studio Lab genera il codice univoco e stampa le etichette barcode delle provette con il colore del tappo per tipo: **viola** (emocromo), **giallo** (chimica clinica e immunometria), **azzurro** (coagulazione), **bianco** (sierologia), **verde** (plasma Li-Eparina).
3. **Check-in campioni**: registra l'arrivo delle provette e segnala urgenze, anomalie ed eventuale mancanza di consensi all'esecuzione dell'analisi.
4. **Validazione** a due livelli: tecnica (tecnico di laboratorio: qualità analitica, controlli di qualità, delta check, valori critici) e clinica con firma digitale del Direttore Tecnico o del biologo. Solo dopo la firma il referto si può consegnare.
5. **Ritorno a GIPO**: risultati e referto firmato tornano da soli in GIPO (HL7) nello storico; il referto è disponibile online e per la stampa allo sportello.

### Attenzioni
- **Punto critico**: l'identificazione con il barcode è il momento più delicato; un errore di etichettatura non si scopre dopo e attribuisce risultati sbagliati al paziente.
- **Anomalie HL7**: se la connessione non è disponibile, completa l'accettazione a mano in Studio Lab e riconcilia i dati quando torna. Verifica sempre la corrispondenza dei codici esame tra GIPO e Studio Lab (in GIPO: **Codice LIS** della prestazione).
- **Esami a normativa speciale** (HIV e altri, D.M. 22 luglio 1996): Studio Lab separa il referto e limita l'accesso; verifica la configurazione nel profilo del paziente in GIPO prima di procedere.
- **Referto parziale**: per esami con tempi diversi (per esempio colture 48-72 ore) Studio Lab produce referti parziali e tiene aperto il referto fino al completamento.

=== sezione
ordine: 13
slug: fase6b-immagini
titolo: Fase 6b: diagnostica per immagini con ZeeroMed
parole_chiave: diagnostica per immagini, zeeromed, ris, pacs, dicom, worklist, ae title, tsrm, tecnico di radiologia, mpps, mezzo di contrasto, creatinina, allergie, immagini da cd, dicom import, radiologo, referto su gipo, associa medico, wado
sintesi: Il flusso della diagnostica per immagini secondo il manuale TD: worklist DICOM da GIPO a ZeeroMed, AE Title, acquisizione del TSRM, stato MPPS, immagini da CD, refertazione del medico su GIPO tramite Associa medico.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Per radiografie, ecografie, TAC, RMN, mammografie e densitometrie GIPO si collega a ZeeroMed con DICOM e HL7. ZeeroMed gestisce **solo l'acquisizione** delle immagini da parte del TSRM; la **refertazione** avviene su GIPO.

### Il flusso
1. **Worklist**: a fine accettazione GIPO invia al server DICOM Worklist di ZeeroMed i dati del paziente, Accession Number, Procedure ID, modalità (RX, US, CT, MR, MG, DX...), AE Title della sala e note cliniche (allergie al mezzo di contrasto, creatinina, gravidanza, claustrofobia).
2. **Acquisizione**: l'apparecchiatura scarica la lista esami; il TSRM trova il paziente già in lista e acquisisce senza reinserire i dati.
3. A esame finito: **DICOM Store** manda le immagini al PACS di ZeeroMed; **DICOM MPPS** aggiorna lo stato dell'esame (eseguito, in attesa di referto), visibile anche in GIPO.
4. **Mezzo di contrasto**: il TSRM verifica dalla worklist allergie, creatinina e peso prima dell'iniezione.
5. **Immagini pregresse su CD**: ZeeroMed le importa (DICOM Import) e le associa al fascicolo del paziente per il confronto.
6. **Referto su GIPO**: il medico associato con **Associa medico** in fase di assegnazione (fase 4) entra in GIPO, vede le immagini di ZeeroMed e scrive il referto con modelli, frasi preimpostate e refertazione vocale; lo firma digitalmente su GIPO. Le immagini restano nel PACS e il paziente le vede dal portale in formato DICOM o WADO.

### Attenzioni
- **Configurazione critica**: l'AE Title in GIPO deve coincidere esattamente con quello di ZeeroMed e delle apparecchiature; se non coincide la sala non riceve la worklist e si inserisce tutto a mano, con rischio di errori.
- **Conservazione**: le immagini hanno valore legale con firma digitale e marca temporale; senza conservazione sostitutiva si tiene copia fisica per il periodo di legge.
- La refertazione su GIPO dà un solo archivio per tutti i referti e semplifica l'invio al FSE 2.0.

=== sezione
ordine: 14
slug: fase7-refertazione
titolo: Fase 7: refertazione e firma digitale su GIPO
percorso_gipo: /referti
parole_chiave: refertazione, firma digitale, referto, modelli, frasi preimpostate, refertazione vocale, fse 2.0, referti non firmati, direttore sanitario, repository unico, referto parziale
sintesi: Regole TD per la refertazione: tutti i referti confluiscono e si firmano in GIPO, firma digitale, invio automatico al FSE 2.0 dopo la firma, referti non firmati non accessibili fuori dall'ambiente di refertazione.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Le regole
1. Tutti i referti (laboratorio, immagini, visite) confluiscono e si firmano digitalmente in GIPO, che è l'archivio unico dei documenti clinici della struttura.
2. Il professionista redige il referto con frasi preimpostate, modelli per tipo di esame e refertazione vocale.
3. La firma digitale garantisce autenticità, integrità e non ripudio.
4. Dopo la firma il referto va automaticamente al FSE 2.0 (GIPO è certificato dal Ministero della Salute per i referti compatibili).
5. I referti **non firmati** non sono accessibili fuori dall'ambiente di refertazione; il Direttore Sanitario li vede solo con autorizzazioni di profilo specifiche.
6. Nessun referto si consegna prima della firma digitale del professionista.

Comandi in GIPO: [Da dove si avvia un referto](sezione:referto-avvio), [Gestione referti](sezione:gestione-referti), [Stati del referto](sezione:referto-stati), [FSE](sezione:referto-fse).

=== sezione
ordine: 15
slug: fase8-credenziali
titolo: Fase 8: credenziali e ritiro del referto (modulo TD-SGI-MOD235)
percorso_gipo: /Pazienti/Index
parole_chiave: credenziali, foglio credenziali, td-sgi-mod235, assegnazione credenziali portale paziente, modulistica, stampare modulo credenziali, id paziente, dossier sanitario, tuotempo, portale referti, ritiro referto, otp, email telefono aggiornati
sintesi: Come stampare e consegnare il modulo TD-SGI-MOD235 "Assegnazione Credenziali Portale Paziente" da Modulistica (anagrafica o assegnazione), dove trovare l'ID Paziente e cosa verificare prima della stampa.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Alla fine dell'accettazione o dell'assegnazione l'operatore stampa e consegna al paziente il modulo **TD-SGI-MOD235 "Assegnazione Credenziali Portale Paziente"**, con le istruzioni per accedere al Dossier Sanitario (TuoTempo) e scaricare referti, immagini e documenti fiscali.

### L'ID Paziente
È il codice numerico univoco che GIPO genera alla creazione dell'anagrafica: non si modifica e non si riusa. Il paziente lo inserisce sul portale per accedere ai referti. Si trova:
- nella scheda del paziente, in alto accanto al nome;
- nell'indirizzo web della scheda paziente (il numero nell'URL);
- in **Pazienti > Gestione paziente**, colonna **Id** dell'archivio.

### Come si stampa il modulo
Il modulo è già caricato in GIPO nella **Modulistica** con il nome "TD-SGI-MOD235_00 - Assegnazione Credenziali Portale Paziente" e riporta da solo l'ID del paziente. Due percorsi equivalenti:
1. **Dall'anagrafica**: apri la scheda del paziente, premi **Modulistica** in alto, trova il modello "Assegnazione Credenziali Portale Paziente", premi l'icona della stampante: GIPO genera il PDF con l'ID già compilato.
2. **Dall'assegnazione**: nella schermata dell'assegnazione premi **Modulistica** in alto, stesso modello, icona della stampante.

### Prima di stampare
- Verifica che l'anagrafica abbia **e-mail e telefono aggiornati**: devono coincidere con quelli che il paziente inserirà sul portale, altrimenti la validazione con codice OTP non riesce.
- Verifica che l'ID sia riportato correttamente sul modulo.

### Ritiro in sede
Chi non riesce ad accedere al portale ritira il referto allo sportello con un documento d'identità; con un delegato servono delega scritta e copia del documento del delegante.

Come accede il paziente: [Il portale del paziente](sezione:fase8-portale-paziente).

### Da riconciliare con il manuale
- Nella schermata **Nuovo paziente** osservata i pulsanti sono Indietro, Salva, Informazioni: il pulsante **Modulistica** sull'anagrafica (percorso 1) va confermato sulla scheda di un paziente già salvato. Nell'assegnazione il pulsante **Modulistica** è osservato.
- Il manuale cita sia il portale www.referti.online sia il Dossier Sanitario TuoTempo all'indirizzo indicato sul modulo: usa quello stampato sul modulo TD-SGI-MOD235.

=== sezione
ordine: 16
slug: fase8-portale-paziente
titolo: Il portale del paziente: primo accesso, servizi, dossier
parole_chiave: portale paziente, dossier sanitario, primo accesso, registrazione portale, otp, accedi, ritiro referti, id utente, abilita sincronizzazione, servizi portale, immagini, documenti fiscali, storico, disattiva dossier, azzera storico, elimina account, credenziali smarrite, sicurezza
sintesi: Come il paziente usa il portale secondo il manuale TD: registrazione con OTP, ritiro referti con l'ID Paziente, attivazione del Dossier Sanitario, servizi disponibili, referti senza scadenza, disattivazione e cancellazione del dossier.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Primo accesso del paziente
Il portale è all'indirizzo indicato sul modulo credenziali.
1. **Registrazione**: "Non sei registrato? Clicca qui" e inserisce nome, cognome, e-mail, telefono, uguali a quelli comunicati in accettazione.
2. **Validazione OTP**: riceve un codice via SMS o e-mail e lo inserisce.
3. **Accessi successivi**: **ACCEDI** con le credenziali create.
4. **Ritiro referto**: **RITIRO REFERTI** e inserisce l'ID Utente (= ID Paziente GIPO) del modulo.
5. **Attivazione del Dossier**: al primo accesso "Abilita sincronizzazione dei documenti", accetta la Privacy Policy e inserisce l'ID Paziente sotto il codice fiscale.

### Servizi
| Servizio | Contenuto |
|---|---|
| Referti | referti diagnostici e di laboratorio firmati digitalmente |
| Immagini | immagini (RX, TAC, RMN, ECO) in DICOM/WADO |
| Documenti fiscali | fatture e ricevute per le detrazioni (730) |
| Storico | prestazioni e prenotazioni in Toscana Diagnostica |

### Disponibilità dei referti
- Il referto è sul portale dalla firma digitale del medico su GIPO.
- Resta consultabile **senza limiti di tempo**: nessuna scadenza, nessun obbligo di ritiro (policy TD rispetto all'art. 3 della L. 412/1991).
- Resta attivo finché il paziente non disattiva, azzera o elimina il dossier.
- Il paziente riceve una notifica (WhatsApp, SMS o e-mail) quando il referto è disponibile.

### Gestione del dossier da parte del paziente
- **Disattiva dossier**: per riattivarlo deve venire in sede.
- **Azzera storico**: rimuove per sempre appuntamenti passati, disdette e documenti del dossier.
- **Elimina account**: cancella per sempre anagrafica, appuntamenti e documenti, anche dei familiari collegati.

### Attenzioni
- Sono azioni del paziente sul portale: l'operatore non può farle da GIPO. Sono irreversibili: informa il paziente delle conseguenze.
- **Sicurezza**: le credenziali sono personali; Toscana Diagnostica non chiede mai la password per e-mail, telefono o messaggi. In caso di smarrimento o uso improprio il paziente contatta il Supporto Clienti per disabilitarle e averne di nuove (dati trattati ai sensi del GDPR).

=== sezione
ordine: 17
slug: fase9-post-erogazione
titolo: Fase 9: post-erogazione, flussi istituzionali e reportistica
parole_chiave: post erogazione, notifiche, promemoria, referto disponibile, sistema tessera sanitaria, invio mensile, fse 2.0, rendicontazione asl, flussi, reportistica, accessi per sede, ritardo medio, tempi di attesa, ricavi per canale, anomalie hl7, errori dicom
sintesi: Cosa succede dopo la chiusura dell'episodio secondo il manuale TD: comunicazioni automatiche al paziente, flussi verso Sistema Tessera Sanitaria, FSE 2.0 e ASL, reportistica operativa.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### Comunicazioni automatiche al paziente
- WhatsApp o SMS ed e-mail di referto disponibile.
- Promemoria di cortesia se il referto non è ancora stato consultato (frequenza configurabile).
- Conferma degli appuntamenti futuri.

### Flussi istituzionali
- **Sistema Tessera Sanitaria**: trasmissione mensile delle spese sanitarie per il 730 precompilato (GIPO SSN), incluse le note di credito.
- **FSE 2.0**: i referti firmati vanno al repository regionale e sono accessibili a paziente e medico curante.
- **Rendicontazione ASL**: flussi periodici secondo il tracciato regionale toscano (in GIPO: [Tracciati ASL](sezione:ssn-tracciati-asl)).

### Reportistica operativa
- Accessi per sede, canale e tipo di prestazione; ritardo medio e tempo di permanenza.
- Tasso di consultazione online dei referti per sede; tempi di attesa per priorità CUP.
- Ricavi per canale, sede e tipo di prestazione.
- Anomalie di interfaccia: errori HL7 verso Studio Lab, errori DICOM verso ZeeroMed.

### Da riconciliare con il manuale
- I report elencati non corrispondono a voci di menu osservate in GIPO: chiedi al referente dove si generano. La regolarità dell'invio mensile al Sistema Tessera Sanitaria va verificata anche alla luce dello stato "Account non configurato" di **Invio spese Gipo730**.

=== sezione
ordine: 18
slug: checklist-td
titolo: Checklist operativa: punti critici
parole_chiave: checklist, punti critici, controlli, verifiche qualità, accettazione, controllo sportello, lista di controllo
sintesi: La checklist del manuale TD per l'accettazione e le verifiche di qualità: prenotazione, impegnativa, esenzione, prescrittore, priorità, anagrafica, contatti, firma, canale, autorizzazione, Associa medico, fattura, provette, AE Title, contrasto, firma del referto, credenziali, STS.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### La checklist
| Controllo | Azione richiesta |
|---|---|
| Prenotazione su GIPO | l'episodio è in agenda (Classica o Wizard) prima dell'arrivo del paziente |
| Validità impegnativa | data di emissione e regione di prescrizione |
| Codice esenzione | presente sull'impegnativa e coerente con il profilo del paziente |
| Medico prescrittore | firma e timbro leggibili e completi, indispensabili per la rendicontazione SSN |
| Priorità CUP | rispettare U/B/D/P nei tempi di garanzia regionali |
| Anagrafica paziente | codice fiscale corretto e corrispondente al documento d'identità |
| Dati di contatto | telefono ed e-mail aggiornati (promemoria e credenziali referto) |
| Firma grafometrica GipoSign | firma su tablet al primo accesso o quando cambiano i moduli |
| Canale di accesso | SSN, privato o assicurazione scelto bene prima della fatturazione |
| Autorizzazione assicurativa | numero di autorizzazione, massimale, data di validità |
| Associa medico | medico refertante associato all'episodio (obbligatorio per la diagnostica per immagini) |
| Fattura: dati ed esenzione | canale, dati fiscali, esenzione IVA art. 10 DPR 633/72, bollo virtuale se dovuto, Natura bollo N4 |
| Etichette provette (laboratorio) | colore del tappo giusto, barcode leggibile, check-in campioni fatto |
| Notizie cliniche | digiuno, farmaci, allergie inseriti in GIPO e trasmessi a Studio Lab o ZeeroMed |
| AE Title DICOM (immagini) | coincidenza tra GIPO, ZeeroMed e apparecchiatura |
| Mezzo di contrasto | allergie e creatinina verificate dalla worklist prima dell'iniezione |
| Firma digitale del referto | nessun referto consegnato prima della firma del professionista su GIPO |
| Foglio credenziali | consegnato sempre, spiegando che il Dossier Sanitario non scade |
| Attivazione Dossier Sanitario | modulo TD-SGI-MOD235 consegnato e attivazione verificata |
| Trasmissione STS | regolarità dell'invio mensile al Sistema Tessera Sanitaria |

=== sezione
ordine: 19
slug: riferimenti-normativi
titolo: Riferimenti normativi del percorso
parole_chiave: normativa, riferimenti normativi, gdpr, codice privacy, cad, l. 412/1991, d.m. 22 luglio 1996, d.lgs. 50/2011, dpr 633 art 10, dpr 642 art 15, bollo, fse, dpcm 2015, hl7, dicom, iso 15189
sintesi: Le norme e gli standard richiamati dal manuale TD (GDPR, Codice Privacy, CAD, ritiro referti, esami HIV, ricetta dematerializzata, esenzione IVA, bollo virtuale, FSE, HL7, DICOM, ISO 15189).
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
| Norma o fonte | Ambito |
|---|---|
| GDPR, Reg. UE 2016/679 | trattamento dei dati personali e sanitari, consensi, diritti dell'interessato |
| D.Lgs. 196/2003 (Codice Privacy) e s.m.i. | privacy in ambito sanitario, misure di sicurezza |
| D.Lgs. 82/2005 (CAD) | firma digitale, firma grafometrica, conservazione sostitutiva |
| L. 412/1991, art. 3 | obbligo di ritiro entro 30 giorni: TD applica l'accesso illimitato tramite il Dossier Sanitario |
| D.M. 22 luglio 1996 | normativa speciale per esami HIV e test infettivologici sensibili |
| D.Lgs. 50/2011 e s.m.i. | ricetta medica dematerializzata, Sistema TS |
| DPR 26/10/1972 n. 633, art. 10 n. 18 | esenzione IVA delle prestazioni sanitarie di diagnosi, cura e riabilitazione |
| D.P.R. 642/1972, art. 15 e D.M. 17/06/2014 | bollo virtuale sulle fatture sanitarie esenti sopra 77,47 euro |
| D.P.C.M. 29 settembre 2015 | regole tecniche del Fascicolo Sanitario Elettronico |
| FSE 2.0, DPCM e decreti attuativi | piattaforma nazionale FSE, trasmissione referti, accreditamento software |
| L.R. Toscana e delibere GRT | nomenclatore regionale, priorità CUP, rendicontazione ASL |
| HL7 v2.x / CDA Rel. 2 | interoperabilità GIPO e Studio Lab |
| DICOM 3.0 | interoperabilità GIPO, ZeeroMed e apparecchiature |
| ISO 15189:2022 | competenza dei laboratori medici, accreditamento |

=== sezione
ordine: 20
slug: manuale-da-riconciliare
titolo: Differenze tra manuale e interfaccia da riconciliare
parole_chiave: da riconciliare, differenze manuale interfaccia, manuale operativo, incongruenze, nomi diversi, aggiornare manuale
sintesi: L'elenco dei punti in cui il manuale operativo TD-SGI-MAN007 e l'interfaccia di GIPO osservata usano nomi o descrivono comportamenti diversi, da chiarire con il referente e nella prossima revisione del manuale.
fonte: INTERFACCIA+MANUALE
livello: BACK_END
===
### A cosa serve
Raccoglie i punti in cui il manuale e le schermate osservate non coincidono. Nella guida valgono i **nomi dell'interfaccia**; queste differenze vanno chiarite con il referente GIPO e portate nella prossima revisione del manuale.

### I punti
| Argomento | Manuale TD-SGI-MAN007 | Interfaccia osservata |
|---|---|---|
| Wizard | trova in un clic il primo slot che soddisfa specialista, sala e apparecchiatura | prenotazione a carrello: Aggiungi al carrello, Dal / Al, Cerca, griglia Ora / Agende |
| Lista di lavoro | "Lista Lavoro" | **Lista di Lavoro** |
| Archivio pazienti | "Pazienti > Gestione pazienti" | **Pazienti > Gestione paziente** |
| Modulistica dall'anagrafica | pulsante Modulistica nella scheda del paziente | in Nuovo paziente osservati solo Indietro, Salva, Informazioni (da confermare sulla scheda di un paziente salvato) |
| Natura bollo | voce "N4-Pretsazioni esenti IVA" | campo **Natura bollo** osservato, voci non annotate |
| Sistema Tessera Sanitaria | trasmissione automatica (GIPO SSN) | **Invio spese Gipo730**: "Account non configurato per l'invio delle spese verso Gipo730" |
| Priorità | "priorità CUP" | **Priorità Accesso** (scheda SSN, Riepilogo Asl) |
| Convenzione assicurativa | "codice convenzione" | listino con **Assicurazione collegata**, scheda **Assicurazione** con **Numero pratica** |
| SmartQ e cruscotto operativo | monitor di sala d'attesa e cruscotto in tempo reale | nessuna voce di menu con questi nomi |
| Medicina dello sport | sezione "Visite", pulsante "+ Nuova" | menu **Med. dello sport > Nuova visita** ed **Elenco visite** |
| Portale referti | www.referti.online e Dossier Sanitario TuoTempo | non pertinente all'interfaccia di GIPO; vale l'indirizzo del modulo TD-SGI-MOD235 |
| Reportistica operativa | accessi, ritardi, ricavi, anomalie HL7 e DICOM | nessuna voce di menu corrispondente osservata |

### Attenzioni
- Quando un punto è chiarito, la redazione corregge la sezione interessata e toglie la riga da questa tabella.
