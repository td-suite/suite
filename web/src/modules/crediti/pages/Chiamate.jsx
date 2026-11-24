// Chiamate del referente commerciale (fase a +35 giorni): copione del memo ed esito registrato. L'esito decide cosa succede dopo.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Tabs, Modal, Field, ErrorBox } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { Modalita, LinkCliente, api } from '../components.jsx';
import { useAuth } from '../auth.jsx';
import { eur, itData, itDataOra, oggiIso, ESITO } from '../format.js';

export function EsitoChiamata({ orgId, cliente, attivitaId = null, onClose, onFatto }) {
  const [v, setV] = useState({ data: oggiIso(), esito: '', interlocutore: '', nota: '', impegno_data: '', impegno_importo: '', prossima_azione: '' });
  const [rate, setRate] = useState([{ data: '', importo: '' }]); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const { state } = useAuth();
  const go = async () => { setBusy(true); setErr(null); try { await api.post('/chiamate', { organization_id: orgId, attivita_id: attivitaId, ...v, rate: v.esito === 'PIANO_RIENTRO' ? rate.filter((r) => r.data && r.importo) : undefined }); window.dispatchEvent(new Event('suite:badges')); await onFatto?.(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal wide title={`Esito della chiamata a ${cliente}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !v.esito} onClick={go}>Registra l'esito</button></>}>
      <ErrorBox error={err} />
      <details style={{ marginBottom: 12 }}><summary className="strong">Traccia della chiamata</summary><div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{state?.traccia_chiamata}</div></details>
      <div className="form-grid">
        <Field label="Data della chiamata" required><input type="date" value={v.data} max={oggiIso()} onChange={set('data')} /></Field>
        <Field label="Con chi hai parlato"><input value={v.interlocutore} onChange={set('interlocutore')} /></Field>
        <Field label="Esito" required><select value={v.esito} onChange={set('esito')}><option value="">Scegli</option>{Object.entries(ESITO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {v.esito === 'PAGAMENTO_PROMESSO' && <><Field label="Pagamento entro il" required><input type="date" value={v.impegno_data} min={oggiIso()} onChange={set('impegno_data')} /></Field><Field label="Importo promesso (vuoto: tutto lo scaduto)"><input type="number" step="0.01" value={v.impegno_importo} onChange={set('impegno_importo')} /></Field></>}
      </div>
      {v.esito === 'PIANO_RIENTRO' && <div style={{ margin: '8px 0' }}><div className="strong small">Rate proposte dal cliente (il piano va approvato dal Responsabile Amministrazione e Finanza)</div>
        {rate.map((r, i) => <div key={i} className="cr-riga-f"><input type="date" value={r.data} min={oggiIso()} onChange={(e) => setRate(rate.map((y, j) => (j === i ? { ...y, data: e.target.value } : y)))} aria-label="Data della rata" /><input type="number" step="0.01" placeholder="Importo" value={r.importo} onChange={(e) => setRate(rate.map((y, j) => (j === i ? { ...y, importo: e.target.value } : y)))} aria-label="Importo della rata" />{rate.length > 1 && <button className="btn sm ghost" onClick={() => setRate(rate.filter((_, j) => j !== i))}>Togli</button>}</div>)}
        <button className="btn sm ghost" onClick={() => setRate([...rate, { data: '', importo: '' }])}>Aggiungi una rata</button></div>}
      <div className="form-grid"><Field label={v.esito === 'CONTESTAZIONE' ? 'Cosa contesta il cliente' : 'Note'} required={v.esito === 'CONTESTAZIONE'} className="span2"><textarea value={v.nota} onChange={set('nota')} /></Field><Field label="Prossima azione" className="span2"><input value={v.prossima_azione} onChange={set('prossima_azione')} /></Field></div>
      <p className="small muted">{v.esito === 'PAGAMENTO_PROMESSO' ? 'La scala resta sospesa fino alla data promessa; se l\'incasso non arriva riprende da sola.' : v.esito === 'PIANO_RIENTRO' ? 'Finché il piano non è approvato o respinto la scala resta sospesa.' : v.esito === 'CONTESTAZIONE' ? 'Le fatture della chiamata escono dalla scala: gestione eccezioni dell\'Amministrazione.' : v.esito === 'NESSUN_RISCONTRO' ? 'Senza un impegno entro i giorni lavorativi previsti la posizione viene proposta all\'area legale, che parte solo su autorizzazione.' : ''}</p>
    </Modal>
  );
}

export default function Chiamate() {
  const [stato, setStato] = useState('APERTE'); const d = useApi(`/attivita?stato=${stato}`, [stato]); const [m, setM] = useState(null);
  const righe = d.data?.righe || [];
  return (
    <div className="page">
      <PageHead title="Chiamate di recupero" icon="phone" sub="Dopo due solleciti scritti senza riscontro il cliente viene chiamato dal suo referente commerciale. L'esito va sempre registrato: è lui a decidere il passo successivo." />
      <Modalita />
      <Tabs value={stato} onChange={setStato} items={[{ value: 'APERTE', label: 'Da fare' }, { value: 'FATTE', label: 'Fatte' }]} />
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : (
        <Card flush>{righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th className="num">Scaduto</th><th>Entro</th><th>Referente</th><th></th></tr></thead>
          <tbody>{righe.map((a) => <tr key={a.id}><td><LinkCliente id={a.organization_id}>{a.cliente}</LinkCliente><div className="small muted">{a.fattura_ids.length} {a.fattura_ids.length === 1 ? 'fattura' : 'fatture'} · assegnata il {itDataOra(a.creata_at)}</div></td><td className="num strong">{eur(a.totale)}</td>
            <td>{itData(a.entro)}{a.in_ritardo && <div className="small cr-rosso">in ritardo</div>}{a.simulata && <div><Badge tone="grey">Prova</Badge></div>}</td><td>{a.assegnata_a || <span className="cr-rosso">nessun referente</span>}</td>
            <td>{a.stato === 'APERTA' ? <button className="btn sm" onClick={() => setM(a)}>Registra l'esito</button> : <span className="small muted">chiusa il {itDataOra(a.chiusa_at)}</span>}</td></tr>)}</tbody></table></div> : <Empty compact icon="check">{stato === 'APERTE' ? 'Nessuna chiamata da fare' : 'Nessuna chiamata registrata'}</Empty>}</Card>)}
      {m && <EsitoChiamata orgId={m.organization_id} cliente={m.cliente} attivitaId={m.id} onClose={() => setM(null)} onFatto={d.reload} />}
    </div>
  );
}
