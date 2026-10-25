import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Skeleton, Badge, Empty } from '../components/ui.jsx';
import { Icon, weatherIcon } from '../components/Icons.jsx';
import Widget from '../components/Widget.jsx';
import Board from '../components/community/Board.jsx';
import { CircolariCard, NewsCard, CalendarCard, WeatherCard, QuoteCard, FilesCard, PeopleQuick, BirthdaysCard } from '../components/community/Cards.jsx';
import { greeting, firstName, fmtDateLong, capitalize, SEVERITY, areaColor } from '../format.js';

function NoticeBanner({ n }) {
  const inner = <><Icon name={n.severity === 'CRIT' ? 'alert' : n.severity === 'WARN' ? 'alert' : 'info'} /><div><div className="t">{n.title}</div>{n.body && <div className="b">{n.body}</div>}</div><div className="spacer" /><Badge tone={n.severity === 'CRIT' ? 'red' : n.severity === 'WARN' ? 'amber' : 'blue'}>{SEVERITY[n.severity] || n.severity}</Badge></>;
  if (n.link) return /^https?:/.test(n.link) ? <a className={`notice ${n.severity}`} href={n.link} target="_blank" rel="noopener noreferrer">{inner}</a> : <Link className={`notice ${n.severity}`} to={n.link}>{inner}</Link>;
  return <div className={`notice ${n.severity}`} role="status">{inner}</div>;
}

