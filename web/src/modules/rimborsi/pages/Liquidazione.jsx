// Liquidazione (P&C): note approvate da prendere in carico e liquidare (data, importo, riferimento del cedolino o del bonifico), liquidate
// da archiviare con il PDF definitivo, note ancora in attesa del responsabile; export Excel per il cedolino (TeamSystem HR non è collegato).
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { apiBase, useApi } from '../api.js';
import { ModuliCartacei } from '../components.jsx';
import { MESI, oggiIso, eur } from '../format.js';
import ElencoNote from './ElencoNote.jsx';

export default function Liquidazione() {
  const d = useApi('/liquidazione');
  const [anno, setAnno] = useState(Number(oggiIso().slice(0, 4)));
  const [mese, setMese] = useState('');
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const r = d.data.righe;
  const daLiq = r.filter((x) => ['APPROVATA', 'IN_LIQUIDAZIONE'].includes(x.stato));
  const daArch = r.filter((x) => x.stato === 'LIQUIDATA');
  const tot = daLiq.reduce((a, x) => a + Math.max(0, Number(x.saldo)), 0);
  return (
    <div className="page rs-page">
      <PageHead title="Liquidazione" icon="stats" sub={`P&C: ${daLiq.length} note da liquidare, saldo complessivo a favore dei dipendenti ${eur(tot)}. Le tue note le liquida un altro P&C.`}
        actions={<div className="row">
          <select value={anno} onChange={(e) => setAnno(Number(e.target.value))} aria-label="Anno">{[0, 1, 2].map((k) => Number(oggiIso().slice(0, 4)) - k).map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select value={mese} onChange={(e) => setMese(e.target.value)} aria-label="Mese"><option value="">Tutto l'anno</option>{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <a className="btn ghost" href={`${apiBase}/export.xlsx?anno=${anno}${mese ? `&mese=${mese}` : ''}`}><Icon name="sheet" />Export Excel</a>
        </div>} />
      <Card className="rs-gap" title={`Da liquidare (${daLiq.length})`} icon="check" flush><ElencoNote righe={daLiq} vuoto="Nessuna nota approvata da liquidare" /></Card>
      <Card className="rs-gap" title={`Liquidate da archiviare (${daArch.length})`} icon="folder" flush><ElencoNote righe={daArch} liquidazione vuoto="Nessuna" /></Card>
      <Card className="rs-gap" title={`In attesa del responsabile (${d.data.in_attesa_responsabile.length})`} icon="clock" flush><ElencoNote righe={d.data.in_attesa_responsabile} attesa vuoto="Nessuna" /></Card>
      <Card title="Modulistica cartacea" icon="file"><ModuliCartacei /></Card>
    </div>
  );
}
