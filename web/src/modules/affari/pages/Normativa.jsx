// Normativa di riferimento (v0.97.0): collegamenti alle norme su autorizzazione e accreditamento delle strutture sanitarie in Toscana,
// testi acquisiti dalla Suite e domande in linguaggio naturale. La risposta è del modello AI sui soli passi delle norme che la Suite gli
// passa, con il rimando al punto della norma; i passi usati si leggono sotto la risposta.
import React, { useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, ConfirmModal, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi } from '../api.js';
import { useStato } from '../index.jsx';

const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ESITO = { COMPLETA: ['green', 'Risposta fondata sui testi'], PARZIALE: ['amber', 'Risposta parziale'], NON_TROVATA: ['grey', 'Non trovato nei testi'], ERRORE: ['red', 'Errore'] };
const ESEMPI = ['Quali requisiti deve avere un punto prelievo collegato a un laboratorio per essere accreditato?', 'Ogni quanto si rinnova l\'accreditamento istituzionale e che cosa serve per il rinnovo?', 'Che cosa va comunicato al Comune se cambia il direttore sanitario di una struttura autorizzata?', 'Quali sono i requisiti di esercizio per la risonanza magnetica?'];

function Risposta({ r }) {
  const [aperti, setAperti] = useState(false);
  const [tono, etichetta] = ESITO[r.esito] || ESITO.PARZIALE;
  return (
    <div className="pa-voce">
      <div className="m"><Badge tone={tono}>{etichetta}</Badge>{r.at && <span>{itDataOra(r.at)}</span>}{r.utente && <span>{r.utente}</span>}</div>
      <div className="t">{r.domanda}</div>
      <div className="s pa-risposta">{String(r.risposta || '').split(/\n{1,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
      {r.riferimenti?.length > 0 && <>
        <div className="p"><strong>Passi delle norme usati:</strong> {r.riferimenti.map((x) => `[${x.n}] ${x.norma}${x.punto ? `, ${x.punto}` : ''}`).join('; ')}</div>
        <div className="az"><button className="btn sm ghost" onClick={() => setAperti(!aperti)}>{aperti ? 'Nascondi i passi' : 'Leggi i passi'}</button></div>
        {aperti && r.riferimenti.map((x) => <div key={x.n} className="pa-passo"><b>[{x.n}] {x.norma}{x.punto ? ` · ${x.punto}` : ''}</b><div>{x.estratto}{x.estratto?.length >= 700 ? '…' : ''}</div></div>)}
      </>}
    </div>
  );
}

export default function Normativa() {
  const st = useStato(); const toast = useToast();
  const d = useApi('/norme');
  const [dom, setDom] = useState(''); const [busy, setBusy] = useState(false); const [ultima, setUltima] = useState(null);
  const [nuova, setNuova] = useState(null);
  const chiedi = async (e, testo = null) => {
    e?.preventDefault?.(); const q = String(testo ?? dom).trim(); if (q.length < 8 || busy) return;
    setBusy(true); setUltima(null);
    try { setUltima(await api.post('/norme/chiedi', { domanda: q })); setDom(''); d.reload(); } catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  const aggiungi = async () => {
    setBusy(true);
    try { const r = await api.post('/norme', nuova); toast(r.acquisita ? `Norma aggiunta: testo acquisito (${r.caratteri.toLocaleString('it-IT')} caratteri)` : `Norma aggiunta come solo collegamento: ${r.errore}`, r.acquisita ? 'ok' : 'err'); setNuova(null); d.reload(); }
    catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  const [daTogliere, setDaTogliere] = useState(null);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const norme = d.data.righe; const conTesto = norme.filter((n) => n.con_testo);
  return (
    <div className="page">
      <PageHead title="Normativa di riferimento" icon="shield" sub="Autorizzazione all'esercizio e accreditamento istituzionale delle strutture sanitarie in Toscana: norme, testi acquisiti, domande."
        actions={st.user.gestisce && <button className="btn ghost" onClick={() => setNuova({ titolo: '', url: '', descrizione: '' })}><Icon name="plus" />Aggiungi una norma</button>} />
      <Card className="pa-gap" title="Norme e collegamenti" icon="list">
        {norme.map((n) => (
          <div key={n.id} className="pa-norma">
            <div><a href={n.url} target="_blank" rel="noreferrer"><b>{n.titolo}</b> <Icon name="external" /></a>{n.url_pdf && <> · <a href={n.url_pdf} target="_blank" rel="noreferrer">versione PDF</a></>}</div>
            {n.descrizione && <div className="small">{n.descrizione}</div>}
            <div className="small muted">{n.con_testo ? <><Badge tone="green">Testo acquisito</Badge> {Number(n.caratteri).toLocaleString('it-IT')} caratteri in {n.brani} brani. {n.fonte_testo}.</> : n.errore ? <span className="pa-rosso">Testo non acquisito: {n.errore}</span> : <Badge tone="grey">Solo collegamento</Badge>}
              {st.user.gestisce && <> <button className="link-btn" onClick={() => setDaTogliere(n)}>togli</button></>}</div>
          </div>))}
        {nuova && <div className="pa-nuova">
          <input placeholder="Titolo della norma" value={nuova.titolo} onChange={(e) => setNuova({ ...nuova, titolo: e.target.value })} />
          <input placeholder="Indirizzo del testo (pagina o PDF)" value={nuova.url} onChange={(e) => setNuova({ ...nuova, url: e.target.value })} />
          <input placeholder="Descrizione (facoltativa)" value={nuova.descrizione} onChange={(e) => setNuova({ ...nuova, descrizione: e.target.value })} />
          <div className="row"><button className="btn" disabled={busy || nuova.titolo.trim().length < 5 || !nuova.url.trim()} onClick={aggiungi}>{busy ? 'Leggo il testo…' : 'Aggiungi e acquisisci il testo'}</button><button className="btn ghost" onClick={() => setNuova(null)}>Annulla</button></div>
        </div>}
      </Card>

      <Card className="pa-gap" title="Chiedi alle norme" icon="sparkle">
        {!d.data.ai && <div className="alert warn"><span>Il modello AI non è attivo su questo server: la ricerca mostra i passi delle norme più vicini alla domanda, senza risposta scritta.</span></div>}
        <form onSubmit={chiedi} className="pa-chiedi">
          <textarea value={dom} onChange={(e) => setDom(e.target.value)} rows={3} placeholder="Scrivi la domanda con parole tue, per esempio: che cosa serve per accreditare un nuovo punto prelievo?" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) chiedi(e); }} />
          <button className="btn" disabled={busy || dom.trim().length < 8 || !conTesto.length}>{busy ? 'Cerco nelle norme…' : 'Chiedi'}</button>
        </form>
        <div className="pa-esempi">{ESEMPI.map((x) => <button key={x} type="button" className="chip-btn" disabled={busy} onClick={() => { setDom(x); chiedi(null, x); }}>{x}</button>)}</div>
        <p className="small muted">La ricerca lavora su {conTesto.length} test{conTesto.length === 1 ? 'o' : 'i'}: {conTesto.map((n) => n.titolo).join('; ')}. {d.data.avvertenza}</p>
        {busy && <Loading />}
        {ultima && <Risposta r={ultima} />}
      </Card>

      {daTogliere && <ConfirmModal title="Togli la norma dall'elenco" text={`"${daTogliere.titolo}" esce dall'elenco e il suo testo non sarà più usato nelle risposte. Il documento ufficiale resta dov'è.`} confirmText="Togli"
        onClose={() => setDaTogliere(null)} onConfirm={async () => { await api.del(`/norme/${daTogliere.id}`); toast('Norma tolta dall\'elenco'); d.reload(); }} />}
      {d.data.domande.filter((x) => x.id !== ultima?.id).length > 0 && <Card title="Domande recenti" icon="clock">
        {d.data.domande.filter((x) => x.id !== ultima?.id).map((x) => <Risposta key={x.id} r={x} />)}
      </Card>}
    </div>
  );
}
