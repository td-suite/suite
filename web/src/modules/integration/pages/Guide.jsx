import React from 'react';
import { Card } from '../components/ui.jsx';

export default function Guide() {
  return (
    <div className="page">
      <div className="page-head"><div><h1>Guida all'uso</h1><div className="sub">Come si lavora sul piano di integrazione, in due minuti.</div></div></div>
      <div className="grid g2">
        <Card title="Il piano">
          <p>Il <b>Cruscotto</b> riassume avanzamento, attività senza owner e carico di lavoro per ruolo. Ogni <b>società target</b> ha la sua scheda: anagrafica, disegno dell'operazione (LOI, preliminare, closing, orizzonte in settimane) e il <b>GANTT</b> delle attività di integrazione.</p>
          <p>Il GANTT parte dal lunedì della settimana del preliminare se indicato, altrimenti del closing. Le attività vengono dal catalogo comune (adempimenti generali e operativi) oppure si aggiungono su misura.</p>
        </Card>
        <Card title="Modificare un'attività">
          <p>Clicca sulle <b>celle</b> per pianificare: un clic fuori dalla barra la estende, sul bordo la accorcia, sull'unica settimana la cancella. Clicca sul <b>nome</b> per aprire la riga di modifica: owner, support, processo, stato, data fine effettiva, P&amp;L, milestone, dettaglio e note. Trascina il simbolo ⋮⋮ per riordinare.</p>
          <p>Impostando lo stato <b>completata</b> si registra la data di fine; viceversa, inserendo la data l'attività passa a completata.</p>
        </Card>
        <Card title="Salvataggio e lavoro di squadra">
          <p>Non c'è un pulsante "Salva": <b>ogni modifica viene salvata subito</b> nel database condiviso e compare entro un secondo a tutti gli utenti collegati. Il chip in alto indica lo stato: <i>sincronizzato</i>, <i>salvataggio in corso</i>, <i>offline</i> (le modifiche restano in coda e vengono inviate alla riconnessione).</p>
          <p>Se due persone modificano la stessa attività nello stesso istante, chi arriva per secondo vede un avviso e la riga viene aggiornata con la versione dell'altro: nessuna modifica viene sovrascritta in silenzio.</p>
        </Card>
        <Card title="Profili">
          <p><b>Sola lettura</b> (investitore, banche): consulta, stampa, esporta. <b>Editor</b>: modifica il piano. <b>Amministratore</b>: in più gestisce utenti, snapshot, import e vede il registro attività completo.</p>
          <p>Il <b>Registro attività</b> conserva ogni modifica con autore, data e valore prima/dopo. Gli <b>snapshot</b> notturni e quelli automatici prima delle operazioni massive permettono di tornare indietro.</p>
        </Card>
        <Card title="Esporta, stampa, importa">
          <p><b>Esporta XLSX</b> produce un file Excel con riepilogo, ruoli e un foglio per società; contiene anche lo stato completo, quindi è un backup portabile. <b>Stampa PDF</b> genera il GANTT per società o per owner (una pagina per persona). Gli amministratori possono <b>caricare</b> un file XLSX/JSON o <b>unire</b> un file della vecchia versione: le attività più recenti nel file aggiornano quelle attuali.</p>
        </Card>
      </div>
    </div>
  );
}
