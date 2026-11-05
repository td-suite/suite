// Modulo Orders dentro la Suite: le pagine dell'app di origine con percorsi relativi al modulo (/orders/...).
// La sidebar dell'app non c'è più (le voci sono in meta.js, le disegna la Suite); Login, Onboarding, Utenti e Profilo
// non si portano (li gestisce la Suite). Il layout shell/side/main è rimosso: il modulo rende solo il contenuto (.page).
import React, { useEffect } from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isOps } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { BASE } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Warehouse from './pages/Warehouse.jsx';
import Dotazione from './pages/Dotazione.jsx';
import DotazioneSede from './pages/DotazioneSede.jsx';
import Catalog from './pages/Catalog.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Supplier from './pages/Supplier.jsx';
import Deliveries from './pages/Deliveries.jsx';
import LoadingPage from './pages/Loading.jsx';
import Unload from './pages/Unload.jsx';
import Stock from './pages/Stock.jsx';
import StockCount from './pages/StockCount.jsx';
import StockCounts from './pages/StockCounts.jsx';
import Production from './pages/Production.jsx';
import Issues from './pages/Issues.jsx';
import NetworkStock from './pages/NetworkStock.jsx';
import Strutture from './pages/Strutture.jsx';
import Articles from './pages/Articles.jsx';
import Mappings from './pages/Mappings.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import EmailLog from './pages/EmailLog.jsx';
import './styles.css';

function Gate() {
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const ops = isOps(user);
  const sup = user.role === 'SUPERADMIN';
  const kind = user.struttura_kind;
  const td = !ops && kind !== 'CLIENTE';
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="magazzino" element={ops ? <Warehouse /> : <Forbidden />} />
      <Route path="dotazione" element={ops ? <Dotazione /> : <Forbidden />} />
      <Route path="dotazione/sedi/:id" element={ops ? <DotazioneSede /> : <Forbidden />} />
      <Route path="catalogo" element={(ops || kind === 'CLIENTE') ? <Catalog /> : <Navigate to={BASE} replace />} />
      <Route path="ordini" element={<Orders />} />
      <Route path="verifica" element={ops ? <Orders verify /> : <Forbidden />} />
      <Route path="fornitore" element={ops ? <Supplier /> : <Forbidden />} />
      <Route path="consegne" element={ops ? <Deliveries /> : <Forbidden />} />
      <Route path="ordini/:id" element={<OrderDetail />} />
      <Route path="carico" element={<LoadingPage />} />
      <Route path="carico/:id" element={<LoadingPage />} />
      <Route path="scarico" element={<Unload />} />
      <Route path="giacenza" element={<Stock />} />
      <Route path="giacenze" element={(ops || td) ? <StockCounts /> : <Forbidden />} />
      <Route path="giacenze/:id" element={(ops || td) ? <StockCount /> : <Forbidden />} />
      <Route path="produzione" element={(ops || td) ? <Production /> : <Forbidden />} />
      <Route path="difformita" element={<Issues />} />
      <Route path="rete" element={ops ? <NetworkStock /> : <Forbidden />} />
      <Route path="correlazioni" element={ops ? <Mappings /> : <Forbidden />} />
      <Route path="strutture" element={ops ? <Strutture /> : <Forbidden />} />
      <Route path="articoli" element={ops ? <Articles /> : <Forbidden />} />
      <Route path="invii" element={ops ? <EmailLog /> : <Forbidden />} />
      <Route path="audit" element={ops ? <Audit /> : <Forbidden />} />
      <Route path="impostazioni" element={sup ? <Settings /> : <Forbidden />} />
      <Route path="*" element={<Navigate to={BASE} replace />} />
    </Routes>
  );
}

export default function Module({ moduleUser }) {
  return (
    <ToastProvider>
      <AuthProvider user={moduleUser}>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
