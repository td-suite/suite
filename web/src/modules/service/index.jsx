// Modulo Portale Service: route relative a /service dentro la cornice della Suite. Pagine riscritte in React sui JSON del sito
// (specchio di sola lettura); i PDF arrivano da /api/service/file/... e i link stabili /service/p|m|doc/... li serve il server.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import './sito.css';
import './suite.css';
import Home from './pages/Home.jsx';
import Certificazioni from './pages/Certificazioni.jsx';
import Veq from './pages/Veq.jsx';
import Agora from './pages/Agora.jsx';
import Contatti from './pages/Contatti.jsx';
import Servizi, { Servizio } from './pages/Servizi.jsx';
import Vademecum from './pages/Vademecum.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import MioSpazio from './pages/MioSpazio.jsx';
import VistaCome from './pages/VistaCome.jsx';
import { vistaCorrente, salvaVista } from './vista.js';
import { base } from './dati.js';

const Ctx = createContext({ user: null });
export const useServizio = () => useContext(Ctx);

// /service/p|m|doc/<codice> raggiunto navigando dentro l'app: lo serve il server (PDF dalla cache), quindi caricamento completo
function LinkStabile() {
  const loc = useLocation();
  useEffect(() => { window.location.replace(loc.pathname); }, [loc.pathname]);
  return null;
}

// Atterraggio (/service): per il Cliente service, e per il personale TD in vista come Legal entity, "Il mio spazio"; per tutti gli altri
// Preparazioni e documenti. I link stabili e la ricerca (/service?codice=…, ?nontrovato=…, ?q=…) portano sempre a Preparazioni e documenti.
function Atterraggio({ conSpazio }) {
  const [params] = useSearchParams();
  const ricerca = ['codice', 'nontrovato', 'q'].some((k) => params.has(k));
  return conSpazio && !ricerca ? <MioSpazio /> : <Home />;
}

export default function Module({ moduleUser }) {
  const loc = useLocation();
  // Vista come Legal entity (solo personale TD): dal query string ?org= o da sessionStorage; si riallinea a ogni cambio di indirizzo
  const td = Boolean(moduleUser) && !moduleUser.esterno;
  const [vista, setVista] = useState(() => (td ? vistaCorrente() : null));
  useEffect(() => {
    if (!td) return;
    const v = vistaCorrente();
    if (new URLSearchParams(loc.search).has('org')) salvaVista(v);
    setVista((x) => (x?.id === v?.id && (x?.name || null) === (v?.name || null) ? x : v));
  }, [td, loc.search, loc.pathname]);
  if (!moduleUser) return null;
  // "Il mio spazio": il Cliente service sempre; il personale TD solo con una Legal entity scelta
  const conSpazio = Boolean(moduleUser.cliente_service) || (td && Boolean(vista));
  return (
    <Ctx.Provider value={{ user: moduleUser, vista: td ? vista : null }}>
      {td && <VistaCome vista={vista} onScelta={setVista} />}
      <Routes>
        <Route path="" element={<Atterraggio conSpazio={conSpazio} />} />
        <Route path="preparazioni" element={<Home />} />
        {/* "Il mio spazio" esiste solo per il Cliente service (e per il personale TD in vista come): per gli altri porta alla home del portale */}
        <Route path="mio-spazio" element={conSpazio ? <MioSpazio /> : <Navigate to={base} replace />} />
        <Route path="certificazioni" element={<Certificazioni />} />
        <Route path="veq" element={<Veq />} />
        <Route path="agora" element={<Agora />} />
        <Route path="agora/:slug" element={<Agora />} />
        <Route path="contatti" element={<Contatti />} />
        <Route path="servizi" element={<Servizi />} />
        <Route path="servizi/:id" element={<Servizio />} />
        <Route path="vademecum" element={<Vademecum />} />
        <Route path="impostazioni" element={moduleUser.editor ? <Impostazioni /> : <Forbidden />} />
        <Route path="p/:codice" element={<LinkStabile />} />
        <Route path="m/:codice" element={<LinkStabile />} />
        <Route path="doc/:codice" element={<LinkStabile />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Ctx.Provider>
  );
}
