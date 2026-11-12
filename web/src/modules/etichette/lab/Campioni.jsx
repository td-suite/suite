// Lab Control · Campioni: tracciamento dei campioni (barcode, accettazione, cliente, sede, contenitore, raccolto, check-in, preparato,
// check-out) con i filtri sede, data, stato del campione, "in viaggio" e "raccolti e non arrivati da più di N ore"; ricerca per barcode
// pensata per il lettore (il lettore scrive il codice e preme Invio).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, Pager, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, qs, base } from '../api.js';
import { ClienteLink, CopiaInfo, FiltroPeriodo, FiltroSede, gg, dataOra, num, durata, useFiltriUrl, useStatoLab } from './comuni.jsx';

const TONO = { NON_RACCOLTO: 'grey', IN_VIAGGIO: 'amber', ARRIVATO: 'blue', PREPARATO: 'teal', USCITO: 'green' };

export default function Campioni() {
  const st = useStatoLab();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const [bc, setBc] = useState(f.barcode || '');
  const q = useApi(`/lab/campioni${qs(f)}`, [sp.toString()]);
  const d = q.data;
  const oggi = d?.adesso?.slice(0, 10);
  const oreSoglia = st.data?.soglia?.ore_campioni || 24;
  return (
    <div className="page lc-page">
      <PageHead title="Campioni" icon="tag" sub="Dove sono le provette: raccolte, arrivate in laboratorio (check-in), preparate, uscite" />
      <div className="lc-filtri">
        <form className="lc-cerca lc-barcode" onSubmit={(e) => { e.preventDefault(); set({ barcode: bc.trim() }); }}>
          <Icon name="search" /><input autoFocus type="search" value={bc} onChange={(e) => { setBc(e.target.value); if (!e.target.value) set({ barcode: '' }); }} placeholder="Leggi o scrivi il barcode" aria-label="Barcode del campione" autoComplete="off" spellCheck={false} />
        </form>
        <FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />
        <FiltroPeriodo f={f} onChange={set} tutto predefinito={f.barcode || f.viaggio || f.non_arrivati ? 'tutto' : '7g'} />
        <select className="lc-sel" value={f.stato || ''} onChange={(e) => set({ stato: e.target.value })} aria-label="Stato del campione">
          <option value="">Tutti gli stati</option>{(d?.stati || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className="lc-check"><input type="checkbox" checked={f.viaggio === '1' && f.non_arrivati !== '1'} onChange={(e) => set({ viaggio: e.target.checked ? '1' : '', non_arrivati: '' })} />In viaggio</label>
        <label className="lc-check"><input type="checkbox" checked={f.non_arrivati === '1'} onChange={(e) => set({ non_arrivati: e.target.checked ? '1' : '', viaggio: '' })} />Non arrivati da più di
          <input type="number" min="1" max="720" className="lc-ore" value={f.ore || oreSoglia} onChange={(e) => set({ ore: e.target.value, non_arrivati: '1' })} aria-label="Ore" /> ore</label>
      </div>
      <ErrorBox error={q.error} />
      <Card flush title={d ? `${num(d.totale)} campioni${d.periodo?.da ? ` di accettazioni dal ${gg(d.periodo.da)} al ${gg(d.periodo.a)}` : ''}` : 'Campioni'} actions={d && <CopiaInfo copia={d.copia} />}>
        {!d ? <div className="lc-pad"><Skeleton lines={8} /></div> : !d.righe.length ? <div className="lc-pad muted">Nessun campione con questi filtri.</div> : <>
          <div className="table-wrap"><table className="t lc-t" data-testid="lc-campioni-elenco">
            <thead><tr><th>Barcode</th><th>Stato</th><th>Accettazione</th><th>Cliente</th><th>Sede</th><th>Contenitore</th><th>Raccolto</th><th>Check-in</th><th>Preparato / uscito</th></tr></thead>
            <tbody>{d.righe.map((s) => (
              <tr key={`${s.instance_id}|${s.request_id}|${s.id}`}>
                <td className="mono"><b>{s.barcode || '–'}</b>{s.esami && <div className="small muted">{s.esami}</div>}</td>
                <td><Badge tone={TONO[s.stato]}>{s.stato_label}</Badge>{s.ore_viaggio >= 1 && <div className={`small ${s.ore_viaggio >= oreSoglia ? 'lc-warn' : 'muted'}`}>da {durata(s.ore_viaggio * 60)}</div>}</td>
                <td className="nowrap"><Link to={`${base}/accettazioni/${encodeURIComponent(s.instance_id)}/${encodeURIComponent(s.request_id)}`}>{s.numero}</Link><div className="small muted">{gg(s.data)}</div></td>
                <td><ClienteLink r={s} /></td>
                <td className="small nowrap" title={s.sede || ''}>{s.sede ? s.sede.split(' ')[0] : <span className="muted">–</span>}</td>
                <td className="small">{s.contenitore || '–'}<div className="muted">{s.materiale || ''}</div></td>
                <td className="nowrap small">{dataOra(s.raccolto_il || s.prelevato_il, oggi) || '–'}</td>
                <td className="nowrap small">{dataOra(s.checkin_il, oggi) || '–'}</td>
                <td className="nowrap small">{dataOra(s.preparato_il, oggi) || '–'}{s.checkout_il && <div className="muted">uscito {dataOra(s.checkout_il, oggi)}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="lc-pager"><Pager page={d.pagina} pageSize={d.per_pagina} total={d.totale} onChange={(p) => set({ pagina: p }, { pagina: false })} /></div>
        </>}
      </Card>
      <div className="small muted lc-nota">"In viaggio" = raccolto (o prelevato) e senza check-in in laboratorio, per accettazioni non refertate né chiuse degli ultimi {st.data?.soglia?.giorni_finestra || 60} giorni. I campioni non sono risultati clinici: sono le provette e le loro date.</div>
    </div>
  );
}
