// Modulo Circolari: route relative a /circolari dentro la cornice della Suite
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, canEdit, canPublish } from './auth.jsx';
import { base } from './api.js';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Archivio from './pages/Archivio.jsx';
import Nuova from './pages/Nuova.jsx';
import Circolare from './pages/Circolare.jsx';
import Liste from './pages/Liste.jsx';
import Guida from './pages/Guida.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthProvider user={user}>
      <Routes>
        <Route path="" element={<Cruscotto />} />
        <Route path="archivio" element={<Archivio />} />
        {canEdit(user) && <Route path="bozze" element={<Archivio preset={{ stato: 'BOZZA' }} title="Bozze" />} />}
        {canEdit(user) && <Route path="nuova" element={<Nuova />} />}
        {canPublish(user) && <Route path="liste" element={<Liste />} />}
        <Route path="guida" element={<Guida />} />
        <Route path=":id" element={<Circolare />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
