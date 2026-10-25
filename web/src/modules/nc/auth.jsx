// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → props.moduleUser, da GET /api/nc/state).
// useAuth() del modulo ritorna { user } con user.role = profilo del grant Suite e user.sedi = sedi assegnate (scope del grant).
// Gli helper di ruolo dell'app restano identici.
import React, { createContext, useCallback, useContext, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user: initial, children }) {
  const [user, setUser] = useState(initial);
  // dopo il salvataggio delle preferenze (notifiche, telefono) si rilegge l'utente del modulo
  const refresh = useCallback(async () => { try { const me = await api.get('/auth/me', { silent: true }); setUser(me.user); } catch { /* resta l'utente della Suite */ } }, []);
  const value = { loading: false, user: user || initial, pending: false, authMethod: 'SUITE', refresh, logout: async () => {} };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const isQualita = (u) => u?.role === 'ADMIN' || u?.role === 'QUALITA';
export const isLab = (u) => ['ADMIN', 'QUALITA', 'LAB'].includes(u?.role);
export const isSede = (u) => u?.role === 'SEDE';
export const isInternal = (u) => ['ADMIN', 'QUALITA', 'LAB', 'VIEWER'].includes(u?.role);
