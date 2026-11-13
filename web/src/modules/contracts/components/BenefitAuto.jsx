// Sezione "Benefit: vettura e fuel card" della scheda della persona (v0.72.0, richiesta del CEO del 13/11/2026). Solo P&C (profili
// Amministratore e Risorse umane) e il titolare. Le assegnazioni le legge il Rimborso Spese: con la vettura aziendale i chilometri non sono
// rimborsabili, il carburante pagato con la fuel card è una spesa non rimborsabile. Il numero della carta si salva per intero e si mostra
// mascherato (pulsante "Mostra"); il PIN non si registra mai. Nessun dato reale nel seme: targhe e numeri li inserisce il CEO.
import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, ErrorBox, Modal, Badge, ConfirmModal, useToast, Icon } from './ui.jsx';
import { itDate } from '../format.js';

const vuotaV = { marca: '', modello: '', targa: '', alimentazione: '', dal: '', al: '', uso_promiscuo: true, note: '' };
const vuotaF = { circuito: 'DKV', numero: '', dal: '', al: '', vettura_id: '', note: '' };

export default function BenefitAuto({ personId }) {
  const toast = useToast();
  const d = useApi(`/benefit/persona/${personId}`, [personId]);
  const [modal, setModal] = useState(null);
  const [mostra, setMostra] = useState({});
  if (d.error) return <Card title="Benefit: vettura e fuel card"><ErrorBox error={d.error} /></Card>;
  if (!d.data) return null;
  const { vetture, fuel_card: fuel } = d.data;
  return (
    <Card title="Benefit: vettura e fuel card" className="mt" actions={<div className="row">
      <button className="btn sm ghost" onClick={() => setModal({ tipo: 'V', v: vuotaV })}><Icon name="plus" />Vettura</button>
      <button className="btn sm ghost" onClick={() => setModal({ tipo: 'F', v: vuotaF })}><Icon name="plus" />Fuel card</button></div>}>
      <p className="small muted" style={{ marginTop: 0 }}>Letti dal Rimborso Spese: con la vettura aziendale i chilometri non sono rimborsabili; il carburante pagato con la fuel card si registra come spesa non rimborsabile. L'assegnazione aggiunge la voce al benefit del contratto. Il PIN della carta non si registra.</p>
      {!vetture.length && !fuel.length && <Empty>Nessuna vettura aziendale e nessuna fuel card assegnate</Empty>}
      {vetture.map((v) => (
        <div key={v.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px dashed var(--line)', padding: '6px 0' }}>
          <span><strong>{v.marca} {v.modello}</strong> · {v.targa}{v.alimentazione ? ` · ${v.alimentazione}` : ''}{v.uso_promiscuo ? ' · uso promiscuo' : ''} <span className="small muted">dal {itDate(v.dal)}{v.al ? ` al ${itDate(v.al)}` : ''}</span> {v.in_corso ? <Badge tone="green">in corso</Badge> : <Badge>non in corso</Badge>}</span>
          <span className="row"><button className="btn sm ghost" onClick={() => setModal({ tipo: 'V', v: { ...vuotaV, ...v, al: v.al || '', alimentazione: v.alimentazione || '', note: v.note || '' } })}>Modifica</button><button className="btn sm danger" onClick={() => setModal({ tipo: 'X', url: `/benefit/persona/${personId}/vetture/${v.id}`, testo: `${v.marca} ${v.modello} ${v.targa}` })}>Elimina</button></span>
        </div>))}
      {fuel.map((f) => (
        <div key={f.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px dashed var(--line)', padding: '6px 0' }}>
          <span><strong>Fuel card {f.circuito}</strong> · <span className="mono">{mostra[f.id] ? f.numero : f.numero_mascherato}</span> <button className="btn link small" onClick={() => setMostra((m) => ({ ...m, [f.id]: !m[f.id] }))}>{mostra[f.id] ? 'Nascondi' : 'Mostra'}</button>{f.vettura_targa ? ` · per ${f.vettura_targa}` : ''} <span className="small muted">dal {itDate(f.dal)}{f.al ? ` al ${itDate(f.al)}` : ''}</span> {f.in_corso ? <Badge tone="green">in corso</Badge> : <Badge>non in corso</Badge>}</span>
          <span className="row"><button className="btn sm ghost" onClick={() => setModal({ tipo: 'F', v: { ...vuotaF, ...f, numero: f.numero, al: f.al || '', vettura_id: f.vettura_id || '', note: f.note || '' } })}>Modifica</button><button className="btn sm danger" onClick={() => setModal({ tipo: 'X', url: `/benefit/persona/${personId}/fuel-card/${f.id}`, testo: `${f.circuito} ${f.numero_mascherato}` })}>Elimina</button></span>
        </div>))}
      {modal?.tipo === 'V' && <VetturaModal personId={personId} v={modal.v} onClose={() => setModal(null)} onOk={() => { setModal(null); d.reload(); toast('Vettura salvata'); }} />}
      {modal?.tipo === 'F' && <FuelModal personId={personId} v={modal.v} vetture={vetture} onClose={() => setModal(null)} onOk={() => { setModal(null); d.reload(); toast('Fuel card salvata'); }} />}
      {modal?.tipo === 'X' && <ConfirmModal title="Eliminare l'assegnazione?" text={`${modal.testo}. Per una restituzione indica piuttosto la data di fine.`} danger confirmText="Elimina" onConfirm={async () => { await api.del(modal.url); d.reload(); }} onClose={() => setModal(null)} />}
    </Card>
  );
}
const Empty = ({ children }) => <div className="small muted">{children}</div>;

function VetturaModal({ personId, v, onClose, onOk }) {
  const [x, setX] = useState(v);
  const [err, setErr] = useState(null);
  const s = (k, y) => setX((o) => ({ ...o, [k]: y }));
  const go = async () => {
    const b = { marca: x.marca, modello: x.modello, targa: x.targa, alimentazione: x.alimentazione || null, dal: x.dal, al: x.al || null, uso_promiscuo: Boolean(x.uso_promiscuo), note: x.note || null };
    try { if (v.id) await api.put(`/benefit/persona/${personId}/vetture/${v.id}`, b); else await api.post(`/benefit/persona/${personId}/vetture`, b); onOk(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title={v.id ? 'Modifica vettura aziendale' : 'Assegna una vettura aziendale'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!x.marca || !x.modello || x.targa.length < 4 || !x.dal} onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="grid g3">
        <Field label="Marca"><input value={x.marca} onChange={(e) => s('marca', e.target.value)} /></Field>
        <Field label="Modello"><input value={x.modello} onChange={(e) => s('modello', e.target.value)} /></Field>
        <Field label="Targa"><input value={x.targa} onChange={(e) => s('targa', e.target.value.toUpperCase())} /></Field>
        <Field label="Alimentazione"><input value={x.alimentazione} onChange={(e) => s('alimentazione', e.target.value)} /></Field>
        <Field label="Dal"><input type="date" value={x.dal} onChange={(e) => s('dal', e.target.value)} /></Field>
        <Field label="Al (restituzione)"><input type="date" value={x.al} onChange={(e) => s('al', e.target.value)} /></Field>
      </div>
      <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={Boolean(x.uso_promiscuo)} onChange={(e) => s('uso_promiscuo', e.target.checked)} />Uso promiscuo (anche personale)</label>
      <Field label="Note"><textarea rows={2} value={x.note} onChange={(e) => s('note', e.target.value)} /></Field>
    </Modal>
  );
}

function FuelModal({ personId, v, vetture, onClose, onOk }) {
  const [x, setX] = useState(v);
  const [err, setErr] = useState(null);
  const s = (k, y) => setX((o) => ({ ...o, [k]: y }));
  const go = async () => {
    const b = { circuito: x.circuito, numero: x.numero, dal: x.dal, al: x.al || null, vettura_id: x.vettura_id || null, note: x.note || null };
    try { if (v.id) await api.put(`/benefit/persona/${personId}/fuel-card/${v.id}`, b); else await api.post(`/benefit/persona/${personId}/fuel-card`, b); onOk(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title={v.id ? 'Modifica fuel card' : 'Assegna una fuel card'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!x.circuito || x.numero.replace(/\s/g, '').length < 8 || !x.dal} onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Field label="Circuito"><input value={x.circuito} onChange={(e) => s('circuito', e.target.value)} placeholder="es. DKV" /></Field>
        <Field label="Numero della carta" help="Per intero; il PIN non si registra"><input value={x.numero} inputMode="numeric" autoComplete="off" onChange={(e) => s('numero', e.target.value.replace(/[^\d\s]/g, ''))} /></Field>
        <Field label="Dal"><input type="date" value={x.dal} onChange={(e) => s('dal', e.target.value)} /></Field>
        <Field label="Al"><input type="date" value={x.al} onChange={(e) => s('al', e.target.value)} /></Field>
        <Field label="Vettura collegata"><select value={x.vettura_id} onChange={(e) => s('vettura_id', e.target.value)}><option value="">Nessuna</option>{vetture.map((y) => <option key={y.id} value={y.id}>{y.marca} {y.modello} {y.targa}</option>)}</select></Field>
      </div>
      <Field label="Note"><textarea rows={2} value={x.note} onChange={(e) => s('note', e.target.value)} /></Field>
    </Modal>
  );
}
