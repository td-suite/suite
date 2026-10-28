import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, useToast, Badge } from '../components/ui.jsx';
import { Sezionali } from '../components/sezionali.jsx';

export default function Settings() {
  const toast = useToast();
  const { data } = useApi('/settings');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const daily = useApi('/comms/daily');
  const [testTo, setTestTo] = useState('');
  const [testRes, setTestRes] = useState(null);
  useEffect(() => { if (data) setF({ creditor_name: '', creditor_iban: '', creditor_bic: '', creditor_id: '', royalty_invoice_prefix: 'RY', pickup_alert_days: '2', daily_alert_hour: '10', daily_alert_enabled: 'true', daily_summary_admins: 'true', closing_alert_delay_minutes: '60', schedule_alert_days: '7', schedule_istat_pct: '1.5', schedule_utility_growth_pct: '0', schedule_notify_roles: 'SUPERADMIN,ADMIN,FINANCE', ...data }); }, [data]);
  if (!f) return <div className="page"><Loading /></div>;
  const save = async () => { setErr(null); try { await api.put('/settings', f); toast('Impostazioni salvate'); } catch (e) { setErr(e); } };
  const i = (k, label, help, extra = {}) => <Field label={label} help={help}><input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Dati del creditore SEPA e parametri di controllo</div></div><button className="btn" onClick={save}>Salva</button></div>
      <ErrorBox error={err} />
      <div className="grid">
        <Card title="Creditore SEPA (Toscana Diagnostica)">
          <p className="small muted" style={{ marginTop: 0 }}>Se vuoti, ragione sociale, IBAN e BIC del creditore vengono dalla Legal entity capofila dell'anagrafica (IBAN in Amministrazione, Legal entity) e dai Dati aziendali della Suite (Amministrazione, Impostazioni). Compilali qui solo per forzare un valore diverso.</p>
          <div className="form-grid">
            {i('creditor_name', 'Ragione sociale (forzatura)')}
            {i('creditor_iban', 'IBAN di accredito (forzatura)', null, { className: 'mono' })}
            {i('creditor_bic', 'BIC (forzatura, facoltativo)')}
            {i('creditor_id', 'Creditor Identifier (CI)', 'Rilasciato dalla banca per gli addebiti SDD, formato ITnnZZZ + codice', { className: 'mono' })}
          </div>
        </Card>
        <Card title="Parametri">
          <div className="form-grid">
            {i('royalty_invoice_prefix', 'Prefisso numerazione estratti royalty', 'es. RY → RY2026-0001', { maxLength: 10 })}
            {i('pickup_alert_days', 'Giorni oltre i quali un flusso è in ritardo', 'Rendiconti non versati da più di N giorni compaiono nel cruscotto', { type: 'number', min: 0, max: 60 })}
          </div>
        </Card>
        <Card title="Comunicazioni email">
          <div className="row" style={{ marginBottom: 12 }}>
            <span>Stato invio:</span>
            {daily.data?.mail?.configured ? <Badge tone="green">attivo · Microsoft 365 · {daily.data.mail.from}</Badge> : <Badge tone="red">non configurato: le email vengono solo registrate</Badge>}
          </div>
          <div className="form-grid">
            {i('closing_alert_delay_minutes', 'Sollecito alla sede: minuti dopo la chiusura', 'Se il rendiconto del giorno manca, la sede riceve il sollecito questo tempo dopo il suo orario di chiusura (orari in anagrafica sede)', { type: 'number', min: 0, max: 600 })}
            {i('daily_alert_hour', 'Ora del riepilogo del mattino (0-23)', 'Ogni mattina il sistema riepiloga agli amministratori i rendiconti mancanti del giorno prima e sollecita le sedi senza orario di chiusura', { type: 'number', min: 0, max: 23 })}
            <Field label="Controllo automatico"><select value={f.daily_alert_enabled} onChange={(e) => setF({ ...f, daily_alert_enabled: e.target.value })}><option value="true">Attivo</option><option value="false">Disattivo</option></select></Field>
            <Field label="Riepilogo agli amministratori"><select value={f.daily_summary_admins} onChange={(e) => setF({ ...f, daily_summary_admins: e.target.value })}><option value="true">Sì, ogni giorno</option><option value="false">No</option></select></Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Field label="Invia una email di prova a"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="tuo@indirizzo.it" /></Field>
            <button className="btn ghost" style={{ marginTop: 18 }} disabled={!testTo} onClick={async () => { setTestRes(null); try { setTestRes(await api.post('/comms/test', { to: testTo })); } catch (e) { setErr(e); } }}>Invia prova</button>
          </div>
          {testRes && <div className={`alert ${testRes.status === 'INVIATA' ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}>{testRes.status === 'INVIATA' ? 'Email inviata.' : testRes.status === 'NON_CONFIGURATA' ? 'Invio non configurato: registrata nel registro invii.' : `Invio fallito: ${testRes.error}`}</div>}
          <p className="small muted" style={{ marginTop: 10 }}>Le email partono dalla casella della Suite TD (Microsoft 365, permesso applicativo Mail.Send). Se l'invio non è configurato sul server della Suite, ogni messaggio resta comunque nel registro invii.</p>
        </Card>
        <Card title="Scadenziario strutture">
          <p className="small muted" style={{ marginTop: 0 }}>Affitti e utenze delle sedi (pagina Scadenziario strutture). Sedi, locatori e fornitori vengono dall'anagrafica unica: qui restano solo i parametri degli avvisi e le ipotesi della previsione.</p>
          <div className="form-grid">
            {i('schedule_alert_days', 'Avviso: giorni di anticipo', 'Le scadenze entro questi giorni (e quelle scadute non segnate) generano una notifica in app, una sola volta per scadenza', { type: 'number', min: 0, max: 120 })}
            {i('schedule_istat_pct', 'Previsione: rivalutazione ISTAT annua %', 'Ipotesi applicata ai canoni con adeguamento ISTAT dal prossimo anniversario della decorrenza', { type: 'number', step: '0.1', min: -10, max: 30 })}
            {i('schedule_utility_growth_pct', 'Previsione: crescita annua delle utenze %', 'Ipotesi applicata alla media mensile delle bollette (0 = costi costanti)', { type: 'number', step: '0.1', min: -50, max: 99 })}
            {i('schedule_notify_roles', 'Profili che ricevono gli avvisi', 'Profili Cash separati da virgola: SUPERADMIN, ADMIN, FINANCE, CASSIERE, OPERATOR (gli operatori solo per le proprie sedi)')}
          </div>
        </Card>
        <div id="sezionali"><Sezionali /></div>
      </div>
    </div>
  );
}
