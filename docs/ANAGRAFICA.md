# Anagrafica unica · ricetta per i moduli

Decisione di Francesco Epifani (25/10/2026): sedi, persone e utenti esistono una volta sola, in Amministrazione (schema `public`:
`sites`, `people`, `users`, `organizations`). Nessun modulo tiene una propria anagrafica. Ogni modulo conserva soltanto una
tabella di estensione con i campi operativi che servono a lui, agganciata all'anagrafica unica. I dati dei moduli sono di prova
(20 giorni) tranne Room Planning: nessuna compatibilità con le vecchie anagrafiche, si fa pulito.

## Aggiornamento 25/10/2026 (decisione definitiva)
Nessuna riconciliazione e nessuna copia delle anagrafiche dalle app precedenti: la Suite parte vuota e si popola dai modelli XLSX
di Amministrazione > Importazioni (Sedi, Organizzazioni e clienti, Persone, Utenti con moduli e profili). I moduli sull'anagrafica
unica (cash, room, nc, orders, retail, contracts, business, integration: `FRESH_MODULES` in lib/travaso.js) si avviano vuoti e LIVE;
`afterTravaso` e la traduzione con `legacy_refs` restano nell'infrastruttura ma non si usano. Anche le organizzazioni (clienti
service, società, fornitori, target M&A) seguono la regola: `<key>.org_ext (org_id → public.organizations)`.

## Regole
1. **Sedi**: la tabella sedi del modulo (`sites`, `sedi`, `strutture`, `work_sites`) sparisce. Al suo posto `<key>.site_ext`
   (`site_id INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE` + i soli campi specifici del modulo, es. per Cash fondo cassa, orari,
   royalty, azienda; per Room `data` degli ambulatori e planimetria; per NC codici LIS e canali; per Ordini tipo di
   struttura e codici magazzino; per Retail orari, staff, asset). Ogni colonna che referenziava la vecchia tabella ora è
   `REFERENCES public.sites(id)` (scrivere sempre `public.` esplicito: il search_path del modulo è `<key>, public`).
   Le letture usano `public.sites s LEFT JOIN site_ext e ON e.site_id = s.id`; una vista `<key>.sites_v` con le colonne che il
   codice dell'app si aspetta (id, code, name, city, active, ...) è ammessa per ridurre le modifiche alle query, ma le FK vanno
   su `public.sites`. La riga di `site_ext` si crea alla prima scrittura (upsert), non serve seminarla.
2. **Persone**: la tabella persone del modulo (`professionisti`, `resources`, `site_staff`, `operators`) sparisce. Al suo posto
   `<key>.person_ext` (`person_id INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE` + campi specifici: per Room
   disponibilità, tariffe, contratto, documenti; per Contracts il dossier HR). Nome, cognome, titolo, email, telefono, codice
   fiscale, disciplina, sede, stato vengono da `public.people` e si modificano in Amministrazione > Persone o nel modulo
   Contratti del personale (unico modulo autorizzato a scrivere su `public.people`, con `audit`).
3. **Utenti**: resta `<key>.users` solo come riga tecnica dell'app (ruolo, preferenze), creata dall'adattatore `moduleUser`.
   `req.user.site_ids` sono gli id di `public.sites` negli scope del grant: usarli al posto di `user_sites`, `users_sedi`,
   `user_strutture`, che spariscono. `req.user.person_id` è la persona dell'utente (per "le mie disponibilità" di Room ecc.).
4. **Niente CRUD anagrafico nei moduli**: le pagine "Sedi", "Strutture", "Professionisti" del modulo restano come elenco con le
   impostazioni operative del modulo (i campi di `site_ext` / `person_ext`), ma non creano, rinominano o disattivano sedi e
   persone; mostrano un pulsante "Apri in Amministrazione" (`/admin/sites` per le sedi, `/people/<id>` per la scheda persona).
   Eccezione: Contratti del personale crea e modifica persone (è l'ingresso HR).
5. **Scelta sede/persona nei form**: selettori sull'anagrafica unica (`GET /api/sites?all=1`, `GET /api/people?...` della Suite,
   già esistenti e filtrati per permessi), oppure endpoint del modulo che leggono `public.sites` / `public.people` filtrando per
   `req.user.site_ids` quando il profilo è di sede.
6. **Travaso**: `lib/travaso.js` traduce da solo le colonne con FK verso `public.sites`, `public.people`, `public.users` usando
   `legacy_refs->><key>` salvato dalla sincronizzazione (Sorgenti legacy). Le righe il cui riferimento obbligatorio non ha
   corrispondenza vengono scartate e contate (`scartate` nelle statistiche, visibili in Confronta conteggi). Le vecchie tabelle
   anagrafiche dell'app non vengono copiate (non esistono più nel modulo). Per `site_ext` / `person_ext` scrivere una migrazione
   SQL `00x_suite_anagrafica.sql` che crea le nuove tabelle e, se serve, un passo di travaso dedicato nel modulo
   (`export async function afterTravaso(client, key)` in `server/src/modules/<key>/index.js`, chiamato dal job dopo la copia
   nella stessa transazione) che riempie `site_ext` dai dati dell'origine via `legacyQuery` tradotti con `legacy_refs`.
7. **Migrazioni**: le migrazioni dell'app di origine restano come sono (creano le vecchie tabelle); la migrazione nuova le
   `DROP ... CASCADE` e ricrea le FK verso `public.*`. Il travaso rifà lo schema da zero quando serve (`Ripeti travaso`).
   Prima del collaudo: `DROP SCHEMA <key> CASCADE` sul database locale, poi travaso.
8. **Vocabolario**: nelle interfacce si dice "sede" (non struttura, non site) e "persona"/"professionista". Testi in italiano,
   senza trattini lunghi.

## Collaudo (obbligatorio)
Come in PORTING.md: database locale `suite` (host=/tmp), sorgente `legacy_<key>`, `PUT /api/legacy/sources/<key>/credential`,
`POST /api/legacy/sources/<key>/sync`, `DROP SCHEMA <key> CASCADE`, `POST /api/travaso/<key>/run`, `GET /api/travaso/<key>/compare`
(righe scartate ammesse solo se motivate), verifica delle route principali, build web pulita, Playwright sulle pagine principali
con screenshot in `docs/screens/mod-<key>-*.png`. Server su porta propria (PORT=31xx). Nel report: tabelle rimosse, estensioni
create, righe scartate e perché, pagine toccate.

## Clienti service (25/10/2026)
Ogni codice cliente StudioLAB è un'organizzazione distinta (kind CLIENTE, `organizations.studiolab_code`, chiave di riconoscimento al
posto della partita IVA: due codici con la stessa P.IVA sono due organizzazioni). Per ciascuna la Suite crea e aggiorna da sola la
sede gemella `SRV-<codice>` (kind SERVICE, stesso `studiolab_code`, organization_id) su cui lavorano NC, Ordini e i perimetri degli
utenti esterni. Nel file Sedi vanno solo le sedi Toscana Diagnostica. Il connettore StudioLAB alimenterà le organizzazioni (dataset
`organizations` dell'API di ingestione, campo `studiolab_code`).
