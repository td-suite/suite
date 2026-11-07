// Business Hub · pagina del contratto (Management > Tutti i contratti, elenchi per sezione, fascicoli): il contenuto è il componente
// ContrattoDettaglio, lo stesso che la scheda "Contratto" dell'account incorpora (richiesta del CEO del 07/11/2026).
import React from 'react';
import { useParams } from 'react-router-dom';
import ContrattoDettaglio from '../components/ContrattoDettaglio.jsx';

export default function ContractDetail() {
  const { id } = useParams();
  return <ContrattoDettaglio id={id} />;
}
