// Guida GIPO · editor di una sezione (ADMIN): markdown con anteprima affiancata, percorso in GIPO, parole chiave, stato VALIDATA /
// DA_VALIDARE (la validazione chiede chi ha verificato), storico delle revisioni con ripristino, ripristino dalla versione del seme.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, ConfirmModal, ErrorBox, Field, Modal, PageHead, PromptModal, Skeleton, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, useApi } from '../api.js';
import { BackEndBadge, Bollino, FONTE as FONTI_SEZIONE, TestoGuida, itDataOra } from '../components.jsx';

const FONTE = { MANUALE: 'modifica', SEME: 'nuovo rilascio', RIPRISTINO: 'ripristino', STATO: 'cambio di stato' };

export default function Editor() {
  const { id } = useParams();
  const toast = useToast();
  const s = useApi(`/redazione/sezioni/${id}`, [id]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [valida, setValida] = useState(false);
  const [semeOk, setSemeOk] = useState(false);
  const [rev, setRev] = useState(null);
  const [mascherati, setMascherati] = useState([]);
  useEffect(() => { if (s.data) setF({ titolo: s.data.titolo, corpo: s.data.corpo, percorso_gipo: s.data.percorso_gipo || '', parole_chiave: s.data.parole_chiave || '', nota: '',
    fonte: s.data.fonte || 'INTERFACCIA', livello: s.data.livello || 'OPERATIVO', sintesi: s.data.sintesi || '' }); }, [s.data]);
  // controllo dei dati personali nel testo (stesso filtro delle domande), mentre si scrive
  useEffect(() => {
    if (!f?.corpo) return undefined;
    const h = setTimeout(() => api.post('/redazione/controlla-testo', { testo: f.corpo }, { silent: true }).then((r) => setMascherati(r.mascherati)).catch(() => {}), 700);
    return () => clearTimeout(h);
  }, [f?.corpo]);
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!s.data || !f) return <div className="page"><Skeleton lines={12} /></div>;
  const x = s.data;
  const cambiato = f.titolo !== x.titolo || f.corpo !== x.corpo || (f.percorso_gipo || '') !== (x.percorso_gipo || '') || (f.parole_chiave || '') !== (x.parole_chiave || '')
    || f.fonte !== (x.fonte || 'INTERFACCIA') || f.livello !== (x.livello || 'OPERATIVO') || (f.sintesi || '') !== (x.sintesi || '');
  const salva = async () => {
    setBusy(true); setErr(null);
    try { await api.put(`/redazione/sezioni/${x.id}`, { titolo: f.titolo, corpo: f.corpo, percorso_gipo: f.percorso_gipo || null, parole_chiave: f.parole_chiave || null, nota: f.nota || null,
      fonte: f.fonte, livello: f.livello, sintesi: f.sintesi || null }); toast('Sezione salvata: la versione precedente è nello storico'); s.reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const stato = async (nuovo, nota) => { await api.post(`/redazione/sezioni/${x.id}/stato`, { stato: nuovo, nota: nota || null }); toast(nuovo === 'VALIDATA' ? 'Sezione validata' : 'Sezione riportata a da validare'); s.reload(); };
  return (
    <div className="page gg-page gg-editor">
      <PageHead crumb={<><Link to={`${base}/redazione?scheda=sezioni`}>Redazione</Link> / Sezioni</>} title={`${x.numero || x.capitolo} ${x.titolo}`} icon="edit"
        sub={<>Aggiornata il {itDataOra(x.aggiornata_il)}{x.aggiornata_da_nome ? ` da ${x.aggiornata_da_nome}` : ' (seme)'} · <Link to={`${base}/guida/${x.slug}`}>vedi nella guida</Link></>}
        actions={<>
          <Bollino stato={x.stato} fonteValidazione={x.fonte_validazione} />
          <BackEndBadge livello={x.livello} />
          {x.stato === 'VALIDATA'
            ? <button className="btn ghost" onClick={() => stato('DA_VALIDARE').catch((e) => setErr(e))}><Icon name="refresh" />Torna da validare</button>
            : <button className="btn ghost" onClick={() => setValida(true)} disabled={cambiato} title={cambiato ? 'Salva prima le modifiche' : ''}><Icon name="check" />Segna come validata</button>}
          <button className="btn" onClick={salva} disabled={busy || !cambiato}><Icon name="check" />Salva</button>
        </>} />
      <ErrorBox error={err} />
      {x.seme_diverso && <div className="alert info"><Icon name="info" /><span>Il seme del rilascio corrente ha una versione diversa di questa sezione, non applicata perché la sezione è stata modificata a mano o validata. <button type="button" className="gg-link" onClick={() => setSemeOk(true)}>Ripristina dal seme</button></span></div>}
      {mascherati.length > 0 && <div className="alert warn"><Icon name="shield" /><span>Il testo contiene dati che sembrano personali ({mascherati.join(', ')}): la guida non deve contenere dati di pazienti.</span></div>}
      <div className="gg-due">
        <Field label="Titolo"><input value={f.titolo} maxLength={160} onChange={(e) => setF({ ...f, titolo: e.target.value })} /></Field>
        <Field label="Percorso in GIPO" help="Es. /Fatture/Index. Le pagine di consultazione hanno il link 'Apri in GIPO'; le pagine /Create no."><input value={f.percorso_gipo} onChange={(e) => setF({ ...f, percorso_gipo: e.target.value })} /></Field>
      </div>
      <Field label="Parole chiave" help="Separate da virgole: aiutano la ricerca (sinonimi, modi di dire del personale)."><input value={f.parole_chiave} onChange={(e) => setF({ ...f, parole_chiave: e.target.value })} /></Field>
      <Field label="Sintesi" help="Una riga che riassume la sezione: è ciò che l'assistente legge nell'indice per scegliere le sezioni con cui rispondere."><input value={f.sintesi} maxLength={400} onChange={(e) => setF({ ...f, sintesi: e.target.value })} /></Field>
      <div className="gg-due">
        <Field label="Fonte"><select value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })}>{Object.entries(FONTI_SEZIONE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Livello" help="Back-end: procedura per chi configura GIPO (filtro 'Per chi configura GIPO')."><select value={f.livello} onChange={(e) => setF({ ...f, livello: e.target.value })}><option value="OPERATIVO">Operativo</option><option value="BACK_END">Back-end (configurazione)</option></select></Field>
      </div>
      <div className="gg-editor-griglia">
        <Card title="Testo (markdown)" icon="edit">
          <textarea className="gg-editor-testo" value={f.corpo} onChange={(e) => setF({ ...f, corpo: e.target.value })} spellCheck />
          <div className="small muted">### titolo · 1. passo · - elenco · **grassetto** · &gt; attenzione · [testo](sezione:slug) per collegare un'altra sezione</div>
        </Card>
        <Card title="Anteprima" icon="eye" className="gg-editor-anteprima"><TestoGuida source={f.corpo} /></Card>
      </div>
      <Field label="Nota della modifica (facoltativa, nello storico)"><input value={f.nota} maxLength={500} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Es. corretto il passo 3 dopo la verifica con l'accettazione di Livorno" /></Field>
      <Card title={`Storico delle revisioni (${x.revisioni.length})`} icon="clock">
        {!x.revisioni.length && <div className="muted small">Nessuna revisione: la sezione è com'era nel seme.</div>}
        <ul className="gg-revisioni">
          {x.revisioni.map((r) => (
            <li key={r.id}>
              <span className="small">{itDataOra(r.creata_il)}</span>
              <Badge tone="grey">{FONTE[r.fonte] || r.fonte}</Badge>
              <span className="small">{r.autore_nome || 'sistema'}</span>
              <span className="small muted">versione precedente: {r.stato === 'VALIDATA' ? 'validata' : 'da validare'}{r.nota ? ` · ${r.nota}` : ''}</span>
              <button type="button" className="btn sm ghost" onClick={async () => { try { setRev(await api.get(`/redazione/revisioni/${r.id}`)); } catch (e) { setErr(e); } }}><Icon name="eye" />Vedi</button>
            </li>
          ))}
        </ul>
      </Card>
      {valida && <PromptModal title="Segna la sezione come validata" label="Chi ha verificato la procedura in GIPO, e come" placeholder="Es. verificata in GIPO con la responsabile accettazione di ..." type="textarea" minLength={3}
        help="La sezione mostrerà il bollino verde 'validata'. Se poi qualcuno la modifica resta validata: riportala a 'da validare' se cambia la procedura."
        onClose={() => setValida(false)} onConfirm={(nota) => stato('VALIDATA', nota)} />}
      {semeOk && <ConfirmModal title="Ripristina dal seme" text="Il testo attuale va nello storico e la sezione torna alla versione del seme del rilascio corrente, con lo stato del seme ('validata' solo per le procedure del manuale TD, altrimenti 'da validare')." confirmText="Ripristina"
        onClose={() => setSemeOk(false)} onConfirm={async () => { await api.post(`/redazione/sezioni/${x.id}/ripristina-seme`); s.reload(); }} />}
      {rev && (
        <Modal title={`Revisione del ${itDataOra(rev.creata_il)}`} onClose={() => setRev(null)} wide
          footer={<><button className="btn ghost" onClick={() => setRev(null)}>Chiudi</button><button className="btn" onClick={async () => { try { await api.post(`/redazione/revisioni/${rev.id}/ripristina`); setRev(null); toast('Revisione ripristinata'); s.reload(); } catch (e) { setErr(e); } }}><Icon name="refresh" />Ripristina questa versione</button></>}>
          <h3>{rev.titolo}</h3>
          <TestoGuida source={rev.corpo} />
        </Modal>
      )}
    </div>
  );
}
