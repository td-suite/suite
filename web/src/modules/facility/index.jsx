// Modulo Facility e Manutenzioni: route relative a /facility dentro la cornice della Suite
import React, { createContext, useContext } from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
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
        <Route path="immobili" element={noMaint ? <Immobili /> : <Forbidden />} />
        <Route path="immobili/:siteId" element={noMaint ? <Immobile /> : <Forbidden />} />
        <Route path="dispositivi" element={<Dispositivi />} />
        <Route path="dispositivi/:id" element={<Dispositivo />} />
        <Route path="qr/:token" element={<QrRedirect />} />
        <Route path="piano" element={<Piano />} />
        <Route path="interventi" element={<Interventi />} />
        <Route path="interventi/:id" element={<Intervento />} />
        <Route path="utenze" element={noMaint ? <Utenze /> : <Forbidden />} />
        <Route path="energia" element={noMaint ? <Energia /> : <Forbidden />} />
        <Route path="report" element={<Report />} />
        <Route path="impostazioni" element={isFacility(user) ? <Impostazioni /> : <Forbidden />} />
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
