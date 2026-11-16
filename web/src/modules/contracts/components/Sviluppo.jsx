// Gestione del Personale, v0.77.0: sezioni della scheda della persona per formazione ed ECM, tirocinio e medicina del lavoro.
// Ogni sezione legge e scrive le proprie API (routes/sviluppo.js); `onChange` ricarica la scheda quando cambiano dossier e scadenze.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, Kpi, Modal, ConfirmModal, useToast, Icon } from './ui.jsx';
import { itDate, today, eur } from '../format.js';

const n1 = (v) => Number(v || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const addMonths = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const fd = (obj, file) => { const f = new FormData(); for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); if (file) f.append('file', file); return f; };
const Riga = ({ k, v }) => (v == null || v === '' ? null : <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px dashed var(--line)', padding: '5px 0' }}><span className="muted">{k}</span><span className="strong" style={{ textAlign: 'right' }}>{v}</span></div>);

// ================================================================ FORMAZIONE ED ECM
export function ContatoreEcm({ c }) {
  if (!c) return null;
  const pct = c.dovuti ? c.acquisiti / c.dovuti * 100 : 100;
  return (
    <div className="grid g3" style={{ marginBottom: 14 }}>
      <Kpi label={`Crediti ECM mancanti · triennio ${c.triennio}`} value={n1(c.residuo)} accent foot={`acquisiti ${n1(c.acquisiti)} su ${n1(c.dovuti)}${c.riduzione ? ` (obbligo ${n1(c.obbligo)}, riduzione ${n1(c.riduzione)})` : ''}`} bar={pct} />
      <Kpi label="Obiettivo progressivo a fine anno" value={c.mancano_anno > 0 ? `mancano ${n1(c.mancano_anno)}` : 'raggiunto'} foot={`obiettivo ${n1(c.obiettivo_anno)} crediti: indicativo, l'obbligo è sul triennio`} />
      <Kpi label="Crediti per anno" value={c.anni.map((a) => n1(a.crediti)).join(' · ')} foot={c.anni.map((a) => a.anno).join(' · ')} />
    </div>
  );
}

function CorsoModal({ id, corso, tipi, rinnovo, letturaAi, soggetto, onClose, onSaved }) {
  const toast = useToast();
  const nuovo = !corso?.id;
  const [v, setV] = useState(corso || { tipo: 'AZIENDALE', stato: 'SVOLTA', data: today(), crediti_ecm: '', ore: '', obbligatoria: false });
  const [file, setFile] = useState(null);
  const [lettura, setLettura] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const s = (k, x) => setV((p) => ({ ...p, [k]: x }));
  const leggi = async (f) => {
    setFile(f); setLettura(null); setErr(null);
    if (!f) return;
    setBusy('lettura');
    try {
      const r = await api.upload(`/resources/${id}/formazione/leggi`, fd({}, f));
      setLettura(r);
      setV((p) => ({ ...p, stato: 'SVOLTA', titolo: r.titolo || p.titolo || '', ente: r.ente || p.ente || '', tipo: r.tipo || p.tipo, data: r.data || p.data, ore: r.ore ?? p.ore, crediti_ecm: r.crediti_ecm ?? p.crediti_ecm,
        scadenza: r.scadenza || (r.data && rinnovo?.[r.tipo] ? addMonths(r.data, rinnovo[r.tipo]) : p.scadenza) || '', codice_evento: r.codice_evento || p.codice_evento || '' }));
    } catch (e) { setErr(e); }
    setBusy(null);
  };
  const save = async () => {
    setBusy('salva'); setErr(null);
    try {
      const body = { tipo: v.tipo, titolo: v.titolo || '', ente: v.ente || '', stato: v.stato, data: v.stato === 'SVOLTA' ? v.data || '' : '', data_prevista: v.stato === 'PROGRAMMATA' ? v.data_prevista || '' : '', scadenza: v.scadenza || '',
        ore: v.ore ?? '', crediti_ecm: v.stato === 'SVOLTA' ? v.crediti_ecm ?? '' : '', obbligatoria: Boolean(v.obbligatoria), codice_evento: v.codice_evento || '', note: v.note || '' };
      if (nuovo) await api.upload(`/resources/${id}/formazione`, fd({ ...body, lettura: lettura || undefined }, file));
      else await api.put(`/resources/${id}/formazione/${corso.id}`, body);
      toast(nuovo ? 'Corso registrato' : 'Corso aggiornato'); onSaved();
    } catch (e) { setErr(e); }
    setBusy(null);
  };
  return (
    <Modal wide title={nuovo ? 'Nuovo corso o attestato' : 'Modifica corso'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={Boolean(busy) || !(v.titolo || '').trim()} onClick={save}>{busy === 'salva' ? 'Salvataggio…' : 'Salva'}</button></>}>
      <ErrorBox error={err} />
      {nuovo && (
        <div className="alert info" style={{ display: 'block', marginBottom: 12 }}>
          <Field label="Attestato (PDF o foto)" help={letturaAi ? 'Il file viene letto con l\'API di Anthropic: titolo, ente, data, ore e crediti ECM arrivano precompilati. Controllali prima di salvare.' : 'Chiave API Anthropic non configurata: la lettura è approssimativa, controlla ogni campo.'}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,application/pdf,image/*" onChange={(e) => leggi(e.target.files?.[0] || null)} />
          </Field>
          {busy === 'lettura' && <div className="small">Lettura dell'attestato in corso…</div>}
          {lettura && <div className="small" style={{ marginTop: 6 }}>
            Lettura {lettura.method === 'claude' ? 'con intelligenza artificiale' : 'senza intelligenza artificiale'}{lettura.intestatario ? ` · intestato a ${lettura.intestatario}` : ''}{lettura.note ? ` · ${lettura.note}` : ''}
            {lettura.altra_persona && <div><Badge tone="red">L'attestato sembra intestato a un'altra persona</Badge></div>}
            {lettura.doppione && <div><Badge tone="amber">Possibile doppione: "{lettura.doppione.titolo}" del {itDate(lettura.doppione.data)} è già registrato</Badge></div>}
          </div>}
        </div>
      )}
      <div className="form-grid">
        <Field label="Titolo del corso *" className="span2"><input value={v.titolo || ''} onChange={(e) => s('titolo', e.target.value)} /></Field>
        <Field label="Tipo"><select value={v.tipo} onChange={(e) => { const t = e.target.value; setV((p) => ({ ...p, tipo: t, scadenza: p.scadenza || (p.data && rinnovo?.[t] ? addMonths(p.data, rinnovo[t]) : '') })); }}>{Object.entries(tipi || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Ente o provider"><input value={v.ente || ''} onChange={(e) => s('ente', e.target.value)} /></Field>
        <Field label="Stato"><select value={v.stato} onChange={(e) => s('stato', e.target.value)}><option value="SVOLTA">Svolto</option><option value="PROGRAMMATA">Programmato</option></select></Field>
        {v.stato === 'SVOLTA'
          ? <Field label="Data di conseguimento *"><input type="date" value={v.data || ''} onChange={(e) => s('data', e.target.value)} /></Field>
          : <Field label="Data prevista *" help="Entra nello scadenzario"><input type="date" value={v.data_prevista || ''} onChange={(e) => s('data_prevista', e.target.value)} /></Field>}
        <Field label="Ore"><input type="number" min="0" step="0.5" value={v.ore ?? ''} onChange={(e) => s('ore', e.target.value)} /></Field>
        {v.stato === 'SVOLTA' && <Field label="Crediti ECM" help={soggetto ? 'Riducono il contatore del triennio in cui cade la data' : 'La persona non risulta soggetta all\'obbligo ECM: i crediti restano registrati ma non c\'è un contatore'}><input type="number" min="0" step="0.1" value={v.crediti_ecm ?? ''} onChange={(e) => s('crediti_ecm', e.target.value)} /></Field>}
        <Field label="Scadenza o rinnovo entro" help="Se indicata entra nello scadenzario e nei richiami"><input type="date" value={v.scadenza || ''} onChange={(e) => s('scadenza', e.target.value)} /></Field>
        <Field label="Codice evento"><input value={v.codice_evento || ''} onChange={(e) => s('codice_evento', e.target.value)} /></Field>
        <Field label="Obbligatoria"><select value={v.obbligatoria ? '1' : '0'} onChange={(e) => s('obbligatoria', e.target.value === '1')}><option value="0">No</option><option value="1">Sì</option></select></Field>
        <Field label="Note" className="span2"><input value={v.note || ''} onChange={(e) => s('note', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function EcmModal({ id, ecm, onClose, onSaved }) {
  const toast = useToast();
  const p = ecm.profilo || {};
  const [v, setV] = useState({ soggetto: p.soggetto == null ? '' : p.soggetto ? '1' : '0', professione: p.professione || '', obbligo_triennio: p.obbligo_triennio ?? '', riduzione: p.riduzione || '', riduzione_motivo: p.riduzione_motivo || '', note: p.note || '' });
  const [err, setErr] = useState(null);
  const s = (k, x) => setV((q) => ({ ...q, [k]: x }));
  const save = async () => { try { await api.put(`/resources/${id}/ecm`, { ...v, soggetto: v.soggetto === '' ? null : v.soggetto === '1' }); toast('Posizione ECM salvata'); onSaved(); } catch (e) { setErr(e); } };
  return (
    <Modal title="Posizione ECM" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Soggetto all'obbligo ECM" help="Automatico: riconosciuto da tipo di persona, mansione o disciplina" className="span2"><select value={v.soggetto} onChange={(e) => s('soggetto', e.target.value)}><option value="">Automatico ({ecm.automatico && ecm.soggetto ? 'oggi: sì' : ecm.automatico ? 'oggi: no' : 'da ricalcolare'})</option><option value="1">Sì, professione sanitaria</option><option value="0">No</option></select></Field>
        <Field label="Professione sanitaria" className="span2"><input value={v.professione} placeholder="es. tecnico sanitario di radiologia medica" onChange={(e) => s('professione', e.target.value)} /></Field>
        <Field label="Obbligo del triennio" help={`Vuoto = obbligo generale (${n1(ecm.regole.obbligo)} crediti)`}><input type="number" min="0" step="1" value={v.obbligo_triennio} onChange={(e) => s('obbligo_triennio', e.target.value)} /></Field>
        <Field label="Riduzione riconosciuta" help="Esoneri, esenzioni, bonus"><input type="number" min="0" step="0.5" value={v.riduzione} onChange={(e) => s('riduzione', e.target.value)} /></Field>
        <Field label="Motivo della riduzione" className="span2"><input value={v.riduzione_motivo} onChange={(e) => s('riduzione_motivo', e.target.value)} /></Field>
        <Field label="Note" className="span2"><input value={v.note} onChange={(e) => s('note', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function FormazioneTab({ id, writer, onChange }) {
  const toast = useToast();
  const d = useApi(`/resources/${id}/formazione`, [id]);
  const [modal, setModal] = useState(null);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const { corsi, ecm, tipi } = d.data;
  const reload = () => { setModal(null); d.reload(); onChange?.(); };
  const svolti = corsi.filter((c) => c.stato === 'SVOLTA'); const programmati = corsi.filter((c) => c.stato === 'PROGRAMMATA');
  return (
    <>
      {ecm.soggetto ? (<>
        <ContatoreEcm c={ecm.contatore} />
        {!ecm.profilo && <div className="alert info" style={{ display: 'block', marginBottom: 14 }}>Posizione ECM riconosciuta in automatico ma non ancora attivata: il contatore si vede, scadenze e richiami partono dal primo attestato con crediti registrato oppure da "Posizione ECM" &gt; Salva.</div>}
      </>) : <div className="alert info" style={{ display: 'block', marginBottom: 14 }}>Nessun contatore ECM: la persona non risulta una professione sanitaria{ecm.automatico ? ' (riconoscimento automatico da tipo, mansione e disciplina)' : ''}.{writer ? ' Se lo è, impostalo da "Posizione ECM".' : ''}</div>}
      <Card title={`Formazione svolta (${svolti.length})`} flush actions={<div className="row" style={{ gap: 6 }}>{writer && <button className="btn sm ghost" onClick={() => setModal({ ecm: true })}>Posizione ECM</button>}{writer && <button className="btn sm" onClick={() => setModal({ corso: null })}><Icon name="plus" />Nuovo corso o attestato</button>}</div>}>
        {!svolti.length ? <Empty>Nessun corso registrato</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data</th><th>Corso</th><th>Tipo</th><th className="num">Ore</th><th className="num">Crediti ECM</th><th>Rinnovo entro</th><th>Attestato</th><th /></tr></thead>
            <tbody>{svolti.map((c) => (
              <tr key={c.id}>
                <td className="strong">{itDate(c.data)}</td>
                <td>{c.titolo}{c.obbligatoria && <> <Badge tone="blue">obbligatoria</Badge></>}<div className="small muted">{[c.ente, c.codice_evento && `evento ${c.codice_evento}`, c.fonte === 'ATTESTATO' && 'letto dall\'attestato', c.note].filter(Boolean).join(' · ')}</div></td>
                <td><Badge>{tipi[c.tipo] || c.tipo}</Badge></td>
                <td className="num">{c.ore ? n1(c.ore) : '–'}</td>
                <td className="num strong">{Number(c.crediti_ecm) > 0 ? n1(c.crediti_ecm) : '–'}</td>
                <td>{c.scadenza ? <Badge tone={c.scadenza < today() ? 'red' : 'grey'}>{itDate(c.scadenza)}</Badge> : '–'}</td>
                <td>{c.attachment_id ? <a href={`${API_BASE}/resources/${id}/attachments/${c.attachment_id}/download?inline=1`} target="_blank" rel="noreferrer">Apri</a> : <span className="muted">–</span>}</td>
                <td className="num">{writer && <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="iconbtn" aria-label="Modifica" onClick={() => setModal({ corso: c })}><Icon name="edit" /></button><button className="iconbtn" aria-label="Elimina" onClick={() => setModal({ del: c })}><Icon name="trash" /></button></span>}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
      {programmati.length > 0 && (
        <Card title={`Formazione programmata (${programmati.length})`} flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data prevista</th><th>Corso</th><th>Tipo</th><th /></tr></thead>
            <tbody>{programmati.map((c) => (
              <tr key={c.id}><td className="strong">{itDate(c.data_prevista)}</td><td>{c.titolo}<div className="small muted">{[c.ente, c.note].filter(Boolean).join(' · ')}</div></td><td><Badge>{tipi[c.tipo] || c.tipo}</Badge></td>
                <td className="num">{writer && <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setModal({ corso: { ...c, stato: 'SVOLTA', data: c.data_prevista } })}>Segna svolto</button><button className="iconbtn" aria-label="Elimina" onClick={() => setModal({ del: c })}><Icon name="trash" /></button></span>}</td></tr>))}</tbody>
          </table></div>
        </Card>)}
      {modal && 'corso' in modal && <CorsoModal id={id} corso={modal.corso} tipi={tipi} rinnovo={d.data.rinnovo_mesi} letturaAi={d.data.lettura_ai} soggetto={ecm.soggetto} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.ecm && <EcmModal id={id} ecm={ecm} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.del && <ConfirmModal danger title="Eliminare il corso?" text={`"${modal.del.titolo}"${Number(modal.del.crediti_ecm) > 0 ? `: i ${n1(modal.del.crediti_ecm)} crediti ECM tornano nel contatore.` : '.'} L'attestato resta nel dossier.`} confirmText="Elimina"
        onClose={() => setModal(null)} onConfirm={async () => { try { await api.del(`/resources/${id}/formazione/${modal.del.id}`); toast('Corso eliminato'); reload(); } catch (e) { toast(e.message, 'err'); } }} />}
    </>
  );
}

// ================================================================ TIROCINIO
export const TIR_TIPO = { CURRICULARE: 'Curriculare', EXTRACURRICULARE: 'Extracurriculare', PROFESSIONALIZZANTE: 'Professionalizzante', ALTRO: 'Altro' };
export const PF_STATO = { DA_RICHIEDERE: { label: 'Da richiedere', tone: 'red' }, RICHIESTO: { label: 'Richiesto', tone: 'amber' }, RICEVUTO: { label: 'Ricevuto, da firmare', tone: 'blue' }, FIRMATO: { label: 'Firmato', tone: 'green' } };
export const GIUDIZIO_TIR = { POSITIVO: { label: 'Positivo', tone: 'green' }, POSITIVO_CON_RISERVA: { label: 'Positivo con riserva', tone: 'amber' }, NEGATIVO: { label: 'Negativo', tone: 'red' }, INTERROTTO: { label: 'Tirocinio interrotto', tone: 'grey' } };

export function TirocinioForm({ value: v, onChange, sites = [], people = [], nuovo = false }) {
  const s = (k, x) => onChange({ ...v, [k]: x });
  return (
    <>
      <div className="subhead" style={{ marginTop: 0 }}>Convenzione e contratto di inserimento</div>
      <div className="form-grid">
        <Field label="Tipo di tirocinio"><select value={v.tipo || 'EXTRACURRICULARE'} onChange={(e) => s('tipo', e.target.value)}>{Object.entries(TIR_TIPO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Ente promotore" help="Università, scuola, centro per l'impiego, agenzia"><input value={v.ente_promotore || ''} onChange={(e) => s('ente_promotore', e.target.value)} /></Field>
        <Field label="Email dell'ente" help="Per la richiesta del progetto formativo"><input type="email" value={v.ente_email || ''} onChange={(e) => s('ente_email', e.target.value)} /></Field>
        <Field label="Tutor dell'ente promotore"><input value={v.tutor_ente || ''} onChange={(e) => s('tutor_ente', e.target.value)} /></Field>
        <Field label="Convenzione n."><input value={v.convenzione_numero || ''} onChange={(e) => s('convenzione_numero', e.target.value)} /></Field>
        <Field label="Convenzione del"><input type="date" value={v.convenzione_data || ''} onChange={(e) => s('convenzione_data', e.target.value)} /></Field>
        <Field label="Inizio"><input type="date" value={v.start_date || ''} onChange={(e) => s('start_date', e.target.value)} /></Field>
        <Field label="Fine"><input type="date" value={v.end_date || ''} onChange={(e) => s('end_date', e.target.value)} /></Field>
        <Field label="Ore settimanali"><input type="number" min="0" max="60" step="0.5" value={v.weekly_hours ?? ''} onChange={(e) => s('weekly_hours', e.target.value)} /></Field>
        <Field label="Indennità mensile (€)" help="Se prevista"><input type="number" min="0" step="10" value={v.indennita_mensile ?? ''} onChange={(e) => s('indennita_mensile', e.target.value)} /></Field>
        <Field label="Sede del tirocinio"><select value={v.work_site_id || ''} onChange={(e) => s('work_site_id', e.target.value ? Number(e.target.value) : null)}><option value="">–</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Tutor aziendale" help="Chi segue il tirocinante e firma il giudizio"><select value={v.tutor_person_id || ''} onChange={(e) => s('tutor_person_id', e.target.value ? Number(e.target.value) : null)}><option value="">–</option>{people.filter((p) => p.kind !== 'TIROCINANTE').map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}</option>)}</select></Field>
        <Field label="Obiettivi formativi" className="span2"><textarea rows={3} value={v.obiettivi || ''} onChange={(e) => s('obiettivi', e.target.value)} /></Field>
      </div>
      <div className="subhead">Progetto formativo individuale</div>
      <div className="form-grid">
        <Field label="Stato"><select value={v.pf_stato || 'DA_RICHIEDERE'} onChange={(e) => s('pf_stato', e.target.value)}>{Object.entries(PF_STATO).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
        <Field label="Richiesto il"><input type="date" value={v.pf_richiesto_il || ''} onChange={(e) => s('pf_richiesto_il', e.target.value)} /></Field>
        <Field label="Ricevuto il"><input type="date" value={v.pf_ricevuto_il || ''} onChange={(e) => s('pf_ricevuto_il', e.target.value)} /></Field>
        <Field label="Firmato il"><input type="date" value={v.pf_firmato_il || ''} onChange={(e) => s('pf_firmato_il', e.target.value)} /></Field>
      </div>
      {!nuovo && (<>
        <div className="subhead">Giudizio finale del tutor aziendale</div>
        <div className="form-grid">
          <Field label="Esito"><select value={v.giudizio_esito || ''} onChange={(e) => s('giudizio_esito', e.target.value || null)}><option value="">Non ancora espresso</option>{Object.entries(GIUDIZIO_TIR).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
          <Field label="Data del giudizio"><input type="date" value={v.giudizio_data || ''} onChange={(e) => s('giudizio_data', e.target.value)} /></Field>
          <Field label="Giudizio" className="span2" help="Competenze acquisite, obiettivi raggiunti, eventuale proposta di inserimento"><textarea rows={4} value={v.giudizio_note || ''} onChange={(e) => s('giudizio_note', e.target.value)} /></Field>
        </div>
      </>)}
      <div className="form-grid" style={{ marginTop: 10 }}><Field label="Note" className="span2"><input value={v.notes || ''} onChange={(e) => s('notes', e.target.value)} /></Field></div>
    </>
  );
}

export function TirocinioCard({ id, tirocinio: t, writer, onChange }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [v, setV] = useState(t || {});
  const [err, setErr] = useState(null);
  const sites = useApi(modal === 'edit' ? '/work-sites' : null, [modal]);
  const people = useApi(modal === 'edit' ? '/resources?status=ATTIVO,IMPEGNO' : null, [modal]);
  useEffect(() => { setV(t || {}); }, [t]);
  const save = async () => { try { await api.put(`/resources/${id}/tirocinio`, v); toast('Tirocinio salvato'); setModal(null); onChange?.(); } catch (e) { setErr(e); } };
  const richiedi = async (invia) => { try { const r = await api.post(`/resources/${id}/tirocinio/richiedi-progetto`, { invia }); toast(invia ? (r.esito === 'REGISTRATO' ? 'Richiesta registrata: la posta è in modalità registro, nessun invio reale' : 'Richiesta inviata all\'ente promotore dalla casella People') : 'Richiesta registrata'); setModal(null); onChange?.(); } catch (e) { toast(e.message, 'err'); } };
  const pf = PF_STATO[t?.pf_stato] || PF_STATO.DA_RICHIEDERE;
  return (
    <Card title="Tirocinio" actions={writer && <button className="btn sm ghost" onClick={() => { setErr(null); setModal('edit'); }}>{t ? 'Modifica' : 'Inserisci'}</button>}>
      {!t ? <Empty>Dati del tirocinio non inseriti</Empty> : (<>
        <Riga k="Tipo" v={TIR_TIPO[t.tipo]} />
        <Riga k="Ente promotore" v={[t.ente_promotore, t.tutor_ente && `tutor ${t.tutor_ente}`].filter(Boolean).join(' · ')} />
        <Riga k="Convenzione" v={[t.convenzione_numero && `n. ${t.convenzione_numero}`, t.convenzione_data && `del ${itDate(t.convenzione_data)}`].filter(Boolean).join(' ')} />
        <Riga k="Periodo" v={t.start_date ? `dal ${itDate(t.start_date)}${t.end_date ? ` al ${itDate(t.end_date)}` : ''}` : null} />
        <Riga k="Impegno" v={t.weekly_hours ? `${n1(t.weekly_hours)} ore settimanali` : null} />
        <Riga k="Indennità" v={Number(t.indennita_mensile) > 0 ? `${eur(t.indennita_mensile)} al mese` : null} />
        <Riga k="Sede" v={t.work_site_name} />
        <Riga k="Tutor aziendale" v={t.tutor_person_id ? <Link to={`${BASE}/risorse/${t.tutor_person_id}`}>{t.tutor_name}</Link> : <Badge tone="red">da individuare</Badge>} />
        <Riga k="Progetto formativo" v={<span><Badge tone={pf.tone}>{pf.label}</Badge>{t.pf_richiesto_il ? ` richiesto il ${itDate(t.pf_richiesto_il)}` : ''}{t.pf_firmato_il ? ` · firmato il ${itDate(t.pf_firmato_il)}` : ''}</span>} />
        <Riga k="Giudizio finale" v={t.giudizio_esito ? <span><Badge tone={GIUDIZIO_TIR[t.giudizio_esito].tone}>{GIUDIZIO_TIR[t.giudizio_esito].label}</Badge> {itDate(t.giudizio_data)}</span> : <span className="muted">non ancora espresso</span>} />
        {t.obiettivi && <p className="small muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><b>Obiettivi:</b> {t.obiettivi}</p>}
        {t.giudizio_note && <p className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}><b>Giudizio:</b> {t.giudizio_note}</p>}
        {writer && t.pf_stato !== 'FIRMATO' && <div className="row" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => setModal('richiedi')}><Icon name="mail" />Richiedi il progetto formativo</button></div>}
        <p className="small muted" style={{ marginTop: 10 }}>Convenzione, progetto formativo firmato, registro presenze e attestazione finale si caricano nel Dossier.</p>
      </>)}
      {modal === 'edit' && <Modal wide title="Tirocinio" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}><ErrorBox error={err} /><TirocinioForm value={v} onChange={setV} sites={sites.data || []} people={people.data || []} /></Modal>}
      {modal === 'richiedi' && <Modal title="Richiesta del progetto formativo" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn ghost" onClick={() => richiedi(false)}>Registra senza inviare</button><button className="btn" disabled={!t?.ente_email} onClick={() => richiedi(true)}>Invia dalla casella People</button></>}>
        <p>La richiesta viene registrata con la data di oggi e il progetto passa a "Richiesto". Resta nello scadenzario finché non risulta firmato.</p>
        {t?.ente_email ? <p>Con "Invia" parte un'email dalla casella People a <b>{t.ente_email}</b> con i dati del tirocinio, del soggetto ospitante e del tutor aziendale.</p> : <p className="muted">Per inviarla dalla Suite serve l'email dell'ente promotore nei dati del tirocinio.</p>}
      </Modal>}
    </Card>
  );
}

// ================================================================ MEDICINA DEL LAVORO
export const MDL_STATO = { NON_SOGGETTO: { label: 'Non soggetto', tone: 'grey' }, DA_IMPOSTARE: { label: 'Da impostare', tone: 'grey' }, DA_FARE: { label: 'Visita preventiva da fare', tone: 'red' }, SCADUTA: { label: 'Scaduta', tone: 'red' }, IMMINENTE: { label: 'Entro 30 giorni', tone: 'mauve' }, PROSSIMA: { label: 'Entro 90 giorni', tone: 'blue' }, IN_REGOLA: { label: 'In regola', tone: 'green' } };
export const GIUDIZIO_TONE = { IDONEO: 'green', IDONEO_PRESCRIZIONI: 'amber', IDONEO_LIMITAZIONI: 'amber', NON_IDONEO_TEMPORANEO: 'red', NON_IDONEO_PERMANENTE: 'red' };

function VisitaModal({ id, visita, quadro, onClose, onSaved }) {
  const toast = useToast();
  const nuova = !visita?.id;
  const per = quadro.posizione?.periodicita_mesi || 12;
  const [v, setV] = useState(visita || { tipo: quadro.posizione?.ultima_visita ? 'PERIODICA' : 'PREVENTIVA', stato: 'EFFETTUATA', data_visita: today(), scadenza: addMonths(today(), per), medico: quadro.scheda?.medico_competente || '' });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const s = (k, x) => setV((p) => ({ ...p, [k]: x }));
  const fatta = v.stato === 'EFFETTUATA';
  const save = async () => {
    setErr(null);
    try {
      const body = { tipo: v.tipo, stato: v.stato, data_prevista: v.data_prevista || '', ora: v.ora || '', luogo: v.luogo || '', medico: v.medico || '', data_visita: fatta ? v.data_visita || '' : '', giudizio: fatta ? v.giudizio || '' : '', prescrizioni: fatta ? v.prescrizioni || '' : '', scadenza: fatta ? v.scadenza || '' : '', note: v.note || '' };
      const f = fd(body, file);
      if (nuova) await api.upload(`/resources/${id}/mdl/visite`, f);
      else await api.put(`/resources/${id}/mdl/visite/${visita.id}`, f);
      toast('Visita salvata'); onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal wide title={nuova ? 'Nuova visita' : 'Visita di medicina del lavoro'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Tipo di visita"><select value={v.tipo} onChange={(e) => s('tipo', e.target.value)}>{Object.entries(quadro.tipi).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Stato"><select value={v.stato} onChange={(e) => s('stato', e.target.value)}>{Object.entries(quadro.stati).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {!fatta && <Field label="Data prevista"><input type="date" value={v.data_prevista || ''} onChange={(e) => s('data_prevista', e.target.value)} /></Field>}
        {!fatta && <Field label="Ora"><input value={v.ora || ''} placeholder="09:30" onChange={(e) => s('ora', e.target.value)} /></Field>}
        {!fatta && <Field label="Luogo" className="span2"><input value={v.luogo || ''} onChange={(e) => s('luogo', e.target.value)} /></Field>}
        <Field label="Medico competente"><input value={v.medico || ''} onChange={(e) => s('medico', e.target.value)} /></Field>
        {fatta && <Field label="Data della visita *"><input type="date" value={v.data_visita || ''} onChange={(e) => { const dv = e.target.value; setV((p) => ({ ...p, data_visita: dv, scadenza: dv ? addMonths(dv, per) : p.scadenza })); }} /></Field>}
        {fatta && <Field label="Giudizio di idoneità *"><select value={v.giudizio || ''} onChange={(e) => s('giudizio', e.target.value)}><option value="">–</option>{Object.entries(quadro.giudizi).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        {fatta && <Field label="Prossima visita entro" help={`Proposta dalla periodicità (${per} mesi): correggila se il giudizio indica altro`}><input type="date" value={v.scadenza || ''} onChange={(e) => s('scadenza', e.target.value)} /></Field>}
        {fatta && <Field label="Prescrizioni o limitazioni" className="span2" help="Solo quanto scritto nel giudizio: nessuna diagnosi, nessun esito di accertamenti"><textarea rows={3} value={v.prescrizioni || ''} onChange={(e) => s('prescrizioni', e.target.value)} /></Field>}
        {fatta && <Field label="Giudizio di idoneità (PDF)" className="span2" help="Va nel Dossier come Idoneità sanitaria. Non caricare referti o cartella sanitaria."><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>}
        <Field label="Note organizzative" className="span2"><input value={v.note || ''} onChange={(e) => s('note', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function MdlTab({ id, writer, onChange }) {
  const toast = useToast();
  const d = useApi(`/resources/${id}/mdl`, [id]);
  const [modal, setModal] = useState(null);
  const [sch, setSch] = useState(null);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const q = d.data; const p = q.posizione; const st = MDL_STATO[p?.stato] || MDL_STATO.DA_IMPOSTARE;
  const reload = () => { setModal(null); d.reload(); onChange?.(); };
  const prot = q.protocolli.find((x) => x.id === q.scheda?.protocollo_id);
  const apriScheda = () => { setSch({ sorveglianza: q.scheda ? q.scheda.sorveglianza : true, protocollo_id: q.scheda?.protocollo_id || '', mansione: q.scheda?.mansione || '', rischi: q.scheda?.rischi || '', periodicita_mesi: q.scheda?.periodicita_mesi || '', medico_competente: q.scheda?.medico_competente || '', note: q.scheda?.note || '' }); setModal('scheda'); };
  const salvaScheda = async () => { try { await api.put(`/resources/${id}/mdl`, sch); toast('Scheda di sorveglianza salvata'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <Kpi label="Giudizio di idoneità" accent value={p?.giudizio ? q.giudizi[p.giudizio] : 'non registrato'} foot={p?.ultima_visita ? `visita del ${itDate(p.ultima_visita)}` : 'nessuna visita effettuata'} />
        <Kpi label="Prossima visita" value={p?.sorveglianza === false ? 'non soggetto' : p?.impostata && p?.prossima ? itDate(p.prossima) : 'da impostare'} foot={<Badge tone={st.tone}>{st.label}</Badge>} />
        <Kpi label="Visita fissata" value={p?.fissata ? itDate(p.fissata.data) : 'nessuna'} foot={p?.fissata ? [p.fissata.stato === 'CONVOCATA' ? 'convocata' : 'programmata', p.fissata.ora && `ore ${p.fissata.ora}`, p.fissata.luogo].filter(Boolean).join(' · ') : 'le convocazioni partono da Medicina del lavoro'} />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Sorveglianza e protocollo sanitario" actions={writer && <button className="btn sm ghost" onClick={apriScheda}>{q.scheda ? 'Modifica' : 'Imposta'}</button>}>
          {!q.scheda ? <Empty>Scheda non impostata: finché non lo è, la persona non genera scadenze di medicina del lavoro</Empty> : (<>
            <Riga k="Sorveglianza sanitaria" v={q.scheda.sorveglianza ? 'Attiva' : 'Non soggetto'} />
            <Riga k="Mansione" v={q.scheda.mansione || p?.mansione} />
            <Riga k="Rischi" v={q.scheda.rischi || prot?.rischi} />
            <Riga k="Protocollo sanitario" v={prot?.nome} />
            <Riga k="Periodicità" v={`${p?.periodicita_mesi || 12} mesi`} />
            <Riga k="Medico competente" v={q.scheda.medico_competente} />
            {prot?.accertamenti && <p className="small muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><b>Accertamenti previsti dal protocollo:</b> {prot.accertamenti}</p>}
            {q.scheda.note && <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{q.scheda.note}</p>}
          </>)}
          {p?.prescrizioni && <div className="alert" style={{ display: 'block', marginTop: 10, background: '#fff6e5', border: '1px solid #f0d9a8', color: '#7a4a00', borderRadius: 10, padding: '10px 14px' }}><b>Prescrizioni o limitazioni in vigore:</b> {p.prescrizioni}</div>}
          <p className="small muted" style={{ marginTop: 10 }}>In Suite sta solo il giudizio di idoneità con le eventuali prescrizioni. Diagnosi, referti e cartella sanitaria restano al medico competente. Ogni consultazione di questa sezione è registrata.</p>
        </Card>
        <Card title={`Calendario delle visite (${q.visite.length})`} flush actions={writer && <button className="btn sm" onClick={() => setModal({ visita: null })}><Icon name="plus" />Nuova visita</button>}>
          {!q.visite.length ? <Empty>Nessuna visita registrata</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Data</th><th>Tipo</th><th>Esito</th><th>Prossima</th><th /></tr></thead>
              <tbody>{q.visite.map((x) => (
                <tr key={x.id}>
                  <td className="strong">{itDate(x.data_visita || x.data_prevista)}{x.ora && !x.data_visita ? <div className="small muted">ore {x.ora}</div> : null}</td>
                  <td>{q.tipi[x.tipo]}<div className="small muted">{[x.medico, x.luogo].filter(Boolean).join(' · ')}</div></td>
                  <td>{x.giudizio ? <Badge tone={GIUDIZIO_TONE[x.giudizio]}>{q.giudizi[x.giudizio]}</Badge> : <Badge tone={x.stato === 'CONVOCATA' ? 'blue' : 'grey'}>{q.stati[x.stato]}</Badge>}{x.prescrizioni && <div className="small muted">{x.prescrizioni}</div>}</td>
                  <td>{x.scadenza ? itDate(x.scadenza) : '–'}</td>
                  <td className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{x.attachment_id && <a className="btn sm ghost" href={`${API_BASE}/resources/${id}/attachments/${x.attachment_id}/download?inline=1`} target="_blank" rel="noreferrer">Giudizio</a>}
                    {writer && <button className="iconbtn" aria-label="Modifica" onClick={() => setModal({ visita: x.stato === 'EFFETTUATA' ? x : { ...x, stato: 'EFFETTUATA', data_visita: x.data_prevista, scadenza: x.data_prevista ? addMonths(x.data_prevista, p?.periodicita_mesi || 12) : '' } })}><Icon name="edit" /></button>}
                    {writer && <button className="iconbtn" aria-label="Elimina" onClick={() => setModal({ del: x })}><Icon name="trash" /></button>}</span></td>
                </tr>))}</tbody>
            </table></div>)}
        </Card>
      </div>
      {modal && typeof modal === 'object' && 'visita' in modal && <VisitaModal id={id} visita={modal.visita} quadro={q} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.del && <ConfirmModal danger title="Eliminare la visita?" text="La visita esce dal calendario. Il giudizio eventualmente caricato resta nel Dossier." confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { try { await api.del(`/resources/${id}/mdl/visite/${modal.del.id}`); reload(); } catch (e) { toast(e.message, 'err'); } }} />}
      {modal === 'scheda' && sch && (
        <Modal title="Sorveglianza e protocollo sanitario" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={salvaScheda}>Salva</button></>}>
          <div className="form-grid">
            <Field label="Sorveglianza sanitaria" help="Non soggetto: nessuna visita dovuta (lo stabilisce il documento di valutazione dei rischi)"><select value={sch.sorveglianza ? '1' : '0'} onChange={(e) => setSch({ ...sch, sorveglianza: e.target.value === '1' })}><option value="1">Attiva</option><option value="0">Non soggetto</option></select></Field>
            <Field label="Protocollo sanitario" help="I protocolli si definiscono in Medicina del lavoro"><select value={sch.protocollo_id || ''} onChange={(e) => setSch({ ...sch, protocollo_id: e.target.value ? Number(e.target.value) : '' })}><option value="">–</option>{q.protocolli.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.periodicita_mesi} mesi)</option>)}</select></Field>
            <Field label="Mansione ai fini della sorveglianza" className="span2"><input value={sch.mansione} onChange={(e) => setSch({ ...sch, mansione: e.target.value })} /></Field>
            <Field label="Rischi specifici" className="span2"><input value={sch.rischi} placeholder="es. videoterminale, rischio biologico, radiazioni ionizzanti" onChange={(e) => setSch({ ...sch, rischi: e.target.value })} /></Field>
            <Field label="Periodicità (mesi)" help="Vuoto = quella del protocollo, altrimenti 12"><input type="number" min="1" max="120" value={sch.periodicita_mesi} onChange={(e) => setSch({ ...sch, periodicita_mesi: e.target.value })} /></Field>
            <Field label="Medico competente"><input value={sch.medico_competente} onChange={(e) => setSch({ ...sch, medico_competente: e.target.value })} /></Field>
            <Field label="Note organizzative" className="span2"><input value={sch.note} onChange={(e) => setSch({ ...sch, note: e.target.value })} /></Field>
          </div>
        </Modal>)}
    </>
  );
}
