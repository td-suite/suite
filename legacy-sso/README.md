# Accesso dalla Suite alle app esistenti (SSO)

La Suite TD apre i moduli legacy con un token firmato (HS256, 90 secondi) invece di chiedere di nuovo le credenziali. Lato app serve un solo file (`suite-sso.js`, nessuna dipendenza) e una rotta `GET /api/auth/suite`. Lo stack delle dieci app è lo stesso (Express, sessione su PostgreSQL, `routes/auth.js` con una funzione `completeLogin`/`finishLogin`), quindi la patch è identica a meno della mappatura profilo → ruolo e di come l'app rappresenta le sedi.

Flusso: l'utente clicca il widget nella Suite → `GET https://suite.toscanadiagnostica.it/go/<modulo>` → la Suite firma il token con il segreto del modulo → redirect a `https://<app>/api/auth/suite?token=...&next=/` → l'app verifica firma, scadenza, `aud` (= chiave del modulo) e `iss` (= indirizzo della Suite), trova o crea l'utente per email, apre la sessione come nel login normale, imposta il cookie `suite_origin=1` e reindirizza a `next` (solo percorsi relativi).

## Patch in tre passaggi

### 1. Copiare il file

`legacy-sso/suite-sso.js` → `server/src/lib/suiteSso.js` dell'app. Esporta `suiteSsoRoute({ secret, audience, issuer, findOrCreateUser, finishLogin, roleFromProfile })` e `verifySuiteToken`.

### 2. Aggiungere la rotta in `server/src/routes/auth.js`

Prima di qualunque `requireAuth` (la rotta è pubblica: la protezione è il token). Esempio generico, da adattare con la mappatura dell'app (sotto):

```js
import { suiteSsoRoute } from '../lib/suiteSso.js';

const SUITE_ROLES = ['ADMIN', 'PLANNER', 'VIEWER'];          // ruoli di questa app
const roleFromProfile = (profile, p) => (SUITE_ROLES.includes(profile) ? profile : p.level === 'OWNER' ? 'ADMIN' : 'VIEWER');

r.get('/suite', suiteSsoRoute({
  secret: process.env.SUITE_SSO_SECRET,
  audience: 'room',                                           // chiave del modulo in Suite
  issuer: process.env.SUITE_URL || 'https://suite.toscanadiagnostica.it',
  roleFromProfile,
  async findOrCreateUser(p) {
    let u = await one('SELECT * FROM users WHERE lower(email)=$1', [p.email]);
    if (u && !u.active) return null;                          // disattivato qui: la Suite non riapre l'accesso
    if (!u) {
      u = await one(`INSERT INTO users (email, full_name, role, auth_provider, must_change_password) VALUES ($1,$2,$3,'ENTRA',FALSE) RETURNING *`, [p.email, p.name || p.email, p.role]);
    } else if (u.role !== p.role && p.profile) {
      // il profilo in Suite è la fonte dei permessi: allinea il ruolo locale
      u = await one('UPDATE users SET role=$2, updated_at=now() WHERE id=$1 RETURNING *', [u.id, p.role]);
    }
    return u;
  },
  async finishLogin(req, user, p) { await completeLogin(req, user, 'SUITE'); },   // la funzione che il login locale/Entra già usa
}));
```

Note:
- `completeLogin`/`finishLogin` dell'app rigenera la sessione, salva `userId`, aggiorna `last_login_at` e scrive l'audit: usarla così com'è, con metodo `'SUITE'`. Se la funzione controlla il metodo (`LOCAL` → obbligo cambio password o TOTP), `'SUITE'` è un metodo già verificato a monte (la Suite ha fatto autenticare l'utente, con TOTP se richiesto): non va chiesto un secondo fattore.
- Se l'app impone `must_change_password` agli utenti locali, con metodo `'SUITE'` quell'obbligo non deve scattare (vedi `onboardingState` in Room Planning: controlla `authMethod === 'LOCAL'`).
- Ambiti di sede: il token porta `scopes` (`SITE:<id Suite>`) e `site_codes` (`<codice Suite>|<id in questa app>` quando la Suite conosce il riferimento legacy, altrimenti solo il codice). Per le app con tabella di collegamento utente ↔ sedi (`users_sedi`, `user_sites`, `user_strutture`) la callback può allinearla; nelle prime settimane conviene lasciare la gestione sedi nell'app e usare il token solo per l'identità.
- Il token è monouso (`jti`) e la rotta rifiuta `next` assoluti o verso altri host.

### 3. Variabile d'ambiente su Render

