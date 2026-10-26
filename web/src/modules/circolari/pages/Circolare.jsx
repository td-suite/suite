// Pagina della circolare: in bozza è l'editor (scheda, blocchi, anteprima impaginata); pubblicata è la scheda d'archivio
// con PDF, Word, QR, revisioni, annullamento e invio alle liste.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { useAuth, canEdit, canPublish } from '../auth.jsx';
import { Card, Field, Loading, Empty, Badge, Modal, ConfirmModal, useToast, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { STATO, SEGMENTO, ORIENTAMENTO, itDate, itDateTime, isoDate } from '../format.js';
import Blocchi, { Lettura } from './Blocchi.jsx';

const FIELDS = ['tipo', 'linea', 'segmento', 'titolo', 'destinatari', 'oggetto', 'decorrenza', 'riferimenti', 'luogo', 'data', 'sintesi', 'corpo', 'contatti', 'firma_nome', 'firma_ruolo', 'orientamento', 'note_interne'];
const pick = (c) => Object.fromEntries(FIELDS.map((k) => [k, k === 'data' ? isoDate(c.data) : k === 'contatti' ? (c.contatti || []).join('\n') : c[k] ?? '']));

export default function Circolare() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: c, error, reload } = useApi(`/circolari/${id}`, [id]);
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(0);
  const [modal, setModal] = useState(null);
  useEffect(() => { if (c) { setF(pick(c)); setDirty(false); } }, [c]);
  const bozza = c?.stato === 'BOZZA';
  const edit = bozza && canEdit(user);
  const upd = (k, v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const body = () => ({ ...f, contatti: String(f.contatti || '').split('\n').map((x) => x.trim()).filter(Boolean) });

  const salva = async (silent) => {
    setBusy(true);
    try { await api.put(`/circolari/${id}`, body()); if (!silent) toast('Bozza salvata'); setDirty(false); await reload(); return true; }
    catch (e) { toast(e, 'err'); return false; } finally { setBusy(false); }
  };
  const anteprima = async () => {
    if (dirty && !(await salva(true))) return;
    setBusy(true);
    try { const r = await api.post(`/circolari/${id}/anteprima`); toast(r.pdf ? `Anteprima impaginata (${ORIENTAMENTO[r.orientamento].toLowerCase()}, ${r.pages || '?'} pagine)` : `Generato il Word (${r.error || 'PDF non disponibile'})`); setPreview((x) => x + 1); await reload(); }
    catch (e) { toast(e, 'err'); } finally { setBusy(false); }
  };
  const pubblica = async () => {
    if (dirty && !(await salva(true))) return;
    setBusy(true);
    try { const r = await api.post(`/circolari/${id}/pubblica`); toast(`Pubblicata con protocollo ${r.protocollo}`); setModal(null); setPreview((x) => x + 1); await reload(); }
    catch (e) { toast(e, 'err'); } finally { setBusy(false); }
  };
  const revisione = async () => { setBusy(true); try { const r = await api.post(`/circolari/${id}/revisione`); toast(`Revisione ${r.revisione} in bozza`); nav(`${base}/${r.id}`); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const elimina = async () => { try { await api.del(`/circolari/${id}`); toast('Bozza eliminata'); nav(`${base}/bozze`); } catch (e) { toast(e, 'err'); } };
  const annulla = async (motivo) => { try { await api.post(`/circolari/${id}/annulla`, { motivo }); toast('Circolare annullata'); setModal(null); reload(); } catch (e) { toast(e, 'err'); } };

  if (error) return <div className="page"><Empty icon="alert" title="Circolare non trovata">{error.message}</Empty></div>;
  if (!c || !f) return <div className="page"><Loading /></div>;
  const st = STATO[c.stato];
  const pdfUrl = c.has_pdf ? `/api/circolari/circolari/${id}/pdf?v=${preview}${c.render_at ? '&t=' + encodeURIComponent(c.render_at) : ''}` : null;
  const stale = bozza && c.render_at && dirty;

  return (
    <div className="page">
      <PageHead title={c.protocollo ? `Circolare ${c.protocollo}` : 'Bozza di circolare'} icon="doc" crumb={<Link to={`${base}/${bozza ? 'bozze' : 'archivio'}`}>{bozza ? 'Bozze' : 'Archivio'}</Link>}
        sub={<span><Badge tone={st.tone}>{st.label}</Badge> {c.revisione > 0 && <Badge tone="blue">revisione {c.revisione}</Badge>} <span className="muted">creata da {c.created_by_name || 'n/d'} il {itDateTime(c.created_at)}{c.published_at ? ` · pubblicata da ${c.published_by_name || 'n/d'} il ${itDateTime(c.published_at)}` : ''}{c.sorgente_nome ? ` · origine: ${c.sorgente_nome}` : ''}</span></span>}
        actions={<>
          {edit && <button className="btn ghost" disabled={busy || !dirty} onClick={() => salva()}><Icon name="check" />Salva</button>}
          {edit && <button className="btn ghost" disabled={busy} onClick={anteprima}><Icon name="eye" />Anteprima impaginata</button>}
          {bozza && canPublish(user) && <button className="btn" disabled={busy} onClick={() => setModal('pubblica')}><Icon name="send" />Pubblica</button>}
          {c.stato === 'PUBBLICATA' && canPublish(user) && <button className="btn" disabled={busy} onClick={() => setModal('invia')}><Icon name="mail" />Invia</button>}
          {c.stato === 'PUBBLICATA' && canPublish(user) && <button className="btn ghost" disabled={busy} onClick={() => setModal('revisione')}><Icon name="refresh" />Nuova revisione</button>}
          {c.stato === 'PUBBLICATA' && canPublish(user) && <button className="btn danger" disabled={busy} onClick={() => setModal('annulla')}><Icon name="x" />Annulla</button>}
          {edit && <button className="btn danger" disabled={busy} onClick={() => setModal('elimina')}><Icon name="trash" />Elimina bozza</button>}
        </>} />

      <div className="circ-grid">
        <div className="grid">
          {edit ? (
            <>
              <Card title="Scheda" icon="list">
                <div className="circ-form">
                  <div className="two">
                    <Field label="Tipo di comunicazione" help="Prima riga della fascia"><input value={f.tipo} onChange={(e) => upd('tipo', e.target.value)} maxLength={80} /></Field>
                    <Field label="Linea di servizio" help="Seconda riga della fascia"><input value={f.linea} onChange={(e) => upd('linea', e.target.value)} maxLength={80} /></Field>
                  </div>
                  <Field label="Titolo" required><input value={f.titolo} onChange={(e) => upd('titolo', e.target.value)} maxLength={200} /></Field>
                  <Field label="Destinatari"><input value={f.destinatari} onChange={(e) => upd('destinatari', e.target.value)} maxLength={400} placeholder="Es. Strutture sanitarie e laboratori clienti del service; Punti Prelievo convenzionati" /></Field>
                  <Field label="Oggetto"><input value={f.oggetto} onChange={(e) => upd('oggetto', e.target.value)} maxLength={400} /></Field>
                  <div className="two">
                    <Field label="Decorrenza"><input value={f.decorrenza} onChange={(e) => upd('decorrenza', e.target.value)} maxLength={160} placeholder="Es. 1° novembre 2026" /></Field>
                    <Field label="Riferimenti"><input value={f.riferimenti} onChange={(e) => upd('riferimenti', e.target.value)} maxLength={400} placeholder="Contratti, procedure SGI, circolari precedenti" /></Field>
                  </div>
                  <div className="two">
                    <Field label="Luogo"><input value={f.luogo} onChange={(e) => upd('luogo', e.target.value)} maxLength={80} /></Field>
                    <Field label="Data" help="L'anno del protocollo è l'anno di questa data"><input type="date" value={f.data} onChange={(e) => upd('data', e.target.value)} /></Field>
                  </div>
                  <Field label="In sintesi" help="Due o quattro frasi: cosa cambia, per chi, da quando. È la parte che il cliente legge sempre."><textarea value={f.sintesi} onChange={(e) => upd('sintesi', e.target.value)} maxLength={1200} /></Field>
                </div>
              </Card>
              <Card title="Corpo" icon="edit">
                <Blocchi value={f.corpo || []} onChange={(v) => upd('corpo', v)} />
              </Card>
              <Card title="Chiusura e impaginazione" icon="gear">
                <div className="circ-form">
                  <Field label="Per informazioni" help="Una riga per ogni voce del box"><textarea value={f.contatti} onChange={(e) => upd('contatti', e.target.value)} /></Field>
                  <div className="two">
                    <Field label="Firma: nome"><input value={f.firma_nome} onChange={(e) => upd('firma_nome', e.target.value)} maxLength={80} /></Field>
                    <Field label="Firma: ruolo"><input value={f.firma_ruolo} onChange={(e) => upd('firma_ruolo', e.target.value)} maxLength={80} /></Field>
                  </div>
                  <div className="two">
                    <Field label="Destinatari (segmento)"><select value={f.segmento} onChange={(e) => upd('segmento', e.target.value)}>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Orientamento" help={`Automatico: ${c.orientamento_previsto === 'ORIZZONTALE' ? 'orizzontale (tabella larga)' : 'verticale'}`}><select value={f.orientamento} onChange={(e) => upd('orientamento', e.target.value)}>{Object.entries(ORIENTAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  </div>
                  <Field label="Note interne" help="Non compaiono nel documento"><textarea value={f.note_interne} onChange={(e) => upd('note_interne', e.target.value)} maxLength={2000} /></Field>
                </div>
              </Card>
              {c.sorgente_testo && <Card title="Bozza di origine" icon="file" actions={canEdit(user) && <button className="btn sm ghost" disabled={busy} onClick={() => setModal('struttura')}><Icon name="sparkle" />Ristruttura con Claude</button>}><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', margin: 0 }}>{c.sorgente_testo}</pre></Card>}
            </>
          ) : (
            <Card title="Contenuto" icon="doc">
              <div className="circ-banner"><div className="l"><div className="big">CIRCOLARE</div><div className="sm">{c.tipo}</div><div className="sm">{c.linea}</div></div><div className="r"><div className="lbl">Protocollo n.</div><div className="num">{c.protocollo || 'BOZZA'}</div><div className="dt">{c.luogo}, {itDate(c.data)}</div></div></div>
              <dl className="circ-meta">
                {c.destinatari && <><dt>Destinatari</dt><dd>{c.destinatari}</dd></>}
                {c.oggetto && <><dt>Oggetto</dt><dd>{c.oggetto}</dd></>}
                {c.decorrenza && <><dt>Decorrenza</dt><dd>{c.decorrenza}</dd></>}
                {c.riferimenti && <><dt>Riferimenti</dt><dd>{c.riferimenti}</dd></>}
              </dl>
              <h2 style={{ margin: '14px 0 8px' }}>{c.titolo}</h2>
              {c.sintesi && <div className="alert info" style={{ marginBottom: 10 }}><div><b>In sintesi.</b> {c.sintesi}</div></div>}
              <Lettura blocchi={c.corpo} />
              <div className="small muted" style={{ marginTop: 10 }}>{(c.contatti || []).join(' · ')}</div>
              <div style={{ marginTop: 10 }}><b>{c.firma_nome}</b><div className="small muted">{c.firma_ruolo}</div></div>
            </Card>
          )}
        </div>

        <div className="circ-side">
          <Card title="Documento" icon="pdf" actions={<span className="row tight">{c.has_docx && <a className="btn sm ghost" href={`/api/circolari/circolari/${id}/docx`}><Icon name="doc" />Word</a>}{c.has_pdf && <a className="btn sm ghost" href={pdfUrl} target="_blank" rel="noreferrer"><Icon name="pdf" />PDF</a>}</span>}>
            {stale && <div className="alert warn" style={{ marginBottom: 8 }}><div>Ci sono modifiche non ancora impaginate: rigenera l'anteprima.</div></div>}
            {c.render_error && <div className="alert warn" style={{ marginBottom: 8 }}><div>{c.render_error}</div></div>}
            {pdfUrl ? <iframe title="Anteprima PDF" className="circ-preview" src={pdfUrl} /> : <div className="circ-preview-ph">{bozza ? (edit ? 'Nessuna anteprima ancora: compila la scheda e premi "Anteprima impaginata".' : 'Nessuna anteprima.') : c.has_docx ? 'PDF non disponibile: scarica il Word.' : 'Documento non disponibile.'}</div>}
            <div className="small muted" style={{ marginTop: 8 }}>{c.render_at ? `Impaginata il ${itDateTime(c.render_at)} · ${ORIENTAMENTO[c.orientamento_eff] || ''}${c.pdf_pages ? ` · ${c.pdf_pages} pagine` : ''}` : 'Non ancora impaginata'}</div>
          </Card>
          {c.public_url && (
            <Card title="Versione digitale" icon="external">
              <div className="circ-qr"><img alt="QR code" src={`/api/circolari/circolari/${id}/qr.png`} /><div className="small"><div>Il QR code stampato sulla circolare apre sempre l'ultima revisione in vigore.</div><a href={c.public_url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{c.public_url}</a><div className="muted" style={{ marginTop: 4 }}>{c.letture} letture</div></div></div>
            </Card>
          )}
          {c.revisioni?.length > 1 && (
            <Card title="Revisioni" icon="refresh" flush>
              <table className="t"><tbody>{c.revisioni.map((r) => <tr key={r.id} className={r.id === c.id ? '' : 'click'} onClick={() => r.id !== c.id && nav(`${base}/${r.id}`)}><td className="circ-prot">{r.protocollo || 'bozza'}</td><td className="small">{r.revisione === 0 ? 'emissione' : `rev. ${r.revisione}`}</td><td><Badge tone={STATO[r.stato].tone}>{STATO[r.stato].label}</Badge></td><td className="small muted">{itDate(r.published_at)}</td></tr>)}</tbody></table>
            </Card>
          )}
          {!bozza && (
            <Card title="Invii" icon="mail" flush>
              {!c.invii?.length ? <div className="bd small muted">Nessun invio registrato.</div> : <table className="t"><tbody>{c.invii.map((i) => <tr key={i.id}><td><div className="strong">{i.lista_nome || 'Destinatari indicati'}</div><div className="small muted">{itDateTime(i.inviato_at)} · {i.inviato_da_name || ''}</div></td><td className="small num">{i.n_inviati}/{i.n_destinatari}{i.n_errori > 0 && <div className="red">{i.n_errori} errori</div>}</td></tr>)}</tbody></table>}
            </Card>
          )}
        </div>
      </div>

      {modal === 'pubblica' && <ConfirmModal title="Pubblicare la circolare?" text={`Il protocollo ${c.parent_id ? 'resta quello della circolare di origine con il suffisso di revisione' : 'TD-' + (f.data || '').slice(0, 4) + '/NNN viene assegnato ora dal registro'} e non si potrà più modificare il testo: le correzioni successive passano da una revisione. Il documento viene impaginato in via definitiva con il QR code.`} confirmText="Pubblica" onConfirm={pubblica} onClose={() => setModal(null)} />}
      {modal === 'revisione' && <ConfirmModal title="Nuova revisione" text="Viene creata una bozza che eredita tutto il contenuto. Alla sua pubblicazione questa versione passa a Superata e il QR code rimanda alla revisione nuova." confirmText="Crea la bozza" onConfirm={revisione} onClose={() => setModal(null)} />}
      {modal === 'elimina' && <ConfirmModal title="Eliminare la bozza?" text="La bozza viene eliminata definitivamente. Le circolari pubblicate non si eliminano: si annullano." confirmText="Elimina" danger onConfirm={elimina} onClose={() => setModal(null)} />}
      {modal === 'annulla' && <AnnullaModal onConfirm={annulla} onClose={() => setModal(null)} />}
      {modal === 'invia' && <InviaModal c={c} onDone={() => { setModal(null); reload(); }} onClose={() => setModal(null)} />}
      {modal === 'struttura' && <StrutturaModal id={id} onApply={(s) => { setF((x) => ({ ...x, titolo: s.titolo || x.titolo, oggetto: s.oggetto || x.oggetto, destinatari: s.destinatari || x.destinatari, decorrenza: s.decorrenza || x.decorrenza, riferimenti: s.riferimenti || x.riferimenti, sintesi: s.sintesi || x.sintesi, tipo: s.tipo || x.tipo, linea: s.linea || x.linea, corpo: s.corpo?.length ? s.corpo : x.corpo })); setDirty(true); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
}

function AnnullaModal({ onConfirm, onClose }) {
  const [motivo, setMotivo] = useState('');
  return <Modal title="Annullare la circolare?" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn danger" onClick={() => onConfirm(motivo)}>Annulla la circolare</button></>}>
    <p className="small">La circolare resta in archivio con il suo protocollo e stato Annullata; il QR code smette di servirla.</p>
    <Field label="Motivo (facoltativo)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Field>
  </Modal>;
}

function InviaModal({ c, onDone, onClose }) {
  const toast = useToast();
  const liste = useApi('/liste');
  const [listaId, setListaId] = useState('');
  const [emails, setEmails] = useState('');
  const [oggetto, setOggetto] = useState(`Circolare ${c.protocollo}: ${c.titolo}`);
  const [messaggio, setMessaggio] = useState('Gentile Cliente, in allegato la circolare in oggetto. La versione digitale, sempre aggiornata, è raggiungibile dal collegamento in calce.');
  const [busy, setBusy] = useState(false);
  const lista = (liste.data || []).find((l) => String(l.id) === listaId);
  const extra = emails.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  const n = (lista?.n_destinatari || 0) + extra.length;
  const invia = async () => {
    if (!n) return toast('Scegli una lista o indica almeno un indirizzo', 'err');
    setBusy(true);
    try { const r = await api.post(`/circolari/${c.id}/invia`, { lista_id: listaId ? Number(listaId) : undefined, emails: extra, oggetto, messaggio }); toast(`Invio registrato: ${r.n_inviati} su ${r.n_destinatari}${r.n_errori ? `, ${r.n_errori} errori` : ''}`); onDone(); }
    catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return <Modal title="Invia la circolare" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn" disabled={busy || !n} onClick={invia}><Icon name="send" />Invia a {n} destinatari</button></>}>
    <div className="circ-form">
      <Field label="Lista di distribuzione"><select value={listaId} onChange={(e) => setListaId(e.target.value)}><option value="">Nessuna lista</option>{(liste.data || []).filter((l) => l.attiva).map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.n_destinatari})</option>)}</select></Field>
      <Field label="Altri indirizzi" help="Separati da virgola, spazio o a capo"><textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={2} /></Field>
      <Field label="Oggetto dell'email"><input value={oggetto} onChange={(e) => setOggetto(e.target.value)} maxLength={200} /></Field>
      <Field label="Messaggio"><textarea value={messaggio} onChange={(e) => setMessaggio(e.target.value)} maxLength={3000} /></Field>
      <div className="small muted">In allegato il {c.has_pdf ? 'PDF' : 'Word'} della circolare; nel testo il collegamento alla versione digitale. Mittente: la casella della Suite.</div>
    </div>
  </Modal>;
}

function StrutturaModal({ id, onApply, onClose }) {
  const toast = useToast();
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState(null);
  const run = async () => { setBusy(true); try { const r = await api.post(`/circolari/${id}/struttura`, { hint }); setS(r); if (!r.ai) toast(r.ai_error ? `Claude non ha risposto (${r.ai_error}): proposta con regole semplici` : 'Claude non configurato: proposta con regole semplici'); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return <Modal title="Ristruttura la bozza con Claude" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button>{s && <button className="btn" onClick={() => onApply(s)}><Icon name="check" />Applica alla scheda</button>}</>}>
    <div className="circ-form">
      <Field label="Indicazioni (facoltative)"><input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={500} placeholder="Es. tono più formale, evidenziare la decorrenza, tabella per sede" /></Field>
      <div><button className="btn ghost" disabled={busy} onClick={run}><Icon name="sparkle" />{s ? 'Rigenera' : 'Genera la proposta'}</button></div>
      {s && <div className="card" style={{ padding: 14 }}><h3 style={{ marginTop: 0 }}>{s.titolo}</h3><div className="small muted">{s.oggetto}</div>{s.sintesi && <p className="small"><b>In sintesi.</b> {s.sintesi}</p>}<Lettura blocchi={s.corpo} /></div>}
      <div className="small muted">La proposta sostituisce scheda e corpo solo quando premi "Applica"; poi salvi.</div>
    </div>
  </Modal>;
}
