# Suite TD · suite.toscanadiagnostica.it

Intranet e Operating Suite di Toscana Diagnostica. Un solo accesso (Microsoft 365 o credenziali locali con TOTP), una sola anagrafica di persone, sedi e organizzazioni, una home a widget che apre i moduli operativi secondo il profilo di ciascun utente, la Community (bacheca, news e circolari con presa visione, avvisi, calendario, meteo, frase del giorno, cartella personale), la ricerca in tutto il patrimonio della Suite con risposta di Claude, il Cockpit direzionale, l'API di ingestione per gli automatismi PowerShell.

Versione 0.4 (anagrafica unica): sedi, organizzazioni, persone e utenti esistono una volta sola, in Amministrazione, e tutti i moduli vi puntano. La Suite parte vuota e si popola con quattro modelli XLSX (Amministrazione > Importazioni): Sedi, Organizzazioni e clienti, Persone, Utenti con moduli e profili. Nessuna copia delle anagrafiche dalle app precedenti, nessuna riconciliazione. Le dieci app operative sono dentro la Suite come moduli (Room Planning, Integration M&A, Payments, Business, Spedizioni e Kit, Non conformità, Ordini e Magazzino, Cash Management, Retail Assistant, Contratti del personale), ciascuna con il proprio schema PostgreSQL e i dati copiati dall'app originale dal job di travaso. I portali SGI e Service restano per ora collegati via SSO. Architettura e piano: `docs/` e il documento `2026-10-24_SuiteTD_Architettura_v0.1.docx` nella cartella di progetto.

## Anagrafica unica e avvio dei moduli

Regola (decisione del 25/10/2026): un modulo non ha anagrafiche proprie. Sedi (`sites`), organizzazioni e clienti (`organizations`), persone (`people`) e utenti (`users`) vivono nello schema `public` e si gestiscono da Amministrazione; ogni modulo tiene solo tabelle di estensione (`site_ext`, `org_ext`, `person_ext`) con i campi operativi suoi, agganciate con chiave esterna all'anagrafica. Dentro i moduli le pagine Sedi, Strutture, Aziende, Professionisti, Organizzazioni sono elenchi dell'anagrafica con le impostazioni del modulo: nessuna creazione o rinomina (pulsante "Apri in Amministrazione"). Contratti del personale è il modulo HR: crea e modifica persone sull'anagrafica unica, con audit. Ogni utente è una persona: l'accesso nasce da solo quando la persona è ATTIVA e ha un'email (Microsoft 365 per i domini aziendali, credenziali locali con invito per gli altri), i moduli li assegna un amministratore partendo dalle proposte dell'area organizzativa. Ricetta per i moduli in `docs/ANAGRAFICA.md`.

Avvio di una Suite vuota, nell'ordine: 1) Amministrazione > Importazioni: scarica i modelli, compila, carica (Organizzazioni e clienti, poi Sedi, poi Persone, poi Utenti con moduli e profili; le righe scartate si correggono e si ricaricano, le altre non si duplicano). 2) Amministrazione > Travaso moduli: "Avvia il modulo" su Cash, Room, NC, Ordini, Retail, Contratti, Business, Integration (partono vuoti e LIVE). 3) Payments e Spedizioni (indipendenti dall'anagrafica) seguono il travaso classico dall'app di origine: Sorgenti legacy > connessione, Travaso > Avvia, Confronta conteggi, Passa a LIVE. 4) Foto delle sedi (fino a 3) da Amministrazione > Sedi, con Azure Blob configurato. Il titolare può azzerare tutto da Importazioni ("Azzera la Suite": restano titolare, impostazioni, credenziali, catalogo dei moduli e frasi del giorno).

Variabili d'ambiente delle integrazioni esterne dei moduli: `server/.env.moduli.example` (su Render "Add from .env"); `BUSINESS_CREDENTIALS_KEY` e `RETAIL_SESSION_SECRET` restano necessarie. Dopo il LIVE di un modulo, l'app originale va reindirizzata a `https://suite.toscanadiagnostica.it/<modulo>` e i fornitori informati dei nuovi indirizzi dei canali macchina (`/api/nc/hl7`, `/api/nc/lis/push`, `/api/orders/integrations/...`).

## Struttura del repository

```
server/            API, autenticazione, sincronizzazione legacy, travaso, ingestione, lavori di sfondo
  src/migrations   schema core (001_core, 002_community, 003_modules)
  src/modules      un modulo per app travasata: migrations/ dell'app, lib/, routes/, index.js (mount, mountPublic per i canali macchina)
  src/seed         catalogo dei moduli e dei profili
  src/lib          access, audience, entra, sso, mailer, blob, claude, weather, legacy, search, community
  src/routes       auth, users, core, sso, community, files, search, legacy, travaso, ingest
web/               interfaccia React (PWA); web/src/modules/<key>/ = interfaccia di ciascun modulo (meta.js + index.jsx, CSS isolato sotto .mod-<key>)
powershell/        modulo TD.Suite per gli automatismi dai server di origine
legacy-sso/        patch per le app esistenti (accettano il token della Suite) + patch pronta per Room Planning
docs/              API.md (contratto), screens/ (schermate di collaudo)
```

