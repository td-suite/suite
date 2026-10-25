import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { useApi, Card, Badge, Field, PageHead, Avatar, useToast, Modal, ErrorBox, Switch } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { PasswordFields } from './Auth.jsx';
import { LEVEL, PROVIDER, AREA_NAMES, AREA_COLORS } from '../format.js';

export default function Profile() {
  const { user, refresh, authMethod, cfg } = useAuth();
  const toast = useToast();
  const sites = useApi('/sites');
  const mods = useApi('/modules');
  const [f, setF] = useState({ phone: user.phone || '', title: user.title || '', bio: user.bio || '', site_id: user.site_id || '', lang: user.lang || 'it', notify_email: user.notify_email !== false });
  const [busy, setBusy] = useState(false);
  useEffect(() => setF({ phone: user.phone || '', title: user.title || '', bio: user.bio || '', site_id: user.site_id || '', lang: user.lang || 'it', notify_email: user.notify_email !== false }), [user]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.put('/auth/me', { phone: f.phone || null, title: f.title || null, bio: f.bio || null, site_id: f.site_id ? Number(f.site_id) : null, lang: f.lang, notify_email: Boolean(f.notify_email) }); await refresh(); toast('Profilo aggiornato'); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  const uploadAvatar = async (file) => {
    try { const fd = new FormData(); fd.append('file', file); await api.upload('/files/avatar', fd); await refresh(); toast('Foto aggiornata'); } catch (e) { toast(e, 'err'); }
  };

  // Sicurezza
  const [pwModal, setPwModal] = useState(false);
  const [totpModal, setTotpModal] = useState(null); // {secret, qr}
  const [disableModal, setDisableModal] = useState(false);
  const local = ['LOCAL', 'BOTH'].includes(user.auth_provider);
  const startTotp = async () => { try { setTotpModal(await api.post('/auth/totp/setup')); } catch (e) { toast(e, 'err'); } };

  const ORDER = ['DIREZIONE', 'FINANCE', 'RETAIL_FLOW', 'OPERATIONS', 'HQS', 'PEOPLE'];
  const grants = Object.entries(user.grants || {}).sort(([, a], [, b]) => ORDER.indexOf(a.area) - ORDER.indexOf(b.area));
  const modByKey = Object.fromEntries((mods.data || []).map((m) => [m.key, m]));

  return (
    <div className="page narrow">
      <PageHead title="Il mio profilo" icon="user" sub="Dati personali, sede, preferenze e sicurezza dell'account" />
      <div className="grid g2">
        <div className="col">
          <Card title="Dati" icon="user">
            <div className="row top mb2">
              <Avatar name={user.full_name} fileId={user.avatar_file_id} size="xl" />
              <div style={{ flex: 1 }}>
                <div className="strong" style={{ fontSize: 18 }}>{user.full_name}</div>
                <div className="muted">{user.email}</div>
                <div className="row tight mt"><Badge tone={user.level === 'USER' ? 'grey' : 'teal'}>{LEVEL[user.level]}</Badge>{user.person_job_title && <Badge tone="mauve">{user.person_job_title}</Badge>}{user.organization_name && <Badge tone="grey">{user.organization_name}</Badge>}</div>
                {cfg.blobEnabled && <label className="btn sm ghost mt" style={{ cursor: 'pointer' }}><Icon name="upload" />Cambia foto<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadAvatar(e.target.files[0])} /></label>}
              </div>
            </div>
            <form onSubmit={save} className="col">
              <div className="form-grid">
                <Field label="Titolo" help="Dott., Dott.ssa, Ing."><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={20} /></Field>
                <Field label="Telefono"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Sede principale"><select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">Nessuna</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}</select></Field>
                <Field label="Lingua"><select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}><option value="it">Italiano</option><option value="en">English</option></select></Field>
              </div>
              <Field label="Presentazione" help={`Visibile nella rubrica · ${f.bio.length} / 4000 caratteri`}><textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value.slice(0, 4000) })} style={{ minHeight: 160 }} /></Field>
              <label className="f inline"><Switch checked={f.notify_email} onChange={(v) => setF({ ...f, notify_email: v })} label="Notifiche via email" />Ricevi le notifiche anche via email</label>
              <div className="row end"><button className="btn" disabled={busy}>Salva</button></div>
            </form>
          </Card>
        </div>
        <div className="col">
          <Card title="Sicurezza" icon="shield">
            <div className="col">
              <div className="row between"><div><div className="strong">Metodo di accesso</div><div className="small muted">{PROVIDER[user.auth_provider] || user.auth_provider}{authMethod ? ` · sessione attuale: ${authMethod === 'ENTRA' ? 'Microsoft 365' : 'credenziali'}` : ''}</div></div></div>
              {local && <div className="row between"><div><div className="strong">Password</div><div className="small muted">Cambiala periodicamente e non riutilizzarla altrove.</div></div><button className="btn ghost sm" onClick={() => setPwModal(true)}>Cambia password</button></div>}
              {local && <div className="row between"><div><div className="strong">Verifica in due passaggi (TOTP)</div><div className="small muted">{user.totp_enabled ? 'Attiva: ti chiederemo un codice a ogni accesso con credenziali.' : 'Proteggi l\'account con un codice dall\'app di autenticazione.'}{user.needs_totp && !user.totp_enabled && <span className="amber"> Richiesta per gli amministratori.</span>}</div></div>{user.totp_enabled ? <button className="btn ghost sm" onClick={() => setDisableModal(true)}>Disattiva</button> : <button className="btn sm" onClick={startTotp}>Attiva</button>}</div>}
              {!local && <div className="small muted">L'accesso avviene con Microsoft 365: password e verifica in due passaggi sono gestite dall'account aziendale.</div>}
            </div>
          </Card>
          <Card title="I miei moduli" icon="grid">
            {isAdmin(user) && <div className="small muted mb">Come {LEVEL[user.level].toLowerCase()} hai accesso a tutti i moduli non riservati.</div>}
            {!grants.length && !isAdmin(user) && <div className="small muted">Nessun modulo assegnato. L'amministrazione può abilitarli dalla sezione Utenti.</div>}
            <div className="col" style={{ gap: 8 }}>{grants.map(([k, g]) => { const m = modByKey[k]; const label = m?.profiles?.find((p) => p.key === g.profile)?.label || g.profile; return (
              <div key={k} className="row tight"><Icon name={m?.icon || k} style={{ width: 28, height: 28, color: AREA_COLORS[g.area] || 'var(--teal)' }} /><div style={{ flex: 1 }}><div className="strong">{m?.name || k}</div><div className="tiny muted">{AREA_NAMES[g.area] || g.area}{g.scopes?.length ? ` · ${g.scopes.length} ambit${g.scopes.length === 1 ? 'o' : 'i'}` : ''}</div></div><Badge tone="teal">{label}</Badge></div>
            ); })}</div>
          </Card>
        </div>
      </div>

      {pwModal && <ChangePwModal onClose={() => setPwModal(false)} />}
      {totpModal && <TotpModal setup={totpModal} onClose={() => setTotpModal(null)} onDone={refresh} />}
      {disableModal && <DisableTotpModal onClose={() => setDisableModal(false)} onDone={refresh} />}
    </div>
  );
}

