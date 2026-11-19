// Guida alla Suite · Guida al widget (v0.89.0, richiesta del CEO del 19/11/2026): da ogni widget la voce "Guida al widget" apre questa
// pagina con il capitolo del widget, una domanda che lo riguarda (passa a Chiedi con il prefisso "[Widget: Nome]") e la guida del widget
// in PDF (estratto TD-SGI-MAN009_NN, da inviare anche a clienti e fornitori).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, PageHead, Skeleton, ErrorBox } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, apiBase, useApi } from '../api.js';
import { AvvisoDati, TestoGuida } from '../components.jsx';
import MAPPA from '../widget.json';

export default function Widget() {
  const { key } = useParams();
  const w = MAPPA[key];
  const nav = useNavigate();
  const indice = useApi('/indice');
  const [sezioni, setSezioni] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const cap = indice.data?.capitoli?.find((k) => k.numero === w?.capitolo);
  useEffect(() => {
    if (!cap) return;
    Promise.all(cap.sezioni.map((s) => api.get(`/sezioni/${s.slug}`))).then(setSezioni).catch(setErr);
  }, [cap?.numero]);
  if (!w) return <div className="page"><ErrorBox error={new Error('Per questo widget non c\'è ancora una guida')} /></div>;
  const chiedi = (e) => { e.preventDefault(); const t = q.trim(); if (t.length < 5) return; nav(`${base}?chiedi=${encodeURIComponent(`[Widget: ${w.nome}] ${t}`)}`); };
  return (
    <div className="page gg-widget">
      <PageHead title={`Guida al widget · ${w.nome}`} icon="suiteguida" sub={cap?.intro || 'Che cosa fa, chi lo usa, come si usa'}
        actions={<><a className="btn" href={`${apiBase}/widget/${key}.pdf?scarica=1`}><Icon name="download" />Scarica la guida del widget (PDF)</a><Link className="btn ghost" to={w.route}><Icon name="external" />Apri {w.nome}</Link></>} />
      <Card title={`Fai una domanda su ${w.nome}`} icon="comment">
        <form onSubmit={chiedi} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <input style={{ flex: 1, minHeight: 44 }} value={q} onChange={(e) => setQ(e.target.value)} maxLength={900} placeholder="Scrivi la domanda con parole tue" aria-label={`La tua domanda su ${w.nome}`} />
          <button className="btn" type="submit" disabled={q.trim().length < 5}><Icon name="send" />Chiedi</button>
        </form>
        <AvvisoDati />
      </Card>
      {err && <ErrorBox error={err} />}
      {!sezioni && !err && <Skeleton lines={8} />}
      {sezioni?.map((s) => (
        <Card key={s.slug} title={s.titolo.replace(`${w.nome}: `, '').replace(/^./, (c) => c.toUpperCase())} icon="doc">
          <TestoGuida source={s.corpo} />
        </Card>
      ))}
      <p className="small muted">Fonte: Manuale d'uso della Suite TD, TD-SGI-MAN009. <Link to={`${base}/guida`}>Tutta la guida</Link> · <a href={`${apiBase}/guida.pdf`} target="_blank" rel="noopener noreferrer">Manuale completo in PDF</a></p>
    </div>
  );
}
