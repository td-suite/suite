// Modulo Referti esterni: route relative a /referti dentro la cornice della Suite
import React, { createContext, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { base } from './api.js';
import './styles.css';
import Inbox from './pages/Inbox.jsx';
import Scheda from './pages/Scheda.jsx';
import Archivio from './pages/Archivio.jsx';
import Registro from './pages/Registro.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Guida from './pages/Guida.jsx';

const AuthCtx = createContext({ user: null });
export const useAuth = () => useContext(AuthCtx);
export const isLab = (u) => Boolean(u?.isLab || u?.role === 'LAB' || u?.role === 'ADMIN');
export const isQualita = (u) => Boolean(u?.isQualita || u?.role === 'QUALITA' || u?.role === 'ADMIN');

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthCtx.Provider value={{ user }}>
      <Routes>
        <Route path="" element={<Inbox />} />
        <Route path="archivio" element={<Archivio />} />
        <Route path="registro" element={<Registro />} />
        {isQualita(user) && <Route path="impostazioni" element={<Impostazioni />} />}
        <Route path="guida" element={<Guida />} />
        <Route path="schede/:id" element={<Scheda />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
