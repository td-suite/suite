// Business Hub · Scheda account: intestazione (Legal entity, linea, fase con avanzamento, cliente attivo riservato al CEO/Admin, owner,
// prossima azione) e schede: Diario (con "Registra contatto"), Referenti, Criticità, Ordini, Non conformità, Ticket, Circolari,
// Portale, Contratti e Fascicoli (di cui), Documenti, Email (con "Scrivi al cliente" dalla casella della linea), Dati economici e
// commerciali (con le strutture del gruppo), Pacchetto di benvenuto (components/Pacchetto.jsx). Le sezioni degli altri widget sono in
// sola lettura.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import Pacchetto from '../components/Pacchetto.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, KindBadge, Modal, PromptModal, ConfirmModal, UploadButton, Icon, Empty, MoneyInput, useToast } from '../components/ui.jsx';
import {
  itDate, itDateTime, bytes, FASI, LINEE, PRIORITA, TIPO_ATTIVITA, ORIGINE_CRITICITA, GRAVITA, NC_STATO, ORDINE_STATO, EMAIL_STATO, DOSSIER_STATUS, FILE_CAT, eurK, pctSconto, num, today,
} from '../format.js';

const SCHEDE = [['diario', 'Diario'], ['referenti', 'Referenti'], ['criticita', 'Criticità'], ['ordini', 'Ordini'], ['nc', 'Non conformità'], ['ticket', 'Ticket'], ['circolari', 'Circolari'],
  ['portale', 'Portale'], ['contratti', 'Contratti'], ['fascicoli', 'Fascicoli'], ['documenti', 'Documenti'], ['email', 'Email'], ['pacchetto', 'Pacchetto di benvenuto'], ['economici', 'Dati economici'], ['commerciali', 'Dati commerciali']];

