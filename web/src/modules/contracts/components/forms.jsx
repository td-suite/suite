import React, { useEffect, useState } from 'react';
import { Field, MoneyInput, useApi, Icon } from './ui.jsx';
import { LEVELS, LEVEL_LABEL, CONTRACT, FEE_TYPE, FEE_VAT, PERSON_KIND, eur } from '../format.js';
import { api } from '../api.js';

const set = (v, onChange) => (k, x) => onChange({ ...v, [k]: x });

// Elenco di stringhe (benefit, titoli, attività)
export function ListEditor({ value = [], onChange, placeholder, addLabel = 'Aggiungi' }) {
  const upd = (i, t) => onChange(value.map((x, j) => (j === i ? t : x)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.map((x, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
          <input value={x} placeholder={placeholder} onChange={(e) => upd(i, e.target.value)} />
          <button type="button" className="iconbtn" aria-label="Rimuovi" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="trash" /></button>
        </div>
      ))}
      <div><button type="button" className="btn sm ghost" onClick={() => onChange([...value, ''])}>+ {addLabel}</button></div>
    </div>
  );
}

export function RalStepsEditor({ value = [], onChange }) {
  const upd = (i, k, x) => onChange(value.map((s, j) => (j === i ? { ...s, [k]: x } : s)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.map((s, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
          <input type="date" value={s.from || ''} onChange={(e) => upd(i, 'from', e.target.value)} style={{ width: 170 }} />
          <MoneyInput value={s.ral ?? ''} onChange={(x) => upd(i, 'ral', x)} placeholder="Nuova RAL" />
          <button type="button" className="iconbtn" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="trash" /></button>
        </div>
      ))}
      <div><button type="button" className="btn sm ghost" onClick={() => onChange([...value, { from: '', ral: '' }])}>+ Crescita di RAL con decorrenza</button></div>
    </div>
  );
}

/** Tendine a cascata per livello (fino a 4); salva l'area più profonda scelta. */
export function AreaSelects({ areas, value, onChange }) {
  const MAX = 4;
  const byId = Object.fromEntries(areas.map((a) => [a.id, a]));
  const chain = []; let cur = value ? byId[value] : null;
  while (cur) { chain.unshift(cur); cur = cur.parent_id ? byId[cur.parent_id] : null; }
  const opts = (parent) => areas.filter((a) => (parent ? a.parent_id === parent.id : a.level === 1));
  const pick = (e, fallback) => onChange(e.target.value ? Number(e.target.value) : fallback);
  const rows = [];
  for (let i = 0; i < MAX; i++) {
    const parent = i === 0 ? null : chain[i - 1] || null;
    const list = i === 0 ? opts(null) : parent ? opts(parent) : [];
    if (i > 0 && !list.length && !chain[i]) { if (i >= 3) break; }
    rows.push(<Field key={i} label={`Area (${i + 1}° livello)`} help={i === 0 ? undefined : parent ? `di: ${parent.name}` : `scegli prima il ${i}° livello`}><select value={chain[i]?.id || ''} disabled={i > 0 && !list.length} onChange={(e) => pick(e, parent?.id || null)}><option value="">–</option>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>);
  }
  return <>{rows}</>;
}

/** Doppie funzioni: aree aggiuntive oltre a quella principale. */
export function ExtraAreas({ areas, primary, value, onChange }) {
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(null);
  const byId = Object.fromEntries(areas.map((a) => [a.id, a]));
  const ids = (value || []).filter((id) => id !== primary && byId[id]);
  const add = () => { if (pick && pick !== primary && !ids.includes(pick)) onChange([...ids, pick]); setPick(null); setAdding(false); };
  return (
    <div className="f span2" style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 650, color: 'var(--muted)' }}>
      <span>Altre funzioni (doppia rispondenza)</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', minHeight: 32 }}>
        {ids.length === 0 && !adding && <span className="small muted" style={{ fontWeight: 400 }}>nessuna</span>}
        {ids.map((id) => <span key={id} className="badge b-grey" title={byId[id].path}>{byId[id].name}<button type="button" className="btn sm link" title="Rimuovi" style={{ marginLeft: 4, fontSize: 14, lineHeight: 1 }} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button></span>)}
        {!adding && <button type="button" className="btn sm ghost" onClick={() => setAdding(true)}>Aggiungi funzione</button>}
      </div>
      {adding && <div className="form-grid" style={{ marginTop: 4, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
        <AreaSelects areas={areas} value={pick} onChange={setPick} />
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}><button type="button" className="btn sm" disabled={!pick || pick === primary} onClick={add}>Conferma</button><button type="button" className="btn sm ghost" onClick={() => { setAdding(false); setPick(null); }}>Annulla</button></div>
      </div>}
      <span className="help">Per chi guida o opera in più aree: l'area scelta sopra resta quella principale</span>
    </div>
  );
}

