import React, { useMemo, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, seesCosts, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, KindBadge, StatusBadge, Badge, Modal, useToast } from '../components/ui.jsx';
import { qs, api, BASE, API_BASE } from '../api.js';
import { eur, itDate, CONTRACT, LEVEL_LABEL, SEX } from '../format.js';

export default function Resources({ kind }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ q: '', area_id: sp.get('area_id') || '', status: 'ATTIVO,IMPEGNO', sex: '' });
  const [sort, setSort] = useState({ key: 'last_name', dir: 1 });
  const areas = useApi('/areas');
  const list = useApi(`/resources${qs({ ...f, kind })}`, [kind]);
  const costs = seesCosts(user);
  const rows = useMemo(() => {
    const r = [...(list.data || [])];
    const k = sort.key;
    r.sort((a, b) => { const x = a[k] ?? ''; const y = b[k] ?? ''; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
    return r;
  }, [list.data, sort]);
  const th = (key, label, cls = '') => <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;
  const title = kind === 'DIPENDENTE' ? 'Elenco dipendenti' : kind === 'LP' ? 'Elenco liberi professionisti' : 'Elenco delle risorse';
  const totCost = rows.reduce((a, x) => a + Number(x.cost_annual || 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{title}</h1><div className="sub">{rows.length} risorse{costs ? ` · costo annuo stimato ${eur(totCost)}` : ''}. Clicca una riga per aprire la scheda e il dossier.</div></div>
        <div className="row">
          {costs && <a className="btn ghost" href={`${API_BASE}/stats/costs.xlsx`}>Esporta Excel</a>}
          {canWrite(user) && kind && <BulkImport kind={kind} onDone={() => list.reload()} />}
          {canWrite(user) && <Link className="btn" to={`${BASE}/risorse/nuova${kind ? `?kind=${kind}` : ''}`}>+ Nuova risorsa</Link>}
        </div>
      </div>
      <div className="filters">
        <Field label="Cerca"><input placeholder="Cognome, nome, CF, mansione…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <Field label="Area"><select value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}><option value="">Tutte</option>{(areas.data || []).map((a) => <option key={a.id} value={a.id}>{'\u00a0\u00a0'.repeat(a.level - 1)}{a.name}</option>)}</select></Field>
        <Field label="Stato"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ATTIVO,IMPEGNO">Attivi e in impegno</option><option value="ATTIVO">Solo attivi</option><option value="IMPEGNO">In impegno</option><option value="CESSATO">Cessati</option><option value="CANDIDATO">Candidati</option><option value="CANDIDATO,IMPEGNO,ATTIVO,CESSATO">Tutti</option></select></Field>
        <Field label="Sesso"><select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">Tutti</option><option value="F">Donne</option><option value="M">Uomini</option></select></Field>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>
        {list.loading && !list.data ? <Loading /> : !rows.length ? <Empty>Nessuna risorsa trovata</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr>{th('last_name', 'Risorsa')}<th>Tipo</th>{th('area_name', 'Area')}<th>Ruolo</th>{th('manager_name', 'Responsabile')}{th('hired_at', 'Ingresso')}{costs && th('ral_current', 'RAL', 'num')}{costs && th('cost_annual', 'Costo annuo', 'num')}<th className="num">Dossier</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`${BASE}/risorse/${r.id}`)}>
                <td><div className="strong">{r.last_name} {r.first_name}</div><div className="small muted">{r.tax_code || ''}{r.sex ? ` · ${SEX[r.sex]}` : ''}</div></td>
                <td><KindBadge kind={r.kind} /> {r.status !== 'ATTIVO' && <StatusBadge status={r.status} />}</td>
                <td title={[r.area_path, ...(r.extra_areas || []).map((x) => x.path)].filter(Boolean).join(' | ')}>{r.area_path ? <span>{r.area_root !== r.area_name && <span className="muted small">{r.area_path.slice(0, r.area_path.lastIndexOf(' › ') + 3)}</span>}{r.area_name}{(r.extra_areas || []).length > 0 && <span className="muted small"> + {r.extra_areas.map((x) => x.name).join(', ')}</span>}</span> : <span className="muted">–</span>}</td>
                <td>{r.kind === 'DIPENDENTE' ? <>{r.job_title || '–'}<div className="small muted">{r.level ? LEVEL_LABEL[r.level] || r.level : ''}{r.contract_type && r.contract_type !== 'TIND' ? ` · ${CONTRACT[r.contract_type]}` : ''}</div></> : <>{r.discipline || '–'}<div className="small muted">{r.lp_end ? `incarico fino al ${itDate(r.lp_end)}` : ''}</div></>}</td>
                <td>{r.manager_name || <span className="muted">–</span>}</td>
                <td>{itDate(r.hired_at) || <span className="muted">–</span>}</td>
                {costs && <td className="num">{r.kind === 'DIPENDENTE' ? eur(r.ral_current) : <span className="muted">{r.est_monthly_cost ? `${eur(r.est_monthly_cost)}/mese` : '–'}</span>}</td>}
                {costs && <td className="num">{eur(r.cost_annual)}</td>}
                <td className="num"><Badge tone={r.attachments_count ? 'teal' : 'grey'}>{r.attachments_count} doc</Badge></td>
              </tr>))}</tbody>
            {costs && <tfoot><tr><td colSpan={6}>Totale</td><td className="num">{eur(rows.filter((x) => x.kind === 'DIPENDENTE').reduce((a, x) => a + Number(x.ral_current || 0), 0))}</td><td className="num">{eur(totCost)}</td><td /></tr></tfoot>}
          </table></div>
        )}
      </Card>
    </div>
  );
}

/** Caricamento massivo da Excel: format scaricabile e upload con validazione dei campi obbligatori. */
function BulkImport({ kind, onDone }) {
  const toast = useToast();
  const input = useRef(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const label = kind === 'LP' ? 'liberi professionisti' : 'dipendenti';
  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('kind', kind);
    setBusy(true);
    try { const r = await api.post('/resources/bulk-import', fd); setRes({ ok: true, ...r }); toast(`Caricamento completato: ${r.created} nuov${r.created === 1 ? 'a' : 'e'}, ${r.updated} aggiornat${r.updated === 1 ? 'a' : 'e'}`); onDone(); }
    catch (err) { setRes({ ok: false, message: err.message, errors: err.errors || [] }); }
    finally { setBusy(false); }
  };
  return (<>
    <a className="btn ghost" href={`${API_BASE}/resources/bulk-template.xlsx?kind=${kind}`} title={`Scarica il format Excel per il caricamento massivo dei ${label}`}>Scarica format Excel</a>
    <button className="btn ghost" disabled={busy} onClick={() => input.current?.click()} title="Carica il format compilato">{busy ? 'Caricamento…' : 'Carica Excel'}</button>
    <input ref={input} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={onFile} />
    {res && <Modal title={res.ok ? 'Caricamento completato' : 'File rifiutato'} onClose={() => setRes(null)} footer={<button className="btn" onClick={() => setRes(null)}>Chiudi</button>}>
      {res.ok ? <>
        <p>{res.created} risors{res.created === 1 ? 'a creata' : 'e create'}, {res.updated} aggiornat{res.updated === 1 ? 'a' : 'e'} (stesso codice fiscale).</p>
        <ul className="small">{(res.log || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </> : <>
        <p className="strong">{res.message}</p>
        <p className="small muted">Correggi il file e ricaricalo: nessuna riga è stata salvata. Le colonne obbligatorie sono quelle con l'asterisco nel format.</p>
        <ul className="small">{(res.errors || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </>}
    </Modal>}
  </>);
}
