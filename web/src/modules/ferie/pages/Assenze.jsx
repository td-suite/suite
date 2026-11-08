// Oggi assenti e prossimi 14 giorni nelle aree visibili (la propria per i dipendenti, quelle che approvano per i responsabili, tutte per HR)
import React, { useState } from 'react';
import { qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoBadge } from '../components.jsx';
import { itData, periodo, quantita, addDays, giorniTra, weekday, quotaInData, GG } from '../format.js';

export default function Assenze() {
  const [gruppo, setGruppo] = useState('');
  const g = useApi('/gruppi');
  const { data, loading, error } = useApi(`/assenze${qs({ giorni: 14, gruppo })}`, [gruppo]);
  const giorni = data ? giorniTra(data.oggi, addDays(data.oggi, 13)) : [];
  return (
    <div className="page">
      <PageHead title="Oggi e prossimi 14 giorni" icon="users" sub="Chi è assente oggi e chi lo sarà nelle prossime due settimane, nelle aree che puoi vedere." />
      <div className="filters"><Field label="Area"><select value={gruppo} onChange={(e) => setGruppo(e.target.value)}><option value="">Tutte quelle visibili</option>{(g.data?.gruppi || []).map((x) => <option key={x.key} value={x.key}>{x.area === 'Sedi' ? `Sede ${x.nome}` : x.nome}</option>)}</select></Field></div>
      {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data ? <Loading /> : (
        <>
          <Card title={`Oggi assenti (${data.oggi_assenti.length})`} icon="user">
            {!data.oggi_assenti.length ? <div className="small muted">Oggi nessuno è in ferie nelle aree visibili.</div>
              : <div className="fe-chips">{data.oggi_assenti.map((x) => <div key={x.id} className="fe-chip"><div className="strong">{x.persona}</div><div className="small muted">{x.gruppo_nome}{x.ruolo ? ` · ${x.ruolo}` : ''}</div><div className="small">rientra dopo il {itData(x.data_fine)}</div></div>)}</div>}
          </Card>
          <Card title="Prossimi 14 giorni" icon="calendar" flush>
            {!data.prossimi.length ? <Empty icon="calendar" title="Nessuna assenza in programma" compact /> : (
              <div className="table-wrap"><table className="t fe-table">
                <thead><tr><th>Persona</th><th>Area</th><th>Periodo</th><th className="num">Quantità</th><th>Stato</th><th className="fe-mini-h">{giorni.map((d) => <span key={d} className={weekday(d) >= 6 ? 'we' : ''} title={itData(d)}>{GG[weekday(d)]}</span>)}</th></tr></thead>
                <tbody>{data.prossimi.map((x) => (
                  <tr key={x.id}><td className="strong">{x.persona}<div className="small muted">{x.ruolo}</div></td><td className="small">{x.gruppo_nome}</td><td style={{ whiteSpace: 'nowrap' }}>{periodo(x)}</td><td className="num">{quantita(x)}</td><td><StatoBadge stato={x.stato} /></td>
                    <td className="fe-mini">{giorni.map((d) => { const q = quotaInData(x, d); return <span key={d} className={`${q ? (x.stato === 'RICHIESTA' ? 'att' : q < 1 ? 'half' : 'fer') : ''} ${weekday(d) >= 6 ? 'we' : ''}`} title={itData(d)} />; })}</td></tr>))}</tbody>
              </table></div>)}
          </Card>
        </>
      )}
      {loading && data && <div className="small muted">Aggiornamento…</div>}
    </div>
  );
}
