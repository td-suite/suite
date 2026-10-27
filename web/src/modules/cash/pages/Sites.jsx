import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Empty, Badge, Modal, MoneyInput, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime } from '../format.js';

// Sedi: anagrafica unica della Suite (public.sites) con le impostazioni Cash della sede (site_ext).
// Solo le sedi di Toscana Diagnostica (le strutture dei clienti service non compaiono mai in Cash); le sedi TD senza
// impostazioni Cash compaiono comunque, con i campi operativi vuoti, e si configurano da qui.
// Qui non si creano, rinominano o disattivano sedi: si fa in Amministrazione > Sedi. Si modificano solo le impostazioni
// operative di Cash (fondo cassa, casse attese, terminali POS, tipo di sede e royalty). Email, orari e giorni di apertura e
// data di apertura della sede sono dell'anagrafica unica (docs/IMPOSTAZIONI.md): qui si leggono soltanto. La struttura
// ospitante è una Legal entity dell'anagrafica (nome, P.IVA ed email vengono da lì).
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const ADMIN_SITES = '/admin/sites';
const ADMIN_ORGS = '/admin/organizations';
const defaults = { company_id: '', cash_float: 0, ownership: 'OSPITATA', expected_registers: 1, pos_terminals: '', float_reason: '', host_org_id: '', royalty_fixed_monthly: 0, royalty_pct: 0, royalty_base: 'TOTALE', royalty_vat_rate: 0, royalty_notes: '' };
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
  const hosts = useApi('/host-organizations');
  const [edit, setEdit] = useState(null);
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const b = { company_id: Number(edit.company_id || user.company_id) || undefined, cash_float: Number(edit.cash_float),
      ownership: edit.ownership, expected_registers: Number(edit.expected_registers) || 1, pos_terminals: edit.pos_terminals || null,
      host_org_id: edit.host_org_id ? Number(edit.host_org_id) : null, royalty_fixed_monthly: Number(edit.royalty_fixed_monthly) || 0, royalty_pct: Number(edit.royalty_pct) || 0, royalty_base: edit.royalty_base, royalty_vat_rate: Number(edit.royalty_vat_rate) || 0, royalty_notes: edit.royalty_notes || null };
    if (edit.configured) { delete b.company_id; if (edit.float_reason) b.float_reason = edit.float_reason; }
    try {
      await api.put(`/sites/${edit.id}`, b);
      toast(edit.configured ? 'Impostazioni Cash salvate' : 'Sede configurata in Cash'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const sorted = [...(data || [])].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    const va = sort.key === 'company' ? a.company_name : sort.key === 'code' ? a.code : a.name;
    const vb = sort.key === 'company' ? b.company_name : sort.key === 'code' ? b.code : b.name;
    return String(va || '').localeCompare(String(vb || ''), 'it', { numeric: true, sensitivity: 'base' }) * sort.dir;
  });
  const Th = ({ k, children }) => <th className="sortable" onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })} title="Ordina">{children}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>;
  const orig = edit?.configured ? data.find((s) => s.id === edit.id) : null;
  const floatChanged = orig && Number(orig.cash_float) !== Number(edit.cash_float);
  const unconfigured = (data || []).filter((s) => !s.configured).length;
  const openEdit = (s) => setEdit({ ...defaults, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)), id: s.id, configured: s.configured, company_id: s.company_id || user.company_id || companies.data?.[0]?.id || '', host_org_id: s.host_org_id || '', float_reason: '' });
  const host = edit?.host_org_id ? (hosts.data || []).find((o) => o.id === Number(edit.host_org_id)) : null;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi e fondo cassa</h1><div className="sub">Le sedi di Toscana Diagnostica dell'anagrafica unica della Suite: qui si impostano fondo cassa, casse attese, terminali POS e royalty di ogni sede. Email, orari e data di apertura vengono dall'anagrafica{unconfigured > 0 && <>. <b>{unconfigured}</b> {unconfigured === 1 ? 'sede da configurare' : 'sedi da configurare'}</>}</div></div>
        <div className="row">
          <Link className="btn ghost" to={ADMIN_SITES}><Icon name="external" size={16} />Apri in Amministrazione</Link>
        </div>
      </div>
      {!data ? <Loading /> : !sorted.length ? <div className="card"><Empty>Nessuna sede di Toscana Diagnostica nell'anagrafica: le sedi si creano in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link></Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><Th k="code">Codice</Th><Th k="name">Sede</Th>{sup && <Th k="company">Azienda</Th>}<th>Giorni operativi</th><th>Struttura ospitante</th><th>Canone</th><th className="num">Fondo cassa</th><th className="num">Utenti</th><th>Stato</th><th /></tr></thead>
          <tbody>{sorted.map((s) => (
            <tr key={s.id} style={{ opacity: s.configured ? 1 : .7 }}>
              <td className="mono">{s.code}</td><td><b>{s.name}</b><div className="small muted">{[s.address, s.city, s.province && `(${s.province})`].filter(Boolean).join(' ')}</div>{s.configured && (s.site_email ? <div className="small muted">{s.site_email}</div> : <div className="small red">email mancante in Amministrazione, Sedi</div>)}</td>
              {sup && <td>{s.company_name || <span className="muted">–</span>}</td>}
              {!s.configured ? <td colSpan={5} className="small muted">Impostazioni Cash non ancora definite: fondo cassa, casse attese, terminali POS e royalty si compilano con "Configura in Cash"</td> : <>
              <td>{DAYS.map((d, i) => <span key={d} className="chip" style={{ opacity: s.operating_days[i] === '1' ? 1 : .3 }}>{d}</span>)}<div className="small muted">dal {itDate(s.start_date)}{!s.opened_at && <span title="Data di apertura non indicata in Amministrazione, Sedi: vale il giorno della configurazione in Cash"> (configurazione)</span>}</div>{s.hours_from_core ? Object.keys(s.hours || {}).length > 0 && <div className="small muted">{hoursSummary(s.hours)}</div> : <div className="small muted">orari non indicati in anagrafica: lun-sab</div>}</td>
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
        <Modal title={edit.configured ? `Impostazioni Cash · ${edit.name}` : `Configura in Cash · ${edit.name}`} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={(!edit.configured && !edit.company_id) || (floatChanged && !edit.float_reason)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="alert info" style={{ marginBottom: 12 }}>
            <span><b>{edit.code}</b> · {[edit.address, edit.city, edit.province && `(${edit.province})`].filter(Boolean).join(' ') || 'indirizzo non indicato'}. Codice, nome, indirizzo e stato della sede si modificano in <Link to={ADMIN_SITES}>Amministrazione, Sedi</Link>.</span>
          </div>
          <div className="form-grid">
            {sup && !edit.configured && <Field label="Azienda Cash" help="Società della rete a cui appartiene la cassa di questa sede"><select value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            {sup && edit.configured && <Field label="Azienda Cash"><input value={edit.company_name || ''} disabled /></Field>}
            <Field label="Fondo cassa" help="Somma che resta in sede e viene sottratta dal contante versato"><MoneyInput value={edit.cash_float} onChange={(v) => setEdit({ ...edit, cash_float: v === '' ? 0 : v })} /></Field>
            <Field label="Terminali POS (TID separati da virgola)" help="Servono per riconoscere la sede negli estratti dell'acquirer"><input value={edit.pos_terminals} onChange={(e) => setEdit({ ...edit, pos_terminals: e.target.value })} /></Field>
            <Field label="Numero di casse attese al giorno" help="Una per operatore: il controllo giornaliero si aspetta questo numero di chiusure"><input type="number" min={1} max={20} value={edit.expected_registers ?? 1} onChange={(e) => setEdit({ ...edit, expected_registers: e.target.value })} /></Field>
          </div>
          {floatChanged && <div style={{ marginTop: 12 }}><Field label={`Motivo variazione fondo cassa (${eur(orig.cash_float)} → ${eur(edit.cash_float)})`}><input value={edit.float_reason} onChange={(e) => setEdit({ ...edit, float_reason: e.target.value })} autoFocus /></Field></div>}
          <h3 style={{ margin: '16px 0 6px' }}>Dall'anagrafica della sede <Link className="small" to={ADMIN_SITES} style={{ fontWeight: 400 }}>Apri in Amministrazione, Sedi</Link></h3>
          <p className="small muted" style={{ margin: '0 0 8px' }}>Email, giorni e orari di apertura e data di apertura si modificano in Amministrazione, Sedi: Cash li legge da lì (il sollecito per rendiconto mancante parte 60 minuti dopo la chiusura; il rendiconto è atteso nei giorni di apertura dalla data di apertura).</p>
          <div className="form-grid">
            <Field label="Email della sede" help="Riceve solleciti, segnalazioni e comunicazioni"><input value={edit.site_email || ''} disabled placeholder="non indicata in Amministrazione" /></Field>
            <Field label="Data di apertura" help={edit.opened_at ? 'Dall\'anagrafica' : 'Non indicata in Amministrazione: vale il giorno della configurazione in Cash'}><input value={edit.start_date ? itDate(edit.start_date) : ''} disabled /></Field>
            <Field label="Giorni e orari di apertura" className="span2"><input value={edit.hours_from_core ? hoursSummary(edit.hours || {}) : 'Orari non indicati in Amministrazione: si assume lunedì-sabato'} disabled /></Field>
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
            <Field label="Struttura ospitante" help="Legal entity dell'anagrafica (partner che ospita il punto prelievi): si crea in Amministrazione, Legal entity"><select value={edit.host_org_id || ''} onChange={(e) => setEdit({ ...edit, host_org_id: e.target.value })}><option value="">Nessuna</option>{(hosts.data || []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ''}</option>)}</select></Field>
            <Field label="P.IVA struttura" help="Dall'anagrafica della Legal entity"><input value={host?.vat_number || ''} disabled placeholder={host ? 'non indicata' : ''} /></Field>
            <Field label="Email struttura ospitante" help={<>Riceve il report royalty confermato, per fatturare. Si modifica in <Link to={ADMIN_ORGS}>Amministrazione, Legal entity</Link></>}><input value={host?.email || ''} disabled placeholder={host ? 'non indicata' : ''} /></Field>
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
