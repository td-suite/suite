// Conti bancari collegati con Enable Banking (sola lettura: saldi e movimenti). Pagina condivisa da Finance Management e da Recupero
// Crediti. Collegare o staccare un conto: titolare, CEO e CFO. Il consenso della banca ha una scadenza e va rinnovato in banca da chi
// ha i poteri sul conto; finché i movimenti non sono aggiornati i solleciti automatici del Recupero Crediti restano fermi.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Card, Loading, Empty, PageHead, Badge, Modal, Field, ErrorBox, useToast, SearchInput, Seg, ConfirmModal } from './ui.jsx';

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ibanFmt = (s) => String(s || '').replace(/(.{4})/g, '$1 ').trim();
const STATO = { ATTIVA: ['green', 'Attivo'], IN_ATTESA: ['amber', 'In attesa dell\'autorizzazione in banca'], SCADUTA: ['red', 'Consenso scaduto'], REVOCATA: ['grey', 'Scollegato'], ERRORE: ['red', 'Non riuscito'] };

function Collega({ onClose }) {
  const b = useApi('/banca/banche?paese=IT'); const [q, setQ] = useState(''); const [tipo, setTipo] = useState('business'); const [err, setErr] = useState(null); const [busy, setBusy] = useState(null);
  const righe = (b.data || []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const vai = async (x) => { setBusy(x.name); setErr(null); try { const r = await api.post('/banca/collega', { banca: x.name, paese: x.country, psu_type: tipo, max_giorni: x.max_giorni }); window.location.assign(r.url); } catch (e) { setErr(e); setBusy(null); } };
  return (
    <Modal wide title="Collega un conto bancario" onClose={onClose}>
      <ErrorBox error={err || b.error} />
      <p className="small">Scegli la banca: verrai portato sul suo sito per l'autenticazione forte. Serve la persona con i poteri sul conto. La Suite riceve saldi e movimenti in sola lettura e non può disporre pagamenti. Il consenso dura al massimo quanto consente la banca, poi va rinnovato.</p>
      <div className="filters" style={{ marginBottom: 8 }}><SearchInput value={q} onChange={setQ} placeholder="Cerca la banca" autoFocus /><Seg value={tipo} onChange={setTipo} label="Tipo di accesso" items={[{ value: 'business', label: 'Accesso aziendale' }, { value: 'personal', label: 'Accesso personale' }]} /></div>
      {!b.data && !b.error ? <Loading text="Elenco delle banche" /> : <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="t"><tbody>{righe.map((x) => <tr key={x.name}><td className="strong">{x.name}{x.beta && <span className="small muted"> · in prova presso Enable Banking</span>}</td><td className="small">{x.psu_types.includes(tipo) ? `consenso fino a ${x.max_giorni || '?'} giorni` : <span className="muted">accesso {tipo === 'business' ? 'aziendale' : 'personale'} non previsto</span>}</td><td><button className="btn sm" disabled={busy != null || !x.psu_types.includes(tipo)} onClick={() => vai(x)}>{busy === x.name ? 'Apertura…' : 'Collega'}</button></td></tr>)}{b.data && !righe.length && <tr><td className="muted small">Nessuna banca trovata</td></tr>}</tbody></table></div>}
    </Modal>
  );
}

export default function BancaConti() {
  const d = useApi('/banca/stato'); const toast = useToast(); const [sp, setSp] = useSearchParams(); const [m, setM] = useState(null); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ iban: '', segno: '', q: '', da: '', a: '' });
  const qsMov = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const mov = useApi(d.data?.conti?.length ? `/banca/movimenti?${qsMov}` : null, [qsMov, d.data?.conti?.length]);
  useEffect(() => { const c = sp.get('collegamento'); if (!c) return; toast(c === 'ok' ? 'Conto collegato: la prima lettura dei movimenti è in corso' : `Collegamento non riuscito: ${c}`, c === 'ok' ? 'ok' : 'err'); setSp({}, { replace: true }); const t = setTimeout(() => d.reload(), 4000); return () => clearTimeout(t); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (d.error) return <div className="page"><Empty icon="alert" title="Conti bancari non disponibili">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data;
  const sincronizza = async () => { setBusy(true); try { const r = await api.post('/banca/sincronizza', {}); toast(r.skipped ? 'Collegamento bancario non configurato sul server' : `${r.conti} conti letti, ${r.nuovi} movimenti nuovi${r.errori ? `, ${r.errori} con errore` : ''}`, r.errori ? 'err' : 'ok'); await d.reload(); await mov.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <div className="page">
      <PageHead title="Conti bancari" icon="building" sub="Saldi e movimenti letti dalla banca con Enable Banking, in sola lettura. Servono alla riconciliazione degli incassi con le fatture e alla quadratura di Finance Management."
        actions={<>{x.conti.length > 0 && <button className="btn ghost" disabled={busy} onClick={sincronizza}>Leggi i movimenti ora</button>}{x.puo_gestire && <button className="btn" disabled={!x.configurata} onClick={() => setM({ t: 'collega' })}>Collega un conto</button>}</>} />
      {!x.configurata && <div className="alert warn" style={{ marginBottom: 16 }}><div><strong>Collegamento non ancora configurato sul server.</strong> Servono un'applicazione Enable Banking e due variabili d'ambiente inserite da chi amministra il server: ENABLEBANKING_APP_ID ed ENABLEBANKING_PRIVATE_KEY. Nell'applicazione Enable Banking va registrato questo indirizzo di ritorno: <code>{x.ritorno}</code></div></div>}
      {x.configurata && !x.aggiornata.ok && <div className="alert warn" style={{ marginBottom: 16 }}><span>Movimenti non aggiornati: {x.aggiornata.motivo}. Finché è così i solleciti automatici del Recupero Crediti restano in attesa di una persona.</span></div>}
      <Card title="Conti" icon="cash" flush style={{ marginBottom: 16 }}>
        {x.conti.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Conto</th><th>Banca</th><th className="num">Saldo</th><th>Ultima lettura</th><th>Movimenti</th><th></th></tr></thead>
          <tbody>{x.conti.map((c) => <tr key={c.id}><td className="strong">{c.name || 'Conto'}<div className="small muted mono">{ibanFmt(c.iban)}</div></td><td>{c.aspsp_name}<div><Badge tone={STATO[c.collegamento_stato]?.[0]}>{STATO[c.collegamento_stato]?.[1]}</Badge></div>{c.valid_until && c.collegamento_stato === 'ATTIVA' && <div className="small muted">consenso fino al {itData(c.valid_until)}</div>}</td>
            <td className="num strong">{c.saldo == null ? '' : eur(c.saldo)}<div className="small muted">{c.saldo_at ? itDataOra(c.saldo_at) : ''}</div></td><td className="small">{c.last_sync_ok_at ? itDataOra(c.last_sync_ok_at) : 'mai'}{c.last_error && <div style={{ color: '#A63A22' }}>{c.last_error}</div>}</td><td className="small">{c.movimenti}{c.ultimo_movimento ? ` · ultimo del ${itData(c.ultimo_movimento)}` : ''}</td>
            <td>{!c.attivo && <Badge tone="grey">Non letto</Badge>}</td></tr>)}</tbody></table></div> : <Empty compact icon="building">Nessun conto collegato</Empty>}
      </Card>
      {x.collegamenti.length > 0 && <Card title="Collegamenti" icon="key" flush style={{ marginBottom: 16 }}><table className="t"><tbody>{x.collegamenti.map((c) => <tr key={c.id}><td className="strong">{c.aspsp_name}<div className="small muted">avviato il {itDataOra(c.created_at)}{c.creato_da ? ` da ${c.creato_da}` : ''}</div></td><td><Badge tone={STATO[c.status]?.[0]}>{STATO[c.status]?.[1]}</Badge>{c.valid_until && ['ATTIVA', 'SCADUTA'].includes(c.status) && <div className="small muted">consenso {c.status === 'SCADUTA' ? 'scaduto il' : 'fino al'} {itData(c.valid_until)}</div>}{c.last_error && <div className="small" style={{ color: '#A63A22' }}>{c.last_error}</div>}</td>
        <td>{x.puo_gestire && <div className="row" style={{ gap: 8 }}>{c.status === 'SCADUTA' && <button className="btn sm" onClick={() => setM({ t: 'collega' })}>Rinnova in banca</button>}{['ATTIVA', 'SCADUTA', 'ERRORE'].includes(c.status) && <button className="btn sm ghost" onClick={() => setM({ t: 'scollega', c })}>Scollega</button>}</div>}</td></tr>)}</tbody></table></Card>}
      {x.conti.length > 0 && <Card title="Movimenti" icon="list" flush>
        <div className="filters" style={{ padding: 12 }}><SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder="Cerca per controparte o causale" /><Seg value={f.segno} onChange={(v) => setF({ ...f, segno: v })} label="Segno" items={[{ value: '', label: 'Tutti' }, { value: 'entrate', label: 'Entrate' }, { value: 'uscite', label: 'Uscite' }]} />
          <label className="f"><span>Dal</span><input type="date" value={f.da} onChange={(e) => setF({ ...f, da: e.target.value })} /></label><label className="f"><span>Al</span><input type="date" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} /></label>
          {x.conti.length > 1 && <label className="f"><span>Conto</span><select value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })}><option value="">Tutti</option>{x.conti.map((c) => <option key={c.id} value={c.iban}>{c.name || ibanFmt(c.iban)}</option>)}</select></label>}</div>
        {!mov.data ? <Loading /> : mov.data.righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Data</th><th>Controparte</th><th>Causale</th><th className="num">Importo</th></tr></thead><tbody>{mov.data.righe.map((t) => <tr key={t.id}><td className="nowrap">{itData(t.data)}{t.stato !== 'BOOK' && <div><Badge tone="amber">In attesa</Badge></div>}</td><td>{t.controparte || <span className="muted">non indicata</span>}</td><td className="small" style={{ wordBreak: 'break-word' }}>{t.causale}</td><td className="num strong" style={{ color: Number(t.importo) < 0 ? '#A63A22' : '#0B6B2E' }}>{eur(t.importo)}</td></tr>)}</tbody></table></div> : <Empty compact icon="list">Nessun movimento con questi filtri</Empty>}
        {mov.data?.righe.length === 500 && <p className="small muted" style={{ padding: 12 }}>Mostrati i 500 movimenti più recenti: restringi il periodo per vedere gli altri.</p>}
      </Card>}
      {m?.t === 'collega' && <Collega onClose={() => setM(null)} />}
      {m?.t === 'scollega' && <ConfirmModal title={`Scollega ${m.c.aspsp_name}`} danger confirmText="Scollega" text="La Suite smette di leggere saldi e movimenti di questo collegamento. I movimenti già letti restano. Per riprendere servirà una nuova autorizzazione in banca." onClose={() => setM(null)} onConfirm={async () => { await api.del(`/banca/collegamenti/${m.c.id}`); await d.reload(); }} />}
    </div>
  );
}
