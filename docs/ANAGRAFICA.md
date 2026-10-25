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

## Clienti service (25/10/2026, definitivo)
Organizzazioni = legal entity, una riga per partita IVA (Toscana Diagnostica, Villa Fiorita, KOS, Turati...). Sedi = punti: le sedi
TD e i punti dei clienti service, ciascuno con il proprio codice cliente StudioLAB (`sites.studiolab_code`, kind SERVICE) e
`organization_id` verso la legal entity. Un cliente con tre codici StudioLAB ha una riga in Organizzazioni e tre righe in Sedi.
Il connettore StudioLAB alimenta le sedi (dataset `sites`, campo `studiolab_code`, `organization_code` del cliente). Nessuna sede
gemella automatica, nessun codice StudioLAB sulle organizzazioni.

## Utenti = persone (25/10/2026)
Ogni utente è una persona dell'anagrafica. Catena: proposta in Contratti del personale (CANDIDATO/IMPEGNO) → assunzione o incarico
(ATTIVO) → accesso creato da solo (`lib/accounts.js`: Microsoft 365 per i domini aziendali, credenziali locali con invito per gli
altri), con proposte di grant dall'area organizzativa da confermare in Amministrazione > Utenti. "Nuovo utente" sceglie una persona;
il file Utenti accetta solo email presenti in Persone; `POST /api/people/:id/account` crea l'accesso a mano. Gli esterni che
entrano nella Suite (referenti dei clienti service, investitori) sono persone di tipo ESTERNO collegate alla loro organizzazione.

## Organizzazione delle persone (25/10/2026)
Niente "area" libera. Una persona ha: Sede (public.sites), Reparto (public.org_units, dipende dalla sede: Preanalitica, Core Lab, Accettazione...),
Ruolo (public.job_roles, catalogo), Responsabile (manager_person_id). L'organigramma si compone da questi. Ruolo e reparto si scelgono
da tendine; i file XLSX creano nel catalogo i ruoli e i reparti nuovi. Amministrazione > Organizzazione governa ruoli e reparti.
Orari delle sedi strutturati per giorno (`sites.opening_hours_json`, due fasce, copia agli altri giorni) con testo riassuntivo in `opening_hours`.
Elenchi di sedi, organizzazioni, persone e utenti sempre in ordine alfabetico.

## Organigramma ad albero (25/10/2026)
Modello del documento TD-SGI-IDL007_01 Allegato 1. `public.org_units` è un albero (`parent_id`) di unità con `kind`: DIREZIONE (radice
Toscana Diagnostica), AREA (Laboratorio di Analisi, Network Punti Prelievo, B2B, Centri Polidiagnostici), SEDE (nodo collegato a
`sites.id`), REPARTO (dipende da una sede o da un'area, es. Core Lab sotto Laboratorio di Analisi), FUNZIONE (Service di Laboratorio,
Medicina del Lavoro...). Gli incarichi stanno in `public.org_positions` (unità + persona + ruolo del catalogo + `is_head`): una persona
può avere più incarichi (Greco: Flow & Back Office in Direzione, responsabile Centri Polidiagnostici, Service di Laboratorio; Taddei
Direttore Sanitario di nove punti). `org_units.head_person_id` resta allineato all'incarico `is_head`. `GET /api/org-chart` ritorna
`{units, people}`; la Rubrica disegna le unità come caselle (responsabile in evidenza, altri incarichi sotto; "Da assegnare" se vuota),
con i livelli a molte foglie in colonna. Amministrazione > Organizzazione > Unità e incarichi è l'editor; il dataset `orgchart`
(file Organigramma: unità, unità superiore, tipo, codice sede, ruolo, persona o email, responsabile, ordine) lo carica in blocco:
le righe creano l'unità e, se indicano una persona, l'incarico; le persone devono già esistere in Persone (match per cognome nome o
email). La tendina "Reparto" delle persone offre i reparti della sede più quelli senza sede (reparti di area).

## Utenti senza doppia compilazione (25/10/2026)
L'utente collegato a una persona non ha più campi anagrafici propri da compilare: nomi, titolo, telefono, sede e legal entity (quella
della sede se la persona non ne ha una) si leggono dalla persona (`syncUserFromPerson` in lib/accounts.js e `SYNC_USER_SQL` nelle
importazioni), e la pagina Utenti li mostra in sola lettura con il link alla Rubrica. Il PUT /users ignora quei campi se c'è una persona.

## Organizzazione ↔ Persone (25/10/2026, sera)
Le due schede si parlano. Dalla scheda persona: Reparto + Ruolo scelti in Persone diventano un incarico in quel reparto
(`syncPositionFromPerson`); gli altri incarichi si aggiungono dal pulsante Incarichi (in Amministrazione > Persone e nella scheda
Rubrica), più unità e ruoli per persona. Dall'Organizzazione: ogni incarico aggiunto riempie reparto, ruolo e sede della persona se
vuoti (`syncPersonFromPosition`). `upsertPosition` evita gli sdoppiamenti (un incarico senza ruolo prende il ruolo quando arriva).
Le API persone espongono `positions` (unità, tipo, padre, ruolo, responsabile). Esportazioni dell'organigramma da Rubrica >
Organigramma: `GET /api/org-chart/export.xlsx` (stesse colonne del modello di importazione: si modifica e si ricarica), `.pptx` e `.pdf`
(una pagina per ogni unità con dipendenti, come l'Allegato 1), in lib/orgchartExport.js.

## Scheda persona = anagrafica + incarichi (25/10/2026, sera)
Il modulo Persone (Amministrazione) ha solo gli estremi anagrafici (nomi, tipo, stato, contatti, sede di lavoro, legal entity, codice
fiscale, disciplina) e sotto la sezione Incarichi nell'organigramma: la stessa tabella `org_positions` dell'Organizzazione, quanti
incarichi servono (unità di qualunque tipo + ruolo + responsabile). Niente più campi Reparto, Ruolo e Responsabile sulla scheda:
`people.unit_id` e `people.role_id` restano come "incarico principale" derivato (`syncPersonFromPosition`) e il responsabile di una
persona è calcolato dall'albero (`people_manager(id)`, migrazione 013: chi è responsabile dell'unità del suo incarico, o dell'unità
superiore se è lei la responsabile; `manager_person_id` resta come forzatura manuale). Nel file Persone, Reparto principale + Ruolo
principale creano il primo incarico; `ensureUnit` aggancia prima il reparto della sede, poi un reparto di area omonimo (Core Lab sotto
il Laboratorio), e solo in mancanza ne crea uno nella sede.

## Coordinate dall'indirizzo (25/10/2026, sera)
`lib/geocode.js`: Nominatim di OpenStreetMap (ricerca strutturata via + città + CAP, poi riga libera; precisione civico/via/città),
con Open-Meteo per la sola città come riserva. Niente chiavi; una richiesta al secondo e User-Agent dichiarato come chiede OSM. Usato
da: pulsante "Trova dall'indirizzo" nel form Sedi (`POST /api/geocode`, da confermare con Salva), completamento automatico al
salvataggio di una sede senza coordinate, "Completa coordinate" nella pagina Sedi (`POST /api/sites/geocode-missing`, in coda) e dopo
ogni importazione del file Sedi. Dal sandbox di sviluppo gli host non sono raggiungibili: collaudato con risposte simulate, da verificare
in produzione su Render.
