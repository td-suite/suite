---
capitolo: 8
titolo: Fatturazione e cassa
intro: Fatture e note di credito, fattura elettronica, fatture di gruppo, scadenzario, registro IVA, gestione cassa e chiusura di giornata, conservazione, fatture passive, Gipo730 e MultiDoc.
---

=== sezione
ordine: 1
slug: nuova-fattura
titolo: Nuova fattura: campi e pulsanti
percorso_gipo: /Fatture/Create
parole_chiave: nuova fattura, fatturare, fattura, intestata a, anagrafica erogante, sezionale, data documento, metodo di pagamento, condizione di pagamento, totale documento, netto dovuto, crea, scontrino, ricevuta
sintesi: Campi e pulsanti di Nuova fattura (intestazione, sezionale, righe, pagamento, bollo, Crea e Stampa, opzioni di stampa) e le regole TD su esenzione IVA, bollo e Natura bollo N4.
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
===
### A cosa serve
Emettere una fattura al paziente o a un altro soggetto.

### Dove si trova
Menu **Fatturazione > Nuova fattura** (percorso /Fatture/Create). Più spesso si arriva dalla Lista di lavoro (**Accetta e fattura**, **Fattura**) o dall'assegnazione (vedi [Fatturare dalla Lista di lavoro e dall'assegnazione](sezione:fatturare-da-lista)).

### Cosa c'è nella schermata
Sezioni: **Dati fattura**, **Note**, **Allegati**. Schede: **Prestazioni / Prodotti** e **Scadenze\Pagamenti**.

Pulsanti: **Crea**, **Indietro**, **Carica DDT**, **Modulistica**, **Informazioni**, **Opzioni stampa**, **Aggiungi**, **Sconto a corpo**, **Associa medico**, **Excel**, "Seleziona o trascina gli allegati".

Campi della testata: **Intestata a**, **Anagrafica erogante**, **Numero documento e sezionale**, **Data documento**, **Data pagamento**, **Metodo di pagamento**, **Condizione di pagamento**, **Fattura elettronica**, **Opzioni stampa**.

Riga di inserimento: **Prestazione - Listino**, **Qta**, **Prezzo**, **Sconto %**.

Altri campi: **Contributo**, **Rivalsa INPS**, **Ritenuta d'acconto**, **Gestione bollo**, **Natura bollo**, **Esigibilità IVA**, **Non movimentare magazzino**, **Opposizione invio sistema TS**, **Descrizione importo da sottrarre**, **Importo da sottrarre** (arrotondamenti).

Totali: **Totale Prestazioni**, **Imponibile**, **Totale Iva**, **Totale documento**, **Netto dovuto**.

Colonne delle righe: Tipo, Prestazione, Descrizione, Q.ta, Listino, Spesa, Prezzo, Sconto, Iva %, Tot. riga, Medici, Assegnazioni, Codice CoGe, Centro di costo.

### Come si fa
1. Controlla **Intestata a** (chi riceve la fattura) e **Anagrafica erogante** (chi la emette).
2. Verifica **Numero documento e sezionale** e **Data documento** proposti.
3. Aggiungi le righe: in **Prestazione - Listino** scegli la prestazione, indica **Qta**, controlla **Prezzo** e **Sconto %**, premi **Aggiungi**. Le righe che arrivano da un'assegnazione sono già presenti.
4. Imposta **Metodo di pagamento** (in uso: Contanti, Bonifico, Bonifico istantaneo, POS carte/bancomat) e **Condizione di pagamento**; compila **Data pagamento** se il paziente paga subito.
5. Controlla bollo e opzioni (vedi [Righe, sconti, bollo e opzioni](sezione:fattura-righe-bollo)).
6. Controlla i totali e premi **Crea**: il pulsante ha le varianti **Crea**, **Crea e Stampa**, **Crea e chiudi**.
7. Per stampare o condividere la fattura vai in **Gestione Fatture/NC** (vedi [Gestione fatture e note di credito](sezione:gestione-fatture)).

