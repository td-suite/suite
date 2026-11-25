# Collegamento bancario con Enable Banking · v0.95.0

Sola lettura: saldi e movimenti (PSD2, informazione sui conti). Nessuna disposizione di pagamento. Codice: `server/src/lib/banca.js`,
`server/src/routes/banca.js`, tabelle `bank_connections`, `bank_accounts`, `bank_transactions` (migrazione 060).

## Attivazione
1. Creare un'applicazione su enablebanking.com (ambiente di produzione) e registrare l'indirizzo di ritorno
   `https://suite.toscanadiagnostica.it/api/banca/ritorno`.
2. Inserire su Render `ENABLEBANKING_APP_ID` e `ENABLEBANKING_PRIVATE_KEY` (PEM, a capo come `\n`) oppure
   `ENABLEBANKING_PRIVATE_KEY_B64`. La chiave non va in repository, log o chat.
3. In Finance Management > Conti e movimenti (o Recupero Crediti > Conti bancari): "Collega un conto", scelta della banca,
   autenticazione forte sul sito della banca da parte di chi ha i poteri sul conto.

## Funzionamento
Lettura ogni ora dalle 6 alle 21. Prima lettura: 120 giorni di storico, se la banca li concede. Il consenso ha una scadenza
(al massimo quella della banca, richiesti 90 giorni): la Suite avvisa CEO e CFO 10 giorni prima e alla scadenza; serve una nuova
autorizzazione in banca. Finché i movimenti non sono aggiornati i solleciti automatici restano in attesa.

Chi collega o scollega: titolare, CEO, CFO. Chi vede conti e movimenti: anche Finance Support e Amministrazione dei crediti.

## Quadratura (Finance Management)
Uscite a fronte delle autorizzazioni al pagamento (importo uguale più IBAN, CRO o nome; solo importo se unico, segnato debole),
istanze eseguite senza movimento, istanze firmate già pagate in banca, entrate classificate dal Recupero Crediti, confronto con il
conto economico del periodo. Cassa e competenza non coincidono: il prospetto mostra la differenza, non la azzera.

## Non verificato
Il collegamento è provato contro un server che riproduce le rotte documentate di Enable Banking, non contro la banca reale: formato
delle causali, nome dell'ordinante e profondità dello storico dipendono dalla banca e vanno controllati al primo collegamento.

## v0.97.4 · Periodo dei movimenti rifiutato dalla banca (25/11/2026)

Primo collegamento reale (Intesa Sanpaolo): saldo letto, movimenti rifiutati con "422 Wrong transactions period requested" perché la prima lettura chiedeva 120 giorni. Ora, se la banca rifiuta il periodo, `sincronizzaConto` riprova con periodi più corti (`PERIODI_RIDOTTI`: 90, 89, 60, 30, 14, 7 giorni) fino a quello accettato. Lo storico più vecchio di quanto la banca concede non è leggibile: per la quadratura dei mesi precedenti resta l'estratto conto.

## v0.98.0 · Limite giornaliero delle letture e verifica dei pagamenti dello Scadenziario (25/11/2026)

**Limite giornaliero.** Con la lettura automatica ogni ora le banche hanno risposto "429 The access on the account has been exceeding the consented multiplicity per day": senza l'utente presente le letture ammesse sono al più 4 al giorno per conto (PSD2). Ora: il job gira ogni ora (6-21) ma rilegge un conto solo se l'ultima lettura, anche fallita, ha almeno 6 ore (`ORE_TRA_LETTURE`): tre letture al giorno. "Sincronizza" premuto da una persona e la prima lettura dopo il collegamento portano le intestazioni `Psu-Ip-Address`, `Psu-User-Agent`, `Psu-Accept-Language` della sua richiesta (accesso con l'utente presente, che non dovrebbe contare nel limite: da verificare su ogni banca). Il 429 si mostra con una spiegazione e non fa scadere il collegamento. I periodi ridotti della prima lettura scendono a tre tentativi (89, 30, 7 giorni).

**Scadenziario strutture: verifica sul conto** (`modules/finance/lib/verificaBanca.js`, migrazione finance 007). All'apertura dell'agenda, per ogni canone e ogni bolletta registrata non segnati (non per gli importi stimati) si cerca tra le uscite del conto un movimento dello stesso importo al centesimo, tra 15 giorni prima e 90 dopo la scadenza, non già agganciato a un'altra scadenza. Se il movimento nomina il beneficiario (locatore, fornitore) o il codice dell'utenza, la scadenza si segna pagata da sola con data, conto e causale (`schedule_done.source = 'BANCA'`, `bank_tx_id`); la bolletta prende come data di pagamento quella del movimento. Se lo stesso importo compare in un solo movimento che non nomina il beneficiario, l'agenda lo propone con il pulsante "È questo pagamento". Non si abbinano pagamenti parziali, importi diversi dalla scadenza (more, arrotondamenti) né un bonifico unico che paga più scadenze. Lo storico disponibile è quello che la banca concede alla prima lettura.
