// Elenchi trasversali: In evidenza, Novità (nuovi per me), Recenti. Stessa tabella con il percorso della cartella.
import React from 'react';
import { useApi } from '../api.js';
import { Card, Loading, Empty, PageHead } from '../../../components/ui.jsx';
import { DocRow } from '../components.jsx';

const PRESET = {
  evidenza: { url: '/evidenza', title: 'In evidenza', icon: 'star', sub: 'I documenti che la gestione ha messo in evidenza, finché la scadenza non passa. Compaiono anche in cima alla cartella principale.', empty: 'Nessun documento in evidenza al momento.' },
  novita: { url: '/novita', title: 'Novità', icon: 'sparkle', sub: 'Documenti caricati negli ultimi 30 giorni che non hai ancora aperto. Spariscono da qui alla prima apertura o al primo download.', empty: 'Niente di nuovo: hai già aperto tutti i documenti recenti.' },
  recenti: { url: '/recenti', title: 'Recenti', icon: 'clock', sub: 'Gli ultimi 20 documenti caricati o aggiornati con una nuova versione.', empty: 'Nessun documento caricato finora.' },
};

export function TabellaDocumenti({ rows, children }) {
  return (
    <Card flush>
      <div className="table-wrap"><table className="t cf-table">
        <thead><tr><th /><th>Nome e cartella</th><th>Tipo</th><th className="num">Dimensione</th><th>Versione</th><th>Aggiornato</th><th className="num" title="persone che lo hanno aperto">Letto da</th></tr></thead>
        <tbody>{rows.map((d) => <DocRow key={d.id} doc={d} percorso />)}</tbody>
      </table></div>
      {children}
    </Card>
  );
}

export default function Elenco({ preset }) {
  const P = PRESET[preset];
  const { data, loading, error } = useApi(P.url, [preset]);
  return (
    <div className="page cf-page">
      <PageHead title={P.title} icon={P.icon} sub={P.sub} />
      {error ? <Empty icon="alert" title="Dati non disponibili">{error.message}</Empty> : loading && !data ? <Loading /> : !data?.length ? <Empty icon={P.icon} title={P.title}>{P.empty}</Empty> : <TabellaDocumenti rows={data} />}
    </div>
  );
}
