# Accessi esterni dalle Legal entity · partner ospitanti e clienti service

Richieste del CEO (29/10/2026), testuali: "In Cash Management. Ci sono Legal Entity (Partner) che devono poter diventare Utenti.
Pensa alle sedi che ospitano i Punti Prelievo a cui vogliamo far vedere le royalties mensili." e "Pensa anche ai clienti service che
accedono al portale service, alle non conformità, alle circolari, ai ticket, alla rubrica."

## In breve
Una Legal entity (`public.organizations`, kind PARTNER o CLIENTE) può avere utenti della Suite: persone di tipo ESTERNO collegate
all'organizzazione, con credenziali locali e invito email. Nascono dalla scheda Legal entity in Amministrazione con uno dei due
**profili di accesso di sistema**, e il loro perimetro (le sedi che vedono) si calcola dall'organizzazione, non dalla sede della
persona. Il perimetro è applicato nel server, non solo nell'interfaccia (`server/src/lib/esterni.js`).

**Chi è esterno**: ogni utente non interno secondo `lib/audience.js` (`isInternal`): non Owner/Admin, Legal entity diversa da
GRUPPO/SOCIETA (o nessuna) e email fuori dai domini aziendali (`AUTO_INTERNAL_DOMAINS`). Il front-end lo riceve in `/api/auth/me`
come `is_external`.

## I due profili di sistema (`access_profiles.system = TRUE`, migrazione 031)
| Profilo | Chiave | Per chi | Widget → profilo | Ambiti risolti dall'organizzazione |
| --- | --- | --- | --- | --- |
| **Partner ospitante** | `PARTNER_OSPITANTE` | PARTNER o CLIENTE che ospita punti prelievo TD | cash PARTNER, circolari VIEWER, rubrica LETTORE (+ Ticket, aperto a tutti) | cash: scope SITE = tutte le sedi con **Legal entity ospitante** = organizzazione (`public.sites.host_organization_id`, Amministrazione > Sedi; `cash.site_ext.host_org_id` resta allineato e fa da riserva) |
| **Cliente service** | `CLIENTE_SERVICE` | CLIENTE con contratto service (sedi kind SERVICE collegate, o scelto a mano) | service LETTORE, sgi LETTORE, nc SEDE, circolari VIEWER, rubrica LETTORE (+ Ticket) | nc: scope ORG = organizzazione (il perimetro NC, `perimetroSedi`, accetta lo scope ORG: chiave `-org_id`, quindi tutte le NC della Legal entity e dei suoi punti SERVICE) |

Il nome dei profili di sistema non si modifica e non si eliminano (`routes/accessProfiles.js`); gli item sì (il titolare può
aggiungere o togliere widget). Il profilo proposto nella scheda Legal entity (`proposeProfileKey`): sedi ospitate → Partner
ospitante (anche per un CLIENTE); sedi SERVICE → Cliente service; altrimenti dal tipo (PARTNER → Partner ospitante, CLIENTE →
Cliente service); gli altri tipi non hanno proposta.

**Risoluzione degli ambiti** (`resolveExternalScopes`, usata da `applyProfile` per ogni utente esterno e dal riallineamento):
cash → sedi ospitate (SITE); nc → la Legal entity (ORG); altri moduli con ambito ORG → la Legal entity; altri moduli per sede →
le sedi dell'organizzazione (`public.sites.organization_id`). Se l'organizzazione non ospita nessuna sede il grant Cash nasce senza
sedi e il rapporto lo segnala ("non ospita nessun punto prelievi"). Un esterno senza Legal entity: grant senza ambito, con avviso.

**Il profilo Default non si applica agli esterni** (`applyDefaultProfile`, `applyDefaultToAll`): è il pacchetto dei membri della
rete (Cartella condivisa, Room, Retail...); un partner riceve solo il profilo di sistema scelto.

## Come si crea un accesso (Amministrazione > Legal entity > colonna Accessi)
La finestra "Accessi · <Legal entity>" mostra gli utenti collegati (`users.organization_id` o `people.organization_id`) con widget,
perimetro e profilo di provenienza, le sedi ospitate e le sedi SERVICE, il profilo proposto, le persone della Legal entity senza accesso.
**Crea accesso esterno**: cognome, nome, email, ruolo presso la Legal entity, telefono ufficio, profilo (proposto), invio dell'invito.
Si può scegliere un referente già presente in Persone (tipo ESTERNO della Legal entity) per precompilare. Il server
(`POST /api/organizations/:id/external-access`, `routes/esterni.js`):
1. crea la persona se manca (kind ESTERNO, ATTIVO, `organization_id`) o aggancia quella scelta/omonima per email (la porta ad ATTIVO
   e alla Legal entity; rifiuta se ha un'altra email);
2. crea l'utente con la stessa funzione di `POST /api/users` (`createUserAccount`: auth LOCAL, level USER, `organization_id`, password
   provvisoria, invito "Benvenuto in Suite TD"); senza invio dell'invito la password provvisoria viene mostrata una volta;
