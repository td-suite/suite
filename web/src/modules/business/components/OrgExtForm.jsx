import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, Modal } from './ui.jsx';

// Impostazioni Business di un'organizzazione dell'anagrafica unica (tracciato TD-SGI-MOD173, parte commerciale).
// Ragione sociale, P.IVA, indirizzo, PEC, stato, banca e IBAN si modificano in Amministrazione, Legal entity (docs/IMPOSTAZIONI.md).
export const EMPTY_EXT = {
  legal_rep: '', signer: '', signer_role: '', contract_services: '', lab_reference: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)', billing_ref: '',
  sales_contact: '', sales_email: '', sales_phone: '',
  svc_contact: '', svc_email: '', svc_mobile: '', svc_address: '', proc_contact: '', proc_email: '', proc_mobile: '', proc_address: '',
  pay_method: 'Bonifico bancario', pay_terms: '30 gg fm', currency: 'EUR', withholding: false, vat_territoriality: 'Italia', intent_declaration: '', split_payment: false, tax_values: '',
  portal_url: '', portal_username: '', portal_password: '', notes: '',
};

export const ORG_KIND = { GRUPPO: 'Gruppo', SOCIETA: 'Società', CLIENTE: 'Cliente', PARTNER: 'Partner', FORNITORE: 'Fornitore', TARGET: 'Target', ALTRO: 'Altro' };

export function OrgExtFields({ p, set }) {
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
        <div className="form-grid" style={{ marginTop: 8 }}>{F('sales_contact', 'Referente')}{F('sales_email', 'Mail')}{F('sales_phone', 'Telefono')}</div>
      </div>
      <div>
        <h3>Riferimenti per la gestione del servizio</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>{F('svc_contact', 'Contatto di riferimento')}{F('svc_email', 'Mail')}{F('svc_mobile', 'Cellulare')}{F('svc_address', 'Indirizzo')}</div>
      </div>
      <div>
        <h3>Riferimenti per l’approvvigionamento</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>{F('proc_contact', 'Contatto di riferimento')}{F('proc_email', 'Mail')}{F('proc_mobile', 'Cellulare')}{F('proc_address', 'Indirizzo')}</div>
      </div>
      <div>
        <h3>Condizioni di pagamento e classificazione fiscale</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          {F('pay_method', 'Metodo di pagamento')}{F('pay_terms', 'Termine di pagamento')}{F('currency', 'Valuta')}
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
