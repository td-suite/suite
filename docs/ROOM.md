# Room Planning · dal piano della sede a Turni, Presenze e Calendario

Il personale di una sede (Sedi e ambulatori > Personale: medici, personale sanitario, accettazione) e gli ambulatori formano il **piano
della sede** (settimana-tipo calcolata da `lib/engine.js computePlan`). Dalla v0.68.4 tutto ciò che il piano assegna arriva, senza
passaggi manuali, in **Turni** ("Genera dalla pianificazione"), **Presenze** (giornata e mese) e **Calendario** (settimana e giorno).

## Causa delle segnalazioni del 10/11/2026 (v0.68.4)
"Turni non genera dalla pianificazione i turni", "in Presenze non riporta immediatamente il professionista assegnato alla sede",
"l'impegno assegnato in Sedi e ambulatori non viene riportato in calendario, turni, presenze". Verificato sul codice e riprodotto su un
database di collaudo (sede con un medico, un'infermiera di supporto, due addetti all'accettazione scelti col selettore):
1. **Solo le assegnazioni medico → ambulatorio**: `POST /personale/turni/genera`, `GET /personale/presenze/giorno` e il Calendario
   (`lib/network.js datedWeek`) leggevano dal piano soltanto `plan.assigns` (sessioni dei medici e sanitario di supporto). I turni del
   **desk di accettazione** (`plan.deskWeeks[].deskShifts`, calcolati dalle ore a contratto) e la copertura del **Punto prelievi** non
   diventavano mai turni, presenze o sessioni di calendario: nel collaudo 42 turni generati (solo medico e infermiera), zero per i due
   addetti all'accettazione, che "non comparivano". Il gruppo `accettazione` era escluso anche dal network (`buildNetwork`).
2. **Aggancio limitato ai "pianificabili"**: la generazione cercava la persona solo fra `professionisti_v.pianificabile`. Una persona
   nel personale di sede ma senza scheda Room e senza ruolo/disciplina/sede (es. ESTERNO) non era pianificabile e finiva tra i "non
   censiti come professionisti", con la richiesta di un passaggio manuale ("importale dalla pagina Professionisti"), che però creava la
   scheda solo per il gruppo sanitario.
3. Minori: il nome dell'ambulatorio nell'attività dei turni generati era sempre vuoto ("Ambulatorio " + nome cercato fra il personale);
   il selettore delle persone (PersonaPicker) teneva in memoria l'elenco per tutta la sessione, così chi era appena stato creato in
   Amministrazione > Persone non compariva senza ricaricare la pagina; il "Riepilogo mese" di Presenze chiedeva le presenze fino al
   giorno 31 di ogni mese, così nei mesi di 30 giorni (novembre compreso) e a febbraio rispondeva "Parametro non valido".

## Regole dalla v0.68.4
- **Impegni del piano** (`lib/impegni.js`, identico in `server/src/modules/room/lib` e `web/src/modules/room/lib`, verificato dal test):
  medico = sessione in ambulatorio e fascia; personale sanitario = supporto al medico e copertura delle fasce prelievi (al primo sanitario
  libero, nell'ordine del personale); accettazione = turni del desk; con la turnazione le settimane A e B si alternano (settimane ISO
  dispari = A, pari = B). Le righe "attività" (Punto prelievi, RM, RX, ...) non sono persone.
- **Aggancio** (`lib/personale.js agganciatore`): prima `person_id` della riga (scelto con il selettore), poi chiave del nome; la persona
  deve essere attiva e non esclusa dalla pianificazione. Essere nel personale di una sede è già l'aggancio con l'attività di sede.
- **Scheda Room automatica** (`assicuraSchedeRoom`): al salvataggio della sede (`PUT /strutture/:id`) e alla generazione dei turni, chi è
  agganciato e non ha la scheda la riceve (tipo dal gruppo: medico → medico; sanitario e accettazione → sanitario; profilo della riga o
  "Accettazione"/"Medico"; la sede tra le sedi abilitate). Chi ha già la scheda non si tocca; gli esclusi restano esclusi. La migrazione
  room `014_schede_dal_personale_di_sede.sql` fa lo stesso, una volta, per le righe già salvate con `person_id` (idempotente).
- **Messaggi**: le persone della sede non agganciabili (senza persona dell'anagrafica, non attive, escluse) si elencano con il motivo nella
  scheda della sede (apertura e salvataggio), nell'esito di "Genera dalla pianificazione", nella giornata e nel mese di Presenze, con il
  link alla sede e alla Diagnostica anagrafica (D52).

## Turni · Genera dalla pianificazione
`POST /api/room/personale/turni/genera` { `mese` 'AAAA-MM' **oppure** `settimana` (una data qualunque della settimana, si parte dal
lunedì), `sede_id` (facoltativo), `tipo` tutti | medici | sanitari | accettazione, `sovrascrivi` }. Salta giorni chiusi e chiusure del
Calendario, non duplica turni già presenti nella stessa fascia, accorpa le fasce contigue della stessa persona (attività elencate,
ambulatorio della parte più lunga). Risposta: `created`, `skipped`, `schede_create`, `perSede`, `nonAgganciati` [{ sede, nome, gruppo,
motivo, link, diagnostica }], `senzaImpegni` (nel personale ma senza fasce nel piano, con il motivo), `sediSenzaPiano`, `nonCensiti`
(compatibilità). I turni del desk hanno profilo "Accettazione" (stile ambra nella griglia); il Cockpit non li conta tra i "turni senza
ambulatorio".

## Presenze
- `GET /personale/presenze/giorno?sede_id&data`: turni, presenze registrate, `pianificati` (impegni del piano del giorno, tutti i gruppi,
  con `prof_id` se agganciati, altrimenti `motivo`), `nonAgganciati`, `pianoErrore` (sede chiusa, piano non calcolabile). La pagina
  precompila la giornata da turni e piano e mostra gli avvisi.
- `GET /personale/presenze/mese?sede_id&mese` (nuovo): persone assegnate alla sede con ore/settimana nel piano, turni e ore a turno,
  presenze e assenze del mese (più chi ha turni o presenze nella sede senza esserne nel personale), `nonAgganciati`. Riquadro "Persone
  assegnate alla sede" nel Riepilogo mese.

## Calendario
`buildNetwork` comprende il gruppo accettazione e, nelle sessioni della persona, desk e prelievi (settimana A); `datedWeek` aggiunge alle
sessioni d'ambulatorio quelle del desk (riga "Accettazione") e dei prelievi, con assenze, sostituzioni e chiusure come per i medici. Il
filtro per persona elenca anche gli addetti all'accettazione.

## Test e verifiche
- `server/test/v0684-stime-room.test.mjs`: impegni puri (medico, supporto, prelievi, desk, turnazione A/B), identità dei due `impegni.js`,
  Calendario; con la Suite su un database temporaneo: persona scelta col selettore (anche un ESTERNO senza ruolo) → scheda automatica →
  turni della settimana e del mese (anche solo accettazione) → presenze del giorno e del mese → conferma → Calendario; righe non
  agganciabili con motivo e D52.
- Schermate (collaudo con dati fittizi): `docs/screens/room-turni-da-pianificazione.png`, `room-turni-genera-esito.png`,
  `room-presenze-giornata.png`, `room-presenze-mese.png`, `room-calendario.png`.
- In produzione dopo il rilascio: rapporto della migrazione (schede create)
  `SELECT person_id, tipo, profilo FROM room.person_ext WHERE dati->>'origine' LIKE 'personale di sede%';`; poi Turni > Genera dalla
  pianificazione del mese e leggere l'esito (persone non agganciabili da sistemare dalla sede o da D52).
