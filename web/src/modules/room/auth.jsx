// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → props.moduleUser, da GET /api/room/state).
// useAuth() del modulo ritorna { user } con user.role = profilo del grant Suite e user.struttura_ids = sedi assegnate.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user, children }) {
  const value = { loading: false, user, onboarding: null, authMethod: 'SUITE', refresh: async () => {}, logout: async () => {} };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...roles) => roles.includes(user?.role);
