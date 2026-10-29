import React, { useCallback, useEffect, useState } from 'react';
import { api, isUnavailable, qs } from '../../api.js';
import { useAuth, isAdmin, canManageComm } from '../../auth.jsx';
import { Avatar, Card, Coming, Empty, ErrorBox, Skeleton, useToast, ConfirmModal } from '../ui.jsx';
import { Icon } from '../Icons.jsx';
import { timeAgo, fmtBytes } from '../../format.js';

// Commenti: dei post della bacheca (default) o degli articoli del Blog (base='/community/news/<id>', delBase='/community/news-comments')
export function Comments({ post, onCount, base, delBase = '/community/comments', canDelete }) {
  const [rows, setRows] = useState(null);
  const [body, setBody] = useState('');
  const toast = useToast();
  const { user } = useAuth();
  const root = base || `/community/posts/${post.id}`;
  const load = useCallback(() => api.get(`${root}/comments`, { silent: true }).then(setRows).catch(() => setRows([])), [root]);
  useEffect(() => { load(); }, [load]);
  const send = async (e) => {
    e.preventDefault(); if (!body.trim()) return;
    try { await api.post(`${root}/comments`, { body: body.trim() }); setBody(''); await load(); onCount?.(1); } catch (e2) { toast(e2, 'err'); }
  };
  const del = async (c) => { try { await api.del(`${delBase}/${c.id}`); await load(); onCount?.(-1); } catch (e2) { toast(e2, 'err'); } };
  return (
    <div className="comments">
      {rows == null && <Skeleton lines={2} />}
      {rows?.map((c) => (
        <div key={c.id} className="cmt">
          <Avatar name={c.author?.full_name || c.author_name} fileId={c.author?.avatar_file_id} size="sm" />
          <div className="bub"><span className="n">{c.author?.full_name || c.author_name}</span><span className="w">{timeAgo(c.created_at)}</span><div>{c.body}</div></div>
          {(isAdmin(user) || canDelete || c.author?.id === user.id || c.author_id === user.id) && <button className="iconbtn danger" aria-label="Elimina commento" onClick={() => del(c)}><Icon name="trash" /></button>}
        </div>
      ))}
      <form className="cmt-form" onSubmit={send}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Scrivi un commento" aria-label="Commento" /><button className="btn sm" disabled={!body.trim()}>Invia</button></form>
    </div>
  );
}

