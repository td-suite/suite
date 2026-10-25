import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ModuleAuthProvider, isAdmin } from './auth.jsx';
import Plan from './pages/Plan.jsx';
import Guide from './pages/Guide.jsx';
import Audit from './pages/Audit.jsx';
import Snapshots from './pages/Snapshots.jsx';
import './styles.css';
import './ipm.css';

// Modulo Integration M&A: le route dell'app, relative a /integration. Login, utenti e profilo sono della Suite.
export default function Module({ moduleKey, mode, moduleUser }) {
  const admin = isAdmin(moduleUser);
  return (
    <ModuleAuthProvider user={moduleUser}>
      <Routes>
        <Route path="/" element={<Plan mode={mode} moduleKey={moduleKey} />} />
        <Route path="guida" element={<Guide />} />
        {admin && <Route path="audit" element={<Audit />} />}
        {admin && <Route path="snapshot" element={<Snapshots />} />}
        <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
      </Routes>
    </ModuleAuthProvider>
  );
}
