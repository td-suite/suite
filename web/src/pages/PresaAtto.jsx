// Presa d'atto delle informative (richiesta del CEO, 05/11/2026): dopo il login, dopo l'eventuale cambio password e prima della Home.
// Blocca la Suite finché l'utente non spunta la casella e preme "Continua"; si ripresenta quando cambia la versione di una delle due
// informative (Amministrazione > Impostazioni > Informative). Si registrano solo i documenti non ancora accettati nella versione corrente.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, ErrorBox, Logo, Badge } from '../components/ui.jsx';
import { IconaPrivacy, IconaIA, TITOLI, useInformative } from '../components/Informative.jsx';
import { fmtDate } from '../format.js';

const ICONE = { PRIVACY: IconaPrivacy, IA: IconaIA };

export default function PresaAtto() {
  const { user, refresh, logout } = useAuth();
  const url = useInformative();
  const [stato, setStato] = useState(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/consensi/stato').then(setStato).catch(setErr); }, []);
  const daAccettare = stato?.da_accettare || user?.consensi_da_accettare || [];
  // l'utente ha già accettato una versione precedente di almeno un documento: è un aggiornamento, non il primo accesso
  const aggiornamento = stato && stato.documenti.some((d) => d.accettato);

  const continua = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/consensi/accetta', { documenti: daAccettare }); await refresh(); } catch (e) { setErr(e); setBusy(false); }
  };

  const documenti = stato?.documenti || ['PRIVACY', 'IA'].map((d) => ({ documento: d, url: url[d], titolo: TITOLI[d] }));
  return (
    <div className="gate">
      <Card className="presa-atto">
        <Logo className="logo" />
        <h1>Prima di iniziare</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {aggiornamento ? 'Una delle informative della Suite è stata aggiornata. Leggi la nuova versione e prendine atto per continuare.'
            : 'Ti chiediamo di leggere le due informative della Suite TD e di prenderne atto. Si aprono in una nuova scheda.'}
        </p>
        <ErrorBox error={err} />
        <div className="presa-atto-docs">
          {documenti.map((d) => {
            const Ico = ICONE[d.documento];
            const nuovo = stato && daAccettare.includes(d.documento) && aggiornamento;
            return (
              <a key={d.documento} className="presa-atto-doc" href={d.url} target="_blank" rel="noopener noreferrer" data-doc={d.documento}>
                <span className="ico-doc"><Ico size={20} /></span>
                <span className="t">
                  <span className="n">{TITOLI[d.documento]}</span>
                  <span className="v">{stato ? `Versione ${d.versione}${d.data ? ` del ${fmtDate(d.data)}` : ''}` : '\u00a0'}</span>
                </span>
                {nuovo && <Badge tone="amber">Aggiornata</Badge>}
              </a>
            );
          })}
        </div>
        <label className="presa-atto-check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>Ho letto le due informative e ne prendo atto</span>
        </label>
        <div className="col" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn lg" disabled={!ok || busy || !stato} onClick={continua}>{busy ? 'Un momento' : 'Continua'}</button>
          <button type="button" className="btn link" onClick={logout}>Esci</button>
        </div>
      </Card>
    </div>
  );
}
