---
capitolo: 11
titolo: SSN e impegnative
intro: Riepilogo Asl delle impegnative, conferma e scarto, stampe per l'Asl e configurazioni del Servizio sanitario.
---

=== sezione
ordine: 1
slug: ssn-riepilogo-asl
titolo: Riepilogo Asl: filtri e colonne
percorso_gipo: /Impegnative/RiepilogoAsl
parole_chiave: riepilogo asl, impegnative, ricette, ssn, dematerializzate, rosse, interne, sar, sac, cup, regime erogazione, ticket, esenzione, export excel
===
### A cosa serve
Elenca le impegnative SSN erogate per controllarle, confermarle e preparare le stampe per l'Asl.

### Dove si trova
Menu **SSN > Riepilogo Asl** (percorso /Impegnative/RiepilogoAsl).

### Cosa c'è nella schermata
Schede: **Impegnative**, **Elaborazione e stampe**.

Filtri:
- **Data fine terapia**.
- **Tipo impegnativa**: Interne, Rosse, Dematerializzate.
- **Origine impegnativa**: SAR/SAC, CUP, Manuali.
- **Centro di lavoro**, **Sede**, **Codice Asl**, **Regime erogazione**, **Confermate**.
- **Altro**: Data assegnazione, Tipo ticket, Posizione contabile, Posizione ticket (Esente / Non esente < € 38,00 / Non esente franchigia), Priorità accesso, Luogo (Regione / Fuori regione / Fuori provincia), Identif. assoluto, Listini, Fatturato a Azienda, Data conferma, Impegnative scartate, Specialità.

Colonne: Azioni, Confermata, Scartata, Num. Impegnativa, Data impegnativa, Num. Assegn., Numero\Anno, Paziente, Codice fiscale, Cod. regione, Cod. Asl, Tipo ticket, Cod. esenzione, Num. Prestazioni, Totale prestazioni, Ticket, Quota fissa, Totale Impegnativa, Centro di lavoro, Data Inizio / Fine Terapia, Num. Fattura, Data fattura, Regime Erogazione.

Comandi: **Export Excel**, **Aggiorna Regime di Erogazione**.

### Come si fa
1. Imposta il periodo con **Data fine terapia** e, se serve, **Sede** e **Centro di lavoro**.
2. Filtra per **Tipo impegnativa** o **Origine impegnativa** se devi controllare un solo canale.
3. Controlla per ogni riga ticket, esenzione e totali.
4. Conferma o scarta le impegnative (vedi [Confermare e scartare le impegnative](sezione:ssn-conferma-scarto)).

### Attenzioni
- È un'attività di chi gestisce la rendicontazione SSN: l'accettazione inserisce le impegnative nell'assegnazione (vedi [Impegnativa e Budget SSN](sezione:assegnazione-ssn)).

=== sezione
ordine: 2
slug: ssn-conferma-scarto
titolo: Confermare e scartare le impegnative, regime di erogazione
percorso_gipo: /Impegnative/RiepilogoAsl
parole_chiave: confermare impegnativa, conferma, scartata, scarto impegnativa, regime di erogazione, aggiorna regime, azioni
===
### A cosa serve
Segnare quali impegnative sono confermate (da rendicontare) e quali scartate, e allineare il regime di erogazione.

### Cosa c'è
- Colonne **Confermata** e **Scartata** e colonna **Azioni** in **SSN > Riepilogo Asl**.
- Filtri **Confermate**, **Data conferma**, **Impegnative scartate**.
- Comando **Aggiorna Regime di Erogazione**.
- In configurazione: "Conferma impegnative di default" (vedi [Configurazione SSN](sezione:config-ssn)).

### Come si fa
1. Filtra le impegnative non confermate del periodo.
2. Verifica i dati di ogni impegnativa.
3. Usa la colonna **Azioni** o i campi **Confermata** / **Scartata** della riga (il comando esatto non è stato osservato: da verificare).
4. Se il regime di erogazione delle righe non è aggiornato, usa **Aggiorna Regime di Erogazione**.

### Attenzioni
- Se "Conferma impegnative di default" è attivo, le impegnative nascono già confermate: in quel caso il controllo consiste nello scartare quelle errate.

=== sezione
ordine: 3
slug: ssn-stampe
titolo: Stampe per l'Asl
percorso_gipo: /Impegnative/RiepilogoAsl
parole_chiave: stampe asl, riepilogo prestazioni, compatto, per specialità, campionatura impegnative, elaborazione e stampe
===
### A cosa serve
Produrre le stampe di rendicontazione delle impegnative.

### Dove si trova
**SSN > Riepilogo Asl**, scheda **Elaborazione e stampe**.

### Cosa c'è
Stampe disponibili:
- **riepilogo prestazioni**: normale, compatto, per specialità, con ordinamento;
- **riepilogo campionatura impegnative**.

### Come si fa
1. Imposta i filtri del periodo nella scheda **Impegnative**.
2. Passa a **Elaborazione e stampe** e scegli la stampa.
3. Controlla la stampa prima dell'invio.

### Attenzioni
- In configurazione si sceglie il **Destinatario stampa riepilogo prestazioni** e se nascondere i prezzi in fattura.

=== sezione
ordine: 4
slug: ssn-tabelle
titolo: Tipi ticket, esenzioni, diagnosi e budget
percorso_gipo: /BudgetSSN
parole_chiave: tipi ticket, codici esenzione, codici diagnosi, budget ssn, imposta budget annuo, quota fissa, identificativo assoluto
===
### A cosa serve
Sono le tabelle SSN usate da impegnative e assegnazioni.

### Cosa c'è (Configurazione > SSN)
- **Tipi ticket**: Identificativo Assoluto, Descrizione, Quota Fissa, Descrizione Breve.
- **Codici esenzione**: Codice, Descrizione, Tipo.
- **Codici diagnosi**: Codice, Descrizione, Origine.
- **Budget** (percorso /BudgetSSN): budget per mese, con il comando **Imposta budget annuo**.

### Come si fa
1. Per verificare un codice di esenzione o un tipo ticket consulta la tabella relativa.
2. Il budget si imposta per mese o con **Imposta budget annuo**; in assegnazione il pulsante **Budget SSN** mostra la situazione.

### Attenzioni
- Queste tabelle si modificano solo con l'amministrazione: un errore qui cambia gli importi di tutte le impegnative.
