import React, { useState } from 'react';
import { api, apiBase } from '../api.js';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, Empty, ErrorBox, useToast, Badge, Field } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { ADMIN_SITES } from './Sedi.jsx';

export default function Settings() {
  const toast = useToast();
  const settings = useApi('/settings');
  const maillog = useApi('/comms/log?limit=100');
  const [cfg, setCfg] = useState(null);
  const saveCfg = async () => { try { await api.put('/settings', cfg); toast('Impostazioni salvate'); settings.reload(); } catch (e) { setErr(e); } };
  const sendNow = async () => { try { const r = await api.post('/criticita/invia'); toast(r.over ? `Avviso inviato per ${r.over} sedi` : 'Nessuna sede sopra soglia'); maillog.reload(); } catch (e) { setErr(e); } };
  const [err, setErr] = useState(null);
  const [res, setRes] = useState(null);

  const importFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      setErr(null); setRes(null);
      try {
        const envelope = JSON.parse(fr.result);
        const n = (envelope.data?.strutture || envelope.strutture || []).length;
        if (!n) throw new Error('Il file non contiene sedi');
        if (!window.confirm(`Il file contiene ${n} sedi: la configurazione Room delle sedi presenti nell'anagrafica della Suite viene aggiornata; le altre vengono saltate e segnalate. Procedere?`)) return;
        const r = await api.post('/backup/import', { envelope });
        setRes(r); toast(`Importazione completata: ${r.updated} sedi aggiornate${r.saltate?.length ? `, ${r.saltate.length} saltate` : ''}`);
      } catch (e2) { setErr(e2); }
    };
    fr.readAsText(f); e.target.value = '';
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni e backup</h1><div className="sub">Soglia delle criticità e avvisi automatici, copia di sicurezza, importazione, registro email. Sedi e persone si amministrano nell'anagrafica unica della Suite.</div></div>
        <div className="row"><Link className="btn ghost" to={ADMIN_SITES}>Sedi in Amministrazione</Link><Link className="btn ghost" to="/people">Persone in Amministrazione</Link></div></div>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Card title="Backup completo">
          <p>Scarica un file JSON con la configurazione Room di tutte le sedi (ambulatori, personale pianificato, orari, loghi e planimetrie, con l'anagrafica attuale della Suite). È lo stesso formato della versione precedente e del file in OneDrive: si può reimportare qui in qualsiasi momento.</p>
          <div className="row"><a className="btn" href={`${apiBase}/backup`} download>Scarica backup</a></div>
          <p className="small muted" style={{ marginTop: 10 }}>I dati vivono nel database della Suite, con i suoi backup; questo file serve come copia indipendente da conservare in OneDrive.</p>
        </Card>
        <Card title="Importa da backup">
          <p>Accetta i file di backup di questa versione e quelli della versione precedente (Backup_Pianificazione_*.json, Pianificazione_Ambulatori_dati.json). Le sedi vengono riconosciute per id della Suite, codice o id dell'app di origine; quelle che non esistono nell'anagrafica vanno prima create in Amministrazione &gt; Sedi.</p>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>Scegli il file JSON…<input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={importFile} /></label>
          {res && <div className="alert info" style={{ marginTop: 10 }}>Aggiornate {res.updated} sedi{res.saltate?.length ? `; saltate perché non in anagrafica: ${res.saltate.join(', ')}` : ''}. Ogni sede importata ha una nuova versione in cronologia: lo stato precedente resta ripristinabile.</div>}
        </Card>
      </div>
      <Card title="Avvisi automatici sulle criticità" className="mt">
        {!settings.data ? <Loading /> : (() => { const c = cfg || { crit_soglia: settings.data.crit_soglia, crit_alert_enabled: settings.data.crit_alert_enabled, crit_alert_hour: settings.data.crit_alert_hour, rendiconto_cc: settings.data.rendiconto_cc, resp_san_nome: settings.data.resp_san_nome }; return <>
          <p>Ogni giorno all'ora indicata il sistema ricalcola la pianificazione di tutte le sedi; se una sede ha un numero di criticità alte pari o superiore alla soglia, invia una email agli amministratori e all'email della sede. Il cruscotto mostra comunque il banner in tempo reale.</p>
          <div className="row">
            <Field label="Soglia criticità alte"><input type="number" min="1" max="999" value={c.crit_soglia} onChange={(e) => setCfg({ ...c, crit_soglia: e.target.value })} style={{ width: 100 }} /></Field>
            <Field label="Ora dell'invio"><input type="number" min="0" max="23" value={c.crit_alert_hour} onChange={(e) => setCfg({ ...c, crit_alert_hour: e.target.value })} style={{ width: 100 }} /></Field>
            <Field label="Avvisi email"><select value={c.crit_alert_enabled} onChange={(e) => setCfg({ ...c, crit_alert_enabled: e.target.value })} style={{ width: 'auto' }}><option value="true">attivi</option><option value="false">disattivati</option></select></Field>
            <button className="btn" disabled={!cfg} onClick={saveCfg}>Salva</button>
            <button className="btn ghost" onClick={sendNow}>Invia ora l'avviso</button>
          </div>
          <p className="small muted">Invio email: {settings.data.mail?.configured ? <Badge tone="green">Microsoft 365 · {settings.data.mail.from}</Badge> : <Badge tone="red">non configurato nella Suite (casella mittente e permesso Mail.Send)</Badge>}{settings.data.crit_alert_last_run ? ` · ultimo controllo ${settings.data.crit_alert_last_run}` : ''}</p>
        </>; })()}
      </Card>
      <Card title="Personale sanitario: rendiconti" className="mt">
        {!settings.data ? <Loading /> : (() => { const c = cfg || { crit_soglia: settings.data.crit_soglia, crit_alert_enabled: settings.data.crit_alert_enabled, crit_alert_hour: settings.data.crit_alert_hour, rendiconto_cc: settings.data.rendiconto_cc, resp_san_nome: settings.data.resp_san_nome }; return <>
          <p>Il rendiconto mensile approvato dal Responsabile del personale sanitario viene inviato al professionista con questi indirizzi in copia (amministrazione e backoffice per la fatturazione). Il Responsabile è l'utente con profilo "Responsabile sanitario" sul modulo Room Planning (Amministrazione della Suite &gt; Utenti).</p>
          <div className="row">
            <Field label="Copia conoscenza rendiconti (più indirizzi separati da virgola)"><input value={c.rendiconto_cc || ''} onChange={(e) => setCfg({ ...c, rendiconto_cc: e.target.value })} style={{ width: 420 }} /></Field>
            <Field label="Nome del Responsabile (nelle email)"><input value={c.resp_san_nome || ''} onChange={(e) => setCfg({ ...c, resp_san_nome: e.target.value })} style={{ width: 220 }} /></Field>
            <button className="btn" disabled={!cfg} onClick={saveCfg}>Salva</button>
          </div>
        </>; })()}
      </Card>
      <Card title="Registro email" className="mt" flush>
        {!maillog.data ? <Loading /> : !maillog.data.length ? <Empty>Nessuna email registrata</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Tipo</th><th>A</th><th>Oggetto</th><th>Allegato</th><th>Esito</th><th>Da</th></tr></thead>
            <tbody>{maillog.data.map((l) => <tr key={l.id}><td className="small">{itDateTime(l.at)}</td><td className="mono small">{l.kind}</td><td className="small">{l.to_addr}</td><td className="small">{l.subject}</td><td className="small">{l.attachment_name}</td><td>{l.status === 'INVIATA' ? <Badge tone="green">inviata</Badge> : l.status === 'NON_CONFIGURATA' ? <Badge>non configurata</Badge> : <Badge tone="red" >{l.status}{l.error ? `: ${l.error}` : ''}</Badge>}</td><td className="small muted">{l.sent_by_name || 'sistema'}</td></tr>)}</tbody></table></div>)}
      </Card>
    </div>
  );
}
