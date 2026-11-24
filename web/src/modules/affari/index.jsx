// Modulo Public Affairs: route relative a /affari (docs/PUBLIC_AFFAIRS.md).
import React, { createContext, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Skeleton } from '../../components/ui.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import Novita from './pages/Novita.jsx';
import Fonti from './pages/Fonti.jsx';
import Archivio from './pages/Archivio.jsx';
import Normativa from './pages/Normativa.jsx';
import Impostazioni from './pages/Impostazioni.jsx';

const Ctx = createContext(null);
export const useStato = () => useContext(Ctx);

export default function Module({ moduleUser }) {
  const st = useApi('/state');
  if (!moduleUser) return null;
  if (!st.data) return <div className="page"><Skeleton lines={6} /></div>;
  return (
    <Ctx.Provider value={st.data}>
      <Routes>
        <Route path="" element={<Novita />} />
        <Route path="archivio" element={<Archivio />} />
        <Route path="normativa" element={<Normativa />} />
        <Route path="fonti" element={<Fonti />} />
        <Route path="impostazioni" element={<Impostazioni />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Ctx.Provider>
  );
}
