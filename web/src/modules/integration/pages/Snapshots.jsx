import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Loading, Empty, Modal, Field, useToast, ErrorBox } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

const KIND = { manual: 'Manuale', daily: 'Giornaliero', 'pre-import': 'Prima di un import', 'pre-restore': 'Prima di un ripristino', 'pre-delete': 'Prima di una eliminazione', migration: 'Migrazione iniziale' };

export default function Snapshots() {
  const toast = useToast();
  const { data, reload } = useApi('/snapshots');
  const [note, setNote] = useState('');
  const [restore, setRestore] = useState(null);
  const [err, setErr] = useState(null);
  const create = async () => { try { await api.post('/snapshots', { note }); setNote(''); toast('Snapshot salvato'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const doRestore = async () => {
    setErr(null);
    try { const r = await api.post(`/snapshots/${restore.id}/restore`); toast(`Ripristinato: ${r.tN + r.tU} target, ${r.aN + r.aU} attività`); setRestore(null); reload(); }
    catch (e) { setErr(e); }
  };
  const download = async (s) => {
    const full = await api.get(`/snapshots/${s.id}`);
    const blob = new Blob([JSON.stringify({ v: 2, targets: full.data.targets, team: full.data.team, meta: { rev: s.id, savedBy: s.created_by || 'sistema', savedAt: s.created_at, log: [] } }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `TD_Integration_Plan_snapshot_${s.id}.json`; document.body.appendChild(a); a.click(); a.remove();
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Snapshot e ripristino</h1><div className="sub">Fotografie integrali del piano: una ogni notte, una prima di ogni import, ripristino o eliminazione di target, più quelle manuali. Il ripristino riporta tutto il piano allo stato dello snapshot (viene salvata prima una fotografia dello stato attuale). Il file JSON scaricato si può aprire con "Carica dati".</div></div>
        <div className="row"><input placeholder="Nota (facoltativa)" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 240 }} /><button className="btn" onClick={create}>Salva snapshot adesso</button></div>
      </div>
      <div className="card">
        {!data ? <Loading /> : !data.length ? <Empty>Nessuno snapshot</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>#</th><th>Quando</th><th>Tipo</th><th>Nota</th><th>Autore</th><th className="num">Target</th><th className="num">Attività</th><th></th></tr></thead>
            <tbody>{data.map((s) => <tr key={s.id}>
              <td className="mono small">{s.id}</td><td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(s.created_at)}</td>
              <td className="small">{KIND[s.kind] || s.kind}</td><td className="small">{s.note || ''}</td><td className="small">{s.created_by || 'sistema'}</td>
              <td className="num">{s.n_targets}</td><td className="num">{s.n_activities}</td>
              <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><button className="btn sm ghost" onClick={() => download(s)}>Scarica JSON</button><button className="btn sm danger" onClick={() => setRestore(s)}>Ripristina</button></div></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
      {restore && <Modal title={`Ripristinare lo snapshot #${restore.id}?`} onClose={() => setRestore(null)}
        footer={<><button className="btn ghost" onClick={() => setRestore(null)}>Annulla</button><button className="btn danger" onClick={doRestore}>Ripristina il piano</button></>}>
        <ErrorBox error={err} />
        <p>Il piano tornerà allo stato del <b>{itDateTime(restore.created_at)}</b> ({restore.n_targets} target, {restore.n_activities} attività). Le modifiche fatte dopo quella data verranno sovrascritte per tutti gli utenti; lo stato attuale viene comunque salvato come snapshot "prima di un ripristino".</p>
      </Modal>}
    </div>
  );
}
