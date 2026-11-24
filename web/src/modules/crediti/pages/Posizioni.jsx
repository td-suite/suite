// Clienti e scaduto: una riga per cliente con partite aperte, filtro per stato e ricerca.
import React, { useMemo, useState } from 'react';
import { Card, Loading, Empty, PageHead, SearchInput, Seg } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { Modalita, StatoCliente, LinkCliente } from '../components.jsx';
import { eur, itData } from '../format.js';

export default function Posizioni() {
  const d = useApi('/posizioni'); const [q, setQ] = useState(''); const [f, setF] = useState('TUTTI');
  const righe = useMemo(() => (d.data?.righe || []).filter((p) => (f === 'TUTTI' || (f === 'SCADUTI' ? p.scaduto > 0 : f === 'FERMI' ? ['ESCLUSO', 'PROMESSA', 'SOSPESO', 'CONTESTAZIONE', 'LEGALE'].includes(p.stato) : p.stato === f)) && (!q || p.ragione_sociale.toLowerCase().includes(q.toLowerCase()))), [d.data, q, f]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const tot = righe.reduce((s, p) => s + p.totale, 0), sc = righe.reduce((s, p) => s + p.scaduto, 0);
  return (
    <div className="page">
      <PageHead title="Clienti e scaduto" icon="building" sub={`${righe.length} clienti · aperto ${eur(tot)} · scaduto ${eur(sc)}`} />
      <Modalita />
      <div className="filters cr-gap"><SearchInput value={q} onChange={setQ} placeholder="Cerca un cliente" /><Seg value={f} onChange={setF} label="Filtro" items={[{ value: 'TUTTI', label: 'Tutti' }, { value: 'SCADUTI', label: 'Con scaduto' }, { value: 'IN_SOLLECITO', label: 'In sollecito' }, { value: 'FERMI', label: 'Scala ferma' }]} /></div>
      <Card flush>
        {righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Cliente</th><th>Stato</th><th className="num">Aperto</th><th className="num">Scaduto</th><th className="num">Giorni</th><th>Ultima fase</th><th>Ultimo contatto</th><th>Referente</th></tr></thead>
          <tbody>{righe.map((p) => (
            <tr key={p.organization_id}>
              <td><LinkCliente id={p.organization_id}>{p.ragione_sociale}</LinkCliente><div className="small muted">{p.fatture} {p.fatture === 1 ? 'fattura' : 'fatture'}{p.linee_hub ? ` · Business Hub: ${p.linee_hub}` : ' · non attivo nel Business Hub'}</div></td>
              <td><StatoCliente stato={p.stato} />{p.risposte_da_gestire > 0 && <div className="small cr-rosso">risposta da leggere</div>}{p.da_approvare > 0 && <div className="small muted">sollecito in attesa</div>}{p.termini_mancanti && <div className="small muted">termini di pagamento da indicare</div>}</td>
              <td className="num">{eur(p.totale)}</td><td className="num strong">{p.scaduto > 0 ? eur(p.scaduto) : ''}</td><td className="num">{p.giorni_max || ''}</td>
              <td>{p.fase_label || ''}{p.promessa && <div className="small muted">{p.promessa.piano ? 'piano' : 'promessa'} al {itData(p.promessa.data)}</div>}</td>
              <td className="small">{p.ultimo_contatto ? itData(String(p.ultimo_contatto)) : ''}</td><td className="small">{p.referente || ''}</td>
            </tr>))}</tbody></table></div> : <Empty compact icon="check">Nessun cliente con partite aperte in questo filtro</Empty>}
      </Card>
    </div>
  );
}
