// Nuovo tirocinante (v0.77.0): anagrafica e dati del tirocinio in un passaggio. Progetto formativo e giudizio si seguono poi dalla scheda.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Card, ErrorBox, useToast } from '../components/ui.jsx';
import { PersonForm } from '../components/forms.jsx';
import { TirocinioForm } from '../components/Sviluppo.jsx';

export default function NewTirocinante() {
  const nav = useNavigate();
  const toast = useToast();
  const [person, setPerson] = useState({ kind: 'TIROCINANTE' });
  const [tir, setTir] = useState({ tipo: 'EXTRACURRICULARE', pf_stato: 'DA_RICHIEDERE' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const sites = useApi('/work-sites');
  const people = useApi('/resources?status=ATTIVO,IMPEGNO');
  const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/resources', { person: clean({ ...person, kind: 'TIROCINANTE', status: 'ATTIVO' }), tirocinio: clean(tir) });
      toast('Tirocinante inserito nell\'anagrafica unica'); nav(`${BASE}/risorse/${r.id}`);
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Nuovo tirocinante</h1><div className="sub">Convenzione con l'ente promotore, progetto formativo individuale, tutor aziendale. Il tirocinio non è un rapporto di lavoro: niente CCNL, RAL o busta paga.</div></div></div>
      <ErrorBox error={err} />
      <Card title="Anagrafica"><PersonForm value={person} onChange={setPerson} kind="TIROCINANTE" /></Card>
      <Card title="Tirocinio"><TirocinioForm value={tir} onChange={setTir} sites={sites.data || []} people={people.data || []} nuovo /></Card>
      <div className="row end" style={{ marginTop: 16 }}><button className="btn lg" disabled={busy || !person.last_name || !person.first_name} onClick={save}>{busy ? 'Salvataggio…' : 'Salva il tirocinante'}</button></div>
    </div>
  );
}
