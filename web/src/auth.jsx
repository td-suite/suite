import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
const EMPTY = { loading: false, user: null, pending: false, totpRequired: false, mustChangePassword: false, authMethod: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...EMPTY, loading: true });
  const [cfg, setCfg] = useState({ appName: 'Suite TD', entraEnabled: false, blobEnabled: false, aiEnabled: false });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me', { silent: true });
      if (!me.user && me.totpRequired) return setState({ ...EMPTY, totpRequired: true, authMethod: me.authMethod });
      setState({
        loading: false, user: me.user, pending: Boolean(me.pending), totpRequired: false, authMethod: me.authMethod,
        mustChangePassword: Boolean(me.user?.must_change_password && me.authMethod === 'LOCAL'),
      });
    } catch {
      setState({ ...EMPTY });
    }
  }, []);

  useEffect(() => {
    api.get('/auth/config', { silent: true }).then((c) => setCfg((x) => ({ ...x, ...c }))).catch(() => {});
    refresh();
    const onUnauth = () => setState({ ...EMPTY });
    const onAuthState = () => refresh();
    window.addEventListener('suite:unauthorized', onUnauth);
    window.addEventListener('suite:authstate', onAuthState);
    // i moduli assegnati da un amministratore devono comparire senza rifare l'accesso: profilo riletto al ritorno sulla scheda e ogni minuto
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    return () => { window.removeEventListener('suite:unauthorized', onUnauth); window.removeEventListener('suite:authstate', onAuthState); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); clearInterval(timer); };
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally { setState({ ...EMPTY }); }
  }, []);

  return <AuthCtx.Provider value={{ ...state, cfg, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isOwner = (u) => u?.level === 'OWNER';
export const isAdmin = (u) => u?.level === 'OWNER' || u?.level === 'ADMIN';
// hasModule(u, 'comunicazione') → ha un grant qualsiasi; hasModule(u, 'comunicazione', 'PUBLISHER') → uno dei profili indicati
export const hasModule = (u, key, ...profiles) => {
  const g = u?.grants?.[key];
  if (!g) return false;
  return profiles.length ? profiles.includes(g.profile) : true;
};
// Può gestire la Comunicazione (news, circolari, avvisi, frasi)
export const canManageComm = (u) => isAdmin(u) || hasModule(u, 'comunicazione');
export const canPublish = (u) => isAdmin(u) || hasModule(u, 'comunicazione', 'PUBLISHER');
