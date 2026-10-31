// Casella People (people@toscanadiagnostica.it): documenti arrivati in risposta ai richiami sulle scadenze, da verificare.
// Il CEO (titolare della Suite) o l'HR Manager (profilo HR o ADMIN) controllano abbinamento, categoria e scadenza proposti e
// approvano: l'allegato entra nel dossier e la scadenza si chiude. Rifiuta (con motivo, email alla persona) e Ignora.
// In fondo il registro dei richiami inviati; le impostazioni della casella sono in Impostazioni (PeopleSettings).
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs, BASE, API_BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, Modal, PromptModal, useToast, Icon } from '../components/ui.jsx';
import { itDate, itDateTime, bytes, DEADLINE_STATE } from '../format.js';

export const canApprove = (u) => u?.suite_level === 'OWNER' || ['ADMIN', 'HR'].includes(u?.role);
const STATUS = { DA_APPROVARE: { label: 'Da approvare', tone: 'amber' }, APPROVATO: { label: 'Approvato', tone: 'green' }, RIFIUTATO: { label: 'Rifiutato', tone: 'red' }, IGNORATO: { label: 'Ignorato', tone: 'grey' } };
const MATCH = { 'TD-SCAD': 'identificativo TD-SCAD', EMAIL: 'email del mittente', NOME: 'nome nel soggetto', INTESTATARIO: 'intestatario del documento', MANUALE: 'scelta manuale' };
const matchLabel = (m) => (m ? m.split('+').map((x) => (x === 'CATEGORIA' ? 'categoria del documento' : MATCH[x] || x)).join(' + ') : 'da assegnare');
const REM_STATUS = { INVIATO: 'green', REGISTRATO: 'blue', FALLITO: 'red', SENZA_DESTINATARIO: 'amber' };
const METHOD = { claude: 'lettura con Claude', mock: 'lettura di prova (CONTRACTS_AI_MOCK)', euristica: 'lettura per parole chiave', nessuna: 'testo non leggibile' };

