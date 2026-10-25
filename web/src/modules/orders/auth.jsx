// Adattatore di autenticazione: l'utente è quello della Suite tradotto dal server nel formato dell'app
// (riga users del modulo con role = profilo del grant; struttura_id = sede dell'anagrafica unica nell'ambito del grant, site_ids[0]).
// Gli helper di ruolo dell'app restano identici; login, logout e onboarding sono della Suite.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null, authMethod: 'SUITE', loading: false });

export function AuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, authMethod: 'SUITE', loading: false, onboarding: null, refresh: () => {}, logout: () => {} }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...roles) => roles.includes(user?.role);

export const isOps = (u) => ['SUPERADMIN', 'PROCUREMENT'].includes(u?.role);
export const isSuper = (u) => u?.role === 'SUPERADMIN';
