// Modulo Ticket: route relative a /ticket dentro la cornice della Suite
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, isAdmin, isGestore } from './auth.jsx';
import { base } from './api.js';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Nuovo from './pages/Nuovo.jsx';
import Dettaglio from './pages/Dettaglio.jsx';
import Lista from './pages/Lista.jsx';
import Statistiche from './pages/Statistiche.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Guida from './pages/Guida.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthProvider user={user}>
      <Routes>
        <Route path="" element={<Cruscotto />} />
        <Route path="nuovo" element={<Nuovo />} />
        <Route path="miei" element={<Lista preset="miei" />} />
        {isGestore(user) && <Route path="gestione" element={<Lista preset="gestione" />} />}
        <Route path="archivio" element={<Lista preset="archivio" />} />
        <Route path="statistiche" element={<Statistiche />} />
        {isAdmin(user) && <Route path="impostazioni" element={<Impostazioni />} />}
        <Route path="guida" element={<Guida />} />
        <Route path=":id" element={<Dettaglio />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
