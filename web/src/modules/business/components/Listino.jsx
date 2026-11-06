// Business Hub · scheda "Listino e offerta" dell'account (processo Service, richiesta del CEO del 06/11/2026: "In anagrafica del cliente,
// carico l'excel del listino che viene da StudioLab. E versioni successive, se il cliente chiede sconti").
// Caricamento sempre con l'anteprima: colonne riconosciute (o mapping a video, che vale anche per i caricamenti successivi), righe lette,
// riepilogo e differenze con la versione corrente; poi "Salva come vN". Versioni con le differenze evidenziate, scelta della corrente,
// "Offerta economica" in PDF da ogni versione (validità, condizioni, note, destinatario) con l'anteprima in pagina.
import React, { useMemo, useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, Modal, Icon, Empty, useToast } from './ui.jsx';
import { itDate, itDateTime, bytes, num } from '../format.js';

const docUrl = (id, inline) => `${API_BASE}/hub/documenti/${id}${inline ? '?inline=1' : ''}`;
const eur = (n) => (n == null ? '–' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)));
const pct = (n) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Number(n || 0))}%`;

export default function Listino({ a, onChange }) {
  const toast = useToast();
  const q = useApi(`/hub/accounts/${a.id}/listini`);
  const [carica, setCarica] = useState(false);
  const [sel, setSel] = useState(null);         // versione aperta
  const [offerta, setOfferta] = useState(null); // versione per cui generare l'offerta
  const [vista, setVista] = useState(null);     // documento PDF in anteprima
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Loading />;
  const corrente = d.versioni.find((v) => v.id === d.corrente_id);
  const scegli = async (id) => { try { await api.put(`/hub/accounts/${a.id}/listino-corrente`, { listino_id: id }); toast(id ? 'Versione corrente scelta' : 'Corrente: l\'ultima versione'); q.reload(); onChange?.(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <div className="grid g2">
        <Card title="Listino StudioLAB del cliente" actions={d.puo_modificare && <button className="btn sm" onClick={() => setCarica(true)}><Icon name="upload" />{d.versioni.length ? `Carica la v${d.versioni[0].versione + 1}` : 'Carica il listino'}</button>}>
          {corrente ? <div className="grid g3">
            <div className="kpi card"><div className="lbl">Versione corrente</div><div className="val">v{corrente.versione}</div><div className="foot">{d.scelta_manuale ? 'scelta a mano' : 'l\'ultima caricata'} · {itDate(corrente.caricato_at)}</div></div>
            <div className="kpi card"><div className="lbl">Esami</div><div className="val">{corrente.riepilogo.esami}</div><div className="foot">{corrente.riepilogo.scontati} con sconto{corrente.riepilogo.settori > 1 ? ` · ${corrente.riepilogo.settori} settori` : ''}</div></div>
            <div className="kpi card accent"><div className="lbl">Sconto medio</div><div className="val">{pct(corrente.riepilogo.sconto_medio)}</div><div className="foot">ponderato sul listino (semplice {pct(corrente.riepilogo.sconto_medio_semplice)})</div></div>
          </div> : <Empty>Nessun listino: carica l'Excel esportato da StudioLAB. Le colonne si riconoscono da sole (codice, descrizione, settore, prezzo di listino, prezzo offerto, sconto); se il formato è diverso le indichi a video una volta sola.</Empty>}
          {corrente && <div className="row" style={{ marginTop: 12, gap: 8 }}>
            {d.puo_modificare && <button className="btn" onClick={() => setOfferta(corrente)}><Icon name="file" />Genera l'offerta economica (v{corrente.versione})</button>}
            {corrente.offerta_documento_id && <button className="btn ghost" onClick={() => setVista({ id: corrente.offerta_documento_id, titolo: `Offerta economica v${corrente.versione}` })}>Anteprima dell'offerta</button>}
          </div>}
          <div className="small muted" style={{ marginTop: 10 }}>Lo sconto medio dell'account (Dati economici) segue la versione corrente. L'offerta economica entra nel kit di proposta e nel pacchetto.</div>
        </Card>
        <Card title={vista ? vista.titolo : 'Anteprima'} flush actions={vista && <a className="btn sm ghost" href={docUrl(vista.id)}><Icon name="download" />Scarica</a>}>
          {vista ? <iframe className="pk-pdf" title="Anteprima" src={`${docUrl(vista.id, true)}#view=FitH`} /> : <Empty>{corrente?.offerta_documento_id ? 'Premi "Anteprima dell\'offerta"' : 'Genera l\'offerta economica per vederla qui'}</Empty>}
        </Card>
      </div>

      <Card title="Versioni" className="mt" flush>
        {d.versioni.length ? <table className="t"><thead><tr><th>Versione</th><th>Caricata</th><th className="num">Esami</th><th className="num">Sconto medio</th><th>Rispetto alla precedente</th><th>Offerta economica</th><th /></tr></thead><tbody>
          {d.versioni.map((v) => <tr key={v.id} className={v.id === d.corrente_id ? 'sel' : ''}>
            <td className="strong">v{v.versione}{v.id === d.corrente_id && <> <Badge tone="teal">corrente</Badge></>}<div className="small muted">{v.filename}</div>{v.note && <div className="small">{v.note}</div>}</td>
            <td className="small">{itDateTime(v.caricato_at)}<div className="muted">{v.caricato_da || ''}</div></td>
            <td className="num">{v.riepilogo.esami}</td>
            <td className="num">{pct(v.riepilogo.sconto_medio)}</td>
            <td className="small">{v.diff ? <>{v.diff.cambiate} cambiate · {v.diff.aggiunte} aggiunte · {v.diff.tolte} tolte{v.diff.variazione_sconto ? <div className={v.diff.variazione_sconto > 0 ? 'green' : 'red'}>sconto medio {v.diff.variazione_sconto > 0 ? '+' : ''}{num(v.diff.variazione_sconto)} punti</div> : null}</> : <span className="muted">prima versione</span>}</td>
            <td className="small">{v.offerta_documento_id ? <><a href={docUrl(v.offerta_documento_id)}><Icon name="download" />{v.offerta_filename}</a><div className="muted">{itDateTime(v.offerta_at)}{v.offerta_dati?.validita ? ` · valida fino al ${itDate(v.offerta_dati.validita)}` : ''}</div></> : <span className="muted">non generata</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn sm ghost" onClick={() => setSel(v)}>Righe</button>{' '}
              {d.puo_modificare && <button className="btn sm ghost" onClick={() => setOfferta(v)}>Offerta</button>}{' '}
              {d.puo_modificare && v.id !== d.corrente_id && <button className="btn sm ghost" onClick={() => scegli(v.id)}>Rendi corrente</button>}
              {d.puo_modificare && d.scelta_manuale && v.id === d.corrente_id && <button className="btn sm ghost" onClick={() => scegli(null)}>Usa l'ultima</button>}
            </td>
          </tr>)}
        </tbody></table> : <Empty>Nessuna versione</Empty>}
      </Card>

      {carica && <Carica a={a} mapping={d.mapping} onClose={() => setCarica(false)} onDone={() => { setCarica(false); q.reload(); onChange?.(); }} />}
      {sel && <Righe v={sel} onClose={() => setSel(null)} />}
      {offerta && <Offerta a={a} v={offerta} predefiniti={d.predefiniti} onClose={() => setOfferta(null)} onDone={(r) => { setOfferta(null); q.reload(); onChange?.(); setVista({ id: r.documento_id, titolo: `Offerta economica v${r.versione}` }); }} />}
    </>
  );
}

