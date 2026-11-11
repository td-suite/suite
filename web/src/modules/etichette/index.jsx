// Modulo Label (chiave `etichette`): route relative a /etichette dentro la cornice della Suite. "Stampa etichette" per tutti i profili;
// Modelli, Registro stampe e Impostazioni solo ADMIN. Lo stato del modulo (indirizzi di Browser Print, avviso di validazione, Data API)
// arriva da GET /api/etichette/state.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';
import { Skeleton } from '../../components/ui.jsx';
import { AuthProvider, isAdmin } from './auth.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import Stampa from './pages/Stampa.jsx';
import Modelli from './pages/Modelli.jsx';
import Registro from './pages/Registro.jsx';
import Impostazioni from './pages/Impostazioni.jsx';

export default function Module({ moduleUser }) {
  const stato = useApi('/state');
  // le pagine chiedono di rileggere lo stato (es. modello validato: l'avviso fisso sparisce)
  useEffect(() => { const h = () => stato.reload(); window.addEventListener('suite:etichette-stato', h); return () => window.removeEventListener('suite:etichette-stato', h); }, [stato.reload]);
  const user = stato.data?.user || moduleUser;
  if (!user) return null;
  if (!stato.data && stato.loading) return <div className="page"><Skeleton lines={6} /></div>;
  const admin = isAdmin(user);
  return (
    <AuthProvider user={user} stato={stato.data}>
      <Routes>
        <Route path="" element={<Stampa />} />
        <Route path="modelli" element={admin ? <Modelli /> : <Forbidden />} />
        <Route path="registro" element={admin ? <Registro /> : <Forbidden />} />
        <Route path="impostazioni" element={admin ? <Impostazioni /> : <Forbidden />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
