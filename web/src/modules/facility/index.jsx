// Modulo Facility e Manutenzioni: route relative a /facility dentro la cornice della Suite
import React, { createContext, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { base } from './api.js';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Immobili from './pages/Immobili.jsx';
import Immobile from './pages/Immobile.jsx';
import Dispositivi from './pages/Dispositivi.jsx';
import Dispositivo, { QrRedirect } from './pages/Dispositivo.jsx';
import Piano from './pages/Piano.jsx';
import Interventi from './pages/Interventi.jsx';
import Intervento from './pages/Intervento.jsx';
import Utenze from './pages/Utenze.jsx';
import Energia from './pages/Energia.jsx';
import Report from './pages/Report.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Guida from './pages/Guida.jsx';

const AuthCtx = createContext({ user: null });
export const useAuth = () => useContext(AuthCtx);
export const isFacility = (u) => Boolean(u?.isFacility || ['FACILITY', 'ADMIN'].includes(u?.role));
export const isSite = (u) => u?.role === 'SITE';
export const isManutentore = (u) => u?.role === 'MANUTENTORE';
export const isViewer = (u) => u?.role === 'VIEWER';

export default function Module({ moduleUser, mode }) {
  const user = moduleUser;
  if (!user) return null;
  const noMaint = !isManutentore(user);
  return (
    <AuthCtx.Provider value={{ user, mode }}>
      <Routes>
        <Route path="" element={<Cruscotto />} />
        {noMaint && <Route path="immobili" element={<Immobili />} />}
        {noMaint && <Route path="immobili/:siteId" element={<Immobile />} />}
        <Route path="dispositivi" element={<Dispositivi />} />
        <Route path="dispositivi/:id" element={<Dispositivo />} />
        <Route path="qr/:token" element={<QrRedirect />} />
        <Route path="piano" element={<Piano />} />
        <Route path="interventi" element={<Interventi />} />
        <Route path="interventi/:id" element={<Intervento />} />
        {noMaint && <Route path="utenze" element={<Utenze />} />}
        {noMaint && <Route path="energia" element={<Energia />} />}
        <Route path="report" element={<Report />} />
        {isFacility(user) && <Route path="impostazioni" element={<Impostazioni />} />}
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
