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

## Dipendenza gerarchica (25/10/2026, notte)
Nella scheda persona, sopra gli incarichi, "Dipende da": per chi ha un incarico la Suite riporta il responsabile calcolato
dall'Organizzazione (`people_manager_auto`, migrazione 014: il responsabile dell'unità del suo incarico, o dell'unità superiore se è
lei la responsabile); per tutti gli altri (medici, infermieri, collaboratori senza casella nell'organigramma) e per le eccezioni si
sceglie a mano una persona (`manager_person_id`), che prevale. La colonna "Dipende da" in Persone segnala "dall'organigramma" quando
il valore è derivato. Il file Persone continua ad accettare `manager_email` come dipendenza manuale.

## Afferenza (25/10/2026, notte)
Ogni persona afferisce a un'unità qualunque dell'albero (`people.unit_id`, non più solo reparto): nella scheda, "Afferisce a" con
tendine a cascata Direzione › Area › Sede › Reparto/Funzione, fermandosi dove serve; il percorso completo è `org_unit_path(unit_id)`
(migrazione 015) ed è mostrato in Persone, in Rubrica e nel filtro `unit_id`. La sede di lavoro, se non indicata, è quella dell'unità o
del primo antenato con sede (`org_unit_site`). L'afferenza crea un incarico senza ruolo nell'unità (così la persona sta "lì sotto"
nell'organigramma, dove le persone afferenti senza ruolo sono raggruppate come conteggio); "Dipende da" deriva prima dall'afferenza
(responsabile dell'unità, o dell'unità superiore se è lei la responsabile), poi dagli incarichi (migrazione 016). Nel file Persone la
colonna Afferenza accetta il nome dell'unità o il percorso "B2B › Service di Laboratorio". Il file Organigramma precompilato ha ora il
nodo Sede "Laboratorio Sesto Fiorentino" sotto l'area Laboratorio di Analisi, con i reparti sotto la sede.

## Sedi: mappa, ricerca, responsabile, centralino (25/10/2026, notte)
Pagina Sedi con mappa Leaflet/OpenStreetMap di tutte le sedi con coordinate (marker per tipo, popup con indirizzo, telefono, orari;
"Sulla mappa" dalla riga; CSP aperta ai tile OSM), ricerca anche per indirizzo, CAP, provincia, nome breve e codice StudioLAB, senza
accenti. Il responsabile di sede non è più testo libero: è il responsabile del nodo Sede dell'organigramma collegato alla sede
(`manager_person_id`/`manager_name`/`manager_role` calcolati in GET /sites; campo in sola lettura nel form; colonna nel modello Sedi
ignorata). Centralino (lib/centralino.js): numero diretto = 055 776 + interno (tre cifre); interni personali e di reparto dal file Rev01
applicati dopo ogni importazione di Persone/Organigramma e al salvataggio della persona. Nessuna sede o legal entity di esempio nel
seed: le sedi (LAB, HQ...) le codifica Francesco nel file Sedi.
Vertice (migrazione 017): `people.no_manager` = la persona non dipende da nessuno anche se l'organigramma suggerirebbe un responsabile;
opzione "Nessuno (vertice)" nella tendina Dipende da; `people_manager` restituisce NULL.

## Dati personali (25/10/2026, notte)
`people` ha anche luogo di nascita, partita IVA e residenza (migrazione 018), oltre a sesso, data di nascita, codice fiscale, ingresso e
cessazione. Si caricano dal file Persone (colonne in coda), si modificano nel form di Amministrazione e si vedono solo agli
amministratori (card "Dati personali" nella scheda Rubrica; le API li omettono agli altri). File precompilato dal file risorse di
Francesco: modelli\SuiteTD_persone_TD.xlsx (43 persone; chi ha partita IVA è stato messo come LP, da verificare).

## Sedi e organigramma allineati (26/10/2026)
Ogni sede TD attiva (non SERVICE) ha sempre il suo nodo Sede nell'albero (`ensureSiteNodes`: creato sotto la Direzione se manca,
nome che segue l'anagrafica sedi; chiamato alla creazione di una sede, dopo il file Sedi e a ogni lettura di Organizzazione). Il file
Organigramma, per una riga Sede, aggancia il nodo esistente per codice sede o per nome/nome breve e lo sposta sotto l'area indicata,
senza duplicarlo. Mappa con tile CARTO (Voyager): i server volontari di OpenStreetMap rifiutano le applicazioni con 403.

## Tecnostruttura e pettine (26/10/2026)
Stesso disegno di Contratti del personale (areas.kind STAFF/LINEA): `org_units.branch` = STAFF (tecnostruttura: Operations, Finance,
Legal People and Organization, Flow & Back Office, Retail & Communications, HSQ, Lab Operations Management) o LINEA (aree operative,
il pettine). Nell'organigramma le funzioni di staff stanno accanto al vertice, le aree operative sotto; nella scheda persona la tendina
Area le separa in due gruppi; il file Organigramma ha la colonna Collocazione (LINEA/STAFF) e il precompilato modella così la Direzione.
Scheda persona = Sede, Ruolo, Area/Reparto/Funzione rispetto alla sede, Dipende da (una persona): il modello di Contracts HR.

## Persone ⊇ Utenti (26/10/2026)
Ogni utente è una persona (anche gli esterni: tipo ESTERNO con la loro legal entity). Ogni persona ATTIVA con email ha un accesso:
nasce al salvataggio, dopo il file Persone (`createMissingAccounts`, senza inviti automatici) e dal pulsante "Crea gli accessi mancanti" in
Persone (`POST /api/people/accounts/missing`). Microsoft 365 per i domini aziendali, credenziali locali per gli altri (invito con il
Reset password dalla scheda utente). Chi non ha email o non è attivo compare "Senza accesso" con il motivo; filtro Accesso in Persone.

## Regole di accesso (26/10/2026)
`grant_rules` (migrazione 022, lib/grantRules.js): condizione = afferenza a un'unità (o sotto) e/o ruolo e/o tipo di sede di lavoro
e/o solo responsabili; effetto = modulo + profilo, ambito sede della persona o tutte. Producono proposte (grants.proposed, source ORG,
scope sulla sede) mai grant confermati; le proposte non più coperte spariscono, quelle confermate restano. Si applicano alla nascita
dell'accesso, al salvataggio della persona, a ogni incarico, dopo le importazioni e da "Rigenera le proposte". 37 regole iniziali
seminate quando esistono le unità (Finance, Operations, Flow & Back Office, Retail & Communications, HSQ, Legal, Laboratorio, B2B,
tipi di sede, responsabili, Direttore Sanitario, Site Manager). Il vecchio AREA_GRANT_PROPOSALS sul campo libero "area" non è più usato.

## Cash: solo sedi TD, operatori = utenti Suite (26/10/2026)
Decisione di Francesco Epifani. Cash non vede mai le strutture dei clienti service (`public.sites.kind = 'SERVICE'`): la vista
`cash.sites_v` (migrazione 012) le esclude e passa a `LEFT JOIN site_ext`, con `configured` a dire se la sede ha le impostazioni Cash;
la pagina Sedi elenca tutte le sedi TD (anche da configurare, con i campi operativi vuoti), i selettori e le statistiche solo quelle
configurate. Il salvataggio delle impostazioni fa upsert su `site_ext`. Nessuna anagrafica degli operatori in Cash: gli operatori sono
gli utenti della Suite con grant sul modulo (`cash.operators_v` su `public.users`/`grants`/`grant_scopes`, id = utente Suite); la pagina
Operatori è in sola lettura (cognome e nome, email, profilo Cash, sedi dello scope, stato, "Apri in Utenti" verso `/admin/users/<id>`),
con il solo fondo cassa personale modificabile in `cash.user_ext (user_id → public.users)`. `cash.users` resta riga tecnica per le chiavi
esterne dei rendiconti, agganciata con `suite_user_id`; nomi, email e profilo nei rendiconti e nei documenti vengono dalla Suite tramite
`cash.users_v`. Le migrazioni nuove dei moduli con schema pronto si applicano all'avvio del server (`applyModuleMigrations` in
lib/travaso.js): prima si applicavano solo al travaso o all'avvio del modulo.


## Integration: le target sono le Legal entity TARGET (26/10/2026)
Decisione di Francesco Epifani. Il modulo Integration non ha anagrafica propria: le "sedi da integrare" (i target del post closing)
sono tutte le Legal entity `public.organizations` con `kind = 'TARGET'`, e il modulo conserva soltanto `integration.org_ext`
(`org_id → public.organizations ON DELETE CASCADE`, migrazione 003: rinomina di `target_ext` senza perdita di dati) con i campi
operativi del piano (date LOI/preliminare/closing, stato, referente, fatturato/PFN/EV, linee, orizzonte del GANTT); attività e
support restano agganciate a `public.organizations`. La vista `integration.targets_v` fa `LEFT JOIN org_ext` ed espone `configured`
(piano avviato) e `integrated` (piano presente ma tipo non più TARGET). Pagina del piano: tutte le Legal entity TARGET compaiono da
sole, anche "da avviare" (nessun dato del modulo: fuori da conteggi, snapshot, stampa ed export), con "Apri in Legal entity"
(`/admin/organizations`) e nessuna creazione o rinomina nel modulo; "Avvia il piano" dalla scheda crea la riga `org_ext` e le attività
del piano generale (`POST /api/integration/targets`). Quando l'Amministrazione cambia il tipo da TARGET a SOCIETA (acquisizione conclusa)
la riga resta in elenco come "Integrata": piano consultabile in sola lettura, scritture e rimozione rifiutate con 400, nessuna
cancellazione. "Rimuovi dal piano" toglie attività e parametri e la Legal entity torna "da avviare".

## Business: organizzazioni e sedi TD (26/10/2026)
Decisione di Francesco Epifani. La pagina `/business/organizzazioni` è "Organizzazioni e sedi": un elenco unico con il filtro Tipo
(Legal entity = `public.organizations`, Sede TD = `public.sites` con `kind <> 'SERVICE'`), letti dall'anagrafica unica senza copie,
con "Apri in Legal entity" (`/admin/organizations`) e "Apri in Sedi" (`/admin/sites`); nessuna creazione o modifica anagrafica nel
modulo (restano solo le impostazioni Business in `business.org_ext`). Contratti e fascicoli si collegano sia alla controparte
(`org_id`) sia alla sede TD (`site_id`), almeno uno dei due (migrazione 005: `contracts.org_id` facoltativo con
`contracts_party_check`; `dossiers.org_id/site_id/title` propri, ereditati dal contratto e allineati a ogni modifica del contratto;
`dossiers.contract_id` facoltativo). Il contratto del punto prelievi lega la sede TD al partner che la ospita; punti prelievo e sedi
in locazione richiedono sempre la sede TD; la generazione dei documenti richiede la controparte. I fascicoli hanno route e pagina
per id proprio (`/api/business/dossiers/:id`, `/business/fascicoli/:id`; il vecchio `/contratti/:id/fascicolo` reindirizza) e
possono nascere anche senza contratto su una sede TD ("Nuovo fascicolo": senza controparte atto di condivisione e DUVRI sono
esclusi). `GET /api/business/sites` esclude le sedi SERVICE e riporta contratti e fascicoli collegati.

## Ordini: strutture = sedi TD e Legal entity (26/10/2026)
Decisione di Francesco Epifani. In Ordini e Magazzino la "struttura" (chi ordina e riceve materiale) ha due origini nell'anagrafica
unica: le sedi TD (`public.sites`, `kind <> 'SERVICE'`, impostazioni in `orders.site_ext`) e le Legal entity (`public.organizations`:
clienti del service di laboratorio, partner, fornitori, società del gruppo; impostazioni in `orders.org_ext`, migrazione 005, stessi
campi di site_ext: ruolo nel flusso, codice Silva, giorno della giacenza, referente, modalità e note di consegna). I punti dei clienti
service (`sites.kind = 'SERVICE'`) non sono strutture: compaiono come punti di consegna della loro Legal entity (`organization_id`) e
la produzione StudioLab attribuita al loro codice cliente si somma sulla Legal entity (`productionStrutture` in lib/studiolab.js).
Chiave unica `struttura_id` in orders, packages, stock_counts, production, issues, email_log: `> 0` id della sede, `< 0` opposto
dell'id della Legal entity; le colonne generate `site_id` e `org_id` (una sola valorizzata) portano le FK reali verso `public.sites`
e `public.organizations`, così le query del modulo restano a un solo intero. Vista `orders.strutture_v` (origin SITE/ORG, site_id,
org_id, kind, codici, `configured`, `delivery_point`, `points`) al posto di `sites_v`, che resta ma non è più usata. Un utente di
struttura con ambito su un punto SERVICE opera sulla sua Legal entity; con ambito ORG o Legal entity propria, su quella. Pagina
Strutture: elenco unico con filtro Tipo (Sede TD / Legal entity), punti di consegna sotto la Legal entity, "Apri in Sedi"
(`/admin/sites`) e "Apri in Legal entity" (`/admin/organizations`); i selettori di struttura (nuovo ordine, archivio, giacenze,
giacenze mensili, produzione) offrono le due origini in due gruppi. Intestazione dei PDF: `company` dell'app se presente,
altrimenti la Legal entity TD dall'anagrafica (`companyInfo`).

## Ordini: Magazzino Centrale e Dotazione di avvio delle sedi (31/10/2026)
Richiesta del CEO. "Magazzino Silva" si chiama ora **Magazzino Centrale** (menu "0 · Magazzino Centrale"; il fornitore resta citato
dove serve: catalogo e giacenze letti dall'API Silva). Migrazione orders/009_dotazione_avvio.sql.
- **Visibilità a quattro tipologie**: le caselle del Magazzino Centrale e del Catalogo articoli sono Tutti (`visible_all`), Punti
  Prelievo (`visible_sedi`), Centro Polidiagnostico (`visible_poli`, nuova), Laboratorio di Analisi (`visible_lab`, nuova), Service
  (`visible_service`); le due nuove partono da `visible_sedi` (prima valeva "punti prelievo e laboratorio"), anche per gli articoli
  importati dall'app originale. La colonna si sceglie dal tipo di sede dell'anagrafica della struttura (`strutture_v.site_kind`,
  risolto in `resolveStruttura` come `struttura_site_kind`): PUNTO_PRELIEVI → visible_sedi; CENTRO_DIAGNOSTICO, POLIAMBULATORIO,
  CENTRO_MEDICO → visible_poli; LABORATORIO → visible_lab; Legal entity e punti SERVICE → visible_service; per Direzione/Altro decide
  il ruolo nel flusso (CLIENTE/LAB/SEDE). Funzioni in `lib/dotazione.js` (`colonnaVisibilita`, `clausolaVisibilita`), usate da
  `GET /articles`, dalla giacenza per struttura e dalla giacenza mensile. Gli articoli Silva nascono con `visible_all` TRUE.
- **Dotazione di avvio sedi** (menu "0b · Dotazione di avvio sedi", solo Area Operations, badge = sedi e Legal entity con apertura
  entro 60 giorni o già aperte senza Giacenza 0). Due schede:
  a) *Modelli per tipologia*: quattro tipologie fisse (`startup_templates`: PUNTO_PRELIEVI "Punto Prelievi", POLIDIAGNOSTICO "Centro
     Polidiagnostico" per CENTRO_DIAGNOSTICO/POLIAMBULATORIO/CENTRO_MEDICO, LABORATORIO "Laboratorio di Analisi", SERVICE "Cliente
     service / Legal entity") con l'elenco completo del materiale (`startup_template_lines`: articolo attivo del catalogo Silva,
     confezioni > 0, note; UNIQUE per tipologia e articolo). Ricerca per codice o descrizione, modifica e rimozione, "Copia da
     un'altra tipologia" (aggiungi i mancanti o sostituisci), esportazione XLSX.
  b) *Sedi e Legal entity*: sedi struttura dell'anagrafica (`strutture_v` origin SITE con site_kind PUNTO_PRELIEVI,
     CENTRO_DIAGNOSTICO, POLIAMBULATORIO, CENTRO_MEDICO, LABORATORIO) e Legal entity clienti service e partner (origin ORG,
     tipologia SERVICE). Data di effettiva apertura: per la sede `public.sites.opened_at`, modificabile qui (scrittura sul core
     con audit `SITE_UPDATED` nel registro della Suite e `DOTAZIONE_APERTURA` nel modulo); per la Legal entity la data di avvio
     del rapporto in `startup_loads.start_date` (organizations non ha una data di apertura). Stato: NON_PIANIFICATA (nessun piano),
     PIANIFICATA, CONSEGNATA (= Giacenza 0 registrata), totale confezioni, ordine collegato.
  Tabelle: `startup_loads` (una per struttura, `struttura_id` della vista come nel resto del modulo: > 0 sede, < 0 Legal entity, con
  `site_id`/`org_id` generati e FK reali; kind, status, start_date, planned_at/by, order_id, delivered_at/by, note) e
  `startup_load_lines` (articolo, packs_planned, packs_delivered, lot, expiry, note). Flusso della scheda `dotazione/sedi/:id`:
  "Genera dal modello" copia le righe della tipologia → si adattano alla struttura (aggiungi, togli, quantità, lotto e scadenza
  facoltativi) → "Salva piano" (PIANIFICATA) → facoltativo "Crea ordine al Magazzino Centrale" (ordine in BOZZA del modulo con le
  righe pianificate e nota "Dotazione di avvio", tramite `creaOrdine` di routes/orders.js; 409 se c'è già un ordine non annullato)
  → "Registra la Giacenza 0": per ogni riga `packs_delivered` confezioni in `packages` con origin `INIZIALE`, stato `RICEVUTO`,
  `received_at` = data scelta (default data di apertura, altrimenti oggi), `received_by` l'utente, nota "Dotazione di avvio" e
  `packages.startup_load_id` (stessa funzione `caricoIniziale` di `POST /stock/initial`); stato CONSEGNATA, non ripetibile (409).
  "Annulla Giacenza 0" (solo SUPERADMIN) toglie le confezioni INIZIALE del carico ancora RICEVUTO (quelle già messe in uso restano)
  e riporta il piano a PIANIFICATA. Dopo la registrazione la Giacenza per struttura mostra le confezioni. Stampa PDF
  (`pdf/dotazione.js`, pdfkit: elenco con la grafica degli articoli, quantità, lotto, scadenza, casella di spunta, firme per
  ricevuta). Audit su ogni scrittura (`DOTAZIONE_*`). API sotto `/api/orders/dotazione` (modelli, sedi, articoli).

## Non conformità: sedi invianti = sedi TD e Legal entity (26/10/2026)
Decisione di Francesco Epifani. In Non conformità la "sede inviante" ha due origini nell'anagrafica unica, con la convenzione di
Ordini: le sedi TD (`public.sites`, `kind <> 'SERVICE'`, impostazioni in `nc.site_ext`) e le Legal entity (`public.organizations`:
laboratori clienti del service, fornitori, partner; impostazioni in `nc.org_ext`, migrazione 004, stessi campi di site_ext: codice
LIS, canale, email/PEC NC, CC, SLA, attiva, note, ultimo oggetto Cliente del LIS). Chiave unica `sede_id` in `nc` e `accettazioni`:
`> 0` id della sede, `< 0` opposto dell'id della Legal entity; colonne generate `site_id` e `org_id` con le FK reali. I punti SERVICE
non sono sedi: compaiono come punti StudioLAB della loro Legal entity (`organization_id`, colonna `punti` della vista) e una NC o
un'accettazione che arriva dal canale macchina (HL7 ORC-13 / FT1 / MSH-4, push) con il codice cliente di un punto si attribuisce alla
Legal entity (`findSedeByCodice` in lib/sedi.js: org_ext.codice_lis, poi site_ext.codice_lis / sites.studiolab_code / sites.code con
il punto SERVICE che porta alla Legal entity, infine organizations.code). Vista `nc.sedi_v` (origin SITE/ORG, site_id, org_id,
organization_id, punti, punto_service, pec_suite) al posto di `sites_v`, che resta ma non è più usata; i dati esistenti su un punto
SERVICE passano alla sua Legal entity nella migrazione. Perimetro di un utente SEDE (`perimetroSedi`): scope SITE = la sede TD (un
punto SERVICE porta alla Legal entity), scope ORG = la Legal entity, senza ambito la Legal entity dell'utente; gli utenti di sede che
ricevono le notifiche di una Legal entity sono quelli con scope ORG su di essa, scope SITE su un suo punto o appartenenti a essa.
Pagina Sedi invianti: elenco unico con filtro Tipo (Sede TD / Legal entity), punti StudioLAB sotto la Legal entity, "Apri in Sedi"
(`/admin/sites`) e "Apri in Legal entity" (`/admin/organizations`), nessun CRUD anagrafico; `PUT /api/nc/sedi/:id` con id negativo
scrive su org_ext e rifiuta i punti SERVICE. I selettori di sede (accettazione manuale, correzione sede, filtri archivio, elenco NC,
statistiche) offrono le due origini in due gruppi (`SedeSelect` in components/ui.jsx).

## Revisione dei moduli dopo l'avvio (26/10/2026)
Cash: solo sedi TD (le non configurate compaiono "da configurare"), operatori = utenti Suite con grant cash (operators_v, cash.user_ext
solo per il fondo cassa). Integration: target = Legal entity TARGET (org_ext). Business: Organizzazioni e sedi, contratti e fascicoli
su Legal entity e/o sede TD. Room: tutte le persone attive con filtri e flag pianificazione (person_ext.planning_excluded, azione
"Escludi non sanitari"). Ordini e NC: struttura = sede TD (id > 0) o Legal entity (id < 0) con colonne generate e FK reali, punti SERVICE
sotto la loro Legal entity. Organigramma: la sezione di Contratti del personale rimanda alla Rubrica, che parte da sede, area o persona
(catena dal vertice + sottoalbero; esportazioni con ?unit_id). SGI e Portale Service si aprono in una scheda nuova. Le migrazioni dei
moduli si applicano all'avvio del server (applyModuleMigrations), non solo al travaso.

## Circolari (26/10/2026)
Modulo nativo integrato dal pacchetto di Francesco sotto HQS (dopo Non conformità): protocollo TD-AAAA/NNN alla pubblicazione, impaginazione
DOCX/PDF su carta intestata, archivio full-text, liste di distribuzione dall'anagrafica unica, QR pubblico. Parte vuoto e LIVE con
"Avvia" (FRESH_MODULES). Documentazione in docs/CIRCOLARI.md. Regole di accesso iniziali: Retail & Communications e HSQ → PUBBLICATORE,
Laboratorio → REDATTORE. Dipendenza nuova del server: docx. Collaudo locale: TXT con tabella → bozza → anteprima → TD-2026/001 → PDF, QR
pubblico, ricerca generale (kind circolare_td).

## Ticket (26/10/2026)
Modulo nativo sotto HQS (dopo Circolari): richieste e segnalazioni ai responsabili delle caselle dell'organigramma, protocollo
TK-AAAA/NNNN, SLA per priorità, cronologia, allegati, statistiche, esportazioni XLSX e PDF. Nessuna anagrafica propria: FK verso
`public.users` (richiedente, assegnatario, osservatori), `public.people`, `public.sites` e `public.organizations` ("per conto di" sede TD
o Legal entity), `public.org_units` (casella destinataria, categoria predefinita, escalation); i gestori sono i responsabili delle
caselle (`org_positions.is_head`) e della catena sopra. Aperto a tutti gli utenti autenticati senza grant (`modules.open_to_all`,
migrazione 024; ruolo implicito UTENTE in `moduleUser`); profili ADMIN, RESPONSABILE, VIEWER. Documentazione in docs/TICKET.md.

## Cartella condivisa (26/10/2026)
Modulo nativo sotto Retail & Flow (dopo Comunicazione): cartelle ad albero e documenti con versioni, evidenza con scadenza e novità per
utente, a disposizione di chi ha il grant (richiesta del CEO: nessun permesso per cartella, il widget lo vede solo chi è abilitato,
`open_to_all` FALSE). Nessuna anagrafica propria: FK verso `public.users` (chi crea, carica, legge). Contenuto dei file in BYTEA nello
schema del modulo (`public.files` richiede Azure Blob e senza di esso risponde 503). Profili ADMIN "Gestione" e VIEWER "Consultazione";
regole di accesso iniziali: responsabili di unità → VIEWER, Retail & Communications e HSQ → ADMIN. Indice di ricerca con audience
MODULE (solo chi ha il grant). Documentazione in docs/CARTELLA.md.

## Connettori unici (26/10/2026)
Decisione del CEO. I dati di accesso ai sistemi esterni (StudioLAB ServiceNET, GIPO, TuoTempo, Silva) stanno una volta sola in
`public.connectors` (migrazione 025) e si configurano in Amministrazione > Connettori: base URL, credenziali e segreto in ingresso
cifrati con lib/secrets, impostazioni, prova di connessione, registro delle chiamate (`connector_log`). I moduli leggono da
`lib/connectors.js` (`getConnector`, `connectorSync`, `verifyInbound`, `logConnector`) con ripiego sulle variabili d'ambiente
storiche finché il connettore non è configurato; le pagine Impostazioni dei moduli mostrano solo lo stato. Documentazione in
docs/CONNETTORI.md.

## Contratti del personale: caricamento dei dossier dalle cartelle HRM (27/10/2026)
Richiesta del CEO: "integriamo i dati di dipendenti e LP che ho messo in Contesto, per inserire tutti i dati nel widget
Contratti del personale". Fonti: OneDrive HRM/Dipendenti (dipendenti.xlsx, ORGANICO TEAM SYSTEM al 26/10/2026, FILE VISITE
+ FORMAZIONE, lettere di assunzione DOCX/PDF, UNILAV, dossier per cartella) e HRM/LP (medici LP.xlsx, infermieri-tecnici
LP.xlsx, contratti LP DOCX e PDF scansionati con tariffario, documentazione per professionista). Costruito il pacchetto
`2026-10-27_ContrattiPersonale_pacchetto_dossier.zip` (manifest.json + files/) per Contratti del personale > Impostazioni >
Importa pacchetto, modalità "Aggiorna esistenti": 33 risorse (23 dipendenti con contratto, livello, RAL, paga base,
superminimo, indennità, scatti 2027, prova, benefit, smart working, MBO, UNILAV; 10 liberi professionisti con disciplina,
titoli, albo, polizza, durata, tariffario a voci), 259 allegati classificati nelle categorie del dossier dal nome del file,
5 CV nel CV Box. Le persone si agganciano all'anagrafica unica per codice fiscale e, se manca, per cognome e nome (fix in
routes/imports.js: prima la corrispondenza per CF e poi per nome, così chi era stato caricato senza CF non viene duplicato).
Lo script che costruisce il pacchetto è fuori repository (sessione Cowork); le note "da verificare" sono nel campo note di
ogni contratto.

