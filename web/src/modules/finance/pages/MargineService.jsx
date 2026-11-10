// Margine per cliente Service nel Controllo di gestione di Finance Management (CEO, 08/11/2026). Clienti Service ATTIVI e
// CONTRATTUALIZZATI (public.clienti_attivi_v), produzione del mese dalla fonte migliore (inserita o caricata qui, StudioLAB da Retail o
// Ordini, stima dall'account del Business Hub), ricavo ai prezzi del listino del cliente, costi diretti (ritiri, costo analitico degli
// esami, pagamenti Finance del cliente), margine. Le ipotesi hanno il badge "stima". Calcoli sul server (GET /controllo/margine-service).
// v0.68.4 (CEO 10/11/2026): stime solo dei clienti ATTIVI e in pro quota sul periodo (FY atteso × giorni lavorativi dopo l'avvio / 250);
// colonna "Proiezione FY" (fatturato atteso pieno) a parte, mai sommata; i contrattualizzati non avviati senza produzione non compaiono.
import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs, fileUrl } from '../api.js';
import { useAuth, canManage } from '../auth.jsx';
import { useApi, Card, Kpi, Modal, Badge, Icon, Loading, ErrorBox, Field, MoneyInput, useToast } from '../components/ui.jsx';
import { eur } from '../format.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const pct = (v) => (v == null ? '' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const n0 = (v) => Number(v || 0).toLocaleString('it-IT');
const FONTE_TONE = { STUDIOLAB: 'teal', SYNCLAB: 'green', MANUALE: 'blue', STIMA: 'mauve' };
// Documenti emessi (Synclab Data API, ex "Fatturato da documenti"; v0.68.5 il ricavo Service è la PRODUZIONE ACCETTATA): documenti emessi nel mese, grandezza diversa dalla produzione: colonna a parte, mai sommata
const DOC_TITLE = 'Dato secondario: contributo al fatturato netto dei documenti economici Synclab con data nel mese (note di credito già negative). Non è sommato al ricavo né al margine: il ricavo Service è la produzione accettata del mese (accettazioni negli stati della produzione, importi di riga e sconto di testata come da impostazioni), i documenti emessi sono un\'altra grandezza.';
const LIVELLO = { ATTIVO: ['green', 'attivo'], CONTRATTUALIZZATO: ['blue', 'in avvio'] };
const meseLabel = (mk) => { const [y, m] = mk.split('-'); return `${MESI[Number(m) - 1]} ${y}`; };

function Note({ t }) {
  return <>{t.stime.length ? <span title={`Ipotesi: ${t.stime.join(', ')}`}><Badge tone="mauve">stima</Badge></span> : null}{t.da_indicare.length ? <> <span title={t.da_indicare.join('; ')}><Badge tone="red">da indicare</Badge></span></> : null}</>;
}

