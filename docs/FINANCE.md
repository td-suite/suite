# Finance Management · Controllo di gestione

Programma "anagrafica unica e Suite interconnessa" (CEO, 08/11/2026), decisioni 11 e 12: **costi centrali e personale condiviso
attribuiti alle sedi in proporzione ai ricavi della sede sul totale**; **fatturazione attiva fuori perimetro: alla Suite basta la
produzione**. Il widget Finance Management (chiave `finance`, ex Payments) ospita, nel gruppo di menu "Controllo di gestione", due pagine
visibili ai profili CEO, CFO, SUPPORT e VIEWER (lettura):

- **Conto economico di sede** `/finance/conto-economico` (P&L per sede, anno e mese o anno intero, tutte le sedi o una, export XLSX e PDF);
- **Margine clienti Service** `/finance/margine-service` (margine per cliente Service, anno e mese, dettaglio mese per mese, export).

Codice: regole pure `server/src/modules/finance/lib/contoEconomico.js` (test `server/test/finance-controllo.test.mjs`), lettura delle fonti
`lib/controlloData.js`, export `lib/controlloExport.js`, route `routes/controllo.js` (`/api/finance/controllo/...`), pagine
`web/src/modules/finance/pages/ContoEconomico.jsx`, `MargineService.jsx`, selettori `components/Classificazione.jsx`. Migrazione
`finance/006_controllo_gestione.sql`.

## Regola delle fonti: mai uno zero silenzioso
Ogni fonte di un altro modulo si legge con la tecnica `safe()` del Cockpit: solo se il modulo è LIVE nella Suite (pool del modulo); un
modulo non LIVE o una lettura fallita danno la riga **"non disponibile"** con la nota (pagina, XLSX, PDF), non zero. Il margine di una sede
è **"parziale"** quando manca una fonte, quando ci sono importi "da indicare" (compensi variabili dei liberi professionisti, ricavi
Service senza valore) o quando i costi centrali sono parziali. Ogni cella si apre sulle righe che la compongono, con il modulo di
provenienza e il collegamento.

