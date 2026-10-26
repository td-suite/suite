import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

export default function Guida() {
  return (
    <div className="page narrow circ-guide">
      <PageHead title="Guida all'uso" icon="info" sub="Come nasce, si pubblica e si diffonde una circolare aziendale." />
      <Card title="Il flusso in cinque passi" icon="list">
        <div className="circ-steps">
          <div><div><b>Bozza.</b> Il laboratorio o l'ufficio scrive la circolare come preferisce (Word, PDF, testo, anche in orizzontale) e la carica in "Nuova circolare". Claude ne ricava la scheda: titolo, oggetto, sintesi, sezioni, elenchi e tabelle, senza alterare numeri, date e condizioni. Senza Claude la scheda nasce con regole semplici e si rifinisce a mano.</div></div>
          <div><div><b>Rifinitura.</b> Nella pagina della bozza si correggono scheda e corpo. I blocchi del corpo sono quattro: titolo di sezione, paragrafo, elenco, tabella. "Anteprima impaginata" produce Word e PDF sulla carta intestata, senza protocollo.</div></div>
          <div><div><b>Pubblicazione.</b> Il profilo Pubblicazione assegna il protocollo TD-AAAA/NNN: lo fa il registro, in modo progressivo per anno, mai a mano. Il documento viene impaginato in via definitiva con il QR code e la circolare entra nell'archivio e nella ricerca della Suite. Il testo non si modifica più.</div></div>
          <div><div><b>Diffusione.</b> "Invia" spedisce il PDF alle liste di distribuzione (clienti service, punti prelievo, medicina del lavoro, partner, personale) con il collegamento alla versione digitale. Ogni invio resta registrato.</div></div>
          <div><div><b>Revisioni.</b> Una circolare pubblicata si corregge con "Nuova revisione": la bozza eredita tutto, alla pubblicazione prende il suffisso r1, r2 e la versione precedente passa a Superata. Il QR code stampato apre sempre l'ultima revisione in vigore. Una circolare sbagliata si annulla, non si elimina.</div></div>
        </div>
      </Card>
      <Card title="Impaginazione" icon="doc">
        <p>Format approvato il 24/10/2026: carta intestata luglio 2026, fascia CIRCOLARE bicolore con tipo di comunicazione, protocollo, luogo e data; metadati (destinatari, oggetto, decorrenza, riferimenti); titolo; riquadro "In sintesi"; corpo giustificato con sezioni numerate; tabelle con intestazione petrolio e celle centrate; box "Per informazioni" con QR code; firma; piè di pagina con protocollo e numero di pagina.</p>
        <p>Orientamento automatico: la circolare va in A4 orizzontale quando una tabella ha più di cinque colonne; si può forzare verticale o orizzontale dalla scheda. La carta intestata si adatta da sola.</p>
      </Card>
      <Card title="Ricerca" icon="search">
        <p>L'archivio cerca nel contenuto, non solo nel titolo: sintesi, corpo, tabelle, riferimenti e anche il testo della bozza di origine. Le circolari pubblicate compaiono anche nella ricerca generale della Suite.</p>
      </Card>
      <Card title="Profili" icon="shield">
        <p>Consultazione: legge archivio e documenti. Redazione: crea bozze, le rifinisce e genera le anteprime. Pubblicazione: pubblica, invia, crea revisioni, annulla, gestisce le liste. Amministratore: tutto.</p>
      </Card>
    </div>
  );
}
