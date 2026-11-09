// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/ferie/state).
// role: ADMIN (HR) | RESPONSABILE | DIPENDENTE (implicito); isApprovatore: è il superiore diretto (o il delegato) di almeno una persona;
// haCatena: ha riporti nell'anagrafica (li vede in "La mia catena", in sola lettura oltre i diretti).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });
export function AuthProvider({ user, children }) { return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
export const isHr = (u) => u?.role === 'ADMIN' || u?.isAdmin;
export const vedeTutto = (u) => isHr(u) || u?.isViewer;
export const isApprovatore = (u) => Boolean(isHr(u) || u?.isApprovatore);
