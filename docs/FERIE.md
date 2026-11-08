# Modulo Piano Ferie · ferie annuali dei dipendenti per Area

Modulo nativo della Suite (chiave `ferie`, area PEOPLE, dopo Rubrica e Organigramma). Decisione del CEO (08/11/2026): "widget
dedicato per le ferie annuali; solo dipendenti; piano ferie per Area: Direzione, Laboratorio, Sedi". Si avvia vuoto da
Amministrazione > Travaso moduli > "Avvia il modulo" (è in `FRESH_MODULES`), dopo Contratti del personale (che fornisce i contratti).
Codice: `server/src/modules/ferie`, `web/src/modules/ferie`; test: `server/test/ferie.test.mjs`.

## Perimetro e Area
- **Chi c'è**: persone di `public.people` di tipo DIPENDENTE (e DIRIGENTE, impostazione `includi_dirigenti`, predefinita sì) in stato
  ATTIVO con una riga in `contracts.employments`. Liberi professionisti, medici e sanitari a incarico sono esclusi. Senza il modulo
  Contratti del personale avviato il perimetro è vuoto e il modulo lo dice.
- **Area** (lib/perimetro.js `areaPersona`), dall'unità della persona (`people.unit_id`, altrimenti il primo incarico) risalendo
  l'organigramma: Laboratorio se la sede dell'unità è di tipo LABORATORIO o un'unità della catena è un'AREA che si chiama
  "Laboratorio..."; Direzione se la persona afferisce al vertice, l'unità di primo livello è di tecnostruttura (`branch` STAFF) o la
  sede è HEADQUARTER; altrimenti la sede dell'unità (una colonna per sede, mai un punto SERVICE); senza unità, la sede di lavoro della
  persona; senza nulla, "Da assegnare" (segnalato nel cruscotto HR). Impostazioni > Aree forzate (`ferie.aree_forzate`) prevale.
- **Approvatore**: approvatore ferie del dossier HR (`contracts.person_ext.approver_id`) se c'è; altrimenti il responsabile del nodo
  Sede (per le Sedi) o dell'unità di primo livello (Direzione, Laboratorio) da `org_positions.is_head`/`head_person_id`; altrimenti
  `people_manager()`; altrimenti HR. Mai sé stessi. Deleghe a tempo (`ferie.deleghe`); HR (ADMIN) decide sempre (delega HR).

## Saldo (lib/saldi.js, lib/core.js `saldoPersona`)
- Giorni annui: `ferie.spettanze` per CCNL e livello (vale la riga più specifica); il contratto non ha un campo ferie. Riga generale
  seminata a **26 giorni come ipotesi** (brief del CEO): da verificare sul testo del CCNL, spesso il valore è riferito alla settimana di 6
  giorni. Forzatura per persona e anno nel saldo (`saldi.giorni_annui`).
- Spettanza = giorni annui × mesi lavorati / 12 (assunzione e cessazione dal contratto; un mese conta con almeno `soglia_mese_giorni`,
  predefinito 15, ipotesi); maturato a oggi = stessa regola sui mesi conclusi.
- Residuo anno precedente: inserito da HR a mano (Cruscotto > matita) o da XLSX (modello precompilato, prova senza scrittura, abbinamento
  per codice fiscale, email, Cognome Nome); i giorni goduti lo consumano per primo.
- Goduto = giorni approvati o goduti fino a oggi; pianificato = approvati futuri; in attesa = richieste da decidere;
  residuo = anno precedente + spettanza − goduto − pianificato; disponibile = residuo − in attesa.
- ROL e permessi in ore: voce facoltativa (`rol_attivi`), ore annue per CCNL/livello senza valore predefinito.
- Avvisi: residuo dell'anno precedente non goduto entro `scadenza_ap` (06-30, come indicato dal CEO; il D.Lgs. 66/2003 art. 10 prevede
  almeno due settimane nell'anno di maturazione e il resto entro i 18 mesi successivi: confermare la regola con il consulente del lavoro);
  residui a rischio nei `mesi_rischio` (ottobre, novembre) da `soglia_rischio_giorni` (10) in su; saldo negativo (anticipo, non bloccato).

