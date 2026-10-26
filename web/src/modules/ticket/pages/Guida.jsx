import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';
import { useApi } from '../api.js';

export default function Guida() {
  const sla = useApi('/sla');
  return (
    <div className="page narrow tk-guide">
      <PageHead title="Guida" icon="info" sub="Come funziona il modulo Ticket: chi apre, chi risponde, in quanto tempo, che cosa resta scritto." />
      <Card title="Come funziona" icon="list">
        <div className="tk-steps">
          <div><div><b>Apertura.</b> Chiunque sia autenticato nella Suite apre un ticket da "Nuovo ticket": sceglie la categoria (che propone priorità e casella destinataria), scrive titolo e descrizione, indica per conto di quale sede o Legal entity fa la richiesta e allega i file che servono. Il ticket riceve il protocollo TK-AAAA/NNNN e i responsabili della casella ricevono notifica ed email.</div></div>
          <div><div><b>Presa in carico.</b> Il responsabile della casella (o un suo superiore nell'organigramma) prende in carico il ticket o lo assegna a una persona che afferisce alla casella. La presa in carico o il primo commento pubblico valgono come prima risposta. Se la richiesta spetta ad altri, il gestore la gira a un'altra casella indicando il motivo.</div></div>
          <div><div><b>Lavorazione.</b> Il gestore commenta, scrive note interne (che il richiedente non vede), cambia la priorità se serve e mette il ticket in attesa quando aspetta qualcosa dal richiedente o da terzi: il tempo in attesa non conta per lo SLA di risoluzione.</div></div>
          <div><div><b>Risoluzione e chiusura.</b> Il gestore segna il ticket come risolto con un messaggio al richiedente, che conferma la chiusura (con una valutazione da 1 a 5, facoltativa) oppure lo riapre entro sette giorni. Senza risposta, il ticket si chiude da solo dopo il numero di giorni impostato dall'amministratore.</div></div>
        </div>
      </Card>
      <Card title="Chi vede e chi fa" icon="shield">
        <p><b>Richiedente:</b> vede i propri ticket, commenta, allega, modifica titolo e descrizione finché il ticket è aperto, annulla un ticket non ancora preso in carico, conferma la risoluzione e riapre.</p>
        <p><b>Osservatori:</b> persone aggiunte dal richiedente o dai gestori; vedono il ticket e ricevono i commenti pubblici. Non previsti sui ticket riservati.</p>
        <p><b>Gestori:</b> i responsabili della casella destinataria e delle caselle superiori (dall'organigramma: incarico di responsabile), l'assegnatario e l'amministratore del modulo. Prendono in carico, assegnano, girano, cambiano priorità e stato, risolvono, scrivono note interne.</p>
        <p><b>Amministratore del modulo (profilo ADMIN):</b> vede tutto, gestisce categorie, SLA e impostazioni. <b>Consultazione (VIEWER):</b> vede tutti i ticket tranne i riservati, senza agire.</p>
        <p>Non serve alcuna abilitazione per aprire ticket e seguire i propri: il modulo è aperto a tutti gli utenti della Suite.</p>
      </Card>
      <Card title="Priorità e tempi (SLA)" icon="clock">
        <p>Ogni priorità ha un tempo massimo di prima risposta e uno di risoluzione, misurati dall'apertura. Cambiando priorità le scadenze si ricalcolano. Quando il ticket è in attesa la scadenza di risoluzione resta congelata e, alla ripresa, si sposta in avanti del tempo trascorso. Un ticket senza presa in carico oltre la scadenza di risoluzione passa in escalation alla casella superiore, i cui responsabili ricevono l'avviso.</p>
        {sla.data && <table className="t" style={{ maxWidth: 520 }}><thead><tr><th>Priorità</th><th>Prima risposta</th><th>Risoluzione</th></tr></thead><tbody>{sla.data.map((s) => <tr key={s.priorita}><td className="strong">{s.priorita} {s.etichetta}</td><td>{s.prima_risposta_ore} ore</td><td>{s.risoluzione_ore} ore</td></tr>)}</tbody></table>}
      </Card>
      <Card title="Privacy e riservatezza" icon="lock">
        <p>Nel ticket non vanno inseriti dati di pazienti (nomi, referti, codici fiscali): per quelli esistono i canali del laboratorio e del sistema qualità.</p>
        <p>La categoria "Segnalazione riservata" rende il ticket visibile solo al richiedente, ai responsabili della casella destinataria (non ai superiori), all'assegnatario e all'amministratore del modulo; chi lo legge senza esserne il richiedente lascia traccia nella cronologia e nell'audit della Suite. Il richiedente può chiedere che il suo nome non compaia fuori dalla casella: nelle liste e nelle statistiche risulta "Riservato". Le email dei ticket riservati portano solo protocollo e collegamento, mai il testo.</p>
        <p>Il modulo non è il canale di segnalazione previsto dal D.lgs. 24/2023 (whistleblowing): per quelle segnalazioni vale il canale ufficiale indicato nella procedura aziendale e richiamato nella pagina Nuovo ticket.</p>
      </Card>
      <Card title="Statistiche ed esportazioni" icon="stats">
        <p>Statistiche sui ticket che si possono vedere: volumi per stato, categoria, casella e struttura, tempi medi, percentuale di SLA rispettati, backlog per età, andamento degli ultimi dodici mesi, valutazione media. Esportazioni: elenco XLSX con foglio Statistiche, scheda PDF del singolo ticket con cronologia, rapporto PDF di periodo.</p>
      </Card>
    </div>
  );
}
