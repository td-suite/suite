// Modulo Retail Assistant: le pagine dell'app di origine dentro la cornice della Suite (route relative a /retail).
// Login, onboarding, utenti e profilo personale non si portano: li gestisce la Suite.
// Riordino del 09/11/2026 (decisione del CEO): cruscotto complessivo (''), sezione B2C (b2c/…: TuoTempo + GIPO) e sezione B2B (b2b/…:
// tutto da StudioLab), dati e amministrazione. Le vecchie rotte rimandano alle nuove (link salvati, Cockpit, Home): REDIRECT qui sotto.
import React from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, canWrite, isAdmin } from './auth.jsx';
import { base } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';
import Cruscotto from './pages/Cruscotto.jsx';
import CruscottoB2C from './pages/CruscottoB2C.jsx';
import Customers from './pages/Customers.jsx';
import ProfiloPazienti from './pages/ProfiloPazienti.jsx';
import B2B from './pages/B2B.jsx';
import CruscottoB2B from './pages/CruscottoB2B.jsx';
import B2BCliente from './pages/B2BCliente.jsx';
import B2BProduzione from './pages/B2BProduzione.jsx';
import B2BFatturato from './pages/B2BFatturato.jsx';
import B2BListini from './pages/B2BListini.jsx';
import B2BBudget from './pages/B2BBudget.jsx';
import Prenotazioni from './pages/Prenotazioni.jsx';
import Laboratorio from './pages/Laboratorio.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Recalls from './pages/Recalls.jsx';
import Products from './pages/Products.jsx';
import ListinoOnline from './pages/ListinoOnline.jsx';
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
import IntornoRilevazione from './pages/IntornoRilevazione.jsx';
import Budget from './pages/Budget.jsx';
import Connectors from './pages/Connectors.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

// Vecchie rotte → nuove (la query string resta: es. ?tab=da_abbinare, ?site_id=…)
const REDIRECT = [
  ['clienti/b2b', 'b2b/clienti'], ['clienti', 'b2c/clienti'], ['profilo-pazienti', 'b2b/profilo-pazienti'], ['vendite', 'b2c/vendite'],
  ['richiami', 'b2c/richiami'], ['prodotti', 'b2c/prodotti'], ['listino-online', 'b2c/listino-online'], ['budget', 'b2c/budget'],
  ['campagne', 'b2c/campagne'], ['promozioni', 'b2c/promozioni'], ['esposizione', 'b2c/esposizione'], ['sedi', 'b2c/sedi'],
];
const REDIRECT_ID = [['clienti/:id', 'b2c/clienti'], ['campagne/:id', 'b2c/campagne'], ['promozioni/:id', 'b2c/promozioni'], ['esposizione/:id', 'b2c/esposizione'], ['sedi/:id', 'b2c/sedi']];
function Rinvia({ to }) {
  const { id } = useParams();
  const loc = useLocation();
  return <Navigate to={`${base}/${to}${id ? `/${id}` : ''}${loc.search || ''}`} replace />;
}

export default function Module({ moduleUser }) {
  const user = moduleUser;
  if (!user) return null;
  const writer = canWrite(user);
  const admin = isAdmin(user);
  return (
    <AuthProvider user={user}>
      <ToastProvider>
        <Routes>
          <Route path="" element={<Cruscotto />} />
          {/* B2C · centri medici e punti prelievo (TuoTempo + GIPO) */}
          <Route path="b2c" element={<CruscottoB2C />} />
          <Route path="b2c/clienti" element={<Customers kind="B2C" />} />
          <Route path="b2c/clienti/:id" element={<CustomerDetail />} />
          <Route path="b2c/richiami" element={<Recalls />} />
          <Route path="b2c/prodotti" element={<Products />} />
          <Route path="b2c/listino-online" element={<ListinoOnline />} />
          <Route path="b2c/vendite" element={<Sales />} />
          <Route path="b2c/prenotazioni" element={<Prenotazioni />} />
          <Route path="b2c/laboratorio" element={<Laboratorio />} />
          <Route path="b2c/campagne" element={<Campaigns />} />
          <Route path="b2c/campagne/:id" element={<CampaignDetail />} />
          <Route path="b2c/promozioni" element={<Promotions />} />
          <Route path="b2c/promozioni/:id" element={<PromotionDetail />} />
          <Route path="b2c/esposizione" element={<Exposure />} />
          <Route path="b2c/esposizione/:id" element={<ExposureSite />} />
          <Route path="b2c/sedi" element={<Sites />} />
          <Route path="b2c/sedi/:id" element={<SiteDetail />} />
          <Route path="b2c/budget" element={<Budget />} />
          <Route path="intorno/:id" element={<IntornoRilevazione />} />
          {/* B2B · service e medicina del lavoro (StudioLab) */}
          <Route path="b2b" element={<CruscottoB2B />} />
          <Route path="b2b/clienti" element={<B2B />} />
          <Route path="b2b/clienti/:chiave" element={<B2BCliente />} />
          <Route path="b2b/codici/:id" element={<CustomerDetail />} />
          <Route path="b2b/produzione" element={<B2BProduzione />} />
          <Route path="b2b/fatturato" element={<B2BFatturato />} />
          <Route path="b2b/listini" element={<B2BListini />} />
          <Route path="b2b/profilo-pazienti" element={<ProfiloPazienti />} />
          <Route path="b2b/budget" element={<B2BBudget />} />
          {/* Dati e amministrazione */}
          <Route path="import" element={writer ? <Import /> : <Forbidden />} />
          <Route path="connettori" element={admin ? <Connectors /> : <Forbidden />} />
          <Route path="impostazioni" element={admin ? <Settings /> : <Forbidden />} />
          <Route path="audit" element={admin ? <Audit /> : <Forbidden />} />
          {REDIRECT.map(([da, a]) => <Route key={da} path={da} element={<Rinvia to={a} />} />)}
          {REDIRECT_ID.map(([da, a]) => <Route key={da} path={da} element={<Rinvia to={a} />} />)}
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
