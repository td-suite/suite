# Recupero Crediti (widget `crediti`, area Finance) · v0.95.0

Richiesta del CEO del 24/11/2026. Processo dal memo "Modello di sollecito clienti B2B" (Amministrazione e Finanza).

## Cosa fa
Tiene le fatture aperte dei clienti B2B, legge gli incassi dalla banca, prepara e invia i solleciti alle date previste dalla casella
dell'Amministrazione, legge le risposte dei clienti, guida la chiamata del referente commerciale e il passaggio all'area legale.

Fonti: fatture da Synclab (documenti emessi ai client abbinati a una Legal entity non del gruppo) e dal partitario della contabilità
(XLSX o CSV); termini di pagamento, contatti e referente commerciale dal Business Hub; movimenti del conto da Enable Banking
(docs/BANCA.md).

## La scala
| Fase | Quando | Chi | Come parte |
|---|---|---|---|
| Avviso di scadenza | 7 giorni prima | Amministrazione | da sola, se nessun controllo la ferma |
| 1° sollecito | +10 giorni | Amministrazione | da sola, se nessun controllo la ferma |
| 2° sollecito | +25 giorni | firma RAF | sempre con l'approvazione di CFO o CEO; email, PEC inviata a mano e registrata |
| Chiamata | +35 giorni | referente commerciale | attività assegnata, esito obbligatorio |
| Area legale | +60 giorni, o nessun impegno entro 5 giorni lavorativi dalla chiamata | RAF, Direzione sopra soglia | solo proposta; parte su autorizzazione |

La scala non salta fasi. Una fattura entrata già molto scaduta riparte dal 1° sollecito. Fra due fasi passa la distanza del memo,
contata da quando la precedente è davvero partita.

## Modalità
PROVA (predefinita): tutto si prepara e si mostra, nessuna email parte, nessuna fase avanza. ATTIVA: la decidono CEO o CFO dalle
Impostazioni, dopo l'anteprima di cosa partirebbe; servono IBAN, telefono dell'Amministrazione e nome del RAF.

## Controlli che fermano un invio automatico
Posta non attiva; movimenti bancari non letti nelle ultime 26 ore o nessun conto collegato; nessun destinatario; testo incompleto;
scadenza calcolata con i termini predefiniti; cliente non attivo nel Business Hub; risposta del cliente da leggere; nota di credito non
applicata; contestazione aperta; bonifico recente non ancora abbinato che potrebbe essere il pagamento. La comunicazione resta "in
attesa" con il motivo scritto; riparte da sola se il motivo cade, oppure la approva una persona.

Non ricevono nulla: clienti esclusi, con promessa o piano in corso, sospesi, con pratica legale autorizzata. Le fatture contestate
escono dalla scala.

## Esclusione dai solleciti
Solo CEO o CFO (basta uno), motivo obbligatorio, data di fine facoltativa (alla data il cliente rientra da solo). Registro in
"Clienti esclusi" e nella scheda.

## Riconciliazione
Si conferma da sola solo la corrispondenza certa: numero di fattura in causale e importo uguale al residuo, senza contraddizioni
sull'ordinante. Il resto è una proposta da confermare, correggere o rifiutare. Gli IBAN dei clienti si imparano dagli abbinamenti.

## Risposte
La casella si legge ogni 15 minuti (Microsoft Graph, Mail.Read). Si conservano solo i messaggi riconducibili a un cliente con partite
aperte o a un riferimento [TD-CRED-...]. Lettura con il modello AI se attivo, altrimenti per parole chiave. Effetti: "ho già pagato"
sospende in attesa dell'incasso; promessa con data sospende fino alla data più la tolleranza; contestazione toglie le fatture dalla
scala e resta da gestire; assenza automatica nessun effetto; il resto da leggere.

## Profili
CEO, CFO (RAF), ATT (Amministrazione), COMMERCIALE (solo i suoi clienti), LEGALE (solo le pratiche autorizzate), VIEWER. Il titolare
della Suite senza grant entra come CEO; un amministratore senza grant in sola lettura.