// Dettaglio del cliente mese per mese (anno intero)
function DettaglioCliente({ orgId, anno, onClose }) {
  const d = useApi(`/controllo/margine-service/cliente/${orgId}?anno=${anno}`);
  const c = d.data?.cliente;
  return (
    <Modal title={c ? `${c.org_name} · ${anno} mese per mese` : 'Cliente'} wide onClose={onClose} footer={<button className="btn" onClick={onClose}>Chiudi</button>}>
      {d.error && <ErrorBox error={d.error} />}
      {!c ? (!d.error && <Loading />) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Listino corrente: {c.listino ? `versione ${c.listino.versione} (${c.listino.esami} esami)` : 'nessuno nel Business Hub'} · contratto Service: {c.contratto ? `${c.contratto.status.toLowerCase()}, ritiri fissi il ${c.contratto.giorni_ritiro.map((g) => ({ mon: 'lun', tue: 'mar', wed: 'mer', thu: 'gio', fri: 'ven', sat: 'sab' }[g])).join(', ') || 'nessun giorno'}` : 'nessuno vigente'}</p>
          <div className="table-wrap"><table className="t" data-testid="margine-cliente-mesi">
            <thead><tr><th>Mese</th><th>Fonte</th><th className="num">Esami</th><th className="num">Ricavo</th>{c.totale.fatturato_documenti != null && <th className="num" title={DOC_TITLE}>Documenti emessi (secondario)</th>}<th className="num">Ritiri</th><th className="num">Costo ritiri</th><th className="num">Costo esami</th><th className="num">Pagamenti</th><th className="num">Margine</th><th>Note</th></tr></thead>
            <tbody>
              {Object.entries(c.mesi).map(([mk, m]) => m.futuro ? <tr key={mk} className="muted"><td style={{ whiteSpace: 'nowrap' }}>{meseLabel(mk)}</td><td colSpan={c.totale.fatturato_documenti != null ? 10 : 9} className="small">mese futuro</td></tr> : (
                <tr key={mk}>
                  <td style={{ whiteSpace: 'nowrap' }}>{meseLabel(mk)}</td>
                  <td>{m.produzione ? <span title={m.produzione.origine}><Badge tone={FONTE_TONE[m.produzione.fonte]}>{m.produzione.fonte.toLowerCase()}</Badge></span> : <span className="muted small">nessuna</span>}</td>
                  <td className="num">{n0(m.esami)}</td>
                  <td className="num">{m.ricavo == null ? (m.esami ? <Badge tone="red">da indicare</Badge> : '–') : eur(m.ricavo)}{m.ricavo_da === 'LISTINO' ? <div className="small muted">a listino</div> : m.ricavo_da === 'SYNCLAB' ? <div className="small muted">produzione accettata</div> : null}{m.produzione?.note ? <div className="small muted" title={m.produzione.note}>vedi nota</div> : null}</td>
                  {c.totale.fatturato_documenti != null && <td className="num" title={m.documenti?.note || DOC_TITLE}>{m.fatturato_documenti == null ? '–' : eur(m.fatturato_documenti)}</td>}
                  <td className="num">{m.ritiri ?? '–'}{m.ritiri_a_chiamata ? <div className="small muted">+{m.ritiri_a_chiamata} a chiamata</div> : null}</td>
                  <td className="num">{m.costo_ritiri == null ? <Badge tone="red">da indicare</Badge> : eur(m.costo_ritiri)}</td>
                  <td className="num">{m.costo_esami == null ? <Badge tone="red">da indicare</Badge> : eur(m.costo_esami)}</td>
                  <td className="num" title={(m.pagamenti_righe || []).map((p) => `${p.protocol || p.id} ${p.beneficiary_name} ${eur(p.amount)}`).join('\n')}>{eur(m.pagamenti)}</td>
                  <td className="num strong">{m.margine == null ? '–' : eur(m.margine)}<div className="small muted">{pct(m.margine_pct)}</div></td>
                  <td><Note t={m} /></td>
                </tr>
              ))}
              <tr className="pl-sum"><td>Totale {anno}</td><td /><td className="num">{n0(c.totale.esami)}</td><td className="num">{eur(c.totale.ricavo)}</td>{c.totale.fatturato_documenti != null && <td className="num">{eur(c.totale.fatturato_documenti)}</td>}<td /><td className="num">{eur(c.totale.costo_ritiri)}</td><td className="num">{eur(c.totale.costo_esami)}</td><td className="num">{eur(c.totale.pagamenti)}</td><td className="num">{eur(c.totale.margine)}<div className="small muted">{pct(c.totale.margine_pct)}</div></td><td><Note t={c.totale} /></td></tr>
            </tbody>
          </table></div>
        </>
      )}
    </Modal>
  );
}

