// Adattatore di autenticazione di Label: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/etichette/state).
// role: ADMIN | OPERATORE; site_ids: sedi del perimetro dell'operatore.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, stato: null });
export function AuthProvider({ user, stato, children }) { return <AuthCtx.Provider value={{ user, stato }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN' || u?.isAdmin;
