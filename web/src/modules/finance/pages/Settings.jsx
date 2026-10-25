import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, Badge, MoneyInput, Modal, useToast } from '../components/ui.jsx';
import { eur } from '../format.js';
import { prettyIban } from '../words.js';

const NUM = ['threshold_single', 'threshold_joint'];
const FIELDS = [
  ['threshold_single', 'Soglia firma singola (€)', 'Fino a questo importo firma uno solo tra AD e CFO (delibera n. 11, punto 2 lett. D; procura CFO delibera n. 12).'],
  ['threshold_joint', 'Soglia delibera CdA (€)', 'Oltre questo importo serve la delibera preventiva del CdA, oltre alla firma congiunta.'],
  ['aggregation_days', 'Finestra anti-frazionamento (giorni)', 'Le istanze verso la stessa controparte entro questa finestra vengono sommate per il controllo delle soglie.'],
  ['token_days', 'Validità del link di firma (giorni)', ''],
  ['reminder_days', 'Sollecito automatico dopo (giorni)', '0 per disattivare. Il controllo gira ogni 6 ore.'],
  ['protocol_prefix', 'Prefisso del protocollo', 'es. AP → AP-2026-0001'],
  ['mail_cc', 'Copia conoscenza su tutte le email', 'Indirizzi separati da virgola, es. amministrazione@toscanadiagnostica.it'],
  ['company_name', 'Ragione sociale', ''],
];
const TEXTS = [
  ['form_title_joint', 'Titolo del modulo (firma congiunta)'],
  ['form_title_single', 'Titolo del modulo (firma singola)'],
  ['form_ref', 'Riferimento normativo in epigrafe'],
  ['auth_text', 'Testo della sezione 4. Autorizzazione'],
];

