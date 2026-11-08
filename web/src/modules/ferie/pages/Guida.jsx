// Guida del Piano Ferie: il piano ferie annuale per area come stabilito dal CEO (08/11/2026), per dipendenti, responsabili e amministratore
import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

export default function Guida() {
  return (
    <div className="page">
      <PageHead title="Guida" icon="info" sub="Il piano ferie annuale di ogni area: lo compila il dipendente, lo approva il responsabile dell'area o il CEO" />
      <div className="alert info" style={{ marginBottom: 16 }}><span>"Serve per pianificare il piano ferie annuale per singola area in modo che sia trasparente a tutta l'area il piano. Visibilità solo all'interno dell'area. Approva il responsabile o il CEO." (CEO, 08/11/2026)</span></div>
      <div className="fe-two">
        <Card title="Per i dipendenti" icon="user">
          <ul className="fe-guida">
            <li>Il Piano Ferie riguarda i dipendenti con contratto di lavoro subordinato registrato in Contratti del personale. I liberi professionisti non sono compresi.</li>
            <li><b>Il mio piano</b>: nel calendario dei 12 mesi trascina sui giorni (o cliccane uno) per aggiungere un periodo; puoi indicare mezza giornata il primo o l'ultimo giorno. I giorni lavorativi si contano da soli: festivi nazionali, santo patrono della sede e la tua settimana lavorativa.</li>
            <li>In alto vedi sempre quanti giorni hai <b>da pianificare</b>: spettanti dell'anno + residuo dell'anno precedente − giorni già nel piano.</li>
            <li>Quando il piano è pronto premi <b>Invia al responsabile</b>. Finché il responsabile non lo prende in carico puoi ancora modificarlo.</li>
            <li>Dopo l'approvazione il piano non si modifica più direttamente: per aggiungere, spostare o togliere un periodo proponi una <b>variazione</b>, che il responsabile approva o rifiuta.</li>
            <li>Sotto il tuo piano vedi <b>il piano della tua area</b>: nomi e periodi dei colleghi della tua area, mai di altre aree. Saldi e note restano riservati.</li>
            <li>Le <b>chiusure collettive</b> della tua area ti sono proposte: con "Aggiungi al piano" il periodo si inserisce da solo.</li>
          </ul>
        </Card>
        <Card title="Per i responsabili di area" icon="users">
          <ul className="fe-guida">
            <li>Il responsabile dell'area è l'approvatore dall'organigramma (responsabile della sede o dell'unità di primo livello), chi ha il profilo Responsabile o chi lo sostituisce per delega. Vede solo la propria area.</li>
            <li><b>Piano dell'area</b>: tutte le persone dell'area per mesi, settimane o giorni, con lo stato del piano di ciascuno e i giorni sotto la <b>copertura minima</b> in rosso.</li>
            <li>Nella vista <b>Mese</b> clicca un giorno per aggiungere un periodo a una persona, o un periodo per spostarlo o toglierlo. Modificando un piano inviato lo prendi in carico (stato "In revisione").</li>
            <li><b>Approva</b> il piano di una persona o <b>tutta l'area</b> in un colpo; poi <b>Rendi definitivo</b>. Un piano definitivo lo cambi solo tu (o l'amministratore) con un motivo, e il dipendente riceve la notifica; puoi anche <b>riaprirlo</b> con un motivo.</li>
            <li>Le <b>variazioni</b> proposte dopo l'approvazione arrivano in "Variazioni da decidere": approva o rifiuta con il motivo.</li>
            <li>Ricevi un promemoria per i piani inviati e le variazioni in attesa da qualche giorno (predefiniti 3).</li>
          </ul>
        </Card>
        <Card title="Stati del piano" icon="list">
          <ul className="fe-guida">
            <li><b>Bozza</b>: il dipendente lo compila.</li>
            <li><b>Inviato</b>: il dipendente l'ha inviato al responsabile e può ancora cambiarlo.</li>
            <li><b>In revisione</b>: il responsabile lo sta modificando.</li>
            <li><b>Approvato</b>: i periodi sono approvati; il responsabile può ancora modificarlo, il dipendente propone variazioni.</li>
            <li><b>Definitivo</b>: bloccato. Ogni cambio del responsabile o dell'amministratore ha un motivo, è registrato come variazione e notificato al dipendente.</li>
          </ul>
        </Card>
        <Card title="Giorni: come si calcolano" icon="stats">
          <ul className="fe-guida">
            <li><b>Spettanti</b>: giorni annui (per CCNL e livello, impostazione dell'amministratore) × mesi lavorati nell'anno / 12. Un mese conta se il rapporto ne copre almeno 15 giorni (ipotesi da verificare con il consulente del lavoro).</li>
            <li><b>Residuo anno precedente</b>: inserito dall'amministratore (a mano o da file XLSX).</li>
            <li><b>Pianificati</b>: somma dei periodi del piano dell'anno; <b>goduti</b>: quelli approvati già passati.</li>
            <li><b>Da pianificare</b> = spettanti + residuo anno precedente − pianificati − variazioni in attesa.</li>
            <li>Avviso dell'anno precedente: il CEO ha indicato lo smaltimento entro il 30 giugno. Il D.Lgs. 66/2003 (art. 10) prevede almeno due settimane nell'anno di maturazione e il resto entro i 18 mesi successivi: la data è un'impostazione da confermare con il consulente del lavoro.</li>
          </ul>
        </Card>
        <Card title="Aree del piano" icon="tree">
          <ul className="fe-guida">
            <li><b>Direzione</b>: tecnostruttura (unità STAFF sotto il vertice), vertice e sede direzionale.</li>
            <li><b>Laboratorio</b>: unità della sede di tipo Laboratorio o sotto l'area "Laboratorio".</li>
            <li><b>Sedi</b>: tutte le altre, un'area per sede (la sede dell'unità nell'organigramma o la sede di lavoro della persona).</li>
            <li>Chi non ha né unità con sede né sede di lavoro finisce in "Da assegnare": l'amministratore lo sistema in Impostazioni &gt; Aree forzate.</li>
          </ul>
        </Card>
        <Card title="Amministratore" icon="shield">
          <ul className="fe-guida">
            <li>L'amministratore (il CEO; HR solo se ha il profilo Amministratore del modulo) vede tutte le aree e può fare tutto ciò che fa il responsabile su ogni area.</li>
            <li>Gestisce le impostazioni: giorni annui, patroni, copertura minima, chiusure collettive, promemoria e la <b>scadenza di invio del piano</b> di ogni anno.</li>
            <li>Il cruscotto mostra i piani per stato in ogni area, i residui a rischio e il non goduto da smaltire.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
