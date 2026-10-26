import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEditDossier } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Icon } from '../components/ui.jsx';
import { PartyCards } from '../components/PartyPicker.jsx';
import { today } from '../format.js';

// Nuovo fascicolo di autorizzazione senza contratto: una sede TD dell'anagrafica unica (sede di proprietà, laboratorio,
// punto prelievi già in essere) e, se c'è una struttura ospitante, la controparte. Almeno uno dei due riferimenti è obbligatorio.
export default function DossierForm() {
  const nav = useNavigate();
  const { user } = useAuth();
  const orgs = useApi('/organizations');
  const sites = useApi('/sites?all=1');
  const [f, setF] = useState({ org_id: '', site_id: '', title: '', doc_date: today() });
  const [err, setErr] = useState(null);
  if (!canEditDossier(user)) return <div className="page"><ErrorBox error={new Error('Il fascicolo è riservato a HQS Manager e Retail Manager')} /></div>;
  const org = (orgs.data || []).find((x) => x.id === Number(f.org_id));
  const site = (sites.data || []).find((x) => x.id === Number(f.site_id));
  const save = async () => {
    setErr(null);
    try {
      if (!f.org_id && !f.site_id) throw new Error('Indica la sede TD o la controparte (Legal entity): almeno una delle due');
      const r = await api.post('/dossiers', { org_id: f.org_id ? Number(f.org_id) : null, site_id: f.site_id ? Number(f.site_id) : null, title: f.title || null, doc_date: f.doc_date || null });
      nav(`${BASE}/fascicoli/${r.id}`);
    } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Nuovo fascicolo di autorizzazione</h1><div className="sub">Fascicolo L.R. Toscana 51/2009 per una sede TD senza contratto nel modulo (sede di proprietà, laboratorio, punto prelievi già attivo). I fascicoli dei punti prelievo con contratto e delle sedi in locazione nascono dal contratto.</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(-1)}>Annulla</button><button className="btn" onClick={save}><Icon name="check" />Crea fascicolo</button></div>
      </div>
      <ErrorBox error={err} />
      <PartyCards orgs={orgs.data} sites={sites.data} orgId={f.org_id} siteId={f.site_id} onOrg={(v) => setF({ ...f, org_id: v })} onSite={(v) => setF({ ...f, site_id: v })} org={org} site={site}
        orgTitle="Controparte (Legal entity)" siteTitle="Sede TD autorizzanda"
        orgNote="Struttura ospitante, se c’è. Senza controparte atto di condivisione e DUVRI vengono esclusi in automatico." siteNote="La sede di Toscana Diagnostica per cui si chiede l’autorizzazione sanitaria: indirizzo e comune compaiono in tutti i documenti." />
      <Card title="Fascicolo" className="mt">
        <div className="form-grid">
          <Field label="Denominazione" className="span2" help={site ? `vuota: "Autorizzazione ${site.name}"` : 'vuota: "Autorizzazione" e nome della sede'}><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Data dei documenti"><input type="date" value={f.doc_date} onChange={(e) => setF({ ...f, doc_date: e.target.value })} /></Field>
        </div>
      </Card>
    </div>
  );
}
