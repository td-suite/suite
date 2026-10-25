// Adattatore di autenticazione: l'utente del modulo arriva dalla Suite (ModuleFrame → props moduleUser).
// useAuth() ritorna { user } con user.role = profilo del grant Suite (ADMIN, HR, VIEWER); gli helper dell'app restano identici.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, loading: false, onboarding: null, authMethod: 'SUITE' }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const canWrite = (u) => ['ADMIN', 'HR'].includes(u?.role);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const seesCosts = (u) => ['ADMIN', 'HR'].includes(u?.role);
