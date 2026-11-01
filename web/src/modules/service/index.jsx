// Modulo Portale Service: route relative a /service dentro la cornice della Suite. Pagine riscritte in React sui JSON del sito
// (specchio di sola lettura); i PDF arrivano da /api/service/file/... e i link stabili /service/p|m|doc/... li serve il server.
import React, { createContext, useContext, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import Home from './pages/Home.jsx';
import Certificazioni from './pages/Certificazioni.jsx';
import Veq from './pages/Veq.jsx';
import Agora from './pages/Agora.jsx';
import Contatti from './pages/Contatti.jsx';
import Servizi, { Servizio } from './pages/Servizi.jsx';
import Vademecum from './pages/Vademecum.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import { base } from './dati.js';

const Ctx = createContext({ user: null });
export const useServizio = () => useContext(Ctx);

// /service/p|m|doc/<codice> raggiunto navigando dentro l'app: lo serve il server (PDF dalla cache), quindi caricamento completo
function LinkStabile() {
  const loc = useLocation();
  useEffect(() => { window.location.replace(loc.pathname); }, [loc.pathname]);
  return null;
}

export default function Module({ moduleUser }) {
  if (!moduleUser) return null;
  return (
    <Ctx.Provider value={{ user: moduleUser }}>
      <Routes>
        <Route path="" element={<Home />} />
        <Route path="certificazioni" element={<Certificazioni />} />
        <Route path="veq" element={<Veq />} />
        <Route path="agora" element={<Agora />} />
        <Route path="agora/:slug" element={<Agora />} />
        <Route path="contatti" element={<Contatti />} />
        <Route path="servizi" element={<Servizi />} />
        <Route path="servizi/:id" element={<Servizio />} />
        <Route path="vademecum" element={<Vademecum />} />
        {moduleUser.editor && <Route path="impostazioni" element={<Impostazioni />} />}
        <Route path="p/:codice" element={<LinkStabile />} />
        <Route path="m/:codice" element={<LinkStabile />} />
        <Route path="doc/:codice" element={<LinkStabile />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Ctx.Provider>
  );
}
