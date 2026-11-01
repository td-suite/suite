// Impostazioni del Portale Service (EDITOR, Owner e Admin della Suite). Nessun contenuto si modifica qui (copia conforme, sola
// lettura): si gestiscono l'origine dello specchio, l'aggiornamento ("Prova l'origine", "Aggiorna adesso"), il caricamento dello ZIP
// del repository (ripiego se il sito non risponde dalla rete di Render o per il primo caricamento) e la cache dei PDF.
import React, { useEffect, useState } from 'react';
import { Card, Field, PageHead, Loading, Badge, DropZone, ConfirmModal, useApi, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api } from '../../../api.js';
import { fmtBytes, fmtDateTime } from '../../../format.js';
import { svuotaDati, svuotaStato } from '../dati.js';

function Riga({ k, children }) { return <div className="sv-kv"><span className="muted">{k}</span><span>{children ?? '–'}</span></div>; }

export default function Impostazioni() {
  const imp = useApi('/service/impostazioni');
  const toast = useToast();
  const [origine, setOrigine] = useState('');
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null);      // { titolo, ok, message }
  const [svuota, setSvuota] = useState(false);
  const d = imp.data;
  useEffect(() => { if (d) setOrigine(d.origine_fonte === 'predefinita' ? '' : d.origine); }, [d]);
  const dopo = () => { svuotaDati(); svuotaStato(); imp.reload(); window.dispatchEvent(new Event('suite:badges')); };
  const run = async (titolo, fn) => {
    setBusy(true); setEsito(null);
    try { const r = await fn(); setEsito({ titolo, ...r }); } catch (e) { setEsito({ titolo, ok: false, message: e.message }); }
    setBusy(false); dopo();
  };
  if (!d) return <div className="page">{imp.error ? <div className="sv-alert warn"><Icon name="alert" className="ico" /><div>{imp.error.message}</div></div> : <Loading />}</div>;
  const s = d.specchio; const n = d.conteggi; const m = n.meta || {};
  const uguale = (a, b) => a != null && b != null && Number(a) === Number(b);
  const caricaZip = (files) => {
    const f = files[0]; if (!f) return;
    if (!/\.zip$/i.test(f.name)) return toast('Serve lo ZIP del repository (.zip)', 'err');
    if (f.size > d.zip_max_mb * 1024 * 1024) return toast(`ZIP troppo grande (massimo ${d.zip_max_mb} MB)`, 'err');
    const fd = new FormData(); fd.append('file', f, f.name);
    run(`ZIP ${f.name}`, async () => { const r = await api.upload('/service/zip', fd); return { ok: true, message: `Specchio sostituito dallo ZIP: pubblicazione del ${r.build}; ${r.file} file in cache (${fmtBytes(r.bytes)})${r.vademecum_pdf ? `; Vademecum: ${r.vademecum_pdf}` : ''}.` }; });
  };
  return (
    <div className="page sv-page">
      <PageHead title="Impostazioni" icon="gear" sub="Il Portale Service della Suite è la copia conforme del sito pubblico: i contenuti si aggiornano sul sito (routine RSGI, build\aggiorna_service.bat) e la Suite li specchia. Qui si gestiscono solo origine, aggiornamento e cache." />
      {esito && <div className={`sv-alert ${esito.ok ? 'ok' : 'warn'}`}><Icon name={esito.ok ? 'check' : 'alert'} className="ico" /><div><div className="strong">{esito.titolo}</div><div className="small">{esito.message}</div></div></div>}
      <div className="grid g2 sv-top">
        <Card title="Origine dello specchio" icon="external" actions={<button className="btn sm" disabled={busy || d.origine_fonte === 'env'} onClick={() => run('Origine salvata', async () => { const r = await api.put('/service/impostazioni', { origine: origine.trim() || null }); return { ok: true, message: `Origine in uso: ${r.origine}` }; })}>Salva</button>}>
          <Field label="Indirizzo del sito" help={d.origine_fonte === 'env' ? 'Impostato dalla variabile d\'ambiente SERVICE_PORTAL_URL: si cambia su Render.' : `Vuoto = ${d.origine_predefinita}. Serve un sito con /api/meta e /data/*.json (es. l'indirizzo onrender.com del servizio).`}>
            <input type="url" value={d.origine_fonte === 'env' ? d.origine : origine} disabled={d.origine_fonte === 'env'} placeholder={d.origine_predefinita} onChange={(e) => setOrigine(e.target.value)} />
          </Field>
          <div className="sv-actions start">
            <button className="btn ghost" disabled={busy} onClick={() => run('Prova l\'origine', () => api.post('/service/impostazioni/prova', d.origine_fonte === 'env' || !origine.trim() ? {} : { origine: origine.trim() }))}><Icon name="search" />Prova l'origine</button>
            <button className="btn" disabled={busy} onClick={() => run('Aggiorna adesso', async () => { const r = await api.post('/service/aggiorna'); return { ok: true, message: r.cambiato ? `Specchio aggiornato (${r.motivi.join(', ')}): pubblicazione del ${r.build}${r.cache_svuotata ? `; cache svuotata (${r.cache_svuotata} file)` : ''}.` : `Nessun cambiamento: la pubblicazione del ${r.build} è già nella Suite.` }; })}><Icon name="refresh" />Aggiorna adesso</button>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Aggiornamento automatico ogni {d.intervallo_ore} ore. Vademecum online incorporato: {d.vademecum_url} (variabile SERVICE_VADEMECUM_URL).</div>
        </Card>
        <Card title="Stato dello specchio" icon="stats" actions={s.ultimo_errore ? <Badge tone="red">errore</Badge> : s.build ? <Badge tone="green">allineato</Badge> : <Badge tone="amber">da caricare</Badge>}>
          <Riga k="Pubblicazione (build)">{s.build}</Riga>
          <Riga k="Indice REG006">{s.reg006_rev ? `rev. ${s.reg006_rev} del ${s.reg006_data}` : null}</Riga>
          <Riga k="Fonte">{s.fonte ? `${s.fonte === 'ZIP' ? 'ZIP del repository' : 'sito di origine'} · ${s.origine_usata || ''}` : null}</Riga>
          <Riga k="Ultima lettura riuscita">{fmtDateTime(s.ultima_lettura) || null}</Riga>
          <Riga k="Ultimo cambiamento">{s.ultimo_cambio ? `${fmtDateTime(s.ultimo_cambio)} · ${(s.ultimi_motivi || []).join(', ')}` : null}</Riga>
          <Riga k="Documenti PDF">{n.n_pdf != null ? <>{n.n_pdf} {uguale(n.n_pdf, m.n_pdf) ? <Badge tone="green" dot={false}>= meta.json</Badge> : <Badge tone="amber" dot={false}>meta.json: {m.n_pdf ?? '–'}</Badge>}</> : null}</Riga>
          <Riga k="Prestazioni">{n.n_prestazioni != null ? <>{n.n_prestazioni} {uguale(n.n_prestazioni, m.n_prestazioni) ? <Badge tone="green" dot={false}>= meta.json</Badge> : <Badge tone="amber" dot={false}>meta.json: {m.n_prestazioni ?? '–'}</Badge>}</> : null}</Riga>
          {s.ultimo_errore && <div className="sv-alert warn" style={{ marginTop: 10 }}><Icon name="alert" className="ico" /><div><div className="strong">Ultimo errore · {fmtDateTime(s.ultimo_errore_at)}</div><div className="small">{s.ultimo_errore}</div></div></div>}
        </Card>
      </div>
      <div className="grid g2 mt sv-top">
        <Card title="ZIP del repository (ripiego)" icon="zip">
          <p className="small muted" style={{ marginTop: 0 }}>Se il sito non risponde dalla rete della Suite, o per il primo caricamento: su GitHub, repository <span className="mono">td-service-portale</span> → Code → Download ZIP, poi trascinalo qui. La Suite legge i JSON da <span className="mono">data/</span> e i PDF da <span className="mono">docs/</span>, <span className="mono">stampabili/</span>, <span className="mono">certificati/</span>, <span className="mono">vademecum/</span> (stessa pipeline dello specchio) e sostituisce lo specchio. Massimo {d.zip_max_mb} MB.</p>
          <DropZone onFiles={caricaZip} accept=".zip" multiple={false} compact><Icon name="upload" /><div className="small">Trascina qui lo ZIP del repository oppure clicca per sceglierlo</div></DropZone>
        </Card>
        <Card title="Cache dei PDF" icon="folder" actions={<button className="btn sm ghost danger" disabled={busy || !d.cache.n} onClick={() => setSvuota(true)}><Icon name="trash" />Svuota cache</button>}>
          <Riga k="File in cache">{d.cache.n}{d.cache.da_zip ? ` (${d.cache.da_zip} dallo ZIP)` : ''}</Riga>
          <Riga k="Spazio occupato">{fmtBytes(d.cache.bytes)}</Riga>
          <p className="small muted">I PDF si scaricano dal sito alla prima apertura e restano in cache (Azure Blob se configurato, altrimenti database) fino al prossimo cambiamento della pubblicazione, che svuota la cache da sola.</p>
        </Card>
      </div>
      <Card className="mt" title="Contenuti dello specchio" icon="list" flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>JSON</th><th className="num">Dimensione</th><th>Letto il</th><th>sha256</th></tr></thead>
          <tbody>{(s.contenuti || []).map((c) => <tr key={c.chiave}><td className="mono">{c.chiave}.json</td><td className="num">{fmtBytes(c.bytes)}</td><td className="small">{fmtDateTime(c.fetched_at)}</td><td className="mono small muted">{c.sha256.slice(0, 16)}…</td></tr>)}</tbody></table></div>
      </Card>
      {svuota && <ConfirmModal title="Svuota la cache dei PDF" text="I PDF verranno scaricati di nuovo dal sito alla prossima apertura. I contenuti del portale restano." confirmText="Svuota" danger onClose={() => setSvuota(false)}
        onConfirm={() => { setSvuota(false); run('Cache svuotata', async () => { const r = await api.post('/service/cache/svuota'); return { ok: true, message: `${r.rimossi} file rimossi dalla cache.` }; }); }} />}
    </div>
  );
}