export default function Settings() {
  const toast = useToast();
  const { user } = useAuth();
  const admin = isAdmin(user);
  const cfg = useApi('/settings');
  const banks = useApi('/bank-accounts?all=1');
  const [f, setF] = useState(null);
  const [bank, setBank] = useState(null);
  const [mail, setMail] = useState(null);
  useEffect(() => { if (cfg.data) setF({ ...cfg.data.settings }); }, [cfg.data]);
  const save = async () => { try { await api.put('/settings', f); toast('Impostazioni salvate'); cfg.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveBank = async () => {
    try {
      const body = { bank_name: bank.bank_name, iban: bank.iban, label: bank.label || null, active: bank.active ?? true, sort_order: Number(bank.sort_order || 100) };
      if (bank.id) await api.put(`/bank-accounts/${bank.id}`, body); else await api.post('/bank-accounts', body);
      setBank(null); banks.reload(); toast('Conto salvato');
    } catch (e) { toast(e.message, 'err'); }
  };
  const testMail = async () => { try { setMail(await api.get('/settings/mail-status')); } catch (e) { setMail({ ok: false, error: e.message }); } };
  if (!f || !cfg.data) return <div className="page">{cfg.error ? <ErrorBox error={cfg.error} /> : <Loading />}</div>;
  const d = cfg.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Soglie e riferimenti normativi del modulo, conti di addebito, stato dei servizi.{admin ? '' : ' In sola lettura: le modifiche sono riservate agli amministratori.'}</div></div>{admin && <button className="btn" onClick={save}>Salva impostazioni</button>}</div>
      <div className="grid g2">
        <Card title="Poteri di firma e flusso">
          <div className="form-grid">
            {FIELDS.map(([k, label, help]) => <Field key={k} label={label} help={help} className={k === 'mail_cc' || k === 'company_name' ? 'span2' : ''}>{NUM.includes(k) ? <MoneyInput value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} /> : <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Firmatari attivi: {d.signers.length ? d.signers.map((s) => `${s.role}: ${s.title ? `${s.title} ` : ''}${s.full_name} (${s.email})`).join(' · ') : <span className="red">nessuno: assegna i profili CEO e CFO del modulo Payments in Amministrazione &gt; Utenti della Suite</span>}</div>
          <div className="small muted" style={{ marginTop: 6 }}>Utenti, profili (Finance Support, CEO, CFO, Consultazione) e accessi si gestiscono nella Suite: Amministrazione &gt; Utenti, modulo Payments.</div>
        </Card>
        <Card title="Stato dei servizi">
          <table className="t"><tbody>
            <tr><td>Accesso Microsoft 365 (Suite)</td><td>{d.entraEnabled ? <Badge tone="green">configurato</Badge> : <Badge tone="red">non configurato (ENTRA_*)</Badge>}</td></tr>
            <tr><td>Invio email</td><td>{d.mailMode === 'GRAPH' ? <Badge tone="green">Microsoft Graph · {d.mailSender}</Badge> : <Badge tone="mauve">modalità {d.mailMode}: i link di firma compaiono nell'app</Badge>} {admin && <button className="btn sm ghost" onClick={testMail}>Verifica</button>}{mail && <div className="small" style={{ marginTop: 4 }}>{mail.ok ? <span className="green">Token Graph ottenuto: invio operativo</span> : <span className="red">{mail.error || `modalità ${mail.mode}`}</span>}</div>}</td></tr>
            <tr><td>Conversione PDF (LibreOffice)</td><td>{d.pdfEnabled ? <Badge tone="green">disponibile</Badge> : <Badge tone="red">non disponibile sul server: anteprime e moduli vengono prodotti in DOCX, il flusso di firma non si ferma</Badge>}</td></tr>
            <tr><td>Firma con accesso locale</td><td>{d.signAllowLocal ? <Badge tone="red">consentita (solo sviluppo)</Badge> : <Badge tone="green">solo Microsoft 365</Badge>}</td></tr>
            <tr><td>Dimensione massima allegati</td><td>{d.maxUploadMb} MB</td></tr>
          </tbody></table>
        </Card>
      </div>
      <Card title="Conti di addebito" className="mt" flush actions={admin && <button className="btn sm" onClick={() => setBank({ bank_name: '', iban: '', label: '', active: true, sort_order: 100 })}>+ Conto</button>}>
        <table className="t"><thead><tr><th>Banca</th><th>IBAN</th><th>Etichetta</th><th>Stato</th><th className="num" /></tr></thead>
          <tbody>{(banks.data || []).map((b) => <tr key={b.id}><td>{b.bank_name}</td><td className="mono">{prettyIban(b.iban)}</td><td>{b.label}</td><td>{b.active ? <Badge tone="green">attivo</Badge> : <Badge tone="grey">disattivato</Badge>}</td><td className="num">{admin && <button className="btn sm ghost" onClick={() => setBank(b)}>Modifica</button>}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Testi del modulo" className="mt">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TEXTS.map(([k, label]) => <Field key={k} label={label} help={f[k] !== d.defaults[k] ? 'modificato rispetto al testo predefinito' : ''}>{k.startsWith('form_title') ? <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <textarea value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ minHeight: k === 'auth_text' ? 140 : 70 }} />}</Field>)}
          <div className="small muted">Il modulo cita soglie e delibere: aggiorna questi testi quando il CdA modifica i poteri. Soglie correnti: firma singola fino a {eur(f.threshold_single)}, delibera CdA oltre {eur(f.threshold_joint)}.</div>
        </div>
      </Card>
      {bank && <Modal title={bank.id ? 'Modifica conto' : 'Nuovo conto di addebito'} onClose={() => setBank(null)} footer={<><button className="btn ghost" onClick={() => setBank(null)}>Annulla</button><button className="btn" onClick={saveBank}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Banca" className="span2"><input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></Field>
          <Field label="IBAN" className="span2"><input className="mono" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value.toUpperCase() })} /></Field>
          <Field label="Etichetta"><input value={bank.label || ''} onChange={(e) => setBank({ ...bank, label: e.target.value })} /></Field>
          <Field label="Ordine"><input type="number" value={bank.sort_order} onChange={(e) => setBank({ ...bank, sort_order: e.target.value })} /></Field>
          <Field label="Attivo" className="inline"><input type="checkbox" checked={bank.active ?? true} onChange={(e) => setBank({ ...bank, active: e.target.checked })} /> selezionabile nelle istanze</Field>
        </div>
      </Modal>}
    </div>
  );
}
