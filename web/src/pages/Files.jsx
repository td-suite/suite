import React, { useState } from 'react';
import { api, qs } from '../api.js';
import { useApi, Card, Skeleton, Empty, Coming, ErrorBox, PageHead, DropZone, useToast, PromptModal, ConfirmModal, Modal, Field } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { fmtBytes, fmtDateTime, fileIcon } from '../format.js';

export default function Files() {
  const [folder, setFolder] = useState('');
  const { data, loading, error, unavailable, reload } = useApi(`/files/mine${qs({ folder })}`, [folder]);
  const toast = useToast();
  const [rename, setRename] = useState(null);
  const [move, setMove] = useState(null);
  const [del, setDel] = useState(null);
  const [newFolder, setNewFolder] = useState(false);
  const [uploading, setUploading] = useState(0);
  const folders = Array.from(new Set([...(data?.folders || []), ...((data?.rows || []).map((r) => r.folder).filter(Boolean))])).sort();
  const upload = async (files) => {
    setUploading(files.length);
    for (const f of files) {
      try { const fd = new FormData(); fd.append('file', f); await api.upload(`/files/upload${qs({ scope: 'PERSONAL', folder })}`, fd); } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
      setUploading((n) => n - 1);
    }
    reload();
  };
  const used = data?.used || 0, quota = data?.quota || 0;
  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const rows = (data?.rows || []).filter((r) => !folder || r.folder === folder);
  return (
    <div className="page narrow">
      <PageHead title="Cartella personale" icon="folder" sub="I tuoi file nella Suite, disponibili da ogni dispositivo" actions={<button className="btn ghost" onClick={() => setNewFolder(true)}><Icon name="plus" />Nuova cartella</button>} />
      {unavailable && <Card><Coming what="L'archivio file" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {!unavailable && (
        <>
          <Card>
            <div className="row between"><span className="small muted">Spazio usato</span><span className="small strong">{fmtBytes(used)}{quota ? ` di ${fmtBytes(quota)}` : ''}</span></div>
            <div className="quota mt" style={{ marginTop: 6 }}><i className={pct >= 95 ? 'full' : ''} style={{ width: `${pct}%` }} /></div>
          </Card>
          <div className="folders mt2">
            <button className={!folder ? 'on' : ''} onClick={() => setFolder('')}><Icon name="folder" />Tutti i file</button>
            {folders.map((f) => <button key={f} className={folder === f ? 'on' : ''} onClick={() => setFolder(f)}><Icon name="folder" />{f}</button>)}
          </div>
          <div className="mt2"><DropZone onFiles={upload}>{uploading > 0 ? <><Icon name="upload" /><div>Caricamento di {uploading} file in corso</div></> : <><Icon name="upload" /><div>Trascina qui i file{folder ? ` nella cartella "${folder}"` : ''} oppure clicca per sceglierli</div></>}</DropZone></div>
          <Card flush className="mt2">
            {loading && <div style={{ padding: 18 }}><Skeleton /></div>}
            {data && !rows.length && <Empty icon="folder" title="Nessun file qui">Carica il primo file trascinandolo nell'area qui sopra.</Empty>}
            {rows.map((f) => (
              <div key={f.id} className="file-row">
                <span className="fi"><Icon name={fileIcon(f.mime, f.filename)} /></span>
                <div style={{ flex: 1, minWidth: 0 }}><a className="n ellipsis" href={`/api/files/${f.id}`} style={{ color: 'inherit', display: 'block' }}>{f.filename}</a><div className="m">{fmtBytes(f.size)} · {fmtDateTime(f.created_at)}{f.folder ? ` · ${f.folder}` : ''}</div></div>
                <a className="iconbtn" href={`/api/files/${f.id}`} download aria-label="Scarica"><Icon name="download" /></a>
                <button className="iconbtn" aria-label="Rinomina" onClick={() => setRename(f)}><Icon name="edit" /></button>
                <button className="iconbtn" aria-label="Sposta" onClick={() => setMove(f)}><Icon name="folder" /></button>
                <button className="iconbtn danger" aria-label="Elimina" onClick={() => setDel(f)}><Icon name="trash" /></button>
              </div>
            ))}
          </Card>
        </>
      )}
      {rename && <PromptModal title="Rinomina file" label="Nuovo nome" placeholder={rename.filename} confirmText="Rinomina" onConfirm={async (v) => { await api.put(`/files/${rename.id}`, { filename: v }); reload(); }} onClose={() => setRename(null)} />}
      {newFolder && <PromptModal title="Nuova cartella" label="Nome della cartella" help="La cartella viene creata al primo file caricato al suo interno." confirmText="Apri" onConfirm={async (v) => { setFolder(v); }} onClose={() => setNewFolder(false)} />}
      {move && (
        <Modal title="Sposta file" onClose={() => setMove(null)}>
          <Field label="Cartella di destinazione">
            <select defaultValue={move.folder || ''} onChange={async (e) => { try { await api.put(`/files/${move.id}`, { folder: e.target.value || null }); toast('File spostato'); setMove(null); reload(); } catch (e2) { toast(e2, 'err'); } }}>
              <option value="">Radice</option>{folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </Modal>
      )}
      {del && <ConfirmModal title="Eliminare il file?" text={`"${del.filename}" verrà eliminato definitivamente.`} confirmText="Elimina" danger onConfirm={async () => { await api.del(`/files/${del.id}`); reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}
