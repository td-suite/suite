import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, isOwner, isAdmin } from '../../auth.jsx';
import { useApi, Badge, Skeleton, Empty, ErrorBox, PageHead, useToast, Modal, ConfirmModal } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, timeAgo, AREA_COLORS } from '../../format.js';

const MODE = { OFF: ['Non travasato', 'grey'], MIRROR: ['In collaudo (copia)', 'amber'], LIVE: ['Attivo nella Suite', 'green'] };

function CompareModal({ m, onClose }) {
  const { data, loading, error } = useApi(`/travaso/${m.key}/compare`);
  const diff = (data || []).filter((r) => !r.ok).length;
  return (
    <Modal title={`Confronto conteggi · ${m.name}`} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Chiudi</button>}>
      {loading && <Skeleton lines={6} />}
      <ErrorBox error={error} />
      {data && <>
        <div className={`alert ${diff ? 'warn' : 'ok'} small`}><Icon name={diff ? 'alert' : 'check'} /><span>{diff ? `${diff} tabelle con conteggi diversi: esegui un nuovo travaso prima del passaggio definitivo.` : 'Tutte le tabelle coincidono tra app originale e Suite.'}</span></div>
        <table className="tbl"><thead><tr><th>Tabella</th><th className="num">App originale</th><th className="num">Suite</th><th></th></tr></thead>
          <tbody>{data.map((r) => <tr key={r.table}><td className="mono">{r.table}</td><td className="num">{r.origine.toLocaleString('it-IT')}</td><td className="num">{r.suite.toLocaleString('it-IT')}</td><td>{r.ok ? <Badge tone="green" dot={false}>ok</Badge> : <Badge tone="red" dot={false}>diverso</Badge>}</td></tr>)}</tbody></table>
      </>}
    </Modal>
  );
}

// ---------------------------------------------------------------- contenuti dall'app originale (moduli partiti vuoti)
const ENTITY = { sites: ['Sedi', 'sede', 'nome, codice, comune'], people: ['Persone', 'persona', 'cognome, nome, email'], organizations: ['Legal entity', 'legal entity', 'ragione sociale, P.IVA'] };
const TABLE_IT = { strutture: 'sedi (impostazioni Room)', struttura_blobs: 'planimetrie e loghi', struttura_history: 'cronologia delle sedi', eventi: 'eventi del calendario', email_log: 'registro email', professionisti: 'professionisti (schede Room)', professionista_docs: 'documenti dei professionisti', disponibilita: 'disponibilità', turni: 'turni', turni_mesi: 'mesi di turni', presenze: 'presenze', rendiconti: 'rendiconti', posizioni: 'bacheca: posizioni', candidature: 'bacheca: candidature', site_ext: 'sedi (impostazioni Room)', person_ext: 'persone (schede Room)', abbinamenti: 'abbinamenti all\'anagrafica' };
const tableIt = (t) => TABLE_IT[t] || t.replace(/_/g, ' ');

