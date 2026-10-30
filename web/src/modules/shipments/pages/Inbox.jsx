import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, API_BASE, uploadWithProgress } from '../api.js';
import { useAuth, canOperate } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import { Card, Modal, Field, ErrorBox, Loading, Empty, Badge, Icon, useApi, useToast } from '../components/ui.jsx';
import { OrdersTable, OrderForm, emptyOrder, orderPayload, orderReady, useModes } from '../components/orders.jsx';
import { fdt, projectPath } from '../format.js';

const ACCEPT = '.pdf,.eml,.txt,.msg,application/pdf,message/rfc822,text/plain';
const MAX_MB = 20;
const fsize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Campi mostrati nel riquadro "Letto dal documento" (JSON della lettura assistita, notazione puntata come la confidenza)
const READ_FIELDS = ['richiedente.tipo', 'richiedente.ragione_sociale', 'richiedente.piva', 'richiedente.cf', 'richiedente.referente', 'richiedente.email', 'richiedente.telefono',
  'destinatario.titolo', 'destinatario.nome', 'destinatario.cognome', 'destinatario.indirizzo1', 'destinatario.indirizzo2', 'destinatario.cap', 'destinatario.citta', 'destinatario.provincia', 'destinatario.paese', 'destinatario.telefono', 'destinatario.email',
  'richiesta.tipo', 'richiesta.quantita_kit', 'richiesta.prodotto', 'richiesta.riferimento_esterno', 'richiesta.note', 'richiesta.lingua'];
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

// Riquadro "Letto dal documento": campi con la spilla di confidenza (verde alta, gialla media, rossa bassa) e la citazione al passaggio del mouse
function ReadBox({ msg }) {
  const { t } = useT();
  const ex = msg.extracted;
  if (!ex) return null;
  const conf = ex.confidenza || {};
  const shown = READ_FIELDS.map((k) => [k, getPath(ex, k)]).filter(([, v]) => v != null && v !== '' && String(v).toLowerCase() !== 'null');
  const fmt = (k, v) => (k === 'richiedente.tipo' ? t(`req.${v}`) : k === 'richiesta.tipo' ? t(`type.${v}`) : String(v));
  return (
    <div className="readbox">
      <div className="hd"><span className="strong row" style={{ gap: 6 }}><Icon name="file" size={16} />{t('inbox.readFrom')}</span>
        <span className="small muted">{msg.extracted_model === 'mock' ? t('inbox.readMock') : `${t('inbox.readModel')} ${msg.extracted_model || ''}`}{msg.ocr ? ` · OCR` : ''} · <span className="conf alta" /> {t('inbox.confAlta')} <span className="conf media" /> {t('inbox.confMedia')} <span className="conf bassa" /> {t('inbox.confBassa')}</span></div>
      {!shown.length ? <div className="small muted">{t('inbox.readEmpty')}</div> : (
        <div className="readgrid">{shown.map(([k, v]) => {
          const c = conf[k] || {};
          const lv = ['alta', 'media', 'bassa'].includes(String(c.livello || '').toLowerCase()) ? String(c.livello).toLowerCase() : 'none';
          return <div key={k} className="rf" title={c.citazione ? `«${c.citazione}»` : t('inbox.noQuote')}><span className={`conf ${lv}`} /><span className="k">{t(`rd.${k}`)}</span><span className="v">{fmt(k, v)}</span></div>;
        })}</div>
      )}
    </div>
  );
}

