import React from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import CockpitScadenzario from './CockpitScadenzario.jsx';

// Scadenzario completo di direzione (filtri, "Segna come vista", export XLSX e PDF): pagina propria da quando /cockpit è il monitor
// (CEO, 08/11/2026). Raggiungibile dal link discreto in fondo al monitor e dal menu della sezione Cockpit.
export default function CockpitScadenzarioPagina() {
  return (
    <div className="page">
      <PageHead title="Scadenzario di direzione" icon="calendar" sub="Tutte le scadenze dei moduli e dell'anagrafica, con filtri, viste ed export"
        crumb={<><Link to="/cockpit"><Icon name="back" />Cockpit direzionale</Link></>} />
      <CockpitScadenzario />
    </div>
  );
}