/** Selettore della sede dell'anagrafica unica (public.sites, elenco da /work-sites). Le sedi si gestiscono in Amministrazione > Sedi. */
export function SiteSelect({ sites = [], value, onChange, placeholder = '–', showAddress = false }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">{placeholder}</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}{showAddress && x.address ? ` · ${x.address}` : ''}</option>)}</select>;
}

// Anagrafica unica della Suite: i campi generali (nome, contatti, tipo, sede, responsabile) vanno in public.people e compaiono
// anche nella Rubrica; i campi del dossier HR (residenza, partita IVA, IBAN, matricola, note) restano riservati al modulo.
export function PersonForm({ value: v, onChange, kind }) {
  const s = set(v, onChange);
  const areas = useApi('/areas');
  const people = useApi('/resources?status=ATTIVO,IMPEGNO');
  const sites = useApi('/work-sites');
  const kinds = kind === 'LP' ? ['LP', 'MEDICO', 'SANITARIO'] : ['DIPENDENTE', 'DIRIGENTE'];
  const onCf = (cf) => {
    const up = cf.toUpperCase();
    const patch = { tax_code: up };
    if (up.length === 16 && !v.sex) { const dd = Number(up.slice(9, 11)); if (!Number.isNaN(dd)) patch.sex = dd > 40 ? 'F' : 'M'; }
    onChange({ ...v, ...patch });
  };
  return (
    <>
    <div className="subhead" style={{ marginTop: 0 }}>Anagrafica (visibile nella Rubrica della Suite)</div>
    <div className="form-grid">
      <Field label="Cognome *"><input value={v.last_name || ''} onChange={(e) => s('last_name', e.target.value)} required /></Field>
      <Field label="Nome *"><input value={v.first_name || ''} onChange={(e) => s('first_name', e.target.value)} required /></Field>
      <Field label="Tipo di persona" help={kind === 'LP' ? 'Incarico autonomo: professionista, medico o personale sanitario' : 'Rapporto subordinato: dipendente o dirigente'}><select value={kinds.includes(v.kind) ? v.kind : kinds[0]} onChange={(e) => s('kind', e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{PERSON_KIND[k]}</option>)}</select></Field>
      <Field label="Sesso"><select value={v.sex || ''} onChange={(e) => s('sex', e.target.value)}><option value="">–</option><option value="F">Donna</option><option value="M">Uomo</option></select></Field>
      <Field label="Titolo" help="dott., dott.ssa, prof., avv."><input value={v.title || ''} onChange={(e) => s('title', e.target.value)} /></Field>
      <Field label="Data di nascita"><input type="date" value={v.birth_date || ''} onChange={(e) => s('birth_date', e.target.value)} /></Field>
      <Field label="Codice fiscale"><input value={v.tax_code || ''} maxLength={16} onChange={(e) => onCf(e.target.value)} className="mono" /></Field>
      <Field label="Email"><input type="email" value={v.email || ''} onChange={(e) => s('email', e.target.value)} /></Field>
      <Field label="Cellulare personale"><input value={v.phone || ''} onChange={(e) => s('phone', e.target.value)} /></Field>
      <Field label="Telefono fisso"><input value={v.phone_office || ''} placeholder="numero diretto" onChange={(e) => s('phone_office', e.target.value)} /></Field>
      <Field label="Interno"><input value={v.phone_ext || ''} maxLength={10} placeholder="centralino" onChange={(e) => s('phone_ext', e.target.value)} /></Field>
      <Field label="Sede" help="Sede di appartenenza (Amministrazione > Sedi)"><SiteSelect sites={sites.data || []} value={v.site_id} onChange={(id) => s('site_id', id)} /></Field>
      <AreaSelects areas={areas.data || []} value={v.area_id} onChange={(id) => s('area_id', id)} />
      <ExtraAreas areas={areas.data || []} primary={v.area_id} value={v.extra_area_ids || []} onChange={(ids) => s('extra_area_ids', ids)} />
      <Field label="Riporta a (responsabile gerarchico)" help="Definisce l'organigramma delle persone"><select value={v.manager_id || ''} onChange={(e) => s('manager_id', e.target.value ? Number(e.target.value) : null)}><option value="">–</option>{(people.data || []).filter((p) => p.id !== v.id).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}</option>)}</select></Field>
      <Field label="Approva ferie, permessi e richieste" help="Vuoto = il responsabile gerarchico"><select value={v.approver_id || ''} onChange={(e) => s('approver_id', e.target.value ? Number(e.target.value) : null)}><option value="">come il responsabile</option>{(people.data || []).filter((p) => p.id !== v.id).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}</option>)}</select></Field>
    </div>
    <div className="subhead">Dossier HR (riservato al modulo Contratti del personale)</div>
    <div className="form-grid">
      <Field label="Luogo di nascita"><input value={v.birth_place || ''} placeholder="Firenze (FI)" onChange={(e) => s('birth_place', e.target.value)} /></Field>
      <Field label="Nazionalità"><input value={v.nationality || ''} placeholder="italiana" onChange={(e) => s('nationality', e.target.value)} /></Field>
      {kind === 'LP' && <Field label="Partita IVA"><input value={v.vat_number || ''} onChange={(e) => s('vat_number', e.target.value)} className="mono" /></Field>}
      <Field label="Cellulare aziendale"><input value={v.mobile_company || ''} onChange={(e) => s('mobile_company', e.target.value)} /></Field>
      <Field label="Residenza (via e civico)"><input value={v.address || ''} onChange={(e) => s('address', e.target.value)} /></Field>
      <Field label="CAP"><input value={v.zip || ''} onChange={(e) => s('zip', e.target.value)} /></Field>
      <Field label="Città"><input value={v.city || ''} onChange={(e) => s('city', e.target.value)} /></Field>
      <Field label="Provincia"><input value={v.province || ''} maxLength={2} onChange={(e) => s('province', e.target.value.toUpperCase())} /></Field>
      <Field label="IBAN"><input value={v.iban || ''} maxLength={34} onChange={(e) => s('iban', e.target.value.toUpperCase())} className="mono" /></Field>
      <Field label={kind === 'LP' ? 'Codice interno' : 'Matricola'}><input value={v.badge_number || ''} onChange={(e) => s('badge_number', e.target.value)} /></Field>
      <Field label="Contatto per emergenze" className="span2"><input value={v.emergency_contact || ''} placeholder="nome, legame, telefono" onChange={(e) => s('emergency_contact', e.target.value)} /></Field>
      <Field label="Note HR" className="span2"><textarea value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field>
    </div>
    </>
  );
}

