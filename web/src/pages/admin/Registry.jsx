import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, useToast, Modal, Switch, Tabs, ConfirmModal } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { SITE_KIND, ORG_KIND, PERSON_KIND, LEVEL } from '../../format.js';
import SitesMap from '../../components/SitesMap.jsx';
import { OrgAccessModal } from './OrgAccess.jsx';

// Chip dei riferimenti alle sorgenti legacy: { cash: 12, nc: "SITE-3", ... } oppure [{source, id}]
export function LegacyRefs({ refs }) {
  if (!refs) return null;
  const list = Array.isArray(refs) ? refs.map((r) => [r.source || r.key, r.id ?? r.ref]) : Object.entries(refs);
  if (!list.length) return null;
  return <div className="row tight" style={{ gap: 4 }}>{list.map(([k, v], i) => <span key={i} className="chip" title={`Riferimento in ${k}`}><Icon name="external" />{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>)}</div>;
}

// Modale generica di modifica (campi: {key,label,type,options,help})
// Orari di apertura per giorno: fino a due fasce (mattina, pomeriggio); "copia agli altri giorni" dal lunedì
const DAYS = [['mon', 'Lunedì'], ['tue', 'Martedì'], ['wed', 'Mercoledì'], ['thu', 'Giovedì'], ['fri', 'Venerdì'], ['sat', 'Sabato'], ['sun', 'Domenica']];
function HoursEditor({ value, onChange }) {
  const v = value || {};
  const ranges = (d) => { const r = v[d] || []; return [r[0] || null, r[1] || null]; };
  const setRange = (d, i, field, val) => {
    const cur = ranges(d); const r = { ...(cur[i] || { from: '', to: '' }), [field]: val }; cur[i] = r;
    const clean = cur.filter((x) => x && (x.from || x.to));
    onChange({ ...v, [d]: clean });
  };
  const clearDay = (d) => { const n = { ...v }; delete n[d]; onChange(n); };
  const copyToAll = (d) => { const src = v[d] || []; const n = { ...v }; for (const [k] of DAYS) if (k !== d && k !== 'sun') n[k] = src.map((x) => ({ ...x })); onChange(n); };
  return (
    <div className="hours-editor">
      <div className="hd"><span>Giorno</span><span>Mattina</span><span>Pomeriggio</span><span /></div>
      {DAYS.map(([d, label]) => { const [a, b] = ranges(d); const closed = !a && !b; return (
        <div key={d} className={`row-day ${closed ? 'closed' : ''}`}>
          <span className="dl">{label}</span>
          <span className="rg"><input type="time" value={a?.from || ''} onChange={(e) => setRange(d, 0, 'from', e.target.value)} /><i>–</i><input type="time" value={a?.to || ''} onChange={(e) => setRange(d, 0, 'to', e.target.value)} /></span>
          <span className="rg"><input type="time" value={b?.from || ''} onChange={(e) => setRange(d, 1, 'from', e.target.value)} /><i>–</i><input type="time" value={b?.to || ''} onChange={(e) => setRange(d, 1, 'to', e.target.value)} /></span>
          <span className="ac">{closed ? <span className="tiny faint">Chiuso</span> : <><button type="button" className="link tiny" onClick={() => copyToAll(d)}>Copia agli altri giorni</button><button type="button" className="link tiny" onClick={() => clearDay(d)}>Chiuso</button></>}</span>
        </div>
      ); })}
      <div className="tiny muted" style={{ marginTop: 6 }}>La domenica non riceve la copia automatica. Il testo riassuntivo per Rubrica e meteo viene composto da solo.</div>
    </div>
  );
}

// Spilla di confidenza accanto a un campo letto da Claude nel PDF: verde alta, gialla media, rossa bassa; citazione al passaggio del mouse
const CONF_LABEL = { alta: 'confidenza alta', media: 'confidenza media', bassa: 'confidenza bassa' };
export function ConfPin({ c }) {
  if (!c) return null;
  return <span className={`conf-pin ${c.level}`} title={`Letto nel PDF, ${CONF_LABEL[c.level] || c.level}${c.quote ? `: "${c.quote}"` : ''}`} aria-label={CONF_LABEL[c.level] || c.level} />;
}

// Campi: { key, label, type, options, help, when(f) per mostrarlo solo in certi casi, onSet(valore, f) → altri campi da aggiornare }.
// type 'section' = titolo di sezione, 'custom' = render(f, patch, item) a tutta larghezza. f._conf = confidenza dei campi letti dal PDF.
function EditModal({ title, fields, item, onSave, onClose, extra }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(fields.filter((x) => !['section', 'custom'].includes(x.type)).map((x) => [x.key, x.type === 'date' && item?.[x.key] ? String(item[x.key]).slice(0, 10) : item?.[x.key] ?? (x.init !== undefined ? x.init : x.type === 'bool' ? (x.default ?? true) : x.type === 'hours' ? null : '')])));
  const [busy, setBusy] = useState(false);
  const patch = (p) => setF((cur) => ({ ...cur, ...p }));
  // valore di un campo con eventuale effetto sugli altri (es. Legal entity ospitante → titolo Ospitata)
  const setVal = (x, val) => setF((cur) => ({ ...cur, [x.key]: val, ...(x.onSet ? x.onSet(val, { ...cur, [x.key]: val }) : {}) }));
  const shown = (x) => !x.when || x.when(f);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = {};
    for (const x of fields) { if (['action', 'static', 'section', 'custom'].includes(x.type) || x.local) continue; const v = f[x.key]; body[x.key] = x.type === 'bool' ? Boolean(v) : x.type === 'number' ? (v === '' ? null : Number(v)) : x.type === 'hours' ? (v && Object.values(v).some((r) => r?.length) ? Object.fromEntries(Object.entries(v).filter(([, r]) => r?.length).map(([d, r]) => [d, r.filter((x) => x.from && x.to)])) : null) : v === '' ? null : v; }
    try { await onSave(body); onClose(); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="eform" disabled={busy}>Salva</button></>}>
      <form id="eform" onSubmit={save} className="form-grid">
        {fields.filter(shown).map((x) => x.type === 'section' ? <div key={x.key} className="span-all form-section"><h3>{x.label}</h3>{x.help && <div className="small muted">{x.help}</div>}</div>
          : x.type === 'custom' ? <div key={x.key} className="span-all">{x.render(f, patch, item)}</div> : (
          <Field key={x.key} label={<>{x.label}<ConfPin c={f._conf?.[x.key]} /></>} help={typeof x.help === 'function' ? x.help(f) : x.help} required={x.required} className={x.full ? 'span-all' : x.wide ? 'span2' : ''}>
            {x.type === 'static' ? <div className="static-val">{x.value(item)}</div>
              : x.type === 'action' ? <div style={{ paddingTop: 2 }}><button type="button" className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); try { await x.run(f, (patch) => setF((cur) => ({ ...cur, ...patch }))); } catch (e2) { toast(e2, 'err'); } setBusy(false); }}><Icon name={x.icon || 'refresh'} />{x.button}</button>{x.help2 && <div className="small muted mt">{x.help2}</div>}</div>
              : x.type === 'hours' ? <HoursEditor value={f[x.key]} onChange={(val) => setF({ ...f, [x.key]: val })} />
              : x.type === 'select' ? <select value={f[x.key] ?? ''} onChange={(e) => { setVal(x, e.target.value); if (x.resets) patch(Object.fromEntries(x.resets.map((k) => [k, '']))); }}>{!x.required && <option value="">{x.empty || 'Nessuno'}</option>}{(x.optionsFor ? x.optionsFor(f) : x.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : x.type === 'bool' ? <div style={{ paddingTop: 6 }}><Switch checked={f[x.key]} onChange={(v) => setF({ ...f, [x.key]: v })} label={x.label} /></div>
                : x.type === 'textarea' ? <textarea value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} style={{ minHeight: 60 }} />
                  : <input type={x.type === 'number' ? 'number' : x.type || 'text'} step={x.step} min={x.min} placeholder={typeof x.placeholder === 'function' ? x.placeholder(f) : x.placeholder} value={f[x.key] ?? ''} onChange={(e) => setVal(x, e.target.value)} required={x.required} maxLength={x.max} />}
          </Field>
        ))}
      </form>
      {extra}
    </Modal>
  );
}

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

// Cestino di riga: conferma, poi DELETE; il server rifiuta se ci sono dati collegati (si disattiva invece di eliminare)
function DeleteButton({ label, text, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="iconbtn danger" aria-label={`Elimina ${label}`} title="Elimina" onClick={() => setOpen(true)}><Icon name="trash" /></button>
      {open && <ConfirmModal title={`Eliminare ${label}?`} text={text} danger confirmText="Elimina" onConfirm={onDelete} onClose={() => setOpen(false)} />}
    </>
  );
}

