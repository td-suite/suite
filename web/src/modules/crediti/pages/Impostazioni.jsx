// Impostazioni: modalità (Prova o Attiva), scala, calendario degli invii, prudenze, dati dei testi, modelli delle comunicazioni, casella,
// stato di posta, banca e modello AI, ultimi giri del motore, registro. Modificano solo CEO e CFO; gli altri leggono.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Loading, Empty, PageHead, Badge, Field, Modal, ErrorBox, Switch } from '../../../components/ui.jsx';
import { useApi, base } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAzione, api } from '../components.jsx';
import { eur, itDataOra, GIORNI, FASE } from '../format.js';

const NUM = [['giorni_avviso', 'Avviso di scadenza: giorni prima'], ['giorni_sollecito_1', '1° sollecito: giorni dopo la scadenza'], ['giorni_sollecito_2', '2° sollecito: giorni dopo la scadenza'], ['giorni_chiamata', 'Chiamata: giorni dopo la scadenza'], ['giorni_legale', 'Area legale: giorni dopo la scadenza'],
  ['giorni_piano_dopo_chiamata', 'Giorni lavorativi per un impegno dopo la chiamata'], ['giorni_termine_1', 'Termine dato nel 1° sollecito (giorni)'], ['giorni_termine_2', 'Termine dato nel 2° sollecito (giorni)']];
const PRUD = [['ore_banca_fresca', 'Movimenti bancari letti da non più di (ore)'], ['giorni_bonifici_dubbi', 'Bonifici non abbinati che fermano l\'invio: ultimi (giorni)'], ['tolleranza_promessa', 'Tolleranza sulla data promessa (giorni)'], ['giorni_attesa_pagato', '"Ho già pagato": attesa dell\'incasso (giorni lavorativi)'],
  ['soglia_minima', 'Scaduto minimo per sollecitare (€)'], ['soglia_dir', 'Pratica legale: soglia oltre la quale serve la Direzione (€)']];
const MODELLI = [[1, 'Avviso di scadenza'], [2, '1° sollecito'], [3, '2° sollecito'], [5, 'Messa in mora (bozza per l\'area legale)']];

