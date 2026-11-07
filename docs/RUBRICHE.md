# Rubriche esterne: Outlook di Francesco e Gmail fraepi@gmail.com (07/11/2026)

Richiesta del CEO del 07/11/2026: "vorrei aggiungere due collegamenti: il primo alla mia rubrica telefonica su gmail
(fraepi@gmail.com) da poter scorrere quando inseriamo i contatti dei referenti delle legal entity. In ogni caso, a completo supporto
della suite. Il secondo, sempre a completo supporto della suite, e assolutamente necessario quando salviamo la mail dei referenti nel
Business Hub la rubrica di contatti mail di Outlook Microsoft 365 di francesco.epifani@toscanadiagnostica.it."

## Cosa fa
- **Cerca in rubrica** (`web/src/components/CercaRubrica.jsx`): un campo di ricerca che interroga insieme
  - **Suite**: persone dell'anagrafica unica e referenti già presenti negli account del Business Hub (per non creare doppioni);
  - **Outlook**: contatti della casella impostata (predefinita francesco.epifani@toscanadiagnostica.it), cartella Contatti e
    sue sottocartelle (fino a 10);
  - **Gmail**: rubrica Google dell'account impostato (predefinito fraepi@gmail.com).
  I risultati sono raggruppati per fonte (al massimo 15 per fonte); il clic compila i campi del form (nome, cognome, email,
  telefono, cellulare, azienda/ruolo), che restano modificabili prima del salvataggio. Se una fonte non risponde entro 8 secondi o
  dà errore, le altre si vedono comunque e sotto la fonte compare il motivo.
- **Trovato in Outlook**: quando l'email di un referente si scrive a mano e coincide con un contatto Outlook (o Gmail), sotto il
  campo compare "Trovato in Outlook: nome · azienda · telefono" con "Completa i campi".
