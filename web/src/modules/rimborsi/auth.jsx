// Adattatore di autenticazione: l'utente arriva dalla Suite (ModuleFrame → moduleUser, da GET /api/rimborsi/state).
// Ruoli calcolati dal server: isResponsabile (ha riporti diretti in organigramma), isPC (P&C), isTitolare, tutto (P&C o titolare).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, state: null });
export function AuthProvider({ user, state, children }) { return <AuthCtx.Provider value={{ user, state }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
