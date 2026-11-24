// Modulo Recupero Crediti: route relative a /crediti dentro la cornice della Suite (docs/RECUPERO_CREDITI.md).
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';
import { Skeleton } from '../../components/ui.jsx';
import { AuthProvider } from './auth.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import Posizioni from './pages/Posizioni.jsx';
import Cliente from './pages/Cliente.jsx';
import Comunicazioni from './pages/Comunicazioni.jsx';
import Risposte from './pages/Risposte.jsx';
import Riconciliazione from './pages/Riconciliazione.jsx';
import Chiamate from './pages/Chiamate.jsx';
import Legale from './pages/Legale.jsx';
import Fatture from './pages/Fatture.jsx';
import Esclusi from './pages/Esclusi.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Banca from './pages/Banca.jsx';

export default function Module({ moduleUser }) {
  const st = useApi('/state');
  if (!moduleUser) return null;
  if (!st.data) return <div className="page"><Skeleton lines={6} /></div>;
  const u = st.data.user;
  const T = (el) => (u.tutto ? el : <Forbidden />);
  return (
    <AuthProvider user={u} state={{ ...st.data, ricarica: st.reload }}>
      <Routes>
        <Route path="" element={u.tutto ? <Cruscotto /> : <Navigate to={`${base}/${u.legale ? 'legale' : 'clienti'}`} replace />} />
        <Route path="clienti" element={u.tutto || u.commerciale ? <Posizioni /> : <Forbidden />} />
        <Route path="clienti/:id" element={<Cliente />} />
        <Route path="comunicazioni" element={T(<Comunicazioni />)} />
        <Route path="risposte" element={T(<Risposte />)} />
        <Route path="riconciliazione" element={T(<Riconciliazione />)} />
        <Route path="chiamate" element={u.tutto || u.commerciale ? <Chiamate /> : <Forbidden />} />
        <Route path="legale" element={u.tutto || u.legale ? <Legale /> : <Forbidden />} />
        <Route path="fatture" element={T(<Fatture />)} />
        <Route path="esclusi" element={T(<Esclusi />)} />
        <Route path="impostazioni" element={T(<Impostazioni />)} />
        <Route path="banca" element={u.opera ? <Banca /> : <Forbidden />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
