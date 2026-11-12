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

### Pagina (schermo unico, v0.68.1)
Richiesta del CEO del 09/11/2026 sera: il monitor è **UNA schermata senza scorrimento a 1920×1080 e 1366×768** (griglia CSS a 12 colonne,
altezze delle righe in frazioni dell'altezza della finestra, caratteri con `clamp()` sull'altezza, nessuna card alta: il contenuto si
taglia con i puntini invece di allungare la pagina). Sotto i 1100 px di larghezza o i 600 px di altezza la pagina torna a scorrere in una
colonna (telefono, tablet in verticale). La tela scalata a 1920 px della v0.65 non c'è più.

Righe dall'alto (dati in `schermo` della risposta, `lib/cockpitMonitor.js` `schermoMonitor`):
1. **Intestazione sottile**: logo, titolo, ora e data, fonti con la data di ciascuna (GIPO = ultima vendita importata; TuoTempo = ultimo
   giorno della prima disponibilità; Synclab = ultimo checkpoint della copia, ora compresa), "Aggiornato alle HH:MM · prossimo tra N min
   · v<versione>", schermo intero, "Barra" (torna alla Suite) o, fuori dal monitor, "Monitor" e "Scadenzario completo".
2. **Ricavi** (v0.68.5): "Ricavi di oggi" e "Ricavi del mese" = **B2C** (GIPO: vendite nette dei privati, righe senza committente B2B,
   senza dimostrative) **+ B2B produzione erogata** (Synclab: accettazioni in stato erogato dei client B2B secondo la ripartizione di Retail,
   `synclab_privati_in_b2c`; netto di riga × quantità × (1 − sconto di testata); definizione unica in docs/SYNCLAB_DATA_API.md "Produzione
   erogata"), con le due componenti sotto e il confronto con lo stesso giorno / lo stesso periodo dell'anno prima. La somma è dichiarata nella
   fonte; con una sola componente disponibile la cella dice "parziale: manca …". Fino alla v0.68.4 il B2B erano i documenti emessi: il CEO
   (10/11/2026) vuole la progressione quotidiana, che i documenti (emessi a inizio del mese successivo) non danno.
3. **Laboratorio (Synclab)**: accettazioni **erogate** di ieri, di oggi e del mese ed esami del mese (tutti i client: B2B e Laboratorio in
   sede, con le due parti; nel dettaglio anche le accettazioni registrate in tutto), **Produzione B2B oggi** e **Produzione B2B del mese**
   (con i documenti emessi del mese solo come dato secondario, "non sommati"), **andamento giornaliero del mese** (mini barre, una per giorno,
   oggi evidenziato, fine settimana attenuati; cella da due colonne nella riga, senza scorrimento), **TOP 5 clienti Service per produzione
   erogata del mese** con la quota sul totale B2B e la variazione sullo stesso periodo del mese prima ("nuovo" senza produzione nel mese
   prima). Fonte sotto ogni numero: "Synclab, accettazioni erogate (stati 18, 20, 25, 40, 50), netto di riga e sconto di testata, copia al
   … · aggiornato alle HH:MM"; nell'intestazione "Synclab · accettazioni aggiornato alle HH:MM" (delta di giorno ogni ora, docs/SYNCLAB_DATA_API.md).
4. **Retail B2C**: accettazioni GIPO del giorno e del mese (`external_ref` distinti), scontrino medio (vendite nette del mese /
   accettazioni), prima disponibilità online (mediana della rete, TuoTempo), quota fuori area dei clienti GIPO del mese (comune e provincia
   diversi da quelli della sede).
5. **Scadenze e persone**: questa settimana e la prossima (al più **6 righe** ciascuna, "+N altre"), ferie e permessi oggi (Piano Ferie),
   NC aperte, ordini in attesa (da approvare, con in preparazione e in consegna).

Ogni numero ha sotto la **fonte in 10-11 px** (e nel tooltip confronto, dettaglio e nota). Fonte assente = cella tratteggiata "Non
disponibile" con il motivo, mai uno zero. **Nessun link ai moduli**, aggiornamento automatico ogni 5 minuti, `?monitor=1` senza la barra
della Suite, tema chiaro e scuro della Suite. Gli indicatori per gruppo di prima restano nel JSON (`indicatori`, usati anche dallo
schermo per ferie, NC, ordini e TuoTempo) ma la pagina mostra solo lo schermo. La pagina **Scadenzario completo** (`/cockpit/scadenzario`)
resta separata.

Collaudo v0.68.5 (db proprio, dati sintetici): riga Laboratorio a 4 colonne con l'andamento giornaliero, ancora senza scorrimento a
1920×1080 e 1366×768; schermata `docs/screens/cockpit-monitor.png` aggiornata. Test `server/test/v0685-produzione-erogata.test.mjs`.

Collaudo v0.68.1 (db proprio, dati sintetici): Playwright a 1920×1080 e 1366×768 con `document.scrollHeight ≤ innerHeight` e nessuno
scorrimento orizzontale; schermate `docs/screens/cockpit-monitor.png` (scuro, 1920), `cockpit-monitor-1366.png` (scuro, 1366),
`cockpit-monitor-chiaro.png` (chiaro, 1920). Test: `server/test/v0681-correlazioni.test.mjs` (somma B2C + B2B, TOP 5, schermo calcolato
con Synclab e GIPO sintetici).

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

### Attesa alla prima disponibilità (TuoTempo, 09/11/2026)
| Gruppo | Indicatore | Fonte e formula |
|---|---|---|
| Retail e Flow | Attesa alla prima disponibilità (giorni) | `retail.tuotempo_attivita` dell'ultimo giorno allineato: per ogni prestazione prenotabile online, giorni dal momento dell'allineamento notturno al primo slot libero (`first_availability` di TuoTempo), attribuita alla sede del primo slot (area abbinata). Valore = mediana della rete; tabella = mediana per sede (prime 8, dalla più lunga); confronto con lo stesso dato di una settimana prima; serie degli ultimi 12 giorni. Senza allineamenti: "non disponibile" con il motivo. **Ipotesi dichiarata**: è la prima disponibilità della prestazione su tutta la rete (Key Entities), non l'agenda di ogni sede (servirà Availabilities, Fase 2). Docs: docs/RETAIL_TUOTEMPO.md |

Verifica in produzione: dopo il primo allineamento la card ha un valore e la tabella per sede; `SELECT data, count(*) FROM retail.tuotempo_attivita GROUP BY 1 ORDER BY 1 DESC LIMIT 3;`.

### Indicatori dal gestionale (Synclab Data API, 09/11/2026)
Nel gruppo **Operations** (il monitor non ha un gruppo Laboratorio/Service: le chiavi dei gruppi restano le sei di prima):
"Accettazioni erogate ieri (Synclab)" (`synclab_accettazioni_ieri`: accettazioni ATTIVE in stato erogato con data di ieri) e, dalla
v0.68.5, "Produzione erogata laboratorio mese (Synclab)" (`synclab_produzione_mese`: produzione erogata di tutti i client dal primo del
mese a oggi, con i documenti emessi del mese come dato secondario mai sommato; prima era "Fatturato laboratorio mese", dai documenti).
Compaiono **solo se ci sono dati importati**: con la Data API spenta o vuota non ci sono (non sono "non disponibili", perché l'assenza è una
scelta). Fonte con l'ora dell'ultima sincronizzazione riuscita.

### Profilo dei pazienti del laboratorio (Synclab, proiezione standard, v0.67.1)
| Gruppo | Indicatore | Fonte e formula |
|---|---|---|
| Retail e Flow | Età mediana pazienti laboratorio (mese) (`synclab_eta_mediana`, anni) | Mediana di `demographics.ageYears` (età alla data dell'accettazione) delle accettazioni ATTIVE con almeno una riga non cancellata, dal primo del mese a oggi; confronto con lo stesso periodo del mese scorso; dettaglio con accettazioni, quota donne/uomini e quota con età non disponibile. Accettazioni, non persone |
| Retail e Flow | Quota fuori area (`synclab_fuori_area`, %) | Accettazioni del mese con comune di residenza diverso da quello della sede **e** provincia diversa, sulle valutabili (sede abbinata con `synclab.clients_td.site_id` e comune/provincia noti); confronto in punti con lo stesso periodo del mese scorso |

Come gli altri indicatori Synclab compaiono **solo se ci sono accettazioni importate**; con accettazioni nella copia ma nessuna nel mese
la card è "non disponibile" con il motivo. Stesse regole della pagina Retail > Profilo dei pazienti (docs/RETAIL_PROFILO_PAZIENTI.md,
`sintesiProfilo` in `lib/synclab/letture.js`). Verifica in produzione: dopo il primo completo delle accettazioni le due card sono nel
gruppo Retail e Flow e l'età mediana coincide con quella della pagina sul mese in corso.

### Monitor ridisegnato sulla produzione (v0.68.6, CEO 10/11/2026)
"Troppa enfasi sulle attività in scadenza, poca sui numeri e sui grafici della produzione che mi interessano ben di più. Aggiungi almeno una
statistica significativa per ogni widget." Sempre UNA schermata senza scorrimento a 1920×1080 e 1366×768 (verificato: `scrollHeight ≤
innerHeight`, nessuno scorrimento orizzontale), tema scuro e chiaro, `?monitor=1`, aggiornamento ogni 5 minuti, fonte sotto ogni numero,
nessun link ai moduli. Fasce (righe della griglia 23/37/25/13):
1. **Produzione** (~60% con la fascia 2): 4 grandi KPI (`schermo.kpi`): Ricavi di oggi, Ricavi del mese (= B2C GIPO + **produzione laboratorio
   StudioLab tutta**, B2B + Laboratorio in sede), Produzione laboratorio oggi e del mese (con le componenti B2B e in sede). Ognuno con il
   confronto con l'anno prima e le statistiche (`statistiche`): oggi = **vs media giornaliera del mese**; mese = **proiezione a fine mese** e **%
   sul mese precedente allo stesso giorno**. Media = produzione dei giorni completi (dal 1° a ieri) / giorni lavorativi (lun-ven, regola del pro
   quota del Business Hub); proiezione = media × giorni lavorativi del mese (`statisticheMese`, pura). Il primo del mese: "non disponibile".
2. **Andamento** (`schermo.grafici`, SVG disegnati in pixel, nessuna libreria): barre giornaliere del mese della produzione laboratorio (B2B e in
   sede impilate, B2C GIPO affiancato), linea della media e del mese precedente (giorno per giorno); ultimi 12 mesi (laboratorio impilato + B2C);
   TOP 5 clienti Service come barre orizzontali con % sul B2B e variazione sul mese prima; ripartizione B2B / in sede / B2C del mese (anello).
3. **Operatività** (`schermo.operativita`, 10 tessere con numero e statistica): accettazioni oggi (vs media dello stesso giorno della settimana
   nelle 8 settimane precedenti coperte dai dati), esami del mese (esami per accettazione; di cui senza prezzo), scontrino medio GIPO (vs mese
   prima), prima disponibilità online (vs una settimana prima), quota fuori area (vs mese prima, in punti), NC aperte (NC aperte nel mese ogni
   1.000 accettazioni Synclab del mese, % oltre il termine), ordini da approvare (tempo medio di approvazione degli ultimi 90 giorni), ferie e
   permessi oggi (% sui dipendenti attivi), clienti Service attivi con produzione nel mese (n e % sui clienti attivi), clienti in ritardo sul pro
   quota (semaforo giallo/rosso del Business Hub, con i rossi).
4. **Scadenze** (`schermo.scadenze_sintesi`, per utente): contatori di questa settimana, della prossima e delle scadute (ultimi 30 giorni:
   lo scadenzario si legge ora da 30 giorni fa) e le 3 più vicine da oggi in una riga; il dettaglio resta nello Scadenzario completo.
- **Mai zeri finti**: un periodo di confronto anteriore al primo dato importato (Synclab o GIPO) non vale zero ma "non disponibile"; i mesi e i
  giorni dei grafici prima del primo dato sono null ("n.d.").
- Nell'intestazione la regola in vigore ("Produzione accettata · importi di riga"). Le chiavi della v0.68.5 (`ricavi`, `laboratorio`, `top5`,
  `andamento`, `retail`, `persone`, `scadenze`) restano nel JSON; `ricavi` ora somma tutto il laboratorio.
- **Punto aperto**: possibile doppio conteggio fra GIPO e Laboratorio in sede (nessun criterio certo nei dati GIPO, nulla viene tolto: nota
  dei Ricavi e della ripartizione; docs/SYNCLAB_DATA_API.md, "Punti aperti").
- Indicatori del gruppo Operations rinominati: "Accettazioni ieri (Synclab)", "Produzione accettata laboratorio mese (Synclab)".

Collaudo v0.68.6 (db proprio, dati sintetici con nomi inventati): schermate `docs/screens/cockpit-monitor.png` (scuro, 1920×1080),
`cockpit-monitor-1366.png` (scuro, 1366×768), `cockpit-monitor-chiaro.png` (chiaro, 1920×1080), tutte senza scorrimento. Test
`server/test/v0686-produzione-accettata.test.mjs` (KPI e statistiche, grafici, tessere, sintesi delle scadenze, funzioni pure).
Verifica in produzione: `GET /api/cockpit/monitor` → `schermo.kpi` con 4 voci e `statistiche`, `schermo.operativita` con 10 tessere (le "non
disponibili" con il motivo), `schermo.scadenze_sintesi`.

### Tessere di Lab Control (v0.71.0, CEO 12/11/2026)
Nel riquadro Operatività tre tessere con i dati di Lab Control (`modules/etichette/lib/lab.js` `indicatoriCockpit`, tutta la rete, soglie
dalle impostazioni di Lab Control o predefinite se il modulo non è avviato; nessun link, regola del monitor):
- **In lavorazione ora**: accettazioni negli stati 15, 18, 20, 25 degli ultimi `giorni_finestra` giorni (60); statistica: referti pronti non chiusi (stato 40).
- **In ritardo (oltre N ore)**: in corso da oltre `ore_ritardo` (72) ore dall'accettazione senza referto; statistica: quota sulle accettazioni in corso.
- **TAT mediano 7 giorni**: accettazione → referto pronto dei referti degli ultimi 7 giorni, in ore; statistiche: vs i 7 giorni prima, 90° percentile.
Sostituiscono "Esami del mese", "Quota fuori area" e "Clienti Service con produzione" (restano in Retail e nel Business Hub): le tessere
restano 10 (5 × 2), una schermata senza scorrimento. Dettagli in LAB_CONTROL.md.
