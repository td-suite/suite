// Impostazioni (Facility e amministratore): SLA per priorità, fattori CO2 e di conversione in kWh, promemoria, soglia delle anomalie,
// fonte dell'attività, avvisi ai site manager; stato delle integrazioni; job delle scadenze eseguito a mano (data di prova in sviluppo)
import React, { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, useToast, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { VECTOR, PRIORITY, num, itDateTime } from '../format.js';

export default function Impostazioni() {
  const toast = useToast();
  const { data, error, reload } = useApi('/settings');
  const [f, setF] = useState(null);
  const [today, setToday] = useState('');
  const [out, setOut] = useState(null);
  useEffect(() => { if (data) setF({ sla_hours: { ...data.sla_hours }, co2_factors: { ...data.co2_factors }, kwh_factors: { ...data.kwh_factors }, reminder_days: (data.reminder_days || []).join(', '), anomaly_pct: data.anomaly_pct, activity_source: data.activity_source, notify_site_managers: data.notify_site_managers !== false }); }, [data]);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data || !f) return <div className="page"><Loading /></div>;
  const save = async () => { try { await api.put('/settings', { ...f, reminder_days: String(f.reminder_days).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) }); toast('Impostazioni salvate'); reload(); } catch (e) { toast(e, 'err'); } };
  const run = async (dry) => { try { const r = await api.post('/jobs/scadenze/run', { today: today || undefined, dry_run: dry }); setOut(r); toast(dry ? 'Prova eseguita' : `Job eseguito: ${r.notifiche} notifiche`); } catch (e) { toast(e, 'err'); } };
  const obj = (k, kk) => (ev) => setF({ ...f, [k]: { ...f[k], [kk]: ev.target.value } });
  return (
    <div className="page">
      <PageHead title="Impostazioni" icon="gear" sub="Valori di benchmark da confermare: SLA, fattori di emissione e soglie si tarano sull'esperienza della rete." actions={<button className="btn" onClick={save}>Salva</button>} />
      <div className="fa-two">
        <Card title="SLA degli interventi (ore)" icon="clock">
          <div className="fa-grid g4">{Object.keys(PRIORITY).map((p) => <Field key={p} label={PRIORITY[p].label}><input className="fa-in w" type="number" min="1" value={f.sla_hours[p]} onChange={obj('sla_hours', p)} /></Field>)}</div>
          <div className="small muted">Predefiniti: urgente 24 ore, alta 3 giorni, media 10 giorni, bassa 30 giorni.</div>
        </Card>
        <Card title="Promemoria e anomalie" icon="bell">
          <div className="fa-grid g2">
            <Field label="Promemoria (giorni prima)" help="Es. 30, 7, 0: mai doppi per la stessa scadenza"><input className="fa-in w" value={f.reminder_days} onChange={(e) => setF({ ...f, reminder_days: e.target.value })} /></Field>
            <Field label="Soglia anomalia (%)" help="Mese oltre la soglia rispetto all'anno prima o alla media di 3 mesi"><input className="fa-in w" type="number" min="5" max="200" value={f.anomaly_pct} onChange={(e) => setF({ ...f, anomaly_pct: e.target.value })} /></Field>
            <Field label="Fonte dell'attività"><select className="fa-in w" value={f.activity_source} onChange={(e) => setF({ ...f, activity_source: e.target.value })}><option value="AUTO">Automatica (Retail, poi Cash)</option><option value="RETAIL">Retail Assistant (accettazioni)</option><option value="CASH">Cash Management (giorni con rendiconto)</option><option value="MANUALE">Solo manuale</option></select></Field>
            <label className="row small" style={{ gap: 6, alignSelf: 'end' }}><input type="checkbox" checked={f.notify_site_managers} onChange={(e) => setF({ ...f, notify_site_managers: e.target.checked })} />Promemoria anche ai site manager</label>
          </div>
        </Card>
      </div>
      <Card title="Fattori di conversione (indicativi)" icon="bolt" style={{ marginBottom: 16 }}>
        <table className="t fa-table"><thead><tr><th>Vettore</th><th>kgCO2 per unità</th><th>kWh per unità</th><th className="small">Predefiniti</th></tr></thead>
          <tbody>{Object.keys(VECTOR).map((v) => <tr key={v}><td>{VECTOR[v]}</td><td><input className="fa-in" type="number" min="0" step="0.001" value={f.co2_factors[v] ?? ''} onChange={obj('co2_factors', v)} /></td><td><input className="fa-in" type="number" min="0" step="0.01" value={f.kwh_factors[v] ?? ''} onChange={obj('kwh_factors', v)} /></td><td className="small muted">{data.defaults.co2_factors[v]} · {data.defaults.kwh_factors[v]}</td></tr>)}</tbody></table>
        <div className="small muted">Elettrico rete Italia circa 0,26 kgCO2/kWh, gas naturale circa 1,98 kgCO2/Smc e 10,69 kWh/Smc: valori medi nazionali indicativi, da aggiornare con i fattori del fornitore o di ISPRA.</div>
      </Card>
      <div className="fa-two">
        <Card title="Integrazioni" icon="refresh">
          <ul className="fa-list">
            <li><span>Payments (utenze, bollette, canoni)</span><Badge tone={data.finance ? 'green' : 'red'}>{data.finance ? 'attivo' : 'non avviato'}</Badge></li>
            <li><span>Room Planning (planimetrie)</span><Badge tone={data.room ? 'green' : 'grey'}>{data.room ? 'attivo' : 'non avviato'}</Badge></li>
            <li><span>Retail Assistant (accettazioni)</span><Badge tone={data.activity.retail ? 'green' : 'grey'}>{data.activity.retail ? 'attivo' : 'non avviato'}</Badge></li>
            <li><span>Cash Management (giorni di apertura)</span><Badge tone={data.activity.cash ? 'green' : 'grey'}>{data.activity.cash ? 'attivo' : 'non avviato'}</Badge></li>
            <li><span>Analisi con Claude</span><Badge tone={data.ai.enabled ? 'green' : data.ai.mock ? 'amber' : 'grey'}>{data.ai.enabled ? 'chiave configurata' : data.ai.mock ? 'simulata' : 'non configurata'}</Badge></li>
            <li><span>Archivio file</span><span className="small">{data.storage === 'blob' ? 'Azure Blob' : 'database'} · fino a {num(data.limiti.max_file_mb)} MB</span></li>
            <li><span>Posta</span><span className="small">{data.mail.provider}</span></li>
          </ul>
        </Card>
        <Card title="Job delle scadenze" icon="clock">
          <div className="small muted" style={{ marginBottom: 8 }}>Ogni giorno: scadenze passate a scadute, promemoria a {String(f.reminder_days)} giorni, attività dalle sorgenti, anomalie recenti. {data.ultimo_promemoria?.sent_at ? `Ultimo promemoria ${itDateTime(data.ultimo_promemoria.sent_at)}.` : ''}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><input className="fa-in" type="date" value={today} onChange={(e) => setToday(e.target.value)} title="Data di prova (solo fuori produzione)" /><button className="btn ghost" onClick={() => run(true)}>Prova</button><button className="btn" onClick={() => run(false)}><Icon name="send" />Esegui ora</button></div>
          {out && <pre className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{JSON.stringify({ giorno: out.giorno, scadute: out.scadute, gruppi: out.gruppi, notifiche: out.notifiche, email: out.email, dettaglio: out.dettaglio }, null, 1)}</pre>}
        </Card>
      </div>
    </div>
  );
}
