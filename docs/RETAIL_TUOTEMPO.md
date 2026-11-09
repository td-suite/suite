# Retail · TuoTempo, Fase 1 (v0.66.0, 09/11/2026)

Richiesta del CEO del 09/11/2026: **"Le sedi sono sedi, su Retail, ovunque. E devono quadrare con TuoTempo."** Fase 1 del piano
(`2026-11-09_Piano_integrazione_TuoTempo.docx`): anagrafiche complete dalle Key Entities del documento Docplanner "Tuotempo Api
integration (Key Entities)", API v3. Perimetro: aree, tipologie e attività, risorse, assicurazioni. **Niente prenotazioni né pazienti**
(vanno chiesti a Docplanner, Fase 2 e 3). La Suite legge, abbina alle anagrafiche uniche e segnala le differenze; non scrive su TuoTempo.

Codice: `server/src/modules/retail/lib/tuotempo.js` (regole e allineamento), `routes/tuotempo.js` (API), migrazione retail
`014_tuotempo_fase1.sql`; interfaccia `web/src/components/TuotempoAnagrafica.jsx` (condivisa da Retail > Connettori e Amministrazione >
Sedi/Persone), `web/src/modules/retail/pages/ListinoOnline.jsx`, blocco "Prenotazione online" in `SiteDetail.jsx`. Test:
`server/test/retail-tuotempo.test.mjs`.

## Connettore e vincoli di Docplanner
- Credenziali, base URL (`https://app.tuotempo.com/api/v3`), istanza (dbName) e lingua solo in Amministrazione > Connettori (docs/CONNETTORI.md).
- Ogni chiamata: `Authorization: Bearer <api_key>`, `Content-Type: application/json; charset=utf-8`, **`User-Agent: TD-Suite/<APP_VERSION>`**
  (anche la "Prova connessione" del core) e **`fields` sempre valorizzato** (`TT_FIELDS`: solo i campi usati; senza fields la chiamata non parte).
- Limite di 600 chiamate al minuto per IP: al massimo una chiamata ogni 110 ms (`TUOTEMPO_PAUSA_MS`) e 300 ms tra una pagina e l'altra
  (`TUOTEMPO_PAUSA_PAGINE_MS`); risposta 429 o "too many" segnalata in chiaro. Paginazione (page, limit 500) su attività, risorse e
  assicurazioni (istanze standalone); aree in una chiamata. Un allineamento completo con 13 aree fa circa 30 chiamate.
- Registro di ogni chiamata in `public.connector_log` (Amministrazione > Connettori).

## Allineamento ("Allinea adesso" e job notturno)
- **Job `retail:tuotempo`**: controllo ogni ora, lavora una volta per notte tra le 2 e le 5 (ora di Roma) se il connettore è attivo, il modulo
  è LIVE e l'ultimo allineamento ha più di 20 ore. Il vecchio `retail:sync-connettori` non gestisce più TuoTempo.
- **"Allinea adesso"**: in Retail > Connettori (card TuoTempo e tabella Aree) e in Amministrazione > Sedi > Aree TuoTempo (`POST /api/retail/tuotempo/allinea`).
- Passi: aree (e per ogni area le prestazioni prenotabili `activities?areaid=` e le risorse `resources?areaid=`, solo identificativi), attività,
  risorse, assicurazioni. Esito nel registro delle sincronizzazioni e in `retail.connectors.settings.tuotempo`.
- Prima di ogni allineamento e all'avvio del modulo: gli abbinamenti area ↔ sede salvati dalle versioni precedenti solo nello specchio
  (`retail.site_ext.tuotempo_area_id`, sync per nome) passano nella fonte con saveSite (`portaSpecchioNellaFonte`, audit SITE_UPDATED,
  origine "Retail > TuoTempo (abbinamento salvato prima della 0.66.0)"). **Nessun abbinamento nuovo si scrive da solo**: la vecchia
  sincronizzazione che abbinava per nome è tolta.

## Aree TuoTempo ↔ Sedi
- **Fonte dell'abbinamento**: `public.sites.legacy_refs->>'tuotempo'` (= areaid), scritto solo da saveSite (chiave `null` = abbinamento tolto,
  supporto aggiunto in `scriviSede`). `retail.site_ext.tuotempo_area_id` è lo specchio, riallineato a ogni scrittura.
