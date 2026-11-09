# Retail · Profilo dei pazienti (laboratorio)

v0.67.1, decisioni del CEO del 09/11/2026 (sera), vincolanti:
- la **proiezione paziente** della Synclab Data API (`includePatient`) resta **spenta**: nessuna identità in massa nella Suite;
- la profilazione serve con **provenienza, età e sesso** (non nome e cognome): basta la proiezione standard (`demographics`);
- Non conformità può avere il paziente quando manca con un **recupero puntuale**, una accettazione alla volta (vedi
  docs/SYNCLAB_DATA_API.md, "Dati paziente: dove e perché").

Pagina: **Retail Assistant > B2B > Profilo dei pazienti** (`/retail/b2b/profilo-pazienti`; dal riordino del 09/11/2026, v0.68.0: il
vecchio indirizzo `/retail/profilo-pazienti` rimanda qui con la stessa query). **Filtro perimetro**: B2B (predefinito: client Synclab di
Legal entity esterne o non abbinati), Laboratorio in sede (client abbinati alle sedi TD, solo con l'impostazione `synclab_privati_in_b2c`
a true) o tutti; la regola della ripartizione è in docs/RETAIL.md. Dalla scheda di una sede il perimetro parte da "tutti" con la sede. La vedono gli stessi profili che vedono i clienti (ADMIN, RETAIL, SEDE, VIEWER: dati aggregati, nessuna identità); la
geocodifica dei comuni la avviano ADMIN e RETAIL. Dalla scheda di una sede (Sedi del network) il pulsante "Pazienti del laboratorio" apre
la pagina filtrata su quella sede.

Avviso fisso in testa: *"Dati del laboratorio (Synclab). I centri medici (GIPO/TuoTempo) non sono compresi finché Docplanner non apre le
API dei pazienti"*, con la data dell'ultimo checkpoint Synclab delle accettazioni; senza accettazioni importate, rimando alla pagina
Amministrazione > Connettori > StudioLAB > Dati Synclab.

## Fonte e regole (nessun dato inventato)

| Voce | Regola |
|---|---|
| Unità | **Accettazioni, non persone**: senza identità i pazienti distinti non sono calcolabili (la pagina lo scrive). |
| Accettazioni | `synclab.requests` con `disponibilita = 'ATTIVO'`, `deleted_at` vuoto e **almeno una riga d'esame non cancellata** (`request_items.deleted` falso o null), data (`date`) nel periodo. |
| Sede / punto prelievi | `synclab.clients_td.site_id` del client dell'accettazione (abbinamento confermato o proposto per codice StudioLAB) → `public.sites`. Client senza sede: "Senza sede abbinata". |
| Età | `demographics.ageYears` = anni compiuti **alla data dell'accettazione** (non l'età di oggi); null o negativa = "età non disponibile". Fasce 0-17, 18-29, 30-44, 45-59, 60-74, 75+. |
| Sesso | `demographics.sex` come arriva: F e M (maiuscole, spazi tolti); qualunque altro codice = "altro codice"; vuoto = "non indicato". Nessuna normalizzazione presunta. |
| Provenienza | `demographics.city`, `province`, `postalCode` = residenza corrente disponibile (non è una fotografia storica). |
| Fuori area | Comune di residenza **diverso** da quello della sede **e** provincia **diversa**. Stesso comune = "stesso comune"; altro comune della stessa provincia = "stessa provincia"; non valutabili le accettazioni senza sede abbinata, senza comune della sede o senza comune/provincia del paziente (confronto senza maiuscole). |
| Tipo paziente | `patientType` così come arriva (PRIVATO, CONVENZIONATO, …): nessuna normalizzazione. |
| Medicina del lavoro | `occupationalMedicine`: filtro sì/no/tutte; nell'andamento è una serie a parte (i tipi paziente sono senza la medicina del lavoro). |
| Esami | righe d'esame non cancellate; codice `examCode` (maiuscolo), descrizione dal catalogo `synclab.exams` (ATTIVO), altrimenti quella della riga. "Esami" = righe, "accettazioni" = accettazioni distinte con quell'esame. |
| Orari | `createdAtLocal`: ora locale di Roma già **senza offset**, nessuna conversione; giorno ISO (1 = lunedì). |
| Confronto | Stesso periodo dell'anno prima (29 febbraio → 28 febbraio). |

Filtri: periodo (ultimi 12 mesi = dal primo giorno del mese di 11 mesi fa a oggi, predefinito; mese; trimestre; anno), sede/punto
prelievi (anche "senza sede abbinata"), tipo paziente, medicina del lavoro, sesso, fascia d'età. I filtri valgono per tutti i blocchi.

