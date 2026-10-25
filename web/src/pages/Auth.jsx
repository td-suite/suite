import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, ErrorBox, Card, Logo } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';

const MsLogo = () => <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>;

function Art() {
  return (
    <div className="art">
      <span className="ring2" aria-hidden="true" />
      <img src="/logo-light.svg" alt="Toscana Diagnostica" />
      <div>
        <div className="claim">Ci prendiamo cura del <span>tempo dei pazienti</span>, lì dove ogni minuto conta.</div>
        <div className="sub">Suite TD è l'intranet e la suite operativa della rete Toscana Diagnostica: laboratorio analisi, diagnostica per immagini, medicina specialistica e medicina del lavoro, in un unico accesso.</div>
      </div>
      <div className="foot">Toscana Diagnostica · accesso riservato al personale, ai medici, alle strutture ospitanti e ai clienti Service</div>
    </div>
  );
}

function Pane({ children }) {
  return (
    <div className="login">
      <Art />
      <div className="pane">
        <div className="box">
          <div className="mobile-logo"><img src="/logo-light.svg" alt="Toscana Diagnostica" /></div>
          {children}
        </div>
      </div>
    </div>
  );
}

const ERRORS = {
  entra: 'Accesso con Microsoft 365 non riuscito. Riprova o usa le credenziali.',
  entra_denied: 'Il tuo account Microsoft non è abilitato alla Suite. Contatta l\'amministrazione.',
  expired: 'Il collegamento non è più valido. Richiedine uno nuovo.',
  session: 'La sessione è scaduta. Accedi di nuovo.',
};

export function Login() {
  const { refresh, cfg } = useAuth();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(() => { const e = sp.get('error'); return e ? new Error(ERRORS[e] || decodeURIComponent(e)) : null; });
  const [busy, setBusy] = useState(false);
  const [showCreds, setShowCreds] = useState(!cfg.entraEnabled);
  useEffect(() => { if (!cfg.entraEnabled) setShowCreds(true); }, [cfg.entraEnabled]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post('/auth/login', { email, password });
      await refresh();
    } catch (e2) { setErr(e2); }
    setBusy(false);
  };

  return (
    <Pane>
      <div>
        <h1>Accedi alla Suite</h1>
        <div className="muted" style={{ marginTop: 6 }}>Personale Toscana Diagnostica con l'account Microsoft 365. Strutture ospitanti, clienti Service e collaboratori esterni con le credenziali ricevute.</div>
      </div>
      <ErrorBox error={err} />
      {cfg.entraEnabled && (
        <a className="btn ms lg" href={`/api/auth/entra/login?next=${encodeURIComponent(next)}`}><MsLogo />Entra con Microsoft 365</a>
      )}
      {cfg.entraEnabled && !showCreds && <button type="button" className="btn link" onClick={() => setShowCreds(true)}>Accesso con credenziali</button>}
      {showCreds && (
        <form onSubmit={submit} className="col">
          {cfg.entraEnabled && <div className="or">Accesso con credenziali</div>}
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!cfg.entraEnabled} /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn lg" disabled={busy}>{busy ? 'Verifica in corso' : 'Accedi'}</button>
          <div className="row between small"><Link to="/forgot">Password dimenticata</Link><span className="muted">Problemi di accesso? Scrivi all'amministrazione.</span></div>
        </form>
      )}
    </Pane>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/forgot', { email }); setDone(true); } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <Pane>
      <div><h1>Password dimenticata</h1><div className="muted" style={{ marginTop: 6 }}>Inserisci l'email con cui accedi: se l'account esiste e usa le credenziali, riceverai un collegamento per impostare una nuova password.</div></div>
      <ErrorBox error={err} />
      {done ? <div className="alert ok"><Icon name="check" /><span>Se l'indirizzo è registrato, l'email è in arrivo. Controlla anche la posta indesiderata.</span></div> : (
        <form onSubmit={submit} className="col">
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <button className="btn lg" disabled={busy}>Invia il collegamento</button>
        </form>
      )}
      <Link to="/login" className="small">Torna all'accesso</Link>
    </Pane>
  );
}

