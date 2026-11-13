// Elenco di note spese (Da approvare, Liquidazione, Archivio): righe cliccabili che sul telefono diventano schede impilate
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty } from '../../../components/ui.jsx';
import { base } from '../api.js';
import { StatoBadge } from '../components.jsx';
import { eur, itData, km, saldoTesto } from '../format.js';

export default function ElencoNote({ righe, vuoto = 'Nessuna nota', persona = true, attesa = false, liquidazione = false }) {
  const nav = useNavigate();
  if (!righe?.length) return <Empty compact icon="doc">{vuoto}</Empty>;
  return (
    <div className={`rs-elenco ${persona ? '' : 'senza-persona'}`}>
      <div className="rs-el-h">{persona && <span>Dipendente</span>}<span>Mese</span><span>Stato</span><span className="num">Rimborsabile</span><span className="num">Saldo</span><span>{attesa ? 'In attesa da' : liquidazione ? 'Liquidazione' : 'Dettagli'}</span></div>
      {righe.map((n) => (
        <button type="button" key={n.id} className="rs-el-r" onClick={() => nav(`${base}/nota/${n.id}`)}>
          {persona && <span className="strong">{n.persona}<span className="small muted rs-blk">{n.sede || ''}</span></span>}
          <span>{n.titolo}</span>
          <span><StatoBadge stato={n.stato} />{n.in_ritardo && <span className="small rs-warn rs-blk">inviata in ritardo</span>}</span>
          <span className="num strong">{eur(n.tot_rimborsabile)}<span className="small muted rs-blk">{n.n_spese} {n.n_spese === 1 ? 'spesa' : 'spese'} · {n.n_viaggi} {n.n_viaggi === 1 ? 'viaggio' : 'viaggi'}{Number(n.tot_km) ? ` · ${km(n.tot_km)}` : ''}</span></span>
          <span className="num">{eur(Math.abs(n.saldo))}<span className="small muted rs-blk">{saldoTesto(n.saldo)}</span></span>
          <span className="small">{attesa ? `${!n.giorni_attesa ? 'da oggi' : n.giorni_attesa === 1 ? 'da 1 giorno' : `da ${n.giorni_attesa} giorni`} · ${n.al_pc ? 'P&C' : n.responsabile_nome || ''}` : n.liquidazione_data ? `${eur(n.liquidazione_importo)} il ${itData(n.liquidazione_data)}` : `${n.n_allegati} giustificativi${Number(n.tot_carta) ? ` · carta ${eur(n.tot_carta)}` : ''}`}</span>
        </button>))}
    </div>
  );
}
