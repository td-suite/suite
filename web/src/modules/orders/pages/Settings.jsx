import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Card, Badge, useToast } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { BASE } from '../api.js';

export default function Settings() {
  const toast = useToast();
  const { data, reload } = useApi('/settings');
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [alertsRun, setAlertsRun] = useState(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!data || !s) return <div className="page"><Loading /></div>;
  const save = async () => { setErr(null); try { await api.put('/settings', s); toast('Impostazioni salvate'); reload(); } catch (e) { setErr(e); } };
  const Mode = ({ ok, label }) => <Badge tone={ok ? 'green' : 'mauve'}>{label}</Badge>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Regole di riordino, solleciti automatici, stato delle integrazioni</div></div><button className="btn" onClick={save}>Salva</button></div>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Card title="Ordine automatico delle sedi">
          <Field label="Formula di riordino">
            <select value={s.reorder_formula} onChange={(e) => setS({ ...s, reorder_formula: e.target.value })}>
              <option value="DIFF_X_FACTOR">(Produzione mensile − Giacenza reale) × fattore</option>
              <option value="TARGET_MINUS_STOCK">Produzione mensile × fattore − Giacenza</option>
            </select>
            <span className="help">Scelta di Francesco: la prima. Con giacenza pari alla produzione la prima ordina zero, la seconda ricostituisce la scorta obiettivo. Il fattore (default 1,5) si imposta per articolo nel catalogo. Il risultato è sempre arrotondato per eccesso a confezioni intere e mai negativo.</span>
          </Field>
          <Field label="Mesi di produzione per la media" className="mt"><input type="number" min="1" max="12" value={s.production_months} onChange={(e) => setS({ ...s, production_months: e.target.value })} style={{ width: 120 }} /><span className="help">Ultimo trimestre = 3</span></Field>
        </Card>
        <Card title="Solleciti automatici">
          <label className="f inline"><input type="checkbox" checked={s.alerts_enabled === 'true'} onChange={(e) => setS({ ...s, alerts_enabled: e.target.checked ? 'true' : 'false' })} />Attivi (giacenza mensile, ricezioni non confermate, ordini da verificare)</label>
          <div className="form-grid mt">
            <Field label="Ora del controllo"><input type="number" min="0" max="23" value={s.alert_hour} onChange={(e) => setS({ ...s, alert_hour: e.target.value })} /></Field>
            <Field label="Sollecito ricezione dopo (giorni)"><input type="number" min="1" value={s.receipt_reminder_days} onChange={(e) => setS({ ...s, receipt_reminder_days: e.target.value })} /></Field>
            <Field label="Riepilogo ordini da verificare dopo (giorni)"><input type="number" min="1" value={s.verify_reminder_days} onChange={(e) => setS({ ...s, verify_reminder_days: e.target.value })} /></Field>
          </div>
          <div className="row mt"><button className="btn ghost" onClick={async () => { setAlertsRun(await api.post('/alerts/run')); }}>Esegui ora il controllo</button>{alertsRun && <span className="small muted">Giacenze: {alertsRun.stock?.length || 0} · ricezioni: {alertsRun.receipt?.length || 0} · verifiche: {alertsRun.verify?.length || 0} invii</span>}</div>
        </Card>
        <Card title="Integrazioni" actions={<a className="btn sm ghost" href="/admin/connectors" title="Chiavi, base URL e segreti in ingresso si impostano in Amministrazione, Connettori">Configura in Amministrazione &gt; Connettori</a>}>
          <p className="small muted" style={{ marginTop: 0 }}>Chiavi API, base URL e segreti in ingresso di StudioLab e Silva vengono dai connettori unici della Suite (Amministrazione &gt; Connettori), validi per tutti i moduli: qui solo lo stato.</p>
          <div className="table-wrap"><table className="t"><tbody>
            <tr><td>Silva Group: canali storici in ingresso (feed giacenze, ordini in polling, avanzamenti; non usati dalla API ordini v1)</td><td><Mode ok={data.silva.inboundConfigured} label={data.silva.inboundConfigured ? 'segreto in ingresso impostato' : 'segreto in ingresso mancante'} /></td><td className="small muted">{data.silva.inboundConfigured ? `Ultimo feed ${data.silva.last_feed_at ? itDateTime(data.silva.last_feed_at) : 'mai'} · ultima lettura ordini ${data.silva.last_poll_at ? itDateTime(data.silva.last_poll_at) : 'mai'}` : 'Impostare il segreto in ingresso del connettore Silva e consegnarlo al fornitore'}{data.silva.connector?.source === 'env' ? ' · in uso le variabili d\'ambiente' : ''}{data.silva.email ? ` · email di ripiego ${data.silva.email}` : ''}</td></tr>
            <tr><td>StudioLab ServiceNET: REST (X-API-KEY)</td><td><Mode ok={data.studiolab.configured} label={data.studiolab.configured ? 'collegato' : 'non configurato'} /></td><td className="small muted">{data.studiolab.configured ? `${data.studiolab.baseUrl} · CodiceCliente ${data.studiolab.clientCode}` : 'Impostare la chiave API nel connettore StudioLAB'}{data.studiolab.connector?.last_test_at ? ` · ultimo test ${data.studiolab.connector.last_status} ${itDateTime(data.studiolab.connector.last_test_at)}` : ''}{data.studiolab.connector?.source === 'env' ? ' · in uso le variabili d\'ambiente' : ''}</td></tr>
            <tr><td>StudioLab: HL7 in ingresso (produzione)</td><td><Mode ok={data.studiolab.inboundConfigured} label={data.studiolab.inboundConfigured ? 'segreto in ingresso impostato' : 'segreto in ingresso mancante'} /></td><td className="small muted">{data.studiolab.inboundConfigured ? `Ultimo messaggio ${data.studiolab.last_hl7_at ? itDateTime(data.studiolab.last_hl7_at) : 'mai'}` : 'Impostare il segreto in ingresso del connettore StudioLAB e comunicare a CB Sistemi URL e segreto'}</td></tr>
            <tr><td>Microsoft 365: accesso</td><td><Mode ok={data.entra} label={data.entra ? 'attivo' : 'non configurato'} /></td><td className="small muted">Accesso gestito dalla Suite TD (variabili ENTRA_* della Suite)</td></tr>
            <tr><td>Email</td><td><Mode ok={data.mail.configured} label={data.mail.mode || 'non configurata'} /></td><td className="small muted">{data.mail.from ? `Mittente ${data.mail.from}` : 'Gli invii restano registrati ma non partono'}</td></tr>
          </tbody></table></div>
          <div className="small muted mt">Endpoint per i fornitori (segreto in ingresso nell'header X-API-KEY, senza sessione): {data.integrationsUrl}/silva/… e {data.integrationsUrl}/studiolab/hl7. L'elenco completo con le istruzioni è nella pagina Connettori di Amministrazione.</div>
        </Card>
        <SilvaStato silva={data.silva?.api} onChanged={reload} />
        <Card title="Email di prova">
          <div className="row"><input type="email" placeholder="destinatario" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 320 }} /><button className="btn ghost" disabled={!testTo} onClick={async () => { const r = await api.post('/settings/test-email', { to: testTo }); toast(`Esito: ${r.status}${r.error ? ' · ' + r.error : ''}`, r.status === 'INVIATA' ? 'ok' : 'err'); }}>Invia</button></div>
          <div className="small muted mt">Indirizzo del modulo nella Suite: {data.baseUrl} · mittente {data.mail.from || 'non configurato'}</div>
        </Card>
      </div>
    </div>
  );
}

