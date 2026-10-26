// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/cartella/state).
// role: ADMIN (gestione) | VIEWER (consultazione). Owner e Admin della Suite sono ADMIN del modulo.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });
export function AuthProvider({ user, children }) { return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN' || Boolean(u?.isAdmin);
