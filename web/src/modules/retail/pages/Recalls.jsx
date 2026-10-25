import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, Kpi } from '../components/ui.jsx';
import { SiteSelect } from '../components/filters.jsx';
import { qs, base } from '../api.js';
import { num, itDate } from '../format.js';

export default function Recalls() {
  const nav = useNavigate();
  const [days, setDays] = useState('30');
  const [site, setSite] = useState('');
  const [consent, setConsent] = useState(false);
  const d = useApi(`/stats/recalls${qs({ days, site_id: site })}`);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (d.data || []).filter((r) => !consent || r.marketing_consent);
  const overdue = rows.filter((r) => r.due < today).length;
  const copyList = () => { const t = rows.map((r) => [r.last_name, r.first_name, r.phone || '', r.email || '', r.description, itDate(r.due)].join('\t')).join('\n'); navigator.clipboard?.writeText(`Cognome\tNome\tTelefono\tEmail\tEsame\tScadenza\n${t}`); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Richiami periodici</h1><div className="sub">Pazienti con esami a periodicità (mammografia, PSA, check-up, controlli annuali) in scadenza: la lista operativa per SMS, telefono e script di accettazione. La periodicità si imposta sulla scheda della prestazione.</div></div>
        <div className="row"><button className="btn ghost" onClick={copyList} disabled={!rows.length}>Copia lista</button></div>
      </div>
      <div className="filters">
        <Field label="Entro"><select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 giorni</option><option value="30">30 giorni</option><option value="60">60 giorni</option><option value="90">90 giorni</option></select></Field>
        <SiteSelect value={site} onChange={setSite} label="Sede di riferimento" />
        <Field label="Consenso" className="inline" style={{ alignSelf: 'center' }}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> solo con consenso marketing</Field>
      </div>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi accent label="Richiami in lista" value={num(rows.length)} foot={`${num(overdue)} già oltre la scadenza`} />
        <Kpi label="Con consenso marketing" value={num((d.data || []).filter((r) => r.marketing_consent).length)} foot="contattabili con SMS ed email" />
        <Kpi label="Con telefono" value={num(rows.filter((r) => r.phone).length)} foot="per il richiamo telefonico" />
      </div>
      <ErrorBox error={d.error} />
      <Card flush>
        {!d.data ? <Loading /> : !rows.length ? <Empty>Nessun richiamo nel periodo</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Paziente</th><th>Contatti</th><th>Sede</th><th>Esame</th><th>Ultima volta</th><th>Scadenza</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="click" onClick={() => nav(`${base}/clienti/${r.customer_id}`)}><td className="strong">{r.last_name} {r.first_name}</td><td className="small">{r.phone || '–'}<div className="muted">{r.email || ''}</div></td><td className="small">{r.site_name || '–'}</td><td>{r.description}<div className="small muted">{r.code}</div></td><td>{itDate(r.last_date)}</td><td>{itDate(r.due)}</td><td className="num">{r.due < today ? <Badge tone="red">scaduto</Badge> : <Badge tone="mauve">in scadenza</Badge>}{!r.marketing_consent && <span className="small muted"> · no consenso</span>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
