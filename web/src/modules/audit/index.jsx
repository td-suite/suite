// Modulo Audit SGI: route relative a /audit dentro la cornice della Suite
import React, { createContext, useContext } from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
import { Routes, Route, Navigate } from 'react-router-dom';
import { base } from './api.js';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Miei from './pages/Miei.jsx';
import Compila from './pages/Compila.jsx';
import Sedi from './pages/Sedi.jsx';
import Sede from './pages/Sede.jsx';
import Partner from './pages/Partner.jsx';
import PartnerDetail from './pages/PartnerDetail.jsx';
import Archivio from './pages/Archivio.jsx';
import SintesiTD from './pages/SintesiTD.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Guida from './pages/Guida.jsx';

const AuthCtx = createContext({ user: null, state: null });
export const useAuth = () => useContext(AuthCtx);
export const isAuditor = (u) => Boolean(u?.isAuditor || ['AUDITOR', 'QUALITA', 'ADMIN'].includes(u?.role));
export const isQualita = (u) => Boolean(u?.isQualita || ['QUALITA', 'ADMIN'].includes(u?.role));
export const isSite = (u) => u?.role === 'SITE';

export default function Module({ moduleUser, mode }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthCtx.Provider value={{ user, mode }}>
      <Routes>
        <Route path="" element={<Cruscotto />} />
        <Route path="miei" element={<Miei />} />
        <Route path="miei/:id" element={<Compila />} />
        <Route path="audit/:id" element={<Compila />} />
        <Route path="sedi" element={<Sedi />} />
        <Route path="sedi/:id" element={<Sede />} />
        <Route path="partner" element={!isSite(user) ? <Partner /> : <Forbidden />} />
        <Route path="partner/:orgId" element={!isSite(user) ? <PartnerDetail /> : <Forbidden />} />
        <Route path="archivio" element={<Archivio />} />
        <Route path="sintesi" element={!isSite(user) ? <SintesiTD /> : <Forbidden />} />
        <Route path="impostazioni" element={isQualita(user) ? <Impostazioni /> : <Forbidden />} />
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