- Tabella **`retail.tuotempo_aree`**: areaid, titolo, indirizzo, CAP, città, provincia, coordinate, telefoni, `opening_hrs` e `orari_norm` (lo
  stesso testo nel formato della Suite se interpretabile), tag, legacyid, `is_hidden`, `presente` (FALSE se TuoTempo non la restituisce
  più), **`ignorata`** ("non nostra / ignora", impostazione per area, con nota e autore), prestazioni dell'area.
- **Sede TD proposta**, nell'ordine deciso dal CEO (`proponiSede`): 1) abbinamento già salvato (fonte, poi specchio); 2) `legacyid` = codice
  sede; 3) indirizzo + CAP normalizzati (`retail.tt_norm`: minuscole, senza accenti, abbreviazioni v./v.le/p.zza/c.so/s. sciolte, senza
  punteggiatura; stessa regola in JS `normTesto`); 4) nome simile con pg_trgm (somiglianza ≥ 0,45 sui nomi senza le parole comuni
  "punto prelievi", "centro medico", ... funzione `retail.tt_nome`) **solo tra sedi della stessa città**. Le sedi già abbinate a un'altra
  area non si propongono. Candidate: sedi non SERVICE attive o in apertura.
- **Azioni** (Admin del modulo o amministratori della Suite): "Abbina a <sede>" (conferma), "Scegli sede" (selettore delle sedi libere), "Crea
  la sede" (saveSite con nome, indirizzo, CAP, città, provincia in sigla, coordinate, telefono fisso o cellulare, orari se il testo è
  interpretabile, tipo scelto tra Punto prelievi, Centro medico, Centro diagnostico, Poliambulatorio, Legal entity di TD dai Dati aziendali,
  `legacy_refs.tuotempo = areaid`; il codice lo indica l'utente, proposto il legacyid), "Non nostra / ignora" e "Riprendi", "Scollega".
  Un'area, una sede: abbinare una sede già abbinata a un'altra area è rifiutato (409).
- Le aree nascoste (`isHidden = 1`), quelle "non nostre" e quelle non più su TuoTempo si vedono attenuate. Il caso delle aree di Livorno e
  Borgo San Lorenzo segnalate come "senza sede": se la sede non c'è si crea con un clic ("Crea la sede"), altrimenti "Non nostra / ignora".
- **Riepilogo** al posto del vecchio messaggio rosso "aree senza sede: …": "13 aree, 4 abbinate, 9 da abbinare" (più non nostre e con dati
  diversi) con il link alla tabella, in Retail > Connettori e in testa alla tabella.

