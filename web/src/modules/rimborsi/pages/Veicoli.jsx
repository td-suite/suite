// Veicoli e fuel card: i veicoli PROPRI del dipendente (marca, modello, targa, tariffa EUR/km dalle tabelle ACI con la fonte) e, in sola
// lettura, la vettura aziendale e le fuel card assegnate in Contratti del personale (le inserisce P&C).
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Modal, Field, ErrorBox, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi } from '../api.js';
import { ModuliCartacei } from '../components.jsx';
import { tariffa, itData } from '../format.js';

export default function Veicoli() {
  const toast = useToast();
  const d = useApi('/veicoli');
  const [modal, setModal] = useState(null);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { veicoli, benefit, tariffa_default: td } = d.data;
  const vett = benefit.vetture.filter((v) => v.in_corso);
  return (
    <div className="page rs-page">
      <PageHead title="Veicoli e fuel card" icon="key" sub="Il veicolo proprio serve al rimborso chilometrico (MOD029): la tariffa EUR/km si prende dalle tabelle ACI per marca, modello e alimentazione." />
      {vett.length > 0 && <div className="alert info rs-gap"><Icon name="info" /><span>Hai una vettura aziendale: i chilometri non sono rimborsabili. I veicoli propri restano per i mesi senza vettura.</span></div>}
      <Card className="rs-gap" title="I miei veicoli" icon="key" actions={<button className="btn sm" onClick={() => setModal({})}><Icon name="plus" />Aggiungi veicolo</button>}>
        {!veicoli.length ? <Empty compact icon="key">Nessun veicolo. Aggiungilo per registrare i viaggi con l'auto propria.</Empty> : (
          <div className="rs-veicoli">{veicoli.map((v) => (
            <div key={v.id} className={`rs-veicolo ${v.attivo ? '' : 'off'}`}>
              <div><strong>{v.marca} {v.modello}</strong> · {v.targa}{v.alimentazione ? ` · ${v.alimentazione}` : ''}{!v.attivo && ' · non più in uso'}</div>
              <div className={!td?.unica && v.tariffa == null ? 'rs-warn small' : 'small'}>{td?.unica ? `Tariffa unica aziendale: ${tariffa(td.tariffa)}` : v.tariffa == null ? `Tariffa EUR/km mancante${td ? `: vale la predefinita di P&C (${tariffa(td.tariffa)})` : ': senza tariffa i viaggi non si inviano'}` : `${tariffa(v.tariffa)} · fonte: ${v.tariffa_fonte}`}</div>
              <button className="btn sm ghost" onClick={() => setModal(v)}><Icon name="edit" />Modifica</button>
            </div>))}</div>)}
      </Card>
      <Card className="rs-gap" title="La tua vettura aziendale e le tue fuel card" icon="building">
        {!benefit.vetture.length && !benefit.fuel_card.length && <div className="small muted">Nessuna vettura aziendale e nessuna fuel card assegnate in Contratti del personale.</div>}
        {benefit.vetture.map((v) => <div key={v.id} className="rs-benefit"><strong>{v.marca} {v.modello}</strong> · targa {v.targa}{v.alimentazione ? ` · ${v.alimentazione}` : ''}{v.uso_promiscuo ? ' · uso promiscuo' : ''}<div className="small muted">dal {itData(v.dal)}{v.al ? ` al ${itData(v.al)}` : ''}{v.in_corso ? '' : ' · non in corso'}</div></div>)}
        {benefit.fuel_card.map((f) => <div key={f.id} className="rs-benefit"><strong>Fuel card {f.circuito}</strong> · {f.numero}{f.vettura_targa ? ` · per ${f.vettura_targa}` : ''}<div className="small muted">dal {itData(f.dal)}{f.al ? ` al ${itData(f.al)}` : ''}{f.in_corso ? '' : ' · non in corso'} · il PIN non si registra nella Suite</div></div>)}
      </Card>
      <Card title="Modulistica cartacea" icon="file"><ModuliCartacei /></Card>
      {modal && <VeicoloModal v={modal} unica={td?.unica ? td.tariffa : null} onClose={() => setModal(null)} onOk={() => { setModal(null); d.reload(); toast('Veicolo salvato'); }} />}
    </div>
  );
}

function VeicoloModal({ v, unica, onClose, onOk }) {
  const [x, setX] = useState({ marca: v.marca || '', modello: v.modello || '', targa: v.targa || '', alimentazione: v.alimentazione || '', tariffa: v.tariffa != null ? String(v.tariffa).replace('.', ',') : '', tariffa_fonte: v.tariffa_fonte || '', attivo: v.attivo !== false });
  const [err, setErr] = useState(null);
  const s = (k, y) => setX((o) => ({ ...o, [k]: y }));
  const go = async () => { try { if (v.id) await api.put(`/veicoli/${v.id}`, x); else await api.post('/veicoli', x); onOk(); } catch (e) { setErr(e); } };
  const elimina = async () => { try { await api.del(`/veicoli/${v.id}`); onOk(); } catch (e) { setErr(e); } };
  return (
    <Modal title={v.id ? 'Modifica veicolo' : 'Nuovo veicolo'} onClose={onClose} footer={<>{v.id && <button className="btn danger" onClick={elimina}>Elimina</button>}<span className="spacer" /><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!x.marca || !x.modello || x.targa.length < 4} onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="rs-form">
        <div className="rs-tre">
          <Field label="Marca" required><input value={x.marca} onChange={(e) => s('marca', e.target.value)} /></Field>
          <Field label="Modello" required><input value={x.modello} onChange={(e) => s('modello', e.target.value)} /></Field>
          <Field label="Targa" required><input value={x.targa} onChange={(e) => s('targa', e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="rs-tre">
          <Field label="Alimentazione"><input value={x.alimentazione} placeholder="es. Benzina" onChange={(e) => s('alimentazione', e.target.value)} /></Field>
{unica ? <div className="span-all small muted">Tariffa chilometrica unica aziendale: {tariffa(unica)} per ogni veicolo.</div> : <>          <Field label="Tariffa ACI (EUR/km)" help="Dalle tabelle ACI dell'anno"><input inputMode="decimal" value={x.tariffa} placeholder="es. 0,4567" onChange={(e) => s('tariffa', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Fonte della tariffa" required={Boolean(x.tariffa)}><input value={x.tariffa_fonte} placeholder="tabelle ACI anno, modello" onChange={(e) => s('tariffa_fonte', e.target.value)} /></Field></>}
        </div>
        <label className="f inline"><input type="checkbox" checked={x.attivo} onChange={(e) => s('attivo', e.target.checked)} />Veicolo in uso</label>
      </div>
    </Modal>
  );
}
