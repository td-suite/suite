// Business Hub · "Scrivi al cliente" dalla casella della linea (scheda account): destinatari dai referenti e dagli indirizzi della Legal
// entity, allegati dai documenti dell'account e dei contratti, riepilogo prima dell'invio con le copie fisse, conferma. Usato anche da
// "Invia per la firma" della revisione del listino/offerta (components/Listino.jsx) con oggetto, testo e PDF già pronti.
import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, Icon, useToast } from './ui.jsx';
import { bytes } from '../format.js';

export default function ScriviCliente({ a, onClose, onDone, iniziale = null, extra = null, titolo = null }) {
  const toast = useToast();
  const conEmail = a.contatti.filter((c) => c.email);
  // iniziale: oggetto, testo e documenti già scelti (es. "Invia per la firma" dell'offerta economica rivista); extra: campi in più per
  // l'invio (sottotipo e listino della revisione), così l'email resta nel diario con il suo sottotipo
  const [f, setF] = useState({ to: conEmail.filter((c) => c.principale).map((c) => c.email), altri: '', cc_extra: '', subject: iniziale?.subject || '', testo: iniziale?.testo || '', documenti: iniziale?.documenti || [], contract_files: [] });
  const [riep, setRiep] = useState(null);
  const [busy, setBusy] = useState(false);
  const cf = useMemo(() => a.contratti.flatMap((c) => (c.files || []).map((x) => ({ ...x, c }))), [a]);
  const body = () => ({ to: [...f.to, ...f.altri.split(/[,;\s]+/).filter(Boolean)], cc_extra: f.cc_extra.split(/[,;\s]+/).filter(Boolean), subject: f.subject, testo: f.testo, documenti: f.documenti, contract_files: f.contract_files, ...(extra || {}) });
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const anteprima = async () => { setBusy(true); try { setRiep(await api.post(`/hub/accounts/${a.id}/email/anteprima`, body())); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const invia = async () => { setBusy(true); try { const r = await api.post(`/hub/accounts/${a.id}/email/invia`, { ...body(), conferma: true }); toast(r.stato === 'FALLITO' ? `Invio non riuscito: ${r.errore}` : r.stato === 'REGISTRATO' ? 'Email registrata (posta in modalità registro)' : 'Email inviata e registrata nel diario', r.stato === 'FALLITO' ? 'err' : 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  if (riep) return (
    <Modal wide title="Conferma l'invio" onClose={onClose} footer={<><button className="btn ghost" onClick={() => setRiep(null)}>Torna al messaggio</button><button className="btn" disabled={busy} onClick={invia}><Icon name="mail" />{busy ? 'Invio…' : 'Conferma e invia'}</button></>}>
      <table className="t"><tbody>
        <tr><td className="muted">Mittente</td><td className="strong">{riep.from}</td></tr>
        <tr><td className="muted">Destinatari</td><td>{riep.to.join(', ')}</td></tr>
        <tr><td className="muted">Copie fisse (sempre presenti)</td><td>{riep.cc_fissi.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Copie</td><td>{riep.cc.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Oggetto</td><td>{riep.subject}</td></tr>
        <tr><td className="muted">Allegati</td><td>{riep.allegati.length ? riep.allegati.map((x) => `${x.filename} (${bytes(x.size)})`).join(', ') : 'nessuno'}</td></tr>
      </tbody></table>
      {riep.avvisi.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>{riep.avvisi.join(' · ')}</div>}
      <div className="small muted" style={{ marginTop: 10 }}>L'email resta nel diario dell'account con l'esito dell'invio e nel registro invii.</div>
    </Modal>
  );
  return (
    <Modal wide title={titolo || `Scrivi al cliente · da ${a.casella}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={anteprima}>Riepilogo prima dell'invio</button></>}>
      <div className="form-grid">
        <div className="span2"><div className="row" style={{ justifyContent: 'space-between' }}><div className="small strong muted">Destinatari dai referenti</div>{conEmail.length > 1 && <button className="btn link small" onClick={() => setF((x) => ({ ...x, to: [...new Set([...x.to, ...conEmail.map((c) => c.email)])] }))}>Seleziona tutti</button>}</div>{conEmail.length ? conEmail.map((c) => <label key={c.id} className="f inline"><input type="checkbox" checked={f.to.includes(c.email)} onChange={() => toggle('to', c.email)} />{c.nome}{c.ruolo ? ` (${c.ruolo})` : ''} · {c.email}</label>) : <div className="small muted">Nessun referente con email: aggiungilo in Referenti o scrivi l'indirizzo qui sotto.</div>}
          {[a.org_email && { email: a.org_email, label: `${a.org_name} (email)` }, a.org_pec && { email: a.org_pec, label: `${a.org_name} (PEC)` }].filter((x) => x && !conEmail.some((c) => c.email.toLowerCase() === x.email.toLowerCase())).map((x) => <label key={x.email} className="f inline"><input type="checkbox" checked={f.to.includes(x.email)} onChange={() => toggle('to', x.email)} />{x.label} · {x.email}</label>)}</div>
        <Field label="Altri destinatari"><input value={f.altri} onChange={(e) => setF({ ...f, altri: e.target.value })} placeholder="indirizzi separati da virgola" /></Field>
        <Field label="Altre copie (oltre a quelle fisse)"><input value={f.cc_extra} onChange={(e) => setF({ ...f, cc_extra: e.target.value })} /></Field>
        <Field label="Oggetto" className="span2"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Testo" className="span2"><textarea style={{ minHeight: 180 }} value={f.testo} onChange={(e) => setF({ ...f, testo: e.target.value })} /></Field>
        {(a.documenti.length > 0 || cf.length > 0) && <div className="span2"><div className="small strong muted">Allegati</div>
          {a.documenti.map((d) => <label key={`d${d.id}`} className="f inline"><input type="checkbox" checked={f.documenti.includes(d.id)} onChange={() => toggle('documenti', d.id)} />{d.filename} <span className="small muted">({bytes(d.size)}, documenti dell'account)</span></label>)}
          {cf.map((x) => <label key={`c${x.id}`} className="f inline"><input type="checkbox" checked={f.contract_files.includes(x.id)} onChange={() => toggle('contract_files', x.id)} />{x.filename} <span className="small muted">({bytes(x.size)}, {x.c.protocol || x.c.title})</span></label>)}
        </div>}
      </div>
    </Modal>
  );
}
