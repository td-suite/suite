// Archivio delle note spese per anno e mese, con ricerca: il dipendente le proprie; il responsabile anche quelle della sua catena;
// P&C e titolare tutte (con l'export Excel).
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { apiBase, useApi, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ModuliCartacei } from '../components.jsx';
import { MESI, STATO } from '../format.js';
import ElencoNote from './ElencoNote.jsx';

export default function Archivio() {
  const { user } = useAuth();
  const [f, setF] = useState({ anno: '', mese: '', stato: '', q: '' });
  const [qv, setQv] = useState('');
  const d = useApi(`/archivio${qs(f)}`, [f.anno, f.mese, f.stato, f.q]);
  const s = (k, v) => setF((o) => ({ ...o, [k]: v }));
  return (
    <div className="page rs-page">
      <PageHead title="Archivio" icon="folder" sub={user.tutto ? 'Tutte le note spese (P&C e titolare).' : 'Le tue note spese e, se sei responsabile, quelle dei tuoi riporti.'}
        actions={(user.isPC || user.isTitolare) && <a className="btn ghost" href={`${apiBase}/export.xlsx${qs({ anno: f.anno || new Date().getFullYear(), mese: f.mese, stati: f.stato })}`}><Icon name="sheet" />Export Excel</a>} />
      <div className="row rs-filtri rs-gap">
        <select value={f.anno} onChange={(e) => s('anno', e.target.value)} aria-label="Anno"><option value="">Tutti gli anni</option>{(d.data?.anni || []).map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <select value={f.mese} onChange={(e) => s('mese', e.target.value)} aria-label="Mese"><option value="">Tutti i mesi</option>{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select value={f.stato} onChange={(e) => s('stato', e.target.value)} aria-label="Stato"><option value="">Tutti gli stati</option>{Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <SearchInput value={qv} onChange={setQv} onSubmit={(v) => s('q', v)} placeholder="Cerca dipendente, motivazione, spesa" />
        <button className="btn ghost" onClick={() => s('q', qv)}>Cerca</button>
      </div>
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : <Card className="rs-gap" flush><ElencoNote righe={d.data.righe} persona={user.tutto || user.isResponsabile} vuoto="Nessuna nota con questi filtri" /></Card>}
      <Card title="Modulistica cartacea" icon="file"><ModuliCartacei /></Card>
    </div>
  );
}
