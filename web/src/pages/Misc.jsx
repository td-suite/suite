import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';

export function NotFound() {
  return (
    <div className="page"><div className="notfound"><div>
      <div className="code">404</div>
      <h1 style={{ marginTop: 10 }}>Pagina non trovata</h1>
      <p className="muted" style={{ marginTop: 8 }}>L'indirizzo che hai aperto non esiste o è stato spostato.</p>
      <Link to="/" className="btn mt"><Icon name="home" />Torna alla Home</Link>
    </div></div></div>
  );
}

export function Forbidden() {
  return (
    <div className="page"><div className="notfound"><div>
      <Icon name="lock" style={{ width: 48, height: 48, color: 'var(--blue)' }} />
      <h1 style={{ marginTop: 10 }}>Sezione non abilitata</h1>
      <p className="muted" style={{ marginTop: 8 }}>Il tuo profilo non prevede l'accesso a questa parte della Suite. Se pensi sia un errore, scrivi all'amministrazione.</p>
      <Link to="/" className="btn mt"><Icon name="home" />Torna alla Home</Link>
    </div></div></div>
  );
}

export function ErrorPage({ error, onRetry }) {
  return (
    <div className="page"><div className="notfound"><div>
      <Icon name="alert" style={{ width: 48, height: 48, color: 'var(--amber)' }} />
      <h1 style={{ marginTop: 10 }}>Qualcosa non ha funzionato</h1>
      <p className="muted" style={{ marginTop: 8 }}>Ci scusiamo per il disguido. Puoi riprovare oppure tornare alla Home; se il problema continua, segnalalo all'amministrazione.</p>
      {error?.message && <div className="small faint mono" style={{ marginTop: 8 }}>{String(error.message).slice(0, 200)}</div>}
      <div className="row mt" style={{ justifyContent: 'center' }}>
        {onRetry && <button className="btn ghost" onClick={onRetry}><Icon name="refresh" />Riprova</button>}
        <a href="/" className="btn"><Icon name="home" />Torna alla Home</a>
      </div>
    </div></div></div>
  );
}
