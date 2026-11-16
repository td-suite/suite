// Business Hub · Ricerca prospect (fase 1 della pipeline): scoperta delle strutture per provincia e tipologia, lettura del loro sito
// (anagrafica, segnali, persone chiave), coorti "deve avere / non deve avere", punteggio con i motivi, promozione in pipeline.
// Nessuna email parte da qui: il primo contatto si fa dalla scheda dell'account.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, BASE, qs } from '../api.js';
import { useApi, Loading, ErrorBox, Badge, Modal, Field, Empty, Card, useToast } from '../components/ui.jsx';
import { origine } from '../components/CompletaDalSito.jsx';
import { LINEE, itDateTime } from '../format.js';

const STATI = { NUOVO: 'Da leggere', PROFILATO: 'Letti', PROMOSSO: 'In pipeline', SCARTATO: 'Scartati' };
const valore = (v) => (v === true ? '' : `: ${v}`);

export default function Scouting() {
  const [sp, setSp] = useSearchParams();
  const linea = ['SRV', 'PP', 'MDL'].includes(sp.get('linea')) ? sp.get('linea') : 'SRV';
  const [f, setF] = useState({ stato: 'NUOVO,PROFILATO', provincia: '', categoria: '', anagrafica: '', q: '', min: '', pubblici: '' });
  const [con, setCon] = useState([]); const [senza, setSenza] = useState([]);
  const [sel, setSel] = useState({});
  const [modal, setModal] = useState(null);
  const toast = useToast();
  const cat = useApi(`/scouting/catalogo?linea=${linea}`, [linea]);
  const ricerche = useApi(`/scouting/ricerche?linea=${linea}`, [linea]);
  const url = `/scouting/candidati${qs({ linea, ...f, con: con.join(','), senza: senza.join(',') })}`;
  const el = useApi(url, [url]);
  const inCorso = el.data?.coda?.in_corso || (ricerche.data || []).some((r) => r.stato === 'IN_CORSO');
  useEffect(() => { if (!inCorso) return undefined; const t = setInterval(() => { el.reload(); ricerche.reload(); }, 2500); return () => clearInterval(t); }, [inCorso]);
  useEffect(() => { setSel({}); }, [url]);
  const righe = el.data?.righe || [];
  const scelti = righe.filter((r) => sel[r.id]);
  const segnali = useMemo(() => (cat.data?.segnali || []).filter((s) => s.attivo), [cat.data]);
  const etichetta = (k) => segnali.find((s) => s.key === k)?.etichetta || k;
  const puo = cat.data?.puo_scrivere;
  const profila = async (ids) => { try { const r = await api.post('/scouting/candidati/profila', { ids }); toast(`${r.accodati} siti in lettura${r.senza_sito ? `, ${r.senza_sito} senza sito` : ''}`); setSel({}); el.reload(); } catch (e) { toast(e.message, 'err'); } };
  const scarta = async (ids) => { try { const r = await api.post('/scouting/candidati/scarta', { ids }); toast(`${r.scartati} scartati`); setSel({}); el.reload(); } catch (e) { toast(e.message, 'err'); } };
  const cambia = (lista, set, k) => set(lista.includes(k) ? lista.filter((x) => x !== k) : [...lista, k]);
  if (cat.error) return <div className="page"><ErrorBox error={cat.error} /></div>;
  if (!cat.data) return <div className="page"><Loading /></div>;
  const ultima = (ricerche.data || [])[0];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Ricerca prospect · {LINEE[linea]?.label || linea}</h1>
          <div className="sub">Trova le strutture, leggi dal loro sito chi sono e perché possono interessarci, porta in pipeline quelle giuste. Nessuna email parte da qui.</div></div>
        <div className="row">
          {cat.data.admin && <button className="btn ghost" onClick={() => setModal({ t: 'segnali' })}>Segnali</button>}
          {puo && <button className="btn ghost" onClick={() => setModal({ t: 'manuale' })}>+ Aggiungi a mano</button>}
          {puo && <button className="btn ghost" onClick={() => setModal({ t: 'fonti' })}>Elenchi ufficiali e file</button>}
          {puo && <button className="btn" onClick={() => setModal({ t: 'ricerca' })}>Nuova ricerca</button>}
        </div>
      </div>
      {ultima && <div className={`alert ${ultima.stato === 'ERRORE' ? 'err' : 'info'}`} style={{ marginBottom: 12, display: 'block' }}>
        {ultima.stato === 'IN_CORSO' ? <>{ultima.fonte === 'OSM' ? 'Ricerca in corso su OpenStreetMap. ' : 'Caricamento in corso. '}{ultima.avanzamento || 'In avvio'}. Finora {ultima.trovati} strutture, {ultima.nuovi} nuove. Ogni provincia richiede fino a un minuto.{' '}
          {puo && <button className="btn sm ghost" onClick={async () => { try { await api.post(`/scouting/ricerche/${ultima.id}/annulla`, {}); ricerche.reload(); } catch (e) { toast(e.message, 'err'); } }}>Annulla</button>}</>
          : ultima.stato === 'ERRORE' ? `L'ultima ricerca non è riuscita: ${ultima.errore}`
            : ultima.stato === 'ANNULLATA' ? `Ricerca annullata: ${ultima.trovati} strutture registrate prima dell'annullamento.`
              : `${ultima.fonte === 'OSM' ? 'Ultima ricerca su OpenStreetMap' : ultima.fonte === 'ELENCO' ? 'Ultimo elenco caricato' : 'Ultimo elenco ufficiale caricato'} il ${itDateTime(ultima.finita_at || ultima.created_at)} (${ultima.province.join(', ')}): ${ultima.trovati} strutture, ${ultima.nuovi} nuove.`}
        {(ultima.avvisi || []).length > 0 && ultima.stato !== 'ERRORE' && <div className="small" style={{ marginTop: 6 }}>{ultima.fonte === 'OSM' ? 'Non riuscite, da ripetere: ' : ''}{ultima.avvisi.join(' · ')}</div>}
      </div>}
      {el.data?.coda?.in_corso && <div className="alert info" style={{ marginBottom: 12 }}>Lettura dei siti in corso: {el.data.coda.fatti} di {el.data.coda.totale}. Si legge un sito alla volta, con una pausa tra le pagine.</div>}
      <div className="filters">
        <Field label="Stato"><select value={f.stato} onChange={(e) => setF({ ...f, stato: e.target.value })}><option value="NUOVO,PROFILATO">Da lavorare</option>{Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Provincia"><select value={f.provincia} onChange={(e) => setF({ ...f, provincia: e.target.value })}><option value="">Tutte</option>{Object.entries(cat.data.province).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Tipologia"><select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">Tutte</option>{cat.data.categorie.map((c) => <option key={c.key} value={c.key}>{c.etichetta}</option>)}</select></Field>
        <Field label="Anagrafica"><select value={f.anagrafica} onChange={(e) => setF({ ...f, anagrafica: e.target.value })}><option value="">Tutte</option><option value="nuovi">Non ancora in anagrafica</option><option value="noti">Già in anagrafica</option></select></Field>
        <Field label="Punteggio minimo"><input type="number" min="0" max="100" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label="Cerca"><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Nome, comune, gestore, dominio" /></Field>
      </div>
      <Card title="Coorte: scegli i segnali" className="small">
        <div className="strong">Deve avere</div>
        <div className="scout-scelte">{segnali.map((s) => <label key={s.key} title={s.descrizione}><input type="checkbox" checked={con.includes(s.key)} onChange={() => { cambia(con, setCon, s.key); setSenza(senza.filter((x) => x !== s.key)); }} />{s.etichetta}</label>)}</div>
        <div className="strong" style={{ marginTop: 8 }}>Non deve avere</div>
        <div className="scout-scelte">{segnali.filter((s) => !con.includes(s.key)).map((s) => <label key={s.key} title={s.descrizione}><input type="checkbox" checked={senza.includes(s.key)} onChange={() => cambia(senza, setSenza, s.key)} />{s.etichetta}</label>)}</div>
        <div className="muted" style={{ marginTop: 8 }}>{el.data ? `${el.data.totale} strutture corrispondono${el.data.totale > righe.length ? ` (mostrate le prime ${righe.length})` : ''} · ${el.data.profilati} con il sito già letto · ${el.data.con_sito} con un sito` : ''}
          {' · '}<label style={{ display: 'inline-flex', gap: 5 }}><input type="checkbox" checked={f.pubblici === 'si'} onChange={(e) => setF({ ...f, pubblici: e.target.checked ? 'si' : '' })} />mostra anche le strutture pubbliche</label></div>
      </Card>
      <ErrorBox error={el.error} />
      <Card flush>
        {el.loading && !el.data ? <Loading /> : !righe.length ? <Empty>Nessuna struttura. Avvia una ricerca per provincia e tipologia, oppure aggiungi a mano una struttura che conosci.</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th style={{ width: 30 }}>{puo && <input type="checkbox" aria-label="Seleziona tutti" checked={scelti.length === righe.length} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(righe.map((r) => [r.id, true])) : {})} />}</th>
              <th>Punti</th><th>Struttura</th><th>Segnali</th><th>Sito e recapiti</th><th>Anagrafica</th></tr></thead>
            <tbody>{righe.map((r) => (
              <tr key={r.id} className="click" onClick={() => setModal({ t: 'scheda', id: r.id })}>
                <td onClick={(e) => e.stopPropagation()}>{puo && <input type="checkbox" aria-label={`Seleziona ${r.nome}`} checked={Boolean(sel[r.id])} onChange={(e) => setSel((o) => ({ ...o, [r.id]: e.target.checked }))} />}</td>
                <td><span className={`scout-punti ${r.punteggio >= 60 ? 'alto' : r.punteggio < 25 ? 'basso' : ''}`}>{r.punteggio ?? '–'}</span></td>
                <td><div className="strong">{r.nome}</div><div className="small muted">{[cat.data.categorie.find((c) => c.key === r.categoria)?.etichetta, [r.comune, r.provincia].filter(Boolean).join(' '), r.operatore].filter(Boolean).join(' · ')}{r.pubblico ? ' · gestore pubblico' : ''}</div></td>
                <td><div className="scout-segni">{Object.entries(r.segnali || {}).filter(([k]) => segnali.some((s) => s.key === k) && !['PIVA_NOTA', 'DOMINIO_RICEVE_POSTA', 'EMAIL_GENERALE', 'SCHEMA_EMAIL', 'PEC_NOTA', 'DECISORE_NOTO'].includes(k)).slice(0, 7)
                  .map(([k, v]) => <Badge key={k} tone={k === 'SENZA_SITO' || k === 'LAB_INTERNO' ? 'amber' : 'teal'}>{etichetta(k)}{typeof v.valore === 'number' || k === 'FORNITORE_LAB' ? valore(v.valore) : ''}</Badge>)}
                  {r.persone > 0 && <Badge tone="blue">{r.persone} {r.persone === 1 ? 'persona' : 'persone'}</Badge>}</div></td>
                <td className="small">{r.sito ? <span>{r.dominio}</span> : <span className="muted">nessun sito</span>}
                  <div className="muted">{r.errore_profilo ? r.errore_profilo : r.profilato_at ? `letto il ${itDateTime(r.profilato_at)}` : r.sito ? 'sito da leggere' : ''}</div><div className="muted">{[r.email, r.telefono].filter(Boolean).join(' · ')}</div></td>
                <td className="small" onClick={(e) => e.stopPropagation()}>{r.account_id ? <Link to={`${BASE}/account/${r.account_id}`}>{r.stato === 'PROMOSSO' ? 'In pipeline' : 'Già account'}</Link> : r.organization_id ? <span title={`Trovata per ${r.abbinato_come}`}>Già in anagrafica: {r.org_name}</span> : <span className="muted">nuova</span>}</td>
              </tr>))}</tbody>
          </table></div>)}
        {puo && scelti.length > 0 && <div className="scout-barra"><strong>{scelti.length} selezionate</strong>
          <button className="btn sm" onClick={() => profila(scelti.map((x) => x.id))}>Leggi i siti</button>
          <button className="btn sm ghost" onClick={() => scarta(scelti.map((x) => x.id))}>Scarta</button>
          <span className="small muted">La lettura usa solo le pagine pubbliche del sito della struttura e rispetta le sue regole per i programmi automatici.</span></div>}
      </Card>
      {modal?.t === 'ricerca' && <NuovaRicerca linea={linea} cat={cat.data} onClose={() => setModal(null)} onFatto={() => { setModal(null); ricerche.reload(); el.reload(); }} />}
      {modal?.t === 'fonti' && <Fonti linea={linea} cat={cat.data} onClose={() => setModal(null)} onFatto={() => { ricerche.reload(); el.reload(); }} />}
      {modal?.t === 'manuale' && <AggiungiAMano linea={linea} cat={cat.data} onClose={() => setModal(null)} onFatto={() => { setModal(null); el.reload(); }} />}
      {modal?.t === 'segnali' && <Segnali cat={cat.data} onClose={() => setModal(null)} onFatto={() => { setModal(null); cat.reload(); }} />}
      {modal?.t === 'scheda' && <Scheda id={modal.id} cat={cat.data} puo={puo} onClose={() => setModal(null)} onCambio={() => el.reload()} />}
    </div>
  );
}

