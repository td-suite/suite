// Guida del Piano Ferie: come funziona per dipendenti, responsabili e HR
import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

export default function Guida() {
  return (
    <div className="page">
      <PageHead title="Guida" icon="info" sub="Come funziona il Piano Ferie" />
      <div className="fe-two">
        <Card title="Per i dipendenti" icon="user">
          <ul className="fe-guida">
            <li>Il Piano Ferie riguarda i dipendenti con contratto di lavoro subordinato registrato in Contratti del personale. I liberi professionisti non sono compresi.</li>
            <li><b>Nuova richiesta</b>: scegli le date (anche mezza giornata il primo o l'ultimo giorno). I giorni lavorativi si contano da soli: festivi nazionali, santo patrono della sede e la tua settimana lavorativa del contratto (lunedì-venerdì se il contratto non dice altro).</li>
            <li>La richiesta va al tuo responsabile (della sede o dell'area, dall'organigramma) o a chi lo sostituisce per delega; senza responsabile, a HR. Ricevi una notifica alla decisione.</li>
            <li>Puoi annullare una richiesta in attesa o già approvata se le ferie non sono ancora iniziate.</li>
            <li>Nel <b>Piano per area</b> vedi nomi e periodi dei colleghi della tua area; i saldi restano riservati.</li>
            <li>Le <b>chiusure collettive</b> della tua area ti sono proposte: con "Richiedi" il periodo si compila da solo.</li>
          </ul>
        </Card>
        <Card title="Per i responsabili" icon="users">
          <ul className="fe-guida">
            <li><b>Da approvare</b> elenca le richieste delle persone che approvi. Se una richiesta fa scendere un giorno sotto la <b>copertura minima</b> (es. nessun infermiere nel punto prelievi) vedi un avviso: non blocca, decidi tu.</li>
            <li>Il motivo del rifiuto è obbligatorio e lo legge il dipendente.</li>
            <li>Dopo qualche giorno di attesa (predefiniti 3, impostazione di HR) arriva un promemoria.</li>
            <li>Se vai in ferie puoi delegare le approvazioni a un collega per un periodo (Impostazioni &gt; Deleghe, oppure chiedi a HR).</li>
          </ul>
        </Card>
        <Card title="Saldo: come si calcola" icon="stats">
          <ul className="fe-guida">
            <li><b>Spettanza</b>: giorni annui (per CCNL e livello, impostazione di HR) × mesi lavorati nell'anno / 12. Un mese conta se il rapporto ne copre almeno 15 giorni (ipotesi da verificare con il consulente del lavoro).</li>
            <li><b>Maturato a oggi</b>: la stessa regola sui soli mesi già conclusi.</li>
            <li><b>Anno precedente</b>: il residuo al 31/12 inserito da HR (a mano o da file XLSX). I giorni goduti consumano prima questo residuo.</li>
            <li><b>Residuo</b> = anno precedente + spettanza − goduti − pianificati; <b>disponibili</b> = residuo − richieste in attesa.</li>
            <li>Avviso dell'anno precedente: il CEO ha indicato lo smaltimento entro il 30 giugno. Il D.Lgs. 66/2003 (art. 10) prevede almeno due settimane nell'anno di maturazione e il resto entro i 18 mesi successivi: la data è un'impostazione di HR da confermare con il consulente del lavoro.</li>
          </ul>
        </Card>
        <Card title="Aree del piano" icon="tree">
          <ul className="fe-guida">
            <li><b>Direzione</b>: tecnostruttura (unità STAFF sotto il vertice), vertice e sede direzionale.</li>
            <li><b>Laboratorio</b>: unità della sede di tipo Laboratorio o sotto l'area "Laboratorio".</li>
            <li><b>Sedi</b>: tutte le altre, una colonna per sede (la sede dell'unità nell'organigramma o la sede di lavoro della persona).</li>
            <li>Chi non ha né unità con sede né sede di lavoro finisce in "Da assegnare": HR lo sistema in Impostazioni &gt; Aree forzate.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
