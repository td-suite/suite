# td-referti-ext · Riproduzione referti di terze parti su format Toscana Diagnostica

Specifica della routine "Come da routine definita, elabora i referti in formato DOCX su format TD e i relativi PDF", consolidata nelle sessioni dal 08/09 al 24/10/2026 (36 referti prodotti), da trasformare in widget della Suite Toscana Diagnostica (stessa architettura e stile di td-integration / td-nc / td-cash).

## 1. Scopo

Il laboratorio invia in service esami a laboratori esterni (Bianalisi Firenze, Cerba HealthCare – RDI Limena, Cerba HealthCare Toscana – Nuova Igea Firenze). I referti rientrano come PDF con intestazione del laboratorio esterno. La routine li trascrive **fedelmente** sul format canonico Toscana Diagnostica (carta intestata TD, font Lato, tabelle senza bordi) producendo per ogni paziente un file `Referto - COGNOME NOME.docx` e il PDF gemello, da archiviare in `OneDrive - Toscana Diagnostica S.r.l\Laboratorio di Analisi\EXT - Referti Microbiologia\`.

Il widget non interpreta né modifica i risultati: è un trascrittore con controllo visivo. Il referto TD non porta firma, timbro o logo del laboratorio esterno.

## 2. Input

| Sorgente | Come si riconosce | Struttura PDF |
|---|---|---|
| **Bianalisi S.p.A. – Laboratorio Firenze** | Intestazione "BIANALISI S.p.A. Laboratorio Firenze"; codici `Referto R3YE… del gg/mm/aaaa` e `Accettazione A3YE… del gg/mm/aaaa`; riga anagrafica `F-16/04/1974 (anni 52) TOLAFI`; nome file `COGNOME_R3YE….PDF` | 1 paziente per PDF, 1–3 pagine; colonne Analisi / Risultati / Intervalli di Riferimento |
| **Cerba – Rete Diagnostica Italiana (Limena)** | Intestazione "Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA"; `Accettazione n°` + `Data Acc.`; nome file `merge….pdf` | **PDF unito: più pazienti, una pagina ciascuno** (es. 6 KPC) |
| **Cerba HealthCare Toscana – Nuova Igea (Firenze)** | Intestazione "Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54"; `Accettazione n°` + `Data Acc.`; nome file `merge….pdf` o `cognome nome.pdf` | 1 paziente per PDF, 1–2 pagine; l'antibiogramma può proseguire a pagina 2 |

Tutti i PDF finora ricevuti hanno testo estraibile (`pdftotext -layout`); prevedere comunque OCR di riserva (Tesseract ita) con flag "verifica manuale obbligatoria".

Un PDF "merge" va **spezzato per paziente**: nuova scheda ogni volta che cambiano cognome/nome + numero di accettazione nell'intestazione di pagina; le pagine successive con la stessa accettazione sono continuazione (es. antibiogramma lungo).

## 3. Estrazione dati (parser per sorgente)

> **Corretto il 29/10/2026 su indicazione del CEO** (testuale: "Devi salvare esclusivamente i dati del paziente completi (cognome, nome, sesso, luogo e data di nascita ed eventualmente indirizzo se c'è) e solo il risultato dell'esame contenuto nel PDF, ovvero il contenuto del riquadro del PDF fornito. Questo c'era scritto nella routine ed abbiamo sempre fatto fino ad oggi."). La versione precedente di questo paragrafo elencava i codici di referto/accettazione del laboratorio esterno tra i campi da trascrivere: era un'istruzione errata.

**Cosa si estrae e si salva.** Solo due cose: (1) i **dati completi del paziente** e (2) il **contenuto del riquadro dei risultati** del laboratorio esterno. Tutto il resto del PDF (intestazione e piè del laboratorio esterno, codici di referto/accettazione, firme, timbri, diciture legali, medico/richiedente, contatti, numero di pagina) non va trascritto né salvato nel testo della scheda: il PDF sorgente intero resta soltanto come file di partenza nell'archivio.

Anagrafica (riquadro anagrafico del referto TD):

- `cognome_nome` (maiuscolo, come in sorgente; non normalizzare, es. `CRS LCN` resta `CRS LCN` ma viene segnalato come "anagrafica abbreviata, verificare").
- `sesso` F/M; `data_nascita` gg/mm/aaaa; `eta` se la sorgente la riporta ("(anni NN)", Bianalisi).
- `luogo_nascita`: nell'intestazione paziente, etichette viste/previste "Nato/a a", "Luogo di nascita", "Comune di nascita", oppure il comune accanto alla data ("Nato il gg/mm/aaaa a COMUNE (PR)"). Attenzione: nei PDF Bianalisi la riga `F-16/04/1974 (anni 52) TOLAFI` porta dopo l'età un **codice di sede**, non il luogo di nascita: non va letto come tale.
- `indirizzo` (solo se presente): "Indirizzo", "Residenza", "Domicilio", "Residente a/in" (via, CAP, comune).
- Anomalia "anagrafica incompleta" quando mancano sesso, data o luogo di nascita (l'indirizzo è facoltativo); "anagrafica abbreviata" per nomi senza vocali.
- I codici del laboratorio esterno (`accettazione_n`/`data_acc` per Cerba, `referto_codice`/`referto_data`/`accettazione_codice`/`accettazione_data` per Bianalisi) si leggono **solo come riferimento interno di tracciabilità ISO** (registro/archivio, colonne `schede.accettazione`, `data_acc`, `referto_codice`): servono anche a spezzare i PDF merge per paziente. **Non compaiono mai nel DOCX né nel PDF TD.**

Riquadro dei risultati:

- `settori[]`: elenco di blocchi, ciascuno con titolo (MICROBIOLOGIA, MICROBIOLOGIA MOLECOLARE, ALLERGOLOGIA, ALLERGOLOGIA E INTOLLERANZE, CHIMICA CLINICA…) e righe esame.
- `note_pie[]`: note interne al riquadro, numerate es. `(1) Esame eseguito Bianalisi Verano Brianza (MB)`; frasi di sostituzione es. `Il presente documento annulla e sostituisce il referto R3YEA050100 del 05/10/2026`. Sono le uniche righe in cui è ammesso un nome di laboratorio o un codice esterno, perché fanno parte del riquadro.
- `testo_sorgente` della scheda = riga anagrafica sintetica (cognome nome, sesso, data e età, luogo, indirizzo) + righe del riquadro di tutte le pagine della scheda. Serve al controllo di coerenza; non è mai l'intero testo del PDF.

Regole di pulizia del testo estratto: ricongiungere le legature (`ﬁ`→`fi`, `ﬂ`→`fl`), ricomporre i valori spezzati su più righe nella colonna risultato (es. "Sviluppo di un / discreto / numero di / colonie" → "Sviluppo di un discreto numero di colonie"), conservare virgola decimale e simboli `<=`, `>`, `/`.

### 3.1 Bianalisi (variante B, corpo 1)

Righe esame nella forma `Nome esame | Risultato | Riferimento`, con sottorighe `Metodo: …`, `Materiale …`. Antibiogramma in formato testuale `Antibiotico | Sensibile - MIC <=4` / `Resistente - MIC >16` / `Intermedio - MIC 0,25`, preceduto da `Metodo: Colturale`, legenda EUCAST (4 righe fisse), `Materiale`, `Germe Isolato`, eventuale `Carica Batterica` (es. `10^5 UFC/mL`, `Sviluppo di Alcune Colonie UFC/mL`) e riga `ESBL (Extended Spectrum Beta Lactamase) | Negativo` inserita in mezzo agli antibiotici (mantenere la posizione).

Tipologie viste: urinocoltura (`U - Urinocoltura`), tampone vaginale colturale, tampone secreto vaginale con batterioscopico (Verano Brianza), Trichomonas PCR (settore separato "Microbiologia molecolare"), Mycoplasma/Ureaplasma e Neisseria su tampone endocervicale, IgE specifiche FEIA (settore "Allergologia e intolleranze" con blocco "Valori di Riferimento" a 9 righe prima degli esami; asterisco `*` sul risultato da conservare).

### 3.2 Cerba RDI Limena (variante A, corpo 1)

Tabella `Esame | Risultato | U.M. | Valori di Riferimento`. Esame con sottorighe `Metodo`, `Materiale`, `Sede Anatomica`. Viste: KPC test di conferma (Negativo, T.AMIES rettale), IgE singolo allergene in chemiluminescenza con classi 0–6 come riferimento.

### 3.3 Cerba Nuova Igea (variante A, corpo 2)

Blocco esame (`URINOCOLTURA`, `ESAME MICROSCOPICO DIVERSI`, `ESAME MICROBIOLOGICO DEL SECRETO VAGINALE`) con `Metodo`, `Materiale`, eventuale `Sede Anatomica` o `Nuova descrizione dell'esame come da Nomenclatore 2025`; poi coppie etichetta/valore (`Specie Microbiche`, `Esito`, `Carica Microbica Totale`, `Flogosi`, `Cellule`, `Ife fungine`, `Spore fungine`, `Flora microbica`, `Trichomonas Vaginalis`, `Esame microscopico dopo colorazione di Gram`, `Ricerca …`, `Antibiogramma/Antimicogramma` = nota interpretativa). Antibiogramma tabellare `Microrganismo #n: specie` + `Carica Batterica: 100.000 UFC/ml` (o `Carica Batterica Totale`, o assente) + legenda testata (`R: Resistente I: Intermedio S: Sensibile` oppure `R: Resistente I: Sensibile con aumentata esposizione al farmaco`, copiare quella della sorgente) + righe `ANTIBIOTICO | S/I/R | MIC`. Con **due microrganismi** la sorgente usa colonne affiancate `#1 MIC #2 MIC`: il widget le separa in due tabelle (#1, #2), omettendo per #2 gli antibiotici senza valore. Esiti testuali lunghi (flora mista / contaminazione) vanno riportati integralmente nella cella valore.