## Conto economico di sede
**Sedi (colonne)**: `public.sites` attive non SERVICE (più quelle chiuse dopo l'inizio del periodo), escluse le **sedi centrali**
(impostazione `pl_sedi_centrali`; vuota = le sedi di tipo Sede direzionale). Periodo: un mese, oppure l'anno; **l'anno in corso si ferma al
mese corrente** e il confronto con l'anno precedente usa gli stessi mesi.

**Ricavi (produzione)**
- Retail: `retail.sales.net_amount` per sede (`site_id` → `public.sites`) e data, senza le vendite dimostrative (`source = 'DEMO'`) e
  senza le vendite B2B dei clienti Service (vanno nella riga Service: niente doppio conteggio).
- Service: produzione dei clienti (sezione sotto) attribuita alla sede **LABORATORIO** (`getLaboratorio`); senza sede Laboratorio la riga
  è "non disponibile".
- Incassi Cash (riga di **controllo**, non sommata): `cash.cash_reports` da CLOSED in poi (`pos_total + cash_to_deposit + transfer_total`)
  con la differenza rispetto a Retail, solo per le sedi con rendiconti nel periodo.

**Costi diretti di sede**
- Canone: rata vigente dagli scatti del contratto dello Scadenziario (`finance.lease_contracts` + `lease_steps`, lib/scheduleData.js) / mesi
  della periodicità, per i giorni di contratto nel mese (contratto scaduto senza rinnovo: fino alla scadenza). Per il contratto collegato
  all'anagrafica (`registry_sync`) l'IVA segue `public.sites.rent_vat/rent_vat_rate` e l'impostazione `pl_iva_costi`; un secondo contratto
  della sede (box) vale come registrato. Sede in LOCAZIONE senza contratto nello Scadenziario: `rent_amount / rent_period` dell'anagrafica
  dalla `lease_start`.
- Utenze: bollette registrate (`finance.utility_bills` della sede), ripartite per giorni del periodo fatturato (senza periodo: mese di
  scadenza). Le bollette attese ma non registrate non si contano.
- Royalties al partner ospitante: royalty di sede confermate in Cash (`cash.site_royalty_statements`, periodo del mese, non annullate:
  la tabella `royalty_statements` è per società e non per sede), totale con IVA o imponibile secondo `pl_iva_costi`.
- Personale dipendente (Contratti del personale): `employments.work_site_id` = sede; costo = **RAL vigente** (scatti `ral_steps`) ×
  coefficiente oneri / 12 per i giorni coperti dal rapporto (inizio = `start_date` o ingresso, fine = `end_date` o cessazione). Il
  coefficiente è l'impostazione `pl_coefficiente_oneri` (**1,28, ipotesi dichiarata**) salvo il coefficiente scritto da HR sul contratto
  (`employments.cost_coefficient`).
- Liberi professionisti: sede della persona (`people.site_id`, `lp_contracts` non ha una sede), compenso mensile del tariffario
  (`est_monthly_cost`, cioè i compensi FISSI) per i giorni coperti; compensi orari, a prestazione o variabili = riga **"da indicare"**.
- Manutenzioni (Facility): interventi chiusi con costo (`work_orders.cost`, data di chiusura) e manutenzioni del piano eseguite con costo
  (`maintenance_plans.cost`, data di esecuzione). Le stime di costo degli obblighi non sono costi sostenuti e non si contano.
- Pagamenti Finance: istanze FIRMATA o ESEGUITA, alla data di esecuzione (o valuta, o richiesta), con `site_id` = sede; con il solo
  cliente (`org_id`) vanno al Laboratorio. **Esclusi** i pagamenti creati dallo Scadenziario (già in canone e utenze) e quelli segnati
  "fuori dal conto economico" (`pl_escluso`: stipendi e contributi, rate, imposte).

**Costi centrali (decisione 11)**: personale e liberi professionisti senza sede o con sede centrale, pagamenti senza sede né cliente,
canoni, utenze e altri costi delle sedi centrali. Si ripartiscono su ogni sede in proporzione ai ricavi della sede sul totale del periodo
(riga "Quota costi centrali" con la percentuale; centesimi di arrotondamento alla sede con la quota più alta). Con ricavi a zero la
ripartizione non si fa e la pagina lo dice. Chiave `pl_chiave_ripartizione`: per ora solo `RICAVI` (campo predisposto).

**Margine di sede** = ricavi − costi diretti − quota dei costi centrali; margine %; margine dello stesso periodo dell'anno precedente e
variazione. Ricavi registrati su sedi fuori dal conto (centrali, SERVICE, chiuse) compaiono negli avvisi.

## Margine per cliente Service
Clienti: `public.clienti_attivi_v` linea SRV. Dalla v0.68.4 stime e proiezione valgono **solo per i clienti ATTIVI**; i
CONTRATTUALIZZATI non avviati compaiono solo se hanno produzione effettiva nel periodo (vedi "Stime in pro quota", sotto). Per ogni mese:
- **Produzione**: StudioLAB non ha un'API di produzione per cliente (orders/lib/studiolab.js), ma la Suite la riceve già in due moduli:
  le **vendite B2B di Retail** (codice StudioLAB abbinato alla Legal entity, con codice d'esame e valore) e la **produzione di Ordini**
  (HL7 OML/ORU o import, per codice d'esame, sulla Legal entity o sui suoi punti SERVICE). In più la tabella
  `finance.produzione_service` (org_id, mese, esami, valore, fonte `STUDIOLAB` | `MANUALE` | `STIMA`, righe per esame, note) per
  l'inserimento manuale e da XLSX nella pagina. Priorità: riga salvata MANUALE/STUDIOLAB → Synclab → Retail → Ordini → stima in pro
  quota calcolata al momento (solo clienti attivi) → stima salvata.
- **Stima** (badge "stima", v0.68.4): pro quota del fatturato FY atteso, vedi "Stime in pro quota" sotto. "Salva le stime" la registra
  come fonte STIMA senza toccare le righe presenti.
- **Ricavo**: esami ai prezzi del **listino corrente** del cliente (`business.listini`, versione scelta o ultima: `versioneCorrente` di
  business/lib/listino.js; prezzo offerto, altrimenti di listino) quando la produzione ha le righe per esame; i codici fuori listino
  valgono il valore registrato. Altrimenti il valore caricato o stimato.
- **Costi diretti**: ritiri del mese = giorni a orario FISSO del contratto Service vigente (`data.pickup.days`, entro la durata del
  contratto; i ritiri a chiamata si contano a parte e non si valorizzano) × `srv_costo_ritiro`; costo analitico = costo per codice della
  tabella `finance.costi_esami` (XLSX "costi esami" in Impostazioni), altrimenti `srv_costo_medio_esame`; pagamenti Finance con
  `org_id` = cliente. Costi non impostati = "da indicare" (mai zero inventato).
- Margine, margine %, ordinamento per colonna, totale di linea, dettaglio del cliente mese per mese, export XLSX/PDF.

## Istanze di pagamento: sede e cliente
`finance.payment_requests` ha `site_id` (sede / centro di costo, solo sedi TD), `org_id` (cliente) e `pl_escluso`: selettori facoltativi
nel form dell'istanza e riquadro "Controllo di gestione" nella scheda, modificabile da Finance Support e amministratori **in ogni stato**
(`PUT /api/finance/requests/:id/classificazione`, evento e audit `REQUEST_CLASSIFY`): non fanno parte del contenuto firmato
(`SIGNED_FIELDS`), quindi firme e impronta restano valide. Le istanze create dallo Scadenziario nascono con la sede del contratto o
dell'utenza. La migrazione 006 abbina il testo `cost_center` alle sedi per nome, nome breve o codice (anche la prima parte prima di
" · ", ":", " - ", " / "), solo se la sede è una sola e `site_id` è vuoto; `cost_center` non si tocca (è nel modulo firmato). Ambigui e
non riconosciuti nel rapporto (`testi_da_classificare`).

## API (`/api/finance/controllo`)
`GET conto-economico?anno&mese&site_id` (+ `/export.xlsx`, `/export.pdf`), `GET margine-service?anno&mese&org` (+ export),
`GET margine-service/cliente/:orgId?anno`, `GET|POST produzione`, `DELETE produzione/:id`, `POST produzione/stime`,
`POST produzione/import[?prova=1]` (multipart `file`, colonne Cliente, Mese, Esami, Valore, Codice esame, Descrizione, Fonte; cliente
riconosciuto da codice StudioLAB della sede SERVICE o dell'account, P.IVA o ragione sociale), `GET costi-esami`, `POST costi-esami/import`
(amministratori), `GET sedi`, `GET clienti`, `GET impostazioni`. Scritture della produzione: Finance Support e amministratori; audit
`PRODUZIONE_SRV_*`, `COSTI_ESAMI_IMPORT`, `PL_EXPORT`, `MARGINE_SRV_EXPORT`.

## Impostazioni (Finance Management > Impostazioni > Controllo di gestione)
`pl_coefficiente_oneri` (1.28), `pl_sedi_centrali` (vuoto = sedi direzionali), `pl_chiave_ripartizione` (RICAVI), `pl_iva_costi` (COSTO:
IVA indetraibile sommata, l'attività sanitaria è esente; ESCLUSA: imponibile), `srv_costo_ritiro` e `srv_costo_medio_esame` (vuoti = da
indicare), tabella costi esami. Le ipotesi compaiono nella nota "Come è calcolato" delle pagine e degli export.

## Verifiche in produzione dopo il rilascio
- Rapporto: `SELECT data FROM audit_log WHERE action='MIGRAZIONE_RAPPORTO' AND entity_id='finance/006_controllo_gestione.sql';`
  (istanze abbinate, ambigue, testi da classificare: si classificano dalla scheda dell'istanza).
- Istanze autorizzate o eseguite senza sede né cliente (finiscono tra i costi centrali):
  `SELECT count(*), sum(amount) FROM finance.payment_requests WHERE status IN ('FIRMATA','ESEGUITA') AND site_id IS NULL AND org_id IS NULL AND NOT pl_escluso;`
  e quelle per stipendi/contributi/rate da segnare "fuori dal conto economico" (`prior_approval`).
- Sede LABORATORIO presente (ricavi Service): `SELECT id, name FROM sites WHERE kind='LABORATORIO' AND active;`
- Dipendenti senza sede di lavoro (costi centrali): `SELECT count(*) FROM contracts.employments WHERE work_site_id IS NULL;`
- Clienti Service senza listino o senza volumi attesi (ricavo da indicare o niente stima): pagina Margine clienti Service, badge
  "senza listino" e "da indicare".
- Impostare costo per ritiro e costo medio per esame (o caricare i costi esami) prima di leggere il margine Service.

## Synclab Data API nel Controllo di gestione (09/11/2026)
- **Fonte SYNCLAB** della produzione Service (lib/contoEconomico.js `scegliProduzione`): dopo la riga salvata a mano (MANUALE o file
  STUDIOLAB) e **prima** di Retail e Ordini, perché è il dato del gestionale e non una stima; origine "Synclab Data API: accettazioni del
  gestionale". Dati: `lib/synclab/letture.js produzionePerOrg` = righe d'esame non cancellate delle accettazioni ATTIVE con data nel mese,
  dei client Synclab abbinati alla Legal entity (`synclab.clients_td`), per codice d'esame e prezzo netto storico.
- **Ricavo con fonte SYNCLAB** (`margineCliente`, `ricavo_da = SYNCLAB`): somma dei netti di riga del gestionale; le righe senza prezzo
  nel gestionale al listino corrente del Business Hub se lo ha, altrimenti "da indicare". Lo sconto di testata (`headerDiscountPercent`) non
  si applica di nuovo: è riportato nella nota della produzione con il numero di accettazioni scontate.
- **"Fatturato da documenti (Synclab)"**: colonna separata nella tabella dei clienti, nel dettaglio mese per mese e negli export XLSX
  (`fatturato_documenti`): `netRevenueContribution` una volta per documento con data nel mese (NC già negative, annullati e proforma a
  zero, tipo sconosciuto escluso e contato). È una grandezza diversa dalla produzione del mese: non entra nel ricavo né nel margine.
- Fonte `synclab` in `fonti` della risposta: lettura non riuscita = avviso, mai uno zero.
- Da confermare con il CEO: la priorità della fonte SYNCLAB sopra Retail/Ordini e l'uso dei netti storici al posto del listino del
  Business Hub per il ricavo.

## Conto economico senza stime nelle somme (09/11/2026 sera, v0.68.1)
- I **ricavi Service** entrano nel totale **solo con produzione effettiva** (fonte SYNCLAB, STUDIOLAB da file, Retail o Ordini, MANUALE):
  `contoEconomico.js movimentiService` divide ogni cliente mese per mese; i mesi con produzione STIMA (salvata o calcolata dall'account
  del Business Hub) vanno nella riga **"Stime commerciali (non sommate)"** (gruppo `STIME`, come il controllo Cash non entra nei ricavi,
  nel margine né nel "parziale"), sotto il totale dei ricavi, con il totale delle stime e il numero di clienti stimati (`totale.stime`).
  Stesse righe negli export XLSX e PDF.
- **KPI "Ricavi · mese"**: solo l'effettivo; sotto "effettivo: Retail GIPO x € · Service Synclab y € · stime escluse z €"
  (`totale.composizione`).
- **"Da dove viene"** su ogni KPI (riga breve con il dettaglio nel tooltip, `da_dove` della risposta): fonti e periodo effettivo, es.
  "Retail (GIPO): vendite nette 1-9 novembre, ultimo dato del 09/11"; "Service: … (Synclab: accettazioni 1-9 novembre, prezzi netti
  storici)"; "Stime commerciali escluse: …".
- **Anno prima senza dati**: se nella Suite non c'è nessuna riga dello stesso periodo dell'anno prima, KPI e riga "Margine <anno prima>"
  dicono "anno prima: nessun dato nella Suite" invece di 0,00 € (`precedente.vuoto`, anche per sede).
- **Margine per cliente Service**: colonna Fonte (origine) come prima; KPI "Ricavo effettivo" e "Margine di linea effettivo" con accanto il
  valore con le stime; in tabella le righe "Totale effettivo" e "Totale con le stime" (`ricavo_effettivo`, `ricavo_stime`,
  `margine_effettivo`, `esami_stimati` in `sommaMesi`).
- Test: `server/test/v0681-correlazioni.test.mjs` (un cliente stimato e uno Synclab: il totale esclude la stima; stima salvata fuori,
  riga MANUALE dentro). Schermate `docs/screens/finance-conto-economico.png`, `finance-margine-service.png` (collaudo con dati sintetici).

## Stime in pro quota sui soli clienti attivi e Proiezione FY (10/11/2026, v0.68.4)
Richiesta del CEO: la riga "Stime commerciali (non sommate)" mostrava "22 clienti stimati · totale 1.483.814,01 €", cioè in pratica il
fatturato FY dichiarato: la stima mensile era volumi × (250/12) giorni × prezzo per **ogni** mese e per ogni cliente ATTIVO **o
CONTRATTUALIZZATO** (anche senza avvio: senza data di avvio la stima partiva dal 1° gennaio), con il mese in corso contato per intero.
- **Chi**: solo i clienti con livello **ATTIVO** di `public.clienti_attivi_v` (= `business.accounts.cliente_attivo`, la regola unica del
  Business Hub): niente prospect, niente contrattualizzati non avviati (questi restano fuori anche dal Margine Service, salvo produzione
  effettiva nel periodo; la risposta li elenca in `esclusi_non_attivi`).
- **Quanto**: `contoEconomico.js stimaProQuota` = fatturato FY atteso × giorni lavorativi del mese successivi alla data di avvio e non
  successivi a oggi / giorni lavorativi dell'anno (`hub_giorni_lavorativi`, 250). È la stessa regola del pro quota della scheda account:
  le funzioni pure stanno in `business/lib/proQuota.js` (`giorniLavorativi`, `dataAvvio`, `proQuota`, nuova `proQuotaPeriodo`;
  `synclabAccount.js` le riesporta) ed esami stimati = `volumiGiornalieri` di `business/lib/processo.js` × gli stessi giorni.
  Mese selezionato = giorni lavorativi di quel mese dall'avvio (il mese in corso fino a oggi); anno = somma dei mesi dall'avvio a fine
  periodo/oggi, mai oltre il FY atteso pieno (`giorniUsati`). Avvio = data effettiva, prevista o di cliente attivo (`attivo_dal`); senza
  nessuna data si parte dall'inizio del periodo (dichiarato nella descrizione). Senza fatturato FY atteso vale l'equivalente volumi
  giornalieri × 250 × prezzo medio; senza nemmeno quelli, nessuna stima e un avviso con i nomi dei clienti.
- **Stima salvata** (fonte STIMA in `produzione_service`): il pro quota calcolato prevale; la riga salvata vale solo se il cliente attivo
  non ha dati economici nella scheda. Le stime salvate prima della v0.68.4 (regola vecchia) restano visibili in "Produzione inserita".
- **Proiezione FY** (`RIGHE` `proiezione_fy`, gruppo `PROIEZIONE`, non sommato come `STIME` e `CONTROLLO`): fatturato FY atteso pieno dei
  clienti attivi, anno del periodo + 1 ("Proiezione FY 2027" sul conto 2026), una riga per cliente al Laboratorio, `totale.proiezione`
  { importo, clienti, anno }. Nel Margine Service: colonna "Proiezione FY", `proiezione` nella risposta, riquadro sopra la tabella.
- Stessa regola negli export XLSX e PDF di conto economico e margine (righe "Stime commerciali in pro quota" e "Proiezione FY …";
  colonne "Di cui stima in pro quota" e "Proiezione FY" nel margine), nel "Da dove viene" e nella nota "Come è calcolato".
- Test: `server/test/finance-controllo.test.mjs`, `server/test/v0684-stime-room.test.mjs` (cliente attivo avviato il 16/10 → stima di
  ottobre = 50.000 × 11 / 250 = 2.200 €; prospect e contrattualizzato esclusi; proiezione FY 2027 separata e mai nei ricavi).
  Schermata `docs/screens/finance-conto-economico.png`.
- Verifica in produzione: Conto economico, anno in corso e mese in corso: la riga "Stime commerciali" deve dire "pro quota … · N clienti
  attivi" con N = `SELECT count(*) FROM public.clienti_attivi_v WHERE linea='SRV' AND livello='ATTIVO';` (meno quelli con produzione
  effettiva nel periodo) e la "Proiezione FY 2027" = `SELECT sum(fatturato_fy_atteso) FROM business.accounts WHERE linea='SRV' AND
  cliente_attivo;` (più gli equivalenti da volumi e prezzo). Stime salvate con la regola vecchia, da rivedere o eliminare:
  `SELECT org_id, mese, valore, note FROM finance.produzione_service WHERE fonte='STIMA' AND coalesce(note,'') NOT LIKE 'Stima in pro quota%';`

