---
capitolo: 9
titolo: Magazzino e DDT
intro: Stato e movimenti del magazzino dei prodotti venduti o consegnati, documenti di trasporto e collegamento con le fatture.
---

=== sezione
ordine: 1
slug: stato-magazzino
titolo: Stato magazzino
percorso_gipo: /Magazzino/Index
parole_chiave: stato magazzino, giacenze, disponibili, entrati, usciti, prodotti, numeri seriali
===
### A cosa serve
Mostra per ogni prodotto quanto è entrato, quanto è uscito e quanto è disponibile.

### Dove si trova
Menu **Magazzino > Stato Magazzino** (percorso /Magazzino/Index).

### Cosa c'è nella schermata
Colonne: **Codice**, **Marca**, **Descrizione**, **Entrati**, **Usciti**, **Disponibili**, **Note**. Comando **Mostra stato numeri seriali** (per i prodotti con numero di serie).

### Attenzioni
- Il magazzino di GIPO riguarda i **prodotti** fatturati o consegnati ai pazienti (configurati in **Configurazione > Prestazioni > Prodotti**). Il materiale di consumo delle sedi si gestisce nella Suite TD, modulo Ordini e Magazzino.
- Una fattura con **Non movimentare magazzino** spuntato non scarica il prodotto.

=== sezione
ordine: 2
slug: movimenti-magazzino
titolo: Movimenti di magazzino
percorso_gipo: /MovimentiMagazzino/Index
parole_chiave: movimenti magazzino, carico, scarico, causale, aggiungi movimento, rettifica
===
### A cosa serve
Elenca i movimenti di carico e scarico e permette di aggiungerne a mano.

### Dove si trova
Menu **Magazzino > Movimenti di Magazzino** (percorso /MovimentiMagazzino/Index).

### Cosa c'è nella schermata
Comando **Aggiungi**. Colonne: **Tipo**, **Causale**, **Cliente**, **Marca prodotto**, **Descrizione**, **Data**, **Importo**, **Q.tà**.

### Come si fa
1. Per registrare un carico (per esempio l'arrivo di prodotti) premi **Aggiungi**.
2. Indica tipo, causale, prodotto, quantità e data (i campi della finestra non sono stati annotati: da verificare) e salva.
3. Controlla poi lo **Stato magazzino**.

### Attenzioni
- I movimenti generati da fatture e DDT dovrebbero comparire qui da soli: aggiungi a mano solo carichi e rettifiche, secondo le regole interne.

=== sezione
ordine: 3
slug: nuovo-ddt
titolo: Nuovo DDT (documento di trasporto)
percorso_gipo: /DDT/Create
parole_chiave: ddt, documento di trasporto, nuovo ddt, consegna, vettore, colli, causale, numero provvisorio, carica fattura
===
### A cosa serve
Emettere un documento di trasporto per la consegna di prodotti.

### Dove si trova
- Menu **Magazzino > Nuovo DDT** (percorso /DDT/Create).
- Da una fattura: **Gestione Fatture/NC**, azione di riga **Crea DDT**.

### Cosa c'è nella schermata
- **Dati generali**: **Intestata a**, **Anagrafica erogante**, **Numero documento e sezionale**, **Data documento**, **Causale**, **Non movimentare magazzino**.
- **Prodotti**: **Prodotto**, **Descrizione**, **Q.ta**.
- **Dati trasporto**: **Vettore**, **Data/ora partenza**, **Trasporto a cura del**, **Aspetto esteriore dei beni**, **Numero colli**, **Peso lordo / netto**.
- **Note**.
- Pulsante **Carica fattura** (riprende i prodotti da una fattura).

### Come si fa
1. Se il DDT accompagna una fattura, parti dalla fattura con **Crea DDT** oppure usa **Carica fattura**.
2. Compila destinatario, causale e prodotti.
3. Compila i dati di trasporto.
4. Salva.

> Aprire **Nuovo DDT** assegna subito un numero provvisorio. Non aprire la schermata "per prova": rischi di consumare un numero della serie.

### Attenzioni
- Se un numero è stato consumato per errore avvisa l'amministrazione.

=== sezione
ordine: 4
slug: gestione-ddt
titolo: Gestione DDT e collegamento con le fatture
percorso_gipo: /DDT/Index
parole_chiave: gestione ddt, elenco ddt, fattura collegata, carica ddt, ddt fattura
===
### A cosa serve
Elenca i DDT emessi e mostra a quale fattura sono collegati.

### Dove si trova
Menu **Magazzino > Gestione DDT** (percorso /DDT/Index).

### Cosa c'è nella schermata
Colonne: **Num.**, **Data**, **Sez.**, **Paziente**, **Codice Fiscale/PIVA**, **Fattura collegata**, **Creato da**, **Causale**.

### Come si fa
1. Per fatturare un DDT: in **Nuova fattura** premi **Carica DDT** e scegli il documento; la colonna **Fattura collegata** dovrebbe poi riportare la fattura.
2. Per creare il DDT di una fattura: **Gestione Fatture/NC > Crea DDT**.

### Attenzioni
- Un DDT senza **Fattura collegata** è una consegna non ancora fatturata: controlla periodicamente l'elenco.
