// Lab Control · Tempi di refertazione (TAT): accettazione → referto pronto delle accettazioni del periodo con reportAtLocal. Mediana e 90°
// percentile, % entro la soglia, andamento settimanale, per cliente, per sede, i 10 esami più lenti, confronto con il mese precedente.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, ErrorBox, PageHead, Skeleton } from '../../../components/ui.jsx';
import { useApi, qs, base } from '../api.js';
import { Barre, ClienteLink, CopiaInfo, FiltroCliente, FiltroPeriodo, FiltroSede, gg, ore, num, pct, useFiltriUrl, useStatoLab } from './comuni.jsx';

function Kpi({ label, v, sub, prima }) {
  return <div className="card lc-num"><span className="lbl">{label}</span><span className="val lc-val-s">{v}</span>{sub && <span className="sub">{sub}</span>}{prima && <span className="sub">{prima}</span>}</div>;
}

export default function Tat() {
  const st = useStatoLab();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const [esame, setEsame] = useState(f.esame || '');
  const q = useApi(`/lab/tat${qs(f)}`, [sp.toString()]);
  const d = q.data;
  const t = d?.totale;
  const p = d?.mese_prima?.totale;
  return (
    <div className="page lc-page">
      <PageHead title="Tempi di refertazione" icon="clock" sub="Dall'accettazione al referto pronto, in ore, per le accettazioni del periodo con il referto" />
      <div className="lc-filtri">
        <FiltroPeriodo f={{ ...f, periodo: f.periodo || '30g' }} onChange={set} predefinito="30g" />
        <FiltroCliente value={f.cliente} etichetta={f.cliente_nome} onChange={(v, et) => set({ cliente: v, cliente_nome: et || '' })} />
        <FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />
        <form className="lc-cerca" onSubmit={(e) => { e.preventDefault(); set({ esame: esame.trim().toUpperCase() }); }}>
          <input type="search" value={esame} onChange={(e) => { setEsame(e.target.value); if (!e.target.value) set({ esame: '' }); }} placeholder="Codice esame" aria-label="Codice esame" />
        </form>
      </div>
      <ErrorBox error={q.error} />
      {!d ? <Skeleton lines={8} /> : <>
        <div className="lc-testa"><span className="small muted">Accettazioni dal {gg(d.periodo.da)} al {gg(d.periodo.a)}{d.esame ? ` con l'esame ${d.esame}` : ''} · soglia {d.soglia} ore</span><CopiaInfo copia={d.copia} /></div>
        <div className="lc-nums" data-testid="lc-tat-kpi">
          <Kpi label="Mediana" v={ore(t.mediana)} sub={`${num(t.n)} accettazioni refertate`} prima={p?.n ? `mese prima ${ore(p.mediana)}` : null} />
          <Kpi label="90° percentile" v={ore(t.p90)} sub="il 90% entro" prima={p?.n ? `mese prima ${ore(p.p90)}` : null} />
          <Kpi label="Media" v={ore(t.media)} prima={p?.n ? `mese prima ${ore(p.media)}` : null} />
          <Kpi label={`Entro ${d.soglia} ore`} v={pct(t.entro_pct)} sub={`${num(t.entro)} su ${num(t.n)}`} prima={p?.n ? `mese prima ${pct(p.entro_pct)}` : null} />
        </div>
        <div className="lc-due">
          <Card title="Andamento settimanale (mediana)" icon="stats">
            <Barre righe={d.settimane} valore={(r) => r.mediana} etichetta={(r) => `sett. ${gg(r.settimana).slice(0, 5)}`} formato={ore} titolo="Mediana settimanale in ore" />
          </Card>
          <Card title="I 10 esami più lenti" icon="list" flush>
            <div className="table-wrap"><table className="t lc-t-stretta" data-testid="lc-tat-esami"><thead><tr><th>Esame</th><th className="num">N.</th><th className="num">Mediana</th><th className="num">90°</th></tr></thead>
              <tbody>{d.esami_lenti.map((e) => <tr key={e.codice}><td><b className="mono">{e.codice}</b> <span className="small muted">{e.descrizione || ''}</span></td><td className="num">{num(e.n)}</td><td className="num">{ore(e.mediana)}</td><td className="num">{ore(e.p90)}</td></tr>)}
              {!d.esami_lenti.length && <tr><td colSpan={4} className="muted">Servono almeno 3 righe per esame nel periodo</td></tr>}</tbody></table></div>
          </Card>
        </div>
        <div className="lc-due">
          <Card title="Per cliente" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Cliente</th><th className="num">N.</th><th className="num">Mediana</th><th className="num">90°</th><th className="num">Entro</th></tr></thead>
              <tbody>{d.clienti.slice(0, 50).map((c) => <tr key={`${c.instance_id}|${c.client_id}`}><td><ClienteLink r={c} /></td><td className="num">{num(c.n)}</td><td className="num">{ore(c.mediana)}</td><td className="num">{ore(c.p90)}</td><td className="num">{pct(c.entro_pct)}</td></tr>)}
              {!d.clienti.length && <tr><td colSpan={5} className="muted">Nessun referto nel periodo</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per sede" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Sede</th><th className="num">N.</th><th className="num">Mediana</th><th className="num">90°</th><th className="num">Entro</th></tr></thead>
              <tbody>{d.sedi.map((s) => <tr key={s.site_id ?? 'nd'}><td>{s.site_id ? <Link to={`${base}/tat${qs({ ...f, sede: s.site_id })}`}>{s.sede}</Link> : <span className="muted">{s.sede}</span>}</td><td className="num">{num(s.n)}</td><td className="num">{ore(s.mediana)}</td><td className="num">{ore(s.p90)}</td><td className="num">{pct(s.entro_pct)}</td></tr>)}
              {!d.sedi.length && <tr><td colSpan={5} className="muted">Nessun referto nel periodo</td></tr>}</tbody></table></div>
          </Card>
        </div>
        <div className="small muted lc-nota">Solo accettazioni con la data del referto (reportAtLocal). Per esame: dall'accettazione alla validazione della riga (o al referto, se la riga non ha la validazione). Mese precedente: stesso intervallo spostato indietro di un mese ({d.mese_prima ? `${gg(d.mese_prima.periodo.da)} → ${gg(d.mese_prima.periodo.a)}` : 'non calcolato'}). Ore di orologio, notti e festivi compresi.</div>
      </>}
    </div>
  );
}