function Attiva({ onClose, onFatto }) {
  const [a, setA] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api.post('/modalita', { modalita: 'ATTIVA' }).then(setA).catch(setErr); }, []);
  const go = async () => { setBusy(true); try { await api.post('/modalita', { modalita: 'ATTIVA', conferma: true }); await onFatto(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const ant = a?.anteprima; const el = (r) => r.map((x, i) => <li key={i}>{x.cliente}: {FASE[x.fase]} per {eur(x.totale)}{x.motivi?.length ? <span className="muted"> · {x.motivi.join(' · ')}</span> : ''}</li>);
  return (
    <Modal wide title="Passa alla modalità Attiva" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn danger" disabled={busy || !ant} onClick={go}>Attiva: da ora le comunicazioni partono</button></>}>
      <ErrorBox error={err} />
      {!a && !err && <Loading text="Calcolo di cosa partirebbe" />}
      {ant && <div>
        <p>Da questo momento, nei giorni e nelle ore di invio, avviso di scadenza e 1° sollecito partono da soli dalla casella dell'Amministrazione quando nessun controllo li ferma. Al prossimo giro di invio:</p>
        <p className="strong">{ant.invii.length} comunicazioni partirebbero da sole per {eur(ant.invii.reduce((s, x) => s + x.totale, 0))}</p>{ant.invii.length > 0 && <ul className="small">{el(ant.invii.slice(0, 40))}</ul>}
        <p className="strong">{ant.attese.length} resterebbero in attesa di una persona</p>{ant.attese.length > 0 && <ul className="small">{el(ant.attese.slice(0, 40))}</ul>}
        <p className="strong">{ant.firme.length} secondi solleciti da firmare · {ant.chiamate.length} chiamate da assegnare · {ant.pratiche.length} proposte all'area legale</p>
        {a.posta?.provider !== 'graph' && <div className="alert warn"><span>La posta della Suite non è attiva su questo server: nessuna email può partire davvero, le comunicazioni resteranno in attesa.</span></div>}
        {!a.banca?.ok && <div className="alert warn"><span>Incassi non verificabili ({a.banca?.motivo}): finché è così tutto resta in attesa di una persona.</span></div>}
      </div>}
    </Modal>
  );
}

export default function Impostazioni() {
  const d = useApi('/impostazioni'); const { state } = useAuth(); const az = useAzione(async () => { await d.reload(); await state.ricarica?.(); });
  const [v, setV] = useState(null); const [m, setM] = useState(null); const [prova, setProva] = useState(null);
  useEffect(() => { if (d.data) setV({ ...d.data.valori, ...Object.fromEntries(Object.keys(d.data.modelli).map((k) => [k, d.data.valori[k] || d.data.modelli[k]])) }); }, [d.data]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data || !v) return <div className="page"><Loading /></div>;
  const x = d.data; const ro = !x.modificabili; const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const salva = (chiavi) => az.fai(() => api.put('/impostazioni', Object.fromEntries(chiavi.map((k) => [k, ['iban', 'intestatario', 'firma_att', 'telefono_att', 'firma_raf_nome', 'firma_raf_ruolo', 'cc_fissi', 'termini_predefiniti', 'fatture_dal', 'casella', 'traccia_chiamata'].includes(k) || k.startsWith('modello_') ? v[k] : k === 'giorni_invio' || typeof v[k] === 'boolean' ? v[k] : v[k] === '' || v[k] == null ? null : Number(v[k])]))), (r) => (r.cambiate.length ? `Salvato: ${r.cambiate.length} ${r.cambiate.length === 1 ? 'valore' : 'valori'}` : 'Nessuna modifica'));
  const Salva = ({ chiavi }) => (ro ? null : <button className="btn sm" disabled={az.busy} onClick={() => salva(chiavi)}>Salva</button>);
  const attiva = x.valori.modalita === 'ATTIVA';
  return (
    <div className="page">
      <PageHead title="Impostazioni del Recupero Crediti" icon="gear" sub={ro ? 'Sola lettura: le impostazioni le modificano CEO e CFO.' : 'Ogni modifica resta nel registro con il tuo nome.'} />
      <div className={`cr-prova ${attiva ? 'cr-attiva' : ''}`}><div style={{ flex: 1 }}><strong>{attiva ? 'Modalità Attiva.' : 'Modalità Prova.'}</strong> {attiva ? 'Le comunicazioni partono davvero: avviso e 1° sollecito da soli, il 2° sollecito con la firma di CFO o CEO.' : 'Tutto viene preparato e mostrato, nessuna email parte e nessuna fase avanza. Usa la Prova per controllare fatture, scadenze, destinatari e testi.'}</div>
        {!ro && (attiva ? <button className="btn ghost" disabled={az.busy} onClick={() => az.fai(() => api.post('/modalita', { modalita: 'PROVA' }), 'Tornati in modalità Prova: nessuna comunicazione parte')}>Torna in Prova</button> : <button className="btn" onClick={() => setM('attiva')}>Passa ad Attiva</button>)}</div>

      <Card title="Stato dei collegamenti" icon="shield" className="cr-gap">
        <dl className="cr-kv">
          <dt>Posta in uscita</dt><dd>{x.posta.provider === 'graph' ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Non attiva su questo server</Badge>} <span className="small muted">mittente dei solleciti: {x.valori.casella}</span></dd>
          <dt>Casella delle risposte</dt><dd>{x.graph ? (x.casella_errore ? <><Badge tone="red">Errore di lettura</Badge> <span className="small">{x.casella_errore.messaggio}</span></> : <Badge tone="green">Collegata</Badge>) : <Badge tone="red">Credenziali Microsoft assenti</Badge>} {!ro && <button className="btn sm ghost" onClick={async () => { setProva({ carica: true }); try { setProva(await api.post('/casella/prova', {})); } catch (e) { setProva({ message: e.message, steps: [] }); } }}>Prova la casella</button>}</dd>
          <dt>Banca (Enable Banking)</dt><dd>{x.banca.ok ? <><Badge tone="green">Movimenti aggiornati</Badge> <span className="small muted">letti il {itDataOra(x.banca.ultimo)}</span></> : <><Badge tone="amber">Incassi non verificabili</Badge> <span className="small">{x.banca.motivo}</span></>} <Link to={`${base}/banca`}>Conti bancari</Link></dd>
          <dt>Lettura delle risposte</dt><dd>{x.ai ? <Badge tone="green">Modello AI attivo</Badge> : <Badge tone="grey">Parole chiave (modello AI non attivo)</Badge>} <span className="small muted">nel dubbio la risposta resta da leggere a una persona</span></dd>
        </dl>
        {prova && !prova.carica && <div className={`alert ${prova.ok ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}><div><strong>{prova.message}</strong><ul className="small" style={{ margin: '6px 0 0' }}>{(prova.steps || []).map((s, i) => <li key={i}>{s.ok ? 'OK' : 'NO'} · {s.step}: {s.detail}</li>)}</ul></div></div>}
      </Card>

      <div className="grid g2 cr-gap">
        <Card title="La scala" icon="tree" actions={<Salva chiavi={NUM.map((n) => n[0])} />}><div className="form-grid">{NUM.map(([k, l]) => <Field key={k} label={l}><input type="number" disabled={ro} value={v[k] ?? ''} onChange={set(k)} /></Field>)}</div><p className="small muted">Valori del memo: 7 giorni prima, poi +10, +25, +35, +60. Fra una fase e la successiva passa sempre la distanza prevista, contata da quando la precedente è davvero partita.</p></Card>
        <Card title="Quando partono gli invii" icon="calendar" actions={<Salva chiavi={['giorni_invio', 'ora_invio_da', 'ora_invio_a', 'fatture_dal', 'termini_predefiniti']} />}>
          <div className="cr-azioni" style={{ marginBottom: 10 }}>{[1, 2, 3, 4, 5, 6, 7].map((g) => <label key={g} className="chip-btn" style={{ cursor: ro ? 'default' : 'pointer' }}><input type="checkbox" disabled={ro} checked={v.giorni_invio.includes(g)} onChange={(e) => setV({ ...v, giorni_invio: e.target.checked ? [...v.giorni_invio, g].sort() : v.giorni_invio.filter((y) => y !== g) })} /> {GIORNI[g]}</label>)}</div>
          <div className="form-grid"><Field label="Dalle ore"><input type="number" disabled={ro} value={v.ora_invio_da} onChange={set('ora_invio_da')} /></Field><Field label="Alle ore"><input type="number" disabled={ro} value={v.ora_invio_a} onChange={set('ora_invio_a')} /></Field>
            <Field label="Fatture di Synclab dal" help="Le fatture precedenti non entrano nel widget."><input type="date" disabled={ro} value={v.fatture_dal || ''} onChange={set('fatture_dal')} /></Field>
            <Field label="Termini predefiniti" help="Usati quando il cliente non ha termini di pagamento: la scadenza così calcolata non fa partire un sollecito da solo."><input disabled={ro} value={v.termini_predefiniti || ''} onChange={set('termini_predefiniti')} /></Field></div>
        </Card>
      </div>

      <div className="grid g2 cr-gap">
        <Card title="Prudenze" icon="lock" actions={<Salva chiavi={[...PRUD.map((n) => n[0]), 'riconciliazione_automatica', 'risposta_automatica']} />}>
          <div className="form-grid">{PRUD.map(([k, l]) => <Field key={k} label={l}><input type="number" disabled={ro} value={v[k] ?? ''} onChange={set(k)} /></Field>)}</div>
          <label className="row" style={{ gap: 10, marginTop: 10 }}><Switch disabled={ro} checked={v.riconciliazione_automatica} onChange={(c) => setV({ ...v, riconciliazione_automatica: c })} label="Riconciliazione automatica" /><span className="small">Conferma da sola i bonifici con numero di fattura in causale e importo uguale al residuo. Tutti gli altri restano proposte.</span></label>
          <label className="row" style={{ gap: 10, marginTop: 10 }}><Switch disabled={ro} checked={v.risposta_automatica} onChange={(c) => setV({ ...v, risposta_automatica: c })} label="Conferma di ricezione" /><span className="small">Invia al cliente che risponde una conferma di ricezione (al più una al giorno per mittente).</span></label>
        </Card>
        <Card title="Dati che entrano nei testi" icon="edit" actions={<Salva chiavi={['iban', 'intestatario', 'firma_att', 'telefono_att', 'firma_raf_nome', 'firma_raf_ruolo', 'cc_fissi', 'casella']} />}>
          <div className="form-grid">
            <Field label="IBAN per i pagamenti" required><input disabled={ro} value={v.iban || ''} onChange={set('iban')} /></Field><Field label="Intestatario"><input disabled={ro} value={v.intestatario || ''} onChange={set('intestatario')} /></Field>
            <Field label="Firma dell'Amministrazione"><input disabled={ro} value={v.firma_att || ''} onChange={set('firma_att')} /></Field><Field label="Telefono dell'Amministrazione" required><input disabled={ro} value={v.telefono_att || ''} onChange={set('telefono_att')} /></Field>
            <Field label="Responsabile Amministrazione e Finanza (firma del 2° sollecito)" required><input disabled={ro} value={v.firma_raf_nome || ''} onChange={set('firma_raf_nome')} /></Field><Field label="Qualifica"><input disabled={ro} value={v.firma_raf_ruolo || ''} onChange={set('firma_raf_ruolo')} /></Field>
            <Field label="Sempre in copia" help="Indirizzi separati da virgola."><input disabled={ro} value={v.cc_fissi || ''} onChange={set('cc_fissi')} /></Field>
            <Field label="Casella mittente e delle risposte" help={x.casella_env ? 'Fissata dalla variabile CREDITI_MAILBOX del server.' : undefined}><input disabled={ro || x.casella_env} value={v.casella || ''} onChange={set('casella')} /></Field>
          </div>
          <p className="small muted">Senza IBAN, telefono e nome del Responsabile i testi restano incompleti: una comunicazione incompleta non parte mai da sola.</p>
        </Card>
      </div>

      <Card title="Testi delle comunicazioni" icon="mail" className="cr-gap cr-modello">
        <p className="small muted">Segnaposto fra parentesi quadre: [referente], [numero], [data], [data scadenza], [importo], [tabella fatture], [iban], [codice cliente], [entro], [firma], [telefono], [email], [firma raf], [ruolo raf], [data 1° sollecito], [data 2° sollecito], [data chiamata], [ragione sociale], [totale].</p>
        {MODELLI.map(([n, l]) => <details key={n} style={{ marginBottom: 10 }}><summary className="strong">{l}</summary>
          <div className="form-grid" style={{ marginTop: 8 }}><Field label="Oggetto" className="span2"><input disabled={ro} value={v[`modello_${n}_oggetto`] || ''} onChange={set(`modello_${n}_oggetto`)} /></Field><Field label="Testo" className="span2"><textarea disabled={ro} value={v[`modello_${n}_testo`] || ''} onChange={set(`modello_${n}_testo`)} /></Field></div>
          {!ro && <div className="cr-azioni"><button className="btn sm" disabled={az.busy} onClick={() => salva([`modello_${n}_oggetto`, `modello_${n}_testo`])}>Salva questo testo</button><button className="btn sm ghost" onClick={() => setV({ ...v, [`modello_${n}_oggetto`]: x.modelli[`modello_${n}_oggetto`], [`modello_${n}_testo`]: x.modelli[`modello_${n}_testo`] })}>Ripristina il testo del memo</button></div>}</details>)}
        <details><summary className="strong">Traccia della chiamata del referente commerciale</summary><div className="form-grid" style={{ marginTop: 8 }}><Field label="Traccia" className="span2"><textarea disabled={ro} value={v.traccia_chiamata || ''} onChange={set('traccia_chiamata')} /></Field></div>{!ro && <button className="btn sm" disabled={az.busy} onClick={() => salva(['traccia_chiamata'])}>Salva la traccia</button>}</details>
      </Card>

      <div className="grid g2">
        <Card title="Ultimi giri del motore" icon="clock" flush>{x.giri.length ? <table className="t"><tbody>{x.giri.map((g, i) => <tr key={i}><td className="small nowrap">{itDataOra(g.at)}</td><td className="small">{g.modalita === 'ATTIVA' ? 'Attiva' : 'Prova'}{g.esito.scala ? '' : ' · fuori calendario'} · {g.esito.inviate} inviate · {g.esito.in_attesa} in attesa · {g.esito.simulate} simulate{g.esito.banca?.automatici ? ` · ${g.esito.banca.automatici} incassi riconosciuti` : ''}{g.esito.fallite ? ` · ${g.esito.fallite} fallite` : ''}</td></tr>)}</tbody></table> : <Empty compact icon="clock">Nessun giro eseguito</Empty>}</Card>
        <Card title="Registro delle operazioni" icon="shield" flush>{x.registro.length ? <table className="t"><tbody>{x.registro.map((r, i) => <tr key={i}><td className="small nowrap">{itDataOra(r.at)}</td><td className="small">{r.label}<div className="muted">{r.utente || 'automatico'}</div></td></tr>)}</tbody></table> : <Empty compact icon="shield">Nessuna operazione</Empty>}</Card>
      </div>
      {m === 'attiva' && <Attiva onClose={() => setM(null)} onFatto={async () => { await d.reload(); await state.ricarica?.(); }} />}
    </div>
  );
}
