import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, canManageComm, hasModule } from '../auth.jsx';
import { api } from '../api.js';
import { Icon } from './Icons.jsx';
import { Avatar, Popover, useTheme, useToast, Empty } from './ui.jsx';
import { timeAgo, AREA_COLORS } from '../format.js';
import { moduleFor } from '../modules/registry.js';

// Sezioni con sidebar: la chiave è il prefisso del percorso
function sectionFor(pathname, user) {
  const mod = moduleFor(pathname);
  if (mod) {
    const profile = user?.grants?.[mod.key]?.profile;
    const raw = (mod.nav || []).filter((i) => !i.profiles || (isAdmin(user) && !i.onlyProfiles) || i.profiles.includes(profile))
      .map((i) => (i.group ? i : { ...i, to: `/${mod.key}${i.to ? `/${i.to}` : ''}` }));
    // niente intestazioni di gruppo senza voci sotto
    const items = raw.filter((i, idx) => !i.group || raw.slice(idx + 1).some((n, j) => !n.group && !raw.slice(idx + 1, idx + 1 + j).some((x) => x.group)));
    return { key: mod.key, kicker: mod.kicker || 'Suite TD', title: mod.title || mod.key, color: AREA_COLORS[mod.area] || 'var(--teal)', items };
  }
  if (pathname.startsWith('/community')) {
    return {
      key: 'community', kicker: 'Suite TD', title: 'Community', color: AREA_COLORS.RETAIL_FLOW,
      items: [
        { to: '/community', icon: 'comment', label: 'Bacheca', end: true },
        { to: '/community/news', icon: 'news', label: 'News' },
        { to: '/community/circolari', icon: 'file', label: 'Circolari' },
        { to: '/community/blog', icon: 'edit', label: 'Blog' },
        { to: '/community/avvisi', icon: 'alert', label: 'Avvisi' },
        { to: '/community/calendar', icon: 'calendar', label: 'Calendario' },
        { to: '/community/quote', icon: 'quote', label: 'Frase del giorno' },
        ...(canManageComm(user) ? [{ group: 'Redazione' }, { to: '/community/manage', icon: 'megaphone', label: 'Gestione' }] : []),
      ],
    };
  }
  if (pathname.startsWith('/people')) {
    return {
      key: 'people', kicker: 'People', title: 'Rubrica', color: AREA_COLORS.PEOPLE,
      items: [
        { to: '/people', icon: 'users', label: 'Elenco', end: true },
        { to: '/people/org-chart', icon: 'tree', label: 'Organigramma' },
        { to: '/people/areas', icon: 'grid', label: 'Aree' },
      ],
    };
  }
  if (pathname.startsWith('/cockpit')) {
    return {
      key: 'cockpit', kicker: 'Direzione', title: 'Cockpit', color: AREA_COLORS.DIREZIONE,
      items: [
        { to: '/cockpit', icon: 'stats', label: 'Indicatori', end: true },
        ...(hasModule(user, 'cash') || isAdmin(user) ? [{ href: '/go/cash', icon: 'external', label: 'Cash Management' }] : []),
        ...(hasModule(user, 'finance') || isAdmin(user) ? [{ href: '/go/finance', icon: 'external', label: 'Autorizzazioni di pagamento' }] : []),
        ...(hasModule(user, 'integration') || isAdmin(user) ? [{ href: '/go/integration', icon: 'external', label: 'Piano di integrazione' }] : []),
      ],
    };
  }
  if (pathname.startsWith('/admin')) {
    return {
      key: 'admin', kicker: 'Amministrazione', title: 'Suite TD', color: AREA_COLORS.DIREZIONE,
      items: [
        { to: '/admin', icon: 'home', label: 'Panoramica', end: true },
        { group: 'Accessi' },
        { to: '/admin/users', icon: 'users', label: 'Utenti' },
        { to: '/admin/modules', icon: 'grid', label: 'Moduli' },
        { to: '/admin/api-keys', icon: 'key', label: 'Chiavi API' },
        { group: 'Anagrafiche' },
        { to: '/admin/sites', icon: 'building', label: 'Sedi' },
        { to: '/admin/organizations', icon: 'folder', label: 'Organizzazioni' },
        { to: '/admin/people', icon: 'user', label: 'Persone' },
        { group: 'Dati' },
        { to: '/admin/legacy', icon: 'refresh', label: 'Sorgenti legacy' },
        { to: '/admin/review', icon: 'check', label: 'Riconciliazione' },
        { to: '/admin/travaso', icon: 'import', label: 'Travaso moduli' },
        { to: '/admin/imports', icon: 'import', label: 'Importazioni' },
        { group: 'Controllo' },
        { to: '/admin/audit', icon: 'shield', label: 'Audit' },
        { to: '/admin/settings', icon: 'gear', label: 'Impostazioni' },
      ],
    };
  }
  return null;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, rows: [] });
  const toast = useToast();
  const navigate = useNavigate();
  const load = useCallback(() => api.get('/notifications', { silent: true }).then(setData).catch(() => {}), []);
  useEffect(() => { load(); const iv = setInterval(load, 90000); return () => clearInterval(iv); }, [load]);
  const readAll = async () => { try { await api.post('/notifications/read', { all: true }); load(); } catch (e) { toast(e, 'err'); } };
  const openOne = async (n) => {
    setOpen(false);
    if (!n.read_at) api.post('/notifications/read', { ids: [n.id] }, { silent: true }).then(load).catch(() => {});
    if (n.link) { if (/^https?:/.test(n.link) || n.link.startsWith('/go/')) window.location.href = n.link; else navigate(n.link); }
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="topbtn" aria-label={`Notifiche${data.unread ? `, ${data.unread} non lette` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />{data.unread > 0 && <span className="dot">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="notif-pop">
        <div className="hd"><strong>Notifiche</strong>{data.unread > 0 && <button className="btn sm ghost" onClick={readAll}>Segna tutte come lette</button>}</div>
        <div className="list">
          {!data.rows.length && <Empty icon="bell" compact title="Nessuna notifica">Qui compariranno circolari, avvisi ed eventi che ti riguardano.</Empty>}
          {data.rows.map((n) => (
            <a key={n.id} href={n.link || '#'} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={(e) => { e.preventDefault(); openOne(n); }}>
              <Icon name={{ NEWS: 'news', CIRCOLARE: 'file', AVVISO: 'alert', EVENTO: 'calendar', MODULO: 'grid' }[n.kind] || 'info'} />
              <div><div className="t">{n.title}</div>{n.body && <div className="b clamp2">{n.body}</div>}<div className="when">{timeAgo(n.created_at)}</div></div>
            </a>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export function TopBar({ onMenu, hasSide }) {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {hasSide && <button className="topbtn side-toggle" onClick={onMenu} aria-label="Apri il menu della sezione"><Icon name="menu" /></button>}
      <Link to="/" className="brand" aria-label="Home Suite TD"><img src="/logo-light.svg" alt="Toscana Diagnostica" /><span className="app-name">Suite</span></Link>
      <div className="mid">
        <button className="mini-search" onClick={() => navigate('/search')} aria-label="Ricerca globale"><Icon name="search" /><span>Cerca in Toscana Diagnostica</span><kbd>/</kbd></button>
      </div>
      <div className="tools">
        <Link to="/" className="topbtn" aria-label="Home"><Icon name="home" /></Link>
        <Notifications />
        <button className="topbtn" onClick={toggle} aria-label={isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'}><Icon name={isDark ? 'sunLight' : 'moon'} /></button>
        <div style={{ position: 'relative' }}>
          <button className="topbtn me" onClick={() => setMenu(!menu)} aria-label="Menu utente" aria-expanded={menu}><Avatar name={user.full_name} fileId={user.avatar_file_id} /></button>
          <Popover open={menu} onClose={() => setMenu(false)}>
            <div className="who"><div className="name">{user.full_name}</div><div className="small muted">{user.email}</div></div>
            <Link to="/profile" onClick={() => setMenu(false)}><Icon name="user" />Profilo</Link>
            {isAdmin(user) && <Link to="/admin" onClick={() => setMenu(false)}><Icon name="shield" />Amministrazione</Link>}
            <button className="item" onClick={logout}><Icon name="logout" />Esci</button>
          </Popover>
        </div>
      </div>
    </header>
  );
}

export default function Shell() {
  const { user } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const section = sectionFor(loc.pathname, user);
  useEffect(() => setOpen(false), [loc.pathname]);
  // Scorciatoia: "/" apre la ricerca
  const navigate = useNavigate();
  useEffect(() => {
    const k = (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate('/search'); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [navigate]);
  return (
    <div className="app">
      <TopBar onMenu={() => setOpen(!open)} hasSide={Boolean(section)} />
      <div className="app-body">
        {section && <>
          <div className={`scrim ${open ? 'on' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className={`side ${open ? 'open' : ''}`} aria-label={`Menu ${section.title}`}>
            <div className="sect"><div className="k">{section.kicker}</div><div className="t"><i style={{ background: section.color }} />{section.title}</div></div>
            <nav>
              {section.items.map((it, i) => it.group ? <div key={i} className="group">{it.group}</div>
                : it.href ? <a key={it.href} href={it.href}><Icon name={it.icon} />{it.label}</a>
                : <NavLink key={it.to} to={it.to} end={it.end}><Icon name={it.icon} />{it.label}</NavLink>)}
            </nav>
            <div className="foot"><Link to="/"><Icon name="back" />Torna alla Home</Link></div>
          </aside>
        </>}
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