## 4. Mappatura sul format canonico TD

Riferimento completo: `01_Format_canonico_referto_Toscana_Diagnostica.md` (progetto "Laboratorio di Analisi"). Sintesi delle regole applicate dal generatore:

- Pagina A4, margini 2/2/2 cm e superiore 3,94 cm; intestazione con logo TD e tre contatti (immagini); piè di pagina TD a 3 righe con numero di pagina. Font Lato ovunque; colori: titoli `004F5F`, etichette `5A6B70`, testo `1A1A1A`, linee `C9E1E6`, accento `42B2BF`, sfondo riquadro `EAF5F7`.
- Riquadro anagrafico a destra (4479 twip), **corretto il 29/10/2026 su indicazione del CEO**: nome 12 pt bold; righe 8,5 pt `Sesso`, `Data di nascita` (con `(anni NN)` se disponibile), `Luogo di nascita`, `Indirizzo` (solo se presente). Non ci sono più le righe `Accettazione n°` / `Data Acc.` / `Referto` / `Accettazione` del laboratorio esterno e sotto il riquadro non compare alcun riferimento al laboratorio esterno: i codici esterni restano nel solo registro interno.
- Corpo 1 / corpo 2 limitati al riquadro dei risultati della sorgente: intestazione e piè del laboratorio esterno, firme, diciture legali, medico/richiedente non si trascrivono.
- Titolo di settore 12,5 pt bold maiuscolo con filetto azzurro; un titolo per ogni settore della sorgente, nell'ordine della sorgente.
- Corpo 1 (Bianalisi, RDI): tabella 3 colonne 3969/3061/2608 twip; nome esame bold 9,5 pt con descrizione a capo e righe `Metodo/Materiale/Sede` 7,5 pt grigie; risultato bold 10,5 pt allineato a destra (unità in grigio normale); riferimento 8,5 pt grigio. Le righe di antibiogramma Bianalisi restano righe della stessa tabella.
- Corpo 2 (Nuova Igea): titolo esame 10,5 pt bold + paragrafo metodo/materiale 7,5 pt; tabella 4309/3628/1701 con etichetta normale e valore bold; poi `Microrganismo #n` 10 pt bold, `Carica Batterica` 9,5 pt bold e tabella antibiogramma 4876/1928/1474 con testata su fondo `004F5F` bianca e righe alternate bianco/`EAF5F7`.
- Note a piè del corpo (`(1) …`, "annulla e sostituisce…") in 7,5 pt grigio dopo l'ultima tabella.
- Nome file: `Referto - COGNOME NOME.docx/.pdf`. Se in cartella esiste già un file con lo stesso nome per un **altro** referto (stesso paziente, esame diverso o laboratorio diverso), aggiungere un suffisso descrittivo tra parentesi, es. `Referto - CELIN PATRIZIA (KPC).docx`, `Referto - GAMBINO SANDY (Bianalisi IgE).docx`. Se invece il nuovo referto "annulla e sostituisce" il precedente, sovrascrivere e tracciare nel registro.

