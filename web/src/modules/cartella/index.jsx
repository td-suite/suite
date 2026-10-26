// Modulo Cartella condivisa: route relative a /cartella dentro la cornice della Suite
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, isAdmin } from './auth.jsx';
import { base } from './api.js';
import './styles.css';
import Sfoglia from './pages/Sfoglia.jsx';
import Elenco from './pages/Elenco.jsx';
import Cerca from './pages/Cerca.jsx';
import Documento from './pages/Documento.jsx';
import Cronologia from './pages/Cronologia.jsx';
import Guida from './pages/Guida.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthProvider user={user}>
      <Routes>
        <Route path="" element={<Sfoglia />} />
        <Route path="c/:id" element={<Sfoglia />} />
        <Route path="evidenza" element={<Elenco preset="evidenza" />} />
        <Route path="novita" element={<Elenco preset="novita" />} />
        <Route path="recenti" element={<Elenco preset="recenti" />} />
        <Route path="cerca" element={<Cerca />} />
        <Route path="doc/:id" element={<Documento />} />
        {isAdmin(user) && <Route path="gestione" element={<Sfoglia manage />} />}
        {isAdmin(user) && <Route path="gestione/c/:id" element={<Sfoglia manage />} />}
        {isAdmin(user) && <Route path="gestione/cronologia" element={<Cronologia />} />}
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