const MBO_DEFAULT = [
  { area: 'Performance Economica', objective: 'Raggiungimento del risultato del Piano Industriale', kpi: 'Fatturato annuo lordo', target: 'Delta', weight: 25 },
  { area: 'Performance Economica', objective: 'Raggiungimento del risultato del Piano Industriale', kpi: 'EBITDA / Fatturato', target: 'Delta', weight: 25 },
  { area: 'Qualità del Servizio', objective: 'Raggiungimento di un indice di soddisfazione utenti pari o superiore al 90%', kpi: 'Customer Satisfaction Score', target: '≥90%', weight: 15 },
  { area: 'Sviluppo Organizzativo', objective: 'Raggiungimento del risultato del Piano Industriale', kpi: 'Consolidamento Modello Organizzativo', target: '100%', weight: 5 },
  { area: 'Obiettivo Individuale', objective: '', kpi: 'Performance Individuale', target: 'Sì/No', weight: 30 },
];

export function MboEditor({ value = [], onChange }) {
  const rows = value.length ? value : [];
  const upd = (i, k, x) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  const tot = rows.reduce((a, r) => a + Number(r.weight || 0), 0);
  return (
    <div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Area strategica</th><th>Obiettivo</th><th>KPI</th><th>Target</th><th className="num">Peso %</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td><input value={r.area || ''} onChange={(e) => upd(i, 'area', e.target.value)} /></td>
            <td><input value={r.objective || ''} onChange={(e) => upd(i, 'objective', e.target.value)} /></td>
            <td><input value={r.kpi || ''} onChange={(e) => upd(i, 'kpi', e.target.value)} /></td>
            <td><input value={r.target || ''} onChange={(e) => upd(i, 'target', e.target.value)} style={{ width: 90 }} /></td>
            <td><input type="number" value={r.weight ?? ''} onChange={(e) => upd(i, 'weight', e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 70 }} className="num" /></td>
            <td><button type="button" className="iconbtn" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button></td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={4}>Totale pesi</td><td className={`num ${tot !== 100 ? 'red' : 'green'}`}>{tot}%</td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...rows, { area: '', objective: '', kpi: '', target: '', weight: 0 }])}>+ Obiettivo</button>
        {!rows.length && <button type="button" className="btn sm ghost" onClick={() => onChange(MBO_DEFAULT)}>Carica schema standard Top Management</button>}
      </div>
    </div>
  );
}

