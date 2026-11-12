// Modulo Guida GIPO (chiave `gipoguida`): route relative a /gipoguida dentro la cornice della Suite. Chiedi (pagina iniziale), Guida
// (indice e sezione), FAQ per tutti gli interni; Redazione (con l'editor delle sezioni) solo ADMIN. Lo stato del modulo (profilo, AI
// attiva, avviso sui dati dei pazienti) arriva da GET /api/gipoguida/state.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';
import { Skeleton } from '../../components/ui.jsx';
import { AuthProvider, isAdmin } from './auth.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import Chiedi from './pages/Chiedi.jsx';
import Guida from './pages/Guida.jsx';
import Faq from './pages/Faq.jsx';
import Redazione from './pages/Redazione.jsx';
import Editor from './pages/Editor.jsx';

export default function Module({ moduleUser }) {
  const stato = useApi('/state');
  const user = stato.data?.user || moduleUser;
  if (!user) return null;
  if (!stato.data && stato.loading) return <div className="page"><Skeleton lines={6} /></div>;
  const admin = isAdmin(user);
  return (
    <AuthProvider user={user} stato={stato.data}>
      <Routes>
        <Route path="" element={<Chiedi />} />
        <Route path="guida" element={<Guida />} />
        <Route path="guida/:slug" element={<Guida />} />
        <Route path="faq" element={<Faq />} />
        <Route path="redazione" element={admin ? <Redazione /> : <Forbidden />} />
        <Route path="redazione/sezioni/:id" element={admin ? <Editor /> : <Forbidden />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
