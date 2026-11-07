import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, Modal } from './ui.jsx';

// Impostazioni Business di un'organizzazione dell'anagrafica unica (tracciato TD-SGI-MOD173, parte commerciale).
// Ragione sociale, P.IVA, indirizzo, PEC, stato, banca e IBAN si modificano in Amministrazione, Legal entity (docs/IMPOSTAZIONI.md).
export const EMPTY_EXT = {
  legal_rep: '', signer: '', signer_role: '', contract_services: '', lab_reference: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)', billing_ref: '',
  sales_contact: '', sales_email: '', sales_phone: '',
  svc_contact: '', svc_email: '', svc_mobile: '', svc_address: '', proc_contact: '', proc_email: '', proc_mobile: '', proc_address: '',
  pay_method: 'Bonifico bancario', pay_terms: '30 gg f.m. data fattura', currency: 'EUR', withholding: false, vat_territoriality: 'Italia', intent_declaration: '', split_payment: false, tax_values: '',
  portal_url: '', portal_username: '', portal_password: '', notes: '',
};

export const ORG_KIND = { GRUPPO: 'Gruppo', SOCIETA: 'Società', CLIENTE: 'Cliente', PARTNER: 'Partner', FORNITORE: 'Fornitore', TARGET: 'Target', ALTRO: 'Altro' };

// Personale di Toscana Diagnostica (dipendenti, LP, dirigenti) per i referenti del tracciato MOD173: scelto a tendina, il resto
// (mail, telefono, indirizzo della sede) si compila da solo (CEO, 07/11/2026: "qui tutto a tendina... inserendo il nome, poi
// autocompili il resto"). La rubrica sta fuori dal prefisso /api/business.
function usePersonaleTD() {
  const [lista, setLista] = useState([]);
  useEffect(() => { let vivo = true;
    fetch('/api/people?status=ATTIVO', { credentials: 'include', headers: { 'X-Requested-With': 'td-suite' } }).then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (vivo) setLista((Array.isArray(rows) ? rows : []).filter((x) => ['DIPENDENTE', 'LP', 'DIRIGENTE'].includes(x.kind))); }).catch(() => {});
    return () => { vivo = false; }; }, []);
  return lista;
}
const nomePersona = (x) => `${x.first_name} ${x.last_name}`.trim();

// Tendina del referente TD: scegliendo una persona si compilano nome, mail e telefono (e l'indirizzo della sede, se richiesto);
// "Altro" lascia i campi liberi; un valore già salvato non in elenco resta selezionabile.
function ReferenteTD({ p, set, persone, campi, label, indirizzo }) {
  const [altro, setAltro] = useState(false);
  const attuale = p[campi.nome] || '';
  const inElenco = persone.some((x) => nomePersona(x) === attuale);
  const scegli = (v) => {
    if (v === '__altro') { setAltro(true); return; }
    setAltro(false);
    const x = persone.find((y) => String(y.id) === v);
    if (!x) { set(campi.nome, ''); return; }
    set(campi.nome, nomePersona(x)); set(campi.email, x.email || '');
    set(campi.tel, x.phone_office || x.phone || '');
    if (indirizzo && campi.indirizzo) set(campi.indirizzo, [x.site_name, x.site_city].filter(Boolean).join(', '));
  };
  const sel = altro || (attuale && !inElenco) ? '__altro' : String(persone.find((x) => nomePersona(x) === attuale)?.id || '');
  return (
    <>
      <Field label={label}>
        <select value={sel} onChange={(e) => scegli(e.target.value)}>
          <option value="">–</option>
          {persone.map((x) => <option key={x.id} value={x.id}>{nomePersona(x)}{x.job_title ? ` · ${x.job_title}` : ''}</option>)}
          <option value="__altro">Altro (scrivi il nome)</option>
        </select>
        {sel === '__altro' && <input style={{ marginTop: 6 }} value={attuale} onChange={(e) => set(campi.nome, e.target.value)} placeholder="Nome e cognome" />}
      </Field>
    </>
  );
}

// Metodo e termine di pagamento: tendine standard (CEO, 07/11/2026); un valore salvato fuori elenco resta come "(valore attuale)",
// "Altro" apre il testo libero. Sono l'UNICA fonte dei termini di pagamento della lettera di offerta (docgen terminiPagamento).
export const METODI_PAGAMENTO = ['Bonifico bancario', 'RID/SDD', 'Carta di credito', 'Contanti'];
export const TERMINI_PAGAMENTO = ['30 gg f.m. data fattura', '60 gg f.m. data fattura', '90 gg f.m. data fattura', 'a vista fattura', '30 gg data fattura', 'anticipato'];
function Tendina({ p, set, k, label, voci, help }) {
  const [altro, setAltro] = useState(false);
  const v = String(p[k] || '').trim();
  const fuori = v && !voci.includes(v);
  const sel = altro ? '__altro' : v;
  return (
    <Field label={label} help={help}>
      <select value={sel} onChange={(e) => { if (e.target.value === '__altro') { setAltro(true); set(k, ''); } else { setAltro(false); set(k, e.target.value); } }}>
        <option value="">–</option>
        {voci.map((x) => <option key={x} value={x}>{x}</option>)}
        {fuori && !altro && <option value={v}>{v} (valore attuale)</option>}
        <option value="__altro">Altro (specificare)</option>
      </select>
      {altro && <input style={{ marginTop: 6 }} autoFocus value={p[k] || ''} onChange={(e) => set(k, e.target.value)} placeholder="testo libero" />}
    </Field>
  );
}

