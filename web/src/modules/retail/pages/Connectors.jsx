import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Icon } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { itDateTime, num } from '../format.js';

const LABEL = { GIPO: 'GIPO (Docplanner) · accettazione e prenotazione B2C', TUOTEMPO: 'TuoTempo (Docplanner) · prenotazione online', STUDIOLAB: 'StudioLab (CB Sistemi) · accettazione B2B' };
const CRED_FIELDS = { API_KEY: [['api_key', 'API key']], BASIC: [['user', 'Utente API'], ['password', 'Password API']], OAUTH2: [['client_id', 'Client ID'], ['client_secret', 'Client secret']], SFTP: [['host', 'Host SFTP'], ['user', 'Utente'], ['password', 'Password'], ['path', 'Cartella remota']] };

export default function Connectors() {
  const toast = useToast();
  const d = useApi('/connectors');
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(null);
  const save = async (c) => {
    const e = edit[c.kind] || {};
    try { await api.put(`/connectors/${c.kind}`, { enabled: e.enabled ?? c.enabled, base_url: e.base_url ?? c.base_url, auth_kind: e.auth_kind ?? c.auth_kind, schedule: e.schedule ?? c.schedule, settings: e.settings || {}, credentials: e.credentials || {} }); toast('Connettore salvato'); setEdit({ ...edit, [c.kind]: undefined }); d.reload(); } catch (err) { toast(err.message, 'err'); }
  };
  const test = async (c) => { setBusy(c.kind); try { const r = await api.post(`/connectors/${c.kind}/test`); toast(r.message); d.reload(); } catch (err) { toast(err.message, 'err'); d.reload(); } finally { setBusy(null); } };
  const sync = async (c) => { setBusy(c.kind); try { const r = await api.post(`/connectors/${c.kind}/sync`, {}); toast(`Sincronizzazione: ${num(r.rows_ok)} righe importate`); d.reload(); } catch (err) { toast(err.message, 'err'); d.reload(); } finally { setBusy(null); } };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Connettori ai gestionali</h1><div className="sub">Struttura pronta per le integrazioni dirette. Finché i fornitori non forniscono API e credenziali, i dati entrano con l'<Link to={`${base}/import`}>import da file</Link>: la mappatura resta la stessa.</div></div></div>
      <ErrorBox error={d.error} />
      {!d.data ? <Loading /> : <div className="grid g3">
        {d.data.connectors.map((c) => { const e = edit[c.kind] || {}; const v = (k) => e[k] ?? c[k]; const auth = v('auth_kind'); return (
          <Card key={c.kind} title={c.kind} actions={<Badge tone={c.enabled ? 'green' : 'grey'}>{c.enabled ? 'abilitato' : 'disabilitato'}</Badge>}>
            <p className="small muted" style={{ marginTop: 0 }}>{LABEL[c.kind]}</p>
            <p className="small" style={{ background: 'var(--silk)', padding: 10, borderRadius: 8 }}>{c.kind === 'TUOTEMPO' ? 'TuoTempo API v3 (Key Entities): Bearer api_key fissa, chiamate server-side dagli IP statici in uscita di Render autorizzati da Docplanner. Il perimetro contrattuale copre solo attività, aree, risorse, tipologie e assicurazioni: la sincronizzazione aggiorna il catalogo prenotabile (prezzi web, tipologie) e abbina le aree alle sedi. Prenotazioni e pazienti non sono autorizzati: le vendite B2C entrano dall\'export GIPO.' : c.settings?.note}</p>
            {c.kind === 'TUOTEMPO' && c.settings?.tuotempo && <p className="small" style={{ marginTop: 0 }}>Ultimo catalogo: {num(c.settings.tuotempo.activities)} attività · {num(c.settings.tuotempo.areas)} aree ({num(c.settings.tuotempo.areas_matched)} abbinate a sedi) · {num(c.settings.tuotempo.resources_active)} risorse attive su {num(c.settings.tuotempo.resources)} ({num(c.settings.tuotempo.machines)} macchine) · {num(c.settings.tuotempo.insurances)} assicurazioni/convenzioni{c.settings.tuotempo.areas_unmatched?.length ? <span className="red"> · aree senza sede: {c.settings.tuotempo.areas_unmatched.join(', ')}</span> : null}</p>}
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <Field label="Endpoint / base URL"><input value={v('base_url') || ''} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, base_url: ev.target.value } })} /></Field>
              {c.kind === 'TUOTEMPO' && <Field label="Istanza TuoTempo (dbName)" help="es. tt_giponext_2313 · api_key fissa fornita da Docplanner, una per istanza"><input value={e.settings?.instance ?? c.settings?.instance ?? ''} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, settings: { ...(e.settings || {}), instance: ev.target.value } } })} /></Field>}
              <Field label="Autenticazione"><select value={auth} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, auth_kind: ev.target.value } })}><option value="API_KEY">API key</option><option value="BASIC">Utente e password</option><option value="OAUTH2">OAuth2 client credentials</option><option value="SFTP">SFTP (export schedulato)</option></select></Field>
              {(CRED_FIELDS[auth] || []).map(([k, l]) => <Field key={k} label={l}><input type={/password|secret|key/.test(k) ? 'password' : 'text'} value={e.credentials?.[k] ?? c.credential_keys?.[k] ?? ''} placeholder={c.credential_keys?.[k] ? 'salvata' : ''} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, credentials: { ...(e.credentials || {}), [k]: ev.target.value } } })} /></Field>)}
              <Field label="Sincronizzazione"><select value={v('schedule')} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, schedule: ev.target.value } })}><option value="MANUALE">Manuale</option><option value="HOURLY">Ogni ora</option><option value="DAILY">Ogni giorno</option></select></Field>
              {c.kind !== 'TUOTEMPO' && <Field label="Giorni da sincronizzare"><input type="number" value={e.settings?.sync_days ?? c.settings?.sync_days ?? 30} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, settings: { ...(e.settings || {}), sync_days: Number(ev.target.value) } } })} /></Field>}
              <Field label="Abilitato" className="inline"><input type="checkbox" checked={Boolean(v('enabled'))} onChange={(ev) => setEdit({ ...edit, [c.kind]: { ...e, enabled: ev.target.checked } })} /> esegue la sincronizzazione pianificata</Field>
            </div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => save(c)}>Salva</button><button className="btn sm ghost" disabled={busy === c.kind} onClick={() => test(c)}>Prova connessione</button><button className="btn sm ghost" disabled={busy === c.kind} onClick={() => sync(c)}><Icon name="refresh" />Sincronizza ora</button></div>
            <p className="small muted" style={{ marginTop: 10 }}>Ultimo esito: {c.last_status ? <Badge tone={c.last_status === 'OK' ? 'green' : 'red'}>{c.last_status}</Badge> : 'mai'} {c.last_message || ''}{c.last_sync_at ? ` · ${itDateTime(c.last_sync_at)}` : ''}</p>
          </Card>); })}
      </div>}
      <Card title="Registro sincronizzazioni" className="card mt" flush>
        {!d.data ? <Loading /> : !d.data.logs.length ? <Empty>Nessuna sincronizzazione eseguita</Empty> : <table className="t"><thead><tr><th>Avvio</th><th>Fine</th><th>Connettore</th><th>Esito</th><th className="num">Lette</th><th className="num">Scritte</th><th>Messaggio</th></tr></thead><tbody>{d.data.logs.map((l) => <tr key={l.id}><td className="small">{itDateTime(l.started_at)}</td><td className="small">{itDateTime(l.finished_at)}</td><td>{d.data.connectors.find((c) => c.id === l.connector_id)?.kind}</td><td><Badge tone={l.status === 'OK' ? 'green' : 'red'}>{l.status || '–'}</Badge></td><td className="num">{num(l.rows_read)}</td><td className="num">{num(l.rows_written)}</td><td className="small muted">{l.message}</td></tr>)}</tbody></table>}
      </Card>
      <Card title="Cosa chiedere ai fornitori" className="card mt">
        <p className="small"><b>Docplanner (TuoTempo)</b>: api_key dell'istanza (Key Entities) già prevista dal contratto; da comunicare a Docplanner gli IP statici in uscita del servizio Render (Settings del servizio td-retail, "Outbound IP addresses"), non l'IP del sito web. L'estensione a reservations e users (prenotazioni e pazienti) richiede un accordo aggiuntivo: finché non c'è, le prenotazioni online si leggono dall'export GIPO con il canale di prenotazione. <b>Docplanner (GIPO)</b>, l'attivazione dell'export schedulato delle accettazioni (CSV via SFTP o cartella condivisa) oppure l'accesso alle API di reportistica, con la lista dei campi: numero accettazione, data, paziente (ID, CF, sesso, data di nascita, comune), sede, codice e descrizione prestazione, importo lordo, sconto, netto, regime, canale.</p>
        <p className="small"><b>CB Sistemi (StudioLab)</b>: export schedulato delle accettazioni B2B con azienda committente, prestazione, quantità, prezzo convenzionato; oppure web service se disponibile sulla vostra versione.</p>
        <p className="small muted">Con gli export schedulati su SFTP il connettore può importare automaticamente i file ogni notte con la mappatura salvata.</p>
      </Card>
    </div>
  );
}
