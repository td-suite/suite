# Guida GIPO · guida di GipoNext, FAQ, ricerca e domande con risposta (v0.70.0, v0.71.1)

Modulo nativo della Suite: nome visibile **Guida GIPO**, chiave tecnica `gipoguida`, tagline "Guida, FAQ e risposte su GipoNext", area
Retail and Flow Management subito dopo Label. Richiesta del CEO del 12/11/2026 ("widget davvero fondamentale"): il personale in difficoltà
con GIPO (GipoNext, il gestionale ambulatoriale di Docplanner Italy, gruppo MioDottore) deve poter interrogare la Suite. Il widget contiene
una guida completa (anche in PDF), le FAQ, una ricerca collegata alla guida e le domande con risposta; la guida si aggiorna di continuo con
le risposte della redazione.

Codice: `server/src/modules/gipoguida`, `web/src/modules/gipoguida`. Contenuti: `server/src/modules/gipoguida/content/`. Test:
`server/test/gipoguida.test.mjs`, `server/test/gipoguida-domande.test.mjs` (v0.71.1, regressione del recupero). Script per la redazione:
`server/scripts/gipoguida-domande.mjs`. Schermate: `docs/screens/gipoguida-chiedi.png`, `gipoguida-guida.png`, `gipoguida-redazione.png`,
`gipoguida-backend.png`, `gipoguida-chiedi-ceo.png`, `gipoguida-coda-rigenera.png`.

## v0.71.1 · risposte all'altezza del back-end (13/11/2026)
Il CEO ha chiesto "come faccio ad impostare un'agenda per un medico che viene in una struttura solo il primo e il terzo martedì di ogni
mese" e ha ricevuto "La guida non copre ancora questa domanda": "Queste domande devono essere alla portata della guida perché deve servire
a noi in back-end per gestire le funzionalità." Due cause, entrambe corrette:
- **contenuti**: le schede interne della configurazione non erano nella guida. Integrate tutte le osservazioni di secondo livello del
  13/11/2026 (agende con Configurazione base, Sottoconfigurazioni con Periodicità in settimane, Priorità e Periodicità nel mese, Prestazioni /
  Listini, Occupazioni parziali; scheda prestazione con Listini, Distinta base, Moduli collegati; scheda medico con Prestazioni e Compensi;
  schede interne dell'assegnazione; Crea e rate della fattura; tabelle in riga; Riepilogo Asl, Gestione cassa, Scadenzario) e il **Manuale
  operativo TD-SGI-MAN007** (documento di TD, citato come fonte);
- **recupero e risposta**: la ricerca pescava Calendario e Aziende e il modello riceveva solo 6 brani. Ora indice esteso, sinonimi e frasi,
  ricerca OR con ranking, passaggio di pianificazione sull'indice completo, risposta sul testo integrale di 12 sezioni e 8 FAQ.

Numeri: **18 capitoli, 140 sezioni (erano 95), 123 FAQ (erano 73)**; 41 sezioni di livello BACK_END; 32 sezioni con fonte manuale
(21 MANUALE_TD, 11 INTERFACCIA+MANUALE); 23 sezioni VALIDATE dal manuale, 117 da validare. Domande di prova: 32 su 32 recuperano la sezione
attesa (la domanda del CEO trova "Sottoconfigurazioni" al primo posto).

## Accesso e profili
| Profilo | Cosa fa |
|---|---|
| **LETTORE** (implicito) | tutti gli **interni** senza grant: Chiedi, Guida, FAQ, PDF, valutazione delle proprie risposte. |
| **ADMIN** (redazione) | in più la Redazione: domande da risolvere, editor delle sezioni con validazione e storico, FAQ, statistiche, seme, riepilogo. Owner e Admin della Suite senza grant entrano come ADMIN; il grant ADMIN si dà da Amministrazione > Utenti. |

`open_to_all` vale **solo per gli interni**: gli accessi esterni (clienti service, partner) ricevono 403 dal modulo (`soloInterni`) e non vedono
il widget né in Home né nel catalogo (`SOLO_INTERNI` in `routes/core.js`, insieme a Piano Ferie; `soloInterni: true` in meta.js), salvo un
grant esplicito. La ricerca globale della Suite mostra le sezioni della guida solo agli interni.

## Come funziona
- **Chiedi** (pagina iniziale): barra grande; mentre si scrive compaiono le sezioni e le FAQ pertinenti; "Chiedi" invia la domanda
  (`POST /api/gipoguida/chiedi`). Avviso fisso "non scrivere nomi o dati di pazienti". Sotto, le ultime 20 domande dell'utente con l'esito e,
  se c'è, il link alla risposta della redazione.
- **Guida**: indice a sinistra (capitoli apribili, pallino arancione sulle sezioni da validare, ricerca immediata), sezione a destra con il
  bollino, il percorso in GIPO, **Apri in GIPO** (https://www.giponext.it + percorso, scheda nuova, **solo** per le pagine di consultazione:
  niente link per `/Create`, nuova visita, nuovo DDT), le FAQ collegate, precedente e successiva. **Scarica la guida PDF** e **Anteprima PDF**.
- **FAQ**: per capitolo, ricerca (full text con sinonimi), filtro per ruolo (accettazione, medico, amministrazione); `?voce=ID` apre una FAQ.
- **Redazione** (ADMIN): vedi sotto.

### Risposte alle domande (v0.71.1)
1. Il testo si **maschera lato server** prima di salvarlo o inviarlo al modello: codici fiscali (anche con omocodia), email, numeri di
   almeno 9 cifre (telefoni, tessere, partite IVA). Date e importi restano. La risposta dice cosa è stato tolto. I nomi delle persone non si
   riconoscono in modo affidabile: per quelli vale l'avviso fisso.
2. **Limite**: 20 domande all'ora per utente (429 oltre).
3. **Recupero** (`recupera` in `lib/ricerca.js`, vedi Ricerca): sezioni e FAQ ordinate con la ricerca OR con ranking.
4. Con l'AI configurata (`aiEnabled()` del wrapper `lib/claude.js`, `askJson` con tipo **`gipoguida`** in `ai_log`):
   - **pianificazione** (`pianifica`, economica, 400 token in uscita): il modello riceve l'INDICE completo della guida (una riga per
     sezione: id, capitolo, titolo, sintesi, parole chiave) e sceglie fino a **10** sezioni;
   - **unione**: i primi 3 risultati della ricerca, poi le scelte del piano, poi il resto della ricerca, al più **12** sezioni con il
     **testo integrale** (tetto 9.000 caratteri per sezione, 60.000 in tutto) più **8** FAQ (trovate o collegate alle sezioni scelte);
   - **risposta**: Claude risponde come un esperto di GIPO che ha davanti la guida, solo sui brani (niente funzioni inventate): dove si fa,
     passi numerati con i nomi esatti di menu, schede, campi e pulsanti, un esempio sui dati della domanda, "Cosa verificare dopo", la nota
     "Da riconciliare con il manuale" se c'è, la riga finale "Da provare prima su..." se ci sono passi dedotti (`dedotto: true`). Dice che la
     guida non copre (`copre: false`) solo se nessun brano riguarda il tema, indicando il più vicino. Testo ripulito (niente emoji, trattini
     lunghi, "approfondire").