// Dati del rapporto di lavoro subordinato (contratto) o della lettera di impegno (subset)
export function EmploymentForm({ value: v, onChange, letter = false, sites = [] }) {
  const s = set(v, onChange);
  const isDir = v.contract_type === 'DIRIGENTE';
  const [sim, setSim] = useState(null);
  useEffect(() => {
    if (!v.ral || (!v.level && !isDir)) { setSim(null); return; }
    const t = setTimeout(() => api.post('/ccnl/simulate', { ral: Number(v.ral), level: isDir ? null : v.level, monthly_payments: Number(v.monthly_payments || 14), at_date: v.start_date || null, contract_type: v.contract_type || 'TIND', weekly_hours: Number(v.weekly_hours || 40) }).then(setSim).catch(() => setSim(null)), 350);
    return () => clearTimeout(t);
  }, [v.ral, v.level, v.monthly_payments, v.start_date, v.contract_type, v.weekly_hours]);
  const applyDecomp = () => sim && onChange({ ...v, base_pay: sim.decomposition.base_pay, superminimo: sim.decomposition.superminimo, function_allowance: sim.decomposition.function_allowance });
  return (
    <>
      <div className="form-grid">
        <Field label="Tipologia contratto" help={isDir ? 'CCNL Dirigenti Industria: nessun livello, 13 mensilità, FASI e Previndai, minimo contrattuale di garanzia + superminimo ad personam' : ''}><select value={v.contract_type || 'TIND'} onChange={(e) => e.target.value === 'DIRIGENTE' ? onChange({ ...v, contract_type: 'DIRIGENTE', level: 'DIRIGENTE', qualification: 'Dirigente', monthly_payments: 13, probation: 'Non richiesto', autonomous_hours: true, weekly_days: 5 }) : s('contract_type', e.target.value)}>{Object.entries(CONTRACT).filter(([k]) => !letter || k !== 'DIRIGENTE').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {isDir ? <Field label="Qualifica"><input value="Dirigente" disabled /></Field> : <Field label="Livello di ingresso"><select value={v.level || ''} onChange={(e) => s('level', e.target.value)}><option value="">–</option>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field>}
        {!isDir && <Field label="Qualifica"><input value={v.qualification || ''} placeholder={v.level === 'Q' ? 'Quadro' : 'Impiegato'} onChange={(e) => s('qualification', e.target.value)} /></Field>}
        {isDir && <Field label="Riporta a" help="Compare nella lettera: 'Lei riporterà …'"><input value={v.reports_to || ''} placeholder="al Presidente del Consiglio di Amministrazione della scrivente Società" onChange={(e) => s('reports_to', e.target.value)} /></Field>}
        <Field label={isDir ? 'Ruolo e funzione' : 'Mansione'} className="span2"><input value={v.job_title || ''} onChange={(e) => s('job_title', e.target.value)} /></Field>
        <Field label={letter ? 'Decorrenza: non oltre il' : 'Decorrenza (data assunzione)'}><input type="date" value={(letter ? v.start_by : v.start_date) || ''} onChange={(e) => s(letter ? 'start_by' : 'start_date', e.target.value)} /></Field>
        {letter && <Field label="Validità della proposta sino al"><input type="date" value={v.valid_until || ''} onChange={(e) => s('valid_until', e.target.value)} /></Field>}
        {!letter && (v.contract_type === 'TDET' || v.contract_type === 'APPRENDISTATO') && <Field label={v.contract_type === 'APPRENDISTATO' ? 'Fine periodo formativo' : 'Scadenza contratto'}><input type="date" value={v.end_date || ''} onChange={(e) => s('end_date', e.target.value)} /></Field>}
        <Field label="Ore settimanali"><input type="number" step="0.5" value={v.weekly_hours ?? 40} onChange={(e) => s('weekly_hours', Number(e.target.value))} /></Field>
        {!letter && <Field label="Giorni settimanali"><select value={v.weekly_days ?? 5} onChange={(e) => onChange({ ...v, weekly_days: Number(e.target.value), days_label: Number(e.target.value) === 6 ? 'dal lunedì al sabato' : 'dal lunedì al venerdì' })}><option value={5}>5 (lunedì-venerdì)</option><option value={6}>6 (lunedì-sabato)</option></select></Field>}
        <Field label="RAL (lordo annuo) *"><MoneyInput value={v.ral ?? ''} onChange={(x) => s('ral', x)} /></Field>
        {!letter && <Field label="Mensilità"><select value={v.monthly_payments ?? 14} onChange={(e) => s('monthly_payments', Number(e.target.value))}><option value={14}>14</option><option value={13}>13</option><option value={12}>12</option></select></Field>}
        <Field label="Sede di lavoro" className="span2" help={v.work_site_id ? (sites.find((x) => x.id === v.work_site_id)?.address || '') : 'Sede dell\'anagrafica unica: nel documento compare l\'indirizzo completo'}><SiteSelect sites={sites} value={v.work_site_id} onChange={(id) => s('work_site_id', id)} placeholder="– sede legale (impostazioni) –" /></Field>
        {!letter && <Field label="Periodo di prova" help="Testo che compare nel contratto"><input value={v.probation ?? 'Nessuno.'} onChange={(e) => s('probation', e.target.value)} /></Field>}
        {!letter && <Field label="Giorni di prova (per il calendario)"><input type="number" value={v.probation_days ?? ''} onChange={(e) => s('probation_days', e.target.value === '' ? null : Number(e.target.value))} /></Field>}
        <Field label="Autonomia di orario" className="inline" help=""><input type="checkbox" checked={Boolean(v.autonomous_hours)} onChange={(e) => s('autonomous_hours', e.target.checked)} /> clausola D.Lgs. 66/2003 (esclusione dai limiti massimi di orario)</Field>
        {!letter && <Field label="Smart working" className="inline"><input type="checkbox" checked={Boolean(v.smart_working)} onChange={(e) => s('smart_working', e.target.checked)} /> accordo di lavoro agile</Field>}
      </div>
      {!letter && sim && (
        <div className="alert info" style={{ marginTop: 12, display: 'block' }}>
          <b>Scomposizione CCNL</b> {isDir ? `(minimo contrattuale di garanzia dirigenti ${eur(sim.decomposition.minimum_annual)} annui)` : null}{!isDir && <>(minimo tabellare livello {v.level} dal {sim.minimum?.valid_from ? sim.minimum.valid_from.split('-').reverse().join('/') : '–'})</>}: paga base {eur(sim.decomposition.base_pay)} · superminimo {eur(sim.decomposition.superminimo)}{!isDir && <> · indennità di funzione {eur(sim.decomposition.function_allowance)}</>} · lordo mensile {eur(sim.decomposition.ral_monthly)}.
          Costo azienda stimato {eur(sim.cost.annual)}/anno (coeff. {sim.cost.coefficient}).
          <button type="button" className="btn sm ghost" style={{ marginLeft: 10 }} onClick={applyDecomp}>Usa nel contratto</button>
        </div>
      )}
      {!letter && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Paga base (mensile)"><MoneyInput value={v.base_pay ?? ''} onChange={(x) => s('base_pay', x)} /></Field>
          <Field label="Superminimo (mensile)"><MoneyInput value={v.superminimo ?? ''} onChange={(x) => s('superminimo', x)} /></Field>
          <Field label="Superminimo" className="inline"><input type="checkbox" checked={v.superminimo_absorbable !== false} onChange={(e) => s('superminimo_absorbable', e.target.checked)} /> assorbibile</Field>
          <Field label="Indennità di funzione (mensile)"><MoneyInput value={v.function_allowance ?? ''} onChange={(x) => s('function_allowance', x)} /></Field>
        </div>
      )}
      <div className="subhead">Crescite di RAL con decorrenze successive</div>
      <RalStepsEditor value={v.ral_steps || []} onChange={(x) => s('ral_steps', x)} />
      <div className="subhead">MBO</div>
      <div className="row">
        <label className="f inline"><input type="checkbox" checked={Boolean(v.mbo_enabled)} onChange={(e) => s('mbo_enabled', e.target.checked)} /> MBO previsto</label>
        {v.mbo_enabled && <Field label="Premio massimo (% RAL)"><input type="number" step="0.5" min="0" max="100" value={v.mbo_pct ?? ''} onChange={(e) => s('mbo_pct', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 120 }} /></Field>}
        {v.mbo_enabled && !letter && <Field label="oppure premio in cifra fissa (€/anno)" help="Se valorizzato prevale sulla percentuale"><MoneyInput value={v.mbo_amount ?? ''} onChange={(x) => s('mbo_amount', x)} /></Field>}
        {v.mbo_enabled && !letter && <Field label="Esercizio"><input type="number" value={v.mbo_year ?? new Date().getFullYear()} onChange={(e) => s('mbo_year', Number(e.target.value))} style={{ width: 110 }} /></Field>}
      </div>
      {v.mbo_enabled && !letter && <div style={{ marginTop: 10 }}><MboEditor value={v.mbo_objectives || []} onChange={(x) => s('mbo_objectives', x)} /></div>}
      {!letter && <>
        <div className="subhead">Benefits e dotazioni di lavoro</div>
        <ListEditor value={v.benefits || []} onChange={(x) => s('benefits', x)} placeholder="es. PC portatile aziendale" addLabel="benefit / dotazione" />
      </>}
      {!letter && <div style={{ marginTop: 12 }}><Field label="Note interne"><textarea value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field></div>}
    </>
  );
}

