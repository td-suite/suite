// Business Hub · scheda "Listino e offerta" dell'account (processo Service, richiesta del CEO del 06/11/2026: "In anagrafica del cliente,
// carico l'excel del listino che viene da StudioLab. E versioni successive, se il cliente chiede sconti").
// Caricamento sempre con l'anteprima: colonne riconosciute (o mapping a video, che vale anche per i caricamenti successivi), righe lette,
// riepilogo e differenze con la versione corrente; poi "Salva come vN". Versioni con le differenze evidenziate, scelta della corrente,
// "Offerta economica" in PDF da ogni versione (validità, condizioni, note, destinatario) con l'anteprima in pagina.
// Revisione del listino/offerta (richiesta del CEO del 07/11/2026: "nel listino/offerta devi prevedere una sezione di revisione
// listino/offerta in cui può cambiare anche solo un prezzo e noi rigeneriamo a quel punto solo il PDF del listino/offerta e mandiamo
// rifirmato solo quello!"): prezzi modificati in pagina dalla versione corrente → "Salva come versione N+1" (motivo obbligatorio), poi
// solo l'offerta economica della nuova versione (non il pacchetto, non la lettera di offerta), "Invia per la firma" con il PDF allegato
// e l'offerta firmata che torna.
import React, { useMemo, useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, Modal, Icon, Empty, UploadButton, useToast } from './ui.jsx';
import ScriviCliente from './ScriviCliente.jsx';
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
  const [rivedi, setRivedi] = useState(false);  // editor della revisione aperto
  const [invio, setInvio] = useState(null);     // email "Invia per la firma" pronta (oggetto, testo, PDF)
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Loading />;
  const corrente = d.versioni.find((v) => v.id === d.corrente_id);
  const ricarica = () => { q.reload(); onChange?.(); };
  const preparaInvio = async (v) => { try { setInvio({ v, ...(await api.get(`/hub/listini/${v.id}/revisione/email`)) }); } catch (e) { toast(e.message, 'err'); } };
  const caricaFirmata = async (v, fl) => { try { const fd = new FormData(); fd.append('file', fl[0]); const r = await api.upload(`/hub/listini/${v.id}/offerta-firmata`, fd); toast(r.gia ? `La v${r.versione} era già firmata: PDF aggiunto ai documenti` : `Offerta economica v${r.versione} firmata registrata nel diario`); ricarica(); } catch (e) { toast(e.message, 'err'); } };
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
          <div className="small muted" style={{ marginTop: 10 }}>Lo sconto medio dell'account (Dati economici) segue la versione corrente. L'offerta economica entra nel kit di proposta e nel pacchetto. Listino unico con il contratto Service: l'Excel di ogni nuova versione (anche di una revisione) diventa il listino del contratto e l'offerta economica della versione corrente il suo PDF; la versione precedente resta qui nello storico.</div>
        </Card>
        <Card title={vista ? vista.titolo : 'Anteprima'} flush actions={vista && <a className="btn sm ghost" href={docUrl(vista.id)}><Icon name="download" />Scarica</a>}>
          {vista ? <iframe className="pk-pdf" title="Anteprima" src={`${docUrl(vista.id, true)}#view=FitH`} /> : <Empty>{corrente?.offerta_documento_id ? 'Premi "Anteprima dell\'offerta"' : 'Genera l\'offerta economica per vederla qui'}</Empty>}
        </Card>
      </div>

      {corrente && <RevisioneOfferta a={a} v={corrente} prossima={d.versioni[0].versione + 1} edit={d.puo_modificare} aperta={rivedi} onApri={() => setRivedi(true)} onChiudi={() => setRivedi(false)}
        onSalvata={(r) => { setRivedi(false); toast(`Revisione salvata come v${r.versione}: ${r.differenze.cambiate.length} ${r.differenze.cambiate.length === 1 ? 'riga cambiata' : 'righe cambiate'}`); ricarica(); }}
        onOfferta={() => setOfferta(corrente)} onVedi={() => setVista({ id: corrente.offerta_documento_id, titolo: `Offerta economica v${corrente.versione}` })} onInvia={() => preparaInvio(corrente)} onFirmata={(fl) => caricaFirmata(corrente, fl)} />}

      <Card title="Versioni" className="mt" flush>
        {d.versioni.length ? <table className="t"><thead><tr><th>Versione</th><th>Caricata</th><th className="num">Esami</th><th className="num">Sconto medio</th><th>Rispetto alla precedente</th><th>Offerta economica</th><th /></tr></thead><tbody>
          {d.versioni.map((v) => <tr key={v.id} className={v.id === d.corrente_id ? 'sel' : ''}>
            <td className="strong">v{v.versione}{v.id === d.corrente_id && <> <Badge tone="teal">corrente</Badge></>}{v.origine === 'REVISIONE' && <> <Badge tone="mauve">revisione{v.base_versione ? ` della v${v.base_versione}` : ''}</Badge></>}{v.firmata_at && <> <Badge tone="green">firmata</Badge></>}<div className="small muted">{v.origine === 'REVISIONE' ? 'prezzi modificati in pagina' : v.filename}</div>{v.note && <div className="small">{v.note}</div>}</td>
            <td className="small">{itDateTime(v.caricato_at)}<div className="muted">{v.caricato_da || ''}</div></td>
            <td className="num">{v.riepilogo.esami}</td>
            <td className="num">{pct(v.riepilogo.sconto_medio)}</td>
            <td className="small">{v.diff ? <>{v.diff.cambiate} cambiate · {v.diff.aggiunte} aggiunte · {v.diff.tolte} tolte{v.diff.variazione_sconto ? <div className={v.diff.variazione_sconto > 0 ? 'green' : 'red'}>sconto medio {v.diff.variazione_sconto > 0 ? '+' : ''}{num(v.diff.variazione_sconto)} punti</div> : null}</> : <span className="muted">prima versione</span>}</td>
            <td className="small">{v.offerta_documento_id ? <><a href={docUrl(v.offerta_documento_id)}><Icon name="download" />{v.offerta_filename}</a><div className="muted">{itDateTime(v.offerta_at)}{v.offerta_dati?.validita ? ` · valida fino al ${itDate(v.offerta_dati.validita)}` : ''}</div></> : <span className="muted">non generata</span>}
              {v.revisione_inviata_at && <div className="muted">inviata per la firma il {itDateTime(v.revisione_inviata_at)}</div>}
              {v.firmata_documento_id && <div><a href={docUrl(v.firmata_documento_id)}><Icon name="download" />firmata: {v.firmata_filename}</a> <span className="muted">{itDateTime(v.firmata_at)}</span></div>}</td>
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
      {invio && <ScriviCliente a={a} titolo={`Invia per la firma l'offerta economica v${invio.versione} · da ${a.casella}`} iniziale={{ subject: invio.subject, testo: invio.testo, documenti: [invio.documento.id] }}
        extra={{ sottotipo: 'OFFERTA_REVISIONE', listino_id: invio.listino_id }} onClose={() => setInvio(null)} onDone={() => { setInvio(null); ricarica(); }} />}
    </>
  );
}

// Caricamento: file → anteprima (colonne, righe, differenze) → eventuale mapping a video → salva. La stessa modale si apre dal riquadro
// "Listino dell'offerta" del contratto (listino unico, 07/11/2026: origine 'contratto'): la versione salvata è anche il listino del contratto.
export function Carica({ a, onClose, onDone, origine = null }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [p, setP] = useState(null);
  const [mapping, setMapping] = useState(null);   // scelto a video
  const [foglio, setFoglio] = useState('');
  const [busy, setBusy] = useState(false);
  const fd = (m = mapping) => { const x = new FormData(); x.append('file', file); if (m) x.append('mapping', JSON.stringify(m)); if (foglio) x.append('foglio', foglio); x.append('note', note); if (origine) x.append('origine', origine); return x; };
  // Il file si legge da solo appena scelto (07/11/2026: il CEO non capiva perché "Salva" fosse spento: serviva prima l'anteprima).
  const leggi = async (m = mapping, f = file) => { if (!f) return; setBusy(true); try { const x = new FormData(); x.append('file', f); if (m) x.append('mapping', JSON.stringify(m)); if (foglio) x.append('foglio', foglio); const r = await api.upload(`/hub/accounts/${a.id}/listini/anteprima`, x); setP(r); if (!m) setMapping(null); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const scegli = (f) => { setFile(f); setP(null); setMapping(null); if (f) leggi(null, f); };
  const pronto = p && p.mancanti.length === 0 && p.righe_totali > 0;
  const perche = !file ? 'Scegli il file da StudioLAB' : busy ? 'Lettura del file in corso…' : !p ? 'Il file non è stato letto: premi "Leggi il file"' : p.mancanti.length ? 'Indica le colonne mancanti e premi "Applica le colonne scelte"' : !p.righe_totali ? 'Nessun esame leggibile nel file' : '';
  const salva = async () => { setBusy(true); try { const r = await api.upload(`/hub/accounts/${a.id}/listini`, fd()); toast(`Listino v${r.versione} salvato: ${r.riepilogo.esami} esami${r.contratto_id ? ', registrato anche nel contratto' : ''}`); onDone(r); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const cambiate = useMemo(() => new Set(p?.differenze?.chiavi_cambiate || []), [p]);
  const chiave = (x) => (x.codice ? `c:${String(x.codice).toUpperCase()}` : null);
  const m = mapping || p?.mapping || {};
  return (
    <Modal wide title={`Carica il listino StudioLAB · ${a.org_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button>
      {p && <button className="btn ghost" disabled={busy} onClick={() => leggi()}>Rileggi</button>}
      {pronto ? <button className="btn" disabled={busy} onClick={salva}>{busy ? 'Salvataggio…' : `Salva come versione ${p.versione}`}</button>
        : <button className="btn" disabled={!file || busy} onClick={() => leggi()} title={perche}>{busy ? 'Lettura…' : 'Leggi il file'}</button>}</>}>
      <div className="form-grid">
        <Field label="File Excel esportato da StudioLAB (.xlsx o .csv)" className="span2"><input type="file" accept=".xlsx,.csv" onChange={(e) => scegli(e.target.files[0] || null)} /></Field>
        {perche && !busy && <div className="small muted span2">{perche}{p ? '' : '. Il file viene letto appena lo scegli: qui sotto compaiono colonne, esami e differenze con la versione corrente, poi si salva come nuova versione.'}</div>}
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
  const [f, setF] = useState({ validita: v.offerta_dati?.validita || predefiniti.validita || '', condizioni: v.offerta_dati?.condizioni || predefiniti.condizioni || '', note: v.offerta_dati?.note || (v.origine === 'REVISIONE' ? '' : v.note || ''),   // il motivo di una revisione è interno: non va da solo nel PDF
    contatto_id: '' });
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
      <div className="small muted" style={{ marginTop: 8 }}>PDF su carta intestata luglio 2026: copertina con il cliente, riepilogo (esami, validità, condizioni), tabelle per settore (la colonna dello sconto solo se almeno un esame è scontato), note, firma del CEO dalle Impostazioni. La versione è nel nome del file, non nel documento. Resta nei documenti dell'account; si rigenera solo questo PDF (non il pacchetto né la lettera di offerta).</div>
    </Modal>
  );
}

// ---------------- Revisione del listino/offerta ----------------
const num2 = (v) => { const t = String(v ?? '').trim().replace(/\s|€/g, ''); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const diversi = (x, y) => Math.abs(Number(x) - Number(y)) > 0.005;

/**
 * Riquadro "Revisione del listino/offerta" della versione corrente: i tre passi dopo una revisione (offerta economica della versione,
 * invio per la firma, offerta firmata che torna) e "Rivedi i prezzi", che apre la tabella modificabile.
 */
function RevisioneOfferta({ a, v, prossima, edit, aperta, onApri, onChiudi, onSalvata, onOfferta, onVedi, onInvia, onFirmata }) {
  const passi = v.versione > 1 || v.origine === 'REVISIONE';
  return (
    <Card title="Revisione del listino/offerta" className="mt" actions={edit && !aperta && <button className="btn sm" onClick={onApri}><Icon name="edit" />Rivedi i prezzi (v{prossima} dalla v{v.versione})</button>}>
      {aperta ? <EditorRevisione a={a} v={v} prossima={prossima} onClose={onChiudi} onSalvata={onSalvata} />
        : <>
          <div className="small muted" style={{ marginBottom: passi ? 10 : 0 }}>Basta cambiare anche un solo prezzo: la revisione diventa la versione v{prossima} con il motivo e le righe cambiate nel diario; poi si rigenera solo l'offerta economica e si manda a firmare solo quella. Il contratto e la lettera di offerta non cambiano; la versione precedente resta nello storico con le differenze.</div>
          {passi && <ol className="checklist-pr">
            <li className={v.offerta_documento_id ? 'ok' : 'ko'}><span className="ico">{v.offerta_documento_id ? '✓' : '1'}</span><div style={{ flex: 1 }}><div className="strong">Offerta economica v{v.versione}</div><div className="small muted">{v.offerta_documento_id ? `${v.offerta_filename} · ${itDateTime(v.offerta_at)}` : 'Solo il PDF dell\'offerta: non il pacchetto, non la lettera di offerta'}</div></div>
              {v.offerta_documento_id && <button className="btn sm ghost" onClick={onVedi}>Anteprima</button>} {edit && <button className={`btn sm ${v.offerta_documento_id ? 'ghost' : ''}`} onClick={onOfferta}><Icon name="file" />{v.offerta_documento_id ? 'Rigenera' : 'Genera l\'offerta economica'}</button>}</li>
            <li className={v.revisione_inviata_at ? 'ok' : 'ko'}><span className="ico">{v.revisione_inviata_at ? '✓' : '2'}</span><div style={{ flex: 1 }}><div className="strong">Invia per la firma</div><div className="small muted">{v.revisione_inviata_at ? `Inviata il ${itDateTime(v.revisione_inviata_at)} (diario: email "Offerta rivista per la firma")` : `Da ${a.casella} ai referenti, con l'offerta v${v.versione} in PDF allegata; testo dal modello "Revisione dell'offerta economica" delle Impostazioni`}</div></div>
              {edit && <button className={`btn sm ${v.revisione_inviata_at ? 'ghost' : ''}`} disabled={!v.offerta_documento_id} title={v.offerta_documento_id ? '' : 'Genera prima l\'offerta economica'} onClick={onInvia}><Icon name="mail" />{v.revisione_inviata_at ? 'Invia di nuovo' : 'Invia per la firma'}</button>}</li>
            <li className={v.firmata_at ? 'ok' : 'ko'}><span className="ico">{v.firmata_at ? '✓' : '3'}</span><div style={{ flex: 1 }}><div className="strong">Offerta firmata</div><div className="small muted">{v.firmata_at ? <>Ricevuta il {itDateTime(v.firmata_at)}: <a href={docUrl(v.firmata_documento_id)}>{v.firmata_filename}</a></> : 'Carica il PDF firmato, o confermalo tra gli allegati da verificare (scheda Kit e contrattualizzazione) se arriva come risposta all\'email. Nessuna nuova contrattualizzazione.'}</div></div>
              {edit && !v.firmata_at && <UploadButton label="Carica l'offerta firmata (PDF)" accept="application/pdf" onFiles={onFirmata} />}</li>
          </ol>}
        </>}
    </Card>
  );
}

/** Tabella modificabile in pagina: offerta (e, a scelta, listino) riga per riga, ricerca, righe cambiate evidenziate, totali in tempo reale. */
function EditorRevisione({ a, v, prossima, onClose, onSalvata }) {
  const toast = useToast();
  const q = useApi(`/hub/listini/${v.id}`);
  const [mod, setMod] = useState({});           // chiave → { offerto, listino } come testo
  const [cerca, setCerca] = useState('');
  const [soloCambiate, setSoloCambiate] = useState(false);
  const [conListino, setConListino] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const righe = q.data?.righe || [];
  // valori correnti di ogni riga (modificati o originali) e righe cambiate
  const stato = useMemo(() => {
    let tl = 0; let to = 0; const cambiate = []; const errori = [];
    for (const x of righe) {
      const m = mod[x.chiave];
      const offerto = m?.offerto != null ? num2(m.offerto) : Number(x.offerto);
      const listino = m?.listino != null ? num2(m.listino) : Number(x.listino);
      if (!Number.isFinite(offerto) || offerto < 0 || !Number.isFinite(listino) || listino < 0) { errori.push(x.codice || x.descrizione); continue; }
      tl += listino; to += offerto;
      if (diversi(offerto, x.offerto) || diversi(listino, x.listino)) cambiate.push({ chiave: x.chiave, offerto, ...(diversi(listino, x.listino) ? { listino } : {}) });
    }
    return { tl, to, sconto: tl > 0 ? (1 - to / tl) * 100 : 0, cambiate, errori, chiavi: new Set(cambiate.map((c) => c.chiave)) };
  }, [righe, mod]);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const t = cerca.trim().toLowerCase();
  const visibili = righe.filter((x) => (!t || String(x.codice || '').toLowerCase().includes(t) || String(x.descrizione || '').toLowerCase().includes(t) || String(x.settore || '').toLowerCase().includes(t)) && (!soloCambiate || stato.chiavi.has(x.chiave)));
  const MAX = 300;
  const set = (k, campo, val) => setMod((m) => ({ ...m, [k]: { ...(m[k] || {}), [campo]: val } }));
  const pronto = stato.cambiate.length > 0 && !stato.errori.length && motivo.trim().length >= 5;
  const perche = stato.errori.length ? `Prezzi non validi: ${stato.errori.slice(0, 3).join(', ')}` : !stato.cambiate.length ? 'Cambia almeno un prezzo' : motivo.trim().length < 5 ? 'Scrivi il motivo della revisione' : '';
  const salva = async () => {
    setBusy(true);
    try { onSalvata(await api.post(`/hub/accounts/${a.id}/listini/${v.id}/revisione`, { righe: stato.cambiate, motivo: motivo.trim() })); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="grid g4">
        <div className="kpi card"><div className="lbl">Righe cambiate</div><div className={`val ${stato.cambiate.length ? '' : 'muted'}`}>{stato.cambiate.length}</div><div className="foot">su {righe.length} esami della v{v.versione}</div></div>
        <div className="kpi card"><div className="lbl">Totale listino</div><div className="val">{eur(stato.tl)} €</div></div>
        <div className="kpi card"><div className="lbl">Totale offerta</div><div className="val">{eur(stato.to)} €</div><div className="foot">v{v.versione}: {eur(v.riepilogo.totale_offerto)} €</div></div>
        <div className="kpi card accent"><div className="lbl">Sconto medio</div><div className="val">{pct(stato.sconto)}</div><div className="foot">v{v.versione}: {pct(v.riepilogo.sconto_medio)} (uso interno, non va nel PDF)</div></div>
      </div>
      <div className="row mt" style={{ gap: 10, flexWrap: 'wrap' }}>
        <input style={{ maxWidth: 320 }} placeholder="Cerca per codice, esame o settore" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <label className="f inline small"><input type="checkbox" checked={soloCambiate} onChange={(e) => setSoloCambiate(e.target.checked)} />Solo le righe cambiate</label>
        <label className="f inline small"><input type="checkbox" checked={conListino} onChange={(e) => setConListino(e.target.checked)} />Modifica anche il prezzo di listino</label>
        <span className="spacer" />
        {stato.cambiate.length > 0 && <button className="btn sm ghost" onClick={() => setMod({})}>Annulla le modifiche</button>}
      </div>
      <div className="table-wrap mt" style={{ maxHeight: 460 }}><table className="t small"><thead><tr><th>Codice</th><th>Esame</th><th>Settore</th><th className="num">Listino €</th><th className="num">Offerta €</th><th className="num">Sconto</th></tr></thead><tbody>
        {visibili.slice(0, MAX).map((x) => {
          const m = mod[x.chiave] || {}; const c = stato.chiavi.has(x.chiave);
          const o = m.offerto != null ? num2(m.offerto) : Number(x.offerto); const l = m.listino != null ? num2(m.listino) : Number(x.listino);
          const sc = Number.isFinite(o) && Number.isFinite(l) && l > 0 ? (1 - o / l) * 100 : 0;
          const errO = m.offerto != null && !(Number.isFinite(o) && o >= 0); const errL = m.listino != null && !(Number.isFinite(l) && l >= 0);
          return <tr key={x.chiave} style={c ? { background: '#fff4d6' } : undefined}>
            <td className="mono">{x.codice || '–'}</td><td>{x.descrizione}</td><td className="muted">{x.settore || ''}</td>
            <td className="num">{conListino ? <input className="num" style={{ width: 96, height: 28, textAlign: 'right', borderColor: errL ? 'var(--red, #c0392b)' : undefined }} value={m.listino ?? eur(x.listino)} onChange={(e) => set(x.chiave, 'listino', e.target.value)} aria-label={`Listino ${x.codice || x.descrizione}`} /> : eur(x.listino)}</td>
            <td className="num">{c && diversi(o, x.offerto) && <span className="muted" style={{ textDecoration: 'line-through', marginRight: 6 }}>{eur(x.offerto)}</span>}<input className="num" style={{ width: 96, height: 28, textAlign: 'right', fontWeight: 600, borderColor: errO ? 'var(--red, #c0392b)' : undefined }} value={m.offerto ?? eur(x.offerto)} onChange={(e) => set(x.chiave, 'offerto', e.target.value)} aria-label={`Offerta ${x.codice || x.descrizione}`} /></td>
            <td className="num">{sc > 0.05 ? pct(sc) : '–'}</td>
          </tr>;
        })}
      </tbody></table></div>
      <div className="small muted" style={{ marginTop: 4 }}>{visibili.length > MAX ? `Mostrate le prime ${MAX} righe su ${visibili.length}: usa la ricerca. ` : ''}In giallo le righe con un prezzo diverso dalla v{v.versione}. Prezzi in euro, anche con la virgola (12,50).</div>
      <div className="form-grid mt">
        <Field label="Motivo della revisione (obbligatorio)" className="span2" help="Va nelle note della versione e nel diario, es. prezzo concordato con il cliente il …"><textarea style={{ minHeight: 60 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
      </div>
      <div className="row end" style={{ marginTop: 10, gap: 8 }}>
        {perche && <span className="small muted">{perche}</span>}
        <button className="btn ghost" onClick={onClose}>Chiudi senza salvare</button>
        <button className="btn" disabled={!pronto || busy} onClick={salva}>{busy ? 'Salvataggio…' : `Salva come versione ${prossima}`}</button>
      </div>
    </>
  );
}
