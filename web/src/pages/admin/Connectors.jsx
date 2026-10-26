import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApi, Card, Badge, Skeleton, ErrorBox, PageHead, Field, useToast, Modal, Switch, CopyButton, ConfirmModal } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, timeAgo } from '../../format.js';

// Amministrazione > Connettori: un connettore per sistema esterno, configurato una volta e valido per tutta la Suite.
// Le credenziali non si rileggono mai: il server espone solo "impostata" e gli ultimi 4 caratteri.
const DESC = {
  STUDIOLAB: 'LIS di laboratorio di CB Sistemi: API REST ServiceNET (chiave X-API-KEY) per Non conformità e Ordini, canali HL7 e push in ingresso con il segreto qui sotto. Alimenta anche le sedi dei clienti service (codice cliente).',
  GIPO: 'Gestionale di accettazione e prenotazione B2C (Docplanner). Nessuna API documentata: i dati entrano dall\'import da file di Retail e dalle API di ingestione della Suite.',
  TUOTEMPO: 'Prenotazione online (Docplanner): API v3 con api_key fissa per istanza, chiamate dagli IP statici in uscita di Render autorizzati da Docplanner. Usata da Retail per il catalogo prenotabile.',
  SILVA: 'Gestore del magazzino. Non espone API: è Silva a interrogare le API di Ordini ogni 5 minuti con il segreto in ingresso qui sotto.',
};
const CRED_FIELDS = { API_KEY: [['api_key', 'Chiave API']], BASIC: [['user', 'Utente'], ['password', 'Password']], OAUTH2: [['client_id', 'Client ID'], ['client_secret', 'Client secret']], NONE: [] };
const SETTINGS = {
  STUDIOLAB: [['client_code', 'Codice cliente (CodiceCliente)', 'Codice di Toscana Diagnostica su ServiceNET, di norma TD'], ['timeout_ms', 'Timeout chiamate (ms)', '']],
  TUOTEMPO: [['instance', 'Istanza (dbName)', 'es. tt_giponext_2313, una api_key per istanza'], ['lang', 'Lingua', 'it']],
  GIPO: [['client_code', 'Codice cliente', '']],
  SILVA: [['customer_code', 'Codice cliente presso Silva', 'Compare negli ordini inviati al fornitore'], ['order_email', 'Email ordini (ripiego)', 'Casella a cui inviare l\'ordine in PDF se le API non sono in uso']],
};

