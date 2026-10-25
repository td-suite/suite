# Suite TD · suite.toscanadiagnostica.it

Intranet e Operating Suite di Toscana Diagnostica. Un solo accesso (Microsoft 365 o credenziali locali con TOTP), una sola anagrafica di persone, sedi e organizzazioni, una home a widget che apre i moduli operativi secondo il profilo di ciascun utente, la Community (bacheca, news e circolari con presa visione, avvisi, calendario, meteo, frase del giorno, cartella personale), la ricerca in tutto il patrimonio della Suite con risposta di Claude, il Cockpit direzionale, l'API di ingestione per gli automatismi PowerShell.

Versione 0.2 (fase 1): le dieci app operative sono dentro la Suite come moduli (Room Planning, Integration M&A, Payments, Business, Spedizioni e Kit, Non conformità, Ordini e Magazzino, Cash Management, Retail Assistant, Contratti del personale), ciascuna con il proprio schema PostgreSQL e i dati copiati dall'app originale dal job di travaso. I portali SGI e Service restano per ora collegati via SSO. Architettura e piano: `docs/` e il documento `2026-10-24_SuiteTD_Architettura_v0.1.docx` nella cartella di progetto.

## Moduli e travaso

Ogni modulo ha tre stati, visibili in Amministrazione > Travaso moduli. **OFF**: il widget apre l'app originale via SSO. **MIRROR** (collaudo): la Suite ha una copia completa dei dati dell'app, aggiornata a ogni "Ripeti travaso"; il modulo si apre dentro la Suite in sola lettura (le scritture rispondono 423) e l'operatività resta sull'app originale. **LIVE**: la Suite è l'unica fonte; la copia dall'app originale si disattiva e l'app originale va spenta o ridotta a redirect.

Procedura per ciascun modulo: 1) Sorgenti legacy: connessione impostata e sincronizzata (utenti, sedi, grant). 2) Travaso moduli: "Avvia travaso", poi "Confronta conteggi" (tutte le tabelle allineate; `users` è informativa). 3) Collaudo con i referenti del modulo dentro la Suite, per qualche giorno, ripetendo il travaso quando serve. 4) Fuori orario: "Passa a LIVE" (esegue da solo un ultimo travaso e verifica i conteggi). 5) App originale: impostare il redirect al nuovo indirizzo `https://suite.toscanadiagnostica.it/<modulo>` e comunicare ai fornitori i nuovi indirizzi dei canali macchina (`/api/nc/hl7`, `/api/nc/lis/push`, `/api/orders/integrations/...`), che in MIRROR rispondono 423. "Torna in collaudo" riporta un modulo LIVE a MIRROR.

I collegamenti della home, del Cockpit, della ricerca e di `/go/<modulo>` aprono il modulo dentro la Suite appena è in MIRROR o LIVE. Le variabili d'ambiente delle integrazioni esterne dei moduli (StudioLAB, Silva, corrieri, chiavi di cifratura ereditate) sono elencate e commentate in `server/.env.moduli.example`: su Render si caricano con "Add from .env". Due vanno copiate dalle app originali prima del travaso: `BUSINESS_CREDENTIALS_KEY` (= `CREDENTIALS_KEY` di td-business) e `RETAIL_SESSION_SECRET` (= `SESSION_SECRET` di Retail). La ricetta per portare un'altra app è in `docs/PORTING.md`.

Stack: Node 22, Express, PostgreSQL 16, React 18 + Vite, Docker su Render (Francoforte). Stesse convenzioni delle app TD (td-cash, td-nc, td-orders...).

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

## Checklist go-live (nell'ordine)

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