// Silva: trasmissione degli ordini (Guida tecnica API ordini v1): destinazioni lette, ultimo invio, coda ed errori, ultimo controllo
// dello stato, automatismo dopo il primo invio concordato, strutture attive senza destinazione Silva
function SilvaStato({ silva, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  if (!silva) return null;
  if (silva.errore) return <Card title="Silva: trasmissione ordini"><div className="alert err">{silva.errore}</div></Card>;
  const k = silva.connettore;
  const run = async (key, fn, ok) => { setBusy(key); setErr(null); try { const r = await fn(); toast(ok(r)); onChanged(); } catch (e) { setErr(e); } setBusy(null); };
  const Row = ({ label, children }) => <tr><td>{label}</td><td className="small">{children}</td></tr>;
  return (
    <Card title="Silva: trasmissione ordini (API v1)" className="span2" actions={<><a className="btn sm ghost" href={`${BASE}/strutture?vista=silva`}>Destinazioni delle strutture</a> <a className="btn sm ghost" href="/admin/connectors">Connettore</a></>}>
      <ErrorBox error={err} />
      <div className="table-wrap"><table className="t"><tbody>
        <Row label="Trasmissione all'approvazione">{k.automatico ? <Badge tone="green">automatica attiva</Badge> : <Badge tone="mauve">non automatica</Badge>} {k.motivo_non_automatico && <span className="muted">{k.motivo_non_automatico}</span>}{k.primo_invio_at && <div className="muted">Primo invio concordato: {k.primo_invio_numero}{k.primo_invio_riferimento ? ` (rif. ${k.primo_invio_riferimento})` : ''} il {itDateTime(k.primo_invio_at)}{k.primo_invio_confermato_at ? ` · automatismo dal ${itDateTime(k.primo_invio_confermato_at)}` : ''}</div>}</Row>
        <Row label="Destinazioni Silva lette">{silva.destinazioni.lette ? `${silva.destinazioni.lette} sedi autorizzate · lette il ${itDateTime(silva.destinazioni.letto_al)}` : <span className="muted">mai lette: "Aggiorna destinazioni" in Strutture o "Prova connessione" nel connettore</span>}</Row>
        <Row label="Ultimo invio">{silva.ultimo_invio ? `${silva.ultimo_invio.numero} il ${itDateTime(silva.ultimo_invio.at)}${silva.ultimo_invio.riferimento ? ` · rif. ${silva.ultimo_invio.riferimento}` : ''}` : <span className="muted">nessuno</span>}</Row>
        <Row label="Ordini approvati">{silva.da_trasmettere} da trasmettere · {silva.in_coda} in coda · <span className={silva.in_errore ? 'red strong' : ''}>{silva.in_errore} in errore o con dati da completare</span> · {silva.presso_silva} presso Silva non ancora consegnati</Row>
        <Row label="Ultimo controllo dello stato">{silva.ultimo_controllo_stato?.at ? `${itDateTime(silva.ultimo_controllo_stato.at)} · ${silva.ultimo_controllo_stato.esito || ''}` : <span className="muted">mai (job ogni 30 minuti)</span>}</Row>
        <Row label="Limite 30 richieste al minuto">{silva.limite.usate_ultimo_minuto} chiamate nell'ultimo minuto{silva.limite.pausa_fino ? ` · in pausa per un 429 fino alle ${itDateTime(silva.limite.pausa_fino)}` : ''}</Row>
      </tbody></table></div>
      <div className="row mt" style={{ gap: 8 }}>
        {k.primo_invio_at && !k.primo_invio_confermato && <button className="btn sm" disabled={busy} onClick={() => run('auto', () => api.post('/silva/automatismo', { attiva: true }), () => 'Trasmissione automatica attiva')}>Attiva la trasmissione automatica</button>}
        {k.primo_invio_confermato && <button className="btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Sospendere la trasmissione automatica? Gli ordini approvati resteranno da trasmettere a mano finché non la riattivi.')) run('auto', () => api.post('/silva/automatismo', { attiva: false }), () => 'Trasmissione automatica sospesa'); }}>Sospendi la trasmissione automatica</button>}
        {k.chiave && <button className="btn sm ghost" disabled={busy} onClick={() => run('stato', () => api.post('/silva/stato/aggiorna'), (r) => r.skipped || `Stato letto per ${r.controllati} ordini${r.interrotto ? ` (interrotto: ${r.interrotto})` : ''}`)}>{busy === 'stato' ? 'Lettura…' : 'Aggiorna ora lo stato da Silva'}</button>}
      </div>
      {silva.strutture_senza_destinazione.length > 0 && (
        <div className="mt">
          <div className="strong small">{silva.strutture_senza_destinazione.length} strutture attive senza destinazione Silva: i loro ordini approvati non si trasmettono</div>
          <div className="small muted" style={{ marginTop: 4 }}>{silva.strutture_senza_destinazione.map((x) => `${x.name}${x.city ? ` (${x.city})` : ''}${x.silva_code ? ` · codice "${x.silva_code}" non valido` : ''}`).join(' · ')}</div>
        </div>
      )}
      {silva.strutture_destinazione_non_autorizzata.length > 0 && <div className="small red mt">Destinazione non più tra quelle autorizzate da Silva: {silva.strutture_destinazione_non_autorizzata.map((x) => `${x.name} (${x.silva_code})`).join(', ')}</div>}
    </Card>
  );
}
