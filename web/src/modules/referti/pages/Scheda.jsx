// Scheda: anteprima affiancata (PDF sorgente a sinistra, referto TD rigenerato a destra), pannello dati editabile (riquadro anagrafico
// come il modello TD: cognome e nome, data di nascita, sesso, accettazione; luogo di nascita e indirizzo se presenti; settori ed esami,
// antibiogrammi, note), anomalie in giallo, checklist di coerenza, pulsanti Anteprima / Conferma / Conferma comunque / Scarta.
// Referto emesso (31/10/2026): "Riapri" (torna in bozza, i file restano finché non si riconferma), mittente della mail della casella
// template@ con lo stato degli invii, "Invia al mittente" e "Reinvia".
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBase, base, useApi } from '../api.js';
import { useAuth, isLab } from '../index.jsx';
import { Card, Loading, Empty, PageHead, Badge, Field, useToast, ConfirmModal, PromptModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDateTime, pagineLabel, b64ToUrl, ORIGINE, STATO_INVIO } from '../format.js';
import { SorgenteBadge, StatoBadge, Anomalie } from './Inbox.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const In = ({ value, onChange, className = '', ...rest }) => <input className={`rf-in ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
const Ta = ({ value, onChange, rows = 2, ...rest }) => <textarea className="rf-in" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;