3. applica il profilo di sistema (merge) con gli ambiti dall'organizzazione; audit `USER_CREATED` con `origin: 'LEGAL_ENTITY'`,
   `EXTERNAL_ACCESS_CREATED` sulla Legal entity.
Le società del gruppo (GRUPPO/SOCIETA) non hanno accessi esterni: 400.

**Riallinea perimetri** (`POST /api/organizations/:id/realign-perimeters`): per tutti gli utenti della Legal entity ricalcola gli
ambiti dei grant nati da un profilo (`profile_id` o source PROFILE) con `resolveExternalScopes`; i grant manuali non si toccano. Da
usare quando TD apre un nuovo punto prelievi presso lo stesso partner (Cash > Sedi > Struttura ospitante) o collega una nuova sede
SERVICE. Idempotente; audit `EXTERNAL_PERIMETERS_REALIGNED`. Anche riapplicare il profilo (Utenti > Applica profilo) completa gli ambiti.

In **Amministrazione > Utenti** la colonna Sede / organizzazione mostra il badge **esterno** (`is_external`, calcolato nel server con
la stessa regola); nella scheda utente "accesso esterno" accanto alla Legal entity. In Profili di accesso i due profili hanno il
badge "Di sistema · esterni".

## Cosa vede un esterno
- **Home**: solo le card dei widget per cui ha un grant o aperti a tutti (Ticket, Circolari); i portali PUBLIC (SGI, Portale Service)
  compaiono solo con il grant (`/home/modules`). Bacheca in sola lettura: niente composer (anche il server rifiuta
  `POST /community/posts` con 403); i post ALL restano visibili come oggi, i post INTERNAL no (audience). Niente compleanni
  (`/community/home` li omette), niente Cartella personale, niente organigramma.
- **Rubrica** (profilo LETTORE): solo le persone ATTIVE delle unità con **contatto pubblico** (`org_units.public_contact`, afferenza
  o incarico) e di ciascuna solo nome, titolo, ruolo, unità, email, telefono ufficio e interno; mai il cellulare, la sede, il
  responsabile, i dati personali (`filterRubricaRow`). `GET /people` filtra nel SQL (`RUBRICA_PUBLIC_SQL`), `GET /people/:id` risponde
  404 fuori dal perimetro, `/people/org-chart`, `/org-chart`, `/org-chart/export.*`, `/people/areas` rispondono 403, il centralino è
  nullo, `/org-units` restituisce le sole unità pubbliche. La pagina si chiama "Contatti di riferimento" (niente Organigramma né Ruoli).
- **Ricerca** (`lib/search.js`): persone solo tra i contatti pubblici, sedi solo del proprio perimetro (ambiti dei grant e sedi della
  Legal entity), Legal entity mai (audience INTERNAL); il resto segue la propria audience.
- **Sedi** (`GET /sites`): solo le sedi del perimetro, senza responsabile, note e riferimenti.
- **Ticket**: apre ticket solo verso le unità con contatto pubblico (catalogo filtrato; `POST /tickets` → 403 altrimenti), per conto
  della propria Legal entity o delle sedi del perimetro; vede i suoi (regole del modulo); nessuna ricerca sugli utenti della rete.