export default function PeopleInbox() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('DA_APPROVARE');
  const [sel, setSel] = useState(null);
  const stato = useApi('/people-inbox/stato');
  const list = useApi(tab === 'RICHIAMI' ? null : `/people-inbox${qs({ status: tab === 'TUTTI' ? '' : tab })}`, [tab]);
  const rem = useApi(tab === 'RICHIAMI' ? '/people-inbox/richiami' : null, [tab]);
  const [busy, setBusy] = useState(false);
  if (!canApprove(user)) return <div className="page"><div className="alert warn">La casella People è riservata al CEO e all'HR Manager.</div></div>;
  const s = stato.data;
  const pollNow = async () => { setBusy(true); try { const r = await api.post('/people-inbox/leggi'); toast(r.skipped ? `Lettura non eseguita: ${r.skipped.replace(/_/g, ' ')}` : `${r.created} messaggi nuovi su ${r.fetched} letti`); list.reload(); stato.reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const remindNow = async () => { setBusy(true); try { const r = await api.post('/people-inbox/richiami/esegui', {}); toast(`Richiami: ${r.inviati} inviati, ${r.registrati} nel registro, ${r.falliti} non riusciti, ${r.senza_destinatario} senza destinatario`); rem.reload(); stato.reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Casella People</h1><div className="sub">Documenti inviati a {s?.mailbox || 'people@toscanadiagnostica.it'} a supporto della chiusura delle scadenze. Nulla entra nel dossier senza l'approvazione del CEO o dell'HR Manager.</div></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={remindNow} title="Esegue subito il giro dei richiami (ogni scadenza e soglia una volta sola)"><Icon name="mail" />Invia ora i richiami</button>
          <button className="btn ghost" disabled={busy} onClick={pollNow}><Icon name="download" />Leggi ora</button>
        </div>
      </div>
      {s && (
        <div className={`alert ${s.read_error || s.send_error ? 'warn' : 'info'} small`} style={{ marginBottom: 12, display: 'block' }}>
          <b>{s.mailbox}</b>{s.mailbox_source === 'env' ? ' (da CONTRACTS_PEOPLE_MAILBOX)' : ''} ·
          lettura {s.read_enabled ? 'automatica ogni 10 minuti' : 'disattivata'}{s.graph_configured ? '' : ' (credenziali Microsoft Graph assenti: si legge solo con la simulazione di collaudo)'}
          {s.last_read ? `, ultima ${itDateTime(s.last_read)}` : ''} ·
          richiami {s.send_enabled ? `attivi (${s.thresholds.join(', ')} giorni prima)` : 'disattivati'}{s.mail_provider !== 'graph' ? ', posta in modalità registro: le email restano nel registro, nessun invio reale' : ''}
          {s.last_send ? `, ultimo invio ${itDateTime(s.last_send)}` : ''}.
          {s.read_error && <div style={{ marginTop: 4 }}>Ultimo errore di lettura: {s.read_error}</div>}
          {s.send_error && <div style={{ marginTop: 4 }}>Ultimo errore di invio: {s.send_error}</div>}
          {['ADMIN', 'HR'].includes(user.role) && <div style={{ marginTop: 4 }}><Link to={`${BASE}/impostazioni`}>Impostazioni della casella People</Link></div>}
        </div>
      )}
      <div className="tabs" style={{ marginBottom: 12 }}>
        {[['DA_APPROVARE', `Da approvare${s ? ` (${s.inbox.da_approvare})` : ''}`], ['APPROVATO', 'Approvati'], ['RIFIUTATO', 'Rifiutati'], ['IGNORATO', 'Ignorati'], ['TUTTI', 'Tutti'], ['RICHIAMI', 'Registro dei richiami']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSel(null); }}>{l}</button>)}
      </div>
      {tab === 'RICHIAMI' ? <Reminders rem={rem} /> : (
        <div className="grid g3" style={{ gridTemplateColumns: sel ? 'minmax(0,0.9fr) minmax(0,1.5fr)' : '1fr', alignItems: 'start' }}>
          <Card flush>
            <ErrorBox error={list.error} />
            {!list.data ? <Loading /> : !list.data.length ? <Empty>{tab === 'DA_APPROVARE' ? 'Nessun documento da approvare' : 'Nessun messaggio'}</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Ricevuto</th><th>Mittente e oggetto</th>{!sel && <th>Persona</th>}<th className="num">Stato</th></tr></thead>
                <tbody>{list.data.map((m) => (
                  <tr key={m.id} className="click" onClick={() => setSel(m.id === sel ? null : m.id)} style={m.id === sel ? { background: 'var(--teal-050)' } : undefined}>
                    <td className="small">{itDateTime(m.received_at)}{m.source === 'SIMULAZIONE' && <div><Badge>simulazione</Badge></div>}</td>
                    <td><div className="strong">{m.from_name || m.from_email}</div><div className="small muted">{m.subject || '(senza oggetto)'} · {m.files} allegat{m.files === 1 ? 'o' : 'i'}</div>{sel && <div className="small">{m.resource_id ? `${m.last_name} ${m.first_name}` : <Badge tone="amber">da assegnare</Badge>}</div>}</td>
                    {!sel && <td>{m.resource_id ? `${m.last_name} ${m.first_name}` : <Badge tone="amber">da assegnare</Badge>}<div className="small muted">{matchLabel(m.match_method)}</div></td>}
                    <td className="num"><Badge tone={STATUS[m.status]?.tone}>{STATUS[m.status]?.label}</Badge></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
          {sel && <MessageDetail key={sel} id={sel} onClose={() => setSel(null)} onDone={() => { list.reload(); stato.reload(); window.dispatchEvent(new Event('suite:badges')); }} />}
        </div>
      )}
    </div>
  );
}

function Reminders({ rem }) {
  if (rem.error) return <ErrorBox error={rem.error} />;
  if (!rem.data) return <Loading />;
  if (!rem.data.length) return <Card><Empty>Nessun richiamo inviato finora</Empty></Card>;
  return (
    <Card flush title={`Richiami inviati · ${rem.data.length}`}>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Inviato</th><th>Persona e scadenza</th><th>Anticipo</th><th>Destinatari</th><th className="num">Esito</th></tr></thead>
        <tbody>{rem.data.map((x) => (
          <tr key={x.id}>
            <td className="small">{itDateTime(x.sent_at)}</td>
            <td>{x.resource_id ? <Link to={`${BASE}/risorse/${x.resource_id}`} className="strong">{x.last_name} {x.first_name}</Link> : '–'}<div className="small muted">{x.title} · {itDate(x.due_date)} · TD-SCAD-{x.deadline_key}</div></td>
            <td>{x.days_before === 0 ? 'il giorno stesso' : `${x.days_before} giorni prima`}</td>
            <td className="small">{x.recipient === 'HR' ? <Badge>HR</Badge> : <Badge tone="blue">persona</Badge>} {x.to_email || '–'}{x.cc_email ? <div className="muted">copia: {x.cc_email}</div> : null}<div className="muted">da {x.from_email}</div></td>
            <td className="num"><Badge tone={REM_STATUS[x.status]}>{x.status.toLowerCase().replace('_', ' ')}</Badge>{x.error && <div className="small muted" style={{ maxWidth: 260, marginLeft: 'auto' }}>{x.error}</div>}</td>
          </tr>))}</tbody>
      </table></div>
    </Card>
  );
}

function MessageDetail({ id, onClose, onDone }) {
  const toast = useToast();
  const d = useApi(`/people-inbox/${id}`, [id]);
  const people = useApi('/resources?status=ATTIVO,IMPEGNO');
  const [v, setV] = useState(null);
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [fix, setFix] = useState(false);          // correzione della scadenza dopo l'approvazione
  const [fixKey, setFixKey] = useState('');
  useEffect(() => {
    if (!d.data) return;
    const m = d.data.message;
    setV({ resource_id: m.resource_id || '', deadline_key: m.deadline_key || '', note: '' });
    setFiles(d.data.files.map((f) => ({ id: f.id, include: f.include, category: f.approved_category || f.proposed_category || 'ALTRO', expires_at: f.approved_expires_at || f.proposed_expires_at || '' })));
  }, [d.data]);
  const peopleList = useMemo(() => (people.data || []).filter((p) => !q || `${p.last_name} ${p.first_name}`.toLowerCase().includes(q.toLowerCase())), [people.data, q]);
  if (!d.data || !v) return <Card><Loading /></Card>;
  const { message: m, deadlines, category_labels: CL } = d.data;
  const open = m.status === 'DA_APPROVARE';
  const assign = async (patch) => { try { await api.put(`/people-inbox/${id}`, patch); d.reload(); onDone(); } catch (e) { toast(e.message, 'err'); } };
  const setF = (fid, patch) => setFiles(files.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
  const approve = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/people-inbox/${id}/approva`, { resource_id: Number(v.resource_id), deadline_key: v.deadline_key || null, note: v.note || null, files: files.map((f) => ({ id: f.id, include: f.include, category: f.category, expires_at: f.expires_at || null })) });
      toast(`Approvato: ${r.attachments.length} allegat${r.attachments.length === 1 ? 'o' : 'i'} nel dossier${r.closure ? `, ${r.closure}` : ''}`);
      d.reload(); onDone();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  // Correzione dopo l'approvazione: abbina (o cambia) la scadenza e chiudila con gli allegati già nel dossier
  const closeLater = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/people-inbox/${id}/chiudi-scadenza`, { deadline_key: fixKey });
      toast(`Scadenza abbinata e chiusa${r.closure ? `: ${r.closure}` : ''}`);
      setFix(false); d.reload(); onDone();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const person = (people.data || []).find((p) => p.id === Number(v.resource_id));
  return (
    <Card title={m.subject || '(senza oggetto)'} actions={<button className="iconbtn" onClick={onClose} aria-label="Chiudi">✕</button>}>
      <div className="small muted" style={{ marginBottom: 8 }}>Da <b>{m.from_name ? `${m.from_name} ` : ''}&lt;{m.from_email || 'sconosciuto'}&gt;</b> · {itDateTime(m.received_at)} · abbinamento: {matchLabel(m.match_method)}{m.source === 'SIMULAZIONE' ? ' · messaggio simulato (collaudo)' : ''}</div>
      {m.body_text && <details style={{ marginBottom: 10 }}><summary className="small">Testo del messaggio</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', background: 'var(--bg-soft, #f3f6f6)', padding: 8, borderRadius: 8 }}>{m.body_text}</pre></details>}
      {!open && <div className={`alert ${m.status === 'APPROVATO' ? 'ok' : m.status === 'RIFIUTATO' ? 'err' : 'info'} small`} style={{ display: 'block', marginBottom: 10 }}><b>{STATUS[m.status].label}</b> da {m.decided_by_name || '–'} il {itDateTime(m.decided_at)}{m.note ? ` · ${m.note}` : ''}</div>}
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Persona" help={open ? 'Cerca e scegli la persona a cui appartiene il documento' : null}>
          {open ? <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per cognome o nome" style={{ marginBottom: 6 }} />
            <select value={v.resource_id} onChange={(e) => { setV({ ...v, resource_id: e.target.value, deadline_key: '' }); assign({ resource_id: e.target.value ? Number(e.target.value) : null }); }}>
              <option value="">da assegnare</option>
              {m.resource_id && !peopleList.some((p) => p.id === m.resource_id) && <option value={m.resource_id}>{m.last_name} {m.first_name}</option>}
              {peopleList.map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}{p.email ? ` · ${p.email}` : ''}</option>)}
            </select>
          </> : <div>{m.resource_id ? <Link to={`${BASE}/risorse/${m.resource_id}`}>{m.last_name} {m.first_name}</Link> : '–'}</div>}
        </Field>
        <Field label="Scadenza da chiudere" help={open ? 'Proposta dall\'identificativo TD-SCAD o dalla categoria del documento' : null}>
          {open ? <select value={v.deadline_key} disabled={!v.resource_id} onChange={(e) => { setV({ ...v, deadline_key: e.target.value }); assign({ deadline_key: e.target.value || null }); }}>
            <option value="">nessuna (solo upload nel dossier)</option>
            {deadlines.map((x) => <option key={x.key} value={x.key}>{itDate(x.due_date)} · {x.title} ({x.days < 0 ? `scaduta da ${-x.days} gg` : `tra ${x.days} gg`})</option>)}
          </select> : <div>{m.deadline_key ? `TD-SCAD-${m.deadline_key}` : '–'}{m.status === 'APPROVATO' && m.resource_id && !fix && <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => { setFix(true); setFixKey(m.deadline_key || ''); }}>{m.deadline_key ? 'Cambia' : 'Abbina e chiudi'}</button>}</div>}
        </Field>
      </div>
      {fix && (
        <div className="alert info small" style={{ display: 'block', margin: '6px 0 10px' }}>
          <div style={{ marginBottom: 6 }}><b>Correzione dopo l'approvazione.</b> Gli allegati sono già nel dossier di {m.last_name} {m.first_name}: scegli la scadenza da collegare e chiudere.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={fixKey} onChange={(e) => setFixKey(e.target.value)} style={{ flex: 1, minWidth: 260 }}>
              <option value="">scegli la scadenza</option>
              {deadlines.map((x) => <option key={x.key} value={x.key}>{itDate(x.due_date)} · {x.title} ({x.state === 'CHIUSA' ? 'chiusa' : x.days < 0 ? `scaduta da ${-x.days} gg` : `tra ${x.days} gg`})</option>)}
            </select>
            <button className="btn" disabled={busy || !fixKey} onClick={closeLater}><Icon name="check" />Abbina e chiudi</button>
            <button className="btn ghost" onClick={() => setFix(false)}>Annulla</button>
          </div>
        </div>
      )}
      {v.deadline_key && (() => { const x = deadlines.find((y) => y.key === v.deadline_key); return x ? <div className="small" style={{ margin: '6px 0' }}><Badge tone={DEADLINE_STATE[x.state]}>{x.title} · {itDate(x.due_date)}</Badge> <span className="muted">TD-SCAD-{x.key}</span></div> : null; })()}
      <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>Allegati</h3>
      {d.data.files.map((f) => {
        const st = files.find((x) => x.id === f.id) || {};
        const holderMismatch = f.proposed_holder && person && !`${person.last_name} ${person.first_name}`.toLowerCase().includes(f.proposed_holder.toLowerCase().split(' ')[0]);
        return (
          <div key={f.id} className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div><div className="strong">{f.filename}</div><div className="small muted">{bytes(f.size)} · {METHOD[f.method] || f.method}{f.confidence != null ? ` · confidenza ${Math.round(f.confidence * 100)}%` : ''}</div></div>
              <div className="row" style={{ gap: 6 }}>
                {/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.mime) && <button className="btn sm ghost" onClick={() => setPreview({ url: `${API_BASE}/people-inbox/files/${f.id}?inline=1`, title: f.filename, mime: f.mime })}><Icon name="eye" />Anteprima</button>}
                <a className="btn sm ghost" href={`${API_BASE}/people-inbox/files/${f.id}`}>Scarica</a>
                {f.attachment_id && m.resource_id && <Link className="btn sm ghost" to={`${BASE}/risorse/${m.resource_id}`}>Nel dossier</Link>}
              </div>
            </div>
            {(f.proposed_holder || f.quote) && <div className="small" style={{ marginTop: 6 }}>{f.proposed_holder && <>Intestatario letto: <b>{f.proposed_holder}</b>{holderMismatch && <Badge tone="red">diverso dalla persona scelta</Badge>} </>}{f.quote && <span className="muted">«{f.quote}»</span>}</div>}
            <div className="form-grid" style={{ marginTop: 6 }}>
              <Field label="Categoria del dossier"><select value={st.category || ''} disabled={!open || !st.include} onChange={(e) => setF(f.id, { category: e.target.value })}>{Object.entries(CL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Scadenza del documento"><input type="date" value={st.expires_at || ''} disabled={!open || !st.include} onChange={(e) => setF(f.id, { expires_at: e.target.value })} /></Field>
            </div>
            {open && <label className="small"><input type="checkbox" checked={Boolean(st.include)} onChange={(e) => setF(f.id, { include: e.target.checked })} /> carica questo allegato nel dossier</label>}
          </div>);
      })}
      {open && <>
        <Field label="Nota (facoltativa)" help="Resta nel registro; per prova e contratto è la nota di chiusura"><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="es. polizza verificata, massimale corretto" /></Field>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy || !v.resource_id || !files.some((f) => f.include)} onClick={approve}><Icon name="check" />Approva: carica nel dossier{v.deadline_key ? ' e chiudi la scadenza' : ''}</button>
          <button className="btn danger" disabled={busy} onClick={() => setModal('reject')}>Rifiuta</button>
          <button className="btn ghost" disabled={busy} onClick={() => setModal('ignore')}>Ignora</button>
        </div>
        {!v.resource_id && <div className="small muted" style={{ marginTop: 6 }}>Per approvare scegli prima la persona.</div>}
      </>}
      {preview && <Modal title={preview.title} onClose={() => setPreview(null)} wide>{preview.mime === 'application/pdf' ? <iframe title={preview.title} src={preview.url} style={{ width: '100%', height: '70vh', border: 0 }} /> : <img src={preview.url} alt={preview.title} style={{ maxWidth: '100%' }} />}</Modal>}
      {modal === 'reject' && <PromptModal danger title="Rifiuta il documento" label="Motivo (viene scritto alla persona: cosa manca o cosa non va)" placeholder="es. la polizza allegata è quella scaduta: serve la quietanza di rinnovo 2027" confirmText="Rifiuta e avvisa" minLength={5} onClose={() => setModal(null)} onConfirm={async (reason) => { await api.post(`/people-inbox/${id}/rifiuta`, { reason }); toast('Rifiutato: la persona riceve il motivo da people@'); d.reload(); onDone(); }} />}
      {modal === 'ignore' && <PromptModal title="Ignora il messaggio" label="Nota (es. spam, non pertinente)" confirmText="Ignora" minLength={0} onClose={() => setModal(null)} onConfirm={async (note) => { await api.post(`/people-inbox/${id}/ignora`, { note: note || null }); toast('Messaggio ignorato'); d.reload(); onDone(); }} />}
    </Card>
  );
}

// ---------------- Impostazioni della casella People (Contracts > Impostazioni, ADMIN e HR) ----------------
const TYPE_LABELS = { DOCUMENTO: 'Documenti (attestati, certificati, idoneità, polizze, identità, permessi)', PROVA: 'Fine periodo di prova', CONTRATTO: 'Contratti e incarichi', MANUALE: 'Scadenze manuali', IMPEGNO: 'Lettere di impegno', RAL: 'Scatti RAL (sempre HR)', MBO: 'MBO (sempre HR)' };
export function PeopleSettings() {
  const toast = useToast();
  const st = useApi('/people-inbox/stato');
  const [v, setV] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) setV({ people_mailbox: st.data.mailbox, people_send_enabled: st.data.send_enabled, people_read_enabled: st.data.read_enabled, people_reminder_days: st.data.thresholds.join(', '), people_hr_cc: st.data.hr_cc.join(', '), people_reminder_map: st.data.map }); }, [st.data]);
  if (st.error) return <Card title="Casella People"><ErrorBox error={st.error} /></Card>;
  if (!st.data || !v) return <Card title="Casella People"><Loading /></Card>;
  const s = st.data;
  const save = async () => { try { const body = { ...v }; if (s.env_override) delete body.people_mailbox; await api.put('/people-inbox/impostazioni', body); toast('Impostazioni della casella People salvate'); st.reload(); } catch (e) { toast(e.message, 'err'); } };
  const run = async (fn) => { setBusy(true); setRes(null); try { setRes(await fn()); } catch (e) { setRes({ ok: false, message: e.message }); } setBusy(false); };
  return (
    <Card title="Casella People: richiami sulle scadenze e documenti in arrivo" className="span2" actions={<button className="btn sm" onClick={save}>Salva</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>I richiami partono dalla casella People verso il diretto destinatario della scadenza; le risposte con allegati arrivano in <Link to={`${BASE}/casella-people`}>Casella People</Link> e il CEO o l'HR Manager le approvano. Servono sull'app registration della Suite i permessi applicativi Microsoft Graph <b>Mail.Read</b> e <b>Mail.Send</b> su questa casella.</p>
      <div className="form-grid">
        <Field label="Indirizzo della casella" help={s.env_override ? 'Impostato da CONTRACTS_PEOPLE_MAILBOX su Render: si cambia lì' : 'Predefinito people@toscanadiagnostica.it'}><input value={v.people_mailbox} disabled={s.env_override} onChange={(e) => setV({ ...v, people_mailbox: e.target.value })} /></Field>
        <Field label="Giorni di anticipo dei richiami" help="Separati da virgola; 0 = il giorno stesso"><input value={v.people_reminder_days} onChange={(e) => setV({ ...v, people_reminder_days: e.target.value })} placeholder="60, 30, 7, 0" /></Field>
        <Field label="Invia i richiami ai destinatari"><label className="small"><input type="checkbox" checked={v.people_send_enabled} onChange={(e) => setV({ ...v, people_send_enabled: e.target.checked })} /> invio automatico (ogni ora, una sola volta per scadenza e anticipo)</label></Field>
        <Field label="Leggi la casella"><label className="small"><input type="checkbox" checked={v.people_read_enabled} onChange={(e) => setV({ ...v, people_read_enabled: e.target.checked })} /> lettura automatica ogni 10 minuti</label></Field>
        <Field label="Copia a HR (HR Manager o lista)" className="span2" help={`Indirizzi in copia ai richiami alla persona e destinatari dei richiami interni. Vuoto = utenti con profilo HR sul modulo${s.hr_effective.length ? ` (oggi: ${s.hr_effective.join(', ')})` : ' (oggi nessuno)'}`}><input value={v.people_hr_cc} onChange={(e) => setV({ ...v, people_hr_cc: e.target.value })} placeholder="hr.manager@toscanadiagnostica.it" /></Field>
      </div>
      <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Destinatario per tipo di scadenza</h3>
      <div className="form-grid">{Object.keys(TYPE_LABELS).map((k) => <Field key={k} label={TYPE_LABELS[k]}><select value={v.people_reminder_map[k]} disabled={k === 'RAL' || k === 'MBO'} onChange={(e) => setV({ ...v, people_reminder_map: { ...v.people_reminder_map, [k]: e.target.value } })}><option value="PERSONA">Persona (con copia a HR)</option><option value="HR">HR</option><option value="NESSUNO">Nessun richiamo</option></select></Field>)}</div>
      <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Prove e stato</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Indirizzo per la prova di invio"><input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="nome.cognome@toscanadiagnostica.it" /></Field>
        <button className="btn sm ghost" disabled={busy || !testTo} onClick={() => run(() => api.post('/people-inbox/prova-invio', { to: testTo }))}>Prova l'invio</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => run(() => api.post('/people-inbox/prova-casella'))}>Prova la casella</button>
      </div>
      {res && <div className={`alert ${res.ok ? 'ok' : 'err'} small`} style={{ display: 'block', marginTop: 8 }}>{res.message}{res.steps && <div style={{ marginTop: 6 }}>{res.steps.map((x, i) => <div key={i}><Badge tone={x.ok ? 'green' : 'red'}>{x.ok ? 'ok' : 'no'}</Badge> <b>{x.step}</b> · {x.detail}</div>)}</div>}</div>}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Microsoft Graph: {s.graph_configured ? <Badge tone="green">credenziali presenti</Badge> : <Badge tone="grey">credenziali assenti</Badge>} · posta in uscita: {s.mail_provider === 'graph' ? <Badge tone="green">Microsoft 365</Badge> : <Badge tone="grey">solo registro</Badge>} · lettura dei documenti: {s.ai_mock ? <Badge tone="amber">di prova (CONTRACTS_AI_MOCK)</Badge> : s.ai_enabled ? <Badge tone="green">Claude</Badge> : <Badge tone="grey">parole chiave (chiave Anthropic assente)</Badge>}<br />
        Ultima lettura: {s.last_read ? itDateTime(s.last_read) : 'mai'}{s.read_error ? ` · errore: ${s.read_error}` : ''} · ultimo invio: {s.last_send ? itDateTime(s.last_send) : 'mai'}{s.send_error ? ` · errore: ${s.send_error}` : ''}
      </p>
    </Card>
  );
}
