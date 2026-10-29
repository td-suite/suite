// Modulo Cash Management dentro la Suite: le pagine dell'app di origine con percorsi relativi al modulo (/cash/...).
// La sidebar dell'app non c'è più (le voci sono in meta.js, le disegna la Suite); Login, Onboarding, Utenti e Profilo
// non si portano (li gestisce la Suite). Il profilo Partner vede solo statistiche e royalty di sede, come nell'app.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, can, canReview, canFinance } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { BASE } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import ReportEdit from './pages/ReportEdit.jsx';
import NewReport from './pages/NewReport.jsx';
import NcList from './pages/NcList.jsx';
import NcDetail from './pages/NcDetail.jsx';
import Stats from './pages/Stats.jsx';
import Reconcile from './pages/Reconcile.jsx';
import Royalty from './pages/Royalty.jsx';
import SiteRoyalty from './pages/SiteRoyalty.jsx';
import PartnerRoyalties from './pages/PartnerRoyalties.jsx';
import Safe from './pages/Safe.jsx';
import DepositsList from './pages/DepositsList.jsx';
import Credits from './pages/Credits.jsx';
import Review from './pages/Review.jsx';
import MonthlyCheck from './pages/MonthlyCheck.jsx';
import DailyCheck from './pages/DailyCheck.jsx';
import Companies from './pages/Companies.jsx';
import Sites from './pages/Sites.jsx';
import Operators from './pages/Operators.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import './styles.css';

function Gate() {
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const partner = user.role === 'PARTNER';
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const sup = can(user, 'SUPERADMIN');
  const reviewer = canReview(user);
  const finance = canFinance(user);
  if (partner) {
    // Partner ospitante (accesso esterno): "Le tue royalties" come pagina di ingresso, report mensile e statistiche delle sole sedi ospitate
    return (
      <Routes>
        <Route path="royalties" element={<PartnerRoyalties />} />
        <Route path="statistiche" element={<Stats />} />
        <Route path="canoni" element={<SiteRoyalty />} />
        <Route path="*" element={<Navigate to={`${BASE}/royalties`} replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="rendiconti" element={<Reports />} />
      <Route path="rendiconti/nuovo" element={<NewReport />} />
      <Route path="rendiconti/:id" element={<ReportEdit />} />
      {admin && <Route path="controllo" element={<DailyCheck />} />}
      {reviewer && <Route path="revisione" element={<Review />} />}
      {finance && <Route path="cassaforte" element={<Safe />} />}
      {finance && <Route path="versamenti" element={<DepositsList />} />}
      {finance && <Route path="accrediti" element={<Credits />} />}
      <Route path="nc" element={<NcList />} />
      <Route path="nc/:id" element={<NcDetail />} />
      <Route path="statistiche" element={<Stats />} />
      {admin && <Route path="canoni" element={<SiteRoyalty />} />}
      {admin && <Route path="royalties" element={<PartnerRoyalties />} />}
      {admin && <Route path="riconciliazione" element={<Reconcile />} />}
      {sup && <Route path="controllo-mensile" element={<MonthlyCheck />} />}
      {sup && <Route path="royalty" element={<Royalty />} />}
      {admin && <Route path="aziende" element={<Companies />} />}
      {admin && <Route path="sedi" element={<Sites />} />}
      {admin && <Route path="operatori" element={<Operators />} />}
      {admin && <Route path="audit" element={<Audit />} />}
      {sup && <Route path="impostazioni" element={<Settings />} />}
      <Route path="*" element={<Navigate to={BASE} replace />} />
    </Routes>
  );
}

export default function Module({ moduleUser }) {
  return (
    <ToastProvider>
      <AuthProvider user={moduleUser}>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
