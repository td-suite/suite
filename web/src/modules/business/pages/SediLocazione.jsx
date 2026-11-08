import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BASE, API_BASE } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { eur, itDate, DOSSIER_STATUS } from '../format.js';

// Sedi TD in locazione (A3, 08/11/2026): vista in sola lettura delle sedi di Toscana Diagnostica in LOCAZIONE, letta dall'anagrafica Sedi
// (canone, decorrenza, scadenza, preavviso, locatore, contratto in PDF) e da Payments (canone vigente e prossimo scatto). Decisione 3 del
// CEO: il canone è visibile a tutti gli utenti del modulo. Qui non si crea né si modifica nulla: la fonte unica è Amministrazione > Sedi.
const PERIODO = { MESE: 'al mese', TRIMESTRE: 'al trimestre', SEMESTRE: 'al semestre', ANNO: "all'anno" };
const IVA = { PIU_IVA: '+ IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente IVA' };

export default function SediLocazione() {
  const { data, error } = useApi('/sedi-locazione');
  const [q, setQ] = useState('');
  const sedi = (data?.sedi || []).filter((s) => !q || `${s.code} ${s.name} ${s.city || ''} ${s.landlord_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const oggi = new Date().toISOString().slice(0, 10);
  const entro = (d, giorni) => d && d >= oggi && d <= new Date(Date.now() + giorni * 86400000).toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi TD in locazione</h1><div className="sub">Laboratorio, punti prelievo e centri flagship in locazione: canone, scadenze e contratto dall'anagrafica Sedi, canone vigente da Payments. Sola lettura: il contratto di locazione si carica e si modifica in Amministrazione, Sedi.</div></div>
        {data?.amministratore && <a className="btn ghost" href="/admin/sites">Apri in Sedi</a>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sede, città, locatore" style={{ minWidth: 240 }} /></Field>
        <div className="spacer" /><div className="small muted">{sedi.length} sedi in locazione</div>
      </div>
      <ErrorBox error={error} />
      <Card flush>{!data ? <Loading /> : sedi.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede</th><th>Locatore</th><th className="num">Canone (Sedi)</th><th className="num">Canone vigente (Payments)</th><th>Decorrenza</th><th>Fine primo periodo</th><th>Disdetta entro</th><th>Contratto</th><th>Autorizzazione</th></tr></thead>
          <tbody>{sedi.map((s) => (
            <tr key={s.id}>
              <td><div className="strong">{s.name}</div><div className="small muted"><span className="mono">{s.code}</span>{s.city ? ` · ${s.city}` : ''}</div>{data.amministratore && <a className="small" href={`/admin/sites?q=${encodeURIComponent(s.code)}`}>Apri in Sedi</a>}</td>
              <td className="small">{s.landlord_name || <span className="amber">non indicato</span>}</td>
              <td className="num">{s.rent_amount != null ? <><div className="strong">{eur(s.rent_amount)}</div><div className="small muted">{PERIODO[s.rent_period] || ''} {IVA[s.rent_vat] || ''}</div></> : <span className="amber small">canone mancante</span>}</td>
              <td className="num small">{s.payments ? <>{s.payments.canone_vigente != null ? eur(s.payments.canone_vigente) : '–'}{s.payments.prossimo_scatto && <div className="muted">dal {itDate(s.payments.prossimo_scatto.dal)}: {eur(s.payments.prossimo_scatto.importo)}</div>}</> : <span className="muted">non collegato</span>}</td>
              <td className="small">{s.lease_start ? itDate(s.lease_start) : '–'}{s.lease_years ? <div className="muted">{s.lease_years}{s.lease_renewal_years ? `+${s.lease_renewal_years}` : ''} anni</div> : null}</td>
              <td className="small">{s.lease_end ? itDate(s.lease_end) : '–'}</td>
              <td className="small">{s.disdetta_entro ? <>{entro(s.disdetta_entro, 180) ? <Badge tone="red">{itDate(s.disdetta_entro)}</Badge> : itDate(s.disdetta_entro)}<div className="muted">preavviso {s.lease_notice_months} mesi</div></> : '–'}</td>
              <td className="small">{s.documento ? <a href={`${API_BASE}/sedi-locazione/${s.id}/contratto`} target="_blank" rel="noopener noreferrer">{s.documento.filename}</a> : <span className="amber">PDF mancante</span>}</td>
              <td className="small">{s.fascicolo ? <Link to={`${BASE}/fascicoli/${s.fascicolo.id}`}><Badge tone={DOSSIER_STATUS[s.fascicolo.status]?.tone}>{DOSSIER_STATUS[s.fascicolo.status]?.label}</Badge></Link> : <span className="muted">nessun fascicolo</span>}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna sede TD in locazione nell'anagrafica (Amministrazione, Sedi).</Empty>}</Card>
    </div>
  );
}