## Spedizioni: comunicazione ad Affinity / Endeavor sempre con il codice SDA (27/10/2026)
Richiesta del CEO: nelle email a katalin@affinitydna.co.uk, katie@easydna.com e stefano@affinitydna.co.uk che danno evidenza
dell'invio del kit al paziente, il codice SDA della spedizione va incluso sempre, perché serve a registrare la spedizione.
Fatto in routes/orders.js: l'email parte a ogni spedizione di un ordine ENDEAVOR (non è più disattivabile dalle impostazioni),
con il codice SDA in oggetto ("Kit … shipped · SDA …") e nel corpo ("SDA shipment code"); la spedizione a mano, che non ha
lettera di vettura di andata, richiede obbligatoriamente il codice dell'etichetta SDA di ritorno (controllo lato server e
pulsante disabilitato nella finestra di spedizione); un codice di ritorno inserito in seguito dalla scheda dell'ordine genera
un secondo messaggio ad Affinity con quel codice (notifyAffinityReturn). I destinatari restano nell'impostazione
affinity_notify_emails (seminata con i tre indirizzi).

## Travaso dei contenuti dall'app originale nei moduli ripartiti da zero (27/10/2026)
Richiesta del CEO: "due cose vorrei travasare e poi la Suite è completa: Room Planning prima e Integration dopo". I due moduli
erano partiti vuoti sull'anagrafica unica; i contenuti delle app originali (database Render collegati in Sorgenti legacy)
si riportano ora con "Importa i contenuti dall'app originale" sulla card del modulo in Amministrazione > Travaso moduli
(solo Owner/Admin, modulo in LIVE, sorgente collegata). Interfaccia comune: il modulo esporta `legacyMatch` (entità
dell'app originale con proposta di abbinamento all'anagrafica unica: riferimento salvato > codice > email > CF/P.IVA > nome
normalizzato; proposta solo se univoca, candidati per i dubbi) e `legacyImport({ mapping, dryRun })` (una transazione,
"Prova senza scrivere" = stessa esecuzione con rollback, idempotente tramite `<key>.legacy_import_map`; scrive su public.*
solo `legacy_refs`; ciò che punta a un'entità non abbinata si salta e compare nel rapporto; ciò che nella Suite esiste già
non si sovrascrive e viene segnalato). Core: routes/travaso.js (`legacy-match`, `legacy-import`, audit LEGACY_IMPORT),
pagina Travaso.jsx (finestra con Sedi / Persone / Legal entity, tendine con i candidati e tutte le anagrafiche, tabelle con
i conteggi, prova, importazione con conferma, rapporto). Room: lib/legacyImport.js copia site_ext (dal JSON della struttura),
planimetrie e cronologia, scheda Room dei professionisti (i dati anagrafici restano nel core e non vengono sovrascritti),
documenti, disponibilità, turni, mesi, presenze, rendiconti, posizioni, candidature, eventi, email. Integration:
lib/legacyImport.js copia parametri del piano (org_ext), team (person_ext), attività con owner e support tradotti (owner non
abbinato = attività copiata senza owner con avviso), snapshot convertiti al formato della Suite, registro delle modifiche.
Collaudo con database legacy di prova e Playwright (schermate in docs/screens/legacy-import-*.png).

