import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, fileUrl } from '../api.js';
import { base } from '../paths.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, MoneyInput, useToast } from '../components/ui.jsx';
import { eur, today, DOC_TYPE, PAY_METHOD, CHECKS, TIER, ROLE_SIGNER } from '../format.js';
import { amountToWords, validIban, normalizeIban, prettyIban } from '../words.js';

const EMPTY = {
  request_date: today(), requester: '', cost_center: '',
  beneficiary_name: '', beneficiary_tax_id: '', beneficiary_iban: '', beneficiary_bic: '', beneficiary_bank: '',
  amount: '', purpose: '', doc_type: 'FATTURA', doc_other: '', doc_number: '', doc_date: '',
  bank_account_id: '', payment_method: 'SEPA', payment_method_other: '', value_date: '',
  single_signer: '', board_number: '', board_date: '', prior_approval: false, prior_approval_ref: '',
  checks: { budget: false, aggregation: false, documents: false, related_party: false, cfo_consent: false, iban_verified: false },
  iban_verified_note: '', notes: '',
};

export default function RequestForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const cfg = useApi('/settings');
  const banks = useApi('/bank-accounts');
  const existing = useApi(id ? `/requests/${id}` : null);
  const [f, setF] = useState({ ...EMPTY, requester: `${user.full_name} · Finance` });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sugg, setSugg] = useState([]);
  const [known, setKnown] = useState(null); // beneficiario riconosciuto in anagrafica
  const [nameTouched, setNameTouched] = useState(false); // i suggerimenti compaiono solo dopo che l'utente scrive (non all'apertura in modifica)
  useEffect(() => {
    if (existing.data) {
      const r = existing.data;
      if (!r.editable) { nav(`${base}/istanze/${r.id}`, { replace: true }); return; }
      setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, r[k] ?? EMPTY[k]])), checks: { ...EMPTY.checks, ...(r.checks || {}) }, bank_account_id: r.bank_account_id || '' });
    }
  }, [existing.data]); // eslint-disable-line
  useEffect(() => { if (banks.data?.length && !f.bank_account_id && !id) setF((x) => ({ ...x, bank_account_id: banks.data[0].id })); }, [banks.data]); // eslint-disable-line

  const s = cfg.data?.settings || {};
  const single = Number(s.threshold_single || 50000); const joint = Number(s.threshold_joint || 250000);
  const amount = Number(f.amount || 0);
  const tier = !amount ? null : amount <= single ? 'SINGOLA' : amount <= joint ? 'CONGIUNTA' : 'CDA';
  const ibanOk = f.beneficiary_iban ? validIban(f.beneficiary_iban) : null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setCheck = (k, v) => setF((x) => ({ ...x, checks: { ...x.checks, [k]: v } }));

  // Suggerimenti dall'anagrafica beneficiari
  useEffect(() => {
    const t = setTimeout(async () => {
      const qv = f.beneficiary_name.trim();
      if (qv.length < 3) return setSugg([]);
      try { setSugg(await api.get(`/beneficiaries?q=${encodeURIComponent(qv)}`)); } catch { setSugg([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [f.beneficiary_name]);
  const pick = (b) => {
    const ib = (b.ibans || [])[0];
    setF((x) => ({ ...x, beneficiary_name: b.name, beneficiary_tax_id: b.tax_id || x.beneficiary_tax_id, beneficiary_iban: ib?.iban || x.beneficiary_iban, beneficiary_bic: ib?.bic || x.beneficiary_bic, beneficiary_bank: ib?.bank || x.beneficiary_bank }));
    setKnown(b); setSugg([]);
  };
  const ibanStatus = useMemo(() => {
    if (!known || !f.beneficiary_iban) return null;
    const ib = (known.ibans || []).find((i) => i.iban === normalizeIban(f.beneficiary_iban));
    if (!ib) return { tone: 'red', text: 'IBAN diverso da quelli già noti per questo beneficiario: variazione da confermare tramite canale indipendente.' };
    if (!ib.verified_at) return { tone: 'mauve', text: 'IBAN già usato ma mai confermato tramite canale indipendente.' };
    return { tone: 'green', text: `IBAN confermato: ${ib.verified_note}` };
  }, [known, f.beneficiary_iban]);

  const save = async (andSubmit) => {
    setBusy(true); setErr(null);
    try {
      const body = { ...f, amount: Number(f.amount), bank_account_id: f.bank_account_id || null, single_signer: tier === 'SINGOLA' ? f.single_signer || null : null };
      const r = id ? await api.put(`/requests/${id}`, body) : await api.post('/requests', body);
      toast(id ? 'Istanza aggiornata' : 'Istanza salvata in bozza');
      nav(`${base}/istanze/${r.id}${andSubmit ? '?invia=1' : ''}`);
    } catch (e) { setErr(e); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    setBusy(false);
  };

  if (id && !existing.data) return <div className="page">{existing.error ? <ErrorBox error={existing.error} /> : <Loading />}</div>;
  const inFirma = existing.data?.status === 'IN_FIRMA';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{id ? `Modifica istanza ${existing.data.protocol || `#${id}`}` : 'Nuova istanza di autorizzazione al pagamento'}</h1>
          <div className="sub">Replica digitale del modulo "Autorizzazione congiunta al pagamento CEO e CFO". Lo scaglione e le firme richieste si calcolano dall'importo.</div></div>
        <div className="row"><Link className="btn ghost" to={id ? `${base}/istanze/${id}` : `${base}/istanze`}>Annulla</Link><button className="btn" disabled={busy} onClick={() => save(false)}>{id ? 'Salva modifiche' : 'Salva bozza'}</button></div>
      </div>
      <ErrorBox error={err} />
      {err?.errors?.length ? <ul className="alert err" style={{ margin: '8px 0 0', paddingLeft: 30 }}>{err.errors.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      {inFirma && <div className="alert warn" style={{ marginTop: 12 }}>L'istanza è in firma senza firme apposte: salvando le modifiche i link già inviati vengono annullati e CEO e CFO ricevono una nuova email con la versione aggiornata.</div>}

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Intestazione">
            <div className="form-grid">
              <Field label="Data richiesta"><input type="date" value={f.request_date} onChange={(e) => set('request_date', e.target.value)} /></Field>
              <Field label="Richiedente / Funzione"><input value={f.requester} onChange={(e) => set('requester', e.target.value)} /></Field>
              <Field label="Centro di costo / voce di budget"><input value={f.cost_center} onChange={(e) => set('cost_center', e.target.value)} placeholder="es. Laboratorio HUB · reagenti" /></Field>
            </div>
          </Card>

          <Card title="1. Dati del pagamento">
            <div className="form-grid">
              <Field label="Beneficiario (ragione sociale / nome)" className="span2" help={known ? `Beneficiario in anagrafica: ${known.requests} istanze, autorizzato ${eur(known.total_authorized)}` : 'Inizia a scrivere: l\'anagrafica propone i beneficiari già censiti con le loro coordinate'}>
                <div style={{ position: 'relative' }}>
                  <input value={f.beneficiary_name} onChange={(e) => { set('beneficiary_name', e.target.value); setKnown(null); setNameTouched(true); }} onBlur={() => setTimeout(() => setSugg([]), 150)} autoComplete="off" />
                  {sugg.length > 0 && !known && nameTouched && (
                    <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: 40, maxHeight: 220, overflow: 'auto' }}>
                      {sugg.map((b) => <div key={b.id} className="click" style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onMouseDown={() => pick(b)}><b>{b.name}</b> <span className="small muted">{b.tax_id || ''} · {(b.ibans || [])[0]?.iban || 'nessun IBAN'}</span></div>)}
                    </div>
                  )}
                </div>
              </Field>
              <Field label="P.IVA / Codice Fiscale"><input value={f.beneficiary_tax_id} onChange={(e) => set('beneficiary_tax_id', e.target.value.toUpperCase())} /></Field>
              <Field label="IBAN beneficiario" className="span2" help={ibanOk === false ? 'IBAN non valido (controllo formale)' : ibanOk ? prettyIban(f.beneficiary_iban) : ''}>
                <input value={f.beneficiary_iban} onChange={(e) => set('beneficiary_iban', e.target.value.toUpperCase())} className={ibanOk === false ? 'mono' : 'mono'} style={ibanOk === false ? { borderColor: 'var(--red)' } : undefined} />
              </Field>
              <Field label="Banca beneficiario"><input value={f.beneficiary_bank} onChange={(e) => set('beneficiary_bank', e.target.value)} /></Field>
              <Field label="BIC / SWIFT"><input value={f.beneficiary_bic} onChange={(e) => set('beneficiary_bic', e.target.value.toUpperCase())} /></Field>
              {ibanStatus && <div className={`alert ${ibanStatus.tone === 'green' ? 'ok' : ibanStatus.tone === 'red' ? 'err' : 'warn'} span2`} style={{ gridColumn: '1 / -1' }}>{ibanStatus.text}</div>}
              <Field label="Importo in cifre (€)"><MoneyInput value={f.amount} onChange={(v) => set('amount', v)} /></Field>
              <Field label="Importo in lettere" className="span2"><input value={amount ? `Euro ${amountToWords(amount)}` : ''} readOnly disabled /></Field>
              <Field label="Causale" className="span2" style={{ gridColumn: '1 / -1' }}><textarea value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="es. Saldo fattura n. 123 del 10/10/2026 – fornitura analizzatore ematologico" /></Field>
              <Field label="Documento di riferimento"><select value={f.doc_type} onChange={(e) => set('doc_type', e.target.value)}>{Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {f.doc_type === 'ALTRO' && <Field label="Specifica"><input value={f.doc_other} onChange={(e) => set('doc_other', e.target.value)} /></Field>}
              <Field label="Numero documento"><input value={f.doc_number} onChange={(e) => set('doc_number', e.target.value)} /></Field>
              <Field label="Data documento"><input type="date" value={f.doc_date || ''} onChange={(e) => set('doc_date', e.target.value)} /></Field>
              <Field label="Conto di addebito" className="span2"><select value={f.bank_account_id} onChange={(e) => set('bank_account_id', e.target.value ? Number(e.target.value) : '')}><option value="">—</option>{(banks.data || []).map((b) => <option key={b.id} value={b.id}>{b.bank_name} · {prettyIban(b.iban)}</option>)}</select></Field>
              <Field label="Modalità di pagamento"><select value={f.payment_method} onChange={(e) => set('payment_method', e.target.value)}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {f.payment_method === 'ALTRO' && <Field label="Specifica"><input value={f.payment_method_other} onChange={(e) => set('payment_method_other', e.target.value)} /></Field>}
              <Field label="Data valuta / esecuzione richiesta"><input type="date" value={f.value_date || ''} onChange={(e) => set('value_date', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="2. Scaglione applicabile">
            {!tier ? <div className="muted">Inserisci l'importo: lo scaglione viene calcolato in automatico.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row"><Badge tone={TIER[tier].tone}>{TIER[tier].label}</Badge>
                  <span className="small muted">{tier === 'SINGOLA' ? `Fino a ${eur(single)}: firma singola dell'AD o del CFO, se l'operazione è a budget o deriva da obblighi già autorizzati.` : tier === 'CONGIUNTA' ? `Oltre ${eur(single)} e fino a ${eur(joint)}: autorizzazione congiunta AD + CFO.` : `Oltre ${eur(joint)}: preventiva approvazione del CdA e firma congiunta AD + CFO.`}</span></div>
                {tier === 'SINGOLA' && (
                  <Field label="Chi firma"><div className="seg">{['CEO', 'CFO'].map((r) => <label key={r} className={f.single_signer === r ? 'on' : ''}><input type="radio" checked={f.single_signer === r} onChange={() => set('single_signer', r)} />{ROLE_SIGNER[r]}</label>)}</div></Field>
                )}
                {tier === 'CDA' && (
                  <div className="form-grid">
                    <Field label="Delibera CdA n."><input value={f.board_number} onChange={(e) => set('board_number', e.target.value)} disabled={f.prior_approval} /></Field>
                    <Field label="del"><input type="date" value={f.board_date || ''} onChange={(e) => set('board_date', e.target.value)} disabled={f.prior_approval} /></Field>
                  </div>
                )}
                <Field className="inline"><input type="checkbox" checked={f.prior_approval} onChange={(e) => set('prior_approval', e.target.checked)} /> Pagamento di paghe, imposte, contributi, rate di debito o altro pagamento già specificamente approvato: non è richiesta una nuova approvazione del CdA per la mera esecuzione; si applicano i poteri di firma corrispondenti all'importo.</Field>
                {f.prior_approval && <Field label="Estremi dell'approvazione"><input value={f.prior_approval_ref} onChange={(e) => set('prior_approval_ref', e.target.value)} placeholder="es. delibera CdA n. 12 del 14/10/2026, punto 6; contratto preliminare del…" /></Field>}
              </div>
            )}
          </Card>

          <Card title="3. Verifiche preliminari">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CHECKS.map(([k, label]) => <Field key={k} className="inline" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={Boolean(f.checks[k])} onChange={(e) => setCheck(k, e.target.checked)} style={{ marginTop: 3 }} /> <span>{label}</span></Field>)}
              <Field label="Conferma delle coordinate bancarie (obbligatoria se IBAN nuovo o variato)" help="Come è stato confermato l'IBAN tramite canale indipendente: telefonata al numero noto del fornitore, PEC, contratto firmato…"><input value={f.iban_verified_note} onChange={(e) => set('iban_verified_note', e.target.value)} /></Field>
              <Field label="Note interne (non compaiono sul modulo)"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </div>
          </Card>
        </div>

        <div className="side-col" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="totals">
            <div className="line"><span>Importo</span><b>{amount ? eur(amount) : '–'}</b></div>
            <div className="line"><span>Scaglione</span><b>{tier ? TIER[tier].label : '–'}</b></div>
            <div className="line"><span>Firme richieste</span><b>{!tier ? '–' : tier === 'SINGOLA' ? (f.single_signer ? ROLE_SIGNER[f.single_signer] : 'da scegliere') : 'AD + CFO'}</b></div>
            {tier === 'CDA' && <div className="line"><span>Delibera CdA</span><b>{f.prior_approval ? 'già approvato' : f.board_number ? `n. ${f.board_number}` : 'richiesta'}</b></div>}
            <div className="big"><span>Verifiche</span><span className="v">{Object.values(f.checks).filter(Boolean).length}/6</span></div>
            <div className="small" style={{ color: '#9cc4cc' }}>Dopo il salvataggio carichi gli allegati e invii in firma dalla scheda dell'istanza. Fino alla prima firma puoi ancora modificare tutto.</div>
          </div>
          <Card title="Cosa succede dopo">
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Salvi la bozza e alleghi fattura, contratto, ordine, SAL o delibera.</li>
              <li>Invii in firma: l'istanza riceve il protocollo e CEO e CFO ricevono l'email da amministrazione@toscanadiagnostica.it con il link personale.</li>
              <li>Ciascuno firma con accesso Microsoft 365: data, ora e identità restano registrate. Può anche rifiutare con motivazione.</li>
              <li>A firme complete l'app genera il modulo PDF firmato e lo archivia; tu registri CRO/TRN dopo l'esecuzione in banca.</li>
            </ol>
          </Card>
        </div>
      </div>
      <div className="row end" style={{ marginTop: 16 }}><Link className="btn ghost" to={id ? `${base}/istanze/${id}` : `${base}/istanze`}>Annulla</Link><button className="btn" disabled={busy} onClick={() => save(false)}>{id ? 'Salva modifiche' : 'Salva bozza'}</button></div>
    </div>
  );
}
