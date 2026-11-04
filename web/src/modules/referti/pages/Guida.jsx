// Guida del modulo Referti esterni (motore del 03/11/2026: lettura con Claude, generatore del progetto, "Chiedi una correzione")
import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

export default function Guida() {
  return (
    <div className="page narrow rf-guide">
      <PageHead title="Guida" icon="info" sub="Come funziona Referti esterni: dal PDF del laboratorio esterno al referto sul format Toscana Diagnostica." />
      <Card title="Come funziona" icon="list">
        <ol className="rf-steps">
          <li><b>Carica.</b> Dall'Inbox trascina i PDF ricevuti da Bianalisi Firenze, Cerba RDI Limena o Cerba Nuova Igea (anche più file per volta e PDF uniti con più pazienti), oppure inoltrali alla casella dei referti. Ogni PDF diventa una scheda per paziente; i PDF che non sono referti (lettere, offerte) vengono scartati con il motivo.</li>
          <li><b>Lettura con Claude.</b> Il PDF va a Claude insieme al testo estratto, con le stesse regole della routine del progetto "Laboratorio di Analisi": fedeltà assoluta, nessuna interpretazione, legature ricongiunte, valori spezzati ricomposti, virgola decimale e simboli &lt;= &gt; / conservati, settori nell'ordine della sorgente, riquadro anagrafico come il modello (Accettazione n° e Data Acc. per Cerba; Referto e Accettazione con codice e data e l'età per Bianalisi), corpo a tre colonne per Bianalisi e RDI, esame + tabella + antibiogramma per Nuova Igea, due microrganismi in due tabelle, carica assente omessa, note a piè e frase "annulla e sostituisce" riportate. Claude restituisce i dati esattamente come li stampa il generatore del progetto.</li>
          <li><b>Il referto.</b> Il DOCX è prodotto dallo stesso generatore del progetto (porting fedele, stesse stringhe, stessi colori e misure) sul template "Format TD (BARONI VERA)": a parità di dati è identico ai referti fatti nel progetto. Il PDF si genera con LibreOffice.</li>
          <li><b>Controlla.</b> Apri la scheda: a sinistra il PDF di partenza, a destra l'anteprima del referto TD. I casi dubbi sono in giallo (anagrafica incompleta o abbreviata, carica assente, due microrganismi, nota di sostituzione, nome file già esistente, OCR, segnalazioni della lettura). Sotto trovi i dati per blocchi, nell'ordine di stampa: riquadro anagrafico, titoli di settore, tabelle degli esami, esami con metodo e materiale, antibiogrammi, note. Puoi correggere ogni campo, aggiungere o togliere righe e antibiotici, spostare i blocchi.</li>
          <li><b>Chiedi una correzione.</b> Nella scheda in bozza scrivi cosa cambiare come lo diresti a un collega ("cambia la carica in 100.000 UFC/ml", "la Ricerca Lieviti è Positiva") e premi "Chiedi la correzione": Claude rilegge il PDF e la scheda e applica solo quella modifica. Ogni correzione è una nuova versione (storico nella scheda), l'anteprima e il controllo di coerenza si rigenerano; "Annulla l'ultima correzione" torna alla versione precedente. Funziona anche dopo "Riapri". L'istruzione resta nel registro.</li>
          <li><b>Verifica.</b> Il controllo di coerenza è una checklist: ogni valore del riquadro della sorgente (risultati, MIC, cariche, classi, esiti) ricompare nel referto TD; ogni valore del referto si trova nella sorgente (niente di inventato); il numero di antibiotici coincide con quello contato sul testo del PDF; nessun numero in più; anagrafica completa; nel corpo nessun testo del laboratorio esterno (le note a piè copiate dal PDF sono ammesse) né testate, firme o diciture legali.</li>
          <li><b>Conferma.</b> La conferma genera DOCX e PDF definitivi "Referto - COGNOME NOME". Se esiste già un file con lo stesso nome per un altro referto si aggiunge un suffisso tra parentesi; se il referto "annulla e sostituisce" il precedente, il file precedente viene sostituito e resta traccia nel registro. "Conferma tutte le verdi" conferma in un colpo le schede senza anomalie di un PDF.</li>
          <li><b>Archivia, casella, riapri.</b> L'Archivio mostra per paziente PDF di partenza, DOCX e PDF TD; il Registro traccia ogni operazione (anche le correzioni chieste a Claude). Dalla casella template@ i referti verdi e senza anomalie si confermano e partono al mittente in automatico. Un referto emesso si riapre, si corregge (anche con Claude) e si riconferma: i file vengono rigenerati.</li>
        </ol>
      </Card>
      <Card title="Parser di riserva e schede del motore precedente" icon="alert">
        <p><b>Parser di riserva.</b> Senza la chiave Anthropic della Suite (Amministrazione &gt; Impostazioni &gt; Claude), o se la lettura con Claude non riesce (credito, tempo massimo, risposta illeggibile), la scheda viene letta dai parser a mano delle tre sorgenti: compare il distintivo "Parser di riserva" e l'anomalia che chiede di verificare ogni valore. La correzione con Claude in questo caso non è disponibile: si correggono i campi a mano, oppure, con la chiave configurata, si usa "Rielabora dal PDF".</p>
        <p><b>Schede del motore precedente.</b> Le schede in bozza create prima del 03/11/2026 hanno i dati nel vecchio formato: sono marcate "Da rielaborare" e vanno rilette con "Rielabora dal PDF" prima di generarle o confermarle. I referti già confermati restano con i loro file; se si riaprono, si rielaborano.</p>
        <p><b>Prova la lettura.</b> In Impostazioni si può leggere un PDF di prova e vedere JSON, anomalie, coerenza e anteprima senza creare schede.</p>
      </Card>
      <Card title="Chi vede e chi fa" icon="shield">
        <p><b>Laboratorio (LAB):</b> carica, corregge (anche con Claude), genera anteprime, conferma, scarta e riapre le schede.</p>
        <p><b>Qualità (QUALITA):</b> consulta archivio e registro, esporta, gestisce le impostazioni, il template e la prova della lettura; non elabora né conferma.</p>
        <p><b>Consultazione (VIEWER):</b> vede inbox, schede, archivio e registro senza modificare nulla.</p>
        <p>Il widget compare in Home e nel menu solo a chi ha una di queste abilitazioni. Owner e amministratori della Suite hanno tutti i poteri.</p>
      </Card>
      <Card title="Cosa non fa (per ora)" icon="info">
        <p>Non interpreta né modifica i risultati: è un trascrittore con controllo visivo. Il referto TD non porta firma, timbro o logo del laboratorio esterno. Invia il referto solo al mittente della mail arrivata alla casella dei referti, non al paziente né alla sede (resta su StudioLAB); non importa i risultati in StudioLAB, non firma digitalmente. L'archiviazione automatica nella cartella OneDrive del laboratorio non è ancora attiva: i file si scaricano dall'Archivio.</p>
        <p>Privacy: il PDF va a Claude (Anthropic) per la lettura e per le correzioni, come nel progetto dedicato; i dati dei pazienti restano nel database del modulo (o nell'archivio file della Suite). Nei log del server compaiono solo identificativi, pagine, conteggi, tempi e token, mai nomi; nel registro delle chiamate a Claude la richiesta è "referti lettura elaborazione N".</p>
      </Card>
    </div>
  );
}
