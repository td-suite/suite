// Dettaglio del ticket: intestazione (protocollo, stato, priorità, SLA), scheda (casella e responsabili, per conto di, assegnatario),
// azioni contestuali al ruolo, thread dei commenti con nota interna per i gestori, allegati, cronologia, osservatori, scheda PDF.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiBase, base, useApi } from '../api.js';
import { Card, Field, Loading, Empty, Modal, useToast, PageHead, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoBadge, PrioBadge, SlaBar, UnitSelect, Stelle } from '../components.jsx';
import { PRIORITA, EVENTO, itDateTime, kb, descriviEvento } from '../format.js';

export default function Dettaglio() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: t, error, reload } = useApi(`/tickets/${id}`, [id]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testo, setTesto] = useState('');
  const [interno, setInterno] = useState(false);
  const [edit, setEdit] = useState(null);
  const act = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); setModal(null); await reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const post = (path, body, ok) => act(() => api.post(`/tickets/${id}${path}`, body), ok);
  const commenta = async () => {
    if (testo.trim().length < 1) return;
    await act(async () => { await api.post(`/tickets/${id}/commenti`, { testo: testo.trim(), interno }); setTesto(''); }, interno ? 'Nota interna salvata' : 'Commento inviato');
  };
  const allega = async (files) => { for (const file of files) { const fd = new FormData(); fd.append('file', file); await act(() => api.upload(`/tickets/${id}/allegati`, fd), `Allegato ${file.name}`); } };
  if (error) return <div className="page"><Empty icon={error.status === 403 ? 'lock' : 'alert'} title={error.status === 403 ? 'Ticket non accessibile' : 'Errore'}>{error.message}</Empty></div>;
  if (!t) return <div className="page"><Loading /></div>;
  const p = t.permessi;
  const chiuso = ['CHIUSO', 'ANNULLATO'].includes(t.stato);
  return (
    <div className="page">
      <PageHead crumb={<><Link to={base}>Ticket</Link><Icon name="chevron" /><span>{t.protocollo}</span></>} title={<>{t.riservato && <Icon name="lock" title="Riservato" />}{t.titolo}</>} icon="ticket"
        sub={<span className="row tight"><span className="tk-prot">{t.protocollo}</span><StatoBadge stato={t.stato} /><PrioBadge priorita={t.priorita} full />{t.riservato && <span className="badge b-mauve nodot">Riservato</span>}{t.escalation_unit_id && <span className="badge b-red nodot">Escalation a {t.escalation_unit_nome}</span>}{t.riaperture > 0 && <span className="badge b-amber nodot">Riaperto {t.riaperture}x</span>}</span>}
        actions={<a className="btn ghost" href={`${apiBase}/tickets/${id}/scheda.pdf`} target="_blank" rel="noopener"><Icon name="pdf" />Scheda PDF</a>} />

      <div className="tk-detail">
        <div className="tk-main">
          <Card title="Richiesta" icon="list" actions={p.modifica && <button className="btn sm ghost" onClick={() => setEdit({ titolo: t.titolo, descrizione: t.descrizione })}><Icon name="edit" />Modifica</button>}>
            <div className="tk-desc">{t.descrizione}</div>
            {t.messaggio_risoluzione && <div className="tk-alert ok" style={{ marginTop: 12 }}><Icon name="check" /><div><b>Risoluzione.</b> {t.messaggio_risoluzione}</div></div>}
            {t.valutazione && <div className="row tight" style={{ marginTop: 10 }}><span className="small muted">Valutazione del richiedente</span><Stelle value={t.valutazione} size={16} />{t.valutazione_nota && <span className="small">{t.valutazione_nota}</span>}</div>}
          </Card>

          {(p.prendi_in_carico || p.assegna || p.gira || p.priorita || p.in_attesa || p.riprendi || p.risolvi || p.chiudi || p.riapri || p.annulla) && (
            <Card title="Azioni" icon="sparkle">
              <div className="row tight tk-actions">
                {p.prendi_in_carico && <button className="btn" disabled={busy} onClick={() => post('/prendi-in-carico', {}, 'Ticket preso in carico')}><Icon name="check" />Prendi in carico</button>}
                {p.risolvi && <button className="btn" disabled={busy} onClick={() => setModal('risolvi')}><Icon name="check" />Risolvi</button>}
                {p.chiudi && <button className="btn" disabled={busy} onClick={() => setModal('chiudi')}><Icon name="lock" />{p.richiedente ? 'Conferma e chiudi' : 'Chiudi'}</button>}
                {p.riapri && <button className="btn ghost" disabled={busy} onClick={() => setModal('riapri')}><Icon name="refresh" />Riapri</button>}
                {p.assegna && <button className="btn ghost" disabled={busy} onClick={() => setModal('assegna')}><Icon name="user" />Assegna</button>}
                {p.gira && <button className="btn ghost" disabled={busy} onClick={() => setModal('gira')}><Icon name="arrowRight" />Gira ad altra casella</button>}
                {p.priorita && <button className="btn ghost" disabled={busy} onClick={() => setModal('priorita')}><Icon name="alert" />Priorità</button>}
                {p.in_attesa && <button className="btn ghost" disabled={busy} onClick={() => setModal('attesa')}><Icon name="clock" />Metti in attesa</button>}
                {p.riprendi && <button className="btn ghost" disabled={busy} onClick={() => post('/stato', { stato: 'IN_CORSO' }, 'Ticket ripreso: scadenza spostata del tempo di attesa')}><Icon name="clock" />Riprendi</button>}
                {p.annulla && <button className="btn danger" disabled={busy} onClick={() => setModal('annulla')}><Icon name="x" />Annulla ticket</button>}
              </div>
            </Card>
          )}

          <Card title={`Commenti (${t.commenti.length})`} icon="comment">
            <div className="tk-thread">
              {!t.commenti.length && <div className="muted small">Nessun commento. {p.gestore ? 'Il primo commento pubblico vale come prima risposta al richiedente.' : ''}</div>}
              {t.commenti.map((c) => (
                <div key={c.id} className={`tk-msg ${c.interno ? 'interno' : ''} ${c.autore_user_id === t.richiedente_user_id ? 'rich' : ''}`}>
                  <div className="hd"><b>{c.autore_nome}</b>{c.interno && <span className="badge b-amber nodot">Nota interna</span>}<span className="muted small">{itDateTime(c.created_at)}</span></div>
                  <div className="tx">{c.testo}</div>
                  {t.allegati.filter((a) => a.commento_id === c.id).map((a) => <a key={a.id} className="tk-att" href={`${apiBase}/tickets/${id}/allegati/${a.id}`} target="_blank" rel="noopener"><Icon name="file" />{a.filename} <span className="muted">{kb(a.size)}</span></a>)}
                </div>))}
            </div>
            {p.commenta && (
              <div className="tk-compose">
                <textarea rows={3} value={testo} onChange={(e) => setTesto(e.target.value)} placeholder={interno ? 'Nota interna: visibile solo ai gestori della casella' : chiuso ? 'Il ticket è chiuso: puoi ancora lasciare un commento' : 'Scrivi un commento'} maxLength={10000} />
                <div className="row between">
                  {p.nota_interna ? <label className="tk-check"><input type="checkbox" checked={interno} onChange={(e) => setInterno(e.target.checked)} /> Nota interna (il richiedente non la vede)</label> : <span />}
                  <button className="btn" disabled={busy || !testo.trim()} onClick={commenta}><Icon name="send" />{interno ? 'Salva nota' : 'Invia'}</button>
                </div>
              </div>
            )}
          </Card>

          <Card title={`Allegati (${t.allegati.length})`} icon="folder">
            {!t.allegati.length && <div className="muted small">Nessun allegato.</div>}
            <div className="tk-attlist">{t.allegati.map((a) => <a key={a.id} className="tk-att" href={`${apiBase}/tickets/${id}/allegati/${a.id}`} target="_blank" rel="noopener"><Icon name={a.mime.startsWith('image/') ? 'image' : a.mime.includes('pdf') ? 'pdf' : 'file'} /><span>{a.filename}</span><span className="muted small">{kb(a.size)} · {a.caricato_da_nome} · {itDateTime(a.created_at)}{a.interno ? ' · nota interna' : ''}</span></a>)}</div>
            {p.allega && <DropZone multiple compact onFiles={allega}><Icon name="upload" /><span>Aggiungi allegati (pdf, immagini, docx, xlsx, txt, csv)</span></DropZone>}
          </Card>

          <Card title="Cronologia" icon="clock" flush>
            <div className="tk-timeline">
              {t.eventi.map((e) => (
                <div key={e.id} className={`tk-ev ev-${e.tipo}`}>
                  <i />
                  <div className="when">{itDateTime(e.created_at)}</div>
                  <div className="what"><b>{EVENTO[e.tipo] || e.tipo}</b> <span className="muted">· {e.user_nome || 'Sistema'}</span><div className="small">{descriviEvento(e)}</div></div>
                </div>))}
            </div>
          </Card>
        </div>

        <aside className="tk-side">
          <Card title="Tempi (SLA)" icon="clock">
            <SlaBar label="Prima risposta" start={t.created_at} deadline={t.sla_risposta_scadenza} done={t.prima_risposta_at} stato={t.stato} />
            <SlaBar label="Risoluzione" start={t.created_at} deadline={t.sla_risoluzione_scadenza} done={t.risolto_at} stato={t.stato} paused={t.stato === 'IN_ATTESA'} />
            {t.attesa_secondi > 0 && <div className="small muted">Tempo in attesa non conteggiato: {Math.round(t.attesa_secondi / 60)} min</div>}
          </Card>
          <Card title="Scheda" icon="info">
            <dl className="tk-meta">
              <dt>Categoria</dt><dd>{t.categoria_nome || '-'}</dd>
              <dt>Casella</dt><dd><b>{t.unit_nome}</b><div className="small muted">{t.unit_path}</div></dd>
              <dt>Responsabili</dt><dd>{t.responsabili.length ? t.responsabili.map((r) => r.nome).join(', ') : <span className="muted">Da assegnare nell'organigramma</span>}</dd>
              <dt>Assegnatario</dt><dd>{t.assegnatario_nome || <span className="muted">Nessuno</span>}</dd>
              <dt>Richiedente</dt><dd>{t.richiedente_nome}{t.richiedente_email && t.richiedente_nome !== 'Riservato' && <div className="small muted">{t.richiedente_email}</div>}</dd>
              <dt>Per conto di</dt><dd>{t.per_conto_site_nome ? <>{t.per_conto_site_nome} <span className="muted small">(sede)</span></> : t.per_conto_org_nome ? <>{t.per_conto_org_nome} <span className="muted small">(Legal entity)</span></> : <span className="muted">Non indicata</span>}</dd>
              <dt>Aperto</dt><dd>{itDateTime(t.created_at)}</dd>
              {t.risolto_at && <><dt>Risolto</dt><dd>{itDateTime(t.risolto_at)}</dd></>}
              {t.chiuso_at && <><dt>Chiuso</dt><dd>{itDateTime(t.chiuso_at)}</dd></>}
              {t.escalation_unit_id && <><dt>Escalation</dt><dd>{t.escalation_unit_nome}<div className="small muted">{itDateTime(t.escalated_at)}</div></dd></>}
            </dl>
          </Card>
          {!t.riservato && (
            <Card title={`Osservatori (${t.osservatori.length})`} icon="eye" actions={p.osservatori && <button className="btn sm ghost" onClick={() => setModal('osservatore')}><Icon name="plus" />Aggiungi</button>}>
              {!t.osservatori.length && <div className="muted small">Nessun osservatore. Gli osservatori vedono il ticket e ricevono i commenti pubblici.</div>}
              {t.osservatori.map((o) => <div key={o.user_id} className="row between tight" style={{ padding: '3px 0' }}><span className="small">{o.full_name}</span>{p.osservatori && <button className="iconbtn" aria-label="Rimuovi" onClick={() => act(() => api.del(`/tickets/${id}/osservatori`, { user_id: o.user_id }), 'Osservatore rimosso')}><Icon name="x" /></button>}</div>)}
            </Card>
          )}
          {t.riservato && <Card title="Riservato" icon="lock"><div className="small">Visibile solo al richiedente, ai responsabili della casella destinataria, all'assegnatario e all'amministratore del modulo. Ogni lettura da parte di chi non è il richiedente viene registrata nella cronologia e nell'audit della Suite.</div></Card>}
        </aside>
      </div>

      {modal === 'risolvi' && <TextModal title="Risolvi il ticket" label="Messaggio al richiedente" help="Spiega come è stata risolta la richiesta. Il richiedente potrà confermare la chiusura o riaprire entro sette giorni." confirm="Segna come risolto" busy={busy} onClose={() => setModal(null)} onConfirm={(v) => post('/stato', { stato: 'RISOLTO', messaggio: v }, 'Ticket risolto')} />}
      {modal === 'attesa' && <TextModal title="Metti in attesa" label="Motivo (facoltativo)" help="Il tempo in attesa non conta per lo SLA di risoluzione: la scadenza si sposta quando il ticket riprende." confirm="Metti in attesa" optional busy={busy} onClose={() => setModal(null)} onConfirm={(v) => post('/stato', { stato: 'IN_ATTESA', messaggio: v || undefined }, 'Ticket in attesa')} />}
      {modal === 'riapri' && <TextModal title="Riapri il ticket" label="Motivo" confirm="Riapri" busy={busy} onClose={() => setModal(null)} onConfirm={(v) => post('/riapri', { motivo: v }, 'Ticket riaperto')} />}
      {modal === 'annulla' && <TextModal title="Annulla il ticket" label="Motivo (facoltativo)" confirm="Annulla il ticket" danger optional busy={busy} onClose={() => setModal(null)} onConfirm={(v) => post('/annulla', { motivo: v }, 'Ticket annullato')} />}
      {modal === 'chiudi' && <ChiudiModal richiedente={p.richiedente} busy={busy} onClose={() => setModal(null)} onConfirm={(b) => post('/chiudi', b, 'Ticket chiuso')} />}
      {modal === 'assegna' && <AssegnaModal unitId={t.unit_id} busy={busy} onClose={() => setModal(null)} onConfirm={(uid) => post('/assegna', { user_id: uid }, 'Ticket assegnato')} />}
      {modal === 'gira' && <GiraModal current={t.unit_id} busy={busy} onClose={() => setModal(null)} onConfirm={(b) => post('/gira', b, 'Ticket girato')} />}
      {modal === 'priorita' && <PrioritaModal current={t.priorita} busy={busy} onClose={() => setModal(null)} onConfirm={(b) => post('/priorita', b, 'Priorità aggiornata, scadenze ricalcolate')} />}
      {modal === 'osservatore' && <UtenteModal title="Aggiungi osservatore" busy={busy} onClose={() => setModal(null)} onConfirm={(uid) => post('/osservatori', { user_id: uid }, 'Osservatore aggiunto')} />}
      {edit && (
        <Modal title="Modifica la richiesta" onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={busy} onClick={() => act(async () => { await api.put(`/tickets/${id}`, edit); setEdit(null); }, 'Ticket aggiornato')}>Salva</button></>}>
          <div className="tk-form"><Field label="Titolo"><input value={edit.titolo} onChange={(e) => setEdit({ ...edit, titolo: e.target.value })} maxLength={200} /></Field><Field label="Descrizione"><textarea rows={8} value={edit.descrizione} onChange={(e) => setEdit({ ...edit, descrizione: e.target.value })} /></Field></div>
        </Modal>
      )}
    </div>
  );
}

