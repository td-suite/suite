// Componenti condivisi del modulo Cartella condivisa: tendina ad albero delle cartelle, schede e righe di documenti e cartelle,
// caricamento con gestione dei duplicati, finestre di modifica per la gestione.
import React, { useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Modal, Field, ErrorBox, DropZone, Popover } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { api, apiBase, base } from './api.js';
import { itDate, itDateTime, kb, tipoDi, anteprimabile } from './format.js';

export const downloadUrl = (d) => `${apiBase}/documenti/${d.id}/download`;
export const anteprimaUrl = (d) => `${apiBase}/documenti/${d.id}/anteprima`;
export const folderTo = (id, manage) => `${base}${manage ? '/gestione' : ''}${id ? `/c/${id}` : ''}`;

// Tendina ad albero delle cartelle (da GET /albero), con rientro; "Cartella principale" = radice
export function FolderSelect({ cartelle = [], value, onChange, disabled, exclude = [] }) {
  const rows = useMemo(() => {
    const byParent = new Map();
    for (const c of cartelle) { const k = c.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(c); }
    const coll = new Intl.Collator('it');
    const out = [];
    const walk = (pid, depth) => {
      for (const c of (byParent.get(pid) || []).slice().sort((a, b) => (a.sort_order - b.sort_order) || coll.compare(a.nome, b.nome))) { out.push({ ...c, depth }); walk(c.id, depth + 1); }
    };
    walk(0, 0);
    return out;
  }, [cartelle]);
  // le cartelle escluse (la cartella da spostare e le sue discendenti) restano visibili ma non selezionabili
  const excluded = useMemo(() => {
    const set = new Set(exclude);
    let grown = true;
    while (grown) { grown = false; for (const c of cartelle) if (c.parent_id && set.has(c.parent_id) && !set.has(c.id)) { set.add(c.id); grown = true; } }
    return set;
  }, [cartelle, exclude]);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled}>
      <option value="">Cartella principale</option>
      {rows.map((c) => <option key={c.id} value={c.id} disabled={excluded.has(c.id)} title={c.percorso}>{'   '.repeat(c.depth)}{c.depth ? '› ' : ''}{c.nome}</option>)}
    </select>
  );
}

export function TipoIcon({ doc, size = 22 }) {
  const t = tipoDi(doc);
  return <span className={`cf-tipo cf-t-${t.cls}`} title={t.label}><Icon name={t.icon} size={size} /></span>;
}

export const Stella = ({ doc }) => (doc.evidenza_attiva ? <span className="cf-star" title={doc.evidenza_fino ? `In evidenza fino al ${itDate(doc.evidenza_fino)}` : 'In evidenza'}><Icon name="star" /></span> : null);
export const plur = (n, uno, piu) => `${n} ${n === 1 ? uno : piu}`;
export const Nuovo = ({ doc }) => (doc.nuovo ? <Badge tone="green" dot={false}>nuovo</Badge> : null);

// Apertura di un documento: anteprima nella pagina del modulo (PDF e immagini) oppure download diretto
export function useApriDocumento() {
  const nav = useNavigate();
  return (d) => { if (anteprimabile(d)) nav(`${base}/doc/${d.id}`); else window.location.assign(downloadUrl(d)); };
}