// Foto della sede: fino a 3, su Azure Blob
function SitePhotos({ site, onClose }) {
  const toast = useToast();
  const [ids, setIds] = useState(site.photo_file_ids || []);
  const [busy, setBusy] = useState(false);
  const add = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); setBusy(true);
      try { const r = await api.upload(`/sites/${site.id}/photos`, fd); setIds((x) => [...x, r.id]); toast('Foto caricata'); } catch (e) { toast(e, 'err'); }
      setBusy(false);
    };
    input.click();
  };
  const remove = async (fid) => { try { await api.del(`/sites/${site.id}/photos/${fid}`); setIds((x) => x.filter((i) => i !== fid)); toast('Foto rimossa'); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title={`Foto · ${site.name}`} onClose={onClose}>
      <div className="site-photos">
        {ids.map((fid) => <div key={fid} className="ph"><img src={`/api/files/${fid}`} alt="" /><button className="iconbtn" aria-label="Rimuovi" onClick={() => remove(fid)}><Icon name="x" /></button></div>)}
        {ids.length < 3 && <button type="button" className="ph add" disabled={busy} onClick={add}><Icon name="upload" /><span>{busy ? 'Caricamento' : 'Aggiungi foto'}</span></button>}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>Massimo 3 foto per sede (JPEG, PNG o WebP). Richiede Azure Blob configurato in Impostazioni.</div>
    </Modal>
  );
}

// ---------- Titolo di godimento e locazione della sede (fonte unica per Payments e Facility) ----------
export const TENURE = { PROPRIETA: 'Proprietà', LOCAZIONE: 'Locazione', COMODATO: 'Comodato', OSPITATA: 'Ospitata da Legal entity' };
const RENT_PERIOD = { MESE: 'al mese', TRIMESTRE: 'al trimestre', SEMESTRE: 'al semestre', ANNO: 'all\'anno' };
const PERIOD_N = { MESE: 12, TRIMESTRE: 4, SEMESTRE: 2, ANNO: 1 };
const RENT_VAT = { PIU_IVA: 'Più IVA', ESENTE: 'Esente IVA (art. 10 DPR 633/72)', IVA_INCLUSA: 'IVA inclusa' };
const REGISTRATION = { IMPOSTA_ANNUALE: 'Imposta di registro annuale', UNICA_SOLUZIONE: 'Registro in unica soluzione', CEDOLARE_SECCA: 'Cedolare secca', DA_REGISTRARE: 'Da registrare' };
const eurIt = (v) => (v == null || v === '' ? '–' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
// Fine del primo periodo: decorrenza + anni (come il server, lib/leaseSync.js)
export function leaseEndOf(start, years) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) || !(Number(years) > 0)) return '';
  const [y, m, d] = String(start).split('-').map(Number);
  const ty = y + Number(years); const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const RENT_PERIOD_OPT = { MESE: 'Mensile', TRIMESTRE: 'Trimestrale', SEMESTRE: 'Semestrale', ANNO: 'Annuale' };

// Riepilogo del canone: annuo e con IVA
function RentSummary({ f }) {
  if (f.rent_amount === '' || f.rent_amount == null) return null;
  const year = Number(f.rent_amount) * (PERIOD_N[f.rent_period] || 12);
  const rate = Number(f.rent_vat_rate || 22);
  const vat = f.rent_vat === 'PIU_IVA' ? year * rate / 100 : 0;
  return <div className="small muted">Canone annuo {eurIt(year)}{f.rent_vat === 'PIU_IVA' ? ` + IVA ${rate}% (${eurIt(vat)}) = ${eurIt(year + vat)}` : f.rent_vat === 'IVA_INCLUSA' ? ` IVA ${rate}% inclusa` : f.rent_vat === 'ESENTE' ? ', esente IVA' : ''}</div>;
}