export default function Inbox({ project }) {
  const { t, lang } = useT();
  const { user } = useAuth();
  const op = canOperate(user);
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [tab, setTab] = useState('pending');
  const [paste, setPaste] = useState(null);
  const [manual, setManual] = useState(null);
  const [review, setReview] = useState(null);
  const [upload, setUpload] = useState(null);   // { files: [File], progress: 0..1 | null, over }
  const [err, setErr] = useState(null);
  const modes = useModes();
  const status = tab === 'pending' ? 'NEW,PARSED,ERROR' : tab === 'done' ? 'CONFIRMED' : 'IGNORED';
  const inbox = useApi(`/orders/inbox?status=${status}&project=${project}`, [tab]);
  const newOrders = useApi(`/orders?project=${project}&status=NEW`, [tab]);
  const settings = useApi(op ? '/settings' : null);
  const p = projectPath(project);
  const ls = project === 'LIFESTYLE';

  const doPaste = async () => {
    setErr(null);
    try { const r = await api.post('/orders/inbox/paste', { text: paste.text, subject: paste.subject || null }); setPaste(null); inbox.reload(); if (r.status === 'PARSED') openReview(r); else toast(t('inbox.noKits'), 'err'); } catch (e) { setErr(e); }
  };
  const openReview = (m) => {
    let items;
    if (m.project === 'LIFESTYLE') {
      // righe proposte dalla lettura assistita: richiedente (Legal entity abbinata o persona), destinatario, tipo e quantità
      items = (m.parsed || []).map((b) => ({ ...emptyOrder('LIFESTYLE'), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)),
        requester_org_name: b.requester_org_id ? (m.requester_match?.id === b.requester_org_id ? m.requester_match.name : b.requester_name || '') : '',
        external_ref: b.external_ref || '', barcode: '', warnings: b.warnings || [] }));
    } else {
      items = (m.parsed || []).map((b) => ({ ...emptyOrder('ENDEAVOR'), external_ref: b.external_ref, shipping_mode_id: b.mode?.id || '', mode_text: b.mode_text, warnings: b.warnings || [], barcode: b.in_stock ? b.external_ref : '', in_stock: !!b.in_stock, kit_status: b.kit_status || null, legs: b.legs || null, notes: (b.mode_text || '').length > 30 ? b.mode_text : '', patient_title: b.patient_title || '', patient_first_name: b.patient_first_name, patient_last_name: b.patient_last_name, address1: b.address1, address2: b.address2 || '', city: b.city, province: b.province || '', zip: b.zip || '', country: b.country || 'Italia', phone: b.phone || '', lang: 'en' }));
    }
    setErr(null);
    setReview({ msg: m, items: items.length ? items : [emptyOrder(m.project || project)] });
  };
  const confirm = async () => {
    setErr(null);
    try {
      const r = await api.post(`/orders/inbox/${review.msg.id}/confirm`, { items: review.items.map(orderPayload) });
      toast(`${t('inbox.created')}: ${r.order_ids.length}`); setReview(null); inbox.reload(); newOrders.reload();
      if (r.order_ids.length === 1) nav(`/${p}/richieste/${r.order_ids[0]}`);
    } catch (e) { setErr(e); }
  };
  const ignore = async (m) => { try { await api.post(`/orders/inbox/${m.id}/ignore`); inbox.reload(); } catch (e) { setErr(e); } };
  const reparse = async (m) => { try { const r = await api.post(`/orders/inbox/${m.id}/reparse`); inbox.reload(); openReview(r); } catch (e) { setErr(e); } };
  const createManual = async () => {
    setErr(null);
    try { const o = await api.post('/orders', orderPayload(manual)); toast(t('c.saved')); setManual(null); nav(`/${p}/richieste/${o.id}`); } catch (e) { setErr(e); }
  };
  const reparseAll = async () => { try { const r = await api.post('/orders/inbox/reparse-all'); toast(`${r.recognized} / ${r.total}`); inbox.reload(); } catch (e) { setErr(e); } };
  const runInbox = async () => { try { const r = await api.post('/settings/run/inbox'); toast(JSON.stringify(r)); inbox.reload(); } catch (e) { setErr(e); } };
  const mailCfg = settings.data?.mail;

  // ---- upload di PDF o email ----
  const addFiles = (list) => {
    const arr = [...(list || [])];
    if (!arr.length) return;
    setUpload((u) => ({ ...(u || {}), files: [...(u?.files || []), ...arr].slice(0, 10), progress: null, over: false }));
  };
  const doUpload = async () => {
    setErr(null);
    const big = upload.files.find((f) => f.size > MAX_MB * 1048576);
    if (big) { setErr(new Error(t('inbox.tooBig', { f: big.name, n: MAX_MB }))); return; }
    const fd = new FormData();
    fd.append('project', project);
    for (const f of upload.files) fd.append('file', f);
    setUpload((u) => ({ ...u, progress: 0 }));
    try {
      const r = await uploadWithProgress('/inbox/upload', fd, (pr) => setUpload((u) => (u ? { ...u, progress: pr } : u)));
      setUpload(null); setTab('pending'); inbox.reload();
      for (const e of r.errori || []) toast(`${e.filename}: ${e.error}`, 'err');
      if (r.messages.length === 1) {
        if ((r.messages[0].parsed || []).length) openReview(r.messages[0]); else toast(ls ? t('inbox.readEmpty') : t('inbox.noKits'), 'err');
      } else toast(t('inbox.readN', { n: r.messages.length }));
    } catch (e) { setErr(e); setUpload((u) => (u ? { ...u, progress: null } : u)); }
  };
  // Legal entity dal documento (richiedente non abbinato): creata in Amministrazione come CLIENTE da rivedere
  const createOrg = async () => {
    setErr(null);
    try {
      const r = await api.post('/inbox/organizations', { from_message_id: review.msg.id });
      toast(r.organization.existing ? t('inbox.orgExisting', { n: r.organization.name }) : t('inbox.orgCreated', { n: r.organization.name }));
      const keep = review.items;
      openReview(r.message);
      // le modifiche già fatte dall'operatore restano: si aggiorna solo il richiedente
      setReview((rv) => ({ ...rv, items: keep.map((it) => ({ ...it, requester_kind: 'LEGAL_ENTITY', requester_org_id: r.organization.id, requester_org_name: r.organization.name, warnings: (it.warnings || []).filter((w) => w !== 'requester_unmatched') })) }));
      inbox.reload();
    } catch (e) { setErr(e); }
  };
  const applyRequesterToAll = () => {
    const f = review.items[0];
    const keys = ['requester_kind', 'requester_org_id', 'requester_org_name', 'requester_contact', 'requester_email', 'requester_phone'];
    setReview({ ...review, items: review.items.map((it, i) => (i === 0 ? it : { ...it, ...Object.fromEntries(keys.map((k) => [k, f[k]])) })) });
  };

  const fileLink = (m) => m.has_file && <a className="chip" href={`${API_BASE}/inbox/${m.id}/file`} target="_blank" rel="noreferrer" title={t('inbox.openFile')}><Icon name="file" size={12} /> {m.filename}</a>;
  const lsSummary = (m) => {
    const ps = m.parsed || [];
    if (!ps.length) return <Badge tone="red">{t('inbox.readEmpty')}</Badge>;
    const b = ps[0];
    const who = b.requester_kind === 'LEGAL_ENTITY' ? (m.requester_match?.name || b.requester_name || '?') : [b.patient_first_name, b.patient_last_name].filter(Boolean).join(' ');
    return <>{b.requester_kind === 'LEGAL_ENTITY' && <Badge tone={b.requester_org_id ? 'green' : 'yellow'}>{b.requester_org_id ? t('req.LEGAL_ENTITY') : t('inbox.warn.requester_unmatched')}</Badge>}<span className="small strong">{who}</span><Badge tone="mauve">{t('inbox.kitsN', { n: ps.length })} · {t(`type.${b.order_type}`)}</Badge></>;
  };
  const revProject = review?.msg?.project || project;
  const ready = review && review.items.every((it) => orderReady(it, revProject));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('inbox.title')}</h1><div className="sub">{ls ? t('inbox.lsSub') : t('inbox.sub')}</div></div>
        {op && <div className="row">
          <button className="btn ghost" onClick={() => { setErr(null); setUpload({ files: [], progress: null }); }}><Icon name="upload" size={16} />{t('inbox.upload')}</button>
          {!ls && <button className="btn ghost" onClick={() => setPaste({ text: '', subject: '' })}>{t('inbox.paste')}</button>}
          <button className="btn" onClick={() => { setErr(null); setManual(emptyOrder(project)); }}>+ {t('inbox.manual')}</button>
        </div>}
      </div>
      <ErrorBox error={!review && !upload && !manual ? err : null} />
      {!ls && op && settings.data && (
        <div className={`alert ${mailCfg?.inboxConfigured ? 'info' : 'warn'}`} style={{ marginBottom: 14 }}>
          {mailCfg?.inboxConfigured ? <>{t('inbox.graphOn', { m: mailCfg.inbox, n: 5, t: settings.data.inbox.lastPoll ? fdt(settings.data.inbox.lastPoll) : '–' })} <button className="btn sm ghost" onClick={runInbox}>{t('inbox.readNow')}</button></> : (mailCfg?.inboxReason === 'no_mailbox' ? t('inbox.graphOffMailbox') : t('inbox.graphOff'))}
        </div>
      )}
      <div className="tabs" style={{ alignItems: 'center' }}>{[['pending', t('inbox.pending')], ['done', t('inbox.done')], ['ignored', t('inbox.ignored')]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}<div className="spacer" />{op && !ls && tab === 'pending' && <button className="btn sm ghost" style={{ marginBottom: 6 }} onClick={reparseAll}>{t('inbox.reparseAll')}</button>}</div>
      {!inbox.data ? <Loading /> : !inbox.data.length ? <Card><Empty>{ls && tab === 'pending' ? t('inbox.lsEmpty') : t('c.none')}</Empty></Card> : (
        <div className="rowlist" style={{ marginBottom: 20 }}>
          {inbox.data.map((m) => (
            <div key={m.id} className={`blockcard ${m.status === 'ERROR' || (m.status !== 'CONFIRMED' && (m.parsed || []).some((b) => b.warnings?.length)) ? 'warn' : ''}`}>
              <div className="hd">
                <div className="row" style={{ gap: 6 }}>{m.source === 'UPLOAD' && <Icon name="file" size={16} />}<span className="strong">{m.subject || m.filename || '(no subject)'}</span> <span className="small muted">· {t('inbox.from')} {m.from_addr || '–'} · {t('inbox.received')} {fdt(m.received_at)} · {t(`inbox.source.${m.source}`)}</span>{fileLink(m)}</div>
                <div className="row">
                  {m.status === 'CONFIRMED' ? <span className="small">{t('inbox.created')}: {(m.order_ids || []).map((id) => <Link key={id} to={`/${p}/richieste/${id}`} className="chip">#{id}</Link>)}</span>
                    : m.status === 'IGNORED' ? <Badge>{t('inbox.ignored')}</Badge>
                      : <>{m.project === 'LIFESTYLE' ? lsSummary(m) : (() => { const ps = m.parsed || []; const ok = ps.filter((b) => b.in_stock).length; if (!ps.length) return <Badge tone="red">{t('inbox.noKits')}</Badge>; if (ok === ps.length) return <Badge tone="green">{ok} {t('inbox.kitsInStock')}</Badge>; if (ok === 0) return <Badge tone="red">{ps.length > 1 ? t('inbox.kitsNotInStock') : t('inbox.kitNotInStock')}</Badge>; return <Badge tone="mauve">{t('inbox.kitsPartial', { a: ok, b: ps.length })}</Badge>; })()}
                        {op && <><button className="btn sm" onClick={() => openReview(m)}>{t('inbox.review')}</button><button className="btn sm ghost" onClick={() => reparse(m)}>{t('inbox.reparse')}</button><button className="btn sm ghost" onClick={() => ignore(m)}>{t('inbox.ignore')}</button></>}</>}
                </div>
              </div>
              {m.project !== 'LIFESTYLE' && (m.parsed || []).length > 0 && m.status !== 'CONFIRMED' && <div className="row small">{m.parsed.map((b, i) => <span key={i} className="chip" style={b.in_stock ? undefined : { background: 'var(--red-100)', color: 'var(--red)' }}>{b.external_ref} · {b.in_stock ? t('inbox.inStock') : b.kit_known ? t(`kst.${b.kit_status}`) : t('inbox.notInStock')} · {b.patient_first_name} {b.patient_last_name} · {b.mode ? (lang === 'en' ? modes.data?.find((x) => x.id === b.mode.id)?.name_en : modes.data?.find((x) => x.id === b.mode.id)?.name_it) : <span className="red">{b.mode_text || '?'}</span>}</span>)}</div>}
              {m.status !== 'CONFIRMED' && m.status !== 'IGNORED' && (m.avvisi || []).length > 0 && <div className="small" style={{ marginTop: 6, color: '#6a5510' }}>{m.avvisi.join(' · ')}</div>}
              <details style={{ marginTop: 8 }}><summary className="small muted" style={{ cursor: 'pointer' }}>{m.source === 'UPLOAD' ? t('inbox.docText') : t('inbox.body')}</summary><pre className="mail">{m.body_text}</pre></details>
            </div>))}
        </div>
      )}
      <Card title={t('dash.toAssign')} flush>
        <OrdersTable rows={newOrders.data} project={project} columns={ls ? ['ref', 'requester', 'patient', 'mode', 'status', 'date'] : ['ref', 'patient', 'mode', 'status', 'date']} />
      </Card>

      {upload && (
        <Modal title={t('inbox.upload')} wide onClose={() => upload.progress == null && setUpload(null)} footer={<><button className="btn ghost" disabled={upload.progress != null} onClick={() => setUpload(null)}>{t('c.cancel')}</button><button className="btn" disabled={!upload.files.length || upload.progress != null} onClick={doUpload}>{upload.progress != null ? t('inbox.uploading') : t('inbox.uploadGo', { n: upload.files.length })}</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 10 }}>{ls ? t('inbox.uploadHelpLs') : t('inbox.uploadHelpEn')}</div>
          <div className={`dropzone ${upload.over ? 'over' : ''}`} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); if (!upload.over) setUpload({ ...upload, over: true }); }} onDragLeave={() => setUpload({ ...upload, over: false })}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}><span className="ico"><Icon name="upload" /></span></div>
            <div className="strong">{t('inbox.drop')}</div>
            <div className="small">{t('inbox.dropSub', { n: MAX_MB })}</div>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {upload.files.length > 0 && <div className="uplist">{upload.files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="uf"><Icon name="file" size={16} /><span className="strong" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{f.name}</span><span className="small muted">{fsize(f.size)}</span>
              {/\.msg$/i.test(f.name) && <Badge tone="red">{t('inbox.msgNo')}</Badge>}
              <div className="bar"><i style={{ width: `${Math.round((upload.progress || 0) * 100)}%` }} /></div>
              {upload.progress == null && <button className="btn sm ghost" onClick={() => setUpload({ ...upload, files: upload.files.filter((_, j) => j !== i) })}>{t('c.delete')}</button>}</div>))}
            {upload.progress != null && <div className="small muted">{upload.progress < 1 ? `${Math.round(upload.progress * 100)}%` : t('inbox.reading')}</div>}
          </div>}
        </Modal>
      )}
      {paste && (
        <Modal title={t('inbox.paste')} wide onClose={() => setPaste(null)} footer={<><button className="btn ghost" onClick={() => setPaste(null)}>{t('c.cancel')}</button><button className="btn" disabled={paste.text.trim().length < 10} onClick={doPaste}>{t('inbox.review')}</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 10 }}>{t('inbox.pasteHelp')}</div>
          <Field label={t('inbox.subject')}><input value={paste.subject} onChange={(e) => setPaste({ ...paste, subject: e.target.value })} placeholder="Kits to send out - AFF…" /></Field>
          <Field label={t('inbox.body')} className="" ><textarea rows={14} autoFocus value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} /></Field>
        </Modal>
      )}
      {manual && (
        <Modal title={t('inbox.manual')} wide onClose={() => setManual(null)} footer={<><button className="btn ghost" onClick={() => setManual(null)}>{t('c.cancel')}</button><button className="btn" disabled={!orderReady(manual, project)} onClick={createManual}>{t('c.save')}</button></>}>
          <ErrorBox error={err} />
          <OrderForm value={manual} onChange={setManual} project={project} modes={modes.data} />
        </Modal>
      )}
      {review && (
        <Modal title={`${t('inbox.review')} · ${review.msg.subject || review.msg.filename || ''}`} wide onClose={() => setReview(null)} footer={<><button className="btn ghost" onClick={() => setReview(null)}>{t('c.cancel')}</button><button className="btn" disabled={!ready} onClick={confirm}>{review.items.length > 1 ? t('inbox.confirmN', { n: review.items.length }) : t('inbox.confirm1')}</button></>}>
          <ErrorBox error={err} />
          {review.msg.has_file && <div className="small" style={{ marginBottom: 8 }}>{t('inbox.file')}: {fileLink(review.msg)} <a className="small" href={`${API_BASE}/inbox/${review.msg.id}/file?download=1`}>{t('c.download')}</a></div>}
          <ReadBox msg={review.msg} />
          {(review.msg.avvisi || []).length > 0 && <div className="alert warn" style={{ marginBottom: 12, flexDirection: 'column', gap: 4 }}>{review.msg.avvisi.map((a, i) => <div key={i}>{a}</div>)}</div>}
          {revProject === 'LIFESTYLE' && review.msg.extracted && (() => {
            const ric = review.msg.extracted.richiedente || {};
            const entity = String(ric.tipo || '').toUpperCase() === 'LEGAL_ENTITY' || ric.ragione_sociale || ric.piva;
            if (!entity) return null;
            const m = review.msg.requester_match;
            return <div className="row" style={{ marginBottom: 12 }}>{m ? <><Badge tone="green">{t('inbox.orgMatched')}</Badge><span className="strong">{m.name}</span><span className="small muted">{t('inbox.orgHow', { h: m.how })}</span></>
              : <><Badge tone="yellow">{t('inbox.warn.requester_unmatched')}</Badge><span className="strong">{ric.ragione_sociale || ric.piva}</span>{op && <button className="btn sm" onClick={createOrg}><Icon name="building" size={14} />{t('inbox.orgCreate')}</button>}<span className="small muted">{t('inbox.orgCreateHelp')}</span></>}</div>;
          })()}
          <div className="rowlist">
            {review.items.map((it, i) => (
              <div key={i} className={`blockcard ${it.warnings?.length ? 'warn' : ''}`}>
                <div className="hd"><span className="ref">{it.external_ref || `#${i + 1}`}</span>
                  <div className="row small">{it.mode_text && <span className="muted">{t('inbox.modeText')}: <b>{it.mode_text}</b></span>}{(it.warnings || []).filter((w) => w !== 'mode' || !it.legs).map((w) => <Badge key={w} tone={w === 'requester_unmatched' ? 'yellow' : 'red'}>{w === 'mode_no_tariff' && it.legs ? t('inbox.warn.mode_no_tariff', { o: it.legs.outbound || '–', r: it.legs.ret || '–' }) : t(`inbox.warn.${w}`)}</Badge>)}
                    {review.items.length > 1 && <button className="btn sm ghost" onClick={() => setReview({ ...review, items: review.items.filter((_, j) => j !== i) })}>{t('c.delete')}</button>}</div></div>
                <OrderForm value={it} onChange={(v) => setReview({ ...review, items: review.items.map((x, j) => (j === i ? v : x)) })} project={revProject} modes={modes.data} compact
                  requesterExtra={i === 0 && review.items.length > 1 ? <button type="button" className="btn sm ghost" onClick={applyRequesterToAll}>{t('inbox.applyAll')}</button> : null} />
              </div>))}
          </div>
          <details style={{ marginTop: 12 }}><summary className="small muted" style={{ cursor: 'pointer' }}>{review.msg.source === 'UPLOAD' ? t('inbox.docText') : t('inbox.body')}</summary><pre className="mail">{review.msg.body_text}</pre></details>
        </Modal>
      )}
    </div>
  );
}
