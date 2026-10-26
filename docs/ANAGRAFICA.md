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
