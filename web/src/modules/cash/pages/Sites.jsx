import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Empty, Badge, Modal, MoneyInput, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime } from '../format.js';

// Sedi: anagrafica unica della Suite (public.sites) con le impostazioni Cash della sede (site_ext).
// Qui non si creano, rinominano o disattivano sedi: si fa in Amministrazione > Sedi. Si modificano solo le impostazioni
// operative di Cash (fondo cassa, giorni e orari, casse attese, email, tipo di sede e royalty).
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const ADMIN_SITES = '/admin/sites';
const defaults = { company_id: '', site_email: '', host_email: '', cash_float: 0, start_date: '', ownership: 'OSPITATA', hours: {}, hours_note: '', expected_registers: 1, operating_days: '1111110', pos_terminals: '', float_reason: '', host_name: '', host_vat: '', royalty_fixed_monthly: 0, royalty_pct: 0, royalty_base: 'TOTALE', royalty_vat_rate: 0, royalty_notes: '' };
const BASES = { TOTALE: 'Totale incassi (contanti, POS, bonifici)', CONTANTI_POS: 'Contanti e POS', CONTANTI: 'Solo contanti' };

// Riassunto orari: raggruppa i giorni con lo stesso orario
function hoursSummary(hours) {
  const groups = [];
  DAYS.forEach((d, i) => { const h = hours[String(i + 1)]; if (!h || (!h.open && !h.close)) return; const key = `${h.open || '?'}-${h.close || '?'}`; const g = groups.find((x) => x.key === key); if (g) g.days.push(d); else groups.push({ key, days: [d] }); });
  return groups.map((g) => `${g.days.length > 2 ? `${g.days[0]}-${g.days[g.days.length - 1]}` : g.days.join(', ')} ${g.key}`).join(' · ');
}