function ChangePwModal({ onClose }) {
  const toast = useToast();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(null);
  const go = async (e) => { e.preventDefault(); if (pw !== pw2) return setErr(new Error('Le due password non coincidono')); try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw }); toast('Password aggiornata'); onClose(); } catch (e2) { setErr(e2); } };
  return (
    <Modal title="Cambia password" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="pwform">Salva</button></>}>
      <ErrorBox error={err} />
      <form id="pwform" onSubmit={go} className="col"><Field label="Password attuale"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus /></Field><PasswordFields value={pw} onChange={setPw} confirm={pw2} onConfirm={setPw2} /></form>
    </Modal>
  );
}

function TotpModal({ setup, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState(''); const [err, setErr] = useState(null);
  const go = async (e) => { e.preventDefault(); try { await api.post('/auth/totp/enable', { code }); toast('Verifica in due passaggi attiva'); onDone(); onClose(); } catch (e2) { setErr(e2); } };
  return (
    <Modal title="Attiva la verifica in due passaggi" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="totpform" disabled={code.length !== 6}>Conferma</button></>}>
      <p className="muted">Inquadra il codice con Microsoft Authenticator o Google Authenticator, poi inserisci il codice a sei cifre mostrato dall'app.</p>
      <div style={{ textAlign: 'center' }}>{setup.qr && <img src={setup.qr} alt="Codice QR per l'app di autenticazione" style={{ width: 200, height: 200, borderRadius: 12, background: '#fff', padding: 8 }} />}</div>
      {setup.secret && <div className="small muted mt" style={{ textAlign: 'center' }}>Oppure inserisci manualmente: <span className="mono">{setup.secret}</span></div>}
      <ErrorBox error={err} />
      <form id="totpform" onSubmit={go} className="mt"><input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="000000" aria-label="Codice a sei cifre" autoFocus /></form>
    </Modal>
  );
}

function DisableTotpModal({ onClose, onDone }) {
  const toast = useToast();
  const [pw, setPw] = useState(''); const [err, setErr] = useState(null);
  const go = async (e) => { e.preventDefault(); try { await api.post('/auth/totp/disable', { password: pw }); toast('Verifica in due passaggi disattivata'); onDone(); onClose(); } catch (e2) { setErr(e2); } };
  return (
    <Modal title="Disattiva la verifica in due passaggi" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn danger" form="dtform">Disattiva</button></>}>
      <ErrorBox error={err} />
      <form id="dtform" onSubmit={go}><Field label="Conferma con la tua password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field></form>
    </Modal>
  );
}
