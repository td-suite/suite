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
