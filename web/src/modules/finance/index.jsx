// Modulo Finance (Payments) dentro la Suite: solo il contenuto delle pagine dell'app (la cornice, la sidebar e l'accesso
// sono della Suite). Percorsi relativi a /finance. Login, Onboarding, Utenti e Profilo dell'app non sono portati.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { FinanceAuthProvider, canManage, isAdmin } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { base } from './paths.js';
import Dashboard from './pages/Dashboard.jsx';
import Requests from './pages/Requests.jsx';
import RequestForm from './pages/RequestForm.jsx';
import RequestDetail from './pages/RequestDetail.jsx';
import Sign from './pages/Sign.jsx';
import Beneficiaries from './pages/Beneficiaries.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Schedule from './pages/Schedule.jsx';
import './finance.css';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  const manager = canManage(user);
  const admin = isAdmin(user);
  return (
    <FinanceAuthProvider user={user}>
      <ToastProvider>
        <Routes>
          <Route path="" element={<Dashboard />} />
          {manager && <Route path="istanze/nuova" element={<RequestForm />} />}
          {manager && <Route path="istanze/:id/modifica" element={<RequestForm />} />}
          <Route path="istanze" element={<Requests />} />
          <Route path="da-firmare" element={<Requests preset={{ mine: '1' }} />} />
          <Route path="in-firma" element={<Requests preset={{ status: 'IN_FIRMA' }} />} />
          <Route path="da-eseguire" element={<Requests preset={{ status: 'FIRMATA' }} />} />
          <Route path="archivio" element={<Requests archive />} />
          <Route path="istanze/:id" element={<RequestDetail />} />
          <Route path="firma/:token" element={<Sign />} />
          <Route path="beneficiari" element={<Beneficiaries />} />
          <Route path="scadenziario" element={<Schedule />} />
          {(admin || user?.role === 'SUPPORT') && <Route path="impostazioni" element={<Settings />} />}
          {admin && <Route path="audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </ToastProvider>
    </FinanceAuthProvider>
  );
}