## Richieste
- Periodo con mezze giornate (primo giorno dal pomeriggio, ultimo fino alla mattina), note, una richiesta per anno solare (le richieste a
  cavallo d'anno si dividono). Conteggio automatico (lib/calendario.js): festivi nazionali (Pasquetta calcolata; 4 ottobre dal 2026,
  impostazione `festa_4_ottobre`), patrono della sede (`ferie.patroni`, nessun valore precompilato), festivi aziendali aggiunti o esclusi,
  settimana dal contratto (`weekly_days` 6 o "sabato" in `days_label` → lunedì-sabato, altrimenti lunedì-venerdì).
- Il dipendente non chiede giorni passati; nessuna sovrapposizione con altre richieste attive. HR inserisce per conto e può registrare
  direttamente approvato (anche nel passato).
- Stati: RICHIESTA → APPROVATA / RIFIUTATA (motivo obbligatorio) → GODUTA (job, a data passata) · ANNULLATA (il dipendente finché non
  iniziata, l'approvatore e HR; HR anche le godute). Cronologia in `ferie.eventi`, audit della Suite `FERIE_*`.
- Notifiche in app (`notify`, kind FERIE, link `/ferie/richieste/<id>`) all'approvatore e ai suoi delegati (senza approvatore a HR) e al
  dipendente; email solo con `email_attiva` (spenta), con il mittente della Suite agli utenti con email e avvisi email attivi.
- Job `ferie:promemoria` (giornaliero, solo con modulo LIVE, Impostazioni > "Esegui ora"): GODUTA alle approvate concluse, promemoria
  all'approvatore per le richieste in attesa da più di `promemoria_giorni` (3), al massimo uno al giorno.

## Piano per area e copertura
- Vista mese (persone × giorni) e anno (persone × mesi) per Direzione, Laboratorio e ogni sede; "Oggi e prossimi 14 giorni".
- Copertura minima (`ferie.coperture`): ambito DIR, LAB, SEDE:<id> o KIND:<tipo sede> (es. ogni punto prelievi), ruolo (`job_roles`, della
  scheda o di un incarico; vuoto = chiunque), minimo di presenti. Una richiesta che scende sotto il minimo NON è bloccata: `sotto_copertura`
  e il dettaglio arrivano all'approvatore (ricalcolato all'apertura e all'approvazione); nel piano i giorni sotto il minimo sono rossi.
  Ipotesi: contano i dipendenti del perimetro della stessa area o sede, mezza giornata = mezza presenza, le richieste in attesa contano
  come assenze quando si valuta una richiesta.
- Chiusure collettive (`ferie.chiusure`, per area o TUTTE): proposte ai dipendenti ("Richiedi"), mostrate nel piano.
- Esportazioni: `GET /api/ferie/export/piano.xlsx?gruppo=<DIR|LAB|SEDE:id|SEDI|TUTTI>&anno=` (un foglio per area persone × giorni, fogli
  Richieste e Copertura) e `.../piano.pdf` (una pagina per area e mese, `&mese=` per uno solo).

## Accessi
- Aperto a tutti gli interni (`open_to_all`, ruolo implicito DIPENDENTE): le proprie ferie e il piano della propria area (nomi e periodi
  dei colleghi, senza note né saldi). Profili: ADMIN = HR (tutto, impostazioni, saldi, decide sempre), RESPONSABILE (approva e vede i saldi
  della propria area o sede anche oltre l'organigramma), VIEWER (consultazione di tutto). I responsabili dall'organigramma approvano senza
  grant le persone di cui sono approvatori. Owner e Admin della Suite sono ADMIN.
- Esterni (partner, clienti service): 403 su tutte le API senza un grant esplicito; la Home li nasconde (`soloInterni` in meta.js);
  nessun contatore.
- Home: card nell'area People con "richieste da approvare" (chi approva, HR) o "giorni residui" (dipendente), contatore per utente
  (`PER_USER_COUNTERS` in lib/legacy.js). Cockpit: nessuna card.

## Produzione
1. Pubblicare, poi Amministrazione > Travaso moduli > Piano Ferie > Avvia (Contratti del personale deve essere avviato).
2. Regole di accesso come per gli altri moduli nuovi: le regole si seminano solo su `grant_rules` vuota, quindi in produzione HR va
   assegnato a mano (grant `ferie` ADMIN alle persone HR) o con una regola da Amministrazione > Regole di accesso; RESPONSABILE facoltativo.
3. HR: verificare i giorni annui per CCNL e livello, inserire i patroni delle sedi, le regole di copertura, le chiusure, il residuo
   dell'anno precedente (modello XLSX), decidere `email_attiva` e la scadenza del residuo.
4. Controllare il cruscotto "Da assegnare" e i responsabili mancanti (approva HR).
