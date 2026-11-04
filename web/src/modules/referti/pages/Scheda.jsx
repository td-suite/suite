// Scheda: anteprima affiancata (PDF sorgente a sinistra, referto TD rigenerato a destra), "Chiedi una correzione" a Claude con lo storico
// delle versioni e "Annulla l'ultima correzione", editor per blocchi del JSON della scheda (motore del 03/11/2026: riquadro anagrafico
// con le righe come vanno stampate; blocchi settore, titolo esame, paragrafo, tabella del corpo 1, esame e tabella del corpo 2,
// antibiogramma, spazio), anomalie in giallo, checklist di coerenza, Anteprima / Conferma / Conferma comunque / Scarta.
// Referto emesso: "Riapri", mittente della casella template@ con lo stato degli invii, "Invia al mittente" e "Reinvia".
// Schede del motore precedente: "Rielabora dal PDF".
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBase, base, useApi } from '../api.js';
import { useAuth, isLab } from '../index.jsx';
import { Card, Loading, Empty, PageHead, Badge, Field, useToast, ConfirmModal, PromptModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDateTime, pagineLabel, b64ToUrl, STATO_INVIO, LETTURA, ORIGINE_VERSIONE } from '../format.js';
import { SorgenteBadge, StatoBadge, Anomalie, LetturaBadge } from './Inbox.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const In = ({ value, onChange, className = '', ...rest }) => <input className={`rf-in ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
const Ta = ({ value, onChange, rows = 2, ...rest }) => <textarea className="rf-in" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
// Liste di righe (small, metodo): una per riga di testo; le righe vuote in mezzo restano finché si scrive
const righeDa = (v) => String(v).split('\n');
const nRighe = (v) => Math.min(8, Math.max(1, String(v ?? '').split('\n').length));

export const TIPI_BLOCCO = {
  settore: 'Titolo di settore',
  titolo_esame: 'Titolo dell\'esame',
  paragrafo: 'Paragrafo (note, valori di riferimento)',
  tabella1: 'Tabella esami (corpo 1)',
  esame2: 'Esame con metodo e materiale (corpo 2)',
  tabella2: 'Tabella etichetta / valore (corpo 2)',
  antibiogramma: 'Antibiogramma (microrganismo)',
  spacer: 'Spazio',
};
const NUOVO = {
  settore: () => ({ tipo: 'settore', titolo: '' }),
  titolo_esame: () => ({ tipo: 'titolo_esame', testo: '' }),
  paragrafo: () => ({ tipo: 'paragrafo', testo: '', stile: 'small', before: 120, after: 0 }),
  tabella1: () => ({ tipo: 'tabella1', righe: [{ nome: '', risultato: '', riferimento: '', bold_name: true, small: [], unit: '' }] }),
  esame2: () => ({ tipo: 'esame2', nome: '', metodo: ['Metodo: ', 'Materiale: '] }),
  tabella2: () => ({ tipo: 'tabella2', righe: [{ etichetta: '', valore: '' }] }),
  antibiogramma: (blocchi) => ({ tipo: 'antibiogramma', specie: '', n: blocchi.filter((b) => b.tipo === 'antibiogramma').length + 1, carica: '', carica_lbl: 'Carica Batterica', legenda: 'R: Resistente   I: Sensibile con aumentata esposizione al farmaco', righe: [['', 'S', '']] }),
  spacer: () => ({ tipo: 'spacer' }),
};
const ETICHETTE_RIQUADRO = ['Data di nascita', 'Sesso', 'Accettazione n°', 'Data Acc.', 'Referto', 'Accettazione', 'Luogo di nascita', 'Indirizzo'];

export function Checklist({ coerenza }) {
  if (!coerenza) return null;
  const etichetta = (c) => ({ TESTO_LAB_ESTERNO: 'Trovato', NUMERI_IN_PIU: 'In più', VALORI_IN_SORGENTE: 'Non trovati nella sorgente', RIGHE_SPURIE: 'Righe' }[c] || 'Mancano');
  return (
    <ul className="rf-check">
      {coerenza.check.map((c) => (
        <li key={c.codice} className={c.ok ? 'ok' : 'ko'}>
          <Icon name={c.ok ? 'check' : 'alert'} /><div><div>{c.testo}</div>
            {!c.ok && Array.isArray(c.dettagli) && c.dettagli.length > 0 && <div className="small muted">{etichetta(c.codice)}: {c.dettagli.join(', ')}</div>}</div>
        </li>))}
    </ul>
  );
}

