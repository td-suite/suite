import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, SegmentBadge, Modal, useToast, Kpi } from '../components/ui.jsx';
import { SiteSelect, LineSelect } from '../components/filters.jsx';
import { qs, api, base, apiBase } from '../api.js';
import { eur, eur0, num, itDate, SEX, SEGMENT, CHANNEL, B2B_TYPE } from '../format.js';

const SORTS = [['revenue', 'Fatturato'], ['last_visit', 'Ultima visita'], ['first_visit', 'Prima visita'], ['visits', 'Visite'], ['name', 'Nome'], ['age', 'Età'], ['city', 'Comune']];

export default function Customers({ kind }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const init = () => ({ q: sp.get('q') || '', sex: sp.get('sex') || '', province: sp.get('province') || '', city: sp.get('city') || '', site_id: sp.get('site_id') || '', channel: sp.get('channel') || '', segment: sp.get('segment') || '', consent: sp.get('consent') || '', age_from: sp.get('age_from') || '', age_to: sp.get('age_to') || '', line_id: sp.get('line_id') || '', b2b_type: sp.get('b2b_type') || '', sort: sp.get('sort') || 'revenue', offset: 0 });
  const [f, setF] = useState(init);
  useEffect(() => { setF(init()); /* eslint-disable-next-line */ }, [kind]);
  useEffect(() => { const o = {}; for (const [k, v] of Object.entries(f)) if (v && k !== 'offset') o[k] = v; setSp(o, { replace: true }); }, [f, setSp]);
  const facets = useApi('/customers/facets');
  const list = useApi(`/customers${qs({ ...f, kind, limit: 100 })}`, [kind]);
  const [edit, setEdit] = useState(null);
  const d = list.data;
  const set = (k, v) => setF({ ...f, [k]: v, offset: 0 });
  const save = async () => {
    try {
      const body = { ...edit, kind, employees: edit.employees === '' || edit.employees == null ? null : Number(edit.employees), home_site_id: edit.home_site_id ? Number(edit.home_site_id) : null };
      delete body.id;
      const r = edit.id ? await api.put(`/customers/${edit.id}`, body) : await api.post('/customers', body);
      toast('Cliente salvato'); setEdit(null); if (r.id) nav(`${base}/clienti/${r.id}`); else list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const isB2B = kind === 'B2B';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{isB2B ? 'Aziende e strutture (B2B)' : 'Clienti e profilazione (B2C)'}</h1><div className="sub">{isB2B ? 'Aziende per medicina del lavoro e welfare, strutture sanitarie e laboratori in service, assicurazioni e fondi.' : 'Chi sono i pazienti, da dove vengono, cosa comprano e quando tornano. Filtra per profilo e apri la scheda per lo storico.'}</div></div>
        <div className="row">
          <a className="btn ghost" href={`${apiBase}/customers/export.xlsx${qs({ ...f, kind })}`}>Esporta Excel</a>
          {canWrite(user) && <button className="btn" onClick={() => setEdit({ kind, marketing_consent: false })}>+ Nuovo {isB2B ? 'cliente B2B' : 'paziente'}</button>}
        </div>
      </div>
      <div className="filters">
        <Field label="Cerca"><input placeholder={isB2B ? 'Ragione sociale, P.IVA, comune…' : 'Cognome, nome, CF, email, comune…'} value={f.q} onChange={(e) => set('q', e.target.value)} /></Field>
        {!isB2B && <Field label="Sesso"><select value={f.sex} onChange={(e) => set('sex', e.target.value)}><option value="">Tutti</option><option value="F">Donne</option><option value="M">Uomini</option></select></Field>}
        {!isB2B && <Field label="Età da"><input type="number" min="0" style={{ width: 80 }} value={f.age_from} onChange={(e) => set('age_from', e.target.value)} /></Field>}
        {!isB2B && <Field label="a"><input type="number" min="0" style={{ width: 80 }} value={f.age_to} onChange={(e) => set('age_to', e.target.value)} /></Field>}
        <Field label="Provincia"><select value={f.province} onChange={(e) => set('province', e.target.value)}><option value="">Tutte</option>{(facets.data?.provinces || []).map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}</select></Field>
        <Field label="Comune"><input list="cities" value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Tutti" /><datalist id="cities">{(facets.data?.cities || []).map((x) => <option key={x.v} value={x.v} />)}</datalist></Field>
        <SiteSelect value={f.site_id} onChange={(v) => set('site_id', v)} label="Sede di riferimento" />
        {!isB2B && <Field label="Segmento"><select value={f.segment} onChange={(e) => set('segment', e.target.value)}><option value="">Tutti</option>{Object.entries(SEGMENT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
        {!isB2B && <Field label="Canale di acquisizione"><select value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="">Tutti</option>{(facets.data?.channels || []).map((x) => <option key={x.v} value={x.v}>{CHANNEL[x.v] || x.v} ({x.n})</option>)}</select></Field>}
        {isB2B && <Field label="Tipologia"><select value={f.b2b_type} onChange={(e) => set('b2b_type', e.target.value)}><option value="">Tutte</option>{Object.entries(B2B_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        <LineSelect value={f.line_id} onChange={(v) => set('line_id', v)} />
        {!isB2B && <Field label="Consenso marketing" className="inline" style={{ alignSelf: 'center' }}><input type="checkbox" checked={f.consent === '1'} onChange={(e) => set('consent', e.target.checked ? '1' : '')} /> solo con consenso</Field>}
        <Field label="Ordina per"><select value={f.sort} onChange={(e) => set('sort', e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <ErrorBox error={list.error} />
      {d && <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi label="Clienti selezionati" value={num(d.total)} foot="rispondono ai filtri impostati" />
        <Kpi label="Fatturato complessivo" value={eur0(d.revenue)} foot="storico delle vendite dei clienti selezionati" />
        <Kpi label="Fatturato medio per cliente" value={eur0(d.total ? d.revenue / d.total : 0)} foot="valore medio storico" />
      </div>}
      <Card flush>
        {list.loading && !d ? <Loading /> : !d?.rows.length ? <Empty>Nessun cliente trovato</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>{isB2B ? 'Azienda' : 'Paziente'}</th>{!isB2B && <th>Profilo</th>}<th>Provenienza</th><th>Sede di riferimento</th><th>Segmento</th><th>Prima / ultima visita</th><th className="num">Visite</th><th className="num">Fatturato</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`${base}/clienti/${r.id}`)}>
                <td><div className="strong">{isB2B ? r.company_name : `${r.last_name} ${r.first_name}`}</div><div className="small muted">{isB2B ? `${B2B_TYPE[r.b2b_type] || r.b2b_type || ''}${r.sector ? ` · ${r.sector}` : ''}` : `${r.tax_code || ''}${r.email ? ` · ${r.email}` : ''}`}</div></td>
                {!isB2B && <td>{r.sex ? SEX[r.sex] : '–'}{r.age != null ? `, ${r.age} anni` : ''}<div className="small muted">{CHANNEL[r.acquisition_channel] || r.acquisition_channel || ''}{r.marketing_consent ? ' · consenso mkt' : ''}</div></td>}
                <td>{r.city || '–'}{r.province ? ` (${r.province})` : ''}</td>
                <td className="small">{r.home_site_name || '–'}</td>
                <td><SegmentBadge segment={r.segment} /></td>
                <td className="small">{itDate(r.first_visit) || '–'}<br />{itDate(r.last_visit) || ''}</td>
                <td className="num">{num(r.visits)}</td>
                <td className="num strong">{eur(r.revenue)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {d && d.total > d.limit && <div className="row" style={{ padding: 12, justifyContent: 'space-between' }}><span className="small muted">{d.offset + 1}–{Math.min(d.total, d.offset + d.limit)} di {num(d.total)}</span><div className="row"><button className="btn sm ghost" disabled={!d.offset} onClick={() => setF({ ...f, offset: Math.max(0, d.offset - d.limit) })}>Precedenti</button><button className="btn sm ghost" disabled={d.offset + d.limit >= d.total} onClick={() => setF({ ...f, offset: d.offset + d.limit })}>Successivi</button></div></div>}
      </Card>
      {edit && <CustomerModal value={edit} onChange={setEdit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

export function CustomerModal({ value: v, onChange, onClose, onSave }) {
  const sites = useApi('/sites');
  const orgs = useApi('/organizations');
  const s = (k, x) => onChange({ ...v, [k]: x });
  const isB2B = v.kind === 'B2B';
  return (
    <Modal title={v.id ? 'Modifica cliente' : isB2B ? 'Nuovo cliente B2B' : 'Nuovo paziente'} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={onSave}>Salva</button></>}>
      <div className="form-grid">
        {isB2B ? <>
          <Field label="Ragione sociale *" className="span2"><input value={v.company_name || ''} onChange={(e) => s('company_name', e.target.value)} /></Field>
          <Field label="Partita IVA"><input value={v.vat_number || ''} onChange={(e) => s('vat_number', e.target.value)} className="mono" /></Field>
          <Field label="Tipologia"><select value={v.b2b_type || ''} onChange={(e) => s('b2b_type', e.target.value)}><option value="">–</option>{Object.entries(B2B_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Settore"><input value={v.sector || ''} onChange={(e) => s('sector', e.target.value)} placeholder="es. manifatturiero, GDO, sanità" /></Field>
          <Field label="Dipendenti"><input type="number" value={v.employees ?? ''} onChange={(e) => s('employees', e.target.value)} /></Field>
          <Field label="Referente"><input value={v.contact_name || ''} onChange={(e) => s('contact_name', e.target.value)} /></Field>
          <Field label="Organizzazione in anagrafica" help="Collega il cliente a una società, cliente o partner dell'anagrafica unica della Suite (facoltativo)" className="span2"><select value={v.organization_id || ''} onChange={(e) => s('organization_id', e.target.value ? Number(e.target.value) : null)}><option value="">– nessun collegamento –</option>{(orgs.data || []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.vat_number ? ` · ${o.vat_number}` : ''} ({o.kind})</option>)}</select></Field>
          <Field label="Gruppo" help="Clienti con più reparti o sedi"><input value={v.group_name || ''} onChange={(e) => s('group_name', e.target.value)} /></Field>
          <Field label="Codice nel gestionale"><input className="mono" value={v.external_code || ''} onChange={(e) => s('external_code', e.target.value)} /></Field>
        </> : <>
          <Field label="Cognome *"><input value={v.last_name || ''} onChange={(e) => s('last_name', e.target.value)} /></Field>
          <Field label="Nome *"><input value={v.first_name || ''} onChange={(e) => s('first_name', e.target.value)} /></Field>
          <Field label="Sesso"><select value={v.sex || ''} onChange={(e) => s('sex', e.target.value)}><option value="">–</option><option value="F">Donna</option><option value="M">Uomo</option></select></Field>
          <Field label="Data di nascita"><input type="date" value={v.birth_date || ''} onChange={(e) => s('birth_date', e.target.value)} /></Field>
          <Field label="Codice fiscale"><input value={v.tax_code || ''} maxLength={16} onChange={(e) => s('tax_code', e.target.value.toUpperCase())} className="mono" /></Field>
          <Field label="Canale di acquisizione"><select value={v.acquisition_channel || ''} onChange={(e) => s('acquisition_channel', e.target.value)}><option value="">–</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Consenso marketing" className="inline"><input type="checkbox" checked={Boolean(v.marketing_consent)} onChange={(e) => s('marketing_consent', e.target.checked)} /> autorizza comunicazioni commerciali</Field>
        </>}
        <Field label="Email"><input type="email" value={v.email || ''} onChange={(e) => s('email', e.target.value)} /></Field>
        <Field label="Telefono"><input value={v.phone || ''} onChange={(e) => s('phone', e.target.value)} /></Field>
        <Field label="Indirizzo"><input value={v.address || ''} onChange={(e) => s('address', e.target.value)} /></Field>
        <Field label="CAP"><input value={v.zip || ''} onChange={(e) => s('zip', e.target.value)} /></Field>
        <Field label="Comune"><input value={v.city || ''} onChange={(e) => s('city', e.target.value)} /></Field>
        <Field label="Provincia"><input value={v.province || ''} maxLength={2} onChange={(e) => s('province', e.target.value.toUpperCase())} /></Field>
        <Field label="Sede di riferimento"><select value={v.home_site_id || ''} onChange={(e) => s('home_site_id', e.target.value)}><option value="">–</option>{(sites.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Note" className="span2"><textarea value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