## 5. Flusso del widget

1. **Carica** uno o più PDF (drag & drop o cartella monitorata `EXT - Referti Microbiologia\_inbox`). Rilevamento automatico della sorgente; rifiuto con messaggio chiaro dei PDF che non sono referti (es. lettere commerciali TD caricate per errore).
2. **Spezza** i merge per paziente e mostra l'elenco delle schede trovate (nome, sorgente, accettazione, esami, pagine).
3. **Parsing + anteprima affiancata**: a sinistra la pagina sorgente, a destra il referto TD renderizzato (PDF). Campi estratti editabili in un pannello (anagrafica, righe esame, antibiotici) con evidenza gialla dei casi dubbi: anagrafica abbreviata, OCR, valori spezzati ricomposti, carica assente, due microrganismi, nota di sostituzione, nome file già esistente.
4. **Controllo di coerenza** automatico prima della conferma (aggiornato il 29/10/2026): tutti i token "risultato" del riquadro della sorgente (valori, MIC, S/I/R, UFC, classi) devono ricomparire nel testo del DOCX generato; numero antibiotici uguale; nessun numero in più rispetto a riquadro + riga anagrafica; anagrafica completa (cognome e nome, sesso, data e luogo di nascita); **controllo inverso**: nel DOCX non deve comparire alcun testo del laboratorio esterno (intestazioni, codici R3YE/A3YE, "Accettazione n°", "Data Acc.", nomi Bianalisi / Rete Diagnostica / Nuova Igea / Cerba, medico richiedente, direttore, firma digitale, P.IVA), con l'eccezione delle note interne al riquadro. Esito mostrato come checklist.
5. **Conferma** → genera DOCX (OpenXML da template `Referto - BARONI VERA.docx`, sostituendo `word/document.xml`) e PDF (LibreOffice headless, come per i documenti SGI) → salva nella cartella OneDrive via Graph (SharePoint/OneDrive API, account laboratorio@) → registra nel log.
6. **Registro**: tabella delle elaborazioni (data, operatore, sorgente, paziente, accettazione, file prodotti, anomalie segnalate, sostituzioni) con export XLSX; serve anche come evidenza ISO 9001 del controllo.

