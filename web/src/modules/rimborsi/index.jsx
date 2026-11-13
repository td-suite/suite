// Modulo Rimborso Spese: route relative a /rimborsi dentro la cornice della Suite. Nota spese mensile del dipendente con le sezioni Spese
// (MOD025) e Chilometri (MOD029), approvazione del superiore diretto dell'organigramma, liquidazione di P&C, archivio (docs/RIMBORSI.md).
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';
import { Skeleton } from '../../components/ui.jsx';
import { AuthProvider } from './auth.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import MieNote from './pages/MieNote.jsx';
import Nota from './pages/Nota.jsx';
import DaApprovare from './pages/DaApprovare.jsx';
import Liquidazione from './pages/Liquidazione.jsx';
import Archivio from './pages/Archivio.jsx';
import Veicoli from './pages/Veicoli.jsx';
import Impostazioni from './pages/Impostazioni.jsx';

export default function Module({ moduleUser }) {
  const st = useApi('/state');
  if (!moduleUser) return null;
  if (!st.data) return <div className="page"><Skeleton lines={6} /></div>;
  const u = st.data.user;
  return (
    <AuthProvider user={u} state={st.data}>
      <Routes>
        <Route path="" element={<MieNote />} />
        <Route path="nota/:id" element={<Nota />} />
        <Route path="veicoli" element={<Veicoli />} />
        <Route path="archivio" element={<Archivio ambito="personale" />} />
        <Route path="archivio-approvazioni" element={u.isResponsabile || u.isPC || u.isTitolare ? <Archivio ambito="approvatore" /> : <Forbidden />} />
        <Route path="da-approvare" element={u.isResponsabile || u.isPC || u.isTitolare ? <DaApprovare /> : <Forbidden />} />
        <Route path="liquidazione" element={u.isPC ? <Liquidazione /> : <Forbidden />} />
        <Route path="impostazioni" element={u.isPC || u.isTitolare ? <Impostazioni /> : <Forbidden />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
