import React from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
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
        <Route path="audit" element={admin ? <Audit /> : <Forbidden />} />
        <Route path="snapshot" element={admin ? <Snapshots /> : <Forbidden />} />
        <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
      </Routes>
    </ModuleAuthProvider>
  );
}
