// Modulo Business dentro la cornice della Suite: solo il contenuto (.page), le voci di menu sono in meta.js
import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, isAdmin, isManager, canEditDossier } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contracts from './pages/Contracts.jsx';
import ContractForm from './pages/ContractForm.jsx';
import ContractDetail from './pages/ContractDetail.jsx';
import Dossier from './pages/Dossier.jsx';
import DossierForm from './pages/DossierForm.jsx';
import { useApi, Loading, ErrorBox } from './components/ui.jsx';
import Organizations from './pages/Organizations.jsx';
import Dossiers from './pages/Dossiers.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
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
            <Route path="contratti/:id/fascicolo" element={<ContractDossierRedirect moduleKey={moduleKey} />} />
            {canEditDossier(user) && <Route path="fascicoli/nuovo" element={<DossierForm />} />}
            <Route path="fascicoli/:id" element={<Dossier />} />
            <Route path="organizzazioni" element={<Organizations />} />
            <Route path="partner" element={<Navigate to={`/${moduleKey}/organizzazioni`} replace />} />
            {admin && <Route path="impostazioni" element={<Settings />} />}
            {admin && <Route path="audit" element={<Audit />} />}
            <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}

// Vecchio percorso del fascicolo (per contratto): porta alla scheda del fascicolo, che ora ha un id proprio
function ContractDossierRedirect({ moduleKey }) {
  const { id } = useParams();
  const c = useApi(`/contracts/${id}`);
  if (c.error) return <div className="page"><ErrorBox error={c.error} /></div>;
  if (!c.data) return <div className="page"><Loading /></div>;
  if (!c.data.dossier) return <div className="page"><ErrorBox error={new Error('Questo contratto non ha un fascicolo di autorizzazione')} /></div>;
  return <Navigate to={`/${moduleKey}/fascicoli/${c.data.dossier.id}`} replace />;
}
