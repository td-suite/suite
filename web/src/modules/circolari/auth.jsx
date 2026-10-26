// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/circolari/state)
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });
export function AuthProvider({ user, children }) { return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const canPublish = (u) => ['ADMIN', 'PUBBLICATORE'].includes(u?.role);
export const canEdit = (u) => ['ADMIN', 'PUBBLICATORE', 'REDATTORE'].includes(u?.role);