- **Cash (PARTNER)**: `partnerGuard` ammette solo state, stats/summary, export CSV, sites, canoni/*, nc in GET; `GET /cash/sites` restituisce
  le sole sedi ospitate (ambiti SITE); `canoni/sites/:id` di una sede non ospitata → 403 "Sede non autorizzata", di un mese non
  confermato → 403. Menu: "Le tue royalties" (ingresso), "Royalty di sede", "Statistiche"; il resto nascosto (`meta.js`) e rifiutato.
  **Le tue royalties** (`GET /cash/canoni/partner?months=`, pagina `PartnerRoyalties.jsx`): tabella mesi × sedi ospitate dei soli report
  confermati; cella → dettaglio (base di calcolo, quota variabile e percentuale, quota fissa, imponibile, IVA, totale, data di conferma,
  rendiconti considerati) e PDF del report (`/canoni/sites/:id/pdf`). Lo stato del pagamento non è tracciato in Cash: la cella lo dice
  ("segue il flusso contabile ordinario"). Alla conferma del mese l'amministratore fa partire anche una **notifica in app** agli utenti
  con grant cash PARTNER sulla sede (link `/cash/royalties?period=AAAA-MM`, mese evidenziato), oltre all'email alla struttura ospitante.
- **NC (SEDE con scope ORG)**: come oggi per il profilo SEDE: solo le NC inviate alla propria Legal entity, dialogo e risposte.
- **Circolari**: perimetro per segmento già esistente (docs/CIRCOLARI.md): Legal entity PARTNER → Partner, CLIENTE → Clienti service.
- **Portale Service e SGI**: restano collegamenti ai portali esistenti (`/go/<key>` → SSO verso l'app legacy se il segreto è
  configurato, altrimenti il solo link): l'account del portale è separato finché non c'è SSO. Limite dichiarato.

## Contatto pubblico (`org_units.public_contact`)
Flag sulle unità dell'organigramma, impostabile in Amministrazione > Organizzazione > Unità e incarichi (interruttore "Contatto
pubblico", badge nell'elenco). Seme iniziale: Direzione, HSQ Management, Flow & Back Office, Laboratorio di Analisi, Service/B2B,
Retail & Communications (per nome, se esistono): nella migrazione 031 e una volta sola all'avvio o dopo il file Organigramma
(`seedPublicContact` in migrate.js, flag `esterni.public_contact_seeded` scritto quando ha trovato almeno un'area o funzione). Da lì
comanda solo l'Amministrazione.

## File
Server: `migrations/031_accessi_esterni.sql`, `lib/esterni.js` (regole pure e letture), `lib/accessProfiles.js` (ambiti degli esterni,
Default escluso), `routes/esterni.js` (accessi della Legal entity), `routes/users.js` (`createUserAccount`, `origin`,
`access_profile_id`, `is_external`), `routes/accessProfiles.js` (profili di sistema), `routes/core.js` (home, rubrica, sedi),
`routes/orgcat.js` (organigramma, `public_contact`), `routes/community.js` (bacheca, compleanni), `lib/search.js`,
`modules/ticket/routes/tickets.js`, `modules/cash/routes/siteRoyalty.js` (`/canoni/partner`, notifica), `routes/auth.js`
(`is_external`), `migrate.js` (`seedPublicContact`), `routes/importxlsx.js`. Web: `pages/admin/OrgAccess.jsx`, `Registry.jsx`,
`Users.jsx`, `AccessProfiles.jsx`, `People.jsx`, `Home.jsx`, `Community.jsx`, `components/Shell.jsx`, `community/Board.jsx`,
`community/Cards.jsx`, `auth.jsx` (`isExternal`), `modules/cash/{meta.js,index.jsx,pages/PartnerRoyalties.jsx}`.
Test: `server/test/esterni.test.mjs`. Schermate: `docs/screens/esterni-*.png`.

## Collaudo (29/10/2026, db dedicato, porta 3126)
Legal entity PARTNER "Farmacia Rossi" che ospita Calenzano (`site_ext.host_org_id`), report di settembre confermato; accesso esterno
mario.rossi@farmaciarossi.it con Partner ospitante → grant cash PARTNER con scope Calenzano, circolari, rubrica (niente Default);
login con la password provvisoria e cambio password; `/home/modules` = cash, circolari, ticket, rubrica; `GET /cash/sites` solo
Calenzano; `canoni/summary` e `canoni/partner` con il mese confermato (366 €); sede non ospitata 403; mese non confermato 403; PDF 200;
rendiconti e scritture 403; `/people` solo Greco e Neri (unità pubbliche) con i soli contatti d'ufficio, Verdi (Legal) assente e 404;
organigramma 403; `/sites` solo Calenzano; post in bacheca 403; compleanni vuoti; ricerca "Verdi" vuota, "Greco" trovata, "Prato" vuota,
"Calenzano" trovata; notifica in app alla riconferma del mese; ticket verso HSQ aperto, verso Legal 403, per conto di un'altra Legal
entity 403. Riallineo dopo aver ospitato anche Prato: 1 grant cambiato, `GET /cash/sites` due sedi, seconda esecuzione 0 cambiamenti.
CLIENTE "Laboratorio Bianchi" con sede SERVICE → Cliente service: grant service, sgi, nc SEDE (scope ORG), circolari, rubrica; nc
`sedi` = la Legal entity, elenco con la sola NC inviata alla Legal entity, NC di Calenzano 404, risposta registrata (RISPOSTA_SEDE);
ticket aperto; rubrica filtrata; portali SGI/Service in home come `/go/`. Profili di sistema: rinomina e cancellazione rifiutate,
descrizione modificabile; "Default a tutti" esclude gli esterni; colonna "esterno" in Utenti. Test `node --test` 50/50, build Vite ok,
Playwright: `esterni-{legal-entity-accessi,legal-entity-crea-accesso,partner-home,partner-royalties,cliente-rubrica,cliente-nc,
admin-unita-contatto-pubblico,admin-utenti,admin-profili}.png`.

## Limiti e cose da verificare
- Portale Service e SGI: link ai portali esistenti (SSO solo se configurato il segreto del modulo); nessun contenuto dentro la Suite.
- Lo stato di pagamento delle royalties non esiste in Cash: la pagina lo dichiara; se serve, va aggiunto a `site_royalty_statements`.
- Il perimetro Cash del partner dipende da `site_ext.host_org_id`: va compilata la Struttura ospitante in Cash > Sedi per ogni corner.
- L'invito email va verificato con la posta reale (in locale il provider è "log").
- Gli esterni creati da altre vie (file Utenti, "Crea gli accessi mancanti" su una persona ESTERNO) non ricevono il Default né un
  profilo di sistema: vanno completati da Utenti > Applica profilo (gli ambiti si risolvono comunque dall'organizzazione).