function ConnectorCard({ c, onChanged }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [creds, setCreds] = useState({});
  const [inbound, setInbound] = useState('');
  const [busy, setBusy] = useState(null);
  const [secret, setSecret] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const log = useApi(showLog ? `/connectors/${c.kind}/log` : null, [showLog, c.last_test_at]);
  useEffect(() => { setF({ enabled: c.enabled, base_url: c.base_url || '', auth_kind: c.auth_kind, settings: { ...c.settings, ip_allowlist: (c.settings.ip_allowlist || []).join(', ') } }); setCreds({}); setInbound(''); }, [c]);
  if (!f) return null;
  const tone = c.active ? (c.last_status === 'ERRORE' ? 'amber' : 'green') : c.configured || c.env_in_use ? 'grey' : 'grey';
  const stateLabel = !c.configured && !c.env_in_use ? 'Da configurare' : c.env_in_use ? 'Variabili d\'ambiente' : c.active ? 'Attivo' : 'Disabilitato';
  const save = async () => {
    setBusy('save');
    try {
      const settings = { ...f.settings };
      settings.ip_allowlist = String(settings.ip_allowlist || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      if (settings.timeout_ms !== undefined && settings.timeout_ms !== '') settings.timeout_ms = Number(settings.timeout_ms); else delete settings.timeout_ms;
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v && v.trim()));
      const body = { enabled: f.enabled, base_url: f.base_url || null, auth_kind: f.auth_kind, settings, ...(Object.keys(credentials).length ? { credentials } : {}), ...(inbound.trim() ? { inbound_secret: inbound.trim() } : {}) };
      await api.put(`/connectors/${c.kind}`, body);
      toast(`${c.name}: salvato`); onChanged();
    } catch (e) { toast(e, 'err'); }
    setBusy(null);
  };
  const test = async () => { setBusy('test'); try { const r = await api.post(`/connectors/${c.kind}/test`); toast(r.message, r.ok ? 'ok' : 'err'); onChanged(); } catch (e) { toast(e, 'err'); } setBusy(null); };
  const rotate = async () => { const r = await api.post(`/connectors/${c.kind}/rotate-inbound`); setSecret(r.secret); onChanged(); };
  const removeCreds = async () => { setBusy('save'); try { await api.put(`/connectors/${c.kind}`, { credentials: null }); toast('Credenziali rimosse'); onChanged(); } catch (e) { toast(e, 'err'); } setBusy(null); };
  const removeInbound = async () => { setBusy('save'); try { await api.put(`/connectors/${c.kind}`, { inbound_secret: null }); toast('Segreto in ingresso rimosso'); onChanged(); } catch (e) { toast(e, 'err'); } setBusy(null); };
  const needsInbound = c.kind === 'STUDIOLAB' || c.kind === 'SILVA';
  const needsOutbound = c.kind !== 'SILVA';
  return (
    <Card title={c.name} icon="cloud" className="connector-card" actions={<div className="row tight"><Badge tone={tone}>{stateLabel}</Badge><Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={`Abilita ${c.name}`} /></div>}>
      <p className="small muted" style={{ marginTop: 0 }}>{DESC[c.kind]}</p>
      <div className="row tight wrap small" style={{ gap: 14, marginBottom: 10 }}>
        <span>Credenziali: {c.credentials.configured ? <Badge tone="green">impostate{Object.values(c.credentials.keys)[0]?.hint ? ` ••••${Object.values(c.credentials.keys)[0].hint}` : ''}</Badge> : <Badge tone="grey">non impostate</Badge>}</span>
        {needsInbound && <span>Segreto in ingresso: {c.inbound.configured ? <Badge tone="green">impostato ••••{c.inbound.hint}</Badge> : <Badge tone="grey">non impostato</Badge>}</span>}
        <span>Ultimo test: {c.last_test_at ? <Badge tone={c.last_status === 'OK' ? 'green' : 'red'} title={c.last_message}>{c.last_status} · {timeAgo(c.last_test_at)}</Badge> : <span className="faint">mai</span>}</span>
      </div>
      {c.env_in_use && <div className="alert info small"><Icon name="info" /><span>In uso le variabili d'ambiente di Render ({c.env_vars.join(', ')}). Impostando qui credenziali o segreto, questi dati prendono il loro posto per tutti i moduli.</span></div>}
      {c.last_message && c.last_status === 'ERRORE' && <div className="alert err small"><Icon name="alert" /><span>{c.last_message}</span></div>}
      <div className="form-grid">
        {needsOutbound && <Field label="Base URL" help={c.base_url_default ? `Predefinita: ${c.base_url_default}` : 'Facoltativa'}><input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder={c.base_url_default || 'https://'} /></Field>}
        {needsOutbound && <Field label="Tipo di autenticazione"><select value={f.auth_kind} onChange={(e) => setF({ ...f, auth_kind: e.target.value })}><option value="API_KEY">Chiave API</option><option value="BASIC">Utente e password</option><option value="OAUTH2">OAuth2 client credentials</option><option value="NONE">Nessuna</option></select></Field>}
        {needsOutbound && (CRED_FIELDS[f.auth_kind] || []).map(([k, l]) => <Field key={k} label={l} help={c.credentials.keys[k] ? `Impostata, termina con "${c.credentials.keys[k].hint}". Scrivi un nuovo valore per sostituirla.` : 'Scrittura sola: non sarà più leggibile'}><input type="password" autoComplete="new-password" value={creds[k] || ''} onChange={(e) => setCreds({ ...creds, [k]: e.target.value })} placeholder={c.credentials.keys[k] ? `impostata ••••${c.credentials.keys[k].hint}` : ''} /></Field>)}
        {(SETTINGS[c.kind] || []).map(([k, l, h]) => <Field key={k} label={l} help={h}><input value={f.settings[k] ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, [k]: e.target.value } })} /></Field>)}
        <Field label="IP consentiti" help="Indirizzi dai quali il fornitore chiama la Suite, separati da virgola (informativo, per il firewall)"><input value={f.settings.ip_allowlist || ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, ip_allowlist: e.target.value } })} placeholder="es. 185.10.20.30" /></Field>
      </div>
      {needsInbound && (
        <div className="inbound mt">
          <div className="row between tight"><div className="strong small">Segreto in ingresso</div><div className="row tight">{c.inbound.configured && <button className="btn sm ghost danger" disabled={busy} onClick={removeInbound}>Rimuovi</button>}<button className="btn sm ghost" disabled={busy} onClick={() => setConfirmRotate(true)}><Icon name="refresh" />Rigenera</button></div></div>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>È la chiave che {c.kind === 'SILVA' ? 'Silva' : 'CB Sistemi'} deve inviare nell'header di ogni chiamata agli endpoint qui sotto. "Rigenera" ne crea uno casuale e lo mostra una sola volta; in alternativa incollane uno concordato.</p>
          <Field label="Imposta un segreto concordato (almeno 16 caratteri)"><input type="password" autoComplete="new-password" value={inbound} onChange={(e) => setInbound(e.target.value)} placeholder={c.inbound.configured ? `impostato ••••${c.inbound.hint}` : ''} /></Field>
        </div>
      )}
      <details className="mt">
        <summary className="small strong">Endpoint che il fornitore deve chiamare ({c.endpoints.length})</summary>
        <div className="table-wrap"><table className="t small"><thead><tr><th>Metodo</th><th>URL</th><th>Autenticazione</th><th>Note</th></tr></thead><tbody>
          {c.endpoints.map((e) => <tr key={e.path}><td className="mono">{e.method}</td><td className="mono" style={{ wordBreak: 'break-all' }}>{e.url}</td><td className="small">{e.auth}</td><td className="small muted">{e.note}</td></tr>)}
        </tbody></table></div>
      </details>
      <div className="row mt wrap" style={{ gap: 8 }}>
        <button className="btn sm" disabled={busy === 'save'} onClick={save}><Icon name="check" />Salva</button>
        <button className="btn sm ghost" disabled={busy === 'test'} onClick={test}><Icon name="refresh" />{busy === 'test' ? 'Prova in corso' : 'Prova connessione'}</button>
        <button className="btn sm ghost" onClick={() => setShowLog(!showLog)}><Icon name="list" />{showLog ? 'Nascondi registro' : 'Registro chiamate'}</button>
        {c.credentials.configured && <button className="btn sm ghost danger" disabled={busy} onClick={removeCreds}><Icon name="trash" />Rimuovi credenziali</button>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{c.updated_by_name ? `Modificato da ${c.updated_by_name} ${timeAgo(c.updated_at)}` : ''}</span>
      </div>
      {showLog && (
        <div className="mt">
          {log.loading && <Skeleton lines={3} />}
          <ErrorBox error={log.error} />
          {log.data && !log.data.length && <div className="small muted">Nessuna chiamata registrata.</div>}
          {log.data?.length > 0 && <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t small"><thead><tr><th>Quando</th><th>Verso</th><th>Modulo</th><th>Endpoint</th><th>Esito</th><th className="num">ms</th><th>Messaggio</th></tr></thead><tbody>
            {log.data.map((r) => <tr key={r.id}><td className="nowrap">{fmtDateTime(r.at)}</td><td><Badge tone={r.direction === 'IN' ? 'blue' : 'mauve'} dot={false}>{r.direction === 'IN' ? 'In ingresso' : 'In uscita'}</Badge></td><td className="mono">{r.module}</td><td className="mono nowrap">{r.endpoint}</td><td><Badge tone={r.status === 'OK' ? 'green' : 'red'} dot={false}>{r.status}</Badge></td><td className="num">{r.ms ?? ''}</td><td className="muted" style={{ minWidth: 160 }}>{r.message}</td></tr>)}
          </tbody></table></div>}
        </div>
      )}
      {confirmRotate && <ConfirmModal title="Rigenerare il segreto in ingresso?" text={`Il segreto attuale${c.inbound.configured ? ` (••••${c.inbound.hint})` : ''} smette di valere subito: il fornitore deve usare quello nuovo.`} confirmText="Rigenera" onConfirm={rotate} onClose={() => setConfirmRotate(false)} />}
      {secret && (
        <Modal title={`Nuovo segreto in ingresso · ${c.name}`} onClose={() => setSecret(null)} footer={<button className="btn" onClick={() => setSecret(null)}>Ho salvato il segreto</button>}>
          <div className="alert warn"><Icon name="alert" /><span>Copia ora il segreto e comunicalo al fornitore: non sarà più visibile dopo la chiusura di questa finestra.</span></div>
          <div className="secret mt"><span>{secret}</span><CopyButton text={secret} /></div>
          <div className="small muted mt">Va inviato nell'header <span className="mono">X-API-KEY</span>{c.kind === 'STUDIOLAB' ? <> (oppure <span className="mono">X-Push-Secret</span>)</> : null} di ogni chiamata agli endpoint elencati nella card.</div>
        </Modal>
      )}
    </Card>
  );
}

export function Connectors() {
  const { data, loading, error, reload } = useApi('/connectors');
  return (
    <div className="page">
      <PageHead title="Connettori" icon="cloud" sub="Un connettore per ogni sistema esterno (StudioLAB ServiceNET, GIPO, TuoTempo, Silva): base URL, credenziali, segreto in ingresso e impostazioni si configurano qui una volta sola." />
      <div className="alert info small mb"><Icon name="info" /><span>Questi dati valgono per tutti i moduli della Suite: Non conformità, Ordini e Magazzino, Retail e gli altri leggono da qui. Le pagine Impostazioni dei moduli mostrano solo lo stato. Le credenziali sono conservate cifrate e non sono più leggibili dopo il salvataggio.</span></div>
      {loading && <div className="grid g2">{[1, 2].map((i) => <Card key={i}><Skeleton lines={4} /></Card>)}</div>}
      <ErrorBox error={error} />
      {data && <div className="grid g2 connectors">{data.map((c) => <ConnectorCard key={c.kind} c={c} onChanged={reload} />)}</div>}
    </div>
  );
}
