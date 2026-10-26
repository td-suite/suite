// Gestione: ultime operazioni sul modulo (eventi)
import React from 'react';
import { Link } from 'react-router-dom';
import { useApi, base } from '../api.js';
import { Card, Loading, Empty, PageHead } from '../../../components/ui.jsx';
import { descriviEvento, EVENTO, itDateTime } from '../format.js';

export default function Cronologia() {
  const { data, loading, error } = useApi('/eventi');
  return (
    <div className="page cf-page">
      <PageHead title="Cronologia" icon="clock" sub="Le ultime 200 operazioni di gestione: caricamenti, versioni, rinomine, spostamenti, evidenze, eliminazioni." actions={<Link className="btn ghost" to={`${base}/gestione`}>Torna alla gestione</Link>} />
      {error ? <Empty icon="alert" title="Dati non disponibili">{error.message}</Empty> : loading && !data ? <Loading /> : !data?.length ? <Empty icon="clock" title="Nessuna operazione registrata" /> : (
        <Card flush><div className="table-wrap"><table className="t">
          <thead><tr><th>Quando</th><th>Chi</th><th>Operazione</th><th>Dettaglio</th></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id}><td className="small">{itDateTime(e.created_at)}</td><td className="small">{e.user_nome || 'Sistema'}</td><td className="small strong">{EVENTO[e.tipo] || e.tipo}</td><td>{e.documento_id && e.documento_nome ? <Link to={`${base}/doc/${e.documento_id}`}>{descriviEvento(e)}</Link> : descriviEvento(e)}</td></tr>)}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}