export function OrgExtFields({ p, set }) {
  const persone = usePersonaleTD();
  const F = (k, label, opts = {}) => (
    <Field key={k} label={label} className={opts.span ? 'span2' : ''} help={opts.help}>
      {opts.type === 'textarea' ? <textarea value={p[k] || ''} onChange={(e) => set(k, e.target.value)} /> : <input type={opts.type || 'text'} value={p[k] || ''} placeholder={opts.ph} autoComplete={opts.type === 'password' ? 'new-password' : undefined} onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)} />}
    </Field>
  );
  const B = (k, label) => <Field key={k} label={label} className="inline"><input type="checkbox" checked={Boolean(p[k])} onChange={(e) => set(k, e.target.checked)} /> sì</Field>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3>Firmatario e contratto</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          {F('legal_rep', 'Legale rappresentante')}
          {F('signer', 'Firmatario del contratto', { help: 'se diverso dal legale rappresentante' })}
          {F('signer_role', 'Qualifica del firmatario', { ph: 'Amministratore Unico, Procuratore…' })}
          {F('contract_services', 'Servizi a contratto')}
          {F('lab_reference', 'Laboratorio di riferimento')}
          {F('billing_ref', 'Riferimento fatturazione')}
        </div>
      </div>
      <div>
        <h3>Referente commerciale Toscana Diagnostica</h3>
        <div className="form-grid" style={{ marginTop: 8 }}><ReferenteTD p={p} set={set} persone={persone} label="Referente" campi={{ nome: 'sales_contact', email: 'sales_email', tel: 'sales_phone' }} />{F('sales_email', 'Mail')}{F('sales_phone', 'Telefono')}</div>
      </div>
      <div>
        <h3>Riferimenti per la gestione del servizio</h3>
        <div className="form-grid" style={{ marginTop: 8 }}><ReferenteTD p={p} set={set} persone={persone} label="Contatto di riferimento" indirizzo campi={{ nome: 'svc_contact', email: 'svc_email', tel: 'svc_mobile', indirizzo: 'svc_address' }} />{F('svc_email', 'Mail')}{F('svc_mobile', 'Cellulare')}{F('svc_address', 'Indirizzo')}</div>
      </div>
      <div>
        <h3>Riferimenti per l’approvvigionamento</h3>
        <div className="form-grid" style={{ marginTop: 8 }}><ReferenteTD p={p} set={set} persone={persone} label="Contatto di riferimento" indirizzo campi={{ nome: 'proc_contact', email: 'proc_email', tel: 'proc_mobile', indirizzo: 'proc_address' }} />{F('proc_email', 'Mail')}{F('proc_mobile', 'Cellulare')}{F('proc_address', 'Indirizzo')}</div>
      </div>
      <div>
        <h3>Condizioni di pagamento e classificazione fiscale</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <Tendina p={p} set={set} k="pay_method" label="Metodo di pagamento" voci={METODI_PAGAMENTO} />
          <Tendina p={p} set={set} k="pay_terms" label="Termine di pagamento" voci={TERMINI_PAGAMENTO} help="unica fonte dei termini di pagamento della lettera di offerta" />
          {F('currency', 'Valuta')}
          {F('vat_territoriality', 'Territorialità IVA')}{F('intent_declaration', 'Dichiarazione d’intento IVA')}{F('tax_values', 'Tax values')}
          {B('withholding', 'Soggetto a ritenuta d’acconto')}{B('split_payment', 'Split payment')}
        </div>
      </div>
      <div>
        <h3>Istituto di credito del cliente / partner</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <Field label="Nome della banca" help="Dalla Legal entity in Amministrazione"><input value={p.bank_name || ''} disabled placeholder="non indicata" /></Field>
          <Field label="IBAN" help={<>Si modifica in <a href="/admin/organizations">Amministrazione, Legal entity</a></>}><input value={p.iban || ''} disabled placeholder="non indicato" /></Field>
        </div>
      </div>
      <div>
        <h3>Credenziali del portale (livello organizzazione)</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          {F('portal_url', 'Indirizzo del portale', { span: true })}
          {F('portal_username', 'Nome utente')}
          {F('portal_password', p.has_portal_password ? 'Nuova password (vuota: invariata)' : 'Password', { type: 'password', help: 'cifrata con la chiave BUSINESS_CREDENTIALS_KEY' })}
        </div>
      </div>
      <div>
        <h3>Note Business</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>{F('notes', 'Note', { type: 'textarea', span: true })}</div>
      </div>
    </div>
  );
}

export function OrgExtModal({ org, onClose, onSaved }) {
  const [p, setP] = useState({ ...EMPTY_EXT, ...Object.fromEntries(Object.entries(org || {}).filter(([k, v]) => k in EMPTY_EXT && v != null)), notes: org?.business_notes || '', has_portal_password: Boolean(org?.has_portal_password), portal_password: '', bank_name: org?.bank_name || '', iban: org?.iban || '' });
  const [err, setErr] = useState(null);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(p).filter(([k]) => k in EMPTY_EXT));
      if (!body.portal_password) delete body.portal_password;
      onSaved(await api.put(`/organizations/${org.id}/ext`, body));
    } catch (e) { setErr(e); }
  };
  return (
    <Modal wide title={`Impostazioni Business · ${org.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva impostazioni</button></>}>
      <ErrorBox error={err} />
      <div className="alert info small" style={{ marginBottom: 14 }}>
        <b>{org.name}</b> · {ORG_KIND[org.kind] || org.kind} · {[org.street, org.zip, org.city, org.prov ? `(${org.prov})` : ''].filter(Boolean).join(', ') || 'indirizzo non indicato'}<br />
        P.IVA {org.vat || '–'} · C.F. {org.tax_code || '–'} · PEC {org.pec || '–'} · SDI {org.sdi || '–'}<br />
        I dati anagrafici si modificano in <a href="/admin/organizations">Amministrazione, Legal entity</a>.
      </div>
      <OrgExtFields p={p} set={set} />
    </Modal>
  );
}