### Opzioni stampa e scadenze
- **Opzioni stampa**: **Raggruppa per prestazione**, **Raggruppa per impegnativa**, **Nascondi prezzi**.
- Scheda **Scadenze\Pagamenti**: le rate della fattura (vedi [Rate e pagamenti in fattura](sezione:fattura-rate-pagamenti)).

### Regole TD dal manuale operativo
- Privato e assicurazione: fattura esente IVA (art. 10 n. 18 DPR 633/72); sopra 77,47 euro bollo virtuale da 2 euro; nel campo **Natura bollo** scegli sempre la voce **N4** (GIPO non la preseleziona). Vedi [Fase 5: fatturazione e incasso](sezione:fase5-fatturazione).
- Metodi di pagamento ammessi: contanti, POS, bonifico, digitale; non si accettano assegni.

### Attenzioni
- Una fattura creata non si corregge cancellandola: si storna con una nota di credito (vedi [Nota di credito](sezione:nota-di-credito)).
- **Opposizione invio sistema TS** va spuntata solo se il paziente si oppone all'invio delle spese sanitarie al Sistema Tessera Sanitaria.
- In configurazione può essere attivo "Medico obbligatorio in tutte le righe fattura": se GIPO lo chiede, usa **Associa medico**.

=== sezione
ordine: 2
slug: fattura-righe-bollo
titolo: Righe, sconti, bollo e opzioni della fattura
percorso_gipo: /Fatture/Create
parole_chiave: sconto a corpo, sconto, franchigia, bollo, marca da bollo, natura bollo, n4, gestione bollo, ritenuta d'acconto, rivalsa inps, contributo, arrotondamento, importo da sottrarre, opzioni stampa, allegati, carica dati da documento esistente, 77,47
sintesi: Righe, sconti, sconto a corpo, bollo, contributo, rivalsa, ritenuta e opzioni della fattura.
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
===
### A cosa serve
Gestire i casi particolari della fattura: sconti sul totale, franchigie, bollo, ritenute, arrotondamenti, allegati.

### Cosa c'è
- **Sconto a corpo**: finestra "Sconto a corpo fattura", uno sconto sull'intero documento.
- **Applica franchigia totale**: finestra per applicare una franchigia (tipicamente con un'assicurazione, dal nome).
- **Gestione bollo** e **Natura bollo**: come trattare la marca da bollo. In configurazione esistono "Escludi sempre bollo", il conto CoGe del bollo e il testo "Marca da Bollo inserita".
- **Contributo**, **Rivalsa INPS**, **Ritenuta d'acconto**: voci fiscali per casi specifici.
- **Descrizione importo da sottrarre** e **Importo da sottrarre**: per gli arrotondamenti.
- **Carica dati da un documento esistente**: finestra per partire da un documento già emesso.
- **Allegati**: "Seleziona o trascina gli allegati".
- **Opzioni stampa**: impostazioni della stampa del documento.

### Come si fa
1. Per uno sconto sull'intero documento usa **Sconto a corpo**; per lo sconto di una sola riga usa **Sconto %** sulla riga.
2. Per il bollo lascia la gestione proposta, salvo indicazione dell'amministrazione.
3. Per un arrotondamento scrivi la descrizione e l'importo in **Descrizione importo da sottrarre** e **Importo da sottrarre**.
4. Per allegare un file trascinalo nell'area allegati.

### Attenzioni
- Ritenuta d'acconto, rivalsa INPS e contributo cambiano il netto dovuto: usali solo se l'amministrazione lo ha indicato per quel cliente.
- Le soglie e le regole del bollo dipendono dalla configurazione. Regola TD (manuale operativo): sopra 77,47 euro bollo virtuale da 2 euro e, nel campo **Natura bollo**, sempre la voce **N4** (prestazioni esenti IVA), perché GIPO non la preseleziona (vedi [Fase 5: fatturazione e incasso](sezione:fase5-fatturazione)).

=== sezione
ordine: 3
slug: fatturare-da-lista
titolo: Fatturare dalla Lista di lavoro e dall'assegnazione
percorso_gipo: /Home
parole_chiave: accetta e fattura, fattura, fatturare appuntamento, fatturare assegnazione, incassare, pagamento allo sportello, ricevuta paziente
sintesi: La via più rapida per fatturare allo sportello, partendo dall'appuntamento o dalla pratica.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
La via più rapida per fatturare allo sportello, partendo dall'appuntamento o dalla pratica.

### Come si fa
Dalla Lista di lavoro:
1. Sulla riga del paziente arrivato: **Azioni > Accetta e fattura** (oppure **Fattura** se già accettato).
2. Si apre la fattura con le prestazioni dell'appuntamento (da verificare: le righe dovrebbero arrivare dall'assegnazione).
3. Imposta metodo e condizione di pagamento e premi **Crea**.
4. Dopo la creazione la colonna **Fattura** della Lista di lavoro dovrebbe riportare il numero.

