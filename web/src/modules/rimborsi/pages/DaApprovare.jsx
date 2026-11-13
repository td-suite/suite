// Da approvare (responsabili): le note inviate dai diretti dell'organigramma (P&C anche quelle del vertice), quelle dei livelli sotto in
// sola lettura, le ultime decisioni. La scheda della nota ha i giustificativi sfogliabili e le azioni approva, respingi, escludi riga.
import React from 'react';
import { Card, Loading, Empty, PageHead } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { ModuliCartacei } from '../components.jsx';
import ElencoNote from './ElencoNote.jsx';

export default function DaApprovare() {
  const d = useApi('/da-approvare');
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data;
  return (
    <div className="page rs-page">
      <PageHead title="Note spese da approvare" icon="check" sub={`Approvi le note dei tuoi ${x.diretti} riporti diretti in organigramma${x.pc ? ' e, come P&C, quelle del vertice' : ''}. Nessuno approva la propria nota.`} />
      <Card className="rs-gap" title={`Da decidere (${x.da_approvare.length})`} icon="check" flush><ElencoNote righe={x.da_approvare} attesa vuoto="Nessuna nota in attesa" /></Card>
      {x.catena.length > 0 && <Card className="rs-gap" title={`Dei livelli sotto, in sola lettura (${x.catena.length})`} icon="tree" flush><ElencoNote righe={x.catena} attesa /></Card>}
      <Card className="rs-gap" title="Decise negli ultimi 60 giorni" icon="clock" flush><ElencoNote righe={x.decise} vuoto="Nessuna decisione recente" /></Card>
      <Card title="Modulistica cartacea" icon="file"><ModuliCartacei /></Card>
    </div>
  );
}
