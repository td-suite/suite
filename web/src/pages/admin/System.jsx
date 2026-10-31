import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useAuth, isOwner } from '../../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, Coming, ErrorBox, PageHead, Field, SearchInput, useToast, Modal, Switch, ConfirmModal, CopyButton, Tabs, MultiSelect } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, timeAgo, AREA_NAMES, AREA_COLORS } from '../../format.js';
import { LegacyRefs } from './Registry.jsx';

// ---------- Moduli ----------
export function Modules() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/modules');
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [secret, setSecret] = useState(null);
  const owner = isOwner(user);
  const toggle = async (m) => { try { await api.put(`/modules/${m.key}`, { active: !m.active }); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title="Moduli" icon="grid" sub="Catalogo dei widget della Suite: applicazioni legacy, moduli nativi e vetrine pubbliche" />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={5} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && <div className="table-wrap"><table className="t"><thead><tr><th>Modulo</th><th>Area</th><th>Tipo</th><th>URL legacy</th><th>SSO</th><th>Attivo</th><th></th></tr></thead><tbody>
          {data.map((m) => <tr key={m.key}>
            <td><div className="row tight" style={{ flexWrap: 'nowrap' }}><Icon name={m.icon} style={{ width: 30, height: 30, color: AREA_COLORS[m.area] }} /><div><div className="strong">{m.name}{m.restricted && <Icon name="lock" style={{ width: 13, height: 13, marginLeft: 6, color: 'var(--muted)' }} title="Riservato" />}</div><div className="tiny muted">{m.key} · {(m.profiles || []).length} profili</div></div></div></td>
            <td className="small">{AREA_NAMES[m.area] || m.area}</td>
            <td><Badge tone={m.kind === 'NATIVE' ? 'teal' : m.kind === 'PUBLIC' ? 'blue' : 'grey'}>{{ NATIVE: 'Nativo', LEGACY: 'Legacy', PUBLIC: 'Pubblico' }[m.kind]}</Badge></td>
            <td className="small">{m.legacy_url ? <a href={m.legacy_url} target="_blank" rel="noopener noreferrer">{m.legacy_url.replace(/^https?:\/\//, '')}</a> : <span className="faint">{m.route}</span>}</td>
            <td>{m.kind === 'NATIVE' ? <span className="faint small">n/d</span> : m.sso_configured ? <Badge tone="green">Configurato</Badge> : <Badge tone="amber">Mancante</Badge>}</td>
            <td><Switch checked={m.active} onChange={() => toggle(m)} label={`Attivo ${m.name}`} /></td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setEdit(m)}><Icon name="edit" /></button>{owner && m.kind !== 'NATIVE' && <button className="btn sm ghost" onClick={() => setSecret(m)}><Icon name="key" />Segreto SSO</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {edit && <ModuleModal m={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {secret && (
        <Modal title={`Segreto SSO · ${secret.name}`} onClose={() => setSecret(null)}>
          <p className="muted">Il segreto condiviso (HMAC) va impostato anche nell'app legacy. Almeno 24 caratteri. Viene salvato cifrato e non è più leggibile da qui.</p>
          <form onSubmit={async (e) => { e.preventDefault(); const v = e.target.secret.value; try { await api.put(`/modules/${secret.key}`, { sso_secret: v }); toast('Segreto SSO impostato'); setSecret(null); reload(); } catch (e2) { toast(e2, 'err'); } }} className="col">
            <Field label="Nuovo segreto"><input name="secret" type="password" minLength={24} required autoComplete="new-password" autoFocus /></Field>
            <div className="row end"><button className="btn">Salva</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ModuleModal({ m, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: m.name, tagline: m.tagline || '', legacy_url: m.legacy_url || '', sort_order: m.sort_order ?? 100 });
  const save = async (e) => { e.preventDefault(); try { await api.put(`/modules/${m.key}`, { name: f.name, tagline: f.tagline || null, legacy_url: m.kind === 'NATIVE' ? undefined : (f.legacy_url || null), sort_order: Number(f.sort_order) }); toast('Modulo aggiornato'); onSaved(); onClose(); } catch (e2) { toast(e2, 'err'); } };
  return (
    <Modal title={`Modifica ${m.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="mform">Salva</button></>}>
      <form id="mform" onSubmit={save} className="col">
        <Field label="Nome"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Tagline" help="Due righe al massimo nel riquadro della home"><input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Field>
        {m.kind !== 'NATIVE' && <Field label="URL dell'applicazione"><input type="url" value={f.legacy_url} onChange={(e) => setF({ ...f, legacy_url: e.target.value })} /></Field>}
        <Field label="Ordine nell'area"><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ---------- Sorgenti legacy ----------
// Modale per impostare una credenziale cifrata (connessione DB legacy, chiave Anthropic, Azure): solo titolare
function CredentialModal({ title, help, placeholder, statusUrl, statusKey, saveUrl, field, onClose, onSaved }) {
  const toast = useToast();
  const status = useApi(statusUrl);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const st = statusKey ? status.data?.[statusKey] : status.data;
  const save = async (clear) => {
    setBusy(true);
    try { await api.put(saveUrl, { [field]: clear ? null : value.trim() }); toast(clear ? 'Credenziale rimossa' : 'Credenziale verificata e salvata'); onSaved?.(); onClose(); }
    catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      {st?.set && st.source === 'db' && <button className="btn ghost danger" disabled={busy} onClick={() => save(true)}>Rimuovi</button>}
      <span className="spacer" /><button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={busy || !value.trim() || st?.source === 'env'} onClick={() => save(false)}>{busy ? 'Verifica in corso' : 'Prova e salva'}</button></>}>
      {st?.set && <div className={`alert ${st.source === 'env' ? 'info' : 'ok'} small`}><Icon name="info" /><span>{st.source === 'env' ? 'Impostata nelle variabili d\'ambiente di Render (ha la precedenza): per cambiarla usa il pannello Render.' : `Impostata dalla Suite${st.hint ? `, termina con "${st.hint}"` : ''}${st.updated_at ? `, il ${fmtDateTime(st.updated_at)}` : ''}. Inserendo un nuovo valore la sostituisci.`}</span></div>}
      <Field label="Valore" help={help}><input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} disabled={st?.source === 'env'} /></Field>
      <div className="small muted">Il valore viene provato prima di essere salvato, poi conservato cifrato nel database della Suite. Non compare mai in chiaro, né nei registri.</div>
    </Modal>
  );
}

export function Legacy() {
  const { data, loading, error, unavailable, reload } = useApi('/legacy/sources');
  const toast = useToast();
  const { user: me } = useAuth();
  const owner = isOwner(me);
  const [cred, setCred] = useState(null);
  const [busy, setBusy] = useState({});
  const rows = Array.isArray(data) ? data : data?.rows || [];
  return (
    <div className="page">
      <PageHead title="Sorgenti legacy" icon="refresh" sub="Connessione in sola lettura ai database delle app di origine: per il travaso dei moduli indipendenti (Payments, Spedizioni) e per importare i contenuti dell'app originale in Room Planning e Integration (da Travaso moduli). Le anagrafiche non si copiano: si caricano da Amministrazione." />
      {loading && <div className="grid g3">{[1, 2, 3].map((i) => <Card key={i}><Skeleton lines={3} /></Card>)}</div>}
      {unavailable && <Card><Coming what="Il collegamento alle sorgenti legacy" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {data && !rows.length && <Empty icon="refresh" title="Nessuna sorgente configurata">Il titolare imposta la connessione da ciascuna card.</Empty>}
      {cred && <CredentialModal title={`Connessione a ${cred.label}`} help="External Database URL del database Render dell'app (postgresql://...). Usata in sola lettura." placeholder="postgresql://utente:password@host.frankfurt-postgres.render.com/db"
        statusUrl={`/legacy/sources/${cred.key}/credential`} saveUrl={`/legacy/sources/${cred.key}/credential`} field="database_url" onClose={() => setCred(null)} onSaved={reload} />}
      <div className="sources">{rows.map((s) => {
        const tone = !s.enabled ? 'grey' : s.last_status === 'OK' ? 'green' : s.last_status ? 'red' : 'amber';
        const label = !s.enabled ? 'Non collegata' : s.content_import ? 'Collegata' : s.last_status === 'OK' ? 'Collegata' : s.last_status || 'Collegata, mai sincronizzata';
        // stats: { sedi: {creati, aggiornati, saltati}, utenti: {...}, grant: {...}, durata_ms: n }
        const entries = Object.entries(s.stats || {}).filter(([k, v]) => k !== 'durata_ms' && v && typeof v === 'object');
        const total = entries.reduce((a, [, v]) => a + (Number(v.creati) || 0) + (Number(v.aggiornati) || 0), 0);
        const durata = s.stats?.durata_ms;
        return (
          <div key={s.key} className={`source-card ${s.enabled ? 'on' : ''}`}>
            <div className="sc-head">
              <span className={`dot ${tone}`} aria-hidden="true" />
              <div className="sc-title"><div className="n">{s.label || s.key}</div><div className="small muted">{label}{s.last_sync_at ? ` · ultimo sync ${timeAgo(s.last_sync_at)}` : ''}</div></div>
              <Badge tone={tone} dot={false}>{s.running ? 'In corso' : s.enabled ? 'Pronta' : 'Da collegare'}</Badge>
            </div>
            {s.last_error && <div className="alert err small"><Icon name="alert" /><span>{s.last_error}</span></div>}
            {entries.length > 0
              ? <div className="stats">{entries.map(([k, v]) => <div key={k}><b>{((Number(v.creati) || 0) + (Number(v.aggiornati) || 0)).toLocaleString('it-IT')}</b>{k.replace(/_/g, ' ')}<span className="sub">{[v.creati ? `${v.creati} nuovi` : null, v.aggiornati ? `${v.aggiornati} aggiornati` : null, v.saltati ? `${v.saltati} saltati` : null].filter(Boolean).join(' · ') || 'nessuna variazione'}</span></div>)}</div>
              : <div className="sc-empty small muted">{s.content_import
                  ? (s.enabled ? <>Database collegato: importa i contenuti dell'app originale da <Link to="/admin/travaso">Travaso moduli</Link>.</> : 'Collega il database dell\'app originale per importare i contenuti nel modulo (Travaso moduli).')
                  : (s.enabled ? 'Database collegato: il travaso del modulo è possibile.' : 'Collega il database dell\'app di origine per il travaso del modulo.')}</div>}
            <div className="sc-actions">
              {owner && <button className={`btn sm ${s.enabled ? 'ghost' : ''}`} onClick={() => setCred({ key: s.key, label: s.label || s.key })}><Icon name="key" />{s.enabled ? 'Connessione' : 'Collega database'}</button>}
              <span className="small muted" style={{ marginLeft: 'auto' }}>{total > 0 ? `${total.toLocaleString('it-IT')} record` : ''}{durata ? ` · ${(durata / 1000).toFixed(1)} s` : ''}</span>
            </div>
          </div>
        );
      })}</div>
    </div>
  );
}

// ---------- Chiavi API ----------
const SCOPES = ['people', 'sites', 'organizations', 'events', 'news', 'files', 'generic'];
export function ApiKeys() {
  const { data, loading, error, unavailable, reload } = useApi('/api-keys');
  const sites = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [created, setCreated] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [f, setF] = useState({ name: '', source: '', site_id: '', organization_id: '', scopes: ['people', 'sites'], expires_at: '' });
  const rows = Array.isArray(data) ? data : data?.rows || [];
  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/api-keys', { name: f.name, source: f.source, site_id: f.site_id ? Number(f.site_id) : undefined, organization_id: f.organization_id ? Number(f.organization_id) : undefined, scopes: f.scopes, expires_at: f.expires_at || undefined });
      setCreated(r); setModal(false); reload(); setF({ name: '', source: '', site_id: '', organization_id: '', scopes: ['people', 'sites'], expires_at: '' });
    } catch (e2) { toast(e2, 'err'); }
  };
  return (
    <div className="page">
      <PageHead title="Chiavi API" icon="key" sub="Credenziali per l'ingestione dati da Contracts, Room, M365 e dagli altri sistemi" actions={<button className="btn" onClick={() => setModal(true)}><Icon name="plus" />Nuova chiave</button>} />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton /></div>}
        {unavailable && <Coming what="La gestione delle chiavi API" />}
        {error && !unavailable && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="key" title="Nessuna chiave attiva">Crea una chiave per ogni sistema che invia dati alla Suite.</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th><th>Sorgente</th><th>Ambiti</th><th>Prefisso</th><th>Ultimo uso</th><th>Scadenza</th><th></th></tr></thead><tbody>
          {rows.map((k) => <tr key={k.id}>
            <td className="strong">{k.name}{k.revoked_at && <div><Badge tone="red">Revocata</Badge></div>}</td><td className="mono small">{k.source}</td>
            <td>{(k.scopes || []).map((s) => <span key={s} className="chip">{s}</span>)}</td><td className="mono small">{k.prefix || k.key_prefix || ''}</td>
            <td className="small">{k.last_used_at ? timeAgo(k.last_used_at) : <span className="faint">mai</span>}</td><td className="small">{k.expires_at ? fmtDateTime(k.expires_at) : <span className="faint">nessuna</span>}</td>
            <td className="actions">{!k.revoked_at && <button className="btn sm danger" onClick={() => setRevoke(k)}>Revoca</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && (
        <Modal title="Nuova chiave API" onClose={() => setModal(false)} footer={<><button className="btn ghost" onClick={() => setModal(false)}>Annulla</button><button className="btn" form="kform">Crea</button></>}>
          <form id="kform" onSubmit={create} className="col">
            <Field label="Nome" required><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="Contracts · export persone" /></Field>
            <Field label="Sorgente" required help="Identificativo del sistema che userà la chiave (es. contracts, room, m365)"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required /></Field>
            <Field label="Ambiti (dataset consentiti)"><div className="row tight">{SCOPES.map((s) => <label key={s} className="f inline"><input type="checkbox" checked={f.scopes.includes(s)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s] : f.scopes.filter((x) => x !== s) })} />{s}</label>)}</div></Field>
            <div className="form-grid">
              <Field label="Limita a una sede"><select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">Nessun limite</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Limita a un'organizzazione"><select value={f.organization_id} onChange={(e) => setF({ ...f, organization_id: e.target.value })}><option value="">Nessun limite</option>{(orgs.data || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Scadenza"><input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></Field>
            </div>
          </form>
        </Modal>
      )}
      {created && (
        <Modal title="Chiave creata" onClose={() => setCreated(null)} footer={<button className="btn" onClick={() => setCreated(null)}>Ho salvato la chiave</button>}>
          <div className="alert warn"><Icon name="alert" /><span>Copia ora la chiave: per sicurezza non sarà più visibile dopo la chiusura di questa finestra.</span></div>
          <div className="secret mt"><span>{created.key}</span><CopyButton text={created.key} /></div>
          <div className="small muted mt">Uso: header <span className="mono">Authorization: Bearer &lt;chiave&gt;</span> verso <span className="mono">POST /api/ingest/&lt;dataset&gt;</span>. Verifica con <span className="mono">GET /api/ingest/ping</span>.</div>
        </Modal>
      )}
      {revoke && <ConfirmModal title="Revocare la chiave?" text={`"${revoke.name}" smetterà di funzionare immediatamente.`} confirmText="Revoca" danger onConfirm={async () => { await api.del(`/api-keys/${revoke.id}`); reload(); }} onClose={() => setRevoke(null)} />}
    </div>
  );
}

// ---------- Importazioni ----------
const BATCH_TONE = { OK: 'green', PARTIAL: 'amber', FAILED: 'red', DUPLICATE: 'grey', RECEIVED: 'blue' };
// ---------- Caricamento anagrafiche da XLSX ----------
function XlsxImport({ onDone }) {
  const { data: datasets } = useApi('/import/datasets', []);
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [reset, setReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const pick = (ds) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      setBusy(ds.key);
      try { const r = await api.upload(`/import/${ds.key}`, fd); setResult({ ds, ...r }); toast(r.rows_rejected ? `${r.rows_ok} righe caricate, ${r.rows_rejected} scartate` : `${r.rows_ok} righe caricate`); onDone?.(); }
      catch (e) { toast(e, 'err'); }
      setBusy(null);
    };
    input.click();
  };
  const doReset = async () => { try { await api.post('/admin/reset', { confirm: confirmText }); toast('Suite azzerata'); setReset(false); setConfirmText(''); onDone?.(); setTimeout(() => window.location.reload(), 800); } catch (e) { toast(e, 'err'); } };
  return (
    <>
      <Card title="Caricamento anagrafiche" icon="upload" actions={isOwner(user) && <button className="btn sm ghost danger" onClick={() => setReset(true)}><Icon name="alert" />Azzera la Suite</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>Nell'ordine: Legal entity (chi ha partita IVA: società del gruppo, clienti, fornitori), Sedi (i luoghi, ognuno con il codice della sua legal entity), Persone, Utenti. Scarica il modello, compilalo (foglio "Istruzioni" incluso), caricalo. Le righe con la stessa chiave aggiornano quelle esistenti. Massimo 1000 righe per file.</p>
        <div className="import-grid">
          {(datasets || []).map((ds, i) => (
            <div key={ds.key} className="import-card">
              <div className="n"><span className="step">{i + 1}</span>{ds.title}</div>
              <div className="small muted">{ds.columns.length} colonne · chiave: {ds.columns[0].label.toLowerCase()}</div>
              <div className="row tight" style={{ marginTop: 10 }}>
                <a className="btn sm ghost" href={`/api/import/templates/${ds.key}`}><Icon name="download" />Modello</a>
                <button className="btn sm" disabled={busy === ds.key} onClick={() => pick(ds)}><Icon name="upload" />{busy === ds.key ? 'Caricamento' : 'Carica XLSX'}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      {result && (
        <Modal title={`${result.ds.title}: esito del caricamento`} onClose={() => setResult(null)}>
          <div className="row tight" style={{ gap: 14, marginBottom: 12 }}><Badge tone={result.rows_rejected ? 'amber' : 'green'}>{result.rows_ok} righe caricate</Badge>{result.rows_rejected > 0 && <Badge tone="red">{result.rows_rejected} scartate</Badge>}</div>
          {result.errors?.length > 0 && <div className="table-wrap"><table className="table small"><thead><tr><th>Riga</th><th>Errore</th></tr></thead><tbody>{result.errors.map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.error}</td></tr>)}</tbody></table></div>}
          {!result.errors?.length && <div className="small muted">Nessun errore. Le righe scartate, se presenti, vanno corrette nel file e ricaricate: le altre non si duplicano.</div>}
        </Modal>
      )}
      {reset && (
        <Modal title="Azzerare la Suite?" onClose={() => setReset(false)}>
          <div className="alert err"><Icon name="alert" /><span>Vengono eliminati sedi, organizzazioni, persone, utenti (tranne il titolare) con i loro profili, contenuti della Community, lotti caricati e tutti i dati dei moduli, che tornano spenti. Restano impostazioni, credenziali, catalogo dei moduli e frasi del giorno. Operazione irreversibile.</span></div>
          <Field label='Per confermare scrivi: AZZERA LA SUITE'><input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
          <div className="row end"><button className="btn ghost" onClick={() => setReset(false)}>Annulla</button><button className="btn danger" disabled={confirmText !== 'AZZERA LA SUITE'} onClick={doReset}>Azzera</button></div>
        </Modal>
      )}
    </>
  );
}

export function Imports() {
  const [f, setF] = useState({ source: '', dataset: '', status: '', page: 1 });
  const { data, loading, error, unavailable } = useApi(`/ingest-batches${qs(f)}`, [JSON.stringify(f)]);
  const [open, setOpen] = useState(null);
  const detail = useApi(open ? `/ingest-batches/${open}` : null, [open]);
  const rows = Array.isArray(data) ? data : data?.rows || [];
  return (
    <div className="page">
      <PageHead title="Importazioni" icon="import" sub="Caricamento delle anagrafiche da XLSX e registro di tutti i lotti ricevuti (file e API di ingestione), con l'esito riga per riga" />
      <XlsxImport onDone={() => setF((x) => ({ ...x }))} />
      <div className="section-title" style={{ marginTop: 22 }}><h2>Registro dei lotti</h2></div>
      <div className="filters">
        <Field label="Sorgente"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, page: 1 })} placeholder="contracts" /></Field>
        <Field label="Dataset"><input value={f.dataset} onChange={(e) => setF({ ...f, dataset: e.target.value, page: 1 })} placeholder="people" /></Field>
        <Field label="Stato"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Tutti</option>{Object.keys(BATCH_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      </div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton /></div>}
        {unavailable && <Coming what="Il registro delle importazioni" />}
        {error && !unavailable && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="import" title="Nessun lotto ricevuto">I sistemi collegati con una chiave API compariranno qui a ogni invio.</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Ricevuto</th><th>Sorgente</th><th>Dataset</th><th>Lotto</th><th>Stato</th><th className="num">Righe</th><th className="num">OK</th><th className="num">Scartate</th></tr></thead><tbody>
          {rows.map((b) => <tr key={b.id} className="click" onClick={() => setOpen(b.id)}>
            <td className="small nowrap">{fmtDateTime(b.received_at || b.created_at)}</td><td className="mono small">{b.source}</td><td className="mono small">{b.dataset}</td><td className="mono small ellipsis" style={{ maxWidth: 180 }}>{b.batch_uid}</td>
            <td><Badge tone={BATCH_TONE[b.status] || 'grey'}>{b.status}</Badge></td><td className="num">{b.rows_total}</td><td className="num green">{b.rows_ok}</td><td className={`num ${b.rows_rejected ? 'red' : ''}`}>{b.rows_rejected}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {open && (
        <Modal title={`Lotto ${detail.data?.batch_uid || open}`} onClose={() => setOpen(null)} wide>
          {detail.loading && <Skeleton />}
          <ErrorBox error={detail.error} />
          {detail.data && <>
            <div className="row tight mb"><Badge tone={BATCH_TONE[detail.data.status] || 'grey'}>{detail.data.status}</Badge><span className="small muted">{detail.data.source} · {detail.data.dataset} · {fmtDateTime(detail.data.received_at || detail.data.created_at)}</span></div>
            <div className="grid g3 mb"><div className="card kpi"><div className="lbl">Righe</div><div className="val">{detail.data.rows_total}</div></div><div className="card kpi"><div className="lbl">Importate</div><div className="val green">{detail.data.rows_ok}</div></div><div className="card kpi"><div className="lbl">Scartate</div><div className="val red">{detail.data.rows_rejected}</div></div></div>
            {detail.data.manifest && <details className="mb"><summary className="small strong">Manifesto</summary><pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail.data.manifest, null, 2)}</pre></details>}
            {(detail.data.errors || detail.data.rows || []).length > 0 ? <div className="table-wrap"><table className="t"><thead><tr><th>Riga</th><th>Esito</th></tr></thead><tbody>{(detail.data.errors || detail.data.rows).map((r, i) => <tr key={i}><td className="mono">{r.row ?? i + 1}</td><td className={r.error ? 'red' : 'green'}>{r.error || r.status || 'OK'}</td></tr>)}</tbody></table></div> : <div className="small muted">Nessuno scarto: tutte le righe sono state applicate.</div>}
          </>}
        </Modal>
      )}
    </div>
  );
}

// ---------- Audit ----------
export function Audit() {
  const [f, setF] = useState({ action: '', qtext: '', user_id: '', page: 1 });
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, qtext: q, page: 1 })), 300); return () => clearTimeout(t); }, [q]);
  const { data, loading, error } = useApi(`/audit${qs(f)}`, [JSON.stringify(f)]);
  const [open, setOpen] = useState(null);
  const actions = Array.from(new Set((data || []).map((a) => a.action))).sort();
  return (
    <div className="page">
      <PageHead title="Audit" icon="shield" sub="Registro delle operazioni sulla Suite: accessi, modifiche, pubblicazioni" />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Etichetta o nome utente" />
        <Field label="Azione"><select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}><option value="">Tutte</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        <Field label="Id utente"><input value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value.replace(/\D/g, ''), page: 1 })} inputMode="numeric" /></Field>
      </div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={5} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="shield" title="Nessuna voce" />}
        {data?.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Etichetta</th><th>Entità</th><th>IP</th></tr></thead><tbody>
          {data.map((a) => <tr key={a.id} className="click" onClick={() => setOpen(a)}><td className="small nowrap">{fmtDateTime(a.at)}</td><td className="small">{a.user_name || <span className="faint">sistema</span>}</td><td className="mono small">{a.action}</td><td className="small">{a.label}</td><td className="small muted">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td className="mono tiny muted">{a.ip}</td></tr>)}
        </tbody></table></div>}
        <div className="pager"><button className="btn sm ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Precedente</button><span>pagina {f.page}</span><button className="btn sm ghost" disabled={!data || data.length < 100} onClick={() => setF({ ...f, page: f.page + 1 })}>Successiva</button></div>
      </Card>
      {open && <Modal title={`${open.action} · ${fmtDateTime(open.at)}`} onClose={() => setOpen(null)}><div className="small muted mb">{open.user_name || 'sistema'}{open.label ? ` · ${open.label}` : ''}</div><pre className="mono small" style={{ whiteSpace: 'pre-wrap', background: 'var(--card-2)', padding: 12, borderRadius: 10 }}>{JSON.stringify(open.data ?? {}, null, 2)}</pre></Modal>}
    </div>
  );
}

// ---------- Impostazioni ----------
function JsonEditor({ k, value, onSave }) {
  const [txt, setTxt] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState(null);
  useEffect(() => { setTxt(JSON.stringify(value, null, 2)); }, [value]);
  const save = () => { try { const v = JSON.parse(txt); setErr(null); onSave(v); } catch (e) { setErr('JSON non valido: ' + e.message); } };
  return (
    <div className="json-editor col" style={{ gap: 6 }}>
      <textarea value={txt} onChange={(e) => { setTxt(e.target.value); try { JSON.parse(e.target.value); setErr(null); } catch { setErr('JSON non valido'); } }} aria-label={`Valore di ${k}`} />
      <div className="row between"><span className="tiny red">{err}</span><button className="btn sm" disabled={Boolean(err) || txt === JSON.stringify(value, null, 2)} onClick={save}>Salva</button></div>
    </div>
  );
}
function ValuesEditor({ value, onSave }) {
  const [list, setList] = useState(Array.isArray(value) ? value : []);
  useEffect(() => setList(Array.isArray(value) ? value : []), [value]);
  const dirty = JSON.stringify(list) !== JSON.stringify(value);
  return (
    <div className="values-list">
      {list.map((v, i) => <div key={i} className="v"><input value={v} onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Valore ${i + 1}`} /><button className="iconbtn danger" aria-label="Rimuovi" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="trash" /></button></div>)}
      <div className="row between"><button className="btn sm ghost" onClick={() => setList([...list, ''])}><Icon name="plus" />Aggiungi valore</button><button className="btn sm" disabled={!dirty} onClick={() => onSave(list.map((x) => x.trim()).filter(Boolean))}>Salva</button></div>
    </div>
  );
}
function Integrations() {
  const { data, reload } = useApi('/integrations');
  const [open, setOpen] = useState(null);
  const row = (key, label, desc) => {
    const st = data?.[key];
    return (
      <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line-soft)' }}>
        <div><div className="strong">{label}</div><div className="small muted">{desc}</div></div>
        <div className="row tight"><Badge tone={st?.set ? 'green' : 'grey'}>{st?.set ? (st.source === 'env' ? 'Impostata su Render' : `Impostata${st.hint ? ` · ${st.hint}` : ''}`) : 'Non impostata'}</Badge><button className="btn sm ghost" onClick={() => setOpen(key)}><Icon name="key" />{st?.set ? 'Cambia' : 'Imposta'}</button></div>
      </div>
    );
  };
  return (
    <Card title="Integrazioni" icon="key">
      {row('anthropic', 'Claude (Anthropic)', 'Ricerca in linguaggio naturale, frasi del giorno, riassunti, lettura dei contratti e dei referti. Chiave API sk-ant-...')}
      <AiModelBox />
      {row('azure_blob', 'Azure Blob Storage', 'Cartelle personali, allegati, copertine. Stringa di connessione dello storage account.')}
      {open === 'anthropic' && <CredentialModal title="Chiave API Anthropic" help="Dalla console Anthropic, inizia con sk-ant-" placeholder="sk-ant-..." statusUrl="/integrations" statusKey="anthropic" saveUrl="/integrations/anthropic" field="value" onClose={() => setOpen(null)} onSaved={reload} />}
      {open === 'azure_blob' && <CredentialModal title="Stringa di connessione Azure Blob" help="Portale Azure, storage account, Chiavi di accesso, key1, Stringa di connessione" placeholder="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net" statusUrl="/integrations" statusKey="azure_blob" saveUrl="/integrations/azure_blob" field="value" onClose={() => setOpen(null)} onSaved={reload} />}
    </Card>
  );
}

// Dati aziendali (app_settings.company): carta intestata, piè di pagina, firme e intestazioni di tutti i moduli
function CompanyEditor({ value, onSave }) {
  const info = useApi('/company');
  const fields = info.data?.fields || [];
  const [f, setF] = useState(value && typeof value === 'object' ? value : {});
  useEffect(() => setF(value && typeof value === 'object' ? value : {}), [value]);
  const dirty = JSON.stringify(f) !== JSON.stringify(value || {});
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>Ragione sociale, sede legale, partita IVA, REA, capitale sociale, contatti e Direttore Sanitario usati da Business, Finance, Spedizioni, Circolari, Contratti del personale e dall'organigramma per carte intestate, piè di pagina e firme. Si modificano solo qui.</p>
      <div className="form-grid">
        {fields.map(([k, label, help]) => <Field key={k} label={label} help={help} className={k === 'footer' ? 'span-all' : ''}>
          {k === 'footer' ? <textarea value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ minHeight: 70 }} placeholder={info.data?.company?.footer_text || ''} />
            : <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={info.data?.company?.[k] || ''} />}
        </Field>)}
      </div>
      <div className="row between" style={{ marginTop: 10 }}><span className="small muted">Un campo vuoto usa il valore di ripiego mostrato in grigio.</span><button className="btn sm" disabled={!dirty} onClick={() => onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v ?? '').trim()])))}>Salva</button></div>
    </div>
  );
}

