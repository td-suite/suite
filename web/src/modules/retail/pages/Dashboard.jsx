import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Badge, Delta, Progress } from '../components/ui.jsx';
import { Donut, HBars, VBars, Trend, Legend, C } from '../components/charts.jsx';
import { PeriodFilter, SiteSelect, KindSelect, defaultPeriod } from '../components/filters.jsx';
import { qs, base } from '../api.js';
import { eur, eur0, num, pct, delta, itDate, monthLabel, SEX, CHANNEL, PAYMENT, WEEKDAYS, MONTHS, itDateTime, SEGMENT } from '../format.js';

function KpiD({ label, value, prev, foot, accent, money = true, invert }) {
  return (
    <div className={`card kpi ${accent ? 'accent' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{money ? eur0(value) : num(value)}</div>
      <div className="delta"><Delta value={delta(value, prev)} invert={invert} /> <span className="muted">vs periodo precedente{foot ? ` · ${foot}` : ''}</span></div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState(defaultPeriod());
  const [site, setSite] = useState('');
  const [kind, setKind] = useState('');
  const s = useApi(`/stats/summary${qs({ from: p.from, to: p.to, site_id: site, kind })}`);
  const d = s.data;
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  const k = d?.kpi; const pr = d?.prev;
  const avgTicket = k && k.tickets ? k.revenue / k.tickets : 0; const avgTicketPrev = pr && pr.tickets ? pr.revenue / pr.tickets : 0;
  const margin = k ? Number(k.revenue) - Number(k.cost) : 0; const marginPrev = pr ? Number(pr.revenue) - Number(pr.cost) : 0;
  const trend = (d?.trend || []).map((t) => ({ ...t, month: monthLabel(t.month), b2c: Number(t.b2c), b2b: Number(t.b2b), margin: Number(t.margin), invoiced: Number(t.invoiced) }));
  const promo = d?.promo;
  const target = promo?.kpi_target || {};
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno, {user.full_name.split(' ')[0]}</h1>
          <div className="sub">Retail B2C e B2B di Toscana Diagnostica: clienti, prestazioni, campagne, promozioni ed esposizione in sede. {d?.data_range?.min ? `Dati dal ${itDate(d.data_range.min)} al ${itDate(d.data_range.max)}` : 'Nessuna vendita caricata'}{d?.last_import ? ` · ultimo import ${itDateTime(d.last_import.created_at)} (${d.last_import.source})` : ''}.</div>
        </div>
      </div>
      <PeriodFilter value={p} onChange={setP}>
        <SiteSelect value={site} onChange={setSite} />
        <KindSelect value={kind} onChange={setKind} />
      </PeriodFilter>
      {!d ? <Loading /> : <>
        <div className="grid g4">
          <KpiD accent label="Fatturato netto" value={k.revenue} prev={pr.revenue} foot={`B2C ${eur0(k.revenue_b2c)} · B2B ${eur0(k.revenue_b2b)}`} />
          <KpiD label="Accettazioni" value={k.tickets} prev={pr.tickets} money={false} foot={`${num(k.items)} prestazioni`} />
          <KpiD label="Scontrino medio" value={avgTicket} prev={avgTicketPrev} />
          <KpiD label="Sconti e abbattimenti" value={k.discount} prev={pr.discount} invert foot={k.gross ? `${pct((k.discount / k.gross) * 100, 1)} del lordo` : ''} />
        </div>
        <div className="grid g4" style={{ marginTop: 16 }}>
          <KpiD label="Margine sul costo diretto" value={margin} prev={marginPrev} foot={k.revenue_costed > 0 ? `${pct((margin / Number(k.revenue_costed)) * 100, 1)} · costi ${eur0(k.cost)}${Number(k.revenue) - Number(k.revenue_costed) > 1 ? ` · ${pct(((Number(k.revenue) - Number(k.revenue_costed)) / Number(k.revenue)) * 100, 0)} del fatturato senza costo` : ''}` : 'carica la distinta base per calcolarlo'} />
          <Kpi label="Fatturato e da fatturare" value={eur0(k.invoiced)} foot={<span>{eur0(k.uninvoiced)} accettato non ancora fatturato ({pct(k.revenue ? (Number(k.uninvoiced) / Number(k.revenue)) * 100 : 0, 0)}) · {num(k.invoices)} fatture</span>} bar={k.revenue ? (Number(k.invoiced) / Number(k.revenue)) * 100 : null} />
          <Kpi label="Pazienti finali B2B" value={num(k.patients)} foot={d.b2b_patients.total ? `${pct((d.b2b_patients.with_sex / d.b2b_patients.total) * 100, 0)} con sesso ed età noti${d.b2b_patients.avg_age ? ` · età media ${d.b2b_patients.avg_age}` : ''}` : 'nessuna vendita B2B nel periodo'} />
          <Kpi label="Prestazioni senza costo" value={num(k.items_uncosted)} foot={k.items ? `${pct((k.items_uncosted / k.items) * 100, 0)} degli esami: codici non in distinta base` : ''} />
        </div>
        <div className="grid g4" style={{ marginTop: 16 }}>
          <div onClick={() => nav(`${base}/budget?tab=days`)} style={{ cursor: 'pointer' }}><Kpi label="Giorni lavorati" value={`${num(d.working_days.actual)}${d.working_days.planned ? ` / ${num(d.working_days.planned)}` : ''}`} foot={d.working_days.planned ? `reali su pianificati · ${d.working_days.planned - d.working_days.actual > 0 ? `${d.working_days.planned - d.working_days.actual} in meno` : 'in linea'}` : 'reali nel periodo (nessun calendario impostato)'} bar={d.working_days.planned ? (d.working_days.actual / d.working_days.planned) * 100 : null} /></div>
          <Kpi label="Fatturato per giorno lavorato" value={eur0(d.working_days.revenue_per_day)} foot={`${num(d.working_days.tickets_per_day)} accettazioni al giorno`} />
          <div onClick={() => nav(`${base}/budget`)} style={{ cursor: 'pointer' }}><Kpi label={`Budget del periodo (${d.budget_period.scope})`} value={d.budget_period.amount ? eur0(d.budget_period.amount) : '–'} foot={d.budget_period.amount ? <span>consuntivo {eur0(d.budget_period.actual)} · <Delta value={((d.budget_period.actual - d.budget_period.amount) / d.budget_period.amount) * 100} /></span> : 'nessun budget caricato'} bar={d.budget_period.amount ? (d.budget_period.actual / d.budget_period.amount) * 100 : null} /></div>
          <div onClick={() => nav(`${base}/budget?tab=variance`)} style={{ cursor: 'pointer' }}><Kpi label="Scostamento dal budget" value={d.budget_period.amount ? `${d.budget_period.actual - d.budget_period.amount >= 0 ? '+' : ''}${eur0(d.budget_period.actual - d.budget_period.amount)}` : '–'} foot="apri l'analisi: ipotesi esterne e motivazioni interne" /></div>
        </div>
        <div className="grid g4" style={{ marginTop: 16 }}>
          <div onClick={() => nav(`${base}/clienti`)} style={{ cursor: 'pointer' }}><KpiD label="Pazienti serviti" value={k.customers} prev={pr.customers} money={false} foot={`${num(k.b2b_customers)} clienti B2B`} /></div>
          <div onClick={() => nav(`${base}/clienti?segment=NUOVO`)} style={{ cursor: 'pointer' }}><KpiD label="Nuovi pazienti" value={k.new_customers} prev={pr.new_customers} money={false} foot={k.customers ? `${pct((k.new_customers / k.customers) * 100)} del totale` : ''} /></div>
          <div onClick={() => nav(`${base}/clienti?segment=DORMIENTE`)} style={{ cursor: 'pointer' }}><Kpi label="Base clienti" value={num(d.base.b2c)} foot={`${num(d.base.recurring)} ricorrenti · ${num(d.base.dormant)} dormienti · ${num(d.base.consent)} con consenso marketing`} /></div>
          <div onClick={() => nav(`${base}/richiami`)} style={{ cursor: 'pointer' }}><Kpi label="Richiami in scadenza (30 gg)" value={num(d.recalls.due_30)} foot={`${num(d.recalls.overdue)} già scaduti · esami periodici da riproporre`} /></div>
        </div>

        <div className="grid" style={{ marginTop: 16, gridTemplateColumns: '2fr 1fr' }}>
          <Card title="Andamento mensile" actions={<span className="small muted">fatturato B2C e B2B · margine sul costo diretto</span>}>
            <Trend data={trend} keys={[{ key: 'b2c', label: 'B2C', color: C.teal }, { key: 'b2b', label: 'B2B', color: C.mauve }]} lines={[{ key: 'margin', label: 'Margine', color: C.gold, money: true }]} />
          </Card>
          <Card title="Promozione del mese" actions={promo && <Link className="btn sm ghost" to={`${base}/promozioni/${promo.id}`}>Apri</Link>}>
            {promo ? <>
              <div className="claimbox"><div className="small" style={{ color: 'var(--blue)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>{MONTHS[promo.month - 1]} {promo.year} · {promo.name}</div><div className="big">{promo.claim || '(claim da definire)'}</div></div>
              <div style={{ marginTop: 12 }}>
                {[['Prenotazioni', promo.tickets, target.bookings, false], ['Fatturato', promo.revenue, target.revenue, true], ['Pazienti', promo.customers, target.new_customers, false]].map(([l, v, t, m]) => (
                  <div key={l} style={{ marginBottom: 8 }}><div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}><span className="muted">{l}</span><span className="strong">{m ? eur0(v) : num(v)}{t ? <span className="muted"> / {m ? eur0(t) : num(t)}</span> : ''}</span></div>{t ? <Progress value={v} max={t} /> : null}</div>
                ))}
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginTop: 10 }}><span className="muted">Materiali esposti in sede</span><span className="strong">{promo.exposure_ok}/{promo.exposure_total}</span></div><Progress value={promo.exposure_ok} max={promo.exposure_total} />
              </div>
            </> : <Empty>Nessuna promozione pianificata per questo mese. <Link to={`${base}/promozioni`}>Apri il calendario</Link>.</Empty>}
          </Card>
        </div>

        <div className="grid g3" style={{ marginTop: 16 }}>
          <Card title="Fatturato per linea">
            <Donut size={190} data={d.by_line.map((x, i) => ({ name: x.label, value: Number(x.revenue), color: LINE_COLORS[i % LINE_COLORS.length] }))} money onClick={() => nav(`${base}/prodotti`)} />
            <Legend items={d.by_line.map((x, i) => ({ label: `${x.label} ${eurShortPct(x.revenue, k.revenue)}`, color: LINE_COLORS[i % LINE_COLORS.length] }))} />
          </Card>
          <Card title="Sedi per fatturato" actions={<span className="small muted">clicca per filtrare</span>}>
            <HBars data={d.by_site.map((x) => ({ ...x, id: x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.teal }]} onClick={(row) => nav(`${base}/vendite?site_name=${encodeURIComponent(row.label)}`)} labelWidth={200} />
          </Card>
          <Card title="Come prenotano e come pagano">
            <div className="subhead" style={{ marginTop: 0 }}>Canale di prenotazione</div>
            <HBars data={d.by_channel.map((x) => ({ label: CHANNEL[x.label] || x.label, value: Number(x.tickets) }))} keys={[{ key: 'value', label: 'Accettazioni', color: C.blue }]} labelWidth={150} height={Math.max(100, d.by_channel.length * 26 + 20)} />
            <div className="subhead">Regime di pagamento</div>
            <HBars data={d.by_payment.map((x) => ({ label: PAYMENT[x.label] || x.label, value: Number(x.revenue) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.mauve }]} labelWidth={150} height={Math.max(100, d.by_payment.length * 26 + 20)} />
          </Card>
        </div>

        {(d.by_sector.length > 1 || d.b2b_patients.total > 0) && <div className="grid g3" style={{ marginTop: 16 }}>
          <Card title="Fatturato e margine per settore" actions={<span className="small muted">settori StudioLab · clicca per le prestazioni</span>}>
            <HBars data={d.by_sector.map((x) => ({ label: x.label, value: Number(x.revenue), margin: Number(x.margin) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.teal }, { key: 'margin', label: 'Margine', color: C.gold }]} labelWidth={170} height={Math.max(160, d.by_sector.length * 26 + 20)} onClick={(row) => nav(`${base}/prodotti?sector=${encodeURIComponent(row.label)}`)} />
          </Card>
          <Card title="Dove si produce" actions={<span className="small muted">strumento interno o service esterno · fatturato</span>}>
            <HBars data={d.by_destination.slice(0, 12).map((x) => ({ label: x.label, value: Number(x.revenue), margin: Number(x.margin) }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.blue }, { key: 'margin', label: 'Margine', color: C.gold }]} labelWidth={170} height={Math.max(160, Math.min(12, d.by_destination.length) * 26 + 20)} />
            <div className="small muted" style={{ marginTop: 6 }}>Service esterno: {eur0(d.by_destination.filter((x) => /service/i.test(x.label)).reduce((a, x) => a + Number(x.revenue), 0))} di fatturato, margine {eur0(d.by_destination.filter((x) => /service/i.test(x.label)).reduce((a, x) => a + Number(x.margin), 0))}.</div>
          </Card>
          <Card title="Pazienti finali dei clienti B2B" actions={<span className="small muted">dal codice fiscale · pazienti distinti</span>}>
            {d.b2b_patients.total ? <>
              <div className="subhead" style={{ marginTop: 0 }}>Per sesso</div>
              <Donut size={140} data={d.b2b_patients.by_sex.map((x) => ({ name: SEX[x.label] || 'n.d.', value: Number(x.patients), color: x.label === 'F' ? C.teal : x.label === 'M' ? C.blue : C.grey }))} />
              <Legend items={d.b2b_patients.by_sex.map((x) => ({ label: `${SEX[x.label] || 'n.d.'} ${num(x.patients)} · ${eur0(x.spend_per_patient)} a paziente`, color: x.label === 'F' ? C.teal : x.label === 'M' ? C.blue : C.grey }))} />
              <div className="subhead">Per fascia di età</div>
              <VBars data={d.b2b_patients.by_age.map((x) => ({ label: x.label, value: Number(x.patients) }))} keys={[{ key: 'value', label: 'Pazienti', color: C.mauve }]} height={150} />
              <div className="small muted">{num(d.b2b_patients.with_birth)} su {num(d.b2b_patients.total)} pazienti con data di nascita{d.b2b_patients.avg_age ? ` · età media ${d.b2b_patients.avg_age} anni` : ''}.</div>
            </> : <Empty>Nessuna vendita B2B nel periodo</Empty>}
          </Card>
        </div>}

        <div className="grid g3" style={{ marginTop: 16 }}>
          <Card title="Chi sono i pazienti" actions={<Link className="btn sm ghost" to={`${base}/clienti`}>Profilazione</Link>}>
            <div className="subhead" style={{ marginTop: 0 }}>Per sesso (fatturato)</div>
            <Donut size={150} data={d.by_sex.map((x) => ({ name: SEX[x.label] || 'n.d.', value: Number(x.revenue), color: x.label === 'F' ? C.teal : x.label === 'M' ? C.blue : C.grey }))} money onClick={(x) => nav(`${base}/clienti?sex=${x.name === 'Donna' ? 'F' : x.name === 'Uomo' ? 'M' : ''}`)} />
            <Legend items={d.by_sex.map((x) => ({ label: `${SEX[x.label] || 'n.d.'} ${num(x.customers)}`, color: x.label === 'F' ? C.teal : x.label === 'M' ? C.blue : C.grey }))} />
            <div className="subhead">Per fascia di età (pazienti)</div>
            <VBars data={d.by_age.map((x) => ({ label: x.label, value: Number(x.customers) }))} keys={[{ key: 'value', label: 'Pazienti', color: C.teal }]} height={160} onClick={(row) => { const [a, b] = String(row.label).replace('+', '-120').split('-'); nav(`${base}/clienti?age_from=${a}&age_to=${b}`); }} />
            <div className="small muted">Età media della base clienti: {d.base.avg_age || '–'} anni.</div>
          </Card>
          <Card title="Da dove vengono" actions={<span className="small muted">residenza · fatturato</span>}>
            <div className="subhead" style={{ marginTop: 0 }}>Province</div>
            <HBars data={d.by_province.map((x) => ({ label: x.label, value: Number(x.revenue), customers: x.customers }))} money keys={[{ key: 'value', label: 'Fatturato', color: C.teal }]} labelWidth={60} height={Math.max(100, d.by_province.length * 24 + 20)} onClick={(row) => nav(`${base}/clienti?province=${row.label}`)} />
            <div className="subhead">Comuni</div>
            <ol className="ranklist">{d.by_city.slice(0, 10).map((x, i) => <li key={x.label} className="click" onClick={() => nav(`${base}/clienti?city=${encodeURIComponent(x.label.replace(/ \(\w+\)$/, ''))}`)} style={{ cursor: 'pointer' }}><span className="n">{i + 1}</span><span className="lbl">{x.label}</span><span className="small muted">{num(x.customers)} paz.</span><span className="v">{eur0(x.revenue)}</span></li>)}</ol>
          </Card>
          <Card title="Quando vengono">
            <div className="subhead" style={{ marginTop: 0 }}>Giorno della settimana (accettazioni)</div>
            <VBars data={d.by_weekday.map((x) => ({ label: WEEKDAYS[x.label] || x.label, value: Number(x.tickets) }))} keys={[{ key: 'value', label: 'Accettazioni', color: C.blue }]} height={150} />
            <div className="subhead">Fascia oraria</div>
            <VBars data={d.by_hour.filter((x) => x.label != null).map((x) => ({ label: `${x.label}`, value: Number(x.tickets) }))} keys={[{ key: 'value', label: 'Accettazioni', color: C.teal }]} height={150} />
          </Card>
        </div>

        <div style={{ marginTop: 16 }}>
          <Card title="Il paziente tipo: i tre archetipi per volume di richiesta" actions={<span className="small muted">sesso, età, provenienza e cosa comprano · clicca per aprire l'elenco</span>}>
            {d.archetypes.length ? <div className="grid g3">{d.archetypes.map((a, i) => (
              <div key={i} className="card" style={{ padding: 16, cursor: 'pointer', borderTop: `4px solid ${[C.teal, C.blue, C.mauve][i]}` }} onClick={() => { const [lo, hi] = String(a.band).replace('+', '-120').split('-'); nav(`${base}/clienti?sex=${a.sex === 'n.d.' ? '' : a.sex}&age_from=${lo || ''}&age_to=${hi || ''}&province=${a.province === 'n.d.' ? '' : a.province}`); }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="small" style={{ letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800, color: 'var(--teal)' }}>Archetipo {i + 1}</span><Badge tone="teal">{pct(a.share_tickets, 1)} delle accettazioni</Badge></div>
                <div style={{ fontSize: 18, fontWeight: 780, color: 'var(--jet)', marginTop: 6 }}>{a.sex === 'F' ? 'Donna' : a.sex === 'M' ? 'Uomo' : 'Sesso n.d.'}, {a.band} anni{a.avg_age ? ` (media ${a.avg_age})` : ''}</div>
                <div className="muted">{a.province !== 'n.d.' ? `provincia di ${a.province}` : 'provenienza n.d.'}{a.cities.length ? `: ${a.cities.map((c) => c.label).join(', ')}` : ''}</div>
                <div className="row" style={{ marginTop: 10, gap: 14 }}><div><div className="small muted">Pazienti</div><div className="strong">{num(a.customers)}</div></div><div><div className="small muted">Accettazioni</div><div className="strong">{num(a.tickets)}</div></div><div><div className="small muted">Scontrino medio</div><div className="strong">{eur0(a.avg_ticket)}</div></div><div><div className="small muted">Spesa per paziente</div><div className="strong">{eur0(a.spend_per_customer)}</div></div></div>
                <div className="subhead">Cosa compra</div>
                <div className="row" style={{ gap: 4 }}>{a.products.map((p) => <span key={p.label} className="chip">{p.label}</span>)}</div>
                <div className="small muted" style={{ marginTop: 8 }}>Linee: {a.lines.map((l) => l.label).join(', ') || '–'} · Prenota via {a.channels.map((c) => CHANNEL[c.label] || c.label).join(', ') || '–'}</div>
              </div>))}</div> : <Empty>Servono vendite con pazienti profilati (sesso, data di nascita, provincia)</Empty>}
          </Card>
        </div>

        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Spesa media per profilo" flush actions={<span className="small muted">scontrino medio e spesa per paziente nel periodo</span>}>
            <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>Profilo</th><th className="num">Pazienti</th><th className="num">Scontrino medio</th><th className="num">Spesa per paziente</th><th className="num">Fatturato</th></tr></thead>
              <tbody>
                {[['Sesso', d.spend_by_sex.map((x) => ({ ...x, label: SEX[x.label] || x.label }))], ['Età', d.spend_by_age], ['Provincia', d.spend_by_province], ['Segmento', d.spend_by_segment.map((x) => ({ ...x, label: SEGMENT[x.label]?.label || x.label }))], ['Canale', d.spend_by_channel.map((x) => ({ ...x, label: CHANNEL[x.label] || x.label }))]].map(([g, rows]) => <React.Fragment key={g}>
                  <tr><td colSpan={5} className="subhead" style={{ padding: '10px 14px 4px' }}>{g}</td></tr>
                  {rows.map((x) => <tr key={g + x.label}><td>{x.label}</td><td className="num">{num(x.customers)}</td><td className="num strong">{eur0(x.avg_ticket)}</td><td className="num strong">{eur0(x.spend_per_customer)}</td><td className="num muted">{eur0(x.revenue)}</td></tr>)}
                </React.Fragment>)}
              </tbody></table></div>
          </Card>
          <Card title="Chi vende di più" flush actions={<span className="small muted">operatori di accettazione nel periodo</span>}>
            {d.top_operators.length ? <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>#</th><th>Operatore</th><th>Sede</th><th className="num">Accettazioni</th><th className="num">Fatturato</th><th className="num">Medio</th></tr></thead>
              <tbody>{d.top_operators.map((o, i) => <tr key={o.label} className="click" onClick={() => nav(`${base}/vendite?operator=${encodeURIComponent(o.label)}`)}><td><span className="n" style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: i < 3 ? 'var(--jet)' : 'var(--teal-050)', color: i < 3 ? 'var(--silk)' : 'var(--teal)', fontWeight: 800, fontSize: 11 }}>{i + 1}</span></td><td className="strong">{o.label}</td><td className="small muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.site_name}>{o.site_name}{o.sites > 1 ? ` +${o.sites - 1}` : ''}</td><td className="num">{num(o.tickets)}</td><td className="num strong">{eur0(o.revenue)}</td><td className="num">{eur0(o.avg_ticket)}</td></tr>)}</tbody></table></div> : <Empty>Nessun operatore nelle vendite: mappa la colonna "Operatore" negli import dai gestionali</Empty>}
          </Card>
        </div>

        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Prestazioni che funzionano di più" flush actions={<Link className="btn sm ghost" to={`${base}/prodotti`}>Tutte le prestazioni</Link>}>
            <ProductTable rows={d.top_products} nav={nav} />
          </Card>
          <Card title="Prestazioni che funzionano di meno" flush actions={<span className="small muted">tra quelle vendute nel periodo</span>}>
            <ProductTable rows={d.bottom_products} nav={nav} />
          </Card>
        </div>
        {k.revenue_costed > 0 && <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Prestazioni che rendono di più" flush actions={<span className="small muted">margine sul costo diretto nel periodo</span>}>
            <ProductTable rows={d.top_margin_products} nav={nav} margin />
          </Card>
          <Card title="Prestazioni che rendono di meno" flush actions={<span className="small muted">margine negativo o nullo: prezzo da rivedere o costo da verificare</span>}>
            <ProductTable rows={d.low_margin_products} nav={nav} margin />
          </Card>
        </div>}

        <div className="grid g3" style={{ marginTop: 16 }}>
          <Card title="Campagne in corso" flush actions={<Link className="btn sm ghost" to={`${base}/campagne`}>Tutte</Link>}>
            {d.campaigns.length ? <table className="t"><thead><tr><th>Campagna</th><th className="num">Speso</th><th className="num">Ricavi</th></tr></thead><tbody>{d.campaigns.map((c) => <tr key={c.id} className="click" onClick={() => nav(`${base}/campagne/${c.id}`)}><td><div className="strong">{c.name}</div><div className="small muted">{c.channel} · {itDate(c.start_date)}{c.end_date ? ` – ${itDate(c.end_date)}` : ''}</div></td><td className="num">{eur0(c.spent ?? c.budget)}</td><td className="num strong">{eur0(c.revenue)}</td></tr>)}</tbody></table> : <Empty>Nessuna campagna attiva</Empty>}
          </Card>
          <Card title="Esposizione in sede" actions={<Link className="btn sm ghost" to={`${base}/esposizione`}>Book retail</Link>}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Materiali conformi</span><span className="strong">{d.exposure.ok}/{d.exposure.total}</span></div>
            <Progress value={d.exposure.ok} max={d.exposure.total} />
            <p className="small muted" style={{ marginTop: 10 }}>{d.exposure.issues} material{d.exposure.issues === 1 ? 'e' : 'i'} da sostituire o non conform{d.exposure.issues === 1 ? 'e' : 'i'} · {d.exposure.sites_with_issues} sed{d.exposure.sites_with_issues === 1 ? 'e' : 'i'} con interventi aperti.</p>
          </Card>
          <Card title="Top clienti B2B" flush actions={<Link className="btn sm ghost" to={`${base}/clienti/b2b`}>Elenco B2B</Link>}>
            {d.top_b2b.length ? <table className="t"><thead><tr><th>Azienda</th><th className="num">Fatturato</th><th className="num">Margine</th><th className="num">Da fatturare</th></tr></thead><tbody>{d.top_b2b.slice(0, 10).map((c) => <tr key={c.id} className="click" onClick={() => nav(`${base}/clienti/${c.id}`)}><td className="strong">{c.label}<div className="small muted">{num(c.patients)} pazienti · {num(c.items)} esami{c.accounts > 1 ? ` · ${c.accounts} reparti` : ''}</div></td><td className="num">{eur0(c.revenue)}</td><td className="num">{Number(c.cost) > 0 ? <span className={Number(c.margin) < 0 ? 'red' : ''}>{eur0(c.margin)}<div className="small muted">{Number(c.revenue) > 0 ? pct((Number(c.margin) / Number(c.revenue)) * 100, 0) : ''}</div></span> : <span className="small muted">–</span>}</td><td className="num small">{eur0(c.uninvoiced)}</td></tr>)}</tbody></table> : <Empty>Nessuna vendita B2B nel periodo</Empty>}
          </Card>
        </div>
      </>}
    </div>
  );
}

const LINE_COLORS = [C.teal, C.blue, C.mauve, C.green, C.gold, C.grey];
const eurShortPct = (v, tot) => (tot ? `${Math.round((Number(v) / Number(tot)) * 100)}%` : '');

function ProductTable({ rows, nav, margin }) {
  if (!rows.length) return <Empty>Nessuna vendita nel periodo</Empty>;
  return (
    <div className="table-wrap"><table className="t"><thead><tr><th>Prestazione</th><th className="num">Q.tà</th><th className="num">Fatturato</th><th className="num">{margin ? 'Margine' : 'Δ'}</th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.id} className="click" onClick={() => nav(`${base}/prodotti?open=${x.id}`)}><td><div className="strong">{x.label}</div><div className="small muted">{x.code} · {x.sector || x.line_name}</div></td><td className="num">{num(x.items)}</td><td className="num strong">{eur0(x.revenue)}</td><td className="num">{margin ? (x.unit_cost != null ? <span className={Number(x.margin) < 0 ? 'red' : ''}>{eur0(x.margin)}<span className="small muted"> {Number(x.revenue) > 0 ? pct((Number(x.margin) / Number(x.revenue)) * 100, 0) : ''}</span></span> : <span className="small muted">senza costo</span>) : <Delta value={delta(x.revenue, x.revenue_prev)} />}</td></tr>)}</tbody></table></div>
  );
}
