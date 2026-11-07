// Modulo Business Hub dentro la cornice della Suite: solo il contenuto (.page), le voci di menu sono in meta.js
import React from 'react';
import { Forbidden } from '../../pages/Misc.jsx';   // pagina riservata aperta da URL: "Sezione non abilitata" (debug M2)
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, isAdmin, isManager, canEditDossier } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contracts from './pages/Contracts.jsx';
import ContractForm from './pages/ContractForm.jsx';
import ContractDetail from './pages/ContractDetail.jsx';
import Dossier from './pages/Dossier.jsx';
import DossierForm from './pages/DossierForm.jsx';
import { useApi, Loading, ErrorBox } from './components/ui.jsx';
import { BASE } from './api.js';
import Organizations from './pages/Organizations.jsx';
import Dossiers from './pages/Dossiers.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import HubCruscotto from './pages/HubCruscotto.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Clienti from './pages/Clienti.jsx';
import Opportunita from './pages/Opportunita.jsx';
import Account from './pages/Account.jsx';
import EmailDaAssegnare from './pages/EmailDaAssegnare.jsx';
import ClientiAttivi from './pages/ClientiAttivi.jsx';
import PuntiPrelievo from './pages/PuntiPrelievo.jsx';
import './business.css';

// vecchio indirizzo /business/account/:accountId/contratti/:id → scheda Contratto dell'account con quel contratto scelto
function ContrattoInScheda() {
  const { accountId, id } = useParams();
  return <Navigate replace to={`${BASE}/account/${accountId}?scheda=contratto&contratto=${id}`} />;
}

export default function Module({ moduleKey, mode, moduleUser }) {
  const user = moduleUser;
  const admin = isAdmin(user);
  return (
    <ToastProvider>
      <AuthProvider user={user}>
        <div className="biz" data-mode={mode}>
          <Routes>
            <Route path="" element={<HubCruscotto />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="clienti" element={<Clienti />} />
            <Route path="db-opportunita" element={<Opportunita />} />
            <Route path="account/:id" element={<Account />} />
            {/* il contratto aperto dalla scheda account ora è la scheda "Contratto" dell'account (07/11/2026): i vecchi collegamenti ci arrivano */}
            <Route path="account/:accountId/contratti/:id" element={<ContrattoInScheda />} />
            <Route path="email" element={<EmailDaAssegnare />} />
            <Route path="clienti-attivi" element={<ClientiAttivi />} />
            <Route path="contratti-panoramica" element={<Dashboard />} />
            {/* Punti Prelievo (06/11/2026): elenco dei punti con tipo, sede, partner, fase, autorizzazione e avvio; i contratti PP a parte */}
            <Route path="punti-prelievo" element={<PuntiPrelievo />} />
            <Route path="contratti-pp" element={<Contracts kind="PP" />} />
            <Route path="service" element={<Contracts kind="SRV" />} />
            <Route path="medicina-del-lavoro" element={<Contracts kind="MDL" />} />
            <Route path="sedi" element={<Contracts kind="SEDE" />} />
            <Route path="fascicoli" element={<Dossiers />} />
            <Route path="contratti" element={<Contracts />} />
            <Route path="contratti/nuovo/:kind" element={isManager(user) ? <ContractForm /> : <Forbidden />} />
            <Route path="contratti/:id/modifica" element={isManager(user) ? <ContractForm /> : <Forbidden />} />
            <Route path="contratti/:id" element={<ContractDetail />} />
            <Route path="contratti/:id/fascicolo" element={<ContractDossierRedirect moduleKey={moduleKey} />} />
            <Route path="fascicoli/nuovo" element={canEditDossier(user) ? <DossierForm /> : <Forbidden />} />
            <Route path="fascicoli/:id" element={<Dossier />} />
            <Route path="organizzazioni" element={<Organizations />} />
            <Route path="partner" element={<Navigate to={`/${moduleKey}/organizzazioni`} replace />} />
            <Route path="impostazioni" element={admin ? <Settings /> : <Forbidden />} />
            <Route path="audit" element={admin ? <Audit /> : <Forbidden />} />
            <Route path="*" element={<Navigate to={`/${moduleKey}`} replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}

// Vecchio percorso del fascicolo (per contratto): porta alla scheda del fascicolo, che ora ha un id proprio
function ContractDossierRedirect({ moduleKey }) {
  const { id } = useParams();
  const c = useApi(`/contracts/${id}`);
  if (c.error) return <div className="page"><ErrorBox error={c.error} /></div>;
  if (!c.data) return <div className="page"><Loading /></div>;
  if (!c.data.dossier) return <div className="page"><ErrorBox error={new Error('Questo contratto non ha un fascicolo di autorizzazione')} /></div>;
  return <Navigate to={`/${moduleKey}/fascicoli/${c.data.dossier.id}`} replace />;
}
