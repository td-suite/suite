import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, BASE, API_BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, MoneyInput, useToast, Icon, UploadButton, Badge } from '../components/ui.jsx';
import { ORG_KIND } from '../components/OrgExtForm.jsx';
import { today, KIND, DAYS, FEE_VAT, FEE_PERIOD, FEE_BASE, FEE_KIND, SITE_TYPE, RENT_PERIOD, bytes } from '../format.js';

const EMPTY = {
  PP: { fee: { items: [{ kind: 'PERCENT', percent: '', base: 'PUNTO_PRELIEVI', base_other: '', include_ssr: false, amount: '', period: 'MESE', purpose: '', vat: 'PIU_IVA', closing: true, text: '' }] }, services: { nursing: 'TD', reception: 'HOST' }, duration_years: 3, duvri_costs_clause: '' },
  SRV: { site_name: '', site_address: '', client_ds: '', vat_exemption: null, payment_terms: '', pickup: { site: '', street: '', city: '', contact: '', phone: '', email: '', days: DAYS.slice(0, 6).map(() => ({ mode: 'NO', time_from: '', time_to: '' })) }, interface_solution: null, privacy: { role: null, principal: '', measures: '', dpo_name: '', dpo_contact: '' } },
  MDL: { service_email: '', service_contact: '', service_phone: '', invoice_email: '', doctor_name: '', doctor_email: '', vat_exemption: null, payment_terms: '', privacy: { role: null, principal: '', measures: '', dpo_name: '', dpo_contact: '' } },
  SEDE: { site_type: 'PUNTO_PRELIEVI', rent: { amount: '', period: 'MESE', vat: 'PIU_IVA', deposit: '', duration_years: 6, renewal_years: 6, notice_months: 12, istat: true, expenses: '', registration: '', notes: '' } },
};
const deepMerge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v; return o; };