// Inserimento manuale della produzione di un cliente in un mese
function ProduzioneModal({ clienti, mese, onClose, onSaved }) {
  const [f, setF] = useState({ org_id: clienti[0]?.org_id || '', mese, esami: '', valore: '', fonte: 'MANUALE', note: '' });
  const [err, setErr] = useState(null);
  const save = async () => { setErr(null); try { await api.post('/controllo/produzione', { ...f, esami: Number(f.esami || 0) }); onSaved('Produzione salvata'); } catch (e) { setErr(e); } };
  return (
    <Modal title="Produzione del cliente" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Cliente Service" className="span2"><select value={f.org_id} onChange={(e) => setF({ ...f, org_id: Number(e.target.value) })}>{clienti.map((c) => <option key={c.org_id} value={c.org_id}>{c.org_name}</option>)}</select></Field>
        <Field label="Mese"><input type="month" value={f.mese} onChange={(e) => setF({ ...f, mese: e.target.value })} /></Field>
        <Field label="Fonte"><select value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })}><option value="MANUALE">Manuale</option><option value="STUDIOLAB">StudioLAB (dato del gestionale)</option><option value="STIMA">Stima</option></select></Field>
        <Field label="Esami"><input type="number" min={0} value={f.esami} onChange={(e) => setF({ ...f, esami: e.target.value })} /></Field>
        <Field label="Valore della produzione (€)" help="Vuoto: si usa il listino del cliente se la produzione ha il dettaglio per esame"><MoneyInput value={f.valore} onChange={(v) => setF({ ...f, valore: v })} /></Field>
        <Field label="Note" className="span2"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Una riga per cliente e mese: salvando di nuovo si sostituisce. La produzione inserita qui prevale su quella che arriva da StudioLAB e sulla stima.</p>
    </Modal>
  );
}

