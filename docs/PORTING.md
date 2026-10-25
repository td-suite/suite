# Travaso di un'app esistente nella Suite · ricetta

Ogni app TD esistente (Node/Express/PostgreSQL + React/Vite) diventa un modulo della Suite in due parti: `server/src/modules/<key>/` e `web/src/modules/<key>/`. Chiave = nome del modulo in `server/src/seed/modules.js` (room, cash, orders, shipments, nc, retail, business, finance, integration, contracts). I dati vivono nello schema PostgreSQL `<key>` del database della Suite, copiati dall'app originale dal job di travaso (`lib/travaso.js`, Amministrazione > Travaso moduli). L'autenticazione, gli utenti, i profili e le sedi sono quelli della Suite.

## Principi
1. Il codice dell'app resta il più possibile identico: si cambiano solo accesso, utenti e montaggio. Niente restyling, niente rinomini di tabelle.
2. Nessuna scrittura sui database delle app originali. Nessuna modifica fuori dalle due cartelle del modulo (eccezione: nessuna; registri e router si scoprono da soli).
3. Tutto il testo in italiano, senza trattini lunghi. Dipendenze: controllare `server/package.json` (oggi: express, pg, zod, multer, exceljs, pdfkit, docxtemplater, pizzip, yauzl, bwip-js, qrcode, otplib, jose, bcryptjs, nodemailer, @anthropic-ai/sdk, @azure/storage-blob) e `web/package.json` (react, react-router-dom, recharts, jspdf, jspdf-autotable, pdfjs-dist, xlsx). Un pacchetto assente si aggiunge con `npm install <pkg>` nella cartella giusta e si segnala nel report. Non servono: express-session, connect-pg-simple, helmet, express-rate-limit, openid-client (li ha la Suite).