Dall'assegnazione o da Gestione assegnazioni:
1. Apri l'assegnazione oppure trova la riga in **Assegnazioni > Gestione assegnazioni**.
2. Usa l'azione **Fattura**.
3. Completa e premi **Crea**. La colonna **Fatturata** delle prestazioni dovrebbe aggiornarsi.

### Attenzioni
- Se il paziente paga una parte e un'assicurazione un'altra, controlla **Importo paziente** e **Importo ass.** nell'assegnazione prima di fatturare.
- Per una sola fattura che raccoglie più pratiche vedi [Gruppo assegnazioni](sezione:gruppo-assegnazioni).

=== sezione
ordine: 4
slug: nota-di-credito
titolo: Nota di credito
percorso_gipo: /NotaCredito/Create
parole_chiave: nota di credito, storno, stornare fattura, rimborso, annullare fattura, fattura sbagliata, carica fattura, nota credito elettronica
sintesi: Stornare in tutto o in parte una fattura già emessa (errore, rimborso, prestazione non eseguita).
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Stornare in tutto o in parte una fattura già emessa (errore, rimborso, prestazione non eseguita).

### Dove si trova
- Menu **Fatturazione > Nuova nota credito** (percorso /NotaCredito/Create).
- Da **Gestione Fatture/NC**: azione di riga **Crea nota di credito** sulla fattura da stornare, oppure **Crea nuova... > Nota credito**.

### Cosa c'è nella schermata
È come la fattura (vedi [Nuova fattura](sezione:nuova-fattura)) con in più:
- **Carica Fattura**: parte dalla fattura da stornare;
- **Data / Numero / Sezionale documento rimborso**;
- **Nota di credito elettronica**;
- finestre **Recupero buchi nota credito** e **Carica dati da un documento esistente**.

### Come si fa
1. Il modo più sicuro: in **Fatturazione > Gestione Fatture/NC** trova la fattura e usa **Crea nota di credito** sulla sua riga, così la nota parte già collegata alla fattura.
2. In alternativa apri **Nuova nota credito** e usa **Carica Fattura** per scegliere la fattura da stornare.
3. Lascia le righe da stornare (tutte per uno storno totale, solo alcune o con importi ridotti per uno storno parziale).
4. Compila i dati del documento di rimborso e il metodo di pagamento del rimborso.
5. Crea la nota di credito; se elettronica, controllane l'esito come per le fatture (vedi [Fattura elettronica](sezione:fattura-elettronica)).

### Attenzioni
- Una fattura non si cancella per correggerla: **Elimina** in Gestione Fatture/NC va usato solo nei casi previsti dall'amministrazione (per esempio documento appena creato e non inviato: da verificare).
- Dopo lo storno, per rifatturare correttamente crea una nuova fattura.
- Chiedi all'amministrazione prima di stornare fatture di mesi precedenti.