// Riquadro "Carica il contratto in PDF": Claude legge locatore, canone, durata e garanzie e precompila i campi (si controlla e si salva)
function LeasePdfBox({ site, f, patch, onOrgCreated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [doc, setDoc] = useState(site?.lease_document || null);
  const inputRef = React.useRef(null);
  if (!site?.id) return <div className="pdf-box small muted"><Icon name="file" />Salva la sede: poi puoi caricare il contratto di locazione in PDF e farlo leggere a Claude.</div>;
  const read = async (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('Carica un file PDF', 'err'); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.upload(`/sites/${site.id}/lease-document`, fd);
      // i campi letti sostituiscono quelli del form (null = non letto, il form resta com'è); l'utente controlla e salva
      const read = Object.fromEntries(Object.entries(r.proposta?.fields || {}).filter(([k, v]) => v != null && v !== '' && k in f).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
      patch({ ...read, _conf: r.proposta?.confidence || {} });
      setRes(r); setDoc(r.document);
      toast('Contratto letto: controlla i campi con la spilla e salva');
    } catch (e) { toast(e, 'err'); }
    setBusy(false); if (inputRef.current) inputRef.current.value = '';
  };
  const createOrg = async () => {
    setBusy(true);
    try { const o = await api.post(`/sites/${site.id}/lease-document/landlord`); patch({ lease_landlord_org_id: String(o.id) }); onOrgCreated?.(); toast(o.existing ? `Locatore già in anagrafica: ${o.name}` : `Legal entity ${o.name} creata (da rivedere in Legal entity)`); setRes((x) => ({ ...x, proposta: { ...x.proposta, landlord: { ...x.proposta.landlord, id: o.id, label: o.name, how: o.existing ? o.how : 'creata dal contratto' } } })); }
    catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const L = res?.proposta?.landlord;
  return (
    <div className="pdf-box">
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <Icon name="file" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>Carica il contratto in PDF</b>
          <div className="small muted">Claude legge locatore, canone, IVA, durata e garanzie e precompila i campi: controlli e salvi tu. Il PDF resta qui ed è lo stesso che vede Payments.{busy ? ' Lettura in corso…' : ''}</div>
          {doc && <div className="small" style={{ marginTop: 4 }}><a href={`/api/sites/${site.id}/lease-document?doc=${doc.id}`} target="_blank" rel="noreferrer"><Icon name="file" />{doc.filename}</a> <span className="muted">· {Math.round(doc.size / 1024)} KB{doc.model ? ` · letto ${doc.model === 'mock' ? 'in prova' : 'con Claude'}` : ''}</span></div>}
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => read(e.target.files?.[0])} />
        <button type="button" className="btn ghost" disabled={busy} onClick={() => inputRef.current?.click()}><Icon name="upload" />{busy ? 'Lettura…' : doc ? 'Carica un altro PDF' : 'Scegli il PDF'}</button>
      </div>
      {res && <div className="small" style={{ marginTop: 8 }}>
        Locatore: {L?.id ? <><b>{L.label}</b> <span className="muted">({L.how})</span></> : <><span className="red">{L?.read ? `${L.read}: non in anagrafica` : 'non letto'}</span> {L?.read && <button type="button" className="btn sm ghost" disabled={busy} onClick={createOrg}>Crea Legal entity dal contratto</button>}</>}
        {res.avvisi?.length > 0 && <div className="alert warn" style={{ marginTop: 6, flexDirection: 'column', gap: 2 }}>{res.avvisi.map((a, i) => <div key={i}>{a}</div>)}</div>}
      </div>}
    </div>
  );
}

// Riquadro "Planimetria": fonte unica per tutta la Suite (public.site_documents kind PLANIMETRIA). La più recente è la corrente, va in
// Room Planning e Facility la mostra nella scheda dell'immobile; le precedenti restano come storico. Si salva subito, senza il form.
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const isPdfPlan = (d) => /pdf/.test(d?.mime || '') || /\.pdf$/i.test(d?.filename || '');
function SitePlanBox({ site, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(site?.planimetria || null);
  const [list, setList] = useState(null);
  const [del, setDel] = useState(null);
  const inputRef = React.useRef(null);
  const loadList = React.useCallback(async () => { if (site?.id) { try { setList((await api.get(`/sites/${site.id}/planimetria?list=1`)).rows); } catch { setList([]); } } }, [site?.id]);
  useEffect(() => { if (site?.planimetria) loadList(); }, [loadList, site?.planimetria]);
  if (!site?.id) return <div className="pdf-box small muted"><Icon name="image" />Salva la sede: poi puoi caricare la planimetria (PDF o immagine), che diventa disponibile in Room Planning e Facility.</div>;
  const url = (d) => `/api/sites/${site.id}/planimetria?doc=${d.id}`;
  const roomMsg = (r) => (r?.published ? 'pubblicata in Room Planning' : r?.reason || '');
  const upload = async (file) => {
    if (!file) return;
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name) && !/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) { toast('Carica un PDF o un\'immagine PNG, JPEG o WebP', 'err'); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.upload(`/sites/${site.id}/planimetria`, fd);
      setPlan(r.document); await loadList(); onChange?.();
      toast(`Planimetria caricata${roomMsg(r.room) ? `: ${roomMsg(r.room)}` : ''}`, r.room?.published ? undefined : 'warn');
    } catch (e) { toast(e, 'err'); }
    setBusy(false); if (inputRef.current) inputRef.current.value = '';
  };
  const remove = async (d) => {
    const r = await api.del(`/sites/${site.id}/planimetria?doc=${d.id}`);
    const rows = (await api.get(`/sites/${site.id}/planimetria?list=1`)).rows;
    setList(rows); setPlan(rows[0] || null); onChange?.();
    toast(!r.deleted.was_current ? 'Versione eliminata dallo storico' : rows[0] ? `Planimetria eliminata: torna corrente la versione del ${fmtDate(rows[0].created_at)}${r.room?.published ? ', ripubblicata in Room Planning' : ''}` : 'Planimetria eliminata, tolta anche da Room Planning');
  };
  const older = (list || []).filter((d) => !d.current);
  return (
    <div className="pdf-box plan-box">
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <Icon name="image" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>Planimetria</b>
          <div className="small muted">PDF o immagine (PNG, JPEG, WebP, fino a 25 MB). È la stessa per tutta la Suite: va in Room Planning per posizionare gli ambulatori e Facility la mostra nella scheda dell'immobile.{busy ? ' Caricamento…' : ''}</div>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" className="btn ghost" disabled={busy} onClick={() => inputRef.current?.click()}><Icon name="upload" />{busy ? 'Caricamento…' : plan ? 'Carica nuova versione' : 'Carica planimetria'}</button>
      </div>
      {plan && <div className="plan-current">
        {!isPdfPlan(plan) && <a href={url(plan)} target="_blank" rel="noreferrer" className="plan-thumb"><img src={url(plan)} alt="Planimetria" /></a>}
        <div className="small" style={{ flex: 1, minWidth: 200 }}>
          <div><a href={url(plan)} target="_blank" rel="noreferrer"><Icon name={isPdfPlan(plan) ? 'pdf' : 'image'} />{plan.filename}</a> <span className="muted">· {Math.round(plan.size / 1024)} KB · corrente dal {fmtDate(plan.created_at)}</span></div>
          <div className="row tight" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {plan.published_room_at ? <Badge tone="green">Disponibile in Room Planning e Facility</Badge> : <Badge tone="amber">In Facility; Room Planning non aggiornato</Badge>}
            {isPdfPlan(plan) && <a className="small" href={url(plan)} target="_blank" rel="noreferrer">Anteprima</a>}
            <button type="button" className="linklike small red" disabled={busy} onClick={() => setDel(plan)}>Elimina</button>
          </div>
          {!plan.published_room_at && <div className="small muted" style={{ marginTop: 4 }}>Room Planning non è avviato o non ha accettato il file: la pubblicazione si ripete al prossimo caricamento o dalla scheda dell'immobile in Facility.</div>}
        </div>
      </div>}
      {older.length > 0 && <details className="small" style={{ marginTop: 6 }}>
        <summary>Storico: {older.length} {older.length === 1 ? 'versione precedente' : 'versioni precedenti'}</summary>
        <ul className="plan-history">{older.map((d) => <li key={d.id}><a href={url(d)} target="_blank" rel="noreferrer">{d.filename}</a> <span className="muted">· {fmtDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}{d.source ? ` · da ${d.source}` : ''}</span> <button type="button" className="linklike small red" disabled={busy} onClick={() => setDel(d)}>Elimina</button></li>)}</ul>
      </details>}
      {del && <ConfirmModal title="Eliminare la planimetria?" danger confirmText="Elimina" onConfirm={() => remove(del)} onClose={() => setDel(null)}
        text={del.id === plan?.id ? (older.length ? `"${del.filename}" è la corrente: torna corrente la versione precedente, che viene ripubblicata in Room Planning.` : `"${del.filename}" è l'unica planimetria: viene tolta anche da Room Planning e da Facility.`) : `Eliminare dallo storico "${del.filename}"? La corrente non cambia.`} />}
    </div>
  );
}

// Contratto collegato nello Scadenziario strutture di Payments: canone vigente e scatti (gli scatti ISTAT restano di Payments)
function PaymentsLeaseBox({ site, f }) {
  const { data } = useApi(site?.id ? `/sites/${site.id}/lease` : null);
  const L = data?.lease;
  return (
    <div className="small muted lease-payments">
      <Icon name="finance-sign" />
      {L ? <span>Collegato al contratto n. {L.id} dello Scadenziario strutture di Payments{L.current_amount != null ? `: rata vigente ${eurIt(L.current_amount)}` : ''}{L.steps?.length > 1 ? ` (${L.steps.length} scatti: ${L.steps.map((x) => `${x.valid_from.split('-').reverse().join('/')} ${eurIt(x.amount)}`).join(', ')})` : ''}. Le modifiche al canone qui aggiornano lo scatto iniziale; gli scatti ISTAT si registrano in Payments.</span>
        : <span>{f.rent_amount !== '' && f.lease_start ? 'Al salvataggio il contratto viene creato nello Scadenziario strutture di Payments (se Payments è avviato), con il canone come scatto iniziale e il PDF collegato.' : 'Con canone e decorrenza, al salvataggio il contratto nasce anche nello Scadenziario strutture di Payments: non va reinserito.'}</span>}
    </div>
  );
}

// ---------- Sedi ----------
export function Sites() {
  const { data, loading, error, reload } = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [photos, setPhotos] = useState(null);
  // Due elenchi distinti: le sedi della rete Toscana Diagnostica e le strutture dei clienti service (sedi gemelle SRV-<codice StudioLAB>, create dalle organizzazioni)
  const [tab, setTab] = useState('td');
  const [showMap, setShowMap] = useState(true);
  const [focusId, setFocusId] = useState(null);
  // ?sede=<id>: apre direttamente il form della sede (rimando "Modifica in Amministrazione > Sedi" da Facility)
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('sede'));
    const s0 = id && (data || []).find((x) => x.id === id);
    if (s0) { setModal(s0); window.history.replaceState(null, '', window.location.pathname); }
  }, [data]);
  const norm = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isService = (s) => s.kind === 'SERVICE';
  const all = data || [];
  const rows = all.filter((s) => (tab === 'service' ? isService(s) : !isService(s))).filter((s) => !q || norm(`${s.code} ${s.name} ${s.short_name || ''} ${s.address || ''} ${s.zip || ''} ${s.city || ''} ${s.province || ''} ${s.organization_name || ''} ${s.studiolab_code || ''}`).includes(norm(q)));
  const fields = [
    { key: 'code', label: 'Codice', required: true, max: 40 }, { key: 'name', label: 'Nome', required: true }, { key: 'short_name', label: 'Nome breve' },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(SITE_KIND) }, { key: 'organization_id', label: 'Legal entity', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'host_organization_id', label: 'Legal entity ospitante', type: 'select', options: (orgs.data || []).filter((o) => !['GRUPPO', 'SOCIETA'].includes(o.kind)).map((o) => ({ value: o.id, label: o.name })), help: 'Il partner che ospita la sede (es. G.B. Center per il Punto Prelievi di Quarrata): è la Legal entity con cui accede alla Suite e vede le royalties in Cash. Vuoto per le sedi proprie.',
      onSet: (v, f) => (v ? { tenure: 'OSPITATA' } : f.tenure === 'OSPITATA' ? { tenure: 'LOCAZIONE' } : {}) },
    { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 },
    { key: 'phone', label: 'Telefono' }, { key: 'email', label: 'Email', type: 'email' }, { key: '_manager', label: 'Responsabile di sede', type: 'static', value: (it) => it?.manager_name ? `${it.manager_name}${it.manager_role ? ` · ${it.manager_role}` : ''}` : 'Da assegnare', help: 'Dall\'organigramma: è il responsabile del nodo Sede in Organizzazione (incarico con flag Responsabile). Non si scrive qui.' }, { key: 'opening_hours_json', label: 'Orari di apertura', type: 'hours', full: true },
    { key: 'opened_at', label: 'Data di apertura', type: 'date', help: 'Primo giorno di attività della sede: la leggono Cash (da quando attende il rendiconto) e Retail (scheda sede).' },
    // Titolo di godimento e locazione: fonte unica letta da Payments (Scadenziario strutture) e da Facility (Immobili)
    { key: '_tit', type: 'section', label: 'Titolo di godimento', help: 'Proprietà, locazione, comodato o ospitata. Payments e Facility lo leggono da qui: canone e contratto non vanno reinseriti altrove.' },
    { key: 'tenure', label: 'Titolo di godimento', type: 'select', required: true, init: 'LOCAZIONE', options: opts(TENURE), help: (f) => (f.tenure === 'OSPITATA' && !f.host_organization_id ? 'Ospitata richiede la Legal entity ospitante (campo sopra)' : f.host_organization_id && f.tenure !== 'OSPITATA' ? 'C\'è una Legal entity ospitante: di norma la sede è Ospitata' : f.tenure === 'OSPITATA' ? 'Nessun canone TD: la sede è nei locali della Legal entity ospitante' : null) },
    { key: '_plan', type: 'custom', render: (_f, _p, it) => <SitePlanBox site={it} onChange={reload} /> },
    { key: '_pdf', type: 'custom', when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), render: (f, patch, it) => <LeasePdfBox site={it} f={f} patch={patch} onOrgCreated={orgs.reload} /> },
    { key: 'rent_amount', label: 'Canone (importo della rata)', type: 'number', step: '0.01', min: 0, when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'rent_period', label: 'Periodicità della rata', type: 'select', required: true, init: 'MESE', options: opts(RENT_PERIOD_OPT), when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'rent_vat', label: 'IVA', type: 'select', empty: 'Non indicata', options: opts(RENT_VAT), when: (f) => f.tenure === 'LOCAZIONE', onSet: (v, f) => (v && v !== 'ESENTE' && !f.rent_vat_rate ? { rent_vat_rate: '22' } : {}) },
    { key: 'rent_vat_rate', label: 'Aliquota IVA %', type: 'number', step: '0.01', min: 0, init: 22, when: (f) => ['PIU_IVA', 'IVA_INCLUSA'].includes(f.rent_vat) },
    { key: '_rent', type: 'custom', when: (f) => f.tenure === 'LOCAZIONE', render: (f) => <RentSummary f={f} /> },
    { key: 'lease_start', label: 'Decorrenza', type: 'date', when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), onSet: (v, f) => ({ lease_end: leaseEndOf(v, f.lease_years) || f.lease_end }) },
    { key: 'lease_years', label: 'Durata (anni)', type: 'number', min: 0, when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), onSet: (v, f) => ({ lease_end: leaseEndOf(f.lease_start, v) || f.lease_end }) },
    { key: 'lease_renewal_years', label: 'Rinnovo tacito (anni)', type: 'number', min: 0, when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), help: '0 = nessun rinnovo automatico' },
    { key: 'lease_notice_months', label: 'Preavviso disdetta (mesi)', type: 'number', min: 0, when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure) },
    { key: 'lease_end', label: 'Fine del primo periodo', type: 'date', when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), help: 'Calcolata da decorrenza e durata se resta vuota' },
    { key: 'lease_landlord_org_id', label: 'Locatore (Legal entity)', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })), when: (f) => ['LOCAZIONE', 'COMODATO'].includes(f.tenure), help: (f) => (f.tenure === 'COMODATO' ? 'Il comodante' : 'Se manca, crealo in Legal entity o dal PDF') },
    { key: 'lease_registration', label: 'Registrazione', type: 'select', empty: 'Non indicata', options: opts(REGISTRATION), when: (f) => f.tenure === 'LOCAZIONE' },
    { key: '_gar', type: 'section', label: 'Garanzie fornite al locatore', when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'guarantee_bank_amount', label: 'Fideiussione bancaria (importo)', type: 'number', step: '0.01', min: 0, when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'guarantee_insurance_amount', label: 'Fideiussione assicurativa (importo)', type: 'number', step: '0.01', min: 0, when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'deposit_amount', label: 'Caparra / deposito cauzionale', type: 'number', step: '0.01', min: 0, when: (f) => f.tenure === 'LOCAZIONE' },
    { key: 'guarantee_notes', label: 'Note sulle garanzie', type: 'textarea', wide: true, when: (f) => f.tenure === 'LOCAZIONE' },
    { key: '_pay', type: 'custom', when: (f) => f.tenure === 'LOCAZIONE', render: (f, _p, it) => <PaymentsLeaseBox site={it} f={f} /> },
    { key: '_pos', type: 'section', label: 'Posizione e organigramma' },
    { key: 'lat', label: 'Latitudine', type: 'number', step: 'any' }, { key: 'lng', label: 'Longitudine', type: 'number', step: 'any' },
    { key: '_geo', label: 'Coordinate', type: 'action', button: 'Trova dall\'indirizzo', icon: 'pin', help: 'Da via, civico, CAP e città (OpenStreetMap). Se restano vuote, la Suite le completa da sola al salvataggio.', run: async (f, patch) => { const g = await api.post('/geocode', { address: f.address || null, zip: f.zip || null, city: f.city || null, province: f.province || null }); patch({ lat: g.lat, lng: g.lng }); toast(g.precision === 'civico' ? `Trovato al civico: ${g.label}` : g.precision === 'via' ? `Trovata la via (civico non riconosciuto): ${g.label}` : `Trovata solo la città: ${g.label}`, g.precision === 'citta' ? 'warn' : undefined); } },
    { key: 'sort_order', label: 'Ordine', type: 'number' },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'org_node', label: 'Nodo nell\'organigramma', type: 'bool', help: 'Spento se il nodo è stato eliminato in Organizzazione; riaccendilo per ricrearlo sotto la Direzione.' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => {
    const b = { ...body, organization_id: body.organization_id ? Number(body.organization_id) : null, host_organization_id: body.host_organization_id ? Number(body.host_organization_id) : null, lease_landlord_org_id: body.lease_landlord_org_id ? Number(body.lease_landlord_org_id) : null };
    const r = modal?.id ? await api.put(`/sites/${modal.id}`, b) : await api.post('/sites', b);
    const ls = r?.lease_sync;
    toast(ls?.status === 'ok' ? `Sede salvata · ${ls.created ? 'contratto creato' : 'contratto aggiornato'} nello Scadenziario di Payments` : ls?.status === 'error' ? `Sede salvata, ma Payments non è stato aggiornato: ${ls.reason}` : ls?.reason && /chiudilo/.test(ls.reason) ? `Sede salvata. ${ls.reason}` : 'Sede salvata', ls?.status === 'error' ? 'warn' : undefined);
    reload();
  };
  return (
    <div className="page">
      <PageHead title="Sedi" icon="building" sub="Laboratori, centri, punti prelievo e strutture ospitanti della rete" actions={<><button className="btn ghost" title="Ricava latitudine e longitudine dall'indirizzo per le sedi che non le hanno" onClick={async () => { try { const r = await api.post('/sites/geocode-missing'); toast(r.queued ? `${r.queued} sedi in coda: coordinate pronte tra circa ${Math.max(5, r.queued * 2)} secondi` : 'Tutte le sedi hanno già le coordinate'); setTimeout(reload, Math.min(60000, Math.max(5000, r.queued * 2500))); } catch (e) { toast(e, 'err'); } }}><Icon name="pin" />Completa coordinate</button><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova sede</button></>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'td', label: 'Sedi Toscana Diagnostica', count: all.filter((s) => !isService(s)).length }, { value: 'service', label: 'Strutture clienti service', count: all.filter(isService).length }]} />
      {tab === 'service' && <div className="alert info small" style={{ marginBottom: 12 }}><Icon name="info" /><span>Punti dei clienti del service di laboratorio (tipo SERVICE): una riga per codice cliente StudioLAB, agganciata alla legal entity del cliente. Sono il punto inviante su cui lavorano Non conformità, Ordini e gli accessi dei clienti. Si caricano dal file Sedi o dal connettore StudioLAB.</span></div>}
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder={tab === 'service' ? 'Codice StudioLAB, cliente, indirizzo o città' : 'Codice, nome, indirizzo o città'} /><div className="spacer" /><button className={`btn ghost sm${showMap ? ' active' : ''}`} onClick={() => setShowMap((v) => !v)}><Icon name="pin" />{showMap ? 'Nascondi mappa' : 'Mappa'}</button></div>
      {showMap && <Card flush style={{ marginBottom: 14 }}>
        <SitesMap sites={rows} kinds={SITE_KIND} focusId={focusId} />
        <div className="row tight small muted" style={{ padding: '8px 14px', flexWrap: 'wrap', gap: 12 }}>
          <span>{rows.filter((s) => s.lat != null && s.lng != null).length} su {rows.length} sedi con coordinate</span>
          {rows.some((s) => s.lat == null || s.lng == null) && <span>Per le altre usa "Completa coordinate".</span>}
          <span className="spacer" />
          {Object.entries(SITE_KIND).filter(([k]) => rows.some((s) => s.kind === k)).map(([k, v]) => <span key={k} className="row tight" style={{ gap: 5 }}><i className="legend-dot" data-kind={k} />{v}</span>)}
        </div>
      </Card>}
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="building" title={tab === 'service' ? 'Nessun punto cliente: si caricano dal file Sedi con tipo SERVICE e il codice della legal entity del cliente' : 'Nessuna sede'} />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Indirizzo</th><th>Legal entity</th><th>Responsabile</th><th>Utenti</th><th>Foto</th><th></th></tr></thead><tbody>
          {rows.map((s) => <tr key={s.id}>
            <td className="mono">{s.code}</td>
            <td><div className="strong">{s.name}{s.planimetria && <a className="plan-ico" href={`/api/sites/${s.id}/planimetria`} target="_blank" rel="noreferrer" title={`Planimetria: ${s.planimetria.filename}${s.planimetria.published_room_at ? ' (in Room Planning e Facility)' : ''}`} aria-label="Planimetria"><Icon name="image" /></a>}</div><div className="row tight">{!s.active && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td className="small">{SITE_KIND[s.kind] || s.kind}</td><td className="small">{s.address && <div>{s.address}</div>}<span className="muted">{[s.zip, s.city].filter(Boolean).join(' ')}{s.province ? ` (${s.province})` : ''}</span>{s.lat != null && s.lng != null ? <button className="linklike small" style={{ display: 'block' }} onClick={() => { setShowMap(true); setFocusId(s.id); }}>Sulla mappa</button> : <div className="faint small">Senza coordinate</div>}</td><td className="small">{s.organization_name}{s.host_organization_name && <div className="faint">ospitata da {s.host_organization_name}</div>}<div><Badge tone={s.tenure === 'PROPRIETA' ? 'green' : s.tenure === 'OSPITATA' ? 'mauve' : s.tenure === 'COMODATO' ? 'grey' : 'blue'}>{TENURE[s.tenure] || s.tenure}</Badge>{s.tenure === 'LOCAZIONE' && s.rent_amount != null && <span className="faint"> {eurIt(s.rent_amount)} {RENT_PERIOD[s.rent_period] || ''}</span>}</div></td><td className="small">{s.manager_name ? <Link to={`/people/${s.manager_person_id}`}>{s.manager_name}</Link> : <span className="faint">da assegnare</span>}</td><td className="num">{s.users_count}</td>
            <td className="small muted">{(s.photo_file_ids || []).length ? `${s.photo_file_ids.length} / 3` : ''}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(s)}><Icon name="edit" /></button><button className="iconbtn" aria-label="Foto" title="Foto della sede" onClick={() => setPhotos(s)}><Icon name="image" /></button><DeleteButton label={`la sede ${s.code}`} text="Persone e utenti collegati restano, senza sede. Se la sede ha dati nei moduli l'eliminazione viene rifiutata: in quel caso disattivala." onDelete={async () => { await api.del(`/sites/${s.id}`); toast('Sede eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova sede'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
      {photos && <SitePhotos site={photos} onClose={() => { setPhotos(null); reload(); }} />}
    </div>
  );
}

// ---------- Organizzazioni ----------
export function Organizations() {
  const { data, loading, error, reload } = useApi('/organizations');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [access, setAccess] = useState(null);   // sezione Accessi della Legal entity (utenti esterni collegati, nuovo accesso, riallineo)
  const rows = (data || []).filter((o) => !q || `${o.code || ''} ${o.name} ${o.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  const fields = [
    { key: 'name', label: 'Nome', required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: opts(ORG_KIND) }, { key: 'code', label: 'Codice', max: 40 },
    { key: 'vat_number', label: 'Partita IVA', max: 20 }, { key: 'tax_code', label: 'Codice fiscale', max: 20 }, { key: 'sdi', label: 'Codice SDI', max: 10 }, { key: 'pec', label: 'PEC' },
    { key: 'email', label: 'Email' }, { key: 'phone', label: 'Telefono' }, { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 }, { key: 'website', label: 'Sito web' },
    { key: 'iban', label: 'IBAN', max: 40, help: 'Coordinate bancarie della Legal entity: le leggono Business (contratti) e Cash (addebiti SEPA).' }, { key: 'bic', label: 'BIC', max: 11 }, { key: 'bank_name', label: 'Banca', max: 160 },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'org_node', label: 'Nodo nell\'organigramma', type: 'bool', help: 'Spento se il nodo è stato eliminato in Organizzazione; riaccendilo per ricrearlo sotto la Direzione.' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => { if (modal?.id) await api.put(`/organizations/${modal.id}`, body); else await api.post('/organizations', body); toast('Legal entity salvata'); reload(); };
  return (
    <div className="page">
      <PageHead title="Legal entity" icon="folder" sub="Soggetti giuridici, una riga per partita IVA: società del gruppo, clienti service, partner, fornitori e target M&A" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova legal entity</button>} />
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Nome, codice o città" /></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="folder" title="Nessuna organizzazione" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th><th>Tipo</th><th>P. IVA</th><th>Città</th><th>Sedi</th><th>Accessi</th><th></th></tr></thead><tbody>
          {rows.map((o) => <tr key={o.id}>
            <td><div className="strong">{o.name}</div><div className="row tight">{o.code && <span className="mono small muted">{o.code}</span>}{o.active === false && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td><Badge tone={o.kind === 'CLIENTE' ? 'blue' : o.kind === 'TARGET' ? 'mauve' : 'grey'}>{ORG_KIND[o.kind] || o.kind}</Badge></td><td className="mono small">{o.vat_number}</td><td className="small">{o.city}</td><td className="num">{o.sites_count}</td>
            <td className="num"><button className="btn sm ghost" title="Accessi esterni della Legal entity" onClick={() => setAccess(o)}><Icon name="users" />{o.users_count}{o.hosted_sites_count > 0 && <Badge tone="amber" title="Ospita punti prelievo TD">{o.hosted_sites_count} ospitat{o.hosted_sites_count === 1 ? 'a' : 'e'}</Badge>}</button></td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(o)}><Icon name="edit" /></button><DeleteButton label={`la legal entity ${o.name}`} text="Possibile solo senza sedi collegate e senza dati nei moduli; altrimenti disattivala." onDelete={async () => { await api.del(`/organizations/${o.id}`); toast('Legal entity eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova legal entity'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
      {access && <OrgAccessModal org={access} onClose={() => setAccess(null)} onChanged={reload} />}
    </div>
  );
}

// ---------- Persone ----------
export function PeopleAdmin() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ATTIVO');
  const [access, setAccess] = useState('');
  const { data: raw, loading, error, reload } = useApi(`/people${qs({ qtext: q, status, all: status ? '' : '1' })}`, [q, status]);
  const data = useMemo(() => raw ? raw.filter((p) => !access || (access === 'yes' ? p.user_id : !p.user_id)) : raw, [raw, access]);
  const sites = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const roles = useApi('/job-roles');
  const units = useApi('/org-units');
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [pos, setPos] = useState(null);
  const people = useMemo(() => (data || []).map((p) => ({ value: p.id, label: `${p.last_name} ${p.first_name}` })), [data]);
  const fields = [
    { key: 'last_name', label: 'Cognome', required: true }, { key: 'first_name', label: 'Nome', required: true }, { key: 'title', label: 'Titolo', max: 20 },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(PERSON_KIND) }, { key: 'status', label: 'Stato', type: 'select', options: opts({ CANDIDATO: 'Candidato', IMPEGNO: 'Impegno', ATTIVO: 'Attivo', CESSATO: 'Cessato' }) },
    { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Cellulare' }, { key: 'phone_office', label: 'Telefono ufficio' }, { key: 'phone_ext', label: 'Interno centralino', max: 10 },
    { key: 'site_id', label: 'Sede di lavoro', type: 'select', options: (sites.data || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })) },
    { key: 'role_id', label: 'Ruolo', type: 'select', options: (roles.data || []).map((r) => ({ value: r.id, label: r.name })), help: 'Cosa fa (dal catalogo Ruoli): vale per tutti, anche senza casella nell\'organigramma. Gli incarichi sotto sono le caselle.' }, { key: 'discipline', label: 'Disciplina' },
    { key: 'hired_at', label: 'Data di ingresso', type: 'date' }, { key: 'terminated_at', label: 'Data di cessazione', type: 'date' },
    { key: 'sex', label: 'Sesso', type: 'select', options: [{ value: 'F', label: 'F' }, { value: 'M', label: 'M' }] }, { key: 'birth_date', label: 'Data di nascita', type: 'date' }, { key: 'birth_place', label: 'Luogo di nascita', max: 120 }, { key: 'vat_number', label: 'Partita IVA', max: 20 },
    { key: 'address', label: 'Indirizzo di residenza', max: 250 }, { key: 'zip', label: 'CAP', max: 10 }, { key: 'city', label: 'Città', max: 120 }, { key: 'province', label: 'Provincia', max: 4 },
    { key: 'organization_id', label: 'Legal entity', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) }, { key: 'tax_code', label: 'Codice fiscale', max: 16 },
   
  ];
  const save = async (body) => {
    const b = { ...body, site_id: body.site_id ? Number(body.site_id) : null, organization_id: body.organization_id ? Number(body.organization_id) : null, role_id: body.role_id ? Number(body.role_id) : null };
    if (modal?.id) await api.put(`/people/${modal.id}`, b); else { const created = await api.post('/people', b); toast('Persona creata: ora assegna gli incarichi'); reload(); setModal(null); setPos(created); return; }
    toast('Persona salvata'); reload();
  };
  return (
    <div className="page">
      <PageHead title="Persone" icon="user" sub="Anagrafica unica: chi è, dove lavora, cosa fa. Il dossier HR è in Contratti del personale." actions={<><button className="btn ghost" onClick={async () => { try { const r = await api.post('/people/dedupe'); toast(r.removed ? `${r.removed} copie eliminate${r.blocked?.length ? `, ${r.blocked.length} con dati collegati lasciate` : ''}` : 'Nessun duplicato'); reload(); } catch (e) { toast(e, 'err'); } }}><Icon name="refresh" />Elimina duplicati</button><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova persona</button></>} />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cognome, nome, email, ruolo" />
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option><option value="ATTIVO">Attivi</option><option value="IMPEGNO">Impegno</option><option value="CANDIDATO">Candidati</option><option value="CESSATO">Cessati</option></select></Field>
        <Field label="Accesso"><select value={access} onChange={(e) => setAccess(e.target.value)}><option value="">Tutte</option><option value="no">Senza accesso</option><option value="yes">Con accesso</option></select></Field>
      </div>
      {(data || []).some((p) => !p.user_id && p.status === 'ATTIVO') && <div className="alert info small" style={{ marginBottom: 12 }}><Icon name="info" /><span>{(data || []).filter((p) => !p.user_id && p.status === 'ATTIVO' && p.email).length} persone attive con email senza accesso, {(data || []).filter((p) => !p.user_id && p.status === 'ATTIVO' && !p.email).length} senza email (a queste va prima data un'email). <button className="linklike" onClick={async () => { try { const r = await api.post('/people/accounts/missing', {}); toast(`${r.created} accessi creati (${r.entra} Microsoft 365, ${r.local} con credenziali)${r.errors.length ? `, ${r.errors.length} errori` : ''}`); reload(); } catch (e) { toast(e, 'err'); } }}>Crea gli accessi mancanti</button></span></div>}
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="user" title="Nessuna persona">Le persone arrivano dalle importazioni (Contracts) o si inseriscono a mano.</Empty>}
        {data?.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Persona</th><th>Tipo</th><th>Afferenza, ruolo, sede</th><th>Incarichi</th><th>Dipende da</th><th>Contatti</th><th>Accesso</th><th></th></tr></thead><tbody>
          {data.map((p) => <tr key={p.id}>
            <td><Link to={`/people/${p.id}`} className="strong">{p.last_name} {p.first_name}</Link></td>
            <td className="small">{PERSON_KIND[p.kind] || p.kind}</td><td className="small">{p.unit_path && <div className="strong">{p.unit_path.replace(/^[^›]+› /, '')}</div>}{p.job_title && <div>{p.job_title}</div>}<span className="muted">{p.site_name}</span></td>
            <td className="small">{(p.positions || []).length ? (p.positions || []).map((x) => <div key={x.id}>{x.is_head ? <b>{x.unit_name}</b> : x.unit_name}{x.role_name ? <span className="muted"> · {x.role_name}</span> : ''}</div>) : <span className="faint">nessuno</span>}</td>
            <td className="small">{p.manager_name || <span className="faint">{p.no_manager ? 'vertice' : 'nessuno'}</span>}{p.manager_name && !p.manager_override_id && <div className="faint">dall'organigramma</div>}</td>
            <td className="small">{p.email}<div className="muted">{p.phone_office || p.phone}</div></td>
            <td>{p.user_id ? <Link to={`/admin/users/${p.user_id}`}><Badge tone={p.user_level === 'OWNER' ? 'teal' : p.user_level === 'ADMIN' ? 'blue' : 'grey'}>{LEVEL[p.user_level] || 'Accesso'}</Badge></Link>
              : <span className="small"><Badge tone="amber">Senza accesso</Badge><div className="faint">{!p.email ? 'manca l\'email' : p.status !== 'ATTIVO' ? `stato ${p.status.toLowerCase()}` : 'da creare'}</div></span>}</td>
            <td className="actions"><button className="iconbtn" aria-label="Incarichi" title="Incarichi nell'organigramma" onClick={() => setPos(p)}><Icon name="tree" /></button><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(p)}><Icon name="edit" /></button><DeleteButton label={`${p.last_name} ${p.first_name}`} text="Elimina la persona dall'anagrafica e il suo eventuale accesso. Se ha dati nei moduli (turni, contratti, rendiconti) l'eliminazione viene rifiutata: mettila in stato CESSATO." onDelete={async () => { await api.del(`/people/${p.id}`); toast('Persona eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.last_name} ${modal.first_name}` : 'Nuova persona'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)}
        extra={<div className="mt2"><div className="row tight" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="strong">Incarichi nell'organigramma</span></div>
          {modal.id ? <PositionsEditor person={(data || []).find((x) => x.id === modal.id) || modal} onChange={reload} /> : <p className="small muted">Salva la persona: subito dopo si aprono gli incarichi (unità, ruolo, responsabile), quanti servono.</p>}</div>} />}
      {pos && <PersonPositionsModal person={(data || []).find((x) => x.id === pos.id) || pos} onClose={() => setPos(null)} onChange={reload} />}
    </div>
  );
}

