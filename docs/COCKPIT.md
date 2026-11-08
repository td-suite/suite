# Cockpit direzionale · Scadenzario unico di direzione

Decisione del CEO (08/11/2026): "scadenzario unico di direzione che integra il Cockpit". La pagina **Scadenzario di direzione**
(`/cockpit/scadenzario`, dal monitor con il link discreto "Scadenzario completo" e dal menu della sezione Cockpit) raccoglie in una tabella
sola le scadenze vere dei moduli della Suite e dell'anagrafica. Da v0.63 `/cockpit` è il **Monitor** (sezione in fondo).

Codice: `server/src/lib/scadenzario.js` (funzione unica `scadenzeDirezione({ da, a, aree })`, fonti, regole pure, contatore della Home,
job), `server/src/lib/scadenzarioExport.js` (XLSX e PDF), `server/src/routes/scadenzario.js` (API), migrazione core
`048_cockpit_scadenzario.sql`, pagina `web/src/pages/CockpitScadenzario.jsx` (inclusa da `Cockpit.jsx`), riquadro in
Amministrazione > Impostazioni (`ScadenzarioBox` in `web/src/pages/admin/System.jsx`). Test: `server/test/cockpit-scadenzario.test.mjs`.
Schermata: `docs/screens/cockpit-scadenzario.png`.

## Regole
- **Tecnica `safe()` del Cockpit** (lib/legacy.js): ogni fonte di un modulo si legge solo se il modulo è **LIVE** nella Suite, con il pool
  del modulo (`search_path = <modulo>, public`). Modulo non LIVE = fonte "non disponibile" con la nota; lettura fallita = fonte "errore"
  con il messaggio. Nessuna riga e nessuno zero inventato: in fondo alla sezione (riquadro "fonti lette") e nel foglio "Fonti" dell'XLSX
  si vede quali fonti sono state lette, con quante righe e quali campi.
- **Nessuna data inventata**: solo campi con una data registrata. Dove il modulo non ha una scadenza ma il brief chiede un "da oltre N
  giorni" la soglia è un'impostazione dichiarata (proposte senza risposta, ordini da approvare, presa visione delle circolari).
- **Riga normalizzata**: `{ id, data, modulo, modulo_nome, area, fonte, tipo, titolo, descrizione, oggetto (Legal entity, sede o
  persona), importo, stima, stato, giorni, gravita, gravita_base, link (punto della Suite in cui si agisce), responsabile se noto }`.
  `id` è stabile (fonte + oggetto + data) e serve a "Segna come vista".
- **Stato** rispetto a oggi (Europe/Rome): `SCADUTA` (data passata), `OGGI`, `ENTRO_7` (1-7 giorni), `ENTRO_30` (8-30), `OLTRE`.
- **Gravità**: quella del tipo di scadenza (CRITICA, ALTA, MEDIA, BASSA, indicata per ogni fonte sotto), un livello più alta se è già
  scaduta (al massimo CRITICA).
- **Ordine**: per data; a parità di data prima la più grave, poi per titolo. Raggruppamento per settimana (da lunedì a domenica).
- **Intervallo** predefinito: da 30 giorni fa a 90 giorni avanti (massimo 800 giorni). Le scadenze precedenti all'inizio dell'intervallo
  non compaiono (tranne i contratti di locazione scaduti senza rinnovo dello Scadenziario, che Finance mostra sempre).
- **Accesso**: titolare, amministratori e chi ha il modulo Cockpit (grant `cockpit`, profili DIREZIONE e VIEWER); 403 agli altri. Le righe
  dei moduli con dati personali o del dossier HR (**Contratti del personale, Piano Ferie, professionisti di Room Planning**) arrivano solo a
  chi ha anche il grant di quel modulo, o a titolare e amministratori (come la card "Scadenze contrattuali" del Cockpit); per gli altri la
  fonte risulta "riservata".
- **Cache**: 3 minuti per intervallo (al massimo 20 intervalli); `?fresco=1` la salta. Le viste e la visibilità si applicano per utente
  dopo la cache.

