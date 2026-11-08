// Modulo Piano Ferie: route relative a /ferie dentro la cornice della Suite
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata"
import { AuthProvider, isHr, vedeTutto, isApprovatore } from './auth.jsx';
import { base } from './api.js';
import './styles.css';
import MieFerie from './pages/MieFerie.jsx';
import Nuova from './pages/Nuova.jsx';
import Richieste from './pages/Richieste.jsx';
import Dettaglio from './pages/Dettaglio.jsx';
import Piano from './pages/Piano.jsx';
import Assenze from './pages/Assenze.jsx';
import Cruscotto from './pages/Cruscotto.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Guida from './pages/Guida.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  return (
    <AuthProvider user={user}>
      <Routes>
        <Route path="" element={<MieFerie />} />
        <Route path="nuova" element={<Nuova />} />
        <Route path="richieste" element={<Richieste vista="mie" />} />
        <Route path="richieste/:id" element={<Dettaglio />} />
        <Route path="approvare" element={isApprovatore(user) ? <Richieste vista="da_approvare" /> : <Forbidden />} />
        <Route path="storico" element={vedeTutto(user) || user.isApprovatore ? <Richieste vista="tutte" /> : <Forbidden />} />
        <Route path="piano" element={<Piano />} />
        <Route path="assenze" element={<Assenze />} />
        <Route path="cruscotto" element={vedeTutto(user) || user.isApprovatore ? <Cruscotto /> : <Forbidden />} />
        <Route path="impostazioni" element={isHr(user) ? <Impostazioni /> : <Forbidden />} />
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
