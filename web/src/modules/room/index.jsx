// Modulo Room Planning: le pagine dell'app di origine dentro la cornice della Suite (route relative a /room).
// Login, onboarding, utenti e profilo personale non si portano: li gestisce la Suite.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import { base } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';
import './planner/planner.css';
import Dashboard from './pages/Dashboard.jsx';
import Sedi from './pages/Sedi.jsx';
import Specialisti from './pages/Specialisti.jsx';
import Calendario from './pages/Calendario.jsx';
import SedePage from './pages/SedePage.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Professionisti from './pages/Professionisti.jsx';
import Turni from './pages/Turni.jsx';
import Presenze from './pages/Presenze.jsx';
import Rendiconti from './pages/Rendiconti.jsx';
import Fabbisogno from './pages/Fabbisogno.jsx';
import Bacheca from './pages/Bacheca.jsx';
import Statistiche from './pages/Statistiche.jsx';
import { PortaleHome, PortaleDisponibilita, PortaleTurni, PortaleRendiconti } from './pages/Portale.jsx';

function SoloProfessionisti() {
  return <div className="page"><div className="card"><div className="bd"><h2>Portale del professionista</h2><p className="muted">Questa sezione è riservata agli utenti con profilo Professionista: ciascuno vede le proprie disponibilità, i turni confermati, le presenze e i rendiconti. Le schede dei professionisti si gestiscono dalla voce "Professionisti".</p></div></div></div>;
}

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  const admin = user.role === 'ADMIN';
  const gest = admin || user.role === 'RESP_SAN';
  const prof = user.role === 'PROF';
  return (
    <AuthProvider user={user}>
      <ToastProvider>
        <Routes>
          {prof ? <>
            <Route path="" element={<Navigate to={`${base}/portale`} replace />} />
            <Route path="portale" element={<PortaleHome />} />
            <Route path="disponibilita" element={<PortaleDisponibilita />} />
            <Route path="turni" element={<PortaleTurni />} />
            <Route path="rendiconti" element={<PortaleRendiconti />} />
            <Route path="bacheca" element={<Bacheca portale />} />
            <Route path="*" element={<Navigate to={`${base}/portale`} replace />} />
          </> : <>
            <Route path="" element={<Dashboard />} />
            <Route path="portale" element={<SoloProfessionisti />} />
            <Route path="disponibilita" element={<SoloProfessionisti />} />
            <Route path="specialisti" element={<Specialisti />} />
            <Route path="calendario" element={<Calendario />} />
            <Route path="sedi" element={<Sedi />} />
            <Route path="sedi/:id" element={<SedePage />} />
            {gest && <Route path="professionisti" element={<Professionisti />} />}
            <Route path="turni" element={<Turni />} />
            <Route path="presenze" element={<Presenze />} />
            {gest && <Route path="rendiconti" element={<Rendiconti />} />}
            <Route path="fabbisogno" element={<Fabbisogno />} />
            <Route path="bacheca" element={<Bacheca />} />
            {gest && <Route path="statistiche" element={<Statistiche />} />}
            {admin && <Route path="impostazioni" element={<Settings />} />}
            {admin && <Route path="audit" element={<Audit />} />}
            <Route path="*" element={<Navigate to={base} replace />} />
          </>}
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
