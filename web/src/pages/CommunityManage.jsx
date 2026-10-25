import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useParams, useNavigate, NavLink } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, isAdmin, canManageComm, canPublish } from '../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, Coming, ErrorBox, PageHead, Field, Modal, useToast, Tabs, ConfirmModal, Switch, Avatar } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import Markdown from '../components/Markdown.jsx';
import AudienceSelector, { audienceLabel } from '../components/community/Audience.jsx';
import { fmtDate, fmtDateTime, NEWS_KIND, NEWS_STATUS, SEVERITY } from '../format.js';
import { Forbidden } from './Misc.jsx';

const STATUS_TONE = { DRAFT: 'grey', PUBLISHED: 'green', ARCHIVED: 'amber' };

function SubNav() {
  return (
    <div className="tabs">
      <NavLink to="/community/manage" end>Contenuti</NavLink>
      <NavLink to="/community/manage/notices">Avvisi</NavLink>
      <NavLink to="/community/manage/quotes">Frasi del giorno</NavLink>
    </div>
  );
}

// ---------- Tabella contenuti ----------
function ContentTable() {
  const { user } = useAuth();
  const [kind, setKind] = useState('');
  const { data, loading, unavailable, error, reload } = useApi(`/community/manage/news${qs({ kind })}`, [kind]);
  const rows = (Array.isArray(data) ? data : data?.rows || []).filter((n) => !kind || n.kind === kind);
  const toast = useToast();
  const [del, setDel] = useState(null);
  const publish = async (n) => { try { await api.post(`/community/manage/news/${n.id}/publish`); toast(`"${n.title}" pubblicata`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title="Gestione Comunicazione" icon="megaphone" sub="News, circolari, blog, avvisi e frase del giorno" actions={<Link to="/community/manage/news/new" className="btn"><Icon name="plus" />Nuovo contenuto</Link>} />
      <SubNav />
      <Tabs value={kind} onChange={setKind} items={[{ value: '', label: 'Tutti' }, { value: 'NEWS', label: 'News' }, { value: 'CIRCOLARE', label: 'Circolari' }, { value: 'BLOG', label: 'Blog' }]} />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {unavailable && <Coming what="La gestione dei contenuti" />}
        {error && !unavailable && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="news" title="Nessun contenuto">Crea la prima news o circolare con il pulsante in alto.</Empty>}
        {rows.length > 0 && (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Titolo</th><th>Tipo</th><th>Stato</th><th>Pubblico</th><th>Pubblicata</th><th>Presa visione</th><th></th></tr></thead>
            <tbody>{rows.map((n) => (
              <tr key={n.id}>
                <td><Link to={`/community/manage/news/${n.id}`} className="strong">{n.title}</Link>{n.protocol && <div className="tiny mono muted">{n.protocol}</div>}</td>
                <td><Badge tone={n.kind === 'CIRCOLARE' ? 'mauve' : n.kind === 'BLOG' ? 'amber' : 'teal'}>{NEWS_KIND[n.kind]}</Badge></td>
                <td><Badge tone={STATUS_TONE[n.status]}>{NEWS_STATUS[n.status] || n.status}</Badge></td>
                <td className="small">{audienceLabel(n.audience)}{n.is_public && <div className="tiny muted">Pubblico</div>}</td>
                <td className="small nowrap">{fmtDate(n.published_at)}</td>
                <td className="small">{n.requires_ack ? <Link to={`/community/manage/news/${n.id}/acks`}>{n.acks_count != null ? `${n.acks_count}${n.audience_count != null ? ` di ${n.audience_count}` : ''}` : 'Elenco'}</Link> : <span className="faint">non richiesta</span>}</td>
                <td className="actions">
                  {n.status === 'DRAFT' && canPublish(user) && <button className="btn sm" onClick={() => publish(n)}>Pubblica</button>}{' '}
                  <Link to={`/community/manage/news/${n.id}`} className="iconbtn" aria-label="Modifica"><Icon name="edit" /></Link>
                  <button className="iconbtn danger" aria-label="Elimina" onClick={() => setDel(n)}><Icon name="trash" /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {del && <ConfirmModal title="Eliminare il contenuto?" text={`"${del.title}" verrà rimosso definitivamente.`} confirmText="Elimina" danger onConfirm={async () => { await api.del(`/community/manage/news/${del.id}`); reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}

// ---------- Editor ----------
const EMPTY_NEWS = { kind: 'NEWS', title: '', summary: '', body: '', audience: { type: 'ALL' }, requires_ack: false, ack_due: '', is_public: false, tags: [], cover_file_id: null, status: 'DRAFT' };

function Editor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const { user, cfg } = useAuth();
  const existing = useApi(!isNew ? `/community/manage/news/${id}` : null, [id]);
  const [f, setF] = useState(EMPTY_NEWS);
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (existing.data) {
      const n = existing.data.row || existing.data;
      setF({ ...EMPTY_NEWS, ...n, ack_due: n.ack_due ? String(n.ack_due).slice(0, 10) : '', tags: n.tags || [], audience: n.audience || { type: 'ALL' } });
      setTagText((n.tags || []).join(', '));
    }
  }, [existing.data]);
  // Lettura dell'elenco se la GET singola non è disponibile
  const list = useApi(!isNew && existing.error?.status === 404 ? '/community/manage/news' : null, [existing.error]);
  useEffect(() => {
    if (list.data) { const n = (Array.isArray(list.data) ? list.data : list.data.rows || []).find((x) => String(x.id) === String(id)); if (n) { setF({ ...EMPTY_NEWS, ...n, ack_due: n.ack_due ? String(n.ack_due).slice(0, 10) : '', tags: n.tags || [] }); setTagText((n.tags || []).join(', ')); } }
  }, [list.data, id]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const payload = () => ({
    kind: f.kind, title: f.title, summary: f.summary || null, body: f.body, audience: f.audience, requires_ack: f.kind === 'CIRCOLARE' ? Boolean(f.requires_ack) : false,
    ack_due: f.requires_ack && f.ack_due ? f.ack_due : null, is_public: f.kind === 'BLOG' ? Boolean(f.is_public) : false,
    tags: tagText.split(',').map((t) => t.trim()).filter(Boolean), cover_file_id: f.cover_file_id || null,
  });
  const save = async (publish) => {
    if (!f.title.trim() || !f.body.trim()) return toast('Titolo e testo sono obbligatori', 'err');
    setBusy(true);
    try {
      let nid = isNew ? null : Number(id);
      if (isNew) { const r = await api.post('/community/manage/news', payload()); nid = r.id; } else await api.put(`/community/manage/news/${nid}`, payload());
      if (publish) { await api.post(`/community/manage/news/${nid}/publish`); toast('Pubblicato'); } else toast('Bozza salvata');
      navigate('/community/manage');
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const uploadCover = async (file) => {
    try { const fd = new FormData(); fd.append('file', file); const up = await api.upload('/files/upload?scope=NEWS', fd); set('cover_file_id', up.id); } catch (e) { toast(e, 'err'); }
  };
  const insertImage = async (file) => {
    try { const fd = new FormData(); fd.append('file', file); const up = await api.upload('/files/upload?scope=NEWS', fd); set('body', `${f.body}\n\n![${up.filename}](file:${up.id})\n`); } catch (e) { toast(e, 'err'); }
  };
  if (!isNew && existing.loading) return <div className="page"><Skeleton lines={6} /></div>;
  return (
    <div className="page">
      <PageHead crumb={<><Link to="/community/manage">Gestione</Link><Icon name="chevron" /><span>{isNew ? 'Nuovo contenuto' : 'Modifica'}</span></>} title={isNew ? 'Nuovo contenuto' : f.title || 'Modifica'} icon="edit"
        actions={<><Link to="/community/manage" className="btn ghost">Annulla</Link><button className="btn ghost" disabled={busy} onClick={() => save(false)}><Icon name="check" />Salva bozza</button>{canPublish(user) && <button className="btn" disabled={busy} onClick={() => save(true)}><Icon name="send" />{f.status === 'PUBLISHED' ? 'Aggiorna e ripubblica' : 'Pubblica'}</button>}</>} />
      {f.status === 'PUBLISHED' && <div className="alert info mb2"><Icon name="info" /><span>Questo contenuto è già pubblicato{f.protocol ? ` con protocollo ${f.protocol}` : ''}: le modifiche saranno visibili subito dopo il salvataggio.</span></div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="col">
          <Card>
            <div className="col">
              <Field label="Titolo" required><input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Un titolo chiaro e breve" autoFocus={isNew} /></Field>
              <Field label="Sommario" help="Una o due frasi mostrate negli elenchi e nella home."><textarea value={f.summary || ''} onChange={(e) => set('summary', e.target.value)} style={{ minHeight: 60 }} /></Field>
            </div>
          </Card>
          <Card title="Testo" icon="edit" actions={cfg.blobEnabled && <label className="btn sm ghost" style={{ cursor: 'pointer' }}><Icon name="image" />Inserisci immagine<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && insertImage(e.target.files[0])} /></label>}>
            <div className="editor">
              <textarea value={f.body} onChange={(e) => set('body', e.target.value)} placeholder={'Scrivi in Markdown.\n\n# Titolo\nParagrafo con **grassetto** e [link](https://...).\n\n- elenco\n- puntato'} aria-label="Testo in Markdown" />
              <div className="preview" aria-label="Anteprima">{f.body ? <Markdown source={f.body} /> : <div className="empty compact muted">L'anteprima compare mentre scrivi.</div>}</div>
            </div>
          </Card>
        </div>
        <div className="col">
          <Card title="Pubblicazione" icon="megaphone">
            <div className="col">
              <Field label="Tipo"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(NEWS_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <AudienceSelector value={f.audience} onChange={(a) => set('audience', a)} admin={isAdmin(user)} />
              {f.kind === 'CIRCOLARE' && <>
                <label className="f inline"><Switch checked={f.requires_ack} onChange={(v) => set('requires_ack', v)} label="Richiede presa visione" />Richiede presa visione</label>
                {f.requires_ack && <Field label="Scadenza presa visione"><input type="date" value={f.ack_due} onChange={(e) => set('ack_due', e.target.value)} /></Field>}
                <div className="help">Alla pubblicazione la circolare riceve un protocollo CIRC-AAAA-NNN e i destinatari vengono avvisati.</div>
              </>}
              {f.kind === 'BLOG' && <label className="f inline"><Switch checked={f.is_public} onChange={(v) => set('is_public', v)} label="Pubblico" />Visibile sulle vetrine pubbliche</label>}
              <Field label="Tag" help="Separati da virgola"><input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="qualità, formazione" /></Field>
            </div>
          </Card>
          <Card title="Copertina" icon="image">
            {f.cover_file_id ? <div className="col"><img className="cover lg" src={`/api/files/${f.cover_file_id}`} alt="" style={{ height: 150 }} /><button className="btn sm ghost" onClick={() => set('cover_file_id', null)}><Icon name="trash" />Rimuovi</button></div>
              : cfg.blobEnabled ? <label className="dropzone" style={{ display: 'block' }}><Icon name="upload" /><div className="small">Carica un'immagine di copertina</div><input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadCover(e.target.files[0])} /></label>
                : <div className="small muted">L'archivio file non è configurato: la copertina userà il colore del tipo di contenuto.</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------- Presa visione ----------
function Acks() {
  const { id } = useParams();
  const { data, loading, unavailable, error } = useApi(`/community/news/${id}/acks`, [id]);
  const acked = data?.acked || data?.rows?.filter((r) => r.at || r.acked_at) || [];
  const missing = data?.missing || data?.pending || [];
  const [tab, setTab] = useState('missing');
  return (
    <div className="page">
      <PageHead crumb={<><Link to="/community/manage">Gestione</Link><Icon name="chevron" /><span>Presa visione</span></>} title={data?.news?.title || data?.title || 'Presa visione'} icon="eye" sub={data?.news?.protocol || data?.protocol} />
      {loading && <Card><Skeleton /></Card>}
      {unavailable && <Card><Coming what="L'elenco delle prese visione" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {data && (
        <>
          <div className="grid g3 mb2">
            <div className="card kpi"><div className="lbl">Hanno confermato</div><div className="val green">{acked.length}</div></div>
            <div className="card kpi"><div className="lbl">Mancano</div><div className="val red">{missing.length}</div></div>
            <div className="card kpi"><div className="lbl">Copertura</div><div className="val">{acked.length + missing.length ? Math.round((acked.length / (acked.length + missing.length)) * 100) : 0}<small>%</small></div></div>
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ value: 'missing', label: 'Chi manca', count: missing.length }, { value: 'acked', label: 'Chi ha letto', count: acked.length }]} />
          <Card flush>
            {(tab === 'missing' ? missing : acked).length === 0 && <Empty icon="check" compact title={tab === 'missing' ? 'Tutti hanno confermato.' : 'Nessuna conferma ancora'} />}
            <div className="list">{(tab === 'missing' ? missing : acked).map((u) => (
              <div key={u.id || u.user_id} className="it" style={{ alignItems: 'center' }}><Avatar name={u.full_name} fileId={u.avatar_file_id} size="sm" /><div style={{ flex: 1 }}><div className="t">{u.full_name}</div><div className="m">{[u.email, u.site_name].filter(Boolean).join(' · ')}</div></div>{(u.at || u.acked_at) && <span className="small muted">{fmtDateTime(u.at || u.acked_at)}</span>}</div>
            ))}</div>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------- Avvisi ----------
const EMPTY_NOTICE = { title: '', body: '', severity: 'INFO', audience: { type: 'ALL' }, link: '', starts_at: '', ends_at: '' };
const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function NoticeModal({ item, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY_NOTICE, ...(item || {}), starts_at: toLocalInput(item?.starts_at) || toLocalInput(new Date()), ends_at: toLocalInput(item?.ends_at), body: item?.body || '', link: item?.link || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const b = { title: f.title, body: f.body || null, severity: f.severity, audience: f.audience, link: f.link || null, starts_at: new Date(f.starts_at).toISOString(), ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null };
    try { if (item?.id) await api.put(`/community/manage/notices/${item.id}`, b); else await api.post('/community/manage/notices', b); toast('Avviso salvato'); onSaved(); onClose(); } catch (e2) { toast(e2, 'err'); }
  };
  return (
    <Modal title={item?.id ? 'Modifica avviso' : 'Nuovo avviso'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="nform">Salva</button></>}>
      <form id="nform" onSubmit={save} className="col">
        <Field label="Titolo" required><input value={f.title} onChange={set('title')} required autoFocus /></Field>
        <Field label="Testo"><textarea value={f.body} onChange={set('body')} style={{ minHeight: 70 }} /></Field>
        <div className="form-grid">
          <Field label="Gravità"><select value={f.severity} onChange={set('severity')}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Collegamento"><input value={f.link} onChange={set('link')} placeholder="/community/news/..." /></Field>
          <Field label="Dal"><input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} required /></Field>
          <Field label="Al" help="Vuoto = senza scadenza"><input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></Field>
        </div>
        <AudienceSelector value={f.audience} onChange={(a) => setF({ ...f, audience: a })} admin={isAdmin(user)} />
      </form>
    </Modal>
  );
}

function NoticesManage() {
  const { data, loading, unavailable, error, reload } = useApi('/community/notices');
  const rows = Array.isArray(data) ? data : data?.rows || [];
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  return (
    <div className="page">
      <PageHead title="Avvisi" icon="alert" sub="Banner a tempo in evidenza nella home di chi è nel pubblico" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuovo avviso</button>} />
      <SubNav />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton /></div>}
        {unavailable && <Coming what="La gestione degli avvisi" />}
        {error && !unavailable && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="check" title="Nessun avviso attivo">Crea un avviso per segnalare chiusure, manutenzioni o urgenze.</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Titolo</th><th>Gravità</th><th>Pubblico</th><th>Periodo</th><th></th></tr></thead><tbody>
          {rows.map((n) => <tr key={n.id}><td><div className="strong">{n.title}</div>{n.body && <div className="small muted clamp2">{n.body}</div>}</td><td><Badge tone={n.severity === 'CRIT' ? 'red' : n.severity === 'WARN' ? 'amber' : 'blue'}>{SEVERITY[n.severity]}</Badge></td><td className="small">{audienceLabel(n.audience)}</td><td className="small nowrap">{fmtDateTime(n.starts_at)}<br />{n.ends_at ? fmtDateTime(n.ends_at) : 'senza scadenza'}</td><td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(n)}><Icon name="edit" /></button><button className="iconbtn danger" aria-label="Elimina" onClick={() => setDel(n)}><Icon name="trash" /></button></td></tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <NoticeModal item={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
      {del && <ConfirmModal title="Eliminare l'avviso?" text={`"${del.title}" sparirà dalla home.`} confirmText="Elimina" danger onConfirm={async () => { await api.del(`/community/manage/notices/${del.id}`); reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}

// ---------- Frasi del giorno ----------
const QSTATUS = { PROPOSED: ['Proposte', 'mauve'], APPROVED: ['Approvate', 'green'], PUBLISHED: ['Pubblicate', 'teal'], REJECTED: ['Rifiutate', 'grey'] };

function QuotesManage() {
  const { cfg } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('PROPOSED');
  const { data, loading, unavailable, error, reload } = useApi(`/community/manage/quotes?status=${status}`, [status]);
  const rows = Array.isArray(data) ? data : data?.rows || [];
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const setQ = async (q, body) => { try { await api.put(`/community/manage/quotes/${q.id}`, body); reload(); } catch (e) { toast(e, 'err'); } };
  const generate = async () => { setBusy(true); try { const r = await api.post('/community/manage/quotes/generate', { n: 5 }); toast(`Generate ${r?.count ?? r?.length ?? 'nuove'} proposte`); setStatus('PROPOSED'); reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return (
    <div className="page">
      <PageHead title="Frasi del giorno" icon="quote" sub="Proposte ispirate ai valori aziendali, da approvare prima della pubblicazione"
        actions={<>{cfg.aiEnabled && <button className="btn" disabled={busy} onClick={generate}><Icon name="sparkle" />Genera con Claude</button>}<button className="btn ghost" onClick={() => setEdit({ text: '', author_label: '' })}><Icon name="plus" />Scrivi una frase</button></>} />
      <SubNav />
      <Tabs value={status} onChange={setStatus} items={Object.entries(QSTATUS).map(([k, [l]]) => ({ value: k, label: l }))} />
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton /></div>}
        {unavailable && <Coming what="La gestione delle frasi" />}
        {error && !unavailable && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="quote" title={`Nessuna frase ${QSTATUS[status][0].toLowerCase()}`}>{status === 'PROPOSED' && cfg.aiEnabled ? 'Usa "Genera con Claude" per avere nuove proposte.' : 'Le frasi compariranno qui.'}</Empty>}
        <div className="list">{rows.map((q) => (
          <div key={q.id} className="it" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontStyle: 'italic', fontSize: 15 }}>{q.text}</div><div className="m">{q.author_label}{q.theme && !(q.author_label || '').includes(q.theme) ? ` · ${q.theme}` : ''}{q.for_date ? ` · in programma il ${fmtDate(q.for_date)}` : ''}</div></div>
            <div className="row tight">
              {status !== 'PUBLISHED' && <button className="iconbtn" aria-label="Modifica" onClick={() => setEdit(q)}><Icon name="edit" /></button>}
              {status !== 'APPROVED' && status !== 'PUBLISHED' && <button className="btn sm" onClick={() => setQ(q, { status: 'APPROVED' })}><Icon name="check" />Approva</button>}
              {status !== 'REJECTED' && status !== 'PUBLISHED' && <button className="btn sm ghost" onClick={() => setQ(q, { status: 'REJECTED' })}>Rifiuta</button>}
            </div>
          </div>
        ))}</div>
      </Card>
      {edit && (
        <Modal title={edit.id ? 'Modifica frase' : 'Nuova frase'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={async () => { try { if (edit.id) await api.put(`/community/manage/quotes/${edit.id}`, { text: edit.text }); else await api.post('/community/manage/quotes', { text: edit.text, author_label: edit.author_label }); setEdit(null); reload(); } catch (e) { toast(e, 'err'); } }}>Salva</button></>}>
          <Field label="Testo"><textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} autoFocus /></Field>
          {!edit.id && <Field label="Etichetta autore" help="Autore della citazione, per esempio: Seneca. Per una frase della rete: Toscana Diagnostica"><input value={edit.author_label || ''} onChange={(e) => setEdit({ ...edit, author_label: e.target.value })} /></Field>}
        </Modal>
      )}
    </div>
  );
}

export default function CommunityManage() {
  const { user } = useAuth();
  if (!canManageComm(user)) return <Forbidden />;
  return (
    <Routes>
      <Route index element={<ContentTable />} />
      <Route path="news/:id" element={<Editor />} />
      <Route path="news/:id/acks" element={<Acks />} />
      <Route path="notices" element={<NoticesManage />} />
      <Route path="quotes" element={<QuotesManage />} />
    </Routes>
  );
}
