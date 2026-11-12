// Guida GIPO · Redazione (ADMIN): Domande da risolvere (la risposta diventa una FAQ pubblicata collegata a una sezione; chi aveva chiesto
// riceve una notifica), Sezioni (stato, revisioni, editor), FAQ (gestione), Statistiche (domande per settimana, risposte utili, argomenti più
// cercati, ricerche senza risultati, sezioni più citate, seme dei contenuti, riepilogo settimanale).
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, ConfirmModal, ErrorBox, Field, Kpi, Modal, PageHead, PromptModal, Tabs, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, qs, useApi } from '../api.js';
import { BackEndBadge, Bollino, ESITO, FONTE, TestoGuida, itData, itDataOra } from '../components.jsx';
import { Procedure } from './Chiedi.jsx';

const RUOLI = [['', 'Nessuno'], ['accettazione', 'Accettazione'], ['medico', 'Medico'], ['amministrazione', 'Amministrazione']];
const badgeAggiorna = () => window.dispatchEvent(new Event('suite:badges'));

function SceltaSezione({ value, onChange, indice }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Scegli la sezione</option>
      {(indice?.capitoli || []).map((k) => <optgroup key={k.numero} label={`${k.numero}. ${k.titolo}`}>{k.sezioni.map((s) => <option key={s.id} value={s.id}>{s.numero} {s.titolo}</option>)}</optgroup>)}
    </select>
  );
}

