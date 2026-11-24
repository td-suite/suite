# Recupero Crediti (widget `crediti`, area Finance) · v0.95.0

Richiesta del CEO del 24/11/2026. Processo dal memo "Modello di sollecito clienti B2B" (Amministrazione e Finanza).

## Cosa fa
Tiene le fatture aperte dei clienti B2B, legge gli incassi dalla banca, prepara e invia i solleciti alle date previste dalla casella
dell'Amministrazione, legge le risposte dei clienti, guida la chiamata del referente commerciale e il passaggio all'area legale.

Fonti: fatture da Synclab (documenti emessi ai client abbinati a una Legal entity non del gruppo) e dal partitario della contabilità
(XLSX o CSV); termini di pagamento, contatti e referente commerciale dal Business Hub; movimenti del conto da Enable Banking
(docs/BANCA.md).

## La scala
| Fase | Quando | Chi | Come parte |
|---|---|---|---|
| Avviso di scadenza | 7 giorni prima | Amministrazione | da sola, se nessun controllo la ferma |
| 1° sollecito | +10 giorni | Amministrazione | da sola, se nessun controllo la ferma |
| 2° sollecito | +25 giorni | firma RAF | sempre con l'approvazione di CFO o CEO; email, PEC inviata a mano e registrata |
| Chiamata | +35 giorni | referente commerciale | attività assegnata, esito obbligatorio |
| Area legale | +60 giorni, o nessun impegno entro 5 giorni lavorativi dalla chiamata | RAF, Direzione sopra soglia | solo proposta; parte su autorizzazione |

La scala non salta fasi. Una fattura entrata già molto scaduta riparte dal 1° sollecito. Fra due fasi passa la distanza del memo,
contata da quando la precedente è davvero partita.

## Modalità
PROVA (predefinita): tutto si prepara e si mostra, nessuna email parte, nessuna fase avanza. ATTIVA: la decidono CEO o CFO dalle
Impostazioni, dopo l'anteprima di cosa partirebbe; servono IBAN, telefono dell'Amministrazione e nome del RAF.

## Controlli che fermano un invio automatico
Posta non attiva; movimenti bancari non letti nelle ultime 26 ore o nessun conto collegato; nessun destinatario; testo incompleto;
scadenza calcolata con i termini predefiniti; cliente non attivo nel Business Hub; risposta del cliente da leggere; nota di credito non
applicata; contestazione aperta; bonifico recente non ancora abbinato che potrebbe essere il pagamento. La comunicazione resta "in
attesa" con il motivo scritto; riparte da sola se il motivo cade, oppure la approva una persona.

Non ricevono nulla: clienti esclusi, con promessa o piano in corso, sospesi, con pratica legale autorizzata. Le fatture contestate
escono dalla scala.

## Esclusione dai solleciti
Solo CEO o CFO (basta uno), motivo obbligatorio, data di fine facoltativa (alla data il cliente rientra da solo). Registro in
"Clienti esclusi" e nella scheda.

## Riconciliazione
Si conferma da sola solo la corrispondenza certa: numero di fattura in causale e importo uguale al residuo, senza contraddizioni
sull'ordinante. Il resto è una proposta da confermare, correggere o rifiutare. Gli IBAN dei clienti si imparano dagli abbinamenti.

## Risposte
La casella si legge ogni 15 minuti (Microsoft Graph, Mail.Read). Si conservano solo i messaggi riconducibili a un cliente con partite
aperte o a un riferimento [TD-CRED-...]. Lettura con il modello AI se attivo, altrimenti per parole chiave. Effetti: "ho già pagato"
sospende in attesa dell'incasso; promessa con data sospende fino alla data più la tolleranza; contestazione toglie le fatture dalla
scala e resta da gestire; assenza automatica nessun effetto; il resto da leggere.

## Profili
CEO, CFO (RAF), ATT (Amministrazione), COMMERCIALE (solo i suoi clienti), LEGALE (solo le pratiche autorizzate), VIEWER. Il titolare
della Suite senza grant entra come CEO; un amministratore senza grant in sola lettura.

## Limiti dichiarati
- La PEC non parte dalla Suite.
- Le festività non sono considerate nei giorni lavorativi.
- Gli interessi di mora non sono calcolati nei testi.
- I testi predefiniti e la bozza della messa in mora vanno riletti sul memo e validati dall'area legale prima della modalità Attiva.
- Synclab non espone scadenza né stato di pagamento: la scadenza viene dai termini, gli incassi dalla banca o dal partitario.

## Variabili
`CREDITI_MAILBOX` (facoltativa) fissa la casella. Job: `crediti:giro` ogni ora (7-20), `crediti:casella` ogni 15 minuti.
Test: `server/test/crediti-regole.test.mjs`, `server/test/crediti-flusso.test.mjs`.
