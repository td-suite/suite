import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isAdmin, hasModule } from './auth.jsx';
import { ToastProvider, BusyBar } from './components/ui.jsx';
import Shell from './components/Shell.jsx';
import { Login, Forgot, Reset, Totp, ChangePassword, Pending } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Search from './pages/Search.jsx';
import Community from './pages/Community.jsx';
import People from './pages/People.jsx';
import Cockpit from './pages/Cockpit.jsx';
import Files from './pages/Files.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/admin/Admin.jsx';
import { NotFound, ErrorPage, Forbidden } from './pages/Misc.jsx';
import ModuleFrame from './components/ModuleFrame.jsx';
import { moduleKeys } from './modules/registry.js';

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
  const admin = isAdmin(user);
  return (
    <Routes>
      <Route path="/login" element={<Navigate to={new URLSearchParams(loc.search).get('next') || '/'} replace />} />
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
