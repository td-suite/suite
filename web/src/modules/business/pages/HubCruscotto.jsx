// Business Hub · Cruscotto: funnel per fase (conteggi e fatturato FY atteso), stalli, prossime azioni, attività degli ultimi 7 giorni,
// criticità aperte, NC aperte e ordini in attesa di risposta sui clienti attivi, clienti da confermare dal CEO, email da assegnare.
// Punti Prelievo (06/11/2026): avvii con passi da completare (con "Riprova") e flagship con l'autorizzazione rilasciata da avviare.
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge, useToast } from '../components/ui.jsx';
import { itDate, itDateTime, FASI, LINEE, eurK, TIPO_ATTIVITA, TONO_ATTIVITA, GRAVITA, ORIGINE_CRITICITA, NC_STATO, EMAIL_STATO, SOTTOTIPO, TIPO_PUNTO } from '../format.js';

export default function HubCruscotto() {
  const { user } = useAuth();
  const nav = useNavigate();
  // linea fissa dall'indirizzo (?linea=SRV|PP|MDL, una voce Cruscotto per sezione del menu; senza parametro = Service). Il CEO
  // (06/11/2026): nessuna vista "tutte le linee", ogni sezione vede solo la sua.
  const [sp] = useSearchParams();
  const linea = ['SRV', 'PP', 'MDL'].includes(sp.get('linea')) ? sp.get('linea') : 'SRV';
  const s = useApi(`/hub/cruscotto?linea=${linea}`);
  const d = s.data;
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const maxN = Math.max(1, ...d.funnel.filter((f) => f.fase > 0).map((f) => f.n));
  const apri = (id) => nav(`${BASE}/account/${id}`);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cruscotto · {LINEE[linea].label}</h1>
          <div className="sub">Buongiorno, {user.first_name || user.full_name}. La linea {LINEE[linea].label}: pipeline per fasi, contatti, criticità, ordini e non conformità. I contratti e le autorizzazioni sono un "di cui" del percorso.</div>
        </div>
      </div>

      <div className="grid g5">
        <div className="click-card" onClick={() => nav(`${BASE}/pipeline?linea=${linea}`)}><Kpi accent label="In pipeline (fasi 1-6)" value={d.kpi.in_pipeline} foot={`${eurK(d.kpi.fatturato_pipeline)} di fatturato FY atteso`} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?linea=${linea}&attivo=1`)}><Kpi label="Clienti attivi (confermati dal CEO)" value={d.kpi.attivi} foot={d.kpi.da_confermare ? `${d.kpi.da_confermare} da confermare` : 'nessuno in attesa di conferma'} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?linea=${linea}&fase=0`)}><Kpi label="Prospect censiti" value={d.kpi.prospect} foot={`${d.kpi.account} account in tutto`} /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/clienti?linea=${linea}&stallo=1`)}><Kpi label={`In stallo (> ${d.soglia_stallo} gg)`} value={d.kpi.stalli} foot="nessun avanzamento di fase" /></div>
        <div className="click-card" onClick={() => nav(`${BASE}/email?linea=${linea}`)}><Kpi label="Email da assegnare" value={d.kpi.email_da_assegnare} foot={`${d.kpi.criticita} criticità aperte`} /></div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Funnel per fase" actions={<Link className="btn sm ghost" to={`${BASE}/pipeline?linea=${linea}`}>Apri la pipeline</Link>}>
          <div className="funnel">
            {d.funnel.map((f) => (
              <div key={f.fase} className="frow click" onClick={() => nav(`${BASE}/clienti?linea=${linea}&fase=${f.fase}`)}>
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
            {d.attivita.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.account_id)}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itDateTime(x.at)}</td><td><Badge tone={TONO_ATTIVITA(x.tipo)}>{TIPO_ATTIVITA[x.tipo] || x.tipo}</Badge></td><td><div className="strong">{x.org_name}</div><div className="small muted">{x.oggetto}{x.email_stato ? ` · ${EMAIL_STATO[x.email_stato]?.label}` : ''}{x.user_name ? ` · ${x.user_name}` : ''}</div></td></tr>)}
          </tbody></table></div> : <Empty>Nessuna attività registrata negli ultimi 7 giorni</Empty>}
        </Card>
        <Card title="Criticità aperte" flush>
          {d.criticita.length ? <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t"><tbody>
            {d.criticita.map((k) => <tr key={k.id} className="click" onClick={() => apri(k.account_id)}><td><Badge tone={GRAVITA[k.gravita].tone}>{GRAVITA[k.gravita].label}</Badge></td><td><div className="strong">{k.org_name}</div><div className="small muted">{ORIGINE_CRITICITA[k.origine]} · {k.titolo || k.descrizione.slice(0, 90)}</div></td><td className="small muted">{itDate(k.aperta_at)}</td></tr>)}
          </tbody></table></div> : <Empty>Nessuna criticità aperta</Empty>}
        </Card>
      </div>

      {linea === 'SRV' && <Richiamo apri={apri} />}
      {d.pp && (d.pp.da_completare.length > 0 || d.pp.da_avviare.length > 0) && <AvvioPP pp={d.pp} apri={(id) => nav(`${BASE}/account/${id}?scheda=punto`)} onDone={s.reload} puo={canEditKind(user, 'PP')} />}

      {d.email.length > 0 && <Card title="Email da assegnare" className="mt" actions={<Link className="btn sm ghost" to={`${BASE}/email?linea=${linea}`}>Assegna</Link>} flush>
        <table className="t"><tbody>{d.email.map((m) => <tr key={m.id} className="click" onClick={() => nav(`${BASE}/email?linea=${linea}`)}><td><Badge tone={LINEE[m.linea]?.tone}>{LINEE[m.linea]?.short}</Badge></td><td className="small">{itDateTime(m.received_at)}</td><td><div className="strong">{m.from_name || m.from_email}</div><div className="small muted">{m.subject}</div></td><td className="small muted">{m.come}</td></tr>)}</tbody></table>
      </Card>}
    </div>
  );
}

// Punti Prelievo: passi dell'avvio da completare (non riusciti o in attesa della data o della sede) e flagship autorizzati da avviare
function AvvioPP({ pp, apri, onDone, puo }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const riprova = async (e, id) => { e.stopPropagation(); setBusy(id); try { const r = await api.post(`/hub/accounts/${id}/avvio/riprova`, {}); toast(`Riprova: ${r.riepilogo.fatti} passi su ${r.riepilogo.previsti} fatti`); onDone(); } catch (x) { toast(x.message, 'err'); } finally { setBusy(null); } };
  return (
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Card title={`Punti prelievo: passi dell'avvio da completare (${pp.da_completare.length})`} flush>
        {pp.da_completare.length ? <table className="t"><tbody>{pp.da_completare.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.id)}>
          <td><div className="strong">{x.nome}</div><div className="small muted">{x.da_completare.map((k) => SOTTOTIPO[k] || k).join(' · ')}</div></td>
          <td><Badge tone={TIPO_PUNTO[x.tipo]?.tone}>{TIPO_PUNTO[x.tipo]?.label}</Badge></td>
          <td className="small">{x.fatti}/{x.previsti}{x.falliti.length ? <div className="red">{x.falliti.length} non riusciti</div> : <div className="muted">in attesa</div>}</td>
          <td style={{ width: 1 }}>{puo && x.falliti.length > 0 && <button className="btn sm ghost" disabled={busy === x.id} onClick={(e) => riprova(e, x.id)}>{busy === x.id ? 'Riprovo…' : 'Riprova'}</button>}</td>
        </tr>)}</tbody></table> : <Empty>Nessun avvio da completare</Empty>}
      </Card>
      <Card title={`Flagship autorizzati da avviare (${pp.da_avviare.length})`} flush>
        {pp.da_avviare.length ? <table className="t"><tbody>{pp.da_avviare.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.id)}>
          <td><div className="strong">{x.nome}</div><div className="small muted">autorizzazione rilasciata{x.autorizzato_il ? ` il ${itDate(x.autorizzato_il)}` : ''}{x.data_avvio ? ` · avvio ${itDate(x.data_avvio)}` : ''}</div></td>
          <td className="small">"Avvia il punto prelievi" nella scheda</td>
        </tr>)}</tbody></table> : <Empty>Nessun flagship in attesa di avvio</Empty>}
      </Card>
    </div>
  );
}

