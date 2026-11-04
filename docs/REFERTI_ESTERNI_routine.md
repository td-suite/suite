# td-referti-ext · Riproduzione referti di terze parti su format Toscana Diagnostica

Specifica della routine "Come da routine definita, elabora i referti in formato DOCX su format TD e i relativi PDF", consolidata nelle sessioni dal 08/09 al 29/10/2026 del progetto Claude dedicato ("Laboratorio di Analisi", pacchetto "Referti EXT su format TD": 28 referti DOCX/PDF, generatore Python gen.py + gen3.py, template BARONI VERA) e portata nel widget Referti esterni della Suite.

> **Motore del 03/11/2026 (richiesta del CEO).** Testuale: "Dobbiamo completamente cambiare il funzionamento di Referti Esterni. Continua a fare dello schifo! Invece sempre in Claude ma in un progetto dedicato (non webapp) direttamente su prompt fa referti perfetti ed esattamente quello che cerco! O facciamo questo oppure il widget non serve!" e "includi 'chiedi una correzione'". Da questa data il widget fa quello che fa il progetto: **il PDF lo legge Claude** con le regole della routine e **il DOCX lo scrive il generatore del progetto** (porting fedele in Node). I parser a mano restano solo come riserva senza chiave Anthropic. Le sezioni 3–6 descrivono il motore nuovo; le regole di trascrizione (sezioni 2, 3.1–3.3, 4 della specifica del progetto) sono nel prompt di sistema di `lib/lettura.js`.

## 1. Scopo

