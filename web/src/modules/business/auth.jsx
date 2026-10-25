// Adattatore di autenticazione: l'utente del modulo arriva dalla Suite (ModuleFrame → props moduleUser).
// useAuth() ritorna { user } con user.role = profilo del grant Suite; gli helper dell'app restano identici.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, loading: false, onboarding: null, authMethod: 'SUITE' }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const isManager = (u) => ['ADMIN', 'SERVICE', 'RETAIL', 'MDL', 'HQS'].includes(u?.role);
const KIND_ROLE = { PP: 'RETAIL', SRV: 'SERVICE', MDL: 'MDL', SEDE: 'RETAIL' };
export const canEditKind = (u, kind) => isAdmin(u) || KIND_ROLE[kind] === u?.role;
export const canEditDossier = (u) => ['ADMIN', 'HQS', 'RETAIL'].includes(u?.role);
