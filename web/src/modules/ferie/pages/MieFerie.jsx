// Le mie ferie: saldo dell'anno (spettanza, maturato, anno precedente, goduti, pianificati, in attesa, residuo), avvisi, chiusure
// collettive proposte per la mia area, le mie richieste. Chi è fuori perimetro (non dipendente) vede il motivo e i collegamenti utili.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { useAuth, isApprovatore } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Seg } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Saldo, Avvisi, TabellaRichieste } from '../components.jsx';
import { itData, num, oggiIso } from '../format.js';

export default function MieFerie() {
  const { user } = useAuth();
  const nav = useNavigate();
  const annoCorrente = Number(oggiIso().slice(0, 4));
  const [anno, setAnno] = useState(annoCorrente);
  const { data, loading, error } = useApi(`/me?anno=${anno}`, [anno]);
  const anni = [annoCorrente + 1, annoCorrente, annoCorrente - 1];
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  if (data?.fuori_perimetro) {
    return (
      <div className="page">
        <PageHead title="Piano Ferie" icon="calendar" sub="Ferie annuali dei dipendenti: richieste, approvazioni e piano per area." />
        <Card><Empty icon="info" title="Non hai un saldo ferie in questo modulo">{data.motivo}</Empty>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            {isApprovatore(user) && <Link className="btn" to={`${base}/approvare`}><Icon name="check" />Richieste da approvare</Link>}
            <Link className="btn ghost" to={`${base}/piano`}><Icon name="calendar" />Piano per area</Link>
          </div>
        </Card>
      </div>
    );
  }
  const p = data.persona;
  const s = data.saldo;
  return (
    <div className="page">
      <PageHead title="Le mie ferie" icon="calendar" sub={`${p.nome} · ${p.gruppo_nome}${p.ruolo ? ` · ${p.ruolo}` : ''}`}
        actions={<><Seg value={anno} onChange={setAnno} items={anni.map((a) => ({ value: a, label: String(a) }))} label="Anno" /><Link className="btn" to={`${base}/nuova`}><Icon name="plus" />Nuova richiesta</Link></>} />
      {data.settings.avviso_dipendenti && <div className="alert info"><Icon name="info" /><span>{data.settings.avviso_dipendenti}</span></div>}
      <Saldo s={s} />
      <Avvisi avvisi={s.avvisi} />
      <div className="fe-two">
        <Card title="Le mie richieste" icon="list" flush actions={<Link className="btn ghost sm" to={`${base}/richieste`}>Tutte<Icon name="arrowRight" /></Link>}>
          <TabellaRichieste rows={data.richieste.slice(0, 8)} mostraPersona={false} vuoto={`Nessuna richiesta nel ${anno}`} />
        </Card>
        <div className="grid">
          {data.chiusure.length > 0 && (
            <Card title="Chiusure collettive della tua area" icon="building">
              <ul className="fe-list">{data.chiusure.map((c) => (
                <li key={c.id}><div><div className="strong">{itData(c.data_inizio)} → {itData(c.data_fine)}</div><div className="small muted">{c.descrizione || 'Chiusura collettiva'}</div></div>
                  {c.gia_richiesta ? <span className="small muted">già richiesta</span> : <button type="button" className="btn sm" onClick={() => nav(`${base}/nuova?da=${c.data_inizio}&a=${c.data_fine}&chiusura=${c.id}`)}>Richiedi</button>}</li>))}</ul>
            </Card>
          )}
          <Card title="Come si calcola" icon="info">
            <dl className="fe-dl">
              <dt>Area</dt><dd>{p.gruppo_nome} <span className="muted small">({p.area_origine})</span></dd>
              <dt>Approva</dt><dd>{p.approvatore ? <>{p.approvatore} <span className="muted small">({p.approvatore_origine})</span></> : 'HR (nessun responsabile nell\'organigramma)'}</dd>
              <dt>Settimana</dt><dd>{data.settimana}</dd>
              <dt>Spettanza</dt><dd>{num(s.giorni_annui)} giorni l'anno <span className="muted small">({s.spettanza_fonte})</span></dd>
              {p.inizio && <><dt>Contratto</dt><dd>dal {itData(p.inizio)}{p.fine ? ` al ${itData(p.fine)}` : ''}{p.contratto?.level ? ` · livello ${p.contratto.level}` : ''}</dd></>}
            </dl>
            <details className="small"><summary>Festivi {anno} ({data.festivi.length})</summary><ul className="fe-fest">{data.festivi.map((f) => <li key={f.data}>{itData(f.data)} · {f.nome}</li>)}</ul></details>
          </Card>
        </div>
      </div>
    </div>
  );
}
