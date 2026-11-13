// Business Hub · Scheda account: intestazione (Legal entity, linea, fase con avanzamento, cliente attivo riservato al CEO/Admin, owner,
// prossima azione) e schede: Diario (con "Registra contatto"), Referenti, Contratto (il contratto della linea incorporato, prima di
// listino e offerta: richiesta del CEO del 07/11/2026), Listino e offerta, Kit e contrattualizzazione, Criticità, Ordini, Non
// conformità, Ticket, Circolari, Portale, Fascicoli (di cui), Documenti, Email (con "Scrivi al cliente" dalla casella della linea),
// Pacchetto di benvenuto (components/Pacchetto.jsx), Dati economici e commerciali (con le strutture del gruppo). Le sezioni degli altri
// widget sono in sola lettura.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import Pacchetto from '../components/Pacchetto.jsx';
import Listino from '../components/Listino.jsx';
import Proposta from '../components/Proposta.jsx';
import PuntoPrelievi from '../components/PuntoPrelievi.jsx';
import ScriviCliente from '../components/ScriviCliente.jsx';
import ContrattoDettaglio from '../components/ContrattoDettaglio.jsx';
import SynclabAccount from '../components/SynclabAccount.jsx';
import { ClientiGestionale, ListinoGestionale } from '../components/GestionaleSynclab.jsx';
import CercaRubrica, { SuggerimentoEmail } from '../../../components/CercaRubrica.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, KindBadge, Modal, PromptModal, ConfirmModal, UploadButton, Icon, Empty, MoneyInput, useToast } from '../components/ui.jsx';
import {
  itDate, itDateTime, bytes, FASI, LINEE, PRIORITA, TIPO_ATTIVITA, SOTTOTIPO, TONO_ATTIVITA, ORIGINE_CRITICITA, GRAVITA, NC_STATO, ORDINE_STATO, EMAIL_STATO, DOSSIER_STATUS, FILE_CAT, eurK, pctSconto, num, today, VOCABOLARI, DISCIPLINE } from '../format.js';

// Ordine delle schede (richiesta del CEO del 07/11/2026: "La pagina del contratto del cliente va assolutamente inglobata nella scheda del
// cliente [...] quella parte viene anche prima del listino/offerta!"): il contratto ha la sua scheda subito dopo i referenti; la vecchia
// tabella "Contratti" non c'è più (i contratti della Legal entity sono nella scheda Contratto). "Kit e contrattualizzazione" è la ex
// "Proposta e contratto" (components/Proposta.jsx): kit, form online, contrattualizzazione, avvio; il riepilogo del cliente
// contrattualizzato o attivo resta lì.
const SCHEDE = [['diario', 'Diario'], ['referenti', 'Referenti'], ['contratto', 'Contratto'], ['listino', 'Listino e offerta'], ['proposta', 'Kit e contrattualizzazione'], ['criticita', 'Criticità'], ['ordini', 'Ordini'], ['nc', 'Non conformità'], ['ticket', 'Ticket'], ['circolari', 'Circolari'],
  ['portale', 'Portale'], ['fascicoli', 'Fascicoli'], ['documenti', 'Documenti'], ['email', 'Email'], ['pacchetto', 'Pacchetto di benvenuto'], ['economici', 'Dati economici'], ['commerciali', 'Dati commerciali']];
// Linea Punti Prelievo (06/11/2026): al posto di listino e kit del Service la scheda "Punto prelievi" (components/PuntoPrelievi.jsx)
const schedeDi = (linea) => (linea === 'PP' ? [...SCHEDE.slice(0, 3), ['punto', 'Punto prelievi'], ...SCHEDE.slice(5)] : SCHEDE);
// indirizzi salvati prima del 07/11/2026 (?scheda=contratti) aprono la scheda Contratto
const schedaIniziale = () => { const k = new URLSearchParams(window.location.search).get('scheda') || 'diario'; return k === 'contratti' ? 'contratto' : k; };