// Scheda del documento (griglia)
export function DocCard({ doc, menu }) {
  const apri = useApriDocumento();
  const t = tipoDi(doc);
  return (
    <div className={`cf-card ${doc.nuovo ? 'nuovo' : ''}`} role="button" tabIndex={0} onClick={() => apri(doc)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), apri(doc))}>
      <div className="cf-card-top"><TipoIcon doc={doc} size={34} />{menu}</div>
      <div className="cf-card-name" title={doc.nome}>{doc.nome}</div>
      {doc.descrizione && <div className="cf-card-desc">{doc.descrizione}</div>}
      <div className="cf-card-meta"><span>{t.label} · {kb(doc.size)}</span><span>{itDate(doc.updated_at)}</span></div>
      <div className="cf-card-flags"><Nuovo doc={doc} /><Stella doc={doc} />{doc.versione > 1 && <span className="small muted">v{doc.versione}</span>}</div>
    </div>
  );
}
// Riga del documento (elenco)
export function DocRow({ doc, menu, percorso, manage }) {
  const apri = useApriDocumento();
  const t = tipoDi(doc);
  return (
    <tr className="click" onClick={() => apri(doc)}>
      <td className="cf-td-ico"><TipoIcon doc={doc} /></td>
      <td><div className="strong cf-row-name">{doc.nome} <Nuovo doc={doc} /><Stella doc={doc} /></div>{doc.descrizione && <div className="small muted">{doc.descrizione}</div>}{percorso && <div className="small muted"><Link to={folderTo(doc.cartella_id, manage)} onClick={(e) => e.stopPropagation()}>{doc.percorso || 'Cartella principale'}</Link></div>}</td>
      <td className="small">{t.label}</td>
      <td className="small num">{kb(doc.size)}</td>
      <td className="small">v{doc.versione}</td>
      <td className="small">{itDateTime(doc.updated_at)}<div className="muted">{doc.caricato_da_nome || ''}</div></td>
      <td className="small num" title="persone che lo hanno aperto">{doc.n_letture}</td>
      {menu !== undefined && <td className="cf-td-menu" onClick={(e) => e.stopPropagation()}>{menu}</td>}
    </tr>
  );
}
export function FolderCard({ c, manage, menu }) {
  const nav = useNavigate();
  const to = folderTo(c.id, manage);
  return (
    <div className="cf-card cf-folder" role="link" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), nav(to))}>
      <div className="cf-card-top"><span className="cf-tipo cf-t-folder"><Icon name="folder" size={34} /></span>{menu}</div>
      <div className="cf-card-name" title={c.nome}>{c.nome}</div>
      {c.descrizione && <div className="cf-card-desc">{c.descrizione}</div>}
      <div className="cf-card-meta"><span>{plur(c.n_documenti_totale ?? c.n_documenti, 'documento', 'documenti')}{c.n_sottocartelle ? ` · ${plur(c.n_sottocartelle, 'cartella', 'cartelle')}` : ''}</span>{c.n_nuovi > 0 && <Badge tone="green" dot={false}>{c.n_nuovi} nuovi</Badge>}</div>
    </div>
  );
}
export function FolderRow({ c, manage, menu }) {
  const nav = useNavigate();
  return (
    <tr className="click" onClick={() => nav(folderTo(c.id, manage))}>
      <td className="cf-td-ico"><span className="cf-tipo cf-t-folder"><Icon name="folder" /></span></td>
      <td><div className="strong cf-row-name">{c.nome} {c.n_nuovi > 0 && <Badge tone="green" dot={false}>{c.n_nuovi} nuovi</Badge>}</div>{c.descrizione && <div className="small muted">{c.descrizione}</div>}</td>
      <td className="small">Cartella</td>
      <td className="small num">{c.n_documenti_totale ?? c.n_documenti} doc.</td>
      <td className="small">{c.n_sottocartelle ? plur(c.n_sottocartelle, 'cartella', 'cartelle') : ''}</td>
      <td className="small">{itDateTime(c.updated_at)}</td>
      <td />
      {menu !== undefined && <td className="cf-td-menu" onClick={(e) => e.stopPropagation()}>{menu}</td>}
    </tr>
  );
}

