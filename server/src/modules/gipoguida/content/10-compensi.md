---
capitolo: 10
titolo: Compensi dei medici
intro: Calcolo dei compensi (provvigioni) dei medici, riepiloghi e stampe, riepilogo personale del medico.
---

=== sezione
ordine: 1
slug: compensi-calcolo
titolo: Calcolo compensi
percorso_gipo: /Compensi/Calcoli
parole_chiave: compensi, calcolo compensi, provvigioni, medici, nuovo calcolo, base calcolo, periodo
sintesi: Calcola i compensi dei medici per un periodo, sulla base delle prestazioni a loro associate.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Calcola i compensi dei medici per un periodo, sulla base delle prestazioni a loro associate.

### Dove si trova
Menu **Compensi > Calcolo** (percorso /Compensi/Calcoli).

### Cosa c'è nella schermata
Comando **Effettua un nuovo calcolo**. Colonne: **Medico**, **Tipologia medico**, **Data richiesta**, **Periodo Da / A**, **Base calcolo**, **Data riferimento**, **Stato**.

### Come si fa
1. Premi **Effettua un nuovo calcolo**.
2. Indica medico (o medici), periodo e base di calcolo (i campi della finestra non sono stati annotati: da verificare).
3. Avvia il calcolo e attendi che lo **Stato** indichi il termine.
4. Controlla il risultato nel **Riepilogo** (vedi [Riepilogo compensi e stampe](sezione:compensi-riepilogo)).

### Attenzioni
- Il calcolo usa il medico associato alle prestazioni (pulsante **Associa medico** in assegnazione e fattura) e le regole impostate nella scheda del medico (scheda **Compensi**, vedi [Regole di compenso del medico](sezione:medico-compensi-regole)). Un medico mancante sulle righe produce compensi mancanti.
- È un'attività dell'amministrazione.

=== sezione
ordine: 2
slug: compensi-riepilogo
titolo: Riepilogo compensi e stampe
percorso_gipo: /Compensi/Index
parole_chiave: riepilogo compensi, provvigioni per medico, stampa riepilogo, stampa dettaglio, per articolo, per paziente, dovuto, pagamento compensi
sintesi: Mostra le provvigioni per medico con il dettaglio delle prestazioni e produce le stampe.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Mostra le provvigioni per medico con il dettaglio delle prestazioni e produce le stampe.

### Dove si trova
Menu **Compensi > Riepilogo** (percorso /Compensi/Index), titolo "Provvigioni per medico".

### Cosa c'è nella schermata
Filtri: **Medico**, **Listino**, **Da / A data**, **Stato**, **Stampa separata per medico**.

Comandi: **Stampa riepilogo**, **Stampa dettaglio** (per articolo / per paziente), **Esporta Excel**.

Colonne: Medico, Prestazione, Listino, Base calcolo, Documento, Data Rif., Paziente, Q.tà, Importo, Formula, Compenso, Dovuto, Data pagamento, Stato.

### Come si fa
1. Scegli medico e periodo.
2. Controlla le righe (colonne **Formula**, **Compenso**, **Dovuto**).
3. Stampa il riepilogo o il dettaglio; con **Stampa separata per medico** ottieni una stampa per ciascuno.

### Attenzioni
- Le stampe dei compensi contengono nomi di pazienti: consegnale solo all'interessato.
- I modelli di stampa sono in **Configurazione > Templates** (Dettaglio compensi medici, Riepilogo compensi medici).

=== sezione
ordine: 3
slug: compensi-personale
titolo: Riepilogo personale (per il medico)
percorso_gipo: /Compensi/CompensiPersonali
parole_chiave: riepilogo personale, i miei compensi, medico, compensi personali
sintesi: Mostra al medico i propri compensi.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Mostra al medico i propri compensi.

### Dove si trova
Menu **Compensi > Riepilogo Personale** (percorso /Compensi/CompensiPersonali).

### Cosa c'è nella schermata
È la stessa vista del Riepilogo, limitata al medico collegato all'utente che ha fatto l'accesso.

### Attenzioni
- Funziona solo se l'utente è collegato alla scheda del medico (campo **Utente collegato** nella scheda medico, vedi [Aziende e medici](sezione:config-aziende-medici)).
