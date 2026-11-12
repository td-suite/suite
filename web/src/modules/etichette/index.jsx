// Modulo Lab Control (chiave `etichette`, route /etichette invariata), v0.71.0. Pagine di Lab Control alla radice del modulo; la sezione
// Label (v0.69.0) sotto /etichette/label con il suo menu di prima. Compatibilità: i vecchi indirizzi di Label (/etichette/modelli,
// /etichette/registro, /etichette/stampa) portano alle nuove pagine; /etichette/impostazioni sono le Impostazioni di Lab Control, che
// comprendono i giorni delle identità e rimandano a "Impostazioni Label". Lo stato del modulo arriva da GET /api/etichette/state.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Forbidden } from '../../pages/Misc.jsx';
import { Skeleton } from '../../components/ui.jsx';
import { AuthProvider, isAdmin } from './auth.jsx';
import { base, useApi } from './api.js';
import './styles.css';
import './lab/lab.css';
import Stampa from './pages/Stampa.jsx';
import Modelli from './pages/Modelli.jsx';
import Registro from './pages/Registro.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Cruscotto from './lab/Cruscotto.jsx';
import Accettazioni from './lab/Accettazioni.jsx';
import Scheda from './lab/Scheda.jsx';
import Campioni from './lab/Campioni.jsx';
import Ritardi from './lab/Ritardi.jsx';
import Tat from './lab/Tat.jsx';
import NonEseguiti from './lab/NonEseguiti.jsx';
import Clienti from './lab/Clienti.jsx';
import ImpostazioniLab from './lab/ImpostazioniLab.jsx';

// vecchi indirizzi di Label: stessa pagina nella sezione Label, query conservata
function Vecchio({ a }) {
  const loc = useLocation();
  return <Navigate to={`${base}/${a}${loc.search}`} replace />;
}

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
        <Route path="" element={<Cruscotto />} />
        <Route path="accettazioni" element={<Accettazioni />} />
        <Route path="accettazioni/:inst/:id" element={<Scheda />} />
        <Route path="campioni" element={<Campioni />} />
        <Route path="ritardi" element={<Ritardi />} />
        <Route path="tat" element={<Tat />} />
        <Route path="non-eseguiti" element={<NonEseguiti />} />
        <Route path="clienti" element={<Clienti />} />
        <Route path="impostazioni" element={admin ? <ImpostazioniLab /> : <Forbidden />} />
        <Route path="label" element={<Stampa />} />
        <Route path="label/modelli" element={admin ? <Modelli /> : <Forbidden />} />
        <Route path="label/registro" element={admin ? <Registro /> : <Forbidden />} />
        <Route path="label/impostazioni" element={admin ? <Impostazioni /> : <Forbidden />} />
        <Route path="stampa" element={<Vecchio a="label" />} />
        <Route path="modelli" element={<Vecchio a="label/modelli" />} />
        <Route path="registro" element={<Vecchio a="label/registro" />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AuthProvider>
  );
}
