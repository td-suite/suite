import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, isOwner } from '../../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, Modal, Field, PageHead, useToast } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime } from '../../format.js';

// Amministrazione > Diagnostica anagrafica (correzione A13 del programma "anagrafica unica", 08/11/2026): tutti i controlli D01-D40 sulle
// anagrafiche di sedi, Legal entity e persone, con conteggi, prime righe, "Correggi" con conferma (chiama le funzioni del core e scrive
// l'audit DIAGNOSTICA_CORREZIONE), esportazione CSV del rapporto. In fondo le operazioni "Sedi SERVICE dei clienti" (A7, blocco 2: Prova
// ed Esegui) e "Contratti SEDE del Business Hub" (A3): Prova (rapporto delle differenze) ed Esegui (solo titolare).
const TONO = { OK: 'green', BLOCCANTE: 'red', ATTENZIONE: 'amber', INFO: 'blue', DOPO: 'grey', NON_AVVIATO: 'grey', ERRORE: 'red' };
const STATO = { OK: 'verde', BLOCCANTE: 'bloccante', ATTENZIONE: 'attenzione', INFO: 'informativo', DOPO: 'più avanti', NON_AVVIATO: 'modulo non avviato', ERRORE: 'errore' };
const valore = (v) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function Diagnostica() {
  const { data, error, loading, reload } = useApi('/admin/diagnostica');
  const [area, setArea] = useState('');
  const [aperti, setAperti] = useState({});
  const [corr, setCorr] = useState(null);
  const [salvo, setSalvo] = useState(false);
  const toast = useToast();
  const ris = data?.risultati || [];
  const perArea = useMemo(() => Object.entries(data?.aree || {}).map(([k, nome]) => {
    const r = ris.filter((x) => x.area === k);
    return { k, nome, bloccanti: r.filter((x) => x.stato === 'BLOCCANTE').length, attenzione: r.filter((x) => x.stato === 'ATTENZIONE').length, ok: r.filter((x) => x.stato === 'OK').length, tot: r.length };
  }), [data]);
  const visibili = ris.filter((x) => !area || x.area === area);
  const salva = async () => { setSalvo(true); try { const r = await api.post('/admin/diagnostica/salva'); toast(`Esito salvato: ${r.riepilogo.bloccanti} controlli bloccanti${r.cresciuti.length ? `, ${r.cresciuti.length} in aumento` : ''}`); reload(); } catch (e) { toast(e.message, 'err'); } finally { setSalvo(false); } };
  return (
    <div className="page">
      <PageHead title="Diagnostica anagrafica" icon="shield" sub="Controlli D01-D40 su sedi, Legal entity, organigramma e flussi che li toccano. I dati di produzione si correggono da qui (Correggi, con conferma) o nella scheda indicata, mai con SQL a mano."
        actions={<div className="row" style={{ gap: 6 }}>
          <a className="btn ghost" href="/api/admin/diagnostica/export.csv" download><Icon name="download" />Esporta CSV</a>
          <button className="btn ghost" disabled={salvo} onClick={salva}><Icon name="check" />Salva l'esito</button>
          <button className="btn" onClick={reload}><Icon name="refresh" />Riesegui</button>
        </div>} />
      <ErrorBox error={error} />
      {loading && !data && <Card><Skeleton lines={6} /></Card>}
      {data && <>
        <div className="grid g4 mb2">
          {perArea.map((a) => (
            <button key={a.k} type="button" className={`card kpi ${area === a.k ? 'active' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', border: area === a.k ? '2px solid var(--teal)' : undefined }} onClick={() => setArea(area === a.k ? '' : a.k)}>
              <div className="lbl">{a.nome}</div>
              <div className="val" style={{ color: a.bloccanti ? 'var(--red)' : a.attenzione ? 'var(--amber)' : 'var(--green)' }}>{a.bloccanti + a.attenzione}</div>
              <div className="foot">{a.bloccanti} bloccanti · {a.attenzione} attenzione · {a.ok} verdi su {a.tot}</div>
            </button>
          ))}
        </div>
        <div className="small muted mb2">Eseguita {fmtDateTime(data.at)} · {data.riepilogo.bloccanti} bloccanti, {data.riepilogo.attenzione} attenzione, {data.riepilogo.info} informativi, {data.riepilogo.ok} verdi, {data.riepilogo.altri} non eseguibili ora{data.ultimo_salvato ? ` · ultimo esito salvato ${fmtDateTime(data.ultimo_salvato.at)}` : ''}</div>
        <Card flush>
          <div className="table-wrap"><table className="t" data-testid="diagnostica">
            <thead><tr><th style={{ width: 70 }}>Controllo</th><th>Titolo</th><th>Stato</th><th className="num">Righe</th><th>Correzione</th></tr></thead>
            <tbody>{visibili.map((k) => (
              <React.Fragment key={k.id}>
                <tr className={k.righe.length ? 'click' : ''} onClick={() => k.righe.length && setAperti({ ...aperti, [k.id]: !aperti[k.id] })}>
                  <td className="mono strong">{k.id}</td>
                  <td><div className="strong">{k.titolo}</div><div className="small muted">{k.spiegazione}</div>{k.nota && <div className="small amber">{k.nota}</div>}</td>
                  <td><Badge tone={TONO[k.stato]}>{STATO[k.stato] || k.stato}</Badge><div className="small muted">{k.gravita.toLowerCase()}</div></td>
                  <td className="num">{k.n ?? '–'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {k.correggi && k.n > 0 && <button className="btn sm" onClick={() => setCorr({ k, ids: k.righe.map((r) => r[k.chiave]), azione: k.correggi.azioni?.[0] || null })}>{k.correggi.etichetta}</button>}
                    {!k.correggi && k.correggi_dopo && k.n > 0 && <span className="small muted">correzione dopo {k.correggi_dopo}</span>}
                    {k.n > 0 && <a className="small" style={{ marginLeft: 8 }} href={`/api/admin/diagnostica/${k.id}/export.csv`} download>CSV</a>}
                  </td>
                </tr>
                {aperti[k.id] && <tr><td colSpan={5} style={{ background: 'var(--teal-050)' }}><Righe k={k} onCorreggi={(ids, azione) => setCorr({ k, ids, azione })} /></td></tr>}
              </React.Fragment>
            ))}</tbody>
          </table></div>
        </Card>
        <SediService onDone={reload} />
        <ContrattiSede onDone={reload} />
      </>}
      {corr && <CorreggiModal corr={corr} onClose={() => setCorr(null)} onDone={(out) => { setCorr(null); toast(`${out.controllo}: ${out.prima.n} → ${out.dopo.n} righe`); reload(); }} />}
    </div>
  );
}

function Righe({ k, onCorreggi }) {
  const cols = Object.keys(k.righe[0] || {}).filter((c) => c !== '__link');
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t small">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}<th /></tr></thead>
        <tbody>{k.righe.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => <td key={c} className={/id$|code|codice/.test(c) ? 'mono' : ''}>{valore(r[c])}</td>)}
            <td style={{ whiteSpace: 'nowrap' }}>
              {r.__link && (r.__link.startsWith('/business') || r.__link.startsWith('/retail') ? <a href={r.__link}>Apri</a> : <Link to={r.__link}>{r.__link.includes('unisci=') ? 'Unisci' : 'Apri'}</Link>)}
              {k.correggi && !k.correggi.tutte && (k.correggi.azioni ? k.correggi.azioni : [null]).map((a) => (
                <button key={a || 'x'} className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => onCorreggi([r[k.chiave]], a)}>{a === 'crea_sede' ? 'Crea la sede dal nodo' : a === 'elimina_nodo' ? 'Elimina il nodo' : a === 'collega' ? 'Collega' : 'Correggi'}</button>
              ))}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {k.n > k.righe.length && <div className="small muted" style={{ padding: 6 }}>Prime {k.righe.length} righe su {k.n}: l'elenco completo nel CSV.</div>}
    </div>
  );
}

function CorreggiModal({ corr, onClose, onDone }) {
  const { k, ids, azione } = corr;
  const { user } = useAuth();
  const riga = k.righe.find((r) => String(r[k.chiave]) === String(ids[0])) || {};
  const [sede, setSede] = useState({ code: '', name: riga.name || '', kind: 'PUNTO_PRELIEVI', city: '' });
  const [admin, setAdmin] = useState(false);
  const [testo, setTesto] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const serveConferma = k.correggi.conferma;
  const etichetta = azione === 'crea_sede' ? 'Crea la sede dal nodo' : azione === 'elimina_nodo' ? 'Elimina il nodo' : k.correggi.etichetta;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const opzioni = { ...(azione ? { azione } : {}), ...(azione === 'crea_sede' ? { sede } : {}), ...(admin ? { includi_admin: true } : {}) };
      const r = await api.post(`/admin/diagnostica/${k.id}/correggi`, { ids, conferma: 'CORREGGI', opzioni });
      setOut(r);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${k.id} · ${etichetta}`} onClose={onClose} wide footer={out ? <button className="btn" onClick={() => onDone(out)}>Chiudi</button> : <><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || (serveConferma && testo !== 'CORREGGI') || (azione === 'crea_sede' && sede.code.trim().length < 2)} onClick={go}>{busy ? 'Correzione…' : etichetta}</button></>}>
      <ErrorBox error={err} />
      {!out ? <>
        <p><b>Cosa cambia:</b> {azione === 'crea_sede' ? 'nuova sede in Amministrazione > Sedi (con saveSite: audit, organigramma, Cash) collegata a questo nodo.' : azione === 'elimina_nodo' ? 'il nodo si elimina: unità dipendenti e persone passano all\'unità superiore, gli incarichi del nodo spariscono.' : k.correggi.descrizione}.</p>
        <p className="small muted">{k.correggi.tutte ? 'La correzione riguarda tutto il controllo.' : `Righe interessate: ${ids.length}${ids.length <= 10 ? ` (${ids.join(', ')})` : ''}.`} L'operazione rilegge le righe ancora anomale, chiama le funzioni del core e scrive l'audit con prima e dopo.</p>
        {azione === 'crea_sede' && <div className="form-grid">
          <Field label="Codice della sede" required><input value={sede.code} onChange={(e) => setSede({ ...sede, code: e.target.value.toUpperCase() })} placeholder="es. PP-EMP" /></Field>
          <Field label="Nome"><input value={sede.name} onChange={(e) => setSede({ ...sede, name: e.target.value })} /></Field>
          <Field label="Tipo"><select value={sede.kind} onChange={(e) => setSede({ ...sede, kind: e.target.value })}>{['PUNTO_PRELIEVI', 'LABORATORIO', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'HEADQUARTER', 'ALTRO'].map((x) => <option key={x} value={x}>{x.replace('_', ' ').toLowerCase()}</option>)}</select></Field>
          <Field label="Città"><input value={sede.city} onChange={(e) => setSede({ ...sede, city: e.target.value })} /></Field>
        </div>}
        {k.correggi.opzione_admin && (user.level === 'OWNER' || user.level === 'ADMIN') && <label className="row small" style={{ gap: 6, margin: '8px 0' }}><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />Includi gli accessi da amministratore (conferma esplicita)</label>}
        {serveConferma && <Field label='Per confermare scrivi CORREGGI'><input value={testo} onChange={(e) => setTesto(e.target.value)} aria-label="Conferma" /></Field>}
      </> : <>
        <p><b>Fatto.</b> Righe prima: {out.prima.n}, dopo: {out.dopo.n} ({STATO[out.dopo.stato] || out.dopo.stato}).</p>
        <ul className="small">{(out.esito || []).map((e, i) => <li key={i}>{e.id != null ? <span className="mono">#{e.id} </span> : null}{e.esito}{e.motivo ? <span className="amber"> · {e.motivo}</span> : null}</li>)}</ul>
      </>}
    </Modal>
  );
}

// ---- A7 (blocco 2): "Crea le sedi SERVICE mancanti" (richiesta del CEO dell'08/11/2026). Prova: rapporto senza scritture. Esegui
// (amministratori, con conferma): una sede SERVICE con l'indirizzo della Legal entity per ogni cliente attivo o contrattualizzato che
// non ne ha, una per ogni struttura del gruppo attivata. Idempotente: ripetuta non crea doppioni.
function SediService({ onDone }) {
  const toast = useToast();
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [conferma, setConferma] = useState(false);
  const [testo, setTesto] = useState('');
  const prova = async () => { setBusy('prova'); setErr(null); try { setRep(await api.get('/admin/migrazioni/sedi-service')); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const esegui = async () => { setBusy('esegui'); setErr(null); try { const r = await api.post('/admin/migrazioni/sedi-service', { conferma: 'ESEGUI' }); setRep(r); setConferma(false); setTesto(''); toast(`Sedi SERVICE create: ${r.creati}${r.errori ? `, errori ${r.errori}` : ''}`); onDone?.(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const daCreare = (rep?.piano || []).filter((p) => p.esito === 'da creare').length;
  return (
    <Card title="Sedi SERVICE dei clienti (crea quelle mancanti)" icon="building" className="mt" actions={<div className="row" style={{ gap: 6 }}>
      <button className="btn sm ghost" disabled={Boolean(busy)} onClick={prova}>{busy === 'prova' ? 'Prova…' : 'Prova'}</button>
      <button className="btn sm" disabled={Boolean(busy) || !rep || rep.esegui || !daCreare} onClick={() => setConferma(true)}>Esegui</button>
    </div>}>
      <p className="small muted" style={{ marginTop: 0 }}>Ogni cliente Service o Medicina del Lavoro attivo o contrattualizzato ha la sua sede SERVICE in Amministrazione &gt; Sedi (Ordini, Non conformità, Retail e Portale la usano). Una Legal entity senza sede ha una sede sola, la sua: nasce con l'indirizzo della Legal entity, che segue anche quando cambia. Le strutture del gruppo dell'account diventano sedi solo se attivate (fase 6 o 7 nel DB Opportunità, o punto del contratto firmato). Il codice StudioLAB si inserisce poi nella scheda account.</p>
      <ErrorBox error={err} />
      {rep && !rep.pronto && <Empty compact>Business Hub non avviato: nessun cliente da esaminare.</Empty>}
      {rep?.pronto && <>
        <div className="small" style={{ marginBottom: 6 }}>{rep.esegui ? <>Eseguito: <b>{rep.creati}</b> sedi create{rep.errori ? <>, <span className="red">{rep.errori} errori</span></> : null}.</> : <>Da creare: <b>{daCreare}</b>.</>} Strutture del gruppo in attesa di attivazione: {rep.strutture_in_attesa.length}.</div>
        {rep.piano.length ? <div className="table-wrap"><table className="t small" data-testid="sedi-service-piano"><thead><tr><th>Legal entity</th><th>Sede</th><th>Indirizzo</th><th>Perché</th><th>Esito</th></tr></thead>
          <tbody>{rep.piano.map((p, i) => <tr key={i}><td className="strong">{p.org_name}</td><td>{p.tipo === 'STRUTTURA' ? `Struttura: ${p.nome}` : 'Sede della Legal entity'}{p.code ? <div className="mono tiny">{p.code}</div> : null}</td><td>{p.indirizzo || <span className="amber">indirizzo mancante</span>}</td><td className="muted">{p.motivo}</td>
            <td><Badge tone={p.esito === 'creata' ? 'green' : p.esito === 'errore' ? 'red' : p.esito === 'esistente' ? 'grey' : 'teal'}>{p.esito}</Badge>{p.avvisi?.length ? <div className="tiny amber">{p.avvisi.join(' · ')}</div> : null}</td></tr>)}</tbody></table></div>
          : <div className="alert info small">Tutti i clienti attivi e contrattualizzati hanno la loro sede SERVICE.</div>}
      </>}
      {conferma && <Modal title="Creare le sedi SERVICE mancanti" onClose={() => setConferma(false)} footer={<><button className="btn ghost" onClick={() => setConferma(false)}>Annulla</button><button className="btn" disabled={testo !== 'ESEGUI' || Boolean(busy)} onClick={esegui}>{busy === 'esegui' ? 'Esecuzione…' : 'Esegui'}</button></>}>
        <p>{daCreare} sedi SERVICE nuove in Amministrazione &gt; Sedi, con saveSite (audit SITE_CREATED, perimetri degli accessi esterni del cliente riallineati). Nessuna sede esistente viene modificata.</p>
        <Field label="Per confermare scrivi ESEGUI"><input value={testo} onChange={(e) => setTesto(e.target.value)} aria-label="Conferma creazione sedi" /></Field>
      </Modal>}
    </Card>
  );
}

// ---- A3: operazione una tantum sui contratti SEDE del Business Hub
function ContrattiSede({ onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [conferma, setConferma] = useState(false);
  const [testo, setTesto] = useState('');
  const [esito, setEsito] = useState(null);
  const prova = async () => { setBusy('prova'); setErr(null); try { setRep(await api.get('/admin/migrazioni/sede-business')); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const esegui = async () => { setBusy('esegui'); setErr(null); try { const r = await api.post('/admin/migrazioni/sede-business', { conferma: 'ESEGUI' }); setEsito(r); setConferma(false); toast(`Contratti SEDE migrati: ${r.eseguiti.filter((x) => x.esito === 'migrato').length}`); onDone?.(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  return (
    <Card title="Contratti SEDE del Business Hub (operazione una tantum)" icon="folder" className="mt" actions={<div className="row" style={{ gap: 6 }}>
      <button className="btn sm ghost" disabled={Boolean(busy)} onClick={prova}>{busy === 'prova' ? 'Prova…' : 'Prova'}</button>
      {isOwner(user) && <button className="btn sm danger" disabled={Boolean(busy) || !rep?.contratti?.length} onClick={() => setConferma(true)}>Esegui</button>}
    </div>}>
      <p className="small muted" style={{ marginTop: 0 }}>Il contratto di locazione delle sedi TD sta in Amministrazione, Sedi. Prova: rapporto delle differenze senza scrivere nulla. Esegui (titolare): stacca i fascicoli di autorizzazione e li conserva, porta i PDF nella sede riusando i file, riempie solo i campi vuoti della locazione (dove c'è differenza vale Sedi), registra tutto nell'audit, cancella i contratti SEDE. Nel Business Hub resta la vista "Sedi TD in locazione" in sola lettura.</p>
      <ErrorBox error={err} />
      {rep && !rep.pronto && <Empty compact>Business Hub non avviato: nessun contratto SEDE.</Empty>}
      {rep?.pronto && !rep.contratti.length && <div className="alert info small">Nessun contratto SEDE nel Business Hub.{rep.vincoli?.length ? ` Vincoli: ${rep.vincoli.map((v) => `${v.conname} ${v.def}`).join('; ')}` : ''}</div>}
      {rep?.contratti?.map((c) => (
        <div key={c.id} className="card" style={{ marginTop: 10 }}>
          <div className="row between"><div><span className="strong">{c.protocol || `#${c.id}`}</span> · {c.title} <Badge tone="grey">{c.status}</Badge></div><div className="small">{c.site ? <>Sede <span className="mono">{c.site.code}</span> {c.site.name} ({String(c.site.tenure).toLowerCase()})</> : <span className="red">{c.bloccato}</span>}</div></div>
          <table className="t small" style={{ marginTop: 6 }}><thead><tr><th>Campo</th><th>Business</th><th>Sedi</th><th>Azione</th></tr></thead>
            <tbody>{c.confronto.map((x) => <tr key={x.campo}><td>{x.label}</td><td>{valore(x.business)}</td><td>{valore(x.sedi)}</td><td><Badge tone={x.azione === 'riempi' ? 'teal' : x.azione.startsWith('diverso') ? 'amber' : 'grey'}>{x.azione}</Badge></td></tr>)}</tbody></table>
          <div className="small" style={{ marginTop: 6 }}><b>File:</b> {c.file.length ? c.file.map((f) => `${f.filename} (${f.category} → ${f.kind || 'saltato'}${f.motivo ? `: ${f.motivo}` : ''})`).join('; ') : 'nessuno'}</div>
          <div className="small"><b>Fascicoli:</b> {c.fascicoli.length ? c.fascicoli.map((d) => `#${d.id} ${d.status} con ${d.file} file: staccato e conservato`).join('; ') : 'nessuno'}{c.note_accodate ? <> · <b>Note accodate:</b> {c.note_accodate}</> : null}</div>
        </div>
      ))}
      {esito && <div className="alert info small" style={{ marginTop: 10 }}>Eseguito: {esito.eseguiti.map((x) => `${x.protocol || `#${x.id}`} ${x.esito}`).join('; ')}. Verifiche: contratti SEDE rimasti {esito.verifiche.contratti_sede}, fascicoli senza sede né Legal entity {esito.verifiche.fascicoli_senza_sede_ne_legal_entity}, contratti firmati in Sedi {esito.verifiche.firmati_in_sedi} su {esito.verifiche.firmati_attesi}.</div>}
      {conferma && <Modal title="Eliminare i contratti SEDE dal Business Hub" onClose={() => setConferma(false)} footer={<><button className="btn ghost" onClick={() => setConferma(false)}>Annulla</button><button className="btn danger" disabled={testo !== 'ESEGUI' || Boolean(busy)} onClick={esegui}>{busy === 'esegui' ? 'Esecuzione…' : 'Esegui'}</button></>}>
        <p>{rep.contratti.length} contratti SEDE: i fascicoli restano (staccati), i PDF vanno in Sedi, i campi vuoti della locazione si riempiono, poi i contratti si cancellano. L'operazione è registrata nell'audit con il contenuto completo dei contratti.</p>
        <Field label="Per confermare scrivi ESEGUI"><input value={testo} onChange={(e) => setTesto(e.target.value)} aria-label="Conferma esecuzione" /></Field>
      </Modal>}
    </Card>
  );
}
