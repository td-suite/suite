// Partner ISO 37001: Legal entity auditate (non le società del gruppo), nuovo audit partner con ricerca dell'organizzazione,
// sintesi complessiva su tutti i partner.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, base, useApi, qs } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, SearchInput, useToast, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor } from '../index.jsx';
import { Score, Level, StatusBadge, RischioBadge } from '../components/Score.jsx';
import Sintesi from '../components/Sintesi.jsx';
import { itDate, itDateTime, ESITO_LE, RELAZIONE, pct } from '../format.js';

export default function Partner() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const url = `/partners${qs({ q })}`;
  const { data, loading, error, reload } = useApi(url, [url]);
  const [nuovo, setNuovo] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const auditor = isAuditor(user);
  const gen = async () => { setBusy(true); try { const r = await api.post('/sintesi/partners'); toast(`Sintesi complessiva generata: ${pct(r.score)} (${r.level})`); reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return (
    <div className="page">
      <PageHead title="Partner ISO 37001" icon="shield" sub="Audit di due diligence e anticorruzione sui partner e soci in affari (Legal entity): clienti service, punti convenzionati, fornitori, locatori, consulenti. Condotti da Qualità, Service, Retail, MDL Manager, AD."
        actions={<>{auditor && <button className="btn sm" onClick={() => setNuovo(true)}><Icon name="plus" />Nuovo audit partner</button>}{auditor && <button className="btn sm ghost" disabled={busy || !data.rows.length} onClick={gen}><Icon name="sparkle" />{data.complessiva ? 'Rigenera sintesi complessiva' : 'Sintesi complessiva'}</button>}</>} />
      <div className="au-filters"><div style={{ minWidth: 320, flex: 1 }}><SearchInput value={text} onChange={setText} placeholder="Cerca una Legal entity (anche non ancora auditata)" /></div></div>
      <Card title={q ? 'Legal entity trovate' : 'Partner auditati'} icon="list" flush style={{ marginBottom: 14 }}>
        {!data.rows.length ? <Empty icon="shield" title={q ? 'Nessuna Legal entity corrisponde' : 'Nessun partner ancora auditato'}>{q ? 'Le Legal entity si caricano in Amministrazione > Legal entity.' : 'Con "Nuovo audit partner" scegli la Legal entity e compila la checklist ISO 37001.'}</Empty> : <div className="table-wrap"><table className="t au-table">
          <thead><tr><th>Legal entity</th><th>Tipo</th><th>Audit</th><th>Ultimo audit</th><th>Esito</th><th>Rischio finale</th><th>Punteggio</th><th>Sintesi</th><th></th></tr></thead>
          <tbody>{data.rows.map((o) => <tr key={o.id}>
            <td><Link className="strong" to={`${base}/partner/${o.id}`}>{o.name}</Link><div className="small muted">{[o.vat_number && `P.IVA ${o.vat_number}`, o.city].filter(Boolean).join(' · ')}</div></td>
            <td><Badge tone="grey" dot={false}>{o.kind}</Badge></td><td>{o.n_audits}</td>
            <td className="small">{o.ultimo ? <>{itDate(o.ultimo.conducted_at)} <StatusBadge s={o.ultimo.status} /><div className="muted">{RELAZIONE[o.ultimo.header?.relazione] || ''}</div></> : '–'}</td>
            <td className="small">{ESITO_LE[o.ultimo?.report?.esito] || '–'}</td><td><RischioBadge r={o.ultimo?.report?.livello_rischio_finale} /></td>
            <td>{o.ultimo ? <><Score value={o.ultimo.score} /> <Level value={o.ultimo.score} short /></> : '–'}</td>
            <td className="small">{o.sintesi ? <><Score value={o.sintesi.score} /> <Level letter={o.sintesi.level} short /> <RischioBadge r={o.sintesi.rischio_residuo} /></> : <span className="muted">–</span>}</td>
            <td className="actions">{auditor && <button className="btn sm ghost" onClick={async () => { try { const r = await api.post('/audits', { kind: 'LEGAL_ENTITY', organization_id: o.id }); nav(`${base}/audit/${r.id}`); } catch (e) { toast(e, 'err'); } }}><Icon name="plus" />Audit</button>}</td>
          </tr>)}</tbody></table></div>}
      </Card>
      <Sintesi sintesi={data.complessiva} scope="LEGAL_ENTITIES" title="Sintesi complessiva sui partner" actions={auditor && <button className="btn sm" disabled={busy || !data.rows.length} onClick={gen}><Icon name="sparkle" />{data.complessiva ? 'Rigenera' : 'Genera con Claude'}</button>} />
      {nuovo && <NuovoPartner onClose={() => setNuovo(false)} />}
    </div>
  );
}

function NuovoPartner({ onClose }) {
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [relazione, setRelazione] = useState('');
  const [rischio, setRischio] = useState('');
  useEffect(() => { const t = setTimeout(() => api.get(`/organizations${qs({ q })}`, { silent: true }).then(setRows).catch(() => setRows([])), 250); return () => clearTimeout(t); }, [q]);
  const go = async () => {
    if (!sel) return toast('Scegli la Legal entity', 'err');
    try { const r = await api.post('/audits', { kind: 'LEGAL_ENTITY', organization_id: sel.id, header: { relazione: relazione || undefined, livello_rischio_iniziale: rischio || undefined } }); onClose(); nav(`${base}/audit/${r.id}`); } catch (e) { toast(e, 'err'); }
  };
  return (
    <Modal title="Nuovo audit partner ISO 37001" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!sel} onClick={go}>Apri la checklist</button></>}>
      <Field label="Legal entity (partner, socio in affari, fornitore, cliente service, locatore)"><SearchInput value={q} onChange={setQ} placeholder="Cerca per nome o partita IVA" autoFocus /></Field>
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, margin: '8px 0' }}>
        {!rows.length ? <div className="small muted" style={{ padding: 10 }}>Nessuna Legal entity (le società del gruppo sono escluse).</div> : rows.map((o) => <div key={o.id} onClick={() => setSel(o)} style={{ padding: '7px 10px', cursor: 'pointer', background: sel?.id === o.id ? 'var(--teal-050)' : undefined, borderBottom: '1px solid var(--line)' }}><b>{o.name}</b> <span className="small muted">{o.kind}{o.vat_number ? ` · P.IVA ${o.vat_number}` : ''}{o.city ? ` · ${o.city}` : ''}</span></div>)}
      </div>
      <div className="au-head-grid">
        <Field label="Natura della relazione"><select className="au-in" value={relazione} onChange={(e) => setRelazione(e.target.value)}><option value="">–</option>{Object.entries(RELAZIONE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Rischio iniziale della relazione"><select className="au-in" value={rischio} onChange={(e) => setRischio(e.target.value)}><option value="">–</option><option value="BASSO">Basso</option><option value="MEDIO">Medio</option><option value="ALTO">Alto</option></select></Field>
      </div>
    </Modal>
  );
}
