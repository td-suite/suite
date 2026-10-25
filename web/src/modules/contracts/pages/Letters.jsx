import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { qs, BASE } from '../api.js';
import { useAuth, canWrite, seesCosts } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge } from '../components/ui.jsx';
import { eur, itDate, LETTER_STATUS, LEVEL_LABEL } from '../format.js';

export default function Letters() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('BOZZA,INVIATA,ACCETTATA');
  const list = useApi(`/scouting/letters${qs({ status })}`);
  const costs = seesCosts(user);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Elenco lettere di impegno</h1><div className="sub">Proposte di assunzione emesse: cliccabili per modificare, rigenerare, cambiare stato o convertire in assunzione.</div></div>
        {canWrite(user) && <Link className="btn" to={`${BASE}/scouting/lettere/nuova`}>+ Nuova lettera di impegno</Link>}
      </div>
      <div className="filters">
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="BOZZA,INVIATA,ACCETTATA">Aperte (bozza, inviate, accettate)</option><option value="ACCETTATA">Accettate da convertire</option><option value="CONVERTITA">Convertite in assunzione</option><option value="RIFIUTATA,SCADUTA">Rifiutate o scadute</option><option value="">Tutte</option></select></Field>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>
        {!list.data ? <Loading /> : !list.data.length ? <Empty>Nessuna lettera di impegno</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data</th><th>Persona</th><th>Proposta</th>{costs && <th className="num">RAL</th>}<th>Decorrenza max</th><th>Validità</th><th>Stato</th><th className="num">Doc</th></tr></thead>
            <tbody>{list.data.map((l) => (
              <tr key={l.id} className="click" onClick={() => nav(`${BASE}/scouting/lettere/${l.id}`)}>
                <td>{itDate(l.letter_date)}</td>
                <td><div className="strong">{l.last_name} {l.first_name}</div><div className="small muted">{l.area_name || ''}</div></td>
                <td>{l.job_title}<div className="small muted">{LEVEL_LABEL[l.level] || l.level}</div></td>
                {costs && <td className="num">{eur(l.ral)}{(l.ral_steps || []).length ? <div className="small muted">+{l.ral_steps.length} scatti</div> : null}</td>}
                <td>{itDate(l.start_by)}</td><td>{itDate(l.valid_until)}</td>
                <td><Badge tone={LETTER_STATUS[l.status]?.tone}>{LETTER_STATUS[l.status]?.label}</Badge></td>
                <td className="num">{l.documents_count ? <Badge tone="teal">{l.documents_count}</Badge> : <span className="muted">–</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
