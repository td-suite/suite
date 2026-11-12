// Guida GIPO · Chiedi (pagina iniziale). Barra grande: mentre si scrive compaiono le sezioni e le FAQ pertinenti; "Chiedi" invia la domanda
// (POST /chiedi): risposta in passi con le fonti citate, oppure i migliori risultati della ricerca. Ogni risposta ha "Mi è stata utile: sì /
// no" (+ nota): "no" e le domande senza risposta vanno alla redazione. Sotto, le domande recenti dell'utente con l'eventuale risposta della
// redazione. Avviso fisso: niente dati dei pazienti.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, qs, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AvvisoDati, Bollino, ESITO, Risultati, TestoGuida, itDataOra, linkRisultato } from '../components.jsx';

const ESEMPI = ['Come accetto un paziente arrivato?', 'Come faccio una nota di credito?', 'Come stampo la chiusura di cassa?', 'Perché Nuovo referto dal menu dà errore?', 'Dove vedo l\'esito della fattura elettronica?'];

/** Citazioni [n] della risposta → collegamenti "(n)" alla fonte */
const conCitazioni = (testo, fonti) => String(testo || '').replace(/\[(\d+)\](?!\()/g, (m, n) => {
  const f = fonti?.[Number(n) - 1];
  return f ? `[(${n})](${linkRisultato({ tipo: f.tipo, slug: f.slug, id: f.id })})` : m;
});

function Valutazione({ domanda, onFatto }) {
  const [scelta, setScelta] = useState(domanda.utile ?? null);
  const [nota, setNota] = useState(domanda.nota_utente || '');
  const [inviata, setInviata] = useState(domanda.utile != null);
  const [err, setErr] = useState(null);
  const invia = async (utile, testoNota) => {
    setErr(null);
    try { const r = await api.post(`/domande/${domanda.id}/valuta`, { utile, nota: testoNota || null }); setInviata(true); setScelta(utile); onFatto?.(r); } catch (e) { setErr(e); }
  };
  if (inviata) {
    return <div className={`alert ${scelta ? 'ok' : 'info'} gg-val-ok`}><Icon name="check" /><span>{scelta ? 'Grazie: la tua valutazione aiuta a migliorare la guida.' : 'Grazie. La domanda è arrivata alla redazione: quando risponde trovi la risposta tra le FAQ e ricevi una notifica nella Suite.'}</span></div>;
  }
  return (
    <div className="gg-valuta">
      <ErrorBox error={err} />
      <span className="gg-valuta-q">Mi è stata utile?</span>
      <button type="button" className="btn sm" onClick={() => invia(true)}><Icon name="check" />Sì</button>
      <button type="button" className={`btn sm ${scelta === false ? '' : 'ghost'}`} onClick={() => setScelta(false)}><Icon name="x" />No</button>
      {scelta === false && (
        <div className="gg-nota">
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Cosa mancava? (facoltativo, senza dati di pazienti)" rows={2} maxLength={1000} />
          <button type="button" className="btn sm" onClick={() => invia(false, nota)}><Icon name="send" />Invia alla redazione</button>
        </div>
      )}
    </div>
  );
}

function Risposta({ r, onValutata }) {
  const citate = (r.fonti || []).filter((f) => f.citata);
  const altre = (r.risultati || []).filter((x) => !citate.some((f) => f.tipo === x.tipo && f.id === x.id));
  return (
    <Card className="gg-risposta" title={r.esito === 'RISPOSTA' ? 'Risposta dalla guida' : r.esito === 'SOLO_RICERCA' ? 'Cosa dice la guida' : 'La guida non copre ancora questa domanda'} icon={r.esito === 'RISPOSTA' ? 'sparkle' : r.esito === 'SOLO_RICERCA' ? 'doc' : 'info'}
      actions={<Badge tone={ESITO[r.esito]?.tone}>{ESITO[r.esito]?.label}</Badge>}>
      <div className="gg-domanda"><Icon name="comment" /><span>{r.domanda || r.testo}</span></div>
      {r.mascherati?.length > 0 && <div className="alert warn gg-masc"><Icon name="shield" /><span>Dalla domanda sono stati tolti: {r.mascherati.join(', ')}. Non scrivere dati dei pazienti.</span></div>}
      {r.esito === 'RISPOSTA' && r.risposta && <TestoGuida source={conCitazioni(r.risposta, r.fonti)} className="gg-testo-risposta" />}
      {r.esito === 'SENZA_RISPOSTA' && (
        <div className="gg-senza">
          {r.risposta ? <TestoGuida source={conCitazioni(r.risposta, r.fonti)} /> : <p>Nella guida non ci sono ancora sezioni che rispondono a questa domanda.</p>}
          <p className="muted">La domanda è già nella coda della redazione: quando risponde la trovi tra le FAQ e ricevi una notifica nella Suite. Se è urgente chiedi al referente interno o apri un ticket all'assistenza Gipo (menu Assistenza di GIPO, next@gipo.it).</p>
        </div>
      )}
      {r.esito === 'SOLO_RICERCA' && <p className="muted">{r.ai?.errore || (r.ai?.attiva ? '' : 'L\'assistente non è attivo:')} ecco le sezioni e le FAQ più pertinenti. Aprile per i passaggi completi.</p>}
      {r.esito === 'RISPOSTA' && <div className="alert info gg-cautela"><Icon name="info" /><span>La risposta è costruita solo sui testi della guida. Le sezioni "da validare" descrivono procedure ricavate dall'interfaccia: in caso di dubbio chiedi conferma al referente.</span></div>}
      {citate.length > 0 && (
        <div className="gg-fonti">
          <h3>Sezioni usate</h3>
          <ul>{citate.map((f) => { const n = (r.fonti || []).indexOf(f) + 1; return <li key={`${f.tipo}-${f.id}`}><Link to={linkRisultato(f)}><b>({n})</b> {f.tipo === 'faq' ? 'FAQ: ' : ''}{f.titolo}</Link>{f.tipo === 'sezione' && <Bollino stato={f.stato} compatto />}</li>; })}</ul>
        </div>
      )}
      {(r.esito !== 'RISPOSTA' ? r.risultati : altre)?.length > 0 && (
        <div className="gg-fonti">
          <h3>{r.esito === 'RISPOSTA' ? 'Altre sezioni pertinenti' : r.esito === 'SENZA_RISPOSTA' ? 'Forse ti interessano' : 'Risultati nella guida'}</h3>
          <Risultati risultati={r.esito === 'RISPOSTA' ? altre : r.risultati} />
        </div>
      )}
      {r.id && <Valutazione key={r.id} domanda={r} onFatto={onValutata} />}
    </Card>
  );
}

export default function Chiedi() {
  const { stato } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [live, setLive] = useState(null);
  const [risposta, setRisposta] = useState(null);
  const [inviando, setInviando] = useState(false);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  const mie = useApi('/domande/mie', [], { silent: true });

  useEffect(() => { input.current?.focus(); }, []);
  // domanda aperta dalle recenti o da una notifica (?domanda=ID)
  useEffect(() => {
    const id = sp.get('domanda');
    if (!id) return;
    api.get(`/domande/${id}`).then((d) => setRisposta({ ...d, domanda: d.testo, risultati: [] })).catch(setErr);
  }, [sp]);
  // risultati immediati mentre si scrive (non registrati come ricerche: la domanda si registra quando la invii)
  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setLive(null); return undefined; }
    const h = setTimeout(() => { api.get(`/cerca${qs({ q: t, registra: '0' })}`, { silent: true }).then((r) => setLive(r.risultati.slice(0, 6))).catch(() => setLive(null)); }, 220);
    return () => clearTimeout(h);
  }, [q]);

  const chiedi = async (e, testo) => {
    e?.preventDefault();
    const d = (testo ?? q).trim();
    if (d.length < 5) { setErr(new Error('Scrivi la domanda con qualche parola in più')); return; }
    setInviando(true); setErr(null); setRisposta(null);
    if (sp.get('domanda')) setSp({}, { replace: true });
    try { const r = await api.post('/chiedi', { domanda: d }); setRisposta(r); setLive(null); mie.reload(); } catch (e2) { setErr(e2); }
    finally { setInviando(false); }
  };

  return (
    <div className="page gg-page">
      <PageHead title="Chiedi alla Guida GIPO" icon="gipoguida" sub="Fai una domanda su GipoNext con parole tue: la risposta arriva dai testi della guida, con i rimandi alle sezioni"
        actions={<><Link className="btn ghost" to={`${base}/guida`}><Icon name="doc" />Sfoglia la guida</Link><a className="btn ghost" href="/api/gipoguida/guida.pdf?scarica=1"><Icon name="download" />Scarica la guida PDF</a></>} />
      <AvvisoDati testo={stato?.avviso_dati} />
      <form className="gg-cerca" onSubmit={chiedi} role="search">
        <Icon name="search" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="Per esempio: come faccio una nota di credito?" aria-label="La tua domanda su GIPO" />
        <button className="btn lg" disabled={inviando}><Icon name="send" />{inviando ? 'Cerco la risposta' : 'Chiedi'}</button>
      </form>
      {!q && !risposta && (
        <div className="gg-esempi"><span className="muted small">Prova con:</span>{ESEMPI.map((x) => <button key={x} type="button" className="gg-chip" onClick={() => { setQ(x); chiedi(null, x); }}>{x}</button>)}</div>
      )}
      {live && !risposta && !inviando && (
        <div className="gg-live card">
          <div className="gg-live-hd small muted">Nella guida, mentre scrivi · premi Chiedi per la risposta</div>
          <Risultati risultati={live} vuoto="Nessuna sezione contiene queste parole: invia comunque la domanda, arriverà alla redazione." />
        </div>
      )}
      <ErrorBox error={err} />
      {inviando && <Card className="gg-risposta"><div className="gg-attesa"><span className="gg-pulse" />Leggo la guida e preparo la risposta...</div></Card>}
      {risposta && <Risposta r={risposta} onValutata={() => mie.reload()} />}

      <Card title="Le tue domande recenti" icon="clock" className="gg-mie">
        {!mie.data?.length && <div className="muted small">Non hai ancora fatto domande. Le ultime 20 compaiono qui, con la risposta della redazione quando arriva.</div>}
        <ul className="gg-mie-l">
          {(mie.data || []).map((d) => (
            <li key={d.id}>
              <button type="button" className="gg-mie-q" onClick={() => setRisposta({ ...d, domanda: d.testo, risultati: [] })}>{d.testo}</button>
              <span className="small muted">{itDataOra(d.creata_il)}</span>
              <Badge tone={ESITO[d.esito]?.tone}>{ESITO[d.esito]?.label}</Badge>
              {d.utile === true && <Badge tone="green">utile</Badge>}
              {d.utile === false && !d.risolta_il && <Badge tone="amber">alla redazione</Badge>}
              {d.risolta_con_faq_id && <Link className="small" to={`${base}/faq?voce=${d.risolta_con_faq_id}`}><Icon name="check" />Risposta della redazione</Link>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
