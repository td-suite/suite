import React from 'react';
import { base } from '../paths.js';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, canManage, isSigner } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge, TierBadge } from '../components/ui.jsx';
import { HBars, Donut, Legend, C } from '../components/charts.jsx';
import { eur, itDate, itDateTime, hours, TIER, ROLE_SIGNER } from '../format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const s = useApi('/stats/summary');
  const d = s.data;
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const c = d.counts;
  const tierRows = ['SINGOLA', 'CONGIUNTA', 'CDA'].map((t) => { const x = d.by_tier.find((y) => y.tier === t) || { n: 0, amount: 0 }; return { label: TIER[t].label, key: t, n: x.n, amount: Number(x.amount) }; });
  const months = [...new Set(d.monthly.map((m) => m.month))];
  const monthRows = months.map((m) => ({ label: m.split('-').reverse().join('/'), SINGOLA: 0, CONGIUNTA: 0, CDA: 0, ...Object.fromEntries(d.monthly.filter((x) => x.month === m).map((x) => [x.tier, Number(x.amount)])) }));
  const signedOf = (p) => (p.signed_roles || []);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno, {user.full_name.split(' ')[0]}</h1>
          <div className="sub">Autorizzazioni al pagamento {d.year}: soglie {eur(d.thresholds.single)} (firma singola) e {eur(d.thresholds.joint)} (delibera CdA). Clicca su un numero per aprire l'elenco.</div>
        </div>
        {canManage(user) && <Link className="btn" to={`${base}/istanze/nuova`}>+ Nuova istanza</Link>}
      </div>

      {isSigner(user) && d.mine.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <b>{d.mine.length === 1 ? 'Una istanza attende la tua firma' : `${d.mine.length} istanze attendono la tua firma`}.</b> La firma si appone dal link personale ricevuto via email da amministrazione@toscanadiagnostica.it. Se non lo trovi, Finance Support può reinviarlo dalla scheda dell'istanza.
        </div>
      )}
      {d.aggregation_alerts.length > 0 && (
        <div className="alert err" style={{ marginBottom: 16, flexDirection: 'column', gap: 4 }}>
          <b>Controllo anti-frazionamento</b>
          {d.aggregation_alerts.map((a) => <div key={a.id}><Link to={`${base}/istanze/${a.id}`}>{a.protocol}</Link> · {a.beneficiary_name} · {eur(a.amount)}: {a.warning}</div>)}
        </div>
      )}

      <div className="grid g4">
        <div onClick={() => nav(`${base}/istanze?status=IN_FIRMA`)} style={{ cursor: 'pointer' }}><Kpi accent label="In attesa di firma" value={c.in_signature.n} foot={eur(c.in_signature.amount)} /></div>
        <div onClick={() => nav(`${base}/istanze?status=FIRMATA`)} style={{ cursor: 'pointer' }}><Kpi label="Autorizzate da eseguire" value={c.signed.n} foot={eur(c.signed.amount)} /></div>
        <div onClick={() => nav(`${base}/istanze?status=RIFIUTATA,BOZZA`)} style={{ cursor: 'pointer' }}><Kpi label="Bozze e rifiutate" value={c.draft.n + c.rejected.n} foot={`${c.draft.n} bozze · ${c.rejected.n} rifiutate da correggere`} /></div>
        <div onClick={() => nav(`${base}/archivio`)} style={{ cursor: 'pointer' }}><Kpi label={`Eseguite nel ${d.year}`} value={d.executed_ytd.n} foot={eur(d.executed_ytd.amount)} /></div>
      </div>
      <div className="grid g4" style={{ marginTop: 16 }}>
        <Kpi accent label={`Autorizzato nel ${d.year}`} value={eur(d.ytd.amount)} foot={`${d.ytd.n} istanze autorizzate o eseguite`} />
        {tierRows.map((t) => <div key={t.key} onClick={() => nav(`${base}/istanze?tier=${t.key}`)} style={{ cursor: 'pointer' }}><Kpi label={t.label} value={t.n} foot={eur(t.amount)} /></div>)}
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="In attesa di firma" flush actions={<span className="small muted">tempo medio di autorizzazione {hours(d.timing?.avg_hours)}</span>}>
          {d.pending.length ? (
            <div className="table-wrap" style={{ maxHeight: 340 }}><table className="t">
              <thead><tr><th>Protocollo</th><th>Beneficiario</th><th className="num">Importo</th><th>Firme</th><th className="num">Attesa</th></tr></thead>
              <tbody>{d.pending.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`${base}/istanze/${p.id}`)}>
                  <td className="mono">{p.protocol}</td><td>{p.beneficiary_name}</td><td className="num">{eur(p.amount)}</td>
                  <td>{(p.tier === 'SINGOLA' ? [p.single_signer] : ['CEO', 'CFO']).map((r) => <Badge key={r} tone={signedOf(p).includes(r) ? 'green' : 'grey'}>{r}</Badge>)}</td>
                  <td className="num"><Badge tone={p.hours_waiting > 72 ? 'red' : p.hours_waiting > 24 ? 'mauve' : 'blue'}>{hours(p.hours_waiting)}</Badge></td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Nessuna istanza in attesa di firma</Empty>}
        </Card>
        <Card title="Autorizzate, da eseguire in banca" flush>
          {d.to_execute.length ? (
            <div className="table-wrap" style={{ maxHeight: 340 }}><table className="t">
              <thead><tr><th>Protocollo</th><th>Beneficiario</th><th className="num">Importo</th><th>Firmata il</th><th>Valuta</th></tr></thead>
              <tbody>{d.to_execute.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`${base}/istanze/${p.id}`)}>
                  <td className="mono">{p.protocol}</td><td>{p.beneficiary_name}</td><td className="num">{eur(p.amount)}</td><td className="small">{itDateTime(p.signed_at)}</td><td className="small">{p.value_date ? itDate(p.value_date) : '–'}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty>Nessun pagamento in attesa di esecuzione</Empty>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Importi per mese e scaglione" actions={<span className="small muted">ultimi 12 mesi</span>}>
          {monthRows.length ? <HBars data={monthRows} money keys={[{ key: 'SINGOLA', label: 'Firma singola', color: C.blue }, { key: 'CONGIUNTA', label: 'Congiunta', color: C.teal }, { key: 'CDA', label: 'Delibera CdA', color: '#8a5aa8' }]} /> : <Empty>Nessun dato</Empty>}
          <Legend items={[{ label: 'Firma singola', color: C.blue }, { label: 'Congiunta AD + CFO', color: C.teal }, { label: 'Delibera CdA', color: '#8a5aa8' }]} />
        </Card>
        <Card title={`Principali beneficiari ${d.year}`}>
          {d.top_beneficiaries.length ? <HBars data={d.top_beneficiaries.map((b) => ({ label: b.label, amount: Number(b.amount) }))} money keys={[{ key: 'amount', label: 'Autorizzato', color: C.teal }]} /> : <Empty>Nessun dato</Empty>}
        </Card>
      </div>
    </div>
  );
}
