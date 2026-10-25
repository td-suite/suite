// Adattatore di autenticazione: l'app chiedeva /auth/me; nella Suite l'utente del modulo arriva dalla cornice (ModuleFrame)
// con role = profilo del grant (ADMIN, EDITOR, VIEWER). Gli helper isAdmin/canEdit dell'app restano identici.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, loading: false, pending: false, authMethod: 'SUITE' });

export function ModuleAuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, loading: false, pending: false, authMethod: 'SUITE', refresh: () => {}, logout: () => {} }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const canEdit = (u) => u?.role === 'ADMIN' || u?.role === 'EDITOR';
