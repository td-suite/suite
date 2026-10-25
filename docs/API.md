# Suite TD · contratto API (v0.1)

Base: `/api`. Sessione via cookie `suite.sid` (httpOnly). Ogni richiesta non GET deve portare l'header `X-Requested-With: td-suite` (anti CSRF).
Errori: `{ error, code?, details? }`. Codici speciali: `PENDING` (403, account in attesa), `PASSWORD_CHANGE_REQUIRED` (403), `TOTP_REQUIRED` (403), 401 = sessione assente.
Convenzioni server: ESM, Express Router, `ah()` per gli handler async, `parse(zodSchema, data)`, `audit(req, ACTION, {...})`, `one/many/q/tx` da `db.js`. Tutto il testo verso l'utente in italiano, senza trattini lunghi.

Schema del database: `server/src/migrations/001_core.sql`, `002_community.sql`. Catalogo moduli e profili: `server/src/seed/modules.js`.

## Utente (shape di `GET /auth/me` → `{ user, authMethod, pending }`)
```
user = { id, email, full_name, title, phone, level: 'OWNER'|'ADMIN'|'USER', status, auth_provider, must_change_password, totp_enabled, lang,
         organization_id, organization_name, site_id, site_name, site_code, person_id, person_area, person_job_title, avatar_file_id, bio, notify_email,
         grants: { [module_key]: { profile, scopes: [{type:'SITE'|'ORG', id}], area, kind } }, site_ids: [], org_ids: [], needs_totp }
```
Se `GET /auth/me` risponde `{ user:null, totpRequired:true }` il client mostra la pagina del codice a sei cifre (`POST /auth/totp/verify {code}`).

## Auth (`routes/auth.js`, FATTO)
GET /auth/config → `{ appName, tagline, entraEnabled, blobEnabled, aiEnabled, mailProvider, baseUrl }`
GET /auth/me · POST /auth/logout · POST /auth/login {email,password} → `{ ok, pending, mustChangePassword, totpRequired }`
POST /auth/totp/verify {code} · POST /auth/totp/setup → {secret, qr(dataURL)} · POST /auth/totp/enable {code} · POST /auth/totp/disable {password}
POST /auth/change-password {currentPassword,newPassword} · POST /auth/forgot {email} · POST /auth/reset {token,newPassword}
PUT /auth/me {phone?, bio?, notify_email?, lang?, site_id?, title?}
GET /auth/entra/login?next=/… (redirect a Microsoft) · GET /auth/entra/callback

## Home e moduli (`routes/core.js`, FATTO)
GET /home/modules → `{ areas: [{ key, name, color, modules: [{ key, area, name, tagline, icon, kind:'LEGACY'|'NATIVE'|'PUBLIC', legacy_url, route, restricted, profile, href }] }] }`
  `href` = route interna per i nativi, `/go/<key>` per i legacy (navigazione a pagina intera: `window.location.href`).
GET /modules (tutti, con `sso_configured`) · PUT /modules/:key {name?, tagline?, legacy_url?, active?, sort_order?, sso_secret?(solo Owner)}
Aree (ordine della home): DIREZIONE, FINANCE, RETAIL_FLOW, OPERATIONS, HQS, PEOPLE. Icone (nomi): contracts-b2b, finance-sign, integration-plan, cockpit, cash, orders, shipments, room, nc, sgi, service, contracts-hr, rubrica, retail, comunicazione, admin.

## Utenti e grant (`routes/users.js`, FATTO; solo ADMIN/OWNER)
GET /users?qtext&status&module&level&site_id&page&pageSize → `{ total, rows:[{ id,email,full_name,title,level,status,auth_provider,totp_enabled,last_login_at,site_name,organization_name,person_area,person_job_title,person_kind, grants:[{module_key,profile,proposed}] }] }`
GET /users/summary → `{ active, pending, disabled, with_proposals }`
GET /users/:id → `{ user, grants:[{ id,module_key,profile,proposed,source,module_name,area,restricted,scope_type,scopes:[{type,id}] }], audit:[...] }`
POST /users {email, full_name, title?, phone?, level?, status?, auth_provider?, organization_id?, site_id?, person_id?, lang?, password?, send_invite?, grants?:[{module_key,profile,scopes?}]} → `{ id, invited, temporaryPassword? }`
PUT /users/:id {…campi} · POST /users/:id/reset-password → `{ ok, temporaryPassword? }` · POST /users/:id/reset-totp
PUT /users/:id/grants/:module {profile, scopes?:[{type,id}]} · DELETE /users/:id/grants/:module · POST /users/:id/grants/confirm-all · POST /grants/bulk {user_ids, module_key, profile}
Regola: modulo `restricted` (contracts) assegnabile solo da OWNER (403 altrimenti). Solo OWNER crea ADMIN o cambia livello.

