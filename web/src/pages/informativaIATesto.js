// Testo dell'Informativa sull'uso dell'intelligenza artificiale nella Suite TD (richiesta del CEO, 05/11/2026). Fonte unica: lo usano la
// pagina pubblica /informativa-ia (InformativaIA.jsx) e lo script che produce il DOCX da pubblicare sul sito
// (server/scripts/informativaIA-docx.mjs). JavaScript puro, senza JSX, perché lo importa anche Node.
// BOZZA DA FAR RIVEDERE AL CONSULENTE PRIVACY prima della pubblicazione. Se il testo cambia nella sostanza: aggiornare VERSIONE e DATA
// qui e la versione in Amministrazione > Impostazioni > Informative (consensi.ia_versione), così tutti la riaccettano.

export const VERSIONE = '1.0';
export const DATA = '05/11/2026';
export const TITOLO = "Informativa sull'uso dell'intelligenza artificiale nella Suite TD";

export const SEZIONI = [
  {
    titolo: 'Chi siamo',
    paragrafi: [
      'La Suite TD è gestita da Toscana Diagnostica S.r.l., con sede in Via di Pratignone 13/4, 50019 Sesto Fiorentino (FI), partita IVA 07528130482. Per qualsiasi domanda su questa informativa puoi scrivere a info@toscanadiagnostica.it oppure usare i contatti indicati sul sito www.toscanadiagnostica.it.',
    ],
  },
  {
    titolo: "Che cos'è la Suite TD",
    paragrafi: [
      "La Suite TD è l'intranet e la suite operativa della rete Toscana Diagnostica. La usano i dipendenti e i collaboratori, i clienti del servizio di laboratorio e i partner che ospitano i nostri punti prelievo, ciascuno con gli strumenti che gli sono stati assegnati. Questa informativa spiega in modo semplice dove e come alcune funzioni della Suite si servono di un sistema di intelligenza artificiale, perché tu possa saperlo quando le usi.",
    ],
  },
  {
    titolo: "Dove interviene l'intelligenza artificiale",
    paragrafi: [
      "Alcune funzioni della Suite si appoggiano a Claude, un modello di intelligenza artificiale sviluppato da Anthropic. Nel modulo Referti esterni Claude legge il PDF del referto inviato da un laboratorio esterno e ne trascrive i dati sul formato di Toscana Diagnostica; su richiesta dell'operatore applica anche le correzioni che gli vengono indicate. Nelle Circolari aiuta a dare forma alle bozze e propone le domande dei questionari di lettura. Nelle Sedi e nello Scadenziario dei pagamenti legge i contratti di locazione in PDF per proporre le scadenze e le condizioni principali.",
      "Nei Contratti del personale aiuta a classificare i documenti che arrivano nella casella People e a riassumere i curriculum ricevuti. Nell'Audit SGI prepara una sintesi dei risultati degli audit; in Facility commenta i dati sui consumi energetici; in Spedizioni legge i PDF e le email con le richieste del progetto Lifestyle per proporre la compilazione della richiesta. Claude interviene infine nella ricerca in linguaggio naturale, dove formula una risposta a partire dai risultati che la Suite ti mostra, e nella proposta delle frasi del giorno della Community.",
    ],
  },
  {
    titolo: 'Come interviene',
    paragrafi: [
      "In tutte queste funzioni l'intelligenza artificiale è un aiuto al lavoro delle persone: trascrive, classifica, riassume o propone una bozza. Non prende decisioni automatiche che abbiano effetti sulle persone: di regola ogni risultato viene verificato e confermato da un operatore prima di essere usato, e l'operatore può sempre correggerlo o scartarlo.",
      "C'è un solo caso in cui la conferma avviene senza un passaggio manuale: i referti esterni che arrivano alla casella email dedicata del laboratorio. Quando la trascrizione supera il controllo automatico di coerenza con il documento di partenza e non presenta anomalie, il referto trascritto viene confermato e inviato al mittente della email; in tutti gli altri casi resta in bozza finché un operatore non lo verifica. Ogni referto confermato in questo modo resta nel registro del modulo e può essere riaperto e corretto.",
      "L'intelligenza artificiale non viene usata per profilare gli utenti né per formulare diagnosi o valutazioni cliniche; nel caso dei referti si limita a riportare i dati così come sono scritti nel documento di partenza.",
    ],
  },
  {
    titolo: 'Quali dati passano al fornitore',
    paragrafi: [
      "Per svolgere una di queste funzioni la Suite invia ad Anthropic, attraverso la sua interfaccia di programmazione (API), solo il contenuto necessario a quella specifica operazione: per esempio il PDF da leggere, il testo della bozza da strutturare o la domanda posta alla ricerca. I dati sono elaborati sui server del fornitore, che possono trovarsi in Europa o negli Stati Uniti secondo il contratto in essere. Secondo i termini del fornitore, i dati inviati attraverso l'API non sono usati per addestrare i suoi modelli. I risultati restano nella Suite, nei moduli in cui sono stati richiesti.",
    ],
  },
  {
    titolo: 'Trasparenza',
    paragrafi: [
      "Vogliamo che tu sappia sempre quando stai usando una funzione assistita dall'intelligenza artificiale. Per questo nell'interfaccia della Suite queste funzioni sono segnalate con la dicitura “con Claude” o con il nome Claude accanto al comando, come per esempio “Genera con Claude” o “Lettura con Claude”. Questa informativa risponde allo stesso principio di trasparenza richiamato dal Regolamento europeo sull'intelligenza artificiale (Regolamento (UE) 2024/1689).",
    ],
  },
  {
    titolo: 'Controllo umano e segnalazione degli errori',
    paragrafi: [
      "Un sistema di intelligenza artificiale può sbagliare. Per questo i risultati passano dalla verifica di una persona, con la sola eccezione dei referti della casella dedicata descritta sopra, che vengono confermati solo se superano il controllo di coerenza. Se noti un errore in un risultato prodotto con Claude puoi correggerlo direttamente nella scheda, se ne hai i permessi, oppure segnalarlo aprendo un ticket nella Suite o scrivendo a info@toscanadiagnostica.it, indicando il modulo e l'elemento interessato.",
    ],
  },
  {
    titolo: 'I tuoi diritti',
    paragrafi: [
      "Il trattamento dei dati personali nella Suite, compreso quello che avviene nelle funzioni descritte qui, segue la Privacy Policy di Toscana Diagnostica, pubblicata sul sito www.toscanadiagnostica.it. Lì trovi come esercitare i tuoi diritti e a chi rivolgerti.",
    ],
  },
];

export const NOTA_VERSIONE = `Versione ${VERSIONE} del ${DATA}. Quando questa informativa cambia, la Suite ti chiede di prenderne atto di nuovo al primo accesso.`;
