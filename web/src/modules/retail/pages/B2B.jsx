// Retail · Aziende e strutture (B2B) (correzione B15 del programma "anagrafica unica", 08/11/2026). I clienti B2B sono i clienti attivi e
// contrattualizzati della Suite (Service e Medicina del Lavoro, vista public.clienti_attivi_v): anagrafica dalla Legal entity, codici
// cliente StudioLAB abbinati, visite e fatturato dalle vendite importate. I codici delle vendite senza Legal entity stanno in
// "Da abbinare": si abbinano dai codici StudioLAB delle sedi (automatico) o scegliendo la Legal entity (manuale).
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Kpi } from '../components/ui.jsx';
import { api, base } from '../api.js';
import { eur, eur0, num, itDate, B2B_TYPE } from '../format.js';

const LIVELLO = { ATTIVO: { label: 'Cliente attivo', tone: 'green' }, CONTRATTUALIZZATO: { label: 'In avvio (contrattualizzato)', tone: 'mauve' } };
const ABB = { AUTO: 'automatico (codice della sede)', MANUALE: 'manuale' };

export default function B2B() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'clienti');
  const [q, setQ] = useState(sp.get('q') || '');
  const d = useApi(`/customers/b2b?q=${encodeURIComponent(q)}`, [q]);
  const orgs = useApi('/organizations');
  const [scelta, setScelta] = useState({});
  const scrive = canWrite(user);
  const vai = (t) => { setTab(t); setSp({ tab: t, ...(q ? { q } : {}) }, { replace: true }); };
  const abbina = async (id) => { try { await api.put(`/customers/${id}/abbina`, { organization_id: Number(scelta[id]) }); toast('Codice abbinato alla Legal entity'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const automatico = async () => { try { const r = await api.post('/customers/b2b/abbina-codici'); const n = r.filter((x) => x.organization_id).length; toast(n ? `${n} codici abbinati dai codici StudioLAB delle sedi` : 'Nessun codice abbinabile in automatico: scegli la Legal entity'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const x = d.data;
  // Legal entity proposte nel selettore: prima i clienti attivi, poi le altre
  const clientiIds = new Set((x?.clienti || []).map((c) => c.organization_id));
  const opzioni = [...(orgs.data || [])].sort((a, b) => (clientiIds.has(b.id) - clientiIds.has(a.id)) || a.name.localeCompare(b.name, 'it'));
  const tot = (x?.clienti || []).reduce((a, c) => a + Number(c.revenue || 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Aziende e strutture (B2B)</h1><div className="sub">I clienti attivi e in avvio della Suite (Service di laboratorio e Medicina del lavoro): anagrafica dalla Legal entity, codici cliente StudioLAB e vendite. I codici delle vendite senza Legal entity si abbinano in "Da abbinare".</div></div>
      </div>
      <div className="filters">
        <Field label="Cerca"><input placeholder="Ragione sociale, P.IVA, comune, codice…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <div className="seg" style={{ alignSelf: 'end' }}>{[['clienti', `Clienti (${x?.clienti?.length ?? '…'})`], ['da_abbinare', `Da abbinare (${x?.da_abbinare?.length ?? '…'})`], ['non_clienti', `Non clienti attivi (${x?.non_clienti?.length ?? '…'})`]].map(([k, l]) => <label key={k} className={tab === k ? 'on' : ''}><input type="radio" checked={tab === k} onChange={() => vai(k)} />{l}</label>)}</div>
      </div>
      <ErrorBox error={d.error} />
      {x && tab === 'clienti' && <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi label="Clienti B2B" value={num(x.clienti.length)} foot="attivi e contrattualizzati della Suite" />
        <Kpi label="Fatturato dalle vendite" value={eur0(tot)} foot="codici StudioLAB abbinati" />
        <Kpi label="Codici da abbinare" value={num(x.da_abbinare.length)} foot="vendite senza Legal entity" />
      </div>}
      <Card flush>
        {!x ? <Loading /> : tab === 'clienti' ? (!x.clienti.length ? <Empty>Nessun cliente attivo o contrattualizzato nella Suite</Empty> : (
          <div className="table-wrap"><table className="t" data-testid="b2b-clienti">
            <thead><tr><th>Cliente</th><th>Linee</th><th>Stato</th><th>Codici StudioLAB</th><th>Segmento</th><th>Ultima vendita</th><th className="num">Visite</th><th className="num">Fatturato</th></tr></thead>
            <tbody>{x.clienti.map((c) => (
              <tr key={c.organization_id} className={c.codici.length ? 'click' : ''} onClick={() => c.codici[0] && nav(`${base}/clienti/${c.codici[0].id}`)}>
                <td><div className="strong">{c.name}</div><div className="small muted">{[c.vat_number, c.city && `${c.city}${c.province ? ` (${c.province})` : ''}`].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{c.linee}</td>
                <td><Badge tone={LIVELLO[c.livello]?.tone}>{LIVELLO[c.livello]?.label || c.livello}</Badge>{c.dal && <div className="small muted">dal {itDate(c.dal)}</div>}</td>
                <td className="small mono">{c.codici.length ? c.codici.map((k) => k.external_code).join(', ') : <span className="muted">nessun codice nelle vendite</span>}</td>
                <td className="small">{B2B_TYPE[c.b2b_type] || c.b2b_type || '–'}{c.sector ? <div className="muted">{c.sector}</div> : null}</td>
                <td className="small">{itDate(c.last_visit) || '–'}</td>
                <td className="num">{num(c.visits)}</td>
                <td className="num strong">{eur(c.revenue)}</td>
              </tr>))}</tbody>
          </table></div>
        )) : tab === 'da_abbinare' ? (<>
          <div className="row" style={{ padding: 12, gap: 10, justifyContent: 'space-between' }}>
            <span className="small muted">Codici cliente delle vendite StudioLAB senza Legal entity. L'abbinamento automatico usa il codice StudioLAB delle sedi (Amministrazione &gt; Sedi, di norma la sede SERVICE del cliente).</span>
            {scrive && <button className="btn sm" onClick={automatico}>Abbina dai codici StudioLAB</button>}
          </div>
          {!x.da_abbinare.length ? <Empty>Nessun codice da abbinare</Empty> : <div className="table-wrap"><table className="t" data-testid="b2b-da-abbinare">
            <thead><tr><th>Codice</th><th>Nome nel file delle vendite</th><th className="num">Fatturato</th><th>Legal entity</th><th /></tr></thead>
            <tbody>{x.da_abbinare.map((r) => (
              <tr key={r.id}>
                <td className="mono strong">{r.external_code || '–'}</td>
                <td><div>{r.nome_nel_file || '–'}</div>{r.vat_number && <div className="small muted mono">{r.vat_number}</div>}</td>
                <td className="num">{eur(r.revenue)}</td>
                <td style={{ minWidth: 280 }}>{scrive ? <select value={scelta[r.id] || ''} onChange={(e) => setScelta({ ...scelta, [r.id]: e.target.value })}><option value="">Scegli la Legal entity…</option>{opzioni.map((o) => <option key={o.id} value={o.id}>{clientiIds.has(o.id) ? '★ ' : ''}{o.name}{o.vat_number ? ` · ${o.vat_number}` : ''}</option>)}</select> : <span className="muted">da abbinare</span>}</td>
                <td>{scrive && <button className="btn sm" disabled={!scelta[r.id]} onClick={() => abbina(r.id)}>Abbina</button>}</td>
              </tr>))}</tbody>
          </table></div>}
        </>) : (!x.non_clienti.length ? <Empty>Nessun codice abbinato a Legal entity che non sono clienti attivi</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice</th><th>Legal entity</th><th>Abbinamento</th><th className="num">Fatturato</th></tr></thead>
            <tbody>{x.non_clienti.map((r) => <tr key={r.id} className="click" onClick={() => nav(`${base}/clienti/${r.id}`)}><td className="mono">{r.external_code}</td><td>{r.company_name}<div className="small muted">{r.organization_kind} · non è un cliente attivo o contrattualizzato della Suite</div></td><td className="small">{ABB[r.abbinamento] || r.abbinamento || '–'}</td><td className="num">{eur(r.revenue)}</td></tr>)}</tbody>
          </table></div>
        ))}
      </Card>
    </div>
  );
}
