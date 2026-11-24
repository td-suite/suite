// Solleciti: comunicazioni in attesa di una persona (con il motivo), inviate, simulate in Prova, PEC da inviare. Il 2° sollecito lo
// approvano solo CFO e CEO. All'approvazione il testo si riscrive sulle fatture ancora aperte in quel momento.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Loading, Empty, PageHead, Badge, Tabs, Modal, Field, ErrorBox, CopyButton } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modalita, LinkCliente, useAzione, api, Modulo } from '../components.jsx';
import { eur, itDataOra, FASE, STATO_COM } from '../format.js';

export function Testo({ id }) {
  const d = useApi(`/comunicazioni/${id}`, [id]);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const k = d.data;
  return (
    <div>
      <dl className="cr-kv" style={{ marginBottom: 12 }}>
        <dt>Cliente</dt><dd>{k.cliente}</dd><dt>Fase</dt><dd>{k.fase_label} · <Badge tone={STATO_COM[k.stato]?.tone}>{STATO_COM[k.stato]?.label}</Badge></dd>
        <dt>A</dt><dd>{k.destinatari || <span className="cr-rosso">nessun destinatario</span>}{k.cc ? ` · in copia ${k.cc}` : ''}</dd><dt>Oggetto</dt><dd>{k.oggetto}</dd>
        {k.motivo_attesa && <><dt>Nota</dt><dd className="cr-motivo">{k.motivo_attesa}</dd></>}
        {k.pec_indirizzo && <><dt>PEC</dt><dd>{k.pec_indirizzo} · {k.pec_stato === 'INVIATA' ? `inviata il ${itDataOra(k.pec_at)}` : k.pec_stato === 'DA_INVIARE' ? 'da inviare dalla casella PEC aziendale' : 'non prevista'}</dd></>}
      </dl>
      <div className="cr-testo">{k.corpo_testo}</div>
      <div className="cr-azioni" style={{ marginTop: 10 }}><CopyButton text={`${k.oggetto}\n\n${k.corpo_testo}`} label="Copia oggetto e testo" /></div>
      <p className="small muted">Fatture: {k.fatture.map((f) => `n. ${f.numero} (${eur(f.residuo)}${['APERTA', 'PARZIALE'].includes(f.stato) ? '' : ', nel frattempo chiusa'})`).join(', ')}</p>
    </div>
  );
}