export function Settings() {
  const { data, loading, error, reload } = useApi('/settings');
  const toast = useToast();
  const { user: me } = useAuth();
  const [newKey, setNewKey] = useState('');
  const save = async (k, v) => { try { await api.put(`/settings/${encodeURIComponent(k)}`, { value: v }); toast(`"${k}" salvata`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page narrow">
      <PageHead title="Impostazioni" icon="gear" sub="Parametri dell'applicazione (app_settings). I valori sono JSON; i valori aziendali hanno un editor dedicato." />
      {loading && <Card><Skeleton /></Card>}
      <ErrorBox error={error} />
      <div className="col">
        {isOwner(me) && <Integrations />}
        {data && <Card title="Dati aziendali" icon="building"><CompanyEditor value={data.company} onSave={(nv) => save('company', nv)} /></Card>}
        {data && Object.entries(data).filter(([k]) => k !== 'company').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
          <Card key={k} title={<span className="mono">{k}</span>} icon="gear">
            {k === 'community.values' ? <ValuesEditor value={v} onSave={(nv) => save(k, nv)} /> : <JsonEditor k={k} value={v} onSave={(nv) => save(k, nv)} />}
          </Card>
        ))}
        <Card title="Nuova chiave" icon="plus">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (!newKey.trim()) return; save(newKey.trim(), null); setNewKey(''); }}>
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="es. search.ai_enabled" style={{ flex: 1 }} aria-label="Nome della nuova chiave" />
            <button className="btn ghost">Crea con valore null</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

