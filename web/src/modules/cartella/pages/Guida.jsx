import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';
import { useApi } from '../api.js';

export default function Guida() {
  const state = useApi('/state');
  const l = state.data?.limiti;
  return (
    <div className="page narrow cf-guide">
      <PageHead title="Guida" icon="info" sub="Come funziona la Cartella condivisa: che cosa contiene, chi vede, chi gestisce." />
      <Card title="Che cos'è" icon="folder">
        <p>Una cartella di documenti comune a chi ha accesso al modulo: procedure, modulistica, materiali e comunicazioni di lavoro, organizzati in cartelle e sottocartelle. Non ci sono permessi per cartella: chi vede il widget nella home vede tutto il contenuto.</p>
        <p><b>Cartella</b> è la navigazione ad albero, con il percorso in alto e la scelta tra griglia ed elenco. <b>In evidenza</b> raccoglie i documenti segnalati dalla gestione (compaiono anche in cima alla cartella principale) finché la loro scadenza non passa. <b>Novità</b> elenca i documenti caricati negli ultimi {l?.novita_giorni || 30} giorni che non hai ancora aperto: il contatore accanto alla voce scende a ogni apertura o download. <b>Cerca</b> trova per nome, descrizione, nome del file originale e cartella; gli stessi documenti compaiono nella ricerca generale della Suite.</p>
      </Card>
      <Card title="Aprire e scaricare" icon="download">
        <p>Un clic su un PDF o un'immagine apre la scheda con l'anteprima e il pulsante Scarica; gli altri tipi (Word, Excel, PowerPoint, testo, CSV) si scaricano direttamente. Ogni documento ha una scheda con dettagli e storico delle versioni: le versioni precedenti restano scaricabili.</p>
        <p>L'etichetta <b>nuovo</b> segnala i documenti recenti che non hai ancora aperto; la stella segnala quelli in evidenza; "Letto da" conta le persone che lo hanno aperto almeno una volta.</p>
      </Card>
      <Card title="Gestione" icon="gear">
        <p>Chi ha il profilo <b>Gestione</b> (ADMIN) trova la voce Gestione: stessa navigazione con i comandi. Crea cartelle, carica file (trascinandoli o scegliendoli, più file alla volta), e dal menu di ogni elemento rinomina, cambia descrizione, sposta (con la tendina ad albero), mette in evidenza con una scadenza, carica una nuova versione, elimina. Una cartella si elimina solo se vuota. Se un file con lo stesso nome esiste già nella cartella, la gestione propone di caricarlo come nuova versione.</p>
        <p>Tipi ammessi: {(l?.estensioni || ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'webp', 'txt', 'csv', 'md']).join(', ')}; dimensione massima {l?.max_file_mb || 50} MB per file. Ogni operazione resta nella Cronologia del modulo e nell'audit della Suite.</p>
      </Card>
      <Card title="Chi ha accesso" icon="shield">
        <p>Il modulo è riservato a chi ha il grant: profilo <b>Consultazione</b> (VIEWER) per leggere e scaricare, <b>Gestione</b> (ADMIN) per amministrare. Le regole di accesso iniziali propongono la consultazione a tutti i responsabili di unità e la gestione a Retail & Communications Management e HSQ Management; l'amministratore della Suite assegna gli altri accessi da Amministrazione > Utenti.</p>
        <p>Non caricare documenti con dati di pazienti o dati personali: la cartella è visibile a tutte le persone abilitate.</p>
      </Card>
    </div>
  );
}
