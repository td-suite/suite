// Adattatore di autenticazione: utente e stato arrivano da GET /api/crediti/state (ruolo e permessi calcolati dal server).
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, state: null });
export function AuthProvider({ user, state, children }) { return <AuthCtx.Provider value={{ user, state }}>{children}</AuthCtx.Provider>; }
export const useAuth = () => useContext(AuthCtx);