## Anagrafiche (`routes/core.js`, FATTO)
GET /sites[?all=1] · POST /sites · PUT /sites/:id · POST /sites/:id/merge-into/:target
GET /organizations · POST /organizations · PUT /organizations/:id
GET /people?qtext&area&kind&site_id&status&all → rubrica (campi: id, kind, status, last_name, first_name, title, email, phone, phone_office, area, job_title, discipline, manager_person_id, manager_name, site_id, site_name, site_city, organization_name, user_id, avatar_file_id, photo_file_id)
GET /people/areas → [{area, n}] · GET /people/org-chart → persone attive (albero via manager_person_id) · GET /people/:id → scheda + `reports:[]`
POST /people (admin) · PUT /people/:id (admin o rubrica:EDITOR)
GET /notifications → `{ unread, rows:[{id,kind,module_key,title,body,link,read_at,created_at}] }` · POST /notifications/read {ids?|all}
GET /audit?action&user_id&qtext&page · GET /read-log (Owner) · GET /settings · PUT /settings/:key {value}

## SSO (`routes/sso.js`, FATTO)
GET /sso/launch/:module[?path=/…] → 302 verso `<legacy_url>/api/auth/suite?token=…&next=…`. Scorciatoia navigabile: `GET /go/:module` (fuori da /api).

## Community (`routes/community.js`, DA FARE) — tutti gli utenti autenticati; scrittura secondo le regole indicate
Audience ovunque: `{"type":"ALL"}|{"type":"INTERNAL"}|{"type":"SITES","ids":[]}|{"type":"ORGS","ids":[]}|{"type":"MODULE","key":""}|{"type":"USERS","ids":[]}` filtrata con `lib/audience.js` (`audienceSql(user)`).
GET /community/home → riepilogo per la home: `{ notices:[…attivi], news:[…ultime 5 pubblicate], circolari_da_leggere:[…requires_ack non confermate], events:[…prossimi 7 giorni], quote:{text,author_label}, weather:{…}, posts:[…ultimi 3], birthdays?:[] }`
Bacheca: GET /community/posts?before&site_id → `[{ id, author:{id,full_name,avatar_file_id,job_title}, body, audience, site_id, pinned, created_at, files:[{id,filename,mime,size}], reactions:{LIKE:n,…}, my_reaction, comments_count }]`
  POST /community/posts {body, audience?, site_id?, file_ids?} · DELETE /community/posts/:id (autore o admin) · PUT /community/posts/:id/pin (admin|comunicazione)
  POST /community/posts/:id/react {kind|null} · GET /community/posts/:id/comments · POST /community/posts/:id/comments {body} · DELETE /community/comments/:id
News/circolari/blog: GET /community/news?kind&page → pubblicate e visibili all'utente, con `acked` per le circolari · GET /community/news/:slug (registra lettura se requires_ack? no: ack esplicito)
  POST /community/news/:id/ack · GET /community/news/:id/acks (comunicazione:PUBLISHER o admin: elenco presa visione, con chi manca)
  Gestione (comunicazione:EDITOR|PUBLISHER o admin): GET /community/manage/news (tutte, anche bozze) · POST /community/manage/news · PUT /community/manage/news/:id · POST /community/manage/news/:id/publish (PUBLISHER/admin; circolari generano protocol CIRC-AAAA-NNN, notifica agli utenti in audience, email se requires_ack) · DELETE
Avvisi: GET /community/notices (attivi, visibili) · POST/PUT/DELETE /community/manage/notices (comunicazione o admin)
Calendario: GET /community/events?from&to&site_id → eventi visibili · POST /community/events (admin|comunicazione; o chiunque con audience USERS di se stesso = promemoria) · PUT/DELETE /community/events/:id
Frase del giorno: GET /community/quote (quella pubblicata oggi; se manca, pubblica la prima APPROVED e la assegna a oggi) · gestione: GET /community/manage/quotes?status · POST /community/manage/quotes/generate {n?} (Claude: lib/claude.js, dai valori in app_settings community.values) · PUT /community/manage/quotes/:id {status|text}
Meteo: GET /community/weather?site_id → `{ site, city, now:{temp, code, label, icon}, today:{min,max}, days:[{date,min,max,code,label}] }` da Open-Meteo (cache 30 minuti per sede)
Pubblico (senza login, montato su /api/public come `communityRoutes.public`): GET /public/blog · GET /public/blog/:slug (news kind BLOG is_public PUBLISHED)

