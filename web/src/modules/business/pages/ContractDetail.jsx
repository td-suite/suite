import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, canEditKind, isAdmin } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, StatusBadge, KindBadge, Modal, PromptModal, ConfirmModal, UploadButton, Icon, useToast } from '../components/ui.jsx';
import { itDate, itDateTime, bytes, KIND, FILE_CAT, EVENT, DOSSIER_STATUS, FEE_VAT, FEE_PERIOD, FEE_BASE, DAYS, today, num, HAS_DOSSIER, SITE_TYPE, RENT_PERIOD } from '../format.js';

export default function ContractDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const q = useApi(`/contracts/${id}`);
  const c = q.data;
  const [modal, setModal] = useState(null);
  const [signedDate, setSignedDate] = useState(today());
  const [pdfErr, setPdfErr] = useState(null);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!c) return <div className="page"><Loading /></div>;
  const edit = canEditKind(user, c.kind);
  const editable = ['BOZZA', 'PROPOSTA'].includes(c.status);
  const d = c.data || {}; const p = c.partner;
  const files = (cat) => c.files.filter((f) => f.category === cat);
  const act = async (fn, msg) => { try { const r = await fn(); if (r?.pdfError) setPdfErr(r.pdfError); q.reload(); if (msg) toast(msg); } catch (e) { toast(e.message, 'err'); } };
  const uploadFiles = (category, list, extra = {}) => act(async () => { const fd = new FormData(); fd.append('category', category); for (const [k, v] of Object.entries(extra)) fd.append(k, v); for (const f of list) fd.append('files', f); return api.upload(`/contracts/${c.id}/files`, fd); }, 'File caricati');
  const steps = c.kind === 'PP' ? ['BOZZA', 'PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO'] : c.kind === 'SEDE' ? ['BOZZA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO'] : ['BOZZA', 'PROPOSTA', 'FIRMATO', 'ATTIVO'];
  const stepIdx = steps.indexOf(c.status);
  const genDocx = files('GENERATO_DOCX')[0]; const genPdf = files('GENERATO_PDF')[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><KindBadge kind={c.kind} /><StatusBadge status={c.status} />{c.protocol && <span className="mono">{c.protocol} · v{c.version}</span>}</div>
          <h1>{c.title || p.name}</h1>
          <div className="sub">{p.name} · {[p.street, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')} · {c.kind === 'SEDE' ? 'contratto del' : 'proposta del'} {itDate(c.proposal_date)}{c.signed_at ? ` · firmato il ${itDate(c.signed_at)}` : ''}</div>
        </div>
        <div className="row">
          {edit && editable && <Link className="btn ghost" to={`${BASE}/contratti/${c.id}/modifica`}><Icon name="edit" />Modifica</Link>}
          {edit && editable && c.kind !== 'SEDE' && <button className="btn" onClick={() => act(() => api.post(`/contracts/${c.id}/generate`), c.protocol ? 'Documento rigenerato' : 'Proposta protocollata e generata')}><Icon name="file" />{c.protocol ? 'Rigenera DOCX e PDF' : 'Genera proposta (DOCX e PDF)'}</button>}
          {HAS_DOSSIER(c.kind) && <Link className="btn dark" to={`${BASE}/contratti/${c.id}/fascicolo`}><Icon name="folder" />Fascicolo autorizzazione</Link>}
        </div>
      </div>

      <div className="steps">{steps.map((s, i) => <div key={s} className={`s ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'now' : ''}`}><i>{i + 1}</i>{{ BOZZA: 'Bozza', PROPOSTA: 'Proposta generata', FIRMATO: c.kind === 'SEDE' ? 'Contratto di locazione firmato' : 'Sottoscritto', AUTORIZZATO: 'Autorizzazione sanitaria', ATTIVO: 'Attivo' }[s]}</div>)}{['CESSATO', 'ANNULLATO'].includes(c.status) && <div className="s now"><i>!</i>{c.status === 'CESSATO' ? 'Cessato' : 'Annullato'}{c.cancel_reason ? `: ${c.cancel_reason}` : ''}</div>}</div>
      {pdfErr && <div className="alert warn" style={{ marginBottom: 14 }}>PDF non prodotto: {pdfErr}. Il DOCX è disponibile.</div>}

      <div className="grid g2">
        {c.kind === 'SEDE' ? (
          <Card title="Planimetrie e assicurazioni" actions={edit && <div className="row" style={{ gap: 6 }}><UploadButton label="Planimetria" multiple onFiles={(fl) => uploadFiles('PLANIMETRIA', fl)} /><UploadButton label="Assicurazione" multiple onFiles={(fl) => uploadFiles('ASSICURAZIONE', fl)} /></div>}>
            {[...files('PLANIMETRIA'), ...files('ASSICURAZIONE')].length ? [...files('PLANIMETRIA'), ...files('ASSICURAZIONE')].map((f) => <div key={f.id} className="row" style={{ marginBottom: 6 }}><Badge tone={f.category === 'PLANIMETRIA' ? 'blue' : 'mauve'}>{FILE_CAT[f.category]}</Badge><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)} · {itDateTime(f.created_at)}</span>{edit && <button className="iconbtn" title="Rimuovi" onClick={() => setModal({ type: 'delfile', f })}><Icon name="trash" /></button>}</div>)
              : <div className="muted">Planimetrie dei locali e polizze (RCT/RCO, incendio, cyber) relative alla sede.</div>}
          </Card>
        ) : <Card title="Documento della proposta" actions={genPdf && <a className="btn sm ghost" href={`${API_BASE}/contract-files/${genPdf.id}?inline=1`} target="_blank" rel="noreferrer"><Icon name="eye" />Anteprima PDF</a>}>
          {genDocx || genPdf ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[genDocx, genPdf].filter(Boolean).map((f) => <div key={f.id} className="row"><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)} · {itDateTime(f.created_at)}</span></div>)}
              <div className="small muted">Documento generato dal format aziendale con i dati della scheda. Si stampa, si firma con il partner e si carica qui sotto la copia sottoscritta. Ogni rigenerazione sostituisce la versione precedente (v{c.version}).</div>
            </div>
          ) : <div className="muted">Nessun documento ancora generato. {edit ? 'Completa i dati e premi "Genera proposta".' : ''}</div>}
        </Card>}
        <Card title={c.kind === 'SEDE' ? 'Contratto di locazione' : 'Contratto sottoscritto'} actions={edit && (c.status !== 'BOZZA' || c.kind === 'SEDE') && <div className="row" style={{ gap: 6 }}><input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} style={{ height: 30, width: 150 }} title="Data di sottoscrizione" /><UploadButton label="Carica firmato (PDF)" accept="application/pdf" onFiles={(fl) => uploadFiles('FIRMATO', fl, { signed_at: signedDate })} /></div>}>
          {files('FIRMATO').length ? files('FIRMATO').map((f) => <div key={f.id} className="row" style={{ marginBottom: 6 }}><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)} · {f.uploaded_by_name} · {itDateTime(f.created_at)}</span>{isAdmin(user) && <button className="iconbtn" title="Rimuovi" onClick={() => setModal({ type: 'delfile', f })}><Icon name="trash" /></button>}</div>)
            : <div className="muted">{c.kind === 'SEDE' ? 'Carica il contratto di locazione firmato (PDF): la sede passa in stato Firmato e riceve il protocollo.' : c.status === 'BOZZA' ? 'Genera prima la proposta.' : 'Copia firmata non ancora caricata. Caricandola il contratto passa in stato Firmato.'}</div>}
          {c.status === 'FIRMATO' && HAS_DOSSIER(c.kind) && c.dossier && <div className="alert info small" style={{ marginTop: 10 }}>Fascicolo di autorizzazione: <Badge tone={DOSSIER_STATUS[c.dossier.status].tone}>{DOSSIER_STATUS[c.dossier.status].label}</Badge>. Il contratto diventa attivo dopo l'autorizzazione sanitaria del Comune.</div>}
          {edit && ['FIRMATO', 'AUTORIZZATO'].includes(c.status) && <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={() => act(() => api.post(`/contracts/${c.id}/status`, { status: 'ATTIVO' }), 'Contratto attivo')}>Segna come attivo</button></div>}
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={c.kind === 'SEDE' ? 'Dati della locazione' : 'Dati della proposta'}>
          {c.kind === 'PP' && <table className="t"><tbody>
            <tr><td className="muted">Sede del Poliambulatorio / Punto Prelievi</td><td className="strong">{d.site?.street}, {d.site?.zip} {d.site?.city} ({d.site?.prov})</td></tr>
            <tr><td className="muted">Corrispettivo</td><td>{(d.fee?.items || []).length ? (d.fee.items.map((it, i) => <div key={i} className="small">5.1.{i + 1} {it.kind === 'PERCENT' ? `${num(it.percent)}% ${FEE_VAT[it.vat]} sul ${it.base === 'ALTRO' ? it.base_other : FEE_BASE[it.base]}${it.include_ssr ? ' (incluso SSR)' : ''}` : it.kind === 'TEXT' ? it.text : `${it.kind === 'MINIMUM' ? 'minimo garantito ' : ''}${num(it.amount)} € ${FEE_VAT[it.vat]} ${FEE_PERIOD[it.period]}${it.purpose ? ` ${it.purpose}` : ''}`}</div>)) : 'da definire'}</td></tr>
            <tr><td className="muted">Durata</td><td>{d.duration_years} anni dal {c.start_date ? itDate(c.start_date) : 'data da definire'}, rinnovo tacito annuale, recesso con 6 mesi di preavviso</td></tr>
            <tr><td className="muted">Comune di esclusiva</td><td>{d.site?.city}</td></tr>
            <tr><td className="muted">Servizi</td><td>infermieristico: {(d.services?.nursing || 'TD') === 'TD' ? 'Toscana Diagnostica' : 'struttura ospitante'} · accettazione e incassi: {(d.services?.reception || 'HOST') === 'HOST' ? 'struttura ospitante' : 'Toscana Diagnostica'}</td></tr>
          </tbody></table>}
          {c.kind === 'SRV' && <table className="t"><tbody>
            <tr><td className="muted">Sede operativa</td><td className="strong">{d.site_name || p.name}<div className="small muted">{d.site_address || [p.street, p.city].filter(Boolean).join(', ')}</div></td></tr>
            <tr><td className="muted">Direttore Sanitario del cliente</td><td>{d.client_ds || <span className="red">da indicare</span>}</td></tr>
            <tr><td className="muted">Listino</td><td>{d.price_list_file || <span className="red">non caricato</span>}</td></tr>
            <tr><td className="muted">Esenzione IVA art. 10</td><td>{d.vat_exemption === true ? 'esente' : d.vat_exemption === false ? 'imponibile' : 'da dichiarare'}</td></tr>
            <tr><td className="muted">Interfacciamento</td><td>{d.interface_solution ? `Soluzione ${d.interface_solution}` : '–'}</td></tr>
            <tr><td className="muted">Ritiri</td><td className="small">{d.pickup?.site} {d.pickup?.street ? `· ${d.pickup.street}, ${d.pickup.city}` : ''} {d.pickup?.contact ? `· ${d.pickup.contact}` : ''}<div>{DAYS.slice(0, 6).map((day, i) => { const x = d.pickup?.days?.[i]; return x && x.mode !== 'NO' ? `${day.slice(0, 3)} ${x.mode === 'FISSO' ? 'fisso' : 'a chiamata'}${x.time_from ? ` ${x.time_from}${x.time_to ? `-${x.time_to}` : ''}` : ''}` : null; }).filter(Boolean).join(' · ') || 'da definire'}</div></td></tr>
            <tr><td className="muted">Privacy</td><td>{d.privacy?.role === 'TITOLARE' ? 'Titolare del trattamento' : d.privacy?.role === 'RESPONSABILE' ? `Responsabile per conto di ${d.privacy.principal || '–'}` : 'da indicare'}{d.privacy?.dpo_name ? ` · DPO ${d.privacy.dpo_name} (${d.privacy.dpo_contact || ''})` : ''}</td></tr>
          </tbody></table>}
          {c.kind === 'SEDE' && <table className="t"><tbody>
            <tr><td className="muted">Sede</td><td className="strong">{SITE_TYPE[d.site_type]} · {d.site?.street}, {d.site?.zip} {d.site?.city} ({d.site?.prov})</td></tr>
            <tr><td className="muted">Canone</td><td>{d.rent?.amount != null ? `${num(d.rent.amount)} € ${RENT_PERIOD[d.rent.period]} ${FEE_VAT[d.rent.vat]}` : 'da indicare'}{d.rent?.istat ? ' · aggiornamento ISTAT' : ''}</td></tr>
            <tr><td className="muted">Deposito cauzionale</td><td>{d.rent?.deposit != null ? `${num(d.rent.deposit)} €` : '–'}</td></tr>
            <tr><td className="muted">Durata</td><td>{d.rent?.duration_years || '–'} anni{d.rent?.renewal_years ? ` + ${d.rent.renewal_years} di rinnovo` : ''}{d.rent?.notice_months ? ` · disdetta con ${d.rent.notice_months} mesi di preavviso` : ''} · dal {c.start_date ? itDate(c.start_date) : 'data da definire'}</td></tr>
            <tr><td className="muted">Spese e oneri</td><td>{d.rent?.expenses || '–'}</td></tr>
            <tr><td className="muted">Registrazione</td><td>{d.rent?.registration || '–'}</td></tr>
            {d.rent?.notes && <tr><td className="muted">Note</td><td className="small">{d.rent.notes}</td></tr>}
          </tbody></table>}
          {c.kind === 'MDL' && <table className="t"><tbody>
            <tr><td className="muted">Riferimento appuntamenti</td><td>{d.service_contact || '–'} · {d.service_email || '–'} · {d.service_phone || '–'}</td></tr>
            <tr><td className="muted">Fatture</td><td>{d.invoice_email || p.pec || '–'} · SDI {p.sdi || '–'}</td></tr>
            <tr><td className="muted">Medico del Lavoro</td><td>{d.doctor_name || '–'} · {d.doctor_email || '–'}</td></tr>
            <tr><td className="muted">Esenzione IVA art. 10</td><td>{d.vat_exemption === true ? 'esente' : d.vat_exemption === false ? 'imponibile' : 'da dichiarare'}</td></tr>
            <tr><td className="muted">Privacy</td><td>{d.privacy?.role === 'TITOLARE' ? 'Titolare del trattamento' : d.privacy?.role === 'RESPONSABILE' ? `Responsabile per conto di ${d.privacy.principal || '–'}` : 'da indicare'}</td></tr>
          </tbody></table>}
          {c.notes && <div className="small muted" style={{ marginTop: 8 }}>Note: {c.notes}</div>}
        </Card>
        <Card title={c.kind === 'SEDE' ? 'Anagrafica del locatore (MOD173)' : 'Anagrafica del partner (MOD173)'} actions={<Link className="btn sm ghost" to={`${BASE}/partner`}>Apri anagrafica</Link>}>
          <table className="t"><tbody>
            <tr><td className="muted">Ragione sociale</td><td className="strong">{p.name}</td></tr>
            <tr><td className="muted">P.IVA / C.F.</td><td className="mono">{p.vat || '–'} / {p.tax_code || p.vat || '–'}</td></tr>
            <tr><td className="muted">Sede</td><td>{[p.street, p.zip, p.city, p.prov ? `(${p.prov})` : ''].filter(Boolean).join(', ')}</td></tr>
            <tr><td className="muted">Legale rappresentante / firmatario</td><td>{p.legal_rep || '–'}{p.signer ? ` / ${p.signer}${p.signer_role ? ` (${p.signer_role})` : ''}` : ''}</td></tr>
            <tr><td className="muted">PEC · SDI · e-mail</td><td className="small">{p.pec || '–'} · {p.sdi || '–'} · {p.email || '–'}</td></tr>
            <tr><td className="muted">Gestione del servizio</td><td className="small">{p.svc_contact || '–'} {p.svc_email ? `· ${p.svc_email}` : ''} {p.svc_mobile ? `· ${p.svc_mobile}` : ''}</td></tr>
            <tr><td className="muted">Approvvigionamento</td><td className="small">{p.proc_contact || '–'} {p.proc_email ? `· ${p.proc_email}` : ''} {p.proc_mobile ? `· ${p.proc_mobile}` : ''}</td></tr>
            <tr><td className="muted">Pagamento</td><td className="small">{p.pay_method || '–'} {p.pay_terms ? `· ${p.pay_terms}` : ''} {p.bank_name ? `· ${p.bank_name}` : ''} {p.iban ? <span className="mono">{p.iban}</span> : ''}</td></tr>
          </tbody></table>
        </Card>
      </div>

      {['SRV', 'MDL'].includes(c.kind) && (
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Listino dell'offerta" actions={edit && <div className="row" style={{ gap: 6 }}><UploadButton label="XLSX" accept=".xlsx,.xls" onFiles={(fl) => uploadFiles('LISTINO_XLSX', fl)} /><UploadButton label="PDF" accept="application/pdf" onFiles={(fl) => uploadFiles('LISTINO_PDF', fl)} /></div>}>
            {[...files('LISTINO_XLSX'), ...files('LISTINO_PDF')].length ? [...files('LISTINO_XLSX'), ...files('LISTINO_PDF')].map((f) => <div key={f.id} className="row" style={{ marginBottom: 6 }}><Badge tone={f.category === 'LISTINO_XLSX' ? 'green' : 'blue'}>{f.category === 'LISTINO_XLSX' ? 'XLSX' : 'PDF'}</Badge><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)} · {itDateTime(f.created_at)}</span>{edit && <button className="iconbtn" title="Rimuovi" onClick={() => setModal({ type: 'delfile', f })}><Icon name="trash" /></button>}</div>)
              : <div className="muted">Carica il listino dell'offerta in XLSX (per il cliente e il gestionale) e in PDF (allegato alla proposta).</div>}
          </Card>
          <Credentials c={c} edit={edit} onSaved={() => q.reload()} />
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Altri documenti" actions={edit && <UploadButton label="Carica" multiple onFiles={(fl) => uploadFiles('ALTRO', fl)} />}>
          {files('ALTRO').length ? files('ALTRO').map((f) => <div key={f.id} className="row" style={{ marginBottom: 6 }}><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)} · {itDateTime(f.created_at)}</span>{edit && <button className="iconbtn" title="Rimuovi" onClick={() => setModal({ type: 'delfile', f })}><Icon name="trash" /></button>}</div>) : <div className="muted">Visure, polizze, corrispondenza, integrazioni.</div>}
        </Card>
        <Card title="Cronologia">
          <ul className="timeline">{c.events.map((e) => <li key={e.id}><div className="ev">{EVENT[e.kind] || e.kind}</div><div className="small muted">{itDateTime(e.at)} · {e.user_name || 'sistema'}{e.note ? ` · ${e.note}` : ''}</div></li>)}</ul>
        </Card>
      </div>

      {edit && <div className="row end" style={{ marginTop: 18 }}>
        {c.status === 'BOZZA' && <button className="btn danger" onClick={() => setModal({ type: 'delete' })}>Elimina bozza</button>}
        {['PROPOSTA', 'FIRMATO', 'AUTORIZZATO', 'ATTIVO'].includes(c.status) && <button className="btn danger" onClick={() => setModal({ type: 'cancel' })}>Annulla contratto</button>}
        {['FIRMATO', 'AUTORIZZATO', 'ATTIVO'].includes(c.status) && <button className="btn ghost" onClick={() => setModal({ type: 'cease' })}>Cessazione</button>}
      </div>}

      {modal?.type === 'delfile' && <ConfirmModal danger title="Rimuovi file" text={`Rimuovere ${modal.f.filename}?`} confirmText="Rimuovi" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/contracts/${c.id}/files/${modal.f.id}`); q.reload(); }} />}
      {modal?.type === 'delete' && <ConfirmModal danger title="Elimina bozza" text="La bozza e i file collegati verranno eliminati." confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/contracts/${c.id}`); nav(`${BASE}/${KIND[c.kind].path}`); }} />}
      {modal?.type === 'cancel' && <PromptModal danger title="Annulla contratto" label="Motivazione" confirmText="Annulla contratto" onClose={() => setModal(null)} onConfirm={async (reason) => { await api.post(`/contracts/${c.id}/status`, { status: 'ANNULLATO', reason }); q.reload(); }} />}
      {modal?.type === 'cease' && <PromptModal title="Cessazione del contratto" label="Motivazione (recesso, disdetta, risoluzione) e data di efficacia" confirmText="Registra cessazione" onClose={() => setModal(null)} onConfirm={async (reason) => { await api.post(`/contracts/${c.id}/status`, { status: 'CESSATO', reason }); q.reload(); }} />}
    </div>
  );
}

