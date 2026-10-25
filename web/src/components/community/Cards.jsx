import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, isUnavailable } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Coming, Empty, Skeleton, Badge, useToast, useApi, DropZone } from '../ui.jsx';
import { Icon, weatherIcon } from '../Icons.jsx';
import { fmtDate, fmtTime, fmtBytes, fileIcon, timeAgo } from '../../format.js';

// Stato comune: loading → skeleton; unavailable → "in arrivo"; vuoto → messaggio dedicato
function Body({ loading, unavailable, empty, emptyIcon, emptyTitle, emptyText, what, children }) {
  if (loading) return <div style={{ padding: '14px 18px' }}><Skeleton lines={3} /></div>;
  if (unavailable) return <Coming what={what} />;
  if (empty) return <Empty icon={emptyIcon} title={emptyTitle} compact>{emptyText}</Empty>;
  return children;
}

export function CircolariCard({ rows, loading, unavailable, onAck }) {
  const toast = useToast();
  const [done, setDone] = useState({});
  const ack = async (n) => {
    try { await api.post(`/community/news/${n.id}/ack`); setDone((d) => ({ ...d, [n.id]: true })); toast('Presa visione registrata'); onAck?.(n); } catch (e) { toast(e, 'err'); }
  };
  const list = (rows || []).filter((n) => !done[n.id]);
  return (
    <Card title="Circolari da leggere" icon="file" flush actions={<Link to="/community/circolari" className="small">Tutte</Link>}>
      <Body loading={loading} unavailable={unavailable} what="Le circolari" empty={!list.length} emptyIcon="check" emptyTitle="Nessuna circolare da leggere." emptyText="Ottimo.">
        <div className="list">
          {list.map((n) => (
            <div key={n.id} className="it" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link to={`/community/news/${n.slug}`} className="t" style={{ color: 'inherit', display: 'block' }}>{n.title}</Link>
                <div className="m">{n.protocol && <span className="mono">{n.protocol} · </span>}{n.ack_due ? `entro il ${fmtDate(n.ack_due)}` : fmtDate(n.published_at)}</div>
              </div>
              <button className="btn sm mauve" onClick={() => ack(n)}><Icon name="check" />Presa visione</button>
            </div>
          ))}
        </div>
      </Body>
    </Card>
  );
}

export function NewsCard({ rows, loading, unavailable }) {
  return (
    <Card title="News" icon="news" flush actions={<Link to="/community/news" className="small">Tutte</Link>}>
      <Body loading={loading} unavailable={unavailable} what="Le news" empty={!rows?.length} emptyIcon="news" emptyTitle="Nessuna news pubblicata" emptyText="Le novità della rete compariranno qui.">
        <div className="list">
          {(rows || []).slice(0, 5).map((n) => (
            <Link key={n.id} to={`/community/news/${n.slug}`} className="it">
              {n.cover_file_id ? <img className="cover" src={`/api/files/${n.cover_file_id}`} alt="" /> : <span className="cover" style={{ background: n.kind === 'BLOG' ? 'var(--mauve-700)' : 'var(--teal)' }}><Icon name={n.kind === 'BLOG' ? 'edit' : 'news'} /></span>}
              <div style={{ minWidth: 0 }}><div className="t clamp2">{n.title}</div>{n.summary && <div className="s clamp2">{n.summary}</div>}<div className="m">{fmtDate(n.published_at)}</div></div>
            </Link>
          ))}
        </div>
      </Body>
    </Card>
  );
}