export function PasswordFields({ value, onChange, confirm, onConfirm, label = 'Nuova password' }) {
  const weak = value && value.length < 12;
  return (
    <>
      <Field label={label} help="Almeno 12 caratteri. Consigliato: una frase facile da ricordare."><input type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} required minLength={12} /></Field>
      <Field label="Ripeti la password"><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} required /></Field>
      {weak && <div className="small amber">La password è troppo corta.</div>}
      {confirm && value !== confirm && <div className="small red">Le due password non coincidono.</div>}
    </>
  );
}

export function Reset() {
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const navigate = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); if (pw !== pw2) return setErr(new Error('Le due password non coincidono'));
    setBusy(true); setErr(null);
    try { await api.post('/auth/reset', { token, newPassword: pw }); setDone(true); setTimeout(() => navigate('/login'), 2500); } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <Pane>
      <div><h1>Nuova password</h1><div className="muted" style={{ marginTop: 6 }}>Scegli la nuova password per il tuo account.</div></div>
      <ErrorBox error={!token ? new Error('Collegamento non valido: manca il codice di verifica.') : err} />
      {done ? <div className="alert ok"><Icon name="check" /><span>Password aggiornata. Tra un istante torni alla pagina di accesso.</span></div> : (
        <form onSubmit={submit} className="col">
          <PasswordFields value={pw} onChange={setPw} confirm={pw2} onConfirm={setPw2} />
          <button className="btn lg" disabled={busy || !token}>Salva la password</button>
        </form>
      )}
      <Link to="/login" className="small">Torna all'accesso</Link>
    </Pane>
  );
}

export function Totp() {
  const { refresh, logout } = useAuth();
  const [code, setCode] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/totp/verify', { code: code.replace(/\s/g, '') }); await refresh(); } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <div className="gate">
      <Card>
        <Logo className="logo" />
        <h1>Verifica in due passaggi</h1>
        <p className="muted" style={{ marginTop: 6 }}>Inserisci il codice a sei cifre generato dall'app di autenticazione sul tuo telefono.</p>
        <ErrorBox error={err} />
        <form onSubmit={submit} className="col mt">
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} autoFocus aria-label="Codice a sei cifre" placeholder="000000" />
          <button className="btn lg" disabled={busy || code.length !== 6}>Verifica</button>
          <button type="button" className="btn link" onClick={logout}>Annulla e torna all'accesso</button>
        </form>
      </Card>
    </div>
  );
}

export function ChangePassword() {
  const { refresh, logout, user } = useAuth();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); if (pw !== pw2) return setErr(new Error('Le due password non coincidono'));
    setBusy(true); setErr(null);
    try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw }); await refresh(); } catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <div className="gate">
      <Card>
        <Logo className="logo" />
        <h1>Benvenuto, {user?.full_name?.split(' ')[0]}</h1>
        <p className="muted" style={{ marginTop: 6 }}>Al primo accesso ti chiediamo di sostituire la password provvisoria con una tua.</p>
        <ErrorBox error={err} />
        <form onSubmit={submit} className="col mt">
          <Field label="Password attuale"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus /></Field>
          <PasswordFields value={pw} onChange={setPw} confirm={pw2} onConfirm={setPw2} />
          <button className="btn lg" disabled={busy}>Imposta la password</button>
          <button type="button" className="btn link" onClick={logout}>Esci</button>
        </form>
      </Card>
    </div>
  );
}

export function Pending() {
  const { user, logout } = useAuth();
  return (
    <div className="gate">
      <Card>
        <Logo className="logo" />
        <h1>Account in attesa di abilitazione</h1>
        <p className="muted" style={{ marginTop: 6 }}>Ciao {user?.full_name}, il tuo accesso è stato registrato ma non è ancora attivo. L'amministrazione di Toscana Diagnostica lo abiliterà a breve: riceverai un'email quando potrai entrare.</p>
        <div className="alert info"><Icon name="info" /><span>Account: {user?.email}</span></div>
        <div className="row mt2"><button className="btn dark" onClick={logout}><Icon name="logout" />Esci</button></div>
      </Card>
    </div>
  );
}
