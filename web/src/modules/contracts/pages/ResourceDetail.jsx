import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, canWrite, isAdmin, seesCosts } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge, StatusBadge, Modal, PromptModal, ConfirmModal, useToast, Icon } from '../components/ui.jsx';
import { PersonForm, EmploymentForm, LpForm } from '../components/forms.jsx';
import { eur, itDate, itDateTime, bytes, age, CONTRACT, LEVEL_LABEL, LETTER_STATUS, DEADLINE_STATE, FEE_TYPE, FEE_VAT, SEX, TERMINATION_LABEL, PERSON_KIND, today } from '../format.js';

const DOC_LABEL = { CONTRATTO: 'Lettera di assunzione', MBO: 'Piano MBO', LETTERA_IMPEGNO: 'Lettera di impegno', CONTRATTO_LP: 'Contratto LP' };

function Row({ k, v }) { return v == null || v === '' ? null : <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px dashed var(--line)', padding: '5px 0' }}><span className="muted">{k}</span><span className="strong" style={{ textAlign: 'right' }}>{v}</span></div>; }

export default function ResourceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const d = useApi(`/resources/${id}`);
  const siblings = useApi(d.data ? `/resources?kind=${d.data.resource.kind}` : null, [d.data?.resource?.kind]);
  const [tab, setTab] = useState('scheda');
  const [modal, setModal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analysisReport, setAnalysisReport] = useState(null);
  const writer = canWrite(user);
  const costs = seesCosts(user);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { resource: r, employment: e, lp, letters, documents, attachments, deadlines, checklist, payroll, reminders = [], category_labels: CL } = d.data;
  const isEmp = r.kind === 'DIPENDENTE';
  const cats = checklist.map((c) => ({ value: c.category, label: c.label }));

  const generate = async (kind) => { try { const res = await api.post(`/resources/${id}/documents/generate`, { kind }); toast(`${DOC_LABEL[kind]} generato (v${res.version})${res.has_pdf ? ', PDF pronto' : ', solo DOCX'}${(res.missing || []).length ? ` · ${res.missing.length} segnaposto da completare` : ''}`); d.reload(); } catch (e2) { toast(e2.message, 'err'); } };
  const archive = async (doc) => { try { await api.post(`/documents/${doc.id}/archive`, { category: doc.kind === 'MBO' ? 'MBO' : doc.kind === 'LETTERA_IMPEGNO' ? 'LETTERA_IMPEGNO' : 'CONTRATTO_FIRMATO', signed: false }); toast('Archiviato nel dossier'); d.reload(); } catch (e2) { toast(e2.message, 'err'); } };
  const analyzeAll = async () => {
    setAnalyzingAll(true);
    const acc = { analyzed: 0, updated: 0, report: [] };
    try {
      let after = 0, total = null;
      for (;;) {
        const r = await api.post(`/resources/${id}/attachments/analyze-all`, { only_missing: true, limit: 4, after });
        acc.analyzed += r.analyzed; acc.updated += r.updated; acc.report.push(...r.report);
        if (total === null) total = r.total;
        setAnalyzingAll(`${acc.analyzed}/${total}`);
        if (!r.remaining || !r.analyzed) break;
        after = r.last_id;
      }
      setAnalysisReport(acc); d.reload();
    } catch (e) { toast(e.message, 'err'); if (acc.analyzed) { setAnalysisReport(acc); d.reload(); } }
    setAnalyzingAll(false);
  };
  const setStatus = async (status) => { await api.put(`/resources/${id}`, { status, terminated_at: status === 'CESSATO' ? new Date().toISOString().slice(0, 10) : null }); d.reload(); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><KindBadge kind={r.kind} />{r.person_kind && r.person_kind !== r.kind && <Badge tone="blue">{PERSON_KIND[r.person_kind] || r.person_kind}</Badge>}<StatusBadge status={r.status} />{r.area_name && <Badge tone="grey" title={r.area_path}>{r.area_name}</Badge>}{(r.extra_areas || []).map((x) => <Badge key={x.id} tone="grey" title={x.path}>{x.name}</Badge>)}</div>
          <h1 style={{ marginTop: 6 }}>{r.title ? `${r.title} ` : ''}{r.first_name} {r.last_name}</h1>
          <div className="sub">{isEmp ? `${r.job_title || 'Mansione n.d.'}${r.level ? ` · ${LEVEL_LABEL[r.level] || r.level}` : ''}${r.contract_type ? ` · ${CONTRACT[r.contract_type]}` : ''}` : `${r.discipline || 'Disciplina n.d.'} · libero professionista`}{r.manager_name ? ` · riporta a ${r.manager_name}` : ''}</div>
        </div>
        <div className="row">
          {writer && isEmp && e && <button className="btn" onClick={() => generate('CONTRATTO')}><Icon name="file" />Genera contratto</button>}
          {writer && isEmp && e?.mbo_enabled && <button className="btn ghost" onClick={() => generate('MBO')}><Icon name="file" />Genera MBO</button>}
          {writer && !isEmp && lp && <button className="btn" onClick={() => generate('CONTRATTO_LP')}><Icon name="file" />Genera contratto LP</button>}
          {writer && <button className="btn ghost" onClick={() => setModal('person')}><Icon name="edit" />Modifica anagrafica</button>}
          <Link className="btn ghost" to={`/people/${r.id}`} title="Scheda della persona nell'anagrafica unica della Suite (Rubrica)">Apri in Rubrica</Link>
          <PrevNext list={siblings.data} id={r.id} />
        </div>
      </div>

      <div className="tabs">
        {[['scheda', 'Scheda'], ['dossier', `Dossier (${attachments.length})`], ['documenti', `Documenti generati (${documents.length})`], ['scadenze', `Scadenze (${deadlines.length})`], ['lettere', `Lettere di impegno (${letters.length})`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'scheda' && (<>
        <div className="grid g3 scheda" style={{ gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'stretch' }}>
          <Card title="Anagrafica">
            <Row k="Tipo" v={PERSON_KIND[r.person_kind] || r.person_kind} />
            <Row k="Sesso" v={SEX[r.sex]} />
            <Row k="Nascita" v={[r.birth_place, itDate(r.birth_date), r.birth_date ? `(${age(r.birth_date)} anni)` : ''].filter(Boolean).join(' ')} />
            <Row k="Nazionalità" v={r.nationality} />
            <Row k="Codice fiscale" v={r.tax_code} />
            <Row k="Partita IVA" v={r.vat_number} />
            <Row k="Cellulare personale" v={r.phone} /><Row k="Telefono fisso" v={[r.phone_office, r.phone_ext ? `int. ${r.phone_ext}` : ''].filter(Boolean).join(' · ')} /><Row k="Cellulare aziendale" v={r.mobile_company} />
            <Row k="Email" v={r.email} />
            <Row k="Residenza" v={[r.address, r.zip, r.city, r.province ? `(${r.province})` : ''].filter(Boolean).join(' ')} />
            <Row k="Sede" v={r.site_name} />
            {costs && <Row k="IBAN" v={r.iban} />}
            <Row k={isEmp ? 'Matricola' : 'Codice interno'} v={r.badge_number} />
            <Row k="Emergenze" v={r.emergency_contact} />
            <Row k="Area" v={r.area_path || r.area_name} />{(r.extra_areas || []).length > 0 && <Row k="Altre funzioni" v={r.extra_areas.map((x) => x.path).join(" | ")} />}
            <Row k="Riporta a" v={r.manager_id ? <Link to={`${BASE}/risorse/${r.manager_id}`}>{r.manager_name}</Link> : null} />
            <Row k="Approva ferie e permessi" v={r.approver_id ? <Link to={`${BASE}/risorse/${r.approver_id}`}>{r.approver_name}</Link> : r.manager_id ? <span>{r.manager_name} <span className="small muted">(responsabile)</span></span> : null} />
            {(d.data.org_units || []).length > 0 && <Row k="Referente di" v={<Link to={`${BASE}/organigramma`}>{d.data.org_units.map((u) => u.path).join('; ')}</Link>} />}
            <Row k="Ingresso" v={itDate(r.hired_at)} />
            <Row k="Cessazione" v={r.terminated_at ? `${r.status === 'CESSATO' ? 'dal' : 'programmata dal'} ${itDate(r.terminated_at)}${r.termination_reason ? ` · ${TERMINATION_LABEL[r.termination_reason] || r.termination_reason}` : ''}${r.termination_notes ? ` · ${r.termination_notes}` : ''}` : null} />
            {r.cv_attachment_id && <Row k="CV" v={<a href={`${API_BASE}/resources/${id}/attachments/${r.cv_attachment_id}/download?inline=1`} target="_blank" rel="noreferrer">Apri CV</a>} />}
            {r.notes && <p className="small muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
            {writer && <div className="row" style={{ marginTop: 12 }}>
              {r.status !== 'CESSATO' && !r.terminated_at && <button className="btn sm danger" onClick={() => setModal('cessa')}>Registra cessazione</button>}
              {r.terminated_at && <button className="btn sm ghost" onClick={async () => { await api.put(`/resources/${id}/reactivate`, {}); toast('Cessazione annullata'); d.reload(); }}>Annulla cessazione</button>}
              {r.status === 'CESSATO' && <button className="btn sm ghost" onClick={() => setStatus('ATTIVO')}>Riattiva</button>}
              {r.status === 'IMPEGNO' && <button className="btn sm" onClick={() => setStatus('ATTIVO')}>Segna come attivo</button>}
              {isAdmin(user) && <button className="btn sm danger" onClick={() => setModal('delete')}>Elimina</button>}
            </div>}
          </Card>
          {isEmp ? (
            <Card title="Rapporto di lavoro" actions={writer && <button className="btn sm ghost" onClick={() => setModal('employment')}>{e ? 'Modifica' : 'Inserisci'}</button>}>
              {!e ? <Empty>Dati contrattuali non ancora inseriti</Empty> : <>
                <Row k="Contratto" v={`${CONTRACT[e.contract_type]} · CCNL ${e.ccnl === 'STUDI_PROFESSIONALI' ? 'Studi Professionali' : e.ccnl.replace('_', ' ')}`} />
                <Row k="Livello / qualifica" v={`${LEVEL_LABEL[e.level] || e.level || '–'} · ${e.qualification || ''}`} />
                <Row k="Mansione" v={e.job_title} />
                <Row k="Orario" v={`${e.weekly_hours} ore su ${e.weekly_days} giorni${e.autonomous_hours ? ' · autonomia di orario' : ''}`} />
                <Row k="Decorrenza" v={itDate(e.start_date)} />
                <Row k="Scadenza" v={itDate(e.end_date)} />
                <Row k="Periodo di prova" v={`${e.probation}${e.probation_end ? ` (fino al ${itDate(e.probation_end)})` : ''}`} />
                <Row k="Sede di lavoro" v={e.work_site_name ? `${e.work_site_name}${e.work_site ? ` · ${e.work_site}` : ''}` : null} />
                <Row k="Benefit" v={(e.benefits || []).length ? e.benefits.join('; ') : 'Nessuno'} />
                <Row k="Smart working" v={e.smart_working ? 'Sì' : 'No'} />
                <Row k="Data lettera" v={itDate(e.letter_date)} />
                {e.notes && <p className="small muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{e.notes}</p>}
              </>}
            </Card>
          ) : (
            <Card title="Incarico professionale" actions={writer && <button className="btn sm ghost" onClick={() => setModal('lp')}>{lp ? 'Modifica' : 'Inserisci'}</button>}>
              {!lp ? <Empty>Dati dell'incarico non ancora inseriti</Empty> : <>
                <Row k="Disciplina" v={lp.discipline} />
                <Row k="Oggetto" v={lp.role_description} />
                <Row k="Durata" v={`${itDate(lp.start_date)} – ${itDate(lp.end_date)}${lp.auto_renew ? ` · rinnovo automatico, preavviso ${lp.notice_days} gg` : ''}`} />
                <Row k="Ordine" v={[lp.order_name, lp.order_province, lp.order_number ? `n. ${lp.order_number}` : '', lp.order_since ? `dal ${itDate(lp.order_since)}` : ''].filter(Boolean).join(' ')} />
                <Row k="Polizza RC" v={`massimale ${eur(lp.insurance_required)}${lp.insurance_policy ? ` · ${lp.insurance_policy}` : ''}${lp.insurance_expiry ? ` · scade ${itDate(lp.insurance_expiry)}` : ''}`} />
                <Row k="Titoli" v={(lp.degrees || []).join(' · ')} />
                <Row k="Regime IVA" v={lp.vat_regime} />
                <div className="subhead">Tariffario</div>
                <table className="t"><thead><tr><th>Tipo</th><th>Descrizione</th><th className="num">Importo</th><th>IVA</th></tr></thead><tbody>{(lp.fees || []).map((f, i) => <tr key={i}><td><Badge>{FEE_TYPE[f.type]}</Badge></td><td>{f.description}<div className="small muted">{f.category}{f.notes ? ` · ${f.notes}` : ''}</div></td><td className="num">{f.type === 'VARIABILE' ? `${f.amount}%` : `${eur(f.amount)}${f.unit ? `/${f.unit}` : ''}`}</td><td>{f.vat ? <Badge tone={f.vat === 'CON' ? 'blue' : 'grey'}>{FEE_VAT[f.vat]}</Badge> : <Badge tone="red">da definire</Badge>}</td></tr>)}</tbody></table>
                {lp.notes && <p className="small muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{lp.notes}</p>}
              </>}
            </Card>
          )}
            {costs && (
              <Card title="Retribuzione e costo azienda">
                {isEmp && e ? <>
                  <Row k="RAL contrattuale" v={eur(e.ral)} />
                  {(e.ral_steps || []).map((s, i) => <Row key={i} k={`RAL dal ${itDate(s.from)}`} v={eur(s.ral)} />)}
                  <Row k="RAL vigente" v={eur(r.ral_current)} />
                  <Row k="Lordo mensile" v={`${eur(payroll?.decomposition.ral_monthly)} × ${e.monthly_payments}`} />
                  <Row k="Paga base" v={eur(e.base_pay ?? payroll?.decomposition.base_pay)} />
                  <Row k={e.superminimo_absorbable ? 'Superminimo assorbibile' : 'Superminimo non assorbibile'} v={eur(e.superminimo ?? payroll?.decomposition.superminimo)} />
                  <Row k="Indennità di funzione" v={eur(e.function_allowance ?? payroll?.decomposition.function_allowance)} />
                  {e.mbo_enabled && <Row k="MBO" v={`${e.mbo_amount ? `${eur(e.mbo_amount)} annui (cifra fissa)` : `${e.mbo_pct ?? '–'}% RAL`} · esercizio ${e.mbo_year || ''}${r.cost_mbo_max ? ` · costo azienda max ${eur(r.cost_mbo_max)}` : ''}`} />}
                  <div className="totals" style={{ marginTop: 12 }}>
                    <div className="line"><span>Coefficiente di costo</span><span>{r.cost_coefficient_used}</span></div>
                    <div className="big"><span>Costo annuo</span><span className="v">{eur(r.cost_annual)}</span></div>
                    <div className="line"><span>Costo mensile</span><span>{eur(r.cost_monthly)}</span></div>
                    {(r.terminated_at || (r.hired_at && String(r.hired_at).slice(0, 4) === String(new Date().getFullYear()))) && <div className="line"><span>Costo esercizio {new Date().getFullYear()} pro rata{r.terminated_at ? ` (fino al ${itDate(r.terminated_at)})` : ''}</span><span>{eur(r.cost_year)}</span></div>}
                  </div>
                </> : !isEmp && lp ? <>
                  <Row k="Costo mensile stimato" v={eur(r.cost_monthly)} />
                  <Row k="Costo annuo stimato" v={eur(r.cost_annual)} />
                  {r.terminated_at && <Row k={`Costo esercizio ${new Date().getFullYear()} pro rata`} v={`${eur(r.cost_year)} (fino al ${itDate(r.terminated_at)})`} />}
                  <p className="small muted">Stima basata sui compensi fissi (o sul valore impostato nell'incarico); le componenti a prestazione e variabili non sono incluse.</p>
                </> : <Empty>Dati economici non disponibili</Empty>}
              </Card>
            )}
        </div>
        <Card title="Completezza del dossier" className="mt" actions={<span className="small muted">{checklist.filter((c) => c.required && !c.present).length} documenti obbligatori mancanti</span>}>
          <div className="checklist3">
            {checklist.filter((c) => c.required || c.present).map((c) => (
              <div key={c.category} className="ck"><span>{c.label}{c.renew_months ? <span className="small muted"> · rinnovo {c.renew_months} mesi</span> : ''}</span>{c.present ? <Badge tone={c.expires_at && c.expires_at < new Date().toISOString().slice(0, 10) ? 'red' : 'green'}>{c.count} doc{c.expires_at ? ` · ${itDate(c.expires_at)}` : ''}</Badge> : <Badge tone={c.required ? 'red' : 'grey'}>{c.required ? 'Mancante' : '–'}</Badge>}</div>
            ))}
          </div>
        </Card>
      </>)}

      {tab === 'dossier' && (
        <Card title="Dossier online" actions={writer && <span className="row" style={{ gap: 8 }}><button className="btn ghost" disabled={!attachments.length || analyzingAll} onClick={analyzeAll} title="Legge tutti gli allegati e compila firmato, data di rilascio e scadenza dove mancano">{analyzingAll ? `Analisi in corso… ${typeof analyzingAll === 'string' ? analyzingAll : ''}` : 'Analizza i documenti'}</button><button className="btn" onClick={() => setModal('upload')}><Icon name="upload" />Carica allegato</button></span>} flush>
          {!attachments.length ? <Empty>Nessun allegato. Carica contratto firmato, documenti d'identità, titoli, iscrizioni e certificati.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Categoria</th><th>File</th><th>Rilascio</th><th>Scadenza</th><th>Caricato</th><th className="num">Azioni</th></tr></thead>
              <tbody>{attachments.map((a) => {
                const exp = a.expires_at ? String(a.expires_at).slice(0, 10) : null;
                const tone = !exp ? 'grey' : exp < new Date().toISOString().slice(0, 10) ? 'red' : 'blue';
                return (
                  <tr key={a.id}>
                    <td><Badge tone={a.signed ? 'green' : 'grey'}>{CL[a.category] || a.category}</Badge>{a.signed && <span className="small muted"> firmato</span>}</td>
                    <td><div className="strong">{a.filename}</div><div className="small muted">{bytes(a.size)}{a.notes ? ` · ${a.notes}` : ''}</div>{a.inbox_id && <div className="small"><Badge tone="blue">dalla casella People</Badge> <span className="muted">{a.inbox_from} · {itDateTime(a.inbox_received_at)}</span></div>}{a.superseded_by && <div className="small"><Badge>sostituito da un rinnovo</Badge></div>}</td>
                    <td>{itDate(a.issued_at)}</td>
                    <td>{exp ? <Badge tone={a.superseded_by ? 'grey' : tone}>{itDate(exp)}</Badge> : <span className="muted">–</span>}</td>
                    <td className="small muted">{itDateTime(a.uploaded_at)}<br />{a.uploaded_by_name}</td>
                    <td className="num">
                      {['application/pdf', 'image/png', 'image/jpeg'].includes(a.mime) && <button className="btn sm ghost" onClick={() => setPreview({ url: `${API_BASE}/resources/${id}/attachments/${a.id}/download?inline=1`, title: a.filename, mime: a.mime })}>Anteprima</button>}{' '}
                      <a className="btn sm ghost" href={`${API_BASE}/resources/${id}/attachments/${a.id}/download`}>Scarica</a>{' '}
                      {writer && <button className="btn sm ghost" onClick={() => setModal({ editAtt: a })}>Modifica</button>}{' '}
                      {writer && <button className="iconbtn" title="Elimina dal dossier" aria-label="Elimina" onClick={() => setModal({ delAtt: a })}><Icon name="trash" /></button>}
                    </td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === 'documenti' && (
        <Card title="Documenti generati dall'applicazione" flush actions={<span className="small muted">ogni generazione crea una nuova versione; i precedenti restano in archivio</span>}>
          {!documents.length ? <Empty>Nessun documento generato. Usa i pulsanti in alto per generare contratto, MBO o contratto LP sui format aziendali.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Documento</th><th>Versione</th><th>Generato</th><th className="num">Azioni</th></tr></thead>
              <tbody>{documents.map((doc) => (
                <tr key={doc.id}>
                  <td><Badge tone="teal">{DOC_LABEL[doc.kind]}</Badge> <span className="strong">{doc.title}</span>{(doc.missing || []).length > 0 && <div className="small" style={{ color: '#9a5b00', marginTop: 4 }} title={doc.missing.join(', ')}>Con segnaposto da completare: {doc.missing.slice(0, 4).join(', ').toLowerCase()}{doc.missing.length > 4 ? ` e altri ${doc.missing.length - 4}` : ''}</div>}</td>
                  <td>v{doc.version}</td>
                  <td className="small muted">{itDateTime(doc.generated_at)}<br />{doc.generated_by_name}</td>
                  <td className="num">
                    {doc.has_pdf && <button className="btn sm ghost" onClick={() => setPreview({ url: `${API_BASE}/documents/${doc.id}/download?format=pdf&inline=1`, title: doc.title, mime: 'application/pdf' })}>Anteprima</button>}{' '}
                    {doc.has_pdf && <a className="btn sm ghost" href={`${API_BASE}/documents/${doc.id}/download?format=pdf`}>PDF</a>}{' '}
                    <a className="btn sm ghost" href={`${API_BASE}/documents/${doc.id}/download?format=docx`}>DOCX</a>{' '}
                    {writer && <button className="btn sm" onClick={() => archive(doc)}>Archivia nel dossier</button>}{' '}
                    {isAdmin(user) && <button className="iconbtn" onClick={() => setModal({ delDoc: doc })}><Icon name="trash" /></button>}
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === 'scadenze' && (
        <Card title="Scadenze della risorsa" actions={writer && <button className="btn sm" onClick={() => setModal('deadline')}>+ Scadenza manuale</button>} flush>
          {!deadlines.length ? <Empty>Nessuna scadenza calcolata o inserita</Empty> : (
            <table className="t"><thead><tr><th>Data</th><th>Scadenza</th><th>Tipo</th><th className="num">Stato</th></tr></thead>
              <tbody>{deadlines.map((x, i) => <tr key={x.key || i}><td>{itDate(x.due_date)}</td><td><div className="strong">{x.title}</div><div className="small muted">{x.detail}</div></td><td><Badge>{x.type}</Badge></td><td className="num"><Badge tone={DEADLINE_STATE[x.state]}>{x.days < 0 ? `scaduta da ${-x.days} gg` : `tra ${x.days} gg`}</Badge>{x.ref?.deadline_id && writer && <button className="btn sm link" style={{ marginLeft: 8 }} onClick={async () => { await api.put(`/resources/${id}/deadlines/${x.ref.deadline_id}`, { done: true }); d.reload(); }}>Fatto</button>}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}

      {tab === 'scadenze' && (
        <Card title="Richiami inviati dalla casella People" className="mt" flush actions={<span className="small muted">ogni scadenza e soglia di anticipo una volta sola</span>}>
          {!reminders.length ? <Empty>Nessun richiamo inviato a questa persona</Empty> : (
            <table className="t"><thead><tr><th>Inviato</th><th>Scadenza</th><th>Anticipo</th><th>Destinatari</th><th className="num">Esito</th></tr></thead>
              <tbody>{reminders.map((x) => <tr key={x.id}><td className="small">{itDateTime(x.sent_at)}</td><td><div className="strong">{x.title}</div><div className="small muted">{itDate(x.due_date)} · TD-SCAD-{x.deadline_key}</div></td><td>{x.days_before === 0 ? 'il giorno stesso' : `${x.days_before} gg prima`}</td><td className="small">{x.recipient === 'HR' ? 'HR' : 'persona'}: {x.to_email || '–'}{x.cc_email ? ` · copia ${x.cc_email}` : ''}</td><td className="num"><Badge tone={{ INVIATO: 'green', REGISTRATO: 'blue', FALLITO: 'red', SENZA_DESTINATARIO: 'amber' }[x.status]}>{x.status.toLowerCase().replace('_', ' ')}</Badge></td></tr>)}</tbody></table>
          )}
        </Card>
      )}

      {tab === 'lettere' && (
        <Card title="Lettere di impegno" flush actions={writer && isEmp && <Link className="btn sm" to={`${BASE}/scouting/lettere/nuova`}>+ Nuova lettera</Link>}>
          {!letters.length ? <Empty>Nessuna lettera di impegno</Empty> : (
            <table className="t"><thead><tr><th>Data</th><th>Proposta</th><th>Decorrenza max</th><th>Stato</th><th /></tr></thead>
              <tbody>{letters.map((l) => <tr key={l.id} className="click" onClick={() => nav(`${BASE}/scouting/lettere/${l.id}`)}><td>{itDate(l.letter_date)}</td><td>{l.job_title} · {LEVEL_LABEL[l.level] || l.level}{costs ? ` · ${eur(l.ral)}` : ''}</td><td>{itDate(l.start_by)}</td><td><Badge tone={LETTER_STATUS[l.status]?.tone}>{LETTER_STATUS[l.status]?.label}</Badge></td><td className="num"><Icon name="arrow" /></td></tr>)}</tbody></table>
          )}
        </Card>
      )}

      {modal === 'person' && <EditPerson r={r} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal === 'employment' && <EditEmployment id={id} e={e} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal === 'lp' && <EditLp id={id} lp={lp} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal === 'upload' && <UploadModal id={id} cats={cats} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal?.editAtt && <EditAttachment id={id} a={modal.editAtt} cats={cats} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {analysisReport && <Modal title="Analisi dei documenti del dossier" onClose={() => setAnalysisReport(null)} wide footer={<button className="btn" onClick={() => setAnalysisReport(null)}>Chiudi</button>}>
        <p>{analysisReport.analyzed} document{analysisReport.analyzed === 1 ? 'o letto' : 'i letti'}, {analysisReport.updated} aggiornat{analysisReport.updated === 1 ? 'o' : 'i'}. Vengono compilati solo i campi vuoti: quello che avevi già inserito resta. Controlla le righe segnalate.</p>
        {!analysisReport.analyzed && <p className="small muted">Tutti gli allegati hanno già firma, data di rilascio e scadenza compilate.</p>}
        <table className="t"><thead><tr><th>Documento</th><th>Esito</th></tr></thead><tbody>
          {analysisReport.report.map((x) => <tr key={x.id}><td><div className="strong">{x.filename}</div><div className="small muted">{CL?.[x.category] || x.category}</div></td><td className="small">{x.error ? <span style={{ color: '#b42318' }}>Errore: {x.error}</span> : x.skipped ? <span className="muted">Saltato: {x.skipped}</span> : <>{fmtRead(x.result)}{Object.keys(x.changes || {}).length ? <div className="muted">Compilati: {Object.keys(x.changes).map((k) => ({ issued_at: 'rilascio', expires_at: 'scadenza', signed: 'firmato', notes: 'note' })[k]).join(', ')}</div> : <div className="muted">Nessun campo da compilare</div>}{x.result?.mismatch && <div style={{ color: '#9a5b00' }}>Verifica: documento forse non coerente con la categoria o con la persona</div>}</>}</td></tr>)}
        </tbody></table>
      </Modal>}
      {modal?.delAtt && <ConfirmModal danger title="Elimina allegato" text={`Eliminare "${modal.delAtt.filename}" dal dossier? L'operazione è definitiva.`} confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/resources/${id}/attachments/${modal.delAtt.id}`); d.reload(); }} />}
      {modal?.delDoc && <ConfirmModal danger title="Elimina documento generato" text={`Eliminare "${modal.delDoc.title}" v${modal.delDoc.version}?`} confirmText="Elimina" onClose={() => setModal(null)} onConfirm={async () => { await api.del(`/documents/${modal.delDoc.id}`); d.reload(); }} />}
      {modal === 'deadline' && <DeadlineModal id={id} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal === 'cessa' && <TerminateModal r={r} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />}
      {modal === 'delete' && <PromptModal danger title="Elimina risorsa" label="Motivazione (tracciata nel registro)" confirmText="Elimina definitivamente" onClose={() => setModal(null)} onConfirm={async (reason) => { await api.del(`/resources/${id}`, { reason }); nav(`${BASE}/risorse`); }} />}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} wide>
          {preview.mime === 'application/pdf' ? <iframe title={preview.title} src={preview.url} style={{ width: '100%', height: '70vh', border: 0 }} /> : <img src={preview.url} alt={preview.title} style={{ maxWidth: '100%' }} />}
        </Modal>
      )}
    </div>
  );
}

function EditPerson({ r, onClose, onSaved }) {
  const [v, setV] = useState({ ...r, kind: r.person_kind || r.kind, extra_area_ids: (r.extra_areas || []).map((x) => x.id), job_title: r.kind === 'LP' ? (r.discipline || '') : (r.job_title || ''), birth_date: r.birth_date ? String(r.birth_date).slice(0, 10) : '', hired_at: r.hired_at ? String(r.hired_at).slice(0, 10) : '' });
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    // campi di public.people e di person_ext: il server li salva in un'unica transazione con audit PERSON_UPDATED della Suite
    const keys = ['kind', 'last_name', 'first_name', 'sex', 'title', 'birth_place', 'birth_date', 'tax_code', 'vat_number', 'phone', 'phone_office', 'phone_ext', 'mobile_company', 'email', 'address', 'zip', 'city', 'province', 'iban', 'badge_number', 'nationality', 'emergency_contact', 'site_id', 'area_id', 'manager_id', 'approver_id', 'notes', 'hired_at', 'job_title', 'extra_area_ids'];
    const body = Object.fromEntries(keys.map((k) => [k, v[k] === '' ? null : v[k]]));
    try { await api.put(`/resources/${r.id}`, body); onSaved(); } catch (e) { setErr(e); }
  };
  return <Modal title="Modifica anagrafica" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}><ErrorBox error={err} /><PersonForm value={v} onChange={setV} kind={r.kind} /><div className="form-grid" style={{ marginTop: 12 }}><Field label="Ruolo" help={r.kind === 'LP' ? 'Disciplina del professionista (contratto LP)' : 'Mansione indicata nel contratto di assunzione'}><input value={v.job_title || ''} onChange={(e) => setV({ ...v, job_title: e.target.value })} /></Field><Field label="Data di ingresso"><input type="date" value={v.hired_at || ''} onChange={(e) => setV({ ...v, hired_at: e.target.value })} /></Field></div></Modal>;
}

function EditEmployment({ id, e, onClose, onSaved }) {
  const sites = useApi('/work-sites');
  const [v, setV] = useState(e ? { ...e, start_date: e.start_date ? String(e.start_date).slice(0, 10) : '', end_date: e.end_date ? String(e.end_date).slice(0, 10) : '', letter_date: e.letter_date ? String(e.letter_date).slice(0, 10) : '', probation_end: e.probation_end ? String(e.probation_end).slice(0, 10) : '' } : { contract_type: 'TIND', weekly_hours: 40, weekly_days: 5, days_label: 'dal lunedì al venerdì', monthly_payments: 14, probation: 'Nessuno.', autonomous_hours: true, benefits: [], ral_steps: [], mbo_objectives: [] });
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const body = { ...v };
    delete body.resource_id; delete body.updated_at;
    for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    body.benefits = (body.benefits || []).filter(Boolean); body.ral_steps = (body.ral_steps || []).filter((s) => s.from && s.ral); body.mbo_objectives = (body.mbo_objectives || []).filter((o) => o.area || o.objective);
    try { await api.put(`/resources/${id}/employment`, body); onSaved(); } catch (e2) { setErr(e2); }
  };
  return <Modal title="Rapporto di lavoro" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}><ErrorBox error={err} /><EmploymentForm value={v} onChange={setV} sites={sites.data || []} /><div className="form-grid" style={{ marginTop: 12 }}><Field label="Data della lettera"><input type="date" value={v.letter_date || ''} onChange={(ev) => setV({ ...v, letter_date: ev.target.value })} /></Field><Field label="Coefficiente costo (override)" help="Vuoto = calcolato dalle impostazioni"><input type="number" step="0.0001" value={v.cost_coefficient ?? ''} onChange={(ev) => setV({ ...v, cost_coefficient: ev.target.value === '' ? null : Number(ev.target.value) })} /></Field></div></Modal>;
}

function EditLp({ id, lp, onClose, onSaved }) {
  const [v, setV] = useState(lp ? { ...lp, start_date: lp.start_date ? String(lp.start_date).slice(0, 10) : '', end_date: lp.end_date ? String(lp.end_date).slice(0, 10) : '', order_since: lp.order_since ? String(lp.order_since).slice(0, 10) : '', insurance_expiry: lp.insurance_expiry ? String(lp.insurance_expiry).slice(0, 10) : '', letter_date: lp.letter_date ? String(lp.letter_date).slice(0, 10) : '' } : { fees: [], degrees: [], activities: [], auto_renew: true, notice_days: 30, insurance_required: 1000000 });
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const body = { ...v }; delete body.resource_id; delete body.updated_at;
    for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    body.fees = (body.fees || []).filter((f) => f.description); if (body.fees.some((f) => !f.vat)) { setErr(new Error('Indica per ogni compenso se è con o senza IVA')); return; } body.degrees = (body.degrees || []).filter(Boolean); body.activities = (body.activities || []).filter(Boolean);
    try { await api.put(`/resources/${id}/lp`, body); onSaved(); } catch (e2) { setErr(e2); }
  };
  return <Modal title="Incarico professionale" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}><ErrorBox error={err} /><LpForm value={v} onChange={setV} /><div className="form-grid" style={{ marginTop: 12 }}><Field label="Data del contratto"><input type="date" value={v.letter_date || ''} onChange={(ev) => setV({ ...v, letter_date: ev.target.value })} /></Field></div></Modal>;
}

const fmtRead = (r) => r ? [r.doc_type ? `riconosciuto: ${r.doc_type}` : null, r.signed === true ? 'firmato' : r.signed === false ? 'non firmato' : 'firma non determinabile', r.issued_at ? `rilascio ${itDate(r.issued_at)}` : 'data di rilascio non trovata', r.expires_at ? `scadenza ${itDate(r.expires_at)}` : 'nessuna scadenza', r.holder ? `intestatario ${r.holder}` : null, r.mismatch ? 'ATTENZIONE: il documento non sembra corrispondere alla categoria o alla persona' : null].filter(Boolean).join(' · ') + (r.method === 'euristica' ? ' (lettura senza API Claude: solo date nel testo)' : '') : '';

function UploadModal({ id, cats, onClose, onSaved }) {
  const [f, setF] = useState({ category: cats[0]?.value || 'ALTRO', issued_at: '', expires_at: '', signed: false, notes: '' });
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState(null);
  // Lettura automatica del primo file: firmato, data di rilascio, scadenza (modificabili prima del salvataggio)
  const analyze = async (list, category) => {
    const file = list[0]; if (!file) return;
    setReading(true); setRead(null);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('category', category);
      const r = await api.upload(`/resources/${id}/attachments/analyze`, fd);
      setRead(r);
      setF((cur) => ({ ...cur, issued_at: cur.issued_at || r.issued_at || '', expires_at: cur.expires_at || r.expires_at || '', signed: cur.signed || r.signed === true, notes: cur.notes || (r.notes ? `Lettura automatica: ${r.notes}` : '') }));
    } catch (e) { setRead({ error: e.message }); }
    setReading(false);
  };
  const onFiles = (list) => { setFiles(list); setF((cur) => ({ ...cur, issued_at: '', expires_at: '', signed: false, notes: '' })); if (list.length) analyze(list, f.category); };
  const save = async () => {
    if (!files.length) return setErr(new Error('Seleziona almeno un file'));
    setBusy(true); setErr(null);
    try {
      let i = 0;
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file);
        // il primo file usa i campi del modulo (già proposti dalla lettura); gli altri vengono letti uno per uno dal server
        const vals = i === 0 ? f : { category: f.category, issued_at: '', expires_at: '', signed: false, notes: '' };
        for (const [k, v] of Object.entries(vals)) fd.append(k, v);
        if (i > 0) fd.append('auto', '1');
        await api.upload(`/resources/${id}/attachments`, fd); i++;
      }
      onSaved();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return <Modal title="Carica allegato nel dossier" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || reading} onClick={save}>{busy ? 'Caricamento…' : 'Carica'}</button></>}>
    <ErrorBox error={err} />
    <div className="form-grid">
      <Field label="File (PDF, immagini, Office, zip)" className="span2"><input type="file" multiple onChange={(e) => onFiles([...e.target.files])} /></Field>
      <Field label="Categoria"><select value={f.category} onChange={(e) => { setF({ ...f, category: e.target.value }); if (files.length) analyze(files, e.target.value); }}>{cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
      <Field label="Firmato" className="inline"><input type="checkbox" checked={f.signed} onChange={(e) => setF({ ...f, signed: e.target.checked })} /> documento sottoscritto</Field>
      <Field label="Data rilascio"><input type="date" value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></Field>
      <Field label="Scadenza" help="Alimenta il calendario delle scadenze"><input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></Field>
      <Field label="Note" className="span2"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </div>
    <div className="small muted" style={{ marginTop: 10 }}>
      {reading ? 'Lettura del documento in corso…' : read?.error ? <span style={{ color: '#b42318' }}>Lettura automatica non riuscita: {read.error}</span> : read ? <span>Letto dal documento: {fmtRead(read)}. Controlla e correggi prima di caricare.</span> : 'Scegliendo il file, firma, data di rilascio e scadenza vengono letti dal documento e proposti qui.'}
      {files.length > 1 && <div>Gli altri {files.length - 1} file verranno letti uno per uno al caricamento.</div>}
    </div>
  </Modal>;
}

function EditAttachment({ id, a, cats, onClose, onSaved }) {
  const [f, setF] = useState({ category: a.category, issued_at: a.issued_at ? String(a.issued_at).slice(0, 10) : '', expires_at: a.expires_at ? String(a.expires_at).slice(0, 10) : '', signed: a.signed, notes: a.notes || '' });
  const [err, setErr] = useState(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState(null);
  const save = async () => { try { await api.put(`/resources/${id}/attachments/${a.id}`, { ...f, issued_at: f.issued_at || null, expires_at: f.expires_at || null }); onSaved(); } catch (e) { setErr(e); } };
  const analyze = async () => {
    setReading(true); setRead(null);
    try { const r = await api.post(`/resources/${id}/attachments/${a.id}/analyze`, {}); setRead(r); setF((cur) => ({ ...cur, issued_at: r.issued_at || cur.issued_at, expires_at: r.expires_at || cur.expires_at, signed: cur.signed || r.signed === true, notes: cur.notes || (r.notes ? `Lettura automatica: ${r.notes}` : '') })); }
    catch (e) { setRead({ error: e.message }); }
    setReading(false);
  };
  return <Modal title={a.filename} onClose={onClose} footer={<><button className="btn ghost" disabled={reading} onClick={analyze}>{reading ? 'Lettura…' : 'Leggi dal documento'}</button><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
    <ErrorBox error={err} />
    {read && <div className="small muted" style={{ marginBottom: 10 }}>{read.error ? <span style={{ color: '#b42318' }}>Lettura non riuscita: {read.error}</span> : <>Letto dal documento: {fmtRead(read)}. I campi sono stati aggiornati: controlla e salva.</>}</div>}
    <div className="form-grid">
      <Field label="Categoria"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
      <Field label="Firmato" className="inline"><input type="checkbox" checked={f.signed} onChange={(e) => setF({ ...f, signed: e.target.checked })} /> documento sottoscritto</Field>
      <Field label="Data rilascio"><input type="date" value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></Field>
      <Field label="Scadenza"><input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></Field>
      <Field label="Note" className="span2"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </div>
  </Modal>;
}

function DeadlineModal({ id, onClose, onSaved }) {
  const [f, setF] = useState({ title: '', due_date: '', notes: '' });
  const [err, setErr] = useState(null);
  const save = async () => { try { await api.post(`/resources/${id}/deadlines`, f); onSaved(); } catch (e) { setErr(e); } };
  return <Modal title="Nuova scadenza" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
    <ErrorBox error={err} />
    <div className="form-grid"><Field label="Titolo" className="span2"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Data"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field><Field label="Note" className="span2"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
  </Modal>;
}

function TerminateModal({ r, onClose, onSaved }) {
  const isLp = r.kind === 'LP';
  const [f, setF] = useState({ terminated_at: today(), reason: isLp ? 'FINE_INCARICO' : 'DIMISSIONI', notes: '' });
  const [err, setErr] = useState(null);
  const reasons = isLp ? ['FINE_INCARICO', 'RECESSO', 'SCADENZA_TERMINE', 'RISOLUZIONE_CONSENSUALE', 'ALTRO'] : ['DIMISSIONI', 'LICENZIAMENTO', 'SCADENZA_TERMINE', 'RISOLUZIONE_CONSENSUALE', 'PENSIONAMENTO', 'ALTRO'];
  const future = f.terminated_at > today();
  const save = async () => { try { await api.put(`/resources/${r.id}/terminate`, { terminated_at: f.terminated_at, reason: f.reason, notes: f.notes || null }); onSaved(); } catch (e) { setErr(e); } };
  return (
    <Modal title="Registra cessazione" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn danger" disabled={!f.terminated_at} onClick={save}>Registra cessazione</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Decorrenza della cessazione" help={future ? 'Data futura: la risorsa resta attiva fino a quel giorno e la cessazione compare nel calendario scadenze' : 'Ultimo giorno di rapporto'}><input type="date" value={f.terminated_at} onChange={(e) => setF({ ...f, terminated_at: e.target.value })} /></Field>
        <Field label="Motivo"><select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{reasons.map((k) => <option key={k} value={k}>{TERMINATION_LABEL[k]}</option>)}</select></Field>
        <Field label="Note" className="span2"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="es. preavviso lavorato fino al…, accordo del…, TFR da liquidare" /></Field>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>La data di fine viene riportata anche sul {isLp ? 'contratto di incarico' : 'rapporto di lavoro'}; il dossier e i documenti restano consultabili.</p>
    </Modal>
  );
}

// Scorrimento tra le schede nell'ordine dell'elenco della sezione (cognome, nome)
function PrevNext({ list, id }) {
  const nav = useNavigate();
  const items = list || [];
  const i = items.findIndex((x) => x.id === id);
  const prev = i > 0 ? items[i - 1] : null;
  const next = i >= 0 && i < items.length - 1 ? items[i + 1] : null;
  React.useEffect(() => {
    const h = (ev) => { if (!ev.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return; if (ev.key === 'ArrowLeft' && prev) nav(`${BASE}/risorse/${prev.id}`); if (ev.key === 'ArrowRight' && next) nav(`${BASE}/risorse/${next.id}`); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [prev?.id, next?.id]);
  if (!items.length) return null;
  return (
    <div className="prevnext" title="Scorri le schede nell'ordine dell'elenco (Alt + frecce)">
      <button className="iconbtn nav" disabled={!prev} title={prev ? `${prev.last_name} ${prev.first_name}` : ''} onClick={() => prev && nav(`${BASE}/risorse/${prev.id}`)} aria-label="Scheda precedente"><Icon name="arrow" /></button>
      <span className="small muted">{i + 1}/{items.length}</span>
      <button className="iconbtn nav" disabled={!next} title={next ? `${next.last_name} ${next.first_name}` : ''} onClick={() => next && nav(`${BASE}/risorse/${next.id}`)} aria-label="Scheda successiva"><Icon name="arrow" /></button>
    </div>
  );
}