// Incarichi di una persona: più unità e ruoli (es. Direzione + responsabile di area + funzione). Stessa tabella org_positions dell'Organizzazione.
// Afferenza: tendine a cascata lungo l'albero (Direzione › Area › Sede › Reparto...), fino alla foglia che si vuole
// Collocazione semplice: Area, Reparto, Funzione in rapporto alla sede della persona. Sotto c'è sempre lo stesso albero dell'Organizzazione:
// il valore salvato è l'unità più profonda scelta (funzione, altrimenti reparto, altrimenti il nodo sede, altrimenti l'area).
export function OrgPlacement({ units, siteId, value, onChange }) {
  const coll = new Intl.Collator('it');
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const ancestors = (u) => { const out = []; let cur = u; while (cur) { out.push(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : null; } return out; };
  const under = (u, id) => ancestors(u).some((a) => a.id === id);
  const sort = (list) => [...list].sort((a, b) => coll.compare(a.name, b.name));
  const chain = value ? ancestors(byId.get(Number(value))) : [];
  const pick = (kind) => chain.find((u) => u.kind === kind) || null;
  const siteNode = units.find((u) => u.kind === 'SEDE' && u.site_id === Number(siteId)) || pick('SEDE');
  const area = pick('AREA'); const rep = pick('REPARTO'); const fun = pick('FUNZIONE');
  const areas = sort(units.filter((u) => u.kind === 'AREA'));
  const scope = (u) => (siteNode && under(u, siteNode.id)) || (area && under(u, area.id));
  const reparti = sort(units.filter((u) => u.kind === 'REPARTO' && (scope(u) || (!siteNode && !area))));
  const funzioni = sort(units.filter((u) => u.kind === 'FUNZIONE' && (scope(u) || (!siteNode && !area))));
  const deepest = (a, r, f) => (f || r || (siteNode && (!a || under(siteNode, a.id)) ? siteNode : null) || a);
  const set = (k, id) => { const v = id ? byId.get(Number(id)) : null; let a = area, r = rep, f = fun; if (k === 'area') { a = v; r = null; f = null; } if (k === 'rep') { r = v; } if (k === 'fun') { f = v; } const d = deepest(a, r, f); onChange(d ? d.id : null); };
  return (
    <div className="placement">
      <label><span>Area</span><select value={area?.id || ''} onChange={(e) => set('area', e.target.value)}><option value="">Nessuna</option>
        <optgroup label="Tecnostruttura">{areas.filter((u) => u.branch === 'STAFF').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
        <optgroup label="Aree operative (pettine)">{areas.filter((u) => u.branch !== 'STAFF').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup></select></label>
      <label><span>Reparto</span><select value={rep?.id || ''} onChange={(e) => set('rep', e.target.value)}><option value="">Nessuno</option>{reparti.map((u) => <option key={u.id} value={u.id}>{u.name}{u.parent_name && !under(u, siteNode?.id) ? ` (${u.parent_name})` : ''}</option>)}</select></label>
      <label><span>Funzione</span><select value={fun?.id || ''} onChange={(e) => set('fun', e.target.value)}><option value="">Nessuna</option>{funzioni.map((u) => <option key={u.id} value={u.id}>{u.name}{u.parent_name ? ` (${u.parent_name})` : ''}</option>)}</select></label>
      <div className="small muted" style={{ gridColumn: '1 / -1' }}>{chain.length ? chain.slice().reverse().map((u) => u.name).join(' › ') : (siteId ? 'Scegli area, reparto o funzione' : 'Prima indica la sede di lavoro qui sopra e salva')}</div>
    </div>
  );
}

export function PositionsEditor({ person, onChange }) {
  const toast = useToast();
  const units = useApi('/org-units');
  const roles = useApi('/job-roles');
  const people = useApi('/people?all=1');
  const setUnit = async (v) => { try { await api.put(`/people/${person.id}`, { unit_id: v }); toast(v ? 'Afferenza salvata' : 'Afferenza rimossa'); onChange(); } catch (e2) { toast(e2, 'err'); } };
  const setManager = async (v) => { try { await api.put(`/people/${person.id}`, v === 'none' ? { manager_person_id: null, no_manager: true } : { manager_person_id: v ? Number(v) : null, no_manager: false }); toast(v === 'none' ? 'Non dipende da nessuno' : v ? 'Responsabile impostato' : 'Responsabile dall\'organigramma'); onChange(); } catch (e2) { toast(e2, 'err'); } };
  const [f, setF] = useState({ unit_id: '', role_id: '', is_head: false });
  const [busy, setBusy] = useState(false);
  const coll = new Intl.Collator('it');
  const unitLabel = (u) => `${u.name}${u.parent_name ? ` (${u.parent_name})` : ''} · ${KINDS[u.kind]}`;
  const add = async (e) => {
    e.preventDefault(); if (!f.unit_id) return; setBusy(true);
    try { await api.post('/org-positions', { unit_id: Number(f.unit_id), person_id: person.id, role_id: f.role_id ? Number(f.role_id) : null, is_head: f.is_head }); toast('Incarico salvato'); setF({ unit_id: '', role_id: '', is_head: false }); onChange(); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  const del = async (x) => { try { await api.del(`/org-positions/${x.id}`); toast('Incarico rimosso'); onChange(); } catch (e2) { toast(e2, 'err'); } };
  const list = person.positions || [];
  return (
    <>
      <div className="dep-row">
        <div><div className="small strong">Collocazione</div><div className="small muted">Sede {person.site_name || 'da indicare sopra'}: area, reparto e funzione in rapporto a questa sede. Si salva subito.</div></div>
        <OrgPlacement units={units.data || []} siteId={person.site_id} value={person.unit_id} onChange={setUnit} />
      </div>
      <div className="dep-row">
        <div><div className="small strong">Dipende da</div><div className="small muted">{person.no_manager ? 'Vertice: non dipende da nessuno' : person.manager_override_id ? 'Responsabile indicato a mano' : person.manager_auto_id ? 'Dall\'organigramma: il responsabile dell\'unità del suo incarico' : 'Nessuno: aggiungi un incarico o indicalo qui'}</div></div>
        <select value={person.no_manager ? 'none' : (person.manager_override_id || '')} onChange={(e) => setManager(e.target.value)}>
          <option value="">{person.manager_auto_name ? `Dall'organigramma · ${person.manager_auto_name}` : 'Dall\'organigramma (nessuno per ora)'}</option>
          <option value="none">Nessuno (vertice)</option>
          {[...(people.data || [])].filter((x) => x.id !== person.id).sort((a, b) => coll.compare(`${a.last_name} ${a.first_name}`, `${b.last_name} ${b.first_name}`)).map((x) => <option key={x.id} value={x.id}>{x.last_name} {x.first_name}</option>)}
        </select>
      </div>
      {list.length > 0 && <table className="t" style={{ marginBottom: 14 }}><thead><tr><th>Unità</th><th>Ruolo</th><th>Responsabile</th><th></th></tr></thead><tbody>
        {list.map((x) => <tr key={x.id}><td><div className="strong">{x.unit_name}</div><div className="small muted">{KINDS[x.unit_kind]}{x.parent_name ? ` · ${x.parent_name}` : ''}</div></td><td className="small">{x.role_name || ''}</td><td>{x.is_head && <Badge tone="blue">Responsabile</Badge>}</td><td className="actions"><button type="button" className="iconbtn" aria-label="Rimuovi" onClick={() => del(x)}><Icon name="trash" /></button></td></tr>)}
      </tbody></table>}
      <div className="small strong" style={{ margin: '14px 0 6px' }}>Caselle nell'organigramma (solo per responsabili e figure di staff)</div>
      {!list.length && <p className="small muted">Nessuna casella: per chi lavora in sede senza responsabilità va bene così, compare sotto la sua unità con il suo ruolo.</p>}
      <form onSubmit={add} className="form-grid">
        <Field label="Unità" required><select value={f.unit_id} onChange={(e) => setF({ ...f, unit_id: e.target.value })} required><option value="">Scegli</option>{[...(units.data || [])].sort((a, b) => coll.compare(unitLabel(a), unitLabel(b))).map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}</select></Field>
        <Field label="Ruolo nell'incarico"><select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Nessuno</option>{(roles.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Responsabile dell'unità"><div style={{ paddingTop: 6 }}><Switch checked={f.is_head} onChange={(v) => setF({ ...f, is_head: v })} label="Responsabile" /></div></Field>
        <div className="span-all"><button className="btn" disabled={busy || !f.unit_id}><Icon name="plus" />Aggiungi incarico</button></div>
      </form>
    </>
  );
}
export function PersonPositionsModal({ person, onClose, onChange }) {
  return (
    <Modal title={`Incarichi · ${person.last_name} ${person.first_name}`} onClose={onClose} wide footer={<button className="btn ghost" onClick={onClose}>Chiudi</button>}>
      <PositionsEditor person={person} onChange={onChange} />
    </Modal>
  );
}

// ---------- Ruoli (catalogo) ----------
export function Organization() {
  const [tab, setTab] = useState('units');
  return (
    <div className="page">
      <PageHead title="Organizzazione" icon="grid" sub="L'albero delle unità (direzione, aree, sedi, reparti) con gli incarichi di ciascuna: è l'organigramma. Una persona può avere più incarichi." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'units', label: 'Unità e incarichi' }, { value: 'roles', label: 'Ruoli' }, { value: 'rules', label: 'Regole di accesso' }]} />
      {tab === 'roles' ? <Roles embedded /> : tab === 'rules' ? <GrantRules /> : <Units />}
    </div>
  );
}

const KINDS = { DIREZIONE: 'Direzione', AREA: 'Area', SEDE: 'Sede', REPARTO: 'Reparto', FUNZIONE: 'Funzione' };
function Units() {
  const { data, loading, error, reload } = useApi('/org-units?all=1');
  const sites = useApi('/sites?all=1');
  const people = useApi('/people?all=1');
  const roles = useApi('/job-roles?all=1');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [pos, setPos] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const units = data || [];
  const rows = useMemo(() => {
    const byParent = {}; const coll = new Intl.Collator('it');
    for (const u of units) (byParent[u.parent_id || 'root'] ||= []).push(u);
    for (const k of Object.keys(byParent)) byParent[k].sort((a, b) => (a.sort_order - b.sort_order) || coll.compare(a.name, b.name));
    const out = []; const match = (u) => !q || `${u.name} ${u.site_name || ''} ${(u.positions || []).map((x) => x.person_name).join(' ')}`.toLowerCase().includes(q.toLowerCase());
    const walk = (list, depth) => { for (const u of list) { const kids = byParent[u.id] || []; if (match(u) || q) out.push({ ...u, depth, hasKids: kids.length > 0 }); if (!collapsed[u.id] || q) walk(kids, depth + 1); } };
    walk(byParent.root || [], 0);
    return q ? out.filter(match) : out;
  }, [units, q, collapsed]);
  const unitOpts = units.map((u) => ({ value: u.id, label: `${u.name} (${KINDS[u.kind]})` }));
  const fields = (cur) => [
    { key: 'name', label: 'Nome dell\'unità', required: true, max: 160 },
    { key: 'kind', label: 'Tipo', type: 'select', required: true, options: opts(KINDS) },
    { key: 'branch', label: 'Collocazione', type: 'select', required: true, options: [{ value: 'LINEA', label: 'Pettine (area operativa)' }, { value: 'STAFF', label: 'Tecnostruttura (funzione di staff)' }], help: 'Come in Contratti del personale: la tecnostruttura sta in alto accanto al vertice, il pettine sotto' },
    { key: 'parent_id', label: 'Dipende da', type: 'select', options: unitOpts.filter((o) => o.value !== cur?.id), help: 'Vuoto solo per la Direzione' },
    { key: 'site_id', label: 'Sede dell\'anagrafica', type: 'select', options: (sites.data || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })), help: 'Per i nodi Sede e per i reparti' },
    { key: 'phone_ext', label: 'Interno centralino', max: 10 }, { key: 'sort_order', label: 'Ordine', type: 'number' }, { key: 'active', label: 'Attiva', type: 'bool' },
    { key: 'public_contact', label: 'Contatto pubblico', type: 'bool', default: false, help: 'Gli accessi esterni (partner ospitanti, clienti service) vedono in Rubrica le persone di questa unità e possono aprirle ticket' },
    { key: 'description', label: 'Descrizione', type: 'textarea', wide: true },
  ];
  const save = async (body) => { const b = { ...body, parent_id: body.parent_id ? Number(body.parent_id) : null, site_id: body.site_id ? Number(body.site_id) : null }; delete b.head_person_id; if (modal?.id) await api.put(`/org-units/${modal.id}`, b); else await api.post('/org-units', b); toast('Unità salvata'); reload(); };
  return (
    <>
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Unità, sede o persona" /><div className="spacer" /><button className="btn" onClick={() => setModal({ kind: 'AREA', branch: 'LINEA', parent_id: units.find((u) => u.kind === 'DIREZIONE')?.id || '' })}><Icon name="plus" />Nuova unità</button></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="grid" title="Nessuna unità">Crea la Direzione, poi le aree, le sedi e i reparti. Oppure carica il file Organigramma da Importazioni.</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Unità</th><th>Tipo</th><th>Sede</th><th>Incarichi</th><th>Interno</th><th></th></tr></thead><tbody>
          {rows.map((u) => <tr key={u.id}>
            <td><div className="row tight" style={{ paddingLeft: u.depth * 18 }}>
              {u.hasKids ? <button className="iconbtn sm" aria-label={collapsed[u.id] ? 'Espandi' : 'Comprimi'} onClick={() => setCollapsed({ ...collapsed, [u.id]: !collapsed[u.id] })}><Icon name={collapsed[u.id] ? 'chevronRight' : 'chevronDown'} /></button> : <span style={{ width: 26, display: 'inline-block' }} />}
              <div><div className="strong">{u.name}</div><div className="row tight">{!u.active && <Badge tone="grey">Non attiva</Badge>}{u.public_contact && <Badge tone="amber" title="Visibile agli accessi esterni in Rubrica e nei ticket">Contatto pubblico</Badge>}</div></div></div></td>
            <td className="small">{KINDS[u.kind]}{u.branch === 'STAFF' && <div className="faint">tecnostruttura</div>}</td>
            <td className="small">{u.site_code ? `${u.site_code} · ${u.site_name}` : ''}</td>
            <td className="small">{(u.positions || []).map((x) => <div key={x.id}>{x.is_head ? <b>{x.person_name}</b> : x.person_name}{x.role_name ? <span className="muted"> · {x.role_name}</span> : ''}</div>)}{!(u.positions || []).length && <span className="muted">Nessuno</span>}</td>
            <td className="mono small">{u.phone_ext}</td>
            <td className="actions">
              <button className="iconbtn" aria-label="Incarichi" title="Incarichi" onClick={() => setPos(u)}><Icon name="users" /></button>
              <button className="iconbtn" aria-label="Aggiungi unità dipendente" title="Aggiungi unità dipendente" onClick={() => setModal({ parent_id: u.id, kind: u.kind === 'SEDE' ? 'REPARTO' : u.kind === 'DIREZIONE' ? 'AREA' : 'SEDE', branch: 'LINEA', site_id: u.site_id || '' })}><Icon name="plus" /></button>
              <button className="iconbtn" aria-label="Modifica" onClick={() => setModal(u)}><Icon name="edit" /></button>
              <DeleteButton label={`l'unità ${u.name}`} text={`Le unità dipendenti e le persone afferenti passano a ${u.parent_name || 'nessuna unità superiore'}; gli incarichi di questa unità vengono rimossi.${u.site_id ? ' La sede resta in anagrafica, senza nodo nell\'organigramma.' : ''}`} onDelete={async () => { const r = await api.del(`/org-units/${u.id}`); toast(`Unità eliminata${r.units || r.people ? ` (${r.units} unità e ${r.people} persone spostate)` : ''}`); reload(); }} />
            </td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova unità'} fields={fields(modal)} item={modal} onSave={save} onClose={() => setModal(null)} />}
      {pos && <PositionsModal unit={units.find((u) => u.id === pos.id) || pos} people={people.data || []} roles={roles.data || []} onClose={() => setPos(null)} onChange={reload} />}
    </>
  );
}

// Incarichi di un'unità: persona + ruolo + flag responsabile. Una persona può avere più incarichi in unità diverse.
function PositionsModal({ unit, people, roles, onClose, onChange }) {
  const toast = useToast();
  const [f, setF] = useState({ person_id: '', role_id: '', is_head: false });
  const [busy, setBusy] = useState(false);
  const coll = new Intl.Collator('it');
  const add = async (e) => {
    e.preventDefault(); if (!f.person_id) return; setBusy(true);
    try { await api.post('/org-positions', { unit_id: unit.id, person_id: Number(f.person_id), role_id: f.role_id ? Number(f.role_id) : null, is_head: f.is_head }); toast('Incarico salvato'); setF({ person_id: '', role_id: '', is_head: false }); onChange(); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  const del = async (x) => { try { await api.del(`/org-positions/${x.id}`); toast('Incarico rimosso'); onChange(); } catch (e2) { toast(e2, 'err'); } };
  return (
    <Modal title={`Incarichi · ${unit.name}`} onClose={onClose} wide footer={<button className="btn ghost" onClick={onClose}>Chiudi</button>}>
      {(unit.positions || []).length > 0 && <table className="t" style={{ marginBottom: 14 }}><thead><tr><th>Persona</th><th>Ruolo</th><th>Responsabile</th><th></th></tr></thead><tbody>
        {unit.positions.map((x) => <tr key={x.id}><td className="strong">{x.person_name}</td><td className="small">{x.role_name || ''}</td><td>{x.is_head && <Badge tone="blue">Responsabile</Badge>}</td><td className="actions"><button className="iconbtn" aria-label="Rimuovi" onClick={() => del(x)}><Icon name="trash" /></button></td></tr>)}
      </tbody></table>}
      {!(unit.positions || []).length && <p className="small muted">Nessun incarico ancora: la casella risulta "Da assegnare" nell'organigramma.</p>}
      <form onSubmit={add} className="form-grid">
        <Field label="Persona" required><select value={f.person_id} onChange={(e) => setF({ ...f, person_id: e.target.value })} required><option value="">Scegli</option>{[...people].sort((a, b) => coll.compare(`${a.last_name} ${a.first_name}`, `${b.last_name} ${b.first_name}`)).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}</option>)}</select></Field>
        <Field label="Ruolo nell'incarico"><select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Nessuno</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Responsabile dell'unità"><div style={{ paddingTop: 6 }}><Switch checked={f.is_head} onChange={(v) => setF({ ...f, is_head: v })} label="Responsabile" /></div></Field>
        <div className="span-all"><button className="btn" disabled={busy || !f.person_id}><Icon name="plus" />Aggiungi incarico</button></div>
      </form>
    </Modal>
  );
}

// Regole di accesso: chi afferisce a X / ha ruolo Y / lavora in una sede di tipo Z / è responsabile → modulo + profilo proposti
function GrantRules() {
  const { data, loading, error, reload } = useApi('/grant-rules');
  const units = useApi('/org-units?all=1');
  const roles = useApi('/job-roles?all=1');
  const mods = useApi('/modules');
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const coll = new Intl.Collator('it');
  const unitOpts = [...(units.data || [])].sort((a, b) => coll.compare(a.name, b.name)).map((u) => ({ value: u.id, label: `${u.name}${u.parent_name ? ` (${u.parent_name})` : ''}` }));
  const modList = (mods.data || []).filter((m) => !m.restricted);
  const fields = [
    { key: 'name', label: 'Nome della regola', required: true, max: 160 },
    { key: 'unit_id', label: 'Se afferisce a (o sotto)', type: 'select', options: unitOpts },
    { key: 'role_id', label: 'Se ha il ruolo', type: 'select', options: (roles.data || []).map((r) => ({ value: r.id, label: r.name })) },
    { key: 'site_kind', label: 'Se la sede di lavoro è di tipo', type: 'select', options: opts(SITE_KIND) },
    { key: 'only_heads', label: 'Solo responsabili di unità', type: 'bool', default: false },
    { key: 'module_key', label: 'Propone il modulo', type: 'select', required: true, options: modList.map((m) => ({ value: m.key, label: m.name })), resets: ['profile'] },
    { key: 'profile', label: 'Con profilo', type: 'select', required: true, options: [], optionsFor: (f) => ((modList.find((m) => m.key === f.module_key)?.profiles) || []).map((p) => ({ value: p.code || p.key || p, label: p.label || p.name || p })) },
    { key: 'scope', label: 'Ambito', type: 'select', required: true, options: [{ value: 'SITE', label: 'Solo la sede della persona' }, { value: 'ALL', label: 'Tutte le sedi' }] },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'sort_order', label: 'Ordine', type: 'number' },
  ];
  const save = async (body) => { const b = { ...body, unit_id: body.unit_id ? Number(body.unit_id) : null, role_id: body.role_id ? Number(body.role_id) : null, site_kind: body.site_kind || null }; if (modal?.id) await api.put(`/grant-rules/${modal.id}`, b); else await api.post('/grant-rules', b); toast('Regola salvata'); reload(); };
  const cond = (r) => [r.unit_name ? `afferisce a ${r.unit_name}` : null, r.role_name ? `ruolo ${r.role_name}` : null, r.site_kind ? `sede ${SITE_KIND[r.site_kind] || r.site_kind}` : null, r.only_heads ? 'responsabile di unità' : null].filter(Boolean).join(' e ') || 'tutti';
  return (
    <>
      <div className="alert info small" style={{ marginBottom: 12 }}><Icon name="info" /><span>Le regole producono proposte di accesso ai widget (in viola nella scheda utente), da confermare in Utenti. Si riapplicano da sole quando cambia la collocazione di una persona o dopo un'importazione.</span></div>
      <div className="filters"><div className="spacer" /><button className="btn ghost" onClick={async () => { try { const r = await api.post('/grant-rules/apply', {}); toast(`${r.proposals} proposte su ${r.users} utenti`); reload(); } catch (e) { toast(e, 'err'); } }}><Icon name="refresh" />Rigenera le proposte</button><button className="btn" onClick={() => setModal({ scope: 'SITE', active: true })}><Icon name="plus" />Nuova regola</button></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="grid" title="Nessuna regola">Le regole iniziali nascono dopo il caricamento dell'Organigramma (si agganciano alle unità per nome).</Empty>}
        {data?.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Regola</th><th>Condizione</th><th>Modulo e profilo</th><th>Ambito</th><th>In attesa</th><th></th></tr></thead><tbody>
          {data.map((r) => <tr key={r.id}>
            <td><div className="strong">{r.name}</div>{!r.active && <Badge tone="grey">Non attiva</Badge>}</td>
            <td className="small">{cond(r)}</td>
            <td className="small"><b>{r.module_name}</b> · {r.profile}</td>
            <td className="small">{r.scope === 'ALL' ? 'Tutte le sedi' : 'Sede della persona'}</td>
            <td className="num">{r.pending}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(r)}><Icon name="edit" /></button><DeleteButton label={`la regola ${r.name}`} text="Le proposte già fatte restano; non ne nascono di nuove." onDelete={async () => { await api.del(`/grant-rules/${r.id}`); toast('Regola eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova regola'} fields={fields} item={modal} onSave={save} onClose={() => setModal(null)} />}
    </>
  );
}

export function Roles({ embedded }) {
  const { data, loading, error, reload } = useApi('/job-roles?all=1');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const rows = (data || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const fields = [{ key: 'name', label: 'Ruolo', required: true, max: 200 }, { key: 'description', label: 'Descrizione', type: 'textarea', wide: true }, { key: 'sort_order', label: 'Ordine', type: 'number' }, { key: 'active', label: 'Attivo', type: 'bool' }];
  const save = async (body) => { if (modal?.id) await api.put(`/job-roles/${modal.id}`, body); else await api.post('/job-roles', body); toast('Ruolo salvato'); reload(); };
  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && <PageHead title="Ruoli" icon="tag" sub="Catalogo dei ruoli: cosa fa una persona (es. Site Manager, Biologo, Direttore Tecnico). Lo usano la scheda Persona, gli incarichi dell'organigramma e la mansione nei Contratti del personale." />}
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Cerca un ruolo" /><div className="spacer" /><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuovo ruolo</button></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="grid" title="Nessun ruolo" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Ruolo</th><th>Descrizione</th><th>Persone</th><th></th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}>
            <td><div className="strong">{r.name}</div>{!r.active && <Badge tone="grey">Non attivo</Badge>}</td>
            <td className="small muted">{r.description}</td>
            <td className="num">{r.people_count ? <Link to={`/people?role_id=${r.id}`}>{r.people_count}</Link> : 0}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(r)}><Icon name="edit" /></button><DeleteButton label={`il ruolo ${r.name}`} text="Possibile solo se nessuna persona lo ricopre; altrimenti disattivalo." onDelete={async () => { await api.del(`/job-roles/${r.id}`); toast('Ruolo eliminato'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuovo ruolo'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}
