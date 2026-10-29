// Form di compilazione di un audit: parti del modello come schede (Front office / Box prelievo / Sicurezza / Audit report), ogni voce
// con quattro pulsanti a segmenti SI NO NC N.A., nota, "rev. n°" dove previsto, voci libere; per gli AUTO due colonne affiancate
// "Sede" e "Verifica" (la seconda attiva solo per il verificatore con stato INVIATO); barra di avanzamento e punteggio in tempo reale
// per sezione; salvataggio esplicito e automatico ogni 30 s se ci sono modifiche; tabella NC; osservazioni; allegati; azioni di stato.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiBase, base } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, Badge, ConfirmModal, Tabs, useToast, DropZone } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isQualita } from '../index.jsx';
import { Score, Level, Bar, KindBadge, StatusBadge } from '../components/Score.jsx';
import { ANS, ENTE, ESITO_TERZI, ESITO_LE, RELAZIONE, RISCHIO, mese, itDate, itDateTime, kb, soggetto, levelOf, pct } from '../format.js';

const VALUES = ['SI', 'NO', 'NC', 'NA'];
const itemKey = (n) => String(n || '').replace(/\s+/g, '');
// Voci rispondibili del modello (stessa regola del server, lib/scoring.js)
function itemsOf(t) {
  const out = [];
  for (const part of t?.parts || []) for (const sec of part.sections || []) for (const it of sec.items || []) {
    const b = { part_key: part.key, section_key: sec.key, group: it.group || null };
    if (it.sub?.length) for (const s of it.sub) { if (s.free) { for (let i = 1; i <= (Number(s.repeat) || 1); i++) out.push({ ...b, key: `${s.key}_${i}`, n: String(it.n), label: s.text, parent: it.text, rev: Boolean(s.rev), free: true }); } else out.push({ ...b, key: s.key, n: String(it.n), label: s.text, parent: it.text, rev: Boolean(s.rev), free: false }); }
    else if (it.free) { for (let i = 1; i <= (Number(it.repeat) || 1); i++) out.push({ ...b, key: `${itemKey(it.n)}_${i}`, n: String(it.n), label: it.text, parent: null, rev: Boolean(it.rev), free: true }); }
    else out.push({ ...b, key: itemKey(it.n), n: String(it.n), label: it.text, parent: null, rev: Boolean(it.rev), free: false });
  }
  return out;
}
function scoreOf(items, answers, secKey) {
  let si = 0, den = 0, answered = 0, total = 0, nc = 0;
  for (const it of items) {
    if (secKey && it.section_key !== secKey) continue;
    const a = answers?.[it.key] || {};
    if (it.free && !String(a.free || '').trim()) continue;
    total++;
    if (!VALUES.includes(a.v)) continue;
    answered++;
    if (a.v === 'NA') continue;
    den++; if (a.v === 'SI') si++; if (a.v === 'NC') nc++;
  }
  return { score: den ? Math.round((si / den) * 1000) / 10 : null, answered, total, nc };
}

function Seg({ value, onChange, disabled, values = VALUES, labels = ANS }) {
  return <div className="au-seg" role="group">{values.map((v) => <button key={v} type="button" disabled={disabled} className={`${value === v ? `on ${v}` : ''}`} onClick={() => onChange(value === v ? null : v)}>{labels[v] || v}</button>)}</div>;
}

