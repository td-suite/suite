// Clienti esclusi dai solleciti: decisione di CEO o CFO (basta uno dei due), con motivo ed eventuale data di fine. Registro completo.
import React from 'react';
import { Card, Loading, Empty, PageHead, Badge } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { LinkCliente } from '../components.jsx';
import { eur, itData, itDataOra } from '../format.js';

export default function Esclusi() {
  const d = useApi('/esclusioni');
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data;
  return (
    <div className="page">
      <PageHead title="Clienti esclusi dai solleciti" icon="lock" sub="Verso questi clienti non parte nessuna comunicazione; fatture e incassi continuano ad aggiornarsi e lo scaduto resta nel cruscotto. Escludere e riammettere è riservato a CEO e CFO, dalla scheda del cliente." />
      <Card title={`Esclusi oggi (${x.attive.length})`} icon="lock" flush className="cr-gap">{x.attive.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th>Motivo</th><th>Fino al</th><th className="num">Scaduto</th><th>Deciso da</th></tr></thead>
        <tbody>{x.attive.map((c) => <tr key={c.organization_id}><td><LinkCliente id={c.organization_id}>{c.cliente}</LinkCliente></td><td>{c.motivo}</td><td>{c.fino ? itData(c.fino) : 'fino a revoca'}</td><td className="num strong">{eur(c.scaduto)}</td><td className="small">{c.utente}<div className="muted">{itDataOra(c.esclusa_at)}</div></td></tr>)}</tbody></table></div> : <Empty compact icon="check">Nessun cliente escluso</Empty>}</Card>
      <Card title="Registro delle decisioni" icon="clock" flush>{x.registro.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Cliente</th><th>Decisione</th><th>Motivo</th><th>Chi</th></tr></thead>
        <tbody>{x.registro.map((l) => <tr key={l.id}><td className="small nowrap">{itDataOra(l.at)}</td><td><LinkCliente id={l.organization_id}>{l.cliente}</LinkCliente></td><td><Badge tone={l.azione === 'ESCLUSO' ? 'grey' : 'green'}>{l.azione === 'ESCLUSO' ? `Escluso${l.fino ? ` fino al ${itData(l.fino)}` : ''}` : 'Riammesso'}</Badge></td><td className="small">{l.motivo}</td><td className="small">{l.utente || 'automatico'}</td></tr>)}</tbody></table></div> : <Empty compact icon="clock">Nessuna decisione registrata</Empty>}</Card>
    </div>
  );
}
