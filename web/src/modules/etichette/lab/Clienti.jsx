// Lab Control · Clienti: client Synclab con accettazioni nel periodo (accettazioni, in corso, in ritardo, refertate, valore, TAT mediano).
// Il nome apre il Business Hub (Legal entity abbinata) e il menu tutti i collegamenti (Retail, Listino, Ordini, NC, Abbina).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, SearchInput, Skeleton } from '../../../components/ui.jsx';
import { useApi, qs, base } from '../api.js';
import { ClienteLink, CopiaInfo, FiltroPeriodo, FiltroSede, eur, gg, num, ore, useFiltriUrl, useStatoLab } from './comuni.jsx';

const ABB = { DA_ABBINARE: ['red', 'da abbinare'], PROPOSTO: ['amber', 'proposto'], CONFERMATO: ['green', 'abbinato'], MANUALE: ['green', 'abbinato'] };

export default function Clienti() {
  const st = useStatoLab();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const [t, setT] = useState('');
  const q = useApi(`/lab/clienti${qs(f)}`, [sp.toString()]);
  const d = q.data;
  const righe = (d?.righe || []).filter((r) => !t || `${r.cliente} ${r.client_code || ''} ${r.org_name || ''}`.toLowerCase().includes(t.toLowerCase()));
  const per = d ? { periodo: 'intervallo', da: d.periodo.da, a: d.periodo.a } : {};
  return (
    <div className="page lc-page">
      <PageHead title="Clienti" icon="building" sub="Client StudioLab con accettazioni nel periodo: avanzamento, ritardi, valore e tempi di refertazione" />
      <div className="lc-filtri">
        <FiltroPeriodo f={{ ...f, periodo: f.periodo || '30g' }} onChange={set} predefinito="30g" />
        <FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />
        <SearchInput value={t} onChange={setT} placeholder="Filtra per nome o codice" />
      </div>
      <ErrorBox error={q.error} />
      {!d ? <Skeleton lines={8} /> : (
        <Card flush title={`${num(righe.length)} clienti · accettazioni dal ${gg(d.periodo.da)} al ${gg(d.periodo.a)}`} actions={<CopiaInfo copia={d.copia} />}>
          {!righe.length ? <div className="lc-pad muted">Nessun cliente con accettazioni nel periodo.</div> : (
            <div className="table-wrap"><table className="t lc-t" data-testid="lc-clienti">
              <thead><tr><th>Cliente</th><th>Sede</th><th className="num">Accettazioni</th><th className="num">In corso</th><th className="num">In ritardo</th><th className="num">Refertate</th><th className="num">TAT mediano</th><th className="num">Valore</th></tr></thead>
              <tbody>{righe.map((r) => (
                <tr key={`${r.instance_id}|${r.client_id}`}>
                  <td><ClienteLink r={r} /><div className="small muted">{r.client_code}{r.org_name && r.org_name !== r.cliente ? ` · ${r.org_name}` : ''} {ABB[r.abbinamento] && r.abbinamento !== 'CONFERMATO' && r.abbinamento !== 'MANUALE' && <Badge tone={ABB[r.abbinamento][0]}>{ABB[r.abbinamento][1]}</Badge>}</div></td>
                  <td className="small">{r.sede || <span className="muted">–</span>}</td>
                  <td className="num"><Link to={`${base}/accettazioni${qs({ cliente: `c-${r.client_id}`, ...per })}`}>{num(r.accettazioni)}</Link></td>
                  <td className="num">{num(r.in_corso)}</td>
                  <td className="num">{r.in_ritardo ? <Link to={`${base}/accettazioni${qs({ cliente: `c-${r.client_id}`, ritardo: '1', ...per })}`}><Badge tone="red">{num(r.in_ritardo)}</Badge></Link> : <span className="muted">0</span>}</td>
                  <td className="num">{num(r.refertate)}</td>
                  <td className="num">{ore(r.tat_mediana)}</td>
                  <td className="num nowrap">{eur(r.valore)}{r.senza_prezzo ? '*' : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="small muted lc-nota lc-pad">Valore = produzione accettata (stati {d.regola.stati.join(', ')}); * = righe senza prezzo. In ritardo: oltre {d.soglia.ore_ritardo} ore senza referto.</div>
        </Card>
      )}
    </div>
  );
}
