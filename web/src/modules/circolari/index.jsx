// Modulo Circolari: route relative a /circolari dentro la cornice della Suite
import React from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
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
        <Route path="bozze" element={canEdit(user) ? <Archivio preset={{ stato: 'BOZZA' }} title="Bozze" /> : <Forbidden />} />
        <Route path="nuova" element={canEdit(user) ? <Nuova /> : <Forbidden />} />
        <Route path="liste" element={canPublish(user) ? <Liste /> : <Forbidden />} />
        <Route path="guida" element={<Guida />} />
        <Route path=":id" element={<Circolare />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
