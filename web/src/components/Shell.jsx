import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, isExternal, canManageComm } from '../auth.jsx';
import { api } from '../api.js';
import { Icon } from './Icons.jsx';
import { Avatar, Popover, useTheme, useToast, Empty } from './ui.jsx';
import { timeAgo, AREA_COLORS } from '../format.js';
import { moduleFor, vociModulo } from '../modules/registry.js';
import InformativeIcone from './Informative.jsx';
import { impostaVista } from '../lib/vediCome.js';

// Le voci replicate per linea (Business Hub: Cruscotto, Pipeline, Clienti… con ?linea=SRV|PP|MDL) hanno lo stesso percorso: è attiva
// solo quella con la stessa linea dell'indirizzo. Una voce senza "?" si comporta come sempre.
function vocePerLinea(to, loc) {
  const q = to.split('?')[1];
  if (!q) return true;
  const voluti = new URLSearchParams(q); const attuali = new URLSearchParams(loc.search);
  return [...voluti.entries()].every(([k, v]) => attuali.get(k) === v);
}

// Sezioni con sidebar: la chiave è il prefisso del percorso
// Guida al widget (v0.89.0): la voce in fondo al menu di ogni widget apre il suo capitolo nella Guida alla Suite. Le sezioni native
// hanno una chiave diversa da quella del widget (community → comunicazione, people → rubrica).
const GUIDA_WIDGET = { community: 'comunicazione', people: 'rubrica' };

