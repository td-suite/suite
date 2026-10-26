// Modulo Contracts dentro la cornice della Suite: solo il contenuto (.page), le voci di menu sono in meta.js.
// Login, Onboarding, Utenti e Profilo dell'app non si portano: li fa la Suite.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, canWrite, isAdmin } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewResource from './pages/NewResource.jsx';
import Resources from './pages/Resources.jsx';
import ResourceDetail from './pages/ResourceDetail.jsx';
import CvBox from './pages/CvBox.jsx';
import Letters from './pages/Letters.jsx';
import LetterDetail from './pages/LetterDetail.jsx';
import Ccnl from './pages/Ccnl.jsx';
import Payroll from './pages/Payroll.jsx';
import Deadlines from './pages/Deadlines.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import './contracts.css';

export default function Module({ moduleKey, mode, moduleUser }) {
  const user = moduleUser;
  const writer = canWrite(user);
  const admin = isAdmin(user);
  return (
    <ToastProvider>
      <AuthProvider user={user}>
        <div className="ctr" data-mode={mode}>
          <Routes>
            <Route path="" element={<Dashboard />} />
            <Route path="organigramma" element={<Navigate to="/people/org-chart" replace />} />
            {writer && <Route path="risorse/nuova" element={<NewResource key="new" />} />}
            {writer && <Route path="dipendenti/nuovo" element={<NewResource key="emp" kind="DIPENDENTE" />} />}
            {writer && <Route path="lp/nuovo" element={<NewResource key="lp" kind="LP" />} />}
            <Route path="risorse" element={<Resources key="all" />} />
            <Route path="risorse/:id" element={<ResourceDetail />} />
            <Route path="dipendenti" element={<Resources key="emp" kind="DIPENDENTE" />} />
            <Route path="lp" element={<Resources key="lp" kind="LP" />} />
            <Route path="scadenze" element={<Deadlines />} />
            <Route path="scouting/cv" element={<CvBox />} />
            {writer && <Route path="scouting/lettere/nuova" element={<NewResource key="letter" letterMode />} />}
            <Route path="scouting/lettere" element={<Letters />} />
            <Route path="scouting/lettere/:id" element={<LetterDetail />} />
            <Route path="ccnl" element={<Ccnl />} />
            <Route path="busta-paga" element={<Payroll />} />
            {admin && <Route path="impostazioni" element={<Settings />} />}
            {admin && <Route path="audit" element={<Audit />} />}
            <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
