// Sedi: una card per sede con l'auto-audit del mese (stato), l'ultimo interno, l'ultimo di terze parti, punteggio e livello della
// sintesi; pulsanti Nuovo audit interno / Carica audit di terze parti / Genera sintesi (Qualità, auditor, amministratore).
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge, Modal, Field, SearchInput, useToast, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor, isSite } from '../index.jsx';
import { Score, Level, StatusBadge } from '../components/Score.jsx';
import { SITE_KIND, ENTE, ESITO_TERZI, mese, itDate, itDateTime, pct, kb } from '../format.js';

export default function Sedi() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/sites');
  const [q, setQ] = useState('');
  const [terzi, setTerzi] = useState(null);     // sede per cui si carica un audit di terze parti
  const [busy, setBusy] = useState(null);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const auditor = isAuditor(user);
  const rows = data.rows.filter((s) => !q || `${s.name} ${s.code} ${s.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  const nuovoInterno = async (s) => { setBusy(s.id); try { const r = await api.post('/audits', { kind: 'INTERNO', site_id: s.id }); nav(`${base}/audit/${r.id}`); } catch (e) { toast(e, 'err'); } setBusy(null); };
  const sintesi = async (s) => { setBusy(s.id); try { const r = await api.post(`/sintesi/sede/${s.id}`); toast(`Sintesi generata: ${pct(r.score)} (${r.level})`); reload(); } catch (e) { toast(e, 'err'); } setBusy(null); };
  return (
    <div className="page">
      <PageHead title="Sedi" icon="building" sub={`Mese di ${mese(data.period)}: stato dell'auto-audit, ultimi audit e allineamento SGI per ogni sede. ${isSite(user) ? 'Vedi le sedi che gestisci.' : ''}`}
        actions={<div style={{ minWidth: 260 }}><SearchInput value={q} onChange={setQ} placeholder="Cerca sede" /></div>} />
      {!rows.length ? <Card><Empty icon="building" title="Nessuna sede">{isSite(user) ? 'Nessuna sede assegnata al tuo profilo: il grant Site manager porta l\'ambito della sede, oppure devi risultare responsabile della sede nell\'organigramma.' : 'Le sedi si caricano in Amministrazione > Sedi (tipo struttura: punti prelievo, centri medici e diagnostici, laboratorio).'}</Empty></Card> : (
        <div className="au-sites">{rows.map((s) => {
          const ac = s.auto_corrente;
          return (
            <Card key={s.id} className="au-site" title={<Link to={`${base}/sedi/${s.id}`}>{s.name}</Link>} actions={s.sgi_score != null ? <span className="row" style={{ gap: 8 }}><Score value={s.sgi_score} level={s.sgi_level} /><Level letter={s.sgi_level} short /></span> : <Badge tone="grey" dot={false}>Nessuna sintesi</Badge>}>
              <div className="small muted" style={{ marginBottom: 10 }}>{SITE_KIND[s.kind] || s.kind}{s.city ? ` · ${s.city}` : ''} · {s.code}{s.manager_name ? ` · site manager ${s.manager_name}` : ' · site manager non indicato in organigramma'}</div>
              <div className="facts">
                <div><div className="k">Auto-audit del mese</div>{!s.structure ? <span className="muted">non previsto</span> : ac ? <span><StatusBadge s={ac.status} /> {ac.effective_score != null && <Score value={ac.effective_score} />}</span> : <StatusBadge s="MANCANTE" />}</div>
                <div><div className="k">Ultimo auto-audit</div>{s.ultimo_auto ? <span>{mese(s.ultimo_auto.period)} · <Score value={s.ultimo_auto.effective_score} /></span> : <span className="muted">nessuno</span>}</div>
                <div><div className="k">Ultimo audit interno</div>{s.ultimo_interno ? <span>{itDate(s.ultimo_interno.conducted_at)} · <Score value={s.ultimo_interno.effective_score} /> <StatusBadge s={s.ultimo_interno.status} /></span> : <span className="muted">nessuno</span>}</div>
                <div><div className="k">Ultimo terze parti</div>{s.ultimo_terzi ? <span>{itDate(s.ultimo_terzi.third_party?.data || s.ultimo_terzi.conducted_at)} · {ENTE[s.ultimo_terzi.third_party?.ente_tipo] || ''} · {ESITO_TERZI[s.ultimo_terzi.third_party?.esito] || ''}</span> : <span className="muted">nessuno</span>}</div>
              </div>
              {s.sgi_summary && <div className="small" style={{ marginTop: 10 }}>{s.sgi_summary}</div>}
              {s.sgi_at && <div className="small muted" style={{ marginTop: 4 }}>Sintesi del {itDateTime(s.sgi_at)}</div>}
              <div className="acts">
                {ac && <Link className="btn sm ghost" to={`${base}/miei/${ac.id}`}><Icon name={ac.status === 'INVIATO' && auditor ? 'check' : 'edit'} />{ac.status === 'INVIATO' && auditor ? 'Verifica' : 'Auto-audit'}</Link>}
                {!ac && s.structure && (auditor || isSite(user)) && <button className="btn sm ghost" onClick={async () => { try { const r = await api.post('/audits/auto', { site_id: s.id }); nav(`${base}/miei/${r.id}`); } catch (e) { toast(e, 'err'); } }}><Icon name="plus" />Auto-audit del mese</button>}
                {auditor && <button className="btn sm ghost" disabled={busy === s.id} onClick={() => nuovoInterno(s)}><Icon name="plus" />Nuovo audit interno</button>}
                {auditor && <button className="btn sm ghost" onClick={() => setTerzi(s)}><Icon name="upload" />Carica audit di terze parti</button>}
                {auditor && <button className="btn sm" disabled={busy === s.id || !s.n_audits} title={s.n_audits ? 'Analizza con Claude tutti gli audit della sede' : 'Nessun audit da analizzare'} onClick={() => sintesi(s)}><Icon name="sparkle" />{s.sgi_score != null ? 'Rigenera sintesi' : 'Genera sintesi'}</button>}
                <Link className="btn sm ghost" to={`${base}/sedi/${s.id}`}>Scheda</Link>
              </div>
            </Card>
          );
        })}</div>)}
      {terzi && <TerziModal site={terzi} onClose={() => setTerzi(null)} onDone={(id) => { setTerzi(null); reload(); nav(`${base}/audit/${id}`); }} />}
    </div>
  );
}

