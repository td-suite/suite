import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';
import { Level } from '../components/Score.jsx';
import { UrgenzaBadge } from '../components/Score.jsx';

export default function Guida() {
  return (
    <div className="page narrow au-guide">
      <PageHead title="Guida" icon="info" sub="Come funziona Audit SGI: auto-audit mensili delle sedi, audit interni, audit di terze parti, audit ISO 37001 sui partner, sintesi con Claude." />
      <Card title="Come funziona" icon="list">
        <ol className="au-steps">
          <li><b>Auto-audit mensile.</b> Ogni mese ogni sede struttura (punto prelievi, centro medico, centro diagnostico, laboratorio) compila la checklist di verifica interna. Il site manager la trova in "I miei audit" (una sola per sede e mese, creata al volo), risponde voce per voce con Sì / No / NC / N.A., aggiunge note e numero di revisione dei documenti, salva quando vuole (anche in automatico ogni 30 secondi) e poi preme "Invia a Qualità". Il giorno indicato nelle Impostazioni (predefinito il 17) parte l'avviso in Suite e per email alle sedi che non hanno ancora inviato, con promemoria fino all'invio.</li>
          <li><b>Verifica.</b> Qualità, Retail Manager, Service, MDL Manager e l'AD (il titolare della Suite) aprono l'auto-audit inviato e compilano la colonna parallela "Verifica" voce per voce; "Conferma le risposte della sede" copia la colonna della sede per correggere solo le differenze. "Chiudi verifica" porta l'audit a VERIFICATO: da quel momento fa fede il punteggio del verificatore e lo scostamento con quello della sede resta visibile. Il site manager vede la colonna Verifica in sola lettura.</li>
          <li><b>Audit interno.</b> Dalla pagina Sedi, "Nuovo audit interno": stesso modello, colonna unica, evidenze allegabili (foto, PDF), chiusura da parte di chi conduce.</li>
          <li><b>Audit di terze parti.</b> "Carica audit di terze parti" archivia sulla sede il PDF del certificatore, della ASL o del controllo ispettivo con ente, data, esito e note. Il testo del PDF viene estratto (OCR se è una scansione) e serve alla sintesi; il punteggio non si calcola, pesa l'esito.</li>
          <li><b>Audit Partner (ISO 37001).</b> Audit di due diligence e anticorruzione sulle Legal entity (partner, soci in affari, fornitori, clienti service, locatori), con rischio per voce, rischio iniziale e finale della relazione ed esito. Condotto da Qualità, Service, Retail, MDL Manager, AD.</li>
          <li><b>Sintesi con Claude.</b> Tre pulsanti: per sede (tutti gli audit degli ultimi 12 mesi: livello di allineamento 0-100, aree di competenza con punti di forza, criticità e azioni per urgenza, piano di miglioramento, trend, note sulle terze parti; l'esito numerico va nella scheda della sede di Retail Assistant), per la rete TD (classifica delle sedi, aree deboli ricorrenti, azioni trasversali, piano di rete) e per i partner (singolo e complessivo: conformità, rischio corruzione residuo, azioni).</li>
          <li><b>Archivio.</b> Tutti gli audit con filtri, cestino a fine riga, Excel (Archivio, Punteggi per sezione, NC) e PDF della lista; per il singolo audit Excel della checklist compilata e PDF nello stile del modulo originale, con la pagina Audit report.</li>
        </ol>
      </Card>
      <Card title="Punteggio e livelli" icon="stats">
        <p>Per ogni voce: Sì = 1, No = 0, NC = 0 (e conta come non conformità), N.A. esclusa dal conteggio; le voci libere non rispondono se vuote. Punteggio di sezione e totale in percentuale. Per gli auto-audit con la colonna Verifica compilata fa fede il punteggio del verificatore.</p>
        <div className="au-scale">
          <div><Level letter="A" short /><span>Allineato</span><b>90-100</b></div>
          <div><Level letter="B" short /><span>Sostanzialmente allineato</span><b>75-89</b></div>
          <div><Level letter="C" short /><span>Parzialmente allineato</span><b>60-74</b></div>
          <div><Level letter="D" short /><span>Critico</span><b>0-59</b></div>
        </div>
        <p style={{ marginTop: 10 }}>Urgenza delle azioni suggerite dalla sintesi: <UrgenzaBadge u="ALTA" /> entro pochi giorni, rischio per pazienti, sicurezza o conformità normativa; <UrgenzaBadge u="MEDIA" /> entro il mese; <UrgenzaBadge u="BASSA" /> nel piano di miglioramento.</p>
      </Card>
      <Card title="Chi vede e chi fa" icon="shield">
        <p><b>Amministratore (ADMIN, titolare e amministratori della Suite):</b> tutto.</p>
        <p><b>Qualità (QUALITA):</b> tutto il ciclo: conduce audit interni, di terze parti e sui partner, verifica gli auto-audit, genera le sintesi, gestisce impostazioni e modelli, elimina anche gli audit chiusi.</p>
        <p><b>Auditor (AUDITOR: Retail Manager, Service, MDL Manager):</b> conduce audit interni e sui partner, carica audit di terze parti, verifica gli auto-audit, genera le sintesi.</p>
        <p><b>Site manager (SITE, ambito sede):</b> compila e invia l'auto-audit della propria sede, vede gli audit e la sintesi della sede, elimina solo le proprie bozze. È site manager anche chi risulta responsabile della sede nell'organigramma.</p>
        <p><b>Consultazione (VIEWER):</b> vede tutto senza modificare.</p>
      </Card>
      <Card title="ISO 37001 in breve" icon="info">
        <p>La ISO 37001 è la norma sui sistemi di gestione per la prevenzione della corruzione. Richiede alle organizzazioni, tra l'altro, di valutare il rischio di corruzione, di svolgere la due diligence su partner e soci in affari in misura proporzionata al rischio, di ottenere impegni anticorruzione nei contratti, di controllare regali, ospitalità e donazioni, di mantenere canali di segnalazione e di monitorare e riesaminare i controlli. La checklist proposta nel modulo traduce questi requisiti in voci verificabili sul singolo partner, con richiami al D.Lgs. 231/2001 (modello organizzativo e organismo di vigilanza) e al D.Lgs. 24/2023 (whistleblowing). È una proposta da adattare con Qualità e la Funzione di conformità anticorruzione; i riferimenti ai paragrafi della norma sono indicativi.</p>
      </Card>
      <Card title="Limiti" icon="alert">
        <p>La sintesi è un giudizio assistito dall'intelligenza artificiale: va verificato da Qualità, che resta responsabile della valutazione. Ogni chiamata è registrata nel registro IA della Suite (solo id e conteggi, nessun dato personale: nel prompt passano i nomi delle sedi e delle organizzazioni, i punteggi, le non conformità e il testo dei rapporti di terze parti). Senza la chiave Anthropic i pulsanti di sintesi restituiscono un messaggio; in locale si può collaudare con AUDIT_AI_MOCK=1 (sintesi simulata dai punteggi reali).</p>
      </Card>
    </div>
  );
}
