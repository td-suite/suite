// Lab Control · In ritardo: accettazioni in corso oltre la soglia (impostazione ore_ritardo, e soglie per fase se impostate) senza referto
// pronto, raggruppate per cliente e per sede, con gli esami che bloccano (non validati e senza referto pronto); export Excel senza nomi.
import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, qs, base, apiBase } from '../api.js';
import { ClienteLink, CopiaInfo, FaseBar, FiltroSede, gg, ora, num, durata, useFiltriUrl, useStatoLab, FASI_UI } from './comuni.jsx';

export default function Ritardi() {
  const st = useStatoLab();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const q = useApi(`/lab/ritardi${qs(f)}`, [sp.toString()]);
  const d = q.data;
  const fasi = (x) => FASI_UI.filter((p) => x.fasi[p.key]).map((p) => `${p.label.toLowerCase()} ${x.fasi[p.key]}`).join(' · ');
  return (
    <div className="page lc-page">
      <PageHead title="In ritardo" icon="alert" sub={d ? `Accettazioni in corso oltre ${d.soglia.ore_ritardo} ore dall'accettazione senza referto pronto${Object.keys(d.soglia.soglie_fase || {}).length ? ', o ferme in una fase oltre la sua soglia' : ''} (ultimi ${d.soglia.giorni_finestra} giorni)` : 'Accettazioni oltre la soglia senza referto pronto'}
        actions={<a className="btn ghost" href={`${apiBase}/lab/ritardi.xlsx${qs(f)}`}><Icon name="sheet" />Excel</a>} />
      <div className="lc-filtri"><FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />{d && <CopiaInfo copia={d.copia} />}</div>
      <ErrorBox error={q.error} />
      {!d ? <Skeleton lines={8} /> : <>
        <div className="lc-nums">
          <div className="card lc-num warn"><span className="lbl">In ritardo</span><span className="val">{num(d.totale)}</span><span className="sub">soglia {d.soglia.ore_ritardo} ore</span></div>
          <div className="card lc-num"><span className="lbl">Clienti coinvolti</span><span className="val">{num(d.per_cliente.length)}</span></div>
          <div className="card lc-num"><span className="lbl">Sedi coinvolte</span><span className="val">{num(d.per_sede.length)}</span></div>
          <div className="card lc-num"><span className="lbl">Il più vecchio</span><span className="val lc-val-s">{d.righe[0]?.ritardo?.ore != null ? durata(d.righe[0].ritardo.ore * 60) : '–'}</span></div>
        </div>
        <div className="lc-tre">
          <Card title="Per cliente" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Cliente</th><th className="num">N.</th><th className="num">Max</th></tr></thead>
              <tbody>{d.per_cliente.map((c) => <tr key={c.chiave}><td><ClienteLink r={{ ...c, instance_id: c.chiave.split('|')[0], cliente: c.nome, link_cliente: d.righe.find((x) => `${x.instance_id}|${x.client_id}` === c.chiave)?.link_cliente }} /><div className="small muted">{fasi(c)}</div></td>
                <td className="num"><Link to={`${base}/accettazioni${qs({ cliente: `c-${c.client_id}`, ritardo: '1', periodo: 'tutto' })}`}>{num(c.n)}</Link></td><td className="num nowrap">{durata(c.ore_max * 60)}</td></tr>)}
              {!d.per_cliente.length && <tr><td colSpan={3} className="muted">Nessun ritardo</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per sede" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Sede</th><th className="num">N.</th><th className="num">Max</th></tr></thead>
              <tbody>{d.per_sede.map((s) => <tr key={s.chiave}><td>{s.site_id ? <Link to={`${base}/accettazioni${qs({ sede: s.site_id, ritardo: '1', periodo: 'tutto' })}`}>{s.nome}</Link> : <span className="muted">{s.nome}</span>}<div className="small muted">{fasi(s)}</div></td>
                <td className="num">{num(s.n)}</td><td className="num nowrap">{durata(s.ore_max * 60)}</td></tr>)}
              {!d.per_sede.length && <tr><td colSpan={3} className="muted">Nessun ritardo</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Esami che bloccano" icon="list" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Esame</th><th className="num">Accett.</th></tr></thead>
              <tbody>{d.esami_bloccanti.map((e) => <tr key={e.codice}><td><b className="mono">{e.codice}</b> <span className="small muted">{e.descrizione || ''}</span></td><td className="num">{num(e.accettazioni)}</td></tr>)}
              {!d.esami_bloccanti.length && <tr><td colSpan={2} className="muted">Nessuno</td></tr>}</tbody></table></div>
          </Card>
        </div>
        <Card flush title={`Accettazioni in ritardo (dalla più vecchia)`} icon="clock">
          {!d.righe.length ? <div className="lc-pad muted">Nessuna accettazione in ritardo.</div> : (
            <div className="table-wrap"><table className="t lc-t" data-testid="lc-ritardi">
              <thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Sede</th><th>Fase</th><th>Esami che bloccano</th><th className="num">Da</th></tr></thead>
              <tbody>{d.righe.map((r) => (
                <tr key={`${r.instance_id}|${r.id}`} className="click" onClick={() => nav(`${base}/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}`)}>
                  <td className="mono"><b>{r.numero}</b></td><td className="nowrap">{gg(r.data)} <span className="muted">{ora(r.creata_il)}</span></td>
                  <td><ClienteLink r={r} /></td><td className="small">{r.sede || <span className="muted">non abbinata</span>}</td>
                  <td><FaseBar fase={r.fase} tappe={r.fase.tappe} compatta /></td>
                  <td className="small mono">{r.bloccanti.map((b) => b.codice).join(' ') || <span className="muted">tutti validati: manca il referto</span>}</td>
                  <td className="num"><Badge tone="red" title={r.ritardo.motivo}>{durata(r.ritardo.ore * 60)}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
    </div>
  );
}