export default function Account() {
  const { id } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const q = useApi(`/hub/accounts/${id}`);
  const owners = useApi('/hub/utenti');
  const [tab, setTab] = useState(schedaIniziale);
  const [modal, setModal] = useState(null);
  const a = q.data;
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!a) return <div className="page"><Loading /></div>;
  const edit = a.puo_modificare;
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); q.reload(); } catch (e) { toast(e.message, 'err'); } };
  const conta = { proposta: a.da_verificare || 0, punto: a.da_verificare || 0, diario: a.attivita.length, referenti: a.contatti.length, criticita: a.criticita.filter((k) => !k.chiusa_at).length, contratto: contrattiDellaLinea(a).length > 1 ? contrattiDellaLinea(a).length : 0, fascicoli: a.fascicoli.length, documenti: a.documenti.length, email: a.attivita.filter((x) => x.tipo.startsWith('EMAIL')).length };
  const daConfermare = !a.cliente_attivo && a.attivita.some((x) => x.esito === 'DA_CONFERMARE');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Badge tone={LINEE[a.linea].tone}>{LINEE[a.linea].label}</Badge>
            <Badge tone={FASI[a.fase_corrente].tone}>{FASI[a.fase_corrente].label}</Badge>
            {a.priorita && <Badge tone={PRIORITA[a.priorita].tone}>Priorità {PRIORITA[a.priorita].label.toLowerCase()}</Badge>}
            {a.prospect && !a.cliente_attivo && <Badge tone="grey">prospect</Badge>}
            {a.stallo && <Badge tone="red">stallo: {a.giorni_da_avanzamento} giorni</Badge>}
          </div>
          <h1>{a.org_name}</h1>
          {a.linea === 'PP' && a.punto_nome && a.punto_nome !== a.org_name && <div className="strong" style={{ marginTop: -4 }}>Punto prelievi {a.punto_nome}</div>}
          <div className="sub">{[a.gruppo && a.gruppo !== a.org_name ? `Gruppo ${a.gruppo}` : null, a.tipologia, [a.org_address, a.citta, a.prov && `(${a.prov})`].filter(Boolean).join(' '), a.n_sedi ? `${a.n_sedi} strutture` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="row">
          {edit && <button className="btn" onClick={() => setModal({ t: 'contatto' })}><Icon name="plus" />Registra contatto</button>}
          {edit && <button className="btn dark" onClick={() => setModal({ t: 'email' })}><Icon name="mail" />Scrivi al cliente</button>}
          <a className="btn ghost" href="/admin/organizations" title="Anagrafica della Legal entity">Legal entity</a>
          {isAdmin(user) && <button className="iconbtn" title="Elimina l'account dalla pipeline" onClick={() => setModal({ t: 'elimina' })}><Icon name="trash" /></button>}
        </div>
      </div>

      <div className="steps hub">{FASI.slice(1).map((f) => { const d = a.phase_dates?.[f.n]; const cls = f.n < a.fase_corrente || (d && f.n <= a.fase_corrente) ? 'done' : ''; return <div key={f.n} className={`s ${cls} ${f.n === a.fase_corrente ? 'now' : ''}`}><i>{f.n}</i><span>{f.label}<small>{d ? itDate(d) : ''}</small></span></div>; })}</div>
      {a.fase_corrente === 6 && a.phase_dates?.[7] && !a.cliente_attivo && <div className="alert warn small" style={{ marginBottom: 12 }}>Il DB indica "Attivo / Starting" dal {itDate(a.phase_dates[7])}: la fase 7 vale solo quando il CEO conferma il cliente attivo.</div>}

      {['SRV', 'MDL'].includes(a.linea) && <CodiceStudiolab a={a} edit={edit} onDone={q.reload} />}
      {['SRV', 'MDL'].includes(a.linea) && <SynclabAccount a={a} />}

      <div className="grid g4 hubhead">
        <div className="card kpi">
          <div className="lbl">Cliente attivo</div>
          <div className="val" style={{ fontSize: 18 }}>{a.cliente_attivo ? <span className="green">Sì{a.attivo_dal ? `, dal ${itDate(a.attivo_dal)}` : ''}</span> : <span className="muted">No</span>}</div>
          <div className="foot">{a.cliente_attivo ? `confermato da ${a.attivo_da_name || '–'}` : daConfermare ? 'da confermare dal CEO' : 'lo dice solo il CEO'}</div>
          {a.puo_attivo ? <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setModal({ t: 'attivo' })}>{a.cliente_attivo ? 'Segna non attivo' : 'Conferma cliente attivo'}</button> : null}
        </div>
        <div className="card kpi">
          <div className="lbl">Fase</div>
          <div className="val" style={{ fontSize: 18 }}>{FASI[a.fase_corrente].label}</div>
          <div className="foot">{a.ultimo_avanzamento ? `ultimo avanzamento ${itDate(a.ultimo_avanzamento)} (${a.giorni_da_avanzamento} gg)` : 'nessuna data di fase'}</div>
          {edit && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setModal({ t: 'fase', fase: Math.min(a.fase_corrente + 1, a.cliente_attivo ? 7 : 6), data: today(), nota: '' })}>Cambia fase</button>}
        </div>
        <div className="card kpi">
          <div className="lbl">Owner TD</div>
          {edit ? <select style={{ marginTop: 6 }} value={a.owner_user_id || ''} onChange={(e) => act(() => api.put(`/hub/accounts/${a.id}`, { owner_user_id: e.target.value ? Number(e.target.value) : null }), 'Owner aggiornato')}><option value="">Da assegnare</option>{(owners.data || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
            : <div className="val" style={{ fontSize: 18 }}>{a.owner_name || '–'}</div>}
          <div className="foot">riceve le notifiche dell'account</div>
        </div>
        <div className="card kpi">
          <div className="lbl">Prossima azione</div>
          <div className={`val ${a.azione_scaduta ? 'red' : ''}`} style={{ fontSize: 15 }}>{a.prossima_azione || '–'}</div>
          <div className="foot">{a.data_prossima_azione ? `${a.azione_scaduta ? 'scaduta il' : 'entro il'} ${itDate(a.data_prossima_azione)}` : 'nessuna data'}</div>
          {edit && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setModal({ t: 'azione', prossima_azione: a.prossima_azione || '', data_prossima_azione: a.data_prossima_azione || '' })}>Modifica</button>}
        </div>
      </div>

      <div className="tabs scroll" style={{ marginTop: 16 }}>{schedeDi(a.linea).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{conta[k] ? <span className="tcount">{conta[k]}</span> : null}</button>)}</div>

      {tab === 'diario' && <Diario a={a} onChange={q.reload} />}
      {tab === 'referenti' && <Referenti a={a} onChange={q.reload} />}
      {tab === 'contratto' && <SchedaContratto a={a} onChange={q.reload} />}
      {tab === 'listino' && ['SRV', 'MDL'].includes(a.linea) && <ListinoGestionale a={a} />}
      {tab === 'listino' && <Listino a={a} onChange={q.reload} vaiA={setTab} />}
      {tab === 'proposta' && <Proposta a={a} onChange={q.reload} vaiA={setTab} />}
      {tab === 'punto' && a.linea === 'PP' && <PuntoPrelievi a={a} onChange={q.reload} vaiA={setTab} />}
      {tab === 'criticita' && <Criticita a={a} onChange={q.reload} />}
      {tab === 'ordini' && <FeedOrdini a={a} />}
      {tab === 'nc' && <FeedNc a={a} />}
      {tab === 'ticket' && <FeedTicket a={a} />}
      {tab === 'circolari' && <FeedCircolari a={a} />}
      {tab === 'portale' && <FeedPortale a={a} />}
      {tab === 'fascicoli' && <Fascicoli a={a} />}
      {tab === 'documenti' && <Documenti a={a} onChange={q.reload} />}
      {tab === 'email' && <Email a={a} onScrivi={() => setModal({ t: 'email' })} />}
      {tab === 'pacchetto' && <Pacchetto a={a} onChange={q.reload} />}
      {tab === 'economici' && <Economici a={a} onChange={q.reload} />}
      {tab === 'commerciali' && <Commerciali a={a} onChange={q.reload} />}

      {modal?.t === 'contatto' && <Composer a={a} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); setTab('diario'); }} />}
      {modal?.t === 'email' && <ScriviCliente a={a} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); setTab('email'); }} />}
      {modal?.t === 'elimina' && <ConfirmModal danger title={`Elimina ${a.org_name} dalla pipeline`} text={`L'account ${LINEE[a.linea].label} viene eliminato con diario, referenti, listini e documenti del Business Hub. La Legal entity, i contratti e i fascicoli restano. L'operazione non si annulla.`} confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { try { await api.del(`/hub/accounts/${a.id}`); toast('Account eliminato'); nav(`${BASE}/clienti?linea=${a.linea}`); } catch (e) { toast(e.message, 'err'); } }} />}
      {modal?.t === 'attivo' && <AttivoModal a={a} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'fase' && <Modal title="Cambia fase" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={() => act(async () => { await api.put(`/hub/accounts/${a.id}/fase`, { fase: Number(modal.fase), data: modal.data, nota: modal.nota }); setModal(null); }, 'Fase registrata')}>Registra</button></>}>
        <div className="form-grid">
          <Field label="Nuova fase"><select value={modal.fase} onChange={(e) => setModal({ ...modal, fase: e.target.value })}>{FASI.map((f) => <option key={f.n} value={f.n} disabled={f.n === 7 && !a.cliente_attivo}>{f.label}{f.n === 7 && !a.cliente_attivo ? ' (serve il cliente attivo)' : ''}</option>)}</select></Field>
          {Number(modal.fase) > 0 && <Field label="Data della fase"><input type="date" value={modal.data} onChange={(e) => setModal({ ...modal, data: e.target.value })} /></Field>}
          <Field label="Nota" className="span2"><textarea value={modal.nota} onChange={(e) => setModal({ ...modal, nota: e.target.value })} /></Field>
        </div>
      </Modal>}
      {modal?.t === 'azione' && <Modal title="Prossima azione" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" onClick={() => act(async () => { await api.put(`/hub/accounts/${a.id}`, { prossima_azione: modal.prossima_azione, data_prossima_azione: modal.data_prossima_azione }); setModal(null); }, 'Prossima azione salvata')}>Salva</button></>}>
        <div className="form-grid"><Field label="Azione" className="span2"><input value={modal.prossima_azione} onChange={(e) => setModal({ ...modal, prossima_azione: e.target.value })} /></Field><Field label="Entro il"><input type="date" value={modal.data_prossima_azione} onChange={(e) => setModal({ ...modal, data_prossima_azione: e.target.value })} /></Field></div>
      </Modal>}
    </div>
  );
}