export function FeesEditor({ value = [], onChange }) {
  const upd = (i, k, x) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  const unitFor = (t) => ({ FISSO: 'mese', ORARIO: 'ora', PRESTAZIONE: 'cad', VARIABILE: '%' }[t]);
  return (
    <div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Tipo</th><th>Descrizione / attività</th><th>Categoria</th><th className="num">Importo</th><th>Unità</th><th>IVA *</th><th>Note</th><th /></tr></thead>
        <tbody>{value.map((r, i) => (
          <tr key={i}>
            <td><select value={r.type} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, type: e.target.value, unit: unitFor(e.target.value) } : x)))} style={{ minWidth: 130 }}>{Object.entries(FEE_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td><input value={r.description || ''} onChange={(e) => upd(i, 'description', e.target.value)} style={{ minWidth: 220 }} /></td>
            <td><input value={r.category || ''} onChange={(e) => upd(i, 'category', e.target.value)} style={{ minWidth: 140 }} /></td>
            <td><MoneyInput value={r.amount ?? ''} onChange={(x) => upd(i, 'amount', x)} style={{ width: 110 }} /></td>
            <td><input value={r.unit || ''} onChange={(e) => upd(i, 'unit', e.target.value)} style={{ width: 70 }} placeholder={unitFor(r.type)} /></td>
            <td><select value={r.vat || ''} onChange={(e) => upd(i, 'vat', e.target.value || null)} style={{ minWidth: 110, borderColor: r.vat ? undefined : 'var(--danger, #b42318)' }}><option value="">– scegli –</option>{Object.entries(FEE_VAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td><input value={r.notes || ''} onChange={(e) => upd(i, 'notes', e.target.value)} /></td>
            <td><button type="button" className="iconbtn" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="trash" /></button></td>
          </tr>))}</tbody>
      </table></div>
      {value.some((r) => !r.vat) && <div className="small" style={{ color: 'var(--danger, #b42318)', marginTop: 6 }}>Indica per ogni compenso se è con o senza IVA.</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...value, { type: 'FISSO', description: '', category: '', amount: '', unit: 'mese', vat: null, notes: '' }])}>+ Compenso fisso</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...value, { type: 'ORARIO', description: '', category: '', amount: '', unit: 'ora', vat: null, notes: '' }])}>+ A ore</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...value, { type: 'PRESTAZIONE', description: '', category: '', amount: '', unit: 'cad', vat: null, notes: '' }])}>+ A prestazione</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...value, { type: 'VARIABILE', description: '', category: '', amount: '', unit: '%', vat: null, notes: 'del fatturato' }])}>+ Variabile sul fatturato</button>
      </div>
    </div>
  );
}