5. Esiti: **RISPOSTA**; **PARZIALE** (risposta data, con parti dedotte da provare; non va in coda); **SOLO_RICERCA** (AI spenta o non
   raggiungibile: si mostrano i **passi già scritti** delle 3 sezioni migliori, cioè i blocchi "Come si fa", "Esempio", "Cosa verificare",
   con il link alla sezione completa); **SENZA_RISPOSTA** (nessun brano, oppure il modello dichiara che nessuna sezione riguarda il tema:
   si mostra la sezione più vicina e la domanda va in coda).
6. Ogni risposta ha **Mi è stata utile: sì / no** (+ nota, anch'essa mascherata). Solo chi ha posto la domanda la valuta.

### Aggiornamento continuo (senza leggere GIPO)
La Suite non legge ciò che gli utenti fanno dentro GIPO (sito di terzi con dati dei pazienti). La guida cresce così:
1. ogni domanda e ogni ricerca si registrano (testo mascherato; le battute successive della stessa ricerca aggiornano la riga);
2. le domande **SENZA_RISPOSTA** e quelle giudicate **"no"**, non risolte né chiuse, entrano nella coda **Domande da risolvere**;
3. l'amministratore risponde: la risposta diventa una **FAQ pubblicata** collegata a una sezione (origine `DOMANDA_UTENTE`), la domanda
   risulta risolta e chi l'aveva posta riceve una **notifica nella Suite** (tabella `notifications`, link alla FAQ). La FAQ entra subito
   nella pagina della sezione, nella ricerca, nei brani delle risposte successive e nel PDF (appendice e rimando sotto la sezione).
   In alternativa "Chiudi senza FAQ" con una nota (non pertinente, doppione); v0.71.1: **Rigenera risposta** (ripete recupero e
   risposta sulla domanda già mascherata con la guida di oggi: risposta, fonti ed esito della domanda si aggiornano, contatore delle
   rigenerazioni, la domanda resta in coda) e **Segna come risolta dalla guida** (la guida ora risponde senza bisogno di una FAQ nuova:
   `risolta_dalla_guida`, notifica a chi aveva chiesto con il link alla domanda, nota facoltativa);
4. statistiche: domande per settimana (12 settimane), % di risposte utili sulle valutate, argomenti più cercati e ricerche senza risultati
   (90 giorni), sezioni più citate nelle risposte;
5. **job `gipoguida:riepilogo`** (gira ogni ora, agisce il lunedì dalle 8 ora di Roma, una volta per settimana): notifica in app agli ADMIN
   della guida con il numero di domande in coda (e quante da oltre 7 giorni); con la coda vuota non notifica. Meccanismo scelto: le
   notifiche della Suite (lo scadenzario di direzione e la bacheca non hanno destinatari per modulo). In più il **contatore sulla tessera
   in Home** (domande da risolvere, solo agli ADMIN della guida) e il badge della voce Redazione;
6. **Diagnostica D56** "Guida GIPO: domande senza risposta da oltre 7 giorni" (informativo).

## Contenuti e seme
`server/src/modules/gipoguida/content/`: un file markdown per capitolo (`00-come-usare.md` ... `15-glossario.md`) più `faq.md`.
- Front-matter del capitolo: `capitolo`, `titolo`, `intro`. Ogni sezione si apre con un'intestazione `=== sezione` ... `===` con `ordine`,
  `slug`, `titolo`, `percorso_gipo`, `parole_chiave`; sotto il corpo in markdown. Collegamenti interni: `[testo](sezione:slug)`.
- `faq.md`: blocchi `=== faq` con `chiave`, `sezione` (slug), `ruolo`, `domanda`; sotto la risposta.
- Struttura di ogni sezione: a cosa serve, dove si trova (percorso di menu), cosa c'è nella schermata (campi e pulsanti reali), come si fa
  (passi numerati), attenzioni ed errori tipici.
- Numeri del rilascio 0.70.0: 16 capitoli, 95 sezioni, 73 FAQ. Rilascio **0.71.1: 18 capitoli, 140 sezioni, 123 FAQ** (file
  `14-back-end.md`, `15-percorso-td.md` e `faq-back-end.md` nuovi; FAQ per ruolo e glossario diventano i capitoli 16 e 17: le loro righe in
  `capitoli` prendono il nuovo titolo, le sezioni nate dal seme seguono il nuovo numero).
- v0.71.1, chiavi nuove dell'intestazione di sezione: `sintesi` (obbligatoria: una riga, è l'indice del passaggio di pianificazione),
  `fonte` (INTERFACCIA | MANUALE_TD | INTERFACCIA+MANUALE | REDAZIONE, predefinita INTERFACCIA), `livello` (OPERATIVO | BACK_END,
  predefinito OPERATIVO), `stato: VALIDATA` con `validazione` (chi o cosa ha validato: per il manuale "Manuale operativo TD-SGI-MAN007").
