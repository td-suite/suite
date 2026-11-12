// Lab Control · Cruscotto (pagina iniziale): accettazioni di oggi per fase (barra a fasi), in lavorazione ora, referti pronti non chiusi,
// in ritardo, tempo accettazione → referto (oggi, 7 giorni, per sede), campioni in viaggio, esami non eseguiti di oggi. Ogni numero apre
// l'elenco filtrato. In testa la ricerca rapida (numero o barcode → scheda; cognome sulle identità recenti) e il passaggio a Label.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, ErrorBox, PageHead, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, base, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CopiaInfo, ore, num, FASI_UI } from './comuni.jsx';

const L = (p) => `${base}/accettazioni${qs(p)}`;
const giorniPrima = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

function Numero({ to, n, label, sub, tono = '', testid }) {
  return (
    <Link to={to} className={`card lc-num ${tono}`} data-testid={testid}>
      <span className="lbl">{label}</span><span className="val">{num(n)}</span>{sub && <span className="sub">{sub}</span>}
    </Link>
  );
}

export default function Cruscotto() {
  const d = useApi('/lab/cruscotto');
  const { stato } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const x = d.data;
  const cerca = (e) => { e.preventDefault(); const v = q.trim(); if (v) nav(L({ q: v, periodo: /\d/.test(v) ? 'tutto' : '7g' })); };
  const tot = x?.oggi_totale || 0;
  // finestra dei conteggi "aperti" (in lavorazione, referti non chiusi): stesso intervallo dell'elenco che si apre
  const fin = x ? { periodo: 'intervallo', da: giorniPrima(x.oggi, x.soglia.giorni_finestra), a: x.oggi } : {};
  return (
    <div className="page lc-page">
      <PageHead title="Lab Control" icon="etichette" sub="Accettazioni, avanzamento, etichette: lo stato del laboratorio dalle accettazioni StudioLab"
        actions={<><Link className="btn ghost" to={`${base}/label`}><Icon name="printer" />Stampa etichette</Link><Link className="btn" to={L({})}><Icon name="list" />Accettazioni</Link></>} />
      <div className="lc-testa">
        <form className="lc-rapida" onSubmit={cerca} role="search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numero di accettazione, barcode o cognome" aria-label="Cerca un'accettazione" autoComplete="off" spellCheck={false} />
          <button className="btn" disabled={!q.trim()}>Cerca</button>
        </form>
        {x && <CopiaInfo copia={x.copia} />}
      </div>
      <ErrorBox error={d.error} />
      {stato?.data_api && !stato.data_api.ok && <div className="small muted lc-nota">Lettura puntuale dal gestionale non disponibile: {String(stato.data_api.motivo || '').replace(/[()]/g, '')}. I dati sono quelli della copia.</div>}
      {!x ? <Skeleton lines={8} /> : <>
        <Card title={`Accettazioni di oggi: ${num(tot)}`} icon="calendar" className="lc-oggi" actions={<Link className="btn sm ghost" to={L({ periodo: 'oggi' })}>Elenco di oggi</Link>}>
          {tot === 0 ? <div className="muted">Nessuna accettazione con data di oggi nella copia.</div> : (
            <>
              <div className="lc-stack" role="img" aria-label="Accettazioni di oggi per fase">
                {x.oggi_fasi.filter((f) => f.n > 0).map((f) => <Link key={f.key} to={L({ periodo: 'oggi', fase: f.key })} className={`seg f${f.indice}`} style={{ flexGrow: f.n }} title={`${f.label}: ${f.n}`}><span>{f.n}</span></Link>)}
                {x.oggi_nc > 0 && <Link to={L({ periodo: 'oggi', fase: 'NC' })} className="seg nc" style={{ flexGrow: x.oggi_nc }} title={`NC mai arrivato: ${x.oggi_nc}`}><span>{x.oggi_nc}</span></Link>}
              </div>
              <ul className="lc-legenda">
                {x.oggi_fasi.map((f) => <li key={f.key}><Link to={L({ periodo: 'oggi', fase: f.key })}><i className={`f${f.indice}`} />{f.label}<b>{num(f.n)}</b></Link></li>)}
                <li><Link to={L({ periodo: 'oggi', fase: 'NC' })}><i className="nc" />NC mai arrivato<b>{num(x.oggi_nc)}</b></Link></li>
                {x.oggi_altri.map((a) => <li key={a.stato}><span><i />{a.label}<b>{num(a.n)}</b></span></li>)}
              </ul>
            </>
          )}
        </Card>

        <div className="lc-nums">
          <Numero testid="lc-in-lavorazione" to={L({ ...fin, in_corso: '1' })} n={x.in_lavorazione} label="In lavorazione ora" sub={x.in_lavorazione_stati.filter((s) => s.n).map((s) => `${s.label.toLowerCase()} ${s.n}`).join(' · ') || `ultimi ${x.soglia.giorni_finestra} giorni`} />
          <Numero testid="lc-referti" to={L({ ...fin, referti_aperti: '1' })} n={x.referti_non_chiusi} label="Referti pronti non chiusi" sub="stato 40, in attesa di chiusura" />
          <Numero testid="lc-ritardo" to={`${base}/ritardi`} n={x.in_ritardo} label="In ritardo" tono={x.in_ritardo ? 'warn' : ''} sub={`oltre ${x.soglia.ore_ritardo} ore dall'accettazione senza referto`} />
          <Numero testid="lc-viaggio" to={`${base}/campioni?viaggio=1`} n={x.campioni_viaggio} label="Campioni in viaggio" tono={x.campioni_viaggio_oltre ? 'warn' : ''} sub={`raccolti e non arrivati · ${num(x.campioni_viaggio_oltre)} da oltre ${x.soglia.ore_campioni} ore`} />
          <Numero testid="lc-ne" to={L({ periodo: 'oggi', non_eseguiti: '1' })} n={x.non_eseguiti_oggi.righe} label="Esami non eseguiti oggi" sub={`${num(x.non_eseguiti_oggi.accettazioni)} accettazioni di oggi`} />
        </div>

        <div className="lc-due">
          <Card title="Accettazione → referto pronto" icon="clock" actions={<Link className="btn sm ghost" to={`${base}/tat`}>Tempi di refertazione</Link>}>
            <div className="lc-tat">
              <div><span>Oggi (mediana)</span><b>{ore(x.tat_oggi?.mediana)}</b><em>{x.tat_oggi?.n ? `media ${ore(x.tat_oggi.media)} · ${num(x.tat_oggi.n)} referti` : 'nessun referto oggi'}</em></div>
              <div><span>Ultimi 7 giorni (mediana)</span><b>{ore(x.tat_7?.mediana)}</b><em>{x.tat_7?.n ? `media ${ore(x.tat_7.media)} · 90% entro ${ore(x.tat_7.p90)} · ${num(x.tat_7.n)} referti` : 'nessun referto'}</em></div>
            </div>
          </Card>
          <Card title="Tempo per sede (ultimi 7 giorni)" icon="building" flush>
            {!x.tat_sedi.length ? <div className="muted lc-pad">Nessun referto negli ultimi 7 giorni.</div> : (
              <div className="table-wrap"><table className="t lc-t-stretta">
                <thead><tr><th>Sede</th><th className="num">Referti</th><th className="num">Mediana</th><th className="num">Media</th></tr></thead>
                <tbody>{x.tat_sedi.map((s) => <tr key={s.site_id ?? 'nd'}><td>{s.site_id ? <Link to={L({ sede: s.site_id, periodo: '7g' })}>{s.sede}</Link> : <span className="muted">{s.sede}</span>}</td><td className="num">{num(s.n)}</td><td className="num">{ore(s.mediana)}</td><td className="num">{ore(s.media)}</td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
        </div>
        <div className="small muted lc-nota">
          Fasi: {FASI_UI.map((f) => f.label).join(' → ')}; lo stato 11 (NC, campione mai arrivato) è fuori linea. "In lavorazione", ritardi e campioni in viaggio contano le accettazioni degli ultimi {x.soglia.giorni_finestra} giorni. Tempi in ore di orologio, dalle date del gestionale.
        </div>
      </>}
    </div>
  );
}