// Caricamento: file → anteprima (colonne, righe, differenze) → eventuale mapping a video → salva
function Carica({ a, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [p, setP] = useState(null);
  const [mapping, setMapping] = useState(null);   // scelto a video
  const [foglio, setFoglio] = useState('');
  const [busy, setBusy] = useState(false);
  const fd = (m = mapping) => { const x = new FormData(); x.append('file', file); if (m) x.append('mapping', JSON.stringify(m)); if (foglio) x.append('foglio', foglio); x.append('note', note); return x; };
  const leggi = async (m = mapping) => { setBusy(true); try { const r = await api.upload(`/hub/accounts/${a.id}/listini/anteprima`, fd(m)); setP(r); if (!m) setMapping(null); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const salva = async () => { setBusy(true); try { const r = await api.upload(`/hub/accounts/${a.id}/listini`, fd()); toast(`Listino v${r.versione} salvato: ${r.riepilogo.esami} esami`); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const cambiate = useMemo(() => new Set(p?.differenze?.chiavi_cambiate || []), [p]);
  const chiave = (x) => (x.codice ? `c:${String(x.codice).toUpperCase()}` : null);
  const m = mapping || p?.mapping || {};
  return (
    <Modal wide title={`Carica il listino StudioLAB · ${a.org_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn ghost" disabled={!file || busy} onClick={() => leggi()}>{p ? 'Rileggi' : 'Anteprima'}</button>
      <button className="btn" disabled={!p || p.mancanti.length > 0 || !p.righe_totali || busy} onClick={salva}>Salva come v{p?.versione || ''}</button></>}>
      <div className="form-grid">
        <Field label="File Excel esportato da StudioLAB (.xlsx o .csv)" className="span2"><input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files[0] || null); setP(null); setMapping(null); }} /></Field>
        <Field label="Nota della versione" className="span2" help="Es. sconto richiesto dal cliente, revisione del listino"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {p && <div className="mt">
        <div className="small" style={{ marginBottom: 8 }}>{p.fogli.length > 1 && <>Foglio <select style={{ width: 'auto', minHeight: 30, height: 30 }} value={foglio || p.foglio || ''} onChange={(e) => { setFoglio(e.target.value); }}>{p.fogli.map((f) => <option key={f}>{f}</option>)}</select> · </>}intestazione alla riga {p.intestazione_riga} · {p.riconosciuto ? <Badge tone="green">colonne riconosciute</Badge> : p.da_mapping_salvato ? <Badge tone="blue">mapping salvato</Badge> : mapping ? <Badge tone="mauve">mapping scelto a video</Badge> : <Badge tone="red">colonne da indicare</Badge>}</div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(150px, 1fr))' }}>
          {p.campi.map((c) => <Field key={c.k} label={`${c.label}${c.obbligatorio ? ' *' : ''}`}><select value={m[c.k] ?? ''} onChange={(e) => setMapping({ ...m, [c.k]: e.target.value === '' ? undefined : Number(e.target.value) })}><option value="">–</option>{p.intestazioni.map((h, i) => <option key={i} value={i}>{h || `colonna ${i + 1}`}</option>)}</select></Field>)}
        </div>
        {mapping && <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => leggi(mapping)}>Applica le colonne scelte</button><span className="small muted">Il mapping scelto vale anche per i prossimi caricamenti.</span></div>}
        {p.mancanti.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>Indica quale colonna è {p.mancanti.map((k) => p.campi.find((c) => c.k === k)?.label.toLowerCase()).join(' e quale ')}, poi "Applica le colonne scelte".</div>}
        {p.righe_totali > 0 && <>
          <div className="grid g4 mt">
            <div className="kpi card"><div className="lbl">Esami letti</div><div className="val">{p.righe_totali}</div><div className="foot">{p.scartate} righe scartate (vuote o di totale)</div></div>
            <div className="kpi card"><div className="lbl">Totale listino</div><div className="val">{eur(p.riepilogo.totale_listino)} €</div></div>
            <div className="kpi card"><div className="lbl">Totale offerta</div><div className="val">{eur(p.riepilogo.totale_offerto)} €</div></div>
            <div className="kpi card accent"><div className="lbl">Sconto medio</div><div className="val">{pct(p.riepilogo.sconto_medio)}</div><div className="foot">ponderato sul listino</div></div>
          </div>
          {p.differenze && <div className="alert info small" style={{ marginTop: 8 }}>Rispetto alla v{p.precedente.versione}: <b>{p.differenze.cambiate.length} righe cambiate</b>, {p.differenze.aggiunte.length} aggiunte, {p.differenze.tolte.length} tolte, {p.differenze.invariate} invariate · sconto medio {pct(p.differenze.sconto_medio_prima)} → <b>{pct(p.differenze.sconto_medio_dopo)}</b>{p.differenze.tolte.length ? <div>Tolte: {p.differenze.tolte.slice(0, 10).map((x) => x.codice || x.descrizione).join(', ')}{p.differenze.tolte.length > 10 ? '…' : ''}</div> : null}</div>}
          {p.avvisi.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{p.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
          <div className="table-wrap mt" style={{ maxHeight: 360 }}><table className="t small"><thead><tr><th>Codice</th><th>Esame</th><th>Settore</th><th className="num">Listino €</th><th className="num">Offerta €</th><th className="num">Sconto</th></tr></thead><tbody>
            {p.righe.map((x, i) => <tr key={i} style={cambiate.has(chiave(x)) ? { background: '#fff4d6' } : undefined}><td className="mono">{x.codice || '–'}</td><td>{x.descrizione}</td><td className="muted">{x.settore || ''}</td><td className="num">{eur(x.listino)}</td><td className="num strong">{eur(x.offerto)}</td><td className="num">{x.sconto ? pct(x.sconto) : '–'}</td></tr>)}
          </tbody></table></div>
          {p.differenze?.cambiate.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>In giallo le righe con un prezzo diverso dalla versione corrente.</div>}
        </>}
      </div>}
    </Modal>
  );
}

function Righe({ v, onClose }) {
  const q = useApi(`/hub/listini/${v.id}`);
  const cambiate = new Set((q.data?.differenze?.cambiate || []).map((x) => (x.codice ? `c:${String(x.codice).toUpperCase()}` : `d:${x.descrizione}`)));
  const prima = Object.fromEntries((q.data?.differenze?.cambiate || []).map((x) => [x.codice ? `c:${String(x.codice).toUpperCase()}` : `d:${x.descrizione}`, x]));
  return (
    <Modal wide title={`Listino v${v.versione} · ${v.riepilogo.esami} esami`} onClose={onClose}>
      {!q.data ? <Loading /> : <>
        {q.data.differenze && <div className="small muted" style={{ marginBottom: 8 }}>Evidenziate le {q.data.differenze.cambiate.length} righe cambiate rispetto alla versione precedente (prezzo prima → dopo).{q.data.differenze.aggiunte.length ? ` Aggiunte: ${q.data.differenze.aggiunte.length}.` : ''}{q.data.differenze.tolte.length ? ` Tolte: ${q.data.differenze.tolte.map((x) => x.codice || x.descrizione).join(', ')}.` : ''}</div>}
        <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t small"><thead><tr><th>Codice</th><th>Esame</th><th>Settore</th><th className="num">Listino €</th><th className="num">Offerta €</th><th className="num">Sconto</th></tr></thead><tbody>
          {q.data.righe.map((x, i) => { const k = x.codice ? `c:${String(x.codice).toUpperCase()}` : `d:${x.descrizione}`; const c = cambiate.has(k); return <tr key={i} style={c ? { background: '#fff4d6' } : undefined}>
            <td className="mono">{x.codice || '–'}</td><td>{x.descrizione}</td><td className="muted">{x.settore || ''}</td><td className="num">{eur(x.listino)}</td>
            <td className="num strong">{c ? <><span className="muted" style={{ textDecoration: 'line-through' }}>{eur(prima[k].offerto_prima)}</span> {eur(x.offerto)}</> : eur(x.offerto)}</td><td className="num">{x.sconto ? pct(x.sconto) : '–'}</td></tr>; })}
        </tbody></table></div>
      </>}
    </Modal>
  );
}

function Offerta({ a, v, predefiniti, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ validita: v.offerta_dati?.validita || predefiniti.validita || '', condizioni: v.offerta_dati?.condizioni || predefiniti.condizioni || '', note: v.offerta_dati?.note || v.note || '', contatto_id: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const r = await api.post(`/hub/listini/${v.id}/offerta`, { ...f, contatto_id: f.contatto_id ? Number(f.contatto_id) : null }); toast(`Offerta economica v${r.versione} generata: ${r.pagine} pagine`); onDone(r); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <Modal title={`Offerta economica dal listino v${v.versione}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={go}><Icon name="file" />{busy ? 'Generazione…' : 'Genera il PDF'}</button></>}>
      <div className="form-grid">
        <Field label="Valida fino al"><input type="date" value={f.validita} onChange={(e) => setF({ ...f, validita: e.target.value })} /></Field>
        <Field label="Alla cortese attenzione"><select value={f.contatto_id} onChange={(e) => setF({ ...f, contatto_id: e.target.value })}><option value="">Nessuno</option>{a.contatti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Condizioni di pagamento" className="span2" help="Dalla Legal entity o dalle Impostazioni (termini predefiniti)"><input value={f.condizioni} onChange={(e) => setF({ ...f, condizioni: e.target.value })} /></Field>
        <Field label="Note dell'offerta" className="span2"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>PDF su carta intestata luglio 2026: copertina con cliente e versione, riepilogo (esami, sconto medio, validità, condizioni), tabelle per settore, note, firma del CEO dalle Impostazioni. Resta nei documenti dell'account.</div>
    </Modal>
  );
}
