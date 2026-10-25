# Patch SSO per Room Planning (prima app in produzione)

File pronti da copiare nel repository `room` (stessi percorsi):

| File in questa cartella | Destinazione nel repo room | Cosa cambia |
|---|---|---|
| `server/src/lib/suiteSso.js` | `server/src/lib/suiteSso.js` | nuovo: verifica del token HS256 della Suite e handler Express (solo `node:crypto`) |
| `server/src/routes/auth.js` | `server/src/routes/auth.js` | file completo con la nuova rotta `GET /api/auth/suite` (vedi diff sotto); il resto è identico all'originale |
| `web/index.html` | `web/index.html` | barra "Suite TD · Home" sopra `#root`, nascosta di default |
| `web/public/suite-bar.js` | `web/public/suite-bar.js` | nuovo: mostra la barra se c'è il cookie `suite_origin=1`, gestisce il pulsante di chiusura |

Poi su Render (servizio `td-room`): variabile `SUITE_SSO_SECRET` con lo stesso segreto impostato nella Suite per il modulo `room` (titolare: `PUT /api/modules/room { "sso_secret": "..." }`, oppure `SSO_SECRET_ROOM` nell'ambiente della Suite). Facoltativa `SUITE_URL` (predefinito `https://suite.toscanadiagnostica.it`). Riavvio del servizio.

## Diff di `server/src/routes/auth.js` spiegato

1. Import del nuovo modulo:
   ```js
   import { suiteSsoRoute } from '../lib/suiteSso.js';
   ```
2. Subito dopo `const r = Router(); authenticator.options = ...` e prima di `r.get('/config', ...)`: la rotta `r.get('/suite', suiteSsoRoute({...}))`. È pubblica, come `/login` ed `/entra/callback`: la protezione è il token (firma HMAC con il segreto condiviso, scadenza 90 secondi, `aud` = `room`, `iss` = indirizzo della Suite, `jti` monouso).
   - `roleFromProfile`: i profili del modulo Room in Suite (ADMIN, PLANNER, RESP_SAN, PROF, VIEWER) sono gli stessi ruoli di `users.role`. Un amministratore della Suite senza grant arriva con profilo `ADMIN`; se è il titolare (`level=OWNER`) diventa ADMIN, altrimenti VIEWER.
   - `findOrCreateUser`: cerca l'utente per email (case-insensitive). Se è disattivato in Room Planning nega l'accesso (la Suite non riapre account chiusi qui). Se non esiste lo crea con `auth_provider='ENTRA'` e `must_change_password=FALSE`, come fa già l'auto-registrazione Entra, con audit `USER_AUTOPROVISION` (via SUITE). Se esiste con un ruolo diverso da quello della Suite lo allinea (audit `USER_ROLE_FROM_SUITE`), tranne gli ADMIN locali che restano tali a meno che il chiamante sia il titolare. Se il token porta ambiti di sede (`site_codes` nel formato `FI-CAL|cal01`, dove `cal01` è l'id della struttura in Room Planning conosciuto dalla Suite tramite `sites.legacy_refs.room`), per PLANNER e VIEWER riallinea `user_strutture` alle sole strutture esistenti e non eliminate; senza ambiti non tocca nulla (vuoto = tutte le sedi, come oggi).
   - `finishLogin`: richiama la `completeLogin(req, user, 'SUITE')` già presente nel file (rigenera la sessione contro il session fixation, salva `userId` e `authMethod`, aggiorna `last_login_at`, audit `LOGIN` con `method: 'SUITE'`).
3. Nessuna modifica a `lib/access.js`: `onboardingState` impone cambio password e TOTP solo quando `authMethod === 'LOCAL'`, quindi con `'SUITE'` l'utente entra direttamente (il secondo fattore lo ha già superato nella Suite, dove è obbligatorio per gli amministratori). I professionisti (`PROF`) restano confinati al portale dal middleware in `index.js`.

## Perché la barra usa un file esterno

`index.js` applica Helmet con `script-src 'self'`: uno script inline o un `onclick` verrebbero bloccati. Per questo la logica sta in `web/public/suite-bar.js` (Vite copia `public/` così com'è nella build). La barra è `hidden` nel markup e compare solo se il cookie `suite_origin=1` è presente: chi entra con le proprie credenziali in Room Planning non la vede. Il pulsante × cancella il cookie e nasconde la barra fino al prossimo accesso dalla Suite.

## Collaudo

1. In Suite, assegnare a un utente il modulo Room con profilo PLANNER e due sedi (ambiti). Verificare che le sedi abbiano `legacy_refs.room` valorizzato (sincronizzazione legacy eseguita).
2. Dalla Suite aprire il widget Room Planning: l'utente deve ritrovarsi dentro Room Planning, con la barra in alto, con ruolo Pianificatore e le due sedi assegnate in Utenti.
3. Riaprire lo stesso link `/api/auth/suite?token=...` dalla cronologia: deve rispondere "Accesso dalla Suite già utilizzato" (token monouso) e, dopo 90 secondi, "Token scaduto".
4. Cambiare `SUITE_SSO_SECRET` su Render con un valore diverso da quello della Suite: l'accesso deve fallire con "Firma non valida", senza effetti sugli utenti.
5. `npm test` del repo room (test end-to-end con server avviato) deve restare verde: la patch non tocca rotte esistenti.
