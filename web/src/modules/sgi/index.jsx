// Modulo Portale SGI (widget SGI Management): route relative a /sgi dentro la cornice della Suite. Pagine riscritte in React sui JSON
// del sito (specchio di sola lettura); i PDF arrivano da /api/sgi/file/... e i link stabili /sgi/doc|m|p/... li serve il server.
import React, { createContext, useContext, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './sito.css';
import './suite.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Visore from './pages/Visore.jsx';
import Preparazioni from './pages/Preparazioni.jsx';
import Vademecum from './pages/Vademecum.jsx';
import Contatti from './pages/Contatti.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import { base } from './dati.js';

const Ctx = createContext({ user: null });
export const useSgi = () => useContext(Ctx);

// /sgi/doc|m|p/<codice> raggiunto navigando dentro l'app: lo serve il server (PDF dalla cache), quindi caricamento completo
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
        <Route path="" element={<Cruscotto />} />
        <Route path="ultime" element={<Cruscotto speciale="recenti" />} />
        <Route path="cardine" element={<Cruscotto speciale="cardine" />} />
        <Route path="stampabili" element={<Cruscotto speciale="stampabili" />} />
        <Route path="indice" element={<Visore tipo="reg006" />} />
        <Route path="mappa" element={<Visore tipo="mappa" />} />
        <Route path="politica" element={<Visore tipo="politica" />} />
        <Route path="preparazioni" element={<Preparazioni />} />
        <Route path="vademecum" element={<Vademecum />} />
        <Route path="contatti" element={<Contatti />} />
        {moduleUser.editor && <Route path="impostazioni" element={<Impostazioni />} />}
        <Route path="p/:codice" element={<LinkStabile />} />
        <Route path="m/:codice" element={<LinkStabile />} />
        <Route path="doc/:codice" element={<LinkStabile />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Ctx.Provider>
  );
}