function TextModal({ title, label, help, confirm, onConfirm, onClose, busy, danger, optional }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className={`btn ${danger ? 'danger' : ''}`} disabled={busy || (!optional && v.trim().length < 3)} onClick={() => onConfirm(v.trim())}>{confirm}</button></>}>
      <Field label={label} help={help}><textarea rows={5} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
function ChiudiModal({ richiedente, onConfirm, onClose, busy }) {
  const [val, setVal] = useState(0); const [nota, setNota] = useState('');
  return (
    <Modal title={richiedente ? 'Conferma la risoluzione e chiudi' : 'Chiudi il ticket'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className="btn" disabled={busy} onClick={() => onConfirm({ valutazione: val || null, nota: nota.trim() || undefined })}>Chiudi il ticket</button></>}>
      {richiedente ? <>
        <Field label="Come valuti la gestione? (facoltativo)"><Stelle value={val} onChange={setVal} /></Field>
        <Field label="Nota (facoltativa)"><textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </> : <p>Il ticket risolto viene chiuso senza attendere la conferma del richiedente.</p>}
    </Modal>
  );
}
function AssegnaModal({ unitId, onConfirm, onClose, busy }) {
  const { data } = useApi(`/unita/${unitId}/utenti`, [unitId]);
  const [uid, setUid] = useState('');
  return (
    <Modal title="Assegna il ticket" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className="btn" disabled={busy || !uid} onClick={() => onConfirm(Number(uid))}>Assegna</button></>}>
      <Field label="Persona che afferisce alla casella o a una casella sottostante" help="Chi non ha un accesso alla Suite non compare.">
        {!data ? <Loading /> : <select value={uid} onChange={(e) => setUid(e.target.value)} autoFocus><option value="">Scegli</option>{data.map((u) => <option key={u.id} value={u.id}>{u.person_name || u.full_name} · {u.email}</option>)}</select>}
      </Field>
      {data && !data.length && <div className="muted small">Nessun utente afferisce a questa casella: puoi comunque prendere in carico il ticket tu o girarlo.</div>}
    </Modal>
  );
}
function GiraModal({ current, onConfirm, onClose, busy }) {
  const cat = useApi('/catalogo');
  const [unit, setUnit] = useState(null); const [motivo, setMotivo] = useState('');
  return (
    <Modal title="Gira ad altra casella" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className="btn" disabled={busy || !unit || unit === current || motivo.trim().length < 3} onClick={() => onConfirm({ unit_id: unit, motivo: motivo.trim() })}>Gira</button></>}>
      <Field label="Nuova casella destinataria"><UnitSelect units={cat.data?.unita || []} value={unit} onChange={setUnit} /></Field>
      <Field label="Motivo" help="Il richiedente e i responsabili della nuova casella ricevono il motivo. L'assegnazione si azzera; la prima risposta già data resta."><textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </Modal>
  );
}
function PrioritaModal({ current, onConfirm, onClose, busy }) {
  const [pr, setPr] = useState(current); const [motivo, setMotivo] = useState('');
  const cat = useApi('/catalogo');
  const s = (cat.data?.sla || []).find((x) => x.priorita === pr);
  return (
    <Modal title="Cambia priorità" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className="btn" disabled={busy || pr === current} onClick={() => onConfirm({ priorita: pr, motivo: motivo.trim() || undefined })}>Aggiorna</button></>}>
      <Field label="Priorità" help={s ? `Scadenze ricalcolate dall'apertura: risposta ${s.prima_risposta_ore} ore, risoluzione ${s.risoluzione_ore} ore (più il tempo già passato in attesa).` : ''}><select value={pr} onChange={(e) => setPr(e.target.value)}>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
      <Field label="Motivo (facoltativo)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Field>
    </Modal>
  );
}
function UtenteModal({ title, onConfirm, onClose, busy }) {
  const [q, setQ] = useState(''); const [rows, setRows] = useState([]); const [uid, setUid] = useState('');
  useEffect(() => { if (q.trim().length < 2) { setRows([]); return; } const h = setTimeout(() => api.get(`/utenti?q=${encodeURIComponent(q.trim())}`, { silent: true }).then(setRows).catch(() => setRows([])), 300); return () => clearTimeout(h); }, [q]);
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Indietro</button><button className="btn" disabled={busy || !uid} onClick={() => onConfirm(Number(uid))}>Aggiungi</button></>}>
      <Field label="Cerca una persona con accesso alla Suite"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cognome, nome o email" autoFocus /></Field>
      {rows.length > 0 && <Field label="Risultati"><select size={Math.min(8, rows.length + 1)} value={uid} onChange={(e) => setUid(e.target.value)}>{rows.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {u.email}</option>)}</select></Field>}
    </Modal>
  );
}
