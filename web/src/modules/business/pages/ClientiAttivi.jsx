// Business Hub · "Clienti" delle sezioni Service di Laboratorio e Medicina del Lavoro: SOLO i clienti attivi, cioè con la fase 7
// confermata dal CEO ("Questa sezione deve contenere SOLO gli attivi! Non altri!", 08/11/2026). I contrattualizzati in avvio restano in
// Pipeline e in Clienti e prospect. Per la sezione Punti Prelievo la stessa voce ("Punti e centri attivi") elenca TUTTE le sedi attive di
// Toscana Diagnostica di tipo punto prelievi, centro medico, centro diagnostico e poliambulatorio dall'anagrafica Sedi, con l'account PP
// del Business Hub quando c'è (CEO, 08/11/2026: "ci devono essere TUTTE le sedi attive di Toscana Diagnostica. Integrale").
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BASE } from '../api.js';
import { useApi, Loading, ErrorBox, Badge, Empty, StatusBadge, Card } from '../components/ui.jsx';
import { FASI, LINEE, itDate, itDateTime, eurK, num } from '../format.js';

const SITE_KIND = { PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio' };
const TENURE = { PROPRIETA: 'Proprietà', LOCAZIONE: 'Locazione', COMODATO: 'Comodato', OSPITATA: 'Ospitata' };

export default function ClientiAttivi() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const linea = ['SRV', 'PP', 'MDL'].includes(sp.get('linea')) ? sp.get('linea') : 'SRV';
  const q = useApi(`/hub/clienti-attivi?linea=${linea}`);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const righe = q.data.righe;
  const selettore = <select style={{ width: 'auto' }} value={linea} onChange={(e) => setSp({ linea: e.target.value })}>{Object.entries(LINEE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>;

  if (linea === 'PP') {
    const senzaAccount = righe.filter((x) => !x.id).length;
    return (
      <div className="page">
        <div className="page-head">
          <div><h1>Punti e centri attivi</h1><div className="sub">Tutte le sedi attive di Toscana Diagnostica di tipo punto prelievi, centro medico, centro diagnostico e poliambulatorio, dall'anagrafica Sedi (Amministrazione). {righe.length} sedi{senzaAccount ? `, ${senzaAccount} senza scheda nel Business Hub` : ''}. Per aprire o chiudere una sede si passa da Amministrazione &gt; Sedi.</div></div>
          <div className="row" style={{ gap: 8 }}>{selettore}</div>
        </div>
        <Card flush>{righe.length ? <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede</th><th>Tipo</th><th>Titolo</th><th>Apertura</th><th>Responsabile</th><th>Contratto PP</th><th>Fascicolo</th><th>Scheda Business Hub</th><th>Owner</th></tr></thead>
          <tbody>{righe.map((x) => <tr key={x.site_id} className={x.id ? 'click' : ''} onClick={() => (x.id ? nav(`${BASE}/account/${x.id}?scheda=punto`) : nav(`/admin/sites?q=${encodeURIComponent(x.code)}`))}>
            <td><div className="strong">{x.name}</div><div className="small muted mono">{x.code}</div><div className="small muted">{[x.address, [x.zip, x.city].filter(Boolean).join(' '), x.province && `(${x.province})`].filter(Boolean).join(', ')}</div></td>
            <td className="small">{SITE_KIND[x.kind] || x.kind}</td>
            <td className="small"><Badge tone={x.tenure === 'PROPRIETA' ? 'green' : x.tenure === 'OSPITATA' ? 'mauve' : 'blue'}>{TENURE[x.tenure] || x.tenure || '–'}</Badge>{x.host_name && <div className="muted">ospitata da {x.host_name}</div>}</td>
            <td className="small">{x.opened_at ? itDate(x.opened_at) : <span className="muted">–</span>}</td>
            <td className="small">{x.manager_name || <span className="muted">da assegnare</span>}</td>
            <td>{x.contratto ? <><StatusBadge status={x.contratto.status} /><div className="small muted mono">{x.contratto.protocol || ''}{x.contratto.start_date ? ` · dal ${itDate(x.contratto.start_date)}` : ''}{x.contratto.end_date ? ` · al ${itDate(x.contratto.end_date)}` : ''}</div></> : <span className="muted small">{x.tenure === 'OSPITATA' ? 'nessuno' : 'non previsto'}</span>}</td>
            <td className="small">{x.fascicolo ? <Badge tone={x.fascicolo.status === 'AUTORIZZATO' ? 'teal' : 'amber'}>{x.fascicolo.status?.toLowerCase().replace('_', ' ')}</Badge> : <span className="muted">–</span>}</td>
            <td className="small">{x.id ? (x.cliente_attivo ? <Badge tone="teal">attivo{x.attivo_dal ? ` dal ${itDate(x.attivo_dal)}` : ''}</Badge> : <Badge tone="green">{FASI[x.fase_corrente]?.label || `fase ${x.fase_corrente}`}</Badge>) : <Badge tone="grey">senza scheda</Badge>}{x.id && x.volumi_giornalieri_attesi ? <div className="muted">{num(x.volumi_giornalieri_attesi)} al giorno</div> : null}{x.id && x.fatturato_fy_atteso ? <div className="muted">{eurK(x.fatturato_fy_atteso)} / anno</div> : null}</td>
            <td className="small">{x.owner_name || '–'}</td>
          </tr>)}</tbody>
        </table></div> : <Empty>Nessuna sede attiva di questi tipi in Amministrazione &gt; Sedi</Empty>}</Card>
      </div>
    );
  }

  const senzaCodice = righe.filter((x) => !x.codice_studiolab).length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Clienti · {LINEE[linea].label}</h1><div className="sub">Solo i clienti attivi: fase 7 confermata dal CEO dalla scheda del cliente. {righe.length} client{righe.length === 1 ? 'e' : 'i'}. I contrattualizzati in avvio sono in Pipeline e in Clienti e prospect (fase 6). Lo stato del contratto (in vigore, firmato) è un'altra cosa dallo stato del cliente.</div></div>
        <div className="row" style={{ gap: 8 }}>{selettore}</div>
      </div>
      {senzaCodice > 0 && <div className="alert warn small" style={{ marginBottom: 12 }}>{senzaCodice === 1 ? 'Un cliente non ha' : `${senzaCodice} clienti non hanno`} ancora il codice StudioLAB: inseriscilo dalla scheda del cliente (Ordini, Non conformità e Retail lo usano per riconoscerlo).</div>}
      <Card flush>{righe.length ? <div className="table-wrap"><table className="t">
        <thead><tr><th>Cliente</th><th>Codice StudioLAB</th><th>Attivo dal</th><th>Contratto</th><th>Volumi attesi</th><th>Listino</th><th>Accessi</th><th>Ultimo contatto</th><th>Owner</th></tr></thead>
        <tbody>{righe.map((x) => <tr key={x.id} className="click" onClick={() => nav(`${BASE}/account/${x.id}${x.da_verificare ? '?scheda=proposta' : ''}`)}>
          <td><div className="strong">{x.org_name}</div><div className="small muted">{[x.citta, x.prov && `(${x.prov})`].filter(Boolean).join(' ')}{x.da_verificare ? <> · <Badge tone="mauve">{x.da_verificare} allegati da verificare</Badge></> : null}</div></td>
          <td className="small">{x.codice_studiolab ? <span className="mono strong">{x.codice_studiolab}</span> : <Badge tone="amber">da inserire</Badge>}{!x.sede_service_id ? <div className="tiny muted">senza sede SERVICE</div> : null}</td>
          <td className="small">{x.attivo_dal ? itDate(x.attivo_dal) : <span className="muted">–</span>}{x.contrattualizzato_at && <div className="muted">firmato ricevuto {itDate(x.contrattualizzato_at)}</div>}</td>
          <td>{x.contratto ? <><StatusBadge status={x.contratto.status} /><div className="small muted mono">{x.contratto.protocol || ''}{x.contratto.status === 'ATTIVO' && x.contratto.start_date ? ` · dal ${itDate(x.contratto.start_date)}` : x.contratto.signed_at ? ` · firma ${itDate(x.contratto.signed_at)}` : ''}</div></> : <span className="muted small">nessuno</span>}</td>
          <td className="small">{x.volumi.valore != null ? <>{num(x.volumi.valore)} al giorno<div className="muted">{x.volumi.fonte === 'calcolo' ? 'dal volume annuo' : 'indicati'}</div></> : <span className="muted">–</span>}{x.fatturato_fy_atteso ? <div className="muted">{eurK(x.fatturato_fy_atteso)} / anno</div> : null}</td>
          <td className="small">{x.listino_versione ? `v${x.listino_versione}` : '–'}</td>
          <td className="small">{x.accessi || <span className="muted">0</span>}</td>
          <td className="small">{x.ultimo_contatto ? itDateTime(x.ultimo_contatto) : '–'}</td>
          <td className="small">{x.owner_name || '–'}</td>
        </tr>)}</tbody>
      </table></div> : <Empty>Nessun cliente attivo su questa linea: il cliente diventa attivo quando il CEO lo conferma dalla scheda</Empty>}</Card>
    </div>
  );
}
