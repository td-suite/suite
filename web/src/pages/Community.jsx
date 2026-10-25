import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, canManageComm } from '../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, Coming, ErrorBox, PageHead, Field, Modal, useToast, Tabs } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import Markdown from '../components/Markdown.jsx';
import Board from '../components/community/Board.jsx';
import { QuoteCard } from '../components/community/Cards.jsx';
import CommunityManage from './CommunityManage.jsx';
import { fmtDate, fmtDateTime, fmtTime, capitalize, NEWS_KIND, EVENT_KIND, SEVERITY } from '../format.js';
import { NotFound } from './Misc.jsx';

// ---------- Bacheca completa ----------
function BoardPage() {
  const sites = useApi('/sites');
  const [site, setSite] = useState('');
  return (
    <div className="page narrow">
      <PageHead title="Bacheca" icon="comment" sub="Le novità e le conversazioni della rete Toscana Diagnostica"
        actions={<Field label="Sede"><select value={site} onChange={(e) => setSite(e.target.value)} style={{ minWidth: 200 }}><option value="">Tutte le sedi</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>} />
      <Board full siteId={site} />
    </div>
  );
}

// ---------- Elenco news / circolari / blog ----------
function NewsList({ kind: fixedKind }) {
  const [sp, setSp] = useSearchParams();
  const kind = fixedKind || sp.get('kind') || '';
  const page = Number(sp.get('page') || 1);
  const { data, loading, error, unavailable } = useApi(`/community/news${qs({ kind, page })}`, [kind, page]);
  const rows = Array.isArray(data) ? data : data?.rows || [];
  const titles = { CIRCOLARE: ['Circolari', 'Comunicazioni ufficiali con protocollo e presa visione'], BLOG: ['Blog', 'Articoli e approfondimenti, anche per le vetrine pubbliche'], NEWS: ['News', 'Le novità della rete'] };
  const [t, s] = titles[kind] || ['News e comunicazioni', 'Tutte le pubblicazioni visibili al tuo profilo'];
  return (
    <div className="page">
      <PageHead title={t} icon={kind === 'CIRCOLARE' ? 'file' : kind === 'BLOG' ? 'edit' : 'news'} sub={s} />
      {!fixedKind && <Tabs value={kind} onChange={(k) => setSp(k ? { kind: k } : {})} items={[{ value: '', label: 'Tutte' }, { value: 'NEWS', label: 'News' }, { value: 'CIRCOLARE', label: 'Circolari' }, { value: 'BLOG', label: 'Blog' }]} />}
      {loading && <div className="news-grid">{[1, 2, 3].map((i) => <Card key={i}><Skeleton lines={3} /></Card>)}</div>}
      {unavailable && <Card><Coming what="L'archivio delle pubblicazioni" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {data && !rows.length && <Empty icon="news" title={kind === 'CIRCOLARE' ? 'Nessuna circolare pubblicata' : 'Nessuna pubblicazione'}>Quando la Comunicazione pubblicherà qualcosa, lo troverai qui.</Empty>}
      <div className="news-grid">
        {rows.map((n) => (
          <Link key={n.id} to={`/community/news/${n.slug}`} className="card news-card">
            <div className="cov" style={{ background: n.kind === 'BLOG' ? 'var(--mauve-700)' : n.kind === 'CIRCOLARE' ? 'var(--jet)' : 'var(--teal)' }}>
              {n.cover_file_id ? <img src={`/api/files/${n.cover_file_id}`} alt="" loading="lazy" /> : <Icon name={n.kind === 'BLOG' ? 'edit' : n.kind === 'CIRCOLARE' ? 'file' : 'news'} />}
            </div>
            <div className="in">
              <div className="row tight"><Badge tone={n.kind === 'CIRCOLARE' ? 'mauve' : n.kind === 'BLOG' ? 'amber' : 'teal'}>{NEWS_KIND[n.kind] || n.kind}</Badge>{n.requires_ack && (n.acked ? <Badge tone="green">Letta</Badge> : <Badge tone="red">Da leggere</Badge>)}</div>
              <h2>{n.title}</h2>
              {n.summary && <div className="sum clamp3">{n.summary}</div>}
              <div className="meta">{n.protocol && <span className="mono">{n.protocol}</span>}<span>{fmtDate(n.published_at)}</span>{n.tags?.length > 0 && <span>{n.tags.slice(0, 3).join(', ')}</span>}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- Articolo ----------
function Article() {
  const { slug } = useParams();
  const { data, loading, error, unavailable, reload } = useApi(`/community/news/${encodeURIComponent(slug)}`, [slug]);
  const toast = useToast();
  const [acked, setAcked] = useState(false);
  useEffect(() => { if (data?.title) document.title = `${data.title} · Suite TD`; return () => { document.title = 'Suite TD'; }; }, [data]);
  const ack = async () => { try { await api.post(`/community/news/${data.id}/ack`); setAcked(true); toast('Presa visione registrata'); reload(); } catch (e) { toast(e, 'err'); } };
  if (loading) return <div className="page"><div className="article"><Skeleton lines={6} /></div></div>;
  if (unavailable) return <div className="page"><Card><Coming what="L'articolo" /></Card></div>;
  if (error?.status === 404) return <NotFound />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const n = data;
  const isAcked = acked || n.acked;
  return (
    <div className="page">
      <article className="article">
        <div className="crumb"><Link to={n.kind === 'CIRCOLARE' ? '/community/circolari' : n.kind === 'BLOG' ? '/community/blog' : '/community/news'}>{NEWS_KIND[n.kind] || 'News'}</Link><Icon name="chevron" /><span className="ellipsis">{n.title}</span></div>
        <div className="kicker"><Badge tone={n.kind === 'CIRCOLARE' ? 'mauve' : n.kind === 'BLOG' ? 'amber' : 'teal'}>{NEWS_KIND[n.kind] || n.kind}</Badge>{n.protocol && <span className="mono muted">{n.protocol}</span>}{n.tags?.map((t) => <span key={t} className="chip">{t}</span>)}</div>
        <h1>{n.title}</h1>
        {n.summary && <p className="lead">{n.summary}</p>}
        <div className="byline">{n.author_name && <span>di {n.author_name}</span>}<span>{fmtDateTime(n.published_at || n.created_at)}</span>{n.is_public && <Badge tone="grey">Pubblico</Badge>}</div>
        {n.cover_file_id && <img className="cover lg" src={`/api/files/${n.cover_file_id}`} alt="" />}
        <Markdown source={n.body} />
        {n.files?.length > 0 && <div className="mt2"><h3>Allegati</h3><div className="row tight mt">{n.files.map((f) => <a key={f.id} className="chip" href={`/api/files/${f.id}`}><Icon name="file" />{f.filename}</a>)}</div></div>}
        {n.requires_ack && (
          <div className={`ackbox ${isAcked ? 'done' : ''}`}>
            <Icon name={isAcked ? 'check' : 'eye'} style={{ width: 26, height: 26, color: isAcked ? 'var(--green)' : 'var(--mauve-700)' }} />
            <div style={{ flex: 1 }}>
              <div className="t">{isAcked ? 'Presa visione registrata' : 'Questa circolare richiede la presa visione'}</div>
              <div className="small muted">{isAcked ? `Confermata${n.acked_at ? ` il ${fmtDateTime(n.acked_at)}` : ''}.` : `Leggila con attenzione e conferma${n.ack_due ? ` entro il ${fmtDate(n.ack_due)}` : ''}.`}</div>
            </div>
            {!isAcked && <button className="btn mauve" onClick={ack}><Icon name="check" />Confermo la presa visione</button>}
          </div>
        )}
      </article>
    </div>
  );
}

// ---------- Avvisi ----------
function Notices() {
  const { data, loading, unavailable, error } = useApi('/community/notices');
  const rows = Array.isArray(data) ? data : data?.rows || [];
  return (
    <div className="page narrow">
      <PageHead title="Avvisi" icon="alert" sub="Comunicazioni a tempo mostrate in evidenza nella home" />
      {loading && <Card><Skeleton /></Card>}
      {unavailable && <Card><Coming what="Gli avvisi" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      {data && !rows.length && <Empty icon="check" title="Nessun avviso attivo">Tutto regolare.</Empty>}
      <div className="col">{rows.map((n) => (
        <div key={n.id} className={`notice ${n.severity}`}><Icon name={n.severity === 'INFO' ? 'info' : 'alert'} /><div><div className="t">{n.title}</div>{n.body && <div className="b">{n.body}</div>}<div className="tiny" style={{ opacity: .8, marginTop: 4 }}>{SEVERITY[n.severity]} · dal {fmtDate(n.starts_at)}{n.ends_at ? ` al ${fmtDate(n.ends_at)}` : ''}{n.link && <> · <a href={n.link}>Apri il collegamento</a></>}</div></div></div>
      ))}</div>
    </div>
  );
}

// ---------- Calendario ----------
const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function EventModal({ onClose, onSaved, date }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', kind: 'EVENTO', date: date || ymd(new Date()), time: '09:00', duration: 60, all_day: false, location: '', description: '', mine: false });
  const { user } = useAuth();
  const manager = canManageComm(user);
  const save = async (e) => {
    e.preventDefault();
    const starts = new Date(`${f.date}T${f.all_day ? '00:00' : f.time}:00`);
    const ends = f.all_day ? null : new Date(starts.getTime() + Number(f.duration) * 60000);
    try {
      await api.post('/community/events', { title: f.title, kind: f.kind, starts_at: starts.toISOString(), ends_at: ends?.toISOString() || null, all_day: f.all_day, location: f.location || null, description: f.description || null,
        audience: !manager || f.mine ? { type: 'USERS', ids: [user.id] } : { type: 'ALL' } });
      toast('Evento salvato'); onSaved(); onClose();
    } catch (e2) { toast(e2, 'err'); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <Modal title="Nuovo evento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="evform">Salva</button></>}>
      <form id="evform" onSubmit={save} className="col">
        <Field label="Titolo" required><input value={f.title} onChange={set('title')} required autoFocus /></Field>
        <div className="form-grid">
          <Field label="Tipo"><select value={f.kind} onChange={set('kind')}>{Object.entries(EVENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Data"><input type="date" value={f.date} onChange={set('date')} required /></Field>
          {!f.all_day && <Field label="Ora"><input type="time" value={f.time} onChange={set('time')} /></Field>}
          {!f.all_day && <Field label="Durata (minuti)"><input type="number" min="15" step="15" value={f.duration} onChange={set('duration')} /></Field>}
        </div>
        <label className="f inline"><input type="checkbox" checked={f.all_day} onChange={set('all_day')} />Tutto il giorno</label>
        <Field label="Luogo"><input value={f.location} onChange={set('location')} /></Field>
        <Field label="Descrizione"><textarea value={f.description} onChange={set('description')} /></Field>
        {manager && <label className="f inline"><input type="checkbox" checked={f.mine} onChange={set('mine')} />Solo per me (promemoria personale)</label>}
        {!manager && <div className="help">L'evento sarà un promemoria personale, visibile solo a te.</div>}
      </form>
    </Modal>
  );
}

function Calendar() {
  const [cur, setCur] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [sel, setSel] = useState(ymd(new Date()));
  const [modal, setModal] = useState(false);
  const from = useMemo(() => { const d = new Date(cur); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }, [cur]);
  const to = useMemo(() => { const d = new Date(from); d.setDate(d.getDate() + 42); return d; }, [from]);
  const { data, loading, unavailable, error, reload } = useApi(`/community/events?from=${from.toISOString()}&to=${to.toISOString()}`, [from.getTime()]);
  const events = Array.isArray(data) ? data : data?.rows || [];
  const byDay = useMemo(() => { const m = {}; for (const e of events) { const k = ymd(new Date(e.starts_at)); (m[k] ||= []).push(e); } return m; }, [events]);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(from); d.setDate(d.getDate() + i); return d; });
  const today = ymd(new Date());
  const selEvents = byDay[sel] || [];
  const shift = (n) => { const d = new Date(cur); d.setMonth(d.getMonth() + n); setCur(d); };
  return (
    <div className="page">
      <PageHead title="Calendario" icon="calendar" sub="Eventi, riunioni, formazione e scadenze della rete"
        actions={<><button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Mese precedente"><Icon name="back" /></button><strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{cur.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</strong><button className="btn ghost sm" onClick={() => shift(1)} aria-label="Mese successivo"><Icon name="chevron" /></button><button className="btn" onClick={() => setModal(true)}><Icon name="plus" />Nuovo evento</button></>} />
      {unavailable && <Card className="mb2"><Coming what="Il calendario condiviso" /></Card>}
      {error && !unavailable && <ErrorBox error={error} />}
      <div className="cal">
        <Card>
          <div className="cal-grid" role="grid" aria-busy={loading}>
            {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
            {days.map((d) => { const k = ymd(d); const evs = byDay[k] || []; return (
              <button key={k} type="button" className={`day ${d.getMonth() !== cur.getMonth() ? 'off' : ''} ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}`} onClick={() => setSel(k)} aria-label={`${fmtDate(d)}${evs.length ? `, ${evs.length} eventi` : ''}`} aria-pressed={k === sel}>
                <span className="n">{d.getDate()}</span>
                {evs.slice(0, 3).map((e) => <span key={e.id} className={`ev ${e.kind}`}>{e.title}</span>)}
                {evs.length > 3 && <span className="more">+{evs.length - 3} altri</span>}
                {evs.length > 0 && <span className="dots">{evs.slice(0, 3).map((e) => <i key={e.id} style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--teal)', display: 'inline-block' }} />)}</span>}
              </button>
            ); })}
          </div>
        </Card>
        <Card title={capitalize(fmtDate(new Date(sel), { weekday: 'long', day: 'numeric', month: 'long' }))} icon="calendar">
          {!selEvents.length && <Empty icon="calendar" compact title="Nessun evento in questo giorno" />}
          {selEvents.map((e) => (
            <div key={e.id} className="event">
              <div className="datebox" style={{ width: 54 }}><div className="d" style={{ fontSize: 13, padding: '8px 0' }}>{e.all_day ? 'Tutto il giorno' : fmtTime(e.starts_at)}</div></div>
              <div style={{ minWidth: 0 }}><div className="t">{e.title}</div><div className="s">{EVENT_KIND[e.kind] || e.kind}{e.location ? ` · ${e.location}` : ''}{e.site_name ? ` · ${e.site_name}` : ''}{e.ends_at && !e.all_day ? ` · fino alle ${fmtTime(e.ends_at)}` : ''}</div>{e.description && <div className="small muted mt" style={{ whiteSpace: 'pre-wrap' }}>{e.description}</div>}{e.link && <a className="small" href={e.link}>Apri il collegamento</a>}</div>
            </div>
          ))}
        </Card>
      </div>
      {modal && <EventModal date={sel} onClose={() => setModal(false)} onSaved={reload} />}
    </div>
  );
}

// ---------- Frase del giorno ----------
function QuotePage() {
  const { data, loading, unavailable } = useApi('/community/quote');
  const { user } = useAuth();
  return (
    <div className="page narrow">
      <PageHead title="Frase del giorno" icon="quote" sub="Un pensiero al giorno ispirato ai valori di Toscana Diagnostica" actions={canManageComm(user) && <Link to="/community/manage/quotes" className="btn ghost"><Icon name="edit" />Gestisci le frasi</Link>} />
      {unavailable ? <Card><Coming what="La frase del giorno" /></Card> : (!loading && !data?.text) ? <Empty icon="quote" title="Nessuna frase pubblicata oggi">La Comunicazione approva le frasi proposte prima che compaiano qui.</Empty> : <QuoteCard quote={data} loading={loading} />}
      <div className="small muted mt2">Le frasi sono proposte a partire dai valori aziendali e approvate dalla Comunicazione prima della pubblicazione.</div>
    </div>
  );
}

export default function Community() {
  return (
    <Routes>
      <Route index element={<BoardPage />} />
      <Route path="news" element={<NewsList />} />
      <Route path="circolari" element={<NewsList kind="CIRCOLARE" />} />
      <Route path="blog" element={<NewsList kind="BLOG" />} />
      <Route path="news/:slug" element={<Article />} />
      <Route path="avvisi" element={<Notices />} />
      <Route path="calendar" element={<Calendar />} />
      <Route path="quote" element={<QuotePage />} />
      <Route path="manage/*" element={<CommunityManage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
