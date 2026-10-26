// Pagina principale: contenuto di una cartella (radice o /c/:id) con breadcrumb, sottocartelle e documenti in griglia o elenco.
// Con manage=true (percorso /gestione, profilo ADMIN) compaiono i comandi: nuova cartella, caricamento, menu di ogni elemento.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, api, base } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Seg, ConfirmModal, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { DocCard, DocRow, FolderCard, FolderRow, Kebab, FolderModal, DocModal, VersioneModal, Uploader, downloadUrl, folderTo, plur } from '../components.jsx';

const VIEW_KEY = 'cf-view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; } };

export function Breadcrumb({ percorso = [], manage, current }) {
  return (
    <div className="crumb cf-crumb">
      <Link to={folderTo(null, manage)}><Icon name="folder" /> Cartella condivisa</Link>
      {percorso.map((p) => <React.Fragment key={p.id}><Icon name="chevron" />{current && p.id === current.id ? <span className="strong">{p.nome}</span> : <Link to={folderTo(p.id, manage)}>{p.nome}</Link>}</React.Fragment>)}
    </div>
  );
}

export default function Sfoglia({ manage = false }) {
  const { id } = useParams();
  const cid = id ? Number(id) : null;
  const nav = useNavigate();
  const { user } = useAuth();
  const admin = isAdmin(user) && manage;
  const [view, setView] = useState(readView);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* vuoto */ } }, [view]);
  const state = useApi('/state');
  const { data, loading, error, reload } = useApi(`/cartelle/${cid || 0}`, [cid]);
  const evidenza = useApi(!cid && !manage ? '/evidenza' : null, [cid, manage]);
  const albero = useApi(admin ? '/albero' : null, [admin, data]);
  const [modal, setModal] = useState(null);   // { kind, ... }
  const [showUpload, setShowUpload] = useState(false);
  const cartelle = albero.data?.cartelle || [];
  const limiti = state.data?.limiti;

  if (error) return <div className="page"><PageHead title="Cartella condivisa" icon="folder" /><Empty icon="alert" title={error.status === 404 ? 'Cartella non trovata' : 'Dati non disponibili'}>{error.message} <Link to={folderTo(null, manage)}>Torna alla cartella principale</Link></Empty></div>;
  const c = data?.cartella;
  const title = c ? c.nome : 'Cartella condivisa';
  const sub = c ? (c.descrizione || `${plur(c.n_documenti, 'documento', 'documenti')} · ${plur(c.n_sottocartelle, 'sottocartella', 'sottocartelle')}`) : manage ? 'Gestione: crea cartelle, carica file, rinomina, sposta, metti in evidenza, elimina. Tutti gli utenti del modulo vedono tutto.' : 'Documenti a disposizione di chi ha accesso al modulo: procedure, modulistica, materiali. Apri una cartella o un documento; i nuovi non ancora letti sono segnalati.';
  const sotto = data?.sottocartelle || [];
  const docs = data?.documenti || [];
  const vuota = !sotto.length && !docs.length;
  const chiudi = () => setModal(null);
  const folderMenu = (f) => (admin ? <Kebab items={[
    { label: 'Modifica o sposta', icon: 'edit', onClick: () => setModal({ kind: 'folder', cartella: f }) },
    { label: 'Elimina', icon: 'trash', danger: true, onClick: () => setModal({ kind: 'delFolder', cartella: f }) },
  ]} /> : undefined);
  const docMenu = (d) => (admin ? <Kebab items={[
    { label: 'Modifica, sposta, evidenza', icon: 'edit', onClick: () => setModal({ kind: 'doc', doc: d }) },
    { label: 'Nuova versione', icon: 'upload', onClick: () => setModal({ kind: 'versione', doc: d }) },
    { label: 'Scheda e versioni', icon: 'info', onClick: () => nav(`${base}/doc/${d.id}`) },
    { label: 'Scarica', icon: 'download', href: downloadUrl(d) },
    { label: 'Elimina', icon: 'trash', danger: true, onClick: () => setModal({ kind: 'delDoc', doc: d }) },
  ]} /> : undefined);
  return (
    <div className="page cf-page">
      <PageHead title={title} icon={manage ? 'gear' : 'folder'} sub={sub} crumb={<Breadcrumb percorso={data?.percorso || []} manage={manage} current={c} />}
        actions={<>
          <Seg value={view} onChange={setView} label="Vista" items={[{ value: 'grid', label: 'Griglia' }, { value: 'list', label: 'Elenco' }]} />
          {admin && <button className="btn ghost" onClick={() => setModal({ kind: 'folder', parentId: cid })}><Icon name="plus" />Nuova cartella</button>}
          {admin && <button className={`btn ${showUpload ? 'ghost' : ''}`} onClick={() => setShowUpload((s) => !s)}><Icon name="upload" />Carica file</button>}
          {admin && !cid && <Link className="btn ghost" to={`${base}/gestione/cronologia`}><Icon name="clock" />Cronologia</Link>}
          {c && admin && folderMenu(c)}
        </>} />
      {admin && showUpload && <Card title={`Carica in ${c ? c.nome : 'Cartella principale'}`} icon="upload" actions={<button className="iconbtn" aria-label="Chiudi" onClick={() => setShowUpload(false)}><Icon name="x" /></button>}><Uploader cartellaId={cid} limiti={limiti} onDone={reload} /></Card>}
      {!cid && !manage && evidenza.data?.length > 0 && (
        <Card title="In evidenza" icon="star" className="cf-evidenza" actions={<Link to={`${base}/evidenza`} className="small">Tutti</Link>}>
          <div className="cf-grid">{evidenza.data.slice(0, 8).map((d) => <DocCard key={d.id} doc={d} />)}</div>
        </Card>
      )}
      {loading && !data ? <Loading /> : vuota ? (
        <Empty icon="folder" title={c ? 'Cartella vuota' : 'Nessun documento ancora'}>{admin ? 'Crea una cartella o carica i primi file con i pulsanti in alto.' : c ? 'Non ci sono ancora documenti o sottocartelle qui.' : 'Chi gestisce la cartella condivisa non ha ancora caricato documenti.'}</Empty>
      ) : view === 'grid' ? (
        <>
          {sotto.length > 0 && <div className="cf-sect"><h3>Cartelle <Badge tone="grey" dot={false}>{sotto.length}</Badge></h3><div className="cf-grid">{sotto.map((f) => <FolderCard key={f.id} c={f} manage={manage} menu={folderMenu(f)} />)}</div></div>}
          {docs.length > 0 && <div className="cf-sect"><h3>Documenti <Badge tone="grey" dot={false}>{docs.length}</Badge></h3><div className="cf-grid">{docs.map((d) => <DocCard key={d.id} doc={d} menu={docMenu(d)} />)}</div></div>}
        </>
      ) : (
        <Card flush>
          <div className="table-wrap"><table className="t cf-table">
            <thead><tr><th /><th>Nome</th><th>Tipo</th><th className="num">Dimensione</th><th>Versione</th><th>Aggiornato</th><th className="num" title="persone che lo hanno aperto">Letto da</th>{admin && <th />}</tr></thead>
            <tbody>
              {sotto.map((f) => <FolderRow key={`c${f.id}`} c={f} manage={manage} menu={admin ? folderMenu(f) : undefined} />)}
              {docs.map((d) => <DocRow key={d.id} doc={d} menu={admin ? docMenu(d) : undefined} />)}
            </tbody>
          </table></div>
        </Card>
      )}
      {modal?.kind === 'folder' && <FolderModal cartella={modal.cartella} parentId={modal.parentId} cartelle={cartelle} onClose={chiudi} onSaved={(saved) => { if (modal.cartella && modal.cartella.id === cid && saved.parent_id !== modal.cartella.parent_id) nav(folderTo(saved.parent_id, manage)); else reload(); }} />}
      {modal?.kind === 'doc' && <DocModal doc={modal.doc} cartelle={cartelle} onClose={chiudi} onSaved={reload} />}
      {modal?.kind === 'versione' && <VersioneModal doc={modal.doc} onClose={chiudi} onSaved={reload} />}
      {modal?.kind === 'delDoc' && <ConfirmModal title="Elimina documento" danger confirmText="Elimina" text={`Eliminare "${modal.doc.nome}" (versione ${modal.doc.versione}) con tutto lo storico delle versioni? L'operazione non si può annullare.`} onClose={chiudi} onConfirm={async () => { await api.del(`/documenti/${modal.doc.id}`); reload(); }} />}
      {modal?.kind === 'delFolder' && <ConfirmModal title="Elimina cartella" danger confirmText="Elimina" text={`Eliminare la cartella "${modal.cartella.nome}"? Si può eliminare solo se è vuota.`} onClose={chiudi} onConfirm={async () => { await api.del(`/cartelle/${modal.cartella.id}`); if (modal.cartella.id === cid) nav(folderTo(modal.cartella.parent_id, manage)); else reload(); }} />}
    </div>
  );
}
