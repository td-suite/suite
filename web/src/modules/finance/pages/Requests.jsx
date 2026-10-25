import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, canManage } from '../auth.jsx';
import { qs } from '../api.js';
import { base } from '../paths.js';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, StatusBadge, TierBadge } from '../components/ui.jsx';
import { eur, itDate, itDateTime, STATUS, TIER } from '../format.js';

// preset: filtri fissi delle voci di menu della Suite (da-firmare, in-firma, da-eseguire), al posto dei parametri ?mine=1 e ?status=
export default function Requests({ archive = false, preset = {} }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const status = archive ? 'ESEGUITA,ANNULLATA' : preset.status || sp.get('status') || '';
  const tier = sp.get('tier') || '';
  const year = sp.get('year') || '';
  const mine = preset.mine || sp.get('mine') || '';
  const url = `/requests${qs({ status, tier, year, mine, q })}`;
  const list = useApi(url);
  const rows = list.data || [];
  const total = useMemo(() => rows.reduce((a, r) => a + Number(r.amount), 0), [rows]);
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const title = archive ? 'Archivio' : mine ? 'Istanze da firmare' : status === 'IN_FIRMA' ? 'Istanze in firma' : status === 'FIRMATA' ? 'Autorizzate, da eseguire' : 'Tutte le istanze';
  const years = [2026, 2027, 2028, 2029, 2030];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{title}</h1><div className="sub">{archive ? 'Istanze eseguite e annullate, con modulo firmato e documentazione di supporto conservati agli atti.' : 'Autorizzazioni al pagamento: filtra per stato, scaglione, anno o cerca per beneficiario, protocollo, causale o numero documento.'}</div></div>
        {canManage(user) && !archive && <Link className="btn" to={`${base}/istanze/nuova`}>+ Nuova istanza</Link>}
      </div>
      <div className="filters">
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="beneficiario, protocollo, causale…" style={{ minWidth: 260 }} /></Field>
        {!archive && !mine && !preset.status && <Field label="Stato"><select value={status} onChange={(e) => set('status', e.target.value)}><option value="">Tutti</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
        <Field label="Scaglione"><select value={tier} onChange={(e) => set('tier', e.target.value)}><option value="">Tutti</option>{Object.entries(TIER).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Anno"><select value={year} onChange={(e) => set('year', e.target.value)}><option value="">Tutti</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        <div className="spacer" />
        <div className="small muted">{rows.length} istanze · {eur(total)}</div>
      </div>
      <ErrorBox error={list.error} />
      <Card flush>{!list.data ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Protocollo</th><th>Data</th><th>Beneficiario</th><th>Causale</th><th className="num">Importo</th><th>Scaglione</th><th>Firme</th><th>Stato</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => nav(`${base}/istanze/${r.id}`)}>
              <td className="mono">{r.protocol || <span className="muted">bozza #{r.id}</span>}</td>
              <td>{itDate(r.request_date)}</td>
              <td><div className="strong">{r.beneficiary_name}</div><div className="small muted mono">{r.beneficiary_iban}</div></td>
              <td className="small" style={{ maxWidth: 320 }}>{r.purpose}</td>
              <td className="num strong">{eur(r.amount)}</td>
              <td><TierBadge tier={r.tier} /></td>
              <td>{(r.tier === 'SINGOLA' ? [r.single_signer] : ['CEO', 'CFO']).filter(Boolean).map((role) => { const s = (r.signatures || []).find((x) => x.role === role); return <Badge key={role} tone={s ? 'green' : 'grey'}>{role}{s ? ` ${itDate(s.signed_at)}` : ''}</Badge>; })}</td>
              <td><StatusBadge status={r.status} />{r.status === 'ESEGUITA' && r.executed_at ? <div className="small muted">{itDate(r.executed_at)} · {r.cro_trn}</div> : null}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna istanza con questi filtri</Empty>}</Card>
    </div>
  );
}