// Menu a tre puntini con voci [{ label, icon, onClick, danger, href }]
export function Kebab({ items, label = 'Azioni' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="cf-kebab" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="iconbtn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="dots" /></button>
      <Popover open={open} onClose={() => setOpen(false)} className="cf-menu">
        {items.filter(Boolean).map((it) => it.href
          ? <a key={it.label} href={it.href} onClick={() => setOpen(false)}><Icon name={it.icon} />{it.label}</a>
          : <button key={it.label} type="button" className={`item ${it.danger ? 'danger' : ''}`} onClick={() => { setOpen(false); it.onClick(); }}><Icon name={it.icon} />{it.label}</button>)}
      </Popover>
    </span>
  );
}

// ---- Finestre di gestione
export function FolderModal({ cartella, parentId, cartelle, onClose, onSaved }) {
  const [nome, setNome] = useState(cartella?.nome || '');
  const [descrizione, setDescrizione] = useState(cartella?.descrizione || '');
  const [parent, setParent] = useState(cartella ? cartella.parent_id : parentId);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const go = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = { nome: nome.trim(), descrizione: descrizione.trim(), parent_id: parent || null };
      const saved = cartella ? await api.put(`/cartelle/${cartella.id}`, body) : await api.post('/cartelle', body);
      onSaved?.(saved); onClose();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal title={cartella ? 'Modifica cartella' : 'Nuova cartella'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !nome.trim()} onClick={go}>{cartella ? 'Salva' : 'Crea'}</button></>}>
      <ErrorBox error={err} />
      <form className="cf-form" onSubmit={go}>
        <Field label="Nome" required><input autoFocus value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="es. Procedure" /></Field>
        <Field label="Descrizione" help="Facoltativa, compare sotto il nome"><input value={descrizione} maxLength={1000} onChange={(e) => setDescrizione(e.target.value)} /></Field>
        <Field label="Posizione" help={cartella ? 'Spostando la cartella si spostano anche le sottocartelle e i documenti' : undefined}><FolderSelect cartelle={cartelle} value={parent} onChange={setParent} exclude={cartella ? [cartella.id] : []} /></Field>
      </form>
    </Modal>
  );
}

export function DocModal({ doc, cartelle, onClose, onSaved }) {
  const [nome, setNome] = useState(doc.nome);
  const [descrizione, setDescrizione] = useState(doc.descrizione || '');
  const [cartellaId, setCartellaId] = useState(doc.cartella_id);
  const [inEvidenza, setInEvidenza] = useState(Boolean(doc.in_evidenza));
  const [fino, setFino] = useState(doc.evidenza_fino ? String(doc.evidenza_fino).slice(0, 10) : '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const go = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      const saved = await api.put(`/documenti/${doc.id}`, { nome: nome.trim(), descrizione: descrizione.trim(), cartella_id: cartellaId || null, in_evidenza: inEvidenza, evidenza_fino: inEvidenza && fino ? fino : null });
      onSaved?.(saved); onClose();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal title="Modifica documento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !nome.trim()} onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <form className="cf-form" onSubmit={go}>
        <Field label="Nome mostrato" required help={`File originale: ${doc.filename}`}><input autoFocus value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Descrizione" help="Compare nelle schede e nella ricerca"><textarea value={descrizione} maxLength={1000} onChange={(e) => setDescrizione(e.target.value)} /></Field>
        <Field label="Cartella"><FolderSelect cartelle={cartelle} value={cartellaId} onChange={setCartellaId} /></Field>
        <label className="cf-check"><input type="checkbox" checked={inEvidenza} onChange={(e) => setInEvidenza(e.target.checked)} /> In evidenza (compare in cima alla cartella principale e nella pagina In evidenza)</label>
        {inEvidenza && <Field label="In evidenza fino al" help="Vuoto: senza scadenza"><input type="date" value={fino} onChange={(e) => setFino(e.target.value)} /></Field>}
      </form>
    </Modal>
  );
}

