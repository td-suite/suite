// Modulo Business dentro la cornice della Suite: solo il contenuto (.page), le voci di menu sono in meta.js
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, isAdmin, isManager } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contracts from './pages/Contracts.jsx';
import ContractForm from './pages/ContractForm.jsx';
import ContractDetail from './pages/ContractDetail.jsx';
import Dossier from './pages/Dossier.jsx';
import Partners from './pages/Partners.jsx';
import Dossiers from './pages/Dossiers.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Import from './pages/Import.jsx';
import './business.css';

export default function Module({ moduleKey, mode, moduleUser }) {
  const user = moduleUser;
  const admin = isAdmin(user);
  return (
    <ToastProvider>
      <AuthProvider user={user}>
        <div className="biz" data-mode={mode}>
          <Routes>
            <Route path="" element={<Dashboard />} />
            <Route path="punti-prelievo" element={<Contracts kind="PP" />} />
            <Route path="service" element={<Contracts kind="SRV" />} />
            <Route path="medicina-del-lavoro" element={<Contracts kind="MDL" />} />
            <Route path="sedi" element={<Contracts kind="SEDE" />} />
            <Route path="fascicoli" element={<Dossiers />} />
            <Route path="contratti" element={<Contracts />} />
            {isManager(user) && <Route path="contratti/nuovo/:kind" element={<ContractForm />} />}
            {isManager(user) && <Route path="contratti/:id/modifica" element={<ContractForm />} />}
            <Route path="contratti/:id" element={<ContractDetail />} />
            <Route path="contratti/:id/fascicolo" element={<Dossier />} />
            <Route path="partner" element={<Partners />} />
            {admin && <Route path="impostazioni" element={<Settings />} />}
            {admin && <Route path="audit" element={<Audit />} />}
            {admin && <Route path="importazione" element={<Import />} />}
            <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
