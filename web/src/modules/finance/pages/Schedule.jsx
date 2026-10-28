import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, qs, fileUrl } from '../api.js';
import { base } from '../paths.js';
import { useAuth, canManage, isSigner } from '../auth.jsx';
import { useApi, Card, Kpi, Field, Modal, Badge, MoneyInput, useToast, Icon, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { eur, itDate, STATUS } from '../format.js';

// Scadenziario strutture nel widget Payments (richiesta del CEO, 28/10/2026): affitti e utenze di ogni sede, con avvisi dei
// pagamenti, storico degli scatti del canone e delle bollette, previsione dei costi e istanze di pagamento create dalle scadenze.
// Le scadenze non si inseriscono: si calcolano dai contratti e dalle utenze (server, lib/schedule.js); qui si segnano come pagate /
// fatte o si trasformano in istanze. Le sedi sono quelle dell'anagrafica unica; locatore e fornitore si scelgono tra le Legal entity
// e si agganciano a un beneficiario Payments. Finance Support e amministratori scrivono; CEO e CFO segnano gli esiti; gli altri leggono.

const LEASE_KIND = { COMMERCIALE_6_6: 'Commerciale 6+6', COMMERCIALE_9_9: 'Commerciale 9+9', ABITATIVO_4_4: 'Abitativo 4+4', ABITATIVO_3_2: 'Abitativo 3+2', TRANSITORIO: 'Transitorio', COMODATO: 'Comodato', ALTRO: 'Altro' };
const REGISTRATION = { IMPOSTA_ANNUALE: 'Imposta annuale', UNICA_SOLUZIONE: 'Unica soluzione', CEDOLARE_SECCA: 'Cedolare secca', DA_REGISTRARE: 'Da registrare' };
const UTILITY_KIND = { ENERGIA: 'Energia elettrica', GAS: 'Gas', ACQUA: 'Acqua', TARI: 'TARI', TELEFONIA: 'Telefonia / Internet', CONDOMINIO: 'Condominio', VIGILANZA: 'Vigilanza', PULIZIE: 'Pulizie', ALTRO: 'Altro' };
const TRANSFER = { DA_AVVIARE: 'Da avviare', IN_CORSO: 'In corso', COMPLETATA: 'Completata', NON_NECESSARIA: 'Non necessaria' };
const TRANSFER_TONE = { DA_AVVIARE: 'red', IN_CORSO: 'mauve', COMPLETATA: 'green', NON_NECESSARIA: 'grey' };
const STEP_REASON = { INIZIALE: 'Iniziale', ISTAT: 'ISTAT', RINEGOZIAZIONE: 'Rinegoziazione', ALTRO: 'Altro' };
const PERIOD = { 1: 'Mensile', 2: 'Bimestrale', 3: 'Trimestrale', 4: 'Quadrimestrale', 6: 'Semestrale', 12: 'Annuale' };
const PER_SHORT = { 1: 'mese', 2: 'bimestre', 3: 'trimestre', 4: 'quadrimestre', 6: 'semestre', 12: 'anno' };
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const monthLabel = (mk) => { const [y, m] = mk.split('-'); return `${MESI_LUNGHI[Number(m) - 1]} ${y}`; };
const monthShort = (mk) => { const [y, m] = mk.split('-'); return `${MESI[Number(m) - 1]} ${y.slice(2)}`; };
const HORIZONS = [[30, '30 giorni'], [90, '90 giorni'], [180, '6 mesi'], [365, '12 mesi']];
const isOverdue = (e) => e.days < 0 && !e.done && !e.auto;
const PAYABLE = ['canone', 'bolletta', 'registro'];

// Istanza di pagamento collegata alla scadenza: protocollo (o numero in bozza) e stato, con link alla scheda
function RequestBadge({ r }) {
  const st = STATUS[r.status] || { label: r.status, tone: 'grey' };
  return <Link to={`${base}/istanze/${r.id}`} className="req-link" title="Apri l'istanza di pagamento"><Badge tone={st.tone}>Istanza {r.protocol || `n. ${r.id}`} · {st.label.toLowerCase()}</Badge></Link>;
}
const nn = (v) => (v == null || v === '' ? null : v);

function StatePill({ e }) {
  if (e.done) return <Badge tone="green">fatta</Badge>;
  if (e.days < 0) return e.auto ? <Badge>passata</Badge> : <Badge tone="red">scaduta da {-e.days} gg</Badge>;
  if (e.days === 0) return <Badge tone="red">oggi</Badge>;
  if (e.days <= 7) return <Badge tone="red">tra {e.days} gg</Badge>;
  if (e.days <= 30) return <Badge tone="mauve">tra {e.days} gg</Badge>;
  return <Badge>tra {e.days} gg</Badge>;
}

export default function Schedule() {
  const { user } = useAuth();
  const canWrite = canManage(user);
  const canDone = canWrite || isSigner(user);
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'agenda');
  const [siteId, setSiteId] = useState(sp.get('site_id') || '');
  const [cat, setCat] = useState('');
  const [horizon, setHorizon] = useState(90);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { const n = new URLSearchParams(); if (siteId) n.set('site_id', siteId); if (tab !== 'agenda') n.set('tab', tab); setSp(n, { replace: true }); }, [siteId, tab, setSp]);

  const sites = useApi('/scadenziario/sites');
  const ev = useApi(`/scadenziario/events${qs({ site_id: siteId })}`);
  const leases = useApi(`/scadenziario/leases${qs({ site_id: siteId })}`);
  const utilities = useApi(`/scadenziario/utilities${qs({ site_id: siteId })}`);
  const orgs = useApi(canWrite ? '/scadenziario/organizations' : null);
  const reloadAll = () => { ev.reload(); leases.reload(); utilities.reload(); sites.reload(); };

  const [modal, setModal] = useState(null);   // { type: 'lease'|'step'|'utility'|'bill'|'done', ... }
  const [err, setErr] = useState(null);
  const close = () => { setModal(null); setErr(null); };

  const k = ev.data?.kpi;
  const transfers = (utilities.data || []).filter((u) => ['DA_AVVIARE', 'IN_CORSO'].includes(u.transfer_status));
  const siteName = (id) => (sites.data || []).find((s) => s.id === id)?.name || `Sede ${id}`;

  const toggleDone = async (e, payload) => {
    setErr(null);
    try {
      if (e.done) await api.del(`/scadenziario/events/done/${encodeURIComponent(e.key)}`);
      else await api.post('/scadenziario/events/done', { key: e.key, ...payload });
      toast(e.done ? 'Scadenza riaperta' : 'Scadenza segnata come fatta');
      close(); ev.reload(); utilities.reload();
    } catch (x) { setErr(x); throw x; }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scadenziario strutture</h1>
          <div className="sub">Affitti e utenze di ogni sede: scadenze dei pagamenti, scatti del canone, volture e previsione dei costi{ev.data ? `. Oggi ${itDate(ev.data.today)}` : ''}{ev.data?.alert_days ? ` · avvisi ${ev.data.alert_days} giorni prima` : ''}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={fileUrl(`/scadenziario/export.xlsx${qs({ site_id: siteId })}`)}><Icon name="download" size={16} />Esporta XLSX</a>
          {canWrite && <button className="btn ghost" onClick={() => setModal({ type: 'utility', data: { site_id: siteId } })}><Icon name="plus" size={16} />Utenza</button>}
          {canWrite && <button className="btn" onClick={() => setModal({ type: 'lease', data: { site_id: siteId } })}><Icon name="plus" size={16} />Contratto di affitto</button>}
        </div>
      </div>
      <ErrorBox error={ev.error || leases.error || utilities.error} />

      {k && (
        <div className="grid g5" style={{ marginBottom: 18 }}>
          <Kpi label="Scadute" value={<span className={k.overdue ? 'red' : ''}>{k.overdue}</span>} foot={k.overdue ? `${eur(k.overdue_amount)} da gestire o segnare come fatte` : 'nessuna scadenza arretrata'} />
          <Kpi label="Entro 30 giorni" value={k.next30} foot={k.next30 ? `${eur(k.next30_amount)} in arrivo` : 'nessuna scadenza in arrivo'} />
          <Kpi label="Disdette entro 6 mesi" value={k.notices} foot={k.first_notice ? `prima: ${itDate(k.first_notice)}` : 'nessun termine vicino'} />
          <Kpi label="Volture aperte" value={<span className={k.transfers_open ? 'red' : ''}>{k.transfers_open}</span>} foot="utenze da intestare" />
          <Kpi accent label="Canoni al mese" value={eur(k.monthly_rent)} foot={`${k.leases_active} ${k.leases_active === 1 ? 'contratto attivo' : 'contratti attivi'} · ${k.utilities_active} utenze`} />
        </div>
      )}

      <div className="filters">
        <Field label="Sede">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Tutte le sedi</option>
            {(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
          </select>
        </Field>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 0, marginLeft: 'auto' }}>
          {[['agenda', 'Agenda'], ['strutture', `Strutture${sites.data ? ` (${(sites.data || []).filter((s) => s.leases_count || s.utilities_count).length})` : ''}`], ['previsione', 'Previsione'], ['volture', `Volture${transfers.length ? ` (${transfers.length})` : ''}`]].map(([key, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'agenda' && <Agenda ev={ev} cat={cat} setCat={setCat} horizon={horizon} setHorizon={setHorizon} showDone={showDone} setShowDone={setShowDone} canWrite={canWrite} canDone={canDone} onRequest={(e) => setModal({ type: 'request', event: e })} onDone={(e) => (e.done ? toggleDone(e) : setModal({ type: 'done', event: e }))} hasData={!!(leases.data?.length || utilities.data?.length)} onNew={() => setModal({ type: 'lease', data: { site_id: siteId } })} />}
      {tab === 'strutture' && <Strutture sites={sites} leases={leases} utilities={utilities} events={ev.data?.events || []} siteId={siteId} canWrite={canWrite} open={setModal} onChanged={reloadAll} />}
      {tab === 'previsione' && <Previsione siteId={siteId} />}
      {tab === 'volture' && <Volture rows={transfers} loading={!utilities.data} canWrite={canWrite} siteName={siteName} open={setModal} />}

      {modal?.type === 'lease' && <LeaseForm data={modal.data} sites={sites.data || []} orgs={orgs.data || []} orgsReload={orgs.reload} onClose={close} onSaved={() => { close(); reloadAll(); }} />}
      {modal?.type === 'step' && <StepForm lease={modal.lease} step={modal.step} onClose={close} onSaved={() => { close(); reloadAll(); }} />}
      {modal?.type === 'utility' && <UtilityForm data={modal.data} sites={sites.data || []} orgs={orgs.data || []} onClose={close} onSaved={() => { close(); reloadAll(); }} />}
      {modal?.type === 'bill' && <BillForm utility={modal.utility} bill={modal.bill} onClose={close} onSaved={() => { close(); reloadAll(); }} />}
      {modal?.type === 'request' && <RequestModal event={modal.event} onClose={close} onCreated={() => { close(); ev.reload(); }} />}
      {modal?.type === 'done' && <DoneForm event={modal.event} error={err} onClose={close} onConfirm={(p) => toggleDone(modal.event, p)} />}
    </div>
  );
}

// ---------------- Agenda ----------------
function Agenda({ ev, cat, setCat, horizon, setHorizon, showDone, setShowDone, canWrite, canDone, onDone, onRequest, hasData, onNew }) {
  const events = ev.data?.events || [];
  const visible = events.filter((e) => (!cat || e.cat === cat) && (e.days < 0 ? isOverdue(e) || (showDone && e.days >= -60) : e.days <= horizon && (showDone || !e.done)));
  const groups = useMemo(() => {
    const m = new Map();
    for (const e of visible) { const key = isOverdue(e) ? '_over' : e.date.slice(0, 7); if (!m.has(key)) m.set(key, []); m.get(key).push(e); }
    return [...m.entries()];
  }, [visible]);
  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label="Categoria">
          {[['', 'Tutte'], ['AFFITTO', 'Affitti'], ['UTENZA', 'Utenze']].map(([v, l]) => <label key={v} className={cat === v ? 'on' : ''}><input type="radio" name="cat" checked={cat === v} onChange={() => setCat(v)} />{l}</label>)}
        </div>
        <div className="seg" role="group" aria-label="Orizzonte">
          {HORIZONS.map(([v, l]) => <label key={v} className={horizon === v ? 'on' : ''}><input type="radio" name="hz" checked={horizon === v} onChange={() => setHorizon(v)} />{l}</label>)}
        </div>
        <label className="f inline"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />mostra le completate e le passate (60 giorni)</label>
      </div>
      {!ev.data ? <Loading /> : !hasData ? (
        <div className="card"><Empty><b>Nessun contratto né utenza</b><div className="small muted" style={{ marginTop: 6 }}>Registra i contratti di affitto e le utenze delle sedi: canoni, ISTAT, imposta di registro, disdette e bollette compaiono qui da soli.</div>{canWrite && <div style={{ marginTop: 12 }}><button className="btn" onClick={onNew}>+ Contratto di affitto</button></div>}</Empty></div>
      ) : !groups.length ? <div className="card"><Empty>Nessuna scadenza in questo intervallo: allarga l'orizzonte o cambia i filtri.</Empty></div> : groups.map(([key, list]) => {
        const tot = list.reduce((s, e) => s + (e.amount || 0), 0);
        return (
          <Card key={key} flush className="sched-month" title={<span className={key === '_over' ? 'red' : ''} style={key === '_over' ? undefined : { textTransform: 'capitalize' }}>{key === '_over' ? 'Scadute e non segnate' : monthLabel(key)}</span>} actions={<span className="small muted">{list.length} {list.length === 1 ? 'scadenza' : 'scadenze'}{tot ? ` · ${eur(tot)}` : ''}</span>}>
            {list.map((e) => (
              <div key={e.key} className={`sched-ev ${e.done ? 'done' : ''}`}>
                <div className="day"><b>{Number(e.date.slice(8, 10))}</b><span>{MESI[Number(e.date.slice(5, 7)) - 1]}</span></div>
                <div className="what">
                  <div className="t">{e.title} <Badge tone={e.cat === 'AFFITTO' ? 'blue' : 'mauve'}>{e.cat === 'AFFITTO' ? 'Affitto' : 'Utenza'}</Badge></div>
                  <div className="d small muted">{e.site_name}{e.desc ? ` · ${e.desc}` : ''}{e.auto ? ' · pagamento automatico' : ''}{e.done_note ? ` · nota: ${e.done_note}` : ''}</div>
                </div>
                <div className="amt num">{e.amount != null ? <>{e.estimate && <span className="muted" title="importo stimato">~</span>}{eur(e.amount)}{e.done_amount != null && e.done_amount !== e.amount && <div className="small muted">pagati {eur(e.done_amount)}</div>}</> : ''}</div>
                <div className="act row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  {e.request && <RequestBadge r={e.request} />}
                  <StatePill e={e} />
                  {canWrite && !e.done && PAYABLE.includes(e.kind) && (!e.request || ['ANNULLATA', 'RIFIUTATA'].includes(e.request.status)) && <button className="btn sm ghost" onClick={() => onRequest(e)} title="Crea un'istanza di autorizzazione al pagamento per questa scadenza">Crea istanza</button>}
                  {canDone && (e.kind !== 'fine' || e.days < 0) && <button className={`btn sm ${e.done ? 'ghost' : ''}`} onClick={() => onDone(e)}>{e.done ? '✓ Fatta' : PAYABLE.includes(e.kind) ? 'Segna pagato' : 'Segna fatto'}</button>}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
    </>
  );
}

// ---------------- Strutture ----------------
function Strutture({ sites, leases, utilities, events, siteId, canWrite, open, onChanged }) {
  if (!sites.data || !leases.data || !utilities.data) return <Loading />;
  const list = (sites.data || []).filter((s) => !siteId || s.id === Number(siteId));
  const withData = list.filter((s) => leases.data.some((l) => l.site_id === s.id) || utilities.data.some((u) => u.site_id === s.id));
  const without = list.filter((s) => !withData.includes(s));
  if (!list.length) return <div className="card"><Empty>Nessuna sede nel tuo perimetro.</Empty></div>;
  return (
    <>
      {withData.map((s) => <Dossier key={s.id} site={s} leases={leases.data.filter((l) => l.site_id === s.id)} utilities={utilities.data.filter((u) => u.site_id === s.id)} events={events.filter((e) => e.site_id === s.id)} canWrite={canWrite} open={open} onChanged={onChanged} />)}
      {without.length > 0 && (
        <Card title={withData.length ? 'Sedi senza contratti né utenze' : 'Sedi dell\'anagrafica'} flush>
          <table className="t"><tbody>
            {without.map((s) => <tr key={s.id}><td><b>{s.name}</b> <span className="mono muted small">{s.code}</span><div className="small muted">{[s.address, s.city].filter(Boolean).join(', ')}{s.ownership === 'OSPITATA' && s.host_name ? ` · ospitata da ${s.host_name}` : s.ownership === 'PROPRIA' ? ' · sede di proprietà' : ''}</div></td>
              <td className="num">{canWrite && <><button className="btn sm ghost" onClick={() => open({ type: 'lease', data: { site_id: s.id } })}>+ Contratto</button> <button className="btn sm ghost" onClick={() => open({ type: 'utility', data: { site_id: s.id } })}>+ Utenza</button></>}</td></tr>)}
          </tbody></table>
        </Card>
      )}
    </>
  );
}

function Dossier({ site, leases, utilities, events, canWrite, open, onChanged }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const next = events.find((e) => e.days >= 0 && !e.done);
  const overdue = events.filter(isOverdue).length;
  const [stepsOf, setStepsOf] = useState(null);
  const [billsOf, setBillsOf] = useState(null);
  return (
    <Card className="dossier" title={<span>{site.name} <span className="mono muted small">{site.code}</span></span>} actions={<>
      {overdue > 0 && <Badge tone="red">{overdue} {overdue === 1 ? 'scaduta' : 'scadute'}</Badge>}
      {next && <span className="small muted">Prossima: {next.title} {itDate(next.date)}{next.amount != null ? ` · ${next.estimate ? '~' : ''}${eur(next.amount)}` : ''}</span>}
      {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'lease', data: { site_id: site.id } })}>+ Contratto</button>}
      {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'utility', data: { site_id: site.id } })}>+ Utenza</button>}
    </>}>
      <div className="small muted" style={{ marginBottom: 10 }}>{[site.address, site.city, site.province && `(${site.province})`].filter(Boolean).join(' ')}{site.ownership === 'OSPITATA' && site.host_name ? ` · ospitata da ${site.host_name}` : site.ownership === 'PROPRIA' ? ' · sede di proprietà' : ''}</div>
      <h3 style={{ marginBottom: 6 }}>Contratti di affitto</h3>
      {!leases.length ? <div className="small muted" style={{ marginBottom: 12 }}>Nessun contratto registrato.</div> : (
        <div className="table-wrap" style={{ marginBottom: 14 }}><table className="t">
          <thead><tr><th>Immobile / locatore</th><th>Tipologia</th><th className="num">Rata vigente</th><th>Scadenza</th><th>Disdetta entro</th><th>ISTAT · Registro</th><th /></tr></thead>
          <tbody>{leases.map((l) => (
            <React.Fragment key={l.id}>
              <tr>
                <td><b>{l.unit || 'Immobile'}</b><div className="small muted">{l.landlord_name || 'locatore non indicato'}{l.deposit ? ` · deposito ${eur(l.deposit)}` : ''}</div><LeaseDocs lease={l} canWrite={canWrite} onChanged={onChanged} />{l.beneficiary_name ? <div className="small muted">beneficiario {l.beneficiary_name}</div> : <div className="small red" title="Senza beneficiario Payments le istanze usano l'IBAN della Legal entity">beneficiario Payments non indicato</div>}{!l.active && <Badge tone="red">Cessato</Badge>}</td>
                <td>{LEASE_KIND[l.kind] || l.kind}<div className="small muted">dal {itDate(l.start_date)}{l.first_term_years ? ` · ${l.first_term_years} anni` : ''}{l.renewal_years ? ` + ${l.renewal_years}` : ''}</div></td>
                <td className="num"><b>{l.current_amount != null ? eur(l.current_amount) : <span className="muted">non indicata</span>}</b><div className="small muted">/{PER_SHORT[l.period_months] || 'rata'}{l.auto_pay ? ' · automatico' : ''}{l.current_step_from ? ` · dal ${itDate(l.current_step_from)}` : ''}</div></td>
                <td>{l.end_date ? <>{itDate(l.end_date)}{l.expired ? <div className="small red">scaduto</div> : l.renewals ? <div className="small muted">rinnovato {l.renewals} {l.renewals === 1 ? 'volta' : 'volte'}</div> : null}</> : <span className="muted">–</span>}</td>
                <td>{l.notice_by ? <>{itDate(l.notice_by)}<div className="small muted">preavviso {l.notice_months} mesi{l.notice_by < todayIso ? ' · superato' : ''}</div></> : <span className="muted">–</span>}</td>
                <td>{l.istat ? 'ISTAT sì' : 'ISTAT no'}<div className="small muted">{l.registration_label || 'registrazione non indicata'}</div></td>
                <td className="num actions">
                  <button className="btn sm ghost" onClick={() => setStepsOf(stepsOf === l.id ? null : l.id)}>Scatti ({l.steps.length})</button>{' '}
                  {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'step', lease: l })}>Nuovo scatto</button>}{' '}
                  {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'lease', data: l })}>Modifica</button>}
                </td>
              </tr>
              {stepsOf === l.id && (
                <tr><td colSpan={7} style={{ background: 'var(--card-2)' }}>
                  <div className="small strong" style={{ marginBottom: 4 }}>Storico degli scatti del canone</div>
                  {!l.steps.length ? <div className="small muted">Nessuno scatto: indica l'importo iniziale nel contratto o aggiungi uno scatto.</div> : (
                    <table className="t"><thead><tr><th>Dal</th><th className="num">Importo rata</th><th>Motivo</th><th className="num">Variazione</th><th>Note</th><th /></tr></thead>
                      <tbody>{l.steps.map((s, i) => { const prev = l.steps[i - 1]; const delta = prev ? ((Number(s.amount) - Number(prev.amount)) / Number(prev.amount)) * 100 : null; return (
                        <tr key={s.id}><td>{itDate(s.valid_from)}</td><td className="num strong">{eur(s.amount)}</td><td>{STEP_REASON[s.reason] || s.reason}</td><td className="num">{s.pct != null ? `${Number(s.pct).toLocaleString('it-IT')}%` : delta != null ? <span className="muted">{delta >= 0 ? '+' : ''}{delta.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%</span> : ''}</td><td className="small muted">{s.notes || ''}</td>
                          <td className="num">{canWrite && <><button className="btn sm ghost" onClick={() => open({ type: 'step', lease: l, step: s })}>Modifica</button></>}</td></tr>); })}</tbody></table>
                  )}
                </td></tr>
              )}
            </React.Fragment>
          ))}</tbody>
        </table></div>
      )}
      <h3 style={{ marginBottom: 6 }}>Utenze</h3>
      {!utilities.length ? <div className="small muted">Nessuna utenza registrata.</div> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Tipo / fornitore</th><th>Codice</th><th>Intestatario</th><th>Voltura</th><th className="num">Stima a bolletta</th><th>Fine offerta</th><th /></tr></thead>
          <tbody>{utilities.map((u) => (
            <React.Fragment key={u.id}>
              <tr>
                <td><b>{UTILITY_KIND[u.kind] || u.kind}</b><div className="small muted">{u.supplier_name || 'fornitore non indicato'} · {PERIOD[u.period_months] ? PERIOD[u.period_months].toLowerCase() : ''}{u.auto_pay ? ' · addebito automatico' : ''}</div>{u.beneficiary_name && <div className="small muted">beneficiario {u.beneficiary_name}</div>}{!u.active && <Badge tone="red">Cessata</Badge>}</td>
                <td className="mono">{u.code || <span className="muted">–</span>}</td>
                <td>{u.holder || <span className="muted">–</span>}</td>
                <td><Badge tone={TRANSFER_TONE[u.transfer_status]}>{TRANSFER[u.transfer_status]}</Badge></td>
                <td className="num">{u.estimate != null ? <>~{eur(u.estimate)}<div className="small muted">{u.estimate_source === 'bollette' ? 'media delle bollette registrate' : 'importo medio dichiarato'}</div></> : <span className="muted">–</span>}{u.ref_due && <div className="small muted">scadenza nota {itDate(u.ref_due)}</div>}</td>
                <td>{u.offer_end ? itDate(u.offer_end) : <span className="muted">–</span>}</td>
                <td className="num actions">
                  <button className="btn sm ghost" onClick={() => setBillsOf(billsOf === u.id ? null : u.id)}>Bollette ({u.bills_count}{u.unpaid ? `, ${u.unpaid} da pagare` : ''})</button>{' '}
                  {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'bill', utility: u })}>Registra bolletta</button>}{' '}
                  {canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'utility', data: u })}>Modifica</button>}
                </td>
              </tr>
              {billsOf === u.id && (
                <tr><td colSpan={7} style={{ background: 'var(--card-2)' }}>
                  <div className="small strong" style={{ marginBottom: 4 }}>Bollette registrate{u.avg_bill_12m != null ? ` · media degli ultimi 12 mesi ${eur(u.avg_bill_12m)}` : ''}</div>
                  {!u.bills.length ? <div className="small muted">Nessuna bolletta registrata: le scadenze usano l'importo medio dichiarato.</div> : (
                    <table className="t"><thead><tr><th>Periodo</th><th>Scadenza</th><th className="num">Importo</th><th className="num">Consumo</th><th>Pagata</th><th>Note</th><th /></tr></thead>
                      <tbody>{u.bills.map((b) => <tr key={b.id}><td>{b.period_from || b.period_to ? `${itDate(b.period_from)} – ${itDate(b.period_to)}` : <span className="muted">–</span>}</td><td>{itDate(b.due_date)}</td><td className="num strong">{eur(b.amount)}</td><td className="num">{b.consumption != null ? `${Number(b.consumption).toLocaleString('it-IT')} ${b.unit || ''}` : ''}</td><td>{b.paid_at ? <Badge tone="green">il {itDate(b.paid_at)}</Badge> : <Badge tone="red">da pagare</Badge>}</td><td className="small muted">{b.notes || ''}</td>
                        <td className="num">{canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'bill', utility: u, bill: b })}>Modifica</button>}</td></tr>)}</tbody></table>
                  )}
                </td></tr>
              )}
            </React.Fragment>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ---------------- Previsione ----------------
