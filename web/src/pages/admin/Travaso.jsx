import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, isOwner } from '../../auth.jsx';
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

export function Travaso() {
  const { data, loading, error, reload } = useApi('/travaso');
  const { user: me } = useAuth();
  const owner = isOwner(me);
  const toast = useToast();
  const [busy, setBusy] = useState({});
  const [compare, setCompare] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const run = async (m) => {
    setBusy((b) => ({ ...b, [m.key]: true }));
    try { const r = await api.post(`/travaso/${m.key}/run`); toast(`${m.name}: ${r.rows.toLocaleString('it-IT')} righe in ${r.tables} tabelle (${(r.ms / 1000).toFixed(1)} s)`); reload(); }
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
              {!m.fresh && <span><Icon name={m.source_enabled ? 'check' : 'x'} style={{ width: 14, height: 14, verticalAlign: -2 }} /> database collegato</span>}
              <span><Icon name={m.code_ready ? 'check' : 'x'} style={{ width: 14, height: 14, verticalAlign: -2 }} /> codice nella Suite</span>
              {m.live_since && <span>attivo dal {fmtDateTime(m.live_since)}</span>}
            </div>
            <div className="sc-actions">
              {owner && m.fresh && m.mode !== 'LIVE' && <button className="btn sm" disabled={busy[m.key] || !m.code_ready} onClick={() => run(m)}><Icon name="check" />{busy[m.key] ? 'Avvio in corso' : 'Avvia il modulo'}</button>}
              {owner && !m.fresh && m.mode !== 'LIVE' && <button className={`btn sm ${m.mode === 'OFF' ? '' : 'ghost'}`} disabled={busy[m.key] || !m.source_enabled || !m.code_ready} onClick={() => run(m)}><Icon name="import" />{busy[m.key] ? 'Travaso in corso' : m.mode === 'OFF' ? 'Avvia travaso' : 'Ripeti travaso'}</button>}
              {!m.fresh && m.mode !== 'OFF' && <button className="btn sm ghost" onClick={() => setCompare(m)}><Icon name="check" />Confronta conteggi</button>}
              {m.mode !== 'OFF' && <Link className="btn sm ghost" to={`/${m.key}`}><Icon name="external" />Apri nella Suite</Link>}
              {owner && m.mode === 'MIRROR' && <button className="btn sm" onClick={() => setConfirm({ title: `Attivare ${m.name} nella Suite?`, text: 'Da questo momento la Suite è la fonte dei dati del modulo: l\'app originale va messa in sola lettura o reindirizzata. La copia dall\'app originale si disattiva.', confirmText: 'Attiva nella Suite', go: () => live(m) })}><Icon name="check" />Passa a LIVE</button>}
              {owner && !m.fresh && m.mode === 'LIVE' && <button className="btn sm ghost danger" onClick={() => setConfirm({ title: `Riportare ${m.name} in collaudo?`, text: 'Le modifiche fatte nella Suite dopo il passaggio verranno sovrascritte al prossimo travaso.', danger: true, confirmText: 'Torna in collaudo', go: () => mirror(m) })}><Icon name="refresh" />Torna in collaudo</button>}
            </div>
          </div>
        );
      })}</div>
      {compare && <CompareModal m={compare} onClose={() => setCompare(null)} />}
      {confirm && <ConfirmModal {...confirm} onConfirm={async () => { await confirm.go(); setConfirm(null); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}
