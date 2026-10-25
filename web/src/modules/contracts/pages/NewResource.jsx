import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, useToast, Badge, Icon } from '../components/ui.jsx';
import { PersonForm, EmploymentForm, LpForm } from '../components/forms.jsx';
import { eur, itDate, LEVEL_LABEL, today } from '../format.js';

const STEPS_EMP = ['Tipo di risorsa', 'Percorso', 'Anagrafica e CV', 'Dati contrattuali', 'Riepilogo e generazione'];
const STEPS_LP = ['Tipo di risorsa', 'Anagrafica e CV', 'Dati dell\'incarico', 'Riepilogo e generazione'];

function Steps({ steps, cur }) {
  return <div className="steps">{steps.map((s, i) => <div key={s} className={`s ${i < cur ? 'done' : i === cur ? 'now' : ''}`}><i>{i < cur ? '✓' : i + 1}</i>{s}</div>)}</div>;
}

export default function NewResource({ letterMode = false, kind: kindProp = null }) {
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [kind, setKind] = useState(kindProp || sp.get('kind') || (letterMode ? 'DIPENDENTE' : ''));
  const [path, setPath] = useState(letterMode ? 'LETTERA' : (kindProp || sp.get('kind')) === 'LP' ? 'LP' : '');
  const [step, setStep] = useState(kind ? 1 : 0);
  const [person, setPerson] = useState({ kind: kind || 'DIPENDENTE' });
  const [emp, setEmp] = useState({ contract_type: 'TIND', weekly_hours: 40, weekly_days: 5, days_label: 'dal lunedì al venerdì', monthly_payments: 14, probation: 'Nessuno.', autonomous_hours: true, benefits: [], ral_steps: [], mbo_objectives: [], mbo_enabled: false, work_site_id: null });
  const [letter, setLetter] = useState({ contract_type: 'TIND', weekly_hours: 40, autonomous_hours: true, ral_steps: [], letter_date: today(), work_site_id: null });
  const [lp, setLp] = useState({ fees: [], degrees: [], activities: [], auto_renew: true, notice_days: 30, insurance_required: 1000000, role_description: '' });
  const [cvFile, setCvFile] = useState(null);
  const [fromLetter, setFromLetter] = useState(null); // lettera accettata selezionata
  const [generate, setGenerate] = useState(true);
  const [imported, setImported] = useState({ contract: null, mbo: null, unilav: null }); // file già sottoscritti caricati come "tempo zero"
  const [importInfo, setImportInfo] = useState([]);
  const [parsing, setParsing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const accepted = useApi(kind === 'DIPENDENTE' && path === 'CONTRATTO' ? '/scouting/letters-accepted' : null, [kind, path]);
  const sites = useApi('/work-sites');   // sedi dell'anagrafica unica (public.sites)
  // sede di lavoro predefinita: la sede principale (HEADQUARTER) dell'anagrafica unica, altrimenti la prima
  useEffect(() => {
    const list = sites.data || []; if (!list.length) return;
    const def = (list.find((x) => x.kind === 'HEADQUARTER') || list[0]).id;
    setEmp((e) => (e.work_site_id ? e : { ...e, work_site_id: def }));
    setLetter((l) => (l.work_site_id ? l : { ...l, work_site_id: def }));
  }, [sites.data]);
  // testo della sede letto da un contratto caricato: si cerca la sede corrispondente per nome o città
  const matchSite = (text) => { if (!text) return null; const t = String(text).toLowerCase(); return (sites.data || []).find((x) => [x.name, x.city, x.address].filter(Boolean).some((y) => t.includes(String(y).toLowerCase()) || String(y).toLowerCase().includes(t)))?.id || null; };
  const cvId = sp.get('cv_id');
  const cv = useApi(cvId ? `/scouting/cv?q=` : null);
  useEffect(() => {
    if (!cvId || !cv.data) return;
    const c = cv.data.find((x) => String(x.id) === cvId);
    if (c) setPerson((p) => ({ ...p, last_name: c.last_name || '', first_name: c.first_name || '', email: c.email || '', phone: c.phone || '', area_id: c.area_id || null }));
  }, [cvId, cv.data]);

  const isLp = kind === 'LP';
  const hasImport = Boolean(imported.contract || imported.mbo || imported.unilav);
  const steps = isLp ? STEPS_LP : STEPS_EMP;
  const idx = (name) => steps.indexOf(name);

  const pickKind = (k) => { setKind(k); setPerson((p) => ({ ...p, kind: k })); setStep(1); if (k === 'LP') setPath('LP'); };
  const pickPath = (p) => { setPath(p); setStep(2); };
  const useLetter = (l) => {
    setFromLetter(l);
    setPerson((p) => ({ ...p, id: l.resource_id, last_name: l.last_name, first_name: l.first_name, tax_code: l.tax_code || '', email: l.email || '', phone: l.phone || '', area_id: l.area_id || null, manager_id: l.manager_id || null, birth_place: l.birth_place || '', birth_date: l.birth_date ? String(l.birth_date).slice(0, 10) : '', sex: l.sex || '' }));
    setEmp((e) => ({ ...e, contract_type: l.contract_type || 'TIND', level: l.level || '', qualification: l.qualification || '', job_title: l.job_title || '', weekly_hours: Number(l.weekly_hours || 40), autonomous_hours: Boolean(l.autonomous_hours), ral: Number(l.ral || 0), ral_steps: l.ral_steps || [], mbo_enabled: Boolean(l.mbo_enabled), mbo_pct: l.mbo_pct, work_site_id: l.work_site_id || e.work_site_id, start_date: l.start_by ? String(l.start_by).slice(0, 10) : '' }));
    setStep(2);
  };

  const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      let resourceId; let target;
      if (isLp) {
        const r = await api.post('/resources', { person: clean({ ...person, kind: ['LP', 'MEDICO', 'SANITARIO'].includes(person.kind) ? person.kind : 'LP', status: 'ATTIVO' }), lp: { ...lp, fees: (lp.fees || []).filter((f) => f.description), degrees: (lp.degrees || []).filter(Boolean), activities: (lp.activities || []).filter(Boolean) } });
        resourceId = r.id; target = `${BASE}/risorse/${resourceId}`;
        if (cvFile) await uploadCv(resourceId);
        if (generate) await api.post(`/resources/${resourceId}/documents/generate`, { kind: 'CONTRATTO_LP' });
      } else if (path === 'LETTERA') {
        const r = await api.post('/scouting/letters', { person: fromLetter?.id ? undefined : clean({ ...person, kind: person.kind === 'DIRIGENTE' ? 'DIRIGENTE' : 'DIPENDENTE', status: 'IMPEGNO' }), resource_id: person.id || undefined, cv_id: cvId || undefined, letter: { ...letter, ral_steps: (letter.ral_steps || []).filter((s) => s.from && s.ral) }, generate });
        resourceId = r.resource_id; target = `${BASE}/scouting/lettere/${r.id}`;
        if (cvFile) await uploadCv(resourceId);
      } else {
        const e = { ...emp, benefits: (emp.benefits || []).filter(Boolean), ral_steps: (emp.ral_steps || []).filter((s) => s.from && s.ral), mbo_objectives: emp.mbo_enabled ? (emp.mbo_objectives || []).filter((o) => o.area || o.objective) : [] };
        if (fromLetter?.id) {
          resourceId = fromLetter.resource_id;
          await api.put(`/resources/${resourceId}`, clean({ ...person, id: undefined, kind: emp.contract_type === 'DIRIGENTE' || person.kind === 'DIRIGENTE' ? 'DIRIGENTE' : 'DIPENDENTE', status: 'ATTIVO', hired_at: emp.start_date || null }));
          await api.put(`/resources/${resourceId}/employment`, e);
          await api.put(`/scouting/letters/${fromLetter.id}`, { status: 'CONVERTITA' });
        } else {
          const r = await api.post('/resources', { person: clean({ ...person, kind: emp.contract_type === 'DIRIGENTE' || person.kind === 'DIRIGENTE' ? 'DIRIGENTE' : 'DIPENDENTE', status: 'ATTIVO' }), employment: e });
          resourceId = r.id;
        }
        target = `${BASE}/risorse/${resourceId}`;
        if (cvFile) await uploadCv(resourceId);
        await uploadImported(resourceId);
        if (generate) {
          await api.post(`/resources/${resourceId}/documents/generate`, { kind: 'CONTRATTO' });
          if (emp.mbo_enabled) await api.post(`/resources/${resourceId}/documents/generate`, { kind: 'MBO' });
        }
      }
      toast('Persona salvata nell\'anagrafica unica' + (generate ? ' e documenti generati' : ''));
      nav(target);
    } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  const uploadImported = async (id) => {
    const items = [['contract', 'CONTRATTO_FIRMATO', emp.letter_date || emp.start_date], ['mbo', 'MBO', emp.letter_date], ['unilav', 'UNILAV', emp.start_date]];
    for (const [key, category, issued] of items) {
      const f = imported[key]; if (!f) continue;
      const fd = new FormData(); fd.append('file', f); fd.append('category', category); fd.append('signed', 'true'); if (issued) fd.append('issued_at', issued); fd.append('notes', 'Documento già sottoscritto, caricato all\'inserimento (tempo zero)');
      await api.upload(`/resources/${id}/attachments`, fd);
    }
  };
  const importFile = async (slot, file) => {
    if (!file) return;
    setParsing(slot); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.upload('/resources/parse-document', fd);
      const notes = [...(r.notes || [])];
      if (r.detected === 'SCONOSCIUTO') notes.push('Formato non riconosciuto: il file viene comunque allegato al dossier');
      const key = r.detected === 'MBO' ? 'mbo' : r.detected === 'UNILAV' ? 'unilav' : 'contract';
      if (key !== slot && r.detected !== 'SCONOSCIUTO') notes.push(`Il file è stato riconosciuto come ${r.detected === 'MBO' ? 'piano MBO' : r.detected === 'UNILAV' ? 'comunicazione UNILAV' : 'contratto'}`);
      setImported((x) => ({ ...x, [r.detected === 'SCONOSCIUTO' ? slot : key]: file }));
      setKind('DIPENDENTE'); setPath('CONTRATTO'); setGenerate(false);
      const fill = (prev, data) => { const out = { ...prev }; for (const [k, v] of Object.entries(data || {})) if (v !== null && v !== undefined && v !== '') out[k] = v; return out; };
      setPerson((p) => fill({ ...p, kind: 'DIPENDENTE' }, r.person));
      setEmp((e) => { const data = { ...(r.employment || {}) }; if (data.work_site) { const sid = matchSite(data.work_site); if (sid) data.work_site_id = sid; delete data.work_site; } if (r.detected === 'MBO') { delete data.letter_date; if (data.mbo_fixed_amount) { data.mbo_amount = data.mbo_fixed_amount; } delete data.mbo_fixed_amount; } const n = fill(e, data); if (r.detected === 'MBO') n.mbo_enabled = true; return n; });
      const label = r.detected === 'MBO' ? 'Piano MBO' : r.detected === 'UNILAV' ? 'UNILAV' : r.detected === 'CONTRATTO_DIRIGENTE' ? 'Contratto dirigente' : 'Contratto';
      setImportInfo((l) => [...l, `${label} "${r.filename}" letto${r.method === 'ocr' ? ' con OCR (scansione: verifica i dati)' : ''}. ${notes.join('. ')}`]);
      setStep(2);
      toast(`${label} letto: controlla e completa i dati`);
    } catch (e2) { setErr(e2); }
    setParsing(null);
  };
  const uploadCv = async (id) => { const fd = new FormData(); fd.append('file', cvFile); fd.append('category', 'CV'); fd.append('set_cv', 'true'); await api.upload(`/resources/${id}/attachments`, fd); };

  const personOk = person.last_name && person.first_name;
  const dataOk = true; // i dati contrattuali possono restare incompleti: nel documento compaiono come segnaposto [CAMPO]
  const missingList = (() => {
    const m = [];
    if (!person.birth_place) m.push('luogo di nascita'); if (!person.birth_date) m.push('data di nascita'); if (!person.tax_code) m.push('codice fiscale'); if (!person.address || !person.city) m.push('indirizzo di residenza');
    if (isLp) { if (!lp.discipline) m.push('disciplina'); if (!person.vat_number) m.push('partita IVA'); if (!lp.order_name) m.push('ordine'); if (!lp.order_number) m.push('numero di iscrizione'); if (!lp.start_date) m.push('data di inizio'); if (!(lp.fees || []).some((f) => f.description)) m.push('compensi'); if ((lp.fees || []).some((f) => f.description && !f.vat)) m.push('IVA sui compensi (con / senza)'); }
    else if (path === 'LETTERA') { if (!letter.job_title) m.push('mansione'); if (!letter.level) m.push('livello'); if (!letter.ral) m.push('RAL'); if (!letter.start_by) m.push('decorrenza massima'); }
    else { if (!emp.job_title) m.push('mansione'); if (!emp.level && emp.contract_type !== 'DIRIGENTE') m.push('livello'); if (!emp.ral) m.push('RAL'); if (!emp.start_date) m.push('data di assunzione'); if (!emp.probation) m.push('periodo di prova'); }
    return m;
  })();

  return (
    <div className="page">
      <div className="page-head"><div><h1>{letterMode ? 'Nuova lettera di impegno' : 'Inserimento nuova risorsa'}</h1><div className="sub">{letterMode ? 'Il percorso guida raccoglie i dati e genera la lettera sul format aziendale (DOCX e PDF).' : 'Il percorso guida raccoglie i dati e genera i documenti sui format aziendali (DOCX e PDF). Per i rapporti già in essere, carica il contratto firmato: i dati vengono letti e il file archiviato nel dossier.'}</div></div>
        {!letterMode && (
          <div className="row">
            <label className={`btn ghost ${parsing ? 'disabled' : ''}`} title="PDF o DOCX del contratto già sottoscritto: i dati vengono letti e precompilati"><Icon name="upload" />{parsing === 'contract' ? 'Lettura in corso…' : imported.contract ? `Contratto: ${imported.contract.name}` : 'Carica PDF contratto'}<input type="file" accept=".pdf,.docx,application/pdf" style={{ display: 'none' }} disabled={Boolean(parsing)} onChange={(e) => { importFile('contract', e.target.files?.[0]); e.target.value = ''; }} /></label>
            <label className={`btn ghost ${parsing ? 'disabled' : ''}`} title="PDF o DOCX del piano MBO firmato"><Icon name="upload" />{parsing === 'mbo' ? 'Lettura in corso…' : imported.mbo ? `MBO: ${imported.mbo.name}` : 'Carica PDF MBO'}<input type="file" accept=".pdf,.docx,application/pdf" style={{ display: 'none' }} disabled={Boolean(parsing)} onChange={(e) => { importFile('mbo', e.target.files?.[0]); e.target.value = ''; }} /></label>
          </div>
        )}
      </div>
      {importInfo.length > 0 && <div className="alert info" style={{ display: 'block', marginBottom: 14 }}>{importInfo.map((t, i) => <div key={i}>{t}</div>)}<div className="small muted" style={{ marginTop: 4 }}>I file caricati vengono archiviati nel dossier come documenti firmati al salvataggio; la generazione dei nuovi documenti è disattivata (riattivabile nel riepilogo).</div></div>}
      <Steps steps={steps} cur={step} />
      <ErrorBox error={err} />

      {step === 0 && (
        <div className="grid g2">
          <Card title="Dipendente"><p>Rapporto di lavoro subordinato con CCNL Studi Professionali: lettera di impegno all'assunzione o contratto di assunzione (con eventuale piano MBO).</p><button className="btn" onClick={() => pickKind('DIPENDENTE')}>Dipendente <Icon name="arrow" /></button></Card>
          <Card title="Libero professionista"><p>Incarico di prestazione professionale con tariffario, iscrizione all'ordine e polizza RC: contratto generato dal format LP.</p><button className="btn" onClick={() => pickKind('LP')}>Libero professionista <Icon name="arrow" /></button></Card>
        </div>
      )}

      {!isLp && step === 1 && (
        <div className="grid g2">
          <Card title="Lettera di impegno all'assunzione"><p>Proposta formale con livello, mansione, RAL e decorrenza massima. La risorsa entra in stato "in impegno"; all'accettazione i dati passano al contratto senza reinserimento.</p><button className="btn" onClick={() => pickPath('LETTERA')}>Lettera di impegno <Icon name="arrow" /></button></Card>
          <Card title="Contratto di assunzione"><p>Lettera di assunzione a tempo indeterminato/determinato o apprendistato. Se esiste una lettera di impegno accettata, i dati vengono recuperati.</p><button className="btn" onClick={() => pickPath('CONTRATTO')}>Contratto di assunzione <Icon name="arrow" /></button></Card>
        </div>
      )}

      {!isLp && step === 2 && path === 'CONTRATTO' && !fromLetter && !hasImport && (accepted.data || []).length > 0 && (
        <Card title="Lettere di impegno accettate" className="no-print" actions={<span className="small muted">verifica automatica</span>}>
          <p>Ci sono lettere di impegno accettate non ancora convertite in assunzione. Seleziona quella della persona da assumere per recuperare tutti i dati, oppure prosegui con un inserimento nuovo.</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>Persona</th><th>Mansione</th><th>Livello</th><th className="num">RAL</th><th>Decorrenza max</th><th /></tr></thead>
            <tbody>{accepted.data.map((l) => <tr key={l.id}><td className="strong">{l.last_name} {l.first_name}</td><td>{l.job_title}</td><td>{LEVEL_LABEL[l.level] || l.level}</td><td className="num">{eur(l.ral)}</td><td>{itDate(l.start_by)}</td><td className="num"><button className="btn sm" onClick={() => useLetter(l)}>Recupera i dati</button></td></tr>)}</tbody></table></div>
          <div style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setFromLetter({ none: true })}>Prosegui senza lettera</button></div>
        </Card>
      )}

      {((isLp && step === 1) || (!isLp && step === 2 && (path === 'LETTERA' || fromLetter || hasImport || !(accepted.data || []).length))) && (
        <Card title="Anagrafica e CV">
          {fromLetter?.id && <div className="alert ok" style={{ marginBottom: 12 }}>Dati recuperati dalla lettera di impegno del {itDate(fromLetter.letter_date)} (accettata il {itDate(fromLetter.accepted_at)}).</div>}
          <PersonForm value={person} onChange={setPerson} kind={kind} />
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="CV in PDF" help="Va nel dossier della risorsa"><input type="file" accept="application/pdf" onChange={(e) => setCvFile(e.target.files?.[0] || null)} /></Field>
          </div>
          <div className="row end" style={{ marginTop: 16 }}><button className="btn ghost" onClick={() => setStep(step - 1)}>Indietro</button><button className="btn" disabled={!personOk} onClick={() => setStep(step + 1)}>Avanti</button></div>
        </Card>
      )}

      {((isLp && step === 2) || (!isLp && step === 3)) && (
        <Card title={isLp ? 'Dati dell\'incarico' : path === 'LETTERA' ? 'Condizioni proposte' : 'Dati contrattuali'}>
          {isLp ? <LpForm value={lp} onChange={setLp} /> : path === 'LETTERA' ? <EmploymentForm value={letter} onChange={setLetter} letter sites={sites.data || []} /> : <EmploymentForm value={emp} onChange={setEmp} sites={sites.data || []} />}
          <div className="row end" style={{ marginTop: 16 }}><button className="btn ghost" onClick={() => setStep(step - 1)}>Indietro</button><button className="btn" disabled={!dataOk} onClick={() => setStep(step + 1)}>Avanti</button></div>
        </Card>
      )}

      {((isLp && step === 3) || (!isLp && step === 4)) && (
        <Card title="Riepilogo">
          <div className="grid g2">
            <div>
              <h3>Persona</h3>
              <p><b>{person.last_name} {person.first_name}</b> {person.sex && <Badge>{person.sex === 'F' ? 'Donna' : 'Uomo'}</Badge>}<br />{person.birth_place} {person.birth_date ? itDate(person.birth_date) : ''}<br />{person.tax_code}<br />{person.email} {person.phone}</p>
            </div>
            <div>
              <h3>{isLp ? 'Incarico' : path === 'LETTERA' ? 'Proposta' : 'Contratto'}</h3>
              {isLp ? <p>{lp.discipline}<br />dal {itDate(lp.start_date)} al {itDate(lp.end_date)}<br />{(lp.fees || []).filter((f) => f.description).length} voci di compenso</p>
                : path === 'LETTERA' ? <p>{letter.job_title} · {LEVEL_LABEL[letter.level] || letter.level}<br />RAL {eur(letter.ral)}{(letter.ral_steps || []).filter((s) => s.from).map((s) => ` → ${eur(s.ral)} dal ${itDate(s.from)}`)}<br />decorrenza non oltre il {itDate(letter.start_by)}</p>
                  : <p>{emp.job_title} · {emp.contract_type === 'DIRIGENTE' ? 'Dirigente (CCNL Dirigenti Industria)' : (LEVEL_LABEL[emp.level] || emp.level)}<br />RAL {eur(emp.ral)} su {emp.monthly_payments} mensilità{(emp.ral_steps || []).filter((s) => s.from).map((s) => ` → ${eur(s.ral)} dal ${itDate(s.from)}`)}<br />dal {itDate(emp.start_date)} · {emp.weekly_hours} ore · prova: {emp.probation}{emp.mbo_enabled ? ` · MBO ${emp.mbo_amount ? eur(emp.mbo_amount) + ' annui' : (emp.mbo_pct ?? '–') + '%'}` : ''}</p>}
            </div>
          </div>
          {missingList.length > 0 && <div className="alert" style={{ marginTop: 12, display: 'block', background: '#fff6e5', border: '1px solid #f0d9a8', color: '#7a4a00', borderRadius: 10, padding: '10px 14px' }}>Dati non inseriti: {missingList.join(', ')}. Puoi salvare comunque: nel DOCX e nel PDF compariranno come segnaposto tra parentesi quadre (es. [CODICE FISCALE]) da completare in Word o rigenerando il documento dopo aver completato la scheda.</div>}
          {(imported.contract || imported.mbo || imported.unilav) && <div className="alert ok" style={{ marginTop: 12, display: 'block' }}>Documenti già sottoscritti che verranno archiviati nel dossier: {[imported.contract && `contratto (${imported.contract.name})`, imported.mbo && `MBO (${imported.mbo.name})`, imported.unilav && `UNILAV (${imported.unilav.name})`].filter(Boolean).join(', ')}.</div>}
          <label className="f inline" style={{ marginTop: 10 }}><input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} /> Genera subito i documenti (DOCX e PDF) sui format aziendali{!isLp && path === 'CONTRATTO' && emp.mbo_enabled ? ': contratto e piano MBO' : ''}</label>
          <div className="row end" style={{ marginTop: 16 }}><button className="btn ghost" onClick={() => setStep(step - 1)}>Indietro</button><button className="btn lg" disabled={busy} onClick={save}>{busy ? 'Salvataggio…' : 'Salva e genera'}</button></div>
        </Card>
      )}
    </div>
  );
}