function Credentials({ c, edit, onSaved }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [f, setF] = useState(null);
  const cred = c.credentials;
  const reveal = async () => { try { const r = await api.get(`/contracts/${c.id}/credentials?reveal=1`); setRevealed(r.password || ''); } catch (e) { toast(e.message, 'err'); } };
  const save = async () => { try { await api.put(`/contracts/${c.id}/credentials`, { portal_url: f.portal_url, username: f.username, password: f.password || null, notes: f.notes }); setOpen(false); setRevealed(null); onSaved(); toast('Credenziali salvate'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Credenziali di accesso al portale" actions={edit && <button className="btn sm ghost" onClick={() => { setF({ portal_url: cred?.portal_url || '', username: cred?.username || '', password: '', notes: cred?.notes || '' }); setOpen(true); }}>{cred ? 'Modifica' : '+ Inserisci'}</button>}>
      {cred ? (
        <table className="t"><tbody>
          <tr><td className="muted">Portale</td><td>{cred.portal_url ? <a href={cred.portal_url} target="_blank" rel="noreferrer">{cred.portal_url}</a> : '–'}</td></tr>
          <tr><td className="muted">Utente</td><td className="mono">{cred.username || '–'}</td></tr>
          <tr><td className="muted">Password</td><td>{revealed != null ? <span className="mono">{revealed || '(vuota)'}</span> : cred.has_password ? '••••••••' : <span className="muted">non impostata</span>} {edit && cred.has_password && revealed == null && <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={reveal}><Icon name="eye" />Mostra</button>}</td></tr>
          {cred.notes && <tr><td className="muted">Note</td><td className="small">{cred.notes}</td></tr>}
          <tr><td className="muted">Aggiornate</td><td className="small">{itDateTime(cred.updated_at)}</td></tr>
        </tbody></table>
      ) : <div className="muted">Credenziali del portale (accettazione richieste e download referti) consegnate al cliente. La password è conservata cifrata e ogni visualizzazione viene registrata.</div>}
      {open && <Modal title="Credenziali del portale" onClose={() => setOpen(false)} footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Indirizzo del portale" className="span2"><input value={f.portal_url} onChange={(e) => setF({ ...f, portal_url: e.target.value })} /></Field>
          <Field label="Nome utente"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Field>
          <Field label={cred?.has_password ? 'Nuova password (vuota: invariata)' : 'Password'}><input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" className="mono" /></Field>
          <Field label="Note (consegna, referente)" className="span2"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
    </Card>
  );
}
