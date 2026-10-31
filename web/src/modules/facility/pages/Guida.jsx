// Guida del modulo Facility e Manutenzioni
import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';

const S = ({ t, children }) => <Card title={t} style={{ marginBottom: 14 }}><div className="small" style={{ lineHeight: 1.6 }}>{children}</div></Card>;

export default function Guida() {
  return (
    <div className="page">
      <PageHead title="Guida" icon="info" sub="Come funziona Facility e Manutenzioni" />
      <S t="Chi fa cosa">Facility (Operations) gestisce immobili, dispositivi, piano, interventi, utenze ed energia. Il manutentore, anche di un fornitore esterno, vede le scadenze e gli interventi affidati a lui o alla sua Legal entity, registra l'esecuzione e chiude. Il site manager vede la propria sede, segnala i guasti con foto, conferma i controlli di sede (sorveglianza mensile di estintori, porte, luci di emergenza, DAE) e registra le letture dei contatori. Qualità e HSQ consultano e scaricano i report.</S>
      <S t="Immobili">Ogni sede attiva dell'anagrafica è un immobile. Nella scheda: dati catastali e tecnici, superficie (serve all'intensità energetica), canone e scadenze lette dal contratto di affitto in Payments, Legal entity ospitante, obblighi di controllo del contratto (generano scadenze), documenti con scadenza e la planimetria. La planimetria caricata qui è la fonte: va in Room Planning della stessa sede, dove si posizionano gli ambulatori.</S>
      <S t="Dispositivi e Catalogo">Il Catalogo dispositivi è in Amministrazione &gt; Anagrafiche: per ogni tipo le periodicità di sorveglianza, controllo e manutenzione e il riferimento normativo. I valori iniziali sono un benchmark da confermare con RSPP e Qualità. Registrando un dispositivo nascono le sue scadenze; ogni dispositivo ha un QR da stampare che apre la scheda con il registro.</S>
      <S t="Piano e promemoria">Chiudendo una scadenza con esito, data, costo e rapportino nasce la successiva (data di esecuzione più la periodicità). Un esito non conforme apre un intervento correttivo. Un obbligo con costo avvisa Payments per l'istanza di pagamento. Ogni giorno le scadenze passate diventano scadute e partono i promemoria a 30, 7 e 0 giorni, mai doppi.</S>
      <S t="Interventi">Segnalazione con priorità e foto; SLA: urgente 24 ore, alta 3 giorni, media 10, bassa 30 (benchmark, modificabili). Facility assegna a un manutentore interno o a una Legal entity fornitrice; il manutentore avanza e chiude con la risoluzione, il costo e le ore di fermo. MTTR = tempo medio tra apertura e chiusura.</S>
      <S t="Utenze e Payments">Le utenze e le bollette stanno in Payments. Creandole qui entrano nello Scadenziario strutture: ogni bolletta registrata compare con la scadenza di pagamento e la si paga con l'istanza di Payments. Facility aggiunge vettore, POD/PDR, potenza, tariffa e le letture dei contatori.</S>
      <S t="Energia">Consumi dalle bollette (ripartiti sui giorni del periodo) o dalle letture. Indicatori: kWh equivalenti (gas a 10,69 kWh/Smc), CO2 con fattori indicativi, kWh per m2 all'anno, kWh per accettazione (attività da Retail Assistant, Cash Management o inserita a mano), kWh per ora di apertura. Confronto con gli stessi mesi dell'anno prima, anomalie (mese oltre il 20% rispetto all'anno prima o alla media dei tre mesi precedenti), classifica tra sedi, obiettivi di riduzione. Le fasce di benchmark sono indicative (letteratura di settore / ENEA) e vanno tarate. L'analisi con Claude commenta i dati aggregati e propone azioni per urgenza.</S>
    </div>
  );
}