## Server: `server/src/modules/<key>/`
```
migrations/   gli SQL dell'app originale, copiati così come sono (girano con search_path = <key>, public)
lib/          le lib dell'app (copiate), con gli import adattati
routes/       le route dell'app (copiate), senza auth/users/admin-utenti
index.js      export default function mount(app)
db.js         export { q, one, many, tx, pool } = moduleDb('<key>')  (sostituisce il db.js dell'app)
config.js     la config dell'app, letta da process.env con le stesse chiavi; BASE_URL della Suite + '/<key>'
```
`index.js` modello:
```js
import { Router } from 'express';
import { requireAuth } from '../../lib/access.js';
import { requireModuleReady, blockWritesInMirror, getModuleState } from '../../lib/modules.js';
import { registerJob } from '../../lib/jobs.js';
import struttureRoutes from './routes/strutture.js';   // le route dell'app
const KEY = 'room';
export default function mount(app) {
  const r = Router();
  r.use(requireAuth, requireModuleReady(KEY, { roleColumn: 'role' }));
  // l'app ragiona con il "suo" utente: la riga della sua tabella users (nello schema del modulo) con il ruolo = profilo del grant Suite
  r.use((req, _res, next) => { req.suiteUser = req.user; req.user = req.moduleUser; next(); });
  r.get('/state', async (req, res) => { const st = await getModuleState(KEY); res.json({ mode: st.mode, last_copy_at: st.last_copy_at, user: publicUser(req.user) }); });
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), authMethod: 'SUITE' }));   // stessa forma che l'app si aspetta
  r.use(blockWritesInMirror);
  r.use(struttureRoutes); /* ... */
  app.use(`/api/${KEY}`, r);
  registerJob(`${KEY}:nome-job`, 5, async () => { /* solo se il modulo è LIVE: const st = await getModuleState(KEY); if (st.mode !== 'LIVE') return { skipped: true }; */ });
}
```
Regole:
- `req.user` dentro il modulo ha: tutte le colonne della tabella `users` dell'app + `role` (profilo Suite) + `suite_user_id` + `legacy_site_ids` (id delle sedi dell'app corrispondenti agli scope del grant). Dove l'app leggeva `user_strutture`/`user_sites`/`users_sedi` per il perimetro, usare `req.user.legacy_site_ids` quando non vuoto, altrimenti il comportamento dell'app per "nessuna assegnazione".
- Le route di autenticazione dell'app (login, Entra, TOTP, change-password), la gestione utenti (`routes/users.js`, `routes/admin.js` solo per la parte utenti) NON si portano: li gestisce la Suite. Le impostazioni dell'app (app_settings) sì.
- `requireRole`, `isAdmin`, `canEdit`... dell'app restano, perché `req.user.role` è il profilo del grant (stesso vocabolario, vedi `seed/modules.js`). I profili Suite OWNER/ADMIN senza grant ricevono il ruolo amministrativo del modulo (passare `extraColumns.defaultAdminRole`, es. 'SUPERADMIN' per cash/orders/shipments, 'ADMIN' per gli altri).
- Email: usare `sendMail` di `server/src/lib/mailer.js` della Suite (casella suite@) al posto del mailer dell'app; i template HTML dell'app restano.
- File binari (BYTEA nelle tabelle dell'app): restano nello schema del modulo per ora, nessuna migrazione a Blob in questa fase.
- Lavori di sfondo dell'app (scheduler, SLA, polling): registrarli con `registerJob` e farli girare solo con modulo LIVE.
- Scritture in MIRROR: bloccate da `blockWritesInMirror` (423). Non aggirare.
- Audit dell'app: resta nella sua `audit_log` (schema del modulo). In più, per le azioni principali, `audit(req, ...)` della Suite con `module: KEY` è gradito ma non obbligatorio.

## Web: `web/src/modules/<key>/`
```
meta.js      export default { key, title, kicker, area, nav: [{ to: 'sedi', icon: 'building', label: 'Sedi', end?, profiles? }, { group: 'Gestione' }, ...] }
index.jsx    export default function Module({ moduleKey, mode, moduleUser }) → <Routes> relative (path senza prefisso: "", "sedi", "sedi/:id" ...)
api.js       client con base `/api/<key>` e header 'X-Requested-With': 'td-suite' (copiare quello della Suite cambiando il prefisso)
auth.jsx     adattatore: useAuth() del modulo ritorna { user: moduleUser } (il ruolo è user.role); gli helper isAdmin/canEdit dell'app restano
pages/, components/, lib/, *.css   copiati dall'app; Login, Onboarding, Users, Profile, Pending NON si portano
```
Regole:
- Le pagine usano i percorsi relativi al modulo: `navigate('sedi/3')`, `<Link to="turni">`; se l'app usava percorsi assoluti (`/sedi/3`) vanno prefissati con `/${moduleKey}`. Un helper `const base = `/${moduleKey}`` nel modulo.
- La sidebar dell'app non si porta: le voci vanno in `meta.js` (nav) e le disegna la Suite. Il layout dell'app (shell/side/main) va rimosso: il modulo rende solo il contenuto (`.page`).
- Il CSS dell'app si copia tale e quale (styles.css, planner.css...): il plugin Vite lo isola sotto `.mod-<key>`. Le variabili `:root` dell'app diventano variabili di `.mod-<key>`: va bene.
- Icone: usare `Icon` della Suite (`web/src/components/Icons.jsx`) dove l'app usava le sue; se l'app ha una propria Icon con nomi diversi, tenerla nel modulo.
- `useApi`, `Card`, `Modal`... dell'app: tenerli nel modulo (components/ui.jsx copiato), così il comportamento resta identico.
- Nessun `localStorage` per dati; `window.location.href` solo per download di file (`/api/<key>/...`).

## Note dal primo giro di porting (già risolte nell'infrastruttura)
- Il travaso serializza per tipo di colonna di destinazione: json/jsonb sempre `JSON.stringify`, array PostgreSQL passati come array JS, bytea come Buffer. Non servono migrazioni che convertono array in JSONB.
- Le tabelle con bytea vengono copiate a lotti piccoli con timeout lunghi.
- `compareCounts` tratta `users` come informativa (gli utenti Suite entrano al primo accesso) e `goLive` esegue un ultimo travaso da solo prima del passaggio.
- `sendMail` della Suite accetta `attachments: [{ filename, content, contentType }]`: non chiamare Graph direttamente.
- Il gestore errori della Suite propaga `err.current` (optimistic locking) e `express.json` accetta 30 MB.
- Nelle voci di `meta.js` si può usare `onlyProfiles: true` insieme a `profiles` per nascondere la voce anche a OWNER/ADMIN (es. "Il mio portale" solo PROF). I gruppi senza voci sotto spariscono da soli.
- La CSP vieta `onclick` inline e script esterni: codice che li usa va riscritto con listener registrati.
- LibreOffice (`soffice`) c'è nell'immagine Docker di produzione (Dockerfile della Suite), non nell'ambiente locale: la generazione PDF deve degradare con messaggio chiaro.

## Collaudo locale (obbligatorio prima del report)
Database locale: `DATABASE_URL="postgres://postgres@localhost:5432/suite?host=/tmp"`. Database di origine di prova: `legacy_<key>` sullo stesso server (host=/tmp); se non esiste, crearlo applicando le migrazioni dell'app e inserendo dati realistici (sedi, utenti, almeno 20 righe nelle tabelle principali). Collegare la sorgente: `PUT /api/legacy/sources/<key>/credential { database_url: "postgresql://postgres@localhost:5432/legacy_<key>?host=/tmp" }` da OWNER (francesco.epifani@toscanadiagnostica.it / Prova12345678!, header X-Requested-With: td-suite). Poi `POST /api/legacy/sources/<key>/sync` (crea utenti, sedi, grant), `POST /api/travaso/<key>/run`, `GET /api/travaso/<key>/compare` (tutte le tabelle ok), e verificare le route principali del modulo come OWNER e come un utente con grant del modulo (status 423 sulle scritture in MIRROR; dopo `POST /api/travaso/<key>/live` le scritture passano). Front-end: `npm run build` pulito in web/, e con Playwright (require('playwright')) login, apertura di `/<key>` e delle pagine principali con screenshot in `docs/screens/mod-<key>-*.png`, da guardare e correggere. Avviare il server su una porta propria (PORT=31xx, BASE_URL coerente) per non collidere con altri collaudi in corso; fermarlo alla fine.
