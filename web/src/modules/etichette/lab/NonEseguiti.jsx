// Lab Control · Esami non eseguiti: righe d'esame con notPerformedCode del periodo (cliente, sede, esame, codice), conteggi per codice, per
// esame e per cliente, andamento settimanale e l'elenco delle righe con il link alla scheda. Il significato dei codici è del gestionale.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, ErrorBox, PageHead, Pager, Skeleton } from '../../../components/ui.jsx';
import { useApi, qs, base } from '../api.js';
import { Barre, ClienteLink, CopiaInfo, FiltroCliente, FiltroPeriodo, FiltroSede, gg, num, pct, useFiltriUrl, useStatoLab } from './comuni.jsx';

export default function NonEseguiti() {
  const st = useStatoLab();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const [esame, setEsame] = useState(f.esame || '');
  const q = useApi(`/lab/non-eseguiti${qs(f)}`, [sp.toString()]);
  const d = q.data;
  return (
    <div className="page lc-page">
      <PageHead title="Esami non eseguiti" icon="x" sub="Righe d'esame con il codice di non esecuzione del gestionale (campione insufficiente, emolizzato, non pervenuto: il significato del codice è di StudioLab)" />
      <div className="lc-filtri">
        <FiltroPeriodo f={{ ...f, periodo: f.periodo || '30g' }} onChange={set} predefinito="30g" />
        <FiltroCliente value={f.cliente} etichetta={f.cliente_nome} onChange={(v, et) => set({ cliente: v, cliente_nome: et || '' })} />
        <FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />
        <form className="lc-cerca" onSubmit={(e) => { e.preventDefault(); set({ esame: esame.trim().toUpperCase() }); }}>
          <input type="search" value={esame} onChange={(e) => { setEsame(e.target.value); if (!e.target.value) set({ esame: '' }); }} placeholder="Codice esame" aria-label="Codice esame" />
        </form>
        {f.codice && <span className="lc-chip">Codice {f.codice}<button type="button" onClick={() => set({ codice: '' })} aria-label="Togli">×</button></span>}
      </div>
      <ErrorBox error={q.error} />
      {!d ? <Skeleton lines={8} /> : <>
        <div className="lc-testa"><span className="small muted">Accettazioni dal {gg(d.periodo.da)} al {gg(d.periodo.a)}</span><CopiaInfo copia={d.copia} /></div>
        <div className="lc-nums">
          <div className="card lc-num warn"><span className="lbl">Esami non eseguiti</span><span className="val">{num(d.righe)}</span><span className="sub">{pct(d.quota_pct)} degli esami del periodo</span></div>
          <div className="card lc-num"><span className="lbl">Accettazioni coinvolte</span><span className="val">{num(d.accettazioni)}</span></div>
          <div className="card lc-num"><span className="lbl">Esami del periodo</span><span className="val">{num(d.esami_totali)}</span></div>
          <div className="card lc-num"><span className="lbl">Codici diversi</span><span className="val">{num(d.per_codice.length)}</span></div>
        </div>
        <div className="lc-tre">
          <Card title="Per codice" icon="tag" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Codice</th><th className="num">Righe</th></tr></thead>
              <tbody>{d.per_codice.map((c) => <tr key={c.codice} className="click" onClick={() => set({ codice: c.codice })}><td className="mono"><b>{c.codice}</b></td><td className="num">{num(c.n)}</td></tr>)}
              {!d.per_codice.length && <tr><td colSpan={2} className="muted">Nessuno</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per esame" icon="list" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Esame</th><th className="num">Righe</th></tr></thead>
              <tbody>{d.per_esame.map((e) => <tr key={e.esame} className="click" onClick={() => { setEsame(e.esame); set({ esame: e.esame }); }}><td><b className="mono">{e.esame}</b> <span className="small muted">{e.descrizione || ''}</span></td><td className="num">{num(e.n)}</td></tr>)}
              {!d.per_esame.length && <tr><td colSpan={2} className="muted">Nessuno</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per cliente" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Cliente</th><th className="num">Righe</th></tr></thead>
              <tbody>{d.per_cliente.map((c) => <tr key={`${c.instance_id}|${c.client_id}`}><td><ClienteLink r={c} /></td><td className="num">{num(c.n)}</td></tr>)}
              {!d.per_cliente.length && <tr><td colSpan={2} className="muted">Nessuno</td></tr>}</tbody></table></div>
          </Card>
        </div>
        <Card title="Andamento settimanale" icon="stats"><Barre righe={d.settimane} valore={(r) => r.n} etichetta={(r) => `sett. ${gg(r.settimana).slice(0, 5)}`} titolo="Esami non eseguiti per settimana" /></Card>
        <Card flush title={`Righe (${num(d.righe)})`} icon="list" className="lc-mt">
          {!d.elenco.length ? <div className="lc-pad muted">Nessun esame non eseguito con questi filtri.</div> : <>
            <div className="table-wrap"><table className="t lc-t" data-testid="lc-ne-elenco">
              <thead><tr><th>Accettazione</th><th>Data</th><th>Cliente</th><th>Sede</th><th>Esame</th><th>Codice</th></tr></thead>
              <tbody>{d.elenco.map((e, i) => <tr key={i}><td className="mono"><Link to={`${base}/accettazioni/${encodeURIComponent(e.instance_id)}/${encodeURIComponent(e.request_id)}`}>{e.numero}</Link></td><td className="nowrap">{gg(e.data)}</td>
                <td><ClienteLink r={e} /></td><td className="small">{e.sede || <span className="muted">non abbinata</span>}</td><td><b className="mono">{e.codice_esame}</b> <span className="small muted">{e.descrizione || ''}</span></td><td className="mono">{e.codice}</td></tr>)}</tbody>
            </table></div>
            <div className="lc-pager"><Pager page={d.pagina} pageSize={100} total={d.righe} onChange={(p) => set({ pagina: p }, { pagina: false })} /></div>
          </>}
        </Card>
      </>}
    </div>
  );
}