// Abbinamento di una entità dell'app originale: proposta, candidati e tutte le anagrafiche della Suite (filtrate dalla ricerca della sezione)
function MatchSelect({ row, value, onChange, catalog, filter }) {
  const ql = filter.trim().toLowerCase();
  const candIds = new Set(row.candidates.map((c) => c.id));
  const all = catalog.filter((c) => !candIds.has(c.id) && (c.id === value || !ql || c.label.toLowerCase().includes(ql)));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={`Abbinamento di ${row.label}`}>
      <option value="">Non abbinare</option>
      {row.candidates.length > 0 && <optgroup label="Proposti">{row.candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>}
      <optgroup label={`Tutte le anagrafiche${ql ? ' (filtrate)' : ''}`}>{all.slice(0, 400).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
    </select>
  );
}

function MatchSection({ kind, rows, catalog, mapping, setMapping }) {
  const [filter, setFilter] = useState('');
  const [title, single, hint] = ENTITY[kind];
  if (!rows.length) return <div className="mb2"><h3 style={{ margin: '0 0 6px' }}>{title}</h3><div className="small muted">Nessuna {single} nell'app originale.</div></div>;
  const matched = rows.filter((r) => mapping[r.legacy_id]).length;
  return (
    <div className="mb2">
      <div className="row between mb">
        <div><h3 style={{ margin: 0 }}>{title}</h3><div className="small muted">{matched} su {rows.length} abbinate · le non abbinate si saltano insieme ai loro contenuti</div></div>
        <div className="search-input" style={{ minWidth: 240 }}><Icon name="search" /><input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Cerca nelle anagrafiche (${hint})`} aria-label={`Cerca ${single}`} /></div>
      </div>
      <table className="t"><thead><tr><th>App originale</th><th>Proposta</th><th style={{ width: '45%' }}>Anagrafica della Suite</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.legacy_id}>
            <td><div>{r.label}</div>{r.detail && <div className="small muted">{r.detail}</div>}</td>
            <td className="small">{r.proposal ? <Badge tone={r.proposal.score >= 85 ? 'green' : 'amber'} dot={false} title={r.proposal.label}>{r.proposal.how}</Badge> : <Badge tone="grey" dot={false}>da abbinare a mano</Badge>}</td>
            <td><MatchSelect row={r} value={mapping[r.legacy_id] || null} onChange={(v) => setMapping(kind, r.legacy_id, v)} catalog={catalog} filter={filter} /></td>
          </tr>
        ))}</tbody></table>
    </div>
  );
}

function ImportReport({ r }) {
  const tables = Object.entries(r.stats || {});
  const copied = tables.reduce((a, [, s]) => a + (s.copied || 0), 0);
  const existing = tables.reduce((a, [, s]) => a + (s.existing || 0), 0);
  return (
    <div className="mt2">
      <div className={`alert ${r.dryRun ? 'info' : 'ok'} small`}><Icon name={r.dryRun ? 'info' : 'check'} /><span>{r.dryRun ? 'Prova senza scrivere: ' : 'Importazione completata: '}{copied.toLocaleString('it-IT')} righe {r.dryRun ? 'da importare' : 'importate'}{existing ? `, ${existing.toLocaleString('it-IT')} già presenti da una importazione precedente` : ''}, {(r.skipped || []).length.toLocaleString('it-IT')} saltate{r.ms ? ` (${(r.ms / 1000).toFixed(1)} s)` : ''}.</span></div>
      {(r.warnings || []).map((w, i) => <div key={i} className="alert warn small"><Icon name="alert" /><span>{w}</span></div>)}
      <table className="t mt"><thead><tr><th>Contenuto</th><th className="num">{r.dryRun ? 'Da importare' : 'Importate'}</th><th className="num">Già presenti</th><th className="num">Saltate</th></tr></thead>
        <tbody>{tables.map(([t, s]) => <tr key={t}><td>{tableIt(t)}{t === 'abbinamenti' && <span className="small muted"> · {s.sedi} sedi, {s.persone} persone</span>}</td><td className="num">{(s.copied || 0).toLocaleString('it-IT')}</td><td className="num">{(s.existing || 0).toLocaleString('it-IT')}</td><td className="num">{s.skipped ? <Badge tone="amber" dot={false}>{s.skipped.toLocaleString('it-IT')}</Badge> : '0'}</td></tr>)}</tbody></table>
      {(r.skipped || []).length > 0 && <>
        <h3 className="mt2" style={{ marginBottom: 6 }}>Righe saltate</h3>
        <table className="t"><thead><tr><th>Contenuto</th><th>Riga dell'app</th><th>Motivo</th></tr></thead>
          <tbody>{r.skipped.slice(0, 300).map((s, i) => <tr key={i}><td>{tableIt(s.table)}</td><td className="mono">{s.legacy_id}</td><td className="small">{s.reason}</td></tr>)}</tbody></table>
        {r.skipped.length > 300 && <div className="small muted mt">Mostrate le prime 300 di {r.skipped.length.toLocaleString('it-IT')} righe saltate.</div>}
      </>}
    </div>
  );
}

function LegacyImportModal({ m, onClose, onDone }) {
  const { data, loading, error } = useApi(`/travaso/${m.key}/legacy-match`);
  const toast = useToast();
  const [mapping, setMappingState] = useState(null);
  const [busy, setBusy] = useState(null);     // 'dry' | 'run'
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(false);
  // proposta automatica come valore iniziale
  const map = mapping || (data ? Object.fromEntries(Object.entries(data.entities).map(([k, rows]) => [k, Object.fromEntries(rows.filter((r) => r.proposal).map((r) => [r.legacy_id, r.proposal.id]))])) : null);
  const setMapping = (kind, lid, v) => { const next = { ...map, [kind]: { ...map[kind] } }; if (v) next[kind][lid] = v; else delete next[kind][lid]; setMappingState(next); setResult(null); };
  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'run'); setResult(null);
    try {
      const r = await api.post(`/travaso/${m.key}/legacy-import`, { mapping: map, dryRun });
      setResult(r);
      if (!dryRun) { toast(`${m.name}: ${(r.copied || 0).toLocaleString('it-IT')} righe importate dall'app originale`); onDone?.(); }
    } catch (e) { toast(e, 'err'); }
    setBusy(null);
  };
  const total = data ? Object.values(data.entities).reduce((a, rows) => a + rows.length, 0) : 0;
  const matched = map ? Object.values(map).reduce((a, x) => a + Object.keys(x).length, 0) : 0;
  // Doppioni: la stessa anagrafica scelta per due voci (le voci "Non abbinare", vuote, non contano)
  const duplicates = map ? Object.values(map).flatMap((x) => { const seen = new Set(); return Object.values(x).filter((id) => { if (!id) return false; const d = seen.has(id); seen.add(id); return d; }); }).length : 0;
  return (
    <Modal title={`Importa i contenuti dall'app originale · ${m.name}`} onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Chiudi</button>
        <button className="btn ghost" disabled={!map || busy || duplicates > 0} onClick={() => run(true)}><Icon name="search" />{busy === 'dry' ? 'Prova in corso' : 'Prova senza scrivere'}</button>
        <button className="btn" disabled={!map || busy || duplicates > 0} onClick={() => setConfirm(true)}><Icon name="import" />{busy === 'run' ? 'Importazione in corso' : 'Importa'}</button>
      </>}>
      {loading && <Skeleton lines={8} />}
      <ErrorBox error={error} />
      {data && map && <>
        <div className="alert info small"><Icon name="info" /><span>Le sedi e le persone dell'app originale vanno abbinate all'anagrafica unica della Suite: la proposta automatica usa codice, email, codice fiscale o partita IVA e nome. Nessuna anagrafica viene creata o modificata; ciò che non è abbinato si salta e compare nel rapporto. {matched} abbinamenti su {total}.</span></div>
        {duplicates > 0 && <div className="alert err small"><Icon name="alert" /><span>La stessa anagrafica della Suite è scelta per più voci dell'app originale: correggi gli abbinamenti prima di continuare.</span></div>}
        {(data.warnings || []).map((w, i) => <div key={i} className="alert warn small"><Icon name="alert" /><span>{w}</span></div>)}
        {['sites', 'people', 'organizations'].map((k) => <MatchSection key={k} kind={k} rows={data.entities[k] || []} catalog={data.catalog[k] || []} mapping={map[k]} setMapping={setMapping} />)}
        <h3 style={{ margin: '0 0 6px' }}>Contenuti dell'app originale</h3>
        <div className="row tight small">{(data.tables || []).map((t) => <span key={t.table} className="chip" title={t.table}>{tableIt(t.table)} <b>{t.rows.toLocaleString('it-IT')}</b></span>)}</div>
        {result && <ImportReport r={result} />}
      </>}
      {confirm && <ConfirmModal title={`Importare i contenuti in ${m.name}?`} text={`${matched} sedi e persone abbinate: impostazioni, planimetrie, turni, presenze, rendiconti e gli altri contenuti dell'app originale vengono copiati nella Suite con gli id dell'anagrafica unica. Ciò che è già presente nella Suite non viene sovrascritto; le righe non abbinate si saltano. Usa prima "Prova senza scrivere" per vedere il piano.`} confirmText="Importa" onConfirm={() => run(false)} onClose={() => setConfirm(false)} />}
    </Modal>
  );
}