export default function Sites() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/sites?all=1');
  const companies = useApi(sup ? '/companies' : null);
  const [edit, setEdit] = useState(null);
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null);
  const [show, setShow] = useState('configured');   // configured | all
  const save = async () => {
    setErr(null);
    const b = { company_id: Number(edit.company_id || user.company_id) || undefined, cash_float: Number(edit.cash_float), site_email: edit.site_email || null, host_email: edit.host_email || null,
      start_date: String(edit.start_date || '').slice(0, 10), ownership: edit.ownership, expected_registers: Number(edit.expected_registers) || 1, operating_days: edit.operating_days,
      hours: Object.fromEntries(Object.entries(edit.hours || {}).filter(([, v]) => v && (v.open || v.close)).map(([k, v]) => [k, { open: v.open || null, close: v.close || null }])), hours_note: edit.hours_note || null, pos_terminals: edit.pos_terminals || null,
      host_name: edit.host_name || null, host_vat: edit.host_vat || null, royalty_fixed_monthly: Number(edit.royalty_fixed_monthly) || 0, royalty_pct: Number(edit.royalty_pct) || 0, royalty_base: edit.royalty_base, royalty_vat_rate: Number(edit.royalty_vat_rate) || 0, royalty_notes: edit.royalty_notes || null };
    if (edit.configured) { delete b.company_id; if (edit.float_reason) b.float_reason = edit.float_reason; }
    try {
      await api.put(`/sites/${edit.id}`, b);
      toast(edit.configured ? 'Impostazioni Cash salvate' : 'Sede configurata in Cash'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const list = (data || []).filter((s) => show === 'all' || s.configured);
  const sorted = [...list].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    const va = sort.key === 'company' ? a.company_name : sort.key === 'code' ? a.code : a.name;
    const vb = sort.key === 'company' ? b.company_name : sort.key === 'code' ? b.code : b.name;
    return String(va || '').localeCompare(String(vb || ''), 'it', { numeric: true, sensitivity: 'base' }) * sort.dir;
  });
  const Th = ({ k, children }) => <th className="sortable" onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })} title="Ordina">{children}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>;
  const orig = edit?.configured ? data.find((s) => s.id === edit.id) : null;
  const floatChanged = orig && Number(orig.cash_float) !== Number(edit.cash_float);
  const unconfigured = (data || []).filter((s) => !s.configured).length;
  const openEdit = (s) => setEdit({ ...defaults, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)), id: s.id, configured: s.configured, company_id: s.company_id || user.company_id || companies.data?.[0]?.id || '', hours: s.hours || {}, float_reason: '', start_date: s.start_date || (s.configured ? '' : new Date().toISOString().slice(0, 10)) });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi e fondo cassa</h1><div className="sub">Le sedi sono quelle dell'anagrafica unica della Suite: qui si impostano fondo cassa, giorni e orari, casse attese, email e royalty di ogni sede</div></div>
        <div className="row">
          {unconfigured > 0 && <button className="btn ghost" onClick={() => setShow(show === 'all' ? 'configured' : 'all')}>{show === 'all' ? 'Solo sedi configurate' : `Mostra tutte le sedi (${unconfigured} da configurare)`}</button>}
          <Link className="btn ghost" to={ADMIN_SITES}><Icon name="external" size={16} />Apri in Amministrazione</Link>
        </div>
      </div>
      {!data ? <Loading /> : !sorted.length ? <div className="card"><Empty>{show === 'all' ? 'Nessuna sede nell\'anagrafica' : 'Nessuna sede configurata in Cash'}{unconfigured > 0 && show !== 'all' && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setShow('all')}>Mostra le sedi da configurare</button></div>}</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><Th k="code">Codice</Th><Th k="name">Sede</Th>{sup && <Th k="company">Azienda</Th>}<th>Giorni operativi</th><th>Struttura ospitante</th><th>Canone</th><th className="num">Fondo cassa</th><th className="num">Utenti</th><th>Stato</th><th /></tr></thead>
          <tbody>{sorted.map((s) => (
            <tr key={s.id} style={{ opacity: s.configured ? 1 : .7 }}>
              <td className="mono">{s.code}</td><td><b>{s.name}</b><div className="small muted">{[s.address, s.city, s.province && `(${s.province})`].filter(Boolean).join(' ')}</div>{s.configured && (s.site_email ? <div className="small muted">{s.site_email}</div> : <div className="small red">email sede mancante</div>)}</td>
              {sup && <td>{s.company_name || <span className="muted">–</span>}</td>}
              {!s.configured ? <td colSpan={5} className="small muted">Impostazioni Cash non ancora definite</td> : <>
              <td>{DAYS.map((d, i) => <span key={d} className="chip" style={{ opacity: s.operating_days[i] === '1' ? 1 : .3 }}>{d}</span>)}<div className="small muted">dal {itDate(s.start_date)}</div>{s.hours && Object.keys(s.hours).length > 0 && <div className="small muted">{hoursSummary(s.hours)}</div>}</td>
              <td>{s.ownership === 'PROPRIA' ? <Badge tone="teal">Sede di proprietà</Badge> : s.host_name || <span className="muted">–</span>}{s.host_email && <div className="small muted">{s.host_email}</div>}</td>
              <td className="small">{s.ownership === 'PROPRIA' ? <span className="muted">nessuna royalty</span> : <>{Number(s.royalty_fixed_monthly) > 0 && <div>{eur(s.royalty_fixed_monthly)}/mese</div>}{Number(s.royalty_pct) > 0 && <div>{s.royalty_pct}% {s.royalty_base === 'TOTALE' ? 'sul totale' : s.royalty_base === 'CONTANTI_POS' ? 'su contanti e POS' : 'sui contanti'}</div>}{Number(s.royalty_fixed_monthly) > 0 || Number(s.royalty_pct) > 0 ? <div className="muted">IVA {s.royalty_vat_rate}%</div> : <span className="muted">nessuno</span>}</>}</td>
              <td className="num strong">{eur(s.cash_float)} <button className="btn link small" onClick={() => setHist(s)}>storico</button>{Number(s.expected_registers) > 1 && <div className="small muted">{s.expected_registers} casse</div>}</td>
              <td className="num">{s.users_count}</td>
              </>}
              <td>{s.active ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Disattiva</Badge>}{!s.configured && <div style={{ marginTop: 4 }}><Badge>Da configurare</Badge></div>}</td>
              <td className="num"><button className="btn sm ghost" onClick={() => openEdit(s)}>{s.configured ? 'Impostazioni Cash' : 'Configura in Cash'}</button></td>
            </tr>))}</tbody>
        </table></div></div>
      )}
      {edit && (
        <Modal title={edit.configured ? `Impostazioni Cash · ${edit.name}` : `Configura in Cash · ${edit.name}`} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.start_date || (!edit.configured && !edit.company_id) || (floatChanged && !edit.float_reason)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="alert info" style={{ marginBottom: 12 }}>
            <span><b>{edit.code}</b> · {[edit.address, edit.city, edit.province && `(${edit.province})`].filter(Boolean).join(' ') || 'indirizzo non indicato'}. Codice, nome, indirizzo e stato della sede si modificano in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link>.</span>
          </div>
          <div className="form-grid">
            {sup && !edit.configured && <Field label="Azienda Cash" help="Società della rete a cui appartiene la cassa di questa sede"><select value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            {sup && edit.configured && <Field label="Azienda Cash"><input value={edit.company_name || ''} disabled /></Field>}
            <Field label="Email della sede" help="Riceve solleciti, segnalazioni e comunicazioni"><input type="email" value={edit.site_email} onChange={(e) => setEdit({ ...edit, site_email: e.target.value })} /></Field>
            <Field label="Fondo cassa" help="Somma che resta in sede e viene sottratta dal contante versato"><MoneyInput value={edit.cash_float} onChange={(v) => setEdit({ ...edit, cash_float: v === '' ? 0 : v })} /></Field>
            <Field label="Terminali POS (TID separati da virgola)" help="Servono per riconoscere la sede negli estratti dell'acquirer"><input value={edit.pos_terminals} onChange={(e) => setEdit({ ...edit, pos_terminals: e.target.value })} /></Field>
          </div>
          {floatChanged && <div style={{ marginTop: 12 }}><Field label={`Motivo variazione fondo cassa (${eur(orig.cash_float)} → ${eur(edit.cash_float)})`}><input value={edit.float_reason} onChange={(e) => setEdit({ ...edit, float_reason: e.target.value })} autoFocus /></Field></div>}
          <div style={{ marginTop: 12 }}>
            <Field label="Numero di casse attese al giorno" help="Una per operatore: il controllo giornaliero si aspetta questo numero di chiusure"><input type="number" min={1} max={20} value={edit.expected_registers ?? 1} onChange={(e) => setEdit({ ...edit, expected_registers: e.target.value })} /></Field>
            <Field label="Data di avvio della sede in Cash" help="Primo giorno di lavoro: da questa data il sistema attende il rendiconto e segnala le mancanze"><input type="date" required value={edit.start_date ? String(edit.start_date).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></Field>
            <div className="small strong muted" style={{ marginBottom: 6 }}>Giorni operativi (attesi in rendicontazione)</div>
            <div className="row">{DAYS.map((d, i) => <label key={d} className="f inline"><input type="checkbox" checked={edit.operating_days[i] === '1'} onChange={(e) => { const a = edit.operating_days.split(''); a[i] = e.target.checked ? '1' : '0'; setEdit({ ...edit, operating_days: a.join('') }); }} />{d}</label>)}</div>
            <div className="small strong muted" style={{ margin: '12px 0 6px' }}>Orari della sede <span className="muted" style={{ fontWeight: 400 }}>(il sollecito per rendiconto mancante parte 60 minuti dopo la chiusura)</span></div>
            {(() => { const firstK = DAYS.map((_, i) => String(i + 1)).find((k) => { const h = (edit.hours || {})[k]; return h && (h.open || h.close); }); const first = firstK ? edit.hours[firstK] : null; return (<>
            <table className="t hours" style={{ width: 'auto' }}><thead><tr><th>Giorno</th><th>Apertura</th><th>Chiusura</th></tr></thead><tbody>
              {DAYS.map((d, i) => { const k = String(i + 1); const h = (edit.hours || {})[k] || {}; const on = edit.operating_days[i] === '1'; const setH = (patch) => setEdit({ ...edit, hours: { ...(edit.hours || {}), [k]: { ...h, ...patch } } }); return (
                <tr key={d} style={{ opacity: on ? 1 : .45 }}>
                  <td>{d}</td>
                  <td><input type="time" disabled={!on} value={h.open || ''} onChange={(e) => setH({ open: e.target.value })} /></td>
                  <td><input type="time" disabled={!on} value={h.close || ''} onChange={(e) => setH({ close: e.target.value })} /></td>
                </tr>); })}
            </tbody></table>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm ghost" type="button" disabled={!first} onClick={() => { const all = {}; DAYS.forEach((_, j) => { if (edit.operating_days[j] === '1') all[String(j + 1)] = { open: first.open || null, close: first.close || null }; }); setEdit({ ...edit, hours: all }); }}>Copia per tutti i giorni</button>
              {first && <span className="small muted">applica {first.open || '–'} / {first.close || '–'} a tutti i giorni operativi</span>}
            </div>
            </>); })()}
            <Field label="Note sugli orari" help="es. chiusura pomeridiana, orari estivi"><input value={edit.hours_note} onChange={(e) => setEdit({ ...edit, hours_note: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ margin: '18px 0 8px', alignItems: 'center', gap: 14 }}>
            <h3 style={{ margin: 0 }}>Tipo di sede</h3>
            <div className="seg" role="radiogroup">
              <label className={edit.ownership === 'OSPITATA' ? 'on' : ''}><input type="radio" name="ownership" checked={edit.ownership === 'OSPITATA'} onChange={() => setEdit({ ...edit, ownership: 'OSPITATA' })} />Ospitata (con royalty)</label>
              <label className={edit.ownership === 'PROPRIA' ? 'on' : ''}><input type="radio" name="ownership" checked={edit.ownership === 'PROPRIA'} onChange={() => setEdit({ ...edit, ownership: 'PROPRIA' })} />Di proprietà</label>
            </div>
          </div>
          {edit.ownership === 'PROPRIA' ? <p className="small muted" style={{ marginTop: 8 }}>La sede non compare nella pagina Royalty di sede e non genera report per strutture ospitanti.</p> : <>
          <h3 style={{ margin: '14px 0 8px' }}>Royalty alla struttura ospitante</h3>
          <div className="form-grid">
            <Field label="Struttura ospitante"><input value={edit.host_name} onChange={(e) => setEdit({ ...edit, host_name: e.target.value })} placeholder="es. Farmacia Comunale n. 3" /></Field>
            <Field label="P.IVA struttura"><input value={edit.host_vat} onChange={(e) => setEdit({ ...edit, host_vat: e.target.value })} /></Field>
            <Field label="Email struttura ospitante" help="Riceve il report royalty confermato, per fatturare"><input type="email" value={edit.host_email} onChange={(e) => setEdit({ ...edit, host_email: e.target.value })} /></Field>
            <Field label="Quota fissa mensile" help="0 se non prevista"><MoneyInput value={edit.royalty_fixed_monthly} onChange={(v) => setEdit({ ...edit, royalty_fixed_monthly: v === '' ? 0 : v })} /></Field>
            <Field label="Percentuale sui ricavi %" help="0 se non prevista"><input type="number" step="0.01" min="0" max="100" value={edit.royalty_pct} onChange={(e) => setEdit({ ...edit, royalty_pct: e.target.value })} /></Field>
            <Field label="Base della percentuale"><select value={edit.royalty_base} onChange={(e) => setEdit({ ...edit, royalty_base: e.target.value })}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="IVA %" help="0 se il canone non è soggetto a IVA"><input type="number" step="0.01" min="0" max="100" value={edit.royalty_vat_rate} onChange={(e) => setEdit({ ...edit, royalty_vat_rate: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 10 }}><Field label="Note contrattuali"><input value={edit.royalty_notes} onChange={(e) => setEdit({ ...edit, royalty_notes: e.target.value })} placeholder="es. contratto del 01/09/2026, pagamento entro il 10 del mese successivo" /></Field></div>
          </>}
        </Modal>
      )}
      {hist && <FloatHistory site={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function FloatHistory({ site, onClose }) {
  const { data } = useApi(`/sites/${site.id}/float-history`);
  return (
    <Modal title={`Storico fondo cassa · ${site.name}`} onClose={onClose}>
      {!data ? <Loading /> : <table className="t"><thead><tr><th>Quando</th><th>Chi</th><th className="num">Da</th><th className="num">A</th><th>Motivo</th></tr></thead>
        <tbody>{data.map((h) => <tr key={h.id}><td>{itDateTime(h.changed_at)}</td><td>{h.full_name}</td><td className="num">{h.old_value == null ? '–' : eur(h.old_value)}</td><td className="num strong">{eur(h.new_value)}</td><td>{h.reason}</td></tr>)}</tbody></table>}
    </Modal>
  );
}
