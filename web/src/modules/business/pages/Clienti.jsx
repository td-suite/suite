// Business Hub · Clienti e prospect: elenco degli account (una Legal entity per linea) ordinabile e filtrabile; nuovo prospect.
// Filtri condivisi con la Pipeline (linea, priorità, owner, provincia, segmento, fase, stato, ricerca) nell'indirizzo della pagina.
import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { StampaDB } from '../components/StampaDB.jsx';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, Modal, Field, Empty, useToast } from '../components/ui.jsx';
import { FASI, LINEE, PRIORITA, eurK, itDate, itDateTime } from '../format.js';

const CHIAVI = ['q', 'linea', 'priorita', 'owner', 'prov', 'segmento', 'fase', 'attivo', 'stallo', 'origine'];
export function useFiltri() {
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(CHIAVI.map((k) => [k, sp.get(k) || '']));
  // la linea è fissa dalla sezione del menu (?linea=…); senza parametro = Service. Nessuna vista "tutte le linee" (CEO, 06/11/2026)
  if (!['SRV', 'PP', 'MDL'].includes(f.linea)) f.linea = 'SRV';
  const setF = (patch) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) n.delete(k); else n.set(k, v); } setSp(n, { replace: true }); };
  return [f, setF];
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function filtra(righe, f) {
  const t = norm(f.q);
  return righe.filter((a) => (!f.linea || a.linea === f.linea) && (!f.priorita || a.priorita === f.priorita)
    && (!f.owner || (f.owner === 'nessuno' ? !a.owner_user_id : String(a.owner_user_id) === f.owner)) && (!f.prov || String(a.prov || '').toUpperCase() === f.prov)
    && (!f.segmento || a.segmento_lab === f.segmento) && (f.fase === '' || String(a.fase_corrente) === f.fase)
    && (!f.attivo || (f.attivo === '1' ? a.cliente_attivo : f.attivo === 'conferma' ? a.da_confermare : !a.cliente_attivo)) && (!f.stallo || a.stallo)
    && (f.origine !== 'anagrafica' || (a.da_anagrafica && Number(a.fase_corrente) === 0))
    && (!t || norm(`${a.org_name} ${a.gruppo || ''} ${a.citta || ''} ${a.tipologia || ''}`).includes(t)));
}
export function FiltriAccount({ f, setF, righe, owners, fase }) {
  const prov = [...new Set(righe.map((a) => String(a.prov || '').toUpperCase()).filter((p) => p && p.length <= 3))].sort();
  const seg = [...new Set(righe.map((a) => a.segmento_lab).filter(Boolean))].sort();
  const attivi = Object.values(f).some(Boolean);
  return (
    <div className="filters">
      <label className="f" style={{ minWidth: 220, flex: 1 }}>Cerca<input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Nome, gruppo, città, tipologia" /></label>
      <label className="f">Priorità<select value={f.priorita} onChange={(e) => setF({ priorita: e.target.value })}><option value="">Tutte</option>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <label className="f">Owner<select value={f.owner} onChange={(e) => setF({ owner: e.target.value })}><option value="">Tutti</option><option value="nessuno">Da assegnare</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
      <label className="f" style={{ minWidth: 100 }}>Provincia<select value={f.prov} onChange={(e) => setF({ prov: e.target.value })}><option value="">Tutte</option>{prov.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="f">Segmento<select value={f.segmento} onChange={(e) => setF({ segmento: e.target.value })}><option value="">Tutti</option>{seg.map((s) => <option key={s}>{s}</option>)}</select></label>
      {fase && <label className="f">Fase<select value={f.fase} onChange={(e) => setF({ fase: e.target.value })}><option value="">Tutte</option>{FASI.map((x) => <option key={x.n} value={x.n}>{x.label}</option>)}</select></label>}
      <label className="f">Stato<select value={f.attivo} onChange={(e) => setF({ attivo: e.target.value })}><option value="">Tutti</option><option value="1">Clienti attivi</option><option value="0">Non attivi</option><option value="conferma">Da confermare dal CEO</option></select></label>
      <label className="f inline" style={{ alignSelf: 'center' }}><input type="checkbox" checked={f.stallo === '1'} onChange={(e) => setF({ stallo: e.target.checked ? '1' : '' })} />Solo in stallo</label>
      {/* CEO, 09/11/2026: le Legal entity cliente dell'anagrafica si ritrovano subito (schede create dall'anagrafica, prospect censiti) */}
      <label className="f inline" style={{ alignSelf: 'center' }} title="Schede create dall'anagrafica (Amministrazione > Legal entity di tipo cliente), ancora in fase 0"><input type="checkbox" data-testid="filtro-anagrafica" checked={f.origine === 'anagrafica'} onChange={(e) => setF({ origine: e.target.checked ? 'anagrafica' : '' })} />Da anagrafica (censiti)</label>
      {attivi && <button className="btn sm ghost" style={{ alignSelf: 'center' }} onClick={() => setF(Object.fromEntries(CHIAVI.map((k) => [k, k === 'linea' ? f.linea : ''])))}>Azzera filtri</button>}
    </div>
  );
}

const COLS = [
  ['org_name', 'Account'], ['linea', 'Linea'], ['fase_corrente', 'Fase'], ['priorita', 'Priorità'], ['citta', 'Città'], ['owner_name', 'Owner'],
  ['data_prossima_azione', 'Prossima azione'], ['fatturato_fy_atteso', 'Fatturato FY atteso'], ['ultimo_contatto', 'Ultimo contatto'], ['giorni_da_avanzamento', 'Giorni da avanz.'],
];
const PRIO = { ALTA: 3, MEDIA: 2, BASSA: 1 };

export default function Clienti() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useFiltri();
  const q = useApi('/hub/accounts');
  const owners = useApi('/hub/utenti');
  const [sort, setSort] = useState({ k: 'fase_corrente', dir: -1 });
  const [nuovo, setNuovo] = useState(sp.get('nuovo') === '1');
  const righe = useMemo(() => {
    const l = filtra(q.data?.righe || [], f);
    const v = (a) => (sort.k === 'priorita' ? PRIO[a.priorita] || 0 : a[sort.k]);
    return [...l].sort((a, b) => { const x = v(a); const y = v(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
  }, [q.data, f, sort]);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const totFy = righe.reduce((s, a) => s + Number(a.fatturato_fy_atteso || 0), 0);
  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>{({ SRV: 'Clienti e prospect', PP: 'Partner e prospect', MDL: 'Aziende e prospect' })[f.linea]} · {LINEE[f.linea].label}</h1><div className="sub">Un account per Legal entity sulla linea. {righe.length} di {q.data.righe.filter((a) => a.linea === f.linea).length} account · fatturato FY atteso {eurK(totFy)}.</div></div>
        <div className="row" style={{ gap: 6 }}><StampaDB righe={righe} f={f} /><button className="btn" onClick={() => setNuovo(true)}>+ Nuovo prospect</button></div>
      </div>
      <FiltriAccount f={f} setF={setF} righe={q.data.righe} owners={owners.data || []} fase />
      <div className="card"><div className="table-wrap" style={{ maxHeight: 'calc(100vh - 290px)' }}>
        <table className="t">
          <thead><tr>{COLS.map(([k, l]) => <th key={k} className={`sortable ${['fatturato_fy_atteso', 'giorni_da_avanzamento'].includes(k) ? 'num' : ''}`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : 1 }))}>{l}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
          <tbody>
            {righe.map((a) => (
              <tr key={a.id} className="click" onClick={() => nav(`${BASE}/account/${a.id}`)}>
                <td><div className="strong">{a.org_name}{a.da_anagrafica && Number(a.fase_corrente) === 0 && <> <Badge tone="grey" title="Scheda creata dall'anagrafica (Legal entity di tipo cliente)">da anagrafica{a.org_code ? ` · ${a.org_code}` : ''}</Badge></>}</div><div className="small muted">{[a.punto_nome && a.punto_nome !== a.org_name ? a.punto_nome : null, a.gruppo && a.gruppo !== a.org_name ? a.gruppo : null, a.tipologia, a.n_sedi ? `${a.n_sedi} strutture` : null].filter(Boolean).join(' · ')}</div></td>
                <td><Badge tone={LINEE[a.linea].tone}>{LINEE[a.linea].short}</Badge></td>
                <td style={{ whiteSpace: 'nowrap' }}><Badge tone={FASI[a.fase_corrente].tone}>{FASI[a.fase_corrente].short}</Badge>{a.cliente_attivo ? <div className="small green strong">cliente attivo</div> : a.da_confermare ? <div className="small" style={{ color: '#6d3f8a' }}>da confermare dal CEO</div> : null}</td>
                <td>{a.priorita ? <Badge tone={PRIORITA[a.priorita].tone}>{PRIORITA[a.priorita].label}</Badge> : '–'}</td>
                <td className="small">{a.citta || '–'}{a.prov ? ` (${a.prov})` : ''}</td>
                <td className="small">{a.owner_name || <span className="muted">da assegnare</span>}</td>
                <td className={`small ${a.azione_scaduta ? 'red' : ''}`}>{a.prossima_azione ? `${a.prossima_azione}${a.data_prossima_azione ? ` · ${itDate(a.data_prossima_azione)}` : ''}` : '–'}</td>
                <td className="num">{eurK(a.fatturato_fy_atteso)}</td>
                <td className="small muted">{a.ultimo_contatto ? itDateTime(a.ultimo_contatto) : '–'}</td>
                <td className={`num ${a.stallo ? 'red strong' : ''}`}>{a.giorni_da_avanzamento ?? '–'}</td>
              </tr>
            ))}
            {!righe.length && <tr><td colSpan={COLS.length}><Empty>Nessun account con questi filtri</Empty></td></tr>}
          </tbody>
        </table>
      </div></div>
      {nuovo && <NuovoProspect linea={f.linea} onClose={() => setNuovo(false)} onDone={(id) => nav(`${BASE}/account/${id}`)} owners={owners.data || []} />}
    </div>
  );
}

function NuovoProspect({ onClose, onDone, owners, linea }) {
  const { user } = useAuth();
  const toast = useToast();
  const linee = Object.keys(LINEE).filter((k) => canEditKind(user, k));
  const [f, setF] = useState({ linea: linee.includes(linea) ? linea : linee[0] || 'SRV', modo: 'esistente', organization_id: '', cerca: '', name: '', city: '', province: '', email: '', phone: '', priorita: 'MEDIA', owner_user_id: '' });
  const orgs = useApi(f.modo === 'esistente' && f.cerca.length >= 2 ? `/organizations?q=${encodeURIComponent(f.cerca)}` : null, [f.cerca]);
  const salva = async () => {
    try {
      const body = { linea: f.linea, priorita: f.priorita, owner_user_id: f.owner_user_id ? Number(f.owner_user_id) : null };
      if (f.modo === 'esistente') { if (!f.organization_id) throw new Error('Scegli la Legal entity'); body.organization_id = Number(f.organization_id); }
      else body.nuova_org = { name: f.name, city: f.city, province: f.province, email: f.email, phone: f.phone };
      const r = await api.post('/hub/accounts', body); toast('Account creato'); onDone(r.id);
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!linee.length) return <Modal title="Nuovo prospect" onClose={onClose}><div className="muted">Non gestisci nessuna linea di business: chiedi il profilo all'Admin del modulo.</div></Modal>;
  return (
    <Modal title="Nuovo prospect" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={salva}>Crea l'account</button></>}>
      <div className="form-grid">
        <Field label="Linea"><select value={f.linea} onChange={(e) => setF({ ...f, linea: e.target.value })}>{linee.map((k) => <option key={k} value={k}>{LINEE[k].label}</option>)}</select></Field>
        <Field label="Priorità"><select value={f.priorita} onChange={(e) => setF({ ...f, priorita: e.target.value })}>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Owner"><select value={f.owner_user_id} onChange={(e) => setF({ ...f, owner_user_id: e.target.value })}><option value="">Da assegnare</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <div className="span2 seg">{[['esistente', 'Legal entity esistente'], ['nuova', 'Nuova Legal entity']].map(([k, l]) => <label key={k} className={f.modo === k ? 'on' : ''}><input type="radio" checked={f.modo === k} onChange={() => setF({ ...f, modo: k })} />{l}</label>)}</div>
        {f.modo === 'esistente' ? <>
          <Field label="Cerca la Legal entity" className="span2"><input value={f.cerca} onChange={(e) => setF({ ...f, cerca: e.target.value, organization_id: '' })} placeholder="almeno 2 lettere" autoFocus /></Field>
          {(orgs.data || []).length > 0 && <Field label="Legal entity" className="span2"><select value={f.organization_id} onChange={(e) => setF({ ...f, organization_id: e.target.value })} size={Math.min(8, orgs.data.length + 1)}><option value="">Scegli…</option>{orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ''}</option>)}</select></Field>}
        </> : <>
          <Field label="Ragione sociale" className="span2"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Città"><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Provincia"><input value={f.province} maxLength={4} onChange={(e) => setF({ ...f, province: e.target.value.toUpperCase() })} /></Field>
          <Field label="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Telefono"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div className="span2 small muted">La Legal entity nasce di tipo Cliente (con il segno prospect sull'account); i dati anagrafici completi si curano in Amministrazione &gt; Legal entity.</div>
        </>}
      </div>
    </Modal>
  );
}