export function Travaso() {
  const { data, loading, error, reload } = useApi('/travaso');
  const { user: me } = useAuth();
  const owner = isOwner(me);
  const admin = isAdmin(me);
  const toast = useToast();
  const [busy, setBusy] = useState({});
  const [compare, setCompare] = useState(null);
  const [legacyImport, setLegacyImport] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const run = async (m) => {
    setBusy((b) => ({ ...b, [m.key]: true }));
    try { const r = await api.post(`/travaso/${m.key}/run`); toast(r.fresh ? `${m.name}: avviato vuoto e LIVE sull'anagrafica unica` : `${m.name}: ${(r.rows || 0).toLocaleString('it-IT')} righe in ${r.tables || 0} tabelle (${((r.ms || 0) / 1000).toFixed(1)} s)`); reload(); }
    catch (e) { toast(e, 'err'); }
    setBusy((b) => ({ ...b, [m.key]: false }));
  };
  const live = async (m) => { try { await api.post(`/travaso/${m.key}/live`); toast(`${m.name} è ora attivo nella Suite`); reload(); } catch (e) { toast(e, 'err'); } };
  const mirror = async (m) => { try { await api.post(`/travaso/${m.key}/mirror`); toast(`${m.name} torna in collaudo`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title="Travaso moduli" icon="import" sub="Moduli sull'anagrafica unica (Cash, Room, NC, Ordini, Retail, Contratti, Business, Integration): si avviano vuoti con un clic. Moduli indipendenti (Payments, Spedizioni): dati copiati dall'app originale, poi il passaggio definitivo quando i conteggi coincidono" />
      {loading && <Skeleton lines={6} />}
      <ErrorBox error={error} />
      {data && !data.length && <Empty icon="import" title="Nessun modulo da travasare" />}
      <div className="sources">{(data || []).map((m) => {
        const [label, tone] = MODE[m.mode] || MODE.OFF;
        const stats = m.last_copy_stats || {};
        return (
          <div key={m.key} className={`source-card ${m.mode !== 'OFF' ? 'on' : ''}`} style={{ borderLeftColor: m.mode === 'OFF' ? undefined : (m.mode === 'LIVE' ? 'var(--green)' : 'var(--amber)') }}>
            <div className="sc-head">
              <span className={`dot ${tone}`} aria-hidden="true" />
              <div className="sc-title"><div className="n">{m.name}</div><div className="small muted">{m.fresh ? (m.mode === 'LIVE' ? 'avviato vuoto sull\'anagrafica unica' : 'parte vuoto: sedi, persone e organizzazioni dall\'anagrafica unica') : m.last_copy_at ? `ultimo travaso ${timeAgo(m.last_copy_at)} · ${(stats.rows || 0).toLocaleString('it-IT')} righe` : 'nessun travaso eseguito'}</div></div>
              <Badge tone={tone} dot={false}>{m.running ? 'In corso' : label}</Badge>
            </div>
            {m.last_error && <div className="alert err small"><Icon name="alert" /><span>{m.last_error}</span></div>}
            <div className="row tight small muted" style={{ gap: 14 }}>
              {(!m.fresh || m.legacy_import) && <span><Icon name={m.source_enabled ? 'check' : 'x'} style={{ width: 14, height: 14, verticalAlign: -2 }} /> {m.fresh ? 'app originale collegata' : 'database collegato'}</span>}
              <span><Icon name={m.code_ready ? 'check' : 'x'} style={{ width: 14, height: 14, verticalAlign: -2 }} /> codice nella Suite</span>
              {m.live_since && <span>attivo dal {fmtDateTime(m.live_since)}</span>}
            </div>
            <div className="sc-actions">
              {owner && m.fresh && m.mode !== 'LIVE' && <button className="btn sm" disabled={busy[m.key] || !m.code_ready} onClick={() => run(m)}><Icon name="check" />{busy[m.key] ? 'Avvio in corso' : 'Avvia il modulo'}</button>}
              {owner && !m.fresh && m.mode !== 'LIVE' && <button className={`btn sm ${m.mode === 'OFF' ? '' : 'ghost'}`} disabled={busy[m.key] || !m.source_enabled || !m.code_ready} onClick={() => run(m)}><Icon name="import" />{busy[m.key] ? 'Travaso in corso' : m.mode === 'OFF' ? 'Avvia travaso' : 'Ripeti travaso'}</button>}
              {!m.fresh && m.mode !== 'OFF' && <button className="btn sm ghost" onClick={() => setCompare(m)}><Icon name="check" />Confronta conteggi</button>}
              {m.mode !== 'OFF' && <Link className="btn sm ghost" to={`/${m.key}`}><Icon name="external" />Apri nella Suite</Link>}
              {admin && m.fresh && m.legacy_import && m.mode === 'LIVE' && (m.source_enabled
                ? <button className="btn sm ghost" onClick={() => setLegacyImport(m)}><Icon name="import" />Importa i contenuti dall'app originale</button>
                : <Link className="btn sm ghost" to="/admin/legacy" title="Collega prima il database dell'app originale in Sorgenti legacy"><Icon name="import" />Importa i contenuti dall'app originale</Link>)}
              {owner && m.mode === 'MIRROR' && <button className="btn sm" onClick={() => setConfirm({ title: `Attivare ${m.name} nella Suite?`, text: 'Da questo momento la Suite è la fonte dei dati del modulo: l\'app originale va messa in sola lettura o reindirizzata. La copia dall\'app originale si disattiva.', confirmText: 'Attiva nella Suite', go: () => live(m) })}><Icon name="check" />Passa a LIVE</button>}
              {owner && !m.fresh && m.mode === 'LIVE' && <button className="btn sm ghost danger" onClick={() => setConfirm({ title: `Riportare ${m.name} in collaudo?`, text: 'Le modifiche fatte nella Suite dopo il passaggio verranno sovrascritte al prossimo travaso.', danger: true, confirmText: 'Torna in collaudo', go: () => mirror(m) })}><Icon name="refresh" />Torna in collaudo</button>}
            </div>
          </div>
        );
      })}</div>
      {compare && <CompareModal m={compare} onClose={() => setCompare(null)} />}
      {legacyImport && <LegacyImportModal m={legacyImport} onClose={() => setLegacyImport(null)} onDone={reload} />}
      {confirm && <ConfirmModal {...confirm} onConfirm={async () => { await confirm.go(); setConfirm(null); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}
