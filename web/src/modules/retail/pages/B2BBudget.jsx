// Retail · B2B · Budget B2B (riordino del 09/11/2026): obiettivi per cliente e mese su produzione (valore) e fatturato da documenti, con il
// consuntivo di StudioLab accanto. Tabella retail.budget_b2b (la tabella budgets esistente non ha una dimensione per cliente B2B).
// Fonte: GET/PUT /api/retail/b2b/budget. Scrivono ADMIN e RETAIL.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, useToast, MoneyInput } from '../components/ui.jsx';
import { FonteSynclab } from '../components/fonte.jsx';
import { useAuth, canWrite } from '../auth.jsx';
import { api } from '../api.js';
import { eur0, MONTHS_SHORT, today } from '../format.js';
import { linkCliente } from './CruscottoB2B.jsx';

export default function B2BBudget() {
  const { user } = useAuth();
  const toast = useToast();
  const [anno, setAnno] = useState(Number(today().slice(0, 4)));
  const [metrica, setMetrica] = useState('produzione');
  const q = useApi(`/b2b/budget?anno=${anno}`, [anno]);
  const orgs = useApi('/organizations');
  const [righe, setRighe] = useState([]);
  const [mod, setMod] = useState({});
  const [nuova, setNuova] = useState('');
  useEffect(() => { if (q.data) { setRighe(q.data.clienti); setMod({}); } }, [q.data]);
  const scrive = canWrite(user);
  const chiaveB = (k) => (metrica === 'produzione' ? 'budget_produzione' : 'budget_fatturato');
  const val = (c, m) => { const k = `${c.chiave}|${m.mese}|${metrica}`; return k in mod ? mod[k] : m[chiaveB()]; };
  const cons = (m) => (metrica === 'produzione' ? m.produzione : m.fatturato);
  const salva = async () => {
    const perCella = new Map();
    for (const c of righe) for (const m of c.mesi) {
      const kp = `${c.chiave}|${m.mese}|produzione`, kf = `${c.chiave}|${m.mese}|fatturato`;
      if (!(kp in mod) && !(kf in mod)) continue;
      perCella.set(`${c.chiave}|${m.mese}`, { chiave: c.chiave, cliente: c.organization_id ? null : c.cliente, mese: m.mese,
        produzione: kp in mod ? (mod[kp] === '' || mod[kp] == null ? null : Number(mod[kp])) : m.budget_produzione,
        fatturato: kf in mod ? (mod[kf] === '' || mod[kf] == null ? null : Number(mod[kf])) : m.budget_fatturato, esami: m.budget_esami });
    }
    if (!perCella.size) return toast('Nessuna modifica');
    try { const r = await api.put('/b2b/budget', { anno, righe: [...perCella.values()] }); toast(`Budget salvato: ${r.scritte} celle${r.tolte ? `, ${r.tolte} tolte` : ''}`); q.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const aggiungi = () => {
    const o = (orgs.data || []).find((x) => String(x.id) === nuova);
    if (!o || righe.some((c) => c.chiave === String(o.id))) return;
    setRighe([...righe, { chiave: String(o.id), cliente: o.name, organization_id: o.id, mesi: Array.from({ length: 12 }, (_, i) => ({ mese: i + 1, budget_produzione: null, budget_fatturato: null, produzione: null, fatturato: null, esami: 0 })) }]);
    setNuova('');
  };
  const tot = (c, fn) => c.mesi.reduce((a, m) => a + Number(fn(m) || 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Budget B2B</h1><div className="sub">Obiettivi per cliente e mese su produzione e fatturato da documenti, con il consuntivo di StudioLab sotto ogni cella.</div></div>
        {scrive && <div className="row"><button className="btn" onClick={salva} disabled={!Object.keys(mod).length}>Salva il budget</button></div>}
      </div>
      {q.data && <FonteSynclab stato={q.data.stato} />}
      <div className="filters">
        <label className="f">Anno<select value={anno} onChange={(e) => setAnno(Number(e.target.value))}>{[0, 1, 2, -1].map((i) => Number(today().slice(0, 4)) - i).sort().map((y) => <option key={y}>{y}</option>)}</select></label>
        <div className="seg" style={{ alignSelf: 'end' }}>{[['produzione', 'Produzione'], ['fatturato', 'Fatturato']].map(([k, l]) => <label key={k} className={metrica === k ? 'on' : ''}><input type="radio" checked={metrica === k} onChange={() => setMetrica(k)} />{l}</label>)}</div>
        {scrive && <><label className="f" style={{ minWidth: 260 }}>Aggiungi una Legal entity<select value={nuova} onChange={(e) => setNuova(e.target.value)}><option value="">Scegli…</option>{(orgs.data || []).filter((o) => o.kind === 'CLIENTE' || !o.kind).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button className="btn ghost" style={{ alignSelf: 'end' }} disabled={!nuova} onClick={aggiungi}>Aggiungi</button></>}
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!q.data ? <Loading /> : !righe.length ? <Empty>Nessun cliente B2B con produzione o budget nell'anno: aggiungi una Legal entity</Empty> : <div className="table-wrap"><table className="t" data-testid="budget-b2b">
        <thead><tr><th>Cliente</th>{MONTHS_SHORT.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Anno</th></tr></thead>
        <tbody>{righe.map((c) => <tr key={c.chiave}><td style={{ minWidth: 200 }}><Link className="strong" to={linkCliente(c.chiave)}>{c.cliente}</Link></td>
          {c.mesi.map((m) => <td key={m.mese} className="num" style={{ minWidth: 92 }}>
            {scrive ? <MoneyInput value={val(c, m) ?? ''} onChange={(v) => setMod({ ...mod, [`${c.chiave}|${m.mese}|${metrica}`]: v })} style={{ width: 84 }} /> : <div>{eur0(val(c, m))}</div>}
            <div className="small muted" title="consuntivo StudioLab">{cons(m) != null ? eur0(cons(m)) : '–'}</div></td>)}
          <td className="num"><div className="strong">{eur0(tot(c, (m) => val(c, m)))}</div><div className="small muted">{eur0(tot(c, cons))}</div></td></tr>)}</tbody>
      </table></div>}</Card>
      <div className="small muted" style={{ marginTop: 10 }}>Sopra l'obiettivo, sotto il consuntivo (produzione = netti di riga delle accettazioni; fatturato = contributo netto dei documenti). Una cella svuotata e salvata toglie l'obiettivo.</div>
    </div>
  );
}