export default function ContractForm() {
  const { kind: kindParam, id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const existing = useApi(id ? `/contracts/${id}` : null);
  const kind = existing.data?.kind || kindParam;
  const settings = useApi('/settings');
  const [f, setF] = useState(null);
  const [partnerQ, setPartnerQ] = useState('');
  // organizzazioni e sedi dell'anagrafica unica (Amministrazione): qui si scelgono, non si creano
  const partners = useApi(`/organizations${partnerQ ? `?q=${encodeURIComponent(partnerQ)}` : ''}`);
  const sites = useApi(kindParam === 'PP' || kindParam === 'SEDE' || id ? '/sites?all=1' : null);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState([]); // file da caricare dopo il salvataggio (nuova proposta)

  useEffect(() => {
    if (id && !existing.data) return;
    const c = existing.data;
    setF({
      org_id: c?.org_id || '', site_id: c?.site_id || '', title: c?.title || '', proposal_date: c?.proposal_date || today(), start_date: c?.start_date || '', end_date: c?.end_date || '', notes: c?.notes || '',
      data: deepMerge(EMPTY[kind], c?.data || {}),
    });
  }, [id, existing.data, kind]);

  const partner = useMemo(() => (partners.data || []).find((p) => p.id === Number(f?.org_id)) || existing.data?.org, [partners.data, f?.org_id, existing.data]);
  const site = useMemo(() => (sites.data || []).find((x) => x.id === Number(f?.site_id)) || existing.data?.site, [sites.data, f?.site_id, existing.data]);
  if (!kind || !KIND[kind]) return <div className="page"><ErrorBox error={new Error('Sezione non valida')} /></div>;
  if (!canEditKind(user, kind)) return <div className="page"><ErrorBox error={new Error('Non hai i permessi su questa sezione')} /></div>;
  if (!f) return <div className="page">{existing.error ? <ErrorBox error={existing.error} /> : <Loading />}</div>;
  const setD = (path, v) => setF((x) => { const d = structuredClone(x.data); let o = d; const ks = path.split('.'); for (const k of ks.slice(0, -1)) o = o[k]; o[ks.at(-1)] = v; return { ...x, data: d }; });
  const d = f.data;

  const save = async () => {
    setErr(null);
    try {
      const body = { kind, org_id: Number(f.org_id), site_id: f.site_id ? Number(f.site_id) : null, title: f.title || null, proposal_date: f.proposal_date, start_date: f.start_date || null, end_date: f.end_date || null, notes: f.notes || null, data: cleanData(kind, d) };
      if (!body.org_id) throw new Error('Seleziona l’organizzazione dall’anagrafica');
      if ((kind === 'PP' || kind === 'SEDE') && !body.site_id) throw new Error('Seleziona la sede dall’anagrafica');
      const r = id ? await api.put(`/contracts/${id}`, body) : await api.post('/contracts', body);
      for (const pf of pending) { const fd = new FormData(); fd.append('category', pf.category); fd.append('files', pf.file); await api.upload(`/contracts/${r.id}/files`, fd); }
      toast(id ? (kind === 'SEDE' ? 'Sede aggiornata' : 'Proposta aggiornata') : (kind === 'SEDE' ? 'Sede registrata' : 'Proposta creata in bozza'));
      nav(`${BASE}/contratti/${r.id}`);
    } catch (e) { setErr(e); }
  };
  const S = settings.data?.settings || {};
  // caricamento file: subito se il contratto esiste, altrimenti in coda fino al salvataggio
  const addFiles = async (category, list) => {
    if (id) { try { const fd = new FormData(); fd.append('category', category); for (const f of list) fd.append('files', f); await api.upload(`/contracts/${id}/files`, fd); existing.reload(); toast('File caricati'); } catch (e) { toast(e.message, 'err'); } }
    else setPending((x) => [...x, ...list.map((file) => ({ category, file }))]);
  };
  const fileList = (cats) => <FileList cats={cats} files={existing.data?.files || []} pending={pending} onRemovePending={(i) => setPending(pending.filter((_, j) => j !== i))} onRemove={async (fid) => { try { await api.del(`/contracts/${id}/files/${fid}`); existing.reload(); } catch (e) { toast(e.message, 'err'); } }} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{kind === 'SEDE' ? (id ? 'Modifica sede' : 'Nuova sede TD in locazione') : `${id ? 'Modifica proposta' : 'Nuova proposta'} · ${KIND[kind].one}`}</h1><div className="sub">{kind === 'SEDE' ? 'Sede intestata a Toscana Diagnostica: locatore, canone, contratto di locazione e allegati. Il fascicolo di autorizzazione si compila dalla scheda.' : `${KIND[kind].doc}. Compila i dati, salva in bozza e genera il documento dalla scheda del contratto.`}</div></div>
        <div className="row"><button className="btn ghost" onClick={() => nav(-1)}>Annulla</button><button className="btn" onClick={save}>Salva</button></div>
      </div>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Card title={kind === 'SEDE' ? 'Locatore (organizzazione)' : 'Organizzazione'} actions={<a className="btn sm ghost" href="/admin/organizations">Apri in Amministrazione</a>}>
          <div className="form-grid">
            <Field label="Cerca nell'anagrafica"><input value={partnerQ} onChange={(e) => setPartnerQ(e.target.value)} placeholder="ragione sociale, P.IVA, città" /></Field>
            <Field label={kind === 'SEDE' ? 'Locatore' : 'Cliente / partner'} className="span2" help="organizzazioni dell'anagrafica unica della Suite">
              <select value={f.org_id} onChange={(e) => setF({ ...f, org_id: e.target.value })}>
                <option value="">Seleziona…</option>
                {(partners.data || []).filter((p) => p.active || p.id === Number(f.org_id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind ? ` · ${ORG_KIND[p.kind] || p.kind}` : ''}{p.city ? ` · ${p.city}` : ''}{p.vat ? ` · ${p.vat}` : ''}</option>)}
              </select>
            </Field>
          </div>
          {partner && (
            <div className="alert info small" style={{ marginTop: 12 }}>
              <b>{partner.name}</b> · {[partner.street, partner.zip, partner.city, partner.prov ? `(${partner.prov})` : ''].filter(Boolean).join(', ')}<br />
              P.IVA {partner.vat || '–'} · C.F. {partner.tax_code || partner.vat || '–'} · PEC {partner.pec || '–'} · SDI {partner.sdi || '–'}<br />
              Legale rappresentante: {partner.legal_rep || '–'}{partner.signer ? ` · firmatario: ${partner.signer}${partner.signer_role ? ` (${partner.signer_role})` : ''}` : ''}
              {(!partner.vat && !partner.tax_code) || !partner.street || !(partner.signer || partner.legal_rep) ? <div className="red" style={{ marginTop: 4 }}>Dati incompleti per la generazione del documento: P.IVA o C.F. e indirizzo in Amministrazione, Legal entity, firmatario nelle impostazioni Business dell'organizzazione.</div> : null}
            </div>
          )}
        </Card>
        <Card title="Proposta">
          <div className="form-grid">
            <Field label={kind === 'SEDE' ? 'Data del contratto di locazione' : 'Data della proposta'}><input type="date" value={f.proposal_date} onChange={(e) => setF({ ...f, proposal_date: e.target.value })} /></Field>
            <Field label={kind === 'PP' ? 'Decorrenza (apertura del punto prelievi)' : kind === 'SEDE' ? 'Decorrenza della locazione' : 'Decorrenza (se diversa dalla sottoscrizione)'}><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="Denominazione breve" className="span2" help={kind === 'PP' ? 'vuota: "Punto Prelievi <comune>"' : kind === 'SEDE' ? 'vuota: tipo di sede e comune' : 'vuota: ragione sociale del cliente'}><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Note interne" className="span2"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ minHeight: 60 }} /></Field>
          </div>
        </Card>
      </div>

      {kind === 'PP' && <>
        <Card title="Sede del Punto Prelievi (premesse del contratto)" className="mt" actions={<a className="btn sm ghost" href="/admin/sites">Apri in Amministrazione</a>}>
          <SitePicker sites={sites.data || []} value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} site={site} />
          <div className="small muted" style={{ marginTop: 8 }}>La sede è quella dell'anagrafica unica (Amministrazione &gt; Sedi): indirizzo e comune compaiono nel contratto e nel fascicolo. Il comune è anche il comune di esclusiva (art. 3.1, ultimo punto) e il destinatario della domanda di autorizzazione (Modello 5).</div>
        </Card>
        <Card title="Ripartizione dei servizi (art. 3)" className="mt">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', alignItems: 'end' }}>
            <Field label="Servizio infermieristico per i prelievi">
              <div className="seg">{[['TD', 'Toscana Diagnostica'], ['HOST', 'Struttura ospitante']].map(([v, l]) => <label key={v} className={(d.services?.nursing || 'TD') === v ? 'on' : ''}><input type="radio" checked={(d.services?.nursing || 'TD') === v} onChange={() => setD('services.nursing', v)} />{l}</label>)}</div>
            </Field>
            <Field label="Accettazione, segreteria, referti e incassi">
              <div className="seg">{[['HOST', 'Struttura ospitante'], ['TD', 'Toscana Diagnostica']].map(([v, l]) => <label key={v} className={(d.services?.reception || 'HOST') === v ? 'on' : ''}><input type="radio" checked={(d.services?.reception || 'HOST') === v} onChange={() => setD('services.reception', v)} />{l}</label>)}</div>
            </Field>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Il format prevede infermieristico a Toscana Diagnostica e accettazione alla struttura ospitante: la scelta sposta la relativa obbligazione tra l'art. 3.1 e l'art. 3.2. La fatturazione resta sempre sui sistemi e a nome di Toscana Diagnostica.</div>
        </Card>
        <Card title="Corrispettivo (art. 5) e durata (art. 4)" className="mt">
          <div className="form-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <FeeItems items={d.fee.items || []} onChange={(items) => setD('fee.items', items)} />
            </div>
            <Field label="Durata (anni)"><input type="number" min="1" max="10" value={d.duration_years} onChange={(e) => setD('duration_years', e.target.value)} /></Field>
            <Field label="Allegato 2 · costi della sicurezza da interferenze" className="span2" help="vuoto: testo predefinito delle Impostazioni (nessun rischio di interferenza, costi pari a 0 euro)"><textarea value={d.duvri_costs_clause || ''} onChange={(e) => setD('duvri_costs_clause', e.target.value)} style={{ minHeight: 56 }} placeholder={S.duvri_costs_default} /></Field>
          </div>
          <div className="alert warn small" style={{ marginTop: 10 }}>Il rinnovo tacito annuale e il recesso con 6 mesi di preavviso sono fissi nel format (art. 4).</div>
        </Card>
      </>}

      {kind === 'SRV' && <>
        <Card title="Sede operativa del cliente e Direttore Sanitario (lettera di offerta e art. 4.3)" className="mt">
          <div className="form-grid">
            <Field label="Denominazione della sede operativa" help="vuota: ragione sociale"><input value={d.site_name || ''} onChange={(e) => setD('site_name', e.target.value)} /></Field>
            <Field label="Indirizzo della sede operativa" help="vuoto: indirizzo fiscale dell'organizzazione"><input value={d.site_address || ''} onChange={(e) => setD('site_address', e.target.value)} /></Field>
            <Field label="Direttore Sanitario della struttura cliente" className="span2"><input value={d.client_ds || ''} onChange={(e) => setD('client_ds', e.target.value)} placeholder="dott. Nome Cognome" /></Field>
          </div>
        </Card>
        <Card title="Condizioni di vendita (lettera di offerta)" className="mt">
          <CommercialFields d={d} setD={setD} S={S} partner={partner} />
          <div style={{ marginTop: 14 }}>
            <Field label="Interfacciamento informatico scelto (Allegato 6)">
              <div className="seg wrap">{[[1, 'Soluzione 1 · LIS TD bidirezionale'], [2, 'Soluzione 2 · portale web'], [3, 'Soluzione 3 · schede cartacee']].map(([v, l]) => <label key={v} className={d.interface_solution === v ? 'on' : ''}><input type="radio" checked={d.interface_solution === v} onChange={() => setD('interface_solution', v)} />{l}</label>)}</div>
            </Field>
          </div>
        </Card>
        <Card title="Listino dell'offerta (Allegato 2)" className="mt" actions={<div className="row" style={{ gap: 6 }}><UploadButton label="Carica XLSX" accept=".xlsx,.xls" onFiles={(fl) => addFiles('LISTINO_XLSX', fl)} /><UploadButton label="Carica PDF" accept="application/pdf" onFiles={(fl) => addFiles('LISTINO_PDF', fl)} /></div>}>
          {fileList(['LISTINO_XLSX', 'LISTINO_PDF'])}
          <div className="small muted" style={{ marginTop: 8 }}>Il listino in XLSX serve al cliente e al gestionale, il PDF è l'allegato della proposta. I nomi dei file compaiono nell'Allegato 2.</div>
        </Card>
        <Card title="Logistica dei ritiri (Allegato 3)" className="mt">
          <div className="form-grid">
            <Field label="Sede di ritiro (denominazione)"><input value={d.pickup.site || ''} onChange={(e) => setD('pickup.site', e.target.value)} /></Field>
            <Field label="Indirizzo"><input value={d.pickup.street || ''} onChange={(e) => setD('pickup.street', e.target.value)} /></Field>
            <Field label="Città"><input value={d.pickup.city || ''} onChange={(e) => setD('pickup.city', e.target.value)} /></Field>
            <Field label="Persona referente del cliente"><input value={d.pickup.contact || ''} onChange={(e) => setD('pickup.contact', e.target.value)} /></Field>
            <Field label="Telefono referente"><input value={d.pickup.phone || ''} onChange={(e) => setD('pickup.phone', e.target.value)} /></Field>
            <Field label="E-mail referente"><input value={d.pickup.email || ''} onChange={(e) => setD('pickup.email', e.target.value)} /></Field>
            {partner && <div className="span2"><button className="btn sm ghost" onClick={() => setF({ ...f, data: { ...d, pickup: { ...d.pickup, site: d.site_name || partner.name, street: partner.street || '', city: partner.city || '', contact: partner.svc_contact || '', phone: partner.svc_mobile || partner.phone || '', email: partner.svc_email || partner.email || '' } } })}>Usa i riferimenti dell'organizzazione</button></div>}
          </div>
          <table className="t" style={{ marginTop: 12 }}>
            <thead><tr><th>Giorno</th><th>Modalità</th><th>Dalle ore</th><th>Alle ore</th><th /></tr></thead>
            <tbody>{DAYS.slice(0, 6).map((day, i) => { const x = d.pickup.days[i] || {}; return (
              <tr key={day}><td className="strong">{day}</td>
                <td><div className="seg">{[['FISSO', 'Fisso'], ['CHIAMATA', 'A chiamata'], ['NO', 'Nessun ritiro']].map(([v, l]) => <label key={v} className={x.mode === v ? 'on' : ''}><input type="radio" checked={x.mode === v} onChange={() => setD(`pickup.days.${i}.mode`, v)} />{l}</label>)}</div></td>
                <td><input type="time" step="300" value={x.time_from || ''} disabled={x.mode === 'NO'} onChange={(e) => setD(`pickup.days.${i}.time_from`, e.target.value)} style={{ width: 130 }} /></td>
                <td><input type="time" step="300" value={x.time_to || ''} disabled={x.mode === 'NO'} onChange={(e) => setD(`pickup.days.${i}.time_to`, e.target.value)} style={{ width: 130 }} /></td>
                <td>{i === 0 && <button type="button" className="btn sm ghost" onClick={() => setD('pickup.days', DAYS.slice(0, 6).map(() => ({ ...x })))}>Copia a tutti i giorni</button>}</td>
              </tr>); })}</tbody>
          </table>
          <div className="small muted" style={{ marginTop: 6 }}>L'orario "alle ore" è facoltativo: con il solo orario iniziale l'allegato riporta "ore 10:00", con entrambi "10:00-12:00".</div>
        </Card>
        <PrivacyCard d={d} setD={setD} annex="Allegato 8" />
      </>}

      {kind === 'MDL' && <>
        <Card title="Riferimenti del cliente (lettera di offerta e art. 2)" className="mt">
          <div className="form-grid">
            <Field label="E-mail di riferimento per gli appuntamenti"><input value={d.service_email || ''} onChange={(e) => setD('service_email', e.target.value)} /></Field>
            <Field label="Contatto di riferimento (sig./sig.ra)"><input value={d.service_contact || ''} onChange={(e) => setD('service_contact', e.target.value)} /></Field>
            <Field label="Telefono del contatto"><input value={d.service_phone || ''} onChange={(e) => setD('service_phone', e.target.value)} /></Field>
            <Field label="E-mail per l'invio delle fatture"><input value={d.invoice_email || ''} onChange={(e) => setD('invoice_email', e.target.value)} placeholder={partner?.pec || ''} /></Field>
            <Field label="Medico Competente / del Lavoro"><input value={d.doctor_name || ''} onChange={(e) => setD('doctor_name', e.target.value)} placeholder="dott. Nome Cognome" /></Field>
            <Field label="E-mail del Medico del Lavoro per l'anticipo dei referti (art. 2.9)"><input value={d.doctor_email || ''} onChange={(e) => setD('doctor_email', e.target.value)} /></Field>
            {partner && <div className="span2"><button className="btn sm ghost" onClick={() => setF({ ...f, data: { ...d, service_email: partner.svc_email || partner.email || '', service_contact: partner.svc_contact || '', service_phone: partner.svc_mobile || partner.phone || '', invoice_email: d.invoice_email || partner.pec || '' } })}>Usa i riferimenti dell'organizzazione</button></div>}
          </div>
        </Card>
        <Card title="Condizioni di vendita (lettera di offerta)" className="mt"><CommercialFields d={d} setD={setD} S={S} partner={partner} /></Card>
        <Card title="Listino delle prestazioni (Allegato 1)" className="mt" actions={<div className="row" style={{ gap: 6 }}><UploadButton label="Carica XLSX" accept=".xlsx,.xls" onFiles={(fl) => addFiles('LISTINO_XLSX', fl)} /><UploadButton label="Carica PDF" accept="application/pdf" onFiles={(fl) => addFiles('LISTINO_PDF', fl)} /></div>}>
          {fileList(['LISTINO_XLSX', 'LISTINO_PDF'])}
          <div className="small muted" style={{ marginTop: 8 }}>Il listino in XLSX serve al cliente e al gestionale, il PDF è l'allegato della proposta. I nomi dei file compaiono nell'Allegato 1.</div>
        </Card>
        <PrivacyCard d={d} setD={setD} annex="Allegato 3" />
      </>}

      {kind === 'SEDE' && <>
        <Card title="Sede" className="mt" actions={<a className="btn sm ghost" href="/admin/sites">Apri in Amministrazione</a>}>
          <div className="form-grid">
            <Field label="Tipo di sede"><select value={d.site_type} onChange={(e) => setD('site_type', e.target.value)}>{Object.entries(SITE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <div style={{ marginTop: 10 }}><SitePicker sites={sites.data || []} value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} site={site} /></div>
          <div className="small muted" style={{ marginTop: 8 }}>La sede è intestata a Toscana Diagnostica ed è una sede dell'anagrafica unica: l'autorizzazione sanitaria si chiede a nome proprio e il fascicolo (Modello 5 o istanza equivalente, planimetrie, relazioni, liste di autovalutazione, DVR) si compila dalla scheda. Atto di condivisione e DUVRI con la struttura ospitante sono esclusi in automatico.</div>
        </Card>
        <Card title="Locazione" className="mt">
          <div className="form-grid">
            <Field label="Canone (€)"><MoneyInput value={d.rent.amount} onChange={(v) => setD('rent.amount', v)} /></Field>
            <Field label="Periodicità"><select value={d.rent.period} onChange={(e) => setD('rent.period', e.target.value)}>{Object.entries(RENT_PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="IVA"><select value={d.rent.vat} onChange={(e) => setD('rent.vat', e.target.value)}>{Object.entries(FEE_VAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Deposito cauzionale (€)"><MoneyInput value={d.rent.deposit} onChange={(v) => setD('rent.deposit', v)} /></Field>
            <Field label="Durata (anni)"><input type="number" min="1" max="30" value={d.rent.duration_years ?? ''} onChange={(e) => setD('rent.duration_years', e.target.value)} /></Field>
            <Field label="Rinnovo (anni)"><input type="number" min="0" max="30" value={d.rent.renewal_years ?? ''} onChange={(e) => setD('rent.renewal_years', e.target.value)} /></Field>
            <Field label="Preavviso di disdetta (mesi)"><input type="number" min="0" max="36" value={d.rent.notice_months ?? ''} onChange={(e) => setD('rent.notice_months', e.target.value)} /></Field>
            <Field label="Aggiornamento ISTAT" className="inline"><input type="checkbox" checked={Boolean(d.rent.istat)} onChange={(e) => setD('rent.istat', e.target.checked)} /> previsto</Field>
            <Field label="Spese e oneri accessori" className="span2"><input value={d.rent.expenses || ''} onChange={(e) => setD('rent.expenses', e.target.value)} placeholder="es. spese condominiali a carico del conduttore, utenze intestate a TD" /></Field>
            <Field label="Registrazione (Agenzia delle Entrate)"><input value={d.rent.registration || ''} onChange={(e) => setD('rent.registration', e.target.value)} placeholder="estremi e data" /></Field>
            <Field label="Note" className="span2"><textarea value={d.rent.notes || ''} onChange={(e) => setD('rent.notes', e.target.value)} style={{ minHeight: 56 }} /></Field>
          </div>
        </Card>
        <Card title="Contratto di locazione e allegati" className="mt" actions={<div className="row" style={{ gap: 6 }}><UploadButton label="Contratto firmato (PDF)" accept="application/pdf" onFiles={(fl) => addFiles('FIRMATO', fl)} /><UploadButton label="Planimetria" multiple onFiles={(fl) => addFiles('PLANIMETRIA', fl)} /><UploadButton label="Assicurazione" multiple onFiles={(fl) => addFiles('ASSICURAZIONE', fl)} /><UploadButton label="Altro" multiple onFiles={(fl) => addFiles('ALTRO', fl)} /></div>}>
          {fileList(['FIRMATO', 'PLANIMETRIA', 'ASSICURAZIONE', 'ALTRO'])}
          <div className="small muted" style={{ marginTop: 8 }}>Il contratto di locazione lo predispone il locatore: caricando la copia firmata la sede passa in stato Firmato e riceve il protocollo. Le planimetrie caricate qui servono anche al fascicolo di autorizzazione.</div>
        </Card>
      </>}

      <div className="row end" style={{ marginTop: 18 }}><button className="btn ghost" onClick={() => nav(-1)}>Annulla</button><button className="btn lg" onClick={save}><Icon name="check" />Salva</button></div>
    </div>
  );
}

// Selettore della sede sull'anagrafica unica (public.sites), con ricerca per nome, codice o comune
function SitePicker({ sites, value, onChange, site }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = sites.filter((x) => (x.active || x.id === Number(value)) && (!ql || `${x.name} ${x.code} ${x.city || ''} ${x.address || ''}`.toLowerCase().includes(ql)));
  return (
    <>
      <div className="form-grid">
        <Field label="Cerca la sede"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome, codice, comune" /></Field>
        <Field label="Sede" className="span2">
          <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">Seleziona…</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.city ? ` · ${x.city}` : ''}{x.code ? ` · ${x.code}` : ''}</option>)}
          </select>
        </Field>
      </div>
      {site && <div className="alert info small" style={{ marginTop: 10 }}><b>{site.name}</b> · {[site.address || site.street, site.zip, site.city, (site.province || site.prov) ? `(${site.province || site.prov})` : ''].filter(Boolean).join(', ') || 'indirizzo non indicato'}{site.organization_name ? ` · ${site.organization_name}` : ''}{!(site.address || site.street) || !site.city ? <div className="red" style={{ marginTop: 4 }}>Completa indirizzo e comune della sede in Amministrazione &gt; Sedi: compaiono nel contratto e nel fascicolo.</div> : null}</div>}
    </>
  );
}

function CommercialFields({ d, setD, S, partner }) {
  return (
    <div className="form-grid">
      <Field label="Termini di pagamento" help="vuoto: testo predefinito"><input value={d.payment_terms || ''} onChange={(e) => setD('payment_terms', e.target.value)} placeholder={S.payment_terms_default} /></Field>
      <Field label="Esenzione IVA art. 10 n. 18 D.P.R. 633/1972" className="span2">
        <div className="seg wrap">{[[true, 'Prestazione esente'], [false, 'Prestazione imponibile'], [null, 'Da dichiarare dal cliente']].map(([v, l]) => <label key={String(v)} className={d.vat_exemption === v ? 'on' : ''}><input type="radio" checked={d.vat_exemption === v} onChange={() => setD('vat_exemption', v)} />{l}</label>)}</div>
      </Field>
      <div className="span2 small muted">PEC {partner?.pec || '–'} · SDI {partner?.sdi || '–'} · banca {partner?.bank_name || 'da indicare'}: dall'anagrafica dell'organizzazione e dalle sue impostazioni Business.</div>
    </div>
  );
}

// Elenco dei file di una categoria: già caricati (contratto esistente) e in attesa di salvataggio (nuovo contratto)
function FileList({ cats, files, pending, onRemovePending, onRemove }) {
  const have = files.filter((f) => cats.includes(f.category));
  const pend = pending.map((p, i) => ({ ...p, i })).filter((p) => cats.includes(p.category));
  if (!have.length && !pend.length) return <div className="muted">Nessun file caricato.</div>;
  const tag = (c) => (c.endsWith('XLSX') ? 'XLSX' : c.endsWith('PDF') ? 'PDF' : c === 'PLANIMETRIA' ? 'planimetria' : c === 'ASSICURAZIONE' ? 'assicurazione' : c === 'FIRMATO' ? 'contratto' : 'altro');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {have.map((f) => <div key={f.id} className="row"><Badge tone="green">{tag(f.category)}</Badge><a href={`${API_BASE}/contract-files/${f.id}`}><Icon name="download" />{f.filename}</a><span className="small muted">{bytes(f.size)}</span><button type="button" className="iconbtn" title="Rimuovi" onClick={() => onRemove(f.id)}><Icon name="trash" /></button></div>)}
      {pend.map((p) => <div key={p.i} className="row"><Badge tone="blue">{tag(p.category)} · da salvare</Badge><span>{p.file.name}</span><span className="small muted">{bytes(p.file.size)}</span><button type="button" className="iconbtn" title="Rimuovi" onClick={() => onRemovePending(p.i)}><Icon name="trash" /></button></div>)}
    </div>
  );
}

function PrivacyCard({ d, setD, annex }) {
  const p = d.privacy || {};
  return (
    <Card title={`Ruolo privacy del cliente (art. 28 GDPR, ${annex})`} className="mt">
      <div className="form-grid">
        <Field label="Il cliente tratta i dati dei pazienti come" className="span2">
          <div className="seg">{[['TITOLARE', 'Titolare del trattamento'], ['RESPONSABILE', 'Responsabile per conto di un Committente']].map(([v, l]) => <label key={v} className={p.role === v ? 'on' : ''}><input type="radio" checked={p.role === v} onChange={() => setD('privacy.role', v)} />{l}</label>)}</div>
        </Field>
        {p.role === 'RESPONSABILE' && <Field label="Nominativo del Committente" className="span2"><input value={p.principal || ''} onChange={(e) => setD('privacy.principal', e.target.value)} /></Field>}
        <Field label="Ulteriori misure di sicurezza richieste dal cliente" className="span2" help="vuoto: NO"><input value={p.measures || ''} onChange={(e) => setD('privacy.measures', e.target.value)} /></Field>
        <Field label="DPO del cliente (nominativo)"><input value={p.dpo_name || ''} onChange={(e) => setD('privacy.dpo_name', e.target.value)} /></Field>
        <Field label="DPO del cliente (contatto)"><input value={p.dpo_contact || ''} onChange={(e) => setD('privacy.dpo_contact', e.target.value)} /></Field>
      </div>
    </Card>
  );
}

// Normalizza i campi numerici e vuoti prima dell'invio
function cleanData(kind, d) {
  const x = structuredClone(d);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (kind === 'PP') { x.fee.items = (x.fee.items || []).map((it) => ({ ...it, percent: num(it.percent), amount: num(it.amount) })); x.duration_years = Number(x.duration_years || 3); }
  else if (kind === 'SEDE') { for (const k of ['amount', 'deposit', 'duration_years', 'renewal_years', 'notice_months']) x.rent[k] = num(x.rent[k]); }
  return x;
}

// Condizioni del corrispettivo (art. 5.1): una riga per sotto-articolo, replicabili e riordinabili
const NEW_ITEM = { kind: 'PERCENT', percent: '', base: 'PUNTO_PRELIEVI', base_other: '', include_ssr: false, amount: '', period: 'MESE', purpose: '', vat: 'PIU_IVA', closing: true, text: '' };
function FeeItems({ items, onChange }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i, dir) => { const a = [...items]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  return (
    <div className="feeitems">
      {items.map((it, i) => (
        <div key={i} className="feeitem">
          <div className="feeitem-n">5.1.{i + 1}</div>
          <div className="feeitem-body">
            <div className="feerow">
              <Field label="Tipo"><select value={it.kind} onChange={(e) => set(i, 'kind', e.target.value)}>{Object.entries(FEE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {it.kind === 'PERCENT' && <>
                <Field label="Percentuale"><input type="number" step="0.01" min="0" max="100" value={it.percent ?? ''} onChange={(e) => set(i, 'percent', e.target.value)} /></Field>
                <Field label="Base di calcolo"><select value={it.base} onChange={(e) => set(i, 'base', e.target.value)}>{Object.entries(FEE_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="IVA"><select value={it.vat} onChange={(e) => set(i, 'vat', e.target.value)}>{Object.entries(FEE_VAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              </>}
              {(it.kind === 'FIXED' || it.kind === 'MINIMUM') && <>
                <Field label="Importo (€)"><MoneyInput value={it.amount} onChange={(v) => set(i, 'amount', v)} /></Field>
                <Field label="Periodicità"><select value={it.period} onChange={(e) => set(i, 'period', e.target.value)}>{Object.entries(FEE_PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="IVA"><select value={it.vat} onChange={(e) => set(i, 'vat', e.target.value)}>{Object.entries(FEE_VAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              </>}
            </div>
            {it.kind === 'PERCENT' && it.base === 'ALTRO' && <Field label="Base di calcolo (testo in contratto, es. del fatturato generato dalle prestazioni di diagnostica per immagini)"><input value={it.base_other || ''} onChange={(e) => set(i, 'base_other', e.target.value)} /></Field>}
            {(it.kind === 'FIXED' || it.kind === 'MINIMUM') && <Field label="Causale (es. per la concessione ad utilizzo esclusivo degli spazi posti al piano sotterraneo)"><input value={it.purpose || ''} onChange={(e) => set(i, 'purpose', e.target.value)} /></Field>}
            <Field label={it.kind === 'TEXT' ? 'Testo della condizione' : 'Precisazione aggiuntiva (facoltativa, dopo la condizione)'}><textarea value={it.text || ''} onChange={(e) => set(i, 'text', e.target.value)} style={{ minHeight: 44 }} /></Field>
            <div className="row" style={{ gap: 18 }}>
              {it.kind === 'PERCENT' && <label className="f inline"><input type="checkbox" checked={Boolean(it.include_ssr)} onChange={(e) => set(i, 'include_ssr', e.target.checked)} /> ivi comprese le prestazioni effettuate a vantaggio del SSR</label>}
              {it.kind !== 'TEXT' && <label className="f inline"><input type="checkbox" checked={Boolean(it.closing)} onChange={(e) => set(i, 'closing', e.target.checked)} /> chiudi con "remunerazione complessiva ed onnicomprensiva per la prestazione dei Servizi"</label>}
            </div>
          </div>
          <div className="feeitem-tools">
            <button type="button" className="iconbtn nav" title="Sposta su" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow" /></button>
            <button type="button" className="iconbtn nav" title="Sposta giù" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="arrow" /></button>
            <button type="button" className="iconbtn" title="Rimuovi" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="trash" /></button>
          </div>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...items, { ...NEW_ITEM }])}>+ % sul fatturato</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...items, { ...NEW_ITEM, kind: 'FIXED', closing: false }])}>+ Importo fisso</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...items, { ...NEW_ITEM, kind: 'MINIMUM', closing: false }])}>+ Minimo garantito</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange([...items, { ...NEW_ITEM, kind: 'TEXT', closing: false }])}>+ Condizione in testo libero</button>
      </div>
      <div className="small muted">Ogni riga diventa un sotto-articolo dell'art. 5.1 (5.1.1, 5.1.2, …) nell'ordine indicato. Il pagamento resta a 30 giorni fine mese dalla consegna della fattura, entro il 10 del mese successivo (art. 5.2).</div>
    </div>
  );
}