// Nuova versione: un solo file, stesso nome mostrato, versione + 1
export function VersioneModal({ doc, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try { const fd = new FormData(); fd.append('file', file); const saved = await api.upload(`/documenti/${doc.id}/versione`, fd); onSaved?.(saved); onClose(); }
    catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Nuova versione di ${doc.nome}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !file} onClick={go}>Carica la versione {doc.versione + 1}</button></>}>
      <ErrorBox error={err} />
      <p className="small muted">La versione attuale ({doc.versione}, {doc.filename}) resta consultabile nello storico. Il nome mostrato non cambia.</p>
      <DropZone multiple={false} onFiles={(fs) => setFile(fs[0])} compact>{file ? <><Icon name="file" /><div>{file.name} · {kb(file.size)}</div></> : null}</DropZone>
    </Modal>
  );
}

// Caricamento di più file in una cartella, con gestione dei nomi duplicati (proposta di nuova versione)
export function Uploader({ cartellaId, limiti, onDone, compact }) {
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null);   // { caricati, errori }
  const [dup, setDup] = useState(null);       // file duplicati in attesa di conferma
  const pendingRef = useRef([]);
  const accept = (limiti?.estensioni || []).map((e) => `.${e}`).join(',');
  const carica = async (files, sostituisci) => {
    setBusy(true); setEsito(null); setDup(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('file', f);
      if (sostituisci) fd.append('sostituisci', '1');
      let res;
      // con nessun file accettato il server risponde 400 e mette l'esito per file in details
      try { res = await api.upload(`/cartelle/${cartellaId || 0}/documenti`, fd); }
      catch (e) { if (e.status === 400 && e.details?.errori) res = e.details; else throw e; }
      const duplicati = (res.errori || []).filter((x) => x.codice === 'DUPLICATO');
      pendingRef.current = files.filter((f) => duplicati.some((d) => d.filename === f.name));
      setEsito(res);
      if (duplicati.length) setDup(duplicati);
      if (res.caricati?.length) onDone?.(res);
    } catch (e) { setEsito({ caricati: [], errori: [{ filename: '', error: e.message }] }); }
    finally { setBusy(false); }
  };
  return (
    <div className={`cf-upload ${compact ? 'compact' : ''}`}>
      <DropZone accept={accept} onFiles={(fs) => carica(fs, false)} compact={compact}>
        <Icon name="upload" /><div className={compact ? 'small' : ''}>{busy ? 'Caricamento in corso' : 'Trascina qui i file oppure clicca per sceglierli'}</div>
        {!compact && <div className="small muted">{(limiti?.estensioni || []).join(', ')} · massimo {limiti?.max_file_mb || 50} MB per file · fino a {limiti?.max_files || 20} file alla volta</div>}
      </DropZone>
      {esito && (esito.caricati?.length > 0 || esito.errori?.length > 0) && (
        <div className="cf-upload-esito">
          {esito.caricati?.length > 0 && <div className="cf-alert ok"><Icon name="check" className="ico" /><span>{esito.caricati.length === 1 ? `Caricato ${esito.caricati[0].nome}${esito.caricati[0].nuova_versione ? ` (versione ${esito.caricati[0].versione})` : ''}` : `Caricati ${esito.caricati.length} file`}</span></div>}
          {esito.errori?.filter((x) => x.codice !== 'DUPLICATO').map((x, i) => <div key={i} className="cf-alert warn"><Icon name="alert" className="ico" /><span>{x.filename ? `${x.filename}: ` : ''}{x.error}</span></div>)}
          {dup && <div className="cf-alert warn"><Icon name="info" className="ico" /><span>{dup.length === 1 ? `"${dup[0].filename}" esiste già in questa cartella.` : `${dup.length} file esistono già in questa cartella (${dup.map((d) => d.filename).join(', ')}).`} Vuoi caricarli come nuove versioni?</span>
            <button type="button" className="btn sm" disabled={busy} onClick={() => carica(pendingRef.current, true)}>Sì, nuove versioni</button><button type="button" className="btn sm ghost" onClick={() => setDup(null)}>No</button></div>}
        </div>
      )}
    </div>
  );
}
