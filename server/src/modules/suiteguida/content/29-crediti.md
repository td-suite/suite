---
capitolo: 29
titolo: Recupero Crediti
intro: Tiene le fatture aperte dei clienti aziendali, legge gli incassi dalla banca e porta avanti la scala di sollecito del memo di Amministrazione e Finanza, fermandosi ogni volta che serve una persona.
---

=== sezione
ordine: 1
slug: crediti-serve
titolo: Recupero Crediti: a cosa serve
percorso_gipo: /crediti
parole_chiave: recupero crediti, finance, solleciti, scaduto, a cosa serve
sintesi: Fatture aperte, scaduto, solleciti e incassi dei clienti aziendali in un solo posto.
fonte: INTERFACCIA
livello: OPERATIVO
stato: VALIDATA
validazione: Documentazione del widget v0.95.0 (docs/RECUPERO_CREDITI.md), da recepire nella prossima revisione del Manuale TD-SGI-MAN009
===
Tiene le fatture aperte dei clienti aziendali (da Synclab e dal partitario della contabilità), legge gli incassi dal conto bancario collegato e porta avanti la scala di sollecito: avviso sette giorni prima della scadenza, primo sollecito a dieci giorni, secondo sollecito a venticinque, chiamata del referente commerciale a trentacinque, proposta all'area legale a sessanta.

### Da ricordare
In modalità Prova nessuna email parte. In modalità Attiva partono da soli solo l'avviso e il primo sollecito, e solo quando gli incassi sono verificati: in ogni altro caso la comunicazione resta in attesa con il motivo scritto.

=== sezione
ordine: 2
slug: crediti-accesso
titolo: Recupero Crediti: a chi è destinato e come si apre
parole_chiave: recupero crediti, finance, accesso, aprire, destinatari
sintesi: Chi usa Recupero Crediti e da dove si apre.
fonte: INTERFACCIA
livello: OPERATIVO
stato: VALIDATA
validazione: Documentazione del widget v0.95.0 (docs/RECUPERO_CREDITI.md), da recepire nella prossima revisione del Manuale TD-SGI-MAN009
===
### A chi è destinato
Amministrazione, CFO e CEO; referenti commerciali per le chiamate ai propri clienti; area legale per le pratiche autorizzate.

### Come si apre
Dalla Home, area Finance, tessera Recupero Crediti. Visibile solo a chi ha un profilo sul widget.

=== sezione
ordine: 3
slug: crediti-profili
titolo: Recupero Crediti: profili
parole_chiave: recupero crediti, profili, permessi, ceo, cfo, amministrazione, commerciale, legale
sintesi: I profili di Recupero Crediti e che cosa può fare ciascuno.
fonte: INTERFACCIA
livello: OPERATIVO
stato: VALIDATA
validazione: Documentazione del widget v0.95.0 (docs/RECUPERO_CREDITI.md), da recepire nella prossima revisione del Manuale TD-SGI-MAN009
===
Il profilo stabilisce che cosa ciascuno vede e può fare nel widget. Lo assegna l'Amministrazione della Suite.

- **CEO e CFO**: tutte le decisioni. Solo loro escludono un cliente dai solleciti, attivano la modalità Attiva, firmano il secondo sollecito, approvano un piano di rientro e autorizzano il passaggio all'area legale.
- **Amministrazione**: fatture e partitario, incassi da abbinare, risposte dei clienti, approvazione di avvisi e primi solleciti in attesa.
- **Referente commerciale**: vede i propri clienti e registra l'esito delle chiamate.
- **Area legale**: vede le pratiche autorizzate e il fascicolo.
- **Sola lettura**: consulta senza modificare.

=== sezione
ordine: 4
slug: crediti-uso
titolo: Recupero Crediti: come si usa
parole_chiave: recupero crediti, come si fa, sollecito, incasso, esclusione, promessa, chiamata, partitario
sintesi: Le operazioni principali di Recupero Crediti.
fonte: INTERFACCIA
livello: OPERATIVO
stato: VALIDATA
validazione: Documentazione del widget v0.95.0 (docs/RECUPERO_CREDITI.md), da recepire nella prossima revisione del Manuale TD-SGI-MAN009
===
**Solleciti in attesa.** In Solleciti si legge il motivo dell'attesa, si controllano destinatari e testo e si approva. All'invio il testo viene riscritto sulle sole fatture ancora aperte.

**Incassi da abbinare.** I bonifici con numero di fattura in causale e importo esatto si confermano da soli. Gli altri sono proposte: si confermano, si correggono o si rifiutano. Un bonifico non ancora abbinato ferma i solleciti a quel cliente.

**Risposte dei clienti.** La Suite legge la casella dell'Amministrazione e registra solo le risposte dei clienti. Una promessa con data sospende la scala; una contestazione toglie le fatture dalla scala e resta da gestire.

**Escludere un cliente.** Dalla scheda del cliente, solo CEO o CFO, con motivo obbligatorio ed eventuale data di fine. La decisione resta nel registro.

**Chiamata.** Il referente commerciale trova la chiamata in Chiamate e ne registra l'esito: pagamento promesso, piano di rientro, contestazione, nessun riscontro.

**Partitario.** In Fatture e partitario si carica il file della contabilità: prima l'anteprima, poi la conferma.