Operazioni in massa: "Conferma tutti i verdi" per le schede senza anomalie (tipico dei lotti KPC).

## 6. Architettura proposta (allineata alla Suite)

- **web**: React 18 + Vite, `styles.css` condiviso (Manrope, palette Dark Teal/Pacific Blue/Jet Black/Cornsilk/Mauve), menu laterale, voci: Inbox, Elaborazioni, Registro, Impostazioni.
- **server**: Node 22 + Express; parsing con `pdftotext -layout` (poppler) + parser per sorgente in moduli separati (`parsers/bianalisi.js`, `parsers/cerba-rdi.js`, `parsers/cerba-nuovaigea.js`) che producono lo stesso JSON intermedio; generatore DOCX (`docx/generator.js`, porting del generatore Python usato in sessione: funzioni `anagrafica`, `settore`, `table`/`row` per corpo 1, `esame_v2`/`table2`/`row2` e `antibiogramma` per corpo 2); conversione PDF con `soffice --headless`; archiviazione via Microsoft Graph nella cartella OneDrive del laboratorio.
- **db**: PostgreSQL 16 — tabelle `elaborazioni`, `schede` (JSON intermedio + stato BOZZA/CONFERMATA/SCARTATA), `file_prodotti`, `anomalie`, `registro_attivita`. PDF sorgente e file prodotti in bytea (max 6 MB) oltre che su OneDrive.
- **auth**: Microsoft 365 single tenant TD; ruoli LAB (elabora e conferma), QUALITA (registro, impostazioni), VIEWER.
- **deploy**: Docker su Render Francoforte, `render.yaml` con `BASE_URL`, `MAIL_PROVIDER` e credenziali Graph `sync:false` (lezione td-nc). Immagine con poppler-utils, LibreOffice e font Lato installati.
- **privacy**: nessun dato paziente nelle email o nei log applicativi; i PDF sorgente restano solo in DB e OneDrive; retention configurabile.

Endpoint minimi: `POST /api/elaborazioni` (upload), `GET /api/elaborazioni/:id/schede`, `PATCH /api/schede/:id` (correzioni), `POST /api/schede/:id/anteprima` (PDF), `POST /api/schede/:id/conferma`, `GET /api/registro.xlsx`.

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

## 8. Impostazioni

Cartella di destinazione OneDrive; template DOCX (versionato: la carta intestata luglio 2026); elenco sorgenti con pattern di riconoscimento; regola di naming e suffissi; soglia dimensione PDF; retention; utenti abilitati alla conferma; opzione "genera anche PDF" (default sì).

## 9. Fuori perimetro (per ora)

Invio del referto al paziente o alla sede (resta su StudioLAB); importazione risultati in StudioLAB via API (valutare in seguito con CB Sistemi, come per td-nc); firma digitale del referto TD; interpretazione clinica dei risultati.
