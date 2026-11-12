# Retail Assistant · mappa del modulo (riordino del 09/11/2026, v0.68.0)

Decisione del CEO del 09/11/2026 sera, vincolante: **"In Retail va fatto ordine: un cruscotto complessivo e due sezioni separate, B2C e
B2B. Il B2B deriva tutto da StudioLab. Il B2C da TuoTempo + GIPO a seconda delle informazioni attese."**

Il modulo ha quattro parti: il **Cruscotto di rete**, la sezione **B2C** (centri medici e punti prelievo: TuoTempo + GIPO), la sezione
**B2B** (service e medicina del lavoro: StudioLab/Synclab) e **Dati e amministrazione**. Ogni pagina dichiara la sua fonte e l'ultimo
aggiornamento; dove il dato non c'è ancora (es. prenotazioni TuoTempo) la pagina lo dice, nessun numero inventato.

## Ripartizione delle accettazioni StudioLab (B2C / B2B)

Impostazione del modulo **`synclab_privati_in_b2c`** (Retail > Impostazioni, "Ripartizione delle accettazioni StudioLab"; predefinita
`true`, migrazione retail `015_riordino_b2b.sql`; la regola è da confermare col CEO, per questo è un'impostazione):

| Client Synclab | Con `true` (predefinito) | Con `false` |
|---|---|---|
| abbinato a una **sede TD** (`synclab.clients_td.site_id` → sede non SERVICE della Legal entity di TD: Dati aziendali `company_org_id`, o società GRUPPO/SOCIETA) | **Laboratorio in sede** (B2C) | B2B |
| abbinato alla Legal entity di TD senza sede (interno, non "esterno") | Laboratorio in sede (B2C) | B2B |
| abbinato a una **Legal entity esterna** (di norma la sede SERVICE del cliente) | **B2B** | B2B |
| **non abbinato** | **B2B** | B2B |

La regola è una sola, in `server/src/lib/synclab/letture.js` (`ctePc`, `RIPARTIZIONI`), usata da tutte le letture (cruscotti, produzione,
fatturato, listini, profilo, laboratorio). Il flag `perimetro_b2b` di `clients_td` (cliente attivo/contrattualizzato del Business Hub)
resta un'informazione mostrata accanto al cliente, non decide la sezione. Con `false` la voce "Laboratorio in sede" sparisce dal menu
(flag `laboratorio_in_sede` di `/api/retail/badges`) e la pagina lo dice.

**Cliente B2B** = Legal entity abbinata (chiave = id) oppure, per un client non abbinato, il client Synclab (chiave `c-<id client>`).

## Menu e rotte (`web/src/modules/retail/meta.js`, `index.jsx`)

| Parte | Rotta | Pagina | Fonte |
|---|---|---|---|
| Cruscotto | `/retail` | `Cruscotto.jsx` (nuova) | `GET /stats/rete` |
| **B2C** | `b2c` | Cruscotto B2C (`CruscottoB2C.jsx`, l'ex Dashboard) | GIPO (`/stats/summary`) |
| | `b2c/clienti`, `b2c/clienti/:id` | Clienti e profilazione | GIPO |
| | `b2c/richiami` | Richiami periodici | GIPO |
| | `b2c/prodotti` | Prestazioni e prodotti | GIPO |
| | `b2c/listino-online` | Listino online vs cassa | TuoTempo + GIPO |
| | `b2c/vendite` | Accettazioni e vendite (GIPO) | GIPO |
| | `b2c/prenotazioni` | **Prenotazioni online e prima disponibilità** (nuova) | TuoTempo, `GET /prenotazioni` |
| | `b2c/laboratorio` | **Laboratorio in sede** (nuova, solo con l'impostazione a true) | StudioLab, `GET /laboratorio` |
| | `b2c/campagne`, `b2c/promozioni`, `b2c/esposizione`, `b2c/sedi`, `b2c/budget` | come prima | GIPO / registrazioni in sede |
| **B2B** | `b2b` | **Cruscotto B2B** (nuova) | StudioLab, `GET /b2b/cruscotto` |
| | `b2b/clienti` | Aziende e strutture (B2B.jsx con le colonne Synclab) | `GET /b2b/clienti` |
| | `b2b/clienti/:chiave` | **Scheda cliente B2B** (nuova) | `GET /b2b/clienti/:chiave` |
| | `b2b/codici/:id` | scheda di un codice delle vendite importate (CustomerDetail) | vendite importate |
| | `b2b/produzione` | **Produzione per cliente e mese** (+ Excel) | `GET /b2b/produzione`, `/b2b/produzione/export.xlsx` |
| | `b2b/fatturato` | **Fatturato da documenti** | `GET /b2b/fatturato` |
| | `b2b/listini` | **Listini applicati** | `GET /b2b/listini` |
| | `b2b/profilo-pazienti` | Profilo dei pazienti, filtro perimetro B2B / Laboratorio in sede / tutti | `GET /profilo-pazienti` |
| | `b2b/budget` | **Budget B2B** | `GET/PUT /b2b/budget` |
| Dati e amministrazione | `import`, `connettori`, `impostazioni`, `audit` | come prima | |

**Redirect** delle vecchie rotte (link salvati, Cockpit, Home, Diagnostica): `clienti`→`b2c/clienti`, `clienti/b2b`→`b2b/clienti`,
`clienti/:id`→`b2c/clienti/:id`, `profilo-pazienti`→`b2b/profilo-pazienti`, `vendite`, `richiami`, `prodotti`, `listino-online`,
`budget`, `campagne(/:id)`, `promozioni(/:id)`, `esposizione(/:id)`, `sedi(/:id)` → sotto `b2c/`; la query string resta. Link interni
aggiornati: pagine di Retail, Diagnostica D21 (`/retail/b2b/clienti?tab=da_abbinare`), Audit SGI > Sede (`/retail/b2c/sedi/:id`), scheda
sede ("Pazienti del laboratorio" → `b2b/profilo-pazienti?site_id=`). Il test `retail-riordino.test.mjs` verifica via grep che non restino
link alle vecchie rotte.

## Server (`server/src/modules/retail`)

- `routes/stats.js`: `GET /stats/rete` (cruscotto complessivo: GIPO, TuoTempo, Laboratorio in sede, B2B Synclab, anno prima, fuori area,
  connettori), `GET /stats/fonti` (ultimo import GIPO e allineamento TuoTempo per le pagine B2C).
- `routes/b2b.js` (nuovo): `/b2b/stato`, `/cruscotto`, `/clienti`, `/clienti/:chiave`, `/produzione`, `/produzione/export.xlsx`,
  `/fatturato`, `/listini`, `/budget` (GET e PUT, ADMIN e RETAIL).
- `routes/prenotazioni.js` (nuovo), `routes/laboratorio.js` (nuovo).
- `lib/b2b.js`: `privatiInB2c()`, `listiniHub()` (listino corrente del Business Hub per Legal entity: account SRV, poi MDL; prezzo offerto,
  altrimenti di listino), `ncAperte()` (schema `nc`, solo con il modulo NC LIVE, in try/catch), `budgetB2B()`.
- **Letture Synclab solo da `server/src/lib/synclab/letture.js`**: `ripartizioneClienti`, `quadroLaboratorio`, `produzioneClientiMesi`,
  `fatturatoClientiMesi`, `cruscottoB2B`, `prezziApplicati`, `schedaClienteSynclab`, `laboratorioInSede`, `statoCopia`; il profilo
  accetta `perimetro` (`B2B` | `LAB_SEDE`).
- Migrazione retail `015_riordino_b2b.sql`: riga `synclab_privati_in_b2c = true` se manca; tabella `budget_b2b` (chiave cliente, anno,
  mese, produzione, fatturato, esami; unica per chiave/anno/mese). La tabella `budgets` esistente non ha una dimensione per cliente B2B.

## Regole dei numeri

| Voce | Regola |
|---|---|
| Accettazioni (Synclab) | v0.68.5: accettazioni **erogate**: `requests` ATTIVE, non cancellate, con almeno una riga d'esame non cancellata, **stato in `stati_erogati`** (predefiniti 18, 20, 25, 40, 50: ipotesi da confermare), data nel periodo |
| Esami | righe d'esame non cancellate delle accettazioni erogate |
| Produzione erogata (ex "Valore della produzione") | v0.68.5: Σ netto di riga × quantità × (1 − sconto di testata), lo sconto di testata applicato **una volta**; righe senza prezzo contate a parte ("n esami senza prezzo", valore parziale). È la **grandezza principale** del B2B (definizione unica: docs/SYNCLAB_DATA_API.md "Produzione erogata") |
| Documenti emessi (ex "Fatturato da documenti"), dato secondario mai sommato | `netRevenueContribution` una volta per documento; **note di credito separate** (già negative); annullati e proforma **esclusi e contati**; tipo sconosciuto escluso e contato |
| In calo | stesso mese dell'anno prima, variazione ≤ −20% sul valore (se c'è in entrambi i periodi) altrimenti sugli esami; compresi i clienti a zero nel mese |
| Senza produzione da 60 giorni | ultima accettazione più vecchia di 60 giorni ma entro i 12 mesi |
| Non abbinati | client Synclab ATTIVI in stato `DA_ABBINARE`; quelli `PROPOSTO` sono contati a parte (i numeri usano già la proposta) |
| Prezzi applicati | prezzo netto medio = Σ netto di riga × quantità / Σ quantità (righe con prezzo, **prima** dello sconto di testata: è il prezzo confrontabile con i listini) contro il listino **corrente** Synclab del client (base, poi extra) e il listino **corrente** del Business Hub |
| Mese in corso | fino a oggi; l'anno prima fino allo stesso giorno |
| GIPO (B2C) | vendite `source = 'GIPO'` senza committente B2B: accettazioni = riferimenti distinti, vendite = netto |
| Fuori area | comune di residenza diverso da quello della sede **e** provincia diversa (stessa regola per GIPO e laboratorio) |
| Prima disponibilità | mediana di `tuotempo_attivita.giorni_attesa` dell'ultimo giorno, confronto con 7 giorni prima (ipotesi dichiarata in RETAIL_TUOTEMPO.md) |
| Prenotazioni online | **non disponibili** finché Docplanner non apre le API (Fase 2): la pagina e il cruscotto lo dicono |

## v0.68.5: produzione erogata (CEO 10/11/2026)
"A me non interessa il dato delle fatture ma il dato delle accettazioni in stato erogato … Mi serve nei vari cruscotti." In Retail:
- **Cruscotto di rete**: righe e KPI B2B e Laboratorio in sede sulla **produzione erogata** (accettazioni erogate, esami, produzione);
  "Documenti emessi (secondario, non sommati)" resta come riga a parte; la fonte della produzione è dichiarata sotto la tabella.
- **Cruscotto B2B**: KPI principale "Produzione erogata B2B", "Esami erogati", "Documenti emessi (secondario)"; **barre giorno per giorno** del
  mese (`giornaliero` di `GET /b2b/cruscotto`); top 10 con le colonne Produzione erogata e Documenti emessi.
- **Scheda cliente B2B**: KPI "Produzione erogata" e "Documenti emessi (secondario)", **barre giornaliere** dell'ultimo mese del periodo,
  andamento mensile con produzione e documenti, "Documenti emessi nel periodo".
- **B2B > Produzione**: vista **Mensile** (cliente × mese, come prima) e **Giornaliera** (cliente × giorno di un mese, fino a oggi per il mese
  in corso, con le barre del totale giornaliero), export Excel per entrambe (`GET /b2b/produzione/giorni?mese=AAAA-MM` e
  `/produzione/giorni/export.xlsx`). Schermata `docs/screens/retail-b2b-produzione-giornaliera.png`.
- **Laboratorio in sede**: accettazioni e produzione erogate.
- Ogni pagina B2B dichiara sopra la fonte della produzione: "Produzione erogata · Synclab, accettazioni erogate (stati …), netto di riga e
  sconto di testata, copia al … · aggiornato alle HH:MM" (`fonte_produzione`, `aggiornato`, `stati_descritti` nelle risposte).
- Menu: "Fatturato da documenti" → **"Documenti emessi"** (stessa pagina, dato secondario).

## Test e collaudo
- `server/test/retail-riordino.test.mjs` (13 test): menu, redirect e link (grep); ripartizione con l'impostazione vera e falsa, cruscotto
  di rete, cruscotto B2B, produzione e export, fatturato, listini con il Business Hub, scheda cliente con NC, laboratorio, profilo con
  perimetro, impostazione e budget, prenotazioni. Dati solo sintetici (forma degli esempi di CB Sistemi).
- Collaudo del 09/11/2026 su db proprio `suite_rt_t` (porta 3166): 4 sedi TD, 6 Legal entity esterne, 2 client non abbinati, 8.095
  accettazioni e 210 documenti sintetici, 2.672 vendite GIPO, storico TuoTempo di 30 giorni; tutte le pagine nuove aperte, redirect
  verificati, nessun errore di pagina. Schermate: `docs/screens/retail-cruscotto.png`, `retail-b2b-cruscotto.png`, `retail-b2c-prenotazioni.png`.

## Verifiche in produzione dopo il rilascio
1. Rapporto della migrazione: `SELECT key, value FROM retail.app_settings WHERE key='synclab_privati_in_b2c';` (atteso `true`) e
   `SELECT count(*) FROM retail.budget_b2b;` (0).
2. Retail > Cruscotto: i tre connettori con la data giusta; StudioLAB/Synclab "attivo" solo con la Data API abilitata.
3. Cruscotto B2B: i client "non abbinati" vanno abbinati in Amministrazione > Connettori > StudioLAB > Dati Synclab > Clienti Synclab; i
   punti prelievo TD devono avere il codice StudioLAB in Amministrazione > Sedi, altrimenti le loro accettazioni finiscono nel B2B.
4. Laboratorio in sede: le sedi dei punti TD compaiono man mano che i client sono abbinati.
5. Listini applicati: gli scostamenti col Business Hub hanno senso solo per i clienti con un listino caricato nella scheda del Business Hub.
6. Vecchi link salvati (es. `/retail/clienti/b2b`) aprono la pagina nuova.

## Da decidere / aperti
- Conferma del CEO sulla ripartizione (impostazione pronta per il contrordine).
- Il Cruscotto B2C (ex Dashboard) mostra ancora le righe delle vendite importate con committente B2B (codici StudioLAB): restano per
  continuità finché il B2B importato da file non viene spento a favore di Synclab.
- Prenotazioni online, pazienti e NPS di TuoTempo: in attesa di Docplanner (Fase 2-3).

## v0.68.6 · Produzione accettata (CEO, 10/11/2026)
La grandezza principale delle pagine B2B, del Laboratorio in sede e del cruscotto di rete è la **produzione accettata** (definizione unica in
docs/SYNCLAB_DATA_API.md, "v0.68.6"): accettazioni negli stati dell'impostazione `stati_erogati` (predefiniti tutti tranne 11 NC mai
arrivato), importi di riga con lo sconto di testata **non applicato** salvo impostazione `sconto_testata` = APPLICA. Etichette "Produzione
accettata", "Accettazioni", "Esami" (non più "erogata/erogate"); la riga "Produzione accettata · fonte" dichiara stati, regola dello sconto e
ora della copia. Esami = righe d'esame non cancellate **comprese quelle senza prezzo** (come il report del gestionale), mostrate anche a
parte ("di cui … senza prezzo"). In B2B > Produzione e nella scheda cliente: "di cui sconti di testata: x €" (applicati o no).
Le API B2B espongono `sconto_testata` e `regola_sconto` accanto a `fonte_produzione`.
Punto aperto: possibile doppio conteggio fra GIPO e Laboratorio in sede nel Cockpit (docs/SYNCLAB_DATA_API.md, "Punti aperti").

## v0.71.0 · Collegamenti con Lab Control (CEO 12/11/2026)
- Scheda cliente B2B (`/retail/b2b/clienti/:chiave`): pulsante **"Accettazioni in Lab Control"** con il filtro del cliente (`cliente=<id
  Legal entity>` oppure `c-<id client>`, stessa chiave di Retail), nel campo `link.lab_control` della risposta (solo con Lab Control LIVE e il grant).
- B2C > Laboratorio in sede: per ogni sede il pulsante **"Lab Control"** (accettazioni di oggi della sede), campo `lab_control` della risposta.
- In senso inverso, dal menu di un cliente in Lab Control: "Retail · scheda cliente B2B" o, per i client delle sedi TD (regola della
  ripartizione qui sopra, con l'impostazione `synclab_privati_in_b2c`), "Retail · Laboratorio in sede" (`/retail/b2c/sedi/:id`); "Listino del
  gestionale" apre B2B > Listini applicati sul cliente. Con Retail non LIVE o senza grant le voci restano spente con il motivo.
