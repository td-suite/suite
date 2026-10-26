// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/ticket/state).
// role: ADMIN | RESPONSABILE | VIEWER | UTENTE (implicito); isManager: responsabile di almeno una casella (org_positions.is_head).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });
export function AuthProvider({ user, children }) { return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN' || u?.isAdmin;
export const isGestore = (u) => Boolean(isAdmin(u) || u?.isManager || u?.isViewer);