export function Checklist({ coerenza }) {
  if (!coerenza) return null;
  return (
    <ul className="rf-check">
      {coerenza.check.map((c) => (
        <li key={c.codice} className={c.ok ? 'ok' : 'ko'}>
          <Icon name={c.ok ? 'check' : 'alert'} /><div><div>{c.testo}</div>
            {!c.ok && Array.isArray(c.dettagli) && c.dettagli.length > 0 && <div className="small muted">{c.codice === 'TESTO_LAB_ESTERNO' ? 'Trovato' : c.codice === 'NUMERI_IN_PIU' ? 'In più' : 'Mancano'}: {c.dettagli.join(', ')}</div>}</div>
        </li>))}
    </ul>
  );
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
  const [modal, setModal] = useState(null);             // 'conferma' | 'forza' | 'scarta'
  useEffect(() => { if (scheda) { setForm(clone(scheda.dati || {})); setNomeFile(scheda.nome_file || ''); setDirty(false); setAnteprima(null); } }, [scheda]);
  useEffect(() => () => { if (anteprima?.url) URL.revokeObjectURL(anteprima.url); }, [anteprima]);
  const editable = Boolean(scheda && scheda.stato === 'BOZZA' && lab);
  const upd = (fn) => { setForm((f) => { const n = clone(f); fn(n); return n; }); setDirty(true); };

  const salva = async () => {
    if (!dirty) return true;
    await api.patch(`/schede/${id}`, { dati: form, nome_file: nomeFile });
    setDirty(false);
    return true;
  };
  const generaAnteprima = async () => {
    setBusy(true);
    try {
      await salva();
      const r = await api.post(`/schede/${id}/anteprima`);
      if (anteprima?.url) URL.revokeObjectURL(anteprima.url);
      setAnteprima({ url: r.pdf ? b64ToUrl(r.pdf, 'application/pdf') : null, docxUrl: r.docx ? b64ToUrl(r.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') : null, coerenza: r.coerenza, template: r.template, nome_file: r.nome_file });
      setCoerenza(r.coerenza);
      toast(r.coerenza.ok ? 'Anteprima generata: controllo di coerenza superato' : 'Anteprima generata: il controllo di coerenza segnala differenze', r.coerenza.ok ? 'ok' : 'err');
      if (dirty) reload();
    } catch (e) { toast(e, 'err'); }
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
    try { await api.post(`/schede/${id}/riapri`); toast('Referto riaperto: modifica la scheda e riconfermalo. I file emessi restano in archivio fino alla nuova conferma.'); reload(); window.dispatchEvent(new Event('suite:badges')); } catch (e) { toast(e, 'err'); }
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
  const a = form.anagrafica || {};
  const pagina = scheda.pagine?.[0] || 1;
  const sorgenteUrl = `${apiBase}/elaborazioni/${scheda.elaborazione_id}/pdf?inline=1#page=${pagina}&view=FitH`;
  const filePdf = scheda.file?.find((f) => f.kind === 'PDF');
  const fileDocx = scheda.file?.find((f) => f.kind === 'DOCX');
  const destraUrl = scheda.stato === 'CONFERMATA' && filePdf ? `${apiBase}/file/${filePdf.id}?inline=1` : anteprima?.url || (scheda.riaperta_at && filePdf ? `${apiBase}/file/${filePdf.id}?inline=1` : null);
  const corpo2 = Number(form.corpo) === 2;
  const casella = scheda.origine === 'CASELLA';
  const partiti = (scheda.invii || []).filter((i) => i.stato !== 'FALLITO');
  const ultimoOk = partiti[0];
  // reinvio da proporre: già partito e riconfermato dopo l'ultimo invio (file rigenerati)
  const daReinviare = Boolean(ultimoOk && scheda.stato === 'CONFERMATA' && new Date(scheda.confirmed_at) > new Date(ultimoOk.at));
  const pdfGiaInviato = Boolean(filePdf && partiti.some((i) => i.file_sha256 === filePdf.sha256 && i.to_email === (scheda.from_email || '').toLowerCase()));

  return (
    <div className="page rf-scheda">
      <PageHead crumb={<Link to={base}>Inbox</Link>} title={scheda.cognome_nome || 'Scheda'} icon="file"
        sub={<span><SorgenteBadge s={scheda.sorgente} /> <StatoBadge s={scheda.stato} /> {scheda.ocr && <Badge tone="amber" dot={false}>OCR</Badge>} <span className="muted">{scheda.elaborazione_filename} · {pagineLabel(scheda.pagine)} di {scheda.elaborazione_pagine}{scheda.confirmed_at ? ` · confermata il ${itDateTime(scheda.confirmed_at)} da ${scheda.confirmed_by_nome || ''}` : ''}</span></span>}
        actions={editable ? <>
          <button className="btn ghost" disabled={busy} onClick={generaAnteprima}><Icon name="eye" />{dirty ? 'Salva e genera anteprima' : 'Anteprima'}</button>
          <button className="btn" disabled={busy} onClick={() => setModal('conferma')}><Icon name="check" />Conferma</button>
          {coerenza && !coerenza.ok && <button className="btn danger" disabled={busy} onClick={() => setModal('forza')}><Icon name="alert" />Conferma comunque</button>}
          <button className="btn ghost danger" disabled={busy} onClick={() => setModal('scarta')}><Icon name="trash" />Scarta</button>
        </> : scheda.stato === 'CONFERMATA' ? <>
          {scheda.file?.map((f) => <a key={f.id} className="btn ghost" href={`${apiBase}/file/${f.id}`}><Icon name={f.kind === 'DOCX' ? 'doc' : 'pdf'} />{f.kind === 'SORGENTE_PDF' ? 'PDF di partenza' : f.kind === 'DOCX' ? 'DOCX' : 'PDF TD'}</a>)}
          {lab && scheda.from_email && !pdfGiaInviato && <button className="btn" disabled={busy} onClick={() => setModal('invia')}><Icon name="mail" />{daReinviare ? 'Reinvia al mittente' : 'Invia al mittente'}</button>}
          {lab && scheda.from_email && pdfGiaInviato && <button className="btn ghost" disabled={busy} onClick={() => setModal('reinvia')}><Icon name="mail" />Reinvia</button>}
          {lab && <button className="btn ghost" disabled={busy} onClick={() => setModal('riapri')}><Icon name="edit" />Riapri</button>}
        </> : null} />

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
            <div className="rf-placeholder"><Icon name="eye" /><div>{editable ? 'Genera l\'anteprima per vedere il referto sul format Toscana Diagnostica. Si rigenera a ogni salvataggio.' : scheda.stato === 'SCARTATA' ? 'Scheda scartata: nessun referto prodotto.' : 'Anteprima disponibile al personale di laboratorio.'}</div>{editable && <button className="btn" disabled={busy} onClick={generaAnteprima}><Icon name="eye" />Genera anteprima</button>}</div>)}
        </Card>
      </div>

      {(coerenza || anteprima) && (
        <Card title="Controllo di coerenza" icon="shield">
          <Checklist coerenza={coerenza || anteprima?.coerenza} />
          {anteprima?.template && <div className="small muted">Carta intestata: {anteprima.template === 'predefinito' ? 'template predefinito (offerta Service): caricare dalle Impostazioni il template del referto' : anteprima.template}</div>}
        </Card>)}

      <Card title="Dati del referto" icon="edit" actions={editable && <span className="small muted">{dirty ? 'Modifiche non salvate' : 'Nessuna modifica'}</span>}>
        <fieldset className="rf-fs" disabled={!editable}>
          <div className="rf-sub">Riquadro anagrafico del referto TD (modello del 29/10/2026): PAZIENTE, cognome e nome, data di nascita, sesso, riferimenti di accettazione; luogo di nascita e indirizzo compaiono solo se presenti nella sorgente.</div>
          <div className="rf-grid4">
            <Field label="Cognome e nome (come in sorgente)"><In value={a.cognome_nome} onChange={(v) => upd((f) => { f.anagrafica.cognome_nome = v.toUpperCase(); })} /></Field>
            <Field label="Sesso"><select className="rf-in" value={a.sesso || ''} onChange={(e) => upd((f) => { f.anagrafica.sesso = e.target.value; })}><option value="">-</option><option value="F">F</option><option value="M">M</option></select></Field>
            <Field label="Data di nascita"><In value={a.data_nascita} onChange={(v) => upd((f) => { f.anagrafica.data_nascita = v; })} placeholder="gg/mm/aaaa" /></Field>
            <Field label="Età (anni, se indicata)"><In value={a.eta ?? ''} onChange={(v) => upd((f) => { f.anagrafica.eta = v; })} /></Field>
            <Field label="Luogo di nascita (se presente)"><In value={a.luogo_nascita} onChange={(v) => upd((f) => { f.anagrafica.luogo_nascita = v; })} placeholder="Comune (Prov.)" /></Field>
            <Field label="Indirizzo (se presente)"><In value={a.indirizzo} onChange={(v) => upd((f) => { f.anagrafica.indirizzo = v; })} placeholder="Via, CAP, comune" /></Field>
            <Field label="Nome del file" help="Senza estensione: si producono .docx e .pdf. Se esiste già per un'altra scheda, alla conferma viene aggiunto un suffisso tra parentesi."><In value={nomeFile} onChange={(v) => { setNomeFile(v); setDirty(true); }} /></Field>
          </div>
          <div className="rf-grid4">
            {a.variante === 'B' ? <>
              <Field label="Referto (codice)"><In value={a.referto_codice} onChange={(v) => upd((f) => { f.anagrafica.referto_codice = v; })} /></Field>
              <Field label="Referto (data)"><In value={a.referto_data} onChange={(v) => upd((f) => { f.anagrafica.referto_data = v; })} /></Field>
              <Field label="Accettazione (codice)"><In value={a.accettazione_codice} onChange={(v) => upd((f) => { f.anagrafica.accettazione_codice = v; })} /></Field>
              <Field label="Accettazione (data)"><In value={a.accettazione_data} onChange={(v) => upd((f) => { f.anagrafica.accettazione_data = v; })} /></Field>
            </> : <>
              <Field label="Accettazione n°"><In value={a.accettazione_n} onChange={(v) => upd((f) => { f.anagrafica.accettazione_n = v; })} /></Field>
              <Field label="Data Acc."><In value={a.data_acc} onChange={(v) => upd((f) => { f.anagrafica.data_acc = v; })} /></Field>
            </>}
          </div>

          {(form.settori || []).map((s, si) => (
            <div key={si} className="rf-settore">
              <div className="rf-settore-hd"><In value={s.titolo} onChange={(v) => upd((f) => { f.settori[si].titolo = v.toUpperCase(); })} className="rf-titolo" placeholder="Senza titolo di settore (la sorgente non lo ha)" />
                {editable && <button className="btn sm ghost danger" title="Elimina settore" onClick={() => upd((f) => { f.settori.splice(si, 1); })}><Icon name="trash" /></button>}</div>
              {!corpo2 && (
                <table className="t rf-edit">
                  <thead><tr><th style={{ width: '36%' }}>Esame / antibiotico</th><th>Risultato</th><th style={{ width: 90 }}>Unità</th><th>Riferimento / MIC</th><th style={{ width: 54 }}></th></tr></thead>
                  <tbody>{(s.righe || []).map((r, ri) => (
                    <tr key={ri} className={`tipo-${r.tipo}`}>
                      {r.tipo === 'esame' ? <>
                        <td><In value={r.nome} onChange={(v) => upd((f) => { f.settori[si].righe[ri].nome = v; })} /><Ta rows={1} value={(r.sotto || []).join('\n')} onChange={(v) => upd((f) => { f.settori[si].righe[ri].sotto = v.split('\n').filter((x) => x.trim()); })} placeholder="Metodo / Materiale / Sede (una per riga)" /></td>
                        <td><Ta rows={1} value={r.risultato} onChange={(v) => upd((f) => { f.settori[si].righe[ri].risultato = v; })} /></td>
                        <td><In value={r.unita} onChange={(v) => upd((f) => { f.settori[si].righe[ri].unita = v; })} /></td>
                        <td><Ta rows={1} value={r.riferimento} onChange={(v) => upd((f) => { f.settori[si].righe[ri].riferimento = v; })} /></td>
                      </> : r.tipo === 'antibiotico' ? <>
                        <td><In value={r.nome} onChange={(v) => upd((f) => { f.settori[si].righe[ri].nome = v; })} /><div className="small muted">antibiotico</div></td>
                        <td><select className="rf-in" value={r.esito || ''} onChange={(e) => upd((f) => { f.settori[si].righe[ri].esito = e.target.value; })}><option value="">-</option><option>Sensibile</option><option>Intermedio</option><option>Resistente</option></select></td>
                        <td></td>
                        <td><In value={r.mic} onChange={(v) => upd((f) => { f.settori[si].righe[ri].mic = v; })} placeholder="MIC" /></td>
                      </> : <td colSpan={4}><In value={r.testo} onChange={(v) => upd((f) => { f.settori[si].righe[ri].testo = v; })} /><div className="small muted">{r.tipo === 'legenda' ? 'legenda' : 'testo libero (riga non interpretata)'}</div></td>}
                      <td className="actions">{editable && <button className="btn sm ghost danger" title="Elimina riga" onClick={() => upd((f) => { f.settori[si].righe.splice(ri, 1); })}><Icon name="trash" /></button>}</td>
                    </tr>))}</tbody>
                </table>)}
              {!corpo2 && editable && <div className="row rf-add">
                <button className="btn sm ghost" onClick={() => upd((f) => { f.settori[si].righe.push({ tipo: 'esame', nome: '', risultato: '', unita: '', riferimento: '' }); })}><Icon name="plus" />Esame</button>
                <button className="btn sm ghost" onClick={() => upd((f) => { f.settori[si].righe.push({ tipo: 'antibiotico', nome: '', esito: 'Sensibile', mic: '' }); })}><Icon name="plus" />Antibiotico</button>
                <button className="btn sm ghost" onClick={() => upd((f) => { f.settori[si].righe.push({ tipo: 'legenda', testo: '' }); })}><Icon name="plus" />Legenda</button>
              </div>}

              {corpo2 && (form.esami || []).map((e, ei) => ((e.settore ?? 0) !== si ? null : (
                <div key={ei} className="rf-esame">
                  <div className="rf-grid4">
                    <Field label="Esame"><In value={e.titolo} onChange={(v) => upd((f) => { f.esami[ei].titolo = v.toUpperCase(); })} /></Field>
                    <Field label="Metodo"><In value={e.metodo} onChange={(v) => upd((f) => { f.esami[ei].metodo = v; })} /></Field>
                    <Field label="Materiale"><In value={e.materiale} onChange={(v) => upd((f) => { f.esami[ei].materiale = v; })} /></Field>
                    <Field label="Sede anatomica"><In value={e.sede} onChange={(v) => upd((f) => { f.esami[ei].sede = v; })} /></Field>
                  </div>
                  <Field label="Nota (es. nuova descrizione da Nomenclatore)"><In value={e.nota} onChange={(v) => upd((f) => { f.esami[ei].nota = v; })} /></Field>
                  <table className="t rf-edit">
                    <thead><tr><th style={{ width: '40%' }}>Etichetta</th><th>Valore</th><th style={{ width: 54 }}></th></tr></thead>
                    <tbody>{(e.campi || []).map((c, ci) => (
                      <tr key={ci}>
                        <td><In value={c.etichetta} onChange={(v) => upd((f) => { f.esami[ei].campi[ci].etichetta = v; f.esami[ei].campi[ci].libero = !v; })} placeholder={c.libero ? 'testo libero' : ''} /></td>
                        <td><Ta rows={1} value={c.valore} onChange={(v) => upd((f) => { f.esami[ei].campi[ci].valore = v; })} /></td>
                        <td className="actions">{editable && <button className="btn sm ghost danger" onClick={() => upd((f) => { f.esami[ei].campi.splice(ci, 1); })}><Icon name="trash" /></button>}</td>
                      </tr>))}</tbody>
                  </table>
                  {editable && <div className="row rf-add"><button className="btn sm ghost" onClick={() => upd((f) => { f.esami[ei].campi.push({ etichetta: '', valore: '' }); })}><Icon name="plus" />Riga</button>
                    <button className="btn sm ghost" onClick={() => upd((f) => { f.antibiogrammi.push({ esame: ei, n: f.antibiogrammi.filter((b) => (b.esame ?? 0) === ei).length + 1, specie: '', carica: '', carica_label: 'Carica Batterica', legenda: 'R: Resistente I: Intermedio S: Sensibile', righe: [] }); })}><Icon name="plus" />Antibiogramma</button>
                    <button className="btn sm ghost danger" onClick={() => upd((f) => { f.esami.splice(ei, 1); f.antibiogrammi = f.antibiogrammi.filter((b) => (b.esame ?? 0) !== ei).map((b) => ({ ...b, esame: (b.esame ?? 0) > ei ? b.esame - 1 : b.esame })); })}><Icon name="trash" />Elimina esame</button></div>}

                  {(form.antibiogrammi || []).map((b, bi) => ((b.esame ?? 0) !== ei ? null : (
                    <div key={bi} className="rf-ab">
                      <div className="rf-grid4">
                        <Field label={`Microrganismo #${b.n}`}><In value={b.specie} onChange={(v) => upd((f) => { f.antibiogrammi[bi].specie = v; })} /></Field>
                        <Field label="Etichetta carica"><In value={b.carica_label} onChange={(v) => upd((f) => { f.antibiogrammi[bi].carica_label = v; })} placeholder="Carica Batterica" /></Field>
                        <Field label="Carica (vuota = riga omessa)"><In value={b.carica} onChange={(v) => upd((f) => { f.antibiogrammi[bi].carica = v; })} /></Field>
                        <Field label="Legenda (come in sorgente)"><In value={b.legenda} onChange={(v) => upd((f) => { f.antibiogrammi[bi].legenda = v; })} /></Field>
                      </div>
                      <table className="t rf-edit rf-abt">
                        <thead><tr><th>Antibiotico</th><th style={{ width: 110 }}>S / I / R</th><th style={{ width: 140 }}>MIC</th><th style={{ width: 54 }}></th></tr></thead>
                        <tbody>{(b.righe || []).map((r, ri) => (
                          <tr key={ri}>
                            <td><In value={r.antibiotico} onChange={(v) => upd((f) => { f.antibiogrammi[bi].righe[ri].antibiotico = v; })} /></td>
                            <td><select className="rf-in" value={r.sir || ''} onChange={(e2) => upd((f) => { f.antibiogrammi[bi].righe[ri].sir = e2.target.value; })}><option value="">-</option><option>S</option><option>I</option><option>R</option></select></td>
                            <td><In value={r.mic} onChange={(v) => upd((f) => { f.antibiogrammi[bi].righe[ri].mic = v; })} /></td>
                            <td className="actions">{editable && <button className="btn sm ghost danger" onClick={() => upd((f) => { f.antibiogrammi[bi].righe.splice(ri, 1); })}><Icon name="trash" /></button>}</td>
                          </tr>))}</tbody>
                      </table>
                      {editable && <div className="row rf-add"><button className="btn sm ghost" onClick={() => upd((f) => { f.antibiogrammi[bi].righe.push({ antibiotico: '', sir: 'S', mic: '' }); })}><Icon name="plus" />Antibiotico</button>
                        <button className="btn sm ghost danger" onClick={() => upd((f) => { f.antibiogrammi.splice(bi, 1); })}><Icon name="trash" />Elimina antibiogramma</button></div>}
                    </div>)))}
                </div>)))}
              {corpo2 && editable && <div className="row rf-add"><button className="btn sm ghost" onClick={() => upd((f) => { f.esami.push({ settore: si, titolo: '', metodo: '', materiale: '', sede: '', nota: '', campi: [] }); })}><Icon name="plus" />Esame</button></div>}
            </div>))}
          {editable && <div className="row rf-add"><button className="btn sm ghost" onClick={() => upd((f) => { f.settori.push({ titolo: '', righe: [] }); })}><Icon name="plus" />Settore</button></div>}

          <Field label="Note a piè del referto (una per riga: es. (1) Esame eseguito…, frase 'annulla e sostituisce…')" className="rf-note">
            <Ta rows={3} value={(form.note || []).join('\n')} onChange={(v) => upd((f) => { f.note = v.split('\n').filter((x) => x.trim()); })} />
          </Field>
        </fieldset>
        {editable && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" disabled={busy || !dirty} onClick={generaAnteprima}><Icon name="check" />Salva e rigenera anteprima</button></div>}
      </Card>

      {modal === 'conferma' && <ConfirmModal title="Conferma la scheda" text={`Vengono generati "${nomeFile || scheda.nome_file}.docx" e il PDF sul format Toscana Diagnostica dopo il controllo di coerenza. Se il controllo non è superato la conferma si ferma e compare la checklist.`} confirmText="Conferma" onConfirm={() => conferma(false)} onClose={() => setModal(null)} />}
      {modal === 'forza' && <ConfirmModal title="Conferma comunque" danger text="Il controllo di coerenza segnala differenze tra la sorgente e il referto TD. Confermando comunque, la forzatura viene tracciata nel registro. Procedere solo dopo il controllo visivo dell'anteprima." confirmText="Conferma comunque" onConfirm={() => conferma(true)} onClose={() => setModal(null)} />}
      {modal === 'riapri' && <ConfirmModal title="Riapri il referto" text={`La scheda torna in bozza e potrai modificarla. I file emessi (DOCX e PDF) restano in archivio fino alla nuova conferma, che li rigenera e li sostituisce.${partiti.length ? ' Il referto è già stato inviato al mittente: dopo la riconferma potrai reinviarlo (non parte da solo).' : ''} L'operazione resta nel registro.`} confirmText="Riapri" onConfirm={riapri} onClose={() => setModal(null)} />}
      {modal === 'invia' && <ConfirmModal title={daReinviare ? 'Reinvia al mittente' : 'Invia al mittente'} text={`Il PDF del referto "${scheda.nome_file}.pdf" parte dalla casella dei referti verso ${scheda.from_email}, con oggetto "Toscana Diagnostica · Referto ${scheda.cognome_nome}" e nessun dato clinico nel testo.`} confirmText="Invia" onConfirm={() => invia(daReinviare)} onClose={() => setModal(null)} />}
      {modal === 'reinvia' && <ConfirmModal title="Reinvia al mittente" text={`Questo PDF è già stato inviato a ${scheda.from_email}. Reinviarlo comunque?`} confirmText="Reinvia" onConfirm={() => invia(true)} onClose={() => setModal(null)} />}
      {modal === 'scarta' && <PromptModal title="Scarta la scheda" label="Motivo (facoltativo)" placeholder="Es. referto già trascritto, PDF duplicato" confirmText="Scarta" minLength={0} onConfirm={scarta} onClose={() => setModal(null)} />}
    </div>
  );
}