Nel pannello Render del servizio: `SUITE_SSO_SECRET` = segreto di almeno 32 caratteri casuali (es. `openssl rand -base64 48`), **lo stesso** impostato nella Suite per quel modulo (`PUT /api/modules/<key> { sso_secret }` dal titolare, oppure `SSO_SECRET_<KEY>` nell'ambiente della Suite). Un segreto diverso per ogni app. Facoltativo: `SUITE_URL` se la Suite non sta su `https://suite.toscanadiagnostica.it`. Riavviare il servizio.

Verifica: dalla Suite, aprire il widget; in caso di errore la pagina di login dell'app mostra il motivo (`/login?error=...`). Senza `SUITE_SSO_SECRET` la rotta risponde "Accesso dalla Suite non configurato" e la Suite, se non ha un segreto per quel modulo, apre semplicemente l'app senza token.

## Mappatura profilo Suite → ruolo dell'app

I profili dei moduli in Suite (`server/src/seed/modules.js`) coincidono con i ruoli delle tabelle `users` delle app: la mappatura è l'identità, con due regole comuni:
- profilo sconosciuto o assente (amministratore della Suite senza grant sul modulo): `OWNER` → ruolo amministrativo dell'app, altrimenti ruolo di sola lettura;
- vincoli dell'app (sede o società obbligatoria per certi ruoli) da rispettare in `findOrCreateUser`, altrimenti negare (`return null`).

| App (modulo) | Profili Suite = ruoli app | Regole particolari |
|---|---|---|
| Business `business` | ADMIN, SERVICE, RETAIL, MDL, HQS, VIEWER | OWNER senza grant → ADMIN; altri → VIEWER |
| Finance `finance` | CEO, CFO, SUPPORT, VIEWER | indice univoco: un solo CEO e un solo CFO attivi. Se il ruolo è già occupato da un altro utente → SUPPORT con `is_admin=false`. `is_admin` = `level` OWNER/ADMIN |
| Integration `integration` | ADMIN, EDITOR, VIEWER | `status` deve essere ACTIVE; nuovo utente creato ACTIVE con `organization='Toscana Diagnostica'` se dominio aziendale |
| Cash Management `cash` | SUPERADMIN, ADMIN, CASSIERE, FINANCE, OPERATOR, PARTNER | `company_id` obbligatorio per i ruoli diversi da SUPERADMIN: dall'ambito ORG del token (`org_codes`) o dalla società capogruppo (`companies.code='TDS'` o `is_franchisor`); CASSIERE/OPERATOR/PARTNER → allineare `user_sites` dai `site_codes` |
| Orders `orders` | SUPERADMIN, PROCUREMENT, CLIENTE, SEDE, LAB | `struttura_id` obbligatorio per CLIENTE/SEDE/LAB: prima voce di `site_codes` (parte dopo `|`), altrimenti negare. OWNER senza grant → SUPERADMIN; `auth_provider` nuovi utenti: ENTRA |
| Shipments `shipments` | SUPERADMIN, ADMIN, ENDEAVOR, VIEWER | OWNER senza grant → SUPERADMIN; `lang` dal profilo Suite (`it`) |
| Room Planning `room` | ADMIN, PLANNER, RESP_SAN, PROF, VIEWER | PLANNER/VIEWER con ambiti → `user_strutture` dai `site_codes` (id testuali); PROF resta confinato al portale (controllo già in `index.js`) |
| Non conformità `nc` | ADMIN, QUALITA, LAB, SEDE, VIEWER | `status` ACTIVE; SEDE → `users_sedi` dai `site_codes`; nuovo utente con `auth_provider='ENTRA'` se dominio aziendale, altrimenti LOCAL senza password (entra solo via Suite) |
| Contracts (People) `contracts` | ADMIN, HR, VIEWER | modulo riservato: **non** creare utenti nuovi via SSO; accettare solo email già censite (`return null` altrimenti). L'Owner è ADMIN |
| Retail Assistant `retail` | ADMIN, RETAIL, SEDE, VIEWER | SEDE → `site_id` dalla prima voce di `site_codes` (`sites.code` coincide con il codice Suite) |

I portali pubblici (SGI, Service) non hanno SSO: la Suite li apre direttamente.

## Barra "Suite TD · Home" nelle app

Frammento da inserire in `web/index.html` di ogni app, subito dopo `<body>`. Compare solo se è presente il cookie `suite_origin=1` impostato dalla rotta SSO (chi entra dall'app con le proprie credenziali non la vede). Nessuna dipendenza, nessuno stile esterno.

```html
<div id="suite-bar" hidden style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:10px;height:28px;padding:0 14px;background:#01212C;color:#fff;font:600 12px/1 'Segoe UI',Arial,sans-serif;letter-spacing:.2px">
  <a href="https://suite.toscanadiagnostica.it" style="color:#71B1BD;text-decoration:none;display:inline-flex;align-items:center;gap:6px">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>
    Suite TD · Home
  </a>
  <span style="opacity:.55">·</span>
  <span style="opacity:.8;font-weight:500">sei entrato dalla Suite</span>
  <button type="button" onclick="document.cookie='suite_origin=; Max-Age=0; path=/';this.parentNode.hidden=true" title="Nascondi" style="margin-left:auto;background:none;border:0;color:#9fc5cd;cursor:pointer;font-size:14px;line-height:1">×</button>
</div>
<script>
  (function () { if (/(^|;\s*)suite_origin=1(;|$)/.test(document.cookie)) { var b = document.getElementById('suite-bar'); if (b) b.hidden = false; } })();
</script>
```

Se l'app usa una Content Security Policy con `script-src 'self'` senza `'unsafe-inline'` (è il caso delle app TD con Helmet), spostare lo script in `web/public/suite-bar.js` e includerlo con `<script src="/suite-bar.js"></script>`; il gestore `onclick` va sostituito con un `addEventListener` nello stesso file (vedi la patch per Room Planning).