export default function Account() {
  const { id } = useParams();
  const toast = useToast();
  const q = useApi(`/hub/accounts/${id}`);
  const owners = useApi('/hub/utenti');
  const [tab, setTab] = useState('diario');
  const [modal, setModal] = useState(null);
  const a = q.data;
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!a) return <div className="page"><Loading /></div>;
  const edit = a.puo_modificare;
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); q.reload(); } catch (e) { toast(e.message, 'err'); } };
  const conta = { diario: a.attivita.length, referenti: a.contatti.length, criticita: a.criticita.filter((k) => !k.chiusa_at).length, contratti: a.contratti.length, fascicoli: a.fascicoli.length, documenti: a.documenti.length, email: a.attivita.filter((x) => x.tipo.startsWith('EMAIL')).length };
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
          <div className="sub">{[a.gruppo && a.gruppo !== a.org_name ? `Gruppo ${a.gruppo}` : null, a.tipologia, [a.org_address, a.citta, a.prov && `(${a.prov})`].filter(Boolean).join(' '), a.n_sedi ? `${a.n_sedi} strutture` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="row">
          {edit && <button className="btn" onClick={() => setModal({ t: 'contatto' })}><Icon name="plus" />Registra contatto</button>}
          {edit && <button className="btn dark" onClick={() => setModal({ t: 'email' })}><Icon name="mail" />Scrivi al cliente</button>}
          <a className="btn ghost" href="/admin/organizations" title="Anagrafica della Legal entity">Legal entity</a>
        </div>
      </div>

      <div className="steps hub">{FASI.slice(1).map((f) => { const d = a.phase_dates?.[f.n]; const cls = f.n < a.fase_corrente || (d && f.n <= a.fase_corrente) ? 'done' : ''; return <div key={f.n} className={`s ${cls} ${f.n === a.fase_corrente ? 'now' : ''}`}><i>{f.n}</i><span>{f.label}<small>{d ? itDate(d) : ''}</small></span></div>; })}</div>
      {a.fase_corrente === 6 && a.phase_dates?.[7] && !a.cliente_attivo && <div className="alert warn small" style={{ marginBottom: 12 }}>Il DB indica "Attivo / Starting" dal {itDate(a.phase_dates[7])}: la fase 7 vale solo quando il CEO conferma il cliente attivo.</div>}

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

      <div className="tabs scroll" style={{ marginTop: 16 }}>{SCHEDE.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{conta[k] ? <span className="tcount">{conta[k]}</span> : null}</button>)}</div>

      {tab === 'diario' && <Diario a={a} onChange={q.reload} />}
      {tab === 'referenti' && <Referenti a={a} onChange={q.reload} />}
      {tab === 'criticita' && <Criticita a={a} onChange={q.reload} />}
      {tab === 'ordini' && <FeedOrdini a={a} />}
      {tab === 'nc' && <FeedNc a={a} />}
      {tab === 'ticket' && <FeedTicket a={a} />}
      {tab === 'circolari' && <FeedCircolari a={a} />}
      {tab === 'portale' && <FeedPortale a={a} />}
      {tab === 'contratti' && <Contratti a={a} />}
      {tab === 'fascicoli' && <Fascicoli a={a} />}
      {tab === 'documenti' && <Documenti a={a} onChange={q.reload} />}
      {tab === 'email' && <Email a={a} onScrivi={() => setModal({ t: 'email' })} />}
      {tab === 'pacchetto' && <Pacchetto a={a} onChange={q.reload} />}
      {tab === 'economici' && <Economici a={a} onChange={q.reload} />}
      {tab === 'commerciali' && <Commerciali a={a} onChange={q.reload} />}

      {modal?.t === 'contatto' && <Composer a={a} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); setTab('diario'); }} />}
      {modal?.t === 'email' && <ScriviCliente a={a} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); setTab('email'); }} />}
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
            <Badge tone={x.tipo === 'SISTEMA' ? 'grey' : x.tipo === 'CRITICITA' ? 'red' : x.tipo.startsWith('EMAIL') ? 'teal' : x.tipo === 'PACCHETTO' ? 'mauve' : 'blue'}>{TIPO_ATTIVITA[x.tipo]}</Badge>
            <span className="strong">{x.oggetto || ''}</span>
            {x.esito && <Badge tone={x.esito === 'DA_CONFERMARE' || x.esito === 'DA_VERIFICARE' ? 'mauve' : x.esito === 'FALLITO' ? 'red' : 'grey'}>{x.esito.replace(/_/g, ' ').toLowerCase()}</Badge>}
            <span className="spacer" />
            <span className="small muted">{itDateTime(x.at)}{x.user_name ? ` · ${x.user_name}` : ''}</span>
            {['CHIAMATA', 'INCONTRO', 'SOPRALLUOGO', 'NOTA', 'OFFERTA'].includes(x.tipo) && a.puo_modificare && <button className="iconbtn" title="Elimina" onClick={() => setDel(x)}><Icon name="trash" /></button>}
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
  const salva = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      const c = a.contatti.find((x) => String(x.id) === String(f.contatto_id));
      for (const [k, v] of Object.entries({ ...f, at: f.at ? new Date(f.at).toISOString() : '', con_chi: f.con_chi || (c ? `${c.nome}${c.ruolo ? ` (${c.ruolo})` : ''}` : '') })) fd.append(k, v ?? '');
      for (const x of files) fd.append('files', x);
      await api.upload(`/hub/accounts/${a.id}/attivita`, fd); toast('Contatto registrato nel diario'); onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Registra contatto · ${a.org_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={salva}>Registra nel diario</button></>}>
      <div className="form-grid">
        <Field label="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{['CHIAMATA', 'INCONTRO', 'SOPRALLUOGO', 'OFFERTA', 'NOTA', 'EMAIL_IN', 'EMAIL_OUT'].map((k) => <option key={k} value={k}>{TIPO_ATTIVITA[k]}{k.startsWith('EMAIL') ? ' (registrata a mano)' : ''}</option>)}</select></Field>
        <Field label="Quando"><input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
        <Field label="Con chi (referente)"><select value={f.contatto_id} onChange={(e) => setF({ ...f, contatto_id: e.target.value })}><option value="">Altro / non in elenco</option>{a.contatti.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ruolo ? ` · ${c.ruolo}` : ''}</option>)}</select></Field>
        {!f.contatto_id && <Field label="Con chi (testo)"><input value={f.con_chi} onChange={(e) => setF({ ...f, con_chi: e.target.value })} placeholder="Nome e ruolo" /></Field>}
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
function Referenti({ a, onChange }) {
  const toast = useToast();
  const [m, setM] = useState(null);
  const salva = async () => { try { if (m.id) await api.put(`/hub/contatti/${m.id}`, m); else await api.post(`/hub/accounts/${a.id}/contatti`, m); toast('Referente salvato'); setM(null); onChange(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="grid g2">
      <Card title="Referenti del cliente" actions={a.puo_modificare && <button className="btn sm" onClick={() => setM({ nome: '', ruolo: '', email: '', telefono: '', principale: false, note: '' })}>+ Referente</button>} flush>
        {a.contatti.length ? <table className="t"><tbody>{a.contatti.map((c) => <tr key={c.id}>
          <td><div className="strong">{c.nome}{c.principale ? <Badge tone="teal">principale</Badge> : null}</div><div className="small muted">{[c.ruolo, c.person_id ? 'in Persone' : null, c.fonte === 'DB_OPPORTUNITA' ? 'dal DB Opportunità' : c.fonte === 'EMAIL' ? 'da email' : null].filter(Boolean).join(' · ')}</div></td>
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
          <Field label="Nome e cognome" className="span2"><input value={m.nome} onChange={(e) => setM({ ...m, nome: e.target.value })} autoFocus /></Field>
          <Field label="Ruolo"><input value={m.ruolo || ''} onChange={(e) => setM({ ...m, ruolo: e.target.value })} /></Field>
          <Field label="Email"><input value={m.email || ''} onChange={(e) => setM({ ...m, email: e.target.value })} /></Field>
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
const NonAttivo = ({ nome }) => <Card><Empty>Widget {nome} non attivo: avvialo in Amministrazione &gt; Travaso moduli.</Empty></Card>;
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
function FeedPortale({ a }) {
  const f = useFeed(a, 'portale');
  if (!f.data) return f.error ? <ErrorBox error={f.error} /> : <Loading />;
  return (
    <Card title="Accessi esterni della Legal entity al Portale" flush>
      {f.data.righe.length ? <table className="t"><thead><tr><th>Utente</th><th>Stato</th><th>Ultimo accesso</th><th>Ultima consultazione</th></tr></thead><tbody>
        {f.data.righe.map((u) => <tr key={u.id}><td><div className="strong">{u.full_name}</div><div className="small muted">{u.email}</div></td><td className="small">{u.status}</td><td className="small">{u.last_login_at ? itDateTime(u.last_login_at) : <span className="muted">mai</span>}</td><td className="small">{u.ultima_lettura ? itDateTime(u.ultima_lettura) : '–'}</td></tr>)}
      </tbody></table> : <Empty>Nessun accesso esterno: si crea dalla scheda Legal entity in Amministrazione.</Empty>}
    </Card>
  );
}

// ---------------- Contratti e fascicoli (di cui) ----------------
function Contratti({ a }) {
  const nav = useNavigate();
  return (
    <Card title="Contratti della Legal entity (di cui)" flush actions={<Link className="btn sm" to={`${BASE}/contratti/nuovo/${a.linea}`}>+ Proposta {LINEE[a.linea].short}</Link>}>
      {a.contratti.length ? <table className="t"><thead><tr><th>Protocollo</th><th>Sezione</th><th>Titolo</th><th>Stato</th><th>Proposta</th><th>Firma</th><th className="num">Versione</th></tr></thead><tbody>
        {a.contratti.map((c) => <tr key={c.id} className="click" onClick={() => nav(`${BASE}/contratti/${c.id}`)}><td className="mono">{c.protocol || 'bozza'}</td><td><KindBadge kind={c.kind} /></td><td>{c.title}{c.site_name ? <div className="small muted">{c.site_name}</div> : null}</td><td><StatusBadge status={c.status} /></td><td className="small">{itDate(c.proposal_date)}</td><td className="small">{itDate(c.signed_at) || '–'}</td><td className="num">v{c.version}</td></tr>)}
      </tbody></table> : <Empty>Nessun contratto con questa Legal entity</Empty>}
    </Card>
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
function Documenti({ a, onChange }) {
  const toast = useToast();
  const up = async (l) => { try { const fd = new FormData(); fd.append('categoria', 'ALTRO'); for (const x of l) fd.append('files', x); await api.upload(`/hub/accounts/${a.id}/documenti`, fd); toast('Documenti caricati'); onChange(); } catch (e) { toast(e.message, 'err'); } };
  const cf = a.contratti.flatMap((c) => (c.files || []).map((f) => ({ ...f, c })));
  return (
    <div className="grid g2">
      <Card title="Documenti dell'account" actions={a.puo_modificare && <UploadButton label="Carica" multiple onFiles={up} />} flush>
        {a.documenti.length ? <table className="t"><tbody>{a.documenti.map((d) => <tr key={d.id}><td><a href={`${API_BASE}/hub/documenti/${d.id}`}><Icon name="download" />{d.filename}</a><div className="small muted">{d.categoria === 'EMAIL' ? 'allegato di un\'email ricevuta' : d.categoria === 'ALLEGATO' ? 'allegato del diario' : d.categoria === 'PACCHETTO' ? 'pacchetto di benvenuto' : d.categoria.toLowerCase()} · {bytes(d.size)} · {itDateTime(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</div></td>
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

function ScriviCliente({ a, onClose, onDone }) {
  const toast = useToast();
  const conEmail = a.contatti.filter((c) => c.email);
  const [f, setF] = useState({ to: conEmail.filter((c) => c.principale).map((c) => c.email), altri: '', cc_extra: '', subject: '', testo: '', documenti: [], contract_files: [] });
  const [riep, setRiep] = useState(null);
  const [busy, setBusy] = useState(false);
  const cf = useMemo(() => a.contratti.flatMap((c) => (c.files || []).map((x) => ({ ...x, c }))), [a]);
  const body = () => ({ to: [...f.to, ...f.altri.split(/[,;\s]+/).filter(Boolean)], cc_extra: f.cc_extra.split(/[,;\s]+/).filter(Boolean), subject: f.subject, testo: f.testo, documenti: f.documenti, contract_files: f.contract_files });
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const anteprima = async () => { setBusy(true); try { setRiep(await api.post(`/hub/accounts/${a.id}/email/anteprima`, body())); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const invia = async () => { setBusy(true); try { const r = await api.post(`/hub/accounts/${a.id}/email/invia`, { ...body(), conferma: true }); toast(r.stato === 'FALLITO' ? `Invio non riuscito: ${r.errore}` : r.stato === 'REGISTRATO' ? 'Email registrata (posta in modalità registro)' : 'Email inviata e registrata nel diario', r.stato === 'FALLITO' ? 'err' : 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  if (riep) return (
    <Modal wide title="Conferma l'invio" onClose={onClose} footer={<><button className="btn ghost" onClick={() => setRiep(null)}>Torna al messaggio</button><button className="btn" disabled={busy} onClick={invia}><Icon name="mail" />{busy ? 'Invio…' : 'Conferma e invia'}</button></>}>
      <table className="t"><tbody>
        <tr><td className="muted">Mittente</td><td className="strong">{riep.from}</td></tr>
        <tr><td className="muted">Destinatari</td><td>{riep.to.join(', ')}</td></tr>
        <tr><td className="muted">Copie fisse (sempre presenti)</td><td>{riep.cc_fissi.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Copie</td><td>{riep.cc.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Oggetto</td><td>{riep.subject}</td></tr>
        <tr><td className="muted">Allegati</td><td>{riep.allegati.length ? riep.allegati.map((x) => `${x.filename} (${bytes(x.size)})`).join(', ') : 'nessuno'}</td></tr>
      </tbody></table>
      {riep.avvisi.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>{riep.avvisi.join(' · ')}</div>}
      <div className="small muted" style={{ marginTop: 10 }}>L'email resta nel diario dell'account con l'esito dell'invio e nel registro invii.</div>
    </Modal>
  );
  return (
    <Modal wide title={`Scrivi al cliente · da ${a.casella}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={anteprima}>Riepilogo prima dell'invio</button></>}>
      <div className="form-grid">
        <div className="span2"><div className="small strong muted">Destinatari dai referenti</div>{conEmail.length ? conEmail.map((c) => <label key={c.id} className="f inline"><input type="checkbox" checked={f.to.includes(c.email)} onChange={() => toggle('to', c.email)} />{c.nome} · {c.email}</label>) : <div className="small muted">Nessun referente con email: aggiungilo in Referenti o scrivi l'indirizzo qui sotto.</div>}</div>
        <Field label="Altri destinatari"><input value={f.altri} onChange={(e) => setF({ ...f, altri: e.target.value })} placeholder="indirizzi separati da virgola" /></Field>
        <Field label="Altre copie (oltre a quelle fisse)"><input value={f.cc_extra} onChange={(e) => setF({ ...f, cc_extra: e.target.value })} /></Field>
        <Field label="Oggetto" className="span2"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Testo" className="span2"><textarea style={{ minHeight: 180 }} value={f.testo} onChange={(e) => setF({ ...f, testo: e.target.value })} /></Field>
        {(a.documenti.length > 0 || cf.length > 0) && <div className="span2"><div className="small strong muted">Allegati</div>
          {a.documenti.map((d) => <label key={`d${d.id}`} className="f inline"><input type="checkbox" checked={f.documenti.includes(d.id)} onChange={() => toggle('documenti', d.id)} />{d.filename} <span className="small muted">({bytes(d.size)}, documenti dell'account)</span></label>)}
          {cf.map((x) => <label key={`c${x.id}`} className="f inline"><input type="checkbox" checked={f.contract_files.includes(x.id)} onChange={() => toggle('contract_files', x.id)} />{x.filename} <span className="small muted">({bytes(x.size)}, {x.c.protocol || x.c.title})</span></label>)}
        </div>}
      </div>
    </Modal>
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
            {COMM.map(([k, l]) => <Field key={k} label={l} className={k === 'note' ? 'span2' : ''}>{k === 'note' ? <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
          </div>
          <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setF(null)}>Annulla</button><button className="btn" onClick={salva}>Salva</button></div>
        </>}
      </Card>
      <Card title={a.n_sedi ? `Strutture del gruppo (${a.n_sedi})` : 'Strutture'} flush>
        {a.sedi?.length ? <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t"><tbody>{a.sedi.map((s) => <tr key={s.id_db}><td><div className="strong">{s.nome}</div><div className="small muted">ID {s.id_db} · {[s.tipologia, s.indirizzo, s.citta, s.prov && `(${s.prov})`].filter(Boolean).join(' · ')}</div><div className="small">{[s.email, s.pec && `PEC ${s.pec}`, s.telefono, s.referente && `Ref. ${s.referente}`].filter(Boolean).join(' · ')}</div></td><td className="small" style={{ whiteSpace: 'nowrap' }}>{s.fase}<div>{s.fatturato_fy_atteso ? eurK(s.fatturato_fy_atteso) : ''}</div></td></tr>)}</tbody></table></div>
          : <Empty>Una sola struttura: i suoi dati sono quelli della Legal entity.</Empty>}
        <div className="small muted" style={{ padding: '10px 14px' }}>Le strutture del gruppo non sono sedi dell'anagrafica: diventano sedi (Amministrazione &gt; Sedi, tipo Service) quando partono davvero.</div>
      </Card>
    </div>
  );
}