// Caricamento di un audit di terze parti (PDF, anche più file) con ente, data, esito e note
export function TerziModal({ site, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ ente_tipo: 'CERTIFICATORE', ente: '', data: '', esito: 'CONFORME', note: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!files.length) return toast('Carica almeno un PDF', 'err');
    if (!f.ente.trim()) return toast('Indica l\'ente', 'err');
    const fd = new FormData(); fd.append('site_id', site.id); for (const [k, v] of Object.entries(f)) fd.append(k, v); for (const x of files) fd.append('file', x, x.name);
    setBusy(true);
    try { const r = await api.upload('/audits/terzi', fd); toast(`Rapporto caricato: ${r.pagine} pagine, ${r.caratteri.toLocaleString('it-IT')} caratteri estratti${r.ocr ? ' (OCR)' : ''}`); onDone(r.id); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={`Audit di terze parti · ${site.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={go}>{busy ? 'Caricamento ed estrazione del testo' : 'Carica'}</button></>}>
      <div className="au-head-grid">
        <Field label="Tipo di ente"><select className="au-in" value={f.ente_tipo} onChange={(e) => setF({ ...f, ente_tipo: e.target.value })}>{Object.entries(ENTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Ente" required><input className="au-in" value={f.ente} onChange={(e) => setF({ ...f, ente: e.target.value })} placeholder="es. Bureau Veritas, ASL Toscana Centro" /></Field>
        <Field label="Data dell'audit"><input className="au-in" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
        <Field label="Esito"><select className="au-in" value={f.esito} onChange={(e) => setF({ ...f, esito: e.target.value })}>{Object.entries(ESITO_TERZI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="Note"><textarea className="au-note" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div style={{ marginTop: 10 }}><DropZone onFiles={(xs) => setFiles([...files, ...xs])} accept=".pdf" compact><Icon name="upload" /><div className="small">Trascina qui il PDF del rapporto (fino a 25 MB, anche più file)</div></DropZone></div>
      {files.length > 0 && <ul className="au-list" style={{ marginTop: 8 }}>{files.map((x, i) => <li key={i}><span>{x.name} <span className="muted small">{kb(x.size)}</span></span><button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" /></button></li>)}</ul>}
      <div className="small muted" style={{ marginTop: 8 }}>Il testo del PDF viene estratto (OCR se è una scansione) e usato dalla sintesi di Claude della sede. Il punteggio non si calcola: pesa l'esito.</div>
    </Modal>
  );
}
