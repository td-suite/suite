---
capitolo: 6
titolo: Refertazione
intro: Da dove si avvia un referto, la gestione dei referti e i loro stati, la condivisione su MioDottore e l'invio al Fascicolo Sanitario Elettronico.
---

=== sezione
ordine: 1
slug: referto-avvio
titolo: Da dove si avvia un referto
percorso_gipo: /referti
parole_chiave: nuovo referto, errore creazione referto, referta, inizia visita e referta, refertare, scrivere referto, avviare referto
===
### A cosa serve
Spiega da dove aprire un referto senza incorrere nell'errore della voce di menu.

### Il problema noto
La voce di menu **Refertazione > Nuovo referto** (percorso /Referti/Create), aperta così, senza un paziente e una prestazione, dà il messaggio **"Errore creazione referto"**. Non è un guasto del tuo PC: il referto deve nascere da una prestazione.

### Come si fa
Il referto si avvia da una prestazione:
1. dalla **Lista di lavoro**, sulla riga dell'appuntamento: **Azioni > Referta**, oppure **Azioni > Inizia visita e referta** per avviare la visita e il referto insieme;
2. dall'**assegnazione**: pulsante **Referta** (vedi [Prenotare e refertare dall'assegnazione](sezione:assegnazione-prenota-referta));
3. da **Gestione assegnazioni**: azione di riga **Referta**.

Poi:
4. Scrivi il referto nel modello proposto (i modelli si configurano in **Configurazione > Referti**, vedi [Configurazione dei referti](sezione:config-referti)).
5. Salva; per completarlo e firmarlo segui gli stati descritti in [Stati del referto](sezione:referto-stati).

### Attenzioni
- L'editor del referto e la procedura di firma non sono stati osservati in dettaglio: da validare con un medico refertante.
- In **Gestione referti** il pulsante **Nuovo** esiste: se funziona senza errori partendo da lì non è stato verificato.

=== sezione
ordine: 2
slug: gestione-referti
titolo: Gestione referti: filtri, colonne e azioni
percorso_gipo: /referti
parole_chiave: gestione referti, elenco referti, cercare referto, refertante, firma, condiviso md, accesso, prestazioni, filtri referti
===
### A cosa serve
Elenca i referti, con filtri per stato, data, refertante e condivisione su MioDottore.

### Dove si trova
Menu **Refertazione > Gestione referti** (percorso /referti).

### Cosa c'è nella schermata
Pulsanti: **Nuovo**, **Azioni**, **Excel**.

Filtri:
- **Stati referto**: Bozze, Completati, Firmati, In Errore, Includi annullati.
- **Data**.
- **Refertante**.
- **Condivisione MioDottore**: Non condiviso, Condiviso, Errore.
- Campo "Cerca referto o paziente".

Colonne: Titolo, Paziente, Condiviso MD, Data, Firma, Refertante, Accesso, Prestazioni.

### Come si fa
1. Scrivi il paziente o il titolo in "Cerca referto o paziente".
2. Restringi con **Stati referto** (per esempio solo **Bozze** per i referti da completare) e **Refertante**.
3. Apri il referto dalla riga; usa **Azioni** per le operazioni disponibili (le voci del menu Azioni non sono state annotate).

### Attenzioni
- La colonna **Accesso** non è spiegata dall'interfaccia: con ogni probabilità indica se il paziente ha visto o scaricato il referto (da verificare).

=== sezione
ordine: 3
slug: referto-stati
titolo: Stati del referto
percorso_gipo: /referti
parole_chiave: stati referto, bozza, completato, firmato, in errore, annullato, firma referto
===
### A cosa serve
Capire a che punto è un referto.

### Gli stati visti nei filtri
- **Bozze**: referto iniziato, non ancora completato.
- **Completati**: testo concluso.
- **Firmati**: referto firmato (colonna **Firma**).
- **In Errore**: referto con un problema (per esempio nella firma o nell'invio: la causa va letta nel referto, da verificare).
- **Includi annullati**: mostra anche i referti annullati, nascosti di norma.

### Come si fa
1. In **Gestione referti** controlla ogni giorno le **Bozze** e gli **In Errore** del tuo nome (filtro **Refertante**).
2. Completa e firma le bozze secondo la procedura del medico refertante.
3. Per gli errori apri il referto e leggi il messaggio; se non è chiaro apri un ticket a Gipo.

### Attenzioni
- Il passaggio da Completato a Firmato (firma digitale o altro) non è stato osservato: da validare con un medico.

=== sezione
ordine: 4
slug: referto-miodottore
titolo: Condivisione dei referti su MioDottore
percorso_gipo: /referti
parole_chiave: miodottore, condivisione, condiviso md, consenso condivisione, condivisione file, referto online, paziente scarica referto
===
### A cosa serve
GIPO può condividere i referti con il paziente attraverso MioDottore.

### Cosa c'è
- In **Gestione referti**: filtro **Condivisione MioDottore** (Non condiviso, Condiviso, Errore) e colonna **Condiviso MD**.
- Nella scheda del paziente: **Consenti condivisione su MD**.
- In **Configurazione > MioDottore**: **Condivisione file** (vedi [MioDottore](sezione:config-miodottore)).

### Come si fa
1. Verifica che il paziente abbia dato il consenso (**Consenti condivisione su MD** nella scheda anagrafica).
2. In **Gestione referti** filtra **Condivisione MioDottore** = Errore per trovare i referti non condivisi per un problema.
3. Le condizioni con cui GIPO condivide (automaticamente alla firma o a mano) non sono state osservate: da verificare.

### Attenzioni
- Sull'account di Toscana Diagnostica, al momento dell'analisi, la **Mappatura prestazioni** di MioDottore riportava "Nessuna Facility collegata": la condivisione potrebbe non essere attiva. Chiedi al referente prima di dire a un paziente che troverà il referto su MioDottore.

=== sezione
ordine: 5
slug: referto-fse
titolo: Fascicolo Sanitario Elettronico (FSE)
percorso_gipo: /referti/fse
parole_chiave: fse, fascicolo sanitario elettronico, invio referti, regione, gestione fse
===
### A cosa serve
**Gestione FSE** serve all'invio dei referti al Fascicolo Sanitario Elettronico.

### Dove si trova
Menu **Refertazione > Gestione FSE** (percorso /referti/fse). La configurazione è in **Configurazione > SSN > FSE** (percorso /referti/fse/configurazione).

### Attenzioni
- Il contenuto della pagina **non era leggibile** durante l'analisi: come si inviano i referti, quali vengono inviati e come si leggono gli esiti va chiesto al referente o all'assistenza Gipo.
