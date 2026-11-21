// Non conformità · Le mie azioni (v0.93.0): le azioni correttive e preventive di cui la persona è responsabile. Da qui aggiorna lo
// stato (pianificata, in corso, completata) e scrive una nota; chi ha assegnato l'azione e la Qualità ricevono l'avviso.
// Chi entra solo per questo (profilo implicito AZIONI) vede della NC codice, tipologia e sede: nessun dato dell'accettazione.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Badge, Empty, Modal, Field, useToast } from '../components/ui.jsx';
import { AZ_STATO, itDate } from '../format.js';

export default function MieAzioni() {
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [mod, setMod] = useState(null);
  const [f, setF] = useState({ stato: '', nota: '' });
  const [chiuse, setChiuse] = useState(false);
  const carica = () => api.get('/mie-azioni').then((r) => { setD(r); setErr(null); }).catch(setErr);
  useEffect(() => { carica(); }, []);
  const apri = (a) => { setF({ stato: a.stato, nota: '' }); setMod(a); };
  const salva = async () => {
    try {
      await api.put(`/mie-azioni/${mod.id}`, { stato: f.stato, ...(f.nota.trim() ? { nota: f.nota.trim() } : {}) });
      toast('Aggiornamento salvato'); setMod(null); carica(); window.dispatchEvent(new Event('suite:badges'));
    } catch (e) { toast(e.message, 'err'); }
  };
  const aperte = (d?.righe || []).filter((a) => ['PIANIFICATA', 'IN_CORSO'].includes(a.stato));
  const altre = (d?.righe || []).filter((a) => !['PIANIFICATA', 'IN_CORSO'].includes(a.stato));
  const vedeNc = user?.role !== 'AZIONI';
  const Riga = ({ a }) => (
    <tr data-testid="mia-azione">
      <td style={{ whiteSpace: 'nowrap' }}>{a.scadenza ? <b className={a.scaduta ? 'sla-over' : ''} style={a.scaduta ? { color: '#B3261E' } : undefined}>{itDate(a.scadenza)}</b> : <span className="muted">senza scadenza</span>}{a.scaduta && <div className="small" style={{ color: '#B3261E' }}>scaduta</div>}</td>
      <td><div className="small"><Badge tone={a.tipo === 'CORRETTIVA' ? 'teal' : 'blue'}>{a.tipo === 'CORRETTIVA' ? 'Correttiva' : 'Preventiva'}</Badge> {vedeNc ? <Link to={`${base}/nc/${a.nc_id}`} className="mono">{a.nc_codice}</Link> : <span className="mono">{a.nc_codice}</span>}</div>
        <div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{a.descrizione}</div>
        <div className="small muted">{[a.nc_tipo, a.sede, a.assegnata_da ? `assegnata da ${a.assegnata_da}` : null].filter(Boolean).join(' · ')}</div>
        {a.note && <div className="small" style={{ marginTop: 4 }}><b>Note:</b> {a.note}</div>}
        {a.resp_nota && <div className="small" style={{ marginTop: 4 }}><b>Il tuo ultimo aggiornamento{a.resp_aggiornata_at ? ` (${itDate(a.resp_aggiornata_at)})` : ''}:</b> {a.resp_nota}</div>}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><Badge tone={AZ_STATO[a.stato].tone}>{AZ_STATO[a.stato].label}</Badge>
        {a.stato !== 'ANNULLATA' && <div style={{ marginTop: 6 }}><button className="btn sm" data-testid="mia-aggiorna" onClick={() => apri(a)}>Aggiorna</button></div>}</td>
    </tr>
  );
  return (
    <div className="page">
      <div className="page-head"><div><h1>Le mie azioni</h1><div className="sub">Azioni correttive e preventive delle non conformità di cui sei responsabile. Aggiorna lo stato quando inizi e quando hai completato.</div></div></div>
      {err && <div className="alert err">{err.message}</div>}
      {!d ? <Card><Empty>Caricamento…</Empty></Card> : <>
        <Card title={`Da fare · ${aperte.length}`} flush>
          {!aperte.length ? <Empty>Nessuna azione da fare.</Empty> : <table className="t"><thead><tr><th>Scadenza</th><th>Azione</th><th style={{ textAlign: 'right' }}>Stato</th></tr></thead><tbody>{aperte.map((a) => <Riga key={a.id} a={a} />)}</tbody></table>}
        </Card>
        {altre.length > 0 && <div style={{ marginTop: 14 }}>
          <button className="btn ghost sm" onClick={() => setChiuse(!chiuse)}>{chiuse ? 'Nascondi' : 'Mostra'} le azioni chiuse ({altre.length})</button>
          {chiuse && <div style={{ marginTop: 10 }}><Card title="Chiuse" flush><table className="t"><tbody>{altre.map((a) => <Riga key={a.id} a={a} />)}</tbody></table></Card></div>}
        </div>}
      </>}
      {mod && <Modal title={`Aggiorna l'azione · ${mod.nc_codice}`} onClose={() => setMod(null)} footer={<><button className="btn ghost" onClick={() => setMod(null)}>Annulla</button><button className="btn" data-testid="mia-salva" onClick={salva}>Salva</button></>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{mod.descrizione}</div>
          <div className="seg">{(d?.stati || []).map((s) => <label key={s} className={f.stato === s ? 'on' : ''}><input type="radio" checked={f.stato === s} onChange={() => setF({ ...f, stato: s })} />{AZ_STATO[s].label}</label>)}</div>
          <Field label="Nota di aggiornamento" help="Cosa è stato fatto, o cosa manca. La leggono chi ti ha assegnato l'azione e la Qualità."><textarea data-testid="mia-nota" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
