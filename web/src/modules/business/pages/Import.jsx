import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useApi, Card, Loading, ErrorBox, Badge, StatusBadge, KindBadge, Kpi, useToast, Icon } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function Import() {
  const toast = useToast();
  const runs = useApi('/import/runs');
  const [file, setFile] = useState(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [resetWord, setResetWord] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const doReset = async () => {
    setResetBusy(true);
    try { const r = await api.post('/import/reset', { confirm: resetWord }); toast(`Azzerati ${r.deleted.contracts} contratti e ${r.deleted.partners} partner`); setResetWord(''); setResult(null); runs.reload(); }
    catch (e) { toast(e.message, 'err'); }
    finally { setResetBusy(false); }
  };

  // Upload con XMLHttpRequest per mostrare l'avanzamento del caricamento del pacchetto
  const run = () => {
    if (!file) return;
    setBusy(true); setError(null); setResult(null); setProgress(0);
    const fd = new FormData(); fd.append('package', file); fd.append('dry_run', dryRun ? '1' : '0');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/import`);
    xhr.setRequestHeader('X-Requested-With', 'td-suite');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setBusy(false);
      let data = null; try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        setResult(data); runs.reload();
        toast?.(data.ok ? (data.dryRun ? 'Verifica completata' : 'Importazione completata') : 'Pacchetto con errori', data.ok ? 'ok' : 'err');
      } else setError({ message: data?.error || `Errore ${xhr.status}` });
    };
    xhr.onerror = () => { setBusy(false); setError({ message: 'Caricamento interrotto: riprova' }); };
    xhr.send(fd);
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Importazione</h1><div className="sub">Caricamento dello status quo da pacchetti ZIP (manifest.json più documenti) preparati fuori dall’app: partner, contratti con stato e protocollo, documenti firmati, listini, credenziali dei portali e fascicoli di autorizzazione. L’importazione è idempotente: i contratti già presenti vengono saltati, i pacchetti si possono caricare in più passaggi.</div></div></div>
      <Card title="Pacchetto">
        <div className="row wrap" style={{ gap: 12, alignItems: 'end' }}>
          <label className="btn ghost" htmlFor="pkg"><Icon name="upload" />{file ? `${file.name} (${fmtMb(file.size)})` : 'Scegli il pacchetto ZIP'}
            <input id="pkg" type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); e.target.value = ''; }} />
          </label>
          <label className="f inline"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Solo verifica (non scrive nulla)</label>
          <button className="btn" disabled={!file || busy} onClick={run}>{busy ? (progress < 100 ? `Caricamento ${progress}%` : 'Elaborazione in corso…') : (dryRun ? 'Verifica il pacchetto' : 'Importa')}</button>
        </div>
        {busy && <div className="kpi" style={{ padding: 0, marginTop: 12 }}><div className="bar"><i style={{ width: `${progress}%` }} /></div></div>}
        <div className="small muted" style={{ marginTop: 10 }}>Consiglio: prima la verifica, poi l’importazione. Un pacchetto pesante (oltre 100 MB) va caricato con una connessione stabile; se la connessione cade, ricaricalo: nulla viene duplicato.</div>
      </Card>
      <ErrorBox error={error} />
      {result && <Card title={result.dryRun ? 'Esito della verifica' : 'Esito dell’importazione'}>
        {result.errors?.length > 0 && <div className="alert err"><div className="strong">Il pacchetto non è stato importato: correggi questi punti.</div><ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        <div className="grid g4" style={{ marginBottom: 12 }}>
          <Kpi label="Partner nuovi" value={result.counts.partners} foot={`${result.counts.partners_existing} già presenti`} />
          <Kpi label={result.dryRun ? 'Contratti da creare' : 'Contratti creati'} value={result.counts.contracts} foot={`${result.counts.contracts_skipped} già presenti${result.counts.contracts_appended ? `, ${result.counts.contracts_appended} integrati` : ''}`} />
          <Kpi label="Documenti" value={result.counts.files} foot={`${result.counts.dossier_files} nei fascicoli`} />
          <Kpi label="Credenziali portali" value={result.counts.credentials} />
        </div>
        {result.items?.length > 0 && <div className="table-wrap"><table className="t">
          <thead><tr><th>Chiave</th><th>Sezione</th><th>Contratto</th><th>Stato</th><th>Protocollo</th><th>File</th><th>Azione</th></tr></thead>
          <tbody>{result.items.map((it) => <tr key={it.key}>
            <td className="mono small">{it.key}</td><td><KindBadge kind={it.kind} /></td>
            <td>{it.id ? <Link to={`${BASE}/contratti/${it.id}`}>{it.title}</Link> : it.title}</td>
            <td><StatusBadge status={it.status} /></td><td className="mono">{it.protocol || <span className="muted">–</span>}</td><td>{it.files ?? ''}</td>
            <td><Badge tone={it.action === 'creato' ? 'green' : it.action === 'da creare' ? 'blue' : 'grey'}>{it.action}</Badge></td>
          </tr>)}</tbody></table></div>}
      </Card>}
      <Card title="Esecuzioni precedenti" flush>{!runs.data ? <Loading /> : runs.data.length ? (
        <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Utente</th><th>Pacchetto</th><th>Modalità</th><th>Esito</th></tr></thead>
          <tbody>{runs.data.map((r) => <tr key={r.id}><td className="small">{itDateTime(r.at)}</td><td>{r.user_name || '–'}</td><td>{r.filename}</td><td>{r.dry_run ? <Badge>verifica</Badge> : <Badge tone="green">importazione</Badge>}</td>
            <td className="small">{r.summary?.ok ? `${r.summary.counts?.contracts ?? 0} contratti, ${r.summary.counts?.files ?? 0} documenti, ${r.summary.counts?.contracts_skipped ?? 0} saltati${r.summary.counts?.contracts_appended ? `, ${r.summary.counts.contracts_appended} integrati` : ''}` : `${r.summary?.errors?.length ?? 0} errori`}</td></tr>)}</tbody></table></div>
      ) : <div className="empty">Nessuna importazione eseguita</div>}</Card>
      <Card title="Azzeramento prima dello status quo">
        <p className="small muted">Elimina tutti i contratti, i partner, i fascicoli, le credenziali e azzera i contatori di protocollo. Utenti, impostazioni e registro attività restano. Operazione irreversibile: serve solo per ripartire a pulito prima dell'importazione dello status quo. Per confermare scrivi AZZERA.</p>
        <div className="row">
          <input value={resetWord} onChange={(e) => setResetWord(e.target.value)} placeholder="AZZERA" style={{ maxWidth: 160 }} />
          <button className="btn danger" disabled={resetWord !== 'AZZERA' || resetBusy} onClick={doReset}>{resetBusy ? 'Azzeramento…' : 'Azzera i dati contrattuali'}</button>
        </div>
      </Card>
    </div>
  );
}