// ---------------- Diario ----------------
function Diario({ a, onChange }) {
  const toast = useToast();
  const [tipo, setTipo] = useState('');
  const [del, setDel] = useState(null);
  const l = a.attivita.filter((x) => !tipo || x.tipo === tipo);
  return (
    <Card title="Diario" actions={<select style={{ height: 30, width: 200 }} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Tutte le attività</option>{Object.entries(TIPO_ATTIVITA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
      {l.length ? <ul className="diario">{l.map((x) => (
        <li key={x.id} className={`t-${x.tipo}`}>
          <div className="dh">
            <Badge tone={TONO_ATTIVITA(x.tipo)}>{TIPO_ATTIVITA[x.tipo] || x.tipo}</Badge>{x.sottotipo && SOTTOTIPO[x.sottotipo] && <Badge tone="silk">{SOTTOTIPO[x.sottotipo]}</Badge>}
            <span className="strong">{x.oggetto || ''}</span>
            {x.esito && <Badge tone={x.esito === 'DA_CONFERMARE' || x.esito === 'DA_VERIFICARE' ? 'mauve' : x.esito === 'FALLITO' ? 'red' : 'grey'}>{x.esito.replace(/_/g, ' ').toLowerCase()}</Badge>}
            <span className="spacer" />
            <span className="small muted">{itDateTime(x.at)}{x.user_name ? ` · ${x.user_name}` : ''}</span>
            {['CHIAMATA', 'MESSAGGIO', 'INCONTRO', 'SOPRALLUOGO', 'NOTA', 'OFFERTA'].includes(x.tipo) && a.puo_modificare && <button className="iconbtn" title="Elimina" onClick={() => setDel(x)}><Icon name="trash" /></button>}
          </div>
          {(x.con_chi || x.email_from) && <div className="small muted">{x.tipo === 'EMAIL_IN' ? `Da ${x.email_from}` : x.tipo === 'EMAIL_OUT' ? `Da ${x.email_from} a ${x.email_to}${x.email_cc ? ` · cc ${x.email_cc}` : ''}` : `Con ${x.con_chi}`}</div>}
          {x.testo && <div className="dt">{x.testo}</div>}
          {(x.prossima_azione || x.contract_protocol || x.email_errore) && <div className="small">{x.prossima_azione ? `→ ${x.prossima_azione}${x.data_prossima ? ` entro il ${itDate(x.data_prossima)}` : ''}` : ''}{x.contract_protocol ? ` · contratto ${x.contract_protocol}` : ''}{x.email_errore ? <span className="red"> · {x.email_errore}</span> : ''}</div>}
          {x.allegati?.length > 0 && <div className="row" style={{ gap: 8, marginTop: 4 }}>{x.allegati.map((f) => <a key={f.id} className="small" href={`${API_BASE}/hub/documenti/${f.id}`}><Icon name="download" />{f.filename}</a>)}</div>}
        </li>))}</ul> : <Empty>Nessuna attività</Empty>}
      {del && <ConfirmModal danger title="Elimina attività" text="L'attività e il collegamento ai suoi allegati vengono rimossi dal diario." confirmText="Elimina" onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/hub/attivita/${del.id}`); toast('Attività eliminata'); onChange(); }} />}
    </Card>
  );
}

function Composer({ a, onClose, onDone }) {
  const toast = useToast();
  const now = new Date(); const loc = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ tipo: 'CHIAMATA', at: loc, contatto_id: '', con_chi: '', oggetto: '', testo: '', esito: '', prossima_azione: '', data_prossima: '', contract_id: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  // scorciatoia "Con chi" dalle rubriche: il contatto scelto diventa un referente dell'account (campi modificabili prima di crearlo)
  const [creati, setCreati] = useState([]);
  const [nuovo, setNuovo] = useState(null);
  const contatti = [...a.contatti, ...creati];
  const creaReferente = async () => {
    try {
      const row = await api.post(`/hub/accounts/${a.id}/contatti`, nuovo);
      setCreati((l) => [...l, row]); setF((cur) => ({ ...cur, contatto_id: String(row.id), con_chi: '' })); setNuovo(null);
      toast('Referente creato: lo trovi anche nella scheda Referenti');
    } catch (e) { toast(e.message, 'err'); }
  };
  const salva = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      const c = contatti.find((x) => String(x.id) === String(f.contatto_id));
      for (const [k, v] of Object.entries({ ...f, at: f.at ? new Date(f.at).toISOString() : '', con_chi: f.con_chi || (c ? `${c.nome}${c.ruolo ? ` (${c.ruolo})` : ''}` : '') })) fd.append(k, v ?? '');
      for (const x of files) fd.append('files', x);
      await api.upload(`/hub/accounts/${a.id}/attivita`, fd); toast('Contatto registrato nel diario'); onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Registra contatto · ${a.org_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={salva}>Registra nel diario</button></>}>
      <div className="form-grid">
        <Field label="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{['CHIAMATA', 'MESSAGGIO', 'INCONTRO', 'SOPRALLUOGO', 'OFFERTA', 'NOTA', 'EMAIL_IN', 'EMAIL_OUT'].map((k) => <option key={k} value={k}>{TIPO_ATTIVITA[k]}{k.startsWith('EMAIL') ? ' (registrata a mano)' : ''}</option>)}</select></Field>
        <Field label="Quando"><input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
        <Field label="Con chi (referente)"><select value={f.contatto_id} onChange={(e) => setF({ ...f, contatto_id: e.target.value })}><option value="">Altro / non in elenco</option>{contatti.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ruolo ? ` · ${c.ruolo}` : ''}</option>)}</select></Field>
        {!f.contatto_id && <Field label="Con chi (testo)"><input value={f.con_chi} onChange={(e) => setF({ ...f, con_chi: e.target.value })} placeholder="Nome e ruolo" /></Field>}
        {!f.contatto_id && !nuovo && a.puo_modificare && <CercaRubrica etichetta="Non è tra i referenti? Cercalo in rubrica e crealo" onScegli={(c) => setNuovo({ nome: '', ruolo: '', email: '', telefono: '', note: '', principale: false, ...referenteDaRubrica(c) })} />}
        {nuovo && <div className="span2 card" style={{ padding: 12 }}>
          <div className="strong" style={{ marginBottom: 8 }}>Nuovo referente da rubrica</div>
          <div className="form-grid">
            <Field label="Nome e cognome"><input value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} /></Field>
            <Field label="Ruolo"><input value={nuovo.ruolo} onChange={(e) => setNuovo({ ...nuovo, ruolo: e.target.value })} /></Field>
            <Field label="Email"><input value={nuovo.email} onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })} /></Field>
            <Field label="Telefono"><input value={nuovo.telefono} onChange={(e) => setNuovo({ ...nuovo, telefono: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><button type="button" className="btn sm" disabled={(nuovo.nome || '').trim().length < 2} onClick={creaReferente}>Crea il referente e usalo</button><button type="button" className="btn sm ghost" onClick={() => setNuovo(null)}>Annulla</button></div>
        </div>}
        <Field label="Oggetto" className="span2"><input value={f.oggetto} onChange={(e) => setF({ ...f, oggetto: e.target.value })} placeholder="In breve" /></Field>
        <Field label="Cosa ci siamo detti" className="span2"><textarea style={{ minHeight: 130 }} value={f.testo} onChange={(e) => setF({ ...f, testo: e.target.value })} /></Field>
        <Field label="Esito"><input value={f.esito} onChange={(e) => setF({ ...f, esito: e.target.value })} placeholder="Es. interessato, richiamare, offerta richiesta" /></Field>
        <Field label="Contratto collegato"><select value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}><option value="">Nessuno</option>{a.contratti.map((c) => <option key={c.id} value={c.id}>{c.protocol || `#${c.id}`} · {c.title}</option>)}</select></Field>
        <Field label="Prossima azione"><input value={f.prossima_azione} onChange={(e) => setF({ ...f, prossima_azione: e.target.value })} /></Field>
        <Field label="Entro il"><input type="date" value={f.data_prossima} onChange={(e) => setF({ ...f, data_prossima: e.target.value })} /></Field>
        <div className="span2 row"><UploadButton label="Allegati" multiple onFiles={(l) => setFiles([...files, ...l])} />{files.map((x, i) => <span key={i} className="chip">{x.name} <button className="btn link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}</div>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>La prossima azione indicata diventa quella dell'account. Le email vere si inviano con "Scrivi al cliente" e arrivano da sole dalla casella {a.casella}.</div>
    </Modal>
  );
}

// ---------------- Referenti ----------------
// Campi del referente dal contatto scelto in rubrica (CercaRubrica): nome completo, ruolo (o azienda se manca), email, telefoni
// (fisso e cellulare insieme, il campo è unico), provenienza per i nuovi; le note restano quelle scritte se ci sono
const FONTE_REFERENTE = { OUTLOOK: 'RUBRICA_OUTLOOK', GOOGLE: 'RUBRICA_GMAIL' };
function referenteDaRubrica(c, cur = {}) {
  return {
    nome: c.nome || cur.nome, ruolo: c.ruolo || cur.ruolo || '', email: c.email || cur.email || '', telefono: c.telefoni_testo || cur.telefono || '',
    note: cur.note || (c.azienda && c.fonte !== 'SUITE' ? `${c.azienda} (da ${c.origine})` : ''),
    ...(cur.id ? {} : { fonte: FONTE_REFERENTE[c.fonte] || 'MANUALE' }),
  };
}
function Referenti({ a, onChange }) {
  const toast = useToast();
  const [m, setM] = useState(null);
  const salva = async () => { try { if (m.id) await api.put(`/hub/contatti/${m.id}`, m); else await api.post(`/hub/accounts/${a.id}/contatti`, m); toast('Referente salvato'); setM(null); onChange(); } catch (e) { toast(e.message, 'err'); } };
  // contatto scelto dalle rubriche (Suite, Outlook, Gmail): compila i campi vuoti o tutti, resta modificabile prima di Salva
  const daRubrica = (c) => setM((cur) => ({ ...cur, ...referenteDaRubrica(c, cur) }));
  return (
    <div className="grid g2">
      <Card title="Referenti del cliente" actions={a.puo_modificare && <button className="btn sm" onClick={() => setM({ nome: '', ruolo: '', email: '', telefono: '', principale: false, note: '' })}>+ Referente</button>} flush>
        {a.contatti.length ? <table className="t"><tbody>{a.contatti.map((c) => <tr key={c.id}>
          <td><div className="strong">{c.nome}{c.principale ? <Badge tone="teal">principale</Badge> : null}</div><div className="small muted">{[c.ruolo, c.person_id ? 'in Persone' : null, c.fonte === 'DB_OPPORTUNITA' ? 'dal DB Opportunità' : c.fonte === 'EMAIL' ? 'da email' : c.fonte === 'RUBRICA_OUTLOOK' ? 'da Outlook' : c.fonte === 'RUBRICA_GMAIL' ? 'da Gmail' : null].filter(Boolean).join(' · ')}</div></td>
          <td className="small">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '–'}<div>{c.telefono || ''}</div></td>
          <td style={{ width: 1, whiteSpace: 'nowrap' }}>{a.puo_modificare && <><button className="btn sm ghost" onClick={() => setM({ ...c })}><Icon name="edit" /></button> <button className="iconbtn" onClick={async () => { await api.del(`/hub/contatti/${c.id}`); onChange(); }}><Icon name="trash" /></button></>}</td>
        </tr>)}</tbody></table> : <Empty>Nessun referente: aggiungilo per registrare con chi parli e per abbinare le email in arrivo.</Empty>}
      </Card>
      <Card title="Persone della Legal entity (anagrafica Suite)" flush>
        {a.persone.length ? <table className="t"><tbody>{a.persone.map((p) => <tr key={p.id}><td><div className="strong">{p.nome}</div><div className="small muted">{p.ruolo || ''}</div></td><td className="small">{p.email || '–'}</td>
          <td style={{ width: 1 }}>{a.puo_modificare && <button className="btn sm ghost" onClick={async () => { try { await api.post(`/hub/accounts/${a.id}/contatti`, { nome: p.nome, ruolo: p.ruolo, email: p.email, telefono: p.phone, person_id: p.id }); toast('Collegato come referente'); onChange(); } catch (e) { toast(e.message, 'err'); } }}>Collega</button>}</td></tr>)}</tbody></table>
          : <Empty>Nessuna persona della Legal entity in Persone: i referenti restano solo qui, senza duplicare l'anagrafica.</Empty>}
      </Card>
      {m && <Modal title={m.id ? 'Modifica referente' : 'Nuovo referente'} onClose={() => setM(null)} footer={<><button className="btn ghost" onClick={() => setM(null)}>Annulla</button><button className="btn" onClick={salva}>Salva</button></>}>
        <div className="form-grid">
          <CercaRubrica onScegli={daRubrica} etichetta="Cerca il referente in rubrica" />
          <Field label="Nome e cognome" className="span2"><input value={m.nome} onChange={(e) => setM({ ...m, nome: e.target.value })} /></Field>
          <Field label="Ruolo"><input value={m.ruolo || ''} onChange={(e) => setM({ ...m, ruolo: e.target.value })} /></Field>
          <Field label="Email"><input value={m.email || ''} onChange={(e) => setM({ ...m, email: e.target.value })} /></Field>
          <SuggerimentoEmail email={m.email} onCompleta={daRubrica} />
          <Field label="Telefono"><input value={m.telefono || ''} onChange={(e) => setM({ ...m, telefono: e.target.value })} /></Field>
          <label className="f inline"><input type="checkbox" checked={Boolean(m.principale)} onChange={(e) => setM({ ...m, principale: e.target.checked })} />Referente principale</label>
          <Field label="Note" className="span2"><input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} /></Field>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>Se l'email è quella di una persona della Legal entity in Persone, il referente si collega alla sua scheda.</div>
      </Modal>}
    </div>
  );
}

// ---------------- Criticità ----------------
function Criticita({ a, onChange }) {
  const toast = useToast();
  const [m, setM] = useState(null);
  const [chiudi, setChiudi] = useState(null);
  const nc = useApi(`/hub/accounts/${a.id}/feed/nc`);
  return (
    <div className="grid g2">
      <Card title="Criticità registrate" actions={a.puo_criticita && <button className="btn sm" onClick={() => setM({ origine: 'LABORATORIO', gravita: 'MEDIA', titolo: '', descrizione: '', aperta_at: today() })}>+ Criticità</button>} flush>
        {a.criticita.length ? <table className="t"><tbody>{a.criticita.map((k) => <tr key={k.id}>
          <td style={{ width: 1 }}><Badge tone={GRAVITA[k.gravita].tone}>{GRAVITA[k.gravita].label}</Badge></td>
          <td><div className="strong">{k.titolo || ORIGINE_CRITICITA[k.origine]}</div><div className="small">{k.descrizione}</div><div className="small muted">{ORIGINE_CRITICITA[k.origine]} · aperta il {itDate(k.aperta_at)}{k.user_name ? ` da ${k.user_name}` : ''}{k.chiusa_at ? ` · chiusa il ${itDate(k.chiusa_at)}: ${k.esito}` : ''}</div></td>
          <td style={{ width: 1 }}>{!k.chiusa_at ? (a.puo_criticita && <button className="btn sm ghost" onClick={() => setChiudi(k)}>Chiudi</button>) : <Badge tone="green">chiusa</Badge>}</td>
        </tr>)}</tbody></table> : <Empty>Nessuna criticità registrata</Empty>}
      </Card>
      <Card title="Dal widget Non conformità (sola lettura)" flush>
        {!nc.data ? <Loading /> : !nc.data.attivo ? <Empty>Widget NC non attivo</Empty> : nc.data.righe.length ? <table className="t"><tbody>{nc.data.righe.map((n) => <tr key={n.id} className="click" onClick={() => { window.location.href = `/nc/nc/${n.id}`; }}>
          <td className="mono">{n.codice}</td><td><div>{n.tipo || n.macro}</div><div className="small muted">{NC_STATO[n.stato] || n.stato} · gravità {String(n.gravita).toLowerCase()}</div></td><td className="small muted">{itDate(n.opened_at)}</td></tr>)}</tbody></table> : <Empty>Nessuna NC su questo cliente</Empty>}
      </Card>
      {m && <Modal title="Nuova criticità" onClose={() => setM(null)} footer={<><button className="btn ghost" onClick={() => setM(null)}>Annulla</button><button className="btn" onClick={async () => { try { await api.post(`/hub/accounts/${a.id}/criticita`, m); toast('Criticità registrata'); setM(null); onChange(); } catch (e) { toast(e.message, 'err'); } }}>Registra</button></>}>
        <div className="form-grid">
          <Field label="Origine"><select value={m.origine} onChange={(e) => setM({ ...m, origine: e.target.value })}>{Object.entries(ORIGINE_CRITICITA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Gravità"><select value={m.gravita} onChange={(e) => setM({ ...m, gravita: e.target.value })}>{Object.entries(GRAVITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Aperta il"><input type="date" value={m.aperta_at} onChange={(e) => setM({ ...m, aperta_at: e.target.value })} /></Field>
          <Field label="Titolo" className="span2"><input value={m.titolo} onChange={(e) => setM({ ...m, titolo: e.target.value })} /></Field>
          <Field label="Descrizione" className="span2"><textarea value={m.descrizione} onChange={(e) => setM({ ...m, descrizione: e.target.value })} /></Field>
        </div>
      </Modal>}
      {chiudi && <PromptModal title="Chiudi la criticità" label="Esito (cosa è stato fatto)" confirmText="Chiudi" onClose={() => setChiudi(null)} onConfirm={async (esito) => { await api.put(`/hub/criticita/${chiudi.id}/chiudi`, { esito }); onChange(); }} />}
    </div>
  );
}

// ---------------- Feed dagli altri widget ----------------
function useFeed(a, sez) { return useApi(`/hub/accounts/${a.id}/feed/${sez}`); }
const NonAttivo = ({ nome }) => <Card><Empty>Widget {nome} non attivo: avvialo in Amministrazione &gt; Attivazione moduli.</Empty></Card>;
const durata = (ore) => (ore == null ? '–' : ore < 24 ? `${num(ore)} ore` : `${num(ore / 24)} giorni`);
function FeedOrdini({ a }) {
  const f = useFeed(a, 'ordini');
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  if (!f.data.attivo) return <NonAttivo nome="Ordini" />;
  return (
    <Card title="Ordini della Legal entity (widget Ordini)" flush actions={<span className="small muted">"Come e quando gli rispondiamo": richiesta → approvazione → spedizione → consegna · soglia {f.data.soglia_giorni} gg</span>}>
      {f.data.righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Fase</th><th>Richiesta</th><th>Approvazione (risposta)</th><th className="num">Tempo di risposta</th><th>Spedizione</th><th>Consegna</th><th>Operatore</th></tr></thead><tbody>
        {f.data.righe.map((o) => <tr key={o.id} className="click" onClick={() => { window.location.href = `/orders/ordini/${o.id}`; }}>
          <td className="mono">{o.number}{o.urgent ? <Badge tone="red">urgente</Badge> : null}<div className="small muted">{o.sede || ''}</div></td>
          <td className="small">{ORDINE_STATO[o.status] || o.status}</td>
          <td className="small">{itDateTime(o.submitted_at)}<div className="muted">{o.richiesto_da || ''}</div></td>
          <td className="small">{o.approved_at ? itDateTime(o.approved_at) : o.giorni_in_attesa != null ? <span className={o.giorni_in_attesa > f.data.soglia_giorni ? 'red strong' : ''}>in attesa da {o.giorni_in_attesa} gg</span> : '–'}</td>
          <td className="num">{durata(o.ore_risposta)}</td>
          <td className="small">{o.shipped_at ? itDateTime(o.shipped_at) : '–'}{o.ddt_number ? <div className="muted">DDT {o.ddt_number}</div> : null}</td>
          <td className="small">{o.delivered_at ? itDateTime(o.delivered_at) : '–'}</td>
          <td className="small">{o.approvato_da || '–'}</td>
        </tr>)}</tbody></table></div> : <Empty>Nessun ordine di questa Legal entity</Empty>}
    </Card>
  );
}
function FeedNc({ a }) {
  const f = useFeed(a, 'nc');
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  if (!f.data.attivo) return <NonAttivo nome="Non conformità" />;
  return (
    <Card title="Non conformità sul cliente (widget NC)" flush>
      {f.data.righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>NC</th><th>Data</th><th>Tipo</th><th>Gravità</th><th>Stato</th><th>Inviata</th><th>Prima risposta</th><th>Chiusa</th></tr></thead><tbody>
        {f.data.righe.map((n) => <tr key={n.id} className="click" onClick={() => { window.location.href = `/nc/nc/${n.id}`; }}>
          <td className="mono">{n.codice}{n.ricorrente ? <Badge tone="red">ricorrente</Badge> : null}</td><td className="small">{itDateTime(n.opened_at)}</td><td className="small">{n.tipo || n.macro}<div className="muted">{n.sede || ''}</div></td>
          <td>{n.gravita}</td><td className="small">{NC_STATO[n.stato] || n.stato}</td><td className="small">{n.sent_at ? itDateTime(n.sent_at) : '–'}</td><td className="small">{n.first_response_at ? itDateTime(n.first_response_at) : '–'}</td><td className="small">{n.closed_at ? itDateTime(n.closed_at) : '–'}</td>
        </tr>)}</tbody></table></div> : <Empty>Nessuna non conformità su questo cliente</Empty>}
    </Card>
  );
}
function FeedTicket({ a }) {
  const f = useFeed(a, 'ticket');
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  if (!f.data.attivo) return <NonAttivo nome="Ticket" />;
  return (
    <Card title="Ticket aperti dagli accessi della Legal entity (widget Ticket)" flush>
      {f.data.righe.length ? <table className="t"><thead><tr><th>Ticket</th><th>Titolo</th><th>Stato</th><th>Aperto</th><th>Prima risposta</th><th>Risolto</th></tr></thead><tbody>
        {f.data.righe.map((t) => <tr key={t.id} className="click" onClick={() => { window.location.href = `/ticket/${t.id}`; }}><td className="mono">{t.protocollo}</td><td>{t.titolo}<div className="small muted">{t.richiedente || ''} · {t.priorita}</div></td><td className="small">{t.stato}</td><td className="small">{itDateTime(t.created_at)}</td><td className="small">{t.prima_risposta_at ? itDateTime(t.prima_risposta_at) : '–'}</td><td className="small">{t.risolto_at ? itDateTime(t.risolto_at) : '–'}</td></tr>)}
      </tbody></table> : <Empty>Nessun ticket (i ticket riservati non compaiono)</Empty>}
    </Card>
  );
}
function FeedCircolari({ a }) {
  const f = useFeed(a, 'circolari');
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  if (!f.data.attivo) return <NonAttivo nome="Circolari" />;
  return (
    <Card title="Circolari del segmento e invii al cliente (widget Circolari)" flush>
      {f.data.righe.length ? <table className="t"><thead><tr><th>Protocollo</th><th>Titolo</th><th>Pubblicata</th><th>Inviata al cliente</th><th>Presa visione</th></tr></thead><tbody>
        {f.data.righe.map((c) => <tr key={c.id} className="click" onClick={() => { window.location.href = `/circolari/${c.id}`; }}><td className="mono">{c.protocollo}</td><td>{c.titolo}</td><td className="small">{itDate(c.published_at)}</td><td className="small">{c.inviata ? `sì, ${itDateTime(c.inviata_at)}` : <span className="muted">no</span>}</td><td className="small">{c.prese_visione ? `${c.prese_visione} (${itDateTime(c.letta_at)})` : <span className="muted">nessuna</span>}</td></tr>)}
      </tbody></table> : <Empty>Nessuna circolare pubblicata per questo segmento</Empty>}
    </Card>
  );
}
// Accessi esterni e referenti senza accesso (richiesta del CEO del 07/11/2026: "crea gli accessi al portale per tutti i referenti
// inclusi in anagrafica"): per ogni referente con email senza accesso "Crea accesso", in alto "Crea gli accessi per tutti i referenti"
// (conferma, invito a ciascuno con la password provvisoria, nessuna copia, esito riga per riga, attività nel diario)
const ESITO_ACC = { CREATO: ['green', 'creato'], HA_ACCESSO: ['teal', 'ha già l\'accesso'], SALTATO: ['grey', 'saltato'], ERRORE: ['red', 'non creato'] };
function FeedPortale({ a }) {
  const toast = useToast();
  const f = useFeed(a, 'portale');
  const p = useApi(`/hub/accounts/${a.id}/accessi`);
  const [conferma, setConferma] = useState(false);
  const [esito, setEsito] = useState(null);
  const [busy, setBusy] = useState(null);
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  const senza = (p.data?.righe || []).filter((r) => r.esito !== 'HA_ACCESSO');
  const daCreare = senza.filter((r) => r.esito === 'DA_CREARE');
  const edit = p.data?.puo_modificare;
  const crea = async (body) => {
    const r = await api.post(`/hub/accounts/${a.id}/accessi`, body);
    setEsito(r); f.reload?.(); p.reload();
    toast(r.creati ? `${r.creati} ${r.creati === 1 ? 'accesso creato' : 'accessi creati'}: invito con la password provvisoria a ciascuno` : 'Nessun accesso da creare');
    return r;
  };
  const una = async (r) => { setBusy(r.contatto_id); try { await crea({ contatto_ids: [r.contatto_id] }); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); } };
  return (
    <>
      <Card title="Accessi esterni della Legal entity al Portale" flush actions={edit && daCreare.length > 0 && <button className="btn sm" onClick={() => setConferma(true)}><Icon name="plus" />Crea gli accessi per tutti i referenti ({daCreare.length})</button>}>
        <table className="t"><thead><tr><th>Utente</th><th>Stato</th><th>Ultimo accesso</th><th>Ultima consultazione</th></tr></thead><tbody>
          {f.data.righe.map((u) => <tr key={u.id}><td><div className="strong">{u.full_name}</div><div className="small muted">{u.email}</div></td><td className="small">{u.status}</td><td className="small">{u.last_login_at ? itDateTime(u.last_login_at) : <span className="muted">mai</span>}</td><td className="small">{u.ultima_lettura ? itDateTime(u.ultima_lettura) : '–'}</td></tr>)}
          {senza.map((r) => <tr key={`c${r.contatto_id}`} className="muted-row"><td><div className="strong">{r.nome || r.email || 'Referente'}{r.principale && <> <Badge tone="teal">principale</Badge></>}</div><div className="small muted">{r.email || 'nessuna email'}{r.ruolo ? ` · ${r.ruolo}` : ''}</div></td>
            <td className="small"><Badge tone="grey">senza accesso</Badge>{r.esito === 'SALTATO' && <div className="muted">{r.motivo}</div>}</td>
            <td colSpan={2} className="small">{edit && r.esito === 'DA_CREARE' && <button className="btn sm ghost" disabled={busy === r.contatto_id} onClick={() => una(r)}><Icon name="plus" />{busy === r.contatto_id ? 'Creazione…' : 'Crea accesso'}</button>}</td></tr>)}
          {!f.data.righe.length && !senza.length && <tr><td colSpan={4}><Empty>Nessun accesso esterno e nessun referente: aggiungi i referenti nella scheda Referenti.</Empty></td></tr>}
        </tbody></table>
        <div className="small muted" style={{ padding: '8px 12px' }}>Un accesso per ogni referente con email (scheda Referenti): invito dalla casella della linea con la password provvisoria, senza copie. Prima della firma senza widget; dopo la contrattualizzazione con il profilo della linea. Al kit di proposta e alla contrattualizzazione si creano da soli per tutti i referenti ({p.data?.impostazione === 'PRINCIPALE' ? 'impostazione attuale: solo il principale' : 'impostazione attuale: tutti i referenti'}, Business Hub &gt; Impostazioni).</div>
      </Card>
      {esito && <Card title="Esito della creazione degli accessi" className="mt" flush actions={<button className="btn sm ghost" onClick={() => setEsito(null)}>Chiudi</button>}>
        <table className="t"><tbody>{esito.righe.map((r) => <tr key={r.contatto_id}><td><div className="strong">{r.nome || r.email || 'Referente'}</div><div className="small muted">{r.email || 'nessuna email'}</div></td><td><Badge tone={ESITO_ACC[r.esito]?.[0]}>{ESITO_ACC[r.esito]?.[1] || r.esito}</Badge></td><td className="small">{r.motivo || (r.invito ? `invito ${String(r.invito).toLowerCase()}` : '')}</td></tr>)}</tbody></table>
        {esito.password_provvisorie?.length > 0 && <div className="alert warn small" style={{ margin: 12 }}>Posta in modalità registro: gli inviti non partono. Password provvisorie da comunicare: {esito.password_provvisorie.map((x) => `${x.email} ${x.password}`).join(' · ')}</div>}
      </Card>}
      {conferma && <ConfirmModal title="Crea gli accessi per tutti i referenti" text={`Si creano ${daCreare.length} accessi al portale (${daCreare.map((r) => r.email).join(', ')}): ciascuno riceve l'invito con la password provvisoria da ${a.casella || 'la casella della linea'}, senza copie. Chi ha già l'accesso resta com'è; i referenti senza email si saltano.`} confirmText="Crea gli accessi" onClose={() => setConferma(false)} onConfirm={() => crea({ tutti: true })} />}
    </>
  );
}

// ---------------- Contratto (dentro la scheda del cliente) e fascicoli (di cui) ----------------
// Contratti della linea dell'account (per i Punti Prelievo quelli della sede del punto o senza sede)
function contrattiDellaLinea(a) {
  return (a.contratti || []).filter((c) => c.kind === a.linea && (a.linea !== 'PP' || !a.pp_site_id || !c.site_id || Number(c.site_id) === Number(a.pp_site_id)));
}
/**
 * Scheda "Contratto": la pagina del contratto completa incorporata (components/ContrattoDettaglio.jsx). Con più contratti della linea
 * (revisioni, annullati, cessati, più punti) in alto il selettore (predefinito: il contratto del pacchetto e del kit, il più recente non
 * annullato né cessato) e "Tutti i contratti di questa Legal entity" (elenco compatto qui dentro). Senza contratti: "Nuova proposta"
 * precompilata con Legal entity e linea, che al salvataggio torna qui.
 */
function SchedaContratto({ a, onChange }) {
  const linea = contrattiDellaLinea(a);
  const daUrl = new URLSearchParams(window.location.search).get('contratto');
  const [scelto, setScelto] = useState(() => (daUrl && a.contratti.some((c) => String(c.id) === daUrl) ? Number(daUrl) : null));
  const [tutti, setTutti] = useState(false);
  const id = (scelto && a.contratti.some((c) => c.id === scelto) ? scelto : null) || a.contratto_corrente_id || linea[0]?.id || null;
  const nuova = `${BASE}/contratti/nuovo/${a.linea}?da=account&account=${a.id}&org=${a.organization_id}${a.linea === 'PP' && a.pp_site_id ? `&site=${a.pp_site_id}` : ''}`;
  const etichetta = (c) => `${c.protocol || `bozza #${c.id}`} · v${c.version} · ${c.title || ''}${c.site_name ? ` (${c.site_name})` : ''}`;
  const altri = a.contratti.length > 1 || (a.contratti.length === 1 && !linea.length);
  return (
    <>
      {(linea.length > 1 || a.contratti.length > 0) && <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {linea.length > 1 && <label className="row small" style={{ gap: 6 }}><span className="muted">Contratto</span>
          <select style={{ height: 30, width: 'auto', maxWidth: 520 }} value={id || ''} onChange={(e) => setScelto(Number(e.target.value))}>{linea.map((c) => <option key={c.id} value={c.id}>{etichetta(c)} · {c.status.toLowerCase()}{c.id === a.contratto_corrente_id ? ' (in uso)' : ''}</option>)}</select></label>}
        {altri && <button className="btn link small" onClick={() => setTutti(!tutti)}>{tutti ? 'Nascondi l\'elenco' : `Tutti i contratti di questa Legal entity (${a.contratti.length})`}</button>}
        <span className="spacer" />
        {a.puo_modificare && id && <Link className="btn sm ghost" to={nuova}><Icon name="plus" />Nuova proposta {LINEE[a.linea].short}</Link>}
      </div>}
      {tutti && <Card title="Contratti della Legal entity" className="mb" flush>
        <table className="t"><thead><tr><th>Protocollo</th><th>Sezione</th><th>Titolo</th><th>Stato</th><th>Proposta</th><th>Firma</th><th className="num">Versione</th></tr></thead><tbody>
          {a.contratti.map((c) => { const dellaLinea = linea.some((x) => x.id === c.id); return <tr key={c.id} className={`click ${c.id === id ? 'sel' : ''}`} onClick={() => { if (dellaLinea) { setScelto(c.id); setTutti(false); } else window.location.href = `${BASE}/contratti/${c.id}`; }}>
            <td className="mono">{c.protocol || 'bozza'}</td><td><KindBadge kind={c.kind} /></td><td>{c.title}{c.site_name ? <div className="small muted">{c.site_name}</div> : null}{!dellaLinea && <div className="small muted">altra linea: si apre nella pagina del contratto</div>}</td><td><StatusBadge status={c.status} /></td><td className="small">{itDate(c.proposal_date)}</td><td className="small">{itDate(c.signed_at) || '–'}</td><td className="num">v{c.version}</td></tr>; })}
        </tbody></table>
      </Card>}
      {id ? <ContrattoDettaglio key={id} id={id} embedded onChange={(e) => { if (e?.eliminato) setScelto(null); onChange(); }} />
        : <Card title="Nessun contratto">
          <Empty>Nessun contratto {LINEE[a.linea].label} con {a.org_name}{a.linea === 'PP' && a.punto_nome ? ` per il punto ${a.punto_nome}` : ''}.</Empty>
          {a.puo_modificare && <div className="row" style={{ justifyContent: 'center' }}><Link className="btn" to={nuova}><Icon name="plus" />Nuova proposta</Link></div>}
          <div className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>La proposta si apre con la Legal entity e la linea già scelte; al salvataggio si torna qui.</div>
        </Card>}
    </>
  );
}
function Fascicoli({ a }) {
  const nav = useNavigate();
  return (
    <Card title="Fascicoli di autorizzazione (di cui)" flush>
      {a.fascicoli.length ? <table className="t"><tbody>{a.fascicoli.map((d) => <tr key={d.id} className="click" onClick={() => nav(`${BASE}/fascicoli/${d.id}`)}><td className="strong">{d.title}<div className="small muted">{d.site_name || ''}{d.protocol ? ` · ${d.protocol}` : ''}</div></td><td><Badge tone={DOSSIER_STATUS[d.status]?.tone}>{DOSSIER_STATUS[d.status]?.label}</Badge></td><td className="small">{d.authorized_at ? `autorizzato il ${itDate(d.authorized_at)}` : d.submitted_at ? `presentato il ${itDate(d.submitted_at)}` : ''}</td></tr>)}</tbody></table>
        : <Empty>Nessun fascicolo di autorizzazione per questa Legal entity</Empty>}
    </Card>
  );
}

// ---------------- Documenti ----------------
const CAT_DOC = { EMAIL: 'allegato di un\'email ricevuta', ALLEGATO: 'allegato del diario', PACCHETTO: 'pacchetto', LISTINO: 'listino StudioLAB', OFFERTA_ECONOMICA: 'offerta economica', MOD173: 'anagrafica clienti B2B (MOD173)',
  CONTRATTO_FIRMATO: 'contratto firmato', ALLEGATO_CONTRATTO: 'allegato del contratto', OFFERTA: 'offerta', VERBALE: 'verbale', ALTRO: 'altro' };
function Documenti({ a, onChange }) {
  const toast = useToast();
  const up = async (l) => { try { const fd = new FormData(); fd.append('categoria', 'ALTRO'); for (const x of l) fd.append('files', x); await api.upload(`/hub/accounts/${a.id}/documenti`, fd); toast('Documenti caricati'); onChange(); } catch (e) { toast(e.message, 'err'); } };
  const cf = a.contratti.flatMap((c) => (c.files || []).map((f) => ({ ...f, c })));
  return (
    <div className="grid g2">
      <Card title="Documenti dell'account" actions={a.puo_modificare && <UploadButton label="Carica" multiple onFiles={up} />} flush>
        {a.documenti.length ? <table className="t"><tbody>{a.documenti.map((d) => <tr key={d.id}><td><a href={`${API_BASE}/hub/documenti/${d.id}`}><Icon name="download" />{d.filename}</a><div className="small muted">{d.da_verificare && <Badge tone="mauve">da verificare</Badge>} {d.etichetta || CAT_DOC[d.categoria] || d.categoria.toLowerCase()} · {bytes(d.size)} · {itDateTime(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</div></td>
          <td style={{ width: 1 }}>{a.puo_modificare && d.categoria !== 'EMAIL' && <button className="iconbtn" onClick={async () => { await api.del(`/hub/documenti/${d.id}`); onChange(); }}><Icon name="trash" /></button>}</td></tr>)}</tbody></table> : <Empty>Nessun documento</Empty>}
      </Card>
      <Card title="Documenti dei contratti (di cui)" flush>
        {cf.length ? <table className="t"><tbody>{cf.map((f) => <tr key={f.id}><td><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><div className="small muted">{f.c.protocol || f.c.title} · {FILE_CAT[f.category] || f.category} · {bytes(f.size)}</div></td></tr>)}</tbody></table> : <Empty>Nessun documento nei contratti</Empty>}
      </Card>
    </div>
  );
}

// ---------------- Email ----------------
function Email({ a, onScrivi }) {
  const l = a.attivita.filter((x) => x.tipo === 'EMAIL_IN' || x.tipo === 'EMAIL_OUT');
  return (
    <Card title={`Email con il cliente · casella ${a.casella}`} actions={a.puo_modificare && <button className="btn sm" onClick={onScrivi}><Icon name="mail" />Scrivi al cliente</button>} flush>
      {l.length ? <table className="t"><tbody>{l.map((x) => <tr key={x.id}>
        <td style={{ width: 1 }}><Badge tone={x.tipo === 'EMAIL_IN' ? 'teal' : 'blue'}>{x.tipo === 'EMAIL_IN' ? 'Ricevuta' : 'Inviata'}</Badge></td>
        <td><div className="strong">{x.oggetto}</div><div className="small muted">{x.tipo === 'EMAIL_IN' ? `da ${x.email_from}` : `a ${x.email_to}${x.email_cc ? ` · cc ${x.email_cc}` : ''}`}{x.user_name ? ` · ${x.user_name}` : ''}</div>{x.testo && <div className="small clamp2">{x.testo}</div>}</td>
        <td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(x.at)}{x.email_stato && <div><Badge tone={EMAIL_STATO[x.email_stato]?.tone}>{EMAIL_STATO[x.email_stato]?.label}</Badge></div>}</td>
      </tr>)}</tbody></table> : <Empty>Nessuna email: quelle in arrivo su {a.casella} si registrano da sole se il mittente è un referente o della Legal entity.</Empty>}
    </Card>
  );
}

function AttivoModal({ a, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ dal: a.phase_dates?.[7] || today(), nota: '' });
  const go = async () => { try { await api.put(`/hub/accounts/${a.id}/attivo`, { attivo: !a.cliente_attivo, dal: f.dal, nota: f.nota }); toast(a.cliente_attivo ? 'Cliente segnato non attivo' : 'Cliente attivo confermato'); onDone(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={a.cliente_attivo ? 'Cliente non attivo' : 'Conferma cliente attivo'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className={`btn ${a.cliente_attivo ? 'danger' : ''}`} onClick={go}>{a.cliente_attivo ? 'Segna non attivo' : 'Conferma: il cliente è attivo'}</button></>}>
      <p style={{ marginTop: 0 }}>{a.cliente_attivo ? 'Il cliente torna non attivo: la data della fase 7 si toglie e resta nel diario.' : 'Il cliente diventa attivo e passa alla fase 7 (Attivo / Starting). Contratti e autorizzazioni non lo fanno da soli: lo decide il CEO.'}</p>
      <div className="form-grid">{!a.cliente_attivo && <Field label="Attivo dal"><input type="date" value={f.dal} onChange={(e) => setF({ ...f, dal: e.target.value })} /></Field>}<Field label="Nota" className="span2"><input value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Field></div>
    </Modal>
  );
}

// ---------------- Dati economici e commerciali ----------------
const ECON = [['sconto_medio', 'Sconto medio vs listino (frazione: -0,22 = 22% sotto)'], ['volume_fy_atteso', 'Volume FY atteso (esami/anno)'], ['prezzo_medio_esame', 'Prezzo medio €/esame'], ['fatturato_fy_atteso', 'Fatturato FY atteso (€)'], ['fatturato_2026', 'Fatturato 2026 da starting (€)'], ['fatturato_2027', 'Fatturato 2027 (€)']];
function Economici({ a, onChange }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const salva = async () => { try { await api.put(`/hub/accounts/${a.id}`, Object.fromEntries(ECON.map(([k]) => [k, f[k] === '' ? null : f[k]]))); toast('Dati economici salvati'); setF(null); onChange(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Dati economici" actions={a.puo_modificare && !f && <button className="btn sm ghost" onClick={() => setF(Object.fromEntries(ECON.map(([k]) => [k, a[k] ?? ''])))}><Icon name="edit" />Modifica</button>}>
      {!f ? <div className="grid g3">
        <div className="kpi card"><div className="lbl">Sconto medio vs listino</div><div className="val">{pctSconto(a.sconto_medio)}</div></div>
        <div className="kpi card"><div className="lbl">Volume FY atteso</div><div className="val">{a.volume_fy_atteso != null ? `${num(Math.round(a.volume_fy_atteso))} esami` : '–'}</div></div>
        <div className="kpi card"><div className="lbl">Prezzo medio per esame</div><div className="val">{a.prezzo_medio_esame != null ? `${num(a.prezzo_medio_esame)} €` : '–'}</div></div>
        <div className="kpi card accent"><div className="lbl">Fatturato FY atteso</div><div className="val">{eurK(a.fatturato_fy_atteso)}</div></div>
        <div className="kpi card"><div className="lbl">Fatturato 2026 da starting</div><div className="val">{eurK(a.fatturato_2026)}</div></div>
        <div className="kpi card"><div className="lbl">Fatturato 2027</div><div className="val">{eurK(a.fatturato_2027)}</div></div>
      </div> : <><div className="form-grid">{ECON.map(([k, l]) => <Field key={k} label={l}><MoneyInput value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} /></Field>)}</div><div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setF(null)}>Annulla</button><button className="btn" onClick={salva}>Salva</button></div></>}
      {a.n_sedi > 0 && <div className="small muted" style={{ marginTop: 10 }}>Account di gruppo: volumi e fatturati sono la somma delle righe del DB Opportunità delle {a.n_sedi} strutture (dettaglio in Dati commerciali).</div>}
    </Card>
  );
}
const COMM = [['tipologia', 'Tipologia'], ['segmento_lab', 'Segmento Lab'], ['gruppo', 'Gruppo / Ente gestore'], ['discipline', 'Discipline'], ['accreditata_ssr', 'Accreditata SSR'], ['fornitore_attuale', 'Fornitore Lab attuale'],
  ['situazione_fornitore', 'Situazione fornitore'], ['listino_riferimento', 'Listino di riferimento'], ['modalita_contatto', 'Modalità di contatto'], ['fonte_priorita', 'Fonte priorità'], ['stato_cartella', 'Stato cartella'],
  ['anno_bilancio', 'Anno bilancio'], ['fonte_censimento', 'Fonte censimento'], ['note', 'Note']];
function Commerciali({ a, onChange }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const acc = useApi(f ? '/hub/accounts' : null);
  const gruppi = useMemo(() => [...new Set((acc.data?.righe || []).map((x) => x.gruppo).filter(Boolean))].sort(), [acc.data]);
  const salva = async () => { try { const b = Object.fromEntries(COMM.map(([k]) => [k, f[k]])); b.priorita = f.priorita || null; b.prospect = f.prospect; await api.put(`/hub/accounts/${a.id}`, b); toast('Dati salvati'); setF(null); onChange(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="grid g2">
      <Card title="Dati commerciali" actions={a.puo_modificare && !f && <button className="btn sm ghost" onClick={() => setF({ ...Object.fromEntries(COMM.map(([k]) => [k, a[k] ?? ''])), priorita: a.priorita || '', prospect: a.prospect })}><Icon name="edit" />Modifica</button>}>
        {!f ? <table className="t"><tbody>
          <tr><td className="muted">Priorità</td><td>{a.priorita ? PRIORITA[a.priorita].label : '–'}</td></tr>
          {COMM.map(([k, l]) => <tr key={k}><td className="muted">{l}</td><td className="small">{a[k] || '–'}</td></tr>)}
          <tr><td className="muted">Fatturato della struttura</td><td className="small">{a.fatturato_struttura != null ? eurK(a.fatturato_struttura) : a.fatturato_struttura_testo || '–'}</td></tr>
          <tr><td className="muted">Legal entity</td><td className="small">{a.org_name}{a.vat_number ? ` · P.IVA ${a.vat_number}` : ''}{a.org_email ? ` · ${a.org_email}` : ''}{a.org_pec ? ` · PEC ${a.org_pec}` : ''}{a.org_phone ? ` · ${a.org_phone}` : ''}</td></tr>
        </tbody></table> : <>
          <div className="form-grid">
            <Field label="Priorità"><select value={f.priorita} onChange={(e) => setF({ ...f, priorita: e.target.value })}><option value="">–</option>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <label className="f inline"><input type="checkbox" checked={f.prospect} onChange={(e) => setF({ ...f, prospect: e.target.checked })} />Prospect (potenziale cliente)</label>
            {COMM.map(([k, l]) => <Field key={k} label={l} className={k === 'note' || k === 'discipline' ? 'span2' : ''}>
              {k === 'note' ? <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                : k === 'discipline' ? <Discipline value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />
                  : VOCABOLARI[k] ? <select value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                    <option value="">–</option>
                    {f[k] && !VOCABOLARI[k].includes(f[k]) && <option value={f[k]}>{f[k]} (valore importato)</option>}
                    {VOCABOLARI[k].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                    : k === 'gruppo' ? <><input list="hub-gruppi" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /><datalist id="hub-gruppi">{(gruppi || []).map((g) => <option key={g} value={g} />)}</datalist></>
                      : <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={k === 'fonte_censimento' ? 'sito, elenco, segnalazione…' : undefined} />}
            </Field>)}
          </div>
          <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setF(null)}>Annulla</button><button className="btn" onClick={salva}>Salva</button></div>
        </>}
      </Card>
      <Card title={a.n_sedi ? `Strutture del gruppo (${a.n_sedi})` : 'Strutture'} flush>
        {a.sedi?.length ? <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t"><tbody>{a.sedi.map((s) => <tr key={s.id_db}><td><div className="strong">{s.nome}</div><div className="small muted">ID {s.id_db} · {[s.tipologia, s.indirizzo, s.citta, s.prov && `(${s.prov})`].filter(Boolean).join(' · ')}</div><div className="small">{[s.email, s.pec && `PEC ${s.pec}`, s.telefono, s.referente && `Ref. ${s.referente}`].filter(Boolean).join(' · ')}</div></td><td className="small" style={{ whiteSpace: 'nowrap' }}>{s.fase}<div>{s.fatturato_fy_atteso ? eurK(s.fatturato_fy_atteso) : ''}</div></td></tr>)}</tbody></table></div>
          : <Empty>Una sola struttura: i suoi dati sono quelli della Legal entity.</Empty>}
        <div className="small muted" style={{ padding: '10px 14px' }}>Le strutture del gruppo non sono sedi dell'anagrafica finché non partono: alla contrattualizzazione nasce la sede SERVICE della Legal entity, e per le strutture attivate (fase 6 o 7, o punto del contratto firmato) una sede ciascuna con "Crea le sedi SERVICE mancanti" (Amministrazione &gt; Diagnostica anagrafica).</div>
      </Card>
    </div>
  );
}

// Codice StudioLAB del cliente (A7 (c), decisione 5 del CEO, 08/11/2026): lo inserisce chi gestisce la linea subito dopo la creazione del
// cliente. Si scrive nella sede SERVICE dell'anagrafica (letta da Ordini, NC e Retail); senza sede resta nell'account e passa alla sede
// quando nasce. Avviso non bloccante finché manca a un cliente attivo o contrattualizzato (elenco in Diagnostica anagrafica, D15c).
function CodiceStudiolab({ a, edit, onDone }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const cliente = Boolean(a.cliente_livello || a.contrattualizzato_at || a.cliente_attivo);
  const salva = async () => { try { await api.put(`/hub/accounts/${a.id}/studiolab`, { codice: v.trim() || null }); toast('Codice StudioLAB salvato'); setV(null); onDone(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className={`alert ${!a.codice_studiolab && cliente ? 'warn' : 'info'} small`} style={{ marginBottom: 12, display: 'block' }} data-testid="codice-studiolab">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
      <Icon name={!a.codice_studiolab && cliente ? 'alert' : 'scan'} size={18} />
      <span style={{ flex: 1 }}>
        <b>Codice StudioLAB:</b> {a.codice_studiolab ? <span className="mono strong">{a.codice_studiolab}</span> : <span>{cliente ? 'da inserire: Ordini, Non conformità e Retail riconoscono il cliente da questo codice' : 'non ancora indicato'}</span>}
        <span className="muted"> · {a.sede_service_id ? `sede SERVICE in anagrafica${a.sedi_service > 1 ? ` (${a.sedi_service})` : ''}` : 'nessuna sede SERVICE: nasce alla contrattualizzazione, il codice passerà a lei'}{a.cliente_livello ? ` · cliente ${a.cliente_livello === 'ATTIVO' ? 'attivo' : 'contrattualizzato'}` : ''}</span>
      </span>
      {edit && v === null && <button className="btn sm ghost" onClick={() => setV(a.codice_studiolab || '')}><Icon name="edit" />{a.codice_studiolab ? 'Modifica' : 'Inserisci'}</button>}
      {v !== null && <span className="row" style={{ gap: 6 }}><input value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder="es. 1234" aria-label="Codice StudioLAB" style={{ width: 140 }} autoFocus /><button className="btn sm" onClick={salva}>Salva</button><button className="btn sm ghost" onClick={() => setV(null)}>Annulla</button></span>}
      </div>
      {/* v0.68.5: sedi SERVICE con il loro codice e client del gestionale abbinati; "Abbina al cliente del gestionale" */}
      <ClientiGestionale a={a} edit={edit} onDone={onDone} />
    </div>
  );
}

// Discipline a scelta multipla (vocabolario DISCIPLINE); valori importati fuori elenco restano come voci aggiuntive finché non si tolgono.
function Discipline({ value, onChange }) {
  const sel = String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
  const extra = sel.filter((x) => !DISCIPLINE.includes(x));
  const toggle = (d) => onChange((sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d]).join(', '));
  return (
    <div className="chips-sel">
      {[...DISCIPLINE, ...extra].map((d) => <label key={d} className={`chip ${sel.includes(d) ? 'on' : ''}`}><input type="checkbox" checked={sel.includes(d)} onChange={() => toggle(d)} />{d}{extra.includes(d) ? ' (importata)' : ''}</label>)}
    </div>
  );
}