Il laboratorio invia in service esami a laboratori esterni (Bianalisi Firenze, Cerba HealthCare – RDI Limena, Cerba HealthCare Toscana – Nuova Igea Firenze). I referti rientrano come PDF con intestazione del laboratorio esterno. La routine li trascrive **fedelmente** sul format canonico Toscana Diagnostica (carta intestata TD, font Lato, tabelle senza bordi) producendo per ogni paziente un file `Referto - COGNOME NOME.docx` e il PDF gemello, da archiviare in `OneDrive - Toscana Diagnostica S.r.l\Laboratorio di Analisi\EXT - Referti Microbiologia\`.

Il widget non interpreta né modifica i risultati: è un trascrittore con controllo visivo. Il referto TD non porta firma, timbro o logo del laboratorio esterno.

## 2. Input

| Sorgente | Come si riconosce | Struttura PDF |
|---|---|---|
| **Bianalisi S.p.A. – Laboratorio Firenze** | Intestazione "BIANALISI S.p.A. Laboratorio Firenze"; codici `Referto R3YE… del gg/mm/aaaa` e `Accettazione A3YE… del gg/mm/aaaa`; riga anagrafica `F-16/04/1974 (anni 52) TOLAFI`; nome file `COGNOME_R3YE….PDF` | 1 paziente per PDF, 1–3 pagine; colonne Analisi / Risultati / Intervalli di Riferimento |
| **Cerba – Rete Diagnostica Italiana (Limena)** | Intestazione "Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA"; `Accettazione n°` + `Data Acc.`; nome file `merge….pdf` | **PDF unito: più pazienti, una pagina ciascuno** (es. 6 KPC) |
| **Cerba HealthCare Toscana – Nuova Igea (Firenze)** | Intestazione "Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54"; `Accettazione n°` + `Data Acc.`; nome file `merge….pdf` o `cognome nome.pdf` | 1 paziente per PDF, 1–2 pagine; l'antibiogramma può proseguire a pagina 2 |

Tutti i PDF finora ricevuti hanno testo estraibile (`pdftotext -layout`); se non c'è testo si usa l'OCR (Tesseract ita) come aiuto, con l'anomalia "verifica manuale obbligatoria" (Claude legge comunque il PDF come documento).

Un PDF "merge" va **spezzato per paziente**: nuova scheda ogni volta che cambiano cognome/nome + numero di accettazione nell'intestazione di pagina; le pagine successive con la stessa accettazione sono continuazione (es. antibiogramma lungo).

## 3. Lettura con Claude (`server/src/modules/referti/lib/lettura.js`)

- **Cosa riceve Claude.** Il PDF sorgente come documento (blocco `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` nel messaggio utente, funzione `askJsonDocument` di `server/src/lib/claude.js`, con lo stesso secondo tentativo di `askJson`: risposta troncata o non JSON → più spazio e "solo JSON") e, come aiuto, il testo di `pdftotext -layout` pagina per pagina. Modello `config.anthropic.model` (Amministrazione > Impostazioni > Claude), `max_tokens` 16000 (`REFERTI_AI_MAX_TOKENS`), tempo massimo 180 s (`REFERTI_AI_TIMEOUT_MS`).
- **Prompt di sistema** (`PROMPT_SISTEMA`): le regole di trascrizione della specifica del progetto (sezioni 2, 3, 4 e 7): fedeltà assoluta e nessuna interpretazione; legature ricongiunte; valori spezzati ricomposti, a capo voluti dentro la cella con `\n`; virgola decimale e simboli `<=` `>` `/` `^` conservati; solo riquadro anagrafico e riquadro dei risultati (niente intestazioni, piè, testate di colonna, firme, diciture legali, ragione sociale del cliente); settori nell'ordine della sorgente; varianti A/B del riquadro; corpo 1 per Bianalisi/RDI e corpo 2 per Nuova Igea; antibiogramma Bianalisi come righe della stessa tabella del corpo 1 ("Sensibile - MIC <=4"); ESBL al suo posto; due microrganismi → due tabelle (#2 senza gli antibiotici vuoti); legenda copiata dalla sorgente; carica assente → omessa; esiti lunghi integrali; note a piè e frase "annulla e sostituisce"; anagrafica abbreviata trascritta com'è e segnalata. Poi lo schema JSON della sezione 4 con **un esempio completo per ciascun corpo**, tratto dai referti del progetto (gen9 IgE Bianalisi, urinocoltura Bianalisi con antibiogramma, KPC RDI, gen11 DINE Nuova Igea con esami RDI e nota, gen9 GRASSI due microrganismi) **con dati anagrafici inventati**: nessun nome reale nel prompt (verificato dal test).
- **Risposta.** `{ schede: [ { pagine: [..], dati } ] }`, una scheda per paziente nei PDF uniti, oppure `{ non_referto: true, motivo }` (elaborazione SCARTATA con il motivo, nessun file prodotto).
- **Dopo la risposta.** Validazione zod (`lib/blocchi.js rispostaLetturaSchema`: un blocco di tipo sconosciuto o un campo fuori schema fanno fallire la lettura, 422 AI_ERROR); pagine ricondotte a quelle del PDF; sorgente dal testo; nome file `Referto - COGNOME NOME` (suffisso alla conferma se esiste già); `testo_sorgente` della scheda = riga anagrafica + righe del riquadro dei risultati delle pagine (dai parser, `analisiSorgente`) e conteggio indipendente degli antibiotici della sorgente, per il controllo di coerenza; anomalie automatiche (sezione 5).
- **Modalità** (`modoLettura`, distintivo nella scheda e nelle Impostazioni): `CLAUDE` (chiave Anthropic configurata); `RISERVA` (chiave assente, oppure lettura con Claude non riuscita: i parser a mano di `lib/parsers` producono lo stesso JSON con `daParser`, anomalia "Letta con il parser di riserva" e, se Claude ha fallito, il motivo nelle note della lettura); `MOCK` (`REFERTI_AI_MOCK=1`, mai in produzione: restituisce i JSON attesi delle fixture `server/test/fixtures/referti/lettura/*.json` riconosciuti dal testo del PDF; per i test e il collaudo senza chiave).
- **Privacy.** Nei log del server solo id dell'elaborazione/scheda, modalità, pagine, numero di schede, millisecondi e token (`[referti] lettura elaborazione 12: CLAUDE, 2 pagine, 1 schede, 23110 ms, token 9876/2345`); in `ai_log` la richiesta è "referti lettura elaborazione N". Nessun nome di paziente.

## 4. JSON della scheda (`lib/blocchi.js`) e generatore (`lib/formatTD.js`)

Il JSON rispecchia **esattamente le chiamate del generatore del progetto**: ogni blocco è una funzione di gen.py / gen3.py, consumata in ordine.

```
{ anagrafica: { cognome_nome, righe: [[etichetta, valore], ...] },        righe del riquadro come vanno stampate
  blocchi: [ { tipo: 'settore', titolo }                                   settore()
           | { tipo: 'titolo_esame', testo }                               p(...) 10,5 pt teal keepNext (gen9 IgE)
           | { tipo: 'paragrafo', testo, stile: 'small'|'normale', before, after }   p([(testo, SMALL)]) note e valori di riferimento
           | { tipo: 'tabella1', righe: [{ nome, risultato, riferimento, bold_name, small: [], unit }] }   table([row(...)]) corpo 1
           | { tipo: 'esame2', nome, metodo: [] }                          esame_v2()
           | { tipo: 'tabella2', righe: [{ etichetta, valore, riferimento? }] }   table2([row2 / row2r]) corpo 2
           | { tipo: 'antibiogramma', specie, n, carica, carica_lbl, legenda, righe: [[antibiotico, sir, mic]] }   antibiogramma_leg()
           | { tipo: 'spacer' } ],                                         spacer()
  nome_file, sorgente, note_anomalie: [] }
```

Riquadro: variante A `Data di nascita`, `Sesso`, `Accettazione n°`, `Data Acc.`; variante B `Data di nascita` con `(anni NN)`, `Sesso`, `Referto` e `Accettazione` con codice e data. Le colonne di ricerca della scheda (cognome_nome, data_nascita, sesso, accettazione, data_acc, referto) si ricavano dalle righe (`colonneAnagrafica`).

**Generatore = porting fedele** di gen.py + gen3.py + `row2r` di gen11.py: stesse stringhe OpenXML, stessi twip (riquadro 4479; corpo 1 3969/3061/2608; corpo 2 4309/3628/1701; antibiogramma 4876/1928/1474), stessi colori, dimensioni e margini di cella, stesse funzioni (`anagrafica`, `settore`, `row`/`table`, `spacer`, `row2`/`row2r`/`table2`, `esame_v2`, `antibiogramma_leg`, `build`). `build` tiene dal `word/document.xml` del template la testa fino a `<w:body>` e la coda da `<w:sectPr>` (intestazione, piè e margini) e mette in mezzo il corpo; gli altri file del template restano invariati. Template predefinito `server/src/modules/referti/templates/formatTD_BARONI_VERA.docx` = `05_Template/Template format TD (base Referto - BARONI VERA).docx` del pacchetto ("Format TD (BARONI VERA)"); quello caricato dalle Impostazioni usa lo stesso meccanismo e deve avere `word/document.xml` con `<w:body>` e `<w:sectPr>`. PDF con LibreOffice headless. **Non "migliorare" le stringhe del generatore: ogni modifica rompe la parità con i referti del progetto.**

**Parità verificata (03/11/2026).** Con i dati delle istanze gen8–gen11 (GAMBINO SANDY e GAMBINO SANDY (Bianalisi IgE), GRASSI TIZIANA, SARSI MARIA CRISTINA, DINE KATERINA, SENSI ROMANA, STEFANI UGHETTA) il DOCX della Suite è **identico byte per byte** (tutti i 20 file del pacchetto, `word/document.xml` compreso) sia ai DOCX di `01_Referti_DOCX` sia a quelli rigenerati con i generatori Python; i 28 referti del progetto, letti all'inverso in JSON a blocchi e rigenerati, danno lo stesso `document.xml`. I PDF dell'anteprima di DINE, STEFANI e SENSI (dai tre merge Nuova Igea reali, lettura simulata) hanno lo stesso testo e sono identici pixel per pixel a 150 dpi ai PDF di `02_Referti_PDF`. Test: `server/test/referti-formatTD.test.mjs`, `server/test/referti-lettura.test.mjs` (il pacchetto e i PDF sorgente non stanno nel repository: `REFERTI_PACCHETTO`, `REFERTI_PDF_SORGENTI`; se mancano quei confronti si saltano).

## 5. Flusso del widget

1. **Carica** uno o più PDF (Inbox, oppure mail alla casella template@). Lettura con Claude (sezione 3); PDF che non sono referti scartati con il motivo.
2. **Schede** per paziente in BOZZA, versione 1 (origine LETTURA). Anomalie automatiche in giallo: anagrafica incompleta o abbreviata, OCR, carica assente, due microrganismi, nota di sostituzione, nome file già esistente, parser di riserva, segnalazioni della lettura (`note_anomalie` scritte da Claude).
3. **Scheda**: a sinistra il PDF sorgente, a destra l'anteprima PDF del referto TD; sotto, "Chiedi una correzione" con lo storico delle versioni, il controllo di coerenza e l'**editor per blocchi** (riquadro anagrafico con le righe come vanno stampate, poi ogni blocco nell'ordine: titoli di settore, tabelle del corpo 1 con righe piccole e grassetto, esami e tabelle del corpo 2, antibiogrammi con specie, numero, etichetta e valore della carica, legenda, antibiotici S/I/R/MIC; aggiunta e rimozione di righe, antibiotici e blocchi, spostamento su/giù). Ogni salvataggio è una versione MANUALE.
4. **Chiedi una correzione** (profilo LAB, scheda in BOZZA, anche dopo "Riapri"): l'operatore scrive cosa correggere ("cambia la carica in 100.000 UFC/ml"); il server manda a Claude il PDF (le sole pagine della scheda se il PDF ne ha di più), il JSON corrente e l'istruzione, chiede il JSON corretto con lo stesso schema e solo le modifiche richieste, lo valida, lo salva come nuova versione (`scheda_versioni`: n, dati, origine CORREZIONE, istruzione, utente, data) e rigenera anteprima e coerenza. **"Annulla l'ultima correzione"** toglie l'ultima versione CORREZIONE e torna alla precedente (ripetibile). Registro: `CORREZIONE_AI` con l'istruzione e `CORREZIONE_ANNULLATA`; audit della Suite solo con id e versione. Senza chiave Anthropic la correzione risponde 400 (si corregge a mano).
5. **Controllo di coerenza** (`lib/coerenza.js`), checklist prima della conferma: (1) ogni token "risultato" del riquadro della sorgente (valori, MIC, S/I/R, UFC, classi, esiti) ricompare nel testo del DOCX; (2) ogni valore del JSON si trova nella sorgente (nulla di inventato); (3) numero di antibiotici del referto = conteggio indipendente sul testo della sorgente (righe delle tabelle antibiogramma + righe "Sensibile/Resistente/Intermedio - MIC" del corpo 1); (4) nessun numero in più (note a piè e riquadro anagrafico esclusi); (5) anagrafica completa; (6) controllo inverso: nessun testo del laboratorio esterno nel corpo (codici R3YE/A3YE, nomi dei laboratori, medico, direttore, firma, P.IVA; ammessi riquadro anagrafico e note a piè copiate dal PDF); (7) nessuna testata, firma, dicitura legale, numero di pagina o ragione sociale del cliente.
6. **Conferma** → DOCX e PDF definitivi `Referto - COGNOME NOME`, PDF sorgente ritagliato alle pagine della scheda; nome già presente per un altro referto confermato → suffisso tra parentesi (primo esame, es. `(Urinocoltura)`, oppure sorgente o data secondo l'impostazione); referto che "annulla e sostituisce" → sostituzione tracciata nel registro. "Conferma comunque" se la coerenza non è superata (forzatura nel registro).
7. **Registro** con export XLSX (operatore, sorgente, paziente, accettazione, file, anomalie, sostituzioni, correzioni con l'istruzione, modalità di lettura); evidenza ISO 9001 del controllo.

Operazioni in massa: "Conferma tutte le verdi" per le schede senza anomalie (tipico dei lotti KPC).

**Schede del motore precedente (migrazione 005).** Le schede in BOZZA con il JSON dei vecchi parser (senza `blocchi`) vengono marcate `da_rielaborare`: non si generano né si confermano, si rileggono con "Rielabora dal PDF" (nuova versione LETTURA). Le schede CONFERMATE restano con i loro file; se si riaprono e sono del motore precedente diventano da rielaborare.

**Casella template@ (31/10/2026).** Oltre al caricamento manuale, la casella `template@toscanadiagnostica.it` (Impostazioni; `REFERTI_MAILBOX` prevale) viene letta ogni 10 minuti (job `referti:inbox`): ogni allegato PDF di una mail nuova diventa un'elaborazione con origine CASELLA (mittente, oggetto, data; dedupe su id Graph + sha256), letta con Claude come un upload; le mail senza PDF sono ignorate e annotate nel registro. Scheda con coerenza tutta verde e senza anomalie → conferma automatica (registro `CONFERMATA_AUTO`, nessun operatore) e invio del PDF da template@ al mittente con oggetto `Toscana Diagnostica · Referto COGNOME NOME` (nessun dato clinico nel testo); altrimenti resta BOZZA, notifica in app ai profili LAB e l'invio parte alla conferma manuale. Una scheda letta dal parser di riserva ha sempre un'anomalia, quindi non parte mai da sola. Mai due invii dello stesso file allo stesso destinatario senza "Reinvia".

**Riapertura (31/10/2026).** Un referto confermato (anche già inviato) si riapre dalla scheda ("Riapri", LAB): torna BOZZA, si corregge (anche con "Chiedi una correzione"), i file emessi restano in archivio finché non si riconferma; alla nuova conferma DOCX, PDF e PDF sorgente vengono rigenerati e sostituiti nella stessa scheda (versione + 1). La catena `sostituisce_id`/`sostituita_da` verso un'altra scheda resta quella della prima conferma. Se il referto era stato inviato, la Suite non reinvia da sola ma propone "Reinvia al mittente".

## 6. Architettura nella Suite

- **server** (`server/src/modules/referti`): `lib/lettura.js` (Claude, mock, riserva, correzione), `lib/blocchi.js` (schema zod, colonne di ricerca, anomalie, conversione dai parser), `lib/formatTD.js` (generatore), `lib/coerenza.js`, `lib/core.js` (elaborazione, versioni, conferma, riapertura), `lib/parsers/*` (riserva e testo del riquadro per la coerenza), `lib/casella.js` e `lib/regoleInvio.js` (template@), `lib/pdf.js` (pdftotext, OCR, ritaglio pagine), routes `elaborazioni`, `schede` (PATCH dati, `POST /schede/:id/correzione`, `POST /schede/:id/annulla-correzione`, `POST /schede/:id/rielabora`, anteprima, conferma, riapri, scarta, invia), `archivio`, `settings` (`POST /settings/prova-lettura`, template predefinito e caricato), `casella`.
- **db** (schema `referti`): `elaborazioni`, `schede` (`dati` = JSON a blocchi, `dati_orig` = prima lettura, `lettura` CLAUDE/MOCK/RISERVA, `antibiotici_sorgente`, `da_rielaborare`), `scheda_versioni` (n, dati, origine LETTURA/CORREZIONE/MANUALE, istruzione, user_id, at), `file_prodotti`, `registro`, `templates`, `invii`, `app_settings`. Migrazioni 001–005.
- **web** (`web/src/modules/referti`): Inbox, Scheda (anteprima affiancata, editor per blocchi, Chiedi una correzione, versioni), Archivio, Registro, Impostazioni (template "Format TD (BARONI VERA)" predefinito e caricamento di un altro, "Prova la lettura" con JSON e anteprima senza creare schede, casella), Guida.
- **privacy**: il PDF va a Claude (Anthropic) per la lettura e le correzioni, come nel progetto dedicato; nessun dato paziente nelle email o nei log del server; retention configurabile dei PDF sorgente.

Endpoint di gestione: `DELETE /api/referti/elaborazioni/:id` e `DELETE /api/referti/schede/:id` (profilo LAB o admin; con referti confermati serve `force: true`, altrimenti 409 con il conteggio; registro ELABORAZIONE_ELIMINATA / SCHEDA_ELIMINATA).

## 7. Casi particolari già incontrati (test di regressione)

| Caso | Referto di riferimento | Comportamento atteso |
|---|---|---|
| Merge con 6 pazienti, 1 pagina ciascuno | KPC 04/09 (GIANNINI, BEGUM, BASSI, CELIN, STESICORO, SONG) | 6 file distinti |
| Due settori nello stesso referto | PENG LIYUN (Microbiologia molecolare + Microbiologia) | Due titoli di settore in sequenza |
| Antibiogramma Bianalisi su 2 pagine | BOATWNGHT PIPER ROSE | Tabella unica, 2 pagine nel DOCX |
| Esami aggiuntivi dopo l'antibiogramma | BOATWNGHT (Mycoplasma, Neisseria endocervicale) | Righe in coda alla stessa tabella |
| Antibiogramma SIR/MIC con nota interpretativa | NORCIA GIUSEPPINA, CRS LCN, SARSI MARIA CRISTINA | Nota in cella "Antibiogramma/Antimicogramma", tabella sotto |
| Due microrganismi affiancati | GRASSI TIZIANA | Due tabelle #1 e #2, carica "Totale" per #2 |
| Carica batterica assente | CORSI CINZIA | Riga omessa, nessun placeholder |
| Esito testuale lungo (contaminazione) | VORRARO MARIA, MATRAIA RAFFAELLO | Testo integrale nella cella valore |
| Nome file già presente per altro esame | CELIN PATRIZIA (KPC), GAMBINO SANDY (Bianalisi IgE) | Suffisso tra parentesi, nessuna sovrascrittura |
| Referto che annulla e sostituisce | MORCINELLI IRENE | Frase riportata; sovrascrittura del file precedente con traccia nel registro |
| Anagrafica abbreviata | CRS LCN | Trascritta com'è + anomalia "verificare anagrafica" |
| Settore non microbiologico | GAMBINO SANDY (IgE), ROSSI STEFANO (LDL ossidate) | Titolo di settore dalla sorgente, corpo 1 |
| File non referto | Lettera offerta Fondazione Turati | Scartato con messaggio, nessun file prodotto |
| Legature tipografiche | "Ceﬁxime", "Ciproﬂoxacina" | Normalizzate a "Cefixime", "Ciprofloxacina" |
| Sorgente non riconosciuta, etichetta PAZIENTE, cliente TD nell'intestazione, firma digitale e diciture legali | CHIARI STEFANIA (FARMACI, Carbamazepina), 29/10/2026 | Nome dalla riga dopo l'etichetta, solo il settore FARMACI, una riga esame, riquadro con accettazione 3370 del 27/10/2026, nessuna riga spuria (TOSCANA DIAGNOSTICA S.R.L., testata, SN=/InfoCamere, "I risultati di questo referto…", "Regolamento…") |
| Riquadro addossato all'intestazione, "Referto: -", antibiogramma Bianalisi come righe di testo | RECCHIA SAMANTA (uscita sbagliata), 31/10/2026; dal 03/11/2026 resa come i referti Bianalisi del progetto | Riquadro e spaziature del template BARONI VERA, nessuna riga con "-" (righe del riquadro solo se valorizzate), antibiogramma nella stessa tabella del corpo 1 ("Resistente - MIC 16"), ESBL al suo posto; fixture `bianalisi_senza_colonne.txt` (parser di riserva) |
| Merge Nuova Igea reali (03/11/2026) | DINE KATERINA (2 pagine, carica assente, esami RDI e nota (RDI)), STEFANI UGHETTA, SENSI ROMANA | Una scheda per PDF, anomalia solo "carica assente" per DINE, coerenza verde, DOCX identico byte per byte e PDF identico pixel per pixel ai referti del progetto |

## 8. Impostazioni

Template del referto: predefinito **"Format TD (BARONI VERA)"** (scaricabile), caricamento di un altro DOCX con verifica (`word/document.xml` con `<w:body>` e `<w:sectPr>`) e ritorno al predefinito. **"Prova la lettura"**: un PDF di prova letto come in Inbox (Claude, simulazione o riserva) mostra per ogni scheda JSON, anomalie, coerenza e anteprima PDF senza creare elaborazioni né schede. Modalità di lettura in uso (Claude / simulata / parser di riserva). Casella in lettura (template@, `REFERTI_MAILBOX`), "Leggi la casella", "Invia al mittente" (acceso di default), "Prova la casella" e "Prova l'invio". Cartella di destinazione OneDrive (informativa); suffisso predefinito per i nomi già presenti; retention; "genera anche PDF" (default sì). Variabili d'ambiente in `docs/IMPOSTAZIONI.md`.

## 9. Fuori perimetro (per ora)

Invio del referto al paziente o alla sede (resta su StudioLAB; si invia solo al mittente della mail arrivata a template@); importazione risultati in StudioLAB via API (valutare in seguito con CB Sistemi, come per td-nc); firma digitale del referto TD; interpretazione clinica dei risultati; archiviazione automatica nella cartella OneDrive.