// Modello Anthropic in uso e prova della configurazione: elenca i modelli disponibili per la chiave e fa una richiesta minima.
// Se un widget mostra "Intelligenza artificiale: modello non disponibile", qui si sceglie un modello valido e si riprova.
function AiModelBox() {
  const toast = useToast();
  const st = useApi('/integrations');
  const [model, setModel] = React.useState('');
  const [res, setRes] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (st.data?.anthropic?.model && !model) setModel(st.data.anthropic.model); }, [st.data]);
  const prova = async () => { setBusy(true); try { const r = await api.post('/integrations/anthropic/test'); setRes(r); toast(r.message, r.ok ? 'ok' : 'err'); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const salva = async () => { try { await api.put('/integrations/anthropic/model', { model: model.trim() }); toast('Modello salvato'); st.reload(); } catch (e) { toast(e, 'err'); } };
  if (!st.data?.anthropic?.set) return null;
  return (
    <div className="card" style={{ padding: 14, marginTop: 10 }}>
      <div className="row" style={{ alignItems: 'end', gap: 10 }}>
        <Field label="Modello Claude in uso" help="Identificativo del modello (es. claude-sonnet-4-5). Prevale sulla variabile ANTHROPIC_MODEL di Render."><input value={model} onChange={(e) => setModel(e.target.value)} list="ai-models" style={{ minWidth: 280 }} /></Field>
        <datalist id="ai-models">{(res?.models || []).map((m) => <option key={m} value={m} />)}</datalist>
        <button className="btn ghost" disabled={busy} onClick={prova}>{busy ? 'Prova in corso' : 'Prova la configurazione'}</button>
        <button className="btn" onClick={salva} disabled={!model.trim() || model.trim() === st.data.anthropic.model}>Salva modello</button>
      </div>
      {res && <div className={`alert ${res.ok ? 'ok' : 'err'} small`} style={{ marginTop: 10 }}><span>{res.message}{res.models?.length ? ` · modelli disponibili per la chiave: ${res.models.join(', ')}` : ''}</span></div>}
    </div>
  );
}