- Dove si usa:
  1. Business Hub > scheda Referenti > "+ Referente" e modifica (il referente nuovo ricorda la provenienza: "da Outlook", "da Gmail");
  2. Business Hub > "Registra contatto" > Con chi: se il referente non è in elenco, "Cercalo in rubrica e crealo" apre i campi
     precompilati e "Crea il referente e usalo" lo aggiunge all'account e lo seleziona;
  3. Amministrazione > Persone > Nuova persona / Modifica (Cognome, Nome, Email, Cellulare, Telefono ufficio e Legal entity se
     l'azienda del contatto ha lo stesso nome di una Legal entity);
  4. Amministrazione > Legal entity > Accessi > Crea accesso esterno (Cognome, Nome, Email, Ruolo, Telefono ufficio).
  Mai nelle pagine pubbliche (form B2B, portali).

## Regole di accesso (decisione)
- Ricerca e "trovato in Outlook": **personale interno con il Business Hub (qualunque profilo) e amministratori della Suite**. Gli
  esterni (clienti service, partner) ricevono 403 anche se avessero il widget. Motivo: le rubriche servono a inserire i referenti,
  attività del Business Hub e dell'Amministrazione.
- La rubrica Gmail è disponibile a tutti questi utenti, come proposto nel brief: il consenso è personale di Francesco, ma i dati
  servono al lavoro di chi inserisce i referenti.
- Collegamento e scollegamento dell'account Google, prova delle rubriche e impostazioni: **amministratori (Owner/Admin)**. Il
  consenso si accetta solo se l'account Google che lo dà è quello impostato (predefinito fraepi@gmail.com): con un altro account non
  si salva nulla e il consenso appena dato viene revocato.

## Privacy
- Nessuna copia in massa: la Suite non sincronizza né archivia le rubriche. Si salva solo il contatto scelto, dal form, come
  qualunque referente o persona inserita a mano.
- Cache in memoria di 60 secondi per query (stessa ricerca ripetuta), poi si interroga di nuovo; gli errori non vanno in cache.
- Log: nessuna email in chiaro (le email nei messaggi d'errore e nell'audit sono mascherate: `m***@dominio.it`).
- Audit `RUBRICA_CERCA` per ogni ricerca che interroga davvero una rubrica esterna (non per le risposte dalla cache): query
  compattata, con le email mascherate e troncata a 40 caratteri, numero di risultati per fonte, fonti in errore. Altri eventi:
  `RUBRICA_IMPOSTAZIONI`, `RUBRICA_GOOGLE_COLLEGATA`, `RUBRICA_GOOGLE_RIFIUTATA` (account diverso), `RUBRICA_GOOGLE_SCOLLEGATA`.
- Il refresh token Google è cifrato (AES-256-GCM con la CREDENTIALS_KEY esistente, `lib/secrets.js`) nella riga
  `app_settings.secret:rubriche_google`, esclusa dall'editor generico delle Impostazioni; mai nei log.

## Cosa deve fare Francesco
### 1. Outlook: permesso Microsoft Graph Contacts.Read
1. Portale Azure (entra.microsoft.com) > Applicazioni > Registrazioni app > **Suite TD** (la stessa delle caselle).
2. Autorizzazioni API > Aggiungi un'autorizzazione > Microsoft Graph > **Autorizzazioni applicazione** > `Contacts.Read` > Aggiungi.
3. **Concedi il consenso amministratore** per Toscana Diagnostica (la colonna Stato diventa verde).
4. Se c'è una **Application Access Policy** di Exchange che limita le caselle leggibili dall'app (quella usata per service@,
   network@, template@, people@...), aggiungi francesco.epifani@ al gruppo di sicurezza della policy, in Exchange Online PowerShell:
   ```powershell
   Connect-ExchangeOnline
   # gruppo già usato nella policy (nome di esempio: "Suite TD caselle"): basta aggiungere il membro
   Add-DistributionGroupMember -Identity "Suite TD caselle" -Member francesco.epifani@toscanadiagnostica.it
   # verifica: deve rispondere AccessCheckResult = Granted
   Test-ApplicationAccessPolicy -Identity francesco.epifani@toscanadiagnostica.it -AppId <ENTRA_CLIENT_ID>
   ```
   L'Application Access Policy vale anche per i contatti (non solo per la posta). La propagazione può richiedere fino a 30 minuti.
5. Suite > Amministrazione > Impostazioni > **Rubriche esterne** > "Prova la rubrica Outlook": i passaggi dicono cosa manca
   (credenziali, permesso Contacts.Read, casella, lettura dei contatti).

### 2. Gmail: progetto Google Cloud (una volta)
1. Apri <https://console.cloud.google.com/> con l'account fraepi@gmail.com (o un account aziendale: il progetto può essere di
   chiunque, conta l'account che darà il consenso).
2. In alto, selettore dei progetti > **Nuovo progetto** > nome "Suite TD Rubrica" > Crea; selezionalo.
3. Menu > API e servizi > **Libreria** > cerca **People API** > **Abilita**.
4. Menu > API e servizi > **Schermata di consenso OAuth** (in alcune console: "Google Auth Platform" > Branding/Pubblico):
   - Tipo utente **Esterno** > Crea;
   - Nome app "Suite TD", email di assistenza e del contatto sviluppatore: la tua;
   - Ambiti (Data access): aggiungi `.../auth/contacts.readonly` (Visualizzare i contatti), `openid` e `.../auth/userinfo.email`;
   - **Utenti di test**: aggiungi `fraepi@gmail.com`.
   - Stato di pubblicazione: con l'app **in test** Google fa scadere il consenso dopo 7 giorni (la Suite lo segnala: "Il consenso
     Google non è più valido... ricollega"). Per non doverlo rinnovare, "Pubblica l'app" (In produzione): per un uso personale con
     un solo utente compare l'avviso "app non verificata", che si supera con "Avanzate > Vai a Suite TD"; la verifica di Google
     non è necessaria finché gli utenti sono meno di 100.
5. Menu > API e servizi > **Credenziali** > Crea credenziali > **ID client OAuth** > Tipo di applicazione **Applicazione web** >
   nome "Suite TD" > **URI di reindirizzamento autorizzati**:
   `https://suite.toscanadiagnostica.it/api/rubriche/google/callback` > Crea.
   (L'URI esatto da copiare è mostrato anche in Impostazioni > Rubriche esterne, ricavato da BASE_URL.)
6. Copia **ID client** e **Segreto client** e su Render (servizio td-suite > Environment) imposta `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET` (nel Blueprint sono `sync: false`: non finiscono nel repository). Salva: Render riavvia il servizio.
7. Suite > Amministrazione > Impostazioni > Rubriche esterne > **Collega l'account Google** > accedi con fraepi@gmail.com >
   consenti "Visualizzare i tuoi contatti". Torni alla Suite con "Account Google collegato". "Prova la rubrica Gmail" conferma il
   numero di contatti leggibili.
8. Per scollegare: "Scollega" (revoca il consenso presso Google e cancella il token) oppure da
   <https://myaccount.google.com/permissions>.

## Variabili d'ambiente
| Variabile | Dove | Note |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Render, `sync: false` | ID client OAuth "Applicazione web" |
| `GOOGLE_CLIENT_SECRET` | Render, `sync: false` | segreto del client OAuth |
| `GOOGLE_REDIRECT_URI` | facoltativa | predefinita `${BASE_URL}/api/rubriche/google/callback` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` (o `GRAPH_*`) | già presenti | stessa app registration delle caselle |
| `RUBRICHE_MOCK=1` | solo sviluppo | contatti finti dichiarati come tali (dominio `.example`); ignorata con `NODE_ENV=production` |

Impostazioni (Amministrazione > Impostazioni > Rubriche esterne, chiave `app_settings.rubriche`): casella Outlook da leggere
(`outlook_casella`) e account Google ammesso al consenso (`google_account`).

## Tecnica
- `server/src/lib/rubriche.js`: normalizzazione pura Outlook/Google → formato comune `{ id, fonte, nome, nome_proprio, cognome,
  email[], telefoni[{tipo,numero}], azienda, ruolo }`; orchestratore `cercaInFonti` (fonti in parallelo, timeout 8 s per fonte,
  errore per fonte, cache 60 s, massimo 15); Outlook con `$filter` startswith su nome, cognome, nome visualizzato, azienda e email
  esatta (`/users/{casella}/contacts` e `/contactFolders/{id}/contacts`; se il servizio rifiuta il filtro si filtra qui un blocco
  di 500 contatti, senza salvarlo); Google con `people:searchContacts` (richiesta di riscaldamento a vuoto ogni 30 minuti, come
  chiede Google) e token di accesso dal refresh token; prove passo per passo come `provaCasella`.
- `server/src/routes/rubriche.js`, montata su `/api/rubriche` dopo l'autenticazione:
  - `GET /stato` → `{ outlook: { configurata, casella, errore? }, google: { configurata, account, consenso_at, errore? } }`
  - `GET /cerca?q=…` (min 2 caratteri; `suite=0` esclude la fonte Suite) → `{ suite, outlook, google, errori, conteggi }`
  - `GET /email?indirizzo=…` → `{ trovato }`
  - `PUT /impostazioni`, `POST /outlook/prova`, `POST /google/prova`, `GET /google/avvia`, `GET /google/callback`,
    `POST /google/revoca` (amministratori). Lo `state` OAuth è casuale, legato alla sessione e all'utente, valido 10 minuti.
- Business Hub: `contatti.fonte` accetta anche `RUBRICA_OUTLOOK` e `RUBRICA_GMAIL` (solo alla creazione; in modifica non cambia).
- Nessuna dipendenza npm nuova: Graph e Google si chiamano con `fetch`.

## Test e collaudo
- `server/test/rubriche.test.mjs`: normalizzazione, maschere, filtro OData, deduplica, ricerca con fonti finte (errore, timeout,
  cache, massimo 15); con `DATABASE_URL_TEST`: stato "non configurata" con motivo, prove fallite con motivo, avvio del consenso
  senza credenziali, callback senza avvio rifiutato, 403 agli esterni, impostazioni; ricerca con `RUBRICHE_MOCK=1` e audit senza
  email in chiaro.
- Collaudo del 07/11/2026 su database proprio (porta 3150, `RUBRICHE_MOCK=1`): ricerca dal form Referenti, compilazione,
  salvataggio con provenienza "da Outlook"; schermate `docs/screens/rubriche-cerca.png` e `docs/screens/rubriche-impostazioni.png`.

## Da verificare in produzione
- Prova della rubrica Outlook dopo Contacts.Read e l'Application Access Policy.
- Prova della rubrica Gmail dopo il progetto Google Cloud e il consenso; tempi di risposta di `searchContacts` sulla rubrica reale.
- Se in Outlook i contatti sono in cartelle condivise o in una rubrica dell'organizzazione (GAL) anziché nei Contatti della casella:
  la GAL richiede User.Read.All e un'altra ricerca, da decidere.
