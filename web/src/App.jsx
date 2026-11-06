import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isAdmin, hasModule } from './auth.jsx';
import { percorsoInterno } from './format.js';
import { ToastProvider, BusyBar } from './components/ui.jsx';
import { Login, Forgot, Reset, Totp, ChangePassword, Pending } from './pages/Auth.jsx';
import { NotFound, ErrorPage, Forbidden } from './pages/Misc.jsx';
import { moduleKeys } from './modules/registry.js';

// Pagine caricate a richiesta (debug pre-produzione M8): la pagina di login scarica solo l'avvio, l'accesso e i componenti di base;
// Shell, Home e tutte le altre pagine (con grafici, mappe, export) arrivano dopo l'accesso, ciascuna nel proprio chunk
const Shell = lazy(() => import('./components/Shell.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const PresaAtto = lazy(() => import('./pages/PresaAtto.jsx'));
const InformativaIA = lazy(() => import('./pages/InformativaIA.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));
const People = lazy(() => import('./pages/People.jsx'));
const Cockpit = lazy(() => import('./pages/Cockpit.jsx'));
const Files = lazy(() => import('./pages/Files.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Admin = lazy(() => import('./pages/admin/Admin.jsx'));
const ModuleFrame = lazy(() => import('./components/ModuleFrame.jsx'));
const FormB2B = lazy(() => import('./pages/FormB2B.jsx'));

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() { return this.state.error ? <ErrorPage error={this.state.error} onRetry={() => this.setState({ error: null })} /> : this.props.children; }
}

function Splash() { return <div className="splash" aria-busy="true"><img src="/logo-light.svg" alt="Toscana Diagnostica" /></div>; }

function Guard({ ok, children }) { return ok ? children : <Forbidden />; }

function Gate() {
  const { loading, user, pending, totpRequired, mustChangePassword, cfg } = useAuth();
  const loc = useLocation();
  // Informativa IA: pagina pubblica, prima di ogni controllo (si apre anche senza login e durante la presa d'atto)
  if (loc.pathname === '/informativa-ia') return <Suspense fallback={<Splash />}><InformativaIA /></Suspense>;
  // Form online del Business Hub per i clienti (processo Service): pubblica, con il token nel collegamento, senza login
  if (loc.pathname.startsWith('/b2b/')) return <Suspense fallback={<Splash />}><Routes><Route path="/b2b/:token" element={<FormB2B />} /></Routes></Suspense>;
  if (loading) return <Splash />;
  if (totpRequired) return <Totp />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="*" element={<Navigate to={`/login${loc.pathname !== '/' ? `?next=${encodeURIComponent(loc.pathname + loc.search)}` : ''}`} replace />} />
      </Routes>
    );
  }
  if (pending) return <Pending />;
  if (mustChangePassword) return <ChangePassword />;
  // Presa d'atto di Privacy e Informativa IA: al primo accesso e quando cambia la versione di una delle due (pages/PresaAtto.jsx)
  if (user.consensi_da_accettare?.length) return <Suspense fallback={<Splash />}><PresaAtto /></Suspense>;
  const admin = isAdmin(user);
  return (
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/login" element={<Navigate to={percorsoInterno(new URLSearchParams(loc.search).get('next') || '/')} replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/community/*" element={<Community />} />
        <Route path="/people/*" element={<Guard ok={admin || hasModule(user, 'rubrica')}><People /></Guard>} />
        <Route path="/cockpit" element={<Guard ok={admin || hasModule(user, 'cockpit')}><Cockpit /></Guard>} />
        <Route path="/files" element={<Guard ok={cfg.blobEnabled}><Files /></Guard>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin/*" element={<Guard ok={admin}><Admin /></Guard>} />
        {moduleKeys().map((k) => <Route key={k} path={`/${k}/*`} element={<ModuleFrame moduleKey={k} />} />)}
        <Route path="/error" element={<ErrorPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BusyBar />
      <AuthProvider>
        <ErrorBoundary>
          <Gate />
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}
