// Lab Control · In ritardo (v0.91.1): accettazioni in corso con esami oltre la scadenza di refertazione = data di accettazione + giorni di
// refertazione - 1 (giorni per esame dalle Impostazioni, altrimenti il predefinito; soglie per fase se impostate), raggruppate per cliente e per sede, con la fase in cui si trovano; export Excel senza nomi.
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
  // Ritardo massimo: l'accettazione (o le accettazioni) con il ritardo più lungo. Una sola: si apre la scheda; più d'una: si evidenziano nell'elenco.
  const ggMax = d?.righe?.length ? Math.max(...d.righe.map((r) => r.ritardo?.giorni_oltre || 0)) : 0;
  const massimi = d?.righe?.length ? d.righe.filter((r) => (r.ritardo?.giorni_oltre || 0) === ggMax) : [];
  const giorniTxt = (n) => (n == null ? '–' : `${n} ${n === 1 ? 'giorno' : 'giorni'}`);
  const [evid, setEvid] = React.useState(false);
  const scheda = (r) => `${base}/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}`;
  const apriMassimo = () => { if (massimi.length === 1) nav(scheda(massimi[0])); else if (massimi.length > 1) { setEvid(true); setTimeout(() => document.querySelector('tr.lc-evid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } };
  const fasi = (x) => FASI_UI.filter((p) => x.fasi[p.key]).map((p) => `${p.label.toLowerCase()} ${x.fasi[p.key]}`).join(' · ');
  return (
    <div className="page lc-page">
      <PageHead title="In ritardo" icon="alert" sub={d ? `Esami oltre la data di accettazione + giorni di refertazione - 1 (esami senza giorni: ${d.soglia.giorni_refertazione})${Object.keys(d.soglia.soglie_fase || {}).length ? ', o accettazioni ferme in una fase oltre la sua soglia' : ''} · ultimi ${d.soglia.giorni_finestra} giorni` : 'Esami oltre la scadenza di refertazione'}
        actions={<a className="btn ghost" href={`${apiBase}/lab/ritardi.xlsx${qs(f)}`}><Icon name="sheet" />Excel</a>} />
      <div className="lc-filtri"><FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />{d && <CopiaInfo copia={d.copia} />}</div>
      <ErrorBox error={q.error} />
      {!d ? <Skeleton lines={8} /> : <>
        <div className="lc-nums">
          <div className="card lc-num warn"><span className="lbl">In ritardo</span><span className="val">{num(d.totale)}</span><span className="sub">oltre la scadenza di refertazione</span></div>
          <div className="card lc-num"><span className="lbl">Clienti coinvolti</span><span className="val">{num(d.per_cliente.length)}</span></div>
          <div className="card lc-num"><span className="lbl">Sedi coinvolte</span><span className="val">{num(d.per_sede.length)}</span></div>
          <button type="button" className="card lc-num lc-num-click" disabled={!massimi.length} onClick={apriMassimo} title={massimi.length === 1 ? `Apri l'accettazione ${massimi[0].numero}` : massimi.length > 1 ? `${massimi.length} accettazioni con questo ritardo: le evidenzio nell'elenco` : ''}>
            <span className="lbl">Ritardo massimo</span><span className="val lc-val-s">{massimi.length ? giorniTxt(ggMax) : '–'}</span>{massimi.length > 0 && <span className="sub">{massimi.length === 1 ? `accettazione ${massimi[0].numero}` : `${massimi.length} accettazioni`}</span>}</button>
        </div>
        <div className="lc-due">
          <Card title="Per cliente" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Cliente</th><th className="num">N.</th><th className="num">Max</th></tr></thead>
              <tbody>{d.per_cliente.map((c) => <tr key={c.chiave}><td><ClienteLink r={{ ...c, instance_id: c.chiave.split('|')[0], cliente: c.nome, link_cliente: d.righe.find((x) => `${x.instance_id}|${x.client_id}` === c.chiave)?.link_cliente }} /><div className="small muted">{fasi(c)}</div></td>
                <td className="num"><Link to={`${base}/accettazioni${qs({ cliente: `c-${c.client_id}`, ritardo: '1', periodo: 'tutto' })}`}>{num(c.n)}</Link></td><td className="num nowrap">{giorniTxt(c.giorni_max)}</td></tr>)}
              {!d.per_cliente.length && <tr><td colSpan={3} className="muted">Nessun ritardo</td></tr>}</tbody></table></div>
          </Card>
          <Card title="Per sede" icon="building" flush>
            <div className="table-wrap"><table className="t lc-t-stretta"><thead><tr><th>Sede</th><th className="num">N.</th><th className="num">Max</th></tr></thead>
              <tbody>{d.per_sede.map((s) => <tr key={s.chiave}><td>{s.site_id ? <Link to={`${base}/accettazioni${qs({ sede: s.site_id, ritardo: '1', periodo: 'tutto' })}`}>{s.nome}</Link> : <span className="muted">{s.nome}</span>}<div className="small muted">{fasi(s)}</div></td>
                <td className="num">{num(s.n)}</td><td className="num nowrap">{giorniTxt(s.giorni_max)}</td></tr>)}
              {!d.per_sede.length && <tr><td colSpan={3} className="muted">Nessun ritardo</td></tr>}</tbody></table></div>
          </Card>
        </div>
        <Card flush title={`Accettazioni in ritardo (dalla più vecchia)`} icon="clock">
          {!d.righe.length ? <div className="lc-pad muted">Nessuna accettazione in ritardo.</div> : (
            <div className="table-wrap"><table className="t lc-t" data-testid="lc-ritardi">
              <thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Sede</th><th>Paziente</th><th>Esami in ritardo</th><th>Scadenza</th><th>Fase</th><th className="num">Oltre da</th></tr></thead>
              <tbody>{d.righe.map((r) => (
                <tr key={`${r.instance_id}|${r.id}`} className={`click ${evid && massimi.includes(r) ? 'lc-evid' : ''}`} onClick={() => nav(scheda(r))}>
                  <td className="mono"><b>{r.numero}</b></td><td className="nowrap">{gg(r.data)} <span className="muted">{ora(r.creata_il)}</span></td>
                  <td><ClienteLink r={r} /></td><td className="small">{r.sede || <span className="muted">non abbinata</span>}</td>
                  <td>{r.paziente || <span className="muted">{[r.eta != null ? `${r.eta} anni` : null, r.sesso].filter(Boolean).join(' · ') || '–'}</span>}</td>
                  <td className="small lc-esami-rit">{(r.esami_in_ritardo || []).length ? r.esami_in_ritardo.map((e, i) => <div key={i}><span className="mono">{e.codice}</span> {e.descrizione || <span className="muted">descrizione non disponibile</span>}<span className="muted"> · {e.giorni} gg{e.eseguito ? ' · eseguito, da validare' : ''}</span></div>) : <span className="muted">{r.ritardo.motivo || '–'}</span>}</td>
                  <td className="nowrap">{r.ritardo.scadenza ? gg(r.ritardo.scadenza) : '–'}</td>
                  <td><FaseBar fase={r.fase} tappe={r.fase.tappe} /></td>
                  <td className="num"><Badge tone="red" title={r.ritardo.motivo}>{r.ritardo.giorni_oltre != null ? giorniTxt(r.ritardo.giorni_oltre) : durata(r.ritardo.ore * 60)}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
    </div>
  );
}
