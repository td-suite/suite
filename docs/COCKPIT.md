# Cockpit direzionale · Scadenzario unico di direzione

Decisione del CEO (08/11/2026): "scadenzario unico di direzione che integra il Cockpit". Nel Cockpit (`/cockpit`), sopra le card KPI,
la sezione **Scadenzario di direzione** raccoglie in una tabella sola le scadenze vere dei moduli della Suite e dell'anagrafica.

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
| Piano Ferie | ferie (riservata) | People | `richieste` in RICHIESTA: `created_at` + impostazione del modulo `promemoria_giorni` (3), periodo, approvatore (`approvatore_person_id`, altrimenti HR); `chiusure` (`data_inizio`, area); residuo dell'anno precedente: `saldi.residuo_ap` meno le richieste FERIE approvate o godute dell'anno (dopo la scadenza solo quelle concluse), alla data `scadenza_ap` del modulo (06-30); una riga aggregata, stima per richieste intere | Richiesta MEDIA (ALTA se le ferie iniziano entro 7 giorni), Chiusura BASSA, Residuo MEDIA | `/ferie/richieste/:id`, `/ferie/piano`, `/ferie/cruscotto` |
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
