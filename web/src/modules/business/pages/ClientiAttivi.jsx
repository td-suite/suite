// Business Hub · "Clienti" della sezione Service di Laboratorio (menu del CEO, 06/11/2026): solo i clienti della linea, cioè i clienti attivi
// confermati dal CEO e i contrattualizzati in avvio (contratto firmato ricevuto, fase 6), con lo stato del contratto, la data di avvio,
// i volumi attesi, l'ultimo contatto, gli accessi alla Suite e gli allegati arrivati da verificare.
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BASE } from '../api.js';
import { useApi, Loading, ErrorBox, Badge, Empty, StatusBadge, Card } from '../components/ui.jsx';
import { FASI, LINEE, itDate, itDateTime, eurK, num } from '../format.js';

export default function ClientiAttivi() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const linea = ['SRV', 'PP', 'MDL'].includes(sp.get('linea')) ? sp.get('linea') : 'SRV';
  const [solo, setSolo] = useState('');
  const q = useApi(`/hub/clienti-attivi?linea=${linea}`);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const righe = q.data.righe.filter((x) => !solo || (solo === 'attivi' ? x.cliente_attivo : !x.cliente_attivo));
  const attivi = q.data.righe.filter((x) => x.cliente_attivo).length;
  const senzaCodice = linea === 'PP' ? 0 : q.data.righe.filter((x) => !x.codice_studiolab).length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Clienti · {LINEE[linea].label}</h1><div className="sub">I clienti della linea: attivi (confermati dal CEO) e contrattualizzati in avvio (contratto firmato). {attivi} attivi, {q.data.righe.length - attivi} in avvio. Lo stato del contratto (in vigore, firmato) è un'altra cosa dallo stato del cliente, che passa ad attivo solo con la conferma del CEO dalla scheda.</div></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg">{[['', 'Tutti'], ['attivi', 'Attivi'], ['avvio', 'In avvio']].map(([k, l]) => <label key={k} className={solo === k ? 'on' : ''}><input type="radio" checked={solo === k} onChange={() => setSolo(k)} />{l}</label>)}</div>
          <select style={{ width: 'auto' }} value={linea} onChange={(e) => setSp({ linea: e.target.value })}>{Object.entries(LINEE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </div>
      </div>
      {senzaCodice > 0 && <div className="alert warn small" style={{ marginBottom: 12 }}>{senzaCodice === 1 ? 'Un cliente non ha' : `${senzaCodice} clienti non hanno`} ancora il codice StudioLAB: inseriscilo dalla scheda del cliente (Ordini, Non conformità e Retail lo usano per riconoscerlo).</div>}
      <Card flush>{righe.length ? <div className="table-wrap"><table className="t">
        <thead><tr><th>Cliente</th><th>Codice StudioLAB</th><th>Stato del cliente</th><th>Contratto</th><th>Avvio</th><th>Volumi attesi</th><th>Listino</th><th>Accessi</th><th>Ultimo contatto</th><th>Owner</th></tr></thead>
        <tbody>{righe.map((x) => <tr key={x.id} className="click" onClick={() => nav(`${BASE}/account/${x.id}${x.da_verificare ? '?scheda=proposta' : ''}`)}>
          <td><div className="strong">{x.org_name}</div><div className="small muted">{[x.citta, x.prov && `(${x.prov})`].filter(Boolean).join(' ')}{x.da_verificare ? <> · <Badge tone="mauve">{x.da_verificare} allegati da verificare</Badge></> : null}</div></td>
          <td className="small">{x.linea === 'PP' ? <span className="muted">–</span> : x.codice_studiolab ? <span className="mono strong">{x.codice_studiolab}</span> : <Badge tone="amber">da inserire</Badge>}{x.linea !== 'PP' && !x.sede_service_id ? <div className="tiny muted">senza sede SERVICE</div> : null}</td>
          <td>{x.cliente_attivo ? <Badge tone="teal">attivo{x.attivo_dal ? ` dal ${itDate(x.attivo_dal)}` : ''}</Badge> : <Badge tone="green">{FASI[x.fase_corrente]?.label || 'in avvio'}</Badge>}{x.contrattualizzato_at && <div className="small muted">firmato ricevuto {itDate(x.contrattualizzato_at)}</div>}</td>
          <td>{x.contratto ? <><StatusBadge status={x.contratto.status} /><div className="small muted mono">{x.contratto.protocol || ''}{x.contratto.status === 'ATTIVO' && x.contratto.start_date ? ` · dal ${itDate(x.contratto.start_date)}` : x.contratto.signed_at ? ` · firma ${itDate(x.contratto.signed_at)}` : ''}</div></> : <span className="muted small">nessuno</span>}</td>
          <td className="small">{x.attivo_dal ? itDate(x.attivo_dal) : x.data_avvio_prevista ? <>prevista {itDate(x.data_avvio_prevista)}</> : <span className="muted">da definire</span>}</td>
          <td className="small">{x.volumi.valore != null ? <>{num(x.volumi.valore)} al giorno<div className="muted">{x.volumi.fonte === 'calcolo' ? 'dal volume annuo' : 'indicati'}</div></> : <span className="muted">–</span>}{x.fatturato_fy_atteso ? <div className="muted">{eurK(x.fatturato_fy_atteso)} / anno</div> : null}</td>
          <td className="small">{x.listino_versione ? `v${x.listino_versione}` : '–'}</td>
          <td className="small">{x.accessi || <span className="muted">0</span>}</td>
          <td className="small">{x.ultimo_contatto ? itDateTime(x.ultimo_contatto) : '–'}</td>
          <td className="small">{x.owner_name || '–'}</td>
        </tr>)}</tbody>
      </table></div> : <Empty>Nessun cliente {solo === 'attivi' ? 'attivo' : solo === 'avvio' ? 'in avvio' : ''} su questa linea</Empty>}</Card>
    </div>
  );
}
