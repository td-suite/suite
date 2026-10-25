import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, Modal } from './ui.jsx';

// Anagrafica partner / cliente B2B sul tracciato TD-SGI-MOD173
export const EMPTY_PARTNER = {
  name: '', vat: '', tax_code: '', sdi: '', street: '', zip: '', city: '', prov: '', country: 'Italia', email: '', phone: '', pec: '',
  legal_rep: '', signer: '', signer_role: '', contract_services: '', lab_reference: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)', billing_ref: '',
  svc_contact: '', svc_email: '', svc_mobile: '', svc_address: '', proc_contact: '', proc_email: '', proc_mobile: '', proc_address: '',
  pay_method: 'Bonifico bancario', pay_terms: '30 gg fm', currency: 'EUR', withholding: false, vat_territoriality: 'Italia', intent_declaration: '', split_payment: false, tax_values: '',
  bank_name: '', iban: '', notes: '', active: true,
};

export function PartnerFields({ p, set, compact }) {
  const F = (k, label, opts = {}) => (
    <Field key={k} label={label} className={opts.span ? 'span2' : ''} help={opts.help}>
      {opts.type === 'textarea' ? <textarea value={p[k] || ''} onChange={(e) => set(k, e.target.value)} /> : <input value={p[k] || ''} placeholder={opts.ph} onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)} />}
    </Field>
  );
  const B = (k, label) => <Field key={k} label={label} className="inline"><input type="checkbox" checked={Boolean(p[k])} onChange={(e) => set(k, e.target.checked)} /> sì</Field>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3>Identificazione del cliente / partner</h3>
        <div className="form-grid" style={{ marginTop: 8 }}>
          {F('name', 'Ragione sociale', { span: true })}
          {F('vat', 'Partita IVA (IVA Reg. Nr. / TAX Nr.)')}
          {F('tax_code', 'Codice fiscale')}
          {F('sdi', 'Codice SDI', { upper: true })}
          {F('pec', 'PEC')}
          {F('street', 'Indirizzo fiscale', { span: true })}
          {F('zip', 'CAP')}
          {F('city', 'Città')}
          {F('prov', 'Provincia (sigla)', { upper: true })}
          {F('country', 'Nazione')}
          {F('email', 'E-mail')}
          {F('phone', 'Telefono')}
          {F('legal_rep', 'Legale rappresentante')}
          {F('signer', 'Firmatario del contratto', { help: 'se diverso dal legale rappresentante' })}
          {F('signer_role', 'Qualifica del firmatario', { ph: 'Amministratore Unico, Procuratore…' })}
          {F('contract_services', 'Servizi a contratto')}
          {F('lab_reference', 'Laboratorio di riferimento')}
          {F('billing_ref', 'Riferimento fatturazione')}
        </div>
      </div>
      {!compact && <>
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
          <div className="form-grid" style={{ marginTop: 8 }}>{F('bank_name', 'Nome della banca')}{F('iban', 'IBAN', { upper: true })}</div>
        </div>
        <div>
          <h3>Note</h3>
          <div className="form-grid" style={{ marginTop: 8 }}>{F('notes', 'Note', { type: 'textarea', span: true })}{B('active', 'Anagrafica attiva')}</div>
        </div>
      </>}
    </div>
  );
}

export function PartnerModal({ partner, onClose, onSaved }) {
  const [p, setP] = useState({ ...EMPTY_PARTNER, ...(partner || {}) });
  const [err, setErr] = useState(null);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(p).filter(([k]) => k in EMPTY_PARTNER));
      const r = p.id ? await api.put(`/partners/${p.id}`, body) : await api.post('/partners', body);
      onSaved(r);
    } catch (e) { setErr(e); }
  };
  return (
    <Modal wide title={p.id ? `Anagrafica · ${p.name}` : 'Nuovo partner / cliente B2B (MOD173)'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva anagrafica</button></>}>
      <ErrorBox error={err} />
      <PartnerFields p={p} set={set} />
    </Modal>
  );
}
