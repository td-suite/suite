# Gestione del Personale (v0.77.0)

Dal 16/11/2026 il widget "Contratti del Personale" si chiama **Gestione del Personale**. Chiave del modulo, indirizzi e profili non cambiano
(`contracts`, `/contracts`, profili ADMIN, HR, VIEWER, LP). Oltre a contratti e dossier gestisce formazione ed ECM, tirocinanti e medicina
del lavoro. Tutto ciò che nasce qui entra nel Calendario delle scadenze del modulo, nello Scadenzario della Suite e nei richiami della
casella People.

## Formazione ed ECM

Scheda della persona, sezione **Formazione ed ECM**: una riga per corso, svolto o programmato (tabella `contracts.formazione`).
"Nuovo corso o attestato" accetta il file dell'attestato: il lettore con l'API di Anthropic (lo stesso degli allegati del dossier) propone
titolo, ente, data, ore, crediti ECM, scadenza e codice evento. Nulla si salva finché chi carica non conferma. Senza chiave API la lettura è
un'euristica sul testo e va controllata campo per campo. L'attestato finisce nel Dossier (categorie ECM, FORMAZIONE_SICUREZZA, FORMAZIONE)
senza scadenza propria: la scadenza la porta il corso, così non compare due volte.

**Contatore ECM**, solo per le professioni sanitarie. È soggetto chi ha tipo di persona Medico o Personale sanitario oppure una mansione o
disciplina sanitaria (infermiere, TSRM, tecnico di laboratorio, biologo, fisioterapista e simili). La scelta si corregge a mano da
"Posizione ECM". I tirocinanti non sono soggetti.

- Obbligo predefinito: **150 crediti nel triennio 2026-2028** (Commissione nazionale per la formazione continua, delibera n. 1 del 5 marzo
  2026). La richiesta parlava di 60 l'anno e 180 nel triennio: il dato di legge è 150, quindi 50 l'anno come riferimento. Il valore si
  cambia in Impostazioni (`ecm_obbligo_triennio`, `ecm_triennio_inizio`) e, per la singola persona, in "Posizione ECM" (obbligo personale,
  riduzioni per esoneri ed esenzioni con motivo obbligatorio).
- Contatore: dovuti meno crediti dei corsi svolti con data nel triennio. Un corso programmato non riduce nulla.
- Obiettivo progressivo a fine anno (un terzo, due terzi, tutto): è indicativo, il vincolo di legge è sul triennio.
- Menu **Formazione ed ECM**: quadro di tutte le professioni sanitarie con crediti per anno, acquisiti, dovuti, mancanti.
- Una posizione riconosciuta in automatico mostra il contatore ma **non genera scadenze né richiami finché non è attivata**: si attiva dal
  quadro ("Attiva"), salvando la Posizione ECM o registrando il primo attestato con crediti. Serve a non far partire richiami a tutto il
  personale sanitario prima che gli attestati già posseduti siano stati caricati.

## Tirocinanti

Terzo tipo di persona oltre a dipendente e libero professionista (`people.kind = TIROCINANTE`, migrazione core 058). Menu **Tirocinanti**:
nuovo tirocinante ed elenco. Il tirocinio (`contracts.tirocini`) contiene convenzione con l'ente promotore, periodo, ore, indennità, sede,
**tutor aziendale** (un dipendente o un professionista, mai un tirocinante), **progetto formativo individuale** (da richiedere, richiesto,
ricevuto, firmato) e **giudizio finale** del tutor (esito, data, testo).

- "Richiedi il progetto formativo" registra la richiesta e, a scelta, la invia all'ente promotore dalla casella People.
- Il dossier del tirocinante ha i suoi documenti attesi: convenzione (contratto di inserimento), progetto formativo firmato, coperture INAIL
  e RC, formazione sicurezza, registro presenze, scheda di valutazione, attestazione finale.
- Un tirocinante non compare tra i dipendenti né tra gli LP, non entra nel Piano Ferie e nel Rimborso Spese (riservati ai dipendenti), non
  ha CCNL, RAL o busta paga. Il profilo LP non lo vede.

## Medicina del lavoro

Per dipendenti e tirocinanti. In Suite stanno **solo** il giudizio di idoneità alla mansione, le eventuali prescrizioni o limitazioni, il
protocollo sanitario assegnato e il calendario delle visite. Diagnosi, referti e cartella sanitaria restano al medico competente: i campi
con quei nomi sono rifiutati e l'audit registra che un giudizio è stato inserito, non quale.

- Accesso: profili ADMIN e HR e il titolare. Il profilo di sola lettura non vede la sezione. Ogni consultazione è nel registro letture.
- Scheda della persona, sezione **Medicina del lavoro**: sorveglianza attiva o non soggetto, protocollo, periodicità, medico competente,
  visite (preventiva, periodica, cambio mansione, rientro, su richiesta, cessazione) con giudizio e prossima visita.
- Menu **Medicina del lavoro**: personale in scadenza, protocolli sanitari, ultime convocazioni.
- **Convocazioni**: solo gli amministratori del widget (profilo ADMIN, quindi anche il titolare). Si seleziona il personale in scadenza, si
  indicano data, ora, luogo e medico; ogni persona riceve un'email personale dalla casella People con l'ufficio People in copia. La visita
  convocata entra in calendario. Chi non ha email resta convocato e l'esito lo segnala.
- Una persona senza scheda né visite è "da impostare" e **non genera scadenze**: al primo avvio nessuno ha visite registrate.

## Scadenze e richiami

Nuovi tipi in `lib/deadlines.js` (unica fonte di Calendario, Scadenzario e richiami):

| Tipo | Scadenze | Richiamo a |
| --- | --- | --- |
| FORMAZIONE | rinnovo di un corso, corso programmato | persona, HR in copia |
| ECM | crediti mancanti a fine triennio, obiettivo di fine anno | persona, HR in copia |
| TIROCINIO | progetto formativo da ottenere, fine tirocinio, giudizio finale | HR |
| MDL | visita fissata, visita periodica o preventiva da programmare | HR |

I destinatari si cambiano in Impostazioni, Casella People, come per gli altri tipi.

## Limiti dichiarati

- La lettura degli attestati con l'API reale non è stata provata da qui: i test usano la lettura di prova.
- Un attestato che arriva per email alla casella People viene archiviato nel Dossier all'approvazione, ma **non** crea da solo la riga di
  formazione né riduce il contatore: va registrato dalla sezione Formazione ed ECM.
- I crediti ECM non sono riconciliati con l'anagrafe Co.Ge.A.P.S.: il contatore conta ciò che viene caricato in Suite.
- Il trattamento dei giudizi di idoneità va validato con il DPO (base giuridica, tempi di conservazione, registro dei trattamenti).