## Blocchi
1. **Sintesi**: accettazioni (con l'anno prima), età mediana, quota donne/uomini, quota con età non disponibile; la nota "accettazioni,
   non persone".
2. **Fasce d'età × sesso**, grafico e tabella con l'anno prima (totale, differenza, variazione).
3. **Provenienza**: quota fuori area (con l'anno prima), province, comuni (primi 20 + "altri N comuni" + "comune non disponibile"), CAP
   della sede scelta (solo con una sede nel filtro), **bacino d'utenza per sede** (stesso comune, stessa provincia, fuori area, non
   valutabili, età mediana, primi 5 comuni; clic su una riga = filtro sulla sede). **Mappa a bolle** (Leaflet, come la mappa delle sedi)
   solo per i comuni con coordinate già in cache e per le sedi con coordinate in anagrafica; gli altri restano in tabella, con il
   conteggio dichiarato.
4. **Andamento mensile** per sede (prime 8 + "altre") e per tipo paziente, medicina del lavoro a parte.
5. **Esami più richiesti** (primi 15) per fascia d'età, sesso, fascia × sesso e per sede.
6. **Orari**: per giorno della settimana, per ora e matrice giorno × ora.

**Export Excel** (`GET /api/retail/profilo-pazienti/export.xlsx`, stessi filtri, exceljs come gli altri export di Retail): fogli
"Fasce età e sesso", "Provenienza province", "Provenienza comuni", "Bacino per sede", "CAP della sede" (con una sede scelta),
"Andamento per sede", "Andamento per tipo" (con la medicina del lavoro in colonna a parte), "Esami top 15", "Esami per sede", "Note"
(fonte, unità, periodo, regola del fuori area, perimetro, ultimo checkpoint). Registro attività di Retail: `PROFILO_PAZIENTI_EXPORT`.

## Geocodifica dei comuni (mappa)
- Cache `public.geo_comuni` (migrazione core 053): una riga per comune e provincia normalizzati con coordinate, precisione, fonte ed esito
  (OK, NON_TROVATO, ERRORE). Solo nomi di comuni e coordinate, nessun dato personale.
- Pulsante "Geocodifica i comuni mancanti (N)" (ADMIN e RETAIL): `POST /api/retail/profilo-pazienti/geocodifica-comuni`, lotti da 15 con
  `lib/geocode.js` `geocodeComune` (Google Geocoding se c'è `GOOGLE_MAPS_SERVER_KEY`, altrimenti OpenStreetMap Nominatim a 1 richiesta al
  secondo, poi Open-Meteo). Un comune non trovato non si ritenta prima di 30 giorni; un errore di rete resta ERRORE e si ritenta al giro
  dopo. Registro: `PROFILO_PAZIENTI_GEOCODIFICA`.

## Architettura
| Pezzo | File |
|---|---|
| Letture | `server/src/lib/synclab/letture.js`: `periodoProfilo`, `filtriProfilo`, `profiloPazienti`, `statoProfilo`, `sintesiProfilo` (Cockpit), `comuniProfilo` (mappa) |
| API | `server/src/modules/retail/routes/profiloPazienti.js` su `/api/retail/profilo-pazienti` (GET, `export.xlsx`, `geocodifica-comuni`) |
| Cache comuni | `server/src/lib/geocode.js` (`comuniInCache`, `geocodificaComuni`), `server/src/migrations/053_profilo_pazienti.sql` |
| Perimetro | `filtriProfilo` accetta `perimetro` (B2B, LAB_SEDE) con `privati_in_b2c` (la route lo legge dall'impostazione di Retail); test in `server/test/retail-riordino.test.mjs` |
| Pagina | `web/src/modules/retail/pages/ProfiloPazienti.jsx`, mappa `web/src/modules/retail/components/MappaComuni.jsx` |
| Cockpit | `server/src/lib/cockpitMonitor.js`, gruppo Retail e Flow: "Età mediana pazienti laboratorio (mese)" e "Quota fuori area" (docs/COCKPIT.md) |
| Test | `server/test/synclab-profilo-nc.test.mjs` (fasce, provenienza, fuori area, anno prima, età null, export, mappa, recupero NC) |
| Dati sintetici | `server/test/helpers/fakeSynclab.mjs` `datiProfilo()` (CLI: `FAKE_SYNCLAB_PROFILO=72`) |

Le query non leggono mai le colonne `patient_*` né `historical_description`: con la proiezione spenta sono vuote, e anche se un giorno si
riaccendesse la pagina resterebbe sulla sola demografia.

## Verifiche in produzione
1. Dopo il primo completo delle accettazioni (Dati Synclab): la pagina mostra la data del checkpoint e i sei blocchi; `SELECT count(*)
   FROM synclab.requests WHERE disponibilita='ATTIVO';` coincide con il totale della pagina sugli ultimi 12 mesi più le accettazioni
   fuori periodo e quelle con tutte le righe cancellate.
2. Bacino per sede: le righe "Senza sede abbinata" calano man mano che si abbinano i client Synclab alle sedi (Dati Synclab > Clienti
   Synclab); i punti prelievi TD devono avere il codice StudioLAB in Amministrazione > Sedi.
3. Fuori area: le sedi devono avere comune e provincia in anagrafica (altrimenti "non valutabili").
4. Mappa: "Geocodifica i comuni mancanti" a più riprese (15 per volta); verificare a campione che le bolle cadano sui comuni giusti.
5. Esami: se molte descrizioni mancano, il catalogo esami Synclab non è importato (Dati Synclab > esami).

## Da decidere
- Se mostrare le celle con numeri molto piccoli (es. CAP con 1-2 accettazioni filtrati per fascia e sesso) o accorparle: oggi si mostrano
  tutte (dati aggregati, nessuna identità).
- Se il profilo SEDE debba vedere solo le proprie sedi (oggi vede la rete, come "Clienti e profilazione").