// Editor di un blocco: ogni campo è quello che il generatore stampa
function EditorBlocco({ b, set, editable }) {
  const riga = (i, fn) => set((x) => { fn(x.righe[i]); });
  const togli = (i) => set((x) => { x.righe.splice(i, 1); });
  const del = (i) => editable && <button type="button" className="btn sm ghost danger" title="Elimina la riga" onClick={() => togli(i)}><Icon name="trash" /></button>;
  switch (b.tipo) {
    case 'settore': return <In value={b.titolo} onChange={(v) => set((x) => { x.titolo = v; })} className="rf-titolo" placeholder="MICROBIOLOGIA" />;
    case 'titolo_esame': return <In value={b.testo} onChange={(v) => set((x) => { x.testo = v; })} placeholder="Titolo dell'esame" />;
    case 'paragrafo': return (
      <div className="rf-par">
        <Ta value={b.testo} rows={nRighe(b.testo)} onChange={(v) => set((x) => { x.testo = v; })} placeholder="Testo (a capo = nuova riga)" />
        <div className="row rf-par-opt">
          <label className="small">Stile <select className="rf-in" value={b.stile || 'small'} onChange={(e) => set((x) => { x.stile = e.target.value; })}><option value="small">piccolo grigio (note)</option><option value="normale">normale</option></select></label>
          <label className="small">Spazio sopra <input className="rf-in rf-num" type="number" min={0} max={2000} step={20} value={b.before ?? 0} onChange={(e) => set((x) => { x.before = Number(e.target.value) || 0; })} /></label>
          <label className="small">Spazio sotto <input className="rf-in rf-num" type="number" min={0} max={2000} step={20} value={b.after ?? 0} onChange={(e) => set((x) => { x.after = Number(e.target.value) || 0; })} /></label>
        </div>
      </div>);
    case 'tabella1': return (
      <>
        <table className="t rf-edit">
          <thead><tr><th style={{ width: '34%' }}>Esame (a capo: descrizione) · righe piccole</th><th>Risultato</th><th style={{ width: 90 }}>Unità</th><th>Riferimento</th><th style={{ width: 54 }}>Grassetto</th><th style={{ width: 44 }}></th></tr></thead>
          <tbody>{(b.righe || []).map((r, i) => (
            <tr key={i}>
              <td><Ta value={r.nome} rows={nRighe(r.nome)} onChange={(v) => riga(i, (x) => { x.nome = v; })} /><Ta value={(r.small || []).join('\n')} rows={Math.max(1, (r.small || []).length)} onChange={(v) => riga(i, (x) => { x.small = v ? righeDa(v) : []; })} placeholder="Metodo: … / Materiale: … (una per riga)" /></td>
              <td><Ta value={r.risultato} rows={nRighe(r.risultato)} onChange={(v) => riga(i, (x) => { x.risultato = v; })} /></td>
              <td><In value={r.unit} onChange={(v) => riga(i, (x) => { x.unit = v; })} /></td>
              <td><Ta value={r.riferimento} rows={nRighe(r.riferimento)} onChange={(v) => riga(i, (x) => { x.riferimento = v; })} /></td>
              <td className="center"><input type="checkbox" checked={Boolean(r.bold_name)} onChange={(e) => riga(i, (x) => { x.bold_name = e.target.checked; })} /></td>
              <td className="actions">{del(i)}</td>
            </tr>))}</tbody>
        </table>
        {editable && <div className="row rf-add"><button type="button" className="btn sm ghost" onClick={() => set((x) => { x.righe.push({ nome: '', risultato: '', riferimento: '', bold_name: false, small: [], unit: '' }); })}><Icon name="plus" />Riga</button></div>}
      </>);
    case 'esame2': return (
      <div className="rf-grid2">
        <Field label="Esame"><In value={b.nome} onChange={(v) => set((x) => { x.nome = v; })} /></Field>
        <Field label="Metodo, materiale, sede (una per riga)"><Ta value={(b.metodo || []).join('\n')} rows={Math.max(2, (b.metodo || []).length)} onChange={(v) => set((x) => { x.metodo = v ? righeDa(v) : []; })} /></Field>
      </div>);
    case 'tabella2': return (
      <>
        <table className="t rf-edit">
          <thead><tr><th style={{ width: '36%' }}>Etichetta</th><th>Valore</th><th style={{ width: 150 }}>Riferimento (se c'è)</th><th style={{ width: 44 }}></th></tr></thead>
          <tbody>{(b.righe || []).map((r, i) => (
            <tr key={i}>
              <td><In value={r.etichetta} onChange={(v) => riga(i, (x) => { x.etichetta = v; })} /></td>
              <td><Ta value={r.valore} rows={nRighe(r.valore)} onChange={(v) => riga(i, (x) => { x.valore = v; })} /></td>
              <td><In value={r.riferimento || ''} onChange={(v) => riga(i, (x) => { if (v) x.riferimento = v; else delete x.riferimento; })} /></td>
              <td className="actions">{del(i)}</td>
            </tr>))}</tbody>
        </table>
        {editable && <div className="row rf-add"><button type="button" className="btn sm ghost" onClick={() => set((x) => { x.righe.push({ etichetta: '', valore: '' }); })}><Icon name="plus" />Riga</button></div>}
      </>);
    case 'antibiogramma': return (
      <div className="rf-ab">
        <div className="rf-grid4">
          <Field label="Microrganismo (specie)"><In value={b.specie} onChange={(v) => set((x) => { x.specie = v; })} /></Field>
          <Field label="Numero (#)"><input className="rf-in" type="number" min={1} max={20} value={b.n ?? 1} onChange={(e) => set((x) => { x.n = Number(e.target.value) || 1; })} /></Field>
          <Field label="Etichetta carica"><In value={b.carica_lbl} onChange={(v) => set((x) => { x.carica_lbl = v; })} placeholder="Carica Batterica" /></Field>
          <Field label="Carica (vuota = riga omessa)"><In value={b.carica} onChange={(v) => set((x) => { x.carica = v; })} /></Field>
        </div>
        <Field label="Legenda (come in sorgente, tre spazi tra le voci)"><In value={b.legenda} onChange={(v) => set((x) => { x.legenda = v; })} /></Field>
        <table className="t rf-edit rf-abt">
          <thead><tr><th>Antibiotico</th><th style={{ width: 110 }}>S / I / R</th><th style={{ width: 140 }}>MIC</th><th style={{ width: 44 }}></th></tr></thead>
          <tbody>{(b.righe || []).map((r, i) => (
            <tr key={i}>
              <td><In value={r[0]} onChange={(v) => riga(i, (x) => { x[0] = v; })} /></td>
              <td><select className="rf-in" value={r[1] || ''} onChange={(e) => riga(i, (x) => { x[1] = e.target.value; })}><option value="">-</option><option>S</option><option>I</option><option>R</option></select></td>
              <td><In value={r[2]} onChange={(v) => riga(i, (x) => { x[2] = v; })} /></td>
              <td className="actions">{del(i)}</td>
            </tr>))}</tbody>
        </table>
        {editable && <div className="row rf-add"><button type="button" className="btn sm ghost" onClick={() => set((x) => { x.righe.push(['', 'S', '']); })}><Icon name="plus" />Antibiotico</button></div>}
      </div>);
    case 'spacer': return <div className="small muted">Spazio sottile tra i blocchi (come nel generatore del progetto).</div>;
    default: return <div className="small rf-ko">Blocco non riconosciuto: {b.tipo}</div>;
  }
}

export default function Scheda() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const lab = isLab(user);
  const { data: scheda, error, reload } = useApi(`/schede/${id}`, [id]);
  const [form, setForm] = useState(null);
  const [nomeFile, setNomeFile] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [anteprima, setAnteprima] = useState(null);     // { url, coerenza, template, docxUrl }
  const [coerenza, setCoerenza] = useState(null);
  const [modal, setModal] = useState(null);             // 'conferma' | 'forza' | 'scarta' | 'riapri' | 'invia' | 'reinvia' | 'annulla' | 'rielabora'
  const [istruzione, setIstruzione] = useState('');
  const [nuovoTipo, setNuovoTipo] = useState('tabella1');
  useEffect(() => { if (scheda) { setForm(clone(scheda.dati || {})); setNomeFile(scheda.nome_file || ''); setDirty(false); } }, [scheda]);
  useEffect(() => () => { if (anteprima?.url) URL.revokeObjectURL(anteprima.url); }, [anteprima]);
  const vecchio = Boolean(scheda && (scheda.da_rielaborare || !Array.isArray(scheda.dati?.blocchi)));
  const editable = Boolean(scheda && scheda.stato === 'BOZZA' && lab && !vecchio);
  const upd = (fn) => { setForm((f) => { const n = clone(f); fn(n); return n; }); setDirty(true); };
  const updBlocco = (i) => (fn) => upd((f) => { fn(f.blocchi[i]); });

  const mostraAnteprima = (r) => {
    if (anteprima?.url) URL.revokeObjectURL(anteprima.url);
    setAnteprima({ url: r.pdf ? b64ToUrl(r.pdf, 'application/pdf') : null, docxUrl: r.docx ? b64ToUrl(r.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') : null, coerenza: r.coerenza, template: r.template, nome_file: r.nome_file });
    setCoerenza(r.coerenza);
  };
  const salva = async () => {
    if (!dirty) return true;
    await api.patch(`/schede/${id}`, { dati: form, nome_file: nomeFile });
    setDirty(false);
    return true;
  };
  const generaAnteprima = async () => {
    setBusy(true);
    try {
      const eraDirty = dirty;
      await salva();
      const r = await api.post(`/schede/${id}/anteprima`);
      mostraAnteprima(r);
      toast(r.coerenza.ok ? 'Anteprima generata: controllo di coerenza superato' : 'Anteprima generata: il controllo di coerenza segnala differenze', r.coerenza.ok ? 'ok' : 'err');
      if (eraDirty) reload();
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const correggi = async () => {
    if (istruzione.trim().length < 3) return toast('Scrivi cosa correggere', 'err');
    setBusy(true);
    try {
      if (dirty) await salva();
      const r = await api.post(`/schede/${id}/correzione`, { istruzione });
      mostraAnteprima(r.anteprima);
      setIstruzione('');
      toast(`Correzione applicata (versione ${r.versione}): controlla l'anteprima${r.anteprima.coerenza.ok ? '' : '; il controllo di coerenza segnala differenze'}`, r.anteprima.coerenza.ok ? 'ok' : 'err');
      reload();
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const annullaCorrezione = async () => {
    setBusy(true); setModal(null);
    try { const r = await api.post(`/schede/${id}/annulla-correzione`); mostraAnteprima(r.anteprima); toast(`Correzione della versione ${r.versione} annullata: ripristinata la versione ${r.ripristinata}`); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const rielabora = async () => {
    setBusy(true); setModal(null);
    try { const r = await api.post(`/schede/${id}/rielabora`); setAnteprima(null); setCoerenza(null); toast(`Scheda riletta dal PDF (${LETTURA[r.lettura]?.label || r.lettura}, versione ${r.versione}): genera l'anteprima`); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const conferma = async (force) => {
    setBusy(true); setModal(null);
    try {
      await salva();
      const r = await api.post(`/schede/${id}/conferma`, { force });
      const inv = r.invio?.stato ? (r.invio.stato === 'FALLITO' ? ` · invio al mittente non riuscito: ${r.invio.errore}` : ` · inviato a ${r.invio.to}${r.invio.stato === 'REGISTRATO' ? ' (registro)' : ''}`) : r.invio?.motivo && r.riconferma ? ` · ${r.invio.motivo}` : '';
      toast(`Scheda ${r.riconferma ? `riconfermata (versione ${r.versione}, file rigenerati)` : 'confermata'}: ${r.nome_file}.docx${r.scheda?.file?.some((f) => f.kind === 'PDF') ? ' e .pdf' : ''}${r.suffisso ? ' (nome con suffisso: esisteva già un file con lo stesso nome)' : ''}${r.sostituisce && !r.riconferma ? ' (file precedente sostituito, tracciato nel registro)' : ''}${inv}`, r.invio?.stato === 'FALLITO' ? 'err' : 'ok');
      reload();
    } catch (e) {
      if (e.code === 'COERENZA' || e.details?.coerenza || e.status === 400) { const c = e.details?.coerenza || null; if (c) setCoerenza(c); toast(e.message, 'err'); }
      else toast(e, 'err');
    }
    setBusy(false);
  };
  const riapri = async () => {
    setBusy(true); setModal(null);
    try { const r = await api.post(`/schede/${id}/riapri`); toast(r.da_rielaborare ? 'Referto riaperto: è del motore precedente, rielaboralo dal PDF prima di correggerlo.' : 'Referto riaperto: correggi la scheda (anche con "Chiedi una correzione") e riconfermalo. I file emessi restano in archivio fino alla nuova conferma.'); reload(); window.dispatchEvent(new Event('suite:badges')); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const invia = async (reinvia) => {
    setBusy(true); setModal(null);
    try { const r = await api.post(`/schede/${id}/invia`, { reinvia }); toast(r.stato === 'FALLITO' ? `Invio non riuscito: ${r.errore}` : `${reinvia ? 'Reinviato' : 'Inviato'} a ${r.to}${r.stato === 'REGISTRATO' ? ' (posta in modalità registro: nessun invio reale)' : ''}`, r.stato === 'FALLITO' ? 'err' : 'ok'); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const scarta = async (motivo) => {
    setBusy(true); setModal(null);
    try { await api.post(`/schede/${id}/scarta`, { motivo }); toast('Scheda scartata'); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };

  if (error) return <div className="page"><Empty icon="alert" title="Scheda non disponibile">{error.message}</Empty></div>;
  if (!scheda || !form) return <div className="page"><Loading /></div>;
  const a = form.anagrafica || { cognome_nome: '', righe: [] };
  const blocchi = form.blocchi || [];
  const pagina = scheda.pagine?.[0] || 1;
  const sorgenteUrl = `${apiBase}/elaborazioni/${scheda.elaborazione_id}/pdf?inline=1#page=${pagina}&view=FitH`;
  const filePdf = scheda.file?.find((f) => f.kind === 'PDF');
  const fileDocx = scheda.file?.find((f) => f.kind === 'DOCX');
  const destraUrl = scheda.stato === 'CONFERMATA' && filePdf ? `${apiBase}/file/${filePdf.id}?inline=1` : anteprima?.url || (scheda.riaperta_at && filePdf ? `${apiBase}/file/${filePdf.id}?inline=1` : null);
  const casella = scheda.origine === 'CASELLA';
  const partiti = (scheda.invii || []).filter((i) => i.stato !== 'FALLITO');
  const ultimoOk = partiti[0];
  const daReinviare = Boolean(ultimoOk && scheda.stato === 'CONFERMATA' && new Date(scheda.confirmed_at) > new Date(ultimoOk.at));
  const pdfGiaInviato = Boolean(filePdf && partiti.some((i) => i.file_sha256 === filePdf.sha256 && i.to_email === (scheda.from_email || '').toLowerCase()));
  const versioni = scheda.versioni || [];
  const ultimaCorrezione = versioni[0]?.origine === 'CORREZIONE' && versioni.length > 1 ? versioni[0] : null;
  const sposta = (i, d) => upd((f) => { const j = i + d; if (j < 0 || j >= f.blocchi.length) return; [f.blocchi[i], f.blocchi[j]] = [f.blocchi[j], f.blocchi[i]]; });

  return (
    <div className="page rf-scheda">
      <PageHead crumb={<Link to={base}>Inbox</Link>} title={scheda.cognome_nome || 'Scheda'} icon="file"
        sub={<span><SorgenteBadge s={scheda.sorgente} /> <StatoBadge s={scheda.stato} /> <LetturaBadge l={scheda.lettura} /> {scheda.ocr && <Badge tone="amber" dot={false}>OCR</Badge>} <span className="muted">{scheda.elaborazione_filename} · {pagineLabel(scheda.pagine)} di {scheda.elaborazione_pagine}{scheda.confirmed_at ? ` · confermata il ${itDateTime(scheda.confirmed_at)} da ${scheda.confirmed_by_nome || ''}` : ''}</span></span>}
        actions={editable ? <>
          <button className="btn ghost" disabled={busy} onClick={generaAnteprima}><Icon name="eye" />{dirty ? 'Salva e genera anteprima' : 'Anteprima'}</button>
          <button className="btn" disabled={busy} onClick={() => setModal('conferma')}><Icon name="check" />Conferma</button>
          {coerenza && !coerenza.ok && <button className="btn danger" disabled={busy} onClick={() => setModal('forza')}><Icon name="alert" />Conferma comunque</button>}
          <button className="btn ghost danger" disabled={busy} onClick={() => setModal('scarta')}><Icon name="trash" />Scarta</button>
        </> : scheda.stato === 'BOZZA' && vecchio && lab ? <>
          <button className="btn" disabled={busy} onClick={() => setModal('rielabora')}><Icon name="refresh" />Rielabora dal PDF</button>
          {!scheda.riaperta_at && <button className="btn ghost danger" disabled={busy} onClick={() => setModal('scarta')}><Icon name="trash" />Scarta</button>}
        </> : scheda.stato === 'CONFERMATA' ? <>
          {scheda.file?.map((f) => <a key={f.id} className="btn ghost" href={`${apiBase}/file/${f.id}`}><Icon name={f.kind === 'DOCX' ? 'doc' : 'pdf'} />{f.kind === 'SORGENTE_PDF' ? 'PDF di partenza' : f.kind === 'DOCX' ? 'DOCX' : 'PDF TD'}</a>)}
          {lab && scheda.from_email && !pdfGiaInviato && <button className="btn" disabled={busy} onClick={() => setModal('invia')}><Icon name="mail" />{daReinviare ? 'Reinvia al mittente' : 'Invia al mittente'}</button>}
          {lab && scheda.from_email && pdfGiaInviato && <button className="btn ghost" disabled={busy} onClick={() => setModal('reinvia')}><Icon name="mail" />Reinvia</button>}
          {lab && <button className="btn ghost" disabled={busy} onClick={() => setModal('riapri')}><Icon name="edit" />Riapri</button>}
        </> : null} />

      {vecchio && scheda.stato === 'BOZZA' && <div className="rf-alert warn"><Icon name="refresh" className="ico" /><div><div className="strong">Scheda del motore precedente: da rielaborare</div><div className="small">I dati sono nel formato dei vecchi parser e non si possono più generare né confermare. "Rielabora dal PDF" rilegge le pagine della scheda con il nuovo motore (lettura con Claude e generatore del progetto); il risultato diventa una nuova versione.</div></div></div>}
      {scheda.lettura === 'RISERVA' && scheda.stato === 'BOZZA' && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div><div className="strong">Letta con il parser di riserva</div><div className="small">La lettura con Claude non era disponibile (chiave Anthropic assente o lettura non riuscita): i dati vengono dai parser a mano. Controlla ogni valore con il PDF a sinistra; con la chiave configurata puoi usare "Rielabora dal PDF".</div></div></div>}
      {scheda.riaperta_at && scheda.stato === 'BOZZA' && <div className="rf-alert warn"><Icon name="edit" className="ico" /><div><div className="strong">Referto riaperto il {itDateTime(scheda.riaperta_at)}{scheda.riaperta_by_nome ? ` da ${scheda.riaperta_by_nome}` : ''}</div><div className="small">I file della versione {scheda.versione} restano in archivio finché non riconfermi; alla conferma DOCX e PDF vengono rigenerati e sostituiti.{partiti.length ? ' Il referto era già stato inviato al mittente: dopo la conferma potrai reinviarlo.' : ''}</div></div></div>}
      {(casella || scheda.invii?.length > 0) && (
        <div className="rf-alert"><Icon name="mail" className="ico" /><div style={{ flex: 1 }}>
          <div className="rf-mittente"><span className="strong">Dalla casella</span> <span>{scheda.from_name ? `${scheda.from_name} · ` : ''}{scheda.from_email || 'mittente sconosciuto'}</span>{scheda.subject && <span className="muted">"{scheda.subject}"</span>}{scheda.received_at && <span className="muted small">{itDateTime(scheda.received_at)}</span>}</div>
          {scheda.invii?.length ? <ul className="rf-invii" style={{ marginTop: 6 }}>{scheda.invii.map((i) => (
            <li key={i.id}><Badge tone={STATO_INVIO[i.stato]?.tone || 'grey'} dot={false}>{STATO_INVIO[i.stato]?.breve || STATO_INVIO[i.stato]?.label || i.stato}</Badge> <span>a {i.to_email}</span> <span className="muted small">{itDateTime(i.at)} · {i.automatico ? 'automatico' : i.user_nome || 'manuale'}{i.versione > 1 ? ` · versione ${i.versione}` : ''}</span>{i.errore && <span className="small rf-ko">{i.errore}</span>}</li>))}</ul>
            : <div className="small muted" style={{ marginTop: 4 }}>{scheda.stato === 'CONFERMATA' ? 'Non ancora inviato al mittente.' : 'Alla conferma il PDF del referto partirà al mittente (se "Invia al mittente" è acceso nelle Impostazioni).'}</div>}
          {daReinviare && <div className="small" style={{ marginTop: 4 }}><b>Riconfermato dopo l'ultimo invio:</b> il mittente ha ancora la versione precedente.</div>}
        </div></div>)}
      {scheda.anomalie?.length > 0 && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div><div className="strong">Casi da verificare ({scheda.anomalie.length})</div><Anomalie list={scheda.anomalie} /></div></div>}
      {scheda.stato === 'CONFERMATA' && scheda.file?.some((f) => f.kind === 'SORGENTE_PDF' && f.intero) && <div className="rf-alert"><Icon name="info" className="ico" /><span>Il PDF di partenza è il file intero caricato (più pazienti): il ritaglio alle sole pagine della scheda non è disponibile su questo server.</span></div>}

      <div className="rf-split">
        <Card title={`PDF sorgente · ${pagineLabel(scheda.pagine)}`} icon="pdf" flush className="rf-pane">
          <iframe title="PDF sorgente" src={sorgenteUrl} className="rf-frame" />
        </Card>
        <Card title={scheda.stato === 'CONFERMATA' ? 'Referto TD (PDF definitivo)' : scheda.riaperta_at && !anteprima ? `Referto TD emesso (versione ${scheda.versione})` : 'Anteprima referto TD'} icon="file" flush className="rf-pane"
          actions={anteprima?.docxUrl && scheda.stato === 'BOZZA' ? <a className="btn sm ghost" href={anteprima.docxUrl} download={`${nomeFile || 'Referto'}.docx`}><Icon name="doc" />DOCX di anteprima</a> : fileDocx ? <a className="btn sm ghost" href={`${apiBase}/file/${fileDocx.id}`}><Icon name="doc" />DOCX</a> : null}>
          {destraUrl ? <iframe title="Referto TD" src={destraUrl} className="rf-frame" /> : (
            <div className="rf-placeholder"><Icon name="eye" /><div>{editable ? 'Genera l\'anteprima per vedere il referto sul format Toscana Diagnostica. Si rigenera a ogni salvataggio e a ogni correzione.' : vecchio && scheda.stato === 'BOZZA' ? 'Rielabora la scheda dal PDF per generare il referto.' : scheda.stato === 'SCARTATA' ? 'Scheda scartata: nessun referto prodotto.' : 'Anteprima disponibile al personale di laboratorio.'}</div>{editable && <button className="btn" disabled={busy} onClick={generaAnteprima}><Icon name="eye" />Genera anteprima</button>}</div>)}
        </Card>
      </div>

      {(editable || versioni.length > 1) && (
        <Card title="Chiedi una correzione" icon="sparkle" className="rf-correzione">
          {editable && <>
            <div className="small muted" style={{ marginBottom: 6 }}>Scrivi in italiano cosa va cambiato, come lo diresti al collega: Claude rilegge il PDF e la scheda e applica solo la modifica richiesta, il resto resta com'è. Il risultato diventa una nuova versione e l'anteprima si rigenera.</div>
            <textarea className="rf-in" rows={2} value={istruzione} onChange={(e) => setIstruzione(e.target.value)} placeholder="Scrivi cosa correggere, es. «cambia la carica in 100.000 UFC/ml» oppure «la riga Esito del secondo esame è Negativa, non Negativo»" disabled={busy} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
              <span className="small muted">{LETTURA[scheda.lettura]?.correzione || ''}</span>
              <div className="row" style={{ gap: 8 }}>
                {ultimaCorrezione && <button className="btn ghost" disabled={busy} onClick={() => setModal('annulla')}><Icon name="back" />Annulla l'ultima correzione</button>}
                <button className="btn" disabled={busy || istruzione.trim().length < 3} onClick={correggi}><Icon name="sparkle" />{busy ? 'Correzione in corso' : 'Chiedi la correzione'}</button>
              </div>
            </div>
          </>}
          {versioni.length > 0 && (
            <ol className="rf-versioni" reversed>
              {versioni.map((v) => (
                <li key={v.id}><Badge tone={ORIGINE_VERSIONE[v.origine]?.tone || 'grey'} dot={false}>v{v.n} · {ORIGINE_VERSIONE[v.origine]?.label || v.origine}</Badge>
                  {v.istruzione && <span className="rf-istr">"{v.istruzione}"</span>}
                  <span className="muted small">{itDateTime(v.at)}{v.user_nome ? ` · ${v.user_nome}` : v.origine === 'LETTURA' ? ' · lettura automatica' : ''}</span></li>))}
            </ol>)}
        </Card>)}

      {(coerenza || anteprima) && (
        <Card title="Controllo di coerenza" icon="shield">
          <Checklist coerenza={coerenza || anteprima?.coerenza} />
          {anteprima?.template && <div className="small muted">Template del referto: {anteprima.template}</div>}
        </Card>)}

      {!vecchio && (
        <Card title="Dati del referto" icon="edit" actions={editable && <span className="small muted">{dirty ? 'Modifiche non salvate' : 'Nessuna modifica'}</span>}>
          <fieldset className="rf-fs" disabled={!editable}>
            <div className="rf-sub">Ogni campo finisce nel referto così com'è scritto: stessi blocchi e stesso ordine del generatore del progetto. A capo dentro un campo = nuova riga nel referto.</div>
            <div className="rf-blocco rf-blocco-ana">
              <div className="rf-blocco-hd"><span className="rf-blocco-tipo">Riquadro anagrafico</span></div>
              <div className="rf-grid2">
                <Field label="Cognome e nome (come in sorgente)"><In value={a.cognome_nome} onChange={(v) => upd((f) => { f.anagrafica.cognome_nome = v.toUpperCase(); })} /></Field>
                <Field label="Nome del file" help="Senza estensione: si producono .docx e .pdf. Se esiste già per un'altra scheda, alla conferma viene aggiunto un suffisso tra parentesi."><In value={nomeFile} onChange={(v) => { setNomeFile(v); setDirty(true); }} /></Field>
              </div>
              <table className="t rf-edit rf-ana">
                <thead><tr><th style={{ width: 200 }}>Etichetta</th><th>Valore (come va stampato)</th><th style={{ width: 44 }}></th></tr></thead>
                <tbody>{(a.righe || []).map((r, i) => (
                  <tr key={i}>
                    <td><In value={r[0]} list="rf-etichette" onChange={(v) => upd((f) => { f.anagrafica.righe[i][0] = v; })} /></td>
                    <td><In value={r[1]} onChange={(v) => upd((f) => { f.anagrafica.righe[i][1] = v; })} placeholder={r[0] === 'Data di nascita' ? 'gg/mm/aaaa (anni NN)' : ''} /></td>
                    <td className="actions">{editable && <button type="button" className="btn sm ghost danger" title="Elimina la riga" onClick={() => upd((f) => { f.anagrafica.righe.splice(i, 1); })}><Icon name="trash" /></button>}</td>
                  </tr>))}</tbody>
              </table>
              <datalist id="rf-etichette">{ETICHETTE_RIQUADRO.map((e) => <option key={e} value={e} />)}</datalist>
              {editable && <div className="row rf-add"><button type="button" className="btn sm ghost" onClick={() => upd((f) => { f.anagrafica.righe.push(['', '']); })}><Icon name="plus" />Riga del riquadro</button></div>}
            </div>

            {blocchi.map((b, i) => (
              <div key={i} className={`rf-blocco rf-b-${b.tipo}`}>
                <div className="rf-blocco-hd">
                  <span className="rf-blocco-tipo">{i + 1}. {TIPI_BLOCCO[b.tipo] || b.tipo}{b.tipo === 'antibiogramma' ? ` #${b.n}` : ''}</span>
                  {editable && <span className="rf-blocco-az">
                    <button type="button" className="btn sm ghost" title="Sposta su" disabled={i === 0} onClick={() => sposta(i, -1)}><Icon name="chevron" className="rf-su" /></button>
                    <button type="button" className="btn sm ghost" title="Sposta giù" disabled={i === blocchi.length - 1} onClick={() => sposta(i, 1)}><Icon name="chevron" className="rf-giu" /></button>
                    <button type="button" className="btn sm ghost danger" title="Elimina il blocco" onClick={() => upd((f) => { f.blocchi.splice(i, 1); })}><Icon name="trash" /></button>
                  </span>}
                </div>
                <EditorBlocco b={b} set={updBlocco(i)} editable={editable} />
              </div>))}
            {editable && <div className="row rf-add rf-nuovo">
              <select className="rf-in" value={nuovoTipo} onChange={(e) => setNuovoTipo(e.target.value)} style={{ maxWidth: 320 }}>{Object.entries(TIPI_BLOCCO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button type="button" className="btn sm ghost" onClick={() => upd((f) => { const fine = f.blocchi.length && f.blocchi[f.blocchi.length - 1].tipo === 'spacer' ? f.blocchi.length - 1 : f.blocchi.length; f.blocchi.splice(fine, 0, NUOVO[nuovoTipo](f.blocchi)); })}><Icon name="plus" />Aggiungi blocco</button>
              <span className="small muted">Il nuovo blocco va prima dello spazio finale; spostalo con le frecce.</span>
            </div>}
          </fieldset>
          {editable && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" disabled={busy || !dirty} onClick={generaAnteprima}><Icon name="check" />Salva e rigenera anteprima</button></div>}
        </Card>)}

      {modal === 'conferma' && <ConfirmModal title="Conferma la scheda" text={`Vengono generati "${nomeFile || scheda.nome_file}.docx" e il PDF sul format Toscana Diagnostica dopo il controllo di coerenza. Se il controllo non è superato la conferma si ferma e compare la checklist.`} confirmText="Conferma" onConfirm={() => conferma(false)} onClose={() => setModal(null)} />}
      {modal === 'forza' && <ConfirmModal title="Conferma comunque" danger text="Il controllo di coerenza segnala differenze tra la sorgente e il referto TD. Confermando comunque, la forzatura viene tracciata nel registro. Procedere solo dopo il controllo visivo dell'anteprima." confirmText="Conferma comunque" onConfirm={() => conferma(true)} onClose={() => setModal(null)} />}
      {modal === 'annulla' && <ConfirmModal title="Annulla l'ultima correzione" text={`La correzione della versione ${ultimaCorrezione?.n} ("${ultimaCorrezione?.istruzione || ''}") viene tolta e la scheda torna ai dati della versione precedente. L'annullamento resta nel registro.`} confirmText="Annulla la correzione" onConfirm={annullaCorrezione} onClose={() => setModal(null)} />}
      {modal === 'rielabora' && <ConfirmModal title="Rielabora dal PDF" text="Le pagine della scheda vengono rilette dal PDF di partenza con il nuovo motore. I dati attuali restano nello storico; il risultato diventa una nuova versione da controllare." confirmText="Rielabora" onConfirm={rielabora} onClose={() => setModal(null)} />}
      {modal === 'riapri' && <ConfirmModal title="Riapri il referto" text={`La scheda torna in bozza e potrai modificarla, anche con "Chiedi una correzione". I file emessi (DOCX e PDF) restano in archivio fino alla nuova conferma, che li rigenera e li sostituisce.${partiti.length ? ' Il referto è già stato inviato al mittente: dopo la riconferma potrai reinviarlo (non parte da solo).' : ''} L'operazione resta nel registro.`} confirmText="Riapri" onConfirm={riapri} onClose={() => setModal(null)} />}
      {modal === 'invia' && <ConfirmModal title={daReinviare ? 'Reinvia al mittente' : 'Invia al mittente'} text={`Il PDF del referto "${scheda.nome_file}.pdf" parte dalla casella dei referti verso ${scheda.from_email}, con oggetto "Toscana Diagnostica · Referto ${scheda.cognome_nome}" e nessun dato clinico nel testo.`} confirmText="Invia" onConfirm={() => invia(daReinviare)} onClose={() => setModal(null)} />}
      {modal === 'reinvia' && <ConfirmModal title="Reinvia al mittente" text={`Questo PDF è già stato inviato a ${scheda.from_email}. Reinviarlo comunque?`} confirmText="Reinvia" onConfirm={() => invia(true)} onClose={() => setModal(null)} />}
      {modal === 'scarta' && <PromptModal title="Scarta la scheda" label="Motivo (facoltativo)" placeholder="Es. referto già trascritto, PDF duplicato" confirmText="Scarta" minLength={0} onConfirm={scarta} onClose={() => setModal(null)} />}
    </div>
  );
}