=== sezione
ordine: 5
slug: gestione-fatture
titolo: Gestione fatture e note di credito
percorso_gipo: /Fatture/Index
parole_chiave: gestione fatture, elenco fatture, ristampare fattura, stampa fattura, condividi fattura, crea ddt, elimina fattura, cercare fattura, errore invio, esito
sintesi: Elenca fatture e note di credito.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Elenca fatture e note di credito: da qui si stampano, si condividono, si stornano e si controlla l'esito della fattura elettronica.

### Dove si trova
Menu **Fatturazione > Gestione Fatture/NC** (percorso /Fatture/Index).

### Cosa c'è nella schermata
Comandi: **Crea nuova...** (Fattura / Nota credito), **Mostra prestazioni**, **Excel**, **Cerca**.

Colonne: Num., Prog., Sez., Tipo, Data, Cliente, Errore invio, E/C, Esito (fattura elettronica), Codice Fiscale/PIVA, Totale prestazioni, Totale imponibile, Totale Iva, Bollo, Totale fattura, Ritenuta d'acconto, Netto dovuto, Data pagamento, Metodo di pagamento, Condizione di pagamento, Origine, Indirizzo / CAP / Provincia / Comune cliente, Opposizione sistema TS.

Azioni di riga: **Stampa**, **Condividi**, **Crea DDT**, **Crea nota di credito**, **Visualizza documento elettronico**, **Scarica documento elettronico**, **Elimina**.

### Come si fa
1. Cerca la fattura con **Cerca** (numero, cliente o codice fiscale).
2. Per ristamparla: **Stampa** sulla riga.
3. Per inviarla al paziente: **Condividi** (il canale usato, email o altro, non è stato osservato).
4. Per stornarla: **Crea nota di credito**.
5. Per vedere le prestazioni dentro ogni documento attiva **Mostra prestazioni**.

### Attenzioni
- Controlla ogni giorno le colonne **Errore invio** ed **Esito** (vedi [Fattura elettronica](sezione:fattura-elettronica)).
- In configurazione può essere attivo "Blocca modifiche documento se scaricato": un documento già scaricato potrebbe non essere più modificabile.

=== sezione
ordine: 6
slug: fattura-elettronica
titolo: Fattura elettronica: esiti, errori e documento elettronico
percorso_gipo: /Fatture/Index
parole_chiave: fattura elettronica, sdi, esito, errore invio, scarto, xml, documento elettronico, codice destinatario, pec, e/c
sintesi: Verificare che le fatture elettroniche siano state trasmesse e accettate, e recuperare il file elettronico.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Verificare che le fatture elettroniche siano state trasmesse e accettate, e recuperare il file elettronico.

### Dove si trova
**Fatturazione > Gestione Fatture/NC** (percorso /Fatture/Index): colonne **Errore invio** ed **Esito** (fattura elettronica), azioni **Visualizza documento elettronico** e **Scarica documento elettronico**. In fattura il campo **Fattura elettronica**, nella nota di credito **Nota di credito elettronica**.

### Come si fa
1. In **Gestione Fatture/NC** guarda la colonna **Esito** della fattura.
2. Se **Errore invio** è valorizzato, leggi il messaggio: spesso riguarda i dati del cliente (codice fiscale, partita IVA, **Codice destinatario Fatt-e**, PEC, indirizzo).
3. Correggi i dati nell'anagrafica del paziente o del cliente secondo le indicazioni dell'amministrazione.
4. Per vedere il documento trasmesso usa **Visualizza documento elettronico**; per salvarlo **Scarica documento elettronico**.

### Attenzioni
- I valori possibili della colonna **Esito** e come si ritrasmette un documento scartato non sono stati osservati: per una fattura scartata chiedi all'amministrazione prima di fare altro.
- La colonna **E/C** compare anche in Gestione cassa: il significato della sigla non è spiegato dall'interfaccia (vedi il [Glossario](sezione:glossario-sigle)).