// Caricamento XLSX: prova (anteprima senza scritture), poi carica
function ImportModal({ mese, onClose, onSaved }) {
  const ref = useRef();
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const go = async (prova) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', file); fd.append('mese', mese);
    try { const r = await api.upload(`/controllo/produzione/import${prova ? '?prova=1' : ''}`, fd); setRes(r); if (!prova) onSaved(`Produzione caricata: ${r.righe.length} righe`); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Carica la produzione da XLSX" wide onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn ghost" disabled={!file} onClick={() => go(true)}>Prova</button><button className="btn" disabled={!file || !res?.prova} onClick={() => go(false)}>Carica</button></>}>
      <ErrorBox error={err} />
      <p className="small" style={{ marginTop: 0 }}>Colonne riconosciute: <b>Cliente</b> (codice StudioLAB, P.IVA o ragione sociale), <b>Mese</b> (AAAA-MM; senza colonna vale {meseLabel(mese)}), <b>Esami</b>, <b>Valore</b>, e facoltative <b>Codice esame</b> e <b>Descrizione</b> (una riga per esame: il ricavo si calcola ai prezzi del listino del cliente) e <b>Fonte</b> (MANUALE, STUDIOLAB, STIMA). Prima "Prova": nessuna scrittura.</p>
      <input ref={ref} type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); }} />
      {res && (
        <div style={{ marginTop: 12 }}>
          <div className="small">{res.prova ? 'Anteprima' : 'Caricato'}: {res.righe.length} righe cliente/mese{res.scartate.length ? `, ${res.scartate.length} scartate` : ''}. Colonne: {Object.entries(res.colonne).map(([k, v]) => `${k} = "${v}"`).join(', ')}</div>
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t"><thead><tr><th>Cliente</th><th>Mese</th><th className="num">Esami</th><th className="num">Valore</th><th>Righe per esame</th><th>Fonte</th></tr></thead>
            <tbody>{res.righe.map((r, i) => <tr key={i}><td>{r.org_name}</td><td>{r.mese}</td><td className="num">{n0(r.esami)}</td><td className="num">{eur(r.valore)}</td><td className="num">{r.righe_esame}</td><td>{r.fonte}</td></tr>)}
              {res.scartate.map((s, i) => <tr key={`s${i}`} className="muted"><td colSpan={6} className="small red">Riga {s.riga} ({s.cliente}): {s.motivo}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </Modal>
  );
}

export default function MargineService() {
  const toast = useToast();
  const { user } = useAuth();
  const manager = canManage(user);
  const [sp, setSp] = useSearchParams();
  const oggi = new Date();
  const anno = Number(sp.get('anno') || oggi.getFullYear());
  const mese = sp.has('mese') ? sp.get('mese') : String(oggi.getMonth() + 1);
  const set = (k, v) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  const q = qs({ anno, mese });
  const d = useApi(`/controllo/margine-service${q}`);
  const prod = useApi(`/controllo/produzione${q}`);
  const [sort, setSort] = useState({ k: 'margine', dir: -1 });
  const [modal, setModal] = useState(null);
  const [cliente, setCliente] = useState(sp.get('org') ? Number(sp.get('org')) : null);
  const x = d.data;
  const meseDef = mese ? `${anno}-${String(mese).padStart(2, '0')}` : `${anno}-${String(oggi.getMonth() + 1).padStart(2, '0')}`;
  const righe = useMemo(() => {
    const val = (c) => ({ cliente: c.org_name.toLowerCase(), esami: c.totale.esami, ricavo: c.totale.ricavo ?? -Infinity, costi: c.totale.costi_diretti, margine: c.totale.margine ?? -Infinity, pct: c.totale.margine_pct ?? -Infinity }[sort.k]);
    return [...(x?.clienti || [])].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [x, sort]);
  const Th = ({ k, children, num }) => <th className={`${num ? 'num ' : ''}click`} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : (k === 'cliente' ? 1 : -1) })}>{children}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;
  const saved = (msg) => { toast(msg); setModal(null); d.reload(); prod.reload(); };
  const stime = async () => { try { const r = await api.post('/controllo/produzione/stime', { anno, mese: mese || null }); saved(`Stime salvate: ${r.salvate.length}`); } catch (e) { toast(e.message, 'err'); } };
  const del = async (id) => { try { await api.del(`/controllo/produzione/${id}`); saved('Produzione eliminata'); } catch (e) { toast(e.message, 'err'); } };
  const anni = [oggi.getFullYear() + 1, oggi.getFullYear(), oggi.getFullYear() - 1, oggi.getFullYear() - 2];
  const T = x?.totale;
  const conDoc = T?.fatturato_documenti != null;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Margine per cliente Service</h1><div className="sub">Produzione, ricavo ai prezzi dell'offerta, costi diretti e margine dei clienti Service attivi; stime in pro quota e proiezione FY a parte.</div></div>
        <div className="row">
          <select style={{ width: "auto" }} value={anno} onChange={(e) => set('anno', e.target.value)} aria-label="Anno">{anni.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select style={{ width: "auto" }} value={mese} onChange={(e) => set('mese', e.target.value)} aria-label="Mese"><option value="">Anno intero</option>{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <a className="btn ghost" href={fileUrl(`/controllo/margine-service/export.xlsx${q}`)}><Icon name="download" />XLSX</a>
          <a className="btn ghost" href={fileUrl(`/controllo/margine-service/export.pdf${q}`)} target="_blank" rel="noreferrer"><Icon name="print" />PDF</a>
        </div>
      </div>
      {d.error && <ErrorBox error={d.error} />}
      {!x ? (!d.error && <Loading />) : (
        <>
          {Object.entries(x.fonti).filter(([, f]) => f && f.disponibile === false).map(([k, f]) => <div key={k} className="alert warn small" style={{ marginBottom: 8 }}>{f.nota}</div>)}
          {x.avvisi.map((a, i) => <div key={i} className="alert info small" style={{ marginBottom: 8 }}>{a}</div>)}
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <Kpi label="Clienti Service" value={x.clienti.length} foot={`${x.clienti.filter((c) => c.livello === 'ATTIVO').length} attivi${x.clienti.some((c) => c.livello !== 'ATTIVO') ? `, ${x.clienti.filter((c) => c.livello !== 'ATTIVO').length} in avvio con produzione` : ''}${x.esclusi_non_attivi?.length ? ` · ${x.esclusi_non_attivi.length} contrattualizzati non avviati esclusi` : ''}`} />
            <Kpi label={`Esami · ${x.periodo.etichetta}`} value={n0(T.esami)} foot={T.fonti.length ? `fonti: ${T.fonti.join(', ').toLowerCase()}` : 'nessuna produzione'} />
            <Kpi label="Ricavo effettivo" value={eur(T.ricavo_effettivo)} foot={<span data-testid="ms-effettivo">con stime {eur(T.ricavo)}{T.ricavo_stime ? ` · stime ${eur(T.ricavo_stime)} (${x.clienti.filter((c) => c.totale.ricavo_stime).length} clienti)` : ' · nessuna stima'}{T.ricavo_parziale ? ' · in parte da indicare' : ''}</span>} />
            <Kpi accent label="Margine di linea effettivo" value={T.margine_effettivo == null ? 'n.d.' : eur(T.margine_effettivo)} foot={`con stime ${T.margine == null ? 'n.d.' : eur(T.margine)} · ${pct(T.margine_pct)}`} />
          </div>
          <div className="alert info small" style={{ marginBottom: 12 }} data-testid="ms-proiezione">Stime in pro quota sul periodo (solo clienti attivi, mesi senza produzione effettiva): <b>{eur(T.ricavo_stime || 0)}</b> · <b>Proiezione FY {x.proiezione?.anno}</b> (fatturato atteso pieno di {x.proiezione?.clienti || 0} clienti attivi, non sommata): <b>{eur(x.proiezione?.importo || 0)}</b></div>
          <Card title={`Clienti · ${x.periodo.etichetta}`} flush actions={manager && <div className="row">
            <button className="btn sm ghost" onClick={() => setModal('prod')} disabled={!x.clienti.length}><Icon name="plus" />Produzione</button>
            <button className="btn sm ghost" onClick={() => setModal('import')}><Icon name="upload" />Carica XLSX</button>
            <button className="btn sm ghost" onClick={stime} title="Salva come STIMA la stima in pro quota dei clienti attivi senza produzione (le righe già presenti non cambiano)">Salva le stime</button>
          </div>}>
            <div className="table-wrap"><table className="t" data-testid="margine-service">
              <thead><tr><Th k="cliente">Cliente</Th><th>Fonte</th><Th k="esami" num>Esami</Th><Th k="ricavo" num>Ricavo</Th>{conDoc && <th className="num" title={DOC_TITLE}>Documenti emessi (secondario)</th>}<Th k="costi" num>Costi diretti</Th><Th k="margine" num>Margine</Th><Th k="pct" num>Margine %</Th><th className="num" title="Fatturato FY atteso pieno della scheda account (solo clienti attivi): non sommato">Proiezione FY {x.proiezione?.anno}</th><th>Note</th></tr></thead>
              <tbody>
                {righe.map((c) => {
                  const t = c.totale; const [tone, lab] = LIVELLO[c.livello] || ['grey', c.livello];
                  return (
                    <tr key={c.org_id} className="click" onClick={() => setCliente(c.org_id)} title="Dettaglio mese per mese">
                      <td><b>{c.org_name}</b> <Badge tone={tone}>{lab}</Badge>{!c.listino ? <div className="small muted">senza listino nel Business Hub</div> : null}</td>
                      <td>{t.fonti.length ? t.fonti.map((f) => <Badge key={f} tone={FONTE_TONE[f]}>{f.toLowerCase()}</Badge>) : <span className="small muted">nessuna produzione</span>}</td>
                      <td className="num">{n0(t.esami)}</td>
                      <td className="num">{t.ricavo == null ? (t.esami ? <Badge tone="red">da indicare</Badge> : '–') : eur(t.ricavo)}</td>
                      {conDoc && <td className="num" title={DOC_TITLE}>{t.fatturato_documenti == null ? '–' : eur(t.fatturato_documenti)}</td>}
                      <td className="num" title={`Ritiri ${eur(t.costo_ritiri)} · esami ${eur(t.costo_esami)} · pagamenti ${eur(t.pagamenti)}`}>{eur(t.costi_diretti)}</td>
                      <td className="num strong">{t.margine == null ? '–' : eur(t.margine)}</td>
                      <td className="num">{pct(t.margine_pct)}</td>
                      <td className="num muted">{c.proiezione_fy ? eur(c.proiezione_fy.importo) : '–'}</td>
                      <td><Note t={t} /></td>
                    </tr>
                  );
                })}
                {!righe.length && <tr><td colSpan={conDoc ? 10 : 9} className="empty">Nessun cliente Service attivo nel Business Hub.</td></tr>}
                <tr className="pl-sum" data-testid="ms-tot-effettivo"><td>Totale effettivo <span className="small muted">(produzione Synclab, StudioLAB, manuale)</span></td><td /><td className="num">{n0(T.esami - (T.esami_stimati || 0))}</td><td className="num">{eur(T.ricavo_effettivo)}</td>{conDoc && <td className="num">{eur(T.fatturato_documenti)}</td>}<td className="num">{eur(T.costi_diretti)}</td><td className="num">{T.margine_effettivo == null ? '–' : eur(T.margine_effettivo)}</td><td /><td /><td /></tr>
                <tr className="pl-prev" data-testid="ms-tot-stime"><td>Totale con le stime <span className="small muted">({n0(T.esami_stimati || 0)} esami stimati, non sono produzione)</span></td><td /><td className="num">{n0(T.esami)}</td><td className="num">{eur(T.ricavo)}</td>{conDoc && <td />}<td className="num">{eur(T.costi_diretti)}</td><td className="num">{T.margine == null ? '–' : eur(T.margine)}</td><td className="num">{pct(T.margine_pct)}</td><td className="num muted">{eur(x.proiezione?.importo || 0)}</td><td><Note t={T} /></td></tr>
              </tbody>
            </table></div>
          </Card>
          <div className="grid g2 mt">
            <Card title="Produzione inserita o caricata nel periodo" flush>
              <table className="t"><thead><tr><th>Cliente</th><th>Mese</th><th>Fonte</th><th className="num">Esami</th><th className="num">Valore</th><th /></tr></thead>
                <tbody>{(prod.data || []).map((p) => <tr key={p.id}><td>{p.org_name}{p.note ? <div className="small muted">{p.note}</div> : null}</td><td>{meseLabel(p.mese)}</td><td><Badge tone={FONTE_TONE[p.fonte]}>{p.fonte.toLowerCase()}</Badge>{p.righe ? <div className="small muted">{p.righe} righe per esame</div> : null}</td><td className="num">{n0(p.esami)}</td><td className="num">{eur(p.valore)}</td><td className="num">{manager && <button className="iconbtn" title="Elimina" onClick={() => del(p.id)}><Icon name="trash" /></button>}</td></tr>)}
                  {!(prod.data || []).length && <tr><td colSpan={6} className="small muted">Nessuna produzione inserita: valgono StudioLAB (Retail, Ordini) o la stima dal Business Hub.</td></tr>}</tbody></table>
            </Card>
            <Card title="Come è calcolato">
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{(x.come_calcolato || []).map((t, i) => <li key={i}>{t}</li>)}</ul>
            </Card>
          </div>
        </>
      )}
      {modal === 'prod' && <ProduzioneModal clienti={x.clienti} mese={meseDef} onClose={() => setModal(null)} onSaved={saved} />}
      {modal === 'import' && <ImportModal mese={meseDef} onClose={() => setModal(null)} onSaved={saved} />}
      {cliente && <DettaglioCliente orgId={cliente} anno={anno} onClose={() => { setCliente(null); if (sp.get('org')) { const n = new URLSearchParams(sp); n.delete('org'); setSp(n, { replace: true }); } }} />}
    </div>
  );
}
