import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, Icon, useToast } from '../components/ui.jsx';

const emptyAcc = { label: '', bank_name: '', iban: '', bic: '', notes: '', is_default: false, active: true };

function BankAccounts({ company }) {
  const toast = useToast();
  const { data, reload } = useApi(`/companies/${company.id}/bank-accounts`);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const b = { ...edit }; delete b.id; delete b.company_id; delete b.created_at;
    for (const k of ['bank_name', 'bic', 'notes']) if (b[k] === '') b[k] = null;
    try {
      if (edit.id) await api.put(`/companies/${company.id}/bank-accounts/${edit.id}`, b); else await api.post(`/companies/${company.id}/bank-accounts`, b);
      toast('Conto salvato'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  const f = (k, label, extra = {}) => <Field label={label}><input value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...extra} /></Field>;
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><div className="small strong">Conti correnti per gli accrediti</div><button className="btn sm ghost" onClick={() => setEdit({ ...emptyAcc, is_default: !(data || []).length })}>+ Conto</button></div>
      {!data ? null : !data.length ? <div className="small red" style={{ marginTop: 4 }}>Nessun conto: gli accrediti non potranno essere attribuiti a un conto specifico.</div> : (
        <table className="t" style={{ marginTop: 6 }}><tbody>{data.map((a) => (
          <tr key={a.id} className={a.active ? '' : 'muted'}>
            <td><b>{a.label}</b>{a.is_default && <Badge tone="teal">predefinito</Badge>}{!a.active && <Badge tone="red">disattivo</Badge>}<div className="mono small">{a.iban}</div>{a.bank_name && <div className="small muted">{a.bank_name}</div>}</td>
            <td className="num"><button className="btn sm ghost" onClick={() => setEdit({ ...emptyAcc, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ''])), is_default: !!a.is_default, active: !!a.active })}>Modifica</button></td>
          </tr>))}</tbody></table>
      )}
      {edit && (
        <Modal title={edit.id ? 'Modifica conto corrente' : 'Nuovo conto corrente'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.label || !edit.iban} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            {f('label', 'Etichetta (es. Conto operativo, Banco Fiorentino)')}{f('bank_name', 'Banca')}
            {f('iban', 'IBAN', { className: 'mono', style: { textTransform: 'uppercase' } })}{f('bic', 'BIC (facoltativo)')}
            <Field label="Note" className="span2"><input value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <label className="f inline"><input type="checkbox" checked={!!edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />Conto predefinito per gli accrediti</label>
            {edit.id && <label className="f inline"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Conto attivo</label>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Aziende: organizzazioni della Suite (public.organizations, kind SOCIETA o GRUPPO) con le impostazioni Cash (org_ext).
// Qui non si creano, rinominano o disattivano aziende: si fa in Amministrazione, Legal entity. Si modificano solo i
// campi Cash: carta intestata e logo della distinta, conti correnti per gli accrediti, mandato SEPA, capofila. IBAN e BIC
// della società (debitore SEPA) sono della Legal entity in Amministrazione (docs/IMPOSTAZIONI.md): qui si leggono soltanto.
const ADMIN_ORGS = '/admin/organizations';
const empty = { letterhead_footer: '', sepa_mandate_id: '', sepa_mandate_date: '', is_franchisor: false };
const KIND = { SOCIETA: 'Società', GRUPPO: 'Gruppo' };

export default function Companies() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/companies');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [logo, setLogo] = useState(null);

  const save = async () => {
    setErr(null);
    const b = Object.fromEntries(Object.entries(edit).filter(([k]) => k in empty));
    if (!sup) for (const k of ['sepa_mandate_id', 'sepa_mandate_date', 'is_franchisor']) delete b[k];
    for (const k of Object.keys(b)) if (b[k] === '') b[k] = null;
    if ('is_franchisor' in b) b.is_franchisor = !!b.is_franchisor;
    try {
      await api.put(`/companies/${edit.id}`, b);
      if (logo) { const fd = new FormData(); fd.append('logo', logo); await api.upload(`/companies/${edit.id}/logo`, fd); }
      toast('Impostazioni Cash salvate'); setEdit(null); setLogo(null); reload();
    } catch (e) { setErr(e); }
  };
  const f = (k, label, extra = {}) => <Field label={label}><input value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...extra} /></Field>;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{sup ? 'Aziende della rete' : 'La tua azienda'}</h1><div className="sub">Società e gruppi dell'anagrafica unica della Suite: qui si impostano carta intestata della distinta, conti correnti per gli accrediti e dati per l'addebito SEPA</div></div>
        <Link className="btn ghost" to={ADMIN_ORGS}><Icon name="external" size={16} />Apri in Amministrazione</Link>
      </div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessuna società o gruppo nell'anagrafica. <Link to={ADMIN_ORGS}>Creala in Amministrazione, Organizzazioni</Link> con tipo Società.</Empty></div> : (
        <div className="grid g2">
          {data.map((c) => (
            <Card key={c.id} title={<span>{c.name} <span className="mono muted small">{c.code}</span></span>} actions={<>{c.is_franchisor && <Badge tone="teal">Capofila</Badge>}<Badge>{KIND[c.kind] || c.kind}</Badge>{!c.active && <Badge tone="red">Disattiva</Badge>}{!c.configured && <Badge tone="grey">Da configurare</Badge>}<button className="btn sm ghost" onClick={() => setEdit({ ...empty, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])), is_franchisor: !!c.is_franchisor })}>Impostazioni Cash</button></>}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 150, height: 56, display: 'grid', placeItems: 'center', background: '#fafcfc', border: '1px solid var(--line)', borderRadius: 8 }}>
                  {c.has_logo ? <img src={`${API_BASE}/companies/${c.id}/logo?v=${c.id}`} alt="" style={{ maxWidth: 140, maxHeight: 48 }} /> : <span className="small muted">nessun logo</span>}
                </div>
                <div className="small" style={{ flex: 1 }}>
                  <div>{[c.address, c.zip, c.city, c.province && `(${c.province})`].filter(Boolean).join(' ') || <span className="muted">indirizzo non indicato</span>}</div>
                  <div>P.IVA {c.vat_number || '–'} · {c.email || ''}</div>
                  <div className="muted">{c.sites_count} sedi · {c.users_count} utenti</div>
                  {sup && !c.is_franchisor && <div style={{ marginTop: 4 }}>{c.iban && c.sepa_mandate_id ? <Badge tone="green">Mandato SEPA {c.sepa_mandate_id}</Badge> : <Badge tone="red">Mandato SEPA mancante</Badge>}</div>}
                </div>
              </div>
              <BankAccounts company={c} />
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal wide title={`Impostazioni Cash · ${edit.name}`} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="alert info" style={{ marginBottom: 12 }}>
            <span><b>{edit.code}</b> · {KIND[edit.kind] || edit.kind} · P.IVA {edit.vat_number || '–'} · {[edit.address, edit.zip, edit.city, edit.province && `(${edit.province})`].filter(Boolean).join(' ') || 'indirizzo non indicato'}. Ragione sociale, partita IVA, indirizzo, contatti e stato si modificano in <Link to={ADMIN_ORGS}>Amministrazione, Organizzazioni</Link>.</span>
          </div>
          <h3 style={{ marginBottom: 8 }}>Carta intestata della distinta</h3>
          <div className="form-grid">
            <Field label="Logo (PNG o JPEG, sfondo trasparente)"><input type="file" accept="image/png,image/jpeg" onChange={(e) => setLogo(e.target.files[0] || null)} /></Field>
            <Field label="Riga legale a piè di pagina" className="span2"><textarea value={edit.letterhead_footer ?? ''} onChange={(e) => setEdit({ ...edit, letterhead_footer: e.target.value })} placeholder="Indirizzo, telefono, P.IVA, REA, capitale sociale" style={{ minHeight: 60 }} /></Field>
          </div>
          {sup && <>
            <h3 style={{ margin: '16px 0 8px' }}>Addebito SEPA (debitore)</h3>
            <div className="form-grid">
              <Field label="IBAN" help={<>Della Legal entity: si modifica in <Link to={ADMIN_ORGS}>Amministrazione, Legal entity</Link></>}><input className="mono" value={edit.iban || ''} disabled placeholder="non indicato in Amministrazione" /></Field>
              <Field label="BIC" help="Dalla Legal entity"><input value={edit.bic || ''} disabled placeholder="non indicato" /></Field>
              {f('sepa_mandate_id', 'Identificativo mandato SDD')}
              <Field label="Data firma mandato"><input type="date" value={edit.sepa_mandate_date ? String(edit.sepa_mandate_date).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, sepa_mandate_date: e.target.value })} /></Field>
              <label className="f inline" style={{ marginTop: 22 }}><input type="checkbox" checked={!!edit.is_franchisor} onChange={(e) => setEdit({ ...edit, is_franchisor: e.target.checked })} />Capofila della rete (creditore delle royalty, nessun addebito)</label>
            </div>
            {edit.sepa_first_done && <div className="small muted" style={{ marginTop: 6 }}>Primo addebito già eseguito: i prossimi saranno RCUR.</div>}
          </>}
        </Modal>
      )}
    </div>
  );
}