## Checklist go-live (nell'ordine, fatta il 24-25/10/2026)

1. GitHub: repository `suite` nell'organizzazione, push di questo contenuto sul ramo `main`.
2. Render: New > Blueprint > repository `suite`. Il blueprint crea il servizio web `td-suite` e il database `td-suite-db` (piano standard, Francoforte). Primo build 5-8 minuti.
3. Entra ID: app registration "Suite TD" (single tenant). Redirect URI web `https://suite.toscanadiagnostica.it/api/auth/entra/callback` e, per la prova prima del DNS, `https://td-suite.onrender.com/api/auth/entra/callback`. ID token abilitato. Permessi applicativi Microsoft Graph: `Mail.Send` (casella suite@, con Application Access Policy che limita l'app a quella casella) e, in seguito, `Calendars.Read`. Consenso amministratore.
4. Azure: storage account nel tenant (West Europe, LRS o ZRS, accesso pubblico disattivato), container `suite`. Copiare la connection string.
5. Render > td-suite > Environment: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `SEED_OWNER_PASSWORD` (facoltativa, minimo 12 caratteri). La chiave Anthropic e la stringa Azure si impostano dalla Suite: Amministrazione > Impostazioni > Integrazioni (solo titolare); come variabili d'ambiente restano possibili e hanno la precedenza. `BASE_URL` resta `https://suite.toscanadiagnostica.it`; finché il DNS non è attivo impostare temporaneamente `https://td-suite.onrender.com`.
6. Database legacy (sola lettura): in Amministrazione > Sorgenti legacy, su ogni card, il titolare preme "Imposta connessione" e incolla la External Database URL del database Render dell'app; la Suite la prova, la salva cifrata (AES-256-GCM con `CREDENTIALS_KEY`) e importa utenti, persone, sedi, organizzazioni creando i grant corrispondenti ai ruoli attuali. In alternativa le variabili `LEGACY_<MODULO>_DATABASE_URL` su Render. Verificare in Riconciliazione.
7. DNS: CNAME `suite` → `td-suite.onrender.com`; su Render aggiungere il Custom Domain `suite.toscanadiagnostica.it` e attendere il certificato.
8. Primo accesso del titolare con Microsoft 365 (francesco.epifani@toscanadiagnostica.it è OWNER dal seed). Attivare il TOTP dal profilo.
9. SSO verso le app: copiare `SSO_SECRET` (generato da Render) nella variabile `SUITE_SSO_SECRET` di ogni app e applicare la patch `legacy-sso/` (Room Planning per prima: `legacy-sso/patch-room/`). Senza patch il widget apre comunque l'app, che chiede le proprie credenziali.
10. Utenti: in Amministrazione > Utenti confermare le proposte di grant importate dall'organigramma di Contracts, creare gli esterni (sedi ospitanti, clienti service) con credenziali locali. Il modulo Contratti del personale è assegnabile solo dal titolare.
11. Casella suite@toscanadiagnostica.it: verificare un invio (nuovo utente locale: riceve l'invito con password provvisoria). Con `MAIL_PROVIDER=log` le email vengono solo registrate.
12. Dopo il go-live: rigenerare il client secret di Entra e aggiornarlo su Render; portare `numInstances` a 2.

## Variabili d'ambiente

Vedi `render.yaml` (commentato), `server/.env.example` (Suite) e `server/.env.moduli.example` (integrazioni dei moduli). Nessun segreto nel repository.

## Sviluppo in locale

```
cd server && npm install && cd ../web && npm install
# PostgreSQL locale: createdb suite
cd web && npm run build
cd ../server && DATABASE_URL=postgres://postgres@localhost:5432/suite SEED_OWNER_PASSWORD=Password-Provvisoria-123 npm start
# oppure: docker compose up --build
```
Interfaccia in sviluppo: `cd web && npm run dev` (proxy su :3000).

## Sicurezza e privacy

Sessioni httpOnly su PostgreSQL, header anti CSRF, rate limit sui login, blocco dopo 5 tentativi, TOTP, password minimo 12 caratteri, Helmet con CSP. Audit di ogni scrittura e registro di lettura sulle schede persona. Il modulo Contratti del personale è "riservato": vincolo lato server, non convenzione. I dati dei pazienti non entrano nell'indice di ricerca e non vengono mai passati a Claude; a Claude arrivano solo risultati non sensibili già filtrati per i permessi dell'utente. Nessun file nel database: tutto su Azure Blob nel tenant Microsoft. La Suite legge i database delle app esistenti in sola lettura (sessione read only, solo SELECT).