## Limiti dichiarati
- La PEC non parte dalla Suite.
- Le festività non sono considerate nei giorni lavorativi.
- Gli interessi di mora non sono calcolati nei testi.
- I testi predefiniti e la bozza della messa in mora vanno riletti sul memo e validati dall'area legale prima della modalità Attiva.
- Synclab non espone scadenza né stato di pagamento: la scadenza viene dai termini, gli incassi dalla banca o dal partitario.

## Variabili
`CREDITI_MAILBOX` (facoltativa) fissa la casella. Job: `crediti:giro` ogni ora (7-20), `crediti:casella` ogni 15 minuti.
Test: `server/test/crediti-regole.test.mjs`, `server/test/crediti-flusso.test.mjs`.

## v0.99.6 · Storni (26/11/2026)

Caso segnalato dal CEO: fattura 26-00022/D stornata dalla nota di credito 26-00038/D e riemessa come 26-00041/D (stesso importo, stessa data). Nel widget la 22 restava "Aperta" e compariva tra le fatture abbinabili a un bonifico.

**Causa.** La Data API del gestionale consegna la nota di credito come documento a sé e **non indica quale fattura storna**. Fino alla 0.99.5 la nota entrava come "nota di credito da applicare" e la fattura si chiudeva solo premendo *Applica* nella scheda del cliente: il passaggio non veniva registrato da solo.

**Ora** (`registraStorni()` in `lib/fatture.js`, regola `fatturaStornata()` in `lib/regole.js`), a ogni lettura dal gestionale e prima di esaminare la banca, ogni nota di credito ancora libera chiude da sola la fattura che storna quando l'individuazione è certa:

- stesso cliente, fattura aperta e mai incassata, residuo uguale al centesimo alla parte libera della nota;
- fattura emessa **prima** della nota: data precedente, oppure stessa data e progressivo più basso nella stessa serie (così la fattura riemessa dopo lo storno non si confonde con quella stornata);
- se nota e fattura riportano le accettazioni e non ne hanno in comune, la fattura è scartata; con più candidate decide l'accettazione in comune.

In ogni altro caso non si storna nulla: la nota resta da applicare a mano e la lettura dice quante sono. Lo storno è scritto nella cronologia del cliente ("Storno registrato in automatico…"). Una fattura chiusa per intero da nota di credito è mostrata come **Stornata** (non "Incassata"), con il numero della nota.

**Banca.** Un bonifico che cita la fattura stornata (il cliente paga con il vecchio numero) identifica il cliente e propone la fattura aperta di pari importo che la sostituisce, sempre da confermare. Corretto anche il riconoscimento dei numeri con anno a due cifre ("26-00022/D": il progressivo è 00022, prima veniva preso 26, quindi queste fatture non erano mai riconosciute in causale).

**Limiti.** Non verificato sui dati di produzione se le note di credito riportano le accettazioni. Uno storno automatico non ha un pulsante di annullo: se fosse sbagliato si corregge dal database. Le note parziali (importo diverso dalla fattura) restano manuali.


## v0.99.7 · Filtro per tipologia in Incassi da abbinare (26/11/2026)

Sopra l'elenco dei movimenti, per ogni linguetta (Proposte, Senza abbinamento, Abbinati, Non sono fatture), il filtro **Tipologia** con il numero di movimenti: Bonifici, POS e carte, Versamenti di contante, Assegni, Incassi SDD e RiBa, Giroconti, Mutui e finanziamenti, Altro (compaiono solo le tipologie presenti). Ogni movimento porta l'etichetta della sua tipologia.

La banca non consegna un campo "tipo": la tipologia si legge dalla causale (`tipoMovimento()` in `lib/regole.js`), sulle diciture viste in produzione il 26/11/2026 ("Bonifico a vs favore", "Incassi PagoBancomat", "Incassi Internazionali Numia SpA", "Versamento contante allo sportello", "Erogazione mutuo", "Giro conto") e sulle forme comuni delle altre banche. Decide la dicitura in testa alla causale. Una dicitura non prevista finisce in Altro: va aggiunta alla regola. `GET /api/crediti/riconciliazione?stato=…&tipo=…` restituisce anche `tipi` e `totale`.
