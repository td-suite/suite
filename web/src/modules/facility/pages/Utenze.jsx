// Utenze per sede: lette e scritte nello Scadenziario strutture di Payments (finance.utilities e utility_bills), con l'estensione
// energetica di Facility (vettore, POD/PDR, potenza, tariffa, fattore CO2) e le letture dei contatori. Bollette registrate qui = scadenze
// di pagamento in Payments.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi, qs } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, useToast, Tabs, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isFacility } from '../index.jsx';
import { Transfer, SiteSelect, useSites, Alert } from '../components/bits.jsx';
import { VECTOR, UNIT, TRANSFER, itDate, eur, num, meseLabel, ogni } from '../format.js';

export default function Utenze() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const sites = useSites();
  const [siteId, setSiteId] = useState(sp.get('site_id') || '');
  const [all, setAll] = useState(false);
  const { data, loading, error, reload } = useApi(`/utenze${qs({ site_id: siteId, all: all ? 1 : '' })}`, [], { silent: true });
  const [nuova, setNuova] = useState(false);
  const [open, setOpen] = useState(null);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const bySite = [];
  for (const u of data.rows) { let g = bySite.find((x) => x.id === u.site_id); if (!g) bySite.push(g = { id: u.site_id, name: u.site_name, rows: [] }); g.rows.push(u); }
  return (
    <div className="page">
      <PageHead title="Utenze" icon="bolt" sub="Contratti di fornitura e bollette vivono nello Scadenziario strutture di Payments: quelli creati qui entrano nelle scadenze ricorrenti, le bollette registrate qui compaiono con la scadenza di pagamento."
        actions={<>{data.finance && <a className="btn ghost" href={`/finance/scadenziario${siteId ? `?site_id=${siteId}` : ''}`}><Icon name="external" />Scadenziario in Payments</a>}{data.finance && isFacility(user) && <button className="btn" onClick={() => setNuova(true)}><Icon name="plus" />Nuova utenza</button>}</>} />
      {!data.finance ? <Alert tone="warn" icon="alert">{data.message}</Alert> : <>
        <div className="fa-filters"><SiteSelect value={siteId} onChange={setSiteId} sites={sites} /><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Anche le cessate</label></div>
        {!bySite.length ? <Card><Empty icon="bolt" title="Nessuna utenza">{isFacility(user) ? 'Crea le utenze di energia elettrica, gas e acqua delle sedi con "Nuova utenza".' : 'Nessuna utenza registrata per le tue sedi.'}</Empty></Card> : bySite.map((g) => (
          <Card key={g.id} title={g.name} icon="building" flush style={{ marginBottom: 14 }}>
            <table className="t fa-table"><thead><tr><th>Vettore</th><th>Fornitore</th><th>POD / PDR</th><th>Intestazione</th><th>Fatturazione</th><th>Bollette</th><th>Prossima bolletta</th><th>Letture</th></tr></thead>
              <tbody>{g.rows.map((u) => <tr key={u.id} className="click" style={{ opacity: u.active ? 1 : 0.55 }} onClick={() => setOpen(u.id)}>
                <td className="strong">{VECTOR[u.vector] || u.kind}{!u.has_meta && <div className="small muted">creata in Payments</div>}</td><td>{u.supplier_name || '–'}</td><td className="small">{u.pod_pdr || u.code || '–'}{u.contracted_power_kw ? <div className="muted">{num(u.contracted_power_kw)} kW</div> : null}</td>
                <td><Transfer s={u.transfer_status} /></td><td className="small">{ogni(u.period_months)}{u.auto_pay ? ' · addebito' : ''}</td><td className="small">{u.n_bills}{u.unpaid ? <span style={{ color: 'var(--amber)' }}> · {u.unpaid} da pagare</span> : ''}{u.last_bill && <div className="muted">ultima {itDate(u.last_bill)}</div>}</td>
                <td className="small">{u.next_bill ? <>{itDate(u.next_bill.date)}<div className="muted">{u.next_bill.amount != null ? `${u.next_bill.estimate ? '~' : ''}${eur(u.next_bill.amount)}` : ''}</div></> : '–'}</td><td className="small">{u.n_readings}</td></tr>)}</tbody></table>
          </Card>))}
      </>}
      {nuova && <UtilityModal sites={sites} siteId={siteId} onClose={() => setNuova(false)} onDone={() => { setNuova(false); reload(); }} />}
      {open && <UtilityDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

export function UtilityModal({ sites, siteId, u, onClose, onDone }) {
  const toast = useToast();
  const { data: orgs } = useApi('/organizations');
  const [f, setF] = useState(u ? { vector: u.vector || 'ELETTRICO', supplier_org_id: u.supplier_org_id || '', supplier_name: u.supplier_name || '', pod_pdr: u.pod_pdr || u.code || '', holder: u.holder || '', transfer_status: u.transfer_status, period_months: u.period_months, ref_due: u.ref_due || '', avg_amount: u.avg_amount ?? '', offer_end: u.offer_end || '', auto_pay: u.auto_pay, contracted_power_kw: u.contracted_power_kw ?? '', tariff: u.tariff || '', co2_factor: u.co2_factor ?? '', active: u.active }
    : { site_id: siteId || '', vector: 'ELETTRICO', supplier_org_id: '', supplier_name: '', pod_pdr: '', holder: '', transfer_status: 'NON_NECESSARIA', period_months: 2, ref_due: '', avg_amount: '', offer_end: '', auto_pay: false, contracted_power_kw: '', tariff: '', co2_factor: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f }; for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    if (u && body.pod_pdr) body.code = body.pod_pdr;
    try { if (u) await api.put(`/utenze/${u.id}`, body); else await api.post('/utenze', body); toast(u ? 'Utenza aggiornata (anche in Payments)' : 'Utenza creata: è nello Scadenziario di Payments'); onDone(); } catch (e) { toast(e, 'err'); }
  };
  return (
    <Modal wide title={u ? 'Modifica utenza' : 'Nuova utenza'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <div className="fa-grid">
        {!u && <Field label="Sede" required><SiteSelect className="fa-in w" value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} sites={sites} all="Scegli la sede" /></Field>}
        <Field label="Vettore" required><select className="fa-in w" value={f.vector} onChange={set('vector')}>{Object.entries(VECTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={f.vector === 'GAS' ? 'PDR' : f.vector === 'ELETTRICO' ? 'POD' : 'Codice / matricola'}><input className="fa-in w" value={f.pod_pdr} onChange={set('pod_pdr')} /></Field>
        <Field label="Fornitore (Legal entity)"><select className="fa-in w" value={f.supplier_org_id} onChange={set('supplier_org_id')}><option value="">Non in anagrafica</option>{(orgs || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Fornitore (nome)" help="Se non è in anagrafica"><input className="fa-in w" value={f.supplier_name} onChange={set('supplier_name')} /></Field>
        <Field label="Intestatario"><input className="fa-in w" value={f.holder} onChange={set('holder')} /></Field>
        <Field label="Voltura"><select className="fa-in w" value={f.transfer_status} onChange={set('transfer_status')}>{Object.entries(TRANSFER).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Fatturazione ogni (mesi)"><select className="fa-in w" value={f.period_months} onChange={set('period_months')}>{[1, 2, 3, 4, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="Una scadenza nota" help="Da qui lo scadenziario calcola le prossime"><input className="fa-in w" type="date" value={f.ref_due} onChange={set('ref_due')} /></Field>
        <Field label="Importo medio (€)"><input className="fa-in w" type="number" min="0" step="0.01" value={f.avg_amount} onChange={set('avg_amount')} /></Field>
        <Field label="Potenza impegnata (kW)"><input className="fa-in w" type="number" min="0" step="0.1" value={f.contracted_power_kw} onChange={set('contracted_power_kw')} /></Field>
        <Field label="Tariffa / offerta"><input className="fa-in w" value={f.tariff} onChange={set('tariff')} /></Field>
        <Field label="Fine offerta"><input className="fa-in w" type="date" value={f.offer_end} onChange={set('offer_end')} /></Field>
        <Field label={`Fattore CO2 (kg/${UNIT[f.vector] || 'unità'})`} help="Vuoto = valore predefinito delle impostazioni"><input className="fa-in w" type="number" min="0" step="0.001" value={f.co2_factor} onChange={set('co2_factor')} /></Field>
      </div>
      <label className="row small" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={f.auto_pay} onChange={(e) => setF({ ...f, auto_pay: e.target.checked })} />Addebito automatico (in Payments le bollette non risultano da pagare a mano)</label>
      {u && <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Attiva</label>}
    </Modal>
  );
}

function UtilityDetail({ id, onClose }) {
  const toast = useToast();
  const sites = useSites();
  const { data: u, reload } = useApi(`/utenze/${id}`);
  const [tab, setTab] = useState('bollette');
  const [edit, setEdit] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [b, setB] = useState({ period_from: '', period_to: '', due_date: '', amount: '', consumption: '', paid_at: '' });
  const [r, setR] = useState({ read_at: today, value: '', source: 'MANUALE' });
  if (!u) return <Modal title="Utenza" onClose={onClose}><Loading /></Modal>;
  const addBill = async () => { const body = { ...b }; for (const k of Object.keys(body)) if (body[k] === '') body[k] = null; try { await api.post(`/utenze/${u.id}/bollette`, body); toast('Bolletta registrata: è nello Scadenziario di Payments'); setB({ period_from: '', period_to: '', due_date: '', amount: '', consumption: '', paid_at: '' }); reload(); } catch (e) { toast(e, 'err'); } };
  const delBill = async (x) => { try { await api.del(`/bollette/${x.id}`); reload(); } catch (e) { toast(e, 'err'); } };
  const addRead = async () => { try { await api.post(`/utenze/${u.id}/letture`, r); toast('Lettura registrata'); setR({ ...r, value: '' }); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal wide title={`${VECTOR[u.vector] || u.kind} · ${u.site_name}`} onClose={onClose} footer={<>{u.can_edit && <button className="btn ghost" onClick={() => setEdit(true)}><Icon name="edit" />Modifica</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Chiudi</button></>}>
      <div className="fa-facts" style={{ marginBottom: 12 }}>
        <div><div className="k">Fornitore</div><div className="v">{u.supplier_label || '–'}</div></div>
        <div><div className="k">POD / PDR</div><div className="v">{u.pod_pdr || u.code || '–'}</div></div>
        <div><div className="k">Voltura</div><Transfer s={u.transfer_status} /></div>
        <div><div className="k">Potenza · tariffa</div><div className="v">{u.contracted_power_kw ? `${num(u.contracted_power_kw)} kW` : '–'}{u.tariff ? ` · ${u.tariff}` : ''}</div></div>
        <div><div className="k">Unità</div><div className="v">{u.unit || '–'}</div></div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'bollette', label: 'Bollette', count: u.bills.length }, { value: 'letture', label: 'Letture', count: u.readings.length }, { value: 'consumi', label: 'Consumi per mese' }]} />
      {tab === 'bollette' && <>
        {u.can_edit && <div className="fa-grid g4" style={{ margin: '10px 0' }}>
          <Field label="Periodo dal"><input className="fa-in w" type="date" value={b.period_from} onChange={(e) => setB({ ...b, period_from: e.target.value })} /></Field>
          <Field label="al"><input className="fa-in w" type="date" value={b.period_to} onChange={(e) => setB({ ...b, period_to: e.target.value })} /></Field>
          <Field label="Scadenza di pagamento" required><input className="fa-in w" type="date" value={b.due_date} onChange={(e) => setB({ ...b, due_date: e.target.value })} /></Field>
          <Field label="Importo (€)" required><input className="fa-in w" type="number" min="0" step="0.01" value={b.amount} onChange={(e) => setB({ ...b, amount: e.target.value })} /></Field>
          <Field label={`Consumo (${u.unit || ''})`}><input className="fa-in w" type="number" min="0" step="0.001" value={b.consumption} onChange={(e) => setB({ ...b, consumption: e.target.value })} /></Field>
          <Field label="Pagata il"><input className="fa-in w" type="date" value={b.paid_at} onChange={(e) => setB({ ...b, paid_at: e.target.value })} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="btn" disabled={!b.due_date || b.amount === ''} onClick={addBill}><Icon name="plus" />Registra bolletta</button></div>
        </div>}
        {!u.bills.length ? <Empty compact icon="file" title="Nessuna bolletta" /> : <table className="t fa-table"><thead><tr><th>Periodo</th><th>Scadenza</th><th className="num">Importo</th><th className="num">Consumo</th><th>Pagata</th>{u.can_edit && <th />}</tr></thead>
          <tbody>{u.bills.map((x) => <tr key={x.id}><td>{x.period_from ? `${itDate(x.period_from)} - ${itDate(x.period_to)}` : '–'}</td><td>{itDate(x.due_date)}</td><td className="num">{eur(x.amount)}</td><td className="num">{x.consumption != null ? `${num(x.consumption)} ${x.unit || ''}` : '–'}</td><td>{x.paid_at ? itDate(x.paid_at) : <Badge tone="amber">da pagare</Badge>}</td>{u.can_edit && <td>{!x.paid_at && <button className="iconbtn" title="Elimina" onClick={() => delBill(x)}><Icon name="trash" /></button>}</td>}</tr>)}</tbody></table>}
      </>}
      {tab === 'letture' && <>
        {u.can_read_meter && <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
          <input className="fa-in" type="date" max={today} value={r.read_at} onChange={(e) => setR({ ...r, read_at: e.target.value })} />
          <input className="fa-in" type="number" min="0" step="0.001" placeholder={`Valore del contatore (${u.unit || ''})`} value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} />
          <select className="fa-in" value={r.source} onChange={(e) => setR({ ...r, source: e.target.value })}><option value="MANUALE">Lettura manuale</option><option value="BOLLETTA">Da bolletta</option><option value="SMART">Contatore intelligente</option></select>
          <button className="btn" disabled={r.value === ''} onClick={addRead}><Icon name="plus" />Registra lettura</button>
        </div>}
        {!u.readings.length ? <Empty compact icon="list" title="Nessuna lettura">Le letture servono quando le bollette non riportano il consumo: la differenza tra due letture è ripartita sui giorni.</Empty> : <table className="t fa-table"><thead><tr><th>Data</th><th className="num">Valore</th><th>Fonte</th><th>Da</th></tr></thead>
          <tbody>{u.readings.map((x) => <tr key={x.id}><td>{itDate(x.read_at)}</td><td className="num">{num(x.value, 0)} {u.unit}</td><td className="small">{x.source.toLowerCase()}</td><td className="small muted">{x.created_by_name || ''}</td></tr>)}</tbody></table>}
      </>}
      {tab === 'consumi' && (!u.monthly.length ? <Empty compact icon="stats" title="Nessun consumo calcolabile" /> : <table className="t fa-table" style={{ marginTop: 10 }}><thead><tr><th>Mese</th><th className="num">Consumo</th><th className="num">Costo</th><th>Fonte</th></tr></thead>
        <tbody>{[...u.monthly].reverse().map((m) => <tr key={m.month}><td>{meseLabel(m.month)}</td><td className="num">{m.qty != null ? `${num(m.qty)} ${u.unit}` : '–'}</td><td className="num">{m.cost != null ? eur(m.cost) : '–'}</td><td className="small muted">{m.source.toLowerCase()}</td></tr>)}</tbody></table>)}
      {edit && <UtilityModal sites={sites} u={{ ...u, supplier_name: u.supplier_name }} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </Modal>
  );
}