## Fonti lette e campi
| Fonte | Modulo (deve essere LIVE) | Area | Campi letti | Tipo e gravità di base | Link |
| --- | --- | --- | --- | --- | --- |
| Sedi (Amministrazione) | core (sempre) | Direzione | `public.sites` attive non SERVICE in `LOCAZIONE`/`COMODATO`: `lease_end` (fine del primo periodo), `lease_renewal_years` (rinnovi taciti successivi), `lease_notice_months` (termine di disdetta = fine periodo − preavviso), locatore `lease_landlord_org_id`; responsabile di sede dall'organigramma (nodo Sede, `is_head`, persona attiva). **Le sedi che hanno un contratto attivo nello Scadenziario di Finance Management (LIVE) si leggono da lì**, per non avere la stessa scadenza due volte | Scadenza locazione ALTA, Disdetta ALTA | `/admin/sites` |
| Finance · Scadenziario strutture | finance | Finance | eventi di `lib/scheduleData.js` `loadScheduleData` + `lib/schedule.js` `buildEvents` (`lease_contracts`, `lease_steps`, `utilities`, `utility_bills`, `schedule_done`, `schedule_requests`): canoni, adeguamento ISTAT, imposta di registro (stima), scadenza e termine di disdetta del contratto, bollette registrate e attese (stima "~"), fine offerta; solo eventi non fatti e non ad addebito automatico; istanza collegata nella nota | fine e disdetta ALTA; canone, registro, bolletta MEDIA; ISTAT, fine offerta BASSA | `/finance/scadenziario?site_id=` |
| Finance · Istanze di pagamento | finance | Finance | `payment_requests` in `IN_FIRMA` (firma) e `FIRMATA` (autorizzata, da eseguire) con `value_date` (data valuta) nell'intervallo; importo, beneficiario, sede `site_id` se la colonna c'è, scaglione e firmatario (`tier`, `single_signer`), richiedente | In firma ALTA (responsabile = firmatario), Da eseguire MEDIA | `/finance/istanze/:id` |
| Business Hub · Contratti | business | Retail e Flow | `contracts` FIRMATO/AUTORIZZATO/ATTIVO: `end_date`; preavviso da `data.rent.notice_months` (contratti SEDE) o `data.notice_months`; contratti in PROPOSTA: `proposal_date` + soglia `proposte_giorni` | Scadenza ALTA, Disdetta ALTA, Proposta senza risposta MEDIA | `/business/contratti/:id` |
| Business Hub · Account e listini | business | Retail e Flow | `accounts`: fase 4 "Offerta inviata" (`phase_dates.4` + `proposte_giorni`, esclusi gli account con un'email ricevuta `activities` EMAIL_IN dopo l'offerta); richiami previsti dei prospect (`data_prossima_azione`, `prossima_azione`, non clienti attivi, senza "Non contattare"); avvio previsto dei clienti contrattualizzati non ancora attivi (`data_avvio_prevista`, `contrattualizzato_at` o fase ≥ 6, senza `data_avvio_effettiva`); owner (`owner_user_id`) come responsabile. `listini` di origine REVISIONE inviati (`revisione_inviata_at` + `proposte_giorni`) non firmati (`firmata_at` vuoto), solo l'ultima versione dell'account | Proposta MEDIA, Richiamo BASSA, Avvio MEDIA, Revisione listino MEDIA | `/business/account/:id` |
| Business Hub · Fascicoli di autorizzazione | business | Retail e Flow | `dossiers` non AUTORIZZATO (`status`, `submitted_at`) del contratto vigente con `start_date` (avvio previsto del punto) nell'intervallo | Autorizzazione sanitaria ALTA | `/business/fascicoli/:id` |
| Contratti del personale | contracts (riservata) | People | `computeDeadlines` di `lib/deadlines.js` (stessa fonte dei richiami di people@): `attachments.expires_at` (documenti del dossier, esclusi i sostituiti), `employments.end_date` / `probation_end` / `ral_steps` / MBO, `lp_contracts.end_date` / `insurance_expiry` / disdetta, `commitment_letters.valid_until` / `start_by`, `deadlines` manuali, cessazioni programmate, senza le scadenze chiuse dalla Casella People; ultimo richiamo da `deadline_reminders` (soglie 60/30/7/0) nella nota; **presa di servizio** = `employments.start_date` / `lp_contracts.start_date` delle persone in `IMPEGNO` | Contratto e prova ALTA; documento, lettera di impegno, manuale, presa di servizio MEDIA; RAL e MBO BASSA | `/contracts/risorse/:id` |
| Piano Ferie | ferie (riservata) | People | Piano annuale (funzionamento del CEO, 08/11/2026): impostazione `scadenze_piano` (data di invio del piano di ogni anno) con il numero di `piani` ancora in BOZZA; `piani` PROPOSTO/IN_REVISIONE (primo `inviato_at` + `promemoria_giorni`, 3) e APPROVATO non definitivi (prima `approvato_at` + `promemoria_giorni`), una riga per anno (`righeFeriePiani`, funzione pura testata); variazioni in attesa (`richieste` in RICHIESTA: `created_at` + `promemoria_giorni`, approvatore); `chiusure` (`data_inizio`, area); residuo dell'anno precedente: `saldi.residuo_ap` meno i periodi FERIE approvati o goduti dell'anno, alla data `scadenza_ap` (06-30), stima per periodi interi | Scadenza di invio MEDIA, Piani da approvare ALTA, Piani non definitivi MEDIA, Variazione MEDIA (ALTA se inizia entro 7 giorni), Chiusura BASSA, Residuo MEDIA | `/ferie/cruscotto`, `/ferie/richieste/:id`, `/ferie/area` |
| Facility e Manutenzioni | facility | Operations | `maintenance_plans` PIANIFICATA/SCADUTA (`due_date`, `kind`, `stream`, `performer`); `work_orders` non chiusi con `due_at` (SLA della priorità), assegnatario o manutentore; `property_documents.valid_until` (certificazioni, solo l'ultima per immobile, tipo e titolo); `properties.ape_valid_until` | Verifica normativa e collaudo ALTA, manutenzione MEDIA, sorveglianza BASSA; intervento secondo la priorità (URGENTE = CRITICA); certificazione ALTA; APE MEDIA | `/facility/piano`, `/facility/interventi/:id`, `/facility/immobili/:siteId` |
| Audit SGI | audit | HQS | auto-audit mensili (`audits` kind AUTO del mese, `period`) non inviati delle sedi attive di tipo struttura (`sites_v`, costante `SEDI_OPERATIVE`) aperte ed esistenti entro la fine del mese: mese corrente dal giorno `alert_day` (17) del modulo, data = fine mese; mese precedente ancora mancante (scaduto); responsabile di sede; azioni sulle NC degli audit non chiusi (`audits.ncs[].entro`, `persona_riferimento`) | Auto-audit MEDIA, Azione su NC MEDIA | `/audit/miei/:id` o `/audit/sedi/:id`, `/audit/audit/:id` |
| Certificazioni SGI | service (specchio del sito) | HQS | `service.contenuti` chiave `certificazioni` (certificazioni.json del sito pubblico): `norma`, `numero`, `prima_emissione`, `scadenza` (gg/mm/aaaa) dei certificati emessi | Certificazione ALTA | `/service/certificazioni` |
| Non conformità | nc | HQS | `nc` in INVIATA_SEDE con `sla_due_at` (termine di risposta della sede), gravità; `nc_azioni` PIANIFICATA/IN_CORSO con `scadenza` e `responsabile` | CRITICA / MAGGIORE (ALTA) / MINORE (MEDIA) | `/nc/nc/:id` |
| Ordini e Magazzino | orders | Operations | `orders` in INVIATO (in attesa di approvazione): `submitted_at` + soglia `ordini_giorni`, urgente, struttura (`strutture_v`) | ALTA se urgente, altrimenti MEDIA | `/orders/ordini/:id` |
| Room Planning · professionisti | room (riservata) | Retail e Flow | `professionista_docs.scadenza` (ultimo documento per tipo), `person_ext.dati.assicurazione.scadenza` (polizza RC), `person_ext.dati.contratto.al` (fine collaborazione), persone attive | Polizza ALTA, documento e contratto MEDIA | `/room/professionisti` |
| Circolari | circolari | HQS | circolari PUBBLICATA del segmento PERSONALE: `published_at` + soglia `circolari_giorni`; `prese_visione`; utenti attivi interni (stessa regola `isInterno` del modulo); riga solo se qualcuno non ha confermato | BASSA | `/circolari/:id` |
| Integration M&A | integration | Finance | `activities` non completate (`st` < 3) con `fine` (AAAA-MM-GG), target da `targets_v` (stessa regola del contatore "Attività M&A in ritardo") | MEDIA | `/integration` |

## Fonti scartate (motivo)
- **Autorizzazioni sanitarie delle sedi**: `public.sites` non ha una data di autorizzazione né di scadenza; i fascicoli del Business Hub
  (`business.dossiers`) hanno presentazione e rilascio ma non una scadenza: si legge l'avvio previsto del punto con il fascicolo non
  ancora autorizzato.
- **Audit pianificati**: `audit.audits` non ha una data di pianificazione (solo `conducted_at` a cose fatte).
- **Spedizioni e Kit**: kit e lotti non hanno una data di scadenza (`stock_lots` ha solo `received_at`).
- **Retail Assistant**: le uniche date future sono i richiami periodici dei pazienti (periodicità del prodotto): dato commerciale per
  paziente, non una scadenza di direzione.
- **Cash Management**: rendiconti e versamenti non hanno una scadenza registrata (il contatore "da approvare" resta nella Home).
- **Ticket**: SLA operativi gestiti dal modulo (escalation automatica), non scadenze di direzione.
- **Circolari di altri segmenti** (clienti service, punti prelievo, partner): il perimetro di lettura degli esterni si calcola per utente
  (Legal entity, liste di distribuzione); senza un elenco certo di chi deve confermare non si conta nulla.

## Interfaccia
- Riepilogo cliccabile (scadute, oggi, entro 7 giorni, entro 30): filtra per stato; i conteggi seguono area, modulo e ricerca.
- Filtri: area (Direzione, Finance, Retail e Flow, Operations, HQS, People), modulo (quelli con righe), ricerca libera (titolo, oggetto,
  tipo, note, responsabile), intervallo; "Viste (n)" mostra anche le righe nascoste; "Azzera i filtri".
- Tabella per settimana con data e giorni mancanti, gravità, scadenza (titolo, nota, tipo e modulo), oggetto, importo ("~" = stima),
  responsabile, **Apri** (punto della Suite in cui si agisce) e **Segna come vista**.
- **Segna come vista**: `public.cockpit_scadenze_viste(user_id, chiave, fino_a)`; nasconde la riga a quell'utente fino alla data compresa
  (predefinita: la data della scadenza se è futura, altrimenti tra 7 giorni; al massimo un anno); "Ripristina" la toglie. Le viste non
  contano nel riepilogo, nella card, nel contatore della Home e nella notifica.
- **Export** XLSX (fogli Scadenzario con settimana, data, stato, gravità, area, modulo, tipo, scadenza, oggetto, importo, stima,
  responsabile, note, collegamento e Fonti con stato e campi letti) e PDF (A4 orizzontale, una tabella per settimana, fonti non
  disponibili in fondo), con gli stessi filtri della pagina; audit `COCKPIT_SCADENZARIO_EXPORT`.
- **Card KPI "Scadenze entro 7 giorni"** in testa alle card del Cockpit (`getCockpit` in lib/legacy.js, per utente): da oggi a 7 giorni,
  con scadute ed entro 30 nel suggerimento; collegamento alla sezione.
- **Home**: la card Cockpit mostra il contatore "Scadenze entro 7 giorni" (contatore per utente `PER_USER_COUNTERS.cockpit` in
  lib/legacy.js), solo a chi vede il Cockpit.

## Notifica giornaliera
Job `core:scadenzario` (registrato in `jobs/register.js`, ogni 30 minuti; `DISABLE_SCHEDULER` lo ferma come gli altri): dopo l'ora
impostata (Europe/Rome, predefinita 8), **una volta al giorno**, se ci sono scadenze entro 7 giorni, notifica in app (`notify` di
lib/community.js, kind AVVISO, module_key cockpit, link `/cockpit`) al **titolare (CEO) e agli amministratori** attivi, ognuno con le
righe che può vedere e senza quelle segnate viste: conteggi (oggi, prossimi 7 giorni, già scadute) e le prime sei scadenze. Il giorno si
prenota in `public.cockpit_scadenzario_invii` (chiave primaria = giorno): con più istanze del server parte una notifica sola.

## Impostazioni (Amministrazione > Impostazioni > Scadenzario di direzione)
`app_settings` chiave `cockpit.scadenzario` (seminata dalla migrazione 048 solo se manca): `notifica_attiva` (sì; interruttore per
spegnere la notifica), `notifica_ora` (8), `proposte_giorni` (30: proposte e offerte del Business Hub senza risposta, revisioni del listino
non firmate), `ordini_giorni` (2: ordini in attesa di approvazione), `circolari_giorni` (7: presa visione delle circolari al personale).
Le tre soglie sono **ipotesi dichiarate** da confermare con il CEO. "Invia ora" manda subito la notifica del giorno (prova).

## API
`GET /api/cockpit/scadenzario?da&a&area&modulo&q&stati&viste=1&fresco=1` → `{ da, a, oggi, generated_at, riepilogo, nascoste, righe,
fonti, scartate, moduli, aree, stati, soglie }`; `GET /api/cockpit/scadenzario/export.xlsx` e `/export.pdf` (stessi filtri);
`POST /api/cockpit/scadenzario/viste { chiave, data?, fino_a? }` e `DELETE /api/cockpit/scadenzario/viste?chiave=` (audit
`COCKPIT_SCADENZA_VISTA`, `COCKPIT_SCADENZA_RIPRISTINATA`); amministratori: `GET|PUT /api/cockpit/scadenzario/impostazioni`,
`POST /api/cockpit/scadenzario/notifica` (audit `COCKPIT_SCADENZARIO_NOTIFICA`).

## Verifiche in produzione dopo il rilascio
- Migrazione applicata: `SELECT name FROM schema_migrations WHERE name = '048_cockpit_scadenzario.sql';` e
  `SELECT value FROM app_settings WHERE key = 'cockpit.scadenzario';` (se la chiave c'era già non viene toccata).
- Stato delle fonti: Cockpit > Scadenzario di direzione > riquadro "fonti lette" (o foglio Fonti dell'XLSX): ogni fonte di un modulo LIVE
  deve risultare letta; una fonte "errore" riporta il messaggio (anche nel log `[scadenzario:<fonte>]`).
- Sedi in locazione senza fine del periodo (nessuna scadenza calcolabile):
  `SELECT id, name FROM sites WHERE active AND kind <> 'SERVICE' AND tenure IN ('LOCAZIONE','COMODATO') AND lease_end IS NULL;`
- Contratti del Business Hub vigenti senza data di fine:
  `SELECT id, kind, protocol FROM business.contracts WHERE status IN ('FIRMATO','AUTORIZZATO','ATTIVO') AND end_date IS NULL;`
- Istanze in firma senza data valuta (non compaiono): `SELECT count(*) FROM finance.payment_requests WHERE status = 'IN_FIRMA' AND value_date IS NULL;`
- Notifica: `SELECT * FROM cockpit_scadenzario_invii ORDER BY giorno DESC LIMIT 5;` e, nelle notifiche, `module_key = 'cockpit'`.
- Grant: il Cockpit è aperto alle regole di accesso esistenti (profilo VIEWER, es. Finance); chi lo ha senza Contratti del personale,
  Piano Ferie o Room non vede le righe di quei moduli (fonte "riservata").

## Monitor (`/cockpit`)
Parole del CEO (08/11/2026): "Ridisegna il Cockpit direzionale. Elimina i link ai widget: non servono. Se li voglio vedere, li apro dalla
home. Immaginati che io proietto il cockpit su un monitor fisso! e deve aggiornarsi ogni 5 minuti. Deve riportare una sintesi delle
scadenze della settimana in corso e della prossima. Poi tutti indicatori numerici".

Codice: `server/src/lib/cockpitMonitor.js` (indicatori, regole pure, cache), `server/src/routes/cockpitMonitor.js` (API),
`web/src/pages/Cockpit.jsx` e `web/src/pages/cockpit-monitor.css` (pagina), `web/src/pages/CockpitScadenzarioPagina.jsx` (scadenzario
completo in pagina propria). Test: `server/test/cockpit-monitor.test.mjs`. Schermate: `docs/screens/cockpit-monitor.png` (tema scuro) e
`docs/screens/cockpit-monitor-chiaro.png` (tema chiaro), 1920×1080.

### Pagina
- **Nessun link ai moduli**: le card non sono cliccabili, il menu della sezione Cockpit ha solo Monitor e Scadenzario completo (prima
  c'erano Cash, Finance e Integration). L'unico collegamento è "Scadenzario completo", in fondo.
- **Aggiornamento automatico ogni 5 minuti** (nessun pulsante Aggiorna): in alto, discreto, "Aggiornato alle HH:MM · prossimo tra N min";
  un errore di rete lascia i dati precedenti e lo dice. Data e ora grandi in alto a destra.
- **Tema**: segue il tema della Suite; il tema scuro riprende la fascia scura (hero) della Home.
- **Griglia a 12 colonne**: a sinistra (4) "Questa settimana" e "Prossima settimana" (conteggi per gravità e scadute, fino a 8 righe con
  data, titolo, oggetto, chip del modulo e barra della gravità, poi "+N altre"); a destra (8) gli indicatori per gruppo (etichetta del
  gruppo in verticale), con valore grande (32-36 px), confronto (freccia e % o punti, verde se migliora e rosso se peggiora secondo il verso
  dell'indicatore), sparkline degli ultimi 12 punti, dettaglio, fonte e momento dell'ultimo dato. Indicatore non disponibile = card
  tratteggiata e attenuata con il motivo.
- **Schermo intero** (API Fullscreen) e **`?monitor=1`**: la pagina si apre senza la barra della Suite (App.jsx la rende fuori dalla
  Shell, come la presa d'atto). In modalità monitor su uno schermo orizzontale la pagina si compone su una tela di 1920 px e si **scala**
  per stare tutta nello schermo (1280×720, 4K) senza barre di scorrimento; su schermi stretti o verticali resta responsive (una colonna).
  Le colonne seguono la larghezza del cockpit (container query), non dello schermo.

### API
`GET /api/cockpit/monitor[?fresco=1]` (titolare, amministratori e chi ha il modulo Cockpit; 403 agli altri) →
`{ generato_at, oggi, cache: { eta_s }, aggiorna_ogni_s: 300, scadenze: { blocchi: [{ key, titolo, da, a, periodo, conteggi: { totale,
scadute, CRITICA, ALTA, MEDIA, BASSA }, righe: [{ id, data, giorni, stato, gravita, titolo, oggetto, tipo, modulo, modulo_nome, area,
importo, stima }], altre }], riservate, fonti }, gruppi, indicatori: [{ chiave, titolo, gruppo, valore, unita, meglio, confronto:
{ valore_precedente, delta, delta_pct, segno, esito, punti, etichetta }, dettaglio, serie: [{ etichetta, valore }], parti, tabella,
secondario, fonte, aggiornato, nota, non_disponibile, motivo }], moduli }`.
- **Cache in memoria di 60 secondi** per tutti i monitor (una sola esecuzione alla volta: chi arriva durante il calcolo aspetta lo
  stesso); la serie mensile del conto economico ha una cache propria di 15 minuti. `?fresco=1` ricalcola.
- **Scadenze**: `scadenzeDirezione` (lib/scadenzario.js) letta una volta da lunedì della settimana in corso a 30 giorni da oggi (copre la
  prossima settimana e lo Scadenziario a 30 giorni). Settimana = da lunedì a domenica (`settimaneMonitor`, anche a cavallo d'anno);
  "Questa settimana" comprende le scadute dei giorni già passati. Le viste ("Segna come vista") **non** filtrano il monitor; le righe dei
  moduli riservati (Contratti, Ferie, Room) arrivano solo a chi le può vedere (`visibiliA`), le altre sono contate in `riservate`.
- **Fonti**: tecnica `safe()`; ogni modulo si legge solo se è LIVE; modulo non LIVE = indicatore `non_disponibile: true` con il motivo
  ("Ordini e Magazzino: modulo non avviato nella Suite"), lettura fallita = gruppo non disponibile con il messaggio. Mai uno zero finto:
  uno zero compare solo se la fonte è stata letta e non ha righe.

### Indicatori, fonti e formule
Confronto: "stesso periodo precedente". Incassi di oggi: stesso giorno della settimana scorsa; incassi del mese e conto economico: stesso
periodo dell'anno precedente; indicatori operativi del mese (eseguite, NC chiuse, ordini, contratti firmati): mese precedente fino allo
stesso giorno; percentuali: differenza in punti con il mese precedente. Indicatori di stato (in firma, aperte, in corso): nessun confronto
(non c'è uno storico registrato).

| Gruppo | Indicatore | Fonte e formula |
| --- | --- | --- |
| Incassi | Incassi di oggi | Cash: rendiconti di oggi in stato CLOSED o successivo, `cash_to_deposit + pos_total + transfer_total`. Se Cash non ha ancora un rendiconto di oggi: Retail, vendite nette di oggi (`net_amount`, senza le DEMO e senza le prestazioni B2B fatturate alle aziende), dichiarato nel dettaglio e nella fonte. Serie: ultimi 12 giorni |
| Incassi | Incassi del mese | Stessa logica dal 1° del mese a oggi (Cash se ha rendiconti nel mese, altrimenti Retail); confronto con lo stesso periodo dell'anno scorso; serie: 12 mesi |
| Incassi | Incassi per sede del mese | Stessa fonte, per sede (`public.sites`), le prime 8 |
| Ricavi e costi | Ricavi del mese / dell'anno | Conto economico di Finance Management (`contoEconomico` di `modules/finance/lib/controlloData.js`, regole di `contoEconomico.js`): totale ricavi (produzione Retail + Service) del mese e dell'anno fino al mese corrente; confronto con lo stesso periodo dell'anno prima (come la pagina del modulo) |
| Ricavi e costi | Costi del mese / dell'anno | Costi diretti di sede + costi centrali dello stesso conto (righe non disponibili escluse e dichiarate nella nota "Parziale") |
| Ricavi e costi | Margine del mese / dell'anno | Ricavi − costi, margine % sui ricavi |
| Ricavi e costi | Produzione (fatturabile) | **Ipotesi dichiarata**: la Suite non ha la fatturazione attiva (decisione 12), quindi l'indicatore "Fatturato" mostra il valore della produzione del mese (Retail + Service a listino) con l'etichetta "Produzione (fatturabile)" e la nota "Non è il fatturato emesso". Nessun fatturato inventato |
| Processi finance | Istanze in firma | `finance.payment_requests` IN_FIRMA: numero e importo |
| Processi finance | Firmate da eseguire | FIRMATA: numero e importo |
| Processi finance | Pagamenti eseguiti | ESEGUITA con `executed_at` nel mese: importo e numero; serie 12 mesi |
| Processi finance | Scadenziario a 30 giorni | Righe della fonte `finance_scadenziario` dello scadenzario da oggi a 30 giorni: somma degli importi (stime dichiarate) |
| Operations | NC aperte | `nc.nc` non CHIUSA/VERIFICATA/ANNULLATA; di cui oltre il termine = INVIATA_SEDE con `sla_due_at` passato (stessa regola del modulo) |
| Operations | NC chiuse nel mese | CHIUSA o VERIFICATA con `closed_at` nel mese |
| Operations | Ordini in corso | `orders.orders`: da approvare INVIATO, in preparazione APPROVATO + PRESO_IN_CARICO, in consegna SPEDITO |
| Operations | Ordini del mese | Ordini non in bozza con `submitted_at` nel mese |
| Operations | Kit in gestione | `shipments.kits` ASSIGNED, SHIPPED, DELIVERED, SAMPLE_RECEIVED, SHIPPED_TO_LAB (in viaggio = SHIPPED; al paziente = ASSIGNED, DELIVERED, SAMPLE_RECEIVED; al laboratorio = SHIPPED_TO_LAB, l'etichetta del modulo); da rendicontare = righe di spedizione e campione con compenso fuori da un periodo di rendiconto chiuso (stessa regola della Rendicontazione), con l'importo |
| Operations | Referti da trascrivere | `referti.schede` in BOZZA (e PDF caricati non elaborati) |
| Retail e Flow | Copertura turni del mese | `room.turni` del mese: con professionista / totale |
| Retail e Flow | Copertura ambulatori | **Ipotesi dichiarata**: ore prenotabili degli ambulatori del mese (fasce `disp` dell'ambulatorio dentro l'orario di apertura della sede, senza le fasce dei prelievi e i giorni di chiusura `eventi` CHIUSURA: stessa regola del motore di Room) coperte da un turno con professionista sullo **stesso ambulatorio** (`turni.room_id`), sul totale. Configurazione attuale degli ambulatori (nessuno storico, quindi nessuna serie); i turni senza ambulatorio non si contano e sono indicati. Se Room non permette il calcolo (nessuna sede configurata, nessun ambulatorio, nessuna fascia, nessun turno) si dichiara e si mostra la copertura dei turni |
| Retail e Flow | Richiami Retail scaduti | Ultima vendita per paziente e prodotto + `periodicity_months` del prodotto, scaduta (regola del contatore del widget) |
| Retail e Flow | Clienti attivi Service e MdL | `public.clienti_attivi_v` linee SRV e MDL (attivi e contrattualizzati "in avvio"); si legge solo con il Business Hub LIVE |
| Retail e Flow | Pipeline in fase 4-5 | `business.accounts` con `fase_corrente` 4 (offerta inviata) o 5 (negoziazione) |
| Retail e Flow | Contratti firmati nel mese | `business.contracts` PP/SRV/MDL con `signed_at` nel mese |
| Persone e qualità | Dipendenti attivi | `public.people` DIPENDENTE e DIRIGENTE ATTIVI (sempre leggibile) |
| Persone e qualità | Assenti oggi | `ferie.richieste` APPROVATA/GODUTA che comprendono oggi, dei piani APPROVATO o DEFINITIVO, persone attive (ferie e ROL distinti) |
| Persone e qualità | Auto-audit mancanti | Sedi struttura in esercizio (`audit.sites_v`) senza auto-audit del mese inviato (regola del contatore del widget); inviati da verificare nel dettaglio |
| Persone e qualità | Ticket aperti | `ticket.tickets` non CHIUSO/ANNULLATO, per priorità |
| Persone e qualità | Circolari da confermare | Circolari PUBBLICATA al PERSONALE degli ultimi 90 giorni con conferme mancanti; % di presa visione = conferme / (circolari × utenti interni attivi, regola `isInterno` del modulo) |

### Verifiche in produzione dopo il rilascio
- `GET /api/cockpit/monitor` con un utente del Cockpit: `indicatori[].non_disponibile` deve essere vero solo per i moduli non LIVE
  (`moduli` nella risposta) e il motivo lo deve dire; il log non deve avere righe `[cockpit:monitor:...]`.
- Tempo di calcolo: la prima chiamata (o `?fresco=1`) calcola tutto (conto economico di mese, anno e 12 mesi compresi); le successive per
  60 secondi rispondono dalla cache (`cache.eta_s` > 0).
- Copertura ambulatori: se il dettaglio dice "turni senza ambulatorio non contati", i turni manuali di Room non hanno l'ambulatorio
  (`SELECT count(*) FROM room.turni WHERE prof_id IS NOT NULL AND room_id IS NULL AND mese = to_char(CURRENT_DATE,'YYYY-MM');`).
- Monitor fisso: aprire `/cockpit?monitor=1` sul PC collegato allo schermo, poi "Schermo intero"; la sessione deve restare valida
  (utente dedicato con il solo modulo Cockpit, profilo VIEWER).
