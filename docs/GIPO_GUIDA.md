# Guida GIPO · guida di GipoNext, FAQ, ricerca e domande con risposta (v0.70.0)

Modulo nativo della Suite: nome visibile **Guida GIPO**, chiave tecnica `gipoguida`, tagline "Guida, FAQ e risposte su GipoNext", area
Retail and Flow Management subito dopo Label. Richiesta del CEO del 12/11/2026 ("widget davvero fondamentale"): il personale in difficoltà
con GIPO (GipoNext, il gestionale ambulatoriale di Docplanner Italy, gruppo MioDottore) deve poter interrogare la Suite. Il widget contiene
una guida completa (anche in PDF), le FAQ, una ricerca collegata alla guida e le domande con risposta; la guida si aggiorna di continuo con
le risposte della redazione.

Codice: `server/src/modules/gipoguida`, `web/src/modules/gipoguida`. Contenuti: `server/src/modules/gipoguida/content/`. Test:
`server/test/gipoguida.test.mjs`. Schermate: `docs/screens/gipoguida-chiedi.png`, `gipoguida-guida.png`, `gipoguida-redazione.png`.

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

### Risposte alle domande
1. Il testo si **maschera lato server** prima di salvarlo o inviarlo al modello: codici fiscali (anche con omocodia), email, numeri di
   almeno 9 cifre (telefoni, tessere, partite IVA). Date e importi restano. La risposta dice cosa è stato tolto. I nomi delle persone non si
   riconoscono in modo affidabile: per quelli vale l'avviso fisso.
2. **Limite**: 20 domande all'ora per utente (429 oltre).
3. Si recuperano le **6** sezioni o FAQ più pertinenti (ricerca della guida senza prefisso; nella seconda passata OR solo i brani che
   coprono almeno metà delle parole).
4. Con l'AI configurata (`aiEnabled()` del wrapper `lib/claude.js`, `askJson` con tipo **`gipoguida`** in `ai_log`) Claude risponde in
   italiano **solo sui brani forniti**, in passi numerati, citando i brani [n] (in pagina diventano link alle sezioni), riportando le cautele
   delle sezioni da validare e dichiarando quando la guida non copre la domanda (`copre: false`). Il testo del modello è ripulito (niente
   emoji, trattini lunghi, "approfondire"; gli a capo restano).
5. Esiti: **RISPOSTA**; **SOLO_RICERCA** (AI spenta o non raggiungibile: si mostrano i migliori risultati); **SENZA_RISPOSTA** (nessun
   brano pertinente, oppure il modello dichiara che la guida non copre la domanda).
