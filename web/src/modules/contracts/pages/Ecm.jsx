// Formazione ed ECM (v0.77.0): quadro dei crediti ECM delle professioni sanitarie nel triennio in corso.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge, Kpi, useToast } from '../components/ui.jsx';
import { useAuth, canWrite } from '../auth.jsx';

const n1 = (v) => Number(v || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 });

export default function Ecm() {
  const toast = useToast();
  const { user } = useAuth();
  const writer = canWrite(user);
  const d = useApi('/formazione/ecm');
  const [q, setQ] = useState('');
  const [solo, setSolo] = useState('');
  const righe = useMemo(() => (d.data?.righe || []).filter((x) => (!q || `${x.nome} ${x.professione || ''}`.toLowerCase().includes(q.toLowerCase())) && (solo === 'indietro' ? x.mancano_anno > 0 : solo === 'attivare' ? !x.attivata : true)), [d.data, q, solo]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { regole, totali } = d.data;
  const daAttivare = d.data.righe.filter((x) => !x.attivata);
  const attiva = async (ids) => { try { const r = await api.post('/formazione/ecm/attiva', { ids }); toast(`${r.attivate} posizioni attivate: da ora generano scadenze e richiami`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Formazione ed ECM</h1><div className="sub">Crediti ECM delle professioni sanitarie nel triennio {regole.inizio}-{regole.fine}: obbligo di {n1(regole.obbligo)} crediti, obiettivo indicativo di {n1(regole.annuale)} l'anno. Gli attestati si caricano dalla scheda della persona, sezione Formazione ed ECM.</div></div>
        {writer && daAttivare.length > 0 && <button className="btn" onClick={() => attiva(daAttivare.map((x) => x.id))}>Attiva le {daAttivare.length} posizioni riconosciute</button>}
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Professioni sanitarie" value={totali.persone} foot="attive o in ingresso" />
        <Kpi label="In linea con l'obiettivo dell'anno" value={totali.in_regola} accent bar={totali.persone ? totali.in_regola / totali.persone * 100 : 0} />
        <Kpi label="Crediti ancora da acquisire" value={n1(d.data.righe.reduce((a, x) => a + x.residuo, 0))} foot={`entro il 31/12/${regole.fine}`} />
        <Kpi label="Posizioni da attivare" value={totali.da_attivare} foot="riconosciute in automatico: nessuna scadenza finché non le attivi" />
      </div>
      <div className="filters">
        <Field label="Mostra"><select value={solo} onChange={(e) => setSolo(e.target.value)}><option value="">Tutti</option><option value="indietro">Sotto l'obiettivo dell'anno</option><option value="attivare">Posizioni da attivare</option></select></Field>
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Persona o professione" /></Field>
      </div>
      <Card title={`Contatori · ${righe.length}`} flush>
        {!righe.length ? <Empty>Nessuna professione sanitaria{d.data.righe.length ? ' con questi filtri' : ': il riconoscimento usa tipo di persona, mansione e disciplina; la posizione si imposta anche a mano dalla scheda'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Persona</th><th>Professione</th>{[0, 1, 2].map((i) => <th key={i} className="num">{regole.inizio + i}</th>)}<th className="num">Acquisiti</th><th className="num">Dovuti</th><th className="num">Mancano</th><th>Obiettivo dell'anno</th><th /></tr></thead>
            <tbody>{righe.map((x) => (
              <tr key={x.id}>
                <td className="strong"><Link to={`${BASE}/risorse/${x.id}?tab=formazione`}>{x.nome}</Link> <KindBadge kind={x.kind} /></td>
                <td>{x.professione || '–'}{x.automatico && <div className="small muted">riconosciuta in automatico</div>}</td>
                {x.anni.map((a) => <td key={a.anno} className="num">{a.crediti ? n1(a.crediti) : '–'}</td>)}
                <td className="num strong">{n1(x.acquisiti)}</td><td className="num">{n1(x.dovuti)}{x.riduzione > 0 && <div className="small muted">riduzione {n1(x.riduzione)}</div>}</td>
                <td className="num strong">{n1(x.residuo)}</td>
                <td>{x.completato ? <Badge tone="green">triennio completato</Badge> : x.mancano_anno > 0 ? <Badge tone="red">mancano {n1(x.mancano_anno)}</Badge> : <Badge tone="green">in linea</Badge>}</td>
                <td className="num">{!x.attivata && (writer ? <button className="btn sm ghost" onClick={() => attiva([x.id])}>Attiva</button> : <Badge>da attivare</Badge>)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
