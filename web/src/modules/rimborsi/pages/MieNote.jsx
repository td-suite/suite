// Le mie note spese: mese corrente in evidenza, pulsanti "Nuova spesa" (foto e tre campi) e "Nuovo viaggio" pensati per il telefono,
// elenco dei mesi con lo stato, vettura aziendale e fuel card assegnate (Contratti del personale), modulistica cartacea.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Empty, Loading, PageHead, Seg, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatoBadge, ModuliCartacei, SpesaModal, ViaggioModal } from '../components.jsx';
import { MESI, nomeMese, eur, oggiIso, itData, saldoTesto } from '../format.js';

export default function MieNote() {
  const { state } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [anno, setAnno] = useState(Number(oggiIso().slice(0, 4)));
  const d = useApi(`/mie-note?anno=${anno}`, [anno]);
  const cat = useApi('/categorie');
  const [modal, setModal] = useState(null);
  const [nuovoMese, setNuovoMese] = useState('');
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data;
  const cor = x.corrente;
  const ricarica = () => { d.reload(); window.dispatchEvent(new Event('suite:badges')); };
  const apriViaggio = async () => {
    try {
      const n = await api.post('/note', { anno: cor.anno, mese: cor.mese });
      if (n.stato !== 'BOZZA') { toast(`La nota di ${cor.titolo} è già inviata: il viaggio va nella nota del suo mese`, 'err'); return; }
      const v = await api.get('/veicoli');
      setModal({ tipo: 'viaggio', nota: { id: n.id, anno: cor.anno, mese: cor.mese }, veicoli: v.veicoli, vettura: v.benefit.vetture.find((y) => y.in_corso) || null, tariffaDefault: v.tariffa_default });
    } catch (e) { toast(e.message, 'err'); }
  };
  const mesiPassati = [];
  { let [y, m] = [cor.anno, cor.mese]; for (let i = 0; i < 12; i++) { mesiPassati.push({ anno: y, mese: m }); m -= 1; if (!m) { m = 12; y -= 1; } } }
  const creaMese = async () => {
    if (!nuovoMese) return;
    const [a, m] = nuovoMese.split('-').map(Number);
    try { const n = await api.post('/note', { anno: a, mese: m }); nav(`${base}/nota/${n.id}`); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page rs-page">
      <PageHead title="Le mie note spese" icon="doc"
        sub={x.persona.al_pc ? 'Le tue note vanno a P&C come secondo controllo (non hai un superiore in organigramma).' : `Le tue note le approva ${x.persona.approvatore || 'il tuo responsabile'} (${x.persona.origine}).`} />
      {x.avviso && <div className="alert info rs-gap"><Icon name="info" /><span>{x.avviso}</span></div>}

      <div className="rs-azioni-mobile">
        <button className="btn lg" onClick={() => setModal({ tipo: 'spesa' })}><Icon name="image" />Nuova spesa</button>
        <button className="btn lg ghost" onClick={apriViaggio}><Icon name="pin" />Nuovo viaggio</button>
      </div>

      <Card className="rs-corrente rs-gap" title={`Mese corrente · ${cor.titolo}`} icon="calendar"
        actions={cor.nota ? <Link className="btn sm" to={`${base}/nota/${cor.nota.id}`}>Apri la nota</Link> : null}>
        {cor.nota ? <div className="row"><StatoBadge stato={cor.nota.stato} /><span className="small muted">{(x.note.find((n) => n.id === cor.nota.id) || {}).n_spese || 0} spese · {(x.note.find((n) => n.id === cor.nota.id) || {}).n_viaggi || 0} viaggi · invio entro il {state.giorno_limite} del mese successivo</span></div>
          : <div className="small muted">Nessuna spesa registrata questo mese. Usa "Nuova spesa": scatti la foto dello scontrino e scrivi importo, categoria e data.</div>}
      </Card>

      {(x.vetture.length > 0 || x.fuel_card.length > 0) && <Card className="rs-gap" title="La tua vettura aziendale e le tue fuel card" icon="key">
        {x.vetture.map((v) => <div key={v.id} className="rs-benefit"><strong>{v.marca} {v.modello}</strong> · targa {v.targa}{v.uso_promiscuo ? ' · uso promiscuo' : ''}<div className="small muted">Dal {itData(v.dal)}{v.al ? ` al ${itData(v.al)}` : ''}: i chilometri non sono rimborsabili, registra solo i viaggi di servizio se ti servono.</div></div>)}
        {x.fuel_card.map((f) => <div key={f.id} className="rs-benefit"><strong>Fuel card {f.circuito}</strong> · {f.numero}<div className="small muted">Il carburante pagato con la carta si registra come spesa "Fuel card": non è rimborsabile, serve alla riconciliazione.</div></div>)}
      </Card>}

      <Card title="Le mie note" icon="list" className="rs-gap" actions={x.anni.length > 1 ? <Seg value={anno} onChange={setAnno} items={x.anni.map((a) => ({ value: a, label: String(a) }))} label="Anno" /> : null}>
        {!x.note.length ? <Empty compact icon="doc">Nessuna nota spese nel {anno}</Empty> : (
          <div className="rs-mesi">{x.note.map((n) => (
            <Link key={n.id} to={`${base}/nota/${n.id}`} className={`rs-mese ${n.anno === cor.anno && n.mese === cor.mese ? 'on' : ''}`}>
              <div className="t">{MESI[n.mese - 1]}</div>
              <StatoBadge stato={n.stato} />
              <div className="v">{eur(n.tot_rimborsabile)}</div>
              <div className="small muted">{n.n_spese} spese · {n.n_viaggi} viaggi{n.in_ritardo ? ' · inviata in ritardo' : ''}</div>
              {['LIQUIDATA', 'ARCHIVIATA'].includes(n.stato) ? <div className="small">Liquidata {eur(n.liquidazione_importo)} il {itData(n.liquidazione_data)}</div> : <div className="small muted">Saldo {eur(Math.abs(n.saldo))} {saldoTesto(n.saldo)}</div>}
            </Link>))}</div>
        )}
        <div className="row rs-nuovo-mese">
          <select value={nuovoMese} onChange={(e) => setNuovoMese(e.target.value)} aria-label="Mese della nota">
            <option value="">Apri la nota di un altro mese</option>
            {mesiPassati.map((m) => <option key={`${m.anno}-${m.mese}`} value={`${m.anno}-${m.mese}`}>{nomeMese(m.anno, m.mese)}</option>)}
          </select>
          <button className="btn ghost" disabled={!nuovoMese} onClick={creaMese}>Apri</button>
        </div>
      </Card>

      <Card title="Regole e modulistica" icon="info">
        <p className="small">{state.testo_giustificativo} Una nota per mese: aggiungi le spese e i viaggi, poi "Invia al responsabile" entro il {state.giorno_limite} del mese successivo. Dopo l'invio la nota non si modifica, salvo che il responsabile la respinga.</p>
        <ModuliCartacei />
      </Card>

      {modal?.tipo === 'spesa' && <SpesaModal rapida categorie={cat.data || []} fuelCard={x.fuel_card} eccezione={x.eccezione} onClose={() => setModal(null)}
        onSalvata={(r) => { setModal(null); toast(`Spesa salvata${r.allegati ? ` con ${r.allegati} ${r.allegati === 1 ? 'giustificativo' : 'giustificativi'}` : ''}`); ricarica(); }} />}
      {modal?.tipo === 'viaggio' && <ViaggioModal nota={modal.nota} veicoli={modal.veicoli} vettura={modal.vettura} tariffaDefault={modal.tariffaDefault} onClose={() => setModal(null)}
        onSalvata={() => { setModal(null); toast('Viaggio salvato'); ricarica(); }} />}
    </div>
  );
}