=== sezione
ordine: 7
slug: gruppo-assegnazioni
titolo: Gruppo assegnazioni: una fattura per più pratiche
percorso_gipo: /Fatture/AssegnazioniDaFatturare
parole_chiave: gruppo assegnazioni, assegnazioni da fatturare, fattura unica, fattura cumulativa, azienda, convenzione, crea fattura, riportare i medici
sintesi: Creare una sola fattura per più assegnazioni, per esempio per un'azienda o un ente che paga le prestazioni di più persone.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Creare **una sola fattura per più assegnazioni**, per esempio per un'azienda o un ente che paga le prestazioni di più persone.

### Dove si trova
Menu **Fatturazione > Gruppo assegnazioni** (percorso /Fatture/AssegnazioniDaFatturare).

### Cosa c'è nella schermata
Filtri: **Data Assegnazione**, **Centro di lavoro**, **Fatturare a**, **Altro**, "Riportare i medici delle prestazioni".

Colonne: Numero, Numero\Anno, Paziente, Fatturare a, Nome assegnazione / episodio, Data creazione.

Pulsante: **Crea fattura**.

### Come si fa
1. Imposta il periodo in **Data Assegnazione** e il soggetto in **Fatturare a**.
2. Se servono i medici sulle righe della fattura spunta "Riportare i medici delle prestazioni".
3. Seleziona le assegnazioni da includere.
4. Premi **Crea fattura** e completa la fattura come di consueto.

### Attenzioni
- Perché un'assegnazione compaia qui, **Fatturare a** deve essere impostato sul soggetto giusto già nell'assegnazione.

=== sezione
ordine: 8
slug: scadenzario
titolo: Scadenzario: rate e pagamenti
percorso_gipo: /Scadenzario/Index
parole_chiave: scadenzario, rate, scadenze, pagamento rata, incasso rata, saldo, insoluti, rate scadute, assicurazione, imposta data pagamento
sintesi: Seguire le rate dei documenti (pagamenti dilazionati, importi a carico delle assicurazioni) e registrarne il pagamento.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Seguire le rate dei documenti (pagamenti dilazionati, importi a carico delle assicurazioni) e registrarne il pagamento.

### Dove si trova
Menu **Fatturazione > Scadenzario** (percorso /Scadenzario/Index). In fattura la scheda **Scadenze\Pagamenti**.

### Cosa c'è nella schermata
Schede: **Scadenze**, **Dettaglio scadenze**.

Filtri: **Intestazione fattura**, **Data documento**, **Data scadenza rata**, **Nascondi rate pagate** (No / Sì), **Solo rate scadute**, **Assicurazione**.

Colonne: Paziente fatturazione, Documento, Assicurazione, Condiz. pagamento, Rate, Tot. dare, Tot. ricevuto, Saldo.

Comando: **Imposta data pagamento rata** (con metodo di pagamento).

### Come si fa
1. Per vedere cosa manca da incassare: **Nascondi rate pagate** = Sì, eventualmente **Solo rate scadute**.
2. Quando una rata viene pagata, selezionala e usa **Imposta data pagamento rata**, indicando data e metodo di pagamento.
3. Per le assicurazioni filtra per **Assicurazione**.

### Scheda Dettaglio scadenze
Una riga per rata: Num. doc., Sez. doc., Data doc., Cond. pag., Quota a carico, Scadenza rata, Dare rata, Ricevuto rata, Saldo rata, Data pagam. rata, Mod. pagamento rata, Nota rata. È la vista giusta per vedere rata per rata chi ha pagato cosa e quando.

### Attenzioni
- In configurazione esiste "Scadenzario: imposta data pagamento come data documento": a seconda dell'impostazione una rata può risultare pagata già alla data della fattura.
- Le rate nascono nella scheda **Scadenze\Pagamenti** della fattura (vedi [Rate e pagamenti in fattura](sezione:fattura-rate-pagamenti)).