function Previsione({ siteId }) {
  const [months, setMonths] = useState(12);
  const f = useApi(`/scadenziario/forecast${qs({ months, site_id: siteId })}`);
  const d = f.data;
  const [detail, setDetail] = useState(false);
  if (f.error) return <ErrorBox error={f.error} />;
  if (!d) return <Loading />;
  const prevSum = d.previous.sum;
  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label="Mesi">{[6, 12, 24].map((n) => <label key={n} className={months === n ? 'on' : ''}><input type="radio" name="months" checked={months === n} onChange={() => setMonths(n)} />{n} mesi</label>)}</div>
        <label className="f inline"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />dettaglio affitti e utenze per sede</label>
        <span className="small muted" style={{ marginLeft: 'auto' }}>Ipotesi dalle Impostazioni: rivalutazione ISTAT {d.assumptions.istat_pct.toLocaleString('it-IT')}% annuo dal prossimo anniversario · crescita utenze {d.assumptions.utility_growth_pct.toLocaleString('it-IT')}% annuo · imposta di registro {d.assumptions.registry_pct}% del canone annuo (minimo {d.assumptions.registry_min} €)</span>
      </div>
      <div className="grid g5" style={{ marginBottom: 16 }}>
        <Kpi accent label={`Costo previsto ${months} mesi`} value={eur(d.totals.sum)} foot={`${eur(d.totals.sum / months)} al mese in media`} />
        <Kpi label="Affitti" value={eur(d.totals.sum_rent + d.totals.sum_registry)} foot={d.totals.sum_registry ? `di cui imposta di registro ${eur(d.totals.sum_registry)}` : 'canoni con rivalutazione ipotetica'} />
        <Kpi label="Utenze" value={eur(d.totals.sum_utilities)} foot="media delle bollette registrate o importo medio" />
        <Kpi label="Istanze già create" value={eur(d.requests_open?.sum || 0)} foot={d.requests_open?.count ? `${d.requests_open.count} ${d.requests_open.count === 1 ? 'istanza' : 'istanze'} in bozza, in firma o autorizzate` : 'nessuna istanza aperta dalle scadenze'} />
        <Kpi label="Ultimi 12 mesi registrati" value={eur(prevSum)} foot={prevSum ? `affitti ${eur(d.previous.sum_rent)} · utenze ${eur(d.previous.sum_utilities)}` : 'bollette pagate e rate segnate fatte'} />
      </div>
      {!d.sites.length ? <div className="card"><Empty>Nessun contratto né utenza: la previsione si costruisce da soli questi dati.</Empty></div> : (
        <Card flush title="Costo previsto per sede e mese" actions={<span className="small muted">~ stima · importi in euro</span>}>
          <div className="table-wrap"><table className="t forecast">
            <thead><tr><th>Sede</th>{d.months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}<th className="num">Totale</th></tr></thead>
            <tbody>
              {d.sites.map((s) => (
                <React.Fragment key={s.site_id}>
                  <tr><td><b>{s.site_name}</b></td>{s.total.map((v, i) => <td key={i} className="num">{v ? eur(v) : <span className="muted">–</span>}</td>)}<td className="num strong">{eur(s.sum)}</td></tr>
                  {detail && <>
                    <tr className="sub"><td className="small muted" style={{ paddingLeft: 28 }}>Affitti{s.registry.some(Boolean) ? ' e imposta di registro' : ''}</td>{s.rent.map((v, i) => <td key={i} className="num small muted">{v + s.registry[i] ? eur(v + s.registry[i]) : ''}</td>)}<td className="num small muted">{eur(s.rent.reduce((a, b) => a + b, 0) + s.registry.reduce((a, b) => a + b, 0))}</td></tr>
                    <tr className="sub"><td className="small muted" style={{ paddingLeft: 28 }}>Utenze</td>{s.utilities.map((v, i) => <td key={i} className="num small muted">{v ? `~${eur(v)}` : ''}</td>)}<td className="num small muted">{eur(s.utilities.reduce((a, b) => a + b, 0))}</td></tr>
                  </>}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Affitti{d.totals.sum_registry ? ' e imposta di registro' : ''}</td>{d.totals.rent.map((v, i) => <td key={i} className="num">{eur(v + d.totals.registry[i])}</td>)}<td className="num">{eur(d.totals.sum_rent + d.totals.sum_registry)}</td></tr>
              <tr><td>Utenze</td>{d.totals.utilities.map((v, i) => <td key={i} className="num">~{eur(v)}</td>)}<td className="num">{eur(d.totals.sum_utilities)}</td></tr>
              <tr><td>Totale rete</td>{d.totals.total.map((v, i) => <td key={i} className="num">{eur(v)}</td>)}<td className="num">{eur(d.totals.sum)}</td></tr>
              {d.requests_open && <tr className="req-row"><td title="Istanze di pagamento create dalle scadenze, non ancora eseguite (bozza, in firma, autorizzate)">Istanze già create</td>{d.requests_open.months.map((v, i) => <td key={i} className="num">{v ? eur(v) : <span className="muted">–</span>}</td>)}<td className="num">{eur(d.requests_open.sum)}</td></tr>}
            </tfoot>
          </table></div>
        </Card>
      )}
      <Card flush title="Confronto con i 12 mesi precedenti" actions={<span className="small muted">bollette pagate (per mese di pagamento) e rate di canone segnate fatte</span>} className="forecast-prev">
        <div className="table-wrap"><table className="t forecast">
          <thead><tr><th>Registrato</th>{d.previous.months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}<th className="num">Totale</th></tr></thead>
          <tbody>
            <tr><td>Affitti</td>{d.previous.rent.map((v, i) => <td key={i} className="num">{v ? eur(v) : <span className="muted">–</span>}</td>)}<td className="num strong">{eur(d.previous.sum_rent)}</td></tr>
            <tr><td>Utenze</td>{d.previous.utilities.map((v, i) => <td key={i} className="num">{v ? eur(v) : <span className="muted">–</span>}</td>)}<td className="num strong">{eur(d.previous.sum_utilities)}</td></tr>
          </tbody>
          <tfoot><tr><td>Totale</td>{d.previous.total.map((v, i) => <td key={i} className="num">{eur(v)}</td>)}<td className="num">{eur(prevSum)}</td></tr></tfoot>
        </table></div>
      </Card>
    </>
  );
}

// ---------------- Volture ----------------
function Volture({ rows, loading, canWrite, siteName, open }) {
  if (loading) return <Loading />;
  if (!rows.length) return <div className="card"><Empty><b>Nessuna voltura aperta</b><div className="small muted" style={{ marginTop: 6 }}>Le utenze con voltura "Da avviare" o "In corso" compaiono qui finché non vengono intestate.</div></Empty></div>;
  const sorted = [...rows].sort((a, b) => siteName(a.site_id).localeCompare(siteName(b.site_id)) || a.kind.localeCompare(b.kind));
  return (
    <Card flush title="Utenze da intestare" actions={<span className="small muted">{rows.length} {rows.length === 1 ? 'voltura aperta' : 'volture aperte'}</span>}>
      <table className="t">
        <thead><tr><th>Sede</th><th>Utenza</th><th>Codice</th><th>Intestatario attuale</th><th>Stato</th><th>Note</th><th /></tr></thead>
        <tbody>{sorted.map((u) => (
          <tr key={u.id}><td><b>{siteName(u.site_id)}</b></td><td>{UTILITY_KIND[u.kind] || u.kind}<div className="small muted">{u.supplier_name || ''}</div></td><td className="mono">{u.code || <span className="muted">–</span>}</td><td>{u.holder || <span className="muted">–</span>}</td>
            <td><Badge tone={TRANSFER_TONE[u.transfer_status]}>{TRANSFER[u.transfer_status]}</Badge></td><td className="small muted">{u.notes || ''}</td>
            <td className="num">{canWrite && <button className="btn sm ghost" onClick={() => open({ type: 'utility', data: u })}>Aggiorna</button>}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

// ---------------- Form ----------------
function SiteSelect({ value, onChange, sites, disabled }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} required><option value="">Scegli la sede</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}</select>;
}
function OrgSelect({ value, onChange, orgs, placeholder = 'Nessuna Legal entity' }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ''}{o.vat_number ? ` · ${o.vat_number}` : ''}</option>)}</select>;
}
const Footer = ({ onClose, onSave, onDelete, busy, disabled, label = 'Salva' }) => <><div className="spacer">{onDelete && <button className="btn danger" disabled={busy} onClick={onDelete}>Elimina</button>}</div><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || disabled} onClick={onSave}>{busy ? 'Salvataggio…' : label}</button></>;

function useSaver(onSaved) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn, msg) => { setBusy(true); setErr(null); try { await fn(); if (msg) toast(msg); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return { busy, err, run };
}
const confirmDelete = (what) => window.confirm(`Eliminare ${what}? L'operazione non si può annullare.`);

function LeaseForm({ data, sites, orgs, orgsReload, onClose, onSaved }) {
  const edit = !!data?.id;
  const [ai, setAi] = useState(null);     // esito della lettura del PDF: { document_id, proposta, avvisi, confidence, initial_steps, model }
  const [f, setF] = useState({ site_id: data?.site_id || '', landlord_org_id: data?.landlord_org_id || '', landlord_name: data?.landlord_name || '', beneficiary_id: data?.beneficiary_id || '', unit: data?.unit || '', kind: data?.kind || 'COMMERCIALE_6_6', start_date: data?.start_date || '', first_term_years: data?.first_term_years ?? (data?.kind?.startsWith('COMMERCIALE_9') ? 9 : 6), renewal_years: data?.renewal_years ?? 6, notice_months: data?.notice_months ?? 12, period_months: data?.period_months || 1, first_due: data?.first_due || '', amount: data?.current_amount ?? data?.steps?.find((s) => s.reason === 'INIZIALE')?.amount ?? '', deposit: data?.deposit ?? '', registration: data?.registration || 'IMPOSTA_ANNUALE', istat: data?.istat ?? true, auto_pay: data?.auto_pay ?? false, business_contract_id: data?.business_contract_id || '', notes: data?.notes || '', active: data?.active ?? true });
  const { busy, err, run } = useSaver(onSaved);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const iniAmount = edit ? data.steps?.find((s) => s.reason === 'INIZIALE')?.amount : null;
  const save = () => run(async () => {
    const body = { site_id: Number(f.site_id), landlord_org_id: f.landlord_org_id ? Number(f.landlord_org_id) : null, landlord_name: nn(f.landlord_name), beneficiary_id: f.beneficiary_id ? Number(f.beneficiary_id) : null, unit: nn(f.unit), kind: f.kind, start_date: f.start_date, first_term_years: f.first_term_years === '' ? null : Number(f.first_term_years), renewal_years: f.renewal_years === '' ? null : Number(f.renewal_years), notice_months: f.notice_months === '' ? null : Number(f.notice_months), period_months: Number(f.period_months), first_due: nn(f.first_due), deposit: f.deposit === '' ? null : Number(f.deposit), registration: nn(f.registration), istat: !!f.istat, auto_pay: !!f.auto_pay, business_contract_id: f.business_contract_id ? Number(f.business_contract_id) : null, notes: nn(f.notes), active: !!f.active };
    // importo iniziale: alla creazione crea lo scatto INIZIALE; in modifica solo se cambia rispetto allo scatto iniziale
    if (!edit) { if (f.amount !== '') body.amount = Number(f.amount); } else if (f.amount !== '' && Number(f.amount) !== Number(iniAmount ?? NaN)) body.amount = Number(f.amount);
    // contratto letto dal PDF: documento da collegare e scatti iniziali proposti (rate iniziali diverse + canone a regime con l'importo del form)
    if (!edit && ai?.document_id) {
      body.document_id = ai.document_id;
      const steps = (ai.initial_steps || []).filter((st) => st.valid_from >= f.start_date).map((st) => (st.reason === 'INIZIALE' && f.amount !== '' ? { ...st, amount: Number(f.amount) } : st));
      if (steps.length > 1) body.initial_steps = steps;
    }
    if (edit) await api.put(`/scadenziario/leases/${data.id}`, body); else await api.post('/scadenziario/leases', body);
  }, edit ? 'Contratto aggiornato' : 'Contratto registrato');
  const del = () => confirmDelete('il contratto con i suoi scatti e gli esiti') && run(() => api.del(`/scadenziario/leases/${data.id}`), 'Contratto eliminato');
  const org = f.landlord_org_id ? orgs.find((o) => o.id === Number(f.landlord_org_id)) : null;
  // valori del form dalla proposta letta nel PDF (solo i campi letti; l'utente controlla e salva)
  const fromProposal = (lease) => Object.fromEntries(Object.entries(lease || {}).filter(([k, v]) => k in f && v != null).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v)]));
  const onAnalyzed = (r) => {
    setAi(r);
    if (!edit) setF((cur) => ({ ...cur, ...fromProposal(r.proposta?.lease) }));
  };
  const applyDiff = (fields) => { setF((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(fromProposal(ai?.proposta?.lease)).filter(([k]) => fields.includes(k))) })); };
  const Pin = ({ k }) => <ConfPin c={ai?.confidence?.[k]} />;
  return (
    <Modal wide title={edit ? `Modifica contratto · ${data.unit || data.site_name || ''}` : 'Nuovo contratto di affitto'} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} onDelete={edit ? del : null} busy={busy} disabled={!f.site_id || !f.start_date} />}>
      <ErrorBox error={err} />
      <PdfPanel edit={edit} leaseId={data?.id} ai={ai} current={f} onAnalyzed={onAnalyzed} onApplyDiff={applyDiff} onOrgCreated={(o) => { setF((cur) => ({ ...cur, landlord_org_id: String(o.id), landlord_name: '' })); setAi((a) => a ? { ...a, proposta: { ...a.proposta, landlord_org_id: o.id, landlord_label: o.name, landlord_how: o.existing ? o.how : 'creata dal contratto' } } : a); orgsReload?.(); }} />
      <div className="form-grid">
        <Field label={<>Sede <Pin k="site_id" /></>} help={ai?.proposta?.site_id ? `Dal contratto: ${ai.proposta.site_label} (${ai.proposta.site_how})` : 'Dall\'anagrafica unica della Suite'} className="span2"><SiteSelect value={f.site_id} onChange={set('site_id')} sites={sites} /></Field>
        <Field label={<>Immobile / unità <Pin k="unit" /></>} help="es. piano terra, box, magazzino"><input value={f.unit} onChange={set('unit')} /></Field>
        <Field label={<>Tipologia <Pin k="kind" /></>}><select value={f.kind} onChange={set('kind')}>{Object.entries(LEASE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={<>Locatore (Legal entity) <Pin k="landlord_org_id" /></>} help={ai?.proposta?.landlord_org_id ? `Dal contratto: ${ai.proposta.landlord_label} (${ai.proposta.landlord_how})` : 'Dall\'anagrafica; se manca, scrivi il nome qui sotto'}><OrgSelect value={f.landlord_org_id} onChange={set('landlord_org_id')} orgs={orgs} /></Field>
        <Field label={<>Locatore (nome) <Pin k="landlord_name" /></>} help={org ? `Vale la Legal entity ${org.name} se lasci vuoto` : 'Nome del proprietario se non è in anagrafica'}><input value={f.landlord_name} onChange={set('landlord_name')} placeholder={org?.name || ''} /></Field>
        <Field label="Beneficiario Payments" help="Anagrafica dei beneficiari con IBAN: serve a creare le istanze dalle scadenze" className="span2"><BeneficiarySelect value={f.beneficiary_id} onChange={set('beneficiary_id')} fromOrg={org ? { id: org.id, name: org.name } : f.landlord_name ? { name: f.landlord_name } : null} fromLabel="nuovo dal locatore" /></Field>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>Durata</h3>
      <div className="form-grid">
        <Field label={<>Decorrenza * <Pin k="start_date" /></>}><input type="date" value={f.start_date} onChange={set('start_date')} required /></Field>
        <Field label={<>Primo periodo (anni) <Pin k="first_term_years" /></>}><input type="number" min={0} max={99} value={f.first_term_years} onChange={set('first_term_years')} /></Field>
        <Field label={<>Rinnovo tacito (anni) <Pin k="renewal_years" /></>} help="0 = nessun rinnovo automatico"><input type="number" min={0} max={99} value={f.renewal_years} onChange={set('renewal_years')} /></Field>
        <Field label={<>Preavviso disdetta (mesi) <Pin k="notice_months" /></>}><input type="number" min={0} max={60} value={f.notice_months} onChange={set('notice_months')} /></Field>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>Canone</h3>
      <div className="form-grid">
        <Field label={<>{edit ? 'Importo iniziale della rata' : 'Importo della rata'} <Pin k="amount" /></>} help={edit ? 'Scatto iniziale; i successivi si aggiungono con "Nuovo scatto"' : 'Crea il primo scatto del canone alla decorrenza'}><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
        <Field label={<>Periodicità della rata <Pin k="period_months" /></>}><select value={f.period_months} onChange={set('period_months')}>{[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{PERIOD[n]}</option>)}</select></Field>
        <Field label="Prima scadenza della rata" help="Se vuota vale la decorrenza"><input type="date" value={f.first_due} onChange={set('first_due')} /></Field>
        <Field label={<>Deposito cauzionale <Pin k="deposit" /></>}><MoneyInput value={f.deposit} onChange={set('deposit')} /></Field>
        <Field label={<>Registrazione <Pin k="registration" /></>}><select value={f.registration} onChange={set('registration')}><option value="">Non indicata</option>{Object.entries(REGISTRATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Riferimento Business" help="Id del contratto SEDE nel widget Business, facoltativo"><input type="number" min={1} value={f.business_contract_id} onChange={set('business_contract_id')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 20 }}>
        <label className="f inline"><input type="checkbox" checked={!!f.istat} onChange={set('istat')} />Adeguamento ISTAT annuale <Pin k="istat" /></label>
        <label className="f inline"><input type="checkbox" checked={!!f.auto_pay} onChange={set('auto_pay')} />Pagamento automatico (RID o bonifico permanente)</label>
        {edit && <label className="f inline"><input type="checkbox" checked={!!f.active} onChange={set('active')} />Contratto attivo</label>}
      </div>
      <div style={{ marginTop: 12 }}><Field label="Note"><textarea value={f.notes} onChange={set('notes')} style={{ minHeight: 60 }} /></Field></div>
    </Modal>
  );
}

function StepForm({ lease, step, onClose, onSaved }) {
  const edit = !!step;
  const last = lease.steps?.[lease.steps.length - 1];
  const [f, setF] = useState({ valid_from: step?.valid_from || '', amount: step?.amount ?? '', reason: step?.reason || 'ISTAT', pct: step?.pct ?? '', notes: step?.notes || '' });
  const { busy, err, run } = useSaver(onSaved);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  // scorciatoia: applica la percentuale all'ultimo scatto
  const applyPct = () => { const base = Number(last?.amount); if (!base || f.pct === '') return; setF({ ...f, amount: Math.round(base * (1 + Number(f.pct) / 100) * 100) / 100 }); };
  const save = () => run(async () => {
    const body = { valid_from: f.valid_from, amount: Number(f.amount), reason: f.reason, pct: f.pct === '' ? null : Number(f.pct), notes: nn(f.notes) };
    if (edit) await api.put(`/scadenziario/steps/${step.id}`, body); else await api.post(`/scadenziario/leases/${lease.id}/steps`, body);
  }, edit ? 'Scatto aggiornato' : 'Nuovo scatto registrato');
  const del = () => confirmDelete('lo scatto') && run(() => api.del(`/scadenziario/steps/${step.id}`), 'Scatto eliminato');
  return (
    <Modal title={edit ? 'Modifica scatto del canone' : `Nuovo scatto · ${lease.unit || lease.site_name || 'contratto'}`} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} onDelete={edit ? del : null} busy={busy} disabled={!f.valid_from || f.amount === ''} />}>
      <ErrorBox error={err} />
      {last && !edit && <div className="alert info" style={{ marginBottom: 12 }}><span>Rata vigente {eur(last.amount)} dal {itDate(last.valid_from)} ({STEP_REASON[last.reason] || last.reason}). Il nuovo importo vale dalla data indicata: le rate successive lo usano.</span></div>}
      <div className="form-grid">
        <Field label="Valido dal *"><input type="date" value={f.valid_from} onChange={set('valid_from')} min={lease.start_date} /></Field>
        <Field label="Motivo"><select value={f.reason} onChange={set('reason')}>{Object.entries(STEP_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Variazione % (se nota)" help={last ? 'Calcola l\'importo dall\'ultima rata' : null}><div className="row" style={{ gap: 6 }}><input type="number" step="0.01" value={f.pct} onChange={set('pct')} />{last && !edit && <button type="button" className="btn sm ghost" onClick={applyPct} disabled={f.pct === ''}>Applica</button>}</div></Field>
        <Field label="Nuovo importo della rata *"><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Note" className="span2"><input value={f.notes} onChange={set('notes')} placeholder="es. indice FOI settembre 2026 +1,2%" /></Field>
      </div>
    </Modal>
  );
}

function UtilityForm({ data, sites, orgs, onClose, onSaved }) {
  const edit = !!data?.id;
  const [f, setF] = useState({ site_id: data?.site_id || '', kind: data?.kind || 'ENERGIA', supplier_org_id: data?.supplier_org_id || '', supplier_name: data?.supplier_name || '', beneficiary_id: data?.beneficiary_id || '', code: data?.code || '', holder: data?.holder || '', transfer_status: data?.transfer_status || 'NON_NECESSARIA', period_months: data?.period_months || 2, ref_due: data?.ref_due || '', avg_amount: data?.avg_amount ?? '', offer_end: data?.offer_end || '', auto_pay: data?.auto_pay ?? false, notes: data?.notes || '', active: data?.active ?? true });
  const { busy, err, run } = useSaver(onSaved);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const save = () => run(async () => {
    const body = { site_id: Number(f.site_id), kind: f.kind, supplier_org_id: f.supplier_org_id ? Number(f.supplier_org_id) : null, supplier_name: nn(f.supplier_name), beneficiary_id: f.beneficiary_id ? Number(f.beneficiary_id) : null, code: nn(f.code), holder: nn(f.holder), transfer_status: f.transfer_status, period_months: Number(f.period_months), ref_due: nn(f.ref_due), avg_amount: f.avg_amount === '' ? null : Number(f.avg_amount), offer_end: nn(f.offer_end), auto_pay: !!f.auto_pay, notes: nn(f.notes), active: !!f.active };
    if (edit) await api.put(`/scadenziario/utilities/${data.id}`, body); else await api.post('/scadenziario/utilities', body);
  }, edit ? 'Utenza aggiornata' : 'Utenza registrata');
  const del = () => confirmDelete('l\'utenza con le sue bollette') && run(() => api.del(`/scadenziario/utilities/${data.id}`), 'Utenza eliminata');
  const org = f.supplier_org_id ? orgs.find((o) => o.id === Number(f.supplier_org_id)) : null;
  return (
    <Modal wide title={edit ? `Modifica utenza · ${UTILITY_KIND[data.kind] || data.kind}` : 'Nuova utenza'} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} onDelete={edit ? del : null} busy={busy} disabled={!f.site_id} />}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Sede" className="span2"><SiteSelect value={f.site_id} onChange={set('site_id')} sites={sites} /></Field>
        <Field label="Tipo"><select value={f.kind} onChange={set('kind')}>{Object.entries(UTILITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Fatturazione"><select value={f.period_months} onChange={set('period_months')}>{[1, 2, 3, 4, 6, 12].map((n) => <option key={n} value={n}>{PERIOD[n]}</option>)}</select></Field>
        <Field label="Fornitore (Legal entity)" help="Dall'anagrafica; se manca, scrivi il nome qui sotto"><OrgSelect value={f.supplier_org_id} onChange={set('supplier_org_id')} orgs={orgs} /></Field>
        <Field label="Fornitore (nome)" help={org ? `Vale la Legal entity ${org.name} se lasci vuoto` : null}><input value={f.supplier_name} onChange={set('supplier_name')} placeholder={org?.name || ''} /></Field>
        <Field label="Beneficiario Payments" help="Anagrafica dei beneficiari con IBAN: serve a creare le istanze dalle bollette" className="span2"><BeneficiarySelect value={f.beneficiary_id} onChange={set('beneficiary_id')} fromOrg={org ? { id: org.id, name: org.name } : f.supplier_name ? { name: f.supplier_name } : null} fromLabel="nuovo dal fornitore" /></Field>
        <Field label="POD / PDR / numero cliente"><input className="mono" value={f.code} onChange={set('code')} /></Field>
        <Field label="Intestatario attuale"><input value={f.holder} onChange={set('holder')} /></Field>
        <Field label="Voltura"><select value={f.transfer_status} onChange={set('transfer_status')}>{Object.entries(TRANSFER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Scadenza di un pagamento noto" help="Serve a calcolare le prossime bollette attese"><input type="date" value={f.ref_due} onChange={set('ref_due')} /></Field>
        <Field label="Importo medio a bolletta" help="Usato finché non ci sono bollette registrate"><MoneyInput value={f.avg_amount} onChange={set('avg_amount')} /></Field>
        <Field label="Fine contratto / offerta"><input type="date" value={f.offer_end} onChange={set('offer_end')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 20 }}>
        <label className="f inline"><input type="checkbox" checked={!!f.auto_pay} onChange={set('auto_pay')} />Addebito automatico (RID)</label>
        {edit && <label className="f inline"><input type="checkbox" checked={!!f.active} onChange={set('active')} />Utenza attiva</label>}
      </div>
      <div style={{ marginTop: 12 }}><Field label="Note"><textarea value={f.notes} onChange={set('notes')} style={{ minHeight: 60 }} /></Field></div>
    </Modal>
  );
}

function BillForm({ utility, bill, onClose, onSaved }) {
  const edit = !!bill;
  const [f, setF] = useState({ period_from: bill?.period_from || '', period_to: bill?.period_to || '', due_date: bill?.due_date || '', amount: bill?.amount ?? '', consumption: bill?.consumption ?? '', unit: bill?.unit || ({ ENERGIA: 'kWh', GAS: 'Smc', ACQUA: 'mc' }[utility.kind] || ''), paid_at: bill?.paid_at || '', notes: bill?.notes || '' });
  const { busy, err, run } = useSaver(onSaved);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = () => run(async () => {
    const body = { period_from: nn(f.period_from), period_to: nn(f.period_to), due_date: f.due_date, amount: Number(f.amount), consumption: f.consumption === '' ? null : Number(f.consumption), unit: nn(f.unit), paid_at: nn(f.paid_at), notes: nn(f.notes) };
    if (edit) await api.put(`/scadenziario/bills/${bill.id}`, body); else await api.post(`/scadenziario/utilities/${utility.id}/bills`, body);
  }, edit ? 'Bolletta aggiornata' : 'Bolletta registrata');
  const del = () => confirmDelete('la bolletta') && run(() => api.del(`/scadenziario/bills/${bill.id}`), 'Bolletta eliminata');
  return (
    <Modal title={`${edit ? 'Modifica' : 'Registra'} bolletta · ${UTILITY_KIND[utility.kind] || utility.kind}${utility.supplier_name ? ` · ${utility.supplier_name}` : ''}`} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} onDelete={edit ? del : null} busy={busy} disabled={!f.due_date || f.amount === ''} />}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Periodo dal"><input type="date" value={f.period_from} onChange={set('period_from')} /></Field>
        <Field label="al"><input type="date" value={f.period_to} onChange={set('period_to')} /></Field>
        <Field label="Scadenza *"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Importo *"><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Consumo"><input type="number" step="any" min={0} value={f.consumption} onChange={set('consumption')} /></Field>
        <Field label="Unità"><input value={f.unit} onChange={set('unit')} placeholder="kWh, Smc, mc" /></Field>
        <Field label="Pagata il" help="Vuoto = da pagare: compare in agenda alla scadenza"><input type="date" value={f.paid_at} onChange={set('paid_at')} /></Field>
        <Field label="Note"><input value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function DoneForm({ event: e, error, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const pay = ['canone', 'bolletta', 'registro'].includes(e.kind);
  const go = async () => { setBusy(true); try { await onConfirm({ note: nn(note), amount: amount === '' ? null : Number(amount) }); } catch { setBusy(false); } };
  return (
    <Modal title={pay ? 'Segna come pagata' : 'Segna come fatta'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={go}>Conferma</button></>}>
      <ErrorBox error={error} />
      <div className="alert info" style={{ marginBottom: 12 }}><span><b>{e.title}</b> · {e.site_name} · {itDate(e.date)}{e.amount != null ? ` · ${e.estimate ? 'stima ' : ''}${eur(e.amount)}` : ''}{e.desc ? <div className="small">{e.desc}</div> : null}</span></div>
      <div className="form-grid">
        {pay && <Field label="Importo effettivamente pagato" help="Solo se diverso da quello previsto"><MoneyInput value={amount} onChange={setAmount} /></Field>}
        <Field label="Nota (facoltativa)" className={pay ? '' : 'span2'}><input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={pay ? 'es. bonifico del 3/11, CRO…' : 'es. raccomandata inviata il…'} autoFocus /></Field>
      </div>
    </Modal>
  );
}

// Beneficiario Payments: ricerca nell'anagrafica dei beneficiari (GET /beneficiaries?q=) e creazione dal locatore / fornitore
function BeneficiarySelect({ value, onChange, fromOrg, fromLabel }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const toast = useToast();
  useEffect(() => { let alive = true; api.get(`/beneficiaries${qs({ q })}`, { silent: true }).then((r) => alive && setList(r || [])).catch(() => {}); return () => { alive = false; }; }, [q]);
  const cur = list.find((b) => b.id === Number(value));
  const create = async () => {
    setBusy(true); setErr(null);
    try { const b = await api.post('/scadenziario/beneficiaries', fromOrg.id ? { org_id: fromOrg.id } : { name: fromOrg.name }); setList((l) => (l.some((x) => x.id === b.id) ? l : [b, ...l])); onChange(String(b.id)); toast(b.ibans?.length ? 'Beneficiario pronto con IBAN' : 'Beneficiario creato: aggiungi l\'IBAN in Beneficiari e IBAN'); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cerca per nome o P.IVA" style={{ flex: '0 0 180px' }} />
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
          <option value="">Nessuno</option>
          {cur && !list.includes(cur) && <option value={cur.id}>{cur.name}</option>}
          {list.map((b) => <option key={b.id} value={b.id}>{b.name}{b.tax_id ? ` · ${b.tax_id}` : ''}{b.ibans?.length ? '' : ' · senza IBAN'}</option>)}
        </select>
        {fromOrg && <button type="button" className="btn sm ghost" disabled={busy} onClick={create}>{fromLabel}</button>}
      </div>
      {cur && <div className="small muted" style={{ marginTop: 4 }}>{cur.ibans?.length ? `IBAN ${cur.ibans[0].iban}${cur.ibans[0].verified_at ? ' (verificato)' : ' (da verificare)'}` : <span className="red">Nessun IBAN: aggiungilo in Beneficiari e IBAN prima di creare istanze</span>}</div>}
      <ErrorBox error={err} />
    </div>
  );
}

// Istanza di pagamento da una scadenza: conferma (e, per le stime, importo) prima di creare la bozza
function RequestModal({ event: e, onClose, onCreated }) {
  const toast = useToast();
  const [amount, setAmount] = useState(e.amount ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post('/scadenziario/events/request', { key: e.key, amount: amount === '' ? null : Number(amount) }); toast(`Istanza ${r.protocol || `n. ${r.id}`} creata in bozza`); onCreated(r); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal title="Crea istanza di pagamento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !(Number(amount) > 0)} onClick={go}>Crea istanza</button></>}>
      <ErrorBox error={err} />
      <div className="alert info" style={{ marginBottom: 12 }}><span><b>{e.title}</b> · {e.site_name} · {itDate(e.date)}{e.desc ? <div className="small">{e.desc}</div> : null}</span></div>
      <p className="small muted" style={{ marginTop: 0 }}>Nasce un'istanza in bozza con beneficiario, IBAN, importo, causale e valuta già compilati dalla scadenza; la completi (conto di addebito, verifiche, allegati) e la invii in firma dalla scheda dell'istanza. Quando viene eseguita, la scadenza si chiude da sola.</p>
      <div className="form-grid">
        <Field label={e.estimate ? 'Importo da pagare (la scadenza è una stima)' : 'Importo'} help={e.estimate ? 'Conferma o correggi l\'importo stimato' : 'Importo della scadenza; modificalo solo se diverso'}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
      </div>
    </Modal>
  );
}

// ---------------- Contratto in PDF: lettura con Claude ----------------
const CONF_TONE = { alta: 'green', media: 'mauve', bassa: 'red' };
const CONF_LABEL = { alta: 'confidenza alta', media: 'confidenza media', bassa: 'confidenza bassa' };
// Spilla colorata accanto al campo letto dal PDF: verde alta, gialla media, rossa bassa; al passaggio del mouse la citazione
function ConfPin({ c }) {
  if (!c) return null;
  return <span className={`conf-pin ${c.level}`} title={`${CONF_LABEL[c.level] || c.level}${c.quote ? `: "${c.quote}"` : ''}`} aria-label={CONF_LABEL[c.level] || c.level} />;
}

const DIFF_FIELDS = [['site_id', 'Sede'], ['landlord_org_id', 'Locatore (Legal entity)'], ['landlord_name', 'Locatore (nome)'], ['unit', 'Immobile / unità'], ['kind', 'Tipologia'], ['start_date', 'Decorrenza'], ['first_term_years', 'Primo periodo (anni)'], ['renewal_years', 'Rinnovo tacito (anni)'], ['notice_months', 'Preavviso (mesi)'], ['period_months', 'Periodicità'], ['amount', 'Importo della rata'], ['deposit', 'Deposito'], ['registration', 'Registrazione'], ['istat', 'ISTAT']];
const same = (a, b) => String(a ?? '') === String(b ?? '') || (a !== '' && b != null && Number(a) === Number(b) && !Number.isNaN(Number(a)));

// Riquadro in alto nel form: zona di caricamento, esito della lettura (sede e locatore abbinati, avvisi, scatti proposti) e,
// per un contratto esistente, le differenze campo per campo da applicare con una spunta
function PdfPanel({ edit, leaseId, ai, current, onAnalyzed, onApplyDiff, onOrgCreated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState({});
  const [drag, setDrag] = useState(false);
  const inputRef = React.useRef(null);
  const analyze = async (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setErr(new Error('Carica un file PDF')); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.upload(edit ? `/scadenziario/leases/${leaseId}/analizza` : '/scadenziario/leases/analizza', fd);
      const conf = r.proposta?.confidence || {};
      onAnalyzed({ document_id: r.document_id, proposta: r.proposta, avvisi: r.avvisi || [], confidence: conf, initial_steps: r.proposta?.initial_steps || [], model: r.model, filename: file.name, pages: r.pages, ocr: r.ocr });
      if (edit) setSel({});
      toast(edit ? 'Contratto riletto: controlla le differenze' : 'Contratto letto: controlla i campi e salva');
    } catch (e) { setErr(e); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const createOrg = async () => {
    setBusy(true); setErr(null);
    try { const o = await api.post('/scadenziario/organizations', { from_document_id: ai.document_id }); onOrgCreated(o); toast(o.existing ? `Legal entity già presente: ${o.name}` : `Legal entity ${o.name} creata (da rivedere in Amministrazione)`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const diffs = edit && ai ? DIFF_FIELDS.map(([k, label]) => ({ k, label, cur: current[k], read: ai.proposta?.lease?.[k] })).filter((d) => d.read != null && !same(d.cur, d.read)) : [];
  const fmt = (k, v) => (v == null || v === '' ? '–' : k === 'kind' ? LEASE_KIND[v] || v : k === 'registration' ? REGISTRATION[v] || v : k === 'period_months' ? PERIOD[v] || v : ['amount', 'deposit'].includes(k) ? eur(v) : k === 'start_date' ? itDate(v) : k === 'istat' ? (v ? 'sì' : 'no') : k === 'site_id' ? (ai?.proposta?.site_id === Number(v) ? ai.proposta.site_label : `sede ${v}`) : k === 'landlord_org_id' ? (ai?.proposta?.landlord_org_id === Number(v) ? ai.proposta.landlord_label : `Legal entity ${v}`) : String(v));
  return (
    <div className={`pdf-panel ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); analyze(e.dataTransfer.files?.[0]); }}>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <Icon name="file" size={22} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>{edit ? 'Rileggi dal PDF' : 'Carica il contratto in PDF'}</b>
          <div className="small muted">{edit ? 'Claude rilegge il contratto e propone le differenze rispetto ai dati salvati: le applichi con una spunta.' : 'Claude legge locatore, sede, canone e durata e precompila i campi: controlli e salvi tu, niente salvataggio automatico.'}{busy ? ' Lettura in corso…' : ''}</div>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => analyze(e.target.files?.[0])} />
        <button type="button" className="btn ghost" disabled={busy} onClick={() => inputRef.current?.click()}><Icon name="upload" size={16} />{busy ? 'Lettura…' : ai ? 'Altro PDF' : 'Scegli il PDF'}</button>
      </div>
      <ErrorBox error={err} />
      {ai && (
        <div className="pdf-result">
          <div className="small"><b>{ai.filename}</b>{ai.pages ? ` · ${ai.pages} pagine` : ''}{ai.ocr ? ' · OCR' : ''}{ai.model ? ` · lettura ${ai.model === 'mock' ? 'di prova' : ai.model}` : ''}</div>
          <div className="small" style={{ marginTop: 4 }}>
            Sede: {ai.proposta?.site_id ? <><b>{ai.proposta.site_label}</b> <span className="muted">({ai.proposta.site_how})</span></> : <span className="red">non abbinata</span>} · Locatore: {ai.proposta?.landlord_org_id ? <><b>{ai.proposta.landlord_label}</b> <span className="muted">({ai.proposta.landlord_how})</span></> : <><span className="red">non in anagrafica</span> <button type="button" className="btn sm ghost" disabled={busy} onClick={createOrg}>Crea Legal entity dal contratto</button></>}
            {ai.proposta?.beneficiary_id ? <> · Beneficiario Payments: <b>{ai.proposta.beneficiary_label}</b></> : null}
          </div>
          {!edit && ai.initial_steps?.length > 1 && <div className="small" style={{ marginTop: 4 }}>Scatti proposti: {ai.initial_steps.map((st) => `${itDate(st.valid_from)} ${eur(st.amount)}${st.reason === 'INIZIALE' ? ' (a regime)' : ''}`).join(' · ')}</div>}
          {ai.avvisi?.length > 0 && <div className="alert warn" style={{ marginTop: 8, flexDirection: 'column', gap: 2 }}>{ai.avvisi.map((a, i) => <div key={i} className="small">{a}</div>)}</div>}
          {edit && (diffs.length ? (
            <div style={{ marginTop: 8 }}>
              <table className="t diff"><thead><tr><th /><th>Campo</th><th>Attuale</th><th>Letto nel PDF</th><th /></tr></thead>
                <tbody>{diffs.map((d) => <tr key={d.k}><td><input type="checkbox" checked={!!sel[d.k]} onChange={(e) => setSel({ ...sel, [d.k]: e.target.checked })} /></td><td>{d.label}</td><td className="muted">{fmt(d.k, d.cur)}</td><td><b>{fmt(d.k, d.read)}</b> <ConfPin c={ai.confidence?.[d.k]} /></td><td className="small muted">{ai.confidence?.[d.k]?.quote ? `"${ai.confidence[d.k].quote.slice(0, 90)}${ai.confidence[d.k].quote.length > 90 ? '…' : ''}"` : ''}</td></tr>)}</tbody></table>
              <div className="row" style={{ marginTop: 6 }}><button type="button" className="btn sm" disabled={!Object.values(sel).some(Boolean)} onClick={() => { onApplyDiff(Object.keys(sel).filter((k) => sel[k])); setSel({}); toast('Differenze applicate: controlla e salva'); }}>Applica le differenze selezionate</button><button type="button" className="btn sm ghost" onClick={() => setSel(Object.fromEntries(diffs.map((d) => [d.k, true])))}>Seleziona tutte</button></div>
            </div>
          ) : <div className="small muted" style={{ marginTop: 6 }}>Nessuna differenza tra il contratto salvato e quanto letto nel PDF.</div>)}
        </div>
      )}
    </div>
  );
}

// Documenti del contratto nella scheda Strutture: icona, download inline, eliminazione e "Aggiungi documento" (allegato senza analisi)
function LeaseDocs({ lease, canWrite, onChanged }) {
  const toast = useToast();
  const inputRef = React.useRef(null);
  const [busy, setBusy] = useState(false);
  const docs = lease.documents || [];
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); await api.upload(`/scadenziario/leases/${lease.id}/documenti`, fd); toast('Documento allegato'); onChanged?.(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const del = async (d) => { if (!window.confirm(`Eliminare il documento ${d.filename}?`)) return; try { await api.del(`/scadenziario/documenti/${d.id}`); toast('Documento eliminato'); onChanged?.(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="lease-docs small">
      {docs.map((d) => <span key={d.id} className="doc-chip" title={`${d.filename} · ${Math.round(d.size / 1024)} KB${d.analyzed ? ' · letto con Claude' : ''}`}><Icon name="file" size={13} /><a href={fileUrl(`/scadenziario/documenti/${d.id}`)} target="_blank" rel="noreferrer">{d.filename.length > 28 ? `${d.filename.slice(0, 25)}…` : d.filename}</a>{d.analyzed && <span className="muted" title="Letto con Claude">AI</span>}{canWrite && <button type="button" className="iconbtn" title="Elimina" onClick={() => del(d)}>✕</button>}</span>)}
      {canWrite && <><input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} /><button type="button" className="btn link small" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Caricamento…' : docs.length ? '+ documento' : '+ Aggiungi documento'}</button></>}
    </div>
  );
}