export function Post({ post, onChange }) {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState(post);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setP(post), [post]);
  const react = async (kind) => {
    const next = p.my_reaction === kind ? null : kind;
    try {
      await api.post(`/community/posts/${p.id}/react`, { kind: next });
      const r = { ...(p.reactions || {}) };
      if (p.my_reaction) r[p.my_reaction] = Math.max(0, (r[p.my_reaction] || 1) - 1);
      if (next) r[next] = (r[next] || 0) + 1;
      setP({ ...p, reactions: r, my_reaction: next });
    } catch (e) { toast(e, 'err'); }
  };
  const pin = async () => { try { await api.put(`/community/posts/${p.id}/pin`, { pinned: !p.pinned }); setP({ ...p, pinned: !p.pinned }); onChange?.(); } catch (e) { toast(e, 'err'); } };
  const del = async () => { await api.del(`/community/posts/${p.id}`); onChange?.(); };
  const likes = p.reactions?.LIKE || 0, hearts = p.reactions?.HEART || 0;
  const images = (p.files || []).filter((f) => (f.mime || '').startsWith('image/'));
  const others = (p.files || []).filter((f) => !(f.mime || '').startsWith('image/'));
  return (
    <article className="post">
      <div className="who">
        <Avatar name={p.author?.full_name} fileId={p.author?.avatar_file_id} />
        <div style={{ minWidth: 0 }}><div className="n">{p.author?.full_name}</div><div className="r">{[p.author?.job_title, p.site_name].filter(Boolean).join(' · ')}{p.author?.job_title || p.site_name ? ' · ' : ''}{timeAgo(p.created_at)}</div></div>
        <div className="spacer" />
        {p.pinned && <span className="pinned"><Icon name="pinTack" />In evidenza</span>}
        {canManageComm(user) && <button className={`iconbtn ${p.pinned ? 'on' : ''}`} aria-label={p.pinned ? 'Togli dall\'evidenza' : 'Metti in evidenza'} onClick={pin}><Icon name="pinTack" /></button>}
        {(isAdmin(user) || p.author?.id === user.id) && <button className="iconbtn danger" aria-label="Elimina post" onClick={() => setConfirm(true)}><Icon name="trash" /></button>}
      </div>
      <div className="body">{p.body}</div>
      {images.length > 0 && <div className="files">{images.map((f) => <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" /></a>)}</div>}
      {others.length > 0 && <div className="files">{others.map((f) => <a key={f.id} className="chip" href={`/api/files/${f.id}`}><Icon name="file" />{f.filename} <span className="faint">{fmtBytes(f.size)}</span></a>)}</div>}
      <div className="acts">
        <button className={`react ${p.my_reaction === 'LIKE' ? 'on' : ''}`} onClick={() => react('LIKE')} aria-pressed={p.my_reaction === 'LIKE'}><Icon name="like" />{likes || ''} Mi piace</button>
        <button className={`react ${p.my_reaction === 'HEART' ? 'on' : ''}`} onClick={() => react('HEART')} aria-pressed={p.my_reaction === 'HEART'}><Icon name="heart" />{hearts || ''} Grazie</button>
        <button className={`react ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="comment" />{p.comments_count || ''} Commenti</button>
      </div>
      {open && <Comments post={p} onCount={(d) => setP((x) => ({ ...x, comments_count: Math.max(0, (x.comments_count || 0) + d) }))} />}
      {confirm && <ConfirmModal title="Eliminare il post?" text="Il post e i suoi commenti verranno rimossi dalla bacheca." confirmText="Elimina" danger onConfirm={del} onClose={() => setConfirm(false)} />}
    </article>
  );
}

export function Composer({ onPosted, siteId }) {
  const { user, cfg } = useAuth();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);
  const addFiles = async (list) => {
    for (const f of list) {
      try {
        const fd = new FormData(); fd.append('file', f);
        const up = await api.upload('/files/upload?scope=POST', fd);
        setFiles((x) => [...x, up]);
      } catch (e) { toast(e, 'err'); }
    }
  };
  const publish = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post('/community/posts', { body: body.trim(), ...(siteId ? { site_id: Number(siteId) } : {}), ...(files.length ? { file_ids: files.map((f) => f.id) } : {}) });
      setBody(''); setFiles([]); setFocus(false); onPosted?.(); toast('Pubblicato in bacheca');
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return (
    <div className="composer">
      <Avatar name={user.full_name} fileId={user.avatar_file_id} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} onFocus={() => setFocus(true)} placeholder={`Condividi qualcosa con i colleghi, ${user.first_name || user.full_name.split(' ')[0]}`} aria-label="Nuovo post" rows={focus || body ? 3 : 1} />
        {files.length > 0 && <div className="row tight mt">{files.map((f) => <span key={f.id} className="chip"><Icon name="image" />{f.filename}<button type="button" aria-label="Rimuovi allegato" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><Icon name="x" /></button></span>)}</div>}
        {(focus || body) && !canManageComm(user) && user.is_internal && <div className="tiny muted mt">Visibile alla rete Toscana Diagnostica (personale interno).</div>}
        {(focus || body) && (
          <div className="acts">
            {cfg.blobEnabled && <label className="btn sm ghost" style={{ cursor: 'pointer' }}><Icon name="image" />Immagine<input type="file" accept="image/*" hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} /></label>}
            <button className="btn sm ghost" type="button" onClick={() => { setBody(''); setFiles([]); setFocus(false); }}>Annulla</button>
            <button className="btn sm" type="button" disabled={busy || !body.trim()} onClick={publish}><Icon name="send" />Pubblica</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Bacheca: limit → versione compatta (home); full → filtro sede e "carica altri"
export default function Board({ limit, full, siteId, initialPosts, readOnly }) {
  const [posts, setPosts] = useState(initialPosts || null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(!initialPosts);
  const load = useCallback(async (before) => {
    setLoading(true);
    try {
      const rows = await api.get(`/community/posts${qs({ before, site_id: siteId })}`, { silent: true });
      const arr = Array.isArray(rows) ? rows : rows?.rows || [];
      setPosts((p) => (before && p ? [...p, ...arr] : arr));
      setMore(arr.length >= 20);
      setError(null);
    } catch (e) { setError(e); if (!before) setPosts([]); }
    setLoading(false);
  }, [siteId]);
  useEffect(() => { if (!initialPosts) load(); }, [load, initialPosts]);
  useEffect(() => { if (initialPosts) setPosts(initialPosts); }, [initialPosts]);
  const shown = limit && posts ? posts.slice(0, limit) : posts;
  return (
    <Card flush className="board">
      {!isUnavailable(error) && !readOnly && <Composer onPosted={() => load()} siteId={siteId} />}
      {readOnly && <div className="small muted" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>Bacheca in sola lettura: le comunicazioni della rete Toscana Diagnostica rivolte anche ai partner e ai clienti.</div>}
      {loading && !posts && <div style={{ padding: 18 }}><Skeleton lines={3} /><Skeleton lines={2} /></div>}
      {isUnavailable(error) && <Coming what="La bacheca" />}
      {error && !isUnavailable(error) && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
      {posts && !posts.length && !error && <Empty icon="comment" title="La bacheca è ancora vuota">Sii la prima persona a scrivere qualcosa ai colleghi.</Empty>}
      {shown?.map((p) => <Post key={p.id} post={p} onChange={() => load()} />)}
      {full && posts && posts.length > 0 && more && !isUnavailable(error) && (
        <div style={{ padding: 14, textAlign: 'center' }}><button className="btn ghost" disabled={loading} onClick={() => load(posts[posts.length - 1].created_at)}>Carica altri</button></div>
      )}
    </Card>
  );
}