function NuovaRicerca({ linea, cat, onClose, onFatto }) {
  const toast = useToast();
  const [prov, setProv] = useState([]); const [tipi, setTipi] = useState([]); const [busy, setBusy] = useState(false);
  const avvisi = cat.categorie.filter((c) => tipi.includes(c.key) && c.avviso);
  const vai = async () => { setBusy(true); try { await api.post('/scouting/ricerche', { linea, province: prov, categorie: tipi }); toast('Ricerca avviata'); onFatto(); } catch (e) { toast(e.message, 'err'); setBusy(false); } };
  const sw = (l, set, k) => set(l.includes(k) ? l.filter((x) => x !== k) : [...l, k]);
  return (
    <Modal title="Nuova ricerca" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !prov.length || !tipi.length} onClick={vai}>Cerca</button></>}>
      <p className="small muted">Fonte: OpenStreetMap, gratuita. Riporta nome, indirizzo, telefono, sito e gestore delle strutture. Ogni provincia richiede fino a un minuto: con tutta la Toscana e molte tipologie servono alcuni minuti. Se una provincia non risponde le altre proseguono.</p>
      <div className="strong small">Province</div>
      <div className="scout-scelte">{Object.entries(cat.province).map(([k, v]) => <label key={k}><input type="checkbox" checked={prov.includes(k)} onChange={() => sw(prov, setProv, k)} />{v}</label>)}</div>
      <div className="strong small" style={{ marginTop: 12 }}>Tipologie</div>
      <div className="scout-scelte">{cat.categorie.map((c) => <label key={c.key}><input type="checkbox" checked={tipi.includes(c.key)} onChange={() => sw(tipi, setTipi, c.key)} />{c.etichetta}</label>)}</div>
      {avvisi.map((c) => <div key={c.key} className="alert info" style={{ marginTop: 10 }}>{c.avviso}</div>)}
    </Modal>
  );
}
function Fonti({ linea, cat, onClose, onFatto }) {
  const toast = useToast();
  const d = useApi(`/scouting/fonti?linea=${linea}`, [linea]);
  const [busy, setBusy] = useState(null); const [esito, setEsito] = useState({}); const [categoria, setCategoria] = useState(cat.categorie[0]?.key || 'ALTRO');
  const invia = async (chiave, file) => {
    setBusy(chiave); setEsito((o) => ({ ...o, [chiave]: null }));
    try {
      const fd = new FormData(); fd.append('linea', linea); if (file) fd.append('file', file); if (chiave === 'ELENCO') fd.append('categoria', categoria);
      const r = await api.upload(chiave === 'ELENCO' ? '/scouting/elenco' : `/scouting/fonti/${chiave}`, fd);
      setEsito((o) => ({ ...o, [chiave]: { ok: true, testo: `${r.trovati} strutture, ${r.nuovi} nuove${(r.avvisi || []).length ? `. ${r.avvisi.join(' ')}` : ''}` } }));
      toast('Elenco caricato'); d.reload(); onFatto();
    } catch (e) { setEsito((o) => ({ ...o, [chiave]: { ok: false, testo: e.message } })); } finally { setBusy(null); }
  };
  const scegli = (chiave, accept) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => i.files[0] && invia(chiave, i.files[0]); i.click(); };
  return (
    <Modal wide title="Elenchi ufficiali e file" onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Chiudi</button>}>
      <p className="small muted">Gli elenchi del Ministero della Salute sono la fonte stabile: completi, con partita IVA, sempre disponibili. Non riportano sito e telefono: dopo il caricamento indica il sito delle strutture che ti interessano e la Suite ne legge anagrafica, segnali e persone chiave.</p>
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : d.data.map((f) => (
        <div key={f.chiave} style={{ borderTop: '1px solid rgba(0,0,0,.08)', padding: '12px 0' }}>
          <div className="row between"><div><strong>{f.etichetta}</strong> <span className="small muted">· {f.ente} · aggiornamento {f.aggiornamento}</span><div className="small muted">{f.nota}</div>
            {f.ultimo && <div className="small">Caricato il {itDateTime(f.ultimo.finita_at)}: {f.ultimo.trovati} strutture.</div>}</div>
            <div className="row tight"><button className="btn sm" disabled={Boolean(busy)} onClick={() => invia(f.chiave)}>{busy === f.chiave ? 'Carico…' : f.ultimo ? 'Aggiorna dal Ministero' : 'Carica dal Ministero'}</button>
              <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => scegli(f.chiave, '.csv')}>Carica il file</button></div></div>
          {esito[f.chiave] && <div className={`alert ${esito[f.chiave].ok ? 'ok' : 'err'}`} style={{ marginTop: 8, display: 'block' }}>{esito[f.chiave].testo}{!esito[f.chiave].ok && <> <a href={f.pagina} target="_blank" rel="noreferrer noopener">Apri la pagina del Ministero</a></>}</div>}
        </div>))}
      <div style={{ borderTop: '1px solid rgba(0,0,0,.08)', padding: '12px 0' }}>
        <div className="row between"><div><strong>Un tuo elenco</strong> <span className="small muted">· CSV o Excel</span>
          <div className="small muted">La prima riga contiene i nomi delle colonne. Serve almeno il nome; riconosciute anche sito, partita IVA, indirizzo, CAP, comune, provincia, telefono, email, gruppo. Con il sito, la lettura parte dalla tabella.</div></div>
          <div className="row tight"><select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Tipologia delle strutture del file">{cat.categorie.map((c) => <option key={c.key} value={c.key}>{c.etichetta}</option>)}</select>
            <button className="btn sm" disabled={Boolean(busy)} onClick={() => scegli('ELENCO', '.csv,.xlsx,.txt')}>{busy === 'ELENCO' ? 'Carico…' : 'Carica il file'}</button></div></div>
        {esito.ELENCO && <div className={`alert ${esito.ELENCO.ok ? 'ok' : 'err'}`} style={{ marginTop: 8, display: 'block' }}>{esito.ELENCO.testo}</div>}
      </div>
      <p className="small muted">Per RSA, poliambulatori e aziende non esiste un elenco ufficiale aggiornato e scaricabile: usa "Nuova ricerca" (OpenStreetMap), "Aggiungi a mano" o un tuo elenco.</p>
    </Modal>
  );
}
function AggiungiAMano({ linea, cat, onClose, onFatto }) {
  const toast = useToast();
  const [v, setV] = useState({ nome: '', sito: '', categoria: cat.categorie[0]?.key || 'ALTRO', comune: '', provincia: '' });
  const salva = async () => { try { await api.post('/scouting/candidati', { linea, ...v }); toast(v.sito ? 'Aggiunta: il sito è in lettura' : 'Aggiunta'); onFatto(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title="Aggiungi una struttura che conosci" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={v.nome.trim().length < 2} onClick={salva}>Aggiungi</button></>}>
      <Field label="Nome"><input value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} autoFocus /></Field>
      <Field label="Sito" help="Con il sito la Suite legge subito anagrafica, segnali e persone chiave."><input value={v.sito} onChange={(e) => setV({ ...v, sito: e.target.value })} placeholder="www.nomestruttura.it" /></Field>
      <div className="grid g2"><Field label="Tipologia"><select value={v.categoria} onChange={(e) => setV({ ...v, categoria: e.target.value })}>{cat.categorie.map((c) => <option key={c.key} value={c.key}>{c.etichetta}</option>)}</select></Field>
        <Field label="Comune"><input value={v.comune} onChange={(e) => setV({ ...v, comune: e.target.value })} /></Field></div>
      <Field label="Provincia"><select value={v.provincia} onChange={(e) => setV({ ...v, provincia: e.target.value })}><option value="">non indicata</option>{Object.entries(cat.province).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
    </Modal>
  );
}
function Segnali({ cat, onClose, onFatto }) {
  const toast = useToast();
  const [att, setAtt] = useState(Object.fromEntries(cat.segnali.map((s) => [s.key, s.attivo])));
  const [forn, setForn] = useState(cat.impostazioni.fornitori.join('\n'));
  const [maxp, setMaxp] = useState(cat.impostazioni.max_persone);
  const salva = async () => { try { await api.put('/scouting/segnali', { attivi: att, fornitori: forn.split('\n').map((x) => x.trim()).filter((x) => x.length >= 3), max_persone: Number(maxp) }); toast('Impostazioni salvate'); onFatto(); } catch (e) { toast(e.message, 'err'); } };
  const gruppi = [...new Set(cat.segnali.map((s) => s.gruppo))];
  return (
    <Modal wide title="Segnali da cercare sui siti" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={salva}>Salva</button></>}>
      <p className="small muted">Un segnale è un fatto verificabile letto dal sito della struttura. Spegni quelli che non ti servono: non verranno più cercati né mostrati. Valgono dalla prossima lettura.</p>
      {gruppi.map((g) => <div key={g} style={{ marginBottom: 10 }}><div className="strong small">{g}</div>
        {cat.segnali.filter((s) => s.gruppo === g).map((s) => <label key={s.key} className="check-riga small"><input type="checkbox" checked={att[s.key] !== false} onChange={(e) => setAtt({ ...att, [s.key]: e.target.checked })} /><span><strong>{s.etichetta}</strong> · {s.descrizione}</span></label>)}</div>)}
      <Field label="Laboratori da riconoscere come fornitore attuale (uno per riga)"><textarea rows={6} value={forn} onChange={(e) => setForn(e.target.value)} /></Field>
      <Field label="Persone chiave al massimo per struttura"><input type="number" min="1" max="6" value={maxp} onChange={(e) => setMaxp(e.target.value)} /></Field>
    </Modal>
  );
}

