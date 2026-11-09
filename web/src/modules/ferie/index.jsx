// Modulo Piano Ferie: route relative a /ferie dentro la cornice della Suite. Piano ferie annuale per area (decisione del CEO,
// 08/11/2026): "Il mio piano" per il dipendente, "Piano dell'area" per tutta l'area, "La mia catena" per chi ha riporti (approva il
// superiore diretto dell'anagrafica, decisione del 09/11/2026).
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata"
import { AuthProvider, isHr, vedeTutto, isApprovatore } from './auth.jsx';
import { base } from './api.js';
import './styles.css';
import MioPiano from './pages/MioPiano.jsx';
import PianoArea from './pages/PianoArea.jsx';
import Catena from './pages/Catena.jsx';
import Richieste from './pages/Richieste.jsx';
import Dettaglio from './pages/Dettaglio.jsx';
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
        <Route path="" element={<MioPiano />} />
        <Route path="area" element={<PianoArea />} />
        <Route path="catena" element={vedeTutto(user) || user.haCatena ? <Catena /> : <Forbidden />} />
        <Route path="periodi" element={<Richieste vista="mie" />} />
        <Route path="richieste" element={<Navigate to={`${base}/periodi`} replace />} />
        <Route path="richieste/:id" element={<Dettaglio />} />
        <Route path="variazioni" element={isApprovatore(user) ? <Richieste vista="da_approvare" /> : <Forbidden />} />
        <Route path="approvare" element={<Navigate to={`${base}/variazioni`} replace />} />
        <Route path="storico" element={vedeTutto(user) || user.haCatena ? <Richieste vista="tutte" /> : <Forbidden />} />
        <Route path="piano" element={<Navigate to={`${base}/area`} replace />} />
        <Route path="nuova" element={<Navigate to={base} replace />} />
        <Route path="assenze" element={<Assenze />} />
        <Route path="cruscotto" element={vedeTutto(user) || user.haCatena ? <Cruscotto /> : <Forbidden />} />
        <Route path="impostazioni" element={isHr(user) ? <Impostazioni /> : <Forbidden />} />
        <Route path="guida" element={<Guida />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