## Confronto dei dati e Diagnostica
- Vista **`retail.tuotempo_confronto_v`** (una sola regola per la tabella e la Diagnostica): per le sedi abbinate, differenze di indirizzo,
  CAP, città, telefono (quello della sede non è né il fisso né il cellulare dell'area) e orari (`orari_norm` diverso da `sites.opening_hours`).
  Conta solo se TuoTempo ha il dato; gli orari non interpretabili non si confrontano (indicati nella tabella).
- **"Copia da TuoTempo"** (tabella Aree e Diagnostica): indirizzo (con CAP, città, provincia), telefono, orari; conferma esplicita
  (`conferma: 'COPIA'`), scrittura con saveSite (audit SITE_UPDATED con l'origine). Vale l'anagrafica finché non si copia.
- **Diagnostica** (docs/ANAGRAFICA.md): **D45** "Sedi con dati diversi da TuoTempo" (INFO, azioni di riga "Copia l'indirizzo", "Copia il
  telefono", "Copia gli orari"); **D46** "Sedi attive senza area TuoTempo" (ATTENZIONE, tipi prenotabili PUNTO_PRELIEVI, CENTRO_MEDICO,
  CENTRO_DIAGNOSTICO, POLIAMBULATORIO; compare solo dopo il primo allineamento).

## Attività → catalogo prestazioni
- Prodotto per attività: si riconosce da `tt_activity_id`, poi dal codice (= legacyid, altrimenti `TT-<activityid>`). Campi di TuoTempo in
  colonne proprie: `tt_price` (prezzo online), `tt_price_rules`, `tt_preparation`, `tt_hidden`, `tt_first_availability`,
  `tt_first_availability_area`, `tt_legacyid`, `tt_typology_id`/`tt_typology`; la durata va in `duration_min`. **Il listino privato della
  Suite (`price`) non si sovrascrive più** (la versione precedente lo rimpiazzava con il prezzo online); per un'attività senza prodotto il
  prodotto nasce con `source = TUOTEMPO` e il prezzo online anche come listino.
- **Storico giornaliero della prima disponibilità** `retail.tuotempo_attivita (data, activityid, areaid, site_id, typologyid,
  first_availability, giorni_attesa)`: per le sole prestazioni visibili online, giorni dal momento dell'allineamento al primo slot libero;
  `areaid` dal titolo dell'area del primo slot (`first_availability_areaTitle`), `site_id` dalla sede abbinata (aggiornato anche quando
  l'area si abbina o la sede si crea nello stesso giorno). Ipotesi dichiarata: è la prima disponibilità della prestazione su tutta la rete,
  attribuita alla sede del primo slot (le Key Entities non danno le agende per sede: arriveranno con Availabilities, Fase 2).
- **"Listino online vs prezzo di cassa"** (Retail > Vendite): prezzo TuoTempo contro il prezzo medio delle vendite GIPO per prodotto (netto
  diviso quantità, vendite private: `payment_kind` vuoto o PRIVATO, ultimi 3/6/12/24 mesi), differenza in euro e in %, filtro "almeno il 5%".

## Risorse → persone
- Tabella **`retail.tuotempo_risorse`** (resourceid, name, email, phone, status, is_hidden, is_machine, satisfaction, areas, legacyid,
  idnumber). Le aree della risorsa vengono dalla lista se TuoTempo le dà, altrimenti dalle chiamate per area.
- Proposta (`proponiPersona`): stessa email (senza maiuscole), poi stesso nome senza titoli (Dott., Dr.ssa, Prof., ...) se una sola persona
  corrisponde; le macchine non si abbinano. Conferma ("Conferma" o "Scegli persona") nella tabella "Risorse TuoTempo" di Retail >
  Connettori o in Amministrazione > Persone ("Risorse TuoTempo da abbinare alle persone"): scrive **`public.people.legacy_refs->>'tuotempo'`**
  con audit PERSON_UPDATED (origine "Retail > TuoTempo (risorse)"); una risorsa, una persona.

## Assicurazioni
`retail.tuotempo_assicurazioni` (insuranceid, titolo, legacyid, titolo esterno, predefinita, nascosta, tag, presente). `GET
/api/retail/tuotempo/assicurazioni`. Il collegamento a `sales.payment_kind` resta da fare (Fase 1 bis, serve la decodifica dei codici GIPO).

## Scheda sede di Retail: "Prenotazione online"
Area abbinata (visibile o nascosta), prestazioni online dell'area presenti nel catalogo, attesa alla prima disponibilità (mediana dell'ultimo
giorno per la sede), medici attivi (risorse attive non nascoste, non macchine, dell'area) e soddisfazione media, dati pubblicati su TuoTempo
e differenze con l'anagrafica.

## Cockpit
Indicatore "Attesa alla prima disponibilità" nel gruppo Retail e Flow (docs/COCKPIT.md): mediana della rete e per sede dall'ultimo giorno dello
storico, confronto con una settimana prima, serie degli ultimi 12 giorni.

## API (`/api/retail/tuotempo`)
`GET /aree`, `POST /aree/:areaid/abbina {site_id}`, `POST /aree/:areaid/scollega`, `POST /aree/:areaid/ignora {ignorata, nota}`,
`POST /aree/:areaid/crea-sede {code, kind, name?}`, `POST /sedi/:siteId/copia {campi: [indirizzo|telefono|orari], conferma: 'COPIA'}`,
`GET /sedi/:siteId` (prenotazione online), `GET /risorse`, `POST /risorse/:id/conferma {person_id}`, `POST /risorse/:id/scollega`,
`GET /assicurazioni`, `GET /listino?mesi=`, `POST /allinea`. Lettura: profili ADMIN e RETAIL (scheda sede e listino: tutti i profili);
scrittura sull'anagrafica: Admin del modulo o amministratori della Suite. Audit del modulo: TUOTEMPO_AREA_ABBINATA, _SCOLLEGATA, _IGNORATA,
_RIPRESA, TUOTEMPO_SEDE_CREATA, TUOTEMPO_DATI_COPIATI, TUOTEMPO_RISORSA_ABBINATA, _SCOLLEGATA, CONNECTOR_SYNC.

## Collaudo del 09/11/2026 (db `suite_tt_t`, porta 3162, TuoTempo finto su :3163)
Nessuna api_key reale: server TuoTempo finto con dati inventati (5 aree: 1 abbinabile per legacyid, 1 per indirizzo con "V.le ..." contro
"Viale ...", 1 già abbinata nello specchio, 1 nuova a Livorno, 1 nascosta a Borgo San Lorenzo; 20 attività; 6 risorse, 4 abbinabili per email,
1 senza persona, 1 macchina; 2 assicurazioni) che verifica Bearer, fields, User-Agent e ritmo: 28 chiamate per allineamento, nessuna
violazione. Esiti: proposte LEGACYID e INDIRIZZO, Livorno senza proposta (nessuna sede a Livorno; prima della correzione dei nomi il trigramma
proponeva Empoli), abbinamento salvato nello specchio portato nella fonte all'avvio; "Crea la sede" PP-LIV con indirizzo, telefono, coordinate,
orari "Lun-Sab 7:00-10:30", Legal entity di TD e audit; Borgo San Lorenzo "non nostra"; riepilogo "5 aree, 4 abbinate, 0 da abbinare, 1 non
nostra"; doppio abbinamento 409; D45 = 2 (telefono e orari), D46 = 1 (la sede attiva senza area; quella in apertura no), "Copia il telefono" da
Diagnostica e "Copia da TuoTempo" (orari e telefono) dalla tabella con saveSite e audit, senza conferma 400; 20 prodotti con i campi di
TuoTempo e il listino della Suite intatto; storico con la sede per 4 aree; 4 risorse proposte per email e confermate (people.legacy_refs, 4
audit); secondo allineamento idempotente; scheda sede (2 medici attivi, soddisfazione 4,4); listino online vs cassa (PRE01 cassa 18 €);
Cockpit con la mediana per sede. Schermata `docs/screens/retail-aree-tuotempo.png`.

## Verifiche in produzione dopo il rilascio
- Amministrazione > Connettori > TuoTempo: "Prova connessione" (ora con User-Agent TD-Suite/0.66.0); poi Retail > Connettori > "Allinea adesso".
- Rapporto della migrazione: `SELECT data FROM audit_log WHERE action='MIGRAZIONE_RAPPORTO' AND entity_id='retail/014_tuotempo_fase1.sql';`
  e, dopo il riavvio, nel log "[retail] TuoTempo: abbinamenti area ↔ sede portati nell'anagrafica: N" (attesi i 4 abbinamenti di oggi).
- Tabella Aree: le 13 aree, le proposte da confermare, Livorno e Borgo San Lorenzo da creare o segnare "non nostre"; riepilogo atteso
  "13 aree, 4 abbinate, 9 da abbinare" prima delle conferme.
- Registro del connettore: nessun 429; durata dell'allineamento; `SELECT count(*) FROM retail.tuotempo_attivita WHERE data = CURRENT_DATE`.
- Prezzi: `SELECT code, price, tt_price FROM retail.products WHERE tt_activity_id IS NOT NULL AND price IS DISTINCT FROM tt_price LIMIT 20;`
  (i prodotti a cui la versione precedente aveva già scritto il prezzo online in `price` restano così: vanno ricontrollati col listino GIPO).
- Diagnostica: D45, D46 (e risorse da confermare in Amministrazione > Persone).
- Formato reale di `first_availability` (Unix in secondi o data): il codice accetta entrambi; verificare sul primo allineamento.

## Cosa resta (fasi successive)
Durata delle prestazioni a Room, foto e CV delle risorse nella Rubrica, sedi di lavoro delle risorse confrontate con Room, confronto delle
preparazioni con il Portale/SGI, collegamento assicurazioni ↔ `payment_kind`, avvisi (notices). Fasi 2-4 con le API da chiedere a Docplanner.