function Scheda({ id, cat, puo, onClose, onCambio }) {
  const d = useApi(`/scouting/candidati/${id}`, [id]);
  const utenti = useApi('/hub/utenti');
  const toast = useToast();
  const [scelte, setScelte] = useState({}); const [owner, setOwner] = useState(''); const [fase, setFase] = useState(1); const [sito, setSito] = useState(''); const [busy, setBusy] = useState(false); const [vies, setVies] = useState(null);
  useEffect(() => { if (d.data) { setScelte(Object.fromEntries(d.data.persone.map((p) => [p.id, true]))); setSito(d.data.candidato.sito || ''); setVies(d.data.candidato.profilo?.vies || null); } }, [d.data]);
  if (!d.data) return <Modal wide title="Struttura" onClose={onClose}>{d.error ? <ErrorBox error={d.error} /> : <Loading />}</Modal>;
  const { candidato: c, persone, org, fit } = d.data;
  const an = c.profilo?.anagrafica || {};
  const et = (k) => cat.segnali.find((s) => s.key === k)?.etichetta || k;
  const fai = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); d.reload(); onCambio(); return r; } catch (e) { toast(e.message, 'err'); return null; } finally { setBusy(false); } };
  const promuovi = () => fai(() => api.post(`/scouting/candidati/${c.id}/promuovi`, { fase, owner_user_id: owner ? Number(owner) : null, persone: Object.keys(scelte).filter((k) => scelte[k]).map(Number) }),
    (r) => (r.gia ? 'Era già in pipeline' : `In pipeline${r.org_creata ? ', Legal entity creata' : ', Legal entity già in anagrafica'}, ${r.referenti} referenti`));
  const dato = (etich, k, extra) => (an[k]?.valore || extra) && <tr><td className="muted">{etich}</td><td><strong>{an[k]?.valore || extra}</strong></td><td className="muted small">{an[k]?.url && <a href={an[k].url} target="_blank" rel="noreferrer noopener">{origine(an[k].url)}</a>}</td></tr>;
  return (
    <Modal wide title={c.nome} onClose={onClose} footer={puo && c.stato !== 'PROMOSSO' && c.stato !== 'SCARTATO' ? <>
      <button className="btn ghost" disabled={busy} onClick={() => fai(() => api.put(`/scouting/candidati/${c.id}`, { stato: 'SCARTATO' }), 'Scartata').then(onClose)}>Scarta</button>
      <select value={fase} onChange={(e) => setFase(Number(e.target.value))} aria-label="Fase di arrivo"><option value={1}>Fase 1 · Lead</option><option value={0}>Prospect censito</option></select>
      <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Owner: nessuno</option>{(utenti.data || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <button className="btn" disabled={busy} onClick={promuovi}>Porta in pipeline</button></> : null}>
      <div className="row between small" style={{ marginBottom: 10 }}>
        <div><span className={`scout-punti ${fit.punteggio >= 60 ? 'alto' : ''}`}>{fit.punteggio}</span> <span className="muted">{[cat.categorie.find((x) => x.key === c.categoria)?.etichetta, [c.indirizzo, c.cap, c.comune, c.provincia].filter(Boolean).join(' '), c.operatore].filter(Boolean).join(' · ')}</span></div>
        <div>{c.account_id ? <Link to={`${BASE}/account/${c.account_id}`}>Apri l'account</Link> : org ? <Badge tone="amber">Già in anagrafica: {org.name} (per {c.abbinato_come})</Badge> : <Badge>Non in anagrafica</Badge>}</div>
      </div>
      {puo && c.stato !== 'PROMOSSO' && <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label="Sito" className="scout-grow"><input value={sito} onChange={(e) => setSito(e.target.value)} placeholder="www.nomestruttura.it" /></Field>
        <button className="btn ghost" style={{ marginBottom: 10 }} disabled={busy || sito.trim().length < 4} onClick={() => fai(() => (sito.trim() !== (c.sito || '') ? api.put(`/scouting/candidati/${c.id}`, { sito }) : api.post('/scouting/candidati/profila', { ids: [c.id] })), 'Sito in lettura: riapri la scheda tra qualche secondo')}>{c.profilato_at ? 'Rileggi il sito' : 'Leggi il sito'}</button>
      </div>}
      {c.errore_profilo && <div className="alert info">{c.errore_profilo}</div>}
      <div className="grid g2">
        <div>
          <div className="strong small">Anagrafica letta dal sito</div>
          <table className="t small"><tbody>
            {dato('Ragione sociale', 'ragione_sociale')}{dato('Partita IVA', 'piva', c.piva)}{dato('PEC', 'pec')}{dato('Email', 'email', c.email)}{dato('Telefono', 'telefono', c.telefono)}{dato('Indirizzo', 'indirizzo', c.indirizzo)}{dato('Comune', 'comune', c.comune)}
          </tbody></table>
          {c.piva && <div className="small" style={{ marginTop: 6 }}>
            {puo && <button className="btn sm ghost" disabled={busy} onClick={async () => { setBusy(true); try { setVies(await api.post(`/scouting/candidati/${c.id}/verifica-piva`, {})); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}>Verifica la partita IVA (VIES)</button>}{' '}
            <a href="https://www.ufficiocamerale.it/trova-azienda" target="_blank" rel="noreferrer noopener">Apri Ufficio Camerale</a>
            {vies && (vies.ok ? <div className="scout-evidenza">{vies.attiva ? 'Partita IVA attiva' : 'Partita IVA NON attiva'}{vies.denominazione ? ` · ${vies.denominazione}` : ''}{vies.indirizzo ? ` · ${vies.indirizzo}` : ''}<div className="muted">Fonte: {vies.fonte}</div></div> : <div className="scout-evidenza">{vies.errore}</div>)}
          </div>}
          <div className="strong small" style={{ marginTop: 14 }}>Perché questo punteggio</div>
          <table className="t small"><tbody>{fit.motivi.map((m, i) => <tr key={i}><td style={{ width: 44 }} className="num">{m.punti > 0 ? '+' : ''}{m.punti}</td><td>{m.perche}</td></tr>)}</tbody></table>
        </div>
        <div>
          <div className="strong small">Persone chiave</div>
          {persone.length ? <table className="t small"><tbody>{persone.map((p) => <tr key={p.id}>
            <td style={{ width: 26 }}>{puo && !p.contatto_id && c.stato !== 'PROMOSSO' && <input type="checkbox" aria-label={`Porta ${p.nome} tra i referenti`} checked={Boolean(scelte[p.id])} onChange={(e) => setScelte((o) => ({ ...o, [p.id]: e.target.checked }))} />}</td>
            <td><strong>{p.nome}</strong><div className="muted">{p.titolo}</div>{p.email && <div>{p.email} <Badge tone={p.email_stato === 'PUBBLICATA' ? 'teal' : 'amber'}>{p.email_stato === 'PUBBLICATA' ? 'pubblicata' : 'ipotesi, da verificare'}</Badge></div>}
              <div className="scout-evidenza">{p.evidenza} {p.url && <a href={p.url} target="_blank" rel="noreferrer noopener">{origine(p.url)}</a>}</div></td></tr>)}</tbody></table>
            : <div className="small muted">{c.profilato_at ? 'Il sito non nomina persone con un ruolo di direzione.' : 'Leggi il sito per trovarle.'}</div>}
          <div className="strong small" style={{ marginTop: 14 }}>Segnali</div>
          {Object.keys(c.segnali || {}).length ? Object.entries(c.segnali).map(([k, v]) => <div key={k} className="small"><strong>{et(k)}</strong>{valore(v.valore)}
            <div className="scout-evidenza">{v.evidenza} {v.url && <a href={v.url} target="_blank" rel="noreferrer noopener">{origine(v.url)}</a>}</div></div>) : <div className="small muted">Nessun segnale.</div>}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>Fonte: {c.fonte === 'OSM' ? <a href={`https://www.openstreetmap.org/${c.fonte_ref}`} target="_blank" rel="noreferrer noopener">OpenStreetMap</a> : c.fonte === 'MINISTERO' ? `Ministero della Salute, ${c.tags?.elenco || 'open data'}${c.tags?.tipologia ? ` (${c.tags.tipologia})` : ''}` : c.fonte === 'ELENCO' ? 'elenco caricato da file' : 'inserimento manuale'}{(c.profilo?.pagine || []).length ? ` · ${c.profilo.pagine.length} pagine del sito lette` : ''}. Gli indirizzi segnati "ipotesi" non entrano tra i referenti come email: restano nella nota, da verificare.</div>
    </Modal>
  );
}