// Indicatori vivi nella fascia superiore: ciò che richiede attenzione oggi
function Pulse({ icon, value, label, to, tone, loading }) {
  const navigate = useNavigate();
  return (
    <button type="button" className={`pulse ${tone || ''}`} onClick={() => to && navigate(to)} aria-label={`${label}: ${value ?? ''}`}>
      <Icon name={icon} />
      <div>
        <div className="v">{loading ? <span className="sk-inline" /> : (value ?? 0)}</div>
        <div className="l">{label}</div>
      </div>
    </button>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const modules = useApi('/home/modules');
  const home = useApi('/community/home');
  const notif = useApi('/notifications');
  const [counters, setCounters] = useState(null);
  const [countersLoading, setCountersLoading] = useState(true);
  const [q, setQ] = useState('');
  const mods = useApi('/modules');
  const profileLabels = useMemo(() => {
    const map = {};
    for (const m of mods.data || []) for (const p of m.profiles || []) map[`${m.key}:${p.key}`] = p.label;
    return map;
  }, [mods.data]);

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/home/counters', { silent: true }).then((c) => alive && setCounters(c || {})).catch(() => alive && setCounters({})).finally(() => alive && setCountersLoading(false));
    load();
    const t = setInterval(load, 5 * 60_000);     // contatori aggiornati ogni 5 minuti: la pagina resta aperta tutto il giorno
    return () => { alive = false; clearInterval(t); };
  }, []);

  const h = home.data || {};
  const weather = h.weather;
  const now = useClock();
  const todayKey = now.toLocaleDateString('sv-SE');
  const eventsToday = (h.events || []).filter((e) => String(e.starts_at || '').slice(0, 10) === todayKey).length;
  const totalWidgets = (modules.data?.areas || []).reduce((n, a) => n + a.modules.length, 0);
  const submit = (e) => { e.preventDefault(); const s = q.trim(); if (s) navigate(`/search?q=${encodeURIComponent(s)}`); };

  return (
    <div className="home">
      {/* Fascia superiore: saluto, meteo, indicatori, ricerca */}
      <section className="hero" aria-label="Riepilogo di oggi">
        <div className="hero-inner">
          <div className="hero-top">
            <div className="hello">
              <h1>{greeting(now)}, {firstName(user.full_name)}</h1>
              <div className="date">{capitalize(fmtDateLong(now))} · {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <Link to={user.site_name ? '/community/calendar' : '/profile'} className="where" aria-label="Meteo e sede">
              {weather?.now ? <Icon name={weatherIcon(weather.now.code)} title={weather.now.label} /> : <Icon name="pin" />}
              <div>
                {weather?.now ? <div className="temp">{Math.round(weather.now.temp)}°<span>{weather.now.label}</span></div> : <div className="temp"><span>{user.site_name ? 'Meteo in arrivo' : 'Sede non impostata'}</span></div>}
                <div className="site">{user.site_name || weather?.city || 'Imposta la tua sede dal profilo'}{weather?.today ? ` · min ${Math.round(weather.today.min)}° max ${Math.round(weather.today.max)}°` : ''}</div>
              </div>
            </Link>
          </div>

          <form className="hero-search" onSubmit={submit} role="search">
            <Icon name="search" className="lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca in tutta Toscana Diagnostica: persone, sedi, circolari, procedure, moduli" aria-label="Cerca nella Suite" />
            <button type="submit" className="btn primary"><Icon name="arrowRight" /><span>Cerca</span></button>
          </form>
          <div className="hero-hint">Puoi chiedere in linguaggio naturale: "quali circolari devo ancora leggere?", "chi è il site manager di Calenzano?"</div>

          <div className="pulses">
            <Pulse icon="bell" value={notif.data?.unread} label="notifiche da leggere" to="/community" tone={notif.data?.unread ? 'hot' : ''} loading={notif.loading} />
            <Pulse icon="news" value={h.circolari_da_leggere?.length} label="circolari da confermare" to="/community/news?kind=CIRCOLARE" tone={h.circolari_da_leggere?.length ? 'hot' : ''} loading={home.loading} />
            <Pulse icon="calendar" value={eventsToday} label={eventsToday === 1 ? 'evento oggi' : 'eventi oggi'} to="/community/calendar" loading={home.loading} />
            <Pulse icon="comment" value={h.posts?.length} label="novità in bacheca" to="/community" loading={home.loading} />
            <Pulse icon="grid" value={totalWidgets} label={totalWidgets === 1 ? 'strumento attivo' : 'strumenti attivi'} loading={modules.loading} />
          </div>
        </div>
      </section>

      <div className="page home-body">
        {h.notices?.length > 0 && <div className="notices">{h.notices.map((n) => <NoticeBanner key={n.id} n={n} />)}</div>}

        {/* Widget per area, centrati */}
        <section className="dash" aria-label="I tuoi strumenti">
          {modules.loading && <div className="widgets" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="widget" style={{ cursor: 'default' }}><Skeleton block /></div>)}</div>}
          {modules.error && <Empty icon="alert" title="Impossibile caricare i moduli">{modules.error.message}</Empty>}
          {modules.data?.areas?.map((a) => (
            <section key={a.key} className="area" style={{ '--area': areaColor(a.key, a.color) }} aria-label={a.name}>
              <div className="area-title"><i /><h2>{a.name}</h2><i /></div>
              <div className="widgets">
                {a.modules.map((m) => <Widget key={m.key} module={m} areaColor={areaColor(a.key, a.color)} areaKey={a.key} counter={counters?.[m.key]} countersLoading={countersLoading} profileLabel={profileLabels[`${m.key}:${m.profile}`]} />)}
              </div>
            </section>
          ))}
          {modules.data && !modules.data.areas?.length && <Empty icon="grid" title="Nessun modulo assegnato">Il tuo profilo non ha ancora widget attivi. L'amministrazione può abilitarli dalla sezione Utenti.</Empty>}
        </section>

        {/* Community: tre colonne */}
        <div className="section-title center"><Icon name="comment" /><h2>Community</h2><span className="sub">La vita della rete, oggi</span></div>
        <div className="community3">
          <div className="col">
            <Board limit={6} initialPosts={home.data && Array.isArray(h.posts) ? h.posts : undefined} />
            <div className="row end"><Link to="/community" className="btn ghost">Apri la bacheca completa<Icon name="arrowRight" /></Link></div>
          </div>
          <div className="col">
            <CircolariCard rows={h.circolari_da_leggere} loading={home.loading} unavailable={home.unavailable} />
            <NewsCard rows={h.news} loading={home.loading} unavailable={home.unavailable} />
            <CalendarCard rows={h.events} loading={home.loading} unavailable={home.unavailable} />
            <PeopleQuick />
          </div>
          <div className="col">
            <QuoteCard quote={h.quote} loading={home.loading} unavailable={home.unavailable} />
            <WeatherCard data={weather} loading={home.loading} unavailable={home.unavailable} siteName={user.site_name} />
            <BirthdaysCard rows={h.birthdays} />
            <FilesCard />
          </div>
        </div>
      </div>
    </div>
  );
}
