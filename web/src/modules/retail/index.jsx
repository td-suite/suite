// Modulo Retail Assistant: le pagine dell'app di origine dentro la cornice della Suite (route relative a /retail).
// Login, onboarding, utenti e profilo personale non si portano: li gestisce la Suite.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, canWrite, isAdmin } from './auth.jsx';
import { base } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';
import Dashboard from './pages/Dashboard.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Recalls from './pages/Recalls.jsx';
import Products from './pages/Products.jsx';
import Sales from './pages/Sales.jsx';
import Import from './pages/Import.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import Promotions from './pages/Promotions.jsx';
import PromotionDetail from './pages/PromotionDetail.jsx';
import Exposure from './pages/Exposure.jsx';
import ExposureSite from './pages/ExposureSite.jsx';
import Sites from './pages/Sites.jsx';
import SiteDetail from './pages/SiteDetail.jsx';
import Budget from './pages/Budget.jsx';
import Connectors from './pages/Connectors.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  const writer = canWrite(user);
  const admin = isAdmin(user);
  return (
    <AuthProvider user={user}>
      <ToastProvider>
        <Routes>
          <Route path="" element={<Dashboard />} />
          <Route path="clienti" element={<Customers kind="B2C" />} />
          <Route path="clienti/b2b" element={<Customers kind="B2B" />} />
          <Route path="clienti/:id" element={<CustomerDetail />} />
          <Route path="richiami" element={<Recalls />} />
          <Route path="prodotti" element={<Products />} />
          <Route path="vendite" element={<Sales />} />
          {writer && <Route path="import" element={<Import />} />}
          <Route path="campagne" element={<Campaigns />} />
          <Route path="campagne/:id" element={<CampaignDetail />} />
          <Route path="promozioni" element={<Promotions />} />
          <Route path="promozioni/:id" element={<PromotionDetail />} />
          <Route path="esposizione" element={<Exposure />} />
          <Route path="esposizione/:id" element={<ExposureSite />} />
          <Route path="sedi" element={<Sites />} />
          <Route path="sedi/:id" element={<SiteDetail />} />
          <Route path="budget" element={<Budget />} />
          {admin && <Route path="connettori" element={<Connectors />} />}
          {admin && <Route path="impostazioni" element={<Settings />} />}
          {admin && <Route path="audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
