# Business Hub · Ricerca prospect

Dalla v0.74.0 (CEO, 15/11/2026). È la fase 1 della pipeline: trovare le strutture, capire dal loro sito chi sono e perché possono
interessarci, sapere chi decide, portare in pipeline quelle giuste. I metodi sono ispirati al progetto open source Sellbird (ricerca,
segnali confermati, persone dal sito, schema degli indirizzi, coorti). **Il codice è scritto da zero per la Suite**: Sellbird è AGPL-3.0 e
una traduzione del suo codice avrebbe esteso quella licenza alla Suite. Nessun file di terzi è nel repository.

## Cosa fa

1. **Scoperta** (`lib/scouting/scoperta.js`): OpenStreetMap (servizio Overpass, gratuito, senza chiave) per provincia toscana e
   tipologia: RSA, case di cura e ospedali, poliambulatori, studi medici, farmacie, laboratori, fisioterapia, dentisti, veterinari,
   dialisi; per la medicina del lavoro aziende e stabilimenti, con copertura dichiarata scarsa. Le strutture con gestore pubblico sono
   segnate e nascoste finché non le si chiede. Una struttura che si conosce si aggiunge a mano (nome e sito).
2. **Profilo dal sito** (`profila.js`, `estrai.js`): pagina iniziale più al massimo sette pagine scelte dal menu (contatti, chi siamo e
   direzione, lavora con noi, servizi, note legali). Anagrafica: ragione sociale, partita IVA con cifra di controllo, PEC, email
   generale, telefono, indirizzo. Nessun modello di AI, nessun costo.
3. **Segnali** (`segnali.js`): prelievi o analisi in sede, prelievi a domicilio, laboratorio interno, fornitore di laboratorio citato,
   accreditamento, gruppo di appartenenza, posti letto, più sedi, diagnostica per immagini, medicina del lavoro, prenotazione online,
   dipendenti, certificazioni ISO, assunzioni, ricerca di personale sanitario; più quelli su persone e contatti. Ogni segnale ha la frase
   e la pagina di provenienza. L'amministratore del modulo li accende e spegne e gestisce l'elenco dei laboratori da riconoscere.
4. **Persone chiave** (`persone.js`): direttore sanitario, legale rappresentante o titolare, direzione, acquisti, laboratorio,
   coordinamento infermieristico, risorse umane, RSPP, medico competente, qualità. Tre forme di lettura (titolo e nome, nome e titolo,
   scheda su due righe) e i dati strutturati del sito. Esclusi pazienti e clienti citati, ex titolari, titoli senza nome. Al massimo
   quattro per struttura, ordinate per vicinanza alla decisione secondo la linea.
5. **Email** (`email.js`): indirizzi pubblicati (anche nascosti ai robot), abbinati alla persona; dallo schema imparato (es.
   `n.cognome`) una proposta marcata **ipotesi** per gli altri decisori, mai quando due persone darebbero lo stesso indirizzo e mai senza
   un indirizzo che insegni lo schema. Un'ipotesi non entra nel campo email del referente: resta nella nota, da verificare.
6. **Coorti e punteggio** (`fit.js`): filtro "deve avere / non deve avere" sui segnali; punteggio 0-100 con i motivi in chiaro. I pesi
   sono una prima taratura, da correggere guardando quali prospect diventano clienti.
7. **Porta in pipeline** (`store.js` `promuovi`): Legal entity ritrovata per P.IVA, dominio o nome (mai un doppione) oppure creata,
   account della linea in fase Lead o prospect censito, referenti scelti con la pagina di provenienza, riga nel diario con punteggio e
   segnali. Tipologia, gruppo, accreditamento e fornitore attuale dell'account arrivano dai segnali.
8. **Account esistenti**: nella scheda, tab Referenti, "Completa dal sito" propone i dati di anagrafica mancanti e le persone chiave.
   Si applica solo ciò che si spunta; un dato già presente in anagrafica non viene mai sostituito.

## Cosa NON fa, per scelta

- Non invia email. Il primo contatto parte dalla scheda dell'account, come sempre.
- Non verifica gli indirizzi collegandosi ai server di posta: controlla solo che il dominio riceva posta.
- Non legge elenchi di terzi, registri a pagamento, LinkedIn o siti protetti da controlli anti-robot. Ufficio Camerale ha la ricerca
  protetta da reCAPTCHA: la Suite non la interroga in automatico, offre il collegamento per la verifica a mano. Un collegamento vero
  richiede la loro API a pagamento (Openapi), da valutare.
- "Verifica la partita IVA (VIES)" usa il servizio pubblico della Commissione europea. **Da collaudare in produzione**: l'ambiente di
  sviluppo non lo raggiunge.

## Regole di lettura dei siti (`web.js`)

Solo indirizzi pubblici (ogni risposta DNS e ogni reindirizzamento è controllato), `robots.txt` rispettato, un sito alla volta con una
pausa tra le pagine, dimensione e tempo limitati, il programma si presenta come Toscana Diagnostica.

## Privacy

Si raccolgono solo dati professionali pubblicati dall'azienda sul proprio sito, con la pagina di provenienza. Scartando una struttura
le persone lette si cancellano. Restano da validare con il DPO, prima dell'uso commerciale: base giuridica (legittimo interesse),
informativa agli interessati entro un mese dalla raccolta (art. 14 GDPR), tempi di conservazione dei candidati non promossi.

## Dati e API

Migrazione business `020_scouting.sql`: `scout_ricerche`, `scout_candidati`, `scout_persone`, `accounts.sito_web`. API sotto
`/api/business/scouting` (`routes/scouting.js`). Pagina `web/src/modules/business/pages/Scouting.jsx` (`/business/ricerca-prospect`),
componente `CompletaDalSito.jsx`. Test `server/test/business-scouting.test.mjs`.
