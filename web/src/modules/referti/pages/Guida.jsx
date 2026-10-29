import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

export default function Guida() {
  return (
    <div className="page narrow rf-guide">
      <PageHead title="Guida" icon="info" sub="Come funziona Referti esterni: dal PDF del laboratorio esterno al referto sul format Toscana Diagnostica." />
      <Card title="Come funziona" icon="list">
        <ol className="rf-steps">
          <li><b>Carica.</b> Dall'Inbox trascina i PDF ricevuti da Bianalisi Firenze, Cerba RDI Limena o Cerba Nuova Igea (anche più file per volta e PDF uniti con più pazienti). Il modulo riconosce il laboratorio dall'intestazione, legge il testo del PDF (OCR se il PDF è un'immagine) e crea una scheda per ogni paziente. I PDF che non sono referti vengono scartati con un messaggio.</li>
          <li><b>Controlla.</b> Apri la scheda: a sinistra il PDF di partenza, a destra l'anteprima del referto TD. I casi dubbi sono evidenziati in giallo (anagrafica incompleta o abbreviata, valori ricomposti da più righe, due microrganismi, carica assente, nota di sostituzione, nome file già esistente, OCR). Puoi correggere ogni campo: anagrafica, righe degli esami, antibiotici, note.</li>
          <li><b>Cosa si trascrive.</b> Solo i dati completi del paziente (cognome e nome, sesso, data e luogo di nascita, indirizzo se c'è) e il contenuto del riquadro dei risultati del PDF esterno. Intestazione e piè del laboratorio esterno, codici di referto e accettazione, firme, timbri, diciture legali e medico richiedente non vanno nel referto TD: i codici esterni restano solo nel registro interno come riferimento di tracciabilità.</li>
          <li><b>Verifica.</b> L'anteprima esegue il controllo di coerenza: tutti i valori del riquadro della sorgente devono ricomparire nel referto TD, il numero di antibiotici deve coincidere, non devono comparire numeri assenti nella sorgente, l'anagrafica deve essere completa e nel referto TD non deve comparire alcun testo del laboratorio esterno (intestazioni, codici, nomi dei laboratori). L'esito è una checklist.</li>
          <li><b>Conferma.</b> La conferma genera il DOCX e il PDF definitivi con nome "Referto - COGNOME NOME". Se esiste già un file con lo stesso nome per un altro referto si aggiunge un suffisso tra parentesi; se il referto "annulla e sostituisce" il precedente, il file precedente viene sostituito e la sostituzione resta nel registro. "Conferma tutte le verdi" conferma in un colpo le schede senza anomalie di un PDF (tipico dei lotti KPC).</li>
          <li><b>Archivia.</b> L'Archivio mostra una riga per paziente con le tre icone: PDF di partenza, DOCX trasformato, PDF trasformato. Il Registro tiene traccia di ogni operazione, con export XLSX.</li>
        </ol>
      </Card>
      <Card title="Chi vede e chi fa" icon="shield">
        <p><b>Laboratorio (LAB):</b> carica, corregge, genera anteprime, conferma e scarta le schede.</p>
        <p><b>Qualità (QUALITA):</b> consulta archivio e registro, esporta, gestisce le impostazioni e il template della carta intestata; non elabora né conferma.</p>
        <p><b>Consultazione (VIEWER):</b> vede inbox, schede, archivio e registro senza modificare nulla.</p>
        <p>Il widget compare in Home e nel menu solo a chi ha una di queste abilitazioni (richiesta del CEO: solo personale di laboratorio). Owner e amministratori della Suite hanno tutti i poteri.</p>
      </Card>
      <Card title="Cosa non fa (per ora)" icon="info">
        <p>Non interpreta né modifica i risultati: è un trascrittore con controllo visivo. Il referto TD non porta firma, timbro o logo del laboratorio esterno. Non invia il referto al paziente né alla sede (resta su StudioLAB), non importa i risultati in StudioLAB, non firma digitalmente. L'archiviazione automatica nella cartella OneDrive del laboratorio non è ancora attiva: i file si scaricano dall'Archivio.</p>
        <p>Privacy: i dati dei pazienti restano nel database del modulo (o nell'archivio file della Suite); nessun nome compare nei log del server, nelle notifiche o nell'audit generale della Suite.</p>
      </Card>
    </div>
  );
}