=== sezione
ordine: 9
slug: registro-iva
titolo: Stampa del registro IVA
percorso_gipo: /Fatture/RegistroIva
parole_chiave: registro iva, stampa registro, xml gipo, xml fattura elettronica, protocollo, sezionale, fatture non pagate
sintesi: Stampare il registro IVA delle vendite ed esportare i documenti in formato XML.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Stampare il registro IVA delle vendite ed esportare i documenti in formato XML.

### Dove si trova
Menu **Fatturazione > Stampa registro iva** (percorso /Fatture/RegistroIva).

### Cosa c'è nella schermata
Filtri: **Fatture da / a**, **Solo fatture non pagate**, **Da / A data pagamento**, **Metodo di pagamento**, **Protocollo**, **Sezionale**.

Comandi: **Stampa**, **XML Gipo**, **XML Fattura Elettronica**.

### Come si fa
1. Imposta il periodo (**Fatture da / a**) e, se serve, il **Sezionale**.
2. Premi **Stampa** per il registro.
3. Per l'esportazione dei file usa **XML Fattura Elettronica** o **XML Gipo** secondo le indicazioni dell'amministrazione o del commercialista.

### Attenzioni
- È un'operazione amministrativa: l'accettazione di norma non la usa.

=== sezione
ordine: 10
slug: gestione-cassa
titolo: Gestione cassa e chiusura di giornata
percorso_gipo: /GestioneCassa/Index
parole_chiave: gestione cassa, chiusura di cassa, chiusura giornata, incasso, incassi del giorno, stampa cassa, per operatore, per listino, contanti, pos, elabora, non incassato
sintesi: Vedere gli incassi di un periodo e stampare la chiusura di cassa (per esempio a fine giornata).
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Vedere gli incassi di un periodo e stampare la chiusura di cassa (per esempio a fine giornata).

### Dove si trova
Menu **Fatturazione > Gestione cassa** (percorso /GestioneCassa/Index).

### Cosa c'è nella schermata
Schede: **Movimenti**, **Totali**, **Filtri**.

Date: **Data emissione** / **Data incasso**.

Comandi: **Elabora**, **Stampa** (Normale / Per listino / Per operatore), **Excel**.

Colonne: Tipo, Num., Sez., Data, Paziente, P/SSN, E/C, Totale documento, Importo, Incassato, Non Incassato, Mod.Pag., Cond.Pag., Utente.

Azioni di riga: **Stampa**, **Visualizza / Scarica documento elettronico**.

### Come si fa
Chiusura di fine giornata (traccia da validare con il referente):
1. Apri **Fatturazione > Gestione cassa**.
2. Nella scheda **Filtri** imposta la data di oggi (per **Data incasso** se conti gli incassi del giorno, per **Data emissione** se conti i documenti emessi) e la sede o l'operatore se previsti.
3. Premi **Elabora**.
4. Controlla la scheda **Movimenti** (un documento per riga, con **Mod.Pag.**: contanti, POS, bonifico) e la scheda **Totali**.
5. Confronta i totali per metodo di pagamento con il contante in cassa e con lo scontrino del POS.
6. Premi **Stampa** e scegli **Normale**, **Per listino** o **Per operatore** secondo quanto richiesto dalla tua sede.

### La scheda Filtri
- **Importo documento**.
- **Tipo documento**: Fatture, Note credito.
- **Stato pagamento**: Pagate, Non pagate.
- **Privati/SSN**: Private, SSN.
- **Iva**: Con Iva, Esenti Iva.
- **Utenti**: "Mostra solo tipo segreteria/amministrazione".
La scheda **Totali** riporta i totali del periodo elaborato.

### Attenzioni
- **Non Incassato** indica importi fatturati ma non incassati: controllali prima di chiudere.
- Quale data usare e quale stampa consegnare (e a chi) lo decide l'amministrazione: questa sezione descrive solo la schermata.
- La chiusura di cassa nella Suite TD (modulo Cash Management) è un'altra cosa: segui le istruzioni della tua sede per entrambe.

