import React, { Suspense, useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { MODULES } from '../modules/registry.js';
import { useAuth, isAdmin, hasModule } from '../auth.jsx';
import { api } from '../api.js';
import { Skeleton, Empty } from './ui.jsx';
import { Icon } from './Icons.jsx';
import { Forbidden } from '../pages/Misc.jsx';

// Cornice comune ai moduli travasati: verifica grant e stato (MIRROR/LIVE), carica il modulo a richiesta, isola il CSS sotto .mod-<key>
export default function ModuleFrame({ moduleKey }) {
  const params = useParams();
  const key = moduleKey || params.moduleKey;
  const { user } = useAuth();
  // Modulo, stato ed errore restano legati alla chiave per cui sono stati caricati. Passando da un widget a un altro (es. "Guida al
  // widget": /room → /suiteguida/widget/room) la chiave cambia subito, ma lo stato si aggiorna solo dopo l'effetto: senza questo legame
  // il widget di partenza veniva disegnato una volta sul nuovo indirizzo, non lo riconosceva e riportava alla propria pagina iniziale
  // (difetto della v0.89.0: il link non funzionava da nessun widget).
  const [car, setCar] = useState({ key: null, Mod: null, state: null, err: null });
  const def = MODULES[key];
  useEffect(() => {
    let alive = true;
    if (!def) return;
    setCar({ key, Mod: null, state: null, err: null });
    const agg = (x) => alive && setCar((c) => (c.key === key ? { ...c, ...x } : c));
    def.load().then((m) => agg({ Mod: m.default })).catch((e) => agg({ err: e }));
    api.get(`/${key}/state`, { silent: true }).then((s) => agg({ state: s })).catch((e) => agg({ state: { error: e } }));
    return () => { alive = false; };
  }, [key]);
  const mio = car.key === key;
  const Mod = mio ? car.Mod : null; const state = mio ? car.state : null; const err = mio ? car.err : null;
  if (!def) return <Navigate to="/" replace />;
  // openToAll (meta.js del modulo, es. Ticket): accessibile a chiunque sia autenticato, anche senza grant
  if (!(isAdmin(user) || hasModule(user, key) || def.openToAll)) return <Forbidden />;
  if (err) return <div className="page"><Empty icon="alert" title="Modulo non caricato">{err.message}</Empty></div>;
  if (state?.error) {
    const off = state.error.code === 'MODULE_OFF' || state.error.status === 503;
    return <div className="page"><Empty icon="import" title={off ? 'Modulo non ancora attivato' : 'Modulo non disponibile'}>{off ? 'Il modulo si attiva da Amministrazione > Attivazione moduli.' : state.error.message}</Empty></div>;
  }
  if (!Mod || !state) return <div className="page"><Skeleton lines={8} /></div>;
  return (
    <div className={`mod mod-${key}`}>
      {state.mode === 'MIRROR' && <div className="mod-banner"><Icon name="info" /><span>Modulo in collaudo: i dati sono una copia aggiornata al {state.last_copy_at ? new Date(state.last_copy_at).toLocaleString('it-IT') : 'ultimo travaso'}; le modifiche si fanno ancora nell'app originale.</span></div>}
      <Suspense fallback={<div className="page"><Skeleton lines={8} /></div>}>
        <Mod moduleKey={key} mode={state.mode} moduleUser={state.user} />
      </Suspense>
    </div>
  );
}