// ---------------------------------------------------------------- coda
function Rispondi({ d, indice, onClose, onFatto }) {
  const suggerita = (d.fonti || []).find((f) => f.tipo === 'sezione' && f.citata) || (d.fonti || []).find((f) => f.tipo === 'sezione');
  const idSugg = suggerita ? indice?.capitoli?.flatMap((k) => k.sezioni).find((s) => s.slug === suggerita.slug)?.id : null;
  const [f, setF] = useState({ domanda: d.testo.replace(/\s+/g, ' ').slice(0, 300), risposta: '', sezione_id: idSugg || null, ruolo: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [anteprima, setAnteprima] = useState(false);
  const salva = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/redazione/domande/${d.id}/risolvi`, { ...f, ruolo: f.ruolo || null }); onFatto(r); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Rispondi e pubblica come FAQ" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || f.risposta.trim().length < 10 || !f.sezione_id || f.domanda.trim().length < 8} onClick={salva}><Icon name="check" />Pubblica la FAQ e risolvi</button></>}>
      <ErrorBox error={err} />
      <div className="alert info"><Icon name="info" /><span>La risposta diventa una FAQ pubblicata, collegata alla sezione scelta, ed entra nella guida e nel PDF. {d.utente_nome ? `${d.utente_nome} riceve` : 'Chi ha chiesto riceve'} una notifica nella Suite. Non scrivere dati di pazienti.</span></div>
      <Field label="Domanda (come comparirà tra le FAQ)" help="Riformulala in modo generale se serve."><input value={f.domanda} maxLength={300} onChange={(e) => setF({ ...f, domanda: e.target.value })} /></Field>
      <Field label="Risposta (markdown: elenchi con 1. 2. 3., **grassetto**, collegamenti [testo](sezione:slug))">
        <div className="seg gg-seg-anteprima"><button type="button" className={!anteprima ? 'on' : ''} onClick={() => setAnteprima(false)}>Scrivi</button><button type="button" className={anteprima ? 'on' : ''} onClick={() => setAnteprima(true)}>Anteprima</button></div>
        {anteprima ? <div className="gg-anteprima-box"><TestoGuida source={f.risposta || '_vuota_'} /></div> : <textarea rows={9} value={f.risposta} onChange={(e) => setF({ ...f, risposta: e.target.value })} placeholder={'1. Apri ...\n2. Premi ...'} />}
      </Field>
      <div className="gg-due">
        <Field label="Sezione collegata" required><SceltaSezione value={f.sezione_id} onChange={(v) => setF({ ...f, sezione_id: v })} indice={indice} /></Field>
        <Field label="Ruolo"><select value={f.ruolo} onChange={(e) => setF({ ...f, ruolo: e.target.value })}>{RUOLI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function Coda({ indice, onCambio }) {
  const toast = useToast();
  const [vista, setVista] = useState('coda');
  const c = useApi(`/redazione/coda${qs({ vista })}`, [], { silent: true });
  const [risp, setRisp] = useState(null);
  const [chiudi, setChiudi] = useState(null);
  const ricarica = () => { c.reload(); onCambio?.(); badgeAggiorna(); };
  const prendi = async (d) => { try { await api.post(`/redazione/domande/${d.id}/prendi`); ricarica(); } catch (e) { toast(e.message, 'err'); } };
  // v0.71.1: "Rigenera risposta" dopo un aggiornamento della guida; "Segna come risolta dalla guida" (senza FAQ nuova)
  const [rigenerate, setRigenerate] = useState({});
  const [inCorso, setInCorso] = useState(null);
  const rigeneraRisposta = async (d) => {
    setInCorso(d.id);
    try { const r = await api.post(`/redazione/domande/${d.id}/rigenera`); setRigenerate((x) => ({ ...x, [d.id]: r })); toast(`Risposta rigenerata: ${ESITO[r.esito]?.label || r.esito}`); c.reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setInCorso(null); }
  };
  const [risolta, setRisolta] = useState(null);
  return (
    <div>
      <div className="row gg-coda-filtri">
        <div className="seg" role="group" aria-label="Vista">{[['coda', `Da risolvere${c.data ? ` (${c.data.in_coda})` : ''}`], ['risolte', 'Risolte o chiuse'], ['tutte', 'Tutte le domande']].map(([v, l]) => <button key={v} type="button" className={vista === v ? 'on' : ''} onClick={() => setVista(v)}>{l}</button>)}</div>
        <span className="small muted">In coda: domande senza risposta e risposte giudicate "non utili" da chi le ha poste.</span>
      </div>
      <ErrorBox error={c.error} />
      {c.data && !c.data.righe.length && <div className="gg-vuoto muted"><Icon name="check" /> {vista === 'coda' ? 'Nessuna domanda da risolvere.' : 'Nessuna domanda.'}</div>}
      <div className="gg-coda">
        {(c.data?.righe || []).map((d) => (
          <Card key={d.id} className="gg-coda-voce">
            <div className="gg-coda-hd">
              <b className="gg-coda-t">{d.testo}</b>
              <Badge tone={ESITO[d.esito]?.tone}>{ESITO[d.esito]?.label}</Badge>
              {d.utile === false && <Badge tone="red">non utile</Badge>}
              {d.utile === true && <Badge tone="green">utile</Badge>}
              {d.risolta_il && <Badge tone="teal">risolta</Badge>}
              {d.chiusa_il && <Badge tone="grey">chiusa</Badge>}
              {d.risolta_dalla_guida && <Badge tone="teal">risolta dalla guida</Badge>}
              {d.rigenerazioni > 0 && <Badge tone="blue" dot={false} title={`Ultima il ${itDataOra(d.rigenerata_il)}`}>rigenerata {d.rigenerazioni === 1 ? 'una volta' : `${d.rigenerazioni} volte`}</Badge>}
            </div>
            <div className="small muted">{itDataOra(d.creata_il)} · {d.utente_nome || 'utente non più presente'}{d.mascherati?.length ? ` · tolti: ${d.mascherati.join(', ')}` : ''}{d.presa_da_nome ? ` · presa in carico da ${d.presa_da_nome}` : ''}</div>
            {d.nota_utente && <div className="gg-nota-utente"><Icon name="comment" />{d.nota_utente}</div>}
            {d.risposta && <details className="gg-coda-risp" open={Boolean(rigenerate[d.id])}><summary className="small">{d.rigenerazioni > 0 ? 'Risposta rigenerata' : 'Risposta data dall\'assistente'}</summary><TestoGuida source={d.risposta} /></details>}
            {rigenerate[d.id] && !rigenerate[d.id].risposta && (
              <div className="gg-rigenerata"><div className="small muted">Risposta rigenerata senza assistente ({ESITO[rigenerate[d.id].esito]?.label}): i passi delle sezioni trovate.</div><Procedure procedure={rigenerate[d.id].procedure} /></div>
            )}
            {d.fonti?.length > 0 && <div className="small muted">Sezioni trovate: {d.fonti.slice(0, 4).map((f) => f.titolo).join(' · ')}</div>}
            {d.faq_domanda && <div className="small"><Icon name="check" /> FAQ: <Link to={`${base}/faq?voce=${d.risolta_con_faq_id}`}>{d.faq_domanda}</Link></div>}
            {d.chiusa_nota && <div className="small muted">Chiusa: {d.chiusa_nota}</div>}
            {!d.risolta_il && !d.chiusa_il && (
              <div className="row gg-coda-az">
                <button className="btn sm" onClick={() => setRisp(d)}><Icon name="edit" />Rispondi</button>
                <button className="btn sm ghost" onClick={() => rigeneraRisposta(d)} disabled={inCorso === d.id} title="Ripete ricerca e risposta con la guida di oggi"><Icon name="refresh" />{inCorso === d.id ? 'Rigenero...' : 'Rigenera risposta'}</button>
                <button className="btn sm ghost" onClick={() => setRisolta(d)} title="La guida ora risponde: nessuna FAQ nuova, chi ha chiesto riceve una notifica"><Icon name="check" />Segna come risolta dalla guida</button>
                {!d.presa_da_nome && <button className="btn sm ghost" onClick={() => prendi(d)}><Icon name="user" />Prendi in carico</button>}
                <button className="btn sm ghost" onClick={() => setChiudi(d)}><Icon name="x" />Chiudi senza FAQ</button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {risp && <Rispondi d={risp} indice={indice} onClose={() => setRisp(null)} onFatto={(r) => { toast(r.notificato ? 'FAQ pubblicata, notifica inviata' : 'FAQ pubblicata'); ricarica(); }} />}
      {risolta && <PromptModal title="Segna come risolta dalla guida" label="Nota (facoltativa): quale sezione risponde ora" placeholder="Es. aggiornata la sezione 14.4 Sottoconfigurazioni" type="textarea" minLength={0}
        onClose={() => setRisolta(null)} onConfirm={async (nota) => { const r = await api.post(`/redazione/domande/${risolta.id}/risolta-dalla-guida`, { nota: nota || null }); toast(r.notificato ? 'Domanda risolta, notifica inviata' : 'Domanda risolta'); ricarica(); }} />}
      {chiudi && <PromptModal title="Chiudi senza FAQ" label="Motivo (resta nello storico)" placeholder="Es. domanda non pertinente, doppione della FAQ ..." type="textarea" minLength={3}
        onClose={() => setChiudi(null)} onConfirm={async (nota) => { await api.post(`/redazione/domande/${chiudi.id}/chiudi`, { nota }); ricarica(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- sezioni
function Sezioni() {
  const s = useApi('/redazione/sezioni', [], { silent: true });
  const [q, setQ] = useState('');
  const [stato, setStato] = useState('');
  const [livello, setLivello] = useState('');
  const righe = useMemo(() => (s.data || []).filter((x) => (!stato || x.stato === stato) && (!livello || x.livello === livello) && (!q || `${x.numero} ${x.titolo} ${x.percorso_gipo || ''}`.toLowerCase().includes(q.toLowerCase()))), [s.data, q, stato, livello]);
  const validate = (s.data || []).filter((x) => x.stato === 'VALIDATA').length;
  return (
    <div>
      <div className="row gg-coda-filtri">
        <div className="gg-indice-cerca"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra le sezioni" aria-label="Filtra le sezioni" /></div>
        <div className="seg" role="group" aria-label="Stato">{[['', 'Tutte'], ['DA_VALIDARE', 'Da validare'], ['VALIDATA', 'Validate']].map(([v, l]) => <button key={v} type="button" className={stato === v ? 'on' : ''} onClick={() => setStato(v)}>{l}</button>)}</div>
        <div className="seg" role="group" aria-label="Livello">{[['', 'Tutti i livelli'], ['BACK_END', 'Back-end'], ['OPERATIVO', 'Operative']].map(([v, l]) => <button key={v} type="button" className={livello === v ? 'on' : ''} onClick={() => setLivello(v)}>{l}</button>)}</div>
        <span className="small muted">{validate} validate su {s.data?.length || 0}. Per validare: apri la sezione, verifica in GIPO con un referente, "Segna come validata".</span>
      </div>
      <ErrorBox error={s.error} />
      <Card flush>
        <div className="table-wrap">
          <table className="t gg-tab">
            <thead><tr><th>N.</th><th>Sezione</th><th>Stato</th><th>Fonte</th><th>Percorso</th><th className="num">FAQ</th><th className="num">Revisioni</th><th>Aggiornata</th></tr></thead>
            <tbody>
              {righe.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.numero}</td>
                  <td><Link to={`${base}/redazione/sezioni/${x.id}`}>{x.titolo}</Link>{x.origine === 'REDAZIONE' && <> <Badge tone="teal">nuova</Badge></>}</td>
                  <td><Bollino stato={x.stato} compatto fonteValidazione={x.fonte_validazione} /> <BackEndBadge livello={x.livello} /></td>
                  <td className="small">{FONTE[x.fonte]?.label || x.fonte}</td>
                  <td className="small mono">{x.percorso_gipo || ''}</td>
                  <td className="num">{x.faq}</td>
                  <td className="num">{x.revisioni}</td>
                  <td className="small">{itData(x.aggiornata_il)}{x.aggiornata_da_nome ? ` · ${x.aggiornata_da_nome}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- FAQ
function FaqModal({ faq, indice, onClose, onFatto }) {
  const [f, setF] = useState({ domanda: faq?.domanda || '', risposta: faq?.risposta || '', sezione_id: faq?.sezione_id || null, ruolo: faq?.ruolo || '', pubblicata: faq ? faq.pubblicata : true });
  const [err, setErr] = useState(null);
  const salva = async () => {
    setErr(null);
    try { const b = { ...f, ruolo: f.ruolo || null }; if (faq?.id) await api.put(`/redazione/faq/${faq.id}`, b); else await api.post('/redazione/faq', b); onFatto(); onClose(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title={faq?.id ? 'Modifica FAQ' : 'Nuova FAQ'} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={salva} disabled={f.domanda.trim().length < 8 || f.risposta.trim().length < 5}><Icon name="check" />Salva</button></>}>
      <ErrorBox error={err} />
      {faq?.origine === 'SEME' && <div className="alert info"><Icon name="info" /><span>FAQ nata dal seme della guida: se la modifichi, i rilasci successivi non la sovrascrivono più.</span></div>}
      <Field label="Domanda"><input value={f.domanda} maxLength={300} onChange={(e) => setF({ ...f, domanda: e.target.value })} /></Field>
      <Field label="Risposta (markdown)"><textarea rows={8} value={f.risposta} onChange={(e) => setF({ ...f, risposta: e.target.value })} /></Field>
      <div className="gg-due">
        <Field label="Sezione collegata"><SceltaSezione value={f.sezione_id} onChange={(v) => setF({ ...f, sezione_id: v })} indice={indice} /></Field>
        <Field label="Ruolo"><select value={f.ruolo} onChange={(e) => setF({ ...f, ruolo: e.target.value })}>{RUOLI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <label className="gg-check"><input type="checkbox" checked={f.pubblicata} onChange={(e) => setF({ ...f, pubblicata: e.target.checked })} /> Pubblicata (visibile nelle FAQ, nella ricerca, nelle risposte e nel PDF)</label>
    </Modal>
  );
}

function FaqRedazione({ indice }) {
  const toast = useToast();
  const l = useApi('/redazione/faq', [], { silent: true });
  const [q, setQ] = useState('');
  const [mod, setMod] = useState(null);
  const [del, setDel] = useState(null);
  const righe = (l.data || []).filter((f) => !q || `${f.domanda} ${f.risposta}`.toLowerCase().includes(q.toLowerCase()));
  const ORIG = { SEME: ['grey', 'seme'], DOMANDA_UTENTE: ['teal', 'da domanda'], REDAZIONE: ['blue', 'redazione'] };
  return (
    <div>
      <div className="row gg-coda-filtri">
        <div className="gg-indice-cerca"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra le FAQ" aria-label="Filtra le FAQ" /></div>
        <button className="btn" onClick={() => setMod({})}><Icon name="plus" />Nuova FAQ</button>
        <span className="small muted">{l.data?.filter((f) => f.pubblicata).length || 0} pubblicate su {l.data?.length || 0}</span>
      </div>
      <ErrorBox error={l.error} />
      <Card flush>
        <div className="table-wrap">
          <table className="t gg-tab">
            <thead><tr><th>Domanda</th><th>Sezione</th><th>Origine</th><th>Stato</th><th /></tr></thead>
            <tbody>
              {righe.map((f) => (
                <tr key={f.id}>
                  <td><button type="button" className="gg-link" onClick={() => setMod(f)}>{f.domanda}</button></td>
                  <td className="small">{f.sezione_titolo || <span className="faint">nessuna</span>}</td>
                  <td><Badge tone={ORIG[f.origine][0]}>{ORIG[f.origine][1]}</Badge></td>
                  <td>{f.pubblicata ? <Badge tone="green">pubblicata</Badge> : <Badge tone="grey">non pubblicata</Badge>}</td>
                  <td className="num">{f.origine !== 'SEME' && <button className="iconbtn" aria-label="Elimina" title="Elimina" onClick={() => setDel(f)}><Icon name="trash" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {mod && <FaqModal faq={mod.id ? mod : null} indice={indice} onClose={() => setMod(null)} onFatto={() => { l.reload(); toast('FAQ salvata'); }} />}
      {del && <ConfirmModal title="Elimina FAQ" text={`Eliminare la FAQ "${del.domanda}"? Le FAQ del seme non si eliminano: si tolgono dalla pubblicazione.`} danger confirmText="Elimina" onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/redazione/faq/${del.id}`); l.reload(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- statistiche
function Statistiche() {
  const toast = useToast();
  const st = useApi('/redazione/statistiche', [], { silent: true });
  const seme = useApi('/redazione/seme', [], { silent: true });
  const t = st.data?.totali;
  const max = Math.max(1, ...(st.data?.settimane || []).map((w) => w.domande));
  const riepilogo = async () => { try { const r = await api.post('/redazione/riepilogo'); toast(r.coda ? `Riepilogo inviato a ${r.destinatari} amministratori (${r.coda} in coda)` : 'Nessuna domanda in coda: nessuna notifica'); st.reload(); } catch (e) { toast(e.message, 'err'); } };
  const ricarica = async () => { try { const r = await api.post('/redazione/seme/ricarica'); toast(`Seme: ${r.sezioni.nuove} nuove, ${r.sezioni.aggiornate} aggiornate, ${r.sezioni.protette.length} protette`); seme.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="gg-stat">
      <ErrorBox error={st.error} />
      <div className="gg-kpi">
        <Kpi label="Domande" value={t?.domande ?? '-'} foot={`${t?.ultima_settimana ?? 0} negli ultimi 7 giorni`} />
        <Kpi label="Risposte utili" value={t?.pct_utili != null ? `${t.pct_utili}%` : '-'} foot={`${t?.utili ?? 0} su ${t?.valutate ?? 0} valutate`} />
        <Kpi label="In coda" value={t?.in_coda ?? '-'} foot={`${t?.risolte ?? 0} risolte con una FAQ`} accent={t?.in_coda > 0} />
        <Kpi label="Sezioni validate" value={st.data ? `${st.data.sezioni.validate}/${st.data.sezioni.totale}` : '-'} foot={`${st.data?.sezioni.back_end ?? 0} back-end, ${st.data?.sezioni.dal_manuale ?? 0} dal manuale TD · ${st.data?.faq.pubblicate ?? 0} FAQ`} />
      </div>
      <div className="gg-stat-griglia">
        <Card title="Domande per settimana" icon="stats">
          {!st.data?.settimane?.length && <div className="muted small">Ancora nessuna domanda.</div>}
          <div className="gg-barre">
            {(st.data?.settimane || []).map((w) => (
              <div key={w.settimana} className="gg-barra" title={`${w.domande} domande · ${w.con_risposta} con risposta · ${w.parziali} con passi da provare · ${w.senza_risposta} senza · ${w.solo_ricerca} solo ricerca · ${w.utili} utili`}>
                <div className="gg-barra-v" style={{ height: `${Math.round((w.domande / max) * 100)}%` }}><span>{w.domande}</span></div>
                <span className="small muted">{itData(w.settimana).slice(0, 5)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Argomenti più cercati (90 giorni)" icon="search">
          <ol className="gg-top">{(st.data?.cercate || []).map((x) => <li key={x.testo}><span>{x.testo}</span><span className="small muted">{x.volte} {x.volte === 1 ? 'volta' : 'volte'} · {x.risultati} risultat{x.risultati === 1 ? 'o' : 'i'}</span></li>)}</ol>
          {!st.data?.cercate?.length && <div className="muted small">Nessuna ricerca registrata.</div>}
        </Card>
        <Card title="Ricerche senza risultati" icon="alert">
          <ol className="gg-top">{(st.data?.vuote || []).map((x) => <li key={x.testo}><span>{x.testo}</span><span className="small muted">{x.volte} {x.volte === 1 ? 'volta' : 'volte'} · ultima {itData(x.ultima)}</span></li>)}</ol>
          {!st.data?.vuote?.length && <div className="muted small">Nessuna ricerca a vuoto: bene.</div>}
          <div className="small muted">Sono argomenti che la guida non copre: valuta una FAQ o una sezione nuova.</div>
        </Card>
        <Card title="Sezioni più usate nelle risposte" icon="doc">
          <ol className="gg-top">{(st.data?.citate || []).map((x) => <li key={x.slug}><Link to={`${base}/guida/${x.slug}`}>{x.titolo}</Link><span className="small muted">{x.volte} {x.volte === 1 ? 'volta' : 'volte'}</span></li>)}</ol>
          {!st.data?.citate?.length && <div className="muted small">Compaiono quando l'assistente risponde citando la guida.</div>}
        </Card>
        <Card title="Contenuti e riepilogo" icon="gear">
          <p className="small">Seme dei contenuti nel rilascio: <b>{seme.data?.rilascio.sezioni}</b> sezioni e <b>{seme.data?.rilascio.faq}</b> FAQ. Ultimo caricamento: {seme.data?.caricato?.at ? itDataOra(seme.data.caricato.at) : 'mai'}. Le sezioni modificate a mano o validate non vengono sovrascritte dai rilasci.</p>
          <p className="small">Riepilogo settimanale agli amministratori (notifica nella Suite, il lunedì dalle 8): {st.data?.riepilogo ? `ultimo ${itDataOra(st.data.riepilogo.at)}, ${st.data.riepilogo.coda} in coda` : 'non ancora inviato'}.</p>
          <div className="row"><button className="btn sm ghost" onClick={riepilogo}><Icon name="bell" />Invia il riepilogo adesso</button><button className="btn sm ghost" onClick={ricarica}><Icon name="refresh" />Ricarica il seme</button></div>
        </Card>
      </div>
    </div>
  );
}

export default function Redazione() {
  const [sp, setSp] = useSearchParams();
  const scheda = sp.get('scheda') || 'coda';
  const indice = useApi('/indice', [], { silent: true });
  const badges = useApi('/badges', [], { silent: true });
  return (
    <div className="page gg-page">
      <PageHead title="Redazione della guida" icon="edit" sub="Rispondi alle domande del personale, valida le sezioni con i referenti GIPO, cura le FAQ" />
      <Tabs value={scheda} onChange={(v) => setSp({ scheda: v }, { replace: true })} items={[
        { value: 'coda', label: 'Domande da risolvere', count: badges.data?.coda },
        { value: 'sezioni', label: 'Sezioni' }, { value: 'faq', label: 'FAQ' }, { value: 'statistiche', label: 'Statistiche' }]} />
      {scheda === 'coda' && <Coda indice={indice.data} onCambio={badges.reload} />}
      {scheda === 'sezioni' && <Sezioni />}
      {scheda === 'faq' && <FaqRedazione indice={indice.data} />}
      {scheda === 'statistiche' && <Statistiche />}
    </div>
  );
}