=== sezione
ordine: 11
slug: conservazione-sostitutiva
titolo: Conservazione sostitutiva
percorso_gipo: /fatture/conservazione-sostitutiva
parole_chiave: conservazione sostitutiva, archiviazione, conservazione digitale, documenti fiscali
sintesi: Mostra lo stato di conservazione digitale dei documenti fiscali.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Mostra lo stato di conservazione digitale dei documenti fiscali.

### Dove si trova
Menu **Fatturazione > Conservazione sostitutiva** (percorso /fatture/conservazione-sostitutiva).

### Cosa c'è nella schermata
Colonne: **N. Documento**, **Data documento**, **Tipo documento**, **Stato**.

### Attenzioni
- I valori della colonna **Stato** e le operazioni possibili non sono stati osservati. È un'attività dell'amministrazione.

=== sezione
ordine: 12
slug: fatture-passive
titolo: Fatture passive
percorso_gipo: /fatture/passive
parole_chiave: fatture passive, fatture fornitori, ricevute, acquisti
sintesi: Ricevere e consultare le fatture dei fornitori.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Ricevere e consultare le fatture dei fornitori.

### Dove si trova
Menu **Fatturazione > Fatture passive** (percorso /fatture/passive).

### Attenzioni
- Il contenuto della pagina **non era leggibile** durante l'analisi: per l'uso chiedi all'amministrazione o all'assistenza Gipo.

=== sezione
ordine: 13
slug: gipo730
titolo: Invio spese Gipo730 (Sistema Tessera Sanitaria)
percorso_gipo: /InvioGipo730/Index
parole_chiave: gipo730, 730, sistema tessera sanitaria, invio spese sanitarie, opposizione, detrazione
sintesi: Invio delle spese sanitarie al Sistema Tessera Sanitaria per la dichiarazione dei redditi (730 precompilato).
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
===
### A cosa serve
Invio delle spese sanitarie al Sistema Tessera Sanitaria per la dichiarazione dei redditi (730 precompilato).

### Dove si trova
Menu **Fatturazione > Invio spese Gipo730** (percorso /InvioGipo730/Index).

### Stato sull'account di Toscana Diagnostica
Al momento dell'analisi la pagina riportava: **"Account non configurato per l'invio delle spese verso Gipo730"**. La funzione quindi non è attiva su questo account.

### Attenzioni
- In fattura resta il campo **Opposizione invio sistema TS**: va spuntato se il paziente si oppone all'invio dei dati. Come vengono trasmesse le spese senza Gipo730 va chiesto all'amministrazione.

### Da riconciliare con il manuale
- Il manuale operativo TD dice che GIPO trasmette automaticamente al Sistema Tessera Sanitaria le spese (anche delle fatture private e delle note di credito) con invio mensile tramite GIPO SSN, e la checklist chiede di verificarne la regolarità; sull'account TD questa pagina dice "Account non configurato". Va chiarito con l'amministrazione quale canale è attivo (vedi [Fase 9](sezione:fase9-post-erogazione)).

=== sezione
ordine: 14
slug: multidoc
titolo: MultiDoc (archivio documentale)
percorso_gipo: /multidoc
parole_chiave: multidoc, archivio documentale, documenti, archivio, allegati
sintesi: MultiDoc, l'archivio documentale di GIPO.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
MultiDoc è l'archivio documentale di GIPO.

### Dove si trova
- Menu **Fatturazione > MultiDoc** (percorso /multidoc).
- Per un singolo paziente: **Pazienti > Gestione paziente > Altre azioni > MultiDoc** (vedi [MultiDoc del paziente](sezione:paziente-multidoc)).

### Attenzioni
- La struttura dell'archivio, i tipi di documento e il caricamento non sono stati descritti nell'analisi: da completare con il referente.