6. Ogni risposta ha **Mi è stata utile: sì / no** (+ nota, anch'essa mascherata). Solo chi ha posto la domanda la valuta.

### Aggiornamento continuo (senza leggere GIPO)
La Suite non legge ciò che gli utenti fanno dentro GIPO (sito di terzi con dati dei pazienti). La guida cresce così:
1. ogni domanda e ogni ricerca si registrano (testo mascherato; le battute successive della stessa ricerca aggiornano la riga);
2. le domande **SENZA_RISPOSTA** e quelle giudicate **"no"**, non risolte né chiuse, entrano nella coda **Domande da risolvere**;
3. l'amministratore risponde: la risposta diventa una **FAQ pubblicata** collegata a una sezione (origine `DOMANDA_UTENTE`), la domanda
   risulta risolta e chi l'aveva posta riceve una **notifica nella Suite** (tabella `notifications`, link alla FAQ). La FAQ entra subito
   nella pagina della sezione, nella ricerca, nei brani delle risposte successive e nel PDF (appendice e rimando sotto la sezione).
   In alternativa "Chiudi senza FAQ" con una nota (non pertinente, doppione);
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
- Numeri del rilascio 0.70.0: **16 capitoli, 95 sezioni, 73 FAQ**.
- `leggiSeme()` controlla slug unici, FAQ collegate a sezioni esistenti, collegamenti interni validi; un seme non valido blocca l'avvio
  del modulo con l'elenco degli errori.
- **Caricamento** (`caricaSeme`, all'avvio del server in `afterStart`, cioè alla prima attivazione e a ogni rilascio): voci nuove inserite
  (sezioni `DA_VALIDARE`); voci esistenti aggiornate **solo se intatte**: l'impronta del contenuto attuale coincide con `seme_hash` (il seme
  caricato l'ultima volta) e la sezione non è VALIDATA. Le altre restano come sono ("protette"): la Redazione vede "il seme ha una versione
  diversa" e può ripristinarla. La versione sostituita va in `revisioni` (fonte SEME). Nulla si cancella. Se l'impronta complessiva del
  seme non cambia, il caricamento si salta.

### Regole di onestà applicate ai testi
Fonte unica: l'analisi dell'interfaccia di GipoNext del 12/11/2026 (menu, schermate, campi, pulsanti, colonne, filtri, azioni, finestre),
in sola lettura dall'account amministratore di TD, senza dati di pazienti. Le procedure **non sono state eseguite**: i passi dedotti sono
scritti in forma prudente ("dovrebbe", "da verificare") e **tutte le 95 sezioni nascono DA_VALIDARE** (bollino "da validare con un referente
GIPO" in pagina, nell'indice e nel PDF). Dove l'analisi dice "non osservato" la guida lo dichiara e rimanda all'assistenza Gipo; non sono
stati inventati funzioni, campi o comportamenti; nessun testo di Docplanner copiato. Parti dichiarate non osservate: finestra del nuovo
appuntamento, schede Semplificata e Richiami, Panoramica agende, Gestione FSE, Fatture passive, editor e firma del referto, campi delle
schede SSN / Stato prestazioni / Assicurazione dell'assegnazione, contenuto di CRM e MioDottore, permessi dei profili utente, significato
delle sigle E/C e P/SSN. Stato dell'account TD riportato: Gipo730 "Account non configurato", MioDottore "Nessuna Facility collegata".
Il referente interno per GIPO non è nominato: lo scrive la redazione nella sezione 0.3 quando la direzione lo indica.

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
`GET /api/gipoguida/cerca?q=` (registra la ricerca salvo `registra=0`): full text italiano su sezioni e FAQ pubblicate (tsvector generati
`italian`, pesi A titolo e parole chiave, B testo, C percorso; indici GIN). Ogni parola è un gruppo di alternative: la parola, i **sinonimi
minimi** (prenot* → appuntamento, agenda; appuntament* → prenotazione; incass* → cassa e viceversa; storn* → nota di credito; ricett* →
impegnativa e viceversa; disdett*/disdir* → annulla appuntamento; scontrin* → fattura) e, per l'ultima parola, il prefisso (risultati
mentre si scrive). Tutte le parole (AND), poi almeno una (OR, risultati "parziali" con la copertura). Ordinamento `ts_rank_cd` + somiglianza
del titolo (pg_trgm); evidenziazione `ts_headline` con `<b>`. I segnaposto del mascheramento non diventano parole cercate.
**API per gli altri moduli**: `cercaGuida(q, { limite, tipi, prefisso })` in `lib/ricerca.js`; la ricerca globale (`lib/search.js`) la usa
per gli interni con il modulo LIVE (tipo `guida_gipo`, al più 6 risultati, punteggio ricondotto alla scala della Suite).

## PDF
`GET /api/gipoguida/guida.pdf` (`?scarica=1` per salvarlo): pdfkit con lo stile dei PDF della Suite (LiberationSans, logo, colori, dati
aziendali da `lib/company.js`). Copertina (edizione = versione della Suite, data di aggiornamento della guida, numeri, avvertenze, regola sui
dati dei pazienti, assistenza Gipo), indice con numeri di pagina e collegamenti cliccabili (le voci da validare sono marcate), un capitolo
per pagina nuova, ogni sezione con il bollino e il percorso, rimando alle FAQ collegate, appendice con tutte le FAQ pubblicate per
capitolo; intestazione (capitolo corrente) e piè di pagina con versione, data e "pagina n di N". Cache in memoria con chiave sulle date di
modifica (sezioni, FAQ, capitoli) e sulla versione; ogni scrittura della redazione la invalida. Rilascio 0.70.0: 74 pagine.

## Dati e tabelle (schema `gipoguida`)
| Tabella | Contenuto |
|---|---|
| `capitoli` | numero, titolo, intro (dal seme) |
| `sezioni` | capitolo, ordine, titolo, slug, corpo markdown, percorso_gipo, parole_chiave, stato VALIDATA/DA_VALIDARE, origine SEME/REDAZIONE, seme_hash, validata_il/da, aggiornata_il/da, tsv (GIN) |
| `revisioni` | versione precedente di ogni modifica: fonte MANUALE/SEME/RIPRISTINO/STATO, nota, autore |
| `faq` | domanda, risposta, sezione_id, ordine, origine SEME/DOMANDA_UTENTE/REDAZIONE, ruolo, pubblicata, seme_chiave/seme_hash, tsv (GIN) |
| `domande` | utente, testo **mascherato**, categorie mascherate, risposta, fonti (jsonb, con `citata`), modello, esito RISPOSTA/SENZA_RISPOSTA/SOLO_RICERCA, utile, nota_utente, presa in carico, risolta_con_faq_id, chiusura |
| `ricerche` | testo mascherato e numero di risultati (statistiche) |
| `impostazioni` | stato del seme, ultimo riepilogo settimanale |
| `users` | riga tecnica dell'utente del modulo |

Audit della Suite: GIPOGUIDA_SEZIONE, GIPOGUIDA_FAQ, GIPOGUIDA_RISPOSTA, GIPOGUIDA_SEME, GIPOGUIDA_RIEPILOGO. Migrazione del modulo
`gipoguida/001_init.sql` (idempotente). Il modulo è in `FRESH_MODULES` e si attiva da solo all'avvio (come SGI e Portale Service).

## API
| Metodo e percorso | Chi | Cosa |
|---|---|---|
| GET `/state`, `/badges` | tutti / ADMIN | profilo, AI attiva, avviso; contatore della coda |
| GET `/indice`, `/sezioni/:slug`, `/faq?q=`, `/cerca?q=` | tutti | consultazione e ricerca |
| POST `/chiedi`; GET `/domande/mie`, `/domande/:id`; POST `/domande/:id/valuta` | tutti | domande e valutazione |
| GET `/guida.pdf` | tutti | PDF completo |
| GET/POST/PUT `/redazione/sezioni[/:id]`, POST `/redazione/sezioni/:id/stato`, `/ripristina-seme`, GET `/redazione/revisioni/:id`, POST `/redazione/revisioni/:id/ripristina` | ADMIN | editor e storico |
| GET/POST/PUT/DELETE `/redazione/faq[/:id]` | ADMIN | FAQ |
| GET `/redazione/coda?vista=`, POST `/redazione/domande/:id/prendi`, `/risolvi`, `/chiudi` | ADMIN | coda |
| GET `/redazione/statistiche`, `/redazione/seme`; POST `/redazione/seme/ricarica`, `/redazione/riepilogo`, `/redazione/controlla-testo` | ADMIN | statistiche, seme, riepilogo |

## Collaudo (12/11/2026)
Database proprio `suite_gg_t`, server su 3175 (`DISABLE_SCHEDULER=true`), build Vite in `web/dist`. Primo avvio: modulo attivato, seme
caricato (95 sezioni, 73 FAQ). Verificati: ricerca con sinonimi (storno, incasso, ricetta, prenotaz), mascheramento (CF e telefono tolti
dalla domanda salvata), domande senza AI (SOLO_RICERCA, SENZA_RISPOSTA) e con un **modello finto** al posto di Claude (server locale che
imita l'API Messages ed estrae i passi dai brani ricevuti: serve a provare il percorso completo `askJson` → `ai_log` → fonti citate, non
la qualità delle risposte), valutazione "no" in coda, PDF di 74 pagine guardato pagina per pagina (copertina, indice, capitoli, riquadri
"attenzione", appendice). Schermate in `docs/screens/gipoguida-*.png`. Test automatici: `server/test/gipoguida.test.mjs` (19 test).

## Limiti
- I contenuti vengono da un'analisi dell'interfaccia del 12/11/2026, non dall'uso reale: tutte le sezioni sono da validare. GipoNext
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