function sectionFor(pathname, user) {
  const mod = moduleFor(pathname);
  if (mod) {
    const raw = vociModulo(mod, user)
      // una voce con "?" (es. Cruscotto e Pipeline del Business Hub filtrati su una linea) porta il filtro nell'indirizzo
      .map((i) => (i.group ? i : { ...i, to: `/${mod.key}${i.to ? (i.to.startsWith('?') ? i.to : `/${i.to}`) : ''}` }));
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
    // accessi esterni: solo l'elenco dei contatti pubblici (niente organigramma né ruoli)
    return {
      key: 'people', kicker: 'People', title: isExternal(user) ? 'Contatti' : 'Rubrica', color: AREA_COLORS.PEOPLE,
      items: isExternal(user) ? [{ to: '/people', icon: 'users', label: 'Contatti di riferimento', end: true }] : [
        { to: '/people', icon: 'users', label: 'Elenco', end: true },
        { to: '/people/org-chart', icon: 'tree', label: 'Organigramma' },
        { to: '/people/ruoli', icon: 'grid', label: 'Ruoli' },
      ],
    };
  }
  if (pathname.startsWith('/cockpit')) {
    return {
      key: 'cockpit', kicker: 'Direzione', title: 'Cockpit', color: AREA_COLORS.DIREZIONE,
      // CEO, 08/11/2026: niente link ai widget dal Cockpit (si aprono dalla Home); il monitor e lo scadenzario completo
      items: [
        { to: '/cockpit', icon: 'stats', label: 'Monitor', end: true },
        { to: '/cockpit/scadenzario', icon: 'calendar', label: 'Scadenzario completo' },
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
        { to: '/admin/access-profiles', icon: 'shield', label: 'Profili di accesso' },
        { to: '/admin/modules', icon: 'grid', label: 'Moduli' },
        { to: '/admin/api-keys', icon: 'key', label: 'Chiavi API' },
        { group: 'Anagrafiche' },
        { to: '/admin/sites', icon: 'building', label: 'Sedi' },
        { to: '/admin/organizations', icon: 'folder', label: 'Legal entity' },
        { to: '/admin/people', icon: 'user', label: 'Persone' },
        { to: '/admin/organization', icon: 'grid', label: 'Organizzazione' },
        { to: '/admin/roles', icon: 'tag', label: 'Ruoli' },
        { to: '/admin/asset-types', icon: 'facility', label: 'Catalogo dispositivi' },
        { group: 'Dati' },
        { to: '/admin/legacy', icon: 'refresh', label: 'Sorgenti legacy' },
        { to: '/admin/connectors', icon: 'cloud', label: 'Connettori' },
        { to: '/admin/travaso', icon: 'import', label: 'Attivazione moduli' },
        { to: '/admin/imports', icon: 'import', label: 'Importazioni' },
        { group: 'Controllo' },
        { to: '/admin/diagnostica', icon: 'stats', label: 'Diagnostica anagrafica' },
        { to: '/admin/pulizia-allegati', icon: 'trash', label: 'Pulizia allegati' },
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
    if (n.link) { if (/^https?:/.test(n.link) || n.link.startsWith('/go/')) window.open(n.link, '_blank', 'noopener'); else navigate(n.link); }
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
      <div className="mid" />
      <div className="tools">
        <Link to="/" className="topbtn" aria-label="Home"><Icon name="home" /></Link>
        <button className="topbtn" onClick={() => navigate('/search')} aria-label="Ricerca (tasto /)" title="Ricerca · tasto /"><Icon name="search" /></button>
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

// Controllo della versione: ogni 5 minuti confronta la versione in esecuzione sul server (/api/health) con quella della build caricata
// nel browser (__APP_VERSION__); se il server è più nuovo mostra un avviso con "Aggiorna" (ricarica la pagina). Evita l'errore del
// chunk mancante dopo un rilascio e fa arrivare subito le correzioni a chi tiene la Suite aperta tutto il giorno.
function AvvisoVersione() {
  const [nuova, setNuova] = useState(null);
  useEffect(() => {
    let vivo = true;
    const controlla = async () => { try { const h = await api.get('/health'); if (vivo && h?.version && typeof __APP_VERSION__ !== 'undefined' && h.version !== __APP_VERSION__) setNuova(h.version); } catch { /* offline: niente */ } };
    const iv = setInterval(controlla, 5 * 60 * 1000); const t = setTimeout(controlla, 20000);
    return () => { vivo = false; clearInterval(iv); clearTimeout(t); };
  }, []);
  if (!nuova) return null;
  return <div className="versione-nuova" role="status"><Icon name="refresh" /><span>È disponibile la versione {nuova} della Suite.</span><button className="btn sm" onClick={() => location.reload()}>Aggiorna</button></div>;
}

// "Vedi come profilo" (solo titolare): selettore nel menu del widget e fascia in testa alla pagina mentre la vista è attiva.
// Al cambio la pagina si ricarica, così menu, stato del modulo e dati ripartono tutti con il profilo scelto.
function VediCome({ moduleKey }) {
  const { realUser, vista } = useAuth();
  const [def, setDef] = useState(null);
  const [sedi, setSedi] = useState([]);
  const [aperto, setAperto] = useState(false);
  const [f, setF] = useState({ profile: '', site_id: '' });
  const titolare = realUser?.level === 'OWNER';
  useEffect(() => {
    if (!titolare || !aperto || def?.key === moduleKey) return;
    api.get(`/vedi-come/${moduleKey}`, { silent: true }).then(setDef).catch(() => setDef({ key: moduleKey, profili: [] }));
    api.get('/sites', { silent: true }).then((s) => setSedi((Array.isArray(s) ? s : s.items || []).filter((x) => x.active !== false))).catch(() => {});
  }, [titolare, aperto, moduleKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!titolare || vista) return null;
  const avvia = async (e) => {
    e.preventDefault();
    const p = def.profili.find((x) => x.key === f.profile);
    if (!p) return;
    const sede = sedi.find((s) => String(s.id) === String(f.site_id));
    const v = { key: moduleKey, profile: p.key, label: p.label, site_id: sede ? sede.id : null, site_name: sede ? sede.name : null };
    try { await api.post('/vedi-come', v); } catch { return; }
    impostaVista(v); location.reload();
  };
  return (
    <div className="foot vedi-come">
      <button type="button" className="vc-apri" onClick={() => setAperto(!aperto)} aria-expanded={aperto} title="Guarda questo widget come lo vede un profilo, in sola lettura"><Icon name="eye" />Vedi come profilo</button>
      {aperto && def && (def.profili.length ? (
        <form onSubmit={avvia} className="vc-form">
          <select data-tendina="nativa" value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })} aria-label="Profilo"><option value="">Profilo…</option>{def.profili.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          {def.per_sede && <select data-tendina="nativa" value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} aria-label="Sede"><option value="">Nessuna sede (come senza ambito)</option>{sedi.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <button className="btn sm" disabled={!f.profile}>Apri la vista</button>
        </form>
      ) : <div className="small vc-vuoto">Questo widget non ha profili distinti.</div>)}
    </div>
  );
}
function FasciaVista() {
  const { vista } = useAuth();
  const loc = useLocation();
  // uscendo dal widget la vista si chiude da sola
  useEffect(() => { if (vista && !(loc.pathname === `/${vista.key}` || loc.pathname.startsWith(`/${vista.key}/`))) impostaVista(null); }, [vista, loc.pathname]);
  if (!vista) return null;
  return <div className="vista-profilo" role="status"><Icon name="eye" /><span>Stai guardando questo widget come <b>{vista.label}</b>{vista.site_name ? <> · sede <b>{vista.site_name}</b></> : null}. Sola lettura: nessuna modifica viene salvata.</span><button className="btn sm" onClick={() => { impostaVista(null); location.reload(); }}>Torna al tuo profilo</button></div>;
}

export default function Shell() {
  const { user } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const section = sectionFor(loc.pathname, user);
  useEffect(() => setOpen(false), [loc.pathname]);
  // Contatori accanto alle voci di menu dei moduli (GET /api/<modulo>/badges → { chiave: numero }), aggiornati ogni minuto
  const [badges, setBadges] = useState({});
  const badgeKey = section?.items?.some((i) => i.badge || i.flag) ? section.key : null;
  useEffect(() => {
    if (!badgeKey) { setBadges({}); return; }
    let alive = true;
    const load = () => api.get(`/${badgeKey}/badges`, { silent: true }).then((b) => alive && setBadges(b || {})).catch(() => {});
    load(); const t = setInterval(load, 60_000);
    window.addEventListener('suite:badges', load);   // i moduli chiedono l'aggiornamento immediato (es. eliminazione di un'elaborazione)
    return () => { alive = false; clearInterval(t); window.removeEventListener('suite:badges', load); };
  }, [badgeKey, loc.pathname]);
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
              {section.items.filter((it) => !it.flag || badges[it.flag] > 0).map((it, i) => it.group ? <div key={i} className="group">{it.group}</div>
                : it.href ? <a key={it.href} href={it.href} className={it.evidenza ? 'evid' : undefined} target={it.blank || it.href.startsWith('/go/') || /^https?:/.test(it.href) ? '_blank' : undefined} rel="noopener" title={it.blank ? `${it.label} (si apre in una nuova scheda)` : undefined}><Icon name={it.icon} />{it.label}{it.blank && <Icon name="external" className="ext" />}</a>
                : <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive && vocePerLinea(it.to, loc) ? 'active' : undefined)}><Icon name={it.icon} />{it.label}{it.badge && badges[it.badge] > 0 && <span className="count">{badges[it.badge]}</span>}</NavLink>)}
            </nav>
            {moduleFor(loc.pathname) && <VediCome moduleKey={section.key} />}
            {GUIDA_WIDGET[section.key] !== null && section.key !== 'suiteguida' && <div className="foot guida-widget"><Link to={`/suiteguida/widget/${GUIDA_WIDGET[section.key] || section.key}`} title="Che cosa fa questo widget, domande e guida in PDF"><Icon name="info" />Guida al widget</Link></div>}
            <div className="foot"><Link to="/"><Icon name="back" />Torna alla Home</Link><InformativeIcone variant="barra" /></div>
          </aside>
        </>}
        <main className="main" id="main">
          <AvvisoVersione />
          <FasciaVista />
          <Suspense fallback={<div className="page" aria-busy="true" />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
