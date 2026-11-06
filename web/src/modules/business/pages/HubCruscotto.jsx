// Business Hub · Cruscotto: funnel per fase (conteggi e fatturato FY atteso), stalli, prossime azioni, attività degli ultimi 7 giorni,
// criticità aperte, NC aperte e ordini in attesa di risposta sui clienti attivi, clienti da confermare dal CEO, email da assegnare.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { itDate, itDateTime, FASI, LINEE, eurK, TIPO_ATTIVITA, GRAVITA, ORIGINE_CRITICITA, NC_STATO, EMAIL_STATO } from '../format.js';

export default function HubCruscotto() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [linea, setLinea] = useState('');
  const s = useApi(`/hub/cruscotto${linea ? `?linea=${linea}` : ''}`);
  const d = s.data;
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const maxN = Math.max(1, ...d.funnel.filter((f) => f.fase > 0).map((f) => f.n));
  const apri = (id) => nav(`${BASE}/account/${id}`);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Business Hub</h1>
          <div className="sub">Buongiorno, {user.first_name || user.full_name}. La centrale del business di Toscana Diagnostica: pipeline per fasi, contatti, criticità, ordini e non conformità dei clienti. I contratti e le autorizzazioni sono un "di cui" del percorso.</div>
        </div>
        <div className="seg">{[['', 'Tutte le linee'], ...Object.entries(LINEE).map(([k, v]) => [k, v.short])].map(([k, l]) => <label key={k} className={linea === k ? 'on' : ''}><input type="radio" checked={linea === k} onChange={() => setLinea(k)} />{l}</label>)}</div>
      </div>

      <div className="grid g5">
        <div className="click-card" onClick={() => nav(`${BASE}/pipeline`)}><Kpi accent label="In pipeline (fasi 1-6)" value={d.kpi.in_pipeline} foot={`${eurK(d.kpi.fatturato_pipeline)} di fatturato FY atteso`} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?attivo=1`)}><Kpi label="Clienti attivi (confermati dal CEO)" value={d.kpi.attivi} foot={d.kpi.da_confermare ? `${d.kpi.da_confermare} da confermare` : 'nessuno in attesa di conferma'} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?fase=0`)}><Kpi label="Prospect censiti" value={d.kpi.prospect} foot={`${d.kpi.account} account in tutto`} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?stallo=1`)}><Kpi label={`In stallo (> ${d.soglia_stallo} gg)`} value={d.kpi.stalli} foot="nessun avanzamento di fase" /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/email`)}><Kpi label="Email da assegnare" value={d.kpi.email_da_assegnare} foot={`${d.kpi.criticita} criticità aperte`} /></div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Funnel per fase" actions={<Link className="btn sm ghost" to={`${BASE}/pipeline`}>Apri la pipeline</Link>}>
          <div className="funnel">
            {d.funnel.map((f) => (
              <div key={f.fase} className="frow click" onClick={() => nav(`${BASE}/clienti?fase=${f.fase}`)}>
                <div className="fl">{FASI[f.fase].short}</div>
                <div className="fb"><i style={{ width: `${f.fase === 0 ? 100 : f.n ? Math.max(2, (f.n / maxN) * 100) : 0}%` }} className={`t-${FASI[f.fase].tone}`} /></div>
                <div className="fn num">{f.n}</div>
                <div className="fe num">{f.fatturato ? eurK(f.fatturato) : ''}</div>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Fatturato = "Fatturato FY atteso" degli account in quella fase. La fase 7 conta solo i clienti attivi confermati.</div>
        </Card>
        <Card title="Clienti da confermare dal CEO" flush>
          {d.da_confermare.length ? <div className="table-wrap" style={{ maxHeight: 330 }}><table className="t"><tbody>
            {d.da_confermare.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.id)}><td><div className="strong">{x.org_name}</div><div className="small muted clamp2">{x.testo}</div></td><td><Badge tone={LINEE[x.linea]?.tone}>{LINEE[x.linea]?.short}</Badge></td></tr>)}
          </tbody></table></div> : <Empty>Nessun cliente in attesa di conferma</Empty>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={`Stalli (oltre ${d.soglia_stallo} giorni dall'ultimo avanzamento)`} flush>
          {d.stalli.length ? <div className="table-wrap" style={{ maxHeight: 330 }}><table className="t"><thead><tr><th>Account</th><th>Fase</th><th className="num">Giorni</th><th>Owner</th></tr></thead><tbody>
            {d.stalli.map((a) => <tr key={a.id} className="click" onClick={() => apri(a.id)}><td className="strong">{a.org_name}</td><td><Badge tone={FASI[a.fase_corrente].tone}>{FASI[a.fase_corrente].short}</Badge></td><td className="num red">{a.giorni_da_avanzamento}</td><td className="small">{a.owner_name || <span className="muted">da assegnare</span>}</td></tr>)}
          </tbody></table></div> : <Empty>Nessun account in stallo</Empty>}
        </Card>
        <Card title="Prossime azioni (scadute e nei prossimi 7 giorni)" flush>
          {d.prossime.length ? <div className="table-wrap" style={{ maxHeight: 330 }}><table className="t"><thead><tr><th>Data</th><th>Account</th><th>Azione</th></tr></thead><tbody>
            {d.prossime.map((a) => <tr key={a.id} className="click" onClick={() => apri(a.id)}><td className={a.scaduta ? 'red strong' : ''} style={{ whiteSpace: 'nowrap' }}>{itDate(a.data_prossima_azione)}</td><td className="strong">{a.org_name}</td><td className="small">{a.prossima_azione || '–'}{a.owner_name ? <span className="muted"> · {a.owner_name}</span> : ''}</td></tr>)}
          </tbody></table></div> : <Empty>Nessuna azione in scadenza</Empty>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Non conformità aperte sui clienti attivi" flush>
          {!d.nc.attivo ? <Empty>Widget NC non attivo</Empty> : d.nc.righe.length ? <div className="table-wrap" style={{ maxHeight: 300 }}><table className="t"><thead><tr><th>NC</th><th>Cliente</th><th>Gravità</th><th>Stato</th><th>Aperta</th></tr></thead><tbody>
            {d.nc.righe.map((n) => <tr key={n.id} className="click" onClick={() => n.account ? apri(n.account.id) : window.open(`/nc/nc/${n.id}`, '_self')}><td className="mono">{n.codice}</td><td className="strong">{n.account?.org_name || '–'}</td><td>{n.gravita}</td><td className="small">{NC_STATO[n.stato] || n.stato}</td><td className="small">{itDate(n.opened_at)}</td></tr>)}
          </tbody></table></div> : <Empty>Nessuna NC aperta sui clienti attivi</Empty>}
        </Card>
        <Card title={`Ordini dei clienti attivi in attesa di risposta (soglia ${d.ordini.soglia_giorni} gg)`} flush>
          {!d.ordini.attivo ? <Empty>Widget Ordini non attivo</Empty> : d.ordini.righe.length ? <div className="table-wrap" style={{ maxHeight: 300 }}><table className="t"><thead><tr><th>Ordine</th><th>Cliente</th><th>Inviato</th><th className="num">Attesa</th></tr></thead><tbody>
            {d.ordini.righe.map((o) => <tr key={o.id} className="click" onClick={() => o.account && apri(o.account.id)}><td className="mono">{o.number}{o.urgent ? <Badge tone="red">urgente</Badge> : null}</td><td className="strong">{o.account?.org_name || '–'}</td><td className="small">{itDateTime(o.submitted_at)}</td><td className={`num ${o.oltre_soglia ? 'red strong' : ''}`}>{o.giorni} gg</td></tr>)}
          </tbody></table></div> : <Empty>Nessun ordine in attesa</Empty>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Attività degli ultimi 7 giorni" flush>
          {d.attivita.length ? <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t"><tbody>
            {d.attivita.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.account_id)}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itDateTime(x.at)}</td><td><Badge tone={x.tipo === 'SISTEMA' ? 'grey' : x.tipo === 'CRITICITA' ? 'red' : x.tipo.startsWith('EMAIL') ? 'teal' : 'blue'}>{TIPO_ATTIVITA[x.tipo]}</Badge></td><td><div className="strong">{x.org_name}</div><div className="small muted">{x.oggetto}{x.email_stato ? ` · ${EMAIL_STATO[x.email_stato]?.label}` : ''}{x.user_name ? ` · ${x.user_name}` : ''}</div></td></tr>)}
          </tbody></table></div> : <Empty>Nessuna attività registrata negli ultimi 7 giorni</Empty>}
        </Card>
        <Card title="Criticità aperte" flush>
          {d.criticita.length ? <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t"><tbody>
            {d.criticita.map((k) => <tr key={k.id} className="click" onClick={() => apri(k.account_id)}><td><Badge tone={GRAVITA[k.gravita].tone}>{GRAVITA[k.gravita].label}</Badge></td><td><div className="strong">{k.org_name}</div><div className="small muted">{ORIGINE_CRITICITA[k.origine]} · {k.titolo || k.descrizione.slice(0, 90)}</div></td><td className="small muted">{itDate(k.aperta_at)}</td></tr>)}
          </tbody></table></div> : <Empty>Nessuna criticità aperta</Empty>}
        </Card>
      </div>

      {d.email.length > 0 && <Card title="Email da assegnare" className="mt" actions={<Link className="btn sm ghost" to={`${BASE}/email`}>Assegna</Link>} flush>
        <table className="t"><tbody>{d.email.map((m) => <tr key={m.id} className="click" onClick={() => nav(`${BASE}/email`)}><td><Badge tone={LINEE[m.linea]?.tone}>{LINEE[m.linea]?.short}</Badge></td><td className="small">{itDateTime(m.received_at)}</td><td><div className="strong">{m.from_name || m.from_email}</div><div className="small muted">{m.subject}</div></td><td className="small muted">{m.come}</td></tr>)}</tbody></table>
      </Card>}
    </div>
  );
}
