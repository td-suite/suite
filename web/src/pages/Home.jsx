import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isExternal, hasModule } from '../auth.jsx';
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
  const external = isExternal(user);   // accesso esterno: niente composer in bacheca, niente organigramma, ricerca nel proprio perimetro
  const grantKeys = Object.keys(user?.grants || {}).sort().join(',');   // cambia quando un amministratore assegna o toglie un modulo
  const modules = useApi('/home/modules', [grantKeys, user?.level]);
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
  // Meteo della sede da cui si apre la Suite: posizione del browser (se concessa) → sede più vicina; altrimenti la sede del profilo
  const [geoWeather, setGeoWeather] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => api.get(`/community/weather?lat=${pos.coords.latitude.toFixed(4)}&lng=${pos.coords.longitude.toFixed(4)}`, { silent: true }).then((w) => alive && w?.now && setGeoWeather(w)).catch(() => {}),
      () => {}, { timeout: 8000, maximumAge: 30 * 60_000 },
    );
    return () => { alive = false; };
  }, []);
  const weather = geoWeather || h.weather;
  const weatherSite = weather?.site?.name || weather?.city || user.site_name;
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
              <h1>{greeting(now)}, {user.first_name || firstName(user.full_name)}</h1>
              <div className="date">{capitalize(fmtDateLong(now))} · {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <Link to={user.site_name ? '/community/calendar' : '/profile'} className="where" aria-label="Meteo e sede">
              {weather?.now ? <Icon name={weatherIcon(weather.now.code)} title={weather.now.label} /> : <Icon name="pin" />}
              <div>
                {weather?.now ? <div className="temp">{Math.round(weather.now.temp)}°<span>{weather.now.label}</span></div> : <div className="temp"><span>{user.site_name ? 'Meteo in arrivo' : 'Sede non impostata'}</span></div>}
                <div className="site">{weatherSite || 'Imposta la tua sede dal profilo'}{weather?.today ? ` · min ${Math.round(weather.today.min)}° max ${Math.round(weather.today.max)}°` : ''}</div>
              </div>
            </Link>
          </div>

          <form className="hero-search" onSubmit={submit} role="search">
            <Icon name="search" className="lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={external ? 'Cerca: circolari, contatti di riferimento, le tue sedi' : 'Cerca in tutta Toscana Diagnostica: persone, sedi, circolari, procedure, moduli'} aria-label="Cerca nella Suite" />
            <button type="submit" className="btn primary"><Icon name="arrowRight" /><span>Cerca</span></button>
          </form>
          <div className="hero-hint">{external ? 'Puoi chiedere in linguaggio naturale: "quali circolari devo ancora leggere?", "a chi scrivo per una non conformità?"' : 'Puoi chiedere in linguaggio naturale: "quali circolari devo ancora leggere?", "chi è il site manager di Calenzano?"'}</div>

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

        {/* Sezioni per area su una griglia a 5 colonne: un'area occupa tante colonne quante le sue tessere, così due aree piccole stanno sulla stessa riga */}
        <section className="dash" aria-label="I tuoi strumenti">
          {modules.loading && <div className="tiles" aria-busy="true">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="widget" style={{ cursor: 'default' }}><Skeleton block /></div>)}</div>}
          {modules.error && <Empty icon="alert" title="Impossibile caricare i moduli">{modules.error.message}</Empty>}
          {modules.data?.areas?.map((a) => {
            const color = areaColor(a.key, a.color);
            const live = a.modules.reduce((n, m) => n + (Number(counters?.[m.key]?.value) > 0 ? 1 : 0), 0);
            return (
              <section key={a.key} className="area" style={{ '--area': color, '--n': Math.min(a.modules.length, 5) }} aria-label={a.name}>
                <div className="area-head"><i /><h2>{a.name}</h2><span className="meta">{a.modules.length} {a.modules.length === 1 ? 'strumento' : 'strumenti'}{live ? ` · ${live} con novità` : ''}</span></div>
                <div className="tiles">
                  {a.modules.map((m) => <Widget key={m.key} module={m} areaColor={color} areaKey={a.key} counter={counters?.[m.key]} countersLoading={countersLoading} profileLabel={profileLabels[`${m.key}:${m.profile}`]} />)}
                </div>
              </section>
            );
          })}
          {modules.data && !modules.data.areas?.length && <Empty icon="grid" title="Nessun modulo assegnato">Il tuo profilo non ha ancora widget attivi. L'amministrazione può abilitarli dalla sezione Utenti.</Empty>}
        </section>

        {/* Community: griglia ordinata a 12 colonne. Bacheca a sinistra su due righe; a destra Circolari, Calendario, News, Meteo;
            terza riga Frase del giorno, Rubrica, Compleanni, Cartella personale */}
        <div className="section-title"><Icon name="comment" /><h2>Community</h2><span className="sub">La vita della rete, oggi</span><div className="spacer" /><Link to="/community" className="btn ghost sm">Apri la bacheca<Icon name="arrowRight" /></Link></div>
        <div className="community-grid">
          <div className="cg cg-3"><CircolariCard rows={h.circolari_da_leggere} loading={home.loading} unavailable={home.unavailable} /></div>
          <div className="cg cg-3"><CalendarCard rows={h.events} loading={home.loading} unavailable={home.unavailable} /></div>
          <div className="cg cg-3"><NewsCard rows={h.news} loading={home.loading} unavailable={home.unavailable} /></div>
          <div className="cg cg-3"><WeatherCard data={weather} loading={home.loading} unavailable={home.unavailable} siteName={weatherSite} /></div>
          <div className="cg cg-8"><Board limit={5} readOnly={external} initialPosts={home.data && Array.isArray(h.posts) ? h.posts : undefined} /></div>
          <div className="cg cg-4 cg-stack">
            <QuoteCard quote={h.quote} loading={home.loading} unavailable={home.unavailable} />
            {(!external || hasModule(user, 'rubrica')) && <PeopleQuick external={external} />}
            {!external && <BirthdaysCard rows={h.birthdays} />}
            {!external && <FilesCard />}
          </div>
        </div>
      </div>
    </div>
  );
}
