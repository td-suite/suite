import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, canEditDossier } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, Modal, ConfirmModal, UploadButton, Icon, useToast } from '../components/ui.jsx';
import { PartyCards } from '../components/PartyPicker.jsx';
import { itDate, itDateTime, bytes, DOSSIER_STATUS, DOC_STATUS, DAYS } from '../format.js';

// Scheda del fascicolo (per id del fascicolo). Il fascicolo ha i propri riferimenti all'anagrafica unica: la sede TD
// autorizzanda e la controparte (struttura ospitante o locatore); se nasce da un contratto li segue, altrimenti si scelgono qui.
export default function Dossier() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const q = useApi(`/dossiers/${id}`);
  const [tab, setTab] = useState('documenti');
  const [modal, setModal] = useState(null);
  const [errors, setErrors] = useState(null);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const d = q.data; const c = d.contract;
  const edit = canEditDossier(user);
  const site = d.site || {}; const org = d.org;
  const act = async (fn, msg) => { try { const r = await fn(); if (r?.errors?.length) setErrors(r.errors); if (r?.pdfError) toast(`PDF non prodotto: ${r.pdfError}`, 'err'); q.reload(); if (msg) toast(msg); } catch (e) { toast(e.message, 'err'); } };
  const save = (body, msg = 'Fascicolo aggiornato') => act(() => api.put(`/dossiers/${d.id}`, body), msg);
  const upload = (key, list) => act(async () => { const fd = new FormData(); for (const f of list) fd.append('files', f); return api.upload(`/dossiers/${d.id}/upload/${key}`, fd); }, 'File caricati');
  const groups = [...new Set(d.rows.map((r) => r.group))];
  const where = d.site ? `${site.name}${site.street ? ` in ${site.street}` : ''}${site.city ? `, ${site.city}` : ''}${site.prov ? ` (${site.prov})` : ''}` : 'sede TD da indicare';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><Badge tone={DOSSIER_STATUS[d.status].tone}>{DOSSIER_STATUS[d.status].label}</Badge>{c && <StatusBadge status={c.status} />}{c?.protocol && <span className="mono">{c.protocol}</span>}{!c && <Badge tone="grey">senza contratto</Badge>}</div>
          <h1>Fascicolo di autorizzazione · {d.label}</h1>
          <div className="sub">Domanda al Comune{site.city ? ` di ${site.city}` : ''} ai sensi della L.R. Toscana 51/2009 (Modello 5) per {c?.kind === 'PP' ? 'il punto prelievo' : 'la sede'} {where}{org ? (c?.kind === 'SEDE' ? `, locatore ${org.name}` : `, controparte ${org.name}`) : ', nessuna struttura ospitante'}. {c && <Link to={`${BASE}/contratti/${c.id}`}>Scheda del contratto</Link>}</div>
        </div>
        <div className="row">
          {edit && !c && d.status === 'IN_CORSO' && <button className="btn ghost danger" onClick={() => setModal({ type: 'delete' })}>Elimina fascicolo</button>}
          {edit && <button className="btn" onClick={() => act(() => api.post(`/dossiers/${d.id}/generate-all`), 'Documenti del fascicolo generati')}><Icon name="file" />Genera tutti i documenti</button>}
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi accent"><div className="lbl">Completamento del fascicolo</div><div className="val">{d.pct}%</div><div className="foot">{d.done} documenti su {d.required} obbligatori pronti · {d.signed} con versione firmata o caricata</div><div className="bar"><i style={{ width: `${d.pct}%` }} /></div></div>
        <div className="card kpi"><div className="lbl">Data dei documenti</div><div className="val" style={{ fontSize: 18 }}>{edit ? <input type="date" value={d.doc_date || ''} onChange={(e) => save({ doc_date: e.target.value })} /> : itDate(d.doc_date)}</div><div className="foot">compare su dichiarazioni, modelli e relazioni</div></div>
        <div className="card kpi"><div className="lbl">Presentazione al Comune</div><div className="val" style={{ fontSize: 18 }}>{edit ? <input type="date" value={d.submitted_at || ''} onChange={(e) => save({ submitted_at: e.target.value, status: e.target.value && d.status === 'IN_CORSO' ? 'PRESENTATO' : undefined })} /> : itDate(d.submitted_at) || '–'}</div><div className="foot">data di protocollo della domanda</div></div>
        <div className="card kpi"><div className="lbl">Autorizzazione rilasciata</div><div className="val" style={{ fontSize: 18 }}>{edit ? <input type="date" value={d.authorized_at || ''} onChange={(e) => save({ authorized_at: e.target.value })} /> : itDate(d.authorized_at) || '–'}</div><div className="foot">{edit ? <input defaultValue={d.authorization_ref || ''} placeholder="estremi del provvedimento" onBlur={(e) => e.target.value !== (d.authorization_ref || '') && save({ authorization_ref: e.target.value })} style={{ height: 30, marginTop: 4 }} /> : d.authorization_ref || 'carica il provvedimento nella sezione Esito'}</div></div>
      </div>

      {errors && <div className="alert err" style={{ marginTop: 14 }}><b>Errori di generazione</b>{errors.map((e) => <div key={e}>{e}</div>)}<button className="btn sm ghost" onClick={() => setErrors(null)}>Chiudi</button></div>}

      <div className="tabs" style={{ marginTop: 18 }}>
        {[['documenti', 'Documenti del fascicolo'], ['sede', 'Sede, orari e sicurezza'], ['personale', 'Personale'], ['strumentazione', 'Strumentazione'], ['A', 'Lista A'], ['B', 'Lista B'], ['B1.1', 'Lista B1.1']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'documenti' && groups.map((g) => (
        <Card key={g} title={g} className="mt" flush>
          <table className="t">
            <thead><tr><th style={{ width: '42%' }}>Documento</th><th>Stato</th><th>File</th><th className="num">Azioni</th></tr></thead>
            <tbody>{d.rows.filter((r) => r.group === g).map((r) => (
              <tr key={r.key}>
                <td><div className="strong" style={{ fontSize: 13 }}>{r.label.split(' · ')[0]}</div><div className="small muted">{r.label.split(' · ').slice(1).join(' · ')}{r.signer ? ` · firma: ${r.signer}` : ''}{r.required ? '' : ' · facoltativo'}</div>{r.note && <div className="small" style={{ color: 'var(--teal)' }}>Nota: {r.note}</div>}</td>
                <td><Badge tone={DOC_STATUS[r.status].tone}>{DOC_STATUS[r.status].label}</Badge></td>
                <td>{r.files.map((f) => <div key={f.id} className="row small" style={{ gap: 6, marginBottom: 3 }}><Badge tone={f.source === 'GEN' ? 'blue' : 'green'}>{f.source === 'GEN' ? 'generato' : 'caricato'}</Badge><a href={`${API_BASE}/dossier-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="muted">{bytes(f.size)}</span>{edit && <button className="iconbtn" style={{ width: 24, height: 24 }} title="Rimuovi" onClick={() => setModal({ type: 'delfile', f })}><Icon name="trash" /></button>}</div>)}</td>
                <td className="num">{edit && <div className="row end" style={{ gap: 6 }}>
                  {r.source !== 'UPLOAD' && r.status !== 'NON_APPLICABILE' && <button className="btn sm ghost" onClick={() => act(() => api.post(`/dossiers/${d.id}/generate/${r.key}`), r.source === 'CHECK' ? 'Lista esportata in XLSX' : 'Documento generato')}><Icon name="file" />{r.source === 'CHECK' ? 'Esporta XLSX' : 'Genera'}</button>}
                  {r.status !== 'NON_APPLICABILE' && <UploadButton label={r.source === 'UPLOAD' ? 'Carica' : 'Carica firmato'} multiple={Boolean(r.multi)} onFiles={(fl) => upload(r.key, fl)} />}
                  <button className="btn sm ghost" title="Nota o non applicabile" onClick={() => setModal({ type: 'note', r })}><Icon name="edit" /></button>
                </div>}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      ))}

      {tab === 'sede' && <><PartyTab d={d} edit={edit} save={save} /><SiteTab d={d} c={c} edit={edit} save={save} /></>}
      {tab === 'personale' && <StaffTab d={d} edit={edit} save={save} />}
      {tab === 'strumentazione' && <EquipmentTab d={d} edit={edit} save={save} />}
      {['A', 'B', 'B1.1'].includes(tab) && <ChecklistTab key={tab} d={d} code={tab} edit={edit} onSaved={() => q.reload()} />}

      {modal?.type === 'delfile' && <ConfirmModal danger title="Rimuovi file" text={`Rimuovere ${modal.f.filename} dal fascicolo?`} confirmText="Rimuovi" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/dossiers/${d.id}/files/${modal.f.id}`); q.reload(); }} />}
      {modal?.type === 'delete' && <ConfirmModal danger title="Elimina fascicolo" text="Il fascicolo e i file collegati verranno eliminati." confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/dossiers/${d.id}`); nav(`${BASE}/fascicoli`); }} />}
      {modal?.type === 'note' && <DocNoteModal r={modal.r} onClose={() => setModal(null)} onSave={async (b) => { await api.put(`/dossiers/${d.id}/docs/${modal.r.key}`, b); setModal(null); q.reload(); }} />}
    </div>
  );
}

function DocNoteModal({ r, onClose, onSave }) {
  const [na, setNa] = useState(r.status === 'NON_APPLICABILE');
  const [note, setNote] = useState(r.note || '');
  return (
    <Modal title={r.label.split(' · ')[0]} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={() => onSave({ not_applicable: na, note })}>Salva</button></>}>
      <div className="form-grid">
        <Field label="Non applicabile a questo punto prelievi" className="inline span2"><input type="checkbox" checked={na} onChange={(e) => setNa(e.target.checked)} /> escludi dal conteggio dei documenti obbligatori</Field>
        <Field label="Nota" className="span2"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. documento fornito dalla struttura ospitante, in attesa dal tecnico" /></Field>
      </div>
    </Modal>
  );
}

function SiteTab({ d, c, edit, save }) {
  const [hours, setHours] = useState(d.hours?.length ? d.hours : DAYS.map((day) => ({ day, draw: '', pickup: '' })));
  const [x, setX] = useState({ floor: '', building_type: '', workers: '', prov_name: '', notes: '', dvr_code: '', duvri_code: '', dirty_clean_clause: '', ...(d.extra || {}) });
  useEffect(() => { setX({ floor: '', building_type: '', workers: '', prov_name: '', notes: '', dvr_code: '', duvri_code: '', dirty_clean_clause: '', ...(d.extra || {}) }); }, [d.extra]);
  return (
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Card title="Orari di apertura (Relazione operativa)" actions={edit && <button className="btn sm" onClick={() => save({ hours }, 'Orari salvati')}>Salva orari</button>}>
        <table className="t"><thead><tr><th>Giorno</th><th>Orario di prelievo</th><th>Orario di ritiro referti</th></tr></thead>
          <tbody>{hours.map((h, i) => <tr key={h.day}><td className="strong">{h.day}</td><td><input value={h.draw || ''} disabled={!edit} placeholder="Chiuso" onChange={(e) => setHours(hours.map((y, j) => (j === i ? { ...y, draw: e.target.value } : y)))} /></td><td><input value={h.pickup || ''} disabled={!edit} onChange={(e) => setHours(hours.map((y, j) => (j === i ? { ...y, pickup: e.target.value } : y)))} /></td></tr>)}</tbody></table>
        <div className="small muted" style={{ marginTop: 6 }}>Lasciare vuoti entrambi i campi per indicare il giorno di chiusura.</div>
      </Card>
      <Card title="Sede, sicurezza e note" actions={edit && <button className="btn sm" onClick={() => save({ extra: x }, 'Dati della sede salvati')}>Salva</button>}>
        <div className="form-grid">
          <Field label="Piano (DUVRI)"><input value={x.floor} disabled={!edit} placeholder="Piano Terra" onChange={(e) => setX({ ...x, floor: e.target.value })} /></Field>
          <Field label="Tipologia immobile (DVR)"><input value={x.building_type} disabled={!edit} placeholder="Studi Medici" onChange={(e) => setX({ ...x, building_type: e.target.value })} /></Field>
          <Field label="Addetti presenti (DVR)"><input value={x.workers} disabled={!edit} placeholder="1" onChange={(e) => setX({ ...x, workers: e.target.value })} /></Field>
          <Field label="Provincia per esteso (DVR)"><input value={x.prov_name} disabled={!edit} placeholder="Firenze" onChange={(e) => setX({ ...x, prov_name: e.target.value })} /></Field>
          <Field label="Codice SGI del DVR" help="registro REG0xx assegnato dal RSGI"><input value={x.dvr_code} disabled={!edit} placeholder="TD-SGI-REG0xx_00" onChange={(e) => setX({ ...x, dvr_code: e.target.value })} /></Field>
          <Field label="Codice SGI del DUVRI"><input value={x.duvri_code} disabled={!edit} placeholder="TD-SGI-REG0xx_00" onChange={(e) => setX({ ...x, duvri_code: e.target.value })} /></Field>
          <Field label="Dichiarazione sporco/pulito: localizzazione degli spazi" className="span2" help="vuoto: testo predefinito (all'interno della stanza delle prestazioni)"><textarea value={x.dirty_clean_clause} disabled={!edit} style={{ minHeight: 56 }} onChange={(e) => setX({ ...x, dirty_clean_clause: e.target.value })} /></Field>
          <Field label="Note sul progetto (Relazione operativa, paragrafo Il progetto in esame)" className="span2"><textarea value={x.notes} disabled={!edit} onChange={(e) => setX({ ...x, notes: e.target.value })} /></Field>
        </div>
        <div className="alert warn small" style={{ marginTop: 10 }}>DVR e DUVRI vengono generati come bozze dai documenti di riferimento del SGI: vanno validati e firmati dal RSPP prima della presentazione. Le figure (RSPP, RLS, Medico Competente) e i dati del legale rappresentante e del Direttore Sanitario si impostano in Impostazioni.</div>
      </Card>
    </div>
  );
}

const EMPTY_STAFF = { surname: '', name: '', affiliation: 'Libero Professionista', contract: 'LP', hours: '', role: 'Personale Sanitario', degree: '' };
function StaffTab({ d, edit, save }) {
  const [rows, setRows] = useState(d.staff || []);
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card title="Elenco del personale che opera nella struttura" className="mt" flush actions={edit && <div className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setRows([...rows, { ...EMPTY_STAFF }])}>+ Riga</button><button className="btn sm" onClick={() => save({ staff: rows.filter((r) => r.surname || r.name) }, 'Personale salvato')}>Salva</button></div>}>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Cognome</th><th>Nome</th><th>Afferenza</th><th>Contratto</th><th>Ore giornaliere</th><th>Ruolo</th><th>Titolo di studio</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>
          {['surname', 'name', 'affiliation', 'contract', 'hours', 'role', 'degree'].map((k) => <td key={k}><input value={r[k] || ''} disabled={!edit} onChange={(e) => set(i, k, e.target.value)} style={{ minWidth: k === 'degree' ? 220 : k === 'hours' || k === 'contract' ? 70 : 120 }} /></td>)}
          <td>{edit && <button className="iconbtn" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>Nessun operatore inserito. Il Direttore Sanitario va indicato per primo (afferenza, contratto, ore).</td></tr>}
        </tbody>
      </table></div>
      <div className="small muted" style={{ padding: '8px 14px' }}>Afferenza: Dipendente, Libero Professionista, Struttura ospitante. Contratto: LP, TD, TI, CoCoCo. Le ore sono quelle svolte nella struttura.</div>
    </Card>
  );
}

const EMPTY_EQ = { type: '', maker: '', model: '', serial: '', power: 'Corrente di rete', ownership: 'Acquisto', condition: 'Nuovo', tested_at: '' };
function EquipmentTab({ d, edit, save }) {
  const [rows, setRows] = useState(d.equipment || []);
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card title="Inventario delle attrezzature sanitarie" className="mt" flush actions={edit && <div className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setRows([...rows, { ...EMPTY_EQ }])}>+ Riga</button><button className="btn sm" onClick={() => save({ equipment: rows.filter((r) => r.type) }, 'Strumentazione salvata')}>Salva</button></div>}>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>#</th><th>Tipologia</th><th>Costruttore</th><th>Modello</th><th>Matricola</th><th>Alimentazione</th><th>Titolo di possesso</th><th>Condizione</th><th>Collaudo</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td className="muted">{i + 1}</td>
          {['type', 'maker', 'model', 'serial'].map((k) => <td key={k}><input value={r[k] || ''} disabled={!edit} onChange={(e) => set(i, k, e.target.value)} style={{ minWidth: 120 }} /></td>)}
          <td><select value={r.power || ''} disabled={!edit} onChange={(e) => set(i, 'power', e.target.value)}>{['Corrente di rete', 'Batteria', 'Rete e batteria', 'Nessuna'].map((v) => <option key={v}>{v}</option>)}</select></td>
          <td><select value={r.ownership || ''} disabled={!edit} onChange={(e) => set(i, 'ownership', e.target.value)}>{['Acquisto', 'Noleggio', 'Comodato', 'Struttura ospitante'].map((v) => <option key={v}>{v}</option>)}</select></td>
          <td><select value={r.condition || ''} disabled={!edit} onChange={(e) => set(i, 'condition', e.target.value)}>{['Nuovo', 'Usato', 'Ricondizionato'].map((v) => <option key={v}>{v}</option>)}</select></td>
          <td><input type="date" value={r.tested_at || ''} disabled={!edit} onChange={(e) => set(i, 'tested_at', e.target.value)} style={{ width: 150 }} /></td>
          <td>{edit && <button className="iconbtn" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 20 }}>Nessuna apparecchiatura inserita (es. defibrillatore, centrifuga, frigorifero campioni, zaino emergenza).</td></tr>}
        </tbody>
      </table></div>
    </Card>
  );
}

// Controparte (Legal entity) e sede TD del fascicolo: con un contratto di origine si leggono dal contratto, altrimenti si scelgono qui
function PartyTab({ d, edit, save }) {
  const [f, setF] = useState({ org_id: d.org_id || '', site_id: d.site_id || '', title: d.title || '' });
  useEffect(() => { setF({ org_id: d.org_id || '', site_id: d.site_id || '', title: d.title || '' }); }, [d.org_id, d.site_id, d.title]);
  const orgs = useApi('/organizations');
  const sites = useApi('/sites?all=1');
  const org = (orgs.data || []).find((x) => x.id === Number(f.org_id)) || (Number(f.org_id) === d.org_id ? d.org : null);
  const site = (sites.data || []).find((x) => x.id === Number(f.site_id)) || (Number(f.site_id) === d.site_id ? d.site : null);
  const locked = Boolean(d.contract_id) || !edit;
  const dirty = String(f.org_id) !== String(d.org_id || '') || String(f.site_id) !== String(d.site_id || '') || (f.title || '') !== (d.title || '');
  return (
    <div style={{ marginTop: 16 }}>
      <PartyCards orgs={orgs.data} sites={sites.data} orgId={f.org_id} siteId={f.site_id} onOrg={(v) => setF({ ...f, org_id: v })} onSite={(v) => setF({ ...f, site_id: v })} org={org} site={site}
        orgTitle="Controparte (Legal entity)" siteTitle="Sede TD autorizzanda" orgDisabled={locked} siteDisabled={locked}
        orgNote={d.contract_id ? 'Fascicolo nato da un contratto: la controparte si modifica dal contratto di origine.' : 'Struttura ospitante, se c’è: senza controparte atto di condivisione e DUVRI non si applicano.'}
        siteNote={d.contract_id ? 'La sede TD segue il contratto di origine.' : 'La sede di Toscana Diagnostica per cui si chiede l’autorizzazione sanitaria: indirizzo e comune compaiono nei documenti.'} />
      {!locked && <div className="row end" style={{ marginTop: 10, gap: 8 }}>
        <Field label="Denominazione del fascicolo"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={site?.name ? `Autorizzazione ${site.name}` : ''} style={{ minWidth: 280 }} /></Field>
        <button className="btn" disabled={!dirty || (!f.org_id && !f.site_id)} onClick={() => save({ org_id: f.org_id ? Number(f.org_id) : null, site_id: f.site_id ? Number(f.site_id) : null, title: f.title || null }, 'Controparte e sede salvate')}>Salva controparte e sede</button>
      </div>}
    </div>
  );
}

function ChecklistTab({ d, code, edit, onSaved }) {
  const toast = useToast();
  const L = d.checklists.find((x) => x.code === code);
  const [items, setItems] = useState(L?.items || []);
  const [filter, setFilter] = useState('');
  const [dirty, setDirty] = useState(false);
  const [reset, setReset] = useState(false);
  if (!L) return <ErrorBox error={new Error('Lista non trovata')} />;
  const set = (i, k, v) => { setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it))); setDirty(true); };
  const save = async () => { try { await api.put(`/dossiers/${d.id}/checklists/${code}`, { items }); setDirty(false); onSaved(); toast('Lista salvata'); } catch (e) { toast(e.message, 'err'); } };
  const vis = items.map((it, i) => ({ it, i })).filter(({ it }) => !filter || `${it.code} ${it.text} ${it.answer} ${it.document} ${it.notes}`.toLowerCase().includes(filter.toLowerCase()));
  const answered = items.filter((it) => it.code && it.answer).length; const total = items.filter((it) => it.code).length;
  let lastSection = null;
  return (
    <Card title={L.title} className="mt" flush actions={<div className="row" style={{ gap: 6 }}><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filtra requisiti" style={{ height: 30, width: 200 }} /><span className="small muted">{answered}/{total} con risposta</span>{edit && <button className="btn sm ghost" onClick={() => setReset(true)}>Ripristina modello</button>}{edit && <button className="btn sm" disabled={!dirty} onClick={save}>Salva risposte</button>}</div>}>
      <div className="table-wrap"><table className="t">
        <thead><tr><th style={{ width: 70 }}>Req.</th><th style={{ width: '28%' }}>Testo del requisito</th><th style={{ width: 120 }}>Risposta</th><th>Documento / evidenza</th><th>Note e riferimenti SGI</th></tr></thead>
        <tbody>{vis.map(({ it, i }) => {
          const sec = it.section && it.section !== lastSection ? it.section : null; lastSection = it.section || lastSection;
          return (<React.Fragment key={i}>
            {sec && <tr><td colSpan={5} style={{ background: 'var(--teal-050)', fontWeight: 700, color: 'var(--teal)', fontSize: 12 }}>{sec}</td></tr>}
            <tr>
              <td className="strong mono">{it.code}</td>
              <td className="small">{it.text}{it.applicability && <div className="muted" style={{ marginTop: 4 }}>Applicabilità: {it.applicability}</div>}</td>
              <td>{it.code ? <select value={it.answer} disabled={!edit} onChange={(e) => set(i, 'answer', e.target.value)}><option value="">–</option>{['Sì', 'No', 'Non pertinente', 'In corso'].map((v) => <option key={v}>{v}</option>)}{it.answer && !['Sì', 'No', 'Non pertinente', 'In corso', ''].includes(it.answer) && <option>{it.answer}</option>}</select> : null}</td>
              <td><textarea value={it.document} disabled={!edit} onChange={(e) => set(i, 'document', e.target.value)} style={{ minHeight: 56, fontSize: 12 }} /></td>
              <td><textarea value={it.notes} disabled={!edit} onChange={(e) => set(i, 'notes', e.target.value)} style={{ minHeight: 56, fontSize: 12 }} /></td>
            </tr>
          </React.Fragment>);
        })}</tbody>
      </table></div>
      <div className="small muted" style={{ padding: '8px 14px' }}>Risposte e riferimenti precaricati dalle liste compilate per il punto prelievi di Calenzano (Sistema di Gestione Integrato): adeguare sede, orari, personale e strumentazione. L'export XLSX riproduce il tracciato regionale.</div>
      {reset && <ConfirmModal danger title="Ripristina il modello" text="Le risposte di questa lista tornano ai valori del modello Calenzano. Le modifiche fatte per questo punto prelievi vengono perse." confirmText="Ripristina" onClose={() => setReset(false)} onConfirm={async () => { const r = await api.post(`/dossiers/${d.id}/checklists/${code}/reset`); setItems(r.checklists.find((x) => x.code === code).items); setDirty(false); onSaved(); }} />}
    </Card>
  );
}