export function LpForm({ value: v, onChange }) {
  const s = set(v, onChange);
  const fixed = (v.fees || []).filter((f) => f.type === 'FISSO').reduce((a, f) => a + Number(f.amount || 0), 0);
  return (
    <>
      <div className="form-grid">
        <Field label="Disciplina"><input value={v.discipline || ''} placeholder="es. Anatomia Patologica, Infermieristica, Medicina del Lavoro" onChange={(e) => s('discipline', e.target.value)} /></Field>
        <Field label="Oggetto della prestazione" className="span2" help="Compare nel contratto dopo 'Oggetto della prestazione professionale sarà …'"><input value={v.role_description || ''} placeholder="la consulenza sanitaria negli ambiti per cui il Professionista è abilitato" onChange={(e) => s('role_description', e.target.value)} /></Field>
        <Field label="Inizio incarico"><input type="date" value={v.start_date || ''} onChange={(e) => s('start_date', e.target.value)} /></Field>
        <Field label="Scadenza incarico"><input type="date" value={v.end_date || ''} onChange={(e) => s('end_date', e.target.value)} /></Field>
        <Field label="Preavviso disdetta (giorni)"><input type="number" value={v.notice_days ?? 30} onChange={(e) => s('notice_days', Number(e.target.value))} /></Field>
        <Field label="Rinnovo automatico" className="inline"><input type="checkbox" checked={v.auto_renew !== false} onChange={(e) => s('auto_renew', e.target.checked)} /> salvo disdetta</Field>
        <Field label="Ordine professionale"><input value={v.order_name || ''} placeholder="Ordine dei Medici Chirurghi e Odontoiatri" onChange={(e) => s('order_name', e.target.value)} /></Field>
        <Field label="Provincia / sede dell'ordine"><input value={v.order_province || ''} placeholder="Firenze" onChange={(e) => s('order_province', e.target.value)} /></Field>
        <Field label="Numero di iscrizione"><input value={v.order_number || ''} onChange={(e) => s('order_number', e.target.value)} /></Field>
        <Field label="Iscritto dal"><input type="date" value={v.order_since || ''} onChange={(e) => s('order_since', e.target.value)} /></Field>
        <Field label="Massimale RC professionale richiesto (€)"><MoneyInput value={v.insurance_required ?? 1000000} onChange={(x) => s('insurance_required', x)} /></Field>
        <Field label="Compagnia / polizza"><input value={v.insurance_policy || ''} onChange={(e) => s('insurance_policy', e.target.value)} placeholder="Compagnia, n. polizza" /></Field>
        <Field label="Scadenza polizza"><input type="date" value={v.insurance_expiry || ''} onChange={(e) => s('insurance_expiry', e.target.value)} /></Field>
        <Field label="Regime IVA / cassa"><input value={v.vat_regime || ''} onChange={(e) => s('vat_regime', e.target.value)} placeholder="es. esente art. 10; cassa 4%" /></Field>
      </div>
      <div className="subhead">Titoli di studio e specializzazioni (come nel contratto)</div>
      <ListEditor value={v.degrees || []} onChange={(x) => s('degrees', x)} placeholder="Laurea in … conseguita presso … in data gg/mm/aaaa" addLabel="titolo" />
      <div className="subhead">Attività oggetto dell'incarico (facoltative, elenco puntato nel contratto)</div>
      <ListEditor value={v.activities || []} onChange={(x) => s('activities', x)} placeholder="es. analisi di mercato e individuazione di opportunità commerciali;" addLabel="attività" />
      <div className="subhead">Compenso (Allegato 2 – Tariffario)</div>
      <FeesEditor value={v.fees || []} onChange={(x) => s('fees', x)} />
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Costo mensile stimato (per il cruscotto)" help={`Se vuoto: somma dei compensi fissi (${eur(fixed)})`}><MoneyInput value={v.est_monthly_cost ?? ''} onChange={(x) => s('est_monthly_cost', x)} /></Field>
        <Field label="Note interne" className="span2"><textarea value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field>
      </div>
    </>
  );
}