### Sedi già configurate e persone mancanti (28/10/2026)
Segnalazione del CEO: "Il travaso in room planning ha saltato tutti i professionisti, gli ambulatori, le prestazioni. Occorre
recuperarli. Se i professionisti mancano in Persone, fammi XLSX da caricare e quindi poi importare." Cause: le sedi che il CEO
aveva già configurato nella Suite (es. solo la planimetria) venivano saltate per intero ("impostazioni Room già presenti");
i professionisti dell'app assenti in Persone non erano abbinabili e tutto ciò che li riguardava veniva saltato. Regole ora in vigore:
- **Fusione per sezione delle impostazioni Room** (Room, lib/legacyImport.js `mergeSiteExt`): per una sede abbinata che ha già
  site_ext nella Suite, ogni chiave di primo livello del JSON dell'app (ambulatori, personale, prestazioni, hours, desk*, note,
  plan = marker della planimetria, e qualunque altra, in modo generico) entra solo se nella Suite manca o è vuota (null, stringa
  vuota, elenco vuoto, oggetto vuoto, nessun marker); le sezioni già valorizzate restano e il rapporto dice "sezioni X mantenute
  dalla Suite" (solo se diverse da quelle dell'app). Riferimenti interni: i marker puntano agli id degli ambulatori, quindi marker
  dell'app su ambulatori della Suite entrano solo per gli id esistenti (nessuno = sezione non integrata, avviso); marker della
  Suite che non corrispondono agli ambulatori integrati dall'app restano e vengono segnalati. Il personale di sede è riferito per
  nome (personKey), non per id. Ogni fusione aumenta version, aggiorna updated_at e scrive in struttura_history una riga
  "Integrazione dall'app originale: ..." (user_name "Importazione dall'app originale"). **Ripetibile**: la fusione si riesegue
  anche per una sede già in legacy_import_map, così una prima importazione che aveva saltato viene recuperata ricontrollando le
  sezioni vuote; se nulla è da integrare la sede conta come "già presente". Le planimetrie (struttura_blobs) non si sovrascrivono.
- **XLSX delle persone non abbinate**: il modulo esporta `legacyPeopleRows({ legacyQuery, mapping })` (facoltativa: i
  professionisti dell'app NON presenti in mapping.people nel formato del dataset `people` di routes/importxlsx.js: cognome, nome,
  titolo, email, codice fiscale, tipo MEDICO/SANITARIO dal tipo Room, stato ATTIVO/CESSATO, ruolo = profilo, disciplina, codice
  sede = prima sede abilitata abbinata, cellulare, telefono, sesso, data e luogo di nascita, partita IVA, residenza). Il core
  espone `POST /api/travaso/:key/legacy-people.xlsx` con body `{ mapping }` (400 se il modulo non esporta la funzione; audit
  LEGACY_PEOPLE_XLSX) che produce il modello Persone precompilato con `buildTemplate('people', { rows, note })` esportata da
  importxlsx.js (stesso foglio, tendine e foglio Istruzioni del modello scaricabile). Nella finestra di Travaso.jsx, sezione
  Persone, il pulsante "Scarica XLSX delle persone non abbinate (N)" compare se `legacy_match.people_xlsx` è vero e ci sono
  persone senza abbinamento; il testo dice di caricare il file in Amministrazione > Importazioni > Persone e riaprire la finestra.
- **Seconda importazione**: `legacyMatch` propone le persone appena caricate per email, codice fiscale o nome (indice sulle
  anagrafiche della Suite, proposta solo se univoca); le righe saltate dalla prima importazione non sono mai registrate in
  legacy_import_map (solo le righe scritte e le entità abbinate), quindi la seconda esecuzione copia scheda Room, documenti,
  disponibilità, turni, presenze, rendiconti e candidature di quelle persone. Collaudo: sede già configurata con sola planimetria +
  professionista assente → prima importazione (sezioni integrate, persona saltata) → XLSX → caricamento con POST /api/import/people
  → seconda importazione (persona riconosciuta per email, 1 scheda, 2 documenti, 2 disponibilità, 3 turni, 1 rendiconto, 2 presenze,
  1 candidatura copiate) → sezioni svuotate e terza esecuzione: integrate di nuovo. Schermata docs/screens/legacy-import-persone-xlsx.png.

