// Impostazioni del Portale SGI (EDITOR, Owner e Admin della Suite). Nessun contenuto si modifica qui (copia conforme, sola lettura):
// si gestiscono l'origine dello specchio, le credenziali HTTP Basic dell'origine (se sul sito è impostata SGI_PASSWORD), l'aggiornamento
// ("Prova l'origine", "Aggiorna adesso"), lo ZIP del repository (ripiego) e la cache dei PDF. La password non torna mai al browser.
import React, { useEffect, useState } from 'react';
import { Card, Field, PageHead, Loading, Badge, DropZone, ConfirmModal, useApi, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api } from '../../../api.js';
import { fmtBytes, fmtDateTime } from '../../../format.js';
import { svuotaDati, svuotaStato } from '../dati.js';

function Riga({ k, children }) { return <div className="kv"><span className="muted">{k}</span><span>{children ?? '–'}</span></div>; }

export default function Impostazioni() {
  const imp = useApi('/sgi/impostazioni');
  const toast = useToast();
  const [origine, setOrigine] = useState('');
  const [utente, setUtente] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null);      // { titolo, ok, message }
  const [svuota, setSvuota] = useState(false);
  const d = imp.data;
  useEffect(() => { if (d) { setOrigine(d.origine_fonte === 'predefinita' ? '' : d.origine); setUtente(d.credenziali.fonte === 'env' ? d.credenziali.utente : (d.credenziali.utente || '')); setPassword(''); } }, [d]);
  const dopo = () => { svuotaDati(); svuotaStato(); imp.reload(); window.dispatchEvent(new Event('suite:badges')); };
  const run = async (titolo, fn) => {
    setBusy(true); setEsito(null);
    try { const r = await fn(); setEsito({ titolo, ...r }); } catch (e) { setEsito({ titolo, ok: false, message: e.message }); }
    setBusy(false); dopo();
  };
  if (!d) return <div className="page">{imp.error ? <div className="alert warn"><Icon name="alert" /><div>{imp.error.message}</div></div> : <Loading />}</div>;
  const s = d.specchio; const n = d.conteggi; const m = n.meta || {}; const c = d.credenziali;
  const uguale = (a, b) => a != null && b != null && Number(a) === Number(b);
  const confronto = (v, rif) => (v != null ? <>{v} {uguale(v, rif) ? <Badge tone="green" dot={false}>= meta.json</Badge> : <Badge tone="amber" dot={false}>meta.json: {rif ?? '–'}</Badge>}</> : null);
  const caricaZip = (files) => {
    const f = files[0]; if (!f) return;
    if (!/\.zip$/i.test(f.name)) return toast('Serve lo ZIP del repository (.zip)', 'err');
    if (f.size > d.zip_max_mb * 1024 * 1024) return toast(`ZIP troppo grande (massimo ${d.zip_max_mb} MB)`, 'err');
    const fd = new FormData(); fd.append('file', f, f.name);
    run(`ZIP ${f.name}`, async () => { const r = await api.upload('/sgi/zip', fd); return { ok: true, message: `Specchio sostituito dallo ZIP: pubblicazione del ${r.build}; ${r.file} file in cache (${fmtBytes(r.bytes)}).` }; });
  };
  // Prova con quanto scritto nei campi (anche se non salvato): origine e, se indicate, utente e password
  const prova = () => {
    const b = {};
    if (d.origine_fonte !== 'env' && origine.trim()) b.origine = origine.trim();
    if (!c.da_env) { if (password) b.password = password; if (utente.trim() !== (c.utente || '')) b.utente = utente.trim(); }
    return run('Prova l\'origine', () => api.post('/sgi/impostazioni/prova', b));
  };
  const salvaCredenziali = (rimuovi) => run(rimuovi ? 'Credenziali rimosse' : 'Credenziali salvate', async () => {
    const body = rimuovi ? { utente: null, password: null } : { utente: utente.trim() || null, ...(password ? { password } : {}) };
    const r = await api.put('/sgi/impostazioni/credenziali', body);
    setPassword('');
    return { ok: true, message: r.credenziali.password_impostata ? `La Suite si autentica sull'origine come "${r.credenziali.utente}". Premi "Aggiorna adesso" per rileggere il sito.` : 'Nessuna credenziale: la Suite legge l\'origine come sito pubblico.' };
  });
  return (
    <div className="page">
      <PageHead title="Impostazioni" icon="gear" sub="SGI Management nella Suite è la copia conforme del sito pubblico sgi.toscanadiagnostica.it: i documenti si emettono con la routine RSGI (build\aggiorna_portale.bat) e la Suite li specchia. Qui si gestiscono solo origine, credenziali dell'origine, aggiornamento e cache." />
      {esito && <div className={`alert ${esito.ok ? 'ok' : 'warn'}`}><Icon name={esito.ok ? 'check' : 'alert'} /><div><div className="strong">{esito.titolo}</div><div className="small">{esito.message}</div></div></div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Origine dello specchio" icon="external" actions={<button className="btn sm" disabled={busy || d.origine_fonte === 'env'} onClick={() => run('Origine salvata', async () => { const r = await api.put('/sgi/impostazioni', { origine: origine.trim() || null }); return { ok: true, message: `Origine in uso: ${r.origine}` }; })}>Salva</button>}>
          <Field label="Indirizzo del sito" help={d.origine_fonte === 'env' ? 'Impostato dalla variabile d\'ambiente SGI_PORTAL_URL: si cambia su Render.' : `Vuoto = ${d.origine_predefinita}. Serve un sito con /api/meta e /data/*.json (es. l'indirizzo onrender.com del servizio).`}>
            <input type="url" value={d.origine_fonte === 'env' ? d.origine : origine} disabled={d.origine_fonte === 'env'} placeholder={d.origine_predefinita} onChange={(e) => setOrigine(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn ghost" disabled={busy} onClick={prova}><Icon name="search" />Prova l'origine</button>
            <button className="btn" disabled={busy} onClick={() => run('Aggiorna adesso', async () => { const r = await api.post('/sgi/aggiorna'); return { ok: true, message: r.cambiato ? `Specchio aggiornato (${r.motivi.join(', ')}): pubblicazione del ${r.build}${r.cache_svuotata ? `; cache svuotata (${r.cache_svuotata} file)` : ''}.` : `Nessun cambiamento: la pubblicazione del ${r.build} è già nella Suite.` }; })}><Icon name="refresh" />Aggiorna adesso</button>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Aggiornamento automatico ogni {d.intervallo_ore} ore.</div>
        </Card>
        <Card title="Credenziali dell'origine" icon="key" actions={c.password_impostata ? <Badge tone="green">{c.fonte === 'env' ? 'da Render' : 'impostate'}</Badge> : <Badge tone="grey">sito pubblico</Badge>}>
          <p className="small muted" style={{ marginTop: 0 }}>Servono solo se sul sito è impostata la password (variabile <span className="mono">SGI_PASSWORD</span> su Render): cruscotto, <span className="mono">/data</span> e <span className="mono">/docs</span> chiedono utente e password (HTTP Basic). Le preparazioni restano sempre aperte. La password è cifrata nel database come le altre credenziali della Suite e non viene mai mostrata.</p>
          {c.da_env ? <div className="alert info"><Icon name="lock" /><div>Impostate dalle variabili d'ambiente <span className="mono">SGI_PORTAL_USER</span> e <span className="mono">SGI_PORTAL_PASSWORD</span> (utente "{c.utente}"): si cambiano su Render.</div></div> : <>
            <div className="cred">
              <Field label="Utente" help={`Vuoto = "${c.utente_predefinito}", come il sito`}><input type="text" value={utente} autoComplete="off" placeholder={c.utente_predefinito} onChange={(e) => setUtente(e.target.value)} /></Field>
              <Field label="Password" help={c.password_impostata ? 'Impostata. Lascia vuoto per non cambiarla.' : 'Nessuna password salvata'}><input type="password" value={password} autoComplete="new-password" placeholder={c.password_impostata ? '••••••••' : ''} onChange={(e) => setPassword(e.target.value)} /></Field>
            </div>
            <div className="row">
              <button className="btn" disabled={busy || (!password && utente.trim() === (c.utente || ''))} onClick={() => salvaCredenziali(false)}><Icon name="key" />Salva credenziali</button>
              {c.password_impostata && <button className="btn ghost danger" disabled={busy} onClick={() => salvaCredenziali(true)}><Icon name="trash" />Rimuovi</button>}
            </div>
          </>}
        </Card>
      </div>
      <div className="grid g2 mt" style={{ alignItems: 'start' }}>
        <Card title="Stato dello specchio" icon="stats" actions={s.ultimo_errore ? <Badge tone="red">errore</Badge> : s.build ? <Badge tone="green">allineato</Badge> : <Badge tone="amber">da caricare</Badge>}>
          <Riga k="Pubblicazione (build)">{s.build}</Riga>
          <Riga k="Indice REG006">{s.reg006_rev ? `rev. ${s.reg006_rev} del ${s.reg006_data}` : null}</Riga>
          <Riga k="Fonte">{s.fonte ? `${s.fonte === 'ZIP' ? 'ZIP del repository' : 'sito di origine'} · ${s.origine_usata || ''}` : null}</Riga>
          <Riga k="Ultima lettura riuscita">{fmtDateTime(s.ultima_lettura) || null}</Riga>
          <Riga k="Ultimo cambiamento">{s.ultimo_cambio ? `${fmtDateTime(s.ultimo_cambio)} · ${(s.ultimi_motivi || []).join(', ')}` : null}</Riga>
          <Riga k="Documenti attivi">{confronto(n.n_docs, m.n_docs)}</Riga>
          <Riga k="Versioni stampabili">{confronto(n.n_stampabili, m.n_stampabili)}</Riga>
          <Riga k="Prestazioni">{confronto(n.n_prestazioni, m.n_prestazioni)}</Riga>
          {s.ultimo_errore && <div className="alert warn" style={{ marginTop: 10 }}><Icon name="alert" /><div><div className="strong">Ultimo errore · {fmtDateTime(s.ultimo_errore_at)}</div><div className="small">{s.ultimo_errore}</div></div></div>}
        </Card>
        <Card title="Cache dei PDF" icon="folder" actions={<button className="btn sm ghost danger" disabled={busy || !d.cache.n} onClick={() => setSvuota(true)}><Icon name="trash" />Svuota cache</button>}>
          <Riga k="File in cache">{d.cache.n}{d.cache.da_zip ? ` (${d.cache.da_zip} dallo ZIP)` : ''}</Riga>
          <Riga k="Spazio occupato">{fmtBytes(d.cache.bytes)}</Riga>
          <p className="small muted">I PDF si scaricano dal sito alla prima apertura e restano in cache (Azure Blob se configurato, altrimenti database) fino al prossimo cambiamento della pubblicazione, che svuota la cache da sola.</p>
        </Card>
      </div>
      <div className="grid g2 mt" style={{ alignItems: 'start' }}>
        <Card title="ZIP del repository (ripiego)" icon="zip">
          <p className="small muted" style={{ marginTop: 0 }}>Se il sito non risponde dalla rete della Suite, o per il primo caricamento: su GitHub, repository <span className="mono">td-sgi-portale</span> → Code → Download ZIP, poi trascinalo qui. La Suite legge i JSON da <span className="mono">data/</span> e i PDF da <span className="mono">docs/</span> e <span className="mono">stampabili/</span> (stessa pipeline dello specchio) e sostituisce lo specchio. Massimo {d.zip_max_mb} MB.</p>
          <DropZone onFiles={caricaZip} accept=".zip" multiple={false} compact><Icon name="upload" /><div className="small">Trascina qui lo ZIP del repository oppure clicca per sceglierlo</div></DropZone>
        </Card>
        <Card title="Contenuti dello specchio" icon="list" flush>
          <div className="table-wrap"><table className="t"><thead><tr><th>JSON</th><th className="num">Dimensione</th><th>Letto il</th><th>sha256</th></tr></thead>
            <tbody>{(s.contenuti || []).map((x) => <tr key={x.chiave}><td className="mono">{x.chiave}.json</td><td className="num">{fmtBytes(x.bytes)}</td><td className="small">{fmtDateTime(x.fetched_at)}</td><td className="mono small muted">{x.sha256.slice(0, 16)}…</td></tr>)}</tbody></table></div>
        </Card>
      </div>
      {svuota && <ConfirmModal title="Svuota la cache dei PDF" text="I PDF verranno scaricati di nuovo dal sito alla prossima apertura. I contenuti del portale restano." confirmText="Svuota" danger onClose={() => setSvuota(false)}
        onConfirm={() => { setSvuota(false); run('Cache svuotata', async () => { const r = await api.post('/sgi/cache/svuota'); return { ok: true, message: `${r.rimossi} file rimossi dalla cache.` }; }); }} />}
    </div>
  );
}