## File (`routes/files.js`, DA FARE) — Azure Blob (`lib/blob.js`); senza connection string: 503 con messaggio chiaro, il widget cartella si nasconde
POST /files/upload (multipart, campo `file`, query `scope=PERSONAL|POST|NEWS|AVATAR|DOC`, `folder?`) → `{ id, filename, mime, size }` (quota personale PERSONAL_QUOTA_MB)
GET /files/:id → stream del contenuto (controllo: PERSONAL solo owner/admin; POST/NEWS se l'utente vede il contenuto; AVATAR pubblico agli autenticati)
GET /files/mine?folder → `{ used, quota, folders:[], rows:[…] }` · DELETE /files/:id · PUT /files/:id {folder?, filename?}
POST /files/avatar (multipart) → imposta users.avatar_file_id

## Ricerca (`routes/search.js`, DA FARE)
GET /search?q=…&kind= → `{ results:[{ kind, title, snippet, link, module_key }], answer?: { text, sources:[…] } }`
  Full-text su search_index filtrato per audience (SQL) + trigram sul titolo. `answer` solo se `search.ai_enabled` e la domanda è in linguaggio naturale (più di 3 parole o termina con ?): Claude riceve SOLO i risultati non `sensitive` già filtrati e risponde in italiano con citazioni (indici dei risultati). Registra in ai_log.
Indicizzazione (`lib/search.js`): funzioni `indexNews`, `indexPost`, `indexEvent`, `indexPerson`, `indexSite`, `indexOrg`, `indexModule` + job `search:reindex` (ogni 60 min, ricostruisce tutto). Persone e utenti: `sensitive=false` ma solo nome, ruolo, sede, contatti aziendali.

## Legacy, cockpit, ingestione (`routes/legacy.js`, `routes/ingest.js`, `lib/legacy.js`, DA FARE)
GET /legacy/sources (admin) → stato per sorgente `{ key, label, enabled, last_sync_at, last_status, last_error, stats }` · POST /legacy/sources/:key/sync (admin) → esegue subito · POST /legacy/sync-all
GET /legacy/review (admin) → `{ sites:[…needs_review], people:[…needs_review], organizations:[…] }` per la riconciliazione
GET /cockpit → KPI per la direzione (modulo cockpit o admin): `{ generated_at, cards:[{ key, module_key, title, value, unit, delta?, hint, series?:[{label,value}], link }] }` lette in sola lettura dai DB legacy; se una sorgente non è configurata la card riporta `unavailable:true`
GET /home/counters → `{ [module_key]: { value, label } }` contatori per i widget (NC aperte, ordini da evadere, rendiconti da approvare, autorizzazioni in attesa, attività M&A in ritardo, kit in viaggio)
Chiavi API (admin): GET /api-keys · POST /api-keys {name, source, site_id?, organization_id?, scopes:[], expires_at?} → `{ id, key }` (la chiave in chiaro compare una sola volta) · DELETE /api-keys/:id (revoca)
Registro importazioni: GET /ingest-batches?source&dataset&status&page · GET /ingest-batches/:id
Ingestione (fuori sessione, header `Authorization: Bearer <chiave>`, montato su /api/ingest):
  POST /api/ingest/:dataset  body `{ batch_uid, source, manifest?:{…}, rows:[…] }` → `{ batch_id, status, rows_total, rows_ok, rows_rejected, errors:[{row, error}] }`; stesso batch_uid → `status:"DUPLICATE"` senza riapplicare.
  dataset `people` (righe: last_name, first_name, email?, tax_code?, kind?, status?, area?, job_title?, site_code?, phone?) → upsert in people per tax_code, poi email · dataset `sites` (code, name, kind?, city?, …) · dataset `organizations` · dataset `events` (title, starts_at, …external_id) · dataset `news` (bozze) · dataset `files` (multipart: campo file + batch_uid, folder) · dataset generico `<altro>` → solo registrato (status RECEIVED) per i moduli futuri.
  GET /api/ingest/status/:batch_uid · GET /api/ingest/ping (verifica chiave)
