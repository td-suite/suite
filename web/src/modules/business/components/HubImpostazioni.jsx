// Business Hub · Impostazioni: caselle di linea (indirizzo, lettura, copie fisse, prove), import del DB Opportunità (Prova → piano con
// dubbi da decidere → Importa), account mancanti per i contratti già presenti.
import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Badge, Empty, useToast } from './ui.jsx';
import { itDateTime, LINEE } from '../format.js';

export function HubCaselle({ f, setF }) {
  const toast = useToast();
  const st = useApi('/hub/caselle');
  const [esiti, setEsiti] = useState({});
  const [prova, setProva] = useState('');
  const run = async (linea, tipo) => {
    setEsiti((e) => ({ ...e, [linea]: { busy: tipo } }));
    try { const r = await api.post(`/hub/caselle/${linea}/${tipo}`, tipo === 'prova-invio' ? { to: prova || undefined } : {}); setEsiti((e) => ({ ...e, [linea]: r })); }
    catch (e) { setEsiti((x) => ({ ...x, [linea]: { ok: false, message: e.message } })); }
  };
  const leggi = async () => { try { const r = await api.post('/hub/caselle/leggi', {}); toast(`Lettura: ${Object.entries(r).map(([k, v]) => `${k} ${v.letti != null ? `${v.letti} letti, ${v.abbinati} abbinati` : v.errore || v.skipped}`).join(' · ')}`); st.reload(); } catch (e) { toast(e.message, 'err'); } };
  const d = st.data;
  return (
    <Card title="Business Hub · caselle di posta per linea" className="mt" actions={<button className="btn sm ghost" onClick={leggi}>Leggi ora</button>}>
      <div className="small muted" style={{ marginBottom: 10 }}>Ogni linea legge e invia dalla sua casella (Microsoft Graph, servono Mail.Read e Mail.Send applicativi sull'app registration della Suite e, se c'è, l'Application Access Policy estesa alle tre caselle). Lettura automatica ogni {d?.intervallo_minuti || 10} minuti. Le copie fisse partono su ogni email inviata dal widget e compaiono nel riepilogo prima dell'invio.
        {d && <> Stato: Graph {d.graph_configured ? <Badge tone="green">configurato</Badge> : <Badge tone="red">non configurato</Badge>} · posta {d.mail_provider === 'graph' ? <Badge tone="green">invio reale</Badge> : <Badge tone="mauve">modalità registro (MAIL_PROVIDER=log)</Badge>}</>}</div>
      <div className="grid g3">
        {['SRV', 'PP', 'MDL'].map((l) => {
          const c = d?.caselle?.find((x) => x.linea === l);
          const e = esiti[l];
          return (
            <div key={l} className="card" style={{ padding: 14 }}>
              <div className="row" style={{ marginBottom: 8 }}><Badge tone={LINEE[l].tone}>{LINEE[l].label}</Badge></div>
              <Field label="Indirizzo della casella" help={c?.source === 'env' ? `Impostato da BUSINESS_MAILBOX_${l} (sola lettura)` : `Variabile BUSINESS_MAILBOX_${l} per imporlo da Render`}><input value={c?.source === 'env' ? c.address : f[`hub_casella_${l}`] ?? ''} disabled={c?.source === 'env'} onChange={(ev) => setF({ ...f, [`hub_casella_${l}`]: ev.target.value })} /></Field>
              <label className="f inline" style={{ margin: '8px 0' }}><input type="checkbox" checked={String(f[`hub_lettura_${l}`]) !== 'false'} onChange={(ev) => setF({ ...f, [`hub_lettura_${l}`]: ev.target.checked ? 'true' : 'false' })} />Leggi la casella</label>
              <Field label="Copie fisse (sempre in cc)"><textarea style={{ minHeight: 56 }} value={f[`hub_cc_${l}`] ?? ''} onChange={(ev) => setF({ ...f, [`hub_cc_${l}`]: ev.target.value })} /></Field>
              {c && <div className="small muted" style={{ marginTop: 8 }}>Ultima lettura: {c.ultima_lettura ? itDateTime(c.ultima_lettura) : 'mai'} · {c.messaggi.letti} letti, {c.messaggi.abbinati} abbinati, {c.messaggi.da_assegnare} da assegnare · inviati {c.invii.inviati}, registrati {c.invii.registrati}, falliti {c.invii.falliti}{c.errore ? <div className="red">{c.errore}</div> : null}</div>}
              <div className="row" style={{ marginTop: 8, gap: 6 }}><button className="btn sm ghost" disabled={e?.busy} onClick={() => run(l, 'prova')}>Prova la casella</button><button className="btn sm ghost" disabled={e?.busy} onClick={() => run(l, 'prova-invio')}>Prova l'invio</button></div>
              {e && !e.busy && <div className={`small ${e.ok ? 'green' : 'red'}`} style={{ marginTop: 6 }}>{e.message}{e.steps && <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{e.steps.map((s, i) => <li key={i} className={s.ok ? 'green' : 'red'}>{s.step}: {s.detail}</li>)}</ul>}</div>}
            </div>
          );
        })}
      </div>
      <Field label="Destinatario delle prove di invio (vuoto: il tuo indirizzo)" className="mt"><input value={prova} onChange={(e) => setProva(e.target.value)} style={{ maxWidth: 360 }} /></Field>
      <div className="small muted" style={{ marginTop: 6 }}>Indirizzi, lettura e copie si salvano con "Salva impostazioni".</div>
    </Card>
  );
}

export function ImportDb() {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [piano, setPiano] = useState(null);
  const [dec, setDec] = useState({});
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState('');
  const [vista, setVista] = useState('DUBBIO');
  const runs = useApi('/hub/import/db/runs');
  const invia = async (url) => { const fd = new FormData(); fd.append('file', file); fd.append('decisioni', JSON.stringify(dec)); return api.upload(url, fd); };
  const prova = async () => { setBusy('prova'); setRep(null); try { const p = await invia('/hub/import/db/prova'); setPiano(p); setVista(['DUBBIO', 'CONTRATTO', 'ESISTENTE', 'NUOVA', 'GIA_IMPORTATA'].find((x) => p.unita.some((u) => u.esito === x)) || 'CONTRATTO'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const importa = async () => { setBusy('importa'); try { const r = await invia('/hub/import/db/esegui'); setRep(r); toast('Import completato'); runs.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const k = piano?.conteggi;
  const Num = ({ l, v, tone }) => <div className="kpi card" style={{ padding: '10px 12px' }}><div className="lbl">{l}</div><div className={`val ${tone || ''}`} style={{ fontSize: 20 }}>{v}</div></div>;
  const ESITI = { CONTRATTO: 'Abbinate a contratto esistente', ESISTENTE: 'Abbinate a Legal entity esistente', GIA_IMPORTATA: 'Già importate', NUOVA: 'Nuove Legal entity', DUBBIO: 'Dubbi da confermare', SALTATA: 'Da non importare' };
  const elenco = (piano?.unita || []).filter((u) => (vista === 'ALERT' ? u.alert.length : vista === 'GRUPPI' ? u.righe.length > 1 : u.esito === vista));
  const dubbiAperti = (piano?.unita || []).filter((u) => u.esito_abbinamento === 'DUBBIO' && !dec[u.chiave]).length;
  return (
    <Card title="Business Hub · Importa DB Opportunità (XLSX)" className="mt">
      <div className="small muted" style={{ marginBottom: 10 }}>Il file del CEO (DB Opportunità B2B Laboratorio, 49 colonne) diventa la base del CRM: un account per Legal entity sulla linea Service. Abbinamento ai contratti esistenti ("Cliente Pipeline"), alle Legal entity (email, ragione sociale, somiglianza ≥ 90%); tra 72% e 90% è un dubbio da decidere qui sotto prima di importare. Le righe dello stesso gruppo o ente gestore diventano una sola Legal entity con le strutture nell'account. Il cliente attivo non si imposta mai dall'import. Ripetere l'import non duplica nulla.</div>
      <div className="row" style={{ gap: 10 }}>
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files[0] || null); setPiano(null); setRep(null); setDec({}); }} />
        <button className="btn ghost" disabled={!file || Boolean(busy)} onClick={prova}>{busy === 'prova' ? 'Verifico…' : 'Prova (senza scrivere)'}</button>
        <button className="btn" disabled={!file || !piano || Boolean(busy)} onClick={importa}>{busy === 'importa' ? 'Importo…' : 'Importa'}</button>
        {piano && dubbiAperti > 0 && <span className="small" style={{ color: '#6d3f8a' }}>{dubbiAperti} dubbi non decisi: verranno saltati (decidi e ripeti la Prova)</span>}
      </div>
      {k && <div className="mt">
        <div className="grid g5">
          <Num l="Righe di dati" v={k.righe} /><Num l="Legal entity (unità)" v={k.unita} /><Num l="Abbinate a contratto" v={k.abbinate_contratto} /><Num l="Abbinate a Legal entity" v={k.abbinate_legal_entity + k.gia_importate} /><Num l="Nuove Legal entity" v={k.nuove} />
          <Num l="Dubbi (72-90%)" v={k.dubbi} tone={k.dubbi ? 'red' : ''} /><Num l="Account nuovi" v={k.account_nuovi} /><Num l="Gruppi accorpati" v={`${k.gruppi} (${k.righe_in_gruppi} righe)`} /><Num l="Righe con alert" v={k.righe_con_alert} /><Num l="Da confermare dal CEO" v={k.da_confermare_ceo} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Contratti con differenze dal DB: {k.contratti_con_differenze} (diventano un'attività "riconciliazione" nel diario, il contratto non cambia) · righe non di dati (totali e legenda) ignorate: {k.righe_scartate}</div>
        <div className="tabs" style={{ marginTop: 12 }}>{[...Object.keys(ESITI), 'GRUPPI', 'ALERT'].map((x) => <button key={x} className={vista === x ? 'on' : ''} onClick={() => setVista(x)}>{ESITI[x] || (x === 'GRUPPI' ? 'Gruppi accorpati' : 'Alert riconciliazione')}</button>)}</div>
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><tbody>
          {elenco.map((u) => <tr key={u.chiave}>
            <td><div className="strong">{u.nome}</div><div className="small muted">{u.righe.map((r) => `ID ${r.id} ${r.nome}${r.citta ? ` (${r.citta})` : ''}`).join(' · ')}</div>{u.avvisi.map((x, i) => <div key={i} className="small" style={{ color: '#6d3f8a' }}>{x}</div>)}{u.alert.map((x) => <div key={x.id} className="small red">ID {x.id}: {x.testo}</div>)}</td>
            <td className="small" style={{ minWidth: 260 }}>{u.org ? <>→ <strong>{u.org.name}</strong> <span className="muted">({u.come})</span></> : <span className="muted">{u.come}</span>}
              {u.contratti.map((c) => <div key={c.id}>Contratto {c.protocol || `#${c.id}`} ({c.status}){c.differenze.length ? <span className="red"> · {c.differenze.length} differenze</span> : ''}</div>)}
              {u.esito_abbinamento === 'DUBBIO' && <select style={{ marginTop: 6 }} value={dec[u.chiave] || ''} onChange={(e) => setDec({ ...dec, [u.chiave]: e.target.value })}><option value="">Decidi…</option>{u.candidati.map((c) => <option key={c.id} value={c.id}>È {c.name}{c.city ? ` (${c.city})` : ''} · {Math.round(c.s * 100)}%</option>)}<option value="NUOVA">Nuova Legal entity</option><option value="SALTA">Non importare</option></select>}
            </td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{u.fase_db}{u.da_confermare ? <div style={{ color: '#6d3f8a' }}>attivo da confermare</div> : null}</td>
          </tr>)}
          {!elenco.length && <tr><td><Empty>Nessuna riga in questo gruppo</Empty></td></tr>}
        </tbody></table></div>
      </div>}
      {rep && <div className="alert info mt small">Import eseguito: {rep.account_creati} account creati, {rep.account_aggiornati} aggiornati · {rep.legal_entity_nuove} Legal entity nuove, {rep.abbinate_contratto} abbinate a contratti, {rep.legal_entity_abbinate} ad altre Legal entity · {rep.contatti_creati} referenti · {rep.attivita_create} attività nel diario ({rep.riconciliazioni} riconciliazioni, {rep.da_confermare_ceo} clienti da confermare dal CEO) · dubbi saltati {rep.dubbi_saltati}{rep.errori.length ? <span className="red"> · {rep.errori.length} errori: {rep.errori.map((x) => `${x.nome}: ${x.errore}`).join('; ')}</span> : ''}</div>}
      {runs.data?.length > 0 && <details className="mt"><summary className="small">Import precedenti ({runs.data.length})</summary><table className="t small"><tbody>{runs.data.map((x) => <tr key={x.id}><td>{itDateTime(x.at)}</td><td>{x.filename}</td><td>{x.dry_run ? 'prova' : 'import'}</td><td>{x.user_name}</td><td>{x.dry_run ? `${x.summary.unita} unità, ${x.summary.dubbi} dubbi` : `${x.summary.account_creati} creati, ${x.summary.account_aggiornati} aggiornati`}</td></tr>)}</tbody></table></details>}
    </Card>
  );
}

export function AccountDaContratti() {
  const toast = useToast();
  const [r, setR] = useState(null);
  const run = async (dry) => { try { const x = await api.post('/hub/import/contratti', { dry_run: dry }); setR(x); if (!dry) toast(`${x.account} account creati dai contratti`); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Business Hub · account per i contratti già presenti" className="mt">
      <div className="small muted" style={{ marginBottom: 10 }}>Contratti di punti prelievo, service e medicina del lavoro con controparte ma senza account sulla stessa linea (dopo l'import del DB): l'account nasce con le fasi della pipeline del contratto o, in mancanza, dalle sue date (proposta = Offerta inviata, firma = Contratto firmato). Un contratto ATTIVO non rende attivo il cliente: diventa "da confermare dal CEO".</div>
      <div className="row"><button className="btn ghost" onClick={() => run(true)}>Prova</button><button className="btn" disabled={!r?.dry_run || !r.account} onClick={() => run(false)}>Crea gli account</button></div>
      {r && (r.dettaglio.length ? <table className="t small mt"><tbody>{r.dettaglio.map((x, i) => <tr key={i}><td className="strong">{x.org_name}</td><td><Badge tone={LINEE[x.linea]?.tone}>{LINEE[x.linea]?.short}</Badge></td><td>fase {x.fase}</td><td className="muted">{x.contratti.map((c) => `${c.protocol || `#${c.id}`} (${c.status})`).join(', ')} · {x.fonte}</td></tr>)}</tbody></table> : <Empty>Tutti i contratti hanno già il loro account</Empty>)}
    </Card>
  );
}