## Profili di accesso (28/10/2026)
Richiesta del CEO, testuale: "Vorrei creare dei profili per i permessi, in modo da cliccare i profili e assegnarli automaticamente
[...] Aggiungi inoltre un quadratino prima del nome dell'utente in modo da selezionarlo. In questo modo posso assegnare massivamente
i profili agli utenti." Il profilo "Default" va "attivato di default a tutti".
Un profilo di accesso è un pacchetto "widget → profilo del modulo" (`access_profiles`, migrazione 027: name unico, description,
is_default con indice parziale che ne ammette uno solo, items jsonb `[{module_key, profile}]`, sort_order). Tre profili seminati una
volta sola (ON CONFLICT DO NOTHING, il CEO li modifica dall'Amministrazione): **Default** (predefinito: rubrica LETTORE, ticket
RESPONSABILE, circolari VIEWER, sgi LETTORE, cartella ADMIN, room VIEWER, retail VIEWER), **Site Manager** (Default + nc SEDE, orders
SEDE, cash ADMIN, room PLANNER, retail SEDE), **Direzione** (rubrica LETTORE, ticket RESPONSABILE, circolari PUBBLICATORE, nc SEDE, sgi
EDITOR, service EDITOR, orders SEDE, cartella ADMIN, cash ADMIN, room PLANNER, retail SEDE, integration EDITOR, business VIEWER,
comunicazione EDITOR; Room indicata due volte dal CEO, vale Planner). Circolari e Ticket sono open_to_all: il grant si crea lo stesso
perché fissa il profilo. `grants.profile_id` dice da quale profilo è nato un grant (ON DELETE SET NULL: eliminando il profilo i
permessi restano); nuova sorgente `PROFILE` nel CHECK di `grants.source`.
Applicazione (`lib/accessProfiles.js`, `applyProfile(profileId, userIds, { actorId, mode })`): i grant nascono confermati (proposed
FALSE, source PROFILE); sui moduli con `scope_type = 'SITE'` l'ambito è la sede della persona (people.site_id, altrimenti users.site_id);
senza sede il grant nasce senza ambito e il rapporto lo segnala (per i profili "scoped", che la sede la richiedono). Modalità
**merge** (predefinita): aggiunge ciò che manca; aggiorna un grant esistente solo se era una proposta (dall'organigramma) o nato da un
profilo; un grant manuale (MANUAL/LEGACY/SEED) con profilo diverso resta e finisce negli avvisi; un grant nato da un altro profilo non
viene declassato (ordine di forza dei profili come in grantRules: così "Applica il Default a tutti" non toglie nulla a chi ha Site
Manager o Direzione, e lo segnala); un grant uguale resta ("lasciato") e si aggancia al profilo se non ne aveva uno. Modalità
**replace** (solo via API, su richiesta esplicita): sostituisce tutti i grant dell'utente con quelli del profilo. Rispetta le regole di
users.js: i moduli riservati li assegna solo il titolare (per un amministratore vengono saltati con avviso), il titolare lo modifica
solo il titolare. Una modifica manuale del grant (PUT /users/:id/grants/:module, bulk) lo sgancia dal profilo (profile_id NULL,
source MANUAL): da lì in poi nessun profilo lo tocca. Rapporto `{ users, added, updated, kept, removed, warnings, rows }`.
`applyDefaultProfile(userId, actorId)` viene chiamata in `ensureUserForPerson` (accesso dalla persona, importazioni, accessi mancanti)
e nella creazione da Amministrazione > Utenti dopo i grant indicati: ogni nuovo account parte col Default senza perdere quanto scelto a
mano. `applyDefaultToAll` lo applica a tutti gli utenti ACTIVE/PENDING.
Route `/api/access-profiles` (`routes/accessProfiles.js`): GET elenco con conteggio utenti, GET /:id con gli utenti, POST/PUT/DELETE
(requireOwner, validazione degli item contro il catalogo moduli, un solo predefinito), POST /:id/apply { user_ids, mode } e POST
/default/apply-all (requireAdmin). Audit: ACCESS_PROFILE_CREATED / UPDATED / DELETED / APPLIED (con conteggi e avvisi nei dati).
Interfaccia: Amministrazione > Accessi > **Profili di accesso** (`pages/admin/AccessProfiles.jsx`): elenco con widget inclusi, numero
di utenti e badge Default; finestra di creazione/modifica (nome, descrizione, interruttore "profilo predefinito per tutti i nuovi
utenti", tabella widget → profilo per area con "Nessuno" che toglie la riga; solo lettura per gli amministratori non titolari);
"Applica il Default a tutti gli utenti" con conferma e rapporto. In **Utenti**: casella a inizio riga e in intestazione (seleziona tutti
i filtrati; il titolare lo seleziona solo il titolare), barra "N utenti selezionati · Assegna profilo ▾ · Annulla selezione", conferma
che spiega cosa succede, toast e rapporto (aggiunti / aggiornati / lasciati / avvisi, tabella per utente); la selezione si azzera al
cambio di filtri o pagina. Nella scheda utente "Applica profilo" con la stessa tendina; le righe dei grant nati da un profilo mostrano
"dal profilo <nome>" al posto della tagline. Collaudo con db dedicato (API: seed, nuovo utente col Default, merge che non declassa,
scope sede, replace, permessi admin/titolare, apply-all, audit) e Playwright (docs/screens/profili-*.png).

## Room Planning: portale dei professionisti per gli interni e scorrimento della planimetria (28/10/2026)
Richieste del CEO, testuali: "In Room Planning: il super amministratore, l'amministratore e il Planner vede anche riepilogo! E può
selezionare il singolo professionista." "Idem per le mie disponibilità." "Nella pagina della planimetria, non si può scorrere
(alto/basso) la pagina."
Portale: le pagine Riepilogo (`portale`) e Disponibilità (`disponibilita`) restano per il PROF nel gruppo "Il mio portale" (voci con
`onlyProfiles`, invariate: nessuna tendina, solo se stesso) e compaiono anche per ADMIN e PLANNER nel gruppo "Portale dei
professionisti" (il titolare della Suite nel modulo è ADMIN: `defaultAdminRole`; non esiste un profilo SUPERADMIN in Room, i profili
sono ADMIN, PLANNER, RESP_SAN, PROF, VIEWER). In cima alla pagina una tendina cercabile "Professionista" (`PersonaPicker` in
pages/Portale.jsx: elenco di `GET /api/room/portale/professionisti`, cioè le persone attive dell'anagrafica unica con scheda Room in
`person_ext`) carica riepilogo e disponibilità della persona scelta; la scelta vive nell'indirizzo (`?persona=`) e nella sessione del
browser, così passando da una pagina all'altra resta. Server (routes/portale.js): tutte le API del portale accettano `?person_id=`
solo per ADMIN e PLANNER (403 per PROF, RESP_SAN, VIEWER; 404 se la persona non ha la scheda Room); `req.prof` è la persona scelta e
`req.perConto` lo segnala. Le modifiche delle disponibilità per conto del professionista (DISP_ADD, DISP_UPDATE, DISP_DELETE) vanno
nel registro attività con l'autore interno e `data = {per_conto, person_id, persona}`; recapiti personali (PUT /me) e candidature
restano del solo professionista (403 per conto). RESP_SAN e VIEWER senza `person_id` continuano a vedere, se collegati a una persona,
il proprio portale come prima.
Planimetria (pages/SedePage.jsx, scheda Planimetria del planner): la regola generale della Suite `.tabs { overflow-x: auto }` si
applicava anche ai tab del planner, che diventavano un contenitore scorrevole di 1 px in verticale (bordo inferiore del tab attivo):
dopo il clic su "Planimetria" il fuoco resta sul tab e lo scorrimento da tastiera e trackpad (PageDown, frecce, Fine) finiva nel tab,
non nella pagina, con una barra di scorrimento spuria accanto ai tab (visibile nella schermata del CEO). Correzione in
modules/room/styles.css: `.page.rp .tabs { overflow: visible }`. Nessun listener sulla rotellina: la pianta non ha zoom, la pagina
scorre normalmente anche sopra la planimetria. Collaudo Playwright con sede dalla planimetria alta, due professionisti con scheda Room,
utenti PLANNER, PROF e VIEWER: docs/screens/room-portale-*.png e room-planimetria-*.png.

## Contratti del personale: dati di base e casella di recruiting (28/10/2026)
Segnalazione del CEO: "non funziona l'algoritmo effettivamente costruito nell'app originale di Contracts". Causa: con la
partenza da zero mancavano i dati di base che l'app originale seminava all'avvio (livelli e minimi tabellari CCNL Studi
Professionali con le tranche 2024-2026, sezioni di sintesi, requisiti del dossier), quindi la scomposizione della RAL non aveva
il minimo tabellare: paga base = RAL/14, superminimo e indennità a zero. Ora lib/seed.js (`ensureSeed`, job `contracts:dati-base`
all'avvio e ogni giorno, idempotente) inserisce livelli, minimi, sezioni e requisiti; la scomposizione torna quella delle lettere
(es. livello 1, RAL 40.000: paga base 2.131,39, superminimo 217,72, indennità 508,03).
CV Box: il CEO chiede se la casella recruitment@toscanadiagnostica.it è letta. Non lo era (né nell'app originale: solo
caricamento manuale). Costruito lib/inbox.js: ogni 10 minuti (modulo LIVE) legge con Microsoft Graph le email con allegati della
casella (impostazioni cv_inbox, cv_inbox_enabled) e crea un CV per ogni allegato PDF/Word (mittente come candidato, oggetto come
riferimento, sintesi AI se attiva), senza doppioni (cv_box.graph_id, migrazione 018); stato e "Leggi ora" in cima al CV Box.
Richiede sull'app registration della Suite il permesso applicativo Mail.Read sulla casella recruitment@.

## Payments: Scadenziario strutture (28/10/2026)
Richiesta del CEO, testuale: "Ci servirebbe un sistema per mappare tutti gli affitti con tutte le utenze in modo che mi avvisi dei
pagamenti e che possiamo consultarlo per tenere tutti gli scatti e per prevedere i costi futuri. Integriamola come funzione su
Payments." Costruita prima in Cash Management e poi, per correzione di rotta del CEO, spostata per intero nel widget Payments (modulo
`finance`) e collegata alle istanze di pagamento; da Cash è stata rimossa senza tracce (la migrazione 014 di cash non era mai stata
applicata in produzione). Voce di menu "Scadenziario strutture" (gruppo "Affitti e utenze", badge con le scadenze scadute o entro 7
giorni), pagina `web/src/modules/finance/pages/Schedule.jsx`, route `/api/finance/scadenziario` (`routes/schedule.js`), logica pura in
`lib/schedule.js`, dati, badge, avvisi e aggancio alle istanze in `lib/scheduleData.js`, creazione condivisa delle istanze in
`lib/requestCreate.js`, migrazione `002_scadenziario.sql`.
**Anagrafica**: le sedi sono `public.sites` senza perimetro per utente (Payments non ha sedi per utente; le strutture dei clienti service
restano fuori), scelte da `GET /scadenziario/sites` con conteggi di contratti, utenze, volture aperte e prossima scadenza; locatore e
fornitore sono Legal entity facoltative (`landlord_org_id`, `supplier_org_id` → `public.organizations`, elenco `GET /scadenziario/organizations`
con `has_iban`) con un nome libero se la controparte non è in anagrafica (se vuoto vale quello della Legal entity); il **beneficiario
Payments** (`beneficiary_id` → `finance.beneficiaries`, tendina con ricerca su `GET /beneficiaries?q=` e "nuovo dal locatore / fornitore":
`POST /scadenziario/beneficiaries { org_id | name }` crea il beneficiario con nome e P.IVA/CF della Legal entity e ne importa l'IBAN se il
core ce l'ha) è il collegamento con le istanze. Nessun dato di esempio.
**Tabelle** (schema finance): `lease_contracts` (sede, locatore, beneficiary_id, immobile, tipologia COMMERCIALE_6_6 / 9_9 / ABITATIVO_4_4
/ 3_2 / TRANSITORIO / COMODATO / ALTRO, decorrenza, primo periodo e rinnovo tacito in anni, preavviso in mesi, periodicità 1/2/3/6/12,
prima scadenza, deposito, registrazione IMPOSTA_ANNUALE / UNICA_SOLUZIONE / CEDOLARE_SECCA / DA_REGISTRARE, istat, auto_pay,
`business_contract_id` come solo riferimento al contratto SEDE del widget Business, note, active); `lease_steps` (scatti del canone:
importo valido da una data, motivo INIZIALE / ISTAT / RINEGOZIAZIONE / ALTRO, variazione %, UNIQUE per contratto e data; il canone vigente a
una data è l'ultimo scatto con `valid_from <= data`; il salvataggio di un contratto con importo iniziale crea o aggiorna lo scatto INIZIALE);
`utilities` (sede, tipo ENERGIA / GAS / ACQUA / TARI / TELEFONIA / CONDOMINIO / VIGILANZA / PULIZIE / ALTRO, fornitore, beneficiary_id,
POD/PDR, intestatario, voltura DA_AVVIARE / IN_CORSO / COMPLETATA / NON_NECESSARIA, fatturazione 1/2/3/4/6/12 mesi, scadenza nota, importo
medio, fine offerta, addebito automatico); `utility_bills` (bollette registrate: periodo, scadenza, importo, consumo, pagata il);
`schedule_done` (esiti: chiave dell'evento, sede, chi e quando, nota, importo pagato, `request_id` dell'istanza eseguita); `schedule_requests`
(event_key → payment_requests.id: istanza creata dalla scadenza); `schedule_notified` (avvisi già inviati).
**Eventi** (`buildEvents`, mai salvati; chiave `<tipo>:<lease|utility>:<id>:<data>`): rata del canone a ogni periodo (importo = scatto
vigente); adeguamento ISTAT all'anniversario (se istat); imposta di registro entro 30 giorni dall'annualità (F24 ELIDE, stima 2% del canone
annuo, minimo 67 euro) se IMPOSTA_ANNUALE; scadenza del contratto con rinnovi taciti (un contratto scaduto senza rinnovo compare sempre
finché non viene segnato o cessato); termine di disdetta; bollette attese da scadenza nota + fatturazione (stima = media delle bollette
degli ultimi 12 mesi, altrimenti importo medio, segnate "~"); le bollette registrate sostituiscono la stima (importo reale, fatta se pagata);
fine offerta. Scadute = data passata, non fatta, non automatica. Ogni evento porta l'istanza collegata (`request`: id, protocollo, stato,
importo). Finestra predefinita 60 giorni indietro, 400 avanti.
**Istanze dalle scadenze** (la parte nuova): su canoni, imposta di registro e bollette non pagate il pulsante "Crea istanza" chiama
`POST /scadenziario/events/request { key, amount? }` (SUPPORT e amministratori): per le stime l'importo si conferma prima. L'istanza nasce in
bozza con la stessa funzione di `POST /requests` (`createRequest` in lib/requestCreate.js: `requestSchema`, `prepare`, `upsertBeneficiary`,
nessuna regola duplicata): data di oggi, richiedente = utente, beneficiario dal beneficiario Payments del contratto/utenza (ultimo IBAN noto,
prima quelli verificati) oppure dal nome del locatore/fornitore e dalla Legal entity collegata (name, vat_number/tax_code, iban, bic,
bank_name); importo della scadenza; causale "<titolo> <sede> <periodo o data>"; doc_type CONTRATTO (doc_number unità e locatore, doc_date
decorrenza) per canoni e registro, FATTURA (doc_number codice utenza) per le bollette; SEPA (F24 per il registro); valuta = data della
scadenza; prior_approval vero con riferimento "Contratto di affitto" / "Utenza" per canoni e bollette (pagamenti ricorrenti già approvati;
lo schema lo ammette in ogni scaglione: oltre soglia la delibera CdA è soddisfatta anche dall'approvazione preventiva), falso per il
registro; note "Scadenziario: <key>". Senza IBAN la richiesta fallisce: "Indica l'IBAN del locatore/fornitore nel beneficiario Payments o
nella Legal entity". Il collegamento va in `schedule_requests`; in agenda la scadenza mostra "Istanza AP-2026-0001 · stato" con link a
`/finance/istanze/:id`. Quando l'istanza passa a ESEGUITA (`POST /requests/:id/execute`) la scadenza viene segnata fatta da sola
(`schedule_done` con request_id, importo eseguito, nota "Istanza <protocollo> eseguita il ..."; una bolletta registrata prende `paid_at`);
se viene ANNULLATA (`/cancel`) o RIFIUTATA (routes/sign.js) il collegamento cade e la scadenza torna aperta (`onRequestStatus` in
lib/scheduleData.js). La Previsione ha la riga "Istanze già create" (istanze collegate in bozza, in firma o autorizzate, per mese della
scadenza) sotto il totale di rete, e il KPI corrispondente. Il cruscotto di Payments ha il riquadro "Scadenze strutture" (scadute, entro 30
giorni e importo in arrivo, canoni al mese, volture aperte, prossime scadenze; `schedule` in `GET /stats/summary`).
**KPI, previsione, avvisi**: come nella versione Cash (scadute, entro 30 giorni, disdette entro 6 mesi, volture aperte, canoni al mese;
previsione per sede e mese con rivalutazione ISTAT ipotetica `schedule_istat_pct`, imposta di registro, crescita utenze
`schedule_utility_growth_pct`, confronto con i 12 mesi precedenti registrati). Job `finance:scadenziario` (360 minuti, anche all'avvio, solo
LIVE): per ogni scadenza entro `schedule_alert_days` giorni o scaduta, non fatta e non automatica, non ancora in `schedule_notified`, una
notifica in app (`notify` della Suite, kind INFO, module_key finance, titolo "Scadenza: <titolo> · <sede>", corpo con importo, data e istanza
collegata, link `/finance/scadenziario?site_id=…`) agli utenti della Suite con grant finance nei profili `schedule_notify_roles`
(predefinito CEO,CFO,SUPPORT; con SUPPORT anche titolare e amministratori della Suite). `GET /badges` espone `scadenziario`.
**Accesso**: tutti gli utenti del modulo leggono; SUPPORT e amministratori (`canManage`) scrivono contratti, scatti, utenze, bollette e
creano istanze; CEO e CFO possono inoltre segnare gli esiti; VIEWER sola lettura. Validazione zod, audit LEASE_* / LEASE_STEP_* /
UTILITY_* / UTILITY_BILL_* / SCHEDULE_DONE / SCHEDULE_UNDONE / SCHEDULE_REQUEST_CREATE / BENEFICIARY_CREATE. Export
`GET /scadenziario/export.xlsx` (fogli Agenda, Contratti, Utenze, Bollette, Previsione). Test `server/test/finance-schedule.test.mjs`.
Schermate docs/screens/finance-scadenziario-*.png.

### Contratto di affitto in PDF letto con Claude (28/10/2026)
Richiesta del CEO, testuale: "Anche con l'utilizzo dell'API di Anthropic, permetti l'upload del contratto PDF e riconosci sede, importi,
locatore, durata." Nel form "Contratto di affitto" un riquadro in alto ("Carica il contratto in PDF") accetta il PDF (fino a 20 MB, SUPPORT
e amministratori): `POST /api/finance/scadenziario/leases/analizza` (multipart `file`) salva il documento in `finance.lease_documents`
(migrazione 003: bytea o percorso nel blob della Suite tramite `server/src/lib/moduleStorage.js`, condiviso con Business; `lease_id` resta
vuoto finché il contratto non viene creato), estrae il testo con `server/src/lib/pdftext.js` (pdftotext -layout; OCR tesseract se il PDF
è una scansione, con avviso; la stessa libreria usata dai Referti esterni, che ne conserva le firme), lo tronca a 60.000 caratteri con
avviso e lo passa a Claude (`askJson` di lib/claude.js, kind `lease_contract`, maxTokens 3000, registrato in `ai_log`; il contratto di
locazione non contiene dati di pazienti) con un prompt di sistema in italiano da trascrittore fedele: locatore (ragione sociale, P.IVA, CF,
indirizzo, PEC, legale rappresentante), conduttore, immobile (indirizzo, città, descrizione, dati catastali), durata (decorrenza, anni,
rinnovo, preavviso, scadenza), canone (importo e periodo della rata, IVA, rate iniziali diverse anche in forma strutturata, ISTAT, deposito,
fideiussione, spese), registrazione, tipo di contratto, clausole rilevanti e `confidenza` per campo (alta/media/bassa) con la citazione
testuale. Senza chiave Anthropic la richiesta risponde 400 "Intelligenza artificiale non configurata: inserisci la chiave Anthropic in
Amministrazione > Impostazioni". Poi (`lib/leaseAnalysis.js`, `buildProposal`) abbina la sede TD per città e indirizzo dell'immobile
(`matchSite` di `server/src/lib/anagraficaMatch.js`, estratta dal caricamento pacchetti di Business e condivisa, con il criterio
"città e indirizzo" in più), il locatore alle Legal entity per P.IVA, CF o nome (`matchOrg`) e il beneficiario Payments per P.IVA o nome;
risposta `{ document_id, extracted, proposta: { site_id, site_label, site_how, landlord_org_id, landlord_label, landlord_how, beneficiary_id,
lease (campi del form), initial_steps, confidence }, avvisi }` (OCR, testo troncato, conduttore diverso da Toscana Diagnostica, campi a bassa
confidenza, rate iniziali diverse, sede o locatore non abbinati).
Nel form i campi si precompilano e ogni campo letto mostra una spilla (verde alta, gialla media, rossa bassa; al passaggio del mouse la
citazione); sede e locatore proposti con il criterio di abbinamento; se il locatore manca, "Crea Legal entity dal contratto"
(`POST /scadenziario/organizations { from_document_id }`: public.organizations kind PARTNER con needs_review, P.IVA, CF, indirizzo, PEC;
se esiste già la restituisce). Gli avvisi in un riquadro giallo. L'utente controlla e salva: nessun salvataggio automatico. `POST /leases`
accetta `document_id` (collega il documento) e `initial_steps`: con rate iniziali diverse (caso Pratignone: 15-30/04/2026 2.500, maggio
5.000, da giugno 7.300) nascono gli scatti ALTRO per i periodi ridotti e lo scatto INIZIALE con l'importo a regime dal primo giorno
successivo (la coppia contratto/data è unica, quindi INIZIALE non può stare alla decorrenza insieme alla prima rata ridotta), così il
calendario parte giusto. `GET /leases/:id` e l'elenco restituiscono i documenti; `POST /leases/:id/documenti` allega senza analisi,
`GET /documenti/:id` scarica (inline), `GET /documenti/:id/lettura` restituisce la proposta salvata, `DELETE /documenti/:id`. Nella scheda
Strutture ogni contratto mostra i documenti (icona, download, eliminazione, "Aggiungi documento"). Su un contratto esistente "Rileggi dal
PDF" (`POST /leases/:id/analizza`, documento collegato subito) propone le differenze campo per campo (attuale vs letto, con spilla e
citazione) da applicare con una spunta e poi salvare.
Limiti: lettura assistita, da verificare sempre sul contratto (il modello trascrive, non interpreta; i campi a bassa confidenza sono
segnalati); nessun salvataggio automatico; ogni chiamata in `ai_log` senza il testo del contratto. Collaudo senza chiave: `FINANCE_AI_MOCK=1`
(letto solo con NODE_ENV diverso da production) sostituisce il modello con un estrattore a espressioni regolari (`mockExtract`, stesso JSON,
avviso "Lettura di prova" nella risposta) provato sul contratto del laboratorio di via del Pratignone; il prompt reale resta quello per
Claude. Schermate docs/screens/finance-scadenziario-pdf-{analisi,differenze}.png.

## Contatori dei widget nella Home (28/10/2026)
Segnalazione del CEO: "non vedo le notifiche sulle icone dei widget". I contatori delle card della Home (GET /api/home/counters, lib/legacy.js)
erano definiti solo per gli otto moduli travasati (NC, Ordini, Cash, Payments, Integration, Spedizioni, Room, Contratti del personale).
Aggiunti Business (contratti in scadenza entro 60 giorni e fascicoli aperti), Retail (richiami scaduti), Ticket (ticket aperti), Circolari
(bozze), Cartella (documenti nuovi negli ultimi 7 giorni) e Comunicazione (contenuti in bozza e avvisi attivi, letti nel core). Il
contatore di Integration ora segue lo schema della Suite (target = Legal entity, data di fine sull'attività) e conserva la query legacy per
l'app di origine. Cache di 5 minuti, visibilità per grant come prima; SGI e Portale Service sono portali esterni e non hanno contatore.

## Room Planning: responsabile di sede dall'organigramma (28/10/2026)
Segnalazione del CEO: la tabella delle sedi e la scheda non riportavano responsabile e email indicati in Amministrazione. Room leggeva
`public.sites.manager_name` (testo libero che la Suite non compila più). Migrazione room 009: `sites_v` espone `manager_name`,
`manager_email` e `manager_person_id` dal capo del nodo Sede dell'organigramma (stessa regola di Amministrazione > Sedi), con riserva sul
testo libero. La scheda mostra "Site manager (dall'organigramma)"; il campo "Email del site manager" resta un'eccezione facoltativa: vuoto
significa che conferma le presenze il responsabile dell'organigramma (la sua email compare come suggerimento), e `siteManagerSedi` segue la
stessa regola.

## Referti esterni (28/10/2026)
Richiesta del CEO, testuale: "Vorrei generare un WIDGET da includere in Area Operations destinato al SOLO personale di laboratorio. Il
funzionamento è semplice. In input un file PDF. In output DOCX e PDF in formato Toscana Diagnostica. Aggiungici un archivio che per ogni riga
riporta cognome e nome della paziente e 3 icone: PDF di partenza, DOCX trasformato, PDF trasformato." Specifica della routine (sorgenti, parser,
format canonico, casi particolari) nel documento td-referti-ext consolidato nelle sessioni 08/09–24/10/2026.
Modulo nativo `referti` in Operations (dopo Spedizioni), kind LEGACY senza app di origine, parte vuoto e LIVE con "Avvia" (FRESH_MODULES).
`open_to_all` FALSE: il widget lo vede solo chi ha il grant. Profili: **LAB** "Laboratorio" (carica, corregge, anteprima, conferma, scarta),
**QUALITA** "Qualità" (archivio, registro, export, impostazioni e template; nessuna elaborazione), **VIEWER** "Consultazione"; Owner e Admin
della Suite sono ADMIN del modulo (lib/access.js, qualunque profilo porti il loro grant). Regole di accesso iniziali: Laboratorio di Analisi →
LAB, HSQ Management → QUALITA. Nessuna anagrafica propria: `uploaded_by`, `confirmed_by`, `registro.user_id` → `public.users`.
**Schema `referti`** (migrazione 001): `elaborazioni` (PDF caricato: filename, size, sha256, data bytea o blob_path, pagine, sorgente rilevata,
stato CARICATO/ELABORATO/SCARTATO con motivo, ocr), `schede` (un paziente: pagine int[] del sorgente, sorgente BIANALISI/CERBA_RDI/
CERBA_NUOVA_IGEA/ALTRO, colonne di ricerca cognome_nome/data_nascita/sesso/accettazione/data_acc/referto_codice/referto_data, `dati` jsonb
modificabile = JSON intermedio {anagrafica, settori, esami, antibiogrammi, note, corpo 1|2}, `dati_orig` uscita del parser, `testo_sorgente`,
`anomalie` [{codice, testo}], stato BOZZA/CONFERMATA/SCARTATA, nome_file, sostituisce_id/sostituita_da, confirmed_*), `file_prodotti`
(SORGENTE_PDF/DOCX/PDF con contenuto a due vie o rimando al PDF intero dell'elaborazione, flag `intero`), `registro` (azione, user_id, dettagli),
`app_settings`, `templates` (DOCX della carta intestata caricato dalle Impostazioni). File su Azure Blob quando configurato, altrimenti bytea
(lib/storage.js, stesso schema di Business).
**Flusso** (routes su /api/referti): `POST /elaborazioni` (PDF multipli, multer in memoria, 20 MB l'uno) → `pdftotext -layout` pagina per pagina
(lib/pdf.js; sotto 40 caratteri/pagina OCR con tesseract: `-l ita`, ripiego su `eng` se il pacchetto manca, anomalia "OCR: verifica manuale
obbligatoria") → rilevamento della sorgente dall'intestazione (lib/parsers/index.js; senza intestazione nota né anagrafica riconoscibile il PDF
è SCARTATO con motivo) → spezzamento dei merge per paziente (nuova scheda quando cambiano cognome/nome + accettazione nell'intestazione di
pagina, le pagine senza intestazione sono continuazione) → parser della sorgente (corpo1.js per Bianalisi e Cerba RDI: tabella esame |
risultato | [U.M.] | riferimento con sottorighe Metodo/Materiale/Sede, antibiogramma testuale "Sensibile - MIC <=4", legenda EUCAST, valori
spezzati ricomposti; cerbaNuovaIgea.js per il corpo 2: blocchi esame con etichetta/valore, esiti lunghi integrali, antibiogramma tabellare
"Microrganismo #n" + "Carica Batterica" + legenda della sorgente + righe S/I/R MIC, due microrganismi affiancati "#1 MIC #2 MIC" separati in due
tabelle omettendo per #2 gli antibiotici vuoti) → schede in BOZZA con anomalie (anagrafica abbreviata/incompleta, OCR, valore ricomposto, carica
assente, due microrganismi, nota di sostituzione, nome file già presente, riga non interpretata: ciò che il parser non riconosce finisce in
righe "testo libero" del settore corrente, mai perso). `GET /schede/:id`, `PATCH /schede/:id` (LAB: JSON intermedio e nome file),
`POST /schede/:id/anteprima` (DOCX+PDF temporanei in base64 + checklist), `POST /schede/:id/conferma` (controllo di coerenza §5.4 in lib/coerenza.js:
token risultato della sorgente presenti nel testo del DOCX, stesso numero di antibiotici (conteggio indipendente sul testo grezzo), nessun
numero in più, anagrafica completa; se fallisce 400 con la checklist salvo `force: true` tracciato come forzatura; poi file definitivi
`Referto - COGNOME NOME.docx/.pdf`, suffisso tra parentesi se un'altra scheda confermata ha lo stesso nome (regola ESAME/SORGENTE/DATA dalle
Impostazioni), sovrascrittura tracciata (azione SOSTITUZIONE, `sostituita_da`) se la scheda porta la nota "annulla e sostituisce"),
`POST /schede/:id/scarta`, `POST /elaborazioni/:id/conferma-verdi` (schede senza anomalie), `GET /archivio?q=&from=&to=&sorgente=` (una riga per
scheda confermata con i tre file; `GET /file/:id[?inline=1]`; il PDF sorgente di un merge si ritaglia alle pagine della scheda con pdf-lib se
installato, altrimenti si restituisce il PDF intero con `intero=true` e lo si dice in pagina), `GET /registro`, `GET /registro.xlsx` (ExcelJS),
`GET/PUT /settings` e `POST/DELETE /settings/template` (admin o QUALITA), `GET /badges` {da_confermare}.
**Generatore** (lib/docgen.js): corpo con la libreria `docx` secondo il format canonico §4 (A4, margini 2/2/2 cm e superiore 3,94 cm, Lato,
colori 004F5F/5A6B70/1A1A1A/C9E1E6/42B2BF/EAF5F7, riquadro anagrafico a destra 4479 twip, titoli di settore 12,5 pt con filetto, corpo 1
tabella 3969/3061/2608, corpo 2 etichetta/valore 4309/3628/1701 e antibiogramma 4876/1928/1474 con testata 004F5F e righe alternate, note
7,5 pt grigie), poi **trapianto OpenXML** nel template della carta intestata: `word/document.xml` del template sostituito con il corpo generato
mantenendo il `sectPr` del template (header, footer con numero di pagina, media e rels restano quelli del template). Template predefinito:
`templates/carta_intestata_default.docx` = copia di `offerta_service.docx` di Business (logo e contatti TD, piè di pagina a 3 righe), con i
margini canonici applicati; se dalle Impostazioni si carica un DOCX (es. "Referto - BARONI VERA.docx") il generatore usa header, footer e
sectPr di quello. PDF con `docxToPdf` di Business (soffice headless, coda sequenziale).
**Web** (web/src/modules/referti): Inbox (zona di caricamento multipla, esito per file, schede da confermare con badge, elaborazioni recenti con
"Conferma tutte le verdi"), Scheda (PDF sorgente in iframe `#page=N` a sinistra, anteprima PDF TD a destra rigenerata al salvataggio, anomalie
in giallo, checklist di coerenza, pannello dati editabile per anagrafica, settori/righe, esami, antibiogrammi, note; pulsanti Anteprima,
Conferma, Conferma comunque, Scarta), Archivio (una riga per paziente con le tre icone e ricerca/filtri), Registro (tabella + XLSX),
Impostazioni (cartella OneDrive informativa, genera anche PDF, retention, suffisso, template), Guida. Icona `referti` in Icons.jsx.
**Privacy**: nessun nome di paziente nei log del server né nelle notifiche; audit della Suite con soli id e conteggi; retention dei PDF sorgente
configurabile (job `referti:retention`). Dockerfile: `poppler-utils`, `tesseract-ocr`, `tesseract-ocr-ita`, `fonts-lato`.
**Collaudo**: db dedicato, API (upload dei 4 PDF di prova di cui uno scartato, merge spezzato in 3, due microrganismi, PATCH, anteprima, coerenza
fallita e superata, conferma, conferma comunque con suffisso, conferma verdi, archivio con i tre file scaricabili, registro ed export, badge,
permessi VIEWER/QUALITA/LAB, OCR su PDF immagine), test `node --test server/test/referti-parsers.test.mjs` (parser, generatore, coerenza,
trapianto), Playwright (docs/screens/referti-{inbox,scheda,archivio,registro,impostazioni,home-widget}.png).
**Limiti e cose da verificare**: i PDF di prova sono sintetici (server/test/fixtures/referti/genera.py): **i parser vanno ricalibrati sui PDF
reali** appena il CEO li fornisce (posizioni delle colonne, intestazioni, legenda, note); il **template della carta intestata del referto**
(luglio 2026) va caricato dalle Impostazioni, finché manca si usa l'intestazione dell'offerta Service; l'archiviazione automatica nella
cartella OneDrive via Microsoft Graph non è ancora attiva (i file si scaricano dall'Archivio); il ritaglio del PDF sorgente dei merge richiede
`pdf-lib` (non installato: si restituisce il PDF intero); il font Lato va installato sull'immagine (fonts-lato nel Dockerfile) perché il PDF lo
usi davvero; nessun invio al paziente o alla sede, nessuna importazione in StudioLAB, nessuna firma digitale.

## Referti esterni: solo dati del paziente e riquadro dei risultati (29/10/2026)
Indicazione del CEO, testuale: "Devi salvare esclusivamente i dati del paziente completi (cognome, nome, sesso, luogo e data di nascita
ed eventualmente indirizzo se c'è) e solo il risultato dell'esame contenuto nel PDF, ovvero il contenuto del riquadro del PDF fornito.
Questo c'era scritto nella routine ed abbiamo sempre fatto fino ad oggi. Correggi eventuali istruzioni errate." La spec td-referti-ext
§3 e §4 riportava tra i campi da trascrivere i codici di referto/accettazione del laboratorio esterno e li metteva nel riquadro
anagrafico del DOCX: istruzione errata, corretta nella spec con nota datata.
**Parser** (lib/parsers): l'anagrafica estratta è cognome_nome, sesso, data_nascita (+ eta se c'è), **luogo_nascita** (nuovo: "Nato/a a",
"Luogo di nascita", comune accanto alla data "Nato il … a …"; nei PDF Bianalisi il codice dopo l'età, es. "TOLAFI", è un codice di sede e
non si legge) e **indirizzo** (nuovo, se presente: "Indirizzo", "Residenza", "Domicilio"). Il corpo è SOLO il riquadro dei risultati:
`separaIntestazione` taglia intestazione e piè e scarta con `isTestoLaboratorio` ogni riga del laboratorio esterno (ragione sociale,
direttore, medico/richiedente, firme, "documento firmato digitalmente", diciture legali, P.IVA, contatti, righe di piè "Referto R3YE… -
NOME"); le note interne al riquadro ("(1) Esame eseguito…", "annulla e sostituisce…") restano. `schede.testo_sorgente` contiene solo la
riga anagrafica sintetica (nome, sesso, data ed età, luogo, indirizzo) più il testo del riquadro, non l'intero PDF; il PDF intero resta
come file di partenza (elaborazioni.data, richiesta precedente del CEO). Il conteggio degli antibiotici della sorgente si fa sul riquadro.
**DOCX** (lib/docgen.js): riquadro anagrafico con nome 12 pt bold, poi Sesso, Data di nascita (con "(anni NN)" se disponibile), Luogo di
nascita, Indirizzo (solo se presente). Tolte le righe Accettazione n°/Data Acc./Referto/Accettazione; nessun riferimento al laboratorio
esterno nel documento. Corpo 1 / corpo 2 come prima, limitati al riquadro.
**Dati e UI**: migrazione referti 002 aggiunge `schede.luogo_nascita` e `schede.indirizzo` (indice su lower(luogo_nascita)); la scheda
mostra i campi del paziente (obbligatori: cognome e nome, sesso, data e luogo di nascita; indirizzo se presente) e, in un gruppo separato
"riferimenti del laboratorio esterno", i codici di accettazione/referto con la dicitura che restano solo nel registro interno; l'archivio
ha la colonna Nascita (sesso, data, luogo), cerca anche per luogo di nascita e mostra il riferimento esterno come "Rif. esterno".
**Scelta documentata**: i codici di accettazione/referto del laboratorio esterno restano SOLO nel registro interno (`schede.accettazione`,
`data_acc`, `referto_codice`, `referto_data`, registro ed export XLSX) come riferimento di tracciabilità ISO 9001 e per spezzare i PDF
merge per paziente; mai nel DOCX né nel PDF TD. Anomalia "anagrafica incompleta: manca …" quando mancano sesso, data o luogo di nascita.
**Coerenza** (lib/coerenza.js): i token provengono solo dal riquadro (più cognome e nome, data e luogo di nascita, indirizzo); le
etichette TD escluse dal confronto dei numeri sono ora Sesso/Data di nascita/Luogo di nascita/Indirizzo; check ANAGRAFICA = cognome e
nome, sesso, data e luogo di nascita; nuovo check inverso **TESTO_LAB_ESTERNO** che fallisce se nel testo del DOCX (tolte le note del
riquadro) compaiono codici R3YE/A3YE, "Accettazione", "Data Acc.", "Referto <codice>", Bianalisi, Rete Diagnostica, Nuova Igea, Cerba,
Limena, via del laboratorio, medico richiedente, direttore, firma digitale, P.IVA.
**Fixture e test**: genera.py aggiornato (luogo di nascita e indirizzo con etichette diverse per sorgente; intestazioni e piè realistici
del laboratorio esterno da scartare: direttore, medico richiedente, validazione/firma digitale, diciture legali, P.IVA, contatti); test
nuovi per anagrafica completa, righe esterne scartate, riquadro isolato in testo_sorgente, DOCX senza codici/testi esterni, coerenza
inversa (token esterno forzato → fallisce; note del riquadro ammesse), anagrafica incompleta.
**Collaudo** (db dedicato, porta 3123): upload dei 4 PDF (3 elaborati, lettera scartata), schede con anagrafica completa salvata nelle
colonne, testo_sorgente senza testo esterno, anteprime con i 5 check superati, PDF reso in PNG con il riquadro nuovo, PATCH con
"Accettazione n° … - Rete Diagnostica Italiana" → TESTO_LAB_ESTERNO e NUMERI_IN_PIU falliscono e la conferma risponde 400 COERENZA,
senza luogo di nascita → ANAGRAFICA fallisce, 5 conferme, archivio con ricerca per luogo. Resta da verificare sui PDF reali la posizione
e le etichette di luogo di nascita e indirizzo (le fixture sono sintetiche) e l'estensione della lista di righe esterne da scartare.

## Referti esterni: riquadro come il modello del CEO e righe spurie (29/10/2026, seconda correzione)
Il CEO ha provato il widget in produzione: nome = "PAZIENTE" (etichetta al posto di CHIARI STEFANIA), settore inventato MICROBIOLOGIA,
righe spurie (TOSCANA DIAGNOSTICA S.R.L. del cliente, testata "Esame | Risultato U.M. Valori di Riferimento", firma digitale
"28-10-2026 15.30 SN=… InfoCamere … Referto firmato da", diciture legali "I risultati di questo referto…", "Regolamento…"), luogo "-".
Modello corretto: /tmp/claude-0/ref_user.pdf (riquadro PAZIENTE / nome / Data di nascita / Sesso / Accettazione n° / Data Acc.; settore
FARMACI; riga "Carbamazepina | 10,6 µg/ml | 4,0 - 12,0" con Metodo/Materiale; nient'altro). La correzione del mattino aveva tolto i
riferimenti di accettazione dal riquadro per un'interpretazione errata: rimessi.
**Parser** (lib/parsers/common.js): `isEtichettaNome` + `nomeRigaSeguente` (il nome è la riga che segue PAZIENTE/Paziente o la stessa riga
dopo i due punti, mai l'etichetta); `isTestataTabella` (segmenti tutti parole di testata); `isFirma` (Firma/Validato/Direttore,
Firmato digitalmente, Referto firmato da, SN=, Emesso dall'Ente Certificatore, InfoCamere, data-ora+SN); `isDicituraLegale` (I risultati
di questo referto, I dati personali, Regolamento, Il laboratorio dove sono state ottenute, GDPR, art.13, D.Lgs., Informativa);
`isFineRiquadro` = piè | firma | dicitura legale: il riquadro dei risultati è ciò che sta tra l'intestazione paziente e la prima di
queste righe, tolte le testate di tabella e le righe con la ragione sociale del laboratorio esterno o del cliente (Toscana Diagnostica
e varianti, "Cliente:"). Intestazione cercata nelle prime 40 righe (prima 14). **Nessun settore predefinito** (corpo1.js,
cerbaNuovaIgea.js): il settore iniziale ha titolo vuoto e prende il primo titolo maiuscolo isolato della sorgente; anomalia
SETTORE_PRESUNTO eliminata. Sorgente ALTRO = corpo 1 a tre colonne con anomalia "sorgente non riconosciuta, verifica", non uno scarto;
`stimaColonne` stima anche la colonna del riferimento (terzo segmento) quando manca la testata; variante B solo con codici Bianalisi.
Anagrafica obbligatoria: cognome e nome, sesso, data di nascita, riferimento di accettazione; luogo di nascita e indirizzo facoltativi
(colonne 002 mantenute). `rigaAnagrafica` del testo sorgente include i riferimenti di accettazione.
**DOCX** (docgen.js): "PAZIENTE" 8,5 pt grigio sopra il nome 12 pt bold, Data di nascita (anni NN), Sesso, Accettazione n° + Data Acc.
(A) oppure Referto + Accettazione con codice e data (B), Luogo di nascita e Indirizzo solo se valorizzati; titolo di settore solo se
presente (corpo 1 e 2).
**Coerenza** (coerenza.js): token anagrafici con i riferimenti di accettazione; ETICHETTE_TD con PAZIENTE/Accettazione n°/Data
Acc./Referto/Accettazione; check ANAGRAFICA = nome, sesso, data, accettazione; TESTO_LAB_ESTERNO esclude le righe del riquadro
"Accettazione n°:", "Data Acc.:", "Referto:", "Accettazione:" e le note del riquadro; nuovo check **RIGHE_SPURIE** (testate di tabella
anche come testo compattato, firme, diciture legali, numeri di pagina, "Toscana Diagnostica" nel corpo).
**Migrazione 003**: solo COMMENT corretti (i riferimenti stanno nel riquadro TD). **Web**: pannello scheda con i riferimenti di accettazione
tra i dati del riquadro, luogo/indirizzo "(se presente)", settore senza titolo ammesso (placeholder), archivio con colonna Accettazione e
luogo solo se presente; Guida aggiornata. **Fixture** `altro_farmaci.pdf` (genera.py): laboratorio esterno sconosciuto, "Cliente: TOSCANA
DIAGNOSTICA S.R.L.", Paziente: CHIARI STEFANIA, 25/05/1965, F, accettazione 3370 del 27/10/2026, testata, FARMACI, Carbamazepina 10,6
µg/ml 4,0 - 12,0, Metodo Immunochimico (KIMS), Materiale SIERO, firma digitale e diciture legali; test: nome corretto, solo FARMACI, una
riga esame, riquadro con accettazione, DOCX con le sole righe attese, corpo senza titolo se la sorgente non ne ha, righe spurie
forzate → RIGHE_SPURIE fallisce. Spec aggiornata in /tmp/claude-0/referti_spec.md e copiata in docs/REFERTI_ESTERNI_routine.md
(tenerle allineate).

## Referti esterni: riquadro definitivo ed eliminazione delle elaborazioni (29/10/2026)
**Riquadro** (docgen.js, dal modello ref_user.pdf): "PAZIENTE" è il titolo del riquadro, 12 pt bold 004F5F; sotto il nome del paziente
9 pt bold 5A6B70; poi le righe 8,5 pt Data di nascita, Sesso, Accettazione n°, Data Acc. (Bianalisi: Referto e Accettazione con codice e
data); Luogo di nascita e Indirizzo solo se presenti. Spec §4 e docs/REFERTI_ESTERNI_routine.md allineati; test sugli stili XML.
**Eliminazione** (richiesta del CEO: "permettimi di cancellare i file da elaborazioni recenti"): `DELETE /api/referti/elaborazioni/:id`
(LAB o admin) elimina l'elaborazione con schede e file prodotti (cascata) e i blob (dropBlobs, anche del PDF sorgente); con referti
confermati risponde 409 `CONFERMATE` con il conteggio finché il body non porta `force: true`. Registro del modulo: azione
ELABORAZIONE_ELIMINATA (filename, pagine, sorgente, schede, confermate, file, forzata, pazienti: nel registro interno i nomi possono
restare); audit della Suite REFERTI_ELIMINA_ELABORAZIONE con soli id e conteggi, niente nomi nei log. `DELETE /api/referti/schede/:id`
(stessa regola, azione SCHEDA_ELIMINATA, audit REFERTI_ELIMINA_SCHEDA; l'elaborazione resta; i puntatori `sostituita_da` verso la
scheda eliminata si azzerano). Web: cestino a fine riga in Inbox > Elaborazioni recenti con ConfirmModal ("Ci sono N referti
confermati: verranno rimossi dall'archivio"; su 409 la finestra resta aperta e il secondo clic manda force), riga che sparisce e badge
aggiornato subito (evento `suite:badges` ascoltato dalla Shell); in Archivio pulsante "Elimina" per singola scheda confermata;
Registro con le due nuove azioni e dettagli. Collaudo su db dedicato (porta 3123): eliminazione senza force → 409, con force → ok,
registro, badge; test 31/31, build Vite.


## Audit SGI: sedi, partner e allineamento al SGI (29/10/2026)
Modulo nativo `audit` in HQS (docs/AUDIT_SGI.md). Nessuna anagrafica propria: gli audit puntano a `public.sites` (`site_id`, sedi con kind
diverso da SERVICE; auto-audit mensile per PUNTO_PRELIEVI, CENTRO_DIAGNOSTICO, CENTRO_MEDICO, POLIAMBULATORIO, LABORATORIO) e a
`public.organizations` (`organization_id`, partner ISO 37001: Legal entity con kind diverso da GRUPPO e SOCIETA). La vista `audit.sites_v`
espone `manager_name`, `manager_email`, `manager_person_id` dal capo del nodo Sede dell'organigramma (stessa regola di room.sites_v e di
Amministrazione > Sedi): è il site manager che compila l'auto-audit e riceve l'alert del 17, insieme a chi ha il grant SITE del modulo
sulla sede. `audit.users` resta riga tecnica (moduleUser); conducted_by/verified_by/generated_by puntano lì.
Tabella core `public.site_sgi_scores` (migrazione 029): `site_id` PK → sites ON DELETE CASCADE, `score` numeric 0-100, `level` A|B|C|D,
`summary` (giudizio troncato a 400), `synthesis_id` (audit.syntheses, senza FK tra schemi), `last_audit_at`, `computed_at`. La scrive il
modulo audit alla sintesi di sede con Claude; la legge Retail Assistant in `GET /api/retail/structure/sites/:id/structure` (campo `sgi`)
per il riquadro "Allineamento SGI" della scheda sede. Nessun altro modulo la modifica.

## Sedi: Legal entity ospitante (29/10/2026)
`public.sites.host_organization_id` → `organizations`: il partner che ospita la sede (es. G.B. Center per il Punto Prelievi di Quarrata, la cui Legal entity resta Toscana Diagnostica S.r.l.). Si imposta in Amministrazione > Sedi (campo "Legal entity ospitante") o da Cash > Sedi (Struttura ospitante): le due scritture si allineano a vicenda; la vista `cash.sites_v` legge `coalesce(sites.host_organization_id, site_ext.host_org_id)` e deriva `ownership`. È la stessa Legal entity con cui il partner accede alla Suite (profilo Partner ospitante): il suo perimetro Cash sono le sedi che lo hanno come ospitante (`lib/esterni.js hostedSiteIds`).

## Shipments: richieste Lifestyle da PDF o email e richiedente Legal entity (30/10/2026)
Richiesta del CEO: in Shipments > Lifestyle > Richieste in arrivo si caricano PDF o email da cui leggere i dati della richiesta, e il
richiedente del kit può essere una Legal entity.
- **Richiedente** (migrazione `shipments/005_lifestyle_requester_upload.sql`): `orders.requester_kind` PERSONA (predefinito: il
  richiedente è il destinatario, come finora) o LEGAL_ENTITY con `requester_org_id` → `public.organizations` (ON DELETE SET NULL),
  `requester_contact` (referente), `requester_email`, `requester_phone`. Il destinatario del kit resta nei campi `patient_*` e
  indirizzo. Kit ordinati da una Legal entity senza paziente nominato: `patient_last_name` = ragione sociale (o reparto) e
  `patient_first_name` = '' (stringa vuota, colonne sempre NOT NULL: liste, etichette, foglio di spedizione, rendiconti e allarmi
  concatenano nome e cognome e restano corretti). Regole in `routes/orders.js checkRequester` (pura in `lib/requestParse.js
  requesterIssue`): LEGAL_ENTITY richiede la Legal entity esistente e un destinatario; PERSONA richiede nome e cognome e azzera i campi
  requester_*. Il vincolo "LEGAL_ENTITY ⇒ org" non è un CHECK sul database perché impedirebbe di cancellare la Legal entity.
- **Comunicazioni e fattura al richiedente**: l'email "kit spedito" (impostazione `notify_patient_on_ship`) va al destinatario se ha
  un'email, altrimenti, con richiedente Legal entity, a `requester_email` o all'email della Legal entity (`lib/requestParse.js
  shipNoticeRecipient`), con testo "il kit da voi richiesto per …". Il modulo non fattura Lifestyle (la rendicontazione economica è
  solo Endeavor, verso Endeavor DNA): il riferimento per la fattura è il richiedente, esposto nella scheda richiesta (riquadro
  Richiedente), nel foglio di spedizione ("richiesto da …"), nella ricerca e nell'export CSV delle richieste (requester_org,
  requester_vat, referente, email, telefono). Le email ad Affinity (Endeavor) non cambiano.
- **Upload** `POST /api/shipments/inbox/upload` (multipart `file`, fino a 10 file da 20 MB; `project` LIFESTYLE predefinito o
  ENDEAVOR; profili SUPERADMIN/ADMIN): PDF (testo con `lib/pdftext.js`, OCR se scansione con avviso), email `.eml` (lettore semplice
  in `lib/requestParse.js parseEml`: From/Subject/Date, parte text/plain o html, PDF allegati letti e accodati), `.txt`; `.msg` → 400
  "salva l'email come .eml o PDF". Il file va nell'archivio a due vie (`lib/moduleStorage.js`, prefisso `shipments-richieste`) e in
  `inbox_messages` (`source` UPLOAD accanto a GRAPH e PASTE già esistenti, `project`, filename/mime/size/sha256/data/blob_path,
  `extracted`, `extracted_model`, `ocr`, `avvisi`, `requester_match`); si scarica da `GET /api/shipments/inbox/:id/file`. Un file
  già caricato (stesso sha256) dà un avviso.
- **Lettura assistita** (solo Lifestyle, `lib/requestReader.js`): `askJson` kind `shipments_lifestyle_request` (ai_log), prompt da
  trascrittore fedele (null dove il testo non dice), maxTokens 2500, testo troncato a 40.000 caratteri con avviso. JSON: richiedente
  {tipo, ragione_sociale, piva, cf, referente, email, telefono}, destinatario {titolo, nome, cognome, indirizzo1/2, cap, citta,
  provincia, paese, telefono, email}, richiesta {tipo KIT_ONLY|KIT_AND_EXAM, quantita_kit, prodotto, riferimento_esterno, note,
  lingua}, confidenza per campo con citazione. Senza chiave Anthropic: 400 "Intelligenza artificiale non configurata…" (il file non
  viene salvato). Il richiedente si abbina con `matchOrg` (P.IVA, codice fiscale, nome anche simile) e la proposta porta il criterio;
  se manca, "Crea Legal entity dal documento" (`POST /api/shipments/inbox/organizations { from_message_id }`) la crea kind CLIENTE,
  `needs_review`, con P.IVA/CF/email/telefono letti (stessa logica dello Scadenziario di Payments: prima matchOrg, poi INSERT).
  Le righe proposte (`parsed`) sono una per kit se `quantita_kit` > 1, con il riferimento esterno numerato (-1, -2…) perché il
  riferimento è unico per richiesta. "Rileggi" rifà righe e abbinamento dal JSON già letto (nessuna nuova chiamata al modello);
  "Rileggi tutte" resta solo Endeavor. Per Endeavor lo stesso upload passa il testo al riconoscitore delle email Affinity
  (`parseKitEmail`), quindi funzionano anche il PDF o l'.eml di un'email "Kits to send out".
- **Interfaccia**: pulsante "Carica PDF o email" (Lifestyle ed Endeavor) con trascinamento di più file e avanzamento; la revisione è
  la stessa finestra delle email incollate, con in testa "Letto dal documento" (spilla verde/gialla/rossa per la confidenza,
  citazione al passaggio del mouse), gli avvisi in giallo e la Legal entity proposta. L'operatore controlla e conferma: niente
  salvataggio automatico. OrderForm ha in cima il blocco Richiedente (Persona / Legal entity con ricerca su
  `GET /api/shipments/organizations?q=`, tutte le Legal entity attive tranne GRUPPO e SOCIETA). Le liste mostrano il richiedente.
- **Conservazione**: alla pseudonimizzazione delle richieste chiuse si rimuovono anche referente/email/telefono del richiedente (la
  Legal entity resta) e, dei messaggi elaborati, il file caricato (database o blob) e il JSON letto.
- **Collaudo**: `SHIPMENTS_AI_MOCK=1` (solo con NODE_ENV diverso da production) sostituisce Claude con un estrattore a espressioni
  regolari (`mockExtract`), segnalato negli avvisi. Test: `server/test/shipments-upload.test.mjs`. Schermate:
  `docs/screens/shipments-lifestyle-{upload,revisione,richiedente}.png`.
