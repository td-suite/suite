// Incassi da abbinare: bonifici in entrata letti dalla banca. La Suite conferma da sola solo il caso certo (numero di fattura in causale e
// importo uguale al residuo); qui si confermano o si correggono le proposte e si abbinano a mano gli altri.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Empty, PageHead, Badge, Tabs, Modal, ErrorBox, SearchInput } from '../../../components/ui.jsx';
import { useApi, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modalita, LinkCliente, useAzione, api, Modulo } from '../components.jsx';
import { eur, itData, itDataOra } from '../format.js';

function Abbina({ mov, onClose, onFatto }) {
  const [q, setQ] = useState(mov.cliente || ''); const f = useApi(`/riconciliazione/fatture?cerca=${encodeURIComponent(q)}`, [q]);
  const [righe, setRighe] = useState(mov.righe.map((r) => ({ fattura_id: r.fattura_id, numero: r.numero, importo: r.importo, residuo: r.residuo_fattura })));
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const somma = righe.reduce((s, r) => s + Number(r.importo || 0), 0); const resto = Math.round((mov.importo - somma) * 100) / 100;
  const aggiungi = (x) => { if (righe.some((r) => r.fattura_id === x.id)) return; setRighe([...righe, { fattura_id: x.id, numero: x.numero, residuo: x.residuo, importo: Math.max(0, Math.min(x.residuo, resto)) }]); };
  const go = async () => { setBusy(true); setErr(null); try { await api.post(`/movimenti/${mov.id}/conferma`, { righe: righe.map((r) => ({ fattura_id: r.fattura_id, importo: Number(r.importo) })) }); window.dispatchEvent(new Event('suite:badges')); await onFatto(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal wide title={`Abbina il bonifico di ${eur(mov.importo)} del ${itData(mov.data)}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !righe.length || resto < -0.005} onClick={go}>Conferma l'abbinamento</button></>}>
      <ErrorBox error={err} />
      <p className="small"><strong>{mov.controparte || 'Ordinante non indicato'}</strong> · {mov.causale || 'senza causale'}</p>
      {righe.map((r, i) => <div key={r.fattura_id} className="cr-riga-f"><span className="strong">n. {r.numero}</span><span className="muted small">residuo {eur(r.residuo)}</span><input type="number" step="0.01" value={r.importo} onChange={(e) => setRighe(righe.map((y, j) => (j === i ? { ...y, importo: e.target.value } : y)))} aria-label="Importo attribuito" /><button className="btn sm ghost" onClick={() => setRighe(righe.filter((_, j) => j !== i))}>Togli</button></div>)}
      <p className={resto < -0.005 ? 'cr-rosso' : 'small muted'}>Attribuiti {eur(somma)} su {eur(mov.importo)}{resto > 0.005 ? `: restano ${eur(resto)} non attribuiti (acconto o pagamento in eccesso)` : resto < -0.005 ? ': più del bonifico' : ''}</p>
      <SearchInput value={q} onChange={setQ} placeholder="Cerca per cliente o numero di fattura" />
      <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}><table className="t"><tbody>{(f.data?.righe || []).map((x) => <tr key={x.id}><td>{x.cliente}</td><td className="strong">n. {x.numero}</td><td className="small">scad. {itData(x.scadenza)}</td><td className="num">{eur(x.residuo)}</td><td><button className="btn sm ghost" onClick={() => aggiungi(x)}>Aggiungi</button></td></tr>)}</tbody></table></div>
      <p className="small muted">Un bonifico si abbina alle fatture di un solo cliente.</p>
    </Modal>
  );
}

export default function Riconciliazione() {
  const [stato, setStato] = useState('PROPOSTO'); const d = useApi(`/riconciliazione?stato=${stato}`, [stato]); const { user } = useAuth(); const az = useAzione(d.reload); const [m, setM] = useState(null);
  const x = d.data; const b = x?.banca;
  return (
    <div className="page">
      <PageHead title="Incassi da abbinare" icon="check" sub="Bonifici in entrata letti dal conto collegato con Enable Banking, in sola lettura. Un bonifico riconosciuto e non ancora confermato ferma i solleciti automatici a quel cliente."
        actions={user.opera && <button className="btn ghost" disabled={az.busy} onClick={() => az.fai(() => api.post('/riconciliazione/esegui', {}), (r) => `${r.esaminati} movimenti esaminati: ${r.automatici} confermati da soli, ${r.proposti} proposte`)}>Riesamina i movimenti</button>} />
      <Modalita />
      {b && !b.aggiornata.ok && <div className="alert warn cr-gap"><span>{b.configurata ? `Movimenti non aggiornati: ${b.aggiornata.motivo}.` : 'Collegamento bancario non configurato sul server.'} <Link to={`${base}/banca`}>Conti bancari</Link></span></div>}
      {b?.aggiornata.ok && <p className="small muted">Movimenti letti il {itDataOra(b.aggiornata.ultimo)}.</p>}
      <Tabs value={stato} onChange={setStato} items={[{ value: 'PROPOSTO', label: 'Proposte', count: x?.conteggi.proposti }, { value: 'DA_ABBINARE', label: 'Senza abbinamento', count: x?.conteggi.da_abbinare }, { value: 'ABBINATO', label: 'Abbinati' }, { value: 'IGNORATO', label: 'Non sono fatture' }]} />
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !x ? <Loading /> : x.righe.length ? x.righe.map((r) => (
        <div key={r.id} className="cr-mov">
          <div className="h"><span className="imp">{eur(r.importo)}</span><span>{itData(r.data)}</span><span className="strong">{r.controparte || 'Ordinante non indicato'}</span>{r.cliente && <span className="small">cliente: <LinkCliente id={r.organization_id}>{r.cliente}</LinkCliente>{r.riconosciuto_per ? ` (${r.riconosciuto_per})` : ''}</span>}</div>
          <div className="caus">{r.causale || 'Senza causale'}</div>
          {r.righe.map((f) => <div key={f.fattura_id} className="cr-riga-f"><Badge tone={f.stato === 'CONFERMATO' ? 'green' : 'amber'}>{f.stato === 'CONFERMATO' ? (f.automatico ? 'Confermato da solo' : 'Confermato') : 'Proposta'}</Badge><span>fattura n. {f.numero} del {itData(f.data)}</span><span className="strong">{eur(f.importo)}</span>{f.stato !== 'CONFERMATO' && <span className="small muted">residuo {eur(f.residuo_fattura)}</span>}</div>)}
          {r.nota && <div className="small muted" style={{ marginTop: 4 }}>{r.nota}{r.residuo > 0 ? ` · non attribuiti ${eur(r.residuo)}` : ''}{r.utente ? ` · ${r.utente}` : ''}</div>}
          {user.opera && <div className="cr-azioni" style={{ marginTop: 8 }}>
            {stato === 'PROPOSTO' && <><button className="btn sm" disabled={az.busy} onClick={() => az.fai(() => api.post(`/movimenti/${r.id}/conferma`, {}), 'Incasso confermato')}>Conferma la proposta</button><button className="btn sm ghost" onClick={() => setM({ t: 'abbina', r })}>Correggi</button><button className="btn sm ghost" disabled={az.busy} onClick={() => az.fai(() => api.post(`/movimenti/${r.id}/rifiuta`, {}), 'Proposta rifiutata')}>Rifiuta</button></>}
            {stato === 'DA_ABBINARE' && <><button className="btn sm" onClick={() => setM({ t: 'abbina', r })}>Abbina a fatture</button><button className="btn sm ghost" onClick={() => setM({ t: 'ignora', r })}>Non è una fattura cliente</button></>}
            {['ABBINATO', 'IGNORATO'].includes(stato) && <button className="btn sm ghost" disabled={az.busy} onClick={() => az.fai(() => api.post(`/movimenti/${r.id}/annulla`, {}), 'Abbinamento annullato: il movimento torna da abbinare')}>Annulla</button>}
          </div>}
        </div>)) : <Empty icon="check">{stato === 'PROPOSTO' ? 'Nessuna proposta da confermare' : stato === 'DA_ABBINARE' ? 'Nessun bonifico senza abbinamento' : 'Nessun movimento'}</Empty>}
      {m?.t === 'abbina' && <Abbina mov={m.r} onClose={() => setM(null)} onFatto={d.reload} />}
      {m?.t === 'ignora' && <Modulo title="Il movimento non riguarda una fattura cliente" onClose={() => setM(null)} campi={[{ k: 'nota', label: 'Cos\'è (giroconto, incasso POS, rimborso...)', required: true }]} onConfirm={(v) => api.post(`/movimenti/${m.r.id}/ignora`, v).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
    </div>
  );
}
