// Modulo Orders dentro la Suite: le pagine dell'app di origine con percorsi relativi al modulo (/orders/...).
// La sidebar dell'app non c'è più (le voci sono in meta.js, le disegna la Suite); Login, Onboarding, Utenti e Profilo
// non si portano (li gestisce la Suite). Il layout shell/side/main è rimosso: il modulo rende solo il contenuto (.page).
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isOps } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { BASE } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Warehouse from './pages/Warehouse.jsx';
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
      {ops && <Route path="magazzino" element={<Warehouse />} />}
      <Route path="catalogo" element={(ops || kind === 'CLIENTE') ? <Catalog /> : <Navigate to={BASE} replace />} />
      <Route path="ordini" element={<Orders />} />
      {ops && <Route path="verifica" element={<Orders verify />} />}
      {ops && <Route path="fornitore" element={<Supplier />} />}
      {ops && <Route path="consegne" element={<Deliveries />} />}
      <Route path="ordini/:id" element={<OrderDetail />} />
      {td && <Route path="carico" element={<LoadingPage />} />}
      {td && <Route path="carico/:id" element={<LoadingPage />} />}
      {td && <Route path="scarico" element={<Unload />} />}
      <Route path="giacenza" element={<Stock />} />
      {(ops || td) && <Route path="giacenze" element={<StockCounts />} />}
      {(ops || td) && <Route path="giacenze/:id" element={<StockCount />} />}
      {(ops || td) && <Route path="produzione" element={<Production />} />}
      <Route path="difformita" element={<Issues />} />
      {ops && <Route path="rete" element={<NetworkStock />} />}
      {ops && <Route path="correlazioni" element={<Mappings />} />}
      {ops && <Route path="strutture" element={<Strutture />} />}
      {ops && <Route path="articoli" element={<Articles />} />}
      {ops && <Route path="invii" element={<EmailLog />} />}
      {ops && <Route path="audit" element={<Audit />} />}
      {sup && <Route path="impostazioni" element={<Settings />} />}
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
