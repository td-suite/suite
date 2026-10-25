// Modulo Shipments dentro la Suite: le pagine dell'app di origine con percorsi relativi al modulo (/shipments/...).
// La sidebar dell'app non c'è più (le voci sono in meta.js, le disegna la Suite); resta una barra di progetto in testa alle pagine.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, canOperate, isEndeavor } from './auth.jsx';
import { LangProvider, useT, LangToggle } from './i18n.jsx';
import { ToastProvider, Icon } from './components/ui.jsx';
import { projectOf } from './format.js';
import { BASE } from './api.js';
import Home from './pages/Home.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inbox from './pages/Inbox.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Stock from './pages/Stock.jsx';
import Shipping from './pages/Shipping.jsx';
import Returns from './pages/Returns.jsx';
import Lab from './pages/Lab.jsx';
import Quantitative from './pages/Quantitative.jsx';
import Billing from './pages/Billing.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Emails from './pages/Emails.jsx';
import './styles.css';

function ProjectShell({ proj }) {
  const { user } = useAuth();
  const { t } = useT();
  const project = projectOf(proj);
  const base = `${BASE}/${proj}`;
  const endeavorOnly = isEndeavor(user);
  const op = canOperate(user);
  if (endeavorOnly && project !== 'ENDEAVOR') return <Navigate to={`${BASE}/endeavor/rendiconto`} replace />;
  return (
    <>
      <div className={`projbar ${project === 'LIFESTYLE' ? 'ls' : ''}`}>
        <div className="pj"><Icon name={project === 'LIFESTYLE' ? 'heart' : 'dna'} />{t(`proj.${project}`)}</div>
        <div className="spacer" />
        <span className="small muted">{t(`role.${user.role}`)}</span>
        <LangToggle persist />
        {!endeavorOnly && <Link to={BASE} className="btn sm ghost"><Icon name="swap" size={15} />{t('nav.switch')}</Link>}
      </div>
      <Routes>
        {endeavorOnly ? <>
          <Route path="rendicontazione" element={<Quantitative project={project} />} />
          <Route path="rendiconto" element={<Billing project={project} />} />
          <Route path="*" element={<Navigate to={`${base}/rendiconto`} replace />} />
        </> : <>
          <Route index element={<Dashboard project={project} />} />
          <Route path="richieste" element={<Inbox project={project} />} />
          <Route path="richieste/:id" element={<OrderDetail project={project} />} />
          <Route path="magazzino" element={<Stock project={project} />} />
          <Route path="invio" element={<Shipping project={project} orderType={project === 'LIFESTYLE' ? 'KIT_ONLY' : null} />} />
          {project === 'LIFESTYLE' && <Route path="invio-esame" element={<Shipping project={project} orderType="KIT_AND_EXAM" />} />}
          <Route path="ricezione" element={<Returns project={project} />} />
          {project === 'ENDEAVOR' && <Route path="laboratorio" element={<Lab project={project} />} />}
          {project === 'ENDEAVOR' && <Route path="laboratorio/:id" element={<Lab project={project} />} />}
          <Route path="elenco" element={<Orders project={project} />} />
          <Route path="rendicontazione" element={<Quantitative project={project} />} />
          {project === 'ENDEAVOR' && <Route path="rendiconto" element={<Billing project={project} />} />}
          {op && <Route path="impostazioni" element={<Settings />} />}
          {(op || user.role === 'VIEWER') && <Route path="audit" element={<Audit />} />}
          {(op || user.role === 'VIEWER') && <Route path="email" element={<Emails />} />}
          <Route path="*" element={<Navigate to={base} replace />} />
        </>}
      </Routes>
    </>
  );
}

// Le voci di menu "Sistema" (impostazioni, registri) sono comuni ai progetti: /shipments/impostazioni → progetto Endeavor
function Shortcut({ to }) { return <Navigate to={`${BASE}/endeavor/${to}`} replace />; }

function Gate() {
  const { user } = useAuth();
  const { setLang } = useT();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { if (user?.lang) setLang(user.lang, false); }, [user?.lang, setLang]);
  return (
    <Routes>
      <Route index element={isEndeavor(user) ? <Navigate to={`${BASE}/endeavor/rendiconto`} replace /> : <Home />} />
      <Route path="endeavor/*" element={<ProjectShell proj="endeavor" />} />
      <Route path="lifestyle/*" element={<ProjectShell proj="lifestyle" />} />
      <Route path="impostazioni" element={<Shortcut to="impostazioni" />} />
      <Route path="email" element={<Shortcut to="email" />} />
      <Route path="audit" element={<Shortcut to="audit" />} />
      <Route path="*" element={<Navigate to={BASE} replace />} />
    </Routes>
  );
}

export default function Module({ moduleUser }) {
  return (
    <LangProvider initial={moduleUser?.lang}>
      <ToastProvider>
        <AuthProvider user={moduleUser}>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </LangProvider>
  );
}
