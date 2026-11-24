# Public Affairs (widget `affari`, area Direzione) · v0.96.0

Richiesta del CEO del 24/11/2026: monitoraggio di siti specifici e della normativa sanitaria nazionale e della Regione Toscana, sintesi
con l'API Anthropic per valutarne l'utilità, email ogni giorno in caso di novità.

## Fonti
Due tipi: PAGINA (si confrontano i collegamenti della pagina) e RSS (feed RSS o Atom). Categorie: avvisi e bandi, normativa
nazionale, normativa Regione Toscana, altro. Fonti proposte al primo avvio: USL Toscana Centro (manifestazioni di interesse e accordi
contrattuali), USL Toscana Nord Ovest (manifestazioni di interesse), USL Toscana Sud Est (bandi e avvisi), Gazzetta Ufficiale Serie
Generale (feed), BURT consultazione (collegamenti ai fascicoli). Altre si aggiungono da "Fonti monitorate" con la prova di lettura.

Regole:
- la prima lettura di una fonte registra ciò che c'è già come preesistente: nessun avviso;
- è una novità ciò che compare dopo;
- se una pagina mostra insieme più novità del tetto (predefinito 40) si presume un cambio di struttura del sito: le voci si registrano
  senza avviso e la fonte risulta da controllare;
- una fonte che fallisce tre letture di fila genera una notifica in Suite;
- cambiando indirizzo, tipo o filtro la fonte riparte dalla prima lettura.

Lettura: ogni 6 ore fra le 5 e le 22 e subito prima dell'email. Solo indirizzi pubblici, tetto alle dimensioni, nessun aggiramento di
controlli anti-robot (lettore di `business/lib/scouting/web.js`).

## Valutazione
Primo passo: giudizio di utilità (alta, media, bassa), linee interessate, sintesi breve e motivo, a gruppi di 20, su titolo e descrizione.
Secondo passo, per utilità alta e media: lettura del documento (pagina o PDF, prime 60 pagine) e sintesi con che cosa prevede, perché
interessa, che cosa fare, scadenza. Il giudizio usa il "Profilo dell'azienda" delle Impostazioni. Senza chiave Anthropic le novità si
rilevano e si inviano senza sintesi.

## Email
Una al giorno all'ora scelta (predefinita 8), solo se ci sono novità non ancora inviate. Avvisi e bandi entrano sempre; la normativa
secondo la soglia (predefinita: alta e media). Destinatari dalle Impostazioni; se vuoti, il titolare della Suite.

## Limiti dichiarati
- Elenchi a più pagine: si legge la prima.
- Pagine costruite dal browser (senza collegamenti nell'HTML) non sono leggibili: serve un feed o un altro indirizzo. Il sito del
  Ministero della Salute è di questo tipo e non è tra le fonti proposte.
- BURT: ogni fascicolo è un PDF lungo; la sintesi copre le prime 60 pagine e lo dichiara.
- Gazzetta Ufficiale: il feed porta l'ultimo numero; con la lettura ogni 6 ore non si perde, ma un fermo del servizio di più giorni sì.
- Un atto modificato allo stesso indirizzo non viene rilevato come novità.
- Sintesi e giudizi sono prodotti da un modello AI: va letto l'originale.

Job `affari:giro` ogni ora. Test `server/test/affari.test.mjs` (sito di prova locale, modello finto).

## v0.97.0 · Archivio dal gennaio 2026 e normativa di riferimento (CEO, 24/11/2026)

**Archivio** (`/affari/archivio`). Le pagine degli avvisi delle USL sono elenchi a righe su più pagine. La Suite ora legge l'elenco riga per riga (`estraiRighe`: una voce per riga, con la data di pubblicazione quando l'elenco la riporta) e non più tutti i collegamenti della pagina. `archivia(fonte)` segue le pagine successive (`paginaSuccessiva`, al più 15), registra le voci dal 01/01/2026 come storiche (non sono novità, non generano email), si ferma alla prima pagina con sole voci datate precedenti. Data della voce: pubblicazione, altrimenti scadenza nel titolo; le voci senza data si tengono. Toglie i collegamenti del menu registrati dalla prima lettura, se mai lavorati. Le voci storiche ricevono il giudizio di utilità del modello sul titolo (`valutaArchivio`, anche a ogni giro). Parte da sola 45 secondi dopo il primo avvio della versione; poi pulsante "Aggiorna l'archivio" (profilo Direzione). API: `GET /voci?vista=STORICO`, `GET /archivio/stato`, `POST /archivio`, `POST /fonti/:id/archivio`.

Limiti: USL Toscana Centro non riporta la data di pubblicazione nell'elenco (si usa la scadenza del titolo); le fonti che dal server non rispondono (al 24/11/2026: USL Nord Ovest e Gazzetta Ufficiale, "Il sito non risponde") non hanno archivio; i feed non hanno archivio.

**Normativa di riferimento** (`/affari/normativa`). Tabelle `norme`, `norme_parti`, `norme_domande` (migrazione 002). Norme proposte con il testo nel programma (`modules/affari/norme/`, presi dai siti ufficiali il 24/11/2026): l.r. 51/2009 (Raccolta normativa, testo coordinato), regolamento 79/R del 2016 con allegati A, B, C, D (PDF ARS di 242 pagine, testo con le modifiche del d.p.g.r. 90/R del 2020), manuale operativo dei requisiti di esercizio (decreto 6230 del 19/04/2021, allegato 1); più due collegamenti alle pagine della Regione. La Direzione aggiunge altre norme dall'indirizzo (pagina o PDF: il testo si acquisisce subito).

Domande: `POST /norme/chiedi`. Il testo è diviso in brani di circa 1.800 caratteri con il riferimento (allegato, sezione, articolo, requisito). Le parole della domanda, più i termini suggeriti dal modello, scelgono i brani (BM25, al più 14 più il seguito dei primi tre, 42.000 caratteri); il modello risponde solo su quei brani con il numero del brano tra parentesi quadre e dichiara che cosa manca. Sotto la risposta si leggono i passi usati. Ogni domanda resta in `norme_domande`. Senza modello AI la ricerca restituisce i passi più vicini.

Limiti: i testi non hanno valore legale e non si aggiornano da soli (data di acquisizione mostrata per ogni norma); la ricerca è per parole, non per significato: una domanda formulata con termini lontani da quelli della norma può non trovare il passo; la risposta va verificata sul testo ufficiale.

## v0.97.2 · Chi può aggiungere una fonte (CEO, 25/11/2026)

Chiunque abbia il widget (profili Direzione e Visualizzatore) può provare la lettura e aggiungere una fonte (`POST /fonti/prova`, `POST /fonti`). Modifica, sospensione, lettura a mano ed eliminazione restano al profilo Direzione. Quando la aggiunge un Visualizzatore, chi gestisce il widget riceve una notifica; nell'elenco compare "aggiunta da".