export default function Compila() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [answers, setAnswers] = useState({});
  const [ver, setVer] = useState({});
  const [header, setHeader] = useState({});
  const [ncs, setNcs] = useState([]);
  const [obs, setObs] = useState('');
  const [report, setReport] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;

  const load = useCallback(async () => {
    try {
      const x = await api.get(`/audits/${id}`);
      setA(x); setAnswers(x.answers || {}); setVer(x.verifier_answers || {}); setHeader(x.header || {}); setNcs(Array.isArray(x.ncs) && x.ncs.length ? x.ncs : []); setObs(x.observations || ''); setReport(x.report || {});
      setTab((t) => t || x.template?.body?.parts?.[0]?.key || 'REPORT'); setDirty(false);
    } catch (e) { setErr(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const t = a?.template?.body;
  const items = useMemo(() => itemsOf(t), [t]);
  const auto = a?.kind === 'AUTO';
  const canEdit = Boolean(a?.can_edit);
  const canVerify = Boolean(a?.can_verify);
  const showVer = auto && (a?.status !== 'BOZZA' || Object.keys(ver).length > 0);
  const mark = () => setDirty(true);

  const save = useCallback(async (silent = false) => {
    if (!a || (!canEdit && !canVerify)) return;
    setSaving(true);
    try {
      // il verificatore scrive la colonna Verifica (più NC e osservazioni); chi compila scrive la colonna principale e la testata
      const body = canVerify ? { verifier_answers: ver, ncs, observations: obs, report } : { answers, header, ncs, observations: obs, report };
      const r = await api.put(`/audits/${a.id}`, body, { silent });
      setDirty(false);
      setA((x) => ({ ...x, score: r.score, score_verifier: r.score_verifier, score_by_section: r.by_section }));
      if (!silent) toast('Audit salvato');
    } catch (e) { toast(e, 'err'); }
    setSaving(false);
  }, [a, canEdit, canVerify, answers, ver, header, ncs, obs, report, toast]);
  // salvataggio automatico ogni 30 secondi se ci sono modifiche
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => { const h = setInterval(() => { if (dirtyRef.current) saveRef.current(true); }, 30_000); return () => clearInterval(h); }, []);

  const setAns = (col, key, patch) => { const set = col === 'ver' ? setVer : setAnswers; set((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } })); mark(); };
  const action = async (fn, ok) => { try { if (dirty) await save(true); await fn(); if (ok) toast(ok); window.dispatchEvent(new Event('suite:badges')); await load(); } catch (e) { toast(e, 'err'); } setConfirm(null); };

  if (err) return <div className="page"><Empty icon="alert" title={err.status === 403 ? 'Accesso non consentito' : 'Errore'}>{err.message}</Empty></div>;
  if (!a) return <div className="page"><Loading /></div>;

  const tot = scoreOf(items, answers);
  const totV = scoreOf(items, ver);
  const eff = showVer && totV.answered ? totV.score : tot.score;
  const parts = t?.parts || [];
  const tabs = [...parts.map((p) => ({ value: p.key, label: p.title })), { value: 'REPORT', label: t?.report?.title || 'Audit report' }];
  const titolo = `${a.kind_label} · ${soggetto(a)}${auto ? ` · ${mese(a.period)}` : ''}`;
  const hf = t?.header_fields || [];
  const readOnlyAll = !canEdit && !canVerify;

  // ---- Audit di terze parti: scheda del rapporto
  if (a.kind === 'TERZI') {
    const tp = a.third_party || {};
    return (
      <div className="page">
        <PageHead title={titolo} icon="audit" crumb={<Link to={`${base}/sedi/${a.site_id}`}>Sede</Link>} sub={`${ENTE[tp.ente_tipo] || tp.ente_tipo || ''} · ${tp.ente || ''} · ${itDate(tp.data)} · caricato da ${a.conducted_by_name || ''}`} actions={<Actions a={a} user={user} setConfirm={setConfirm} />} />
        <div className="grid au-two">
          <Card title="Rapporto dell'ente" icon="file">
            <div className="au-head-grid">
              <Field label="Tipo di ente"><input className="au-in" value={ENTE[tp.ente_tipo] || tp.ente_tipo || ''} disabled /></Field>
              <Field label="Ente"><input className="au-in" value={tp.ente || ''} disabled /></Field>
              <Field label="Data"><input className="au-in" value={itDate(tp.data)} disabled /></Field>
              <Field label="Esito"><input className="au-in" value={ESITO_TERZI[tp.esito] || tp.esito || ''} disabled /></Field>
              <Field label="Stato"><div><StatusBadge s={a.status} /></div></Field>
            </div>
            {tp.note && <p style={{ marginTop: 10 }}>{tp.note}</p>}
            <div className="small muted" style={{ marginTop: 8 }}>Testo estratto dal PDF per la sintesi di Claude: {tp.caratteri ? `${tp.caratteri.toLocaleString('it-IT')} caratteri` : 'nessuno'}{tp.ocr ? ' (OCR)' : ''}{tp.troncato ? ', troncato a 60.000' : ''}. Il punteggio non si calcola: l'esito pesa nella sintesi della sede.</div>
          </Card>
          <Files a={a} reload={load} canAttach={a.can_attach} />
        </div>
        {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} onConfirm={() => action(confirm.run, confirm.ok)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead title={titolo} icon="audit" crumb={a.kind === 'LEGAL_ENTITY' ? <Link to={`${base}/partner/${a.organization_id}`}>Partner</Link> : <Link to={`${base}/sedi/${a.site_id}`}>Sede</Link>}
        sub={`${t ? `${t.code} rev. ${t.rev}` : ''} · ${a.status_label}${a.conducted_by_name ? ` · condotto da ${a.header?.effettuato_da || a.conducted_by_name}` : ''}${a.verified_by_name ? ` · verificato da ${a.verified_by_name} il ${itDateTime(a.verified_at)}` : ''}`}
        actions={<Actions a={a} user={user} setConfirm={setConfirm} dirty={dirty} saving={saving} save={save} />} />
      <div className="au-sticky">
        <div className="row">
          <div className="au-progress"><div className="small"><span>{showVer && canVerify && !canEdit ? 'Verifica' : 'Compilazione'}: {(showVer && canVerify && !canEdit ? totV : tot).answered} di {tot.total} voci</span><span>{Math.round(((showVer && canVerify && !canEdit ? totV : tot).answered / Math.max(1, tot.total)) * 100)}%</span></div><div className="au-bar"><i style={{ width: `${((showVer && canVerify && !canEdit ? totV : tot).answered / Math.max(1, tot.total)) * 100}%` }} /></div></div>
          <div><div className="small muted">{auto ? 'Sede' : 'Punteggio'}</div><Score value={tot.score} /> <span className="small muted">NC {tot.nc}</span></div>
          {showVer && <div><div className="small muted">Verifica</div><Score value={totV.score} /> <span className="small muted">NC {totV.nc}{totV.score != null && tot.score != null ? ` · scost. ${(totV.score - tot.score) >= 0 ? '+' : ''}${Math.round((totV.score - tot.score) * 10) / 10}` : ''}</span></div>}
          <div><div className="small muted">Livello</div><Level value={eff} /></div>
          {dirty ? <Badge tone="amber">Modifiche non salvate</Badge> : <Badge tone="grey" dot={false}>Salvato</Badge>}
        </div>
      </div>
      {readOnlyAll && <div className="au-alert"><Icon name="info" className="ico" /><div>{a.status === 'BOZZA' ? 'Audit in sola lettura: lo compila il site manager della sede o un auditor.' : a.status === 'INVIATO' ? 'Inviato: in attesa della verifica di Qualità. La colonna Verifica compare qui quando il verificatore la compila.' : 'Audit chiuso: in sola lettura.'}</div></div>}
      {canVerify && !canEdit && a.status === 'INVIATO' && <div className="au-alert"><Icon name="check" className="ico" /><div>Verifica dell'auto-audit: compila la colonna <b>Verifica</b> voce per voce oppure usa "Conferma le risposte della sede" per copiarle e correggere solo le differenze; poi "Chiudi verifica".</div></div>}
      {canVerify && a.status === 'VERIFICATO' && <div className="au-alert ok"><Icon name="check" className="ico" /><div>Auto-audit verificato: fa fede la colonna Verifica. Qualità può ancora correggerla e salvare; "Riapri" riporta l'audit in verifica.</div></div>}

      <Card title="Testata" icon="file" style={{ marginBottom: 14 }}>
        <div className="au-head-grid">
          {hf.map((f) => {
            const ro = !canEdit || f.source;
            const v = f.source === 'site' ? a.site_name : f.source === 'organization' ? a.org_name : header[f.key] ?? '';
            if (f.type === 'select') return <Field key={f.key} label={f.label}><select className="au-in" disabled={ro} value={v || ''} onChange={(e) => { setHeader({ ...header, [f.key]: e.target.value }); mark(); }}><option value="">–</option>{(f.options || []).map((o) => <option key={o} value={o}>{RELAZIONE[o] || RISCHIO[o]?.label || o}</option>)}</select></Field>;
            return <Field key={f.key} label={f.label}><input className="au-in" type={f.type === 'date' ? 'date' : 'text'} disabled={ro} value={v || ''} onChange={(e) => { setHeader({ ...header, [f.key]: e.target.value }); mark(); }} /></Field>;
          })}
          {auto && <Field label="Mese"><input className="au-in" value={mese(a.period)} disabled /></Field>}
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} items={tabs} />

      {parts.filter((p) => p.key === tab).map((p) => p.sections.map((sec) => {
        const ss = scoreOf(items, answers, sec.key); const sv = scoreOf(items, ver, sec.key);
        let lastGroup = null;
        return (
          <Card key={sec.key} className="au-section" title={`${sec.key} · ${sec.title}`} actions={<div className="au-sec-score"><span>{auto ? 'Sede' : 'Punteggio'} <b><Score value={ss.score} /></b> · {ss.answered}/{ss.total}</span>{showVer && <span>Verifica <b><Score value={sv.score} /></b> · {sv.answered}/{sv.total}</span>}</div>}>
            {sec.hint && <div className="hint">{sec.hint}</div>}
            {items.filter((it) => it.section_key === sec.key).map((it) => {
              const x = answers[it.key] || {}; const v = ver[it.key] || {};
              const grp = it.group && it.group !== lastGroup ? it.group : null; if (it.group) lastGroup = it.group;
              const hidden = it.free && !canEdit && !x.free && !v.free;
              if (hidden) return null;
              return (
                <React.Fragment key={it.key}>
                  {grp && <div className="au-group">{grp}</div>}
                  <div className={`au-item ${showVer ? 'two' : ''}`}>
                    <div className="q">
                      <span className="n">{it.key}</span>{it.parent && <span className="parent">{it.parent} · </span>}{it.label}
                      {it.free && <div className="free"><input placeholder="Specificare" disabled={!canEdit} value={x.free || ''} onChange={(e) => setAns('ans', it.key, { free: e.target.value })} /></div>}
                      {it.rev && <label className="rev">rev. n° <input disabled={!canEdit} value={x.rev || ''} onChange={(e) => setAns('ans', it.key, { rev: e.target.value })} /></label>}
                    </div>
                    <div className="au-col"><div className="lbl">{auto ? 'Sede' : 'Esito'}</div>
                      <Seg value={x.v || null} disabled={!canEdit} onChange={(val) => setAns('ans', it.key, { v: val })} />
                      {a.kind === 'LEGAL_ENTITY' && (canEdit || x.risk) && <Seg values={['BASSO', 'MEDIO', 'ALTO']} labels={{ BASSO: 'Rischio basso', MEDIO: 'Medio', ALTO: 'Alto' }} value={x.risk || null} disabled={!canEdit} onChange={(val) => setAns('ans', it.key, { risk: val })} />}
                      <textarea className="au-note" rows={1} placeholder={canEdit ? 'Nota' : ''} disabled={!canEdit} value={x.note || ''} onChange={(e) => setAns('ans', it.key, { note: e.target.value })} />
                    </div>
                    {showVer && <div className="au-col ver"><div className="lbl">Verifica</div>
                      <Seg value={v.v || null} disabled={!canVerify} onChange={(val) => setAns('ver', it.key, { v: val })} />
                      <textarea className="au-note" rows={1} placeholder={canVerify ? 'Nota del verificatore' : ''} disabled={!canVerify} value={v.note || ''} onChange={(e) => setAns('ver', it.key, { note: e.target.value })} />
                    </div>}
                  </div>
                </React.Fragment>
              );
            })}
          </Card>
        );
      }))}

      {tab === 'REPORT' && <>
        <Card title={t?.report?.title || 'Audit report'} icon="alert" className="au-section" actions={(canEdit || canVerify) && <button className="btn sm ghost" onClick={() => { setNcs([...ncs, { n: '', descrizione: '', cause: '', soluzione: '', azione_correttiva: '', persona_riferimento: '', entro: '' }]); mark(); }}><Icon name="plus" />Aggiungi NC</button>}>
          {t?.report?.hint && <div className="hint">{t.report.hint}</div>}
          {!ncs.length ? <div className="small muted">Nessuna non conformità registrata.</div> : <div className="table-wrap"><table className="t au-nc"><thead><tr><th style={{ width: 70 }}>N. voce</th><th>Descrizione NC</th><th>Cause</th><th>Soluzione</th><th>Azione correttiva</th><th style={{ width: 150 }}>Persona di riferimento</th><th style={{ width: 120 }}>Entro</th>{(canEdit || canVerify) && <th />}</tr></thead>
            <tbody>{ncs.map((n, i) => <tr key={i}>{['n', 'descrizione', 'cause', 'soluzione', 'azione_correttiva', 'persona_riferimento'].map((k) => <td key={k}><textarea className="au-note" rows={1} disabled={!(canEdit || canVerify)} value={n[k] || ''} onChange={(e) => { const c = ncs.slice(); c[i] = { ...c[i], [k]: e.target.value }; setNcs(c); mark(); }} /></td>)}<td><input className="au-in" type="date" disabled={!(canEdit || canVerify)} value={n.entro || ''} onChange={(e) => { const c = ncs.slice(); c[i] = { ...c[i], entro: e.target.value }; setNcs(c); mark(); }} /></td>{(canEdit || canVerify) && <td><button className="iconbtn" title="Rimuovi" onClick={() => { setNcs(ncs.filter((_, j) => j !== i)); mark(); }}><Icon name="trash" /></button></td>}</tr>)}</tbody></table></div>}
        </Card>
        <Card title={t?.report?.observations_label || 'Ulteriori eventuali osservazioni'} icon="edit" className="au-section">
          <textarea className="au-note" rows={5} disabled={!(canEdit || canVerify)} value={obs} onChange={(e) => { setObs(e.target.value); mark(); }} placeholder={canEdit || canVerify ? 'Osservazioni, evidenze raccolte, punti di attenzione' : ''} />
          {(t?.report?.extra_fields || []).length > 0 && <div className="au-head-grid" style={{ marginTop: 12 }}>{t.report.extra_fields.map((f) => <Field key={f.key} label={f.label}><select className="au-in" disabled={!(canEdit || canVerify)} value={report[f.key] || ''} onChange={(e) => { setReport({ ...report, [f.key]: e.target.value }); mark(); }}><option value="">–</option>{(f.options || []).map((o) => <option key={o} value={o}>{ESITO_LE[o] || RISCHIO[o]?.label || o}</option>)}</select></Field>)}</div>}
        </Card>
        <Files a={a} reload={load} canAttach={a.can_attach} />
      </>}

      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} onConfirm={() => action(confirm.run, confirm.ok)} />}
    </div>
  );
}

function Actions({ a, user, setConfirm, dirty, saving, save }) {
  const nav = useNavigate();
  const auto = a.kind === 'AUTO';
  return (
    <>
      <a className="btn sm ghost" href={`${apiBase}/audits/${a.id}/export.xlsx`} title="Checklist compilata in Excel"><Icon name="sheet" />Excel</a>
      <a className="btn sm ghost" href={`${apiBase}/audits/${a.id}/export.pdf?inline=1`} target="_blank" rel="noopener" title="Modulo compilato in PDF"><Icon name="pdf" />PDF</a>
      {(a.can_edit || a.can_verify) && save && <button className="btn sm" disabled={saving} onClick={() => save(false)}><Icon name="check" />{dirty ? 'Salva' : 'Salvato'}</button>}
      {auto && a.status === 'BOZZA' && a.can_edit && <button className="btn sm" onClick={() => setConfirm({ title: 'Invia a Qualità', text: 'L\'auto-audit viene inviato ai verificatori (Qualità, auditor, amministratori): da quel momento la colonna Sede non è più modificabile. Confermi l\'invio?', confirmText: 'Invia', run: () => api.post(`/audits/${a.id}/invia`), ok: 'Auto-audit inviato a Qualità' })}><Icon name="send" />Invia a Qualità</button>}
      {auto && a.status === 'INVIATO' && a.can_verify && <button className="btn sm ghost" onClick={() => setConfirm({ title: 'Conferma le risposte della sede', text: 'La colonna Verifica viene riempita con le risposte della sede (le note del verificatore restano vuote). Le voci già verificate vengono sovrascritte. Procedere?', confirmText: 'Copia le risposte', run: () => api.post(`/audits/${a.id}/conferma-sede`), ok: 'Risposte della sede copiate nella colonna Verifica' })}><Icon name="copy" />Conferma le risposte della sede</button>}
      {auto && a.status === 'INVIATO' && a.can_verify && <button className="btn sm" onClick={() => setConfirm({ title: 'Chiudi verifica', text: 'L\'auto-audit passa a VERIFICATO con il punteggio della colonna Verifica, che da ora fa fede. Il site manager riceve una notifica. Confermi?', confirmText: 'Chiudi verifica', run: () => api.post(`/audits/${a.id}/chiudi`), ok: 'Verifica chiusa' })}><Icon name="check" />Chiudi verifica</button>}
      {!auto && a.kind !== 'TERZI' && a.status === 'BOZZA' && a.can_close && <button className="btn sm" onClick={() => setConfirm({ title: 'Chiudi audit', text: 'L\'audit passa a CHIUSO e non è più modificabile (Qualità può riaprirlo). Confermi?', confirmText: 'Chiudi', run: () => api.post(`/audits/${a.id}/chiudi`), ok: 'Audit chiuso' })}><Icon name="check" />Chiudi audit</button>}
      {a.kind === 'TERZI' && a.status === 'CARICATO' && a.can_close && <button className="btn sm" onClick={() => setConfirm({ title: 'Chiudi', text: 'Il rapporto di terze parti viene segnato come preso in carico e chiuso.', confirmText: 'Chiudi', run: () => api.post(`/audits/${a.id}/chiudi`), ok: 'Chiuso' })}><Icon name="check" />Chiudi</button>}
      {a.can_reopen && <button className="btn sm ghost" onClick={() => setConfirm({ title: 'Riapri', text: 'L\'audit torna modificabile (un auto-audit verificato torna in verifica).', confirmText: 'Riapri', run: () => api.post(`/audits/${a.id}/riapri`), ok: 'Audit riaperto' })}><Icon name="refresh" />Riapri</button>}
      {a.can_delete && <button className="btn sm ghost danger" title="Sposta nel cestino" onClick={() => setConfirm({ title: 'Elimina l\'audit', danger: true, confirmText: 'Elimina', text: `L'audit (${a.kind_label}, ${soggetto(a)}) viene eliminato dall'archivio. L'operazione resta tracciata nel registro della Suite.`, run: async () => { await api.del(`/audits/${a.id}`); nav(`${base}/archivio`); }, ok: 'Audit eliminato' })}><Icon name="trash" />Elimina</button>}
    </>
  );
}

function Files({ a, reload, canAttach }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const up = async (files) => {
    if (!files?.length) return;
    const fd = new FormData(); for (const f of files) fd.append('file', f, f.name);
    setBusy(true);
    try { await api.upload(`/audits/${a.id}/files`, fd); toast(`${files.length} ${files.length === 1 ? 'allegato caricato' : 'allegati caricati'}`); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const del = async (f) => { try { await api.del(`/files/${f.id}`); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <Card title={a.kind === 'TERZI' ? `Rapporti allegati (${a.files.length})` : `Evidenze allegate (${a.files.length})`} icon="folder" className="au-section">
      {!a.files.length ? <div className="small muted">Nessun allegato.</div> : <div className="au-files">{a.files.map((f) => <span key={f.id} className="au-fi"><Icon name={/^image\//.test(f.mime) ? 'image' : 'pdf'} /><a href={`${apiBase}/files/${f.id}?inline=1`} target="_blank" rel="noopener">{f.filename}</a><span className="muted">{kb(f.size)}</span>{canAttach && <button className="iconbtn" title="Rimuovi" onClick={() => del(f)}><Icon name="x" /></button>}</span>)}</div>}
      {canAttach && <div style={{ marginTop: 10 }}><DropZone onFiles={up} accept=".pdf,image/*" compact><Icon name="upload" /><div className="small">{busy ? 'Caricamento in corso' : 'Trascina qui PDF o foto (evidenze) oppure clicca per sceglierli'}</div></DropZone></div>}
    </Card>
  );
}
