// Risposte dei clienti lette dalla casella dell'Amministrazione: classe, effetto applicato dalla Suite, gestione di una persona.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Tabs } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modalita, LinkCliente, useAzione, api, Modulo } from '../components.jsx';
import { itDataOra, FASE, CLASSE } from '../format.js';

export default function Risposte() {
  const [stato, setStato] = useState('DA_GESTIRE'); const d = useApi(`/risposte?stato=${stato}`, [stato]); const { user } = useAuth(); const az = useAzione(d.reload); const [m, setM] = useState(null);
  const righe = d.data?.righe || [];
  return (
    <div className="page">
      <PageHead title="Risposte dei clienti" icon="comment" sub={`Dalla casella ${d.data?.casella || ''}: solo i messaggi dei clienti con partite aperte o in risposta a un sollecito. Finché una risposta è da gestire, nessun sollecito parte da solo verso quel cliente.`}
        actions={user.opera && <button className="btn ghost" disabled={az.busy} onClick={() => az.fai(() => api.post('/casella/leggi', {}), (r) => (r.errore ? `Casella non letta: ${r.errore}` : r.skipped ? `Casella non letta: ${r.skipped}` : `${r.letti} messaggi letti, ${r.registrati} risposte nuove`))}>Leggi la casella ora</button>} />
      <Modalita />
      <Tabs value={stato} onChange={setStato} items={[{ value: 'DA_GESTIRE', label: 'Da gestire' }, { value: 'GESTITE', label: 'Gestite' }]} />
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : righe.length ? righe.map((r) => (
        <Card key={r.id} className="cr-gap" title={<>{r.cliente ? <LinkCliente id={r.organization_id}>{r.cliente}</LinkCliente> : r.da_email} <Badge tone={CLASSE[r.classe]?.tone}>{CLASSE[r.classe]?.label}</Badge></>}
          actions={stato === 'DA_GESTIRE' && user.opera && <div className="cr-azioni"><button className="btn sm ghost" onClick={() => setM({ t: 'classe', r })}>Cambia lettura</button><button className="btn sm" onClick={() => setM({ t: 'gestita', r })}>Gestita</button></div>}>
          <div className="small muted">{itDataOra(r.ricevuta_at)} · {r.da_nome ? `${r.da_nome} ` : ''}{r.da_email} · {r.oggetto}{r.fase ? ` · in risposta a: ${FASE[r.fase]}` : ''} · riconosciuta per {{ RIFERIMENTO: 'riferimento nell\'oggetto', MITTENTE: 'indirizzo del mittente', DOMINIO: 'dominio del mittente' }[r.abbinata_per]}</div>
          <p style={{ margin: '8px 0' }}><strong>{r.sintesi}</strong>{r.classificata_da === 'AI' ? <span className="small muted"> · lettura del modello, confidenza {Math.round(Number(r.confidenza) * 100)}%</span> : r.classificata_da === 'PERSONA' ? <span className="small muted"> · letta da una persona</span> : <span className="small muted"> · lettura per parole chiave</span>}</p>
          {r.effetto && <div className="alert info" style={{ marginBottom: 8 }}><span>{r.effetto}</span></div>}
          <div className="cr-testo" style={{ maxHeight: 200 }}>{r.anteprima}</div>
          {(r.allegati || []).length > 0 && <p className="small muted">Allegati nella casella: {r.allegati.map((a) => a.nome).join(', ')}</p>}
          {r.gestita_at && <p className="small muted">Gestita il {itDataOra(r.gestita_at)}{r.gestita_da ? ` da ${r.gestita_da}` : ''}{r.gestione_nota ? `: ${r.gestione_nota}` : ''}</p>}
        </Card>)) : <Empty icon="check">{stato === 'DA_GESTIRE' ? 'Nessuna risposta da gestire' : 'Nessuna risposta gestita'}</Empty>}
      {m?.t === 'gestita' && <Modulo title="Risposta gestita" onClose={() => setM(null)} intro="Da questo momento la risposta non ferma più i solleciti automatici al cliente." campi={[{ k: 'nota', label: 'Cosa è stato fatto', type: 'textarea' }]} onConfirm={(v) => api.post(`/risposte/${m.r.id}/gestita`, v).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
      {m?.t === 'classe' && <Modulo title="Cambia la lettura della risposta" onClose={() => setM(null)} iniziale={{ classe: m.r.classe, promessa_data: m.r.promessa_data || '' }} intro="La Suite applica l'effetto della nuova lettura: promessa con data sospende la scala; ha già pagato la sospende in attesa dell'incasso; contestazione toglie le fatture dalla scala."
        campi={[{ k: 'classe', label: 'Lettura', type: 'select', required: true, options: Object.entries(CLASSE).map(([k, v]) => [k, v.label]) }, { k: 'promessa_data', label: 'Data promessa (solo per la promessa)', type: 'date' }, { k: 'promessa_importo', label: 'Importo promesso', type: 'number' }]}
        onConfirm={(v) => api.put(`/risposte/${m.r.id}`, v).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
    </div>
  );
}
