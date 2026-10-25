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
  const [Mod, setMod] = useState(null);
  const [state, setState] = useState(null);
  const [err, setErr] = useState(null);
  const def = MODULES[key];
  useEffect(() => {
    let alive = true;
    if (!def) return;
    def.load().then((m) => alive && setMod(() => m.default)).catch((e) => alive && setErr(e));
    api.get(`/${key}/state`, { silent: true }).then((s) => alive && setState(s)).catch((e) => alive && setState({ error: e }));
    return () => { alive = false; };
  }, [key]);
  if (!def) return <Navigate to="/" replace />;
  if (!(isAdmin(user) || hasModule(user, key))) return <Forbidden />;
  if (err) return <div className="page"><Empty icon="alert" title="Modulo non caricato">{err.message}</Empty></div>;
  if (state?.error) {
    const off = state.error.code === 'MODULE_OFF' || state.error.status === 503;
    return <div className="page"><Empty icon="import" title={off ? 'Modulo non ancora travasato' : 'Modulo non disponibile'}>{off ? 'Il travaso dei dati di questa app nella Suite non è ancora stato eseguito. Nel frattempo l\'app originale resta raggiungibile dal widget in home.' : state.error.message}</Empty></div>;
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