function Approva({ k, onClose, onFatto }) {
  const [to, setTo] = useState(k.destinatari || ''); const [cc, setCc] = useState(k.cc || ''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { const r = await api.post(`/comunicazioni/${k.id}/approva`, { destinatari: to, cc }); window.dispatchEvent(new Event('suite:badges')); await onFatto(r); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal wide title={`${FASE[k.fase]} a ${k.cliente}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn" disabled={busy || !to.trim()} onClick={go}>{k.fase === 3 ? 'Firma e invia' : 'Approva e invia'}</button></>}>
      <ErrorBox error={err} />
      {k.motivo_attesa && <div className="alert warn" style={{ marginBottom: 12 }}><span>In attesa perché: {k.motivo_attesa}. Approvando dichiari di avere verificato.</span></div>}
      <div className="form-grid"><Field label="Destinatari"><input value={to} onChange={(e) => setTo(e.target.value)} /></Field><Field label="In copia"><input value={cc} onChange={(e) => setCc(e.target.value)} /></Field></div>
      <Testo id={k.id} />
      <p className="small muted">All'invio il testo viene riscritto sulle sole fatture ancora aperte e non contestate. Se sono tutte incassate la comunicazione si annulla da sola.</p>
    </Modal>
  );
}

export default function Comunicazioni() {
  const [sp, setSp] = useSearchParams(); const stato = sp.get('stato') || 'DA_APPROVARE';
  const d = useApi(`/comunicazioni?stato=${stato}`, [stato]); const { user } = useAuth(); const az = useAzione(d.reload); const [m, setM] = useState(null);
  const righe = d.data?.righe || [];
  return (
    <div className="page">
      <PageHead title="Solleciti" icon="mail" sub="Avviso di scadenza e 1° sollecito partono da soli quando gli incassi sono verificati. Qui trovi quelli che aspettano una persona e il 2° sollecito, che porta la firma del Responsabile Amministrazione e Finanza." />
      <Modalita />
      <Tabs value={stato} onChange={(v) => setSp({ stato: v })} items={[{ value: 'DA_APPROVARE', label: 'In attesa' }, { value: 'PEC', label: 'PEC da inviare' }, { value: 'INVIATE', label: 'Inviate' }, { value: 'SIMULATE', label: 'Prova' }, { value: 'FALLITE', label: 'Non riuscite' }, { value: 'ANNULLATE', label: 'Annullate' }]} />
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : (
        <Card flush>
          {righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th>Fase</th><th className="num">Importo</th><th>Destinatari</th><th>{stato === 'INVIATE' ? 'Inviata' : 'Preparata'}</th><th></th></tr></thead>
            <tbody>{righe.map((k) => (
              <tr key={k.id}>
                <td><LinkCliente id={k.organization_id}>{k.cliente}</LinkCliente><div className="small muted">{k.fatture} {k.fatture === 1 ? 'fattura' : 'fatture'}</div></td>
                <td>{FASE[k.fase]}{k.fase === 3 && stato === 'DA_APPROVARE' && <div className="small cr-rosso">firma di CFO o CEO</div>}{k.motivo_attesa && <div className="cr-motivo">{k.motivo_attesa}</div>}{k.errore && <div className="small cr-rosso">{k.errore}</div>}</td>
                <td className="num strong">{eur(k.totale)}</td><td className="small">{k.destinatari || <span className="cr-rosso">nessuno</span>}{stato === 'PEC' && <div>PEC: {k.pec_indirizzo}</div>}</td>
                <td className="small">{itDataOra(k.inviata_at || k.creata_at)}{k.approvata_da && <div className="muted">approvata da {k.approvata_da}</div>}{!k.approvata_da && k.inviata_at && <div className="muted">automatica</div>}{k.stato === 'REGISTRATA' && <div className="cr-rosso">solo registrata: posta non attiva</div>}</td>
                <td><div className="cr-azioni">
                  <button className="btn sm ghost" onClick={() => setM({ t: 'vedi', k })}>Testo</button>
                  {['DA_APPROVARE', 'FALLITE'].includes(stato) && user.opera && (k.fase !== 3 || user.dirige) && <button className="btn sm" onClick={() => setM({ t: 'approva', k })}>{k.fase === 3 ? 'Firma e invia' : stato === 'FALLITE' ? 'Riprova' : 'Approva'}</button>}
                  {['DA_APPROVARE', 'FALLITE', 'SIMULATE'].includes(stato) && user.opera && <button className="btn sm ghost" onClick={() => setM({ t: 'annulla', k })}>Annulla</button>}
                  {stato === 'PEC' && user.opera && <button className="btn sm" disabled={az.busy} onClick={() => az.fai(() => api.post(`/comunicazioni/${k.id}/pec`, {}), 'Invio PEC registrato')}>PEC inviata</button>}
                </div></td>
              </tr>))}</tbody></table></div> : <Empty compact icon="check">{stato === 'DA_APPROVARE' ? 'Nessuna comunicazione in attesa' : stato === 'PEC' ? 'Nessuna PEC da inviare' : 'Nessuna comunicazione'}</Empty>}
        </Card>)}
      {stato === 'PEC' && <p className="small muted">La PEC non parte dalla Suite: apri il testo, copialo, invialo dalla casella PEC aziendale e poi registra qui l'invio.</p>}
      {m?.t === 'vedi' && <Modal wide title="Comunicazione" onClose={() => setM(null)}><Testo id={m.k.id} /></Modal>}
      {m?.t === 'approva' && <Approva k={m.k} onClose={() => setM(null)} onFatto={() => d.reload()} />}
      {m?.t === 'annulla' && <Modulo title="Annulla la comunicazione" onClose={() => setM(null)} campi={[{ k: 'motivo', label: 'Motivo', required: true }]} onConfirm={(v) => api.post(`/comunicazioni/${m.k.id}/annulla`, v).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
    </div>
  );
}
