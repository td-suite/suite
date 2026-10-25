// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → props.moduleUser, da GET /api/retail/state).
// useAuth() del modulo ritorna { user } con user.role = profilo del grant Suite (ADMIN, RETAIL, SEDE, VIEWER)
// e user.site_id / user.site_ids = sedi dell'app assegnate dagli scope del grant (profilo SEDE).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user, children }) {
  const value = { loading: false, user, onboarding: null, authMethod: 'SUITE', refresh: async () => {}, logout: async () => {} };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const canWrite = (u) => ['ADMIN', 'RETAIL'].includes(u?.role);
const ownSites = (u) => (Array.isArray(u?.site_ids) && u.site_ids.length ? u.site_ids : u?.site_id != null ? [u.site_id] : []).map(Number);
export const canEditSite = (u, siteId) => canWrite(u) || (u?.role === 'SEDE' && ownSites(u).includes(Number(siteId)));
export const isAdmin = (u) => u?.role === 'ADMIN';
