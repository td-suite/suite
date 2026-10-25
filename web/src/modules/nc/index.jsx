// Modulo Non conformità: le pagine dell'app di origine dentro la cornice della Suite (route relative a /nc).
// Login, onboarding, utenti e profilo non si portano: li gestisce la Suite. Le preferenze di notifica restano (pagina Notifiche).
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, isLab, isSede, isQualita, isInternal } from './auth.jsx';
import { base } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import { LiveProvider } from './live.jsx';
import './styles.css';
import Dashboard from './pages/Dashboard.jsx';
import Desk from './pages/Desk.jsx';
import NcList from './pages/NcList.jsx';
import NcDetail from './pages/NcDetail.jsx';
import Stats from './pages/Stats.jsx';
import Sedi from './pages/Sedi.jsx';
import Tipi from './pages/Tipi.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import Guide from './pages/Guide.jsx';
import Notifiche from './pages/Notifiche.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthProvider user={user}>
      <ToastProvider>
        <LiveProvider user={user}>
          <Routes>
            <Route path="" element={<Dashboard />} />
            {isLab(user) && <Route path="desk" element={<Desk />} />}
            {isLab(user) && <Route path="desk/:id" element={<Desk />} />}
            {isSede(user) && <Route path="accettazioni" element={<Desk readOnly />} />}
            <Route path="nc" element={<NcList />} />
            {isLab(user) && <Route path="nc/oltre-sla" element={<NcList preset={{ stato: 'INVIATA_SEDE', scadute: '1' }} title="Oltre SLA" />} />}
            {isQualita(user) && <Route path="nc/da-verificare" element={<NcList preset={{ stato: 'CHIUSA' }} title="Da verificare" />} />}
            <Route path="nc/:id" element={<NcDetail />} />
            <Route path="statistiche" element={<Stats />} />
            {isInternal(user) && <Route path="sedi" element={<Sedi />} />}
            {isQualita(user) && <Route path="tipi" element={<Tipi />} />}
            {isQualita(user) && <Route path="audit" element={<Audit />} />}
            {isQualita(user) && <Route path="impostazioni" element={<Settings />} />}
            <Route path="guida" element={<Guide />} />
            <Route path="notifiche" element={<Notifiche />} />
            <Route path="*" element={<Navigate to={base} replace />} />
          </Routes>
        </LiveProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
