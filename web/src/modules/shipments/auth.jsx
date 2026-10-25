// Adattatore di autenticazione: l'utente è quello della Suite tradotto dal server nel formato dell'app
// (riga users del modulo con role = profilo del grant). Gli helper di ruolo dell'app restano identici.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, authMethod: 'SUITE', loading: false });

export function AuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, authMethod: 'SUITE', loading: false, onboarding: null, refresh: () => {}, logout: () => {} }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...roles) => roles.includes(user?.role);

export const canOperate = (u) => ['SUPERADMIN', 'ADMIN'].includes(u?.role);
export const isSuper = (u) => u?.role === 'SUPERADMIN';
export const isEndeavor = (u) => u?.role === 'ENDEAVOR';
