import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Icon } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { itDateTime, num } from '../format.js';

const LABEL = { GIPO: 'GIPO (Docplanner) · accettazione e prenotazione B2C', TUOTEMPO: 'TuoTempo (Docplanner) · prenotazione online', STUDIOLAB: 'StudioLab (CB Sistemi) · accettazione B2B' };

// Credenziali, base URL e istanza stanno nel connettore unico della Suite (Amministrazione > Connettori): qui restano le
// sincronizzazioni del modulo (pianificazione, giorni, esiti) e l'import da file.
export default function Connectors() {
  const toast = useToast();
  const d = useApi('/connectors');
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(null);
  const save = async (c) => {
    const e = edit[c.kind] || {};
    try { await api.put(`/connectors/${c.kind}`, { enabled: e.enabled ?? c.enabled, schedule: e.schedule ?? c.schedule, settings: e.settings || {} }); toast('Connettore salvato'); setEdit({ ...edit, [c.kind]: undefined }); d.reload(); } catch (err) { toast(err.message, 'err'); }
  };
  const test = async (c) => { setBusy(c.kind); try { const r = await api.post(`/connectors/${c.kind}/test`); toast(r.message); d.reload(); } catch (err) { toast(err.message, 'err'); d.reload(); } finally { setBusy(null); } };
  const sync = async (c) => { setBusy(c.kind); try { const r = await api.post(`/connectors/${c.kind}/sync`, {}); toast(`Sincronizzazione: ${num(r.rows_ok)} righe importate`); d.reload(); } catch (err) { toast(err.message, 'err'); d.reload(); } finally { setBusy(null); } };
  const coreState = (core) => !core ? <Badge tone="grey">stato non disponibile</Badge> : core.env_in_use ? <Badge tone="mauve">variabili d'ambiente</Badge> : core.configured ? <Badge tone={core.active ? 'green' : 'grey'}>{core.active ? 'configurato e attivo' : 'configurato, disabilitato'}</Badge> : <Badge tone="grey">non configurato</Badge>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Connettori ai gestionali</h1><div className="sub">Credenziali, base URL e istanza si impostano una volta sola in <a href="/admin/connectors">Amministrazione, Connettori</a> e valgono per tutta la Suite. Qui si governano le sincronizzazioni del modulo; finché i fornitori non forniscono API, i dati entrano con l'<Link to={`${base}/import`}>import da file</Link>.</div></div><a className="btn ghost" href="/admin/connectors"><Icon name="cloud" /> Configura in Amministrazione &gt; Connettori</a></div>
      <ErrorBox error={d.error} />
      {!d.data ? <Loading /> : <div className="grid g3">
        {d.data.connectors.map((c) => { const e = edit[c.kind] || {}; const v = (k) => e[k] ?? c[k]; const core = c.core; return (
          <Card key={c.kind} title={c.kind} actions={<Badge tone={c.enabled ? 'green' : 'grey'}>{c.enabled ? 'sincronizzazione abilitata' : 'sincronizzazione disabilitata'}</Badge>}>
            <p className="small muted" style={{ marginTop: 0 }}>{LABEL[c.kind]}</p>
            <div className="small" style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
              <div>Connettore della Suite: {coreState(core)}</div>
              {core && <div className="muted">Base URL {core.base_url || 'non impostata'} · credenziali {core.credentials?.configured ? `impostate ••••${Object.values(core.credentials.keys)[0]?.hint || ''}` : 'non impostate'}{c.kind === 'TUOTEMPO' ? ` · istanza ${core.settings?.instance || 'non impostata'}` : ''}{core.last_test_at ? ` · ultimo test ${core.last_status} ${itDateTime(core.last_test_at)}` : ''}</div>}
            </div>
            <p className="small" style={{ background: 'var(--silk)', padding: 10, borderRadius: 8 }}>{c.kind === 'TUOTEMPO' ? 'TuoTempo API v3 (Key Entities): Bearer api_key fissa, chiamate server-side dagli IP statici in uscita di Render autorizzati da Docplanner. Il perimetro contrattuale copre solo attività, aree, risorse, tipologie e assicurazioni: la sincronizzazione aggiorna il catalogo prenotabile (prezzi web, tipologie) e abbina le aree alle sedi. Prenotazioni e pazienti non sono autorizzati: le vendite B2C entrano dall\'export GIPO.' : c.settings?.note}</p>
            {c.kind === 'TUOTEMPO' && c.settings?.tuotempo && <p className="small" style={{ marginTop: 0 }}>Ultimo catalogo: {num(c.settings.tuotempo.activities)} attività · {num(c.settings.tuotempo.areas)} aree ({num(c.settings.tuotempo.areas_matched)} abbinate a sedi) · {num(c.settings.tuotempo.resources_active)} risorse attive su {num(c.settings.tuotempo.resources)} ({num(c.settings.tuotempo.machines)} macchine) · {num(c.settings.tuotempo.insurances)} assicurazioni/convenzioni{c.settings.tuotempo.areas_unmatched?.length ? <span className="red"> · aree senza sede: {c.settings.tuotempo.areas_unmatched.join(', ')}</span> : null}</p>}
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
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
