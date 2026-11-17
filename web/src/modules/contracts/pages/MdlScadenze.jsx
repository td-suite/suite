// Scadenze di medicina del lavoro in sola lettura (v0.79.0): è la pagina del profilo MDL, pensato per il responsabile HQS. Mostra chi è
// soggetto a sorveglianza, l'ultima visita, la prossima dovuta e l'eventuale visita già fissata. Non mostra giudizi né prescrizioni.
import React, { useMemo, useState } from 'react';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge, Kpi } from '../components/ui.jsx';
import { MDL_STATO } from '../components/Sviluppo.jsx';
import { itDate } from '../format.js';

export default function MdlScadenze() {
  const d = useApi('/mdl/scadenze');
  const [filtro, setFiltro] = useState('scadenza');
  const [q, setQ] = useState('');
  const ant = d.data?.anticipo_giorni || 60;
  const righe = useMemo(() => (d.data?.righe || []).filter((x) => {
    if (q && !`${x.nome} ${x.mansione || ''} ${x.sede || ''} ${x.area || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'scadenza') return x.sorveglianza && x.impostata && x.giorni != null && x.giorni <= ant;
    if (filtro === 'scadute') return x.sorveglianza && x.impostata && x.giorni != null && x.giorni < 0;
    if (filtro === 'impostare') return x.stato === 'DA_IMPOSTARE';
    return true;
  }).sort((a, b) => (a.giorni ?? 99999) - (b.giorni ?? 99999) || a.nome.localeCompare(b.nome, 'it')), [d.data, filtro, q, ant]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const tutte = d.data.righe; const sogg = tutte.filter((x) => x.sorveglianza);
  const inScad = sogg.filter((x) => x.impostata && x.giorni != null && x.giorni <= ant);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Scadenze di medicina del lavoro</h1><div className="sub">Sorveglianza sanitaria di dipendenti e tirocinanti: ultima visita, prossima visita dovuta, visite già fissate. Sola consultazione: giudizi di idoneità e prescrizioni restano all'ufficio People e al medico competente.</div></div>
        <button className="btn ghost no-print" onClick={() => window.print()}>Stampa</button></div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Soggetti a sorveglianza" value={sogg.length} foot={`${tutte.length - sogg.length} non soggetti`} />
        <Kpi label={`In scadenza entro ${ant} giorni`} value={inScad.length} accent foot={`${inScad.filter((x) => !x.fissata).length} senza visita fissata`} />
        <Kpi label="Scadute o mai fatte" value={inScad.filter((x) => x.giorni < 0).length} foot="visita periodica oltre il termine o preventiva non fatta" />
        <Kpi label="Posizioni da impostare" value={tutte.filter((x) => x.stato === 'DA_IMPOSTARE').length} foot="l'ufficio People non ha ancora aperto la scheda" />
      </div>
      <div className="filters no-print">
        <Field label="Mostra"><select value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="scadenza">In scadenza entro {ant} giorni</option><option value="scadute">Solo scadute o mai fatte</option><option value="tutti">Tutto il personale</option><option value="impostare">Posizioni da impostare</option></select></Field>
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Persona, mansione, sede" /></Field>
      </div>
      <Card title={`Personale · ${righe.length}`} flush>
        {!righe.length ? <Empty>{filtro === 'scadenza' ? `Nessuna visita in scadenza entro ${ant} giorni` : 'Nessuna persona'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Persona</th><th>Mansione</th><th>Sede e area</th><th>Ultima visita</th><th>Prossima visita</th><th>Stato</th><th>Visita fissata</th></tr></thead>
            <tbody>{righe.map((x) => { const st = MDL_STATO[x.stato] || MDL_STATO.DA_IMPOSTARE; return (
              <tr key={x.id}>
                <td className="strong">{x.nome} <KindBadge kind={x.kind} /></td>
                <td>{x.mansione || '–'}{x.protocollo && <div className="small muted">protocollo {x.protocollo}</div>}</td>
                <td>{x.sede || '–'}<div className="small muted">{x.area}</div></td>
                <td>{x.ultima_visita ? itDate(x.ultima_visita) : <span className="muted">–</span>}</td>
                <td>{x.sorveglianza && x.impostata && x.prossima ? <><span className="strong">{itDate(x.prossima)}</span><div className="small muted">{x.giorni < 0 ? `da ${-x.giorni} giorni` : `tra ${x.giorni} giorni`} · {String(x.motivo || '').toLowerCase()}</div></> : <span className="muted">–</span>}</td>
                <td><Badge tone={st.tone}>{st.label}</Badge></td>
                <td>{x.fissata ? <><span className="strong">{itDate(x.fissata.data)}</span>{x.fissata.ora ? ` ore ${x.fissata.ora}` : ''}<div className="small muted">{[x.fissata.stato === 'CONVOCATA' ? 'convocata' : 'programmata', x.fissata.luogo].filter(Boolean).join(' · ')}</div></> : <span className="muted">–</span>}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