=== sezione
ordine: 15
slug: numerazione-recupero-buchi
titolo: Numerazione, sezionali e recupero buchi
percorso_gipo: /Fatture/Create
parole_chiave: numerazione, numero fattura, sezionale, recupero buchi, buco numerazione, numero mancante, dispositivo
sintesi: Numerazione dei documenti per sezionale e recupero dei buchi di numerazione di fatture e note di credito.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Ogni fattura ha un numero dentro un **sezionale** (una serie di numerazione). Se resta un numero inutilizzato ("buco"), GIPO offre una funzione per recuperarlo.

### Cosa c'è
- In fattura: **Numero documento e sezionale**.
- Finestre **Recupero buchi fattura** e, nella nota di credito, **Recupero buchi nota credito**.
- In Gestione Fatture/NC le colonne **Num.**, **Prog.**, **Sez.**.
- I sezionali si configurano in **Configurazione > Fatturazione > Sezionali documento** (vedi [Sezionali e anagrafiche di fatturazione](sezione:config-sezionali-anagrafiche)).

### Come si fa
1. Lascia il sezionale proposto per la tua sede, salvo indicazioni diverse.
2. Se l'amministrazione ti segnala un numero mancante, usa **Recupero buchi fattura** per emettere il documento con quel numero (il funzionamento esatto della finestra non è stato osservato).

### Attenzioni
- Un sezionale può essere limitato a una sede o predefinito per una sede: se il numero proposto sembra di un'altra serie, avvisa l'amministrazione prima di creare la fattura.

=== sezione
ordine: 16
slug: fattura-rate-pagamenti
titolo: Rate e pagamenti in fattura
percorso_gipo: /Fatture/Create
parole_chiave: rate, rateizzare, pagamento a rate, scadenze pagamenti, data scadenza, calcola percentuale, dare, ricevuto, saldo, modalità di pagamento rata, condizione di pagamento, acconto, pagamento parziale, prima rata bollo
sintesi: Come dividere una fattura in rate nella scheda Scadenze\Pagamenti (data scadenza, Calcola %, Dare, Ricevuto, Saldo, data e modalità di pagamento) e registrare poi gli incassi dallo Scadenzario.
fonte: INTERFACCIA
livello: OPERATIVO
===
### A cosa serve
Dividere l'importo di una fattura in rate con le loro scadenze e registrare quanto è stato pagato.

### Dove si trova
**Nuova fattura**, scheda **Scadenze\Pagamenti**. Dopo l'emissione le rate si seguono in **Fatturazione > Scadenzario**.

### Cosa c'è
Colonne delle rate: **Data scadenza**, **Calcola %**, **Dare**, **Ricevuto**, **Saldo**, **Data pagamento**, **Modalità di pagamento**, **Note**.

### Come si fa
1. Nella testata della fattura scegli la **Condizione di pagamento**: le condizioni (Configurazione > Fatturazione > Condizioni pagamento) definiscono le rate e se la prima rata comprende il bollo (colonna **Prima rata Bollo**).
2. Apri la scheda **Scadenze\Pagamenti** e controlla le rate proposte: **Data scadenza**, importo in **Dare** (o la quota con **Calcola %**).
3. Se il paziente paga subito la prima rata, compila **Ricevuto**, **Data pagamento** e **Modalità di pagamento** su quella riga; il **Saldo** mostra quanto resta.
4. Crea la fattura.
5. Alle scadenze successive registra gli incassi da **Fatturazione > Scadenzario** con **Imposta data pagamento rata** (vedi [Scadenzario](sezione:scadenzario)).

### Esempio
Fattura di 600 euro in tre rate mensili: tre righe con Dare 200 euro e scadenze a 30, 60 e 90 giorni; la prima pagata subito con POS (Ricevuto 200, Data pagamento oggi, Modalità POS).

### Cosa verificare dopo
- Nello **Scadenzario**, scheda **Dettaglio scadenze**, la fattura ha le tre rate con **Saldo rata** corretto.

### Attenzioni
- Se le rate non sono proposte in automatico, il modo di aggiungerle a mano (pulsante della griglia) non è stato annotato: da provare su una fattura di prova senza crearla.
- Rateizzazioni e acconti vanno concordati con l'amministrazione.