// Richiamo periodico dei prospect Service (processo Service, 06/11/2026): chi riceverebbe il richiamo oggi, con l'interruttore e il limite
function Richiamo({ apri }) {
  const r = useApi('/hub/richiamo/anteprima');
  const d = r.data;
  if (!d) return null;
  return (
    <Card title={`Richiamo dei prospect · chi lo riceverebbe oggi (${d.oggi.length})`} className="mt" flush
      actions={<span className="small">{d.attivo ? <Badge tone="green">acceso</Badge> : <Badge tone="grey">spento (Impostazioni)</Badge>} ogni {d.giorni} giorni · massimo {d.limite} al giorno{d.gia_oggi ? ` (già ${d.gia_oggi} oggi)` : ''}{d.ultimo_giorno ? ` · ultima esecuzione ${itDate(d.ultimo_giorno)}` : ''}</span>}>
      {d.oggi.length ? <div className="table-wrap" style={{ maxHeight: 320 }}><table className="t"><thead><tr><th>Prospect</th><th>Fase</th><th>Destinatario</th><th>Ultimo richiamo</th></tr></thead><tbody>
        {d.oggi.map((x) => <tr key={x.id} className="click" onClick={() => apri(x.id)}><td className="strong">{x.org_name}{x.priorita ? <span className="small muted"> · priorità {x.priorita.toLowerCase()}</span> : null}</td><td><Badge tone={FASI[x.fase_corrente].tone}>{FASI[x.fase_corrente].short}</Badge></td><td className="small">{x.contatto ? `${x.contatto} · ` : ''}{x.email}</td><td className="small">{x.ultimo_richiamo_at ? itDate(x.ultimo_richiamo_at) : 'mai'}</td></tr>)}
      </tbody></table></div> : <Empty>Nessun prospect da richiamare oggi</Empty>}
      <div className="small muted" style={{ padding: '8px 14px' }}>Da {d.casella} con le copie fisse e il pacchetto di presentazione. In coda per i prossimi giorni: {d.in_coda}. Esclusi: {Object.entries(d.esclusi).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nessuno'}.</div>
    </Card>
  );
}
