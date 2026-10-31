// Report: rapporto energetico annuale (PDF con grafici e XLSX, per sede o di rete) e registro delle manutenzioni (PDF e XLSX con KPI),
// etichette QR dei dispositivi. Il site manager scarica le proprie sedi, il manutentore i propri dati.
import React, { useState } from 'react';
import { qs, apiBase, useApi } from '../api.js';
import { Card, PageHead, Kpi, Loading } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isManutentore } from '../index.jsx';
import { SiteSelect, YearSelect, useSites } from '../components/bits.jsx';
import { num, eur, ore, thisYear } from '../format.js';

export default function Report() {
  const { user } = useAuth();
  const sites = useSites();
  const [year, setYear] = useState(thisYear());
  const [siteId, setSiteId] = useState(user.limited && user.site_ids?.length === 1 ? String(user.site_ids[0]) : '');
  const { data: k } = useApi(`/kpi${qs({ year, site_id: siteId })}`, [], { silent: true });
  const q = qs({ year, site_id: siteId });
  const mnt = isManutentore(user);
  return (
    <div className="page">
      <PageHead title="Report" icon="pdf" sub="Documenti per il riesame della direzione e per le certificazioni (ISO 9001; ISO 14001 / 50001 se intraprese): rapporto energetico e registro delle manutenzioni." />
      <div className="fa-filters"><SiteSelect value={siteId} onChange={setSiteId} sites={sites} all={user.limited ? null : 'Rete (tutte le sedi)'} /><YearSelect value={year} onChange={setYear} /></div>
      <div className="fa-two">
        {!mnt && <Card title="Rapporto energetico" icon="sun">
          <p className="small" style={{ marginTop: 0 }}>Consumi e costi per vettore, CO2, kWh per m2, per accettazione e per ora di apertura, confronto anno su anno, classifica tra sedi, anomalie, obiettivi, fasce di benchmark indicative e, se generata, l'analisi con Claude.</p>
          <div className="row" style={{ gap: 8 }}><a className="btn" href={`${apiBase}/report/energia.pdf${q}&inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" />PDF</a><a className="btn ghost" href={`${apiBase}/report/energia.xlsx${q}`}><Icon name="sheet" />XLSX</a></div>
        </Card>}
        <Card title="Registro delle manutenzioni" icon="calendar">
          <p className="small" style={{ marginTop: 0 }}>Scadenze dell'anno (eseguite con esito, aperte, scadute), interventi con tempi di ripristino e SLA, costi per sede e per tipologia di dispositivo.</p>
          <div className="row" style={{ gap: 8 }}><a className="btn" href={`${apiBase}/report/manutenzioni.pdf${q}&inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" />PDF</a><a className="btn ghost" href={`${apiBase}/report/manutenzioni.xlsx${q}`}><Icon name="sheet" />XLSX</a><a className="btn ghost" href={`${apiBase}/etichette.pdf${qs({ site_id: siteId, inline: 1 })}`} target="_blank" rel="noreferrer"><Icon name="qr" />Etichette QR</a></div>
        </Card>
      </div>
      {!k ? <Loading /> : <div className="fa-kpis">
        <Kpi label="Scadenze rispettate" value={k.rispettate_pct == null ? '–' : `${num(k.rispettate_pct, 1)}%`} foot={`${k.eseguite} eseguite nel ${year}`} />
        <Kpi label="Scadute aperte" value={k.scadute} foot={`${k.prossimi30} nei prossimi 30 giorni`} />
        <Kpi label="MTTR" value={ore(k.mttr_ore)} foot={`${k.interventi_aperti_anno} interventi nel ${year}`} />
        <Kpi label="Entro SLA" value={k.sla_pct == null ? '–' : `${num(k.sla_pct, 1)}%`} />
        <Kpi label="Non conformi" value={k.non_conformi} foot={`${k.dispositivi} dispositivi in servizio`} />
        <Kpi label="Costo dell'anno" value={eur(k.costo_totale)} />
      </div>}
      {k?.interventi_per_sede?.length > 0 && <Card title="Interventi per sede" icon="wrench" flush><table className="t fa-table"><thead><tr><th>Sede</th><th className="num">Aperti</th><th className="num">Chiusi</th><th className="num">Urgenti</th></tr></thead><tbody>{k.interventi_per_sede.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.aperti}</td><td className="num">{x.chiusi}</td><td className="num">{x.urgenti}</td></tr>)}</tbody></table></Card>}
    </div>
  );
}