export function CalendarCard({ rows, loading, unavailable }) {
  return (
    <Card title="Prossimi 7 giorni" icon="calendar" flush actions={<Link to="/community/calendar" className="small">Calendario</Link>}>
      <Body loading={loading} unavailable={unavailable} what="Il calendario" empty={!rows?.length} emptyIcon="calendar" emptyTitle="Settimana libera da eventi" emptyText="Riunioni, formazione e scadenze compariranno qui.">
        <div className="list">
          {(rows || []).slice(0, 6).map((e) => {
            const d = new Date(e.starts_at);
            return (
              <Link key={e.id} to="/community/calendar" className="it">
                <div className="datebox"><div className="d">{d.getDate()}</div><div className="mth">{d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')}</div></div>
                <div style={{ minWidth: 0 }}><div className="t">{e.title}</div><div className="s">{e.all_day ? 'Tutto il giorno' : fmtTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}{e.site_name ? ` · ${e.site_name}` : ''}</div></div>
              </Link>
            );
          })}
        </div>
      </Body>
    </Card>
  );
}

export function WeatherCard({ data, loading, unavailable, siteName }) {
  const now = data?.now;
  return (
    <Card title={`Meteo${data?.site?.name ? ` · ${data.site.name}` : data?.city ? ` · ${data.city}` : siteName ? ` · ${siteName}` : ''}`} icon="cloud-sun">
      <Body loading={loading} unavailable={unavailable} what="Il meteo per sede" empty={!now} emptyIcon="cloud" emptyTitle="Meteo non disponibile al momento" emptyText="Il servizio meteo non risponde: riprova più tardi.">
        {now && (
          <>
            <div className="weather-now">
              <Icon name={weatherIcon(now.code)} title={now.label} />
              <div><div className="temp">{Math.round(now.temp)}°</div><div className="lbl">{now.label}{data.today ? ` · min ${Math.round(data.today.min)}° max ${Math.round(data.today.max)}°` : ''}</div></div>
            </div>
            {data.days?.length > 0 && (
              <div className="weather-days">
                {data.days.slice(0, 5).map((d) => (
                  <div key={d.date} className="d"><div className="n">{new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '')}</div><Icon name={weatherIcon(d.code)} title={d.label} /><div className="mm">{Math.round(d.max)}° <span>{Math.round(d.min)}°</span></div></div>
                ))}
              </div>
            )}
          </>
        )}
      </Body>
    </Card>
  );
}

export function QuoteCard({ quote, loading, unavailable }) {
  if (loading) return <Card title="Frase del giorno" icon="quote"><Skeleton lines={2} /></Card>;
  if (unavailable || !quote?.text) return null;
  return (
    <Card title="Frase del giorno" icon="quote" className="silk">
      <blockquote className="quote" style={{ margin: 0 }}>{quote.text}</blockquote>
      {quote.author_label && <div className="quote-author">{quote.author_label}</div>}
    </Card>
  );
}

export function FilesCard() {
  const { cfg } = useAuth();
  const toast = useToast();
  const { data, loading, unavailable, reload } = useApi(cfg.blobEnabled ? '/files/mine' : null);
  if (!cfg.blobEnabled) return null;
  const upload = async (files) => {
    for (const f of files) {
      try { const fd = new FormData(); fd.append('file', f); await api.upload('/files/upload?scope=PERSONAL', fd); } catch (e) { toast(e, 'err'); }
    }
    toast('File caricati'); reload();
  };
  const rows = (data?.rows || []).slice(0, 5);
  return (
    <Card title="Cartella personale" icon="folder" flush actions={<Link to="/files" className="small">Apri</Link>}>
      <Body loading={loading} unavailable={unavailable} what="La cartella personale" empty={false}>
        {rows.length > 0 && <div className="list">{rows.map((f) => (
          <a key={f.id} href={`/api/files/${f.id}`} className="it" style={{ alignItems: 'center' }}><span className="fi" style={{ color: 'var(--teal)' }}><Icon name={fileIcon(f.mime, f.filename)} /></span><div style={{ minWidth: 0 }}><div className="t ellipsis">{f.filename}</div><div className="m">{fmtBytes(f.size)} · {timeAgo(f.created_at)}</div></div></a>
        ))}</div>}
        <div style={{ padding: 12 }}><DropZone onFiles={upload} compact /></div>
      </Body>
    </Card>
  );
}

export function PeopleQuick() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  return (
    <Card title="Rubrica" icon="users">
      <form onSubmit={(e) => { e.preventDefault(); navigate(`/people?qtext=${encodeURIComponent(q.trim())}`); }} className="row tight">
        <div className="search-input" style={{ flex: 1 }}><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Trova un collega" aria-label="Trova un collega" /></div>
        <button className="btn" type="submit" aria-label="Cerca nella rubrica"><Icon name="arrowRight" /></button>
      </form>
      <div className="small muted mt">Nome, ruolo, area o sede. Dalla scheda puoi scrivere su Teams o inviare un'email.</div>
    </Card>
  );
}

export function BirthdaysCard({ rows }) {
  if (!rows?.length) return null;
  return (
    <Card title="Compleanni" icon="birthday" flush>
      <div className="list">{rows.map((b, i) => <div key={i} className="it"><div><div className="t">{b.full_name || `${b.last_name} ${b.first_name}`}</div><div className="m">{b.date ? fmtDate(b.date, { day: 'numeric', month: 'long' }) : 'oggi'}</div></div></div>)}</div>
    </Card>
  );
}
