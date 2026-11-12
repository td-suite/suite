// Adattatore di autenticazione della Guida GIPO: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/gipoguida/state).
// role: ADMIN (redazione) | LETTORE (consultazione e domande).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, stato: null });
export function AuthProvider({ user, stato, children }) { return <AuthCtx.Provider value={{ user, stato }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN' || u?.isAdmin;