- Sotto un passo numerato le righe rientrate "   - ..." sono un sottoelenco del passo (nella pagina e nel PDF; la numerazione non riparte).
  Le tabelle markdown sono griglie vere anche nel PDF.
- `leggiSeme()` controlla slug unici, FAQ collegate a sezioni esistenti, collegamenti interni validi; un seme non valido blocca l'avvio
  del modulo con l'elenco degli errori.
- **Caricamento** (`caricaSeme`, all'avvio del server in `afterStart`, cioè alla prima attivazione e a ogni rilascio): voci nuove inserite
  (sezioni `DA_VALIDARE`); voci esistenti aggiornate **solo se intatte**: l'impronta del contenuto attuale coincide con `seme_hash` (il seme
  caricato l'ultima volta) e la sezione non è VALIDATA. Le altre restano come sono ("protette"): la Redazione vede "il seme ha una versione
  diversa" e può ripristinarla. La versione sostituita va in `revisioni` (fonte SEME). Nulla si cancella. Se l'impronta complessiva del
  seme non cambia, il caricamento si salta.
- v0.71.1: una sezione VALIDATA **dal seme** (validata_da vuoto, `fonte_validazione` valorizzata) resta aggiornabile dai rilasci; una
  VALIDATA **da una persona** (Redazione > Segna come validata) no. Fonte, livello e sintesi hanno un'impronta propria (`seme_meta_hash`):
  seguono il seme finché la redazione non li cambia dall'editor. "Ripristina dal seme" riporta anche lo stato del seme.

### Regole di onestà applicate ai testi
v0.71.1: le procedure dedotte dai campi (tutto il capitolo Back-end) sono **scritte per intero** ma restano DA_VALIDARE e dicono "da
provare prima su un'agenda o una prestazione di prova"; dove un comportamento non è osservato lo dicono (quale Priorità prevale, conteggio
delle settimane alterne, festivi che bloccano o solo colorano, elenco Prestazioni / Listini vuoto, finestra Copia prezzi di listino). Le
sezioni dal manuale TD sono VALIDATA (procedure approvate dall'azienda); dove manuale e interfaccia divergono valgono i nomi
dell'interfaccia e una nota "Da riconciliare con il manuale" lo dice (riepilogo nella sezione 15.20). Dal manuale **non** sono stati
riportati i nomi delle persone del frontespizio, l'esempio di ID paziente e il dato promozionale sulle prenotazioni gestite da GipoNext.

Regole della v0.70.0:
Fonte unica: l'analisi dell'interfaccia di GipoNext del 12/11/2026 (menu, schermate, campi, pulsanti, colonne, filtri, azioni, finestre),
in sola lettura dall'account amministratore di TD, senza dati di pazienti. Le procedure **non sono state eseguite**: i passi dedotti sono
scritti in forma prudente ("dovrebbe", "da verificare") e **tutte le 95 sezioni nascono DA_VALIDARE** (bollino "da validare con un referente
GIPO" in pagina, nell'indice e nel PDF). Dove l'analisi dice "non osservato" la guida lo dichiara e rimanda all'assistenza Gipo; non sono
stati inventati funzioni, campi o comportamenti; nessun testo di Docplanner copiato. Parti dichiarate non osservate: finestra del nuovo
appuntamento, schede Semplificata e Richiami, Panoramica agende, Gestione FSE, Fatture passive, editor e firma del referto, campi delle
schede SSN / Stato prestazioni / Assicurazione dell'assegnazione, contenuto di CRM e MioDottore, permessi dei profili utente, significato
delle sigle E/C e P/SSN. Stato dell'account TD riportato: Gipo730 "Account non configurato", MioDottore "Nessuna Facility collegata".
Il referente interno per GIPO non è nominato: lo scrive la redazione nella sezione 0.3 quando la direzione lo indica.

## Confronto con il Manuale operativo TD-SGI-MAN007 (v0.71.1)
Per ogni capitolo del manuale (revisione 00 del 23/06/2026): cosa dice, cosa aveva la guida prima (v0.70.0), cosa ha dopo (v0.71.1).
I numeri di sezione sono quelli del PDF e della pagina Guida.

| Argomento | Manuale | Guida prima | Guida dopo |
|---|---|---|---|
| 1 Introduzione, 1.1 perimetro | prestazioni coperte (laboratorio, immagini, visite), tre canali SSN, privato, assicurazione | assente | 15.1 Perimetro, canali e sistemi collegati (VALIDATA) |
| 2.1 Aree funzionali, 2.2 sistemi integrati | aree di GIPO; Studio Lab, ZeeroMed, STS, FSE 2.0, referti.online | solo FSE (6.5) e Gipo730 (8.13) | 15.1 con le due tabelle (VALIDATA) |
| 3 Diagramma di flusso | fasi 0-9 con diramazione per canale | assente | 15.2 Le fasi del percorso (VALIDATA) |
| Fase 0 Prenotazione | agenda classica, wizard multirisorsa, online MioDottore/TuoTempo, CUP, SMS di conferma | 3.1, 3.2, 3.5 dall'interfaccia, finestra del nuovo appuntamento non osservata | 15.3 (VALIDATA); regola TD in 3.2 e 3.5 (fonte interfaccia+manuale); nota "Da riconciliare" sul Wizard |
| Arrivo: accesso, filtro sede, richiamo | credenziali personali, filtro Sede, identità con documento, accesso diretto | 2.1, 2.3 dall'interfaccia | 15.4 (VALIDATA); nota "Lista Lavoro" / "Lista di Lavoro" |
| Fase 1 Anagrafica e consensi | GIPO TS, dati obbligatori per l'inserimento manuale, verifica dei dati, consensi GDPR, GipoSign, non rifirmare | 4.1, 4.2, 4.3 dall'interfaccia | 15.5 (VALIDATA); regole in 4.1 e 4.2 (interfaccia+manuale) |
| Fase 2 Canale SSN | NRE + CF, SAC/SAR, nomenclatore, esenzione, ticket, priorità CUP, ricevuta, ASL | 5.8 Impegnativa e Budget SSN (interfaccia) | 15.6 (VALIDATA) + scheda SSN in 5.10; nota priorità CUP / Priorità Accesso |
| Fase 2 Canale privato | listino privato o convenzionato, contanti/POS/bonifico/digitale, no assegni, esenzione art. 10, bollo sopra 77,47 euro | assente | 15.7 (VALIDATA); regola in 8.1, 12.6, 14.18 |
| Fase 2 Canale assicurazione | forma diretta o indiretta, autorizzazione, massimale, franchigia, intestazione della fattura | 12.13 Assicurazioni (solo colonne) | 15.8 (VALIDATA) + 14.16 configurazione; nota "codice convenzione" |
| Fase 3 Impegnativa | controlli obbligatori, priorità U/B/D/P, prestazioni non erogabili | assente | 15.9 (VALIDATA) |
| Fase 4 Assegnazione, Associa medico, SmartQ | risorsa, priorità, medico refertante obbligatorio per le immagini, monitor e cruscotto | 5.6 Associa medico (interfaccia) | 15.10 (VALIDATA); nota: SmartQ e cruscotto non nel menu osservato |
| Fase 5 Fatturazione e incasso | ticket e STS; esenzione IVA e bollo virtuale; Natura bollo sempre N4; fatture non modificabili | 8.1, 8.2 (bollo "non verificato") | 15.11 (VALIDATA); regola N4 in 8.1 e 8.2; nota STS / "Account non configurato" in 8.13 |
| Fase 6a Laboratorio | ordine HL7 a Studio Lab, colori dei tappi, check-in, validazione, ritorno, anomalie, HIV, referto parziale | assente | 15.12 (VALIDATA) |
| Fase 6b Immagini | worklist DICOM, AE Title, TSRM, MPPS, CD, referto su GIPO con Associa medico | assente | 15.13 (VALIDATA) |
| Fase 7 Refertazione | archivio unico, firma digitale, FSE 2.0, referti non firmati | cap. 6 dall'interfaccia (firma non osservata) | 15.14 (VALIDATA) |
| Fase 8 Credenziali, portale, dossier | modulo TD-SGI-MOD235 da Modulistica, ID Paziente, OTP, servizi, nessuna scadenza, ritiro in sede, gestione del dossier, sicurezza | assente | 15.15 e 15.16 (VALIDATA); nota sul pulsante Modulistica in anagrafica e sui due portali |
| Fase 9 Post-erogazione | notifiche, STS mensile, FSE, ASL, reportistica | 11.3 Stampe per l'Asl | 15.17 (VALIDATA) + 11.5 Tracciati ASL; nota sui report non trovati nel menu |
| 4.1 Medicina dello sport | apertura, tipo visita, sport, anamnesi, esami, esame aggiuntivo, conclusioni, esiti, certificati, relazione sintetica, registro idoneità | 7.1, 7.2 dall'interfaccia, flusso "non eseguito" | 7.1, 7.2 (VALIDATA, interfaccia+manuale) e 7.3 Idoneità, certificati e relazione (VALIDATA); nota "+ Nuova" / "Nuova visita" |
| 5 Checklist | 20 controlli | assente | 15.18 (VALIDATA) |
| 6 Riferimenti normativi | 14 norme e standard | assente | 15.19 (VALIDATA) |
| 7 Glossario | 22 termini | 17.1, 17.2 (termini di GIPO) | 17.3 Termini del manuale (VALIDATA) |
| Divergenze | | | 15.20 Differenze tra manuale e interfaccia da riconciliare (12 punti, DA_VALIDARE) |

Il manuale non tratta la configurazione (agende, listini, compensi, tabelle): quella parte resta dall'interfaccia, nel capitolo 14
Back-end, DA_VALIDARE.

## Back-end: configurare GIPO (capitolo 14, v0.71.1)
Procedure complete per chi configura GIPO, ciascuna con dove si trova, cosa c'è, come si fa (passi numerati), esempio, cosa verificare
dopo, attenzioni: 14.1 mappa "cosa si configura e dove", 14.2 Creare un'agenda, 14.3 Orario settimanale (configurazione base), 14.4
Sottoconfigurazioni con cinque esempi svolti (primo e terzo martedì del mese, settimane alterne, orario estivo dal 1° luglio al 31 agosto,
sostituzione temporanea, ferie con i Giorni festivi o con una sottoconfigurazione), 14.5 Prestazioni prenotabili, 14.6 Occupazioni
parziali, 14.7 Duplicare un'agenda, 14.8 Giorni festivi e chiusure, 14.9 Creare una prestazione, 14.10 Listini e prezzi con validità, 14.11
Listini: creare e copiare con incremento, 14.12 Pacchetti con la distinta base, 14.13 Moduli e consensi collegati, 14.14 Nuovo medico, 14.15
Regole di compenso, 14.16 Assicurazioni e convenzioni, 14.17 Sede, utenza di sede, sezionale, 14.18 Tabelle in riga, 14.19 Accesso di un
nuovo collega, 14.20 Dopo una modifica: cosa controllare. Altre sezioni nuove: 5.10 schede interne dell'assegnazione, 8.16 Rate e pagamenti
in fattura, 11.5 Tracciati ASL (BACK_END). Le sezioni del capitolo 12 Configurazione sono BACK_END e rimandano alle procedure.

Pagina **Guida**: filtro **Per chi configura GIPO** (solo le sezioni BACK_END, capitoli aperti, ricerca limitata a quel livello,
`?vista=back-end`), badge **back-end** e **fonte** in testa alla sezione, bollino verde "validata · Manuale operativo TD-SGI-MAN007",
pallino verde nell'indice per le validate; nella panoramica i pulsanti verso il capitolo back-end e il percorso del manuale. Editor della
redazione con Sintesi, Fonte e Livello; tabella Sezioni con filtro per livello e colonna Fonte.

## Come si valida una sezione
1. Redazione > Sezioni, filtro "Da validare"; apri la sezione (editor con anteprima affiancata).
2. Con un collega che usa GIPO ogni giorno ripercorri i passi in GIPO; correggi il testo (Salva: la versione precedente va nello storico).
3. "Segna come validata" chiede **chi ha verificato e come** (nota obbligatoria, nello storico): bollino verde con data e nome.
4. Se la procedura cambia, "Torna da validare". Le sezioni validate non vengono più toccate dai rilasci del seme.

## Come si aggiorna
- Risposte della redazione (coda) → FAQ: è il canale principale.
- Editor delle sezioni: titolo, percorso in GIPO (validato: deve iniziare con /), parole chiave (aiutano la ricerca), testo; controllo
  automatico dei dati personali nel testo; storico con "Vedi" e "Ripristina questa versione"; "Ripristina dal seme".
- FAQ: nuova, modifica, pubblicazione; quelle del seme non si cancellano (si tolgono dalla pubblicazione).
- Nuovi contenuti per tutti gli ambienti: si modificano i file del seme e si rilascia (solo le voci intatte si aggiornano).

## Ricerca
`GET /api/gipoguida/cerca?q=&livello=` (registra la ricerca salvo `registra=0`; `livello=BACK_END` per il filtro "Per chi configura GIPO").
v0.71.1 (`lib/ricerca.js`):
- **Indice esteso** `sezioni.ricerca_tsv` (migrazione 002, mantenuto dai trigger su sezioni, FAQ e capitoli): **A** titolo e parole chiave,
  **B** sintesi, titolo del capitolo e domande delle FAQ pubblicate collegate, **C** testo, **D** percorso in GIPO. FAQ: `faq.tsv` (A
  domanda, B risposta). Indici GIN e trigrammi (`gin_trgm_ops`) su titolo e parole chiave.
- **Gruppi**: ogni parola significativa (senza le parole vuote delle domande: "come faccio", "imposto", "viene"...) è un gruppo di
  alternative: la parola (stemming italiano) e i **sinonimi** del dizionario `SINONIMI` (oltre a quelli della v0.70.0: agenda, calendario,
  orario, turno, disponibilità, presenza; medico, specialista, dottore, professionista; periodicità, ricorrenza, alterne, mensile,
  quindicinale; giorni della settimana; estivo, sostituzione; ferie, chiusura, festivo, ponte; slot, durata; duplica; prestazioni
  prenotabili; occupazioni parziali; esame, visita; listino, prezzo, tariffa; aumento, incremento; pacchetto, distinta; consenso, moduli
  collegati; compenso, provvigione; utente, collega; credenziali; sede, struttura; sezionale, numerazione; rate; metodo di pagamento;
  convenzione, assicurazione; bollo; tracciati, ASL; referto; idoneità, certificato). Le **frasi** (`FRASI`) aggiungono un gruppo con peso
  doppio: "primo/terzo/ultimo martedì", "giorni del mese", "ogni due settimane", "settimane alterne", "da una certa data", "orario
  estivo", "del 5%", "in riga", "natura bollo". Per l'ultima parola, mentre si scrive, anche il prefisso.
- **Ranking OR** (non AND stretto): ogni gruppo pesa il suo idf (`ln(1 + N / righe che lo contengono)`), 0,65 se trovato e 1 se nei pesi
  A/B; copertura = somma pesata / somma degli idf; punteggio = copertura + 0,25 `ts_rank` della OR + 0,3 somiglianza del titolo (pg_trgm,
  anche come ripiego quando il full text non trova nulla). Le FAQ trovate aggiungono metà del loro punteggio alla sezione collegata.
- `recupera(q, { limiteSezioni, limiteFaq, livello })` per le risposte; `cercaGuida(q, { limite, tipi, prefisso, livello })` per la pagina,
  le FAQ e la ricerca globale (prima chi contiene tutte le parole, `parziale` per gli altri). La ricerca globale (`lib/search.js`, tipo
  `guida_gipo`, solo interni con il modulo LIVE) riconduce il punteggio alla scala della Suite (`0,25 + min(1, score / 1,5)`).
- **Regressione**: `lib/domande-prova.js` (32 domande reali di back-end, la prima è quella del CEO, con le sezioni attese) usata da
  `server/test/gipoguida-domande.test.mjs` (modello finto che riceve i brani: la sezione attesa deve essere fra quelle passate al modello,
  senza aiuto del piano) e da `server/scripts/gipoguida-domande.mjs`:
  `DATABASE_URL=postgres://utente@/db?host=/tmp node scripts/gipoguida-domande.mjs` stampa per ogni domanda le sezioni recuperate con
  punteggio, copertura e stato ("TROVATA (posizione n)"); con argomenti tra virgolette prova domande libere; `--seme` ricarica prima il
  seme, `--tutte` stampa tutte le sezioni. Uscita 1 se una domanda di prova non trova la sezione attesa.

## PDF
`GET /api/gipoguida/guida.pdf` (`?scarica=1` per salvarlo): pdfkit con lo stile dei PDF della Suite (LiberationSans, logo, colori, dati
aziendali da `lib/company.js`). Copertina (edizione = versione della Suite, data di aggiornamento della guida, numeri, avvertenze, regola sui
dati dei pazienti, assistenza Gipo), indice con numeri di pagina e collegamenti cliccabili (le voci da validare sono marcate), un capitolo
per pagina nuova, ogni sezione con il bollino e il percorso, rimando alle FAQ collegate, appendice con tutte le FAQ pubblicate per
capitolo; intestazione (capitolo corrente) e piè di pagina con versione, data e "pagina n di N". Cache in memoria con chiave sulle date di
modifica (sezioni, FAQ, capitoli) e sulla versione; ogni scrittura della redazione la invalida. Rilascio 0.70.0: 74 pagine.
v0.71.1: copertina con le fonti (interfaccia del 12 e 13/11/2026, Manuale operativo TD-SGI-MAN007), il numero di sezioni BACK-END e di
quelle validate dal manuale; ogni sezione ha il bollino di stato ("VALIDATA · Manuale operativo TD-SGI-MAN007" per le procedure del
manuale), il bollino **BACK-END** e la riga "Fonte: ... · Percorso in GIPO: ..."; l'indice marca "(back-end, da validare)"; tabelle a
griglia con intestazione ripetuta a cambio pagina; sottoelenchi dei passi. Rilascio 0.71.1: **123 pagine**
(copia guardata pagina per pagina: `/mnt/user-data/outputs/2026-11-13_Guida_GipoNext_TD.pdf`).

## Dati e tabelle (schema `gipoguida`)
| Tabella | Contenuto |
|---|---|
| `capitoli` | numero, titolo, intro (dal seme) |
| `sezioni` | capitolo, ordine, titolo, slug, corpo markdown, percorso_gipo, parole_chiave, stato VALIDATA/DA_VALIDARE, origine SEME/REDAZIONE, seme_hash, validata_il/da, aggiornata_il/da, tsv (GIN); v0.71.1: fonte (INTERFACCIA, MANUALE_TD, INTERFACCIA+MANUALE, REDAZIONE), livello (OPERATIVO, BACK_END), sintesi, fonte_validazione, seme_meta_hash, ricerca_tsv (GIN, trigger) |
| `revisioni` | versione precedente di ogni modifica: fonte MANUALE/SEME/RIPRISTINO/STATO, nota, autore |
| `faq` | domanda, risposta, sezione_id, ordine, origine SEME/DOMANDA_UTENTE/REDAZIONE, ruolo, pubblicata, seme_chiave/seme_hash, tsv (GIN) |
| `domande` | utente, testo **mascherato**, categorie mascherate, risposta, fonti (jsonb, con `citata`), modello, esito RISPOSTA/PARZIALE/SENZA_RISPOSTA/SOLO_RICERCA, utile, nota_utente, presa in carico, risolta_con_faq_id, risolta_dalla_guida, rigenerata_il/da, rigenerazioni, chiusura |
| `ricerche` | testo mascherato e numero di risultati (statistiche) |
| `impostazioni` | stato del seme, ultimo riepilogo settimanale |
| `users` | riga tecnica dell'utente del modulo |

Audit della Suite: GIPOGUIDA_SEZIONE, GIPOGUIDA_FAQ, GIPOGUIDA_RISPOSTA, GIPOGUIDA_SEME, GIPOGUIDA_RIEPILOGO. Migrazione del modulo
`gipoguida/001_init.sql` e, v0.71.1, `gipoguida/002_back_end.sql` (colonne nuove, vincoli, funzioni e trigger dell'indice, esito
PARZIALE; idempotente: IF NOT EXISTS, DROP ... IF EXISTS prima di ogni ADD CONSTRAINT, CREATE OR REPLACE, provata due volte di seguito nel
test). Il modulo è in `FRESH_MODULES` e si attiva da solo all'avvio (come SGI e Portale Service).

## API
| Metodo e percorso | Chi | Cosa |
|---|---|---|
| GET `/state`, `/badges` | tutti / ADMIN | profilo, AI attiva, avviso; contatore della coda |
| GET `/indice`, `/sezioni/:slug`, `/faq?q=`, `/cerca?q=&livello=` | tutti | consultazione e ricerca (indice e sezione con fonte, livello, fonte_validazione) |
| POST `/chiedi`; GET `/domande/mie`, `/domande/:id`; POST `/domande/:id/valuta` | tutti | domande e valutazione |
| GET `/guida.pdf` | tutti | PDF completo |
| GET/POST/PUT `/redazione/sezioni[/:id]`, POST `/redazione/sezioni/:id/stato`, `/ripristina-seme`, GET `/redazione/revisioni/:id`, POST `/redazione/revisioni/:id/ripristina` | ADMIN | editor e storico |
| GET/POST/PUT/DELETE `/redazione/faq[/:id]` | ADMIN | FAQ |
| GET `/redazione/coda?vista=`, POST `/redazione/domande/:id/prendi`, `/risolvi`, `/chiudi`; v0.71.1 `/rigenera`, `/risolta-dalla-guida` | ADMIN | coda |
| GET `/redazione/statistiche`, `/redazione/seme`; POST `/redazione/seme/ricarica`, `/redazione/riepilogo`, `/redazione/controlla-testo` | ADMIN | statistiche, seme, riepilogo |

## Collaudo (12/11/2026)
Database proprio `suite_gg_t`, server su 3175 (`DISABLE_SCHEDULER=true`), build Vite in `web/dist`. Primo avvio: modulo attivato, seme
caricato (95 sezioni, 73 FAQ). Verificati: ricerca con sinonimi (storno, incasso, ricetta, prenotaz), mascheramento (CF e telefono tolti
dalla domanda salvata), domande senza AI (SOLO_RICERCA, SENZA_RISPOSTA) e con un **modello finto** al posto di Claude (server locale che
imita l'API Messages ed estrae i passi dai brani ricevuti: serve a provare il percorso completo `askJson` → `ai_log` → fonti citate, non
la qualità delle risposte), valutazione "no" in coda, PDF di 74 pagine guardato pagina per pagina (copertina, indice, capitoli, riquadri
"attenzione", appendice). Schermate in `docs/screens/gipoguida-*.png`. Test automatici: `server/test/gipoguida.test.mjs` (19 test).

## Collaudo v0.71.1 (13/11/2026)
Database proprio `suite_gg2_t`, server su 3177 (`DISABLE_SCHEDULER=true`, `WEB_DIR=web/dist`), build Vite. Avvio: migrazioni 001 e 002
applicate, modulo attivato, seme caricato (140 sezioni, 123 FAQ). Verificati via API con sessione vera: indice (140 sezioni, 41 back-end,
32 dal manuale), domanda del CEO senza AI (SOLO_RICERCA con i passi di "Sottoconfigurazioni" in testa), valutazione "no", coda,
**Rigenera risposta**, **Segna come risolta dalla guida**, statistiche, ricerca con `livello=BACK_END`, PDF di 123 pagine. Pagine Guida
(filtro back-end), Chiedi e Redazione aperte in un browser senza errori in console (schermate `docs/screens/gipoguida-backend.png`,
`gipoguida-chiedi-ceo.png`, `gipoguida-coda-rigenera.png`). Script `gipoguida-domande.mjs`: 32 domande su 32 trovano la sezione attesa
(30 al primo posto, una al secondo, una al terzo). Test: `gipoguida.test.mjs` (19, aggiornati alla nuova pipeline) e `gipoguida-domande.test.mjs`
(15); intera suite con `DATABASE_URL_TEST`: 577 test verdi. La risposta con Claude vero non è stata provata (nessuna chiave
nell'ambiente di collaudo): il percorso piano + risposta è coperto dal modello finto.

## Limiti
- I contenuti vengono da un'analisi dell'interfaccia del 12 e 13/11/2026, non dall'uso reale: le sezioni non del manuale sono da
  validare; le procedure di back-end vanno provate su un'agenda o una prestazione di prova (in particolare Priorità delle
  sottoconfigurazioni, conteggio delle settimane alterne, effetto dei Giorni festivi sulla prenotazione, Copia prezzi di listino).
- Il manuale TD-SGI-MAN007 e l'interfaccia divergono in 12 punti (sezione 15.20): vanno chiariti con il referente e nella prossima
  revisione del manuale. GipoNext
  cambia (Docplanner aggiorna il prodotto): una schermata diversa da quella descritta va segnalata con "Mi è stata utile: no".
- Niente lettura delle sessioni GIPO degli utenti, niente integrazione con GipoNext: il link "Apri in GIPO" apre solo la pagina.
- La qualità delle risposte dipende dai testi della guida e dal modello configurato (Amministrazione > Impostazioni > Claude); senza
  chiave Anthropic il modulo funziona come ricerca.
- Il mascheramento non riconosce i nomi delle persone.

## Da verificare in produzione
- Primo avvio su Render: log `[gipoguida] modulo Guida GIPO attivato` e `seme caricato: sezioni 95 nuove`; Diagnostica senza errori.
- Una domanda vera con Claude (modello configurato) e la riga `kind = 'gipoguida'` in `ai_log`; tempi di risposta (timeout 45 s).
- PDF generato dal server di produzione (font e logo dalla cartella shipments/assets) e anteprima nel browser (CSP: frame same-origin).
- Un accesso esterno (cliente service) non vede il widget; un dipendente senza grant lo vede come LETTORE.
- Il lunedì successivo: notifica del riepilogo agli amministratori se la coda non è vuota.
- Nomina del referente interno (sezione 0.3) e prime validazioni con i referenti GIPO delle sedi.
- v0.71.1: all'avvio il log `seme caricato: sezioni 45 nuove, ... aggiornate` (le 95 sezioni della v0.70.0 si aggiornano se nessuno le
  ha toccate); la domanda del CEO con Claude vero (esito PARZIALE atteso, passi con Periodicità nel mese) e due righe `gipoguida` in
  `ai_log` (piano e risposta); i 12 punti da riconciliare con il manuale; una prova reale delle sottoconfigurazioni su un'agenda di prova
  e l'annotazione del risultato nella sezione 14.4.
